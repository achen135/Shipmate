"use client";

import { Bookmark, Check, ExternalLink, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { changeStatus } from "@/app/(app)/postings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SKIP_REASONS, type SkipReason } from "@/lib/inbox/status";
import { cn } from "@/lib/utils";

export type PostingCardData = {
  /** user_postings.id */
  id: string;
  unseen: boolean;
  posting: {
    id: string;
    title: string;
    url: string;
    company: string;
    locations: string[];
    sourceNames: string[];
    closed: boolean;
  };
  /** Formatted on the server ("3h ago") so it can't differ after hydration. */
  postedLabel: string;
};

type Outcome =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "skipped"; reason: SkipReason | null }
  | { kind: "unsaved" }
  | { kind: "applied" };

function locationText(locations: string[]): string {
  if (locations.length === 0) return "Location not listed";
  if (locations.length <= 2) return locations.join(" · ");
  return `${locations.slice(0, 2).join(" · ")} +${locations.length - 2} more`;
}

/**
 * One posting in a list. `inbox`: Save / Skip (with an optional one-tap
 * reason). `to-apply`: Apply link / Mark applied (into the Tracker) / back to
 * Inbox. Every action shows its result in place with Undo instead of the card
 * vanishing.
 */
export function PostingCard({
  data,
  mode,
}: {
  data: PostingCardData;
  mode: "inbox" | "to-apply";
}) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const { posting } = data;

  function run(
    change: Parameters<typeof changeStatus>[0],
    next: Outcome,
  ): void {
    const previous = outcome;
    setOutcome(next);
    startTransition(async () => {
      const result = await changeStatus(change);
      if (!result.ok) {
        setOutcome(previous);
        toast.error(result.message);
      }
    });
  }

  const backTo = mode === "inbox" ? "new" : "saved";
  const undo = () => run({ id: data.id, status: backTo }, { kind: "idle" });

  return (
    <article
      aria-label={`${posting.title} at ${posting.company}`}
      data-testid="posting-card"
      className={cn(
        "rounded-xl border bg-card p-4 transition-opacity",
        outcome.kind !== "idle" && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
          {data.unseen && outcome.kind === "idle" && (
            <span
              aria-label="New"
              className="size-2 shrink-0 rounded-full bg-brass"
            />
          )}
          <span className="truncate">{posting.company}</span>
        </p>
        <p className="shrink-0 text-xs text-muted-foreground">
          {data.postedLabel}
        </p>
      </div>
      <h3 className="mt-1 font-medium text-pretty">
        <Link
          href={`/postings/${posting.id}`}
          className="underline-offset-4 hover:underline"
        >
          {posting.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {locationText(posting.locations)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        via {posting.sourceNames.join(", ") || "unknown source"}
        {posting.closed && <Badge variant="outline">Closed</Badge>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {outcome.kind === "idle" && mode === "inbox" && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run({ id: data.id, status: "saved" }, { kind: "saved" })
              }
            >
              <Bookmark aria-hidden="true" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  { id: data.id, status: "skipped" },
                  { kind: "skipped", reason: null },
                )
              }
            >
              <X aria-hidden="true" />
              Skip
            </Button>
          </>
        )}

        {outcome.kind === "idle" && mode === "to-apply" && (
          <>
            <Button size="sm" asChild>
              <a href={posting.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Apply
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run({ id: data.id, status: "applied" }, { kind: "applied" })
              }
            >
              <Check aria-hidden="true" />
              Mark applied
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                run({ id: data.id, status: "new" }, { kind: "unsaved" })
              }
            >
              Back to Inbox
            </Button>
          </>
        )}

        {outcome.kind === "saved" && (
          <Result text="Saved to To Apply" onUndo={undo} pending={pending} />
        )}
        {outcome.kind === "unsaved" && (
          <Result text="Moved back to Inbox" onUndo={undo} pending={pending} />
        )}
        {outcome.kind === "applied" && (
          <Result
            text="Marked applied: it's in your Tracker"
            onUndo={undo}
            pending={pending}
          />
        )}
        {outcome.kind === "skipped" && (
          <div className="flex w-full flex-col gap-2">
            <Result
              text={
                outcome.reason
                  ? `Skipped: ${SKIP_REASONS.find((r) => r.value === outcome.reason)?.label}`
                  : "Skipped."
              }
              onUndo={undo}
              pending={pending}
            />
            {outcome.reason === null && (
              <div
                role="group"
                aria-label="Why? (optional)"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-xs text-muted-foreground">
                  Why? (optional)
                </span>
                {SKIP_REASONS.map((reason) => (
                  <Button
                    key={reason.value}
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      run(
                        {
                          id: data.id,
                          status: "skipped",
                          skipReason: reason.value,
                        },
                        { kind: "skipped", reason: reason.value },
                      )
                    }
                  >
                    {reason.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Result({
  text,
  onUndo,
  pending,
}: {
  text: string;
  onUndo: () => void;
  pending: boolean;
}) {
  return (
    <p role="status" className="flex items-center gap-3 text-sm">
      <span>{text}</span>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        Undo
      </Button>
    </p>
  );
}
