export const PREFIX = "/xperience/2-research";
const OFFICIAL_HOST = "ropedia.com";

// Inject fetch only for offline tests. ASSETS is this Worker's own static bundle.
export function createWorker(fetchOrigin = (request) => fetch(request)) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const mounted = url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/");

      if (!mounted) {
        // The /xperience/2-research* Route also catches /.../2-research-extra.
        // On the official domain, return such requests to its original origin.
        // Keep global_fetch_strictly_public disabled to avoid looping into this Route.
        if (url.hostname === OFFICIAL_HOST) return fetchOrigin(request);
        // Preserve root-path access on workers.dev and during local development.
        return env.ASSETS.fetch(request);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === PREFIX) {
        url.pathname += "/";
        return new Response(null, {
          status: 307,
          headers: { Location: url.href, "Cache-Control": "no-store" },
        });
      }

      const assetUrl = new URL(url);
      assetUrl.pathname = url.pathname.slice(PREFIX.length);
      const assetRequest = new Request(new Request(assetUrl, request), { redirect: "manual" });
      const response = await env.ASSETS.fetch(assetRequest);
      const location = response.headers.get("Location");
      if (!location || ![301, 302, 303, 307, 308].includes(response.status)) return response;

      // ASSETS may canonicalize /index.html to /, or /guide to /guide/.
      // Keep those redirects inside the mounted project, never at the website root.
      const target = new URL(location, assetUrl);
      if (target.origin !== assetUrl.origin) return response;
      target.pathname = PREFIX + target.pathname;
      if (target.href === url.href) {
        return new Response("Invalid asset redirect", { status: 502, headers: { "Cache-Control": "no-store" } });
      }
      const headers = new Headers(response.headers);
      headers.set("Location", target.href);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    },
  };
}
