/**
 * Google Gemini implementation of AiProvider, written against Google's
 * current docs and the @google/genai SDK's own types (checked 2026-10-14):
 * `models.generateContent` with `responseMimeType: "application/json"` and
 * `responseJsonSchema` (a subset of JSON Schema; unsupported keywords are
 * stripped below), thinking depth through `thinkingConfig.thinkingLevel`,
 * the answer in `response.text`, and `models.countTokens` (free) as the key
 * test. Gemini doesn't validate against the schema for us, so the answer is
 * parsed with the zod schema here, like the other two.
 *
 * Used for the shared free key (lib/ai/index.ts getProvider) and for a
 * user's own Gemini key.
 */

import { FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

import type { ClientOptions } from "./anthropic";
import { toAiError } from "./errors";
import { EFFORT, MODELS } from "./models";
import {
  AiError,
  type AiProvider,
  type AiUsage,
  type StructuredRequest,
} from "./types";

/** JSON Schema keywords Gemini's responseJsonSchema accepts (SDK docs). */
const SUPPORTED = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
]);

/** A zod schema as JSON Schema, keeping only the keywords Gemini supports. */
export function geminiSchema(schema: z.ZodType): unknown {
  const strip = (node: unknown, inProperties = false): unknown => {
    if (Array.isArray(node)) return node.map((n) => strip(n));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      // Inside `properties` the keys are field names, not keywords.
      if (inProperties) {
        out[key] = strip(value);
        continue;
      }
      if (!SUPPORTED.has(key)) continue;
      // zod writes ±MAX_SAFE_INTEGER bounds on every int; they say nothing.
      if (
        (key === "minimum" || key === "maximum") &&
        Math.abs(Number(value)) >= Number.MAX_SAFE_INTEGER
      ) {
        continue;
      }
      out[key] = strip(value, key === "properties" || key === "$defs");
    }
    return out;
  };
  return strip(z.toJSONSchema(schema));
}

const THINKING = {
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

const REFUSED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export function createGoogleProvider(
  options: ClientOptions & { shared?: boolean },
): AiProvider {
  const client = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      ...(options.baseURL ? { baseUrl: options.baseURL } : {}),
      timeout: options.timeoutMs ?? 240_000,
      // The SDK retries 5 times by default, waiting up to a minute each: a
      // 429 on the shared key should come back to us quickly instead, so
      // the worker can leave the tailoring queued for the next run.
      retryOptions: { attempts: (options.maxRetries ?? 1) + 1 },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  });
  const fail = (error: unknown) => toAiError(error, "google", options.apiKey);

  return {
    name: "google",
    shared: options.shared ?? false,

    async testKey() {
      try {
        await client.models.countTokens({
          model: MODELS.google.fast.id,
          contents: "Shipmate key check",
        });
      } catch (error) {
        throw fail(error);
      }
    },

    async generateStructured<T>(request: StructuredRequest<T>) {
      let response;
      try {
        response = await client.models.generateContent({
          model: MODELS.google[request.tier].id,
          contents: request.input,
          config: {
            systemInstruction: request.system,
            responseMimeType: "application/json",
            responseJsonSchema: geminiSchema(request.schema),
            maxOutputTokens: request.maxOutputTokens ?? 16_000,
            thinkingConfig: { thinkingLevel: THINKING[EFFORT[request.tier]] },
          },
        });
      } catch (error) {
        throw fail(error);
      }

      const finish = response.candidates?.[0]?.finishReason;
      if (
        response.promptFeedback?.blockReason ||
        (finish && REFUSED.has(finish))
      ) {
        throw new AiError(
          "refused",
          "Google declined this request. Try again, or edit the file and retry.",
        );
      }
      if (finish === FinishReason.MAX_TOKENS) {
        throw new AiError(
          "too_long",
          "The answer ran past its length limit. Try a shorter file.",
        );
      }
      let parsed: T | null = null;
      try {
        const result = request.schema.safeParse(
          JSON.parse(response.text ?? ""),
        );
        if (result.success) parsed = result.data;
      } catch {
        // Not JSON: falls through to bad_output.
      }
      if (parsed == null) {
        throw new AiError(
          "bad_output",
          "Google's answer didn't match the expected format. Try again.",
        );
      }
      const meta = response.usageMetadata;
      const usage: AiUsage = {
        provider: "google",
        model: response.modelVersion ?? MODELS.google[request.tier].id,
        inputTokens: meta?.promptTokenCount ?? 0,
        // Thinking is billed as output.
        outputTokens:
          (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      };
      return { data: parsed, usage };
    },
  };
}
