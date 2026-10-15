"use client";

import { Puzzle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CopyButton } from "@/components/review/copy-button";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * Connect / disconnect Shipmate Autofill. The token is shown once, right
 * after connecting; after that the page only says it's connected.
 */
export function ConnectExtension({
  connected,
  appOrigin,
  actions,
}: {
  connected: { connectedAt: string; lastUsedAt: string | null } | null;
  appOrigin: string;
  actions: {
    connect: () => Promise<
      { ok: true; token: string } | { ok: false; message: string }
    >;
    disconnect: () => Promise<ActionResult>;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState<string | null>(null);

  function connect() {
    startTransition(async () => {
      const result = await actions.connect();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setToken(result.token);
      router.refresh();
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = await actions.disconnect();
      if (!result.ok) toast.error(result.message);
      setToken(null);
      router.refresh();
    });
  }

  if (token) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="font-medium">Paste this into the extension</p>
        <p className="text-sm text-muted-foreground">
          Open the extension&apos;s settings (right-click its icon → Options),
          paste this key, and save. Shipmate shows it only now: if you lose it,
          connect again.
        </p>
        <div className="flex items-center gap-2">
          <code
            data-testid="extension-token"
            className="min-w-0 flex-1 rounded bg-muted px-2 py-1 text-xs break-all"
          >
            {token}
          </code>
          <CopyButton value={token} label="extension key" />
        </div>
        <p className="text-sm text-muted-foreground">
          Shipmate address for the settings: <code>{appOrigin}</code>
        </p>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="flex items-center gap-2 font-medium">
          <Puzzle aria-hidden="true" className="size-4" />
          Connected
        </p>
        <p className="text-sm text-muted-foreground">
          {connected.lastUsedAt
            ? `Last used ${new Date(connected.lastUsedAt).toLocaleString()}.`
            : "Not used yet."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={disconnect}
          >
            Disconnect
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={connect}
          >
            Connect again (new key)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm">
        Not connected. Connecting makes a key for the extension. It can read
        only what it needs to fill an application in your Inbox, and record that
        you submitted it; disconnecting stops it at once.
      </p>
      <div>
        <Button size="sm" disabled={pending} onClick={connect}>
          Connect the extension
        </Button>
      </div>
    </div>
  );
}
