/**
 * Resume import fixtures: four resumes with different section-naming
 * styles, as text the way unpdf / mammoth extract it, each with a faithful
 * conversion in the flat shape the AI returns (list lines copied whole, as
 * the prompt asks since M8 §0b). The conversions are written
 * by hand to the prompt's rules (not recorded from a model: CI never calls a
 * real API). lib/resume/import.test.ts checks that faithful ones pass
 * `checkImport` cleanly and that renamed / merged / reordered / invented
 * variants are each caught.
 */

import type { ImportedResume } from "../structured";

type Section = ImportedResume["sections"][number];

const entries = (title: string, items: Section["entries"]): Section => ({
  title,
  layout: "entries",
  entries: items,
  lists: [],
  text: "",
});
const list = (title: string, items: Section["lists"]): Section => ({
  title,
  layout: "list",
  entries: [],
  lists: items,
  text: "",
});
const text = (title: string, body: string): Section => ({
  title,
  layout: "text",
  entries: [],
  lists: [],
  text: body,
});
const entry = (
  heading: string,
  subheading: string,
  dates: string,
  location: string,
  bullets: string[],
) => ({ heading, subheading, dates, location, bullets });

export type ImportCase = {
  name: string;
  source: string;
  faithful: ImportedResume;
};

/** Jake's-resume style, the template's own layout (Title Case headings). */
const jake: ImportCase = {
  name: "Jake's resume, Title Case headings",
  source: `Jordan Lee
555-0100 | jordan@example.edu | linkedin.com/in/jordanlee | github.com/jordanlee
Education
Riverside State University Riverside, CA
Bachelor of Science in Computer Science Aug. 2025 – May 2029
Experience
Software Engineering Intern June 2026 – Aug. 2026
Harbor Analytics Seattle, WA
• Built a Python service that cut report generation time by 40%
• Wrote integration tests for the billing API in Go
Projects
Tide Tracker | React, TypeScript, PostgreSQL Jan. 2026 – Present
• Built a web app that charts local tide data for 2,000 monthly users
Technical Skills
Languages: Python, Go, TypeScript, SQL
Frameworks: React, Node.js, Flask`,
  faithful: {
    header: {
      name: "Jordan Lee",
      email: "jordan@example.edu",
      phone: "555-0100",
      links: [
        {
          label: "linkedin.com/in/jordanlee",
          url: "https://linkedin.com/in/jordanlee",
        },
        { label: "github.com/jordanlee", url: "https://github.com/jordanlee" },
      ],
    },
    sections: [
      entries("Education", [
        entry(
          "Riverside State University",
          "Bachelor of Science in Computer Science",
          "Aug. 2025 – May 2029",
          "Riverside, CA",
          [],
        ),
      ]),
      entries("Experience", [
        entry(
          "Software Engineering Intern",
          "Harbor Analytics",
          "June 2026 – Aug. 2026",
          "Seattle, WA",
          [
            "Built a Python service that cut report generation time by 40%",
            "Wrote integration tests for the billing API in Go",
          ],
        ),
      ]),
      entries("Projects", [
        entry(
          "Tide Tracker",
          "React, TypeScript, PostgreSQL",
          "Jan. 2026 – Present",
          "",
          [
            "Built a web app that charts local tide data for 2,000 monthly users",
          ],
        ),
      ]),
      list("Technical Skills", [
        { line: "Languages: Python, Go, TypeScript, SQL" },
        { line: "Frameworks: React, Node.js, Flask" },
      ]),
    ],
  },
};

