"use client";

import { FileSearch, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActionResult } from "@/lib/action-result";
import {
  FACT_KIND_LABELS,
  type FactInput,
  type FactKind,
} from "@/lib/schemas/fact-bank";

type Suggestion = {
  kind: FactKind;
  text: string;
  detail: string;
  traced: boolean;
};

/**
 * Optional: upload a longer CV or a LinkedIn PDF; the AI suggests entries
 * that aren't on the resume; the user ticks which are true. Nothing is saved
 * until they press Add.
 */
export function FactSuggestions({
  addSuggestedFacts,
}: {
  addSuggestedFacts: (facts: FactInput[]) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/facts/suggest", {
        method: "POST",
        body,
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        suggestions?: Suggestion[];
      };
      if (!response.ok || !result.suggestions) {
        toast.error(result.message ?? "Couldn't read it. Try again.");
        return;
      }
      setSuggestions(result.suggestions);
      // Pre-tick only what's word-for-word in the file.
      setPicked(
        new Set(result.suggestions.flatMap((s, i) => (s.traced ? [i] : []))),
      );
    } catch {
      toast.error("Couldn't upload. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const chosen = (suggestions ?? []).filter((_, i) => picked.has(i));
    startTransition(async () => {
      const result = await addSuggestedFacts(
        chosen.map(({ kind, text, detail }) => ({ kind, text, detail })),
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Added ${chosen.length}.`);
      setSuggestions(null);
      router.refresh();
    });
  }

  if (suggestions) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="font-medium">
          {suggestions.length
            ? "Tick the ones that are true"
            : "Nothing new found in that file."}
        </p>
        <ul className="flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <Checkbox
                id={`${inputId}-${i}`}
                checked={picked.has(i)}
                onCheckedChange={(checked) =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (checked === true) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <label htmlFor={`${inputId}-${i}`} className="min-w-0 text-sm">
                <span className="text-muted-foreground">
                  {FACT_KIND_LABELS[s.kind]}:
                </span>{" "}
                {s.text}
                {s.detail && (
                  <span className="block text-muted-foreground">
                    {s.detail}
                  </span>
                )}
                {!s.traced && (
                  <span className="mt-1 flex items-center gap-1 text-warning-foreground dark:text-foreground">
                    <TriangleAlert aria-hidden="true" className="size-3.5" />
                    Not word for word in your file. Only tick it if it&apos;s
                    true.
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || picked.size === 0} onClick={save}>
            Add {picked.size} to my list
          </Button>
          <Button variant="ghost" onClick={() => setSuggestions(null)}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button asChild variant="outline" disabled={busy}>
        <label htmlFor={inputId} className="cursor-pointer">
          <FileSearch aria-hidden="true" />
          {busy ? "Charting course… reading it" : "Find more in a longer CV"}
        </label>
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Optional. Upload a full CV or your LinkedIn PDF export; your AI provider
        suggests what&apos;s missing from your resume and you pick what to keep.
        The file isn&apos;t stored.
      </p>
    </div>
  );
}
