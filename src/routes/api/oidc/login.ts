import { createFileRoute } from "@tanstack/react-router";

// Self-hosted OIDC (e.g. Pocket ID): starts the authorization-code flow with PKCE.
export const Route = createFileRoute("/api/oidc/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const la = await import("@/server/local-auth");
        const { randomToken, pkceChallenge } = await import("@/server/auth-core");
        const s = await la.getOidcSettings();
        if (!s.enabled || !s.issuer || !s.client_id) return new Response("OIDC ist nicht eingerichtet", { status: 400 });
        const meta = await la.discover(s.issuer);
        const state = randomToken(16);
        const verifier = randomToken(32);
        const origin = la.publicOrigin(request, s.public_url);
        const url = new URL(meta.authorization_endpoint);
        url.search = new URLSearchParams({
          response_type: "code",
          client_id: s.client_id,
          redirect_uri: `${origin}/api/oidc/callback`,
          scope: "openid email profile",
          state,
          code_challenge: await pkceChallenge(verifier),
          code_challenge_method: "S256",
        }).toString();
        const secure = origin.startsWith("https") ? "; Secure" : "";
        return new Response(null, {
          status: 302,
          headers: { location: url.toString(), "set-cookie": `bp_oidc=${state}.${verifier}; Path=/api/oidc; HttpOnly; SameSite=Lax; Max-Age=600${secure}` },
        });
      },
    },
  },
});
