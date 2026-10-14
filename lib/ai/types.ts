/**
 * The one interface every AI provider implements (Spec "Tailoring pipeline":
 * provider abstraction). Callers ask for JSON matching a zod schema and get
 * it parsed, plus the tokens it cost, without knowing which provider ran.
 */

import type { z } from "zod";

export const PROVIDERS = ["anthropic", "openai", "google"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
};

/**
 * Which model a step uses: `fast` for extraction and scoring (resume import,
 * keyword extraction), `strong` for edits and writing (M7). Model IDs per
 * provider live in lib/ai/models.ts.
 */
export type Tier = "fast" | "strong";

export type AiUsage = {
  provider: ProviderName;
  /** The model that actually answered (a refusal fallback can differ). */
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type StructuredRequest<T> = {
  tier: Tier;
  /** Instructions: fixed per step, so it caches. */
  system: string;
  /** The user's material (resume text, posting…). Data, not instructions. */
  input: string;
  schema: z.ZodType<T>;
  /** A short name for the schema (OpenAI requires one). */
  name: string;
  maxOutputTokens?: number;
};

export interface AiProvider {
  readonly name: ProviderName;
  /**
   * True for Shipmate's shared free Gemini key (no personal key saved):
   * free, rate-limited, and never the user's to manage.
   */
  readonly shared: boolean;
  /** The cheapest call that proves the key works (token counting: free). */
  testKey(): Promise<void>;
  /** Native structured output on every provider, parsed and validated. */
  generateStructured<T>(
    request: StructuredRequest<T>,
  ): Promise<{ data: T; usage: AiUsage }>;
}

export type AiErrorCode =
  | "invalid_key"
  | "no_access"
  | "rate_limited"
  | "out_of_credit"
  | "provider_error"
  | "unreachable"
  | "refused"
  | "too_long"
  | "bad_output";

/**
 * Every provider failure becomes one of these. `message` is safe to show the
 * user and to log: it never contains the key (lib/ai/errors.ts redacts).
 */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}
