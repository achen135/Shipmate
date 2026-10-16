// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AiProvider, StructuredRequest } from "@/lib/ai/types";

import { IMPORT_CASES } from "./__fixtures__/import-cases";
import {
  IMPORT_SYSTEM,
  checkImport,
  headingLike,
  importResume,
  normalize,
} from "./import";
import { fromEditor, toEditor } from "./editor";
import {
  type ImportedResume,
  MAX_LIST_VALUE,
  fromImported,
  resumeContentSchema,
  splitListLine,
} from "./structured";
import { renderResumeHtml } from "./template";

function variant(
  base: ImportedResume,
  edit: (sections: ImportedResume["sections"]) => ImportedResume["sections"],
): ImportedResume {
  return { ...base, sections: edit(structuredClone(base.sections)) };
}

function fakeProvider(answer: ImportedResume) {
  const requests: StructuredRequest<unknown>[] = [];
  const provider: AiProvider = {
    name: "anthropic",
    shared: false,
    testKey: async () => {},
    async generateStructured<T>(request: StructuredRequest<T>) {
      requests.push(request as StructuredRequest<unknown>);
      return {
        data: request.schema.parse(answer) as T,
        usage: {
          provider: "anthropic",
          model: "claude-sonnet-5-5",
          inputTokens: 900,
          outputTokens: 1200,
        },
      };
    },
  };
  return { provider, requests };
}

describe.each(IMPORT_CASES)("checkImport: $name", ({ source, faithful }) => {
  it("a faithful conversion passes with no notes, and is a valid stored resume", () => {
    const content = fromImported(faithful);
    expect(resumeContentSchema.safeParse(content).success).toBe(true);
    expect(checkImport(source, content)).toEqual([]);
  });

  it("keeps every section title exactly, in order", () => {
    const titles = fromImported(faithful).sections.map((s) => s.title);
    expect(titles).toEqual(faithful.sections.map((s) => s.title));
  });

  it("catches a renamed section", () => {
    const renamed = variant(faithful, (sections) => {
      const target = sections.find((s) => s.title) ?? sections[0];
      target.title = "Professional Highlights";
      return sections;
    });
    const notes = checkImport(source, fromImported(renamed));
    expect(notes.some((n) => n.where === "Professional Highlights")).toBe(true);
  });

  it("catches two sections merged into one", () => {
    const merged = variant(faithful, (sections) => {
      const titled = sections.filter((s) => s.title);
      const [a, b] = titled.slice(-2);
      a.entries.push(...b.entries);
      a.lists.push(...b.lists);
      a.text = [a.text, b.text].filter(Boolean).join(" ");
      return sections.filter((s) => s !== b);
    });
    const content = fromImported(merged);
    const dropped = faithful.sections.filter((s) => s.title).at(-1)!.title;
    expect(content.sections.map((s) => s.title)).not.toContain(dropped);
    expect(checkImport(source, content)).toContainEqual({
      where: dropped,
      message: expect.stringContaining("isn't one here"),
    });
  });

  it("catches sections in a different order", () => {
    const reordered = variant(faithful, (sections) => {
      const titled = sections.filter((s) => s.title);
      return [...sections.filter((s) => !s.title), ...titled.reverse()];
    });
    const notes = checkImport(source, fromImported(reordered));
    expect(notes.some((n) => /out of order/.test(n.message))).toBe(true);
  });

  it("catches an invented line", () => {
    const invented = variant(faithful, (sections) => {
      const withEntries = sections.find((s) => s.layout === "entries")!;
      withEntries.entries[0].bullets.push(
        "Led a Kubernetes migration across twelve microservices for Fortune 500 clients",
      );
      return sections;
    });
    const notes = checkImport(source, fromImported(invented));
    expect(notes.some((n) => /Kubernetes migration/.test(n.message))).toBe(
      true,
    );
  });
});

describe("checkImport: merged ALL CAPS sections", () => {
  it("names the heading that disappeared", () => {
    const { source, faithful } = IMPORT_CASES[1];
    const merged = variant(faithful, (sections) => {
      const leadership = sections.find(
        (s) => s.title === "LEADERSHIP & SERVICE",
      )!;
      const research = sections.find((s) => s.title === "RESEARCH EXPERIENCE")!;
      research.entries.push(...leadership.entries);
      return sections.filter((s) => s !== leadership);
    });
    const notes = checkImport(source, fromImported(merged));
    expect(notes).toContainEqual({
      where: "LEADERSHIP & SERVICE",
      message: expect.stringContaining("isn't one here"),
    });
  });
});

