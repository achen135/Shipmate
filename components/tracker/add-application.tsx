"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Link2, Search } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  addManualApplication,
  addPostingToTracker,
} from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type ManualAddForm, manualAddSchema } from "@/lib/schemas/tracker";
import type { LookupResult } from "@/lib/tracker/lookup";
import {
  TRACKER_STATUSES,
  isTrackerStatus,
  statusLabel,
} from "@/lib/tracker/status";
import { TERM_OPTIONS } from "@/lib/watch/presets";

type Stage =
  | { kind: "url" }
  | { kind: "posting"; result: Extract<LookupResult, { kind: "posting" }> }
  | { kind: "form"; prefill: Partial<ManualAddForm>; note: string | null };

/**
 * Tracker → Add. Paste a job link: a posting Shipmate already has is linked
 * (no duplicate row); a Greenhouse / Lever / Ashby job is filled in from its
 * API; anything else opens the form with the link filled in. "Add without a
 * link" goes straight to the form.
 */
export function AddApplication({ today }: { today: string }) {
  const uid = useId();
  const [stage, setStage] = useState<Stage>({ kind: "url" });
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function lookUp(event: React.FormEvent) {
    event.preventDefault();
    const link = url.trim();
    if (!/^https?:\/\/\S+$/i.test(link)) {
      setUrlError("Paste a full link (https://…).");
      return;
    }
    setUrlError(null);
    startTransition(async () => {
      const response = await fetch("/api/tracker/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      }).catch(() => null);
      if (!response?.ok) {
        // Lookup is a convenience: fall back to the form.
        setStage({
          kind: "form",
          prefill: { url: link },
          note: "Couldn't look that up. Fill in the rest.",
        });
        return;
      }
      const result = (await response.json()) as LookupResult;
      if (result.kind === "posting") setStage({ kind: "posting", result });
      else if (result.kind === "fetched")
        setStage({
          kind: "form",
          prefill: {
            company: result.job.company,
            role: result.job.title,
            location: result.job.location ?? "",
            url: result.job.url,
          },
          note: "Filled in from the job board. Check it, then add.",
        });
      else
        setStage({
          kind: "form",
          prefill: { url: link },
          note: "Shipmate can't read that site. Fill in the rest.",
        });
    });
  }

  if (stage.kind === "posting") {
    const { posting, row } = stage.result;
    const tracked = row && isTrackerStatus(row.status);
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Found in Shipmate
          </p>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            {posting.company}
          </p>
          <p className="font-medium">{posting.title}</p>
          {posting.location && (
            <p className="mt-1 text-sm text-muted-foreground">
              {posting.location}
            </p>
          )}
          {posting.closed && (
            <p className="mt-1 text-sm text-muted-foreground">
              This posting has closed.
            </p>
          )}
        </div>
        {tracked ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            Already in your Tracker ({statusLabel(row.status)}).
            <Button size="sm" variant="outline" asChild>
              <Link href={`/tracker/${row.id}`}>Open it</Link>
            </Button>
          </p>
        ) : (
          <Button
            className="self-start"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await addPostingToTracker(posting.id, {
                  open: true,
                });
                // Success redirects to the new row.
                if (!result.ok) toast.error(result.message);
              })
            }
          >
            <Check aria-hidden="true" />
            Add to Tracker as applied
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setStage({ kind: "url" })}
        >
          Use a different link
        </Button>
      </div>
    );
  }

  if (stage.kind === "form") {
    return (
      <ManualForm
        today={today}
        prefill={stage.prefill}
        note={stage.note}
        onBack={() => setStage({ kind: "url" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={lookUp} noValidate>
        <Field data-invalid={!!urlError}>
          <FieldLabel htmlFor={`${uid}-url`}>Job link</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={`${uid}-url`}
              type="url"
              inputMode="url"
              placeholder="https://boards.greenhouse.io/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!urlError}
              className="h-9"
            />
            <Button type="submit" disabled={pending}>
              <Search aria-hidden="true" />
              {pending ? "Looking…" : "Look up"}
            </Button>
          </div>
          {urlError && (
            <p role="alert" className="text-sm text-destructive">
              {urlError}
            </p>
          )}
        </Field>
      </form>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setStage({ kind: "form", prefill: {}, note: null })}
      >
        <Link2 aria-hidden="true" />
        Add without a link
      </Button>
    </div>
  );
}

type Output = z.output<typeof manualAddSchema>;

function ManualForm({
  today,
  prefill,
  note,
  onBack,
}: {
  today: string;
  prefill: Partial<ManualAddForm>;
  note: string | null;
  onBack: () => void;
}) {
  const uid = useId();
  const form = useForm<ManualAddForm, unknown, Output>({
    resolver: zodResolver(manualAddSchema),
    defaultValues: {
      company: "",
      role: "",
      location: "",
      url: "",
      status: "applied",
      appliedAt: today,
      term: TERM_OPTIONS[0],
      referral: false,
      notes: "",
      ...prefill,
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: Output) {
    const result = await addManualApplication(values);
    // Success redirects to the new row.
    if (result.ok) return;
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
      form.setError(field as keyof ManualAddForm, { message: messages[0] });
    }
    toast.error(result.message);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {note && (
          <p role="status" className="rounded-lg bg-secondary p-3 text-sm">
            {note}
          </p>
        )}
        <Field data-invalid={!!errors.company}>
          <FieldLabel htmlFor={`${uid}-company`}>Company</FieldLabel>
          <Input
            id={`${uid}-company`}
            aria-invalid={!!errors.company}
            {...form.register("company")}
          />
          <FieldError errors={[errors.company]} />
        </Field>
        <Field data-invalid={!!errors.role}>
          <FieldLabel htmlFor={`${uid}-role`}>Role</FieldLabel>
          <Input
            id={`${uid}-role`}
            aria-invalid={!!errors.role}
            {...form.register("role")}
          />
          <FieldError errors={[errors.role]} />
        </Field>
        <Field data-invalid={!!errors.location}>
          <FieldLabel htmlFor={`${uid}-location`}>Location</FieldLabel>
          <Input
            id={`${uid}-location`}
            aria-invalid={!!errors.location}
            {...form.register("location")}
          />
          <FieldError errors={[errors.location]} />
        </Field>
        <Field data-invalid={!!errors.url}>
          <FieldLabel htmlFor={`${uid}-url`}>Link</FieldLabel>
          <Input
            id={`${uid}-url`}
            type="url"
            inputMode="url"
            aria-invalid={!!errors.url}
            {...form.register("url")}
          />
          <FieldError errors={[errors.url]} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.status}>
            <FieldLabel htmlFor={`${uid}-status`}>Status</FieldLabel>
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={`${uid}-status`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRACKER_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field data-invalid={!!errors.appliedAt}>
            <FieldLabel htmlFor={`${uid}-applied`}>Date applied</FieldLabel>
            <Input
              id={`${uid}-applied`}
              type="date"
              aria-invalid={!!errors.appliedAt}
              {...form.register("appliedAt")}
            />
            <FieldError errors={[errors.appliedAt]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.term}>
          <FieldLabel htmlFor={`${uid}-term`}>Term</FieldLabel>
          <Input
            id={`${uid}-term`}
            list={`${uid}-terms`}
            aria-invalid={!!errors.term}
            {...form.register("term")}
          />
          <datalist id={`${uid}-terms`}>
            {TERM_OPTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <FieldError errors={[errors.term]} />
        </Field>

        <Controller
          control={form.control}
          name="referral"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id={`${uid}-referral`}
                checked={field.value}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
              <FieldLabel htmlFor={`${uid}-referral`} className="font-normal">
                Referral
              </FieldLabel>
            </Field>
          )}
        />

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor={`${uid}-notes`}>Notes</FieldLabel>
          <Textarea
            id={`${uid}-notes`}
            rows={3}
            aria-invalid={!!errors.notes}
            {...form.register("notes")}
          />
          <FieldError errors={[errors.notes]} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add to Tracker"}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
