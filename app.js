// WyTV v1: aggregated public live sources, direct-first, proxy fallback.
const $ = (s) => document.querySelector(s);
const video = $("#video"), statusEl = $("#status"), grid = $("#grid");
const GROUPS = ["全部", "央视", "卫视", "地方", "咪咕/其他", "收藏", "我的导入"];
let all = [], currentGroup = "全部", current = null, hls = null, attempt = 0, queue = [];
let favs = new Set(JSON.parse(localStorage.getItem("wytv_fav") || "[]"));
let imported = JSON.parse(localStorage.getItem("wytv_import") || "[]");

function proxy(u) { return "/api/proxy?url=" + encodeURIComponent(u); }
function isHttps(u) { return u.startsWith("https://"); }
function saveFavs() { localStorage.setItem("wytv_fav", JSON.stringify([...favs])); }
function saveImport() { localStorage.setItem("wytv_import", JSON.stringify(imported)); }
function visible() {
  const q = $("#search").value.trim().toLowerCase();
  let list = [...all];
  if (currentGroup === "收藏") list = list.filter(c => favs.has(c.name));
  else if (currentGroup === "我的导入") list = imported;
  else if (currentGroup !== "全部") list = list.filter(c => c.group === currentGroup);
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q));
  return list;
}
function renderTabs() {
  $("#tabs").innerHTML = GROUPS.map(g => `<button class="${g === currentGroup ? 'active' : ''}" data-g="${g}">${g}</button>`).join("");
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { currentGroup = b.dataset.g; renderTabs(); renderGrid(); });
}
function renderGrid() {
  const list = visible();
  $("#countLine").textContent = `当前分组 ${list.length} 个台 · 内置共 ${all.length} 个台（不含我的导入）`;
  grid.innerHTML = list.map(c => `
    <button class="ch ${current && current.name === c.name ? 'active' : ''}" data-name="${c.name.replace(/"/g, '')}">
      ${c.logo ? `<img class="logo" src="${c.logo}" alt="" onerror="this.remove()">` : ""}
      <div class="nm">${c.name}</div>
      <div class="meta">${c.group} · ${c.sources.length} 条线路${c.geo ? " · 可能地区限制" : ""}</div>
    </button>`).join("") || `<p class="status">这个分组还没有台。去“全部”里找，或者用下面的导入补一个。</p>`;
  grid.querySelectorAll(".ch").forEach(b => b.onclick = () => {
    const ch = [...all, ...imported].find(x => x.name === b.dataset.name);
    if (ch) play(ch);
    renderGrid();
  });
}
function setStatus(html) { statusEl.innerHTML = html; }
function renderLines() {
  if (!current) return;
  $("#nowName").textContent = current.name;
  $("#nowGroup").textContent = current.group;
  $("#favBtn").textContent = favs.has(current.name) ? "★ 已收藏" : "☆ 收藏";
  $("#lineBtns").innerHTML = current.sources.map((s, i) => `<button class="${i === attempt % current.sources.length ? 'active' : ''}" data-i="${i}">线路${i + 1}${s.startsWith("http:") ? " · http" : ""}</button>`).join("")
    + `<button id="proxyBtn" class="warn">强制走代理重播</button>`;
  document.querySelectorAll("#lineBtns button[data-i]").forEach(b => b.onclick = () => { play(current, +b.dataset.i, false); });
  $("#proxyBtn").onclick = () => { play(current, attempt % current.sources.length, true); };
}
$("#favBtn").onclick = () => {
  if (!current) return;
  favs.has(current.name) ? favs.delete(current.name) : favs.add(current.name);
  saveFavs(); renderLines(); renderGrid();
};
function destroy() { if (hls) { try { hls.destroy(); } catch {} hls = null; } }
async function play(ch, lineIndex = 0, forceProxy = false) {
  current = ch; destroy();
  // If this channel has a rotating-token official source, refresh line 1
  // at play time; on any failure fall back to the stored lines untouched.
  let sources = [...ch.sources];
  if (ch.refresh && ch.refresh.src && ch.refresh.id) {
    try {
      const r = await fetch(`/api/refresh?src=${encodeURIComponent(ch.refresh.src)}&id=${encodeURIComponent(ch.refresh.id)}`);
      const j = await r.json();
      if (j && typeof j.url === "string" && j.url.startsWith("http")) sources[0] = j.url;
    } catch {}
  }
  // attempt queue: each source direct, then same source via proxy
  queue = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    queue.push({ url: s, via: "直连", idx: i });
    queue.push({ url: proxy(s), via: "代理", idx: i });
  }
  // start at requested line
  let start = lineIndex * 2 + (forceProxy ? 1 : 0);
  queue = queue.slice(start).concat(queue.slice(0, start));
  attempt = lineIndex; renderLines(); renderGrid();
  tryNext(0);
}
function tryNext(pos) {
  if (pos >= queue.length) { setStatus(`<b>${current.name}</b> 所有线路都播不了：源可能已失效、403 或地区封锁。换个台试试，或者用下方导入补一条你自己的源。`); return; }
  const q = queue[pos]; attempt = q.idx; renderLines();
  setStatus(`正在试 <b>${current.name}</b> 线路${q.idx + 1}（${q.via}）… 第 ${pos + 1}/${queue.length} 次尝试`);
  const url = q.url;
  const onErr = () => tryNext(pos + 1);
  if (video.canPlayType("application/vnd.apple.mpegurl") && !window.Hls) {
    video.src = url; video.play().then(() => setStatus(`正在播 <b>${current.name}</b> · 线路${q.idx + 1}（${q.via}）`)).catch(onErr);
    video.onerror = onErr; return;
  }
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30 });
    hls.loadSource(url); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().then(() => setStatus(`正在播 <b>${current.name}</b> · 线路${q.idx + 1}（${q.via}）`)).catch(onErr));
    hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) { destroy(); onErr(); } });
  } else {
    video.src = url; video.play().then(() => setStatus(`正在播 <b>${current.name}</b> · 线路${q.idx + 1}（${q.via}）`)).catch(onErr);
  }
}
function parseM3U(text) {
  const lines = text.split(/\r?\n/); const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXTINF")) {
      const name = (lines[i].split(",").pop() || "").trim();
      const logo = (lines[i].match(/tvg-logo="([^"]*)"/) || [])[1] || "";
      const grp = (lines[i].match(/group-title="([^"]*)"/) || [])[1] || "我的导入";
      const next = (lines[i + 1] || "").trim();
      if (name && next.startsWith("http")) out.push({ name, group: "我的导入", logo, geo: false, sources: [next] });
    } else if (lines[i] && !lines[i].startsWith("#") && lines[i].startsWith("http")) {
      // plain txt: 台名,url on same line handled below
    }
  }
  // txt format: Name,url per line
  if (!out.length) {
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length >= 2 && parts[1].trim().startsWith("http")) out.push({ name: parts[0].trim(), group: "我的导入", logo: "", geo: false, sources: [parts[1].trim()] });
    }
  }
  return out;
}
$("#importBtn").onclick = async () => {
  const url = $("#importUrl").value.trim(); let text = $("#importText").value.trim();
  try {
    if (!text && url) {
      const r = await fetch(proxy(url)); text = await r.text();
    }
    if (!text) { $("#importMsg").textContent = "先粘一个订阅链接或 m3u 内容。"; return; }
    const chans = parseM3U(text);
    if (!chans.length) { $("#importMsg").textContent = "没解析到频道：请检查格式是不是 #EXTINF + url，或 台名,url。"; return; }
    for (const c of chans) {
      const ex = imported.find(x => x.name === c.name);
      if (ex) ex.sources = [...new Set([...ex.sources, ...c.sources])]; else imported.push(c);
    }
    saveImport(); currentGroup = "我的导入"; renderTabs(); renderGrid();
    $("#importMsg").textContent = `已导入 ${chans.length} 个台，到“我的导入”里找。`;
  } catch (e) { $("#importMsg").textContent = "导入失败：" + e.message + "（订阅链接可能需要走代理或本身已失效）"; }
};
$("#clearImportBtn").onclick = () => { imported = []; saveImport(); renderGrid(); $("#importMsg").textContent = "已清空我的导入。"; };
$("#search").addEventListener("input", renderGrid);

fetch("channels.json").then(r => r.json()).then(d => {
  all = d.channels;
  $("#total").textContent = all.length;
  setStatus(`已加载 ${all.length} 个台。点一个台开始看；央视多为 http 源，会先直连、失败自动走代理。`);
  renderTabs(); renderGrid();
  // auto-play a verified direct-playable channel first
  const first = all.find(c => c.name === "广东卫视") || all[0];
  if (first) play(first);
}).catch(e => setStatus("频道列表加载失败：" + e.message));
