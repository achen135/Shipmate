import { simplifyAdapter } from "./simplify";
import type { SourceAdapter, SourceKind } from "./types";

/** Adapters by `sources.kind`. M4 adds the company-board adapters here. */
export const ADAPTERS: Partial<Record<SourceKind, SourceAdapter>> = {
  simplify_repo: simplifyAdapter,
};
