/* global self, caches */
// This handler runs before Workbox routing and never sends shared files to the server.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname !== "/share-target" ||
    event.request.method !== "POST"
  )
    return;

  event.respondWith(
    (async () => {
      const stored = [];
      let cache;
      try {
        cache = await caches.open("bauplan-share-inbox-v1");
        const now = Date.now();
        let total = 0;
        for (const key of await cache.keys()) {
          const response = await cache.match(key);
          if (Number(response.headers.get("x-shared-at")) < now - 86400000) {
            await cache.delete(key);
          } else {
            total += Number(response.headers.get("x-file-size"));
          }
        }
        const data = await event.request.formData();
        const files = data.getAll("files");
        if (
          !files.length ||
          files.some(
            (file) =>
              typeof file === "string" ||
              !file.size ||
              !(
                file.type === "application/pdf" ||
                file.type.startsWith("image/") ||
                ((!file.type || file.type === "application/octet-stream") &&
                  /\.pdf$/i.test(file.name))
              ),
          )
        ) {
          return Response.redirect(`${url.origin}/?share_error=invalid`, 303);
        }
        if (total + files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) {
          return Response.redirect(`${url.origin}/?share_error=too_large`, 303);
        }
        for (const file of files) {
          const key = `${url.origin}/__share-inbox/${crypto.randomUUID()}`;
          // Register before writing so a partially failed batch can be rolled back.
          stored.push(key);
          await cache.put(
            key,
            new Response(file, {
              headers: {
                "content-type":
                  !file.type || file.type === "application/octet-stream"
                    ? "application/pdf"
                    : file.type,
                "x-file-name": encodeURIComponent(file.name),
                "x-file-size": String(file.size),
                "x-shared-at": String(now),
              },
            }),
          );
        }
        return Response.redirect(`${url.origin}/?shared=1`, 303);
      } catch (error) {
        console.error("Could not receive shared documents", error);
        if (cache) {
          try {
            await Promise.all(stored.map((key) => cache.delete(key)));
          } catch (cleanupError) {
            console.error("Could not roll back shared documents", cleanupError);
          }
        }
        return Response.redirect(`${url.origin}/?share_error=storage`, 303);
      }
    })(),
  );
});
