/**
 * Where Shipmate is and the extension's key (chrome.storage.local). The key
 * stays in this browser profile; it's sent only to the Shipmate address,
 * as `Authorization: Bearer`.
 */

export const ORIGINS = [
  "https://shipmate-jobs.vercel.app",
  "http://localhost:3000",
] as const;

export type Settings = { origin: string; token: string };

export async function loadSettings(): Promise<Settings | null> {
  const { origin, token } = (await chrome.storage.local.get([
    "origin",
    "token",
  ])) as Partial<Settings>;
  if (!token || !origin || !(ORIGINS as readonly string[]).includes(origin)) {
    return null;
  }
  return { origin, token };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set(settings);
}
