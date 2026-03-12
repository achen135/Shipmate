import { LockKeyhole } from "lucide-react";

import { cn } from "@/lib/utils";

/** Shown at sign-up (Spec "Data model", plain-English version). */
export function PrivacyNote({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Privacy"
      className={cn(
        "rounded-xl border bg-card p-4 text-sm text-muted-foreground",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 font-medium text-foreground">
        <LockKeyhole aria-hidden="true" className="size-4" />
        Your data
      </h2>
      <p className="mt-2">
        Your tracker, resume, and settings are private to you. Other users
        can&apos;t see them; the database itself enforces that.
      </p>
      <p className="mt-2">
        One caveat: Alex, who runs ShipMate, can see all data in the database
        dashboard and holds the master key that encrypts saved AI keys.
      </p>
    </aside>
  );
}
