self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch (error) {
        console.error("[push] Invalid notification payload", error);
      }
      const url =
        typeof payload?.url === "string" ? new URL(payload.url, self.location.origin) : null;
      await self.registration.showNotification(
        typeof payload?.title === "string" ? payload.title : "Bauplan",
        {
          body: typeof payload?.body === "string" ? payload.body : "",
          icon: "/app-icon-192.png",
          badge: "/app-icon-192.png",
          tag: typeof payload?.tag === "string" ? payload.tag : "bauplan",
          data: { url: url?.origin === self.location.origin ? url.href : self.location.origin },
        },
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL(event.notification.data?.url || "/", self.location.origin);
      if (url.origin !== self.location.origin)
        throw new Error("Invalid push notification destination");
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === url.origin);
      if (existing) {
        await existing.navigate(url.href);
        await existing.focus();
      } else {
        await self.clients.openWindow(url.href);
      }
    })(),
  );
});
