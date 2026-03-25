"use client";

import { Bookmark, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SKIP_REASONS } from "@/lib/inbox/status";

import { changeStatus, markSeen } from "../actions";

/** Save / Skip / undo for a posting that's in the user's Inbox. */
export function PostingActions({
  id,
  status,
  skipReason,
  unseen,
}: {
  id: string;
  status: string;
  skipReason: string | null;
  unseen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (unseen) void markSeen(id);
  }, [id, unseen]);

  function set(change: Parameters<typeof changeStatus>[0]) {
    startTransition(async () => {
      const result = await changeStatus(change);
      if (!result.ok) toast.error(result.message);
      router.refresh();
    });
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
      </div>
    );
  }

  const label =
    status === "saved"
      ? "Saved to To Apply"
      : status === "skipped"
        ? `Skipped${skipReason ? `: ${SKIP_REASONS.find((r) => r.value === skipReason)?.label}` : ""}`
        : `Status: ${status}`;

  return (
    <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
      <span>{label}</span>
      {(status === "saved" || status === "skipped") && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => set({ id, status: "new" })}
        >
          Back to Inbox
        </Button>
      )}
    </p>
  );
}
