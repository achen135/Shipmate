/** Settings: which Shipmate, and the key from Profile → Browser extension. */

import { ORIGINS, loadSettings, saveSettings } from "./settings";

const form = document.getElementById("form") as HTMLFormElement;
const origin = document.getElementById("origin") as HTMLSelectElement;
const token = document.getElementById("token") as HTMLInputElement;
const status = document.getElementById("status")!;

for (const value of ORIGINS) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  origin.append(option);
}

void loadSettings().then((saved) => {
  if (saved) {
    origin.value = saved.origin;
    token.placeholder = "Saved. Paste a new key to replace it.";
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const value = token.value.trim();
    const saved = await loadSettings();
    const next = { origin: origin.value, token: value || saved?.token || "" };
    if (!next.token.startsWith("shm_ext_")) {
      status.textContent = "That doesn't look like a Shipmate extension key.";
      return;
    }
    status.textContent = "Checking…";
    const response = await fetch(`${next.origin}/api/extension/status`, {
      headers: { authorization: `Bearer ${next.token}` },
    }).catch(() => null);
    if (!response?.ok) {
      status.textContent =
        response?.status === 401
          ? "Shipmate didn't accept that key. Connect again in Profile → Browser extension."
          : "Couldn't reach Shipmate at that address.";
      return;
    }
    await saveSettings(next);
    token.value = "";
    token.placeholder = "Saved. Paste a new key to replace it.";
    status.textContent = "Connected ✓";
  })();
});
