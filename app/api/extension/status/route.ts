import { json, withToken } from "@/lib/extension/respond";
import { extensionCheck } from "@/lib/extension/server";

/** GET with the extension's token: is it connected? (The options page's check.) */
export async function GET(request: Request) {
  return withToken(request, "status", async (token) =>
    json({ ok: true, connected: await extensionCheck(token) }),
  );
}
