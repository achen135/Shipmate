/**
 * The toolbar button: fill the form on this page now (the same fill as
 * the automatic one from Shipmate's Apply button), or say why not.
 */

import type { FillReport } from "./messages";
import { loadSettings } from "./settings";

const status = document.getElementById("status")!;
const settings = document.getElementById("settings")!;

settings.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

void (async () => {
  if (!(await loadSettings())) {
    status.textContent =
      "Not connected. In Shipmate, open Profile → Browser extension, connect, and paste the key into Settings.";
    return;
  }
  status.textContent = "Filling…";
  const report = (await chrome.runtime.sendMessage({
    type: "fill-active-tab",
  })) as FillReport;
  status.textContent = report.text || "Nothing to fill on this page.";
})();
