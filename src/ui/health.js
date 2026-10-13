// 1.3.4：加载体检——看看酒馆打开慢，慢在哪
// 酒馆每次打开，都会通过 /api/settings/get 把「全部预设文件」「设置文件（含所有扩展存的数据）」整个下载一遍；
// 角色卡列表、上次的聊天、各个扩展的脚本也都在打开时加载。这里把这些量出来，按占用排好，给出能做的事。

var PA_T = globalThis.__paTiming || (globalThis.__paTiming = { evalAt: performance.now(), readyAt: null });
try {
  performance.setResourceTimingBufferSize?.(4000);
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
  if (/\/api\/settings\/get/.test(p)) return { cat: "设置与全部预设", key: "settings" };
  if (/\/api\/characters\/(all|get)/.test(p)) return { cat: "角色卡", key: "chars" };
  if (/\/api\/chats\//.test(p)) return { cat: "聊天记录", key: "chats" };
  if (/\/api\/worldinfo\//.test(p)) return { cat: "世界书", key: "wi" };
  if (/\/thumbnail/.test(p) || /\/(characters|User Avatars)\//.test(p)) return { cat: "头像/缩略图", key: "thumb" };
  if (/\/backgrounds\//.test(p) || /\/api\/backgrounds/.test(p)) return { cat: "背景图", key: "bg" };
  if (/\/api\/extensions\//.test(p)) return { cat: "扩展管理（检查/更新）", key: "extapi" };
  if (/\/api\//.test(p)) return { cat: `接口 ${p.replace(/^.*\/api\//, "")}`, key: `api:${p}` };
  return { cat: "酒馆程序文件", key: "core" };
}
async function collectHealth() {
  const c2 = ctx();
  const out = { warn: [], tips: [] };
  // ---- 时间
  const nav = performance.getEntriesByType("navigation")[0];
  out.domReady = nav ? nav.domContentLoadedEventEnd : null;
  out.readyAt = PA_T.readyAt;
  out.evalAt = PA_T.evalAt;
  // ---- 预设（每次打开都整个下载）
  out.presets = [];
  for (const api of ["openai", "textgenerationwebui", "kobold", "novel"]) {
    try {
      const pmx = c2.getPresetManager(api);
      const list = pmx?.getPresetList?.();
      if (!list) continue;
      const names = Array.isArray(list.preset_names) ? list.preset_names : Object.keys(list.preset_names || {});
      const idxOf = (n) => Array.isArray(list.preset_names) ? list.preset_names.indexOf(n) : list.preset_names[n];
      for (const n of names) {
        const data = list.presets?.[idxOf(n)];
        if (data) out.presets.push({ api, name: n, size: jsonSize(data) });
      }
    } catch {
    }
  }
  out.presets.sort((a, b) => b.size - a.size);
  out.presetTotal = out.presets.reduce((n, x) => n + x.size, 0);
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
    const r = await fetch("/api/extensions/discover", { headers: c2.getRequestHeaders?.() || {} });
    if (r.ok) {
      const list = await r.json();
      const disabled = new Set(es.disabledExtensions || []);
      out.extTotal = list.filter((x) => x.type !== "system").length;
      out.extEnabled = list.filter((x) => x.type !== "system" && !disabled.has(x.name)).length;
    }
  } catch {
  }
  // ---- 打开时的请求（能记到多少算多少）
  const all = performance.getEntriesByType("resource");
  out.bufferFull = all.length === 250;
  // 只看「打开酒馆那一阵」的请求，之后你自己点出来的（检查更新之类）不算
  const cutoff = PA_T.readyAt ? PA_T.readyAt + 1500 : Infinity;
  const res = all.filter((r) => r.startTime <= cutoff);
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
  out.slow = res.filter((r) => r.duration > 300).sort((a, b) => b.duration - a.duration).slice(0, 8).map((r) => ({ ...categorize(r.name), dur: r.duration, size: r.transferSize || r.encodedBodySize || 0, url: r.name }));
  // ---- 建议
  const MB = 1024 * 1024;
  if (out.presetTotal > 5 * MB) out.warn.push({ t: `全部预设共 ${fmtSize(out.presetTotal)}（${out.presets.length} 个）。酒馆每次打开都会完整下载，这是云端酒馆加载慢的主要原因。`, d: "建议将不用的预设导出备份后，在酒馆中删除。最大的几个见下方列表。" });
  else if (out.presetTotal > 2 * MB) out.tips.push({ t: `预设共 ${fmtSize(out.presetTotal)}（${out.presets.length} 个），每次打开都会下载。`, d: "不常用的预设可导出备份后删除。" });
  const bigExt = out.extData.filter((x) => x.size > 512 * 1024);
  if (bigExt.length) out.warn.push({ t: `以下扩展在设置文件中存有大量数据：${bigExt.slice(0, 3).map((x) => `「${x.key}」${fmtSize(x.size)}`).join("、")}。`, d: "设置文件每次打开都要下载，每次修改设置都要完整上传。可查看这些扩展是否提供清理或导出旧数据的功能，不用的扩展可停用。" });
  if (out.charCount > 150 && !out.lazyChars) out.tips.push({ t: `角色卡共 ${out.charCount} 张，打开时全部读取。`, d: "如能修改服务器上的 config.yaml，可将 performance 下的 lazyLoadCharacters 设为 true（按需加载角色卡），然后重启酒馆。" });
  if (out.autoLoadChat && out.chatLen > 300) out.tips.push({ t: `打开时自动进入上次的聊天，该聊天共 ${out.chatLen} 楼（${fmtSize(out.chatSize)}）。`, d: "可在「用户设置」中关闭「自动加载上次聊天」；长聊天可新开存档，或总结后隐藏旧楼层。" });
  if (out.chatTruncation && out.chatTruncation > 100) out.tips.push({ t: `「一次加载的消息数」为 ${out.chatTruncation}。`, d: "可在「用户设置」中调小（如 30～50），进入聊天会明显加快，向上翻阅时可继续加载。" });
  if (out.extEnabled != null && out.extEnabled > 15) out.tips.push({ t: `已开启 ${out.extEnabled} 个第三方扩展。`, d: "每个扩展在打开时都要加载脚本和设置，「加速」类扩展本身也会增加加载量。不常用的扩展可在扩展管理中停用，无需卸载。" });
  const slowExt = out.groups.filter((g) => g.cat.startsWith("扩展「") && g.max > 1500);
  if (slowExt.length) out.tips.push({ t: `加载较慢的扩展：${slowExt.slice(0, 4).map((g) => `${g.cat.replace(/^扩展/, "")}（最长 ${fmtMs(g.max)}）`).join("、")}。`, d: "可先停用，比较打开速度是否改善。" });
  const ext = out.groups.filter((g) => g.cat.startsWith("外部：") && g.max > 1500);
  if (ext.length) out.tips.push({ t: `有扩展从外部网站加载资源：${ext.slice(0, 3).map((g) => `${g.cat.replace(/^外部：/, "")}（最长 ${fmtMs(g.max)}）`).join("、")}。`, d: "这些网站在国内可能访问缓慢或无法访问，会拖慢整个打开过程。" });
  return out;
}
function mountHealth(sec) {
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
    box.innerHTML = `
      <div class="pa-verdict ${r.warn.length ? "pa-bad" : "pa-good"}">
        <p>${r.readyAt ? `本次打开到可用耗时 <b>${fmtMs(r.readyAt)}</b>（页面本身 ${fmtMs(r.domReady)}）。` : `页面本身加载耗时 <b>${fmtMs(r.domReady)}</b>。`}</p>
        <p>每次打开需下载：全部预设 <b>${fmtSize(r.presetTotal)}</b>，扩展数据 <b>${fmtSize(r.extDataTotal)}</b>，角色卡 ${r.charCount} 张${r.lazyChars ? "（按需加载）" : ""}。</p>
        ${r.settingsReq ? `<p>其中「设置与全部预设」请求耗时 <b>${fmtMs(r.settingsReq.max)}</b>${r.settingsReq.size ? `（传输 ${fmtSize(r.settingsReq.size)}）` : ""}。</p>` : ""}
      </div>
      ${r.warn.map((w) => `<div class="pa-card pa-card-warn"><p><b>${esc(w.t)}</b></p><small>${esc(w.d)}</small></div>`).join("")}
      ${r.tips.map((w) => `<div class="pa-card"><p>${esc(w.t)}</p><small>${esc(w.d)}</small></div>`).join("")}
      <h3 class="pa-h">最大的预设</h3>
      <div class="pa-rank">${r.presets.slice(0, 8).map((p) => `<div><span>${esc(p.name)}</span>${bar(p.size, maxP)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">未读取到</p>'}</div>
      <h3 class="pa-h">扩展在设置文件中的数据</h3>
      <div class="pa-rank">${r.extData.filter((p) => p.size >= 1024).slice(0, 8).map((p) => `<div><span>${esc(p.key)}</span>${bar(p.size, maxE)}<em>${fmtSize(p.size)}</em></div>`).join("") || '<p class="pa-hint">均小于 1 KB。</p>'}</div>
      <h3 class="pa-h">本次打开时最慢的请求</h3>
      ${r.slow.length ? `<div class="pa-rank">${r.slow.map((s) => `<div title="${esc(s.url)}"><span>${esc(s.cat)}</span>${bar(s.dur, r.slow[0].dur)}<em>${fmtMs(s.dur)}${s.size ? ` · ${fmtSize(s.size)}` : ""}</em></div>`).join("")}</div>` : '<p class="pa-hint">没有超过 0.3 秒的请求，或未记录到。</p>'}
      ${r.bufferFull ? '<p class="pa-hint">浏览器只记录前 250 个请求，其余请求未计入。</p>' : ""}
      <p class="pa-hint">${r.extEnabled != null ? `第三方扩展：已开启 ${r.extEnabled} 个，共安装 ${r.extTotal} 个。` : ""}世界书 ${r.worldCount} 本。检查只在本浏览器中进行，不上传任何数据。</p>
      <p class="pa-hint">如仅在长时间未使用后首次打开较慢，通常是云服务器休眠后重新启动，与预设和扩展无关，需更换不休眠的套餐或设置保活。</p>`;
  }
  sec.querySelector("[data-h=run]").addEventListener("click", run);
  let ran = false;
  return {
    render() {
      if (ran) return;
      ran = true;
      run();
    }
  };
}
