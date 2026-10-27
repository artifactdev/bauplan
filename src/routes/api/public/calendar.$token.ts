import { createFileRoute } from "@tanstack/react-router";

// Read-only iCal subscription. Access is granted only by the secret token in the URL.
export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const f = await import("@/server/calendar-feed");
        const given = (params.token ?? "").replace(/\.ics$/, "");
        const token = await f.getFeedToken();
        if (!token || !given || !f.sameToken(given, token))
          return new Response("Not found", { status: 404 });
        const { buildIcs } = await import("@/lib/ics");
        const { events, tasks, offers, name } = await f.feedData();
        return new Response(buildIcs(events, tasks, name, new Date(), offers), {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="bauplan.ics"',
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
