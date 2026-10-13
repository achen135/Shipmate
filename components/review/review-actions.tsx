"use client";

import { Bookmark, Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { changeStatus, markSeen } from "@/app/(app)/postings/actions";
import { addPostingToTracker } from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";
import { SKIP_REASONS } from "@/lib/inbox/status";
import { isTrackerStatus, statusLabel } from "@/lib/tracker/status";

type Item = {
  id: string;
  status: string;
  skipReason: string | null;
  unseen: boolean;
};

/**
 * The review page's sticky actions: Skip, Save (the Later queue), and Apply.
 *
 * Apply opens the company's page in a new tab; Shipmate never submits
 * anything (hard rule 1). When you come back to this tab it asks "Did you
 * submit?": Yes records the application (status Applied, today's date, via
 * the same database trigger as everywhere else), No leaves things as they
 * were.
 */
export function ReviewActions({
  postingId,
  applyUrl,
  item,
}: {
  postingId: string;
  applyUrl: string;
  item: Item | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Set when Apply is clicked; cleared once the question has been asked.
  const [applyOpened, setApplyOpened] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (item?.unseen) void markSeen(item.id);
  }, [item?.id, item?.unseen]);

  // Coming back from the application tab: switching tabs or apps changes
  // visibility, switching windows changes focus.
  useEffect(() => {
    if (!applyOpened) return;
    function back() {
      if (document.visibilityState === "visible") {
        setAsking(true);
        setApplyOpened(false);
      }
    }
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [applyOpened]);

  function set(change: Parameters<typeof changeStatus>[0]) {
    startTransition(async () => {
      const result = await changeStatus(change);
      if (!result.ok) toast.error(result.message);
      router.refresh();
    });
  }

  function submitted() {
    startTransition(async () => {
      const result = item
        ? await changeStatus({ id: item.id, status: "applied" })
        : await addPostingToTracker(postingId);
      setAsking(false);
      if (result.ok) toast.success("Set sail ✓ Added to your Tracker.");
      else toast.error(result.message);
      router.refresh();
    });
  }

  const apply = (
    <Button asChild size="lg" className="flex-1">
      <a
        href={applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setApplyOpened(true)}
      >
        Apply
        <ExternalLink aria-hidden="true" />
      </a>
    </Button>
  );

  let body: React.ReactNode;
  if (item && isTrackerStatus(item.status)) {
    body = (
      <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
        <span>In your Tracker: {statusLabel(item.status)}</span>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/tracker/${item.id}`}>Open in Tracker</Link>
        </Button>
      </p>
    );
  } else if (!item) {
    body = (
      <div className="flex gap-2">
        {apply}
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={submitted}
        >
          <Check aria-hidden="true" />
          Mark applied
        </Button>
      </div>
    );
  } else if (item.status === "new") {
    body = (
      <div className="flex gap-2">
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() => set({ id: item.id, status: "skipped" })}
        >
          <X aria-hidden="true" />
          Skip
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() => set({ id: item.id, status: "saved" })}
        >
          <Bookmark aria-hidden="true" />
          Save
        </Button>
        {apply}
      </div>
    );
  } else {
    const reason =
      item.status === "skipped" && item.skipReason
        ? `: ${SKIP_REASONS.find((r) => r.value === item.skipReason)?.label}`
        : "";
    body = (
      <div className="flex flex-col gap-2">
        <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {item.status === "saved" ? "Saved to To Apply" : `Skipped${reason}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => set({ id: item.id, status: "new" })}
          >
            Back to Inbox
          </Button>
        </p>
        <div className="flex gap-2">
          {item.status === "saved" && (
            <Button
              size="lg"
              variant="outline"
              disabled={pending}
              onClick={() => set({ id: item.id, status: "skipped" })}
            >
              <X aria-hidden="true" />
              Skip
            </Button>
          )}
          {apply}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label="Actions"
      role="region"
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[5] -mx-5 flex flex-col gap-3 border-t bg-background/95 px-5 py-3 backdrop-blur"
    >
      {asking && (
        <div
          role="alertdialog"
          aria-label="Did you submit?"
          className="flex flex-col gap-3 rounded-xl border bg-card p-4"
        >
          <p className="font-medium">Did you submit your application?</p>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={submitted}>
              Yes, I applied
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              Not yet
            </Button>
          </div>
        </div>
      )}
      {body}
    </div>
  );
}
