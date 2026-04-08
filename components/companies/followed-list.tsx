"use client";

import { Star, UserMinus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { setPriority, unfollow } from "@/app/(app)/profile/companies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOARD_LABELS } from "@/lib/follows/detect";
import type { FollowedCompany } from "@/lib/follows/queries";

function boardLabel(company: FollowedCompany): string | null {
  const kind = company.boardKind as keyof typeof BOARD_LABELS | null;
  return kind && kind in BOARD_LABELS ? BOARD_LABELS[kind] : null;
}

function Row({ company }: { company: FollowedCompany }) {
  const [pending, startTransition] = useTransition();
  const board = boardLabel(company);

  function run(action: () => ReturnType<typeof unfollow>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.message);
    });
  }

  return (
    <li data-testid="followed-company" className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{company.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {board ? (
            <>
              <Badge variant="secondary">{board}</Badge>
              <span className="truncate">{company.boardRef}</span>
            </>
          ) : (
            <span>
              Through job lists only. Paste their careers link to watch their
              board.
            </span>
          )}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-pressed={company.priority}
        aria-label={`Priority: ${company.name}`}
        onClick={() =>
          run(() => setPriority(company.companyId, !company.priority))
        }
      >
        <Star
          aria-hidden="true"
          className={company.priority ? "fill-brass text-brass" : undefined}
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={`Unfollow ${company.name}`}
        onClick={() => run(() => unfollow(company.companyId))}
      >
        <UserMinus aria-hidden="true" />
      </Button>
    </li>
  );
}

/** The companies you follow, priority first. */
export function FollowedList({ companies }: { companies: FollowedCompany[] }) {
  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing followed yet. Paste a careers page below, or search for a
        company.
      </p>
    );
  }
  return (
    <ul
      aria-label="Followed companies"
      className="divide-y rounded-xl border bg-card"
    >
      {companies.map((company) => (
        <Row key={company.companyId} company={company} />
      ))}
    </ul>
  );
}
