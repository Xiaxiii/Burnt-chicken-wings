// 运行时：启动、事件、入口（魔棒菜单、悬浮球、斜杠命令）、换聊天套用方案、扩展更新（原 ui/app.js 的非视图部分）
var cleanups = [];

// 1.3.4：扩展页里的设置框，照酒馆扩展的标准样子做：标题带版本号，按钮横排，能检查更新、看更新说明
var EXT_DIR = (() => {
  if (BUILD_KIND !== "extension") return null;
  try {
    return (/\/third-party\/([^/?#]+)\//.exec(decodeURIComponent(import.meta.url)) || [])[1] || null;
  } catch {
    return null;
  }
})();

function changelogSections() {
  const parts = String(CHANGELOG || "").split(/\n(?=\d+\.\d+(?:\.\d+)?[^\n]*\n)/);
  return parts.slice(1).map((t) => {
    const nl = t.indexOf("\n");
    return { head: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() };
  });
}

async function extensionType() {
  try {
    const r = await fetch(stUrl("api/extensions/discover"), { headers: ctx().getRequestHeaders?.() || {} });
    const list = r.ok ? await r.json() : [];
    return list.find((x) => x.name === `third-party/${EXT_DIR}`)?.type || "local";
  } catch {
    return "local";
  }
}

async function extApi(path) {
  const r = await fetch(stUrl(`api/extensions/${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
    body: JSON.stringify({ extensionName: EXT_DIR, global: await extensionType() === "global" })
  });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || r.statusText || `HTTP ${r.status}`);
  return r.json();
}

async function manifestVersion(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? String((await r.json())?.version || "") : "";
  } catch {
    return "";
  }
}

// 1.5.1：iOS Safari 在页面顶部下拉会刷新整页（酒馆没有关掉这个行为），玩着玩着就被刷新了。
// 给 html、body 加 overscroll-behavior-y: none 即可阻止（Safari 16 起支持）。只影响「拖到顶再往下拖」，不影响正常滚动。
function applyPullGuard() {
  let st = document.getElementById("cw-pull-guard");
  const on = settings().noPullRefresh !== false;
  if (on && !st) {
    st = document.createElement("style");
    st.id = "cw-pull-guard";
    st.textContent = "html, body { overscroll-behavior-y: none; }";
    document.head.append(st);
  } else if (!on && st) st.remove();
}

// 2.3.5 悬浮球：点一下打开，按住拖动换位置，松手贴到左右边。默认关闭，扩展页设置框和「更多 → 外观」里开关
var BALL = 44, BALL_GAP = 8;

// 2.5.4 入口自选：魔棒菜单、悬浮球、两个都要；2.6.1 加「都不要」，这时从扩展页的「打开」按钮或 /atelier 打开。
// 以前开了悬浮球的（floatBall），魔棒菜单也一直在，算「两个都要」
var ENTRY_MODES = [["wand", "魔棒菜单"], ["ball", "悬浮球"], ["both", "两个都要"], ["none", "都不要"]];

var NO_ENTRY_NOTE = "从扩展页设置框点「打开」，或在聊天输入框发送 /atelier。";

function entryMode() {
  const s = settings();
  if (ENTRY_MODES.some(([k]) => k === s.entry)) return s.entry;
  return s.floatBall === true ? "both" : "wand";
}

function setEntryMode(mode) {
  if (!ENTRY_MODES.some(([k]) => k === mode)) return;
  settings().entry = mode;
  settings().floatBall = mode === "ball" || mode === "both";
  saveSettings();
  applyFloatBall();
  applyMenuEntry();
  const sel = document.querySelector("#cw-settings [data-opt=entry]");
  if (sel) sel.value = mode;
  document.querySelectorAll("#cw-root [data-entry]").forEach((b) => b.classList.toggle("on", b.dataset.entry === mode));
  document.querySelectorAll(".cw-noentry").forEach((n) => { n.hidden = mode !== "none"; });
}

// 魔棒菜单项用 display 藏：酒馆给菜单项的 flex 样式会盖过 hidden 属性
function applyMenuEntry() {
  const item = document.getElementById("cw-menu-entry");
  if (item) item.style.display = entryMode() === "ball" || entryMode() === "none" ? "none" : "";
}

function addMenuEntry() {
  if (document.getElementById("cw-menu-entry")) return;
  const menu = document.getElementById("extensionsMenu");
  if (!menu) return;
  const item = el(`<div id="cw-menu-entry" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
        <div class="fa-solid fa-scissors extensionsMenuExtensionButton"></div><span class="cw-appname">${esc(appName())}</span></div>`);
  item.addEventListener("click", () => open());
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
  menu.append(item);
  applyMenuEntry();
  // 别的扩展加载有先有后，有的晚于本扩展才往魔棒菜单里加，本项的位置就会跟着变。始终把它挪回最下面
  const keepLast = new MutationObserver(() => {
    if (item.isConnected && item.parentElement === menu && menu.lastElementChild !== item) menu.append(item);
  });
  keepLast.observe(menu, { childList: true });
  cleanups.push(() => keepLast.disconnect());
}

// 位置按可移动范围的比例存，换横竖屏、改窗口大小后仍在同一侧
function placeBall(ball) {
  const p = settings().floatBallPos || { x: 1, y: 0.6 };
  const w = window.innerWidth, h = window.innerHeight;
  ball.style.left = Math.round(BALL_GAP + Math.min(1, Math.max(0, p.x)) * Math.max(0, w - BALL - BALL_GAP * 2)) + "px";
  ball.style.top = Math.round(BALL_GAP + Math.min(1, Math.max(0, p.y)) * Math.max(0, h - BALL - BALL_GAP * 2)) + "px";
}

function applyFloatBall() {
  let ball = document.getElementById("cw-ball");
  if (entryMode() === "wand" || entryMode() === "none") return ball?.remove();
  if (ball) return placeBall(ball);
  ball = el(`<button id="cw-ball" type="button" aria-label="打开${esc(appName())}" title="${esc(appName())}"><i class="fa-solid fa-scissors"></i></button>`);
  let start = null, moved = false, frame = 0, dx = 0, dy = 0;
  // 酒馆在 html 上监听 mousedown/touchstart，点到抽屉外就收起打开着的抽屉（扩展页等）。拖球、点球都不该让它收起
  for (const t of ["mousedown", "touchstart", "click"]) ball.addEventListener(t, (e) => e.stopPropagation());
  // 拖动时只改 transform，每帧最多一次，不触发重新排版；松手再落到 left/top
  const paint = () => {
    frame = 0;
    ball.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };
  ball.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    const r = ball.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: window.innerWidth, h: window.innerHeight };
    moved = false;
    try { ball.setPointerCapture(e.pointerId); } catch {}
  });
  ball.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!moved) { moved = true; ball.classList.add("cw-ball-drag"); }
    dx = Math.min(start.w - BALL, Math.max(0, start.left + e.clientX - start.x)) - start.left;
    dy = Math.min(start.h - BALL, Math.max(0, start.top + e.clientY - start.y)) - start.top;
    if (!frame) frame = requestAnimationFrame(paint);
  });
  const drop = () => {
    if (!start) return;
    const s0 = start;
    start = null;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!moved) return;
    const left = s0.left + dx, top = s0.top + dy;
    ball.style.left = left + "px";
    ball.style.top = top + "px";
    ball.style.transform = "";
    dx = dy = 0;
    settings().floatBallPos = { x: left + BALL / 2 < s0.w / 2 ? 0 : 1, y: Math.min(1, Math.max(0, (top - BALL_GAP) / Math.max(1, s0.h - BALL - BALL_GAP * 2))) };
    saveSettings();
    // 贴边：先落到最终位置，再用 transform 从松手处滑过去（不逐帧改 left/top）
    ball.classList.remove("cw-ball-drag");
    placeBall(ball);
    const fx = left - parseFloat(ball.style.left), fy = top - parseFloat(ball.style.top);
    if ((fx || fy) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      ball.animate?.([{ transform: `translate3d(${fx}px, ${fy}px, 0)` }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.23, 1, .32, 1)" });
    }
  };
  ball.addEventListener("pointerup", drop);
  ball.addEventListener("pointercancel", drop);
  // 拖动结束时浏览器还会补发一次 click，不算打开
  ball.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    if (shellRoot && !shellRoot.hidden) return;
    open();
  });
  if (shellRoot && !shellRoot.hidden) ball.hidden = true;
  document.body.append(ball);
  placeBall(ball);
}

function registerSlash() {
  try {
    const c2 = ctx();
    if (c2.SlashCommandParser && c2.SlashCommand) {
      c2.SlashCommandParser.addCommandObject(c2.SlashCommand.fromProps({
        name: "atelier",
        aliases: ["焦香鸡翅"],
        helpString: "打开焦香鸡翅",
        callback: () => {
          open();
          return "";
        }
      }));
    } else if (c2.registerSlashCommand) {
      c2.registerSlashCommand("atelier", () => {
        open();
        return "";
      }, ["焦香鸡翅"], "打开焦香鸡翅");
    }
  } catch (e) {
    console.warn("[焦香鸡翅] 注册斜杠命令失败", e);
  }
}

var applying = false;

// 自动套用只在「进入一个聊天」时做一次。酒馆和别的扩展在同一个聊天里也会反复发出聊天切换事件
// （重新载入聊天、改角色卡等），以前每次都套用，手动换的预设会被立刻换回去。现在同一个聊天只处理一次。
var handledChat = null;

function chatKeyNow() {
  try {
    return String(ctx().getCurrentChatId?.() || ctx().chatId || "");
  } catch {
    return "";
  }
}

function markChatHandled() {
  handledChat = chatKeyNow();
}

// 换角色、换聊天时弹一个小提示：现在用的预设和模型（3 秒后消失）
function chatInfoToast(scheme) {
  if (settings().chatToast === false) return;
  try {
    if ((ctx().mainApi || $("#main_api").val()) !== "openai") return;
    const t = globalThis.toastr;
    const preset = currentPresetName() || "（未选预设）";
    const model = liveConnection().model || "（未选模型）";
    const msg = `模型：${model}${scheme ? `\n方案：${scheme.name}` : ""}`;
    if (t?.info) t.info(msg, `预设：${preset}`, { timeOut: 3e3, extendedTimeOut: 1e3, preventDuplicates: false, toastClass: "toast cw-chat-toast", escapeHtml: true });
  } catch (e) {
    console.warn("[焦香鸡翅] 提示当前预设失败", e);
  }
}

var onChatChanged = debounce(async () => {
  const key = chatKeyNow();
  if (!key || key === handledChat) return;
  handledChat = key;
  let applied = null;
  try {
    applied = await autoApplyBinding();
  } finally {
    // 等自动连回站点、预设切换的事件处理完，再读当前的预设和模型
    setTimeout(() => { if (chatKeyNow() === key) chatInfoToast(applied); }, 900);
  }
}, 600);

async function autoApplyBinding() {
  const bind = bindingNow();
  const id = bind?.id;
  if (!id) return null;
  const sc = settings().schemes.find((x) => x.id === id);
  if (!sc) return null;
  try {
    // 预设已归档：读不到，直接交给 applyScheme，它会先从归档恢复
    if (!listPresets().includes(sc.preset)) {
      return await applyScheme(sc, { quiet: true, silent: true }) ? sc : null;
    }
    const d = getDraft(sc.preset, { fresh: true });
    const presetOk = currentPresetName() === sc.preset;
    const personaOk = !sc.persona || currentPersona() === sc.persona;
    const siteOk = !connDiffers(schemeConn(sc));
    if (presetOk && personaOk && siteOk && schemeMatches(d, sc)) return sc;
    return await applyScheme(sc, { quiet: true, silent: true }) ? sc : null;
  } catch (e) {
    console.warn("[焦香鸡翅] 套用聊天绑定方案失败", e);
    toast(`套用本聊天绑定的方案「${sc.name}」失败：${e.message}`, "warning");
    return null;
  }
}

function whoFromStack(stack) {
  const names = [...String(stack || "").matchAll(/extensions\/third-party\/([^/?#]+)\//g)].map((m) => decodeURIComponent(m[1]));
  const other = names.find((n) => !/burnt|chicken|atelier|焦香/i.test(n));
  if (other) return other;
  const scripts = [...String(stack || "").matchAll(/scripts\/extensions\/([^/?#]+)\//g)].map((m) => m[1]).find((n) => n !== "third-party");
  return scripts ? `酒馆内置扩展 ${scripts}` : "";
}

function watchMirrorWrites() {
  const orig = window.fetch;
  if (typeof orig !== "function" || orig.__paWatch) return;
  const wrapped = function(input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const body = init?.body;
      if (/api\/presets\/save/.test(url) && typeof body === "string" && body.includes("entryGrouping")) {
        const b = JSON.parse(body);
        const ext = b?.preset?.extensions;
        const bai = ext?.baibaiToolkit?.presetPromptGroups?.groups;
        if (b?.name && Array.isArray(ext?.entryGrouping) && Array.isArray(bai)) {
          const ids = new Set(bai.map((g) => g?.id).filter(Boolean));
          if (ext.entryGrouping.some((g) => g && ids.has(g.id)) && settings().mirrorFixed?.[b.name] && !settings().mirrorIgnore?.[b.name]) {
            const by = whoFromStack(new Error().stack);
            if (!settings().mirrorWrites || typeof settings().mirrorWrites !== "object") settings().mirrorWrites = {};
            settings().mirrorWrites[b.name] = { at: Date.now(), by };
            saveSettings();
            console.warn("[焦香鸡翅] 有人把旧的重复分组写回了预设", b.name, by || "(酒馆保存预设)", new Error().stack);
          }
        }
      }
    } catch {
    }
    return orig.apply(this, arguments);
  };
  wrapped.__paWatch = true;
  window.fetch = wrapped;
  cleanups.push(() => { if (window.fetch === wrapped) window.fetch = orig; });
}

// 1.9.8 规则：换预设，API 不变；切方案，恢复方案记录的 API。
// 去掉「切换预设后连回使用中站点」；关闭酒馆的「预设绑定连接」（只在升级后做一次，之后由用户在酒馆里自行决定）
function migrateApiRule() {
  const s = settings();
  if (s.apiRule === 2) return;
  s.apiRule = 2;
  s.keepApi = false;
  try { if (bindPresetToConnection()) setBindPresetToConnection(false); } catch {}
  saveSettings();
}

function bindEvents() {
  const c2 = ctx();
  const et2 = c2.eventTypes || c2.event_types;
  const on = (ev, fn) => {
    if (!ev) return;
    c2.eventSource.on(ev, fn);
    cleanups.push(() => c2.eventSource.removeListener?.(ev, fn));
  };
  on(et2.PRESET_CHANGED, (e) => {
    if (e?.apiId && e.apiId !== "openai") return;
    try { onPresetSwitchReasoning(e?.name); } catch (err) { console.warn("[焦香鸡翅] 切换推理格式失败", err); }
    // 正则保存只刷新原生面板，保留正在操作的来源选择和缝合位置。
    if (presetRegexRefreshName && e?.apiId === "openai" && e?.name === presetRegexRefreshName) return;
    try { notePresetUse(currentPresetName()); } catch {}
    dropClean();
    // 整页重画（含预设下拉框里的「使用中」标记）
    if (shellRoot && !shellRoot.hidden) refreshPanel();
  });
  on(et2.CHAT_CHANGED, () => onChatChanged());
  bindReplyGuard(on, et2);
  bindVariableWatch(on, et2);
  bindSemanticReview(on, et2);
}

async function start() {
  const prev = globalThis.__presetAtelier;
  if (prev && prev.kind === "extension" && BUILD_KIND === "script") {
    console.info("[焦香鸡翅] 已经装了扩展版，脚本版不再启动");
    return;
  }
  if (prev?.destroy) {
    try {
      prev.destroy();
    } catch {
    }
  }
  await initHost();
  migrateApiRule();
  watchMirrorWrites();
  const checkpointAll = () => { for (const d of dirtyDrafts()) checkpoint(d); };
  window.addEventListener("pagehide", checkpointAll);
  const hiddenCheckpoint = () => { if (document.hidden) { checkpointAll(); flushPresetNotice(); } };
  document.addEventListener("visibilitychange", hiddenCheckpoint);
  cleanups.push(() => { checkpointAll(); flushPresetNotice(); window.removeEventListener("pagehide", checkpointAll); document.removeEventListener("visibilitychange", hiddenCheckpoint); for(const t of autoTimers.values()) clearTimeout(t); });
  window.addEventListener("popstate", onPopState);
  document.addEventListener("keydown", onRootKey);
  cleanups.push(() => { window.removeEventListener("popstate", onPopState); document.removeEventListener("keydown", onRootKey); });
  injectStyle();
  try { applyPullGuard(); } catch {}
  // 1.8.0 去掉了后台中断补救，清掉它留下的记录
  try { localStorage.removeItem("presetAtelier:generating"); } catch {}
  try { delete settings().rescue; } catch {}
  try { if (migrateLegacyKeys(settings().sites)) saveSettings(); } catch {}
  cleanups.push(() => document.getElementById("cw-pull-guard")?.remove());
  addMenuEntry();
  addSettingsEntry();
  try { applyFloatBall(); } catch {}
  const replaceBall = () => { const b = document.getElementById("cw-ball"); if (b) placeBall(b); };
  window.addEventListener("resize", replaceBall);
  cleanups.push(() => { window.removeEventListener("resize", replaceBall); document.getElementById("cw-ball")?.remove(); });
  registerSlash();
  bindEvents();
  try { notePresetUse(currentPresetName(), { save: false }); } catch {}
  initReasoningFollow();
  let tries = 0;
  const timer = setInterval(() => {
    addMenuEntry();
    addSettingsEntry();
    if (++tries > 20 || document.getElementById("cw-menu-entry") && document.getElementById("cw-settings")) clearInterval(timer);
  }, 1e3);
  globalThis.__presetAtelier = {
    version: VERSION,
    kind: BUILD_KIND,
    open,
    destroy() {
      clearInterval(timer);
      cleanups.splice(0).forEach((f) => {
        try {
          f();
        } catch {
        }
      });
      document.getElementById("cw-root")?.remove();
      document.getElementById("cw-style")?.remove();
      document.getElementById("cw-menu-entry")?.remove();
      document.getElementById("cw-settings")?.remove();
      shellRoot = null;
    }
  };
  console.log(`[焦香鸡翅] ${VERSION} 已加载`);
}

// 1.4.1：扩展名称可修改，默认「焦香鸡翅」。酒馆「扩展管理」列表里的名称来自 manifest.json，无法按用户修改
var DEFAULT_APP_NAME = "焦香鸡翅";

function appName() {
  try {
    return settings().appName || DEFAULT_APP_NAME;
  } catch {
    return DEFAULT_APP_NAME;
  }
}

function refreshAppName() {
  document.querySelectorAll(".cw-appname").forEach((x) => { x.textContent = appName(); });
  const ball = document.getElementById("cw-ball");
  if (ball) { ball.title = appName(); ball.setAttribute("aria-label", `打开${appName()}`); }
}
