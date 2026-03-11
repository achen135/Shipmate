"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Copies a sign-in link with the code prefilled. */
export function CopyInviteButton({ code }: { code: string }) {
  async function copy() {
    const link = `${window.location.origin}/sign-in?invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy. Select the code instead.");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Copy aria-hidden="true" />
      Copy link
    </Button>
  );
}
