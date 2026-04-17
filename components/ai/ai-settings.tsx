"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import type { ActionResult } from "@/lib/action-result";
import {
  MODELS,
  PRICES_CHECKED,
  costUsd,
  estimateStep,
  formatUsd,
} from "@/lib/ai/models";
import { PROVIDER_LABELS, PROVIDERS, type ProviderName } from "@/lib/ai/types";
import {
  type AiSettingsInput,
  aiSettingsSchema,
} from "@/lib/schemas/ai-settings";

type SavedKey = { provider: ProviderName; last4: string; addedOn: string };

type SaveKeyResult =
  | { ok: true; last4: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type AiActions = {
  saveKey: (values: {
    provider: ProviderName;
    apiKey: string;
  }) => Promise<SaveKeyResult>;
  removeKey: () => Promise<ActionResult>;
  setMode: (mode: "simple" | "ai") => Promise<ActionResult>;
  saveAiSettings: (values: AiSettingsInput) => Promise<ActionResult>;
};

const KEY_PAGES: Record<ProviderName, { href: string; where: string }> = {
  anthropic: {
    href: "https://platform.claude.com/",
    where: "the Claude Console, under API keys",
  },
  openai: {
    href: "https://platform.openai.com/api-keys",
    where: "the OpenAI dashboard, under API keys",
  },
};

/**
 * Profile → AI. Without a key: what AI mode costs and sends, then the key
 * form (tested before it's saved). With one: which key, the mode switch,
 * and the daily cap.
 */
export function AiSettings({
  savedKey,
  mode,
  dailyCap,
  autoTailor,
  actions,
}: {
  savedKey: SavedKey | null;
  mode: "simple" | "ai";
  dailyCap: number;
  autoTailor: boolean;
  actions: AiActions;
}) {
  const [provider, setProvider] = useState<ProviderName>(
    savedKey?.provider ?? "anthropic",
  );

  if (!savedKey) {
    return (
      <div className="flex flex-col gap-6">
        <CostExplainer
          provider={provider}
          onProviderChange={setProvider}
          dailyCap={dailyCap}
        />
        <KeyForm provider={provider} saveKey={actions.saveKey} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <KeyStatus savedKey={savedKey} mode={mode} actions={actions} />
      <CapForm
        dailyCap={dailyCap}
        autoTailor={autoTailor}
        provider={savedKey.provider}
        save={actions.saveAiSettings}
      />
      <p className="text-sm text-muted-foreground">
        Spent today: $0.00. Tailoring starts in the next update.
      </p>
    </div>
  );
}

function CostExplainer({
  provider,
  onProviderChange,
  dailyCap,
}: {
  provider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  dailyCap: number;
}) {
  const id = useId();
  const label = PROVIDER_LABELS[provider];
  const importCost = estimateStep(provider, "import");
  const tailorCost = estimateStep(provider, "tailor");
  const models = MODELS[provider];

  return (
    <div className="flex flex-col gap-4">
      <FieldSet>
        <FieldLegend variant="label">Which AI company?</FieldLegend>
        <RadioGroup
          value={provider}
          onValueChange={(value) => onProviderChange(value as ProviderName)}
          className="flex flex-wrap gap-4"
          aria-label="AI provider"
        >
          {PROVIDERS.map((option) => (
            <Field key={option} orientation="horizontal" className="w-auto">
              <RadioGroupItem value={option} id={`${id}-${option}`} />
              <FieldLabel htmlFor={`${id}-${option}`} className="font-normal">
                {PROVIDER_LABELS[option]}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>

      <div className="rounded-xl border bg-card p-4 text-sm">
        <h3 className="font-medium">What it costs</h3>
        <p className="mt-1 text-muted-foreground">
          You pay {label} directly with your own key. Shipmate never bills you.
          Rough prices (checked {PRICES_CHECKED}):
        </p>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt>Reading your resume into Shipmate (once)</dt>
          <dd className="text-right tabular-nums">
            {formatUsd(importCost.low)}–{formatUsd(importCost.high)}
          </dd>
          <dt>Tailoring one posting (starts in the next update)</dt>
          <dd className="text-right tabular-nums">
            {formatUsd(tailorCost.low)}–{formatUsd(tailorCost.high)}
          </dd>
          <dt>Most in one day, at your cap of {dailyCap} postings</dt>
          <dd className="text-right tabular-nums">
            about {formatUsd(tailorCost.high * dailyCap)}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Models: {models.fast.label} for reading and scoring (
          {formatUsd(costUsd(provider, "fast", 1_000_000, 0))} per million
          tokens in, {formatUsd(costUsd(provider, "fast", 0, 1_000_000))} out),{" "}
          {models.strong.label} for editing (
          {formatUsd(costUsd(provider, "strong", 1_000_000, 0))} in,{" "}
          {formatUsd(costUsd(provider, "strong", 0, 1_000_000))} out). A long
          posting or a two-page resume costs more.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 text-sm">
        <h3 className="font-medium">What gets sent to {label}</h3>
        <p className="mt-1 text-muted-foreground">
          The text of your resume (including the contact details on it) when you
          import it. Later, for each posting you tailor: your resume, your
          &ldquo;not on my resume&rdquo; entries, and the posting&apos;s text.
          Nothing else: not your answers, your Tracker, or your notes.
        </p>
      </div>
    </div>
  );
}

function KeyForm({
  provider,
  saveKey,
}: {
  provider: ProviderName;
  saveKey: AiActions["saveKey"];
}) {
  const id = useId();
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = PROVIDER_LABELS[provider];
  const page = KEY_PAGES[provider];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveKey({ provider, apiKey });
      if (!result.ok) {
        setError(result.fieldErrors?.apiKey?.[0] ?? result.message);
        return;
      }
      setApiKey("");
      toast.success(`Key works. AI mode is on.`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-key`}>{label} API key</FieldLabel>
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            aria-invalid={!!error}
            placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          />
          <FieldDescription>
            Make one in{" "}
            <a
              href={page.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {page.where}
            </a>
            . Shipmate checks it with one free call, then encrypts it. It is
            never shown again, only its last four characters.
          </FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <div>
          <Button type="submit" disabled={pending || apiKey.trim() === ""}>
            <KeyRound aria-hidden="true" />
            {pending ? "Checking the key…" : "Check and save"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function KeyStatus({
  savedKey,
  mode,
  actions,
}: {
  savedKey: SavedKey;
  mode: "simple" | "ai";
  actions: AiActions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = PROVIDER_LABELS[savedKey.provider];

  function run(action: () => Promise<ActionResult>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <KeyRound
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium" data-testid="saved-key">
            {label} key ending {savedKey.last4}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Added {savedKey.addedOn}.{" "}
            {mode === "ai"
              ? "AI mode is on."
              : "AI mode is off: Shipmate uses your PDF as it is."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {mode === "ai" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => actions.setMode("simple"), "Switched to Simple mode.")
            }
          >
            Switch to Simple
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => actions.setMode("ai"), "AI mode is on.")}
          >
            Use AI mode
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(actions.removeKey, "Key removed.")}
        >
          Remove key
        </Button>
      </div>
    </div>
  );
}

function CapForm({
  dailyCap,
  autoTailor,
  provider,
  save,
}: {
  dailyCap: number;
  autoTailor: boolean;
  provider: ProviderName;
  save: AiActions["saveAiSettings"];
}) {
  const id = useId();
  const form = useForm<AiSettingsInput>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: { dailyCap, autoTailor },
  });
  const { errors, isSubmitting } = form.formState;
  const cap =
    Number(useWatch({ control: form.control, name: "dailyCap" })) || 0;
  const worstDay = estimateStep(provider, "tailor").high * cap;

  async function onSubmit(values: AiSettingsInput) {
    const result = await save(values);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Saved.");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.dailyCap}>
          <FieldLabel htmlFor={`${id}-cap`}>Daily cap</FieldLabel>
          <Input
            id={`${id}-cap`}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className="w-28"
            aria-invalid={!!errors.dailyCap}
            {...form.register("dailyCap")}
          />
          <FieldDescription>
            At most this many tailored postings a day
            {cap > 0 ? `, about ${formatUsd(worstDay)} at most` : ""}.
          </FieldDescription>
          <FieldError errors={[errors.dailyCap]} />
        </Field>
        <Controller
          control={form.control}
          name="autoTailor"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-auto`}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${id}-auto`} className="font-normal">
                  Tailor every new match automatically
                </FieldLabel>
                <FieldDescription>
                  Off: you press &ldquo;Tailor this&rdquo; on the postings you
                  want. Starts in the next update.
                </FieldDescription>
              </div>
            </Field>
          )}
        />
        <div>
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            Save
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
