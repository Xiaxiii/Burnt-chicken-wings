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
                <div class="pa-brand"><span class="pa-logo" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg></span><b class="pa-appname">${esc(appName())}</b></div>
                <div class="pa-savebar" hidden>
                    <span class="pa-dirty-text"></span>
                    <button class="pa-btn" data-g="undo">撤销</button>
                    <button class="pa-btn pa-btn-primary" data-g="confirm">确认</button>
                    <button class="pa-btn pa-btn-primary" data-g="save" hidden>重试保存</button>
                </div>
                <button class="pa-icon-btn pa-backup-btn" data-g="backups" aria-label="备份" title="备份"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg></button>
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
    if (g === "undo") {
      const d = getDraft(focusPreset());
      const label = d.undo();
      if (label) {
        toast(`已撤销：${label}`);
        emitChange(d.name);
      }
    }
    if (g === "confirm") {
      try {
        await confirmDraft(focusPreset());
        toast("已确认", "success");
      } catch (err) {
        toast("保存失败：" + err.message, "error");
      }
    }
    if (g === "backups") return backupsSheet(focusPreset());
    if (g === "save") {
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "保存中…";
      try {
        await saveDraft(focusPreset(), "裁缝铺保存");
        toast("已保存", "success");
      } catch (err) {
        toast("保存失败：" + err.message, "error");
      }
      btn.disabled = false;
      btn.textContent = "重试保存";
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
  // 修改即时自动保存；有未确认的修改时显示「撤销」「确认」
  const err = saveErrors.has(d?.name);
  const pending = !!d?.history.length;
  bar.hidden = !d || !pending && !err && !saveJobs.has(d.name);
  rootEl2.querySelector(".pa-dirty-text").textContent = err ? `保存失败：${String(saveErrors.get(d.name)).slice(0, 40)}` : saveJobs.has(d?.name) || d?.dirty ? "保存中…" : "已自动保存";
  rootEl2.querySelector("[data-g=save]").hidden = !err;
  rootEl2.querySelector("[data-g=undo]").hidden = !pending;
  rootEl2.querySelector("[data-g=confirm]").hidden = !pending || err;
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
    toast("出错：" + e.message, "error");
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
      title: "有未保存的修改",
      body: `<p class="pa-p">${dirty.map((d) => `「${esc(d.name)}」`).join("")}有未保存的修改。</p>`,
      actions: [{ label: "暂不处理（下次打开仍在）", value: "keep" }, { label: "放弃修改", kind: "danger", value: "drop" }, { label: "全部保存", kind: "primary", value: "save" }]
    });
    if (!r) return;
    if (r === "drop") dirty.forEach((d) => dropDraft(d.name));
    if (r === "save") {
      try {
        for (const d of dirty) await saveDraft(d.name, "裁缝铺保存");
        toast("已全部保存", "success");
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
        <div class="fa-solid fa-scissors extensionsMenuExtensionButton"></div><span class="pa-appname">${esc(appName())}</span></div>`);
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
        <b><span class="pa-appname">${esc(appName())}</span> <span class="pa-set-badge">v${esc(VERSION)}</span></b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="pa-set-intro">整理分组、跨预设缝合、思维链检查、方案、加载体检、预设清理。</div>
        <div class="pa-set-btns">
          <div class="menu_button menu_button_icon" data-a="open" tabindex="0" role="button"><i class="fa-solid fa-scissors"></i><span>打开<span class="pa-appname">${esc(appName())}</span></span></div>
          <div class="menu_button menu_button_icon" data-a="health" tabindex="0" role="button"><i class="fa-solid fa-gauge-high"></i><span>加载体检</span></div>
        </div>
        <hr class="sysHR">
        <div class="pa-set-row">
          <span class="pa-set-k">名称</span>
          <span class="pa-set-v pa-appname">${esc(appName())}</span>
          <div class="menu_button menu_button_icon pa-set-mini" data-a="rename" tabindex="0" role="button" title="修改名称"><i class="fa-solid fa-pencil"></i><span>修改</span></div>
        </div>
        <div class="pa-set-row">
          <span class="pa-set-k">版本</span>
          <span class="pa-set-v">${esc(VERSION)} · ${kind}</span>
          ${EXT_DIR ? '<div class="menu_button menu_button_icon pa-set-mini" data-a="check" tabindex="0" role="button"><i class="fa-solid fa-rotate"></i><span>检查更新</span></div>' : ""}
        </div>
        <div class="pa-set-status" hidden></div>
        <label class="checkbox_label pa-set-check"><input type="checkbox" data-opt="noPullRefresh" ${settings().noPullRefresh !== false ? "checked" : ""}><span>防止下拉误刷新（苹果设备）</span></label>
        <div class="pa-set-note">在页面顶部往下拖时，Safari 会刷新整个酒馆。开启后阻止这种刷新；刷新按钮照常可用。</div>
        ${log.length ? `<details class="pa-set-log"><summary>最近两次更新的内容</summary><div class="pa-set-logs">${log.slice(0, 2).map((x) => `<div class="pa-set-logv"><b>${esc(x.head)}</b><div>${esc(x.body).replace(/\n/g, "<br>")}</div></div>`).join("")}</div></details>` : ""}
        <div class="pa-set-foot">打开方式：点上方按钮，或从魔棒菜单打开，或在聊天输入框发送 /atelier。<a href="https://github.com/Xiaxiii/Burnt-chicken-wings" target="_blank" rel="noopener">GitHub</a></div>
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
    if (a === "rename") {
      const n = window.prompt("扩展名称（留空恢复默认）", appName());
      if (n === null) return;
      settings().appName = n.trim() || "";
      saveSettings();
      return refreshAppName();
    }
    if (busy) return;
    busy = true;
    const icon = btn.querySelector("i");
    icon?.classList.add("fa-spin");
    try {
      if (a === "check") {
        say("正在检查更新…");
        const v = await extApi("version");
        if (v.isUpToDate) say(`已是最新版本（${esc(VERSION)}）。`, "ok");
        else say('有新版本。<div class="menu_button menu_button_icon pa-set-mini" data-a="update" tabindex="0" role="button"><i class="fa-solid fa-download"></i><span>更新</span></div>', "new");
      } else if (a === "update") {
        say("正在更新…");
        const v = await extApi("update");
        if (v.isUpToDate) say("已是最新版本。", "ok");
        else say('更新完成，刷新页面后生效。<div class="menu_button menu_button_icon pa-set-mini" data-a="reload" tabindex="0" role="button"><i class="fa-solid fa-arrows-rotate"></i><span>刷新页面</span></div>', "ok");
      }
    } catch (e) {
      say(`更新失败：${esc(e.message).slice(0, 200)}<br>可在「扩展管理」中更新。`, "bad");
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
  box.addEventListener("change", (e) => {
    const t = e.target.closest("[data-opt=noPullRefresh]");
    if (!t) return;
    settings().noPullRefresh = t.checked;
    saveSettings();
    applyPullGuard();
  });
  host2.append(box);
}
// 1.5.1：iOS Safari 在页面顶部下拉会刷新整页（酒馆没有关掉这个行为），玩着玩着就被刷新了。
// 给 html、body 加 overscroll-behavior-y: none 即可阻止（Safari 16 起支持）。只影响「拖到顶再往下拖」，不影响正常滚动。
function applyPullGuard() {
  let st = document.getElementById("pa-pull-guard");
  const on = settings().noPullRefresh !== false;
  if (on && !st) {
    st = document.createElement("style");
    st.id = "pa-pull-guard";
    st.textContent = "html, body { overscroll-behavior-y: none; }";
    document.head.append(st);
  } else if (!on && st) st.remove();
}
function registerSlash() {
  try {
    const c2 = ctx();
    if (c2.SlashCommandParser && c2.SlashCommand) {
      c2.SlashCommandParser.addCommandObject(c2.SlashCommand.fromProps({
        name: "atelier",
        aliases: ["裁缝铺", "焦香鸡翅"],
        helpString: "打开焦香鸡翅（预设裁缝铺）",
        callback: () => {
          open();
          return "";
        }
      }));
    } else if (c2.registerSlashCommand) {
      c2.registerSlashCommand("atelier", () => {
        open();
        return "";
      }, ["裁缝铺"], "打开焦香鸡翅（预设裁缝铺）");
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
    toast(`已恢复连接「${site.name}」`);
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
    try { notePresetUse(currentPresetName()); } catch {}
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
  try { applyPullGuard(); } catch {}
  cleanups.push(() => document.getElementById("pa-pull-guard")?.remove());
  addMenuEntry();
  addSettingsEntry();
  registerSlash();
  bindEvents();
  try { notePresetUse(currentPresetName(), { save: false }); } catch {}
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
// 备份：每批修改开始前自动备份一次修改前的版本，每个预设保留最近 10 份
async function backupsSheet(name) {
  let list = [];
  try {
    list = await backupList(name);
  } catch (e) {
    return toast("读取备份失败：" + e.message, "error");
  }
  if (!list.length) return toast(`「${name}」暂无备份`);
  const items = list.map((b) => ({ label: new Date(b.time).toLocaleString(), sub: b.reason, value: b.id }));
  const id = await pickBox(`「${name}」的备份（最近 ${BACKUP_MAX} 份）`, items, { hint: "每批修改开始前自动备份一次。点一份备份可恢复或下载。" });
  if (!id) return;
  const b = await backupGet(id);
  const how = await pickBox("选择操作", [{ label: "恢复", sub: "恢复后自动保存，可撤销", value: "restore" }, { label: "下载 JSON 文件", value: "download" }]);
  if (how === "download") {
    downloadBlob(new Blob([JSON.stringify(b.data, null, 4)], { type: "application/json" }), `${name}-备份-${new Date(b.time).toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`);
  }
  if (how === "restore") {
    const d = getDraft(name);
    mutate(d, "恢复备份", (x) => {
      const tmp = new x.constructor(name, b.data);
      x.preset = tmp.preset;
      x.groups = tmp.groups;
    });
    toast("已恢复", "success");
  }
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
  document.querySelectorAll(".pa-appname").forEach((x) => { x.textContent = appName(); });
}
