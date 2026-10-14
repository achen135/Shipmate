import type { Metadata } from "next";
import Link from "next/link";

import { AiSettings } from "@/components/ai/ai-settings";
import { PageHeader } from "@/components/app/page-header";
import { getAiSettings } from "@/lib/ai/queries";
import { requireMember } from "@/lib/auth/viewer";

import { removeKey, saveAiSettings, saveKey, setMode } from "./actions";

export const metadata: Metadata = { title: "AI" };

export default async function AiPage() {
  await requireMember();
  const settings = await getAiSettings();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="AI" />
      <p className="text-sm text-muted-foreground">
        In AI mode, Shipmate reads your resume into an editable layout and
        tailors it to each posting, using only what&apos;s true on your resume
        and in your profile. It runs on a shared free AI unless you add a key of
        your own. In Simple mode your PDF is used as it is.
      </p>
      <AiSettings
        {...settings}
        actions={{ saveKey, removeKey, setMode, saveAiSettings }}
      />
      {settings.mode === "ai" && (
        <p className="text-sm">
          Next:{" "}
          <Link href="/profile/resume" className="underline underline-offset-2">
            your structured resume
          </Link>{" "}
          and{" "}
          <Link href="/profile/facts" className="underline underline-offset-2">
            what&apos;s not on your resume
          </Link>
          .
        </p>
      )}
    </div>
  );
}
