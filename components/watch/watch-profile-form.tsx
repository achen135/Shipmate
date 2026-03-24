"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { CATEGORIES } from "@/lib/postings/normalize";
import {
  type WatchProfileForm as FormValues,
  formFromPreset,
  watchProfileSchema,
} from "@/lib/schemas/watch-profile";
import { PRESETS, TERM_OPTIONS, presetById } from "@/lib/watch/presets";

/**
 * One saved search: onboarding "What to watch" and Profile. Picking a preset
 * refills the role fields (name, categories, keywords) and keeps the rest.
 */
export function WatchProfileForm({
  defaultValues,
  action,
  submitLabel,
  successMessage,
}: {
  defaultValues: FormValues;
  action: (values: FormValues) => Promise<ActionResult & { added?: number }>;
  submitLabel: string;
  /** Toast on success. Omit when the action redirects instead. */
  successMessage?: (added: number) => string;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(watchProfileSchema),
    defaultValues,
  });
  const { errors, isSubmitting } = form.formState;
  const id = useId();
  const presetId = useWatch({ control: form.control, name: "preset" });
  const preset = presetById(presetId);

  function choosePreset(next: string) {
    const current = form.getValues();
    const fresh = formFromPreset(next, current.needsSponsorship);
    const nameWasDefault =
      current.name === presetById(current.preset).label ||
      current.name === formFromPreset("custom", false).name;
    form.setValue("preset", fresh.preset);
    form.setValue("categories", fresh.categories);
    form.setValue("includeKeywords", fresh.includeKeywords);
    form.setValue("excludeKeywords", fresh.excludeKeywords);
    if (nameWasDefault || !current.name.trim())
      form.setValue("name", fresh.name);
    form.clearErrors();
  }

  async function onSubmit(values: FormValues) {
    const result = await action(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        form.setError(field as keyof FormValues, { message: messages[0] });
      }
      toast.error(result.message);
      return;
    }
    if (successMessage) toast.success(successMessage(result.added ?? 0));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Start from</FieldLegend>
          <RadioGroup
            value={presetId}
            onValueChange={choosePreset}
            aria-label="Start from"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {PRESETS.map((p) => (
              <FieldLabel
                key={p.id}
                htmlFor={`${id}-preset-${p.id}`}
                className="rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-secondary"
              >
                <RadioGroupItem
                  value={p.id}
                  id={`${id}-preset-${p.id}`}
                  className="sr-only"
                />
                {p.label}
              </FieldLabel>
            ))}
          </RadioGroup>
          <FieldDescription>{preset.description}</FieldDescription>
          {preset.note && (
            <p className="rounded-lg bg-warning/20 p-3 text-sm text-warning-foreground dark:text-foreground">
              {preset.note}
            </p>
          )}
        </FieldSet>

        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <CheckboxGroup
          idPrefix={`${id}-category`}
          control={form.control}
          name="categories"
          legend="Categories"
          description="Simplify's role categories. Any one is enough."
          options={CATEGORIES}
        />

        <Field data-invalid={!!errors.includeKeywords}>
          <FieldLabel htmlFor={`${id}-include`}>Title keywords</FieldLabel>
          <Textarea
            id={`${id}-include`}
            rows={3}
            aria-invalid={!!errors.includeKeywords}
            {...form.register("includeKeywords")}
          />
          <FieldDescription>
            Comma-separated. A title with any of these matches, whatever its
            category.
          </FieldDescription>
          <FieldError errors={[errors.includeKeywords]} />
        </Field>

        <Field data-invalid={!!errors.excludeKeywords}>
          <FieldLabel htmlFor={`${id}-exclude`}>Skip titles with</FieldLabel>
          <Input
            id={`${id}-exclude`}
            placeholder="e.g. PhD, Senior"
            aria-invalid={!!errors.excludeKeywords}
            {...form.register("excludeKeywords")}
          />
          <FieldError errors={[errors.excludeKeywords]} />
        </Field>

        <CheckboxGroup
          idPrefix={`${id}-term`}
          control={form.control}
          name="terms"
          legend="Terms"
          description="Postings with no term listed always match."
          options={TERM_OPTIONS}
          error={errors.terms}
        />

        <Field data-invalid={!!errors.locations}>
          <FieldLabel htmlFor={`${id}-locations`}>Locations</FieldLabel>
          <Input
            id={`${id}-locations`}
            placeholder="Anywhere"
            aria-invalid={!!errors.locations}
            {...form.register("locations")}
          />
          <FieldDescription>
            Comma-separated cities or states (NYC, Bay Area, TX). Leave empty
            for anywhere.
          </FieldDescription>
          <FieldError errors={[errors.locations]} />
        </Field>

        <BooleanCheckbox
          id={`${id}-remote`}
          control={form.control}
          name="remoteOk"
          label="Remote is OK"
        />
        <BooleanCheckbox
          id={`${id}-sponsorship`}
          control={form.control}
          name="needsSponsorship"
          label="I need visa sponsorship"
          description="Never hides postings. Later, it adds a warning when a posting says it won't sponsor."
        />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}

function CheckboxGroup<N extends "categories" | "terms">({
  idPrefix,
  control,
  name,
  legend,
  description,
  options,
  error,
}: {
  idPrefix: string;
  control: Control<FormValues>;
  name: N;
  legend: string;
  description: string;
  options: readonly FormValues[N][number][];
  error?: { message?: string };
}) {
  return (
    <FieldSet data-invalid={!!error}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <Controller
        control={control}
        name={name}
        render={({ field }) => {
          const selected = field.value as readonly string[];
          return (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {options.map((option, i) => (
                <Field key={option} orientation="horizontal">
                  <Checkbox
                    id={`${idPrefix}-${i}`}
                    checked={selected.includes(option)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? [...selected, option]
                          : selected.filter((v) => v !== option),
                      )
                    }
                  />
                  <FieldLabel
                    htmlFor={`${idPrefix}-${i}`}
                    className="font-normal"
                  >
                    {option}
                  </FieldLabel>
                </Field>
              ))}
            </div>
          );
        }}
      />
      <FieldError errors={[error]} />
    </FieldSet>
  );
}

function BooleanCheckbox({
  id,
  control,
  name,
  label,
  description,
}: {
  id: string;
  control: Control<FormValues>;
  name: "remoteOk" | "needsSponsorship";
  label: string;
  description?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked === true)}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={id} className="font-normal">
              {label}
            </FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </div>
        </Field>
      )}
    />
  );
}
