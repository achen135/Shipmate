"use client";

import { Plus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { followExistingCompany } from "@/app/(app)/profile/companies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Result = { id: string; name: string; followed: boolean };

function ResultRow({ company }: { company: Result }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-3 p-4">
      <p className="min-w-0 flex-1 truncate font-medium">{company.name}</p>
      {company.followed ? (
        <Badge variant="secondary">Following</Badge>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Follow ${company.name}`}
          onClick={() =>
            startTransition(async () => {
              const result = await followExistingCompany(company.id);
              if (result.ok) toast.success(`Following ${company.name}.`);
              else toast.error(result.message);
            })
          }
        >
          <Plus aria-hidden="true" />
          Follow
        </Button>
      )}
    </li>
  );
}

export function CompanyResults({ results }: { results: Result[] }) {
  return (
    <ul
      aria-label="Search results"
      className="divide-y rounded-xl border bg-card"
    >
      {results.map((company) => (
        <ResultRow key={company.id} company={company} />
      ))}
    </ul>
  );
}
