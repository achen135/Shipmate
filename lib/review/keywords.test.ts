// @vitest-environment node
import { describe, expect, it } from "vitest";

import { keywordMatch, termCounts } from "./keywords";

const resume = `Alex Chen. Computer Science, State University. Experience: Software Engineering Intern at Acme,
built REST APIs in Python and Java with PostgreSQL, deployed services on AWS with Docker and Kubernetes.
Projects: a React and TypeScript dashboard, a C++ ray tracer, and a Node.js chat server. Skills: Git, Linux, SQL, algorithms, data structures.`;

const posting = {
  title: "Software Engineer Intern",
  category: "Software",
  description: `Build backend services in Python and Go. You will design REST APIs, work with PostgreSQL and Redis,
and deploy on AWS using Docker. Experience with Kubernetes is a plus. Strong computer science fundamentals, algorithms and data structures.`,
};

describe("termCounts", () => {
  it("drops stopwords, numbers, and boilerplate; stems plurals", () => {
    const counts = termCounts(
      "The team is looking for strong APIs and 3 systems. Apply today!",
    );
    expect([...counts.keys()].sort()).toEqual(["api", "system", "today"]);
  });

  it("keeps tech spellings whole", () => {
    const terms = [...termCounts("C++, C#, Node.js, .NET and CI/CD.").keys()];
    expect(terms).toEqual(
      expect.arrayContaining(["c++", "c#", "node.js", "net"]),
    );
  });

  it("counts repeats", () => {
    expect(termCounts("python python Python").get("python")).toBe(3);
  });
});

describe("keywordMatch", () => {
  it("reports the share of the posting's words found in the resume", () => {
    const result = keywordMatch(posting, resume);
    expect(result.score).toBeGreaterThan(40);
    expect(result.matched).toEqual(
      expect.arrayContaining(["python", "aws", "docker", "kubernetes"]),
    );
    expect(result.missing).toEqual(expect.arrayContaining(["go", "redis"]));
  });

  it("scores a resume with none of the words low", () => {
    const unrelated = `Barista and shift lead at a coffee shop. Managed inventory, trained new baristas, handled customer complaints, opened and closed the store, and ran the weekend rush. Volunteer at the food bank, organized donation drives and scheduling for volunteers.`;
    expect(keywordMatch(posting, unrelated).score).toBeLessThan(15);
  });

  it("counts the title's words more than the description's", () => {
    const withTitle = keywordMatch(
      { ...posting, title: "Rust Intern" },
      resume.replace("Linux", "Rust"),
    );
    const without = keywordMatch({ ...posting, title: "Rust Intern" }, resume);
    expect(withTitle.score!).toBeGreaterThan(without.score!);
  });

  it("has no score when the posting has no text to compare (Simplify rows have no description)", () => {
    expect(
      keywordMatch(
        {
          title: "Software Engineer Intern",
          category: "Software",
          description: null,
        },
        resume,
      ).score,
    ).toBeNull();
  });

  it("has no score without resume text (no upload, or a scanned PDF)", () => {
    expect(keywordMatch(posting, null).score).toBeNull();
    expect(keywordMatch(posting, "short").score).toBeNull();
  });

  it("caps the lists", () => {
    const long = {
      ...posting,
      description: Array.from(
        { length: 60 },
        (_, i) => `skill${String.fromCharCode(97 + (i % 26))}${i}`,
      ).join(" "),
    };
    const result = keywordMatch(long, resume);
    expect(result.missing.length).toBeLessThanOrEqual(12);
  });
});
