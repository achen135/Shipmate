import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Summary = {
  id: string;
  name: string;
  categories: string[];
  include_keywords: string[];
  terms: string[];
  locations: string[];
  remote_ok: boolean;
};

function describe(profile: Summary): string {
  const role =
    profile.categories.length > 0
      ? profile.categories.join(", ")
      : `${profile.include_keywords.length} keyword${profile.include_keywords.length === 1 ? "" : "s"}`;
  const where =
    profile.locations.length > 0
      ? `${profile.locations.join(", ")}${profile.remote_ok ? " + remote" : ""}`
      : "anywhere";
  return `${role} · ${profile.terms.join(", ")} · ${where}`;
}

/** Profile's "What you're watching" section. */
export function WatchProfileList({ profiles }: { profiles: Summary[] }) {
  return (
    <div className="flex flex-col gap-3">
      {profiles.length > 0 && (
        <ul
          aria-label="Your searches"
          className="divide-y rounded-xl border bg-card"
        >
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Link
                href={`/profile/watch/${profile.id}`}
                className="flex items-center gap-3 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{profile.name}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {describe(profile)}
                  </p>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {profiles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Badge variant="outline">Paused</Badge> No searches yet, so nothing
          new will reach your Inbox.
        </p>
      )}
      <Button asChild variant="outline" className="self-start">
        <Link href="/profile/watch/new">
          <Plus aria-hidden="true" />
          Add a search
        </Link>
      </Button>
    </div>
  );
}
