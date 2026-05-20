// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AiProvider, StructuredRequest } from "@/lib/ai/types";

import {
  type BoldSource,
  boldSpans,
  carryBold,
  markBold,
  renderBold,
  stripBold,
} from "./bold";
import { docxBold, readResumeFile } from "./file";
import { importResume } from "./import";
import { boldRanges, isBoldFontName, readResumePdf } from "./pdf";
import { type ImportedResume, resumeToText } from "./structured";
import { renderResumeHtml } from "./template";

/*
 * Fix handoff "bold text and preview font", Finding 1. The fixtures are a
 * made-up resume in the same Jake's-resume LaTeX as Alex's, with the same
 * kind of choices: some metrics bold, others deliberately plain.
 * bold-resume.pdf is bold-resume.tex built with tectonic (Latin Modern,
 * a real bold font); bold-resume.docx has Word bold runs.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

/** Bold in the .tex, inside a bullet or value: must come through. */
const BOLD = [
  "Cumulative GPA: 3.7",
  "12,000+",
  "97.2%",
  "0.18 PR-AUC",
  "250K",
  "6ms",
  "11.5s",
  "3.8s",
  "0.20ms",
  "1.000 precision / 0.981 recall",
  "0.731",
  "1,204 req/s",
];
/** Plain in the .tex: must stay plain. */
const PLAIN = ["4.0", "100+", "60+", "410ms", "0.402", "0.690", "k6", "p99"];

async function pdfSource(): Promise<BoldSource> {
  const read = await readResumeFile(fixture("bold-resume.pdf"));
  if (!read.ok) throw new Error(read.message);
  return { text: read.text, ranges: read.bold };
}

describe("reading bold from a PDF's own fonts", () => {
  it("returns exactly the text the plain reader does, with bold alongside", async () => {
    const plain = await readResumePdf(fixture("bold-resume.pdf"));
    const read = await readResumeFile(fixture("bold-resume.pdf"));
    expect(plain.ok && read.ok).toBe(true);
    if (!plain.ok || !read.ok) return;
    expect(read.text).toBe(plain.text);
    expect(read.bold.length).toBeGreaterThan(10);
  });

  it("knows a bold font by its name", () => {
    for (const name of [
      "TQTHRL+LMRoman10-Bold",
      "CMBX10",
      "Calibri-Bold",
      "Inter-SemiBold",
      "Garamond-BoldItalic",
    ]) {
      expect(isBoldFontName(name), name).toBe(true);
    }
    for (const name of [
      "BZIVMZ+LMRoman10-Regular",
      "YEUUOC+LMRoman10-Italic",
      "CMR10",
      "Helvetica",
      "Boldoni-Regular".replace("Boldoni", "Bodoni"),
    ]) {
      expect(isBoldFontName(name), name).toBe(false);
    }
  });

  it("a PDF that's mostly 'bold' gets no bold at all, not a guess", () => {
    const text = "Built a cache that cut reads by 98%";
    const all = new Array<boolean>(text.length).fill(true);
    expect(boldRanges(text, all)).toEqual([]);
    const some = [...text].map((_, i) => i >= text.indexOf("98%"));
    expect(boldRanges(text, some)).toEqual([
      [text.indexOf("98%"), text.length],
    ]);
  });
});

