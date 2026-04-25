import { describe, expect, it } from "vitest";

import {
  backendPosting,
  summaryFacts,
  summaryResume,
  sweFacts,
  sweResume,
} from "./__fixtures__/people";
import { type Edit, StructureChangeError, applyEdits } from "./edits";
import type { Keyword } from "./score";
import { untraceable } from "./trace";

/*
 * Ids in sweResume (lib/tailor/view.ts):
 *   s1 Education: s1.e1 State University
 *   s2 Experience: s2.e1 Harbor Labs (subheading lists Python, Redis,
 *      FastAPI; b1 caching layer 40%, b2 tests, b3 "Assisted with migrating"),
 *      s2.e2 Campus Dining
 *   s3 Projects: s3.e1 MarkIt (TypeScript, React, PostgreSQL)
 *   s4 Technical Skills: s4.l1 Languages, s4.l2 Tools
 * Facts: f1 Kubernetes, f2 Celery at Harbor Labs, f3 Discord bot, f4 ML course.
 */

const kw = (term: string, variants: string[] = []): Keyword => ({
  term,
  importance: "required",
  kind: "hard_skill",
  variants,
});

const KEYWORDS: Keyword[] = [
  kw("Python"),
  kw("SQL"),
  kw("REST APIs", ["REST API"]),
  kw("Redis"),
  kw("Kafka"),
  kw("Kubernetes", ["K8s"]),
  kw("Docker"),
  kw("AWS"),
  kw("PostgreSQL", ["Postgres"]),
  kw("Celery"),
  kw("C++"),
  kw("distributed systems"),
];

const edit = (partial: Partial<Edit> & Pick<Edit, "op" | "target">): Edit => ({
  text: "",
  order: [],
  fact: "",
  keyword: "",
  ...partial,
});

function apply(edits: unknown[], base = sweResume, facts = sweFacts) {
  return applyEdits({
    base,
    master: base,
    facts,
    keywords: KEYWORDS,
    edits,
  });
}

const bullets = (content: typeof sweResume, s: number, e: number) => {
  const section = content.sections[s];
  return section.layout === "entries" ? section.items[e].bullets : [];
};
const values = (content: typeof sweResume, s: number, l: number) => {
  const section = content.sections[s];
  return section.layout === "list" ? section.items[l].values : [];
};

