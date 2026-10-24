// WyTV refresh: fetch a FRESH official live URL at play time, so
// _upt-style rotating tokens are not stored statically in channels.json.
// Only two official, login-free endpoints are allowed; no arbitrary URL
// is fetched (SSRF guard by allow-list, not by user input).
//   /api/refresh?src=fjtv&id=665248966136664064
//   /api/refresh?src=hnntv&id=STHaiNan_channel_lywsgq
// Response: {"url": "https://...m3u8?..."}  or {"error": "..."}.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (context.request.method === "OPTIONS") return new Response(null, { headers: CORS });
  const src = url.searchParams.get("src") || "";
  const id = url.searchParams.get("id") || "";
  let api = "";
  if (src === "fjtv") {
    if (!/^\d{10,20}$/.test(id)) return new Response(JSON.stringify({ error: "bad id" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    api = `https://live.fjtv.net/m2o/channel/channel_info.php?channel_id=${id}`;
  } else if (src === "hnntv") {
    if (!/^[A-Za-z0-9_]{3,60}$/.test(id)) return new Response(JSON.stringify({ error: "bad id" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    api = `https://ps.hnntv.cn/ps/livePlayUrl?appCode=&token=&channelCode=${encodeURIComponent(id)}`;
  } else {
    return new Response(JSON.stringify({ error: "unknown src" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return new Response(JSON.stringify({ error: "upstream " + res.status }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    const data = await res.json();
    let fresh = "";
    if (src === "fjtv") {
      const item = Array.isArray(data) ? data[0] : data;
      fresh = item && typeof item.m3u8 === "string" ? item.m3u8 : "";
    } else {
      const item = data && Array.isArray(data.resultSet) ? data.resultSet[0] : null;
      fresh = item && typeof item.url === "string" ? item.url : "";
    }
    if (!fresh || !/^https?:\/\//.test(fresh)) return new Response(JSON.stringify({ error: "no url in upstream" }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ url: fresh }), { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-cache" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "fetch failed" }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
