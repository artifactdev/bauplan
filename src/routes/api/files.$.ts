import { createFileRoute } from "@tanstack/react-router";

// Serves uploaded files stored locally; requires a valid member session.
export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const la = await import("@/server/local-auth");
        const u = await la.userFromToken(la.cookieFrom(request.headers.get("cookie"), la.SESSION_COOKIE));
        if (!u || (u.role !== "admin" && u.role !== "member")) return new Response("Unauthorized", { status: 401 });
        const { readSqliteFile } = await import("@/server/repo");
        const name = decodeURIComponent(params._splat ?? "");
        const bytes = await readSqliteFile(name);
        if (!bytes) return new Response("Not found", { status: 404 });
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
        return new Response(bytes as BodyInit, { headers: { "content-type": types[ext] ?? "application/octet-stream" } });
      },
    },
  },
});