describe("marking a stored line with the file's bold", () => {
  it("every bold span in the .tex comes through on its line, and nothing else", async () => {
    const source = await pdfSource();
    const lines = [
      "Cumulative GPA: 3.7 / 4.0",
      "Built a Python pipeline that cleaned and labeled a dataset of 12,000+ forum threads for moderation research",
      "Added a read-through cache in front of Postgres, cutting database reads by 97.2% under a k6 load test",
      "Trained a LightGBM classifier that beat the rules baseline by 0.18 PR-AUC on a 250K-event simulated log, scoring at 6ms p99",
      "Fault-injection tests confirmed 11.5s worker recovery and 3.8s leader failover with zero duplicate writes",
      "Cut deal-query latency from 410ms to 0.20ms and matched listings at 1.000 precision / 0.981 recall",
      "Shipped a buy/wait signal at a 0.731 hit rate (vs. 0.402 / 0.690), served at 1,204 req/s",
      "Built a Unity game with a peak of 100+ concurrent players",
      "Repaired and assembled 60+ computers at a local repair shop",
    ];
    const marked = lines.map((l) => markBold(l, source));
    expect(marked.flatMap(boldSpans).sort()).toEqual([...BOLD].sort());
    for (const [i, line] of marked.entries()) {
      expect(stripBold(line)).toBe(lines[i]);
    }
    const spans = marked.flatMap(boldSpans).join(" | ");
    for (const plain of PLAIN) {
      expect(spans.split(" | ")).not.toContain(plain);
    }
    // A run that ends mid-word keeps the rest plain.
    expect(marked[3]).toContain("**250K**-event");
  });

  it("a line that isn't in the file word for word stays plain", async () => {
    const source = await pdfSource();
    expect(
      markBold("Built a pipeline that labeled 12,000+ threads", source),
    ).toBe("Built a pipeline that labeled 12,000+ threads");
  });

  it("a line found twice with different bold stays plain", () => {
    const text = "Scored 98% here\nScored 98% here";
    const at = text.lastIndexOf("98%");
    expect(markBold("Scored 98% here", { text, ranges: [[at, at + 3]] })).toBe(
      "Scored 98% here",
    );
  });
});

describe("a DOCX's own bold runs", () => {
  it("come through on their lines; plain numbers stay plain", async () => {
    const read = await readResumeFile(fixture("bold-resume.docx"));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const source = { text: read.text, ranges: read.bold };
    expect(
      markBold(
        "Labeled a dataset of 12,000+ forum threads for 100+ moderators",
        source,
      ),
    ).toBe(
      "Labeled a dataset of **12,000+** forum threads for 100+ moderators",
    );
    expect(
      markBold(
        "Cut query latency from 410ms to 0.20ms at 1.000 precision / 0.981 recall",
        source,
      ),
    ).toBe(
      "Cut query latency from 410ms to **0.20ms** at **1.000 precision / 0.981 recall**",
    );
    expect(markBold("Python, SQL, Docker", source)).toBe("Python, SQL, Docker");
  });

  it("a paragraph that isn't in the raw text exactly gets none", () => {
    expect(
      docxBold("<p>Not <strong>here</strong></p>", "Something else"),
    ).toEqual([]);
  });
});

