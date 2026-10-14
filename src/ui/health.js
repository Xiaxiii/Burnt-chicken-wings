// 1.3.4：加载体检——看看酒馆打开慢，慢在哪
// 酒馆每次打开，都会通过 /api/settings/get 把「全部预设文件」「设置文件（含所有扩展存的数据）」整个下载一遍；
// 角色卡列表、上次的聊天、各个扩展的脚本也都在打开时加载。这里把这些量出来，按占用排好，给出能做的事。

var PA_T = globalThis.__paTiming || (globalThis.__paTiming = { evalAt: performance.now(), readyAt: null });
// 浏览器默认只记 250 条请求，记满后的会丢掉。先看扩展加载前是不是已经记满，再把上限调大
try {
  const RT_LIMIT = 4000;
  if (PA_T.bufFullBefore === void 0) PA_T.bufFullBefore = performance.getEntriesByType("resource").length >= 250;
  performance.setResourceTimingBufferSize?.(RT_LIMIT);
  performance.addEventListener?.("resourcetimingbufferfull", () => { PA_T.bufFullLater = true; });
} catch {
}
function fmtSize(n) {
  if (!n) return "0";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtMs(ms) {
  if (ms == null) return "—";
  return ms < 1e3 ? `${Math.round(ms)} 毫秒` : `${(ms / 1e3).toFixed(1)} 秒`;
}
function jsonSize(v) {
  try {
    return new Blob([JSON.stringify(v ?? null)]).size;
  } catch {
    return 0;
  }
}
function categorize(url) {
  let u;
  try {
    u = new URL(url, location.href);
  } catch {
    return { cat: "其他", key: url };
  }
  const p = decodeURIComponent(u.pathname);
  if (u.origin !== location.origin) return { cat: `外部：${u.host}`, key: `ext:${u.host}` };
  let m = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(p);
  if (m) return { cat: `扩展「${m[1]}」`, key: `tp:${m[1]}`, ext: m[1] };
  // 1.5.0：百宝箱等扩展会用自己的接口代替 /api/settings/get，下载的是同一份数据
  if (/\/api\/settings\/get|\/settings\/fast-get/.test(p)) return { cat: "设置与全部预设", key: "settings" };
  if (/\/api\/settings\/save|\/settings\/fast-save/.test(p)) return { cat: "保存设置", key: "settingsSave" };
  if (/\/api\/characters\/(all|get)/.test(p)) return { cat: "角色列表", key: "chars" };
  if (/\/api\/chats\//.test(p)) return { cat: "聊天记录", key: "chats" };
  if (/\/api\/worldinfo\//.test(p)) return { cat: "世界书", key: "wi" };
  if (/\/thumbnail/.test(p) || /\/(characters|User Avatars)\//.test(p)) return { cat: "头像/缩略图", key: "thumb" };
  if (/\/backgrounds\//.test(p) || /\/api\/backgrounds/.test(p)) return { cat: "背景图", key: "bg" };
  if (/\/api\/extensions\//.test(p)) return { cat: "扩展管理（检查/更新）", key: "extapi" };
  if (/\/api\//.test(p)) return { cat: `接口 ${p.replace(/^.*\/api\//, "")}`, key: `api:${p}` };
  return { cat: "酒馆程序文件", key: "core" };
}
var PRESET_APIS = [["openai", "聊天补全"], ["textgenerationwebui", "文本补全"], ["kobold", "KoboldAI"], ["novel", "NovelAI"]];
// 全部预设的大小（酒馆打开时，这几类预设都会随设置一起下载）
function allPresetSizes() {
  const out = [];
  for (const [api] of PRESET_APIS) {
    try {
      const list = ctx().getPresetManager(api)?.getPresetList?.();
      if (!list) continue;
      const names = Array.isArray(list.preset_names) ? list.preset_names : Object.keys(list.preset_names || {});
      const idxOf = (n) => Array.isArray(list.preset_names) ? list.preset_names.indexOf(n) : list.preset_names[n];
      for (const n of names) {
        if (api === "openai" && n === "gui") continue;
        const data = api === "openai" && n === currentPresetName() ? (() => { try { return readPreset(n); } catch { return null; } })() : list.presets?.[idxOf(n)];
        if (data) out.push({ api, name: n, size: jsonSize(data) });
      }
    } catch {
    }
  }
  return out.sort((a, b) => b.size - a.size);
}
// 估算：这么多字节的预设，压缩后要传多少、要下载几秒。体检和清理页用同一套算法，数字一致
function wireEstimate(bytes) {
  const m = measureLoad();
  const raw = allPresetSizes().reduce((n, x) => n + x.size, 0) + jsonSize(ctx().extensionSettings || {});
  if (!m.settingsOnce || !raw) return null;
  const wire = bytes * Math.min(1, m.settingsOnce / raw);
  const rate = m.rate;
  return { wire, secs: rate ? wire / rate : null, times: m.settingsCount };
}
async function collectHealth() {
  const c2 = ctx();
  const out = { warn: [], tips: [] };
  // ---- 时间
  const nav = performance.getEntriesByType("navigation")[0];
  out.domReady = nav ? nav.domContentLoadedEventEnd : null;
  out.readyAt = PA_T.readyAt;
  out.evalAt = PA_T.evalAt;
  // ---- 预设（每次打开都整个下载）：聊天补全，以及文本补全、Kobold、NovelAI 的预设
  out.presets = allPresetSizes();
  out.presetTotal = out.presets.reduce((n, x) => n + x.size, 0);
  out.presetByApi = PRESET_APIS.map(([api, label]) => {
    const l = out.presets.filter((x) => x.api === api);
    return { api, label, n: l.length, size: l.reduce((n, x) => n + x.size, 0) };
  }).filter((x) => x.n);
  // ---- 设置文件里各扩展存的数据（每次打开下载、每次保存上传）
  const es = c2.extensionSettings || {};
  out.extData = Object.keys(es).map((k) => ({ key: k, size: jsonSize(es[k]) })).sort((a, b) => b.size - a.size);
  out.extDataTotal = out.extData.reduce((n, x) => n + x.size, 0);
  // ---- 角色卡、聊天
  const chars = c2.characters || [];
  out.charCount = chars.length;
  out.charSize = jsonSize(chars);
  out.lazyChars = chars.length > 0 && chars.some((ch) => ch?.shallow);
  out.chatLen = (c2.chat || []).length;
  out.chatSize = jsonSize(c2.chat || []);
  const pu = c2.powerUserSettings || {};
  out.autoLoadChat = pu.auto_load_chat;
  out.chatTruncation = pu.chat_truncation;
  out.worldCount = (mods.wi?.world_names || []).length;
  // ---- 扩展数量
  try {
    const r = await fetch(stUrl("api/extensions/discover"), { headers: c2.getRequestHeaders?.() || {} });
    if (r.ok) {
      const list = await r.json();
      const disabled = new Set(es.disabledExtensions || []);
      out.extTotal = list.filter((x) => x.type !== "system").length;
      out.extEnabled = list.filter((x) => x.type !== "system" && !disabled.has(x.name)).length;
    }
  } catch {
  }
  // ---- 打开时的请求（能记到多少算多少）
  Object.assign(out, measureLoad());
  const res = out.res;
  const groups = /* @__PURE__ */ new Map();
  for (const r of res) {
    const { cat, key } = categorize(r.name);
    if (!groups.has(key)) groups.set(key, { cat, n: 0, dur: 0, max: 0, size: 0 });
    const g = groups.get(key);
    g.n++;
    g.dur += r.duration;
    g.max = Math.max(g.max, r.duration);
    g.size += r.transferSize || r.encodedBodySize || 0;
  }
  out.groups = [...groups.values()].sort((a, b) => b.max - a.max);
  out.settingsReq = groups.get("settings") || null;
  // 很小的请求等了很久，是在排队（同一服务器最多同时 6 个连接），不算「慢」
  const isQueued = (r) => (r.transferSize || r.encodedBodySize || 0) < 64 * 1024 && r.duration > 3000 && categorize(r.name).key !== "settingsSave";
  out.queued = res.filter(isQueued);
  out.slow = res.filter((r) => r.duration > 300 && !isQueued(r)).sort((a, b) => b.duration - a.duration).slice(0, 8).map((r) => ({ ...categorize(r.name), dur: r.duration, size: r.transferSize || r.encodedBodySize || 0, url: r.name }));
  // ---- 时间线
  const span = (list) => list.length ? { start: Math.min(...list.map((r) => r.startTime)), end: Math.max(...list.map((r) => r.responseEnd || r.startTime + r.duration)) } : null;
  const of = (key) => res.filter((r) => categorize(r.name).key === key);
  out.timeline = [
    { label: "页面", ...(out.domReady ? { start: 0, end: out.domReady } : {}) },
    { label: "设置与全部预设", ...span(of("settings")), n: of("settings").length },
    { label: "角色列表", ...span(of("chars")) },
    { label: "扩展脚本", ...span(res.filter((r) => /\/scripts\/extensions\/third-party\//.test(r.name))) },
    { label: "头像等小文件排队", ...span(out.queued), n: out.queued.length }
  ].filter((x) => x.end != null);
  // ---- 建议
  const MB = 1024 * 1024;
  const bw = out.bandwidth;
  const sec = (bytes) => bw ? fmtMs(bytes / bw * 1000) : null;
  if (out.settingsCount > 1) out.warn.push({ t: `「设置与全部预设」本次下载了 ${out.settingsCount} 次（共 ${fmtSize(out.settingsBytes)}）。`, d: "正常只需下载一次。常见原因是同时开启了两个「启动加速」类功能，例如百宝箱的「Settings get/save 加速」和鸡尾酒的「启动加载优化」，保留其中一个即可；两个都关闭时，酒馆本身也可能下载两次。" });
  // 预设在设置下载里大约占多少（按未压缩大小的比例估算）
  const est = wireEstimate(out.presetTotal);
  const byApi = out.presetByApi.length > 1 ? `（${out.presetByApi.map((x) => `${x.label} ${x.n} 个 ${fmtSize(x.size)}`).join("，")}）` : `（${out.presets.length} 个）`;
  const others = out.presetByApi.filter((x) => x.api !== "openai");
  if (out.presetTotal > 5 * MB) out.warn.push({ t: `全部预设共 ${fmtSize(out.presetTotal)}${byApi}${est ? `，压缩传输约 ${fmtSize(est.wire)}` : ""}${est?.secs ? `，按本次实测速度约需 ${fmtMs(est.secs * 1000)}` : ""}。酒馆每次打开都会完整下载。`, d: `不常用的聊天补全预设可在「清理」中归档：移到服务器上的另一个位置，打开时不再下载，需要时可恢复。${others.length ? `${others.map((x) => x.label).join("、")}预设「清理」页不处理，可在酒馆对应的预设菜单中删除。` : ""}`, act: "clean" });
  else if (out.presetTotal > 2 * MB) out.tips.push({ t: `预设共 ${fmtSize(out.presetTotal)}（${out.presets.length} 个），每次打开都会下载。`, d: "不常用的预设可在「清理」中归档。", act: "clean" });
  if (out.queued.length >= 3) {
    const longest = Math.max(...out.queued.map((r) => r.duration));
    out.tips.push({ t: `${out.queued.length} 个很小的请求（头像等）最长等待了 ${fmtMs(longest)}。`, d: "它们本身只有几百字节，时间都花在排队上：浏览器对同一服务器最多同时建立 6 个连接，前面有大文件在下载时，后面的请求只能等待。减少大文件（预设、角色列表）的下载量，排队也会随之缩短。" });
  }
  if (out.saveDuringLoad) out.tips.push({ t: "打开过程中有扩展保存了一次设置。", d: "保存需要把整个设置文件上传一遍，会和打开时的下载争用带宽。如果每次打开都出现，可逐个停用扩展，找出是哪一个。" });
  const bigExt = out.extData.filter((x) => x.size > 512 * 1024);
  if (bigExt.length) out.warn.push({ t: `以下扩展在设置文件中存有大量数据：${bigExt.slice(0, 3).map((x) => `「${x.key}」${fmtSize(x.size)}`).join("、")}。`, d: "设置文件每次打开都要下载，每次修改设置都要完整上传。可查看这些扩展是否提供清理或导出旧数据的功能，不用的扩展可停用。" });
  if (out.charCount > 150 && !out.lazyChars) out.tips.push({ t: `角色卡共 ${out.charCount} 张，打开时全部读取。`, d: "如能修改服务器上的 config.yaml，可将 performance 下的 lazyLoadCharacters 设为 true（按需加载角色卡），然后重启酒馆。" });
  if (out.autoLoadChat && out.chatLen > 300) out.tips.push({ t: `打开时自动进入上次的聊天，该聊天共 ${out.chatLen} 楼（${fmtSize(out.chatSize)}）。`, d: "可在「用户设置」中关闭「自动加载上次聊天」；长聊天可新开存档，或总结后隐藏旧楼层。" });
  if (out.chatTruncation && out.chatTruncation > 100) out.tips.push({ t: `「一次加载的消息数」为 ${out.chatTruncation}。`, d: "可在「用户设置」中调小（如 30～50），进入聊天会明显加快，向上翻阅时可继续加载。" });
  if (out.extEnabled != null && out.extEnabled > 15) out.tips.push({ t: `已开启 ${out.extEnabled} 个第三方扩展。`, d: "每个扩展在打开时都要加载脚本和设置。不常用的扩展可在扩展管理中停用，无需卸载。" });
  const slowExt = out.groups.filter((g) => g.cat.startsWith("扩展「") && g.max > 1500);
  if (slowExt.length) out.tips.push({ t: `加载较慢的扩展：${slowExt.slice(0, 4).map((g) => `${g.cat.replace(/^扩展/, "")}（最长 ${fmtMs(g.max)}）`).join("、")}。`, d: "可先停用，比较打开速度是否改善。" });
  const ext = out.groups.filter((g) => g.cat.startsWith("外部：") && g.max > 1500);
  if (ext.length) out.tips.push({ t: `有扩展从外部网站加载资源：${ext.slice(0, 3).map((g) => `${g.cat.replace(/^外部：/, "")}（最长 ${fmtMs(g.max)}）`).join("、")}。`, d: "这些网站在国内可能访问缓慢或无法访问，会拖慢整个打开过程。" });
  return out;
}
// 打开那一阵的请求：设置下载了几次、多大、服务器实测速度。「清理」页也用它来估算能快多少。
function measureLoad() {
  const all = performance.getEntriesByType("resource");
  // 只看「打开酒馆那一阵」的请求，之后自己点出来的（检查更新之类）不算
  const cutoff = PA_T.readyAt ? PA_T.readyAt + 1500 : Infinity;
  const res = all.filter((r) => r.startTime <= cutoff);
  const sizeOf = (r) => r.transferSize || r.encodedBodySize || 0;
  const settings2 = res.filter((r) => categorize(r.name).key === "settings");
  const settingsBytes = settings2.reduce((n, r) => n + sizeOf(r), 0);
  // 实测速度：把所有同源请求「正在接收数据」的时间段合并，总字节数 ÷ 忙碌的总时长
  const same = (r) => { try { return new URL(r.name, location.href).origin === location.origin; } catch { return false; } };
  const spans = res.filter((r) => same(r) && sizeOf(r) > 0 && r.responseStart > 0 && r.responseEnd > r.responseStart).map((r) => [r.responseStart, r.responseEnd, sizeOf(r)]).sort((a, b) => a[0] - b[0]);
  let busy = 0, bytes = 0, curS = -1, curE = -1;
  for (const [s, e, n] of spans) {
    bytes += n;
    if (s > curE) {
      if (curE > curS) busy += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE > curS) busy += curE - curS;
  // 太少的数据量测不准（本地酒馆、缓存命中），不给速度
  const bandwidth = bytes > 2 * 1024 * 1024 && busy > 2000 ? bytes / (busy / 1000) : null;
  // 设置文件自己的下载速度（只算它接收数据的那段时间），用来估算预设要下载多久，比整体平均更准
  const big = settings2.slice().sort((a, b) => sizeOf(b) - sizeOf(a))[0];
  const dl = big && big.responseStart > 0 ? big.responseEnd - big.responseStart : 0;
  const settingsRate = big && dl > 500 && sizeOf(big) > 512 * 1024 ? sizeOf(big) / (dl / 1000) : null;
  return {
    res,
    bufferFull: !!(PA_T.bufFullBefore || PA_T.bufFullLater),
    settingsCount: settings2.length,
    settingsBytes,
    settingsOnce: settings2.length ? Math.max(...settings2.map(sizeOf)) : 0,
    bandwidth,
    settingsRate,
    rate: settingsRate || bandwidth,
    saveDuringLoad: PA_T.readyAt ? res.some((r) => categorize(r.name).key === "settingsSave" && r.startTime < PA_T.readyAt) : false
  };
}
function mountHealth(sec, { goClean } = {}) {
  sec.innerHTML = `<div class="pa-scroll pa-health"><div class="pa-health-body"><p class="pa-hint">正在检查…</p></div>
    <div class="pa-card-act"><button class="pa-btn" data-h="run">重新检查</button></div></div>`;
  const box = sec.querySelector(".pa-health-body");
  async function run() {
    box.innerHTML = '<p class="pa-hint">正在检查…</p>';
    let r;
    try {
      r = await collectHealth();
    } catch (e) {
      box.innerHTML = `<p class="pa-warn">检查出错：${esc(e.message)}</p>`;
      return;
    }
    const bar = (v, max) => `<i class="pa-bar"><b style="width:${Math.max(2, Math.round(v / (max || 1) * 100))}%"></b></i>`;
    const maxP = r.presets[0]?.size || 1;
    const maxE = r.extData[0]?.size || 1;
    const total = Math.max(r.readyAt || 0, ...r.timeline.map((t) => t.end)) || 1;
    const pct = (v) => `${Math.max(0, Math.min(100, v / total * 100)).toFixed(2)}%`;
    const card = (w, warn) => `<div class="pa-card ${warn ? "pa-card-warn" : ""}"><p>${warn ? `<b>${esc(w.t)}</b>` : esc(w.t)}</p><small>${esc(w.d)}</small>${w.act === "clean" && goClean ? '<div class="pa-card-act"><button class="pa-btn pa-btn-soft pa-btn-s" data-h="clean">去清理</button></div>' : ""}</div>`;
    box.innerHTML = `
      <div class="pa-verdict ${r.warn.length ? "pa-bad" : "pa-good"}">
        <p>${r.readyAt ? `本次打开到可用耗时 <b>${fmtMs(r.readyAt)}</b>（页面本身 ${fmtMs(r.domReady)}）。` : `页面本身加载耗时 <b>${fmtMs(r.domReady)}</b>。`}</p>
        <p>每次打开需下载：全部预设 <b>${fmtSize(r.presetTotal)}</b>${r.presetByApi.length > 1 ? `（${r.presetByApi.map((x) => `${x.label} ${fmtSize(x.size)}`).join("，")}）` : ""}，扩展数据 <b>${fmtSize(r.extDataTotal)}</b>，角色卡 ${r.charCount} 张${r.lazyChars ? "（按需加载）" : ""}。</p>
        ${r.rate ? `<p>本次实测服务器下载速度约 <b>${fmtSize(r.rate)}/秒</b>。${r.rate < 600 * 1024 ? "速度较低，下载量对打开时间影响很大。" : ""}</p>` : ""}
      </div>
      ${r.timeline.length > 1 ? `<h3 class="pa-h">打开过程</h3>
      <div class="pa-tl">${r.timeline.map((t) => `<div><span>${esc(t.label)}${t.n > 1 ? `<i>×${t.n}</i>` : ""}</span><i class="pa-tl-track"><b style="left:${pct(t.start)};width:${pct(Math.max(t.end - t.start, total * 0.006))}"></b></i><em>${fmtMs(t.end)}</em></div>`).join("")}
        ${r.readyAt ? `<div class="pa-tl-ready"><span>可用</span><i class="pa-tl-track"><b style="left:${pct(r.readyAt)}"></b></i><em>${fmtMs(r.readyAt)}</em></div>` : ""}</div>
      <p class="pa-hint">每一行是该类请求从开始到结束的时间段，右侧是结束于打开后第几秒。</p>` : ""}
      ${r.warn.map((w) => card(w, true)).join("")}
      ${r.tips.map((w) => card(w, false)).join("")}
      <h3 class="pa-h">最大的预设</h3>
      <div class="pa-rank">${r.presets.slice(0, 8).map((p) => `<div><span>${p.api !== "openai" ? `<i class="pa-dim">${esc(PRESET_APIS.find(([a]) => a === p.api)?.[1] || "")}·</i>` : ""}${esc(p.name)}</span>${bar(p.size, maxP)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">未读取到</p>'}</div>
      <h3 class="pa-h">扩展在设置文件中的数据</h3>
      <div class="pa-rank">${r.extData.filter((p) => p.size >= 1024).slice(0, 8).map((p) => `<div><span>${esc(p.key)}</span>${bar(p.size, maxE)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">均小于 1 KB。</p>'}</div>
      <h3 class="pa-h">本次打开时最慢的请求</h3>
      ${r.slow.length ? `<div class="pa-rank">${r.slow.map((s) => `<div title="${esc(s.url)}"><span>${esc(s.cat)}</span>${bar(s.dur, r.slow[0].dur)}<em>${fmtMs(s.dur)}${s.size ? ` · ${fmtSize(s.size)}` : ""}</em></div>`).join("")}</div>` : '<p class="pa-hint">没有超过 0.3 秒的请求，或未记录到。</p>'}
      ${r.queued.length ? `<p class="pa-hint">另有 ${r.queued.length} 个小请求因排队等待较久，未列入上表。</p>` : ""}
      ${r.bufferFull ? '<p class="pa-hint">浏览器的请求记录满过，有一部分请求没有记下来，上面的统计不完整。</p>' : ""}
      <p class="pa-hint">${r.extEnabled != null ? `第三方扩展：已开启 ${r.extEnabled} 个，共安装 ${r.extTotal} 个。` : ""}世界书 ${r.worldCount} 本。检查只在本浏览器中进行，不上传任何数据。</p>
      <p class="pa-hint">如仅在长时间未使用后首次打开较慢，通常是云服务器休眠后重新启动，与预设和扩展无关，需更换不休眠的套餐或设置保活。</p>`;
  }
  sec.querySelector("[data-h=run]").addEventListener("click", run);
  box.addEventListener("click", (e) => {
    if (e.target.closest("[data-h=clean]")) goClean?.();
  });
  // 每次切到这一页都重新检查（清理、归档之后数字会变）
  let last = 0;
  return {
    render() {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      run();
    }
  };
}
