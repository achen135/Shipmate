import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { FactBank } from "@/components/facts/fact-bank";
import { FactSuggestions } from "@/components/facts/fact-suggestions";
import { getAiSettings } from "@/lib/ai/queries";
import { requireMember } from "@/lib/auth/viewer";
import { listFacts } from "@/lib/facts/queries";

import { addFact, addSuggestedFacts, deleteFact } from "./actions";

export const metadata: Metadata = { title: "Not on your resume" };

export default async function FactsPage() {
  await requireMember();
  const [facts, ai] = await Promise.all([listFacts(), getAiSettings()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Not on your resume" />
      <p className="text-sm text-muted-foreground">
        True things that didn&apos;t fit on one page. When Shipmate tailors your
        resume it may bring one of these in if a posting asks for it, and
        nothing that isn&apos;t here or on your resume.
      </p>
      {ai.mode === "ai" && (
        <FactSuggestions addSuggestedFacts={addSuggestedFacts} />
      )}
      <FactBank facts={facts} actions={{ addFact, deleteFact }} />
    </div>
  );
}