describe("applyEdits: what's allowed", () => {
  it("rewords a bullet with a word from the same entry (Redis is in its subheading)", () => {
    const result = apply([
      edit({
        op: "reword_bullet",
        target: "s2.e1.b1",
        text: "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
        keyword: "Redis",
      }),
    ]);
    expect(result.dropped).toEqual([]);
    expect(bullets(result.content, 1, 0)[0]).toBe(
      "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
    );
    expect(result.changes).toEqual([
      {
        what: "Reworded a bullet under Harbor Labs to mention “Redis”",
        why: "the posting asks for “Redis”",
        before:
          "Built a caching layer for the pricing API that cut p95 latency by 40%",
        after:
          "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
      },
    ]);
  });

  it("rewords a bullet using a fact about that entry, and says so", () => {
    const result = apply([
      edit({
        op: "reword_bullet",
        target: "s2.e1.b2",
        text: "Wrote integration tests for 12 endpoints with pytest and ran background jobs with Celery workers",
        fact: "f2",
        keyword: "Celery",
      }),
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.changes[0].why).toBe(
      "the posting asks for “Celery”; from your profile facts (“Used Celery workers at Harbor Labs”)",
    );
  });

  it("adds a skill from the fact bank to a skills line", () => {
    const result = apply([
      edit({
        op: "add_list_value",
        target: "s4.l2",
        text: "Kubernetes",
        keyword: "Kubernetes",
      }),
    ]);
    expect(values(result.content, 3, 1)).toEqual([
      "Git",
      "Docker",
      "React",
      "FastAPI",
      "Kubernetes",
    ]);
    expect(result.changes[0]).toEqual({
      what: "Added “Kubernetes” to Tools",
      why: "the posting asks for “Kubernetes”; from your profile facts",
    });
  });

  it("adds a skill written elsewhere on the resume to a skills line", () => {
    const result = apply([
      edit({ op: "add_list_value", target: "s4.l2", text: "PostgreSQL" }),
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.changes[0].why).toBe("it's already elsewhere on your resume");
  });

  it("adds a fact as a new entry, word for word, built in code", () => {
    const result = apply([edit({ op: "add_entry", target: "s3", fact: "f3" })]);
    const projects = result.content.sections[2];
    expect(projects.layout === "entries" && projects.items[1]).toEqual({
      heading: "Discord bot for my dorm",
      subheading: "",
      dates: "",
      location: "",
      bullets: ["Python bot used by 200 residents to book laundry machines"],
    });
  });

  it("reorders bullets within an entry, and entries within a section", () => {
    const result = apply([
      edit({ op: "order_bullets", target: "s2.e1", order: ["s2.e1.b2"] }),
      edit({ op: "order_entries", target: "s2", order: ["s2.e2", "s2.e1"] }),
    ]);
    expect(result.dropped).toEqual([]);
    const experience = result.content.sections[1];
    expect(
      experience.layout === "entries" && experience.items.map((e) => e.heading),
    ).toEqual(["Campus Dining", "Harbor Labs"]);
    expect(bullets(result.content, 1, 1)[0]).toBe(
      "Wrote integration tests for 12 endpoints with pytest",
    );
  });

  it("rewords a summary with words from anywhere on the resume", () => {
    const result = applyEdits({
      base: summaryResume,
      master: summaryResume,
      facts: summaryFacts,
      keywords: [kw("pandas"), kw("Python")],
      edits: [
        edit({
          op: "reword_text",
          target: "s1",
          text: "Computer science student who builds data tools in Python and pandas, and web apps in JavaScript.",
          keyword: "pandas",
        }),
      ],
    });
    expect(result.dropped).toEqual([]);
    expect(result.changes[0].what).toBe(
      "Reworded your summary to mention “pandas”",
    );
  });
});

describe("applyEdits: what's dropped (and why)", () => {
  const dropped = (edits: Edit[]) => {
    const result = apply(edits);
    expect(result.changes).toEqual([]);
    expect(result.content).toEqual(sweResume);
    return result.dropped.map((d) => d.reason);
  };

  it("a skill that's nowhere on the resume or in the facts", () => {
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s2.e1.b1",
          text: "Built a Kafka-backed caching layer for the pricing API that cut p95 latency by 40%",
          keyword: "Kafka",
        }),
        edit({ op: "add_list_value", target: "s4.l1", text: "Go" }),
        edit({ op: "add_list_value", target: "s4.l2", text: "Kafka" }),
      ]),
    ).toEqual([
      "“kafka-backed” isn't in this entry or a fact about it",
      "“Go” isn't on your resume or in your facts",
      "“Kafka” isn't on your resume or in your facts",
    ]);
  });

  it("C on the resume doesn't vouch for C++", () => {
    expect(
      dropped([edit({ op: "add_list_value", target: "s4.l1", text: "C++" })]),
    ).toEqual(["“C++” isn't on your resume or in your facts"]);
  });

  it("a skill from the skills list moved into an unrelated entry's bullet", () => {
    // Python is in the skills list and Harbor Labs, but MarkIt never says it.
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s3.e1.b1",
          text: "Built a marketplace web app in Python for students to trade textbooks",
          keyword: "Python",
        }),
      ]),
    ).toEqual(["“python” isn't in this entry or a fact about it"]);
  });

  it("a fact cited for an entry it isn't about", () => {
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s3.e1.b1",
          text: "Built a marketplace web app for students to trade textbooks on Kubernetes",
          fact: "f1",
        }),
        edit({
          op: "add_bullet",
          target: "s3.e1",
          text: "Python bot used by 200 residents to book laundry machines",
          fact: "f3",
        }),
      ]),
    ).toEqual([
      "the cited fact isn't about this entry",
      "the cited fact isn't about this entry",
    ]);
  });

  it("a new bullet with no fact behind it", () => {
    expect(
      dropped([
        edit({
          op: "add_bullet",
          target: "s2.e1",
          text: "Built REST APIs with FastAPI",
        }),
      ]),
    ).toEqual(["a new bullet needs a fact to come from"]);
  });

  it("a changed number", () => {
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s2.e1.b1",
          text: "Built a caching layer for the pricing API that cut p95 latency by 60%",
        }),
      ]),
    ).toEqual(["“60” isn't in this entry or a fact about it"]);
  });

  it("making the user's part sound bigger", () => {
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s2.e1.b3",
          text: "Migrated the job queue to a managed service",
        }),
      ]),
    ).toEqual(["it drops “assisted”, which would make your part sound bigger"]);
  });

  it("a word taken from the posting", () => {
    expect(
      dropped([
        edit({
          op: "reword_bullet",
          target: "s3.e1.b2",
          text: "Designed the PostgreSQL schema and REST API for a distributed system",
        }),
      ]),
    ).toEqual(["“distributed” isn't in this entry or a fact about it"]);
  });

  it("ids that don't exist, facts that don't exist, ops that don't fit the target", () => {
    expect(
      dropped([
        edit({ op: "reword_bullet", target: "s2.e1.b9", text: "x" }),
        edit({ op: "add_entry", target: "s3", fact: "f9" }),
        edit({ op: "reword_text", target: "s2", text: "Experience" }),
        edit({ op: "add_list_value", target: "s2.e1", text: "Python" }),
      ]),
    ).toEqual([
      "no such bullet",
      "no fact f9",
      "no such paragraph section",
      "no such list line",
    ]);
  });

  it("an unknown kind of edit is dropped, not guessed at", () => {
    const result = apply([{ op: "embellish", target: "s2.e1.b1", text: "x" }]);
    expect(result.dropped).toEqual([
      { op: "embellish", target: "s2.e1.b1", reason: "unknown kind of edit" },
    ]);
  });
});

