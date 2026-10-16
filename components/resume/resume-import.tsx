"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * AI mode: read a PDF or Word resume into the structured editor (app/api/
 * resume/import). Re-importing replaces the structured resume, so with one
 * already saved the button asks first.
 *
 * The route streams JSON lines: `{ retrying }` when the model was
 * overloaded and it's trying again (shown as it happens, so a longer wait
 * isn't a silent one), then the outcome. A request it turns away before
 * reading is a plain JSON error.
 */

type ImportEvent = {
  retrying?: string;
  ok?: boolean;
  message?: string;
  sections?: string[];
  notes?: number;
};

/** Each JSON line of the body, as it arrives. */
async function* events(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ImportEvent;
    }
    if (done) return;
  }
}
export function ResumeImport({ hasContent }: { hasContent: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  /** Whose servers are busy, while an overloaded model is being retried. */
  const [retrying, setRetrying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setRetrying(null);
    setConfirming(false);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/resume/import", {
        method: "POST",
        body,
      });
      let result: ImportEvent = {};
      if (!response.ok || !response.body) {
        result = (await response.json().catch(() => ({}))) as ImportEvent;
      } else {
        for await (const event of events(response.body)) {
          if (event.retrying) setRetrying(event.retrying);
          else result = event;
        }
      }
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Couldn't read it. Try again.");
        return;
      }
      toast.success(
        result.notes
          ? `Read ${result.sections?.length ?? 0} sections. Check the notes at the top.`
          : `Read ${result.sections?.length ?? 0} sections. Check it over below.`,
      );
      router.refresh();
    } catch {
      toast.error("Couldn't upload. Check your connection and try again.");
    } finally {
      setBusy(false);
      setRetrying(null);
    }
  }

  const picker = (
    <>
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
      <Button
        asChild
        variant={hasContent ? "outline" : "default"}
        disabled={busy}
      >
        <label htmlFor={inputId} className="cursor-pointer">
          <Sparkles aria-hidden="true" />
          {busy
            ? retrying
              ? "Charting course… trying again"
              : "Charting course… reading your resume"
            : hasContent
              ? "Choose a file to replace it"
              : "Import from PDF or Word"}
        </label>
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {hasContent && !confirming && !busy ? (
        <div>
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <Sparkles aria-hidden="true" />
            Import again
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {picker}
          {confirming && (
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}
      <p
        className="text-xs text-muted-foreground"
        role={busy ? "status" : undefined}
      >
        {busy
          ? retrying
            ? `${retrying}'s servers are briefly busy, so Shipmate is trying again. Keep this page open.`
            : "This takes about a minute. Keep this page open."
          : hasContent && confirming
            ? "Importing again replaces the structured resume below, including your edits."
            : "Your AI provider reads the file once and fills in the editor, keeping your own sections. The file isn't stored."}
      </p>
    </div>
  );
}
