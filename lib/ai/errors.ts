/**
 * Turn whatever a provider SDK threw into an AiError whose message is safe
 * to show and to log. Two rules:
 *
 * - Never log or return the SDK error object itself: we only read its HTTP
 *   status and message, then redact anything that looks like a key from the
 *   message (OpenAI echoes a masked key in its 401 text).
 * - The user sees the provider's own words when there are some ("your
 *   credit balance is too low"), prefixed with what that means for them.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GoogleApiError } from "@google/genai";
import OpenAI from "openai";

import { AiError, PROVIDER_LABELS, type ProviderName } from "./types";

/**
 * Key-shaped tokens: sk-…, sk-ant-…, sk-proj-…, masked forms (sk-****abcd),
 * and Google API keys (AIza…, AQ.…).
 */
const KEY_PATTERN =
  /\b(?:sk-[A-Za-z0-9_*\-]{4,}|AIza[A-Za-z0-9_\-]{10,}|AQ\.[A-Za-z0-9_.\-]{20,})/g;

export function redact(text: string, secret?: string): string {
  let out = text;
  const trimmed = secret?.trim();
  if (trimmed && trimmed.length >= 8) out = out.split(trimmed).join("[key]");
  return out.replace(KEY_PATTERN, "[key]").slice(0, 300);
}

function providerMessage(error: unknown): string {
  if (!(error instanceof Error)) return "";
  // Google's SDK puts the response body, JSON, in the message itself.
  if (error instanceof GoogleApiError) {
    try {
      const body = JSON.parse(error.message) as {
        error?: { message?: unknown };
      };
      if (typeof body.error?.message === "string") return body.error.message;
    } catch {
      // Not JSON: use it as it is.
    }
    return error.message;
  }
  // Both SDKs prefix the message with the status code ("401 {...}" or
  // "401 invalid x-api-key"); the JSON body is in `error`, if any.
  const body = (error as { error?: unknown }).error;
  const nested =
    body && typeof body === "object"
      ? ((body as { error?: { message?: unknown } }).error?.message ??
        (body as { message?: unknown }).message)
      : undefined;
  return typeof nested === "string" ? nested : error.message;
}

/**
 * Google's word for "overloaded", from the error body: the v1beta shape
 * carries `status: "UNAVAILABLE"` beside a numeric code; the newer error
 * reference gives `code: "service_unavailable"` instead. The HTTP status is
 * 503 in both, so this only matters if the status is ever missing.
 */
function googleUnavailable(error: unknown): boolean {
  if (!(error instanceof GoogleApiError)) return false;
  try {
    const body = JSON.parse(error.message) as {
      error?: { status?: unknown; code?: unknown };
    };
    return (
      body.error?.status === "UNAVAILABLE" ||
      body.error?.code === "service_unavailable"
    );
  } catch {
    return false;
  }
}

/**
 * A provider's "overloaded, come back in a moment" (503): coded
 * `rate_limited` like a 429, since every caller handles both the same way,
 * but worth telling apart where a quick retry helps (resume import).
 */
export function isOverloaded(error: unknown): error is AiError {
  return (
    error instanceof AiError &&
    error.code === "rate_limited" &&
    error.status === 503
  );
}

export function toAiError(
  error: unknown,
  provider: ProviderName,
  apiKey?: string,
): AiError {
  if (error instanceof AiError) return error;
  const label = PROVIDER_LABELS[provider];
  const said = redact(providerMessage(error), apiKey);
  const detail = said ? ` ${label} said: "${said}"` : "";

  // Google's SDK uses fetch directly: a network failure is fetch's own
  // TypeError ("fetch failed"), or a timeout's AbortError.
  const isConnection =
    error instanceof Anthropic.APIConnectionError ||
    error instanceof OpenAI.APIConnectionError ||
    (provider === "google" &&
      !(error instanceof GoogleApiError) &&
      error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        (error instanceof TypeError && /fetch/i.test(error.message))));
  if (isConnection) {
    return new AiError(
      "unreachable",
      `Couldn't reach ${label}. Check your connection and try again.`,
    );
  }

  const status =
    error instanceof Anthropic.APIError ||
    error instanceof OpenAI.APIError ||
    error instanceof GoogleApiError
      ? error.status
      : undefined;

  // Google answers a bad key with 400 API_KEY_INVALID, not 401.
  if (status === 400 && /api key not valid|API_KEY_INVALID/i.test(said)) {
    return new AiError(
      "invalid_key",
      `${label} didn't accept this key.${detail}`,
      status,
    );
  }

  // OpenAI says "out of credit" as a 429 with this code.
  if (error instanceof OpenAI.APIError && error.code === "insufficient_quota") {
    return new AiError(
      "out_of_credit",
      `This ${label} account is out of credit.${detail}`,
      status,
    );
  }

  // Overloaded: the same "come back later" as a 429, not a real failure.
  if (status === 503 || googleUnavailable(error)) {
    return new AiError(
      "rate_limited",
      `${label}'s servers are briefly overloaded. Try again in a moment.${detail}`,
      503,
    );
  }

  switch (status) {
    case 401:
      return new AiError(
        "invalid_key",
        `${label} didn't accept this key.${detail}`,
        status,
      );
    case 403:
      return new AiError(
        "no_access",
        `This key can't use the model Shipmate needs.${detail}`,
        status,
      );
    case 429:
      return new AiError(
        "rate_limited",
        `${label} is rate-limiting this key. Wait a minute and try again.${detail}`,
        status,
      );
    case 402:
      return new AiError(
        "out_of_credit",
        `This ${label} account is out of credit.${detail}`,
        status,
      );
  }
  if (status === 400 && /credit|billing|quota|balance/i.test(said)) {
    return new AiError(
      "out_of_credit",
      `This ${label} account is out of credit.${detail}`,
      status,
    );
  }
  if (status === 404) {
    return new AiError(
      "no_access",
      `This key can't use the model Shipmate needs.${detail}`,
      status,
    );
  }
  return new AiError(
    "provider_error",
    `${label} returned an error${status ? ` (${status})` : ""}.${detail}`,
    status,
  );
}
