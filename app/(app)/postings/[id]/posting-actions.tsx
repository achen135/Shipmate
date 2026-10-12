"use client";

import { Bookmark, Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { addPostingToTracker } from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";
import { SKIP_REASONS } from "@/lib/inbox/status";
import { isTrackerStatus, statusLabel } from "@/lib/tracker/status";

import { changeStatus, markSeen } from "../actions";

/**
 * Save / Skip / Mark applied / undo for a posting. `item` is the user's
 * user_postings row; postings reached another way (a link, the Tracker's
 * lookup) may have none yet, and Mark applied creates it.
 */
export function PostingActions({
  postingId,
  item,
}: {
  postingId: string;
  item: {
    id: string;
    status: string;
    skipReason: string | null;
    unseen: boolean;
  } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (item?.unseen) void markSeen(item.id);
  }, [item?.id, item?.unseen]);

  function set(change: Parameters<typeof changeStatus>[0]) {
    startTransition(async () => {
      const result = await changeStatus(change);
      if (!result.ok) toast.error(result.message);
      router.refresh();
    });
  }

  function markApplied() {
    if (item) return set({ id: item.id, status: "applied" });
    startTransition(async () => {
      const result = await addPostingToTracker(postingId);
      if (!result.ok) toast.error(result.message);
      router.refresh();
    });
  }

  const markAppliedButton = (
    <Button variant="outline" disabled={pending} onClick={markApplied}>
      <Check aria-hidden="true" />
      Mark applied
    </Button>
  );

  if (!item) {
    return <div className="flex flex-wrap gap-2">{markAppliedButton}</div>;
  }

  const { id, status, skipReason } = item;

  if (isTrackerStatus(status)) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
        <span>In your Tracker: {statusLabel(status)}</span>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/tracker/${id}`}>Open in Tracker</Link>
        </Button>
      </p>
    );
  }

  if (status === "new") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => set({ id, status: "saved" })}
        >
          <Bookmark aria-hidden="true" />
          Save
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => set({ id, status: "skipped" })}
        >
          <X aria-hidden="true" />
          Skip
        </Button>
        {markAppliedButton}
      </div>
    );
  }

  const label =
    status === "saved"
      ? "Saved to To Apply"
      : `Skipped${skipReason ? `: ${SKIP_REASONS.find((r) => r.value === skipReason)?.label}` : ""}`;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
        <span>{label}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => set({ id, status: "new" })}
        >
          Back to Inbox
        </Button>
      </p>
      {status === "saved" && (
        <div className="flex flex-wrap gap-2">{markAppliedButton}</div>
      )}
    </div>
  );
}