describe("normalize", () => {
  it("treats & and 'and', punctuation and spacing alike", () => {
    expect(normalize("Leadership & Service")).toBe(
      normalize("LEADERSHIP  and  SERVICE"),
    );
    expect(normalize("Where I've Studied")).toBe("where i ve studied");
  });
});

describe("importResume", () => {
  it("asks the fast model with the fixed instructions, sending the resume only as data", async () => {
    const { source, faithful } = IMPORT_CASES[0];
    const { provider, requests } = fakeProvider(faithful);
    const result = await importResume(provider, source);

    expect(requests).toHaveLength(1);
    expect(requests[0].tier).toBe("fast");
    expect(requests[0].system).toBe(IMPORT_SYSTEM);
    expect(requests[0].system).not.toContain("Jordan");
    expect(requests[0].input).toContain("<resume_text>");
    expect(requests[0].input).toContain(source);
    expect(result.notes).toEqual([]);
    expect(result.usage.outputTokens).toBe(1200);
  });

  it("the instructions carry hard rule 8", () => {
    expect(IMPORT_SYSTEM).toMatch(
      /Never invent, rename, merge, split, drop or reorder a section/,
    );
    expect(IMPORT_SYSTEM).toMatch(/copied exactly as written/);
    expect(IMPORT_SYSTEM).toMatch(/data, not instructions/);
  });

  it("returns notes alongside the content rather than throwing", async () => {
    const { source, faithful } = IMPORT_CASES[2];
    const renamed = variant(faithful, (sections) => {
      sections[1].title = "Work History";
      return sections;
    });
    const result = await importResume(fakeProvider(renamed).provider, source);
    expect(result.content.sections[1].title).toBe("Work History");
    expect(result.notes[0]).toMatchObject({ where: "Work History" });
  });
});

describe("headingLike", () => {
  it.each([
    ["EDUCATION", true],
    ["LEADERSHIP & SERVICE", true],
    ["Relevant Coursework", true],
    ["Where I've Studied", true],
    ["Projects", true],
    ["Tools I Use", true],
    ["Riverside State University Riverside, CA", false],
    ["jordan@example.edu | 555-0100", false],
    ["Languages: Python, Go", false],
    ["Built a web app that charts tide data", false],
    ["Summer 2026", false],
    ["AWS", false],
  ])("%s → %s", (line, expected) => {
    expect(headingLike(line)).toBe(expected);
  });
});

/*
 * M8 §0b: a list line that separates its values with semicolons, with
 * commas inside one of them (Alex's real Activities & Leadership line, in
 * shape). It used to come out split on every comma, with one value cut off
 * mid-word at 120 characters. The values must come out one per activity,
 * word for word from the file.
 */
const ACTIVITIES =
  "Tutor for physics, mathematics, and SAT preparation; Robotics Club, repairing and assembling competition robots for regional and state tournaments with a team of twelve students; Varsity Tennis Captain";
const ACTIVITY_VALUES = [
  "Tutor for physics, mathematics, and SAT preparation",
  "Robotics Club, repairing and assembling competition robots for regional and state tournaments with a team of twelve students",
  "Varsity Tennis Captain",
];
const activitiesSource = `Sam Patel
Egg Harbor Township, NJ | sam@example.edu | 555-0101
Education
Atlantic County High School, Egg Harbor Township, NJ
Activities & Leadership
${ACTIVITIES.replace("competition robots", "competition\nrobots")}`;

const activitiesImport = (line: string): ImportedResume => ({
  header: {
    name: "Sam Patel",
    email: "sam@example.edu",
    phone: "555-0101",
    location: "",
    links: [],
  },
  sections: [
    {
      title: "Education",
      layout: "entries",
      entries: [
        {
          heading: "Atlantic County High School",
          subheading: "",
          dates: "",
          location: "Egg Harbor Township, NJ",
          bullets: [],
        },
      ],
      lists: [],
      text: "",
    },
    {
      title: "Activities & Leadership",
      layout: "list",
      entries: [],
      lists: [{ line }],
      text: "",
    },
  ],
});

