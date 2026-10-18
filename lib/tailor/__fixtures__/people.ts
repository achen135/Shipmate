/**
 * Fixture people for the tailoring tests: a master resume, a fact bank, and
 * postings, where exactly what's true is known. Made up; any resemblance to
 * a real resume is the Jake's-resume layout everyone uses.
 */

import type { ResumeContent } from "@/lib/resume/structured";
import type { Fact } from "@/lib/schemas/fact-bank";

const fact = (
  id: string,
  kind: Fact["kind"],
  text: string,
  detail = "",
): Fact => ({ id, kind, text, detail, source: "manual" });

// ---------------------------------------------------------------- a SWE student

export const sweResume: ResumeContent = {
  header: {
    name: "Jordan Lee",
    email: "jordan@example.edu",
    phone: "555-0100",
    links: [{ label: "github.com/jlee", url: "https://github.com/jlee" }],
  },
  sections: [
    {
      title: "Education",
      layout: "entries",
      items: [
        {
          heading: "State University",
          subheading: "B.S. Computer Science, GPA 3.8",
          dates: "Expected May 2029",
          location: "Ithaca, NY",
          bullets: [
            "Coursework: Data Structures, Operating Systems, Databases",
          ],
        },
      ],
    },
    {
      title: "Experience",
      layout: "entries",
      items: [
        {
          heading: "Harbor Labs",
          subheading: "Software Engineering Intern (Python, Redis, FastAPI)",
          dates: "Jun 2025 – Aug 2025",
          location: "Boston, MA",
          bullets: [
            "Built a caching layer for the pricing API that cut p95 latency by 40%",
            "Wrote integration tests for 12 endpoints with pytest",
            "Assisted with migrating the job queue to a managed service",
          ],
        },
        {
          heading: "Campus Dining",
          subheading: "Student Supervisor",
          dates: "Sep 2024 – Present",
          location: "Ithaca, NY",
          bullets: [
            "Trained 8 new student workers on food safety procedures",
            "Scheduled shifts for a team of 20 using spreadsheets",
          ],
        },
      ],
    },
    {
      title: "Projects",
      layout: "entries",
      items: [
        {
          heading: "MarkIt",
          subheading: "TypeScript, React, PostgreSQL",
          dates: "2025",
          location: "",
          bullets: [
            "Built a marketplace web app for students to trade textbooks",
            "Designed the PostgreSQL schema and REST API",
          ],
        },
      ],
    },
    {
      title: "Technical Skills",
      layout: "list",
      items: [
        {
          label: "Languages",
          values: ["Python", "TypeScript", "Java", "C", "SQL"],
        },
        { label: "Tools", values: ["Git", "Docker", "React", "FastAPI"] },
      ],
    },
  ],
};

export const sweFacts: Fact[] = [
  fact("11111111-0000-4000-8000-000000000001", "skill", "Kubernetes"),
  fact(
    "11111111-0000-4000-8000-000000000002",
    "other",
    "Used Celery workers at Harbor Labs",
    "Ran background jobs with Celery workers at Harbor Labs",
  ),
  fact(
    "11111111-0000-4000-8000-000000000003",
    "project",
    "Discord bot for my dorm",
    "Python bot used by 200 residents to book laundry machines",
  ),
  fact(
    "11111111-0000-4000-8000-000000000004",
    "coursework",
    "Machine Learning (CS 4780)",
  ),
];

export const backendPosting = {
  title: "Backend Software Engineer Intern",
  company: "Tidewater",
  text: `About the role
Tidewater builds the logistics platform behind thousands of ports. As a Backend Software Engineer Intern, you'll work on distributed systems that move real cargo.

What you'll do
- Design and build Python services and REST APIs used by other teams
- Improve performance with caching (Redis) and message queues (Kafka)
- Deploy services to Kubernetes on AWS with Docker
- Write tests and take part in code review

Requirements
- Currently pursuing a Bachelor's in Computer Science or a related field
- Experience with Python and SQL
- Familiarity with REST APIs and Git

Nice to have
- Kubernetes, Kafka, Go, or C++
- Experience with PostgreSQL
- Celery or other background job systems
`,
};

// ---------------------------------------------------------------- supply chain

