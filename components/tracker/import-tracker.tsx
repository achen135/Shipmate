"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { importApplications } from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { formatCalendarDate } from "@/lib/format/time";
import { type ImportResult, parseImport } from "@/lib/tracker/import";
import { recordKey } from "@/lib/tracker/record";
import { cn } from "@/lib/utils";

import { StatusBadge } from "./status-badge";

/** Larger than any tracker; stops someone pasting a whole database. */
const MAX_FILE_BYTES = 2_000_000;

/**
 * Tracker → Import: paste a Markdown table (or upload a CSV), check the
 * preview (every row's parsed result, and which are already in the
 * tracker), then save. Parsing runs here; the Server Action validates again.
 */
export function ImportTracker({ existingKeys }: { existingKeys: string[] }) {
  const uid = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const previewRef = useRef<HTMLElement>(null);

  // Below the pasted text on a phone: bring the preview into view.
  useEffect(() => {
    if (result?.ok) previewRef.current?.scrollIntoView({ block: "start" });
  }, [result]);

  const preview = useMemo(() => {
    if (!result?.ok) return null;
    const seen = new Set(existingKeys);
    return result.rows.map((row) => {
      if (!row.record) return { row, state: "error" as const };
      const key = recordKey(row.record);
      const state = seen.has(key) ? ("duplicate" as const) : ("new" as const);
      seen.add(key);
      return { row, state };
    });
  }, [result, existingKeys]);

  const toImport = preview?.filter((p) => p.state === "new") ?? [];
  const duplicates =
    preview?.filter((p) => p.state === "duplicate").length ?? 0;
  const errors = preview?.filter((p) => p.state === "error").length ?? 0;

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("That file is too big for a tracker.");
      return;
    }
    const content = await file.text();
    setText(content);
    setResult(parseImport(content));
  }

  function save() {
    startTransition(async () => {
      const outcome = await importApplications(
        toImport.map((p) => p.row.record),
      );
      if (!outcome.ok) {
        toast.error(outcome.message);
        return;
      }
      toast.success(
        `Imported ${outcome.added} application${outcome.added === 1 ? "" : "s"}` +
          (outcome.skipped ? ` (${outcome.skipped} already there)` : "."),
      );
      router.push("/tracker");
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={`${uid}-text`}>Paste your tracker</FieldLabel>
        <Textarea
          id={`${uid}-text`}
          rows={8}
          wrap="off"
          className="field-sizing-fixed h-48 font-mono text-xs whitespace-pre"
          placeholder={
            "# Summer 2027\n\n| Company | Date Applied | Status | Resume Version | Notes |\n| --- | --- | --- | --- | --- |\n| Acme | 09/19/26 | Waiting | 1 | |"
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
        />
        <FieldDescription>
          A Markdown table (a <code># Summer 2027</code> heading above it sets
          the term) or CSV. Columns are matched by name: Company, Role, Date
          Applied, Status, Resume Version, Notes, and more. Struck-through
          companies (~~Acme~~) count as rejected.
        </FieldDescription>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!text.trim()}
          onClick={() => setResult(parseImport(text))}
        >
          Preview
        </Button>
        <Button variant="outline" asChild>
          <label htmlFor={`${uid}-file`} className="cursor-pointer">
            <FileUp aria-hidden="true" />
            Upload CSV
          </label>
        </Button>
        <input
          id={`${uid}-file`}
          type="file"
          accept=".csv,.md,.txt,text/csv,text/markdown,text/plain"
          className="sr-only"
          onChange={(e) => {
            void readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {result && !result.ok && (
        <p role="alert" className="text-sm text-destructive">
          {result.message}
        </p>
      )}

      {preview && (
        <section
          ref={previewRef}
          aria-labelledby={`${uid}-preview`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`${uid}-preview`}
            className="font-heading text-lg font-semibold"
          >
            Preview
          </h2>
          <p role="status" className="text-sm">
            {preview.length} row{preview.length === 1 ? "" : "s"}:{" "}
            <strong>{toImport.length} to import</strong>
            {duplicates > 0 && `, ${duplicates} already in tracker`}
            {errors > 0 && `, ${errors} can't be imported`}.
          </p>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-xs">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Line</th>
                  <th className="px-2 py-2 font-medium">Result</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Term</th>
                  <th className="px-2 py-2 font-medium">Applied</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Referral</th>
                  <th className="px-2 py-2 font-medium">Resume</th>
                  <th className="px-2 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(({ row, state }) => {
                  const r = row.record;
                  return (
                    <tr
                      key={row.line}
                      data-testid="import-row"
                      className={cn(
                        "border-b align-top last:border-0",
                        state !== "new" && "text-muted-foreground",
                      )}
                    >
                      <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {state === "new" && "New"}
                        {state === "duplicate" && "Already in tracker"}
                        {state === "error" && (
                          <span className="text-destructive">{row.error}</span>
                        )}
                        {row.warnings.map((w) => (
                          <span
                            key={w}
                            className="block text-warning-foreground dark:text-foreground"
                          >
                            {w}
                          </span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 font-medium">{r?.company}</td>
                      <td className="px-2 py-1.5">
                        {r ? (r.role ?? "—") : ""}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {r?.term}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                        {r?.appliedAt
                          ? formatCalendarDate(r.appliedAt, true)
                          : ""}
                      </td>
                      <td className="px-2 py-1.5">
                        {r && (
                          <StatusBadge status={r.status} unsure={r.unsure} />
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r?.referral ? (r.referrer ?? "Yes") : ""}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {r?.resumeNote}
                      </td>
                      <td className="min-w-48 px-2 py-1.5 whitespace-pre-line">
                        {r?.notes}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button
            className="self-start"
            disabled={pending || toImport.length === 0}
            onClick={save}
          >
            {pending
              ? "Importing…"
              : `Import ${toImport.length} row${toImport.length === 1 ? "" : "s"}`}
          </Button>
        </section>
      )}
    </div>
  );
}
