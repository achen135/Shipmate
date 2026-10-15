import type { Metadata } from "next";
import { headers } from "next/headers";

import { PageHeader } from "@/components/app/page-header";
import { ConnectExtension } from "@/components/extension/connect-extension";
import { requireMember } from "@/lib/auth/viewer";
import { getExtensionConnection } from "@/lib/extension/queries";

import { connectExtension, disconnectExtension } from "./actions";

export const metadata: Metadata = { title: "Browser extension" };

export default async function ExtensionPage() {
  await requireMember();
  const [connected, list] = await Promise.all([
    getExtensionConnection(),
    headers(),
  ]);
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const proto =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Browser extension" />
      <p className="text-sm text-muted-foreground">
        Shipmate Autofill fills Greenhouse, Lever and Ashby application forms
        with your answers and attaches your resume (the tailored one, if there
        is one). It never clicks Submit and never answers &ldquo;are you a
        robot&rdquo; questions: you check everything and submit it yourself.
        Open a posting&apos;s Apply button in Shipmate and it fills straight
        away; anywhere else, click its icon.
      </p>
      <ConnectExtension
        connected={connected}
        appOrigin={`${proto}://${host}`}
        actions={{ connect: connectExtension, disconnect: disconnectExtension }}
      />
      <p className="text-xs text-muted-foreground">
        Chrome only for now, loaded from its folder (chrome://extensions →
        Developer mode → Load unpacked). Workday forms aren&apos;t supported:
        each company&apos;s is different.
      </p>
    </div>
  );
}