describe("importing: the model sees plain text, code adds the file's bold", () => {
  const faithful: ImportedResume = {
    header: {
      name: "Jordan Lee",
      email: "jordan@example.edu",
      phone: "555-0100",
      location: "Riverside, CA",
      links: [{ label: "github.com/jlee", url: "https://github.com/jlee" }],
    },
    sections: [
      {
        title: "Education",
        layout: "entries",
        entries: [
          {
            heading: "Riverside State University",
            subheading: "Bachelor of Science in Computer Science",
            dates: "Expected May 2029",
            location: "Riverside, CA",
            bullets: [
              "Cumulative GPA: 3.7 / 4.0",
              "Relevant Coursework: Data Structures, Machine Learning, Database Systems",
            ],
          },
        ],
        lists: [],
        text: "",
      },
      {
        title: "Projects",
        layout: "entries",
        entries: [
          {
            heading: "MarkUp",
            subheading: "Java, PostgreSQL, Javalin, Docker",
            dates: "September 2025 – January 2026",
            location: "",
            bullets: [
              "Cut deal-query latency from 410ms to 0.20ms and matched listings at 1.000 precision / 0.981 recall",
            ],
          },
        ],
        lists: [],
        text: "",
      },
      {
        title: "Skills and Interests",
        layout: "list",
        entries: [],
        lists: [
          { line: "Languages: C++, Java, Python, TypeScript, SQL" },
          {
            line: "Activities & Leadership: Built a Unity game with a peak of 100+ concurrent players; Repaired and assembled 60+ computers at a local repair shop; Tutor for physics, mathematics, and SAT preparation",
          },
        ],
        text: "",
      },
    ],
  };

  function fakeProvider() {
    const requests: StructuredRequest<unknown>[] = [];
    const provider: AiProvider = {
      name: "google",
      shared: true,
      testKey: async () => {},
      async generateStructured<T>(request: StructuredRequest<T>) {
        requests.push(request as StructuredRequest<unknown>);
        return {
          data: request.schema.parse(faithful) as T,
          usage: {
            provider: "google",
            model: "gemini-3.8-flash",
            inputTokens: 1,
            outputTokens: 1,
          },
        };
      },
    };
    return { provider, requests };
  }

  it("bullets get their bold; headings, labels and plain lines don't; the model never sees markers", async () => {
    const read = await readResumeFile(fixture("bold-resume.pdf"));
    if (!read.ok) throw new Error(read.message);
    const { provider, requests } = fakeProvider();
    const { content } = await importResume(provider, read.text, read.bold);

    expect(requests[0].input).not.toContain("**");
    const [education, projects, skills] = content.sections;
    if (education.layout !== "entries" || projects.layout !== "entries") {
      throw new Error("layout");
    }
    expect(education.items[0].bullets).toEqual([
      "**Cumulative GPA: 3.7** / 4.0",
      "**Relevant Coursework:** Data Structures, Machine Learning, Database Systems",
    ]);
    expect(education.items[0].heading).toBe("Riverside State University");
    expect(projects.items[0].heading).toBe("MarkUp");
    expect(projects.items[0].bullets[0]).toBe(
      "Cut deal-query latency from 410ms to **0.20ms** and matched listings at **1.000 precision / 0.981 recall**",
    );
    if (skills.layout !== "list") throw new Error("layout");
    // Labels are bold by layout, not markup; the values are plain here.
    expect(skills.items.map((i) => i.label)).toEqual([
      "Languages",
      "Activities & Leadership",
    ]);
    expect(JSON.stringify(skills.items)).not.toContain("**");
    // Words, for matching, are the same as without bold.
    expect(resumeToText(content)).not.toContain("**");
  });

  it("prints bold as <strong>, escaped, in the PDF's HTML and the preview", async () => {
    const read = await readResumeFile(fixture("bold-resume.pdf"));
    if (!read.ok) throw new Error(read.message);
    const { content } = await importResume(
      fakeProvider().provider,
      read.text,
      read.bold,
    );
    const html = renderResumeHtml(content);
    expect(html).toContain("to <strong>0.20ms</strong> and matched");
    expect(html).not.toContain("**");
  });
});

describe("rendering and carrying bold", () => {
  it("renders spans as <strong> and escapes everything", () => {
    expect(renderBold("Cut <b> by **98% & more**")).toBe(
      "Cut &lt;b&gt; by <strong>98% &amp; more</strong>",
    );
    expect(renderBold("an unmatched ** stays as typed")).toBe(
      "an unmatched ** stays as typed",
    );
  });

  it("a reworded line keeps the bold of words it kept, and never adds any", () => {
    const before = "Cut reads by **98.6%** with a **309K**-event cache test";
    expect(
      carryBold(
        before,
        "Cut Postgres reads by 98.6% in a 309K-event load test at 4ms",
      ),
    ).toBe(
      "Cut Postgres reads by **98.6%** in a **309K**-event load test at 4ms",
    );
    // The model writing markers itself changes nothing.
    expect(carryBold(before, "Cut reads by **98.6%** at **4ms**")).toBe(
      "Cut reads by **98.6%** at 4ms",
    );
    // A span is matched as whole words: "98.6%" isn't inside "198.6%".
    expect(carryBold(before, "Cut reads by 198.6%")).toBe(
      "Cut reads by 198.6%",
    );
  });
});
