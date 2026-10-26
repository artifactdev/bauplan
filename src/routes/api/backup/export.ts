import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/backup/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await import("@/server/local-auth");
        const user = await auth.userFromToken(
          auth.cookieFrom(request.headers.get("cookie"), auth.SESSION_COOKIE),
        );
        if (!user) return new Response("Unauthorized", { status: 401 });
        if (user.role !== "admin") return new Response("Forbidden", { status: 403 });

        const { createBackup } = await import("@/server/backup");
        const { sqliteRepo } = await import("@/server/repo");
        const backup = await createBackup(sqliteRepo());
        const date = new Date().toISOString().slice(0, 10);
        return new Response(backup as BodyInit, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="bauplan-backup-${date}.zip"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
