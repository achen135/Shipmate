"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Sparkles } from "lucide-react";
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
import {
  PROVIDER_LABELS,
  PROVIDERS,
  type ProviderName,
  type SharedQuotaLine,
} from "@/lib/ai/types";
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
  google: {
    href: "https://aistudio.google.com/app/apikey",
    where: "Google AI Studio, under Get API key",
  },
};

const PLACEHOLDERS: Record<ProviderName, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  google: "AIza… or AQ.…",
};

/**
 * Profile → AI. AI mode works for everyone on Shipmate's shared free Gemini
 * key; a key of your own is optional (your own quota, or a paid model).
 * Shows: the mode and which key is in use, the daily cap, then your own key
 * (its status, or what one costs and the form to add it).
 */
export function AiSettings({
  savedKey,
  mode,
  dailyCap,
  autoTailor,
  usedToday,
  sharedQuota,
  actions,
}: {
  savedKey: SavedKey | null;
  mode: "simple" | "ai";
  dailyCap: number;
  autoTailor: boolean;
  usedToday: { count: number; cost: number };
  /** Today's calls on the shared key; null with a key of your own. */
  sharedQuota: SharedQuotaLine[] | null;
  actions: AiActions;
}) {
  const [provider, setProvider] = useState<ProviderName>(
    savedKey?.provider ?? "google",
  );

  return (
    <div className="flex flex-col gap-6">
      <ModeStatus savedKey={savedKey} mode={mode} setMode={actions.setMode} />
      {mode === "ai" && !savedKey && <OwnKeyNudge />}
      {mode === "ai" && sharedQuota && <SharedQuota lines={sharedQuota} />}
      <CapForm
        dailyCap={dailyCap}
        autoTailor={autoTailor}
        provider={savedKey?.provider ?? null}
        save={actions.saveAiSettings}
      />
      {mode === "ai" && (
        <p className="text-sm text-muted-foreground" data-testid="used-today">
          Today: {usedToday.count} of {dailyCap} tailored
          {usedToday.cost > 0 ? `, about ${formatUsd(usedToday.cost)}` : ""}.
          The count resets at midnight Eastern.
        </p>
      )}
      <section
        id="own-key"
        aria-labelledby="own-key-heading"
        className="flex scroll-mt-4 flex-col gap-4"
      >
        <h3 id="own-key-heading" className="font-medium">
          Your own key{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </h3>
        {savedKey ? (
          <KeyStatus savedKey={savedKey} removeKey={actions.removeKey} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The shared key is free but busy at times, and it&apos;s shared by
              everyone. Your own key gives you your own limits, and with
              Anthropic or OpenAI, a paid model.
            </p>
            <CostExplainer
              provider={provider}
              onProviderChange={setProvider}
              dailyCap={dailyCap}
            />
            <KeyForm provider={provider} saveKey={actions.saveKey} />
          </>
        )}
      </section>
      <WhatGetsSent provider={savedKey?.provider ?? null} />
    </div>
  );
}

/**
 * On the shared key: say plainly that a key of their own is the better
 * default, and how to get a free one (Fix Handoff "shared key quota" §2).
 * The shared key's Flash quota is 20 requests a day for everyone, so this
 * is the real next step, not a footnote. The steps are the ones Alex used
 * to make the shared key (M7 Handoff §3).
 */
function OwnKeyNudge() {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm"
      data-testid="own-key-nudge"
    >
      <p className="font-medium">
        You&apos;re using Shipmate&apos;s shared free key
      </p>
      <p className="text-muted-foreground">
        Everyone shares its daily limit, so tailoring can wait a while. For
        faster, more reliable results, add your own free Google Gemini key:
        about 2 minutes, still $0.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          Go to{" "}
          <a
            href={KEY_PAGES.google.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Google AI Studio
          </a>{" "}
          and sign in with your Google account.
        </li>
        <li>
          Click <strong>Get API key</strong>, then{" "}
          <strong>Create API key</strong>.
        </li>
        <li>
          Pick <strong>Create API key in new project</strong> (or a project with
          no billing). Google&apos;s free use depends on billing being off for
          that project.
        </li>
        <li>
          Copy the key and paste it under{" "}
          <a href="#own-key" className="underline underline-offset-2">
            Your own key
          </a>{" "}
          below, with Google Gemini picked.
        </li>
      </ol>
    </div>
  );
}

/**
 * How much of the shared key's free daily limit is spent, so nobody finds
 * out by hitting "Tailor this" and being told to wait. Everyone's calls
 * count, not just yours. Google's day ends at midnight Pacific.
 */
function SharedQuota({ lines }: { lines: SharedQuotaLine[] }) {
  return (
    <div
      className="rounded-xl border bg-card p-4 text-sm"
      data-testid="shared-quota"
    >
      <h3 className="font-medium">Shared AI used today</h3>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li key={line.label} className="flex justify-between gap-4">
            <span>{line.label}</span>
            <span className="tabular-nums">
              {line.used} of {line.perDay}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Shared by everyone on Shipmate, so the count is everyone&apos;s, not
        just yours. It resets at midnight Pacific. When Gemini 3.8 Flash runs
        out, tailoring uses the backup model.
      </p>
    </div>
  );
}

function ModeStatus({
  savedKey,
  mode,
  setMode,
}: {
  savedKey: SavedKey | null;
  mode: "simple" | "ai";
  setMode: AiActions["setMode"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const using = savedKey
    ? `your ${PROVIDER_LABELS[savedKey.provider]} key ending ${savedKey.last4}`
    : "Shipmate's shared free AI (Google Gemini). Nothing to set up";

  function toggle() {
    const next = mode === "ai" ? "simple" : "ai";
    startTransition(async () => {
      const result = await setMode(next);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        next === "ai" ? "AI mode is on." : "Switched to Simple mode.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Sparkles
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium" data-testid="ai-mode">
            {mode === "ai" ? "AI mode is on" : "AI mode is off"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "ai"
              ? `Using ${using}.`
              : "Simple mode: Shipmate uses your PDF as it is and doesn't tailor it."}
          </p>
        </div>
      </div>
      <div>
        <Button size="sm" variant="outline" disabled={pending} onClick={toggle}>
          {mode === "ai" ? "Switch to Simple" : "Use AI mode"}
        </Button>
      </div>
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
  const oneModel = models.fast.id === models.strong.id;
  const price = (tier: "fast" | "strong") =>
    `${formatUsd(costUsd(provider, tier, 1_000_000, 0))} per million tokens in, ${formatUsd(costUsd(provider, tier, 0, 1_000_000))} out`;

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
        <h4 className="font-medium">What it costs</h4>
        <p className="mt-1 text-muted-foreground">
          {provider === "google"
            ? "Free if billing is off on your Google project (you get Google's free limits to yourself). With billing on, you pay Google directly, roughly:"
            : `You pay ${label} directly with your own key. Shipmate never bills you. Rough prices (checked ${PRICES_CHECKED}):`}
        </p>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt>Reading your resume into Shipmate (once)</dt>
          <dd className="text-right tabular-nums">
            {formatUsd(importCost.low)}–{formatUsd(importCost.high)}
          </dd>
          <dt>Tailoring one posting</dt>
          <dd className="text-right tabular-nums">
            {formatUsd(tailorCost.low)}–{formatUsd(tailorCost.high)}
          </dd>
          <dt>Most in one day, at your cap of {dailyCap} postings</dt>
          <dd className="text-right tabular-nums">
            about {formatUsd(tailorCost.high * dailyCap)}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {oneModel
            ? `Model: ${models.fast.label} (${price("fast")}).`
            : `Models: ${models.fast.label} for reading and notes (${price("fast")}), ${models.strong.label} for scoring and editing (${price("strong")}).`}{" "}
          A long posting or a two-page resume costs more.
        </p>
      </div>
    </div>
  );
}

function WhatGetsSent({ provider }: { provider: ProviderName | null }) {
  const label = provider ? PROVIDER_LABELS[provider] : "Google";
  return (
    <div className="rounded-xl border bg-card p-4 text-sm">
      <h3 className="font-medium">What gets sent to {label}</h3>
      <p className="mt-1 text-muted-foreground">
        The text of your resume (including the contact details on it) when you
        import it. For each posting you tailor: your resume, your &ldquo;not on
        my resume&rdquo; entries, and the posting&apos;s text. Nothing else: not
        your answers, your Tracker, or your notes.
      </p>
      {(provider === null || provider === "google") && (
        <p className="mt-2 text-muted-foreground">
          {provider === null
            ? "The shared key is on Google's free tier, and Google says it may use what's sent on the free tier to improve its products. If you'd rather it didn't, add your own paid key, or use Simple mode."
            : "On Google's free tier (billing off), Google says it may use what's sent to improve its products. With billing on, it says it doesn't."}
        </p>
      )}
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
      toast.success("Key works. AI mode is on, with your key.");
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
            placeholder={PLACEHOLDERS[provider]}
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
  removeKey,
}: {
  savedKey: SavedKey;
  removeKey: AiActions["removeKey"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = PROVIDER_LABELS[savedKey.provider];

  function remove() {
    startTransition(async () => {
      const result = await removeKey();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Key removed. Back on the shared free AI.");
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
            Added {savedKey.addedOn}. Remove it and Shipmate goes back to the
            shared free AI.
          </p>
        </div>
      </div>
      <div>
        <Button size="sm" variant="ghost" disabled={pending} onClick={remove}>
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
  /** Their own key's provider, or null on the shared free key. */
  provider: ProviderName | null;
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
  const worstDay = provider ? estimateStep(provider, "tailor").high * cap : 0;

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
            {cap > 0 && provider
              ? `, about ${formatUsd(worstDay)} at most`
              : cap > 0
                ? ", $0 on the shared free AI"
                : ""}
            .
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
                  want.
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
