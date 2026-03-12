"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { revokeInvite } from "./actions";

export function RevokeButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeInvite(id);
          if (result.ok) toast.success("Code revoked.");
          else toast.error(result.message);
        })
      }
    >
      {pending ? "Revoking…" : "Revoke"}
    </Button>
  );
}
