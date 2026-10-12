import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { simplifyAdapter } from "./simplify";
import { smartrecruitersAdapter } from "./smartrecruiters";
import type { SourceAdapter, SourceKind } from "./types";
import { workdayAdapter } from "./workday";

/** Adapters by `sources.kind`. */
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  simplify_repo: simplifyAdapter,
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartrecruitersAdapter,
  workday: workdayAdapter,
};

/**
 * The company-board kinds: sources a user follows, as opposed to the
 * aggregator feeds. Their health and first-snapshot rules differ (see
 * worker/health.ts and worker/run.ts).
 */
export const BOARD_KINDS: readonly SourceKind[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
];

export const isBoardKind = (kind: string): boolean =>
  (BOARD_KINDS as readonly string[]).includes(kind);
