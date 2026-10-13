"use client";

import { Bell, BellOff, Share, SquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  removePushSubscription,
  savePushSubscription,
  setEmailFallback,
} from "@/app/(app)/profile/notifications/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type PushSupport,
  pushSupport,
  urlBase64ToUint8Array,
} from "@/lib/notify/device";

type Status =
  | { state: "checking" }
  | { state: "support"; support: PushSupport; subscribed: boolean };

function readSupport(): PushSupport {
  return pushSupport({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}

/**
 * Turn Web Push on or off for this device, with the iPhone steps first when
 * they're needed, and the email-fallback switch.
 */
export function PushSettings({
  vapidPublicKey,
  deviceCount,
  emailOn,
}: {
  vapidPublicKey: string | null;
  deviceCount: number;
  emailOn: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "checking" });
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(emailOn);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const support = readSupport();
      let subscribed = false;
      if (support.kind === "ready") {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          subscribed =
            (await registration?.pushManager.getSubscription()) != null;
        } catch {
          subscribed = false;
        }
      }
      if (!cancelled) setStatus({ state: "support", support, subscribed });
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    startTransition(async () => {
      try {
        if (!vapidPublicKey) throw new Error("no key");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error(
            "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
          );
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          }));
        const json = subscription.toJSON();
        const result = await savePushSubscription({
          endpoint: json.endpoint,
          keys: json.keys,
        });
        if (!result.ok) {
          await subscription.unsubscribe();
          toast.error(result.message);
          return;
        }
        setStatus((s) =>
          s.state === "support" ? { ...s, subscribed: true } : s,
        );
        toast.success("Notifications are on for this device.");
        router.refresh();
      } catch {
        toast.error("Couldn't turn notifications on in this browser.");
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await removePushSubscription(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setStatus((s) =>
          s.state === "support" ? { ...s, subscribed: false } : s,
        );
        toast.success("Notifications are off for this device.");
        router.refresh();
      } catch {
        toast.error("Couldn't turn them off. Try again.");
      }
    });
  }

  function toggleEmail(next: boolean) {
    setEmail(next);
    startTransition(async () => {
      const result = await setEmailFallback(next);
      if (!result.ok) {
        setEmail(!next);
        toast.error(result.message);
      }
    });
  }

  let push: React.ReactNode;
  if (status.state === "checking") {
    push = <p className="text-sm text-muted-foreground">Checking…</p>;
  } else if (status.support.kind === "ios_add_to_home") {
    push = (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="font-medium">Add Shipmate to your Home Screen first</p>
        <p className="text-sm text-muted-foreground">
          iPhone only allows notifications for apps on the Home Screen, and it
          won&apos;t offer to add this one.
        </p>
        <ol className="flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <Share aria-hidden="true" className="size-4 shrink-0" />
            In Safari, tap the Share button.
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus aria-hidden="true" className="size-4 shrink-0" />
            Choose &ldquo;Add to Home Screen&rdquo;, then Add.
          </li>
          <li className="flex items-center gap-2">
            <Bell aria-hidden="true" className="size-4 shrink-0" />
            Open Shipmate from the new icon and come back to this page to turn
            notifications on.
          </li>
        </ol>
      </div>
    );
  } else if (status.support.kind === "unsupported") {
    push = (
      <p className="text-sm text-muted-foreground">
        This browser can&apos;t receive push notifications. Try Chrome, Firefox,
        or Edge, or an iPhone or iPad with Shipmate on the Home Screen.
        {email ? " Email will cover you meanwhile." : ""}
      </p>
    );
  } else if (!vapidPublicKey) {
    push = (
      <p className="text-sm text-muted-foreground">
        Push isn&apos;t set up on this server yet.
      </p>
    );
  } else if (status.subscribed) {
    push = (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm">
          Notifications are on for this device.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={disable}
        >
          <BellOff aria-hidden="true" />
          Turn off
        </Button>
      </div>
    );
  } else {
    push = (
      <div className="flex flex-col gap-2">
        <Button className="self-start" disabled={pending} onClick={enable}>
          <Bell aria-hidden="true" />
          {pending ? "Turning on…" : "Turn on notifications"}
        </Button>
        <p className="text-xs text-muted-foreground">
          One notification per Watch run, like &ldquo;3 new matches&rdquo;.
          Never your resume or answers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="push-heading" className="flex flex-col gap-3">
        <h2 id="push-heading" className="text-lg font-medium">
          This device
        </h2>
        {push}
        {deviceCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {deviceCount} {deviceCount === 1 ? "device" : "devices"} will get
            notifications.
          </p>
        )}
      </section>

      <section aria-labelledby="email-heading" className="flex flex-col gap-3">
        <h2 id="email-heading" className="text-lg font-medium">
          Email
        </h2>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={email}
            disabled={pending}
            onCheckedChange={(value) => toggleEmail(value === true)}
            className="mt-0.5"
          />
          <span>
            Email me when I have new matches but no device turned on
            <span className="block text-xs text-muted-foreground">
              Starts a day after you join, and stops once a device is on.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
