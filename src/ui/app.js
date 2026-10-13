var TABS = [
  ["organize", "整理"],
  ["suture", "缝合"],
  ["cot", "思维链"],
  ["more", "更多"]
];
var rootEl2;
var pages = {};
var current = "organize";
var cleanups = [];
function injectStyle() {
  document.getElementById("pa-style")?.remove();
  const s = document.createElement("style");
  s.id = "pa-style";
  s.textContent = style_default + `
#pa-root .pa-group-select .pa-check { display:block; width:20px; height:20px; border:2px solid var(--pa-line); border-radius:50%; }
#pa-root .pa-group-select[aria-pressed=true] .pa-check { background:var(--pa-thread); border-color:var(--pa-thread); }
#pa-root .pa-group-select[aria-pressed=true] .pa-check::after { content:'✓'; display:block; text-align:center; line-height:16px; }
#pa-root .pa-inline-content { padding:12px 20px; margin:0 8px 8px; background:var(--pa-card); max-height:50vh; overflow:auto; }
#pa-root .pa-gname { cursor:pointer; }
`;
  document.head.append(s);
}
function buildRoot() {
  document.getElementById("pa-root")?.remove();
  rootEl2 = el(`<div id="pa-root" class="pa-root" hidden>
        <div class="pa-shell">
            <header class="pa-top">
                <div class="pa-brand"><span class="pa-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg></span><b>预设裁缝铺</b></div>
                <div class="pa-savebar" hidden>
                    <span class="pa-dirty-text"></span>
                    <button class="pa-btn" data-g="undo">撤销</button>
                    <button class="pa-btn pa-btn-primary" data-g="save">保存</button>
                </div>
                <button class="pa-icon-btn pa-theme-btn" data-g="theme" aria-label="换颜色" title="换颜色"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7.3" r="1.2"/><circle cx="14.5" cy="7.3" r="1.2"/></svg></button>
                <button class="pa-icon-btn pa-close" data-g="close" aria-label="关闭">✕</button>
            </header>
            <nav class="pa-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}">${l}</button>`).join("")}</nav>
            <main class="pa-main">${TABS.map(([k]) => `<section class="pa-page" data-page="${k}" hidden></section>`).join("")}</main>
        </div>
    </div>`);
  document.body.append(rootEl2);
  setRoot(rootEl2);
  const app = {
    showOrganize(ids) {
      show("organize");
      pages.organize.focusIds?.(ids);
    }
  };
  const pageEl = (k) => rootEl2.querySelector(`[data-page="${k}"]`);
  pages = {
    organize: mountOrganize(pageEl("organize"), app),
    suture: mountSuture(pageEl("suture"), app),
    cot: mountCot(pageEl("cot"), app),
    more: mountMore(pageEl("more"), app)
  };
  applyTheme(rootEl2);
  rootEl2.querySelector(".pa-tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) show(t.dataset.tab);
  });
  rootEl2.querySelector(".pa-top").addEventListener("click", async (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (g === "close") return close();
    if (g === "theme") return themeSheet();
    if (g === "undo") {
      const d = getDraft(focusPreset());
      const label = d.undo();
      if (label) {
        toast(`撤销了：${label}`);
        emitChange(d.name);
      }
    }
    if (g === "save") {
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "保存中…";
      try {
        await saveDraft(focusPreset(), "裁缝铺保存");
        toast("保存好了，已自动备份旧版本", "success");
      } catch (err) {
        toast("保存失败：" + err.message, "error");
      }
      btn.disabled = false;
      btn.textContent = "保存";
    }
  });
  cleanups.push(onDraftChange(updateSavebar));
}
function updateSavebar() {
  if (!rootEl2) return;
  const bar = rootEl2.querySelector(".pa-savebar");
  let d = null;
  try {
    d = getDraft(focusPreset());
  } catch {
  }
  const n = d?.dirty ? d.history.length : 0;
  bar.hidden = !d || (!d.dirty && !d.history.length);
  rootEl2.querySelector(".pa-dirty-text").textContent = saveErrors.has(d?.name) ? "保存失败 · 点保存重试" : saveJobs.has(d?.name) ? "自动保存中…" : d?.dirty ? "草稿已即时备份 · 等待自动保存" : "已自动保存";
}
function show(tab) {
  current = tab;
  rootEl2.querySelectorAll(".pa-tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  rootEl2.querySelectorAll(".pa-page").forEach((p) => {
    p.hidden = p.dataset.page !== tab;
  });
  try {
    pages[tab].render();
  } catch (e) {
    console.error(e);
    toast("出错了：" + e.message, "error");
  }
  updateSavebar();
}
function open(tab, sub) {
  if (sub && tab === "more") settings().moreTab = sub;
  if (!rootEl2) buildRoot();
  dropClean();
  setFocusPreset(currentPresetName());
  applyTheme(rootEl2);
  rootEl2.hidden = false;
  document.documentElement.classList.add("pa-open");
  show(tab || current);
}
async function close() {
  const dirty = dirtyDrafts();
  if (dirty.length) {
    const r = await sheet({
      title: "还有改动没保存",
      body: `<p class="pa-p">${dirty.map((d) => `「${esc(d.name)}」`).join("")}有没保存的改动。</p>`,
      actions: [{ label: "先留着（下次打开还在）", value: "keep" }, { label: "放弃改动", kind: "danger", value: "drop" }, { label: "全部保存", kind: "primary", value: "save" }]
    });
    if (!r) return;
    if (r === "drop") dirty.forEach((d) => dropDraft(d.name));
    if (r === "save") {
      try {
        for (const d of dirty) await saveDraft(d.name, "裁缝铺保存");
        toast("都保存好了", "success");
      } catch (e) {
        return toast("保存失败：" + e.message, "error");
      }
    }
  }
  rootEl2.hidden = true;
  document.documentElement.classList.remove("pa-open");
}
function addMenuEntry() {
  if (document.getElementById("pa-menu-entry")) return;
  const menu = document.getElementById("extensionsMenu");
  if (!menu) return;
  const item = el(`<div id="pa-menu-entry" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
        <div class="fa-solid fa-scissors extensionsMenuExtensionButton"></div><span>预设裁缝铺</span></div>`);
  item.addEventListener("click", () => open());
  menu.append(item);
}
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
    const r = await fetch("/api/extensions/discover", { headers: ctx().getRequestHeaders?.() || {} });
    const list = r.ok ? await r.json() : [];
    return list.find((x) => x.name === `third-party/${EXT_DIR}`)?.type || "local";
  } catch {
    return "local";
  }
}
async function extApi(path) {
  const r = await fetch(`/api/extensions/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
    body: JSON.stringify({ extensionName: EXT_DIR, global: await extensionType() === "global" })
  });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || r.statusText || `HTTP ${r.status}`);
  return r.json();
}
function addSettingsEntry() {
  if (document.getElementById("pa-settings")) return;
  const host2 = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
  if (!host2) return;
  const log = changelogSections();
  const kind = BUILD_KIND === "extension" ? "扩展版" : "脚本版";
  const box = el(`<div id="pa-settings" class="pa-set">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>预设裁缝铺 <span class="pa-set-badge">v${esc(VERSION)}</span></b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="pa-set-intro">整理分组 · 跨预设缝合 · 思维链检查 · 开关方案 · API 站点</div>
        <div class="pa-set-btns">
          <div class="menu_button menu_button_icon" data-a="open" tabindex="0" role="button"><i class="fa-solid fa-scissors"></i><span>打开裁缝铺</span></div>
          <div class="menu_button menu_button_icon" data-a="health" tabindex="0" role="button"><i class="fa-solid fa-gauge-high"></i><span>加载体检</span></div>
        </div>
        <hr class="sysHR">
        <div class="pa-set-row">
          <span class="pa-set-k">版本</span>
          <span class="pa-set-v">${esc(VERSION)} · ${kind}</span>
          ${EXT_DIR ? '<div class="menu_button menu_button_icon pa-set-mini" data-a="check" tabindex="0" role="button"><i class="fa-solid fa-rotate"></i><span>检查更新</span></div>' : ""}
        </div>
        <div class="pa-set-status" hidden></div>
        ${log.length ? `<details class="pa-set-log"><summary>更新说明</summary><div class="pa-set-logs">${log.slice(0, 3).map((x) => `<div class="pa-set-logv"><b>${esc(x.head)}</b><div>${esc(x.body).replace(/\n/g, "<br>")}</div></div>`).join("")}</div></details>` : ""}
        <div class="pa-set-foot">也可以从魔棒菜单 →「预设裁缝铺」打开，或者发 <code>/atelier</code>。<a href="https://github.com/Xiaxiii/Burnt-chicken-wings" target="_blank" rel="noopener">GitHub</a></div>
      </div>
    </div>
  </div>`);
  const status = box.querySelector(".pa-set-status");
  const say = (html, cls = "") => {
    status.hidden = false;
    status.className = "pa-set-status " + cls;
    status.innerHTML = html;
  };
  let busy = false;
  async function act(a, btn) {
    if (a === "open") return open();
    if (a === "health") return open("more", "health");
    if (a === "reload") return location.reload();
    if (busy) return;
    busy = true;
    const icon = btn.querySelector("i");
    icon?.classList.add("fa-spin");
    try {
      if (a === "check") {
        say("正在问 GitHub 有没有新版本…");
        const v = await extApi("version");
        if (v.isUpToDate) say(`已经是最新版（${esc(VERSION)}）。`, "ok");
        else say('有新版本。<div class="menu_button menu_button_icon pa-set-mini" data-a="update" tabindex="0" role="button"><i class="fa-solid fa-download"></i><span>现在更新</span></div>', "new");
      } else if (a === "update") {
        say("正在更新…");
        const v = await extApi("update");
        if (v.isUpToDate) say("已经是最新版了。", "ok");
        else say('更新好了，刷新页面就能用上新版。<div class="menu_button menu_button_icon pa-set-mini" data-a="reload" tabindex="0" role="button"><i class="fa-solid fa-arrows-rotate"></i><span>刷新页面</span></div>', "ok");
      }
    } catch (e) {
      say(`没成功：${esc(e.message).slice(0, 200)}<br>也可以去「扩展管理」里点更新。`, "bad");
    } finally {
      icon?.classList.remove("fa-spin");
      busy = false;
    }
  }
  const handler = (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || !box.contains(b)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    act(b.dataset.a, b);
  };
  box.addEventListener("click", handler);
  box.addEventListener("keydown", handler);
  host2.append(box);
}
function registerSlash() {
  try {
    const c2 = ctx();
    if (c2.SlashCommandParser && c2.SlashCommand) {
      c2.SlashCommandParser.addCommandObject(c2.SlashCommand.fromProps({
        name: "atelier",
        aliases: ["裁缝铺"],
        helpString: "打开预设裁缝铺",
        callback: () => {
          open();
          return "";
        }
      }));
    } else if (c2.registerSlashCommand) {
      c2.registerSlashCommand("atelier", () => {
        open();
        return "";
      }, ["裁缝铺"], "打开预设裁缝铺");
    }
  } catch (e) {
    console.warn("[裁缝铺] 注册斜杠命令失败", e);
  }
}
var applying = false;
var keepConnection = debounce(async () => {
  const s = settings();
  if (!s.keepApi || !s.activeSiteId || applying) return;
  const site = s.sites.find((x) => x.id === s.activeSiteId);
  if (!site) return;
  const live = liveConnection();
  const differs = live.source !== site.source || site.source === "custom" && (live.url || "") !== (site.url || "") || site.model && live.model !== site.model;
  if (!differs && live.online) return;
  applying = true;
  try {
    await applyConnection(site);
    toast(`换预设后已自动连回「${site.name}」`);
  } catch (e) {
    console.warn("[裁缝铺] 自动恢复连接失败", e);
  } finally {
    applying = false;
  }
}, 700);
var onChatChanged = debounce(async () => {
  const id = boundSchemeId();
  if (!id) return;
  const sc = settings().schemes.find((x) => x.id === id);
  if (!sc) return;
  try {
    const d = getDraft(sc.preset, { fresh: true });
    const presetOk = currentPresetName() === sc.preset;
    const personaOk = !sc.persona || currentPersona() === sc.persona;
    if (presetOk && personaOk && schemeMatches(d, sc)) return;
    await applyScheme(sc, { quiet: true });
  } catch (e) {
    console.warn("[裁缝铺] 套用聊天绑定方案失败", e);
  }
}, 600);
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
    keepConnection();
    dropClean();
    if (rootEl2 && !rootEl2.hidden) emitChange(focusPreset());
  });
  on(et2.CHAT_CHANGED, () => onChatChanged());
}
async function start() {
  const prev = globalThis.__presetAtelier;
  if (prev && prev.kind === "extension" && BUILD_KIND === "script") {
    console.info("[裁缝铺] 已经装了扩展版，脚本版不再启动");
    return;
  }
  if (prev?.destroy) {
    try {
      prev.destroy();
    } catch {
    }
  }
  await initHost();
  const checkpointAll = () => { for (const d of dirtyDrafts()) checkpoint(d); };
  window.addEventListener("pagehide", checkpointAll);
  const hiddenCheckpoint = () => { if (document.hidden) checkpointAll(); };
  document.addEventListener("visibilitychange", hiddenCheckpoint);
  cleanups.push(() => { checkpointAll(); window.removeEventListener("pagehide", checkpointAll); document.removeEventListener("visibilitychange", hiddenCheckpoint); for(const t of autoTimers.values()) clearTimeout(t); });
  injectStyle();
  addMenuEntry();
  addSettingsEntry();
  registerSlash();
  bindEvents();
  let tries = 0;
  const timer = setInterval(() => {
    addMenuEntry();
    addSettingsEntry();
    if (++tries > 20 || document.getElementById("pa-menu-entry") && document.getElementById("pa-settings")) clearInterval(timer);
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
      document.getElementById("pa-root")?.remove();
      document.getElementById("pa-style")?.remove();
      document.getElementById("pa-menu-entry")?.remove();
      document.getElementById("pa-settings")?.remove();
      rootEl2 = null;
    }
  };
  console.log(`[裁缝铺] ${VERSION} 已加载`);
}

