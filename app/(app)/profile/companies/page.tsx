import { Search } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { CompanyResults } from "@/components/companies/company-results";
import { FollowByLink } from "@/components/companies/follow-by-link";
import { FollowedList } from "@/components/companies/followed-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireMember } from "@/lib/auth/viewer";
import {
  MIN_SEARCH,
  listFollowed,
  searchCompanies,
} from "@/lib/follows/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireMember();
  const { q: rawQuery } = await searchParams;
  const query =
    (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? "";

  const supabase = await createClient();
  const [followed, found] = await Promise.all([
    listFollowed(supabase),
    searchCompanies(supabase, query),
  ]);
  const followedIds = new Set(followed.map((c) => c.companyId));
  const results = found.map((c) => ({
    ...c,
    followed: followedIds.has(c.id),
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Companies" />

      <section
        aria-labelledby="followed-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="followed-heading" className="text-lg font-medium">
          Followed companies
        </h2>
        <p className="text-sm text-muted-foreground">
          Shipmate checks a followed company&apos;s own careers page every 30
          minutes, on top of the shared job lists. The star marks your
          priorities.
        </p>
        <FollowedList companies={followed} />
      </section>

      <section aria-labelledby="link-heading" className="flex flex-col gap-4">
        <h2 id="link-heading" className="text-lg font-medium">
          Follow by careers page
        </h2>
        <FollowByLink />
      </section>

      <section aria-labelledby="search-heading" className="flex flex-col gap-4">
        <h2 id="search-heading" className="text-lg font-medium">
          Find a company
        </h2>
        <form role="search" className="flex gap-2">
          <Input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search companies Shipmate knows"
            aria-label="Search companies"
            autoComplete="off"
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
        {query.length > 0 && query.length < MIN_SEARCH && (
          <p className="text-sm text-muted-foreground">
            Type at least {MIN_SEARCH} letters.
          </p>
        )}
        {query.length >= MIN_SEARCH && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No company matches &ldquo;{query}&rdquo;. Paste their careers page
            above instead.
          </p>
        )}
        {results.length > 0 && <CompanyResults results={results} />}
      </section>
    </div>
  );
}
