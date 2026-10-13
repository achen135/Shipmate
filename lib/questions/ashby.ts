import { htmlToText } from "@/lib/sources/text";

import { type InputKind, type RawQuestion } from "./types";

/**
 * Ashby: the careers page's own GraphQL call, POST
 * jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting. Undocumented, so
 * best effort: the caller treats any surprise as "couldn't read the form".
 *
 * `field` is a JSON blob. Its `type` is String, LongText, Email, Phone, File,
 * Boolean, Location, and (not seen in fixtures yet) ValueSelect /
 * MultiValueSelect with `selectableValues`.
 */

export const ASHBY_GRAPHQL_URL =
  "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting";

const QUERY =
  "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { id title applicationForm { sections { title descriptionHtml fieldEntries { id field isRequired descriptionHtml } } } } }";

export function ashbyRequestBody(slug: string, jobId: string): string {
  return JSON.stringify({
    operationName: "ApiJobPosting",
    variables: { organizationHostedJobsPageName: slug, jobPostingId: jobId },
    query: QUERY,
  });
}

const FIELD_INPUT: Record<string, InputKind> = {
  String: "text",
  Email: "text",
  Phone: "text",
  Location: "text",
  Number: "text",
  Date: "text",
  LongText: "textarea",
  File: "file",
  Boolean: "boolean",
  ValueSelect: "select",
  MultiValueSelect: "multiselect",
};

type FieldEntry = {
  field?: {
    type?: unknown;
    title?: unknown;
    isPrivate?: unknown;
    selectableValues?: { label?: unknown }[];
  };
  isRequired?: unknown;
  descriptionHtml?: unknown;
};

export function parseAshbyQuestions(json: unknown): RawQuestion[] {
  const posting = (json as { data?: { jobPosting?: unknown } } | null)?.data
    ?.jobPosting as {
    applicationForm?: { sections?: { fieldEntries?: FieldEntry[] }[] };
  } | null;
  const sections = posting?.applicationForm?.sections;
  if (!Array.isArray(sections)) {
    // A deleted or unlisted job comes back as jobPosting: null.
    throw new Error("Ashby response has no application form");
  }

  const out: RawQuestion[] = [];
  for (const section of sections) {
    for (const entry of section.fieldEntries ?? []) {
      const title =
        typeof entry.field?.title === "string" ? entry.field.title.trim() : "";
      if (!title) continue;
      const type =
        typeof entry.field?.type === "string" ? entry.field.type : "";
      const description =
        typeof entry.descriptionHtml === "string" && entry.descriptionHtml
          ? htmlToText(entry.descriptionHtml)
          : "";
      out.push({
        label: title,
        ...(description ? { description } : {}),
        required: entry.isRequired === true,
        input: FIELD_INPUT[type] ?? "other",
        options: (entry.field?.selectableValues ?? [])
          .map((v) => (typeof v.label === "string" ? v.label.trim() : ""))
          .filter(Boolean),
      });
    }
  }
  return out;
}
