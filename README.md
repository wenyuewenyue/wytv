# WyTV · 电视直播

Cloudflare Pages 纯静态站 + Pages Functions 代理（`functions/api/proxy.js`）。

- 内置频道：`channels.json`，由公开聚合源合并归一化生成（iptv-org 中国区/中文区、ChinaIPTV、YanG 咪咕源），2026-10-24 生成时共 392 个台。
- 播放：HLS.js（Chrome/安卓）+ Safari 原生 HLS；先直连，失败自动换线路、再走本站代理；http / 无 CORS 的央视源主要靠代理。
- 自导入：页面底部粘贴 m3u/txt 链接或内容，存 localStorage，只在自己设备上。
- 频道更新：重新跑一次频道聚合脚本生成新的 `channels.json` 并重新部署即可（后续可接 GitHub Actions 定时测活）。

部署（与 wyphoto/wygemini 同一路）：GitHub 仓库 `wenyuewenyue/wytv`（main，无构建，输出 `/`）→ Cloudflare Pages 项目 `wytv` → 自定义域名 `wyzhibo.2221314.xyz`（Parker 2026-10-24 22:23 改定，原拟 wytv.2221314.xyz 作废）。

注意：只聚合公开直播链接，不存储节目内容，版权归各电视台所有；付费、赛事版权、地区锁定、运营商内网台在网页端无解，请用官方 App / 运营商 IPTV。
