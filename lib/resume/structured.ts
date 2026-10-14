/**
 * The structured resume (Spec "Structured resume", `resumes.content`).
 *
 * Sections are the user's own: titles, order and grouping come from their
 * resume and are never renamed, merged, split or reordered by Shipmate
 * (CLAUDE.md hard rule 8). Each section has a layout so the template knows
 * how to draw it:
 * - `entries`: heading / subheading / dates / location + bullets
 * - `list`: label: comma-separated values
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
  links: z.array(linkSchema).max(8),
});

export const entrySchema = z.object({
  heading: line(200),
  subheading: line(200),
  dates: line(80),
  location: line(120),
  bullets: z.array(line(600)).max(20),
});

export const listItemSchema = z.object({
  label: line(100),
  values: z.array(line(120)).max(60),
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
      lists: z.array(
        z.object({ label: z.string(), values: z.array(z.string()) }),
      ),
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

/**
 * Flat AI output → stored shape. Keeps each section's own fields for its
 * layout, drops empty bullets, and clips to the stored limits so a long
 * answer can't fail validation on save.
 */
export function fromImported(imported: ImportedResume): ResumeContent {
  const clip = (text: string, max: number) => clean(text).slice(0, max);
  return {
    header: {
      name: clip(imported.header.name, 120),
      email: clip(imported.header.email, 200),
      phone: clip(imported.header.phone, 60),
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
          items: section.lists.slice(0, 30).map((l) => ({
            label: clip(l.label, 100),
            values: l.values
              .map((v) => clip(v, 120))
              .filter(Boolean)
              .slice(0, 60),
          })),
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
        out.push(`${item.label} ${item.values.join(", ")}`);
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
