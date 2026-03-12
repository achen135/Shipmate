/** What a form Server Action returns when it doesn't redirect. */
export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
