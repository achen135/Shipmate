import type { LucideIcon } from "lucide-react";

/** Placeholder content for a screen with nothing in it yet. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary">
        <Icon aria-hidden="true" className="size-6 text-brass" />
      </span>
      <p className="mt-4 font-heading text-xl font-semibold">{title}</p>
      <p className="mt-2 max-w-xs text-sm text-pretty text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
