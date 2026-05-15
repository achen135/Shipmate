/**
 * The editor works on text the way people type it: bullets one per line,
 * list values separated by commas (or by semicolons, when a value has
 * commas of its own: typing a semicolon switches the line to semicolons). These two pure functions convert between that
 * and the stored shape (lib/resume/structured.ts), so a half-typed line never
 * vanishes from under the cursor.
 */

import {
  type Layout,
  type ResumeContent,
  joinValues,
  splitValues,
} from "./structured";

export type EditorEntry = {
  heading: string;
  subheading: string;
  dates: string;
  location: string;
  /** One bullet per line. */
  bullets: string;
};

export type EditorListItem = {
  label: string;
  /** Comma-separated, or semicolon-separated if it has any semicolons. */
  values: string;
};

export type EditorSection =
  | { key: string; title: string; layout: "entries"; items: EditorEntry[] }
  | { key: string; title: string; layout: "list"; items: EditorListItem[] }
  | { key: string; title: string; layout: "text"; text: string };

export type EditorState = {
  header: ResumeContent["header"];
  sections: EditorSection[];
};

let counter = 0;
/** Stable React keys for sections (titles can repeat or be empty). */
export const sectionKey = () => `s${(counter += 1)}`;

export function toEditor(content: ResumeContent): EditorState {
  return {
    header: structuredClone(content.header),
    sections: content.sections.map((section): EditorSection => {
      if (section.layout === "entries") {
        return {
          key: sectionKey(),
          title: section.title,
          layout: "entries",
          items: section.items.map((e) => ({
            heading: e.heading,
            subheading: e.subheading,
            dates: e.dates,
            location: e.location,
            bullets: e.bullets.join("\n"),
          })),
        };
      }
      if (section.layout === "list") {
        return {
          key: sectionKey(),
          title: section.title,
          layout: "list",
          items: section.items.map((i) => ({
            label: i.label,
            values: joinValues(i),
          })),
        };
      }
      return {
        key: sectionKey(),
        title: section.title,
        layout: "text",
        text: section.text,
      };
    }),
  };
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function fromEditor(state: EditorState): ResumeContent {
  return {
    header: {
      name: state.header.name.trim(),
      email: state.header.email.trim(),
      phone: state.header.phone.trim(),
      links: state.header.links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label || l.url),
    },
    sections: state.sections.map((section) => {
      const title = section.title.trim();
      if (section.layout === "entries") {
        return {
          title,
          layout: "entries" as const,
          items: section.items.map((e) => ({
            heading: e.heading.trim(),
            subheading: e.subheading.trim(),
            dates: e.dates.trim(),
            location: e.location.trim(),
            bullets: lines(e.bullets),
          })),
        };
      }
      if (section.layout === "list") {
        return {
          title,
          layout: "list" as const,
          items: section.items.map((i) => ({
            label: i.label.trim(),
            ...splitValues(i.values),
          })),
        };
      }
      return { title, layout: "text" as const, text: section.text.trim() };
    }),
  };
}

export function emptySection(title: string, layout: Layout): EditorSection {
  const key = sectionKey();
  if (layout === "entries") {
    return {
      key,
      title,
      layout,
      items: [
        { heading: "", subheading: "", dates: "", location: "", bullets: "" },
      ],
    };
  }
  if (layout === "list") {
    return { key, title, layout, items: [{ label: "", values: "" }] };
  }
  return { key, title, layout, text: "" };
}

export const EMPTY_RESUME: ResumeContent = {
  header: { name: "", email: "", phone: "", links: [] },
  sections: [],
};
