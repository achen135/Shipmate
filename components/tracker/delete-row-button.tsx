"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteTrackerRow } from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";

/** Two taps: "Delete" → "Delete for good?" (no browser confirm dialog). */
export function DeleteRowButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>Delete this application and its timeline?</span>
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteTrackerRow(id);
            // Success redirects; only failures come back.
            if (!result.ok) toast.error(result.message);
          })
        }
      >
        Delete for good
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
