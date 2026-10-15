"use server";

import type { ActionResult } from "@/lib/action-result";
import { requireMember } from "@/lib/auth/viewer";
import { mintToken } from "@/lib/extension/token";
import { createClient } from "@/lib/supabase/server";

/**
 * Connect the extension: a new token (replacing any earlier one), returned
 * to this one page view and never again. Only its hash is stored.
 */
export async function connectExtension(): Promise<
  { ok: true; token: string } | { ok: false; message: string }
> {
  await requireMember();
  const { token, hash } = mintToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("connect_extension", {
    p_token_hash: hash,
  });
  if (error) {
    console.error(`[extension] connect failed: ${error.code}`);
    return { ok: false, message: "Couldn't connect. Try again." };
  }
  return { ok: true, token };
}

export async function disconnectExtension(): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_extension");
  if (error) {
    console.error(`[extension] disconnect failed: ${error.code}`);
    return { ok: false, message: "Couldn't disconnect. Try again." };
  }
  return { ok: true };
}
