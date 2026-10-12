"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { saveTrackerRow } from "@/app/(app)/tracker/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
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
import { type TrackerEditForm, trackerEditSchema } from "@/lib/schemas/tracker";
import { TRACKER_STATUSES } from "@/lib/tracker/status";
import { TERM_OPTIONS } from "@/lib/watch/presets";

type Output = z.output<typeof trackerEditSchema>;

/**
 * Row detail: status (+ unsure), date applied, referral, term, resume, notes.
 * Manual rows also edit company / role / link. Saving refreshes the page so
 * a status change shows up in the timeline.
 */
export function TrackerRowForm({
  id,
  manual,
  defaultValues,
}: {
  id: string;
  manual: boolean;
  defaultValues: TrackerEditForm;
}) {
  const router = useRouter();
  const form = useForm<TrackerEditForm, unknown, Output>({
    resolver: zodResolver(trackerEditSchema),
    defaultValues,
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const uid = useId();
  const referral = useWatch({ control: form.control, name: "referral" });
  const unsure = useWatch({ control: form.control, name: "unsure" });

  async function onSubmit(values: Output) {
    const result = await saveTrackerRow(id, values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        form.setError(field as keyof TrackerEditForm, {
          message: messages[0],
        });
      }
      toast.error(result.message);
      return;
    }
    toast.success("Saved");
    form.reset(form.getValues());
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {manual && (
          <>
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
            <Field data-invalid={!!errors.url}>
              <FieldLabel htmlFor={`${uid}-url`}>Link</FieldLabel>
              <Input
                id={`${uid}-url`}
                type="url"
                inputMode="url"
                placeholder="https://…"
                aria-invalid={!!errors.url}
                {...form.register("url")}
              />
              <FieldError errors={[errors.url]} />
            </Field>
          </>
        )}

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
            <FieldError errors={[errors.status]} />
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

        <BooleanField
          id={`${uid}-unsure`}
          label="Not sure about this status"
          checked={unsure}
          onChange={(v) => form.setValue("unsure", v, { shouldDirty: true })}
        />

        <BooleanField
          id={`${uid}-referral`}
          label="Referral"
          checked={referral}
          onChange={(v) => form.setValue("referral", v, { shouldDirty: true })}
        />
        {referral && (
          <Field data-invalid={!!errors.referrer}>
            <FieldLabel htmlFor={`${uid}-referrer`}>
              Referred by (optional)
            </FieldLabel>
            <Input
              id={`${uid}-referrer`}
              aria-invalid={!!errors.referrer}
              {...form.register("referrer")}
            />
            <FieldError errors={[errors.referrer]} />
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
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

          <Field data-invalid={!!errors.resumeNote}>
            <FieldLabel htmlFor={`${uid}-resume`}>Resume</FieldLabel>
            <Input
              id={`${uid}-resume`}
              placeholder="e.g. Resume v3"
              aria-invalid={!!errors.resumeNote}
              {...form.register("resumeNote")}
            />
            <FieldDescription>Which version you sent.</FieldDescription>
            <FieldError errors={[errors.resumeNote]} />
          </Field>
        </div>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor={`${uid}-notes`}>Notes</FieldLabel>
          <Textarea
            id={`${uid}-notes`}
            rows={4}
            aria-invalid={!!errors.notes}
            {...form.register("notes")}
          />
          <FieldError errors={[errors.notes]} />
        </Field>

        <Button
          type="submit"
          className="self-start"
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </FieldGroup>
    </form>
  );
}

function BooleanField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
  );
}
