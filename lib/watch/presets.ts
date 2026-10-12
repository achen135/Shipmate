import type { Category } from "@/lib/postings/normalize";

/**
 * Watch-profile presets: starting points the user edits (onboarding "What to
 * watch" and Profile). Each maps to a Simplify category where one exists;
 * keywords catch titles in other categories (and, from M4, company boards,
 * which have no categories).
 */

export const PRESET_IDS = [
  "swe",
  "ai_ml_data",
  "quant",
  "hardware",
  "product",
  "supply_chain_ops",
  "custom",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export type Preset = {
  id: PresetId;
  label: string;
  description: string;
  categories: Category[];
  includeKeywords: string[];
  excludeKeywords: string[];
  /** Shown under the preset when it can't find much yet. */
  note?: string;
};

export const PRESETS: readonly Preset[] = [
  {
    id: "swe",
    label: "SWE",
    description: "Software engineering: backend, frontend, mobile, infra.",
    categories: ["Software"],
    includeKeywords: [
      "software",
      "developer",
      "SWE",
      "backend",
      "frontend",
      "full stack",
      "mobile",
      "iOS",
      "Android",
      "infrastructure",
      "platform",
      "DevOps",
      "SRE",
    ],
    excludeKeywords: [],
  },
  {
    id: "ai_ml_data",
    label: "AI/ML/Data",
    description: "Machine learning, data science, data engineering, analytics.",
    categories: ["AI/ML/Data"],
    includeKeywords: [
      "machine learning",
      "ML",
      "AI",
      "data science",
      "data scientist",
      "data engineer",
      "data analyst",
      "analytics",
      "NLP",
      "computer vision",
      "LLM",
    ],
    excludeKeywords: [],
  },
  {
    id: "quant",
    label: "Quant",
    description: "Quant research, trading, and quant development.",
    categories: ["Quant"],
    includeKeywords: ["quant", "trading", "trader"],
    excludeKeywords: [],
  },
  {
    id: "hardware",
    label: "Hardware",
    description: "Electrical, embedded, firmware, chip design.",
    categories: ["Hardware"],
    includeKeywords: [
      "hardware",
      "electrical",
      "embedded",
      "firmware",
      "FPGA",
      "ASIC",
      "RTL",
      "silicon",
      "PCB",
    ],
    excludeKeywords: [],
  },
  {
    id: "product",
    label: "Product",
    description: "Product management and product analytics.",
    categories: ["Product"],
    includeKeywords: [
      "product manager",
      "product management",
      "APM",
      "product analyst",
    ],
    excludeKeywords: [],
  },
  {
    id: "supply_chain_ops",
    label: "Supply chain/Ops",
    description: "Supply chain, logistics, procurement, operations, planning.",
    categories: [],
    includeKeywords: [
      "supply chain",
      "logistics",
      "procurement",
      "sourcing",
      "purchasing",
      "operations",
      "inventory",
      "demand planning",
      "materials",
      "manufacturing",
      "industrial engineering",
      "buyer",
    ],
    excludeKeywords: [],
    note: "The internship feeds Shipmate reads today are mostly tech roles, so this finds little from the shared lists. Follow supply chain companies (Profile → Companies) to watch their own careers pages.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Start from scratch with your own keywords.",
    categories: [],
    includeKeywords: [],
    excludeKeywords: [],
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.at(-1)!;
}

/** Terms offered in the picker. Simplify's feeds use these spellings. */
export const TERM_OPTIONS = [
  "Summer 2027",
  "Fall 2026",
  "Winter 2027",
  "Spring 2027",
  "Fall 2027",
  "Summer 2028",
  "New Grad",
] as const;

export const DEFAULT_TERMS = ["Summer 2027"];
