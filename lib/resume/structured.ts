/**
 * The structured resume (Spec "Structured resume", `resumes.content`).
 *
 * Sections are the user's own: titles, order and grouping come from their
 * resume and are never renamed, merged, split or reordered by Shipmate
 * (CLAUDE.md hard rule 8). Each section has a layout so the template knows
 * how to draw it:
 * - `entries`: heading / subheading / dates / location + bullets
 * - `list`: label: values, separated as the user separates them (commas,
 *   or semicolons when a value has commas of its own: `separator: ";"`)
 * - `text`: one paragraph
 *
 * Two schemas: `resumeContentSchema` is what's stored and edited (shared by
 * the editor, the import route and the worker); `importedResumeSchema` is
 * the flat shape asked of the AI, because both providers' structured output
 * want every field required and handle one flat object type more reliably
 * than a union. `fromImported` turns one into the other.
 */

import { z } from "zod";

const line = (max: number) => z.string().trim().max(max);

export const linkSchema = z.object({
  label: line(100),
  url: line(300),
});

export const headerSchema = z.object({
  name: line(120),
  email: line(200),
  phone: line(60),
  /** Where they live, as the resume's top line writes it (M8 §0c). */
  location: line(120).optional(),
  links: z.array(linkSchema).max(8),
});

export const entrySchema = z.object({
  heading: line(200),
  subheading: line(200),
  dates: line(80),
  location: line(120),
  bullets: z.array(line(600)).max(20),
});

/** A list value's stored limit. Longer is flagged on import, never cut silently. */
export const MAX_LIST_VALUE = 300;

export const listItemSchema = z.object({
  label: line(100),
  values: z.array(line(MAX_LIST_VALUE)).max(60),
  /** ";" when the line separates values with semicolons; absent = commas. */
  separator: z.literal(";").optional(),
});

const title = line(100);

export const sectionSchema = z.discriminatedUnion("layout", [
  z.object({
    title,
    layout: z.literal("entries"),
    items: z.array(entrySchema).max(30),
  }),
  z.object({
    title,
    layout: z.literal("list"),
    items: z.array(listItemSchema).max(30),
  }),
  z.object({ title, layout: z.literal("text"), text: line(3000) }),
]);

export const resumeContentSchema = z.object({
  header: headerSchema,
  sections: z.array(sectionSchema).max(20),
});

export type ResumeContent = z.infer<typeof resumeContentSchema>;
export type ResumeSection = z.infer<typeof sectionSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type ListItem = z.infer<typeof listItemSchema>;
export type Layout = ResumeSection["layout"];

export const LAYOUT_LABELS: Record<Layout, string> = {
  entries: "Entries (title, dates, bullets)",
  list: "List (label: values)",
  text: "Paragraph",
};

// ---------------------------------------------------------------- AI shape

/** What the import asks the model for. Every field required; "" or [] when absent. */
export const importedResumeSchema = z.object({
  header: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  sections: z.array(
    z.object({
      title: z.string(),
      layout: z.enum(["entries", "list", "text"]),
      entries: z.array(
        z.object({
          heading: z.string(),
          subheading: z.string(),
          dates: z.string(),
          location: z.string(),
          bullets: z.array(z.string()),
        }),
      ),
      // The whole line as written; code splits it (splitListLine).
      lists: z.array(z.object({ line: z.string() })),
      text: z.string(),
    }),
  ),
});

export type ImportedResume = z.infer<typeof importedResumeSchema>;

const clean = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/^[•▪◦●\-–*·]\s*/, "")
    .trim();

// ---------------------------------------------------------------- list lines

/** Split on `sep`, but not inside (…): "Python (pandas, NumPy), SQL". */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if ((ch === ")" || ch === "]") && depth > 0) depth -= 1;
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * A list's values as typed: semicolons if the text has any (a value may then
 * have commas of its own), else commas.
 */
export function splitValues(
  text: string,
): Pick<ListItem, "values" | "separator"> {
  return splitTopLevel(text, ";").length > 1
    ? { values: splitTopLevel(text, ";"), separator: ";" }
    : { values: splitTopLevel(text, ",") };
}

/** "Languages: Python, Go" → label "Languages"; a line without one → "". */
const LABEL = /^([^:;,/()]{1,60}?):\s+(.*)$/;

/** One list line, as written, → label and values, in code (M8 §0b). */
export function splitListLine(text: string): ListItem {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = LABEL.exec(clean);
  const label = match ? match[1].trim() : "";
  const rest = match ? match[2] : clean;
  return { label, ...splitValues(rest) };
}

