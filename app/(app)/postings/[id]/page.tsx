import { ExternalLink, FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AnswerSheetSection } from "@/components/review/answer-sheet";
import { ReviewActions } from "@/components/review/review-actions";
import { SecondLook } from "@/components/review/second-look";
import {
  PdfRefresh,
  TailorButton,
  TailoringProgress,
} from "@/components/review/tailoring";
import { requireMember } from "@/lib/auth/viewer";
import { applyLink } from "@/lib/extension/marker";
import { formatRelative, formatShortDate } from "@/lib/format/time";
import { parseContent, resumeToText } from "@/lib/resume/structured";
import { keywordMatch } from "@/lib/review/keywords";
import { getReview } from "@/lib/review/queries";
import { describePrevious, reviewWarnings } from "@/lib/review/warnings";
import { SHARED_BACKUP_MODEL } from "@/lib/ai/models";
import { LOW_SCORE } from "@/lib/tailor/pipeline";
import { type TailoringView, getLatestTailoring } from "@/lib/tailor/queries";

export const metadata: Metadata = { title: "Posting" };

const SPONSORSHIP: Record<string, string | null> = {
  unknown: null,
  offers: "Offers visa sponsorship",
  no_sponsorship: "Does not offer visa sponsorship",
  citizens_only: "U.S. citizenship required",
};

