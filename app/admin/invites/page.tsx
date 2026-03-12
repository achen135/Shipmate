import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/viewer";
import { formatInviteCode } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";

import { CopyInviteButton } from "./copy-invite-button";
import { CreateInviteForm } from "./create-invite-form";
import { RevokeButton } from "./revoke-button";

export const metadata: Metadata = { title: "Invites" };

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(iso: string) {
  return DATE.format(new Date(iso));
}

export default async function InvitesPage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data: invites, error } = await supabase
    .from("invites")
    .select("id, code, note, created_at, used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`invites: ${error.message}`);

  const available = invites.filter((i) => !i.used_at && !i.revoked_at).length;

  return (
    <>
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Invites
        </h1>
        <p className="mt-2 text-muted-foreground">
          Each code works once. {available} available, {invites.length} total.
        </p>
      </div>

      <CreateInviteForm />

      {invites.length > 0 && (
        <ul
          aria-label="Invite codes"
          className="divide-y rounded-xl border bg-card"
        >
          {invites.map((invite) => {
            const status = invite.used_at
              ? "used"
              : invite.revoked_at
                ? "revoked"
                : "available";
            return (
              <li
                key={invite.id}
                data-testid="invite-row"
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span
                      className={
                        status === "available"
                          ? "font-mono font-semibold"
                          : "font-mono text-muted-foreground line-through"
                      }
                    >
                      {formatInviteCode(invite.code)}
                    </span>
                    <Badge
                      variant={status === "available" ? "secondary" : "outline"}
                    >
                      {status === "used"
                        ? `Used ${formatDate(invite.used_at!)}`
                        : status === "revoked"
                          ? "Revoked"
                          : "Available"}
                    </Badge>
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {invite.note || "No note"} · created{" "}
                    {formatDate(invite.created_at)}
                  </p>
                </div>
                {status === "available" && (
                  <div className="flex gap-2">
                    <CopyInviteButton code={invite.code} />
                    <RevokeButton id={invite.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