/** Research-heavy, ALL CAPS headings with "&" and unusual names. */
const research: ImportCase = {
  name: "research CV, ALL CAPS headings with &",
  source: `PRIYA NATARAJAN
priya.n@example.edu | (555) 010-2233 | priyan.dev
EDUCATION
Lakeshore Institute of Technology, B.S. Biomedical Engineering, Expected May 2028
RESEARCH EXPERIENCE
Neural Interfaces Lab, Undergraduate Researcher, Sept. 2025 – Present
- Designed a signal filter for EEG recordings in MATLAB
- Co-authored a poster on low-noise amplifier design
PUBLICATIONS & POSTERS
Natarajan P., Ortiz R. Low-noise front ends for wearable EEG. Lakeshore Research Day, 2026.
LEADERSHIP & SERVICE
Society of Women Engineers, Outreach Chair, 2025 – Present
- Ran monthly circuit workshops for 60 high school students
RELEVANT COURSEWORK
Signals and Systems, Circuits II, Biomaterials, Data Structures`,
  faithful: {
    header: {
      name: "PRIYA NATARAJAN",
      email: "priya.n@example.edu",
      phone: "(555) 010-2233",
      links: [{ label: "priyan.dev", url: "https://priyan.dev" }],
    },
    sections: [
      entries("EDUCATION", [
        entry(
          "Lakeshore Institute of Technology",
          "B.S. Biomedical Engineering",
          "Expected May 2028",
          "",
          [],
        ),
      ]),
      entries("RESEARCH EXPERIENCE", [
        entry(
          "Neural Interfaces Lab",
          "Undergraduate Researcher",
          "Sept. 2025 – Present",
          "",
          [
            "Designed a signal filter for EEG recordings in MATLAB",
            "Co-authored a poster on low-noise amplifier design",
          ],
        ),
      ]),
      text(
        "PUBLICATIONS & POSTERS",
        "Natarajan P., Ortiz R. Low-noise front ends for wearable EEG. Lakeshore Research Day, 2026.",
      ),
      entries("LEADERSHIP & SERVICE", [
        entry(
          "Society of Women Engineers",
          "Outreach Chair",
          "2025 – Present",
          "",
          ["Ran monthly circuit workshops for 60 high school students"],
        ),
      ]),
      list("RELEVANT COURSEWORK", [
        {
          line: "Signals and Systems, Circuits II, Biomaterials, Data Structures",
        },
      ]),
    ],
  },
};

/** Supply chain / ops: a summary, then sections with non-SWE names. */
const supplyChain: ImportCase = {
  name: "supply chain resume, summary + non-SWE section names",
  source: `Sam Okafor
sam.okafor@example.com | 555-0199
Summary
Operations student focused on inventory planning and warehouse flow.
Operations Experience
Midwest Freight Co. — Logistics Intern, Summer 2026, Chicago, IL
• Reduced dock-to-stock time by 12% by re-slotting fast movers
• Built a weekly fill-rate dashboard in Excel and Power BI
Certifications
APICS CPIM Part 1 (2026); Lean Six Sigma Yellow Belt
Tools I Use
Excel, Power BI, SAP, Tableau`,
  faithful: {
    header: {
      name: "Sam Okafor",
      email: "sam.okafor@example.com",
      phone: "555-0199",
      links: [],
    },
    sections: [
      text(
        "Summary",
        "Operations student focused on inventory planning and warehouse flow.",
      ),
      entries("Operations Experience", [
        entry(
          "Midwest Freight Co.",
          "Logistics Intern",
          "Summer 2026",
          "Chicago, IL",
          [
            "Reduced dock-to-stock time by 12% by re-slotting fast movers",
            "Built a weekly fill-rate dashboard in Excel and Power BI",
          ],
        ),
      ]),
      list("Certifications", [
        { line: "APICS CPIM Part 1 (2026); Lean Six Sigma Yellow Belt" },
      ]),
      list("Tools I Use", [{ line: "Excel, Power BI, SAP, Tableau" }]),
    ],
  },
};

/** A paragraph before any heading, then headings with odd names. */
const noHeadingIntro: ImportCase = {
  name: "untitled intro paragraph, headings like 'Selected Work'",
  source: `Riley Chen
riley@example.org
Designer-turned-engineer who likes building tools for small teams.
Selected Work
Harbor Notes, Solo builder, 2026
- Shipped a note-taking app with offline sync to 300 users
Where I've Studied
Bayview Community College, A.S. Computer Science, 2025`,
  faithful: {
    header: {
      name: "Riley Chen",
      email: "riley@example.org",
      phone: "",
      links: [],
    },
    sections: [
      text(
        "",
        "Designer-turned-engineer who likes building tools for small teams.",
      ),
      entries("Selected Work", [
        entry("Harbor Notes", "Solo builder", "2026", "", [
          "Shipped a note-taking app with offline sync to 300 users",
        ]),
      ]),
      entries("Where I've Studied", [
        entry(
          "Bayview Community College",
          "A.S. Computer Science",
          "2025",
          "",
          [],
        ),
      ]),
    ],
  },
};

export const IMPORT_CASES = [jake, research, supplyChain, noHeadingIntro];
