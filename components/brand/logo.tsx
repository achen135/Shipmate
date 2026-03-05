import { Anchor } from "lucide-react";

import { cn } from "@/lib/utils";

/** The small anchor mark: brass on navy. Decorative; the wordmark carries the name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg bg-navy text-brass",
        className,
      )}
    >
      <Anchor className="size-[60%]" strokeWidth={2.25} />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-heading text-xl font-semibold tracking-tight">
        ShipMate
      </span>
    </span>
  );
}
