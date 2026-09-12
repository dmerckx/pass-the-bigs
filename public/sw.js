// No offline game-state cache: the shared server remains authoritative.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Use the default text. */ }
  const url = ["/david", "/elisabeth"].includes(data.url) ? data.url : "/";
  event.waitUntil(self.registration.showNotification(data.title || "Pass the Pigs", {
    body: data.body || "Hey, its your turn in pass the pigs!",
    icon: "/icon-192.png", badge: "/icon-192.png", tag: data.tag || "your-turn",
    data: { url },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const path = event.notification.data?.url || "/";
  const destination = new URL(path, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => client.url === destination);
    if (existing) return existing.focus();
    return self.clients.openWindow(destination);
  }));
});
