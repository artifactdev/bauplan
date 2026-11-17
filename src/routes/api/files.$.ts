import { createFileRoute } from "@tanstack/react-router";

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  webm: "video/webm",
  webp: "image/webp",
};

export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const la = await import("@/server/local-auth");
        const u = await la.userFromToken(
          la.cookieFrom(request.headers.get("cookie"), la.SESSION_COOKIE),
        );
        if (!u || (u.role !== "admin" && u.role !== "member"))
          return new Response("Unauthorized", { status: 401 });
        const { sqliteFileInfo, streamSqliteFile } = await import("@/server/repo");
        const name = decodeURIComponent(params._splat ?? "");
        const info = await sqliteFileInfo(name);
        if (!info) return new Response("Not found", { status: 404 });
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        let start = 0;
        let end = info.size - 1;
        let status = 200;
        const range = request.headers.get("range");
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || info.size === 0)
            return new Response(null, {
              status: 416,
              headers: { "content-range": `bytes */${info.size}` },
            });
          if (!match[1]) {
            const suffix = Number(match[2]);
            if (!Number.isSafeInteger(suffix) || suffix <= 0)
              return new Response(null, {
                status: 416,
                headers: { "content-range": `bytes */${info.size}` },
              });
            start = Math.max(info.size - suffix, 0);
          } else {
            start = Number(match[1]);
            end = match[2] ? Number(match[2]) : end;
          }
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start >= info.size ||
            end < start
          )
            return new Response(null, {
              status: 416,
              headers: { "content-range": `bytes */${info.size}` },
            });
          end = Math.min(end, info.size - 1);
          status = 206;
        }
        const body =
          info.size === 0 ? await streamSqliteFile(name) : await streamSqliteFile(name, start, end);
        if (!body) return new Response("Not found", { status: 404 });
        return new Response(body, {
          status,
          headers: {
            "accept-ranges": "bytes",
            "content-length": String(end - start + 1),
            ...(status === 206 ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
            "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
