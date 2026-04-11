import { Bot, PenLine } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { loadQuestions } from "@/lib/questions/load";
import type { AnswerProfile } from "@/lib/questions/prefill";
import { type SheetItem, buildSheet } from "@/lib/questions/sheet";
import type { Review } from "@/lib/review/queries";

import { CopyButton } from "./copy-button";
import { PasteQuestions } from "./paste-questions";

/**
 * The answer sheet (Spec "Review page"): the application's questions, with
 * your profile's answers ready to copy. Loads (and, the first time anyone
 * opens the posting, fetches) the questions, so the page streams this in
 * behind a Suspense boundary instead of making everything wait for the ATS.
 */

export function toAnswerProfile(
  profile: Review["profile"],
  email: string | null,
): AnswerProfile {
  const answers =
    profile?.standard_answers &&
    typeof profile.standard_answers === "object" &&
    !Array.isArray(profile.standard_answers)
      ? (profile.standard_answers as AnswerProfile["answers"])
      : {};
  return {
    name: profile?.name ?? null,
    email: profile?.email ?? email,
    phone: profile?.phone ?? null,
    school: profile?.school ?? null,
    degree: profile?.degree ?? null,
    major: profile?.major ?? null,
    gradMonth: profile?.grad_month ?? null,
    gradYear: profile?.grad_year ?? null,
    workAuthorized: profile?.work_authorized ?? null,
    needsSponsorship: profile?.needs_sponsorship ?? null,
    answers,
  };
}

function pastedQuestions(sheet: Review["item"]): string {
  const value = sheet?.answer_sheet;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = (value as Record<string, unknown>).pastedQuestions;
    if (typeof text === "string") return text;
  }
  return "";
}

function Required({ required }: { required: boolean }) {
  return required ? (
    <span className="text-xs text-muted-foreground">Required</span>
  ) : null;
}

function StandardRow({ item }: { item: SheetItem }) {
  const { question, prefill } = item;
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">
          {question.label} <Required required={question.required} />
        </p>
        {question.field === "resume" ? (
          <p className="mt-1">
            <a
              href="/api/resume"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Open your resume PDF
            </a>{" "}
            <span className="text-sm text-muted-foreground">
              and attach it.
            </span>
          </p>
        ) : prefill?.value ? (
          <p className="mt-1 break-words whitespace-pre-line">
            {prefill.value}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {prefill?.note ?? "Answer this one yourself."}
          </p>
        )}
        {prefill?.value && prefill.note && (
          <p className="mt-1 text-xs text-muted-foreground">{prefill.note}</p>
        )}
      </div>
      {prefill?.value && question.field !== "resume" && (
        <CopyButton value={prefill.value} label={question.label} />
      )}
    </li>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export async function AnswerSheetSection({ review }: { review: Review }) {
  const { posting, item } = review;
  const loaded = await loadQuestions(posting);
  const profile = toAnswerProfile(review.profile, null);

  if (loaded.status !== "ok") {
    const pasted = pastedQuestions(item);
    return (
      <div className="flex flex-col gap-4">
        <p>
          {loaded.status === "failed"
            ? "Shipmate couldn't load this application's questions just now. Reload in a few minutes to try again."
            : "Shipmate can't see this application's questions yet. This site keeps its form behind a sign-in."}
        </p>
        {item ? (
          <PasteQuestions userPostingId={item.id} saved={pasted} />
        ) : (
          <Quiet>
            Save this posting to Later first, and you can paste its questions
            here.
          </Quiet>
        )}
      </div>
    );
  }

  const sheet = buildSheet(loaded.questions, profile);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {sheet.total} questions on the form.{" "}
        <Link
          href="/profile/application"
          className="underline underline-offset-2"
        >
          Edit your answers
        </Link>
        .
      </p>

      {sheet.standard.length > 0 && (
        <ul
          aria-label="Questions your profile answers"
          className="divide-y rounded-xl border bg-card px-4"
        >
          {sheet.standard.map((entry, i) => (
            <StandardRow key={`${entry.question.label}-${i}`} item={entry} />
          ))}
        </ul>
      )}

      {sheet.written.length > 0 && (
        <section
          aria-labelledby="written-heading"
          className="flex flex-col gap-3"
        >
          <h3
            id="written-heading"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <PenLine aria-hidden="true" className="size-4" />
            Written questions: yours to answer
          </h3>
          <ul className="flex flex-col gap-2">
            {sheet.written.map(({ question }, i) => (
              <li
                key={`${question.label}-${i}`}
                className="rounded-lg border bg-card p-3 text-sm"
              >
                <p className="break-words">{question.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Required required={question.required} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.antibot.length > 0 && (
        <section
          aria-labelledby="antibot-heading"
          className="flex flex-col gap-3"
        >
          <h3
            id="antibot-heading"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <Bot aria-hidden="true" className="size-4" />
            Answer these yourself
          </h3>
          <ul className="flex flex-col gap-2">
            {sheet.antibot.map(({ question }, i) => (
              <li
                key={`${question.label}-${i}`}
                className="rounded-lg border border-warning/60 bg-card p-3 text-sm"
              >
                <Badge variant="secondary">Anti-bot question</Badge>
                <p className="mt-2 break-words">
                  {question.label.length > 300
                    ? `${question.label.slice(0, 300)}…`
                    : question.label}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This one is meant to tell people from bots, so Shipmate leaves
                  it to you.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.other.length > 0 && (
        <section
          aria-labelledby="other-heading"
          className="flex flex-col gap-2"
        >
          <h3 id="other-heading" className="text-sm font-medium">
            Other questions
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {sheet.other.map(({ question }, i) => (
              <li key={`${question.label}-${i}`} className="break-words">
                {question.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.demographic.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Optional demographic questions ({sheet.demographic.length})
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            These are never required. Shipmate suggests declining unless you set
            an answer in your profile.
          </p>
          <ul className="mt-2 divide-y">
            {sheet.demographic.map((entry, i) => (
              <StandardRow key={`${entry.question.label}-${i}`} item={entry} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