describe("applyEdits: sections are the user's (hard rule 8)", () => {
  const good = edit({
    op: "reword_bullet",
    target: "s2.e1.b1",
    text: "Built a Redis caching layer for the pricing API that cut p95 latency by 40%",
  });

  it.each([
    ["rename", { op: "rename_section", target: "s2", text: "Work Experience" }],
    ["merge", { op: "merge_sections", target: "s2", order: ["s2", "s3"] }],
    ["reorder", { op: "order_sections", target: "", order: ["s4", "s1"] }],
    ["add", { op: "add_section", target: "", text: "Summary" }],
  ])("an edit list that tries to %s a section is rejected whole", (_, bad) => {
    expect(() => apply([good, bad])).toThrow(StructureChangeError);
  });

  it("moving an entry into another section is rejected whole", () => {
    expect(() =>
      apply([
        good,
        edit({
          op: "order_entries",
          target: "s2",
          order: ["s3.e1", "s2.e1"],
        }),
      ]),
    ).toThrow(StructureChangeError);
  });

  it("whatever is applied, the titles, layouts and order stay the same", () => {
    const result = apply([
      good,
      edit({ op: "drop_entry", target: "s2.e2" }),
      edit({ op: "add_entry", target: "s3", fact: "f3" }),
      edit({ op: "order_entries", target: "s3", order: ["s3.e1"] }),
    ]);
    expect(result.content.sections.map((s) => [s.title, s.layout])).toEqual(
      sweResume.sections.map((s) => [s.title, s.layout]),
    );
    expect(result.content.header).toEqual(sweResume.header);
    expect(untraceable(sweResume, sweFacts, result.content)).toEqual([]);
  });
});

describe("applyEdits: the one-page step allows drops only", () => {
  it("anything but a drop is refused", () => {
    const result = applyEdits({
      base: sweResume,
      master: sweResume,
      facts: sweFacts,
      keywords: KEYWORDS,
      edits: [
        edit({ op: "drop_bullet", target: "s2.e2.b2" }),
        edit({ op: "add_list_value", target: "s4.l2", text: "Kubernetes" }),
      ],
      allowed: ["drop_bullet", "drop_entry", "drop_list_value"],
      dropReason: "to keep it to one page",
    });
    expect(result.changes).toEqual([
      {
        what: "Left out a bullet under Campus Dining: “Scheduled shifts for a team of 20 using spreadsheets”",
        why: "to keep it to one page",
        before: "Scheduled shifts for a team of 20 using spreadsheets",
      },
    ]);
    expect(result.dropped).toEqual([
      {
        op: "add_list_value",
        target: "s4.l2",
        reason: "not allowed at this step",
      },
    ]);
  });
});

describe("untraceable: the whole-copy check", () => {
  it("passes the master itself", () => {
    expect(untraceable(sweResume, sweFacts, sweResume)).toEqual([]);
  });

  it("catches a renamed section, a changed header, an invented line and value", () => {
    const tampered = structuredClone(sweResume);
    tampered.header.name = "Jordan A. Lee";
    tampered.sections[1].title = "Work Experience";
    const projects = tampered.sections[2];
    if (projects.layout === "entries") {
      projects.items[0].bullets.push("Scaled it to 10,000 users on AWS");
    }
    const skills = tampered.sections[3];
    if (skills.layout === "list") skills.items[0].values.push("Rust");
    expect(untraceable(sweResume, sweFacts, tampered)).toEqual([
      "the header changed",
      "section 2 is “Work Experience” (entries), not “Experience” (entries)",
      "bullet “Scaled it to 10,000 users on AWS” has words that aren't the user's",
      "value “Rust” isn't on the master or a fact",
    ]);
  });

  it("the posting's own words don't count as the user's", () => {
    const tampered = structuredClone(sweResume);
    const skills = tampered.sections[3];
    if (skills.layout === "list") skills.items[1].values.push("Kafka");
    expect(untraceable(sweResume, sweFacts, tampered)).toEqual([
      "value “Kafka” isn't on the master or a fact",
    ]);
    expect(backendPosting.text).toContain("Kafka");
  });
});
