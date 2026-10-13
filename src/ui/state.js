var KEY = "presetAtelier";
var DEFAULTS = {
  sites: [],
  activeSiteId: null,
  keepApi: true,
  schemes: [],
  cotManual: {},
  keepClickOrder: true,
  followTargetInjection: true,
  theme: "follow",
  sutureSplit: 45,
  moreTab: "schemes",
  nameWithSource: false
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
function recoveryKey(name) { return "presetAtelier:recovery:v110:" + name; }
function checkpoint(d) {
  try { localStorage.setItem(recoveryKey(d.name), JSON.stringify({ preset: d.toPreset(), history: [], time: Date.now() })); }
  catch (e) { saveErrors.set(d.name, "即时草稿备份失败：" + e.message); }
}
function queueAutoSave(name) {
  clearTimeout(autoTimers.get(name));
  autoTimers.set(name, setTimeout(() => {
    autoTimers.delete(name);
    saveDraft(name, "自动保存").catch(e => { saveErrors.set(name, e.message); notifyDraft(name); toast("自动保存失败，草稿仍保留；点保存重试：" + e.message, "error"); });
  }, 350));
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
function getDraft(name, { fresh = false } = {}) {
  let d = drafts.get(name);
  if (!d || fresh && !d.dirty) {
    const live = readPreset(name);
    d = new Draft(name, live);
    d.savedSig = presetSig(live);
    if (!drafts.has(name)) {
      try {
        const cached = JSON.parse(localStorage.getItem(recoveryKey(name)) || "null");
        if (cached?.preset?.prompts) {
          d = new Draft(name, cached.preset); d.history = cached.history || []; d.dirty = true;
          toast(`已恢复「${name}」刷新前的草稿`); queueAutoSave(name);
        }
      } catch(e) { console.warn("草稿恢复失败", e); }
    }
    drafts.set(name, d);
  }
  return d;
}
function dropDraft(name) {
  drafts.delete(name);
  clearTimeout(autoTimers.get(name)); autoTimers.delete(name);
  localStorage.removeItem(recoveryKey(name));
}
function dropClean() {
  for (const [n, d] of drafts) {
    if (d.dirty || saveJobs.has(n)) continue;
    if (!d.history.length) { drafts.delete(n); continue; }
    // 1.1.3：裁缝铺保存之后，用户又在酒馆里直接改了预设（比如解除分组、开关条目），
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
      const data = d.toPreset(); const sent = JSON.stringify(data);
      await writePreset(name, data, reason);
      if (drafts.get(name) !== d) break;
      if (JSON.stringify(d.toPreset()) === sent) {
        try { d.savedSig = presetSig(readPreset(name)); } catch { d.savedSig = presetSig(data); }
        d.dirty = false; localStorage.removeItem(recoveryKey(name));
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

