import { createFileRoute } from "@tanstack/react-router";

// Self-hosted OIDC callback: checks state, exchanges the code, reads the
// user profile from the provider and signs the matching local account in.
export const Route = createFileRoute("/api/oidc/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const la = await import("@/server/local-auth");
        const fail = (msg: string) =>
          new Response(null, { status: 302, headers: { location: `/auth?fehler=${encodeURIComponent(msg)}` } });
        try {
          const url = new URL(request.url);
          const [state, verifier] = (la.cookieFrom(request.headers.get("cookie"), "bp_oidc") ?? "").split(".");
          if (!state || !verifier || url.searchParams.get("state") !== state) return fail("Anmeldung abgelaufen, bitte erneut versuchen.");
          const code = url.searchParams.get("code");
          if (!code) return fail(url.searchParams.get("error_description") ?? "Anmeldung abgebrochen");
          const s = await la.getOidcSettings();
          const meta = await la.discover(s.issuer);
          const origin = la.publicOrigin(request, s.public_url);
          const tokenRes = await fetch(meta.token_endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code", code, redirect_uri: `${origin}/api/oidc/callback`,
              client_id: s.client_id, client_secret: s.client_secret, code_verifier: verifier,
            }),
          });
          if (!tokenRes.ok) return fail("Der Anmeldedienst hat die Anmeldung abgelehnt.");
          const tok = (await tokenRes.json()) as { access_token?: string };
          const infoRes = await fetch(meta.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.access_token}` } });
          if (!infoRes.ok) return fail("Profil konnte nicht gelesen werden.");
          const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string };
          if (!info.sub) return fail("Ungültige Antwort des Anmeldedienstes.");
          const user = await la.upsertOidcUser({ sub: info.sub, email: info.email, email_verified: info.email_verified, name: info.name ?? info.preferred_username });
          const sess = await la.createSession(user.id);
          const secure = origin.startsWith("https") ? "; Secure" : "";
          const h = new Headers({ location: "/" });
          h.append("set-cookie", `bp_session=${sess.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sess.maxAge}${secure}`);
          h.append("set-cookie", `bp_oidc=; Path=/api/oidc; Max-Age=0`);
          return new Response(null, { status: 302, headers: h });
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen");
        }
      },
    },
  },
});
