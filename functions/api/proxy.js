// WyTV proxy: proxies m3u8 playlists (rewriting
// relative segment URLs back through this proxy) and media segments,
// so http / no-CORS sources can play from an https Pages site.
// It does NOT store, transcode or re-distribute content; the browser
// still fetches the original broadcaster's stream, just relayed.
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
  const headers = { "User-Agent": "Mozilla/5.0 (WyTV personal player)", "Accept": "*/*" };
  let res;
  try {
    res = await fetch(upstream.toString(), { headers, redirect: "follow" });
  } catch (e) {
    return new Response("upstream fetch failed: " + String(e && e.message || e), { status: 502 });
  }
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" };
  if (context.request.method === "OPTIONS") return new Response(null, { headers: cors });
  const ct = res.headers.get("content-type") || "";
  const isPlaylist = target.includes(".m3u8") || ct.includes("mpegurl") || ct.includes("x-mpegurl");
  if (isPlaylist) {
    const text = await res.text();
    const out = text.split("\n").map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      try {
        const abs = new URL(t, upstream.toString()).toString();
        return proxyUrl(abs);
      } catch { return line; }
    }).join("\n");
    return new Response(out, { headers: { ...cors, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }
  // segments / playlist text for import: stream through with CORS
  const body = res.body;
  const outHeaders = { ...cors, "Cache-Control": "no-cache" };
  if (ct) outHeaders["Content-Type"] = ct;
  return new Response(body, { status: res.status, headers: outHeaders });
}
