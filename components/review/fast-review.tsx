"use client";

import {
  Bookmark,
  ExternalLink,
  FileText,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { changeStatus } from "@/app/(app)/postings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QueueItem } from "@/lib/tailor/review-queue";
import { cn } from "@/lib/utils";

/**
 * The fast-review queue (M9 §2): tailored results in one dense list, for
 * going through several quickly. A secondary path next to the review page,
 * which stays the place for the whole result and for editing.
 *
 * It only shows what the worker already produced (the items come from
 * lib/tailor/review-queue.ts, read-only) and its one write is the same
 * changeStatus the cards use: Save or Skip the posting. Nothing here
 * tailors, edits or checks a resume.
 *
 * Keys: j/k or ↓/↑ move; e or Enter expands; s saves (moves it to To Apply,
 * or keeps it there); x skips; o opens the full review page in a new tab;
 * u undoes. Save and Skip move on to the next undecided one.
 */

type Decision = "save" | "skip" | null;
type Status = "new" | "saved" | "skipped";

/** What the posting's status is once this decision stands. */
function statusFor(item: QueueItem, decision: Decision): Status {
  if (decision === "save") return "saved";
  if (decision === "skip") return "skipped";
  return item.status;
}

function scoreText(item: QueueItem): string {
  const { scoreBefore, scoreAfter } = item.tailoring;
  if (scoreAfter === null) return "No score";
  return scoreBefore === null
    ? `${scoreAfter}%`
    : `${scoreBefore}% → ${scoreAfter}%`;
}

const SUMMARY_CHANGES = 2;

const KEYS = [
  ["j / k", "move"],
  ["e", "expand"],
  ["s", "save"],
  ["x", "skip"],
  ["o", "open"],
  ["u", "undo"],
] as const;

export function FastReview({ items }: { items: QueueItem[] }) {
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [announce, setAnnounce] = useState("");
  // What the server last confirmed per row, and each row's writes in order,
  // so Save then Skip pressed quickly can't land the other way round.
  const confirmed = useRef<Record<string, Status>>({});
  const writes = useRef<Record<string, Promise<void>>>({});
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const openLinks = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    const id = items[current]?.id;
    rows.current[id ?? ""]?.scrollIntoView?.({ block: "nearest" });
  }, [current, items]);

  function move(by: number) {
    setCurrent((i) => Math.min(items.length - 1, Math.max(0, i + by)));
  }

  function nextUndecided(from: number, after: Record<string, Decision>) {
    for (let i = from + 1; i < items.length; i++) {
      if (!after[items[i].id]) return i;
    }
    return from;
  }

  function decide(index: number, next: Decision) {
    const item = items[index];
    if (!item) return;
    const before = decisions[item.id] ?? null;
    if (before === next) return;
    const after = { ...decisions, [item.id]: next };
    setDecisions(after);
    if (next) setCurrent(nextUndecided(index, after));
    setAnnounce(
      `${next === "save" ? "Saved" : next === "skip" ? "Skipped" : "Undid"}: ${item.posting.title} at ${item.posting.company}`,
    );

    const target = statusFor(item, next);
    writes.current[item.id] = (writes.current[item.id] ?? Promise.resolve())
      .then(async () => {
        if ((confirmed.current[item.id] ?? item.status) === target) return;
        const result = await changeStatus(
          target === "skipped"
            ? { id: item.id, status: "skipped" }
            : { id: item.id, status: target },
        );
        if (result.ok) {
          confirmed.current[item.id] = target;
        } else {
          toast.error(result.message);
          setDecisions((d) => ({ ...d, [item.id]: before }));
        }
      })
      .catch(() => {
        toast.error("Couldn't update. Try again.");
        setDecisions((d) => ({ ...d, [item.id]: before }));
      });
  }

  function onKey(event: KeyboardEvent) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")
    ) {
      return;
    }
    const item = items[current];
    if (!item) return;
    const toggle = () => setExpanded((id) => (id === item.id ? null : item.id));

    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "e":
        toggle();
        break;
      case "Enter":
        // On a button or link, Enter does that control's own job.
        if (/^(A|BUTTON)$/.test(target?.tagName ?? "")) return;
        toggle();
        break;
      case "s":
        decide(current, "save");
        break;
      case "x":
        decide(current, "skip");
        break;
      case "u":
        decide(current, null);
        break;
      case "o":
        openLinks.current[item.id]?.click();
        break;
      default:
        return;
    }
  }

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const left = items.filter((item) => !decisions[item.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground" data-testid="queue-count">
          {left === 0
            ? "All reviewed."
            : `${left} of ${items.length} left to review.`}
        </p>
        <p
          className="hidden flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground md:flex"
          aria-label="Keyboard shortcuts"
        >
          {KEYS.map(([key, what]) => (
            <span key={key}>
              <kbd className="rounded border bg-muted px-1 font-mono">
                {key}
              </kbd>{" "}
              {what}
            </span>
          ))}
        </p>
      </div>
      <p role="status" className="sr-only">
        {announce}
      </p>

      <ul aria-label="Tailored results" className="flex flex-col gap-2">
        {items.map((item, index) => {
          const decision = decisions[item.id] ?? null;
          const isCurrent = index === current;
          const isOpen = expanded === item.id;
          const { tailoring, posting } = item;
          const shown = isOpen
            ? tailoring.changes
            : tailoring.changes.slice(0, SUMMARY_CHANGES);
          return (
            <li
              key={item.id}
              ref={(el) => {
                rows.current[item.id] = el;
              }}
              data-testid="queue-item"
              aria-current={isCurrent ? "true" : undefined}
              className={cn(
                "scroll-mt-4 rounded-xl border bg-card p-3 transition-opacity",
                isCurrent && "ring-2 ring-brass",
                decision && "opacity-70",
              )}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  setCurrent(index);
                  setExpanded(isOpen ? null : item.id);
                }}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-muted-foreground">
                    {posting.company}
                    {posting.locations[0] ? ` · ${posting.locations[0]}` : ""}
                  </span>
                  <span
                    className="block font-medium text-pretty"
                    data-testid="queue-title"
                  >
                    {posting.title}
                  </span>
                </span>
                <span
                  className="shrink-0 text-sm font-semibold"
                  data-testid="queue-score"
                >
                  {scoreText(item)}
                </span>
              </button>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {item.status === "saved" && (
                  <Badge variant="outline">In To Apply</Badge>
                )}
                {posting.closed && <Badge variant="outline">Closed</Badge>}
                {item.onBackupModel && (
                  <Badge variant="outline">Backup model</Badge>
                )}
                {tailoring.edited && (
                  <Badge variant="outline">Edited by you</Badge>
                )}
                {tailoring.warnings.length > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <TriangleAlert aria-hidden="true" />
                    {tailoring.warnings.length === 1
                      ? "1 warning"
                      : `${tailoring.warnings.length} warnings`}
                  </Badge>
                )}
              </div>

              {tailoring.changes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No edits made to your resume for this one.
                </p>
              ) : (
                <div className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    What changed
                  </p>
                  <ul
                    className="mt-1 flex flex-col gap-1 text-sm"
                    data-testid="queue-changes"
                  >
                    {shown.map((change, i) => (
                      <li key={i}>
                        <p className={cn(!isOpen && "line-clamp-1")}>
                          {change.what}
                        </p>
                        {isOpen && (
                          <p className="text-muted-foreground">
                            Why: {change.why}.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {!isOpen && tailoring.changes.length > SUMMARY_CHANGES && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      +{tailoring.changes.length - SUMMARY_CHANGES} more
                    </p>
                  )}
                </div>
              )}

              {isOpen && (
                <div
                  className="mt-3 flex flex-col gap-3 border-t pt-3 text-sm"
                  data-testid="queue-detail"
                >
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">On your resume</dt>
                    <dd className="break-words">
                      {tailoring.matched.join(", ") || "None"}
                    </dd>
                    <dt className="text-muted-foreground">Not on it</dt>
                    <dd className="break-words">
                      {tailoring.missing.join(", ") || "None"}
                    </dd>
                  </dl>
                  {tailoring.warnings.map((warning) => (
                    <p
                      key={warning.kind}
                      className="flex gap-2 rounded-lg bg-warning/20 p-2 text-warning-foreground dark:text-foreground"
                    >
                      <TriangleAlert
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0"
                      />
                      {warning.message}
                    </p>
                  ))}
                  {tailoring.notes.map((note) => (
                    <p key={note} className="text-muted-foreground">
                      {note}
                    </p>
                  ))}
                  {tailoring.suggestions.length > 0 && (
                    <div>
                      <p className="font-medium">Worth a look</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                        {tailoring.suggestions.map((s) => (
                          <li key={s.what}>{s.what}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {tailoring.hasPdf && !tailoring.pdfPending && (
                    <a
                      href={`/api/tailorings/${tailoring.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-fit items-center gap-1 underline underline-offset-2"
                    >
                      <FileText aria-hidden="true" className="size-4" />
                      Open the tailored PDF
                    </a>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {decision === null ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setCurrent(index);
                        decide(index, "save");
                      }}
                    >
                      <Bookmark aria-hidden="true" />
                      {item.status === "saved" ? "Keep" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCurrent(index);
                        decide(index, "skip");
                      }}
                    >
                      <X aria-hidden="true" />
                      Skip
                    </Button>
                  </>
                ) : (
                  <p role="status" className="flex items-center gap-3 text-sm">
                    <span data-testid="queue-decision">
                      {decision === "save"
                        ? item.status === "saved"
                          ? "Kept in To Apply"
                          : "Saved to To Apply"
                        : "Skipped"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => decide(index, null)}
                    >
                      <Undo2 aria-hidden="true" />
                      Undo
                    </Button>
                  </p>
                )}
                <Button size="sm" variant="ghost" asChild>
                  <a
                    ref={(el) => {
                      openLinks.current[item.id] = el;
                    }}
                    href={`/postings/${posting.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink aria-hidden="true" />
                    Open
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
