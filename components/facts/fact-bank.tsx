"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { ActionResult } from "@/lib/action-result";
import {
  FACT_KIND_HINTS,
  FACT_KIND_LABELS,
  FACT_KINDS,
  type Fact,
  type FactInput,
  factInputSchema,
} from "@/lib/schemas/fact-bank";

export type FactActions = {
  addFact: (values: FactInput) => Promise<ActionResult>;
  deleteFact: (id: string) => Promise<ActionResult>;
};

/** "Anything not on your resume?": the list, grouped by kind, and an add form. */
export function FactBank({
  facts,
  actions,
}: {
  facts: Fact[];
  actions: FactActions;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AddFactForm addFact={actions.addFact} />
      {facts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Add skills, projects, courses, clubs or awards that
          are true but didn&apos;t fit on one page.
        </p>
      ) : (
        FACT_KINDS.filter((kind) => facts.some((f) => f.kind === kind)).map(
          (kind) => (
            <section key={kind} aria-label={FACT_KIND_LABELS[kind]}>
              <h3 className="text-sm font-medium text-muted-foreground">
                {FACT_KIND_LABELS[kind]}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {facts
                  .filter((f) => f.kind === kind)
                  .map((fact) => (
                    <FactRow
                      key={fact.id}
                      fact={fact}
                      deleteFact={actions.deleteFact}
                    />
                  ))}
              </ul>
            </section>
          ),
        )
      )}
    </div>
  );
}

function FactRow({
  fact,
  deleteFact,
}: {
  fact: Fact;
  deleteFact: FactActions["deleteFact"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="break-words">{fact.text}</p>
        {fact.detail && (
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {fact.detail}
          </p>
        )}
        {fact.source === "imported" && (
          <Badge variant="secondary" className="mt-2">
            From your CV
          </Badge>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Delete ${fact.text}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteFact(fact.id);
            if (!result.ok) toast.error(result.message);
            else router.refresh();
          })
        }
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddFactForm({ addFact }: { addFact: FactActions["addFact"] }) {
  const id = useId();
  const router = useRouter();
  const form = useForm<FactInput>({
    resolver: zodResolver(factInputSchema),
    defaultValues: { kind: "skill", text: "", detail: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const kind = useWatch({ control: form.control, name: "kind" });

  async function onSubmit(values: FactInput) {
    const result = await addFact(values);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    form.reset({ kind: values.kind, text: "", detail: "" });
    router.refresh();
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="rounded-xl border bg-card p-4"
    >
      <FieldGroup>
        <Controller
          control={form.control}
          name="kind"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${id}-kind`}>Kind</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={`${id}-kind`} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {FACT_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Field data-invalid={!!errors.text}>
          <FieldLabel htmlFor={`${id}-text`}>What is it?</FieldLabel>
          <Input
            id={`${id}-text`}
            placeholder={FACT_KIND_HINTS[kind]}
            aria-invalid={!!errors.text}
            {...form.register("text")}
          />
          <FieldError errors={[errors.text]} />
        </Field>
        <Field data-invalid={!!errors.detail}>
          <FieldLabel htmlFor={`${id}-detail`}>
            Details{" "}
            <span className="font-normal text-muted-foreground">
              (optional: what you did, tools, numbers)
            </span>
          </FieldLabel>
          <Input
            id={`${id}-detail`}
            aria-invalid={!!errors.detail}
            {...form.register("detail")}
          />
          <FieldError errors={[errors.detail]} />
        </Field>
        <div>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
