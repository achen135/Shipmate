"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import {
  type Basics,
  DEGREES,
  MONTHS,
  basicsSchema,
} from "@/lib/schemas/basics";

/**
 * Basics: onboarding step 2 and the Profile page. The same zod schema
 * validates here and again in the Server Action.
 */
export function BasicsForm({
  defaultValues,
  gradYears,
  action,
  submitLabel,
  successMessage,
}: {
  defaultValues: Partial<Basics>;
  gradYears: number[];
  action: (values: Basics) => Promise<ActionResult>;
  submitLabel: string;
  /** Toast on success. Omit when the action redirects instead. */
  successMessage?: string;
}) {
  const form = useForm<Basics>({
    resolver: zodResolver(basicsSchema),
    defaultValues,
  });
  const { errors, isSubmitting } = form.formState;
  // Unique per instance: Next keeps the previous route mounted (hidden), so
  // onboarding's form and Profile's can be in the DOM at once.
  const id = useId();

  async function onSubmit(values: Basics) {
    const result = await action(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        form.setError(field as keyof Basics, { message: messages[0] });
      }
      toast.error(result.message);
      return;
    }
    if (successMessage) toast.success(successMessage);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor={`${id}-name`}>Full name</FieldLabel>
          <Input
            id={`${id}-name`}
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.school}>
          <FieldLabel htmlFor={`${id}-school`}>School</FieldLabel>
          <Input
            id={`${id}-school`}
            autoComplete="organization"
            aria-invalid={!!errors.school}
            {...form.register("school")}
          />
          <FieldError errors={[errors.school]} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.degree}>
            <FieldLabel htmlFor={`${id}-degree`}>Degree</FieldLabel>
            <Controller
              control={form.control}
              name="degree"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    id={`${id}-degree`}
                    aria-invalid={!!errors.degree}
                    className="w-full"
                  >
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEGREES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.degree]} />
          </Field>

          <Field data-invalid={!!errors.major}>
            <FieldLabel htmlFor={`${id}-major`}>Major</FieldLabel>
            <Input
              id={`${id}-major`}
              aria-invalid={!!errors.major}
              {...form.register("major")}
            />
            <FieldError errors={[errors.major]} />
          </Field>
        </div>

        <FieldSet>
          <FieldLegend variant="label">Graduation</FieldLegend>
          <div className="grid grid-cols-2 gap-3">
            <NumberSelect
              idPrefix={id}
              control={form.control}
              name="gradMonth"
              label="Graduation month"
              placeholder="Month"
              options={MONTHS.map((month, i) => ({
                value: i + 1,
                label: month,
              }))}
              error={errors.gradMonth}
            />
            <NumberSelect
              idPrefix={id}
              control={form.control}
              name="gradYear"
              label="Graduation year"
              placeholder="Year"
              options={gradYears.map((year) => ({
                value: year,
                label: String(year),
              }))}
              error={errors.gradYear}
            />
          </div>
        </FieldSet>

        <YesNo
          idPrefix={id}
          control={form.control}
          name="workAuthorized"
          legend="Are you authorized to work in the US?"
          error={errors.workAuthorized}
        />
        <YesNo
          idPrefix={id}
          control={form.control}
          name="needsSponsorship"
          legend="Will you now or in the future need visa sponsorship?"
          error={errors.needsSponsorship}
        />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}

type FieldErrorLike = { message?: string } | undefined;

function NumberSelect({
  idPrefix,
  control,
  name,
  label,
  placeholder,
  options,
  error,
}: {
  idPrefix: string;
  control: Control<Basics>;
  name: "gradMonth" | "gradYear";
  label: string;
  placeholder: string;
  options: { value: number; label: string }[];
  error: FieldErrorLike;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={`${idPrefix}-${name}`} className="sr-only">
        {label}
      </FieldLabel>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select
            value={field.value ? String(field.value) : ""}
            onValueChange={(v) => field.onChange(Number(v))}
          >
            <SelectTrigger
              id={`${idPrefix}-${name}`}
              aria-invalid={!!error}
              className="w-full"
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldError errors={[error]} />
    </Field>
  );
}

function YesNo({
  idPrefix,
  control,
  name,
  legend,
  error,
}: {
  idPrefix: string;
  control: Control<Basics>;
  name: "workAuthorized" | "needsSponsorship";
  legend: string;
  error: FieldErrorLike;
}) {
  return (
    <FieldSet data-invalid={!!error}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <RadioGroup
            value={field.value === undefined ? "" : field.value ? "yes" : "no"}
            onValueChange={(v) => field.onChange(v === "yes")}
            aria-label={legend}
            aria-invalid={!!error}
            className="flex gap-6"
          >
            {(["yes", "no"] as const).map((option) => (
              <Field key={option} orientation="horizontal" className="w-auto">
                <RadioGroupItem
                  value={option}
                  id={`${idPrefix}-${name}-${option}`}
                />
                <FieldLabel
                  htmlFor={`${idPrefix}-${name}-${option}`}
                  className="font-normal"
                >
                  {option === "yes" ? "Yes" : "No"}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        )}
      />
      <FieldError errors={[error]} />
    </FieldSet>
  );
}
