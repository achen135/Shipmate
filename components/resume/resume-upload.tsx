"use client";

import { FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Current = { fileName: string; updatedAt: string; readable: boolean };

/**
 * Upload / replace / remove the one resume PDF (app/api/resume). Simple mode
 * uses the file exactly as given.
 */
export function ResumeUpload({ current }: { current: Current | null }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/resume", { method: "POST", body });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        readable?: boolean;
      };
      if (!response.ok) {
        toast.error(result.message ?? "Couldn't upload. Try again.");
        return;
      }
      toast.success(
        result.readable === false
          ? "Saved. Shipmate can't read text in this PDF, so the keyword match won't work."
          : "Resume saved.",
      );
      router.refresh();
    } catch {
      toast.error("Couldn't upload. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/resume", { method: "DELETE" });
      if (!response.ok) {
        toast.error("Couldn't remove it. Try again.");
        return;
      }
      toast.success("Resume removed.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {current && (
        <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
          <FileText
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{current.fileName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Uploaded {current.updatedAt}
              {!current.readable &&
                ". No text could be read from it, so the keyword match is off."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href="/api/resume" target="_blank" rel="noopener noreferrer">
                  Open
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={remove}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      <div>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
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
            <Upload aria-hidden="true" />
            {busy ? "Uploading…" : current ? "Replace PDF" : "Upload PDF"}
          </label>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          One PDF, up to 4 MB. Shipmate attaches it as it is; it never edits
          your resume in Simple mode.
        </p>
      </div>
    </div>
  );
}
