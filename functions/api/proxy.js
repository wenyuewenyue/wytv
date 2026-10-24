// WyTV proxy: proxies m3u8 playlists (rewriting relative segment URLs
// back through this proxy) and media segments, so http / no-CORS sources
// can play from an https Pages site. It does NOT store, transcode or
// re-distribute content; the browser still fetches the original
// broadcaster's stream, just relayed.
//
// Fixes (2026-10-24):
// - Only rewrite a body that actually IS a playlist (starts with
//   #EXTM3U). An upstream error page (e.g. "error code: 1003") or a
//   403/404 must be passed through with its real status, never
//   rewritten into a fake playlist line.
// - Resolve relative URLs against the FINAL url after redirects
//   (res.url), not the original request url: some sources 302 to a
//   keyed host, and segments must resolve against that host.
// - Also rewrite URI="..." inside #EXT-X-KEY / #EXT-X-MAP lines,
//   otherwise the player resolves keys against the proxy path.
function isBlockedHost(host) {
  const h = (host || "").toLowerCase().split(":")[0];
  if (h === "localhost" || h === "metadata.google.internal") return true;
  if (h.startsWith("127.") || h === "::1" || h === "[::1]") return true;
  if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (h.startsWith("169.254.")) return true;
  return false;
}
function proxyUrl(raw) {
  return "/api/proxy?url=" + encodeURIComponent(raw);
}
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400 });
  let upstream;
  try { upstream = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") return new Response("only http/https", { status: 400 });
  if (isBlockedHost(upstream.hostname)) return new Response("blocked host", { status: 403 });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" };
  if (context.request.method === "OPTIONS") return new Response(null, { headers: cors });
  let res;
  try {
    res = await fetch(upstream.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept": "*/*" },
      redirect: "follow",
    });
  } catch (e) {
    return new Response("upstream fetch failed: " + String(e && e.message || e), { status: 502, headers: cors });
  }
  const ct = res.headers.get("content-type") || "";
  const looksLikePlaylist = target.includes(".m3u8") || ct.includes("mpegurl") || ct.includes("x-mpegurl");
  if (looksLikePlaylist && res.status === 200) {
    const text = await res.text();
    if (!text.trimStart().startsWith("#EXTM3U")) {
      // Upstream returned an error page, not a playlist: pass it
      // through untouched so the player (and the user) sees the
      // real error instead of a broken fake playlist.
      return new Response(text, { status: 200, headers: { ...cors, "Content-Type": "text/plain", "Cache-Control": "no-cache" } });
    }
    const base = res.url || upstream.toString();
    const out = text.split("\n").map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        // Rewrite URI="..." inside KEY/MAP tags.
        if (t.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (m, u) => {
            try { return 'URI="' + proxyUrl(new URL(u, base).toString()) + '"'; } catch { return m; }
          });
        }
        return line;
      }
      try { return proxyUrl(new URL(t, base).toString()); } catch { return line; }
    }).join("\n");
    return new Response(out, { headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }
  // Segments, import text, or any non-200 upstream response:
  // stream through with CORS, preserving the real status.
  const outHeaders = { ...cors, "Cache-Control": "no-cache" };
  if (ct) outHeaders["Content-Type"] = ct;
  return new Response(res.body, { status: res.status, headers: outHeaders });
}
