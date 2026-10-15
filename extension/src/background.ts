/**
 * The extension's service worker: holds a tab's Apply marker, knows which
 * frame of a tab has a form, and talks to Shipmate (only it has the key).
 *
 * Fill: POST /api/extension/fill with the page's address (and the marker,
 * if the tab came from Shipmate's Apply button), then the resume from
 * /api/extension/pdf, then hand both to the frame with the form. With a
 * marker that Shipmate accepts, this happens on its own; otherwise only
 * when the user clicks the toolbar button (the popup).
 */

import type { FillResponse, SubmittedResponse } from "@/lib/extension/protocol";

import type { FillReport, ToBackground, ToContent } from "./messages";
import { loadSettings } from "./settings";

const MARKER_TTL_MS = 10 * 60 * 1000;

type TabState = {
  marker?: { value: string; at: number };
  /** Frames that reported a form, newest last. */
  forms?: { frameId: number; url: string }[];
};

const key = (tabId: number) => `tab:${tabId}`;

async function tabState(tabId: number): Promise<TabState> {
  const stored = await chrome.storage.session.get(key(tabId));
  return (stored[key(tabId)] as TabState | undefined) ?? {};
}

async function setTabState(tabId: number, state: TabState) {
  await chrome.storage.session.set({ [key(tabId)]: state });
}

/**
 * One tab's messages, one at a time: a page's "new page" (with its
 * marker) must land before its "form ready" reads it.
 */
const queues = new Map<number, Promise<unknown>>();
function inOrder(tabId: number | undefined, task: () => Promise<unknown>) {
  if (tabId === undefined) return task();
  const next = (queues.get(tabId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  queues.set(tabId, next);
  return next;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  queues.delete(tabId);
  void chrome.storage.session.remove(key(tabId));
});

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await loadSettings();
  if (!settings) {
    return Response.json(
      {
        ok: false,
        reason: "not_connected",
        message:
          "Connect the extension first: Shipmate → Profile → Browser extension.",
      },
      { status: 401 },
    );
  }
  return fetch(`${settings.origin}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${settings.token}`,
      "content-type": "application/json",
    },
  });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fillFrame(
  tabId: number,
  frame: { frameId: number; url: string },
  marker: string | null,
): Promise<FillReport> {
  let data: FillResponse;
  try {
    const response = await api("/api/extension/fill", {
      method: "POST",
      body: JSON.stringify({ url: frame.url, marker }),
    });
    data = (await response.json()) as FillResponse;
  } catch {
    return { ok: false, text: "Couldn't reach Shipmate. Try again." };
  }
  if (!data.ok) return { ok: false, text: data.message };
  // A marker Shipmate didn't accept (spent, expired, another posting):
  // no automatic fill. The toolbar button still works.
  if (marker && !data.auto) return { ok: false, text: "" };
  if (data.questionsStatus !== "ok") {
    return {
      ok: false,
      text: "Shipmate can't read this form's questions yet, so it didn't fill anything. Use the answer sheet on Shipmate's review page.",
    };
  }

  let pdf: Extract<ToContent, { type: "fill" }>["pdf"] = null;
  if (data.pdf) {
    const response = await api(
      `/api/extension/pdf?up=${encodeURIComponent(data.userPostingId)}`,
    ).catch(() => null);
    if (response?.ok) {
      pdf = {
        name: decodeURIComponent(
          response.headers.get("x-shipmate-file-name") ?? "resume.pdf",
        ),
        path: decodeURIComponent(response.headers.get("x-shipmate-path") ?? ""),
        base64: toBase64(await response.arrayBuffer()),
      };
    }
  }

  const summary = (await chrome.tabs.sendMessage(
    tabId,
    { type: "fill", data, pdf } satisfies ToContent,
    { frameId: frame.frameId },
  )) as { filled: number } | undefined;
  return {
    ok: true,
    text: `Filled ${summary?.filled ?? 0} fields. Check them, then submit it yourself.`,
  };
}

/** The toolbar button: fill the form in the active tab, marker or not. */
async function fillActiveTab(): Promise<FillReport> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id) return { ok: false, text: "No page to fill." };
  // The address is visible only on the hosts the extension works on.
  if (tab.url && /^https:\/\/[^/]*\.myworkdayjobs\.com\//.test(tab.url)) {
    return {
      ok: false,
      text: "Workday forms aren't supported yet: each company's is different. Use the answer sheet on Shipmate's review page to copy your answers.",
    };
  }
  const state = await tabState(tab.id);
  const frame = state.forms?.at(-1);
  if (!frame) {
    return {
      ok: false,
      text: "No application form found on this page. Open the form (often an Apply button on the page) and try again.",
    };
  }
  const report = await fillFrame(tab.id, frame, null);
  if (!report.ok && report.text) {
    await chrome.tabs
      .sendMessage(
        tab.id,
        { type: "notice", text: report.text } satisfies ToContent,
        {
          frameId: frame.frameId,
        },
      )
      .catch(() => undefined);
  }
  return report;
}

async function submitted(
  userPostingId: string,
  path: string | null,
): Promise<FillReport> {
  try {
    const response = await api("/api/extension/submitted", {
      method: "POST",
      body: JSON.stringify({ userPostingId, path }),
    });
    const data = (await response.json()) as SubmittedResponse;
    return data.ok
      ? { ok: true, text: "Set sail ✓ It's in your Tracker as applied." }
      : { ok: false, text: data.message };
  } catch {
    return {
      ok: false,
      text: "Couldn't reach Shipmate. Mark it applied there.",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ToBackground, sender, reply: (value: unknown) => void) => {
    const tabId = sender.tab?.id;
    void inOrder(tabId, async () => {
      switch (message.type) {
        case "page": {
          if (tabId === undefined) return reply(false);
          const { marker } = await tabState(tabId);
          await setTabState(tabId, {
            marker: message.marker
              ? { value: message.marker, at: Date.now() }
              : marker,
          });
          return reply(true);
        }
        case "form-ready": {
          if (tabId === undefined || sender.frameId === undefined) {
            return reply(false);
          }
          const frame = { frameId: sender.frameId, url: message.url };
          const state = await tabState(tabId);
          const marker =
            state.marker && Date.now() - state.marker.at < MARKER_TTL_MS
              ? state.marker.value
              : null;
          // A marker is used once, by the first form that shows up.
          await setTabState(tabId, {
            forms: [...(state.forms ?? []), frame].slice(-5),
          });
          if (marker) await fillFrame(tabId, frame, marker);
          return reply(true);
        }
        case "submitted":
          return reply(await submitted(message.userPostingId, message.path));
        case "fill-active-tab":
          return reply(await fillActiveTab());
      }
    });
    return true;
  },
);

// For the E2E test, which can't click the toolbar: the same handler.
(
  globalThis as { shipmateFillActiveTab?: () => Promise<FillReport> }
).shipmateFillActiveTab = fillActiveTab;
