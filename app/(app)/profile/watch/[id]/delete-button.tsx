"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/** Two taps, no browser dialog: the first arms it, the second deletes. */
export function DeleteWatchProfileButton({
  action,
}: {
  action: () => Promise<ActionResult>;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2 border-t pt-6">
      <Button
        type="button"
        variant={armed ? "destructive" : "outline"}
        disabled={pending}
        onClick={() => {
          if (!armed) return setArmed(true);
          startTransition(async () => {
            const result = await action();
            if (!result.ok) toast.error(result.message);
          });
        }}
      >
        <Trash2 aria-hidden="true" />
        {armed ? "Tap again to delete" : "Delete this search"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Postings it already found stay in your Inbox.
      </p>
    </div>
  );
}
