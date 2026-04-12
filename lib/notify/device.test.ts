import { describe, expect, it } from "vitest";

import {
  type DeviceFacts,
  isIos,
  pushSupport,
  urlBase64ToUint8Array,
} from "./device";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const capable = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};
const facts = (over: Partial<DeviceFacts>): DeviceFacts => ({
  userAgent: ANDROID,
  maxTouchPoints: 5,
  standalone: false,
  ...capable,
  ...over,
});

describe("isIos", () => {
  it("recognizes iPhone, and iPad that calls itself a Mac", () => {
    expect(isIos({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
  });

  it("doesn't mistake a real Mac or Android", () => {
    expect(isIos({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });
});

describe("pushSupport", () => {
  it("shows the Add to Home Screen steps on iOS in a browser tab", () => {
    expect(pushSupport(facts({ userAgent: IPHONE }))).toEqual({
      kind: "ios_add_to_home",
    });
    // Even though Safari reports PushManager only after install, steps come first.
    expect(
      pushSupport(facts({ userAgent: IPHONE, hasPushManager: false })),
    ).toEqual({ kind: "ios_add_to_home" });
  });

  it("lets iOS turn push on once it's opened from the Home Screen", () => {
    expect(pushSupport(facts({ userAgent: IPHONE, standalone: true }))).toEqual(
      { kind: "ready" },
    );
  });

  it("just works on Android and desktop", () => {
    expect(pushSupport(facts({}))).toEqual({ kind: "ready" });
    expect(pushSupport(facts({ userAgent: MAC, maxTouchPoints: 0 }))).toEqual({
      kind: "ready",
    });
  });

  it("says unsupported when the browser can't do push", () => {
    expect(pushSupport(facts({ hasPushManager: false }))).toEqual({
      kind: "unsupported",
    });
    expect(pushSupport(facts({ hasServiceWorker: false }))).toEqual({
      kind: "unsupported",
    });
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a VAPID-style key (URL-safe, no padding)", () => {
    // 0xfb 0xff 0xfe encodes to "-__-" in URL-safe base64.
    expect([...urlBase64ToUint8Array("-__-")]).toEqual([0xfb, 0xff, 0xfe]);
    expect(urlBase64ToUint8Array("AQID").length).toBe(3);
    expect([...urlBase64ToUint8Array("AQI")]).toEqual([1, 2]);
  });
});
