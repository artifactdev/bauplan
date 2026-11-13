import { createFileRoute } from "@tanstack/react-router";
import { legacyUiKeys } from "@/i18n/legacy-ui-keys";

export const Route = createFileRoute("/api/backup/export")({
  server: {
    handlers: {
      GET: ({ request }) => exportBackupResponse(request),
    },
  },
});

export async function exportBackupResponse(request: Request) {
  const auth = await import("@/server/local-auth");
  const user = await auth.userFromToken(
    auth.cookieFrom(request.headers.get("cookie"), auth.SESSION_COOKIE),
  );
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "admin") return new Response("Forbidden", { status: 403 });

  const mode = new URL(request.url).searchParams.get("mode") ?? "full";
  if (mode !== "full" && mode !== "database") return new Response("Bad Request", { status: 400 });
  try {
    const { createBackup } = await import("@/server/backup");
    const { sqliteRepo } = await import("@/server/repo");
    const backup = await createBackup(sqliteRepo(), mode === "full");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(backup as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="bauplan-backup-${date}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[backup] Export failed", error);
    const key = error instanceof Error ? legacyUiKeys[error.message] : undefined;
    return Response.json(
      { error: key ?? "settings.backup_export_failed" },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