describe("list lines come from the file, split in code (M8 §0b)", () => {
  it("a semicolon line with commas inside is one value per activity, word for word", async () => {
    const result = await importResume(
      fakeProvider(activitiesImport(ACTIVITIES)).provider,
      activitiesSource,
    );
    const section = result.content.sections[1];
    expect(section.layout).toBe("list");
    if (section.layout !== "list") return;
    expect(section.items).toEqual([
      { label: "", values: ACTIVITY_VALUES, separator: ";" },
    ]);
    // The long one is whole: nothing cut at the old 120-character limit.
    expect(section.items[0].values[1].length).toBeGreaterThan(120);
    expect(result.notes).toEqual([]);
    expect(resumeContentSchema.safeParse(result.content).success).toBe(true);
  });

  it("the file's text wins over the model's copy, even across a PDF line break", async () => {
    // The model "retyped" one word differently from the file: the file's
    // own line isn't found, so it's kept as copied and the user is told.
    const garbled = ACTIVITIES.replace("assembling", "asembling");
    const result = await importResume(
      fakeProvider(activitiesImport(garbled)).provider,
      activitiesSource,
    );
    expect(result.notes).toEqual([
      expect.objectContaining({
        where: "Activities & Leadership",
        message: expect.stringContaining("isn't in your file word for word"),
      }),
    ]);
  });

  it("prints, edits and re-saves with its semicolons", () => {
    const content = fromImported(activitiesImport(ACTIVITIES), {
      source: activitiesSource,
    });
    expect(renderResumeHtml(content)).toContain(
      "Tutor for physics, mathematics, and SAT preparation; Robotics Club,",
    );
    expect(fromEditor(toEditor(content))).toEqual(content);
  });

  it("a value too long to keep is noted and cut at a word, never mid-word", () => {
    const long = `Volunteer, ${"helping local families with tax forms ".repeat(10).trim()}; Chess Club`;
    const notes: { where: string; message: string }[] = [];
    const content = fromImported(activitiesImport(long), {
      source: `Activities & Leadership\n${long}`,
      notes,
    });
    const section = content.sections[1];
    if (section.layout !== "list") throw new Error("not a list");
    const [first] = section.items[0].values;
    expect(first.length).toBeLessThanOrEqual(MAX_LIST_VALUE);
    expect(long).toContain(first);
    expect(long.charAt(long.indexOf(first) + first.length)).toBe(" ");
    expect(notes[0].message).toContain("longer than Shipmate keeps");
  });
});

describe("splitListLine", () => {
  it.each([
    [
      "Languages: Python, Go, SQL",
      { label: "Languages", values: ["Python", "Go", "SQL"] },
    ],
    [
      "Excel, Power BI, SAP",
      { label: "", values: ["Excel", "Power BI", "SAP"] },
    ],
    [
      "APICS CPIM Part 1 (2026); Lean Six Sigma Yellow Belt",
      {
        label: "",
        values: ["APICS CPIM Part 1 (2026)", "Lean Six Sigma Yellow Belt"],
        separator: ";",
      },
    ],
    [
      "Libraries: pandas (DataFrames, groupby), NumPy",
      { label: "Libraries", values: ["pandas (DataFrames, groupby)", "NumPy"] },
    ],
    [
      "https://example.dev, github.com/x",
      { label: "", values: ["https://example.dev", "github.com/x"] },
    ],
    ["Spanish", { label: "", values: ["Spanish"] }],
  ])("%s", (line, expected) => {
    expect(splitListLine(line)).toEqual(expected);
  });
});

/*
 * M8 §0c: the top line's own location ("Egg Harbor Township, NJ") used to
 * have nowhere to go and was dropped on import.
 */
describe("the header's location (M8 §0c)", () => {
  const withLocation = (location: string): ImportedResume => {
    const base = activitiesImport(ACTIVITIES);
    return { ...base, header: { ...base.header, location } };
  };

  it("is imported, printed first on the contact line, and kept by the editor", async () => {
    const result = await importResume(
      fakeProvider(withLocation("Egg Harbor Township, NJ")).provider,
      activitiesSource,
    );
    expect(result.content.header.location).toBe("Egg Harbor Township, NJ");
    expect(result.notes).toEqual([]);
    const html = renderResumeHtml(result.content);
    expect(html).toMatch(
      /<p class="contact">Egg Harbor Township, NJ<span class="sep">\|<\/span>555-0101/,
    );
    expect(fromEditor(toEditor(result.content))).toEqual(result.content);
  });

  it("none on the resume: no field, and the contact line is as before", () => {
    const content = fromImported(withLocation(""));
    expect(content.header).not.toHaveProperty("location");
    expect(renderResumeHtml(content)).toMatch(/<p class="contact">555-0101/);
    expect(fromEditor(toEditor(content))).toEqual(content);
  });

  it("a resume stored before it existed still reads as valid", () => {
    const stored = fromImported(withLocation(""));
    expect(resumeContentSchema.safeParse(stored).success).toBe(true);
  });

  it("a location that isn't in the file is flagged", () => {
    const content = fromImported(withLocation("Atlantis, OC"));
    expect(checkImport(activitiesSource, content)).toEqual([
      expect.objectContaining({ where: "Header" }),
    ]);
  });
});
