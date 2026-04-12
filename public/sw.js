/*
 * Shipmate's service worker: it exists only to receive Web Push. No caching,
 * no offline mode. A push carries { title, body, url }: counts and company
 * names, never anything from a resume or an answer sheet.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Shipmate";
  const body =
    typeof data.body === "string" ? data.body : "You have new matches.";
  // Only same-site paths: the push body is not trusted to send you elsewhere.
  const url =
    typeof data.url === "string" &&
    data.url.startsWith("/") &&
    !data.url.startsWith("//")
      ? data.url
      : "/inbox";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "shipmate-matches",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? "/inbox",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (
            new URL(client.url).origin === self.location.origin &&
            "focus" in client
          ) {
            if ("navigate" in client) client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