async function loadReview(id: string) {
  const review = await getReview(id);
  const tailoring =
    review?.profile?.mode === "ai" && review.item
      ? await getLatestTailoring(review.item.id)
      : null;
  return { review, tailoring, now: Date.now() };
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FitScore({ tailoring }: { tailoring: TailoringView }) {
  return (
    <div className="flex flex-col gap-3">
      <p>
        <span className="text-2xl font-semibold" data-testid="fit-score">
          {tailoring.scoreBefore}% → {tailoring.scoreAfter}%
        </span>{" "}
        <span className="text-sm text-muted-foreground">
          of what the posting asks for, before → after tailoring
        </span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">On your resume</dt>
        <dd className="break-words">
          {tailoring.matched.join(", ") || "None"}
        </dd>
        <dt className="text-muted-foreground">
          Not on your resume or in your facts
        </dt>
        <dd className="break-words">
          {tailoring.missing.join(", ") || "None"}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Required skills count twice. Shipmate never adds what you don&apos;t
        have: if one of the missing ones is true,{" "}
        <Link href="/profile/facts" className="underline underline-offset-2">
          add it to your profile facts
        </Link>{" "}
        and tailor again.
      </p>
    </div>
  );
}

function TailoredResume({
  postingId,
  inInbox,
  hasStructured,
  tailoring,
}: {
  postingId: string;
  inInbox: boolean;
  hasStructured: boolean;
  tailoring: TailoringView | null;
}) {
  if (!hasStructured) {
    return (
      <p className="rounded-xl border bg-card p-4 text-sm">
        To tailor it,{" "}
        <Link href="/profile/resume" className="underline underline-offset-2">
          import your resume into Shipmate&apos;s layout
        </Link>{" "}
        first.
      </p>
    );
  }
  if (!inInbox) {
    return (
      <p className="text-sm text-muted-foreground">
        Only postings in your Inbox can be tailored.
      </p>
    );
  }
  if (tailoring?.state === "queued" || tailoring?.state === "running") {
    return (
      <TailoringProgress
        state={tailoring.state}
        waitingForQuota={
          tailoring.state === "queued" && tailoring.rateLimitedAt !== null
        }
        shared={tailoring.keySource !== "own"}
      />
    );
  }
  if (tailoring?.state !== "done") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="text-sm">
          {tailoring?.state === "failed"
            ? `Tailoring didn't finish: ${tailoring.error ?? "something went wrong."}`
            : "Shipmate can tailor your master resume to this posting: it rewords, reorders and brings in only what's already on your resume or in your profile facts, and keeps it to one page."}
        </p>
        <div>
          <TailorButton
            postingId={postingId}
            again={tailoring?.state === "failed"}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <FileText
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="font-medium">
            Tailored for this posting
            {tailoring.edited ? " (edited by you)" : ""}
          </p>
          {tailoring.pdfPending ? (
            <PdfRefresh />
          ) : (
            tailoring.hasPdf && (
              <a
                href={`/api/tailorings/${tailoring.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
              >
                Open PDF
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            )
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/postings/${postingId}/resume`}
              className="text-sm underline underline-offset-2"
            >
              Edit this copy
            </Link>
            <TailorButton postingId={postingId} again />
          </div>
        </div>
      </div>
      {tailoring.notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      {tailoring.keySource === "shared" &&
      tailoring.model === SHARED_BACKUP_MODEL.id ? (
        <p className="text-sm text-muted-foreground" data-testid="own-key-hint">
          This ran on Shipmate&apos;s backup model ({SHARED_BACKUP_MODEL.label})
          because the main one was busy. The fit score and the skills-gap
          warning may be less reliable than usual. The resume still uses only
          what&apos;s true on your resume and in your profile, though its
          wording may be a little weaker. Tailor again later for the main model,
          or add{" "}
          <Link href="/profile/ai" className="underline underline-offset-2">
            your own key
          </Link>
          .
        </p>
      ) : (
        tailoring.keySource === "shared" &&
        tailoring.scoreAfter !== null &&
        (tailoring.scoreAfter < LOW_SCORE ||
          tailoring.changes.length === 0) && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="own-key-hint"
          >
            This ran on Shipmate&apos;s shared free model. A stronger one, on{" "}
            <Link href="/profile/ai" className="underline underline-offset-2">
              your own Anthropic or OpenAI key
            </Link>
            , may word what you already have better. No model will add skills
            you don&apos;t have.
          </p>
        )
      )}
      {tailoring.changes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">What changed</h3>
          <ul className="flex flex-col gap-3 text-sm" data-testid="changes">
            {tailoring.changes.map((change, i) => (
              <li key={i}>
                <p>{change.what}</p>
                <p className="text-muted-foreground">Why: {change.why}.</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SecondLook suggestions={tailoring.suggestions} />
    </div>
  );
}

export default async function PostingPage({
  params,
}: PageProps<"/postings/[id]">) {
  await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { review, tailoring, now } = await loadReview(id);
  if (!review) notFound();

  const { posting, item, profile, resume, previous } = review;
  const posted = posting.posted_at ?? posting.first_seen_at;
  const sponsorship = SPONSORSHIP[posting.sponsorship] ?? null;

  const facts: [string, string][] = [
    ["Location", posting.locations.join(" · ") || "Not listed"],
    ["Term", posting.terms.join(", ") || "Not listed (matches any term)"],
    ...(posting.category
      ? [["Category", posting.category] as [string, string]]
      : []),
    ...(posting.degrees.length > 0
      ? [["Degrees", posting.degrees.join(", ")] as [string, string]]
      : []),
    ...(sponsorship ? [["Sponsorship", sponsorship] as [string, string]] : []),
    ["Posted", `${formatShortDate(posted)} (${formatRelative(posted, now)})`],
    ["Source", posting.source_names.join(", ") || "Unknown"],
  ];

  const done = tailoring?.state === "done" ? tailoring : null;
  const ruleWarnings = reviewWarnings({
    posting: {
      title: posting.title,
      terms: posting.terms,
      degrees: posting.degrees,
      sponsorship: posting.sponsorship,
      description: posting.description,
    },
    profile: {
      gradMonth: profile?.grad_month ?? null,
      gradYear: profile?.grad_year ?? null,
      degree: profile?.degree ?? null,
      needsSponsorship: profile?.needs_sponsorship ?? null,
    },
    previous,
  });
  // The rules above run live; the tailoring adds what only it knows.
  const warnings = [
    ...ruleWarnings,
    ...(done?.warnings.filter(
      (w) => w.kind === "skills_gap" || w.kind === "low_score",
    ) ?? []),
  ];

  // AI mode compares against the structured resume (what tailoring starts
  // from); Simple mode against the uploaded PDF's text.
  const structured =
    profile?.mode === "ai" ? parseContent(resume?.content) : null;
  const resumeText = structured
    ? resumeToText(structured)
    : (resume?.text_content?.trim() ?? "");
  const match = resume
    ? keywordMatch(posting, resumeText || null)
    : { score: null, matched: [], missing: [] };

  return (
    <article className="flex flex-col gap-8">
      {posting.status === "closed" && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg bg-warning/20 p-3 text-sm text-warning-foreground dark:text-foreground"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          This posting looks closed: its source took it down. The link may still
          work for a little while.
        </p>
      )}

      <header className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {posting.company?.name ?? "Unknown company"}
          </p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-balance">
            {posting.title}
          </h1>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {warnings.length > 0 && (
        <Section id="warnings-heading" title="Warnings">
          <ul className="flex flex-col gap-2">
            {warnings.map((warning) => (
              <li
                key={warning.kind}
                className="flex gap-2 rounded-lg bg-warning/20 p-3 text-sm text-warning-foreground dark:text-foreground"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                <div className="min-w-0">
                  <p>{warning.message}</p>
                  {warning.previous && (
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {warning.previous.map((p) => (
                        <li key={p.id}>
                          <Link
                            href={`/tracker/${p.id}`}
                            className="underline underline-offset-2"
                          >
                            {describePrevious(p)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Warnings never stop you from applying.
          </p>
        </Section>
      )}

      {done && done.scoreAfter !== null ? (
        <Section id="match-heading" title="Fit">
          <FitScore tailoring={done} />
        </Section>
      ) : (
        <Section id="match-heading" title="Keyword match">
          {!resume ? (
            <p className="text-sm text-muted-foreground">
              <Link
                href="/profile/application"
                className="underline underline-offset-2"
              >
                Upload your resume
              </Link>{" "}
              to see how many of this posting&apos;s words it shares.
            </p>
          ) : !resumeText ? (
            <p className="text-sm text-muted-foreground">
              No text could be read from your resume PDF, so there&apos;s
              nothing to compare.
            </p>
          ) : match.score === null ? (
            <p className="text-sm text-muted-foreground">
              This posting doesn&apos;t include enough text to compare.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>
                <span className="text-2xl font-semibold">{match.score}%</span>{" "}
                <span className="text-sm text-muted-foreground">
                  of this posting&apos;s words are in your resume
                </span>
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">In both</dt>
                <dd className="break-words">
                  {match.matched.join(", ") || "None"}
                </dd>
                <dt className="text-muted-foreground">Not in your resume</dt>
                <dd className="break-words">
                  {match.missing.join(", ") || "None"}
                </dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                A rough word count, not a judgment of your fit. Many words that
                matter here won&apos;t appear in either text.
              </p>
            </div>
          )}
        </Section>
      )}

      <Section id="resume-heading" title="Resume">
        {profile?.mode === "ai" && (
          <TailoredResume
            postingId={posting.id}
            inInbox={item !== null}
            hasStructured={structured !== null}
            tailoring={tailoring}
          />
        )}
        {structured && !resume?.file_path ? null : resume?.file_path ? (
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <FileText
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {resume.file_name ?? "resume.pdf"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your uploaded PDF, attached as it is.
              </p>
              <a
                href="/api/resume"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm underline underline-offset-2"
              >
                Open PDF
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No resume uploaded yet.{" "}
            <Link
              href="/profile/application"
              className="underline underline-offset-2"
            >
              Upload a PDF
            </Link>
            .
          </p>
        )}
      </Section>

      <Section id="questions-heading" title="Application questions">
        <Suspense
          fallback={
            <p role="status" className="text-sm text-muted-foreground">
              Charting course… looking up the application form.
            </p>
          }
        >
          <AnswerSheetSection review={review} />
        </Suspense>
      </Section>

      <ReviewActions
        postingId={posting.id}
        // With the extension's #shipmate= marker when it can fill the page.
        applyUrl={applyLink(posting.url, item?.id ?? null)}
        item={
          item && {
            id: item.id,
            status: item.status,
            skipReason: item.skip_reason,
            unseen: item.seen_at === null,
          }
        }
      />
    </article>
  );
}
