"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** "Tailor this" / "Tailor again": queue it, then show the progress. */
export function TailorButton({
  postingId,
  again = false,
}: {
  postingId: string;
  again?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function tailor() {
    startTransition(async () => {
      const response = await fetch("/api/tailor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId }),
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response?.ok) {
        toast.error(body?.message ?? "Couldn't start tailoring. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant={again ? "outline" : "default"}
      disabled={pending}
      onClick={tailor}
    >
      <Sparkles aria-hidden="true" />
      {pending ? "Starting…" : again ? "Tailor again" : "Tailor this"}
    </Button>
  );
}

/**
 * Queued or running: say so, and refresh the page every few seconds until
 * the worker is done (usually 30-90 seconds after it starts).
 */
export function TailoringProgress({
  state,
  waitingForQuota,
}: {
  state: "queued" | "running";
  waitingForQuota: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {waitingForQuota
        ? "Waiting: Shipmate's shared free AI is busy right now. It tries again on its next run, within about 30 minutes."
        : state === "queued"
          ? "Charting course… tailoring starts in a moment."
          : "Charting course… tailoring your resume to this posting. This takes about a minute."}
    </p>
  );
}

/** An edited copy's PDF is being printed again: refresh until it's back. */
export function PdfRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Printing your edited copy…
    </p>
  );
}