export const opsResume: ResumeContent = {
  header: {
    name: "Sam Rivera",
    email: "sam@example.edu",
    phone: "",
    links: [],
  },
  sections: [
    {
      title: "Where I've Studied",
      layout: "entries",
      items: [
        {
          heading: "Lakeside College",
          subheading: "B.S. Supply Chain Management",
          dates: "2025 – 2029",
          location: "",
          bullets: [],
        },
      ],
    },
    {
      title: "Work",
      layout: "entries",
      items: [
        {
          heading: "Riverside Grocers",
          subheading: "Inventory Assistant",
          dates: "Summer 2025",
          location: "Chicago, IL",
          bullets: [
            "Helped count and reconcile weekly inventory in Excel",
            "Contributed to a vendor scorecard for 15 suppliers",
          ],
        },
      ],
    },
    {
      title: "Leadership & Service",
      layout: "entries",
      items: [
        {
          heading: "Operations Club",
          subheading: "Treasurer",
          dates: "2025 – Present",
          location: "",
          bullets: ["Managed a $3,000 club budget"],
        },
      ],
    },
    {
      title: "Skills",
      layout: "list",
      items: [{ label: "", values: ["Excel", "PowerPoint", "Tableau"] }],
    },
  ],
};

export const opsFacts: Fact[] = [
  fact("22222222-0000-4000-8000-000000000001", "skill", "SQL"),
  fact(
    "22222222-0000-4000-8000-000000000002",
    "award",
    "Dean's List, Fall 2025",
  ),
];

export const supplyPosting = {
  title: "Supply Chain Analyst Intern",
  company: "Northwind Freight",
  text: `Northwind Freight is hiring a Supply Chain Analyst Intern for Summer 2027.

Responsibilities
- Build demand forecasts and inventory reports in Excel and SQL
- Analyze supplier performance and maintain vendor scorecards
- Present findings to stakeholders with Tableau dashboards
- Support procurement with SAP data pulls

Qualifications
- Pursuing a degree in Supply Chain Management, Operations, or Industrial Engineering
- Strong Excel skills (pivot tables, VLOOKUP)
- Experience with SQL is required
- Familiarity with SAP and Six Sigma is a plus
- Excellent communication and stakeholder management
`,
};

// ---------------------------------------------------------------- a summary, odd sections

export const summaryResume: ResumeContent = {
  header: { name: "Alex Kim", email: "", phone: "", links: [] },
  sections: [
    {
      title: "",
      layout: "text",
      text: "Computer science student who builds web apps and data tools in Python and JavaScript.",
    },
    {
      title: "Selected Work",
      layout: "entries",
      items: [
        {
          heading: "Open Data Lab",
          subheading: "Research Assistant",
          dates: "2025",
          location: "",
          bullets: [
            "Cleaned 2 million rows of transit data with pandas",
            "Co-authored a poster on bus delay prediction",
          ],
        },
      ],
    },
    {
      title: "Relevant Coursework",
      layout: "list",
      items: [{ label: "", values: ["Algorithms", "Statistics"] }],
    },
  ],
};

export const summaryFacts: Fact[] = [
  fact(
    "33333333-0000-4000-8000-000000000001",
    "other",
    "Trained a gradient boosting model at the Open Data Lab",
    "Used LightGBM at the Open Data Lab to predict bus delays",
  ),
];

export const dataPosting = {
  title: "Data Science Intern",
  company: "Metro Analytics",
  // Over MIN_POSTING_CHARS (400), so the pipeline really scores and edits
  // for this person; at 396 characters it stopped at "not enough text".
  text: `Metro Analytics is looking for a Data Science Intern to join the transit forecasting team.

You will
- Clean and analyze large datasets with Python, pandas and SQL
- Build machine learning models (LightGBM, XGBoost, scikit-learn) to predict demand
- Communicate results to product teams

You have
- Coursework in statistics and algorithms
- Experience with Python and pandas
- Bonus: Spark, Airflow, or experience publishing research
`,
};

export const PEOPLE = [
  { name: "SWE", resume: sweResume, facts: sweFacts, posting: backendPosting },
  {
    name: "supply chain",
    resume: opsResume,
    facts: opsFacts,
    posting: supplyPosting,
  },
  {
    name: "summary",
    resume: summaryResume,
    facts: summaryFacts,
    posting: dataPosting,
  },
] as const;
