"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import type { ActionResult } from "@/lib/action-result";
import { DEFAULT_HOW_HEARD } from "@/lib/questions/prefill";
import {
  DEMOGRAPHIC_TOPICS,
  type StandardAnswersInput,
  standardAnswersSchema,
} from "@/lib/schemas/standard-answers";

/**
 * Profile → Application answers: what the answer sheet copies into forms.
 * Name, school, graduation and work authorization come from Basics.
 */
export function StandardAnswersForm({
  defaultValues,
  action,
}: {
  defaultValues: StandardAnswersInput;
  action: (values: StandardAnswersInput) => Promise<ActionResult>;
}) {
  const form = useForm<StandardAnswersInput>({
    resolver: zodResolver(standardAnswersSchema),
    defaultValues,
  });
  const { errors, isSubmitting } = form.formState;
  const id = useId();

  async function onSubmit(values: StandardAnswersInput) {
    const result = await action(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(
        result.fieldErrors ?? {},
      )) {
        form.setError(field as keyof StandardAnswersInput, {
          message: messages[0],
        });
      }
      toast.error(result.message);
      return;
    }
    toast.success("Saved.");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor={`${id}-phone`}>Phone</FieldLabel>
          <Input
            id={`${id}-phone`}
            type="tel"
            autoComplete="tel"
            aria-invalid={!!errors.phone}
            {...form.register("phone")}
          />
          <FieldError errors={[errors.phone]} />
        </Field>

        {(
          [
            ["linkedin", "LinkedIn"],
            ["github", "GitHub"],
            ["portfolio", "Website or portfolio"],
          ] as const
        ).map(([name, label]) => (
          <Field key={name} data-invalid={!!errors[name]}>
            <FieldLabel htmlFor={`${id}-${name}`}>{label}</FieldLabel>
            <Input
              id={`${id}-${name}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              aria-invalid={!!errors[name]}
              {...form.register(name)}
            />
            <FieldError errors={[errors[name]]} />
          </Field>
        ))}

        <Field data-invalid={!!errors.howHeard}>
          <FieldLabel htmlFor={`${id}-how`}>
            How did you hear about us?
          </FieldLabel>
          <Input
            id={`${id}-how`}
            placeholder={DEFAULT_HOW_HEARD}
            aria-invalid={!!errors.howHeard}
            {...form.register("howHeard")}
          />
          <FieldDescription>
            Used when an application asks. Left blank, it says &ldquo;
            {DEFAULT_HOW_HEARD}&rdquo;.
          </FieldDescription>
          <FieldError errors={[errors.howHeard]} />
        </Field>

        <FieldSet>
          <FieldLegend variant="label">
            Optional demographic questions
          </FieldLegend>
          <FieldDescription>
            Applications may ask these. Leave them blank and Shipmate suggests
            &ldquo;decline to answer&rdquo;. It never fills one in for you.
          </FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            {DEMOGRAPHIC_TOPICS.map(({ key, label }) => (
              <Field key={key}>
                <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                <Input
                  id={`${id}-${key}`}
                  placeholder="Decline to answer"
                  {...form.register(`demographics.${key}`)}
                />
              </Field>
            ))}
          </div>
        </FieldSet>

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </FieldGroup>
    </form>
  );
}
