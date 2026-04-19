"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/** Continue / Skip for steps whose content saves as you go. */
export function ContinueButton({
  action,
  label,
  variant = "default",
}: {
  action: () => Promise<ActionResult>;
  label: string;
  variant?: "default" | "outline";
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (result && !result.ok) toast.error(result.message);
        })
      }
    >
      {label}
    </Button>
  );
}
