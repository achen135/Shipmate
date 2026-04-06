import { describe, expect, it } from "vitest";

import { isInternshipTitle } from "./title-filter";

describe("isInternshipTitle", () => {
  it.each([
    "Software Engineer Intern",
    "Data Analyst, Intern",
    "2027 Business Technology Solutions Intern - Cloud Engineering (Undergraduate)",
    "Deployment Strategist, Internship",
    "Software Engineering Interns",
    "Hardware Co-op",
    "Co-Op Engineer, Fall",
    "2027 COOP Program, Operations",
    "Cooperative Education Student, Finance",
    "Student Researcher",
    "Summer 2027 Analyst",
    "SWE (summer 2027)",
  ])("keeps %s", (title) => {
    expect(isInternshipTitle(title)).toBe(true);
  });

  it.each([
    "Internal Audit Manager",
    "Internal Audit Data Analytics Lead",
    "International Sales Lead",
    "Cooperative Programs Manager",
    "Senior Software Engineer",
    "Summer Associate Recruiter",
    "Studio Manager",
  ])("drops %s", (title) => {
    expect(isInternshipTitle(title)).toBe(false);
  });
});
