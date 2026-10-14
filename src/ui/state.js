var KEY = "presetAtelier";
var DEFAULTS = {
  sites: [],
  activeSiteId: null,
  keepApi: true,
  chatToast: true,
  schemes: [],
  cotManual: {},
  keepClickOrder: true,
  followTargetInjection: true,
  theme: "follow",
  sutureSplit: 45,
  moreTab: "schemes",
  nameWithSource: false,
  noPullRefresh: true
};
function settings() {
  const all = ctx().extensionSettings;
  if (!all[KEY] || typeof all[KEY] !== "object") all[KEY] = {};
  const s = all[KEY];
  for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === void 0) s[k] = structuredClone(v);
  return s;
}
function saveSettings() {
  ctx().saveSettingsDebounced();
}
var drafts = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function onDraftChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
var saveJobs = new Map();
var autoTimers = new Map();
var saveErrors = new Map();
// 需要用户决定才能继续保存的预设：name -> { kind: "conflict" | "backup", message }
var saveBlocked = new Map();
// 面板没打开时发现的问题，等打开后再问
var pendingAsks = new Map();
// 草稿键带上酒馆账号，同一浏览器换账号不会读到别人的草稿。v110 是旧版不分账号的键
function recoveryKey(name) { return `presetAtelier:recovery:v180:${userHandle()}:${name}`; }
function legacyRecoveryKey(name) { return "presetAtelier:recovery:v110:" + name; }
function recoveryName(key) {
  const m = /^presetAtelier:recovery:v180:[^:]*:([\s\S]*)$/.exec(key) || /^presetAtelier:recovery:v110:([\s\S]*)$/.exec(key);
  return m ? m[1] : null;
}
function readRecovery(name) {
  for (const key of [recoveryKey(name), legacyRecoveryKey(name)]) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      if (v?.preset?.prompts) return { ...v, key };
    } catch {}
  }
  return null;
}
function removeRecovery(name) {
  for (const key of [recoveryKey(name), legacyRecoveryKey(name)]) {
    try { localStorage.removeItem(key); } catch {}
  }
}
// 1.3.6：大预设（1MB 以上）几份草稿就会把 localStorage（约 5MB）写满。
// 写满时先清掉别的预设的旧草稿再试；还不行就只是不做即时备份——这不是保存失败，不再显示「保存失败」。
// baseSig：草稿是基于哪个版本改的。恢复时用它判断服务器上的预设之后有没有被别处改过。
function checkpoint(d) {
  const key = recoveryKey(d.name);
  let text;
  try { text = JSON.stringify({ preset: d.toPreset(), baseSig: d.savedSig || null, history: [], time: Date.now() }); } catch { return; }
  try { localStorage.setItem(key, text); return; } catch {}
  try {
    // 只清当前账号（和旧版不分账号）的草稿，别的账号的草稿留着
    const mine = `presetAtelier:recovery:v180:${userHandle()}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k !== key && (k.startsWith(mine) || k.startsWith("presetAtelier:recovery:v110:")) && !drafts.get(recoveryName(k))?.dirty) localStorage.removeItem(k);
    }
    localStorage.setItem(key, text);
  } catch {
    try { localStorage.removeItem(key); } catch {}
  }
}
function queueAutoSave(name) {
  clearTimeout(autoTimers.get(name));
  // 冲突或备份失败时，等用户决定，不再自动重试（否则会一直弹窗或直接盖掉别处的修改）
  if (saveBlocked.has(name)) return;
  autoTimers.set(name, setTimeout(() => {
    autoTimers.delete(name);
    saveDraft(name, "自动保存").catch((e) => handleSaveError(name, e));
  }, 350));
}
function handleSaveError(name, e) {
  saveErrors.set(name, e.message);
  if (e.kind === "conflict" || e.kind === "backup") {
    saveBlocked.set(name, { kind: e.kind, message: e.message });
    notifyDraft(name);
    askLater(name, () => resolveSaveProblem(name));
    return;
  }
  notifyDraft(name);
  toast("自动保存失败，草稿已保留：" + e.message, "error");
}
function panelVisible() {
  return !!(rootEl && rootEl.isConnected && !rootEl.hidden);
}
function askLater(name, fn) {
  pendingAsks.set(name, fn);
  if (panelVisible()) setTimeout(flushAsks, 0);
}
var asking = false;
async function flushAsks() {
  if (asking || !panelVisible()) return;
  asking = true;
  try {
    while (pendingAsks.size) {
      const [name, fn] = pendingAsks.entries().next().value;
      pendingAsks.delete(name);
      try { await fn(); } catch (e) { console.error(e); }
    }
  } finally {
    asking = false;
  }
}
function downloadPresetJson(name, data, suffix) {
  const t = new Date();
  const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${String(t.getHours()).padStart(2, "0")}${String(t.getMinutes()).padStart(2, "0")}`;
  downloadBlob(new Blob([JSON.stringify(data, null, 4)], { type: "application/json" }), `${name}-${suffix}-${stamp}.json`);
}
// 保存被挡住（别处改过 / 备份失败）时，让用户选怎么办
async function resolveSaveProblem(name) {
  const b = saveBlocked.get(name);
  const d = drafts.get(name);
  if (!b || !d) return;
  if (b.kind === "conflict") {
    const v = await sheet({
      title: "预设在别处被修改过",
      body: `<p class="pa-p">「${esc(name)}」在你开始修改之后，被酒馆或其他扩展改过。继续保存会盖掉那些修改，所以已暂停自动保存。</p><p class="pa-hint">你的修改还在。可以先下载两个版本再决定。</p>`,
      actions: [
        { label: "下载两个版本", value: "dl" },
        { label: "放弃我的修改", kind: "danger", value: "drop" },
        { label: "用我的修改覆盖", kind: "primary", value: "force" }
      ]
    });
    if (v === "dl") {
      downloadPresetJson(name, d.toPreset(), "我的版本");
      try { downloadPresetJson(name, readPreset(name), "别处修改的版本"); } catch {}
      return resolveSaveProblem(name);
    }
    if (v === "drop") {
      unblock(name);
      dropDraft(name);
      notifyDraft(name);
      toast(`已放弃修改，重新读取「${name}」`);
      return;
    }
    if (v === "force") {
      unblock(name);
      d.forceOnce = true;
      return saveDraft(name, "覆盖别处的修改").then(() => toast("已保存", "success")).catch((e) => handleSaveError(name, e));
    }
    return; // 关掉弹窗：保持暂停，顶栏可再次处理
  }
  if (b.kind === "backup") {
    const v = await sheet({
      title: "自动备份失败",
      body: `<p class="pa-p">保存「${esc(name)}」之前要先备份修改前的版本，但备份没有成功：${esc(b.message)}</p><p class="pa-hint">常见原因是浏览器存储已满，或处于无痕模式。没有备份时，顶栏的备份按钮无法恢复到修改前。</p>`,
      actions: [
        { label: "暂不保存", value: null },
        { label: "不备份直接保存", value: "skip" },
        { label: "下载修改前的版本后保存", kind: "primary", value: "dl" }
      ]
    });
    if (v === "dl") {
      try { downloadPresetJson(name, readPreset(name), "修改前"); } catch (e) { toast("下载失败：" + e.message, "error"); return; }
    }
    if (v === "dl" || v === "skip") {
      unblock(name);
      d.skipBackupOnce = true;
      return saveDraft(name, "保存").then(() => toast("已保存", "success")).catch((e) => handleSaveError(name, e));
    }
  }
}
function unblock(name) {
  saveBlocked.delete(name);
  saveErrors.delete(name);
}
function notifyDraft(name) {
  for (const fn of listeners) { try { fn(name); } catch (e) { console.error(e); } }
}
function emitChange(name) {
  const d = drafts.get(name);
  if (d?.dirty) { checkpoint(d); queueAutoSave(name); }
  for (const fn of listeners) {
    try {
      fn(name);
    } catch (e) {
      console.error(e);
    }
  }
}
function presetSig(p) {
  try { return JSON.stringify({ prompts: p?.prompts, prompt_order: p?.prompt_order, extensions: p?.extensions }); }
  catch { return null; }
}
// 让核心逻辑（缝合、接入思维链）也认得「思维链」页里手动指定的思维链
function attachCotManual(d) {
  Object.defineProperty(d, "cotManual", { configurable: true, get: () => settings().cotManual?.[d.name] || {} });
  Object.defineProperty(d, "groupGate", { configurable: true, get: groupGateActive });
  return d;
}
function getDraft(name, { fresh = false } = {}) {
  let d = drafts.get(name);
  if (!d || fresh && !d.dirty) {
    const live = readPreset(name);
    d = new Draft(name, live);
    d.savedSig = presetSig(live);
    if (!drafts.has(name)) {
      try {
        const cached = readRecovery(name);
        if (cached) {
          if (presetSig(cached.preset) === d.savedSig) {
            // 草稿和服务器上的一样：上次其实已经存好了
            removeRecovery(name);
          } else if (cached.baseSig && cached.baseSig === d.savedSig) {
            // 服务器上的预设没被别处改过：可以放心接着保存
            const base = d.savedSig;
            d = new Draft(name, cached.preset);
            d.savedSig = base;
            d.dirty = true;
            drafts.set(name, attachCotManual(d));
            toast(`已恢复「${name}」未保存的草稿`);
            queueAutoSave(name);
          } else {
            // 服务器上的预设之后被改过（或旧版草稿没记基准）：不自动覆盖，问用户
            askLater(name, () => resolveRecovery(name, cached));
          }
        }
      } catch(e) { console.warn("草稿恢复失败", e); }
    }
    drafts.set(name, attachCotManual(d));
  }
  return d;
}
async function resolveRecovery(name, cached) {
  const when = cached.time ? new Date(cached.time).toLocaleString() : "上次";
  const v = await sheet({
    title: "发现未保存的草稿",
    body: `<p class="pa-p">「${esc(name)}」有一份 ${esc(when)} 未保存完的草稿，但这个预设之后在别处被改过。用草稿会盖掉那些修改。</p>`,
    actions: [
      { label: "下载草稿", value: "dl" },
      { label: "丢弃草稿", kind: "danger", value: "drop" },
      { label: "用草稿覆盖", kind: "primary", value: "use" }
    ]
  });
  if (v === "dl") {
    downloadPresetJson(name, cached.preset, "草稿");
    return resolveRecovery(name, cached);
  }
  if (v === "drop") {
    removeRecovery(name);
    toast("已丢弃草稿");
    return;
  }
  if (v === "use") {
    let d;
    try { d = getDraft(name); } catch (e) { return toast(e.message, "error"); }
    mutate(d, "恢复草稿", (x) => x.replaceWith(cached.preset));
    toast(`已用草稿覆盖「${name}」，可撤销`, "success");
  }
  // 关掉弹窗：草稿留在本地，下次打开再问
}
function dropDraft(name) {
  drafts.delete(name);
  clearTimeout(autoTimers.get(name)); autoTimers.delete(name);
  saveBlocked.delete(name);
  saveErrors.delete(name);
  pendingAsks.delete(name);
  removeRecovery(name);
}
// 删除、归档预设之前：取消还没发出的自动保存，等已经发出的保存结束，再丢掉草稿。
// 否则删完之后，晚到的保存会把预设文件重新写回服务器。
// 已经发出的请求撤不回来，只能等它结束；返回 false 表示那次保存失败了（预设仍是之前的样子）。
async function quiesceDraft(name) {
  clearTimeout(autoTimers.get(name)); autoTimers.delete(name);
  let ok = true;
  while (saveJobs.has(name)) {
    try { await saveJobs.get(name); } catch { ok = false; }
  }
  dropDraft(name);
  return ok;
}
function dropClean() {
  for (const [n, d] of drafts) {
    if (d.dirty || saveJobs.has(n)) continue;
    if (!d.history.length) { drafts.delete(n); continue; }
    // 1.1.3：本扩展保存之后，用户又在酒馆里直接改了预设（比如解除分组、开关条目），
    // 旧版会继续拿内存里的旧草稿干活，下一次自动保存就把这些改动盖回去。
    // 现在发现酒馆里的预设和上次保存的不一样，就丢掉旧草稿重新读。
    let live = null;
    try { live = presetSig(readPreset(n)); } catch { live = null; }
    if (!d.savedSig || live !== d.savedSig) drafts.delete(n);
  }
}
function dirtyDrafts() {
  return [...drafts.values()].filter((d) => d.dirty);
}
async function saveDraft(name, reason = "保存") {
  clearTimeout(autoTimers.get(name)); autoTimers.delete(name);
  if (saveJobs.has(name)) { await saveJobs.get(name); return saveDraft(name, reason); }
  const d = drafts.get(name);
  if (!d?.dirty) return;
  const task = (async () => {
    while (d.dirty && drafts.get(name) === d) {
      // 写之前核对：酒馆里的预设和上次读到/存进去的是否一样。不一样说明别处改过，不能直接盖
      if (!d.forceOnce && d.savedSig) {
        let live = null;
        try { live = presetSig(readPreset(name)); } catch { live = null; }
        if (live !== null && live !== d.savedSig) {
          checkpoint(d);
          throw Object.assign(new Error("预设在别处被修改过"), { kind: "conflict" });
        }
      }
      d.forceOnce = false;
      const data = d.toPreset(); const sent = JSON.stringify(data);
      // 1.4.0：每批修改（从上次「完成」或打开之后）只在第一次保存前备份一次修改前的版本
      const first = !d.batchSaved && !d.skipBackupOnce;
      await writePreset(name, data, first ? `修改前${d.history[0]?.label ? `（之后：${d.history[0].label}）` : ""}` : reason, { backup: first });
      d.skipBackupOnce = false;
      d.batchSaved = true;
      // 每次写完都记下新的基准，下一轮核对才不会把自己刚写的当成「别处改过」
      try { d.savedSig = presetSig(readPreset(name)); } catch { d.savedSig = presetSig(data); }
      if (drafts.get(name) !== d) break;
      if (JSON.stringify(d.toPreset()) === sent) {
        d.dirty = false;
        removeRecovery(name);
        saveErrors.delete(name);
      } else checkpoint(d);
    }
  })();
  saveJobs.set(name, task); notifyDraft(name);
  try { await task; }
  finally { saveJobs.delete(name); notifyDraft(name); }
}

function mutate(draft, label, fn) {
  draft.snapshot(label);
  fn(draft);
  emitChange(draft.name);
}
var focusName = null;
function focusPreset() {
  return focusName || currentPresetName();
}
function setFocusPreset(n) {
  focusName = n;
  emitChange(n);
}
// 「确认」：本批修改到此为止。先等保存完成，再清空撤销记录；下一次修改会重新备份
async function confirmDraft(name) {
  const d = drafts.get(name);
  if (!d) return;
  if (d.dirty) await saveDraft(name, "确认");
  d.history = [];
  d.batchSaved = false;
  notifyDraft(name);
}
