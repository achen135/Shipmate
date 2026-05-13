import type { FillResponse } from "@/lib/extension/protocol";

/** Content script → background. */
export type ToBackground =
  | { type: "page"; marker: string | null }
  | { type: "form-ready"; url: string }
  | { type: "submitted"; userPostingId: string; path: string | null }
  | { type: "fill-active-tab" };

/** Background → content script. */
export type ToContent =
  | {
      type: "fill";
      data: Extract<FillResponse, { ok: true }>;
      pdf: { name: string; path: string; base64: string } | null;
    }
  | { type: "notice"; text: string };

/** What a fill or a manual trigger came to, for the popup. */
export type FillReport = { ok: boolean; text: string };

export const MARKER_PARAM = "shipmate";
