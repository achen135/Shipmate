import { Badge } from "@/components/ui/badge";
import { statusText } from "@/lib/tracker/status";

const VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  applied: "secondary",
  oa: "secondary",
  interview: "default",
  offer: "default",
  rejected: "outline",
  withdrawn: "outline",
};

/** "Applied", "Rejected?" (unsure), … */
export function StatusBadge({
  status,
  unsure,
}: {
  status: string;
  unsure: boolean;
}) {
  return (
    <Badge
      variant={VARIANT[status] ?? "outline"}
      title={unsure ? "Not sure" : undefined}
    >
      {statusText(status, unsure)}
    </Badge>
  );
}

/** "No update in 30 days" (lib/tracker/badge.ts). */
export function StaleBadge() {
  return (
    <Badge
      variant="outline"
      className="border-warning bg-warning/20 text-warning-foreground dark:text-foreground"
    >
      No update in 30 days
    </Badge>
  );
}
