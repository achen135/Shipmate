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
import OpenAI from "openai";

import { AiError, PROVIDER_LABELS, type ProviderName } from "./types";

/** Key-shaped tokens: sk-…, sk-ant-…, sk-proj-…, and masked forms (sk-****abcd). */
const KEY_PATTERN = /\bsk-[A-Za-z0-9_*\-]{4,}/g;

export function redact(text: string, secret?: string): string {
  let out = text;
  const trimmed = secret?.trim();
  if (trimmed && trimmed.length >= 8) out = out.split(trimmed).join("[key]");
  return out.replace(KEY_PATTERN, "[key]").slice(0, 300);
}

function providerMessage(error: unknown): string {
  if (!(error instanceof Error)) return "";
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

export function toAiError(
  error: unknown,
  provider: ProviderName,
  apiKey?: string,
): AiError {
  if (error instanceof AiError) return error;
  const label = PROVIDER_LABELS[provider];
  const said = redact(providerMessage(error), apiKey);
  const detail = said ? ` ${label} said: "${said}"` : "";

  const isConnection =
    error instanceof Anthropic.APIConnectionError ||
    error instanceof OpenAI.APIConnectionError;
  if (isConnection) {
    return new AiError(
      "unreachable",
      `Couldn't reach ${label}. Check your connection and try again.`,
    );
  }

  const status =
    error instanceof Anthropic.APIError || error instanceof OpenAI.APIError
      ? error.status
      : undefined;

  // OpenAI says "out of credit" as a 429 with this code.
  if (error instanceof OpenAI.APIError && error.code === "insufficient_quota") {
    return new AiError(
      "out_of_credit",
      `This ${label} account is out of credit.${detail}`,
      status,
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
