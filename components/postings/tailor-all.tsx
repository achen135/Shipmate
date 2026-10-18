"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SharedQuota } from "@/components/ai/ai-settings";
import { Button } from "@/components/ui/button";
import type { SharedQuotaLine } from "@/lib/ai/types";
import { type TailorAllResult, planText, resultText } from "@/lib/tailor/mass";

/**
 * "Tailor all" on To Apply (M9 §1): tailor everything saved here that isn't
 * tailored yet. What fits under today's daily cap starts now; the rest is
 * queued for the following days. The line under the button says which
 * before it's pressed, and what the database actually queued after.
 */
export function TailorAll({
  eligible,
  remainingToday,
  dailyCap,
  sharedQuota,
}: {
  eligible: number;
  remainingToday: number;
  dailyCap: number;
  sharedQuota: SharedQuotaLine[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  function tailorAll() {
    startTransition(async () => {
      const response = await fetch("/api/tailor/all", {
        method: "POST",
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as
        (TailorAllResult & { message?: string }) | null;
      if (!response?.ok || !body) {
        toast.error(body?.message ?? "Couldn't start tailoring. Try again.");
        return;
      }
      const text = resultText(body);
      setDone(text);
      toast.success(text);
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="tailor-all-heading"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid="tailor-all"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="tailor-all-heading" className="text-sm font-medium">
            Tailor everything here
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            {done ?? planText({ eligible, remainingToday, dailyCap })}
          </p>
        </div>
        <Button
          size="sm"
          disabled={pending || eligible === 0}
          onClick={tailorAll}
        >
          <Sparkles aria-hidden="true" />
          {pending ? "Starting…" : "Tailor all"}
        </Button>
      </div>
      {sharedQuota && eligible > 0 && <SharedQuota lines={sharedQuota} />}
    </section>
  );
}