/** How a list's values are written out: ", " or "; ". */
export const joinValues = (item: Pick<ListItem, "values" | "separator">) =>
  item.values.join(item.separator === ";" ? "; " : ", ");

/**
 * The source text of a line the model copied: found in the file with any
 * spacing or line break between its words, and returned as the file has
 * it. null if the file doesn't contain it word for word.
 */
export function findInSource(source: string, line: string): string | null {
  const words = clean(line).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const found = new RegExp(pattern).exec(source);
  return found ? found[0].replace(/\s+/g, " ").trim() : null;
}

export type ImportNoteLike = { where: string; message: string };

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}…` : s}”`;

/**
 * Flat AI output → stored shape. Keeps each section's own fields for its
 * layout, drops empty bullets, and clips to the stored limits so a long
 * answer can't fail validation on save.
 *
 * List lines (M8 §0b): the model only says which lines are lists, copying
 * each whole. With the source text, each line is taken from the file
 * itself, so a value can't be retyped wrong; then code splits it. A line
 * the file doesn't contain word for word, and a value too long to keep,
 * are noted, never silently changed.
 */
export function fromImported(
  imported: ImportedResume,
  options: { source?: string; notes?: ImportNoteLike[] } = {},
): ResumeContent {
  const clip = (text: string, max: number) => clean(text).slice(0, max);
  const note = (where: string, message: string) =>
    options.notes?.push({ where, message });

  const listItem = (where: string, raw: string): ListItem | null => {
    const copied = clean(raw);
    if (!copied) return null;
    let text = copied;
    if (options.source !== undefined) {
      const found = findInSource(options.source, copied);
      if (found) text = found;
      else {
        note(
          where,
          `${quote(copied)} isn't in your file word for word, so it's kept as the AI copied it. Check it.`,
        );
      }
    }
    const item = splitListLine(text);
    return {
      ...item,
      label: item.label.slice(0, 100),
      values: item.values.slice(0, 60).map((v) => {
        if (v.length <= MAX_LIST_VALUE) return v;
        note(
          where,
          `${quote(v)} is longer than Shipmate keeps in one list value (${MAX_LIST_VALUE} characters), so its end was left off. Check it.`,
        );
        const cut = v.slice(0, MAX_LIST_VALUE);
        return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim();
      }),
    };
  };

  return {
    header: {
      name: clip(imported.header.name, 120),
      email: clip(imported.header.email, 200),
      phone: clip(imported.header.phone, 60),
      ...(clip(imported.header.location, 120)
        ? { location: clip(imported.header.location, 120) }
        : {}),
      links: imported.header.links
        .filter((l) => l.label.trim() || l.url.trim())
        .slice(0, 8)
        .map((l) => ({ label: clip(l.label, 100), url: clip(l.url, 300) })),
    },
    sections: imported.sections.slice(0, 20).map((section): ResumeSection => {
      const sectionTitle = clip(section.title, 100);
      if (section.layout === "entries") {
        return {
          title: sectionTitle,
          layout: "entries",
          items: section.entries.slice(0, 30).map((e) => ({
            heading: clip(e.heading, 200),
            subheading: clip(e.subheading, 200),
            dates: clip(e.dates, 80),
            location: clip(e.location, 120),
            bullets: e.bullets
              .map((b) => clip(b, 600))
              .filter(Boolean)
              .slice(0, 20),
          })),
        };
      }
      if (section.layout === "list") {
        return {
          title: sectionTitle,
          layout: "list",
          items: section.lists
            .slice(0, 30)
            .map((l) => listItem(sectionTitle || "Top of the page", l.line))
            .filter((i): i is ListItem => i !== null),
        };
      }
      return {
        title: sectionTitle,
        layout: "text",
        text: clip(section.text, 3000),
      };
    }),
  };
}

/**
 * Plain text of a structured resume, in reading order: what the keyword
 * match compares against in AI mode (Simple mode uses the PDF's text).
 */
export function resumeToText(content: ResumeContent): string {
  const out: string[] = [content.header.name];
  for (const section of content.sections) {
    out.push(section.title);
    if (section.layout === "entries") {
      for (const e of section.items) {
        out.push(e.heading, e.subheading, ...e.bullets);
      }
    } else if (section.layout === "list") {
      for (const item of section.items) {
        out.push(`${item.label} ${joinValues(item)}`);
      }
    } else {
      out.push(section.text);
    }
  }
  return out.filter(Boolean).join("\n");
}

/** Read stored jsonb; null if it isn't a valid structured resume. */
export function parseContent(value: unknown): ResumeContent | null {
  const parsed = resumeContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const EMPTY_ENTRY: Entry = {
  heading: "",
  subheading: "",
  dates: "",
  location: "",
  bullets: [""],
};
