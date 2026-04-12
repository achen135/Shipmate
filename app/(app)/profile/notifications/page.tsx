import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { PushSettings } from "@/components/notifications/push-settings";
import { requireMember } from "@/lib/auth/viewer";
import { readNotifyPrefs } from "@/lib/notify/prefs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireMember();
  const supabase = await createClient();
  const [devices, profile] = await Promise.all([
    supabase
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("notify_prefs").maybeSingle(),
  ]);
  if (devices.error) throw new Error(`devices: ${devices.error.message}`);
  if (profile.error) throw new Error(`profile: ${profile.error.message}`);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Notifications" />
      <p className="text-sm text-muted-foreground">
        After each Watch run, Shipmate tells you once if it found new matches
        for your searches. Priority companies are named first.
      </p>
      <PushSettings
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
        deviceCount={devices.count ?? 0}
        emailOn={readNotifyPrefs(profile.data?.notify_prefs).email}
      />
    </div>
  );
}
