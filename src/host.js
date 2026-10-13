var mods = {};
function stUrl(path) {
  return new URL(path, document.baseURI).href;
}
async function load(name, path) {
  if (mods[name]) return mods[name];
  try {
    mods[name] = await import(
      /* webpackIgnore: true */
      stUrl(path)
    );
  } catch (e) {
    console.warn("[裁缝铺] 无法加载", path, e);
    mods[name] = null;
  }
  return mods[name];
}
async function initHost() {
  await Promise.all([
    load("openai", "scripts/openai.js"),
    load("secrets", "scripts/secrets.js"),
    load("wi", "scripts/world-info.js"),
    load("personas", "scripts/personas.js")
  ]);
  if (!mods.openai) throw new Error("无法读取酒馆的聊天补全模块，酒馆版本可能过旧");
}
function ctx() {
  return globalThis.SillyTavern.getContext();
}
var $ = (...a) => globalThis.jQuery(...a);
function pm() {
  return ctx().getPresetManager("openai");
}
function listPresets() {
  const { preset_names } = pm().getPresetList();
  const names = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names);
  return names.filter((n) => n && n !== "gui").sort((a, b) => a.localeCompare(b, "zh"));
}
function currentPresetName() {
  return mods.openai?.oai_settings?.preset_settings_openai || pm().getSelectedPresetName();
}
function presetIndex(name) {
  const { preset_names } = pm().getPresetList();
  return Array.isArray(preset_names) ? preset_names.indexOf(name) : preset_names[name];
}
function readPreset(name) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  if (idx === void 0 || idx < 0 || !presets[idx]) throw new Error(`未找到预设「${name}」`);
  const base = structuredClone(presets[idx]);
  if (name === currentPresetName() && mods.openai?.getChatCompletionPreset) {
    const live = mods.openai.getChatCompletionPreset(mods.openai.oai_settings);
    for (const k of ["prompts", "prompt_order", "extensions"]) if (live[k] !== void 0) base[k] = structuredClone(live[k]);
  }
  return base;
}
async function writePreset(name, data, reason = "保存") {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  if (idx !== void 0 && idx >= 0 && presets[idx]) {
    await backupPut(name, presets[idx], reason).catch((e) => console.warn("[裁缝铺] 备份失败", e));
  }
  await pm().savePreset(name, data, { skipUpdate: true });
  if (idx !== void 0 && idx >= 0) presets[idx] = structuredClone(data);
  if (name === currentPresetName()) {
    const s = mods.openai.oai_settings;
    s.prompts = structuredClone(data.prompts);
    s.prompt_order = structuredClone(data.prompt_order);
    s.extensions = structuredClone(data.extensions || {});
    ctx().saveSettingsDebounced();
    const et2 = ctx().eventTypes || ctx().event_types;
    // 1.3.5：百宝箱会把「当前预设」的分组缓存在内存里，只在换预设、导入、改名时才重新读。
    // 不提醒它的话，它下一次保存会拿旧分组把刚改的盖回去（表现为：新建的分组没了，看起来像只改了个名）。
    // 「预设导入完成」这个事件酒馆本体没人监听，百宝箱收到后只会清掉这个预设的分组缓存、重新从预设里读。
    if (ctx().extensionSettings?.baiBaiToolkit && et2.OAI_PRESET_IMPORT_READY) {
      try {
        await ctx().eventSource.emit(et2.OAI_PRESET_IMPORT_READY, { presetName: name, data: structuredClone(data) });
      } catch (e) {
        console.warn("[裁缝铺] 通知百宝箱刷新分组失败", e);
      }
    }
    await ctx().eventSource.emit(et2.OAI_PRESET_CHANGED_AFTER);
  }
}
async function selectPreset(name) {
  const value = pm().findPreset(name);
  if (value === void 0) throw new Error(`未找到预设「${name}」`);
  await pm().selectPreset(value);
}
function listWorldbooks() {
  return [...mods.wi?.world_names || []].sort((a, b) => a.localeCompare(b, "zh"));
}
async function readWorldbook(name) {
  const data = await mods.wi.loadWorldInfo(name);
  const entries = Object.values(data?.entries || {});
  entries.sort((a, b) => (a.displayIndex ?? a.order ?? 0) - (b.displayIndex ?? b.order ?? 0));
  return entries.map((e) => ({
    id: `wi:${name}:${e.uid}`,
    name: e.comment || (Array.isArray(e.key) ? e.key.join(",") : "") || `条目${e.uid}`,
    content: e.content || "",
    enabled: !e.disable
  }));
}
function listPersonas() {
  const map = ctx().powerUserSettings?.personas || {};
  return Object.entries(map).map(([avatar, name]) => ({ avatar, name }));
}
function currentPersona() {
  return mods.personas?.user_avatar || null;
}
async function setPersona(avatar) {
  if (!avatar || avatar === currentPersona()) return;
  if (mods.personas?.setUserAvatar) await mods.personas.setUserAvatar(avatar, { toastPersonaNameChange: false });
}
function chatMeta() {
  return ctx().chatMetadata || {};
}
function hasChat() {
  const c2 = ctx();
  return !!(c2.chatId || c2.getCurrentChatId?.());
}
async function saveChatMeta() {
  await ctx().saveMetadata?.();
}
var SOURCES = {
  custom: { label: "自定义（OpenAI 兼容 / 中转站）", secret: "api_key_custom", model: "#custom_model_id", modelList: "#model_custom_select", url: "#custom_api_url_text" },
  openai: { label: "OpenAI", secret: "api_key_openai", model: "#model_openai_select" },
  claude: { label: "Claude", secret: "api_key_claude", model: "#model_claude_select" },
  makersuite: { label: "Google AI Studio（Gemini）", secret: "api_key_makersuite", model: "#model_google_select" },
  openrouter: { label: "OpenRouter", secret: "api_key_openrouter", model: "#model_openrouter_select" },
  deepseek: { label: "DeepSeek", secret: "api_key_deepseek", model: "#model_deepseek_select" }
};
function liveConnection() {
  const s = mods.openai?.oai_settings || {};
  const source = s.chat_completion_source;
  const modelKey = { custom: "custom_model", openai: "openai_model", claude: "claude_model", makersuite: "google_model", openrouter: "openrouter_model", deepseek: "deepseek_model" }[source];
  const secretKey = SOURCES[source]?.secret;
  const st = mods.secrets?.secret_state?.[secretKey];
  const active = Array.isArray(st) ? st.find((x) => x.active) : null;
  return {
    mainApi: ctx().mainApi || $("#main_api").val(),
    source,
    url: source === "custom" ? s.custom_url : "",
    model: modelKey ? s[modelKey] : "",
    secretId: active?.id || null,
    secretMask: active?.value || "",
    online: !!ctx().onlineStatus && ctx().onlineStatus !== "no_connection"
  };
}
function multiKeySupported() {
  return !!(mods.secrets?.rotateSecret && Object.values(mods.secrets.secret_state || {}).some((v) => v === null || Array.isArray(v)));
}
async function storeKey(source, key, label) {
  const secretKey = SOURCES[source]?.secret;
  if (!secretKey) throw new Error("不支持的连接类型");
  const id = await mods.secrets.writeSecret(secretKey, key, label);
  return typeof id === "string" ? id : null;
}
async function readSecretState() {
  await mods.secrets?.readSecretState?.();
  return mods.secrets?.secret_state || {};
}
function setSelect(sel, value) {
  const el2 = $(sel);
  if (!el2.length || !value) return;
  if (el2.is("select") && !el2.find(`option[value="${CSS.escape(value)}"]`).length) {
    el2.append($("<option></option>").val(value).text(value));
  }
  el2.val(value).trigger("change");
}
async function applyConnection(site, { connect = true } = {}) {
  const src = SOURCES[site.source];
  if (!src) throw new Error("不支持的连接类型");
  if ($("#main_api").val() !== "openai") $("#main_api").val("openai").trigger("change");
  if ($("#chat_completion_source").val() !== site.source) {
    $("#chat_completion_source").val(site.source).trigger("change");
    await sleep(150);
  }
  if (site.source === "custom" && src.url) {
    $(src.url).val(site.url || "").trigger("input");
  }
  if (site.secretId && mods.secrets?.rotateSecret) {
    const state = await readSecretState();
    const list = state[src.secret];
    if (Array.isArray(list) && list.some((x) => x.id === site.secretId)) {
      if (!list.find((x) => x.id === site.secretId)?.active) await mods.secrets.rotateSecret(src.secret, site.secretId);
    } else if (site.legacyKey) {
      await mods.secrets.writeSecret(src.secret, site.legacyKey, site.name);
    } else {
      throw new Error(`「${site.name}」的密钥在酒馆密钥库中已不存在，请重新填写`);
    }
  } else if (site.legacyKey) {
    await mods.secrets.writeSecret(src.secret, site.legacyKey);
  }
  if (site.model) {
    if (site.source === "custom") {
      $("#custom_model_id").val(site.model).trigger("input");
      setSelect("#model_custom_select", site.model);
    } else {
      setSelect(src.model, site.model);
    }
  }
  if (connect) {
    $("#api_button_openai").trigger("click");
    await waitConnect(15e3);
    if (site.model && site.source === "custom") {
      $("#custom_model_id").val(site.model).trigger("input");
      setSelect("#model_custom_select", site.model);
    }
  }
  return liveConnection();
}
// 1.3.7：当前连接能选的模型（酒馆连上后自己拉到的列表）
function liveModelOptions() {
  const src = SOURCES[mods.openai?.oai_settings?.chat_completion_source];
  if (!src) return [];
  return $(`${src.modelList || src.model} option`).map((_, o) => o.value).toArray().filter(Boolean);
}
function setLiveModel(model) {
  const source = mods.openai?.oai_settings?.chat_completion_source;
  const src = SOURCES[source];
  if (!src || !model) return;
  if (source === "custom") {
    $("#custom_model_id").val(model).trigger("input");
    setSelect("#model_custom_select", model);
  } else setSelect(src.model, model);
}
function customModelOptions() {
  return $("#model_custom_select option").map((_, o) => o.value).toArray().filter(Boolean);
}
// 1.3.9：已经连着的时候点「连接」，状态一开始就是在线，只看在线会抢在新请求回来之前返回。
// 先等酒馆的连接按钮进入忙碌状态，再等它结束。
async function waitConnect(ms) {
  const busy = () => $("#api_button_openai").hasClass("disabled") || $("#api_loading_openai").is(":visible");
  const t0 = Date.now();
  while (Date.now() - t0 < 800 && !busy()) await sleep(50);
  while (Date.now() - t0 < ms && busy()) await sleep(200);
  return waitOnline(Math.max(0, ms - (Date.now() - t0)));
}
// 1.3.9：直接向酒馆后端要模型列表（酒馆自己连接时调用的也是这个接口），不等界面上的下拉框刷新
async function fetchModelList(site) {
  const s = mods.openai?.oai_settings || {};
  const body = { chat_completion_source: site.source, reverse_proxy: s.reverse_proxy, proxy_password: s.proxy_password };
  if (site.source === "custom") {
    body.custom_url = site.url;
    body.custom_include_headers = s.custom_include_headers;
  }
  const r = await fetch("/api/backends/chat-completions/status", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx().getRequestHeaders?.() || {} },
    body: JSON.stringify(body),
    cache: "no-cache"
  });
  if (!r.ok) throw new Error(`酒馆返回 ${r.status}`);
  const data = await r.json().catch(() => ({}));
  const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.data?.data) ? data.data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  const list = [...new Set(raw.map((m) => typeof m === "string" ? m : m?.id || m?.name).filter(Boolean))];
  if (data?.error && !list.length) throw new Error("站点未返回模型列表，请检查网址和密钥");
  return list;
}
// 用这个站点保存的密钥做一件事，做完换回原来在用的密钥
async function withSiteKey(site, fn) {
  const src = SOURCES[site.source];
  let restore = null;
  if (site.secretId && mods.secrets?.rotateSecret && src) {
    const list = (await readSecretState())[src.secret];
    if (Array.isArray(list)) {
      if (!list.some((x) => x.id === site.secretId)) throw new Error(`「${site.name || "站点"}」的密钥在酒馆密钥库中已不存在，请重新填写`);
      const cur = list.find((x) => x.active)?.id || null;
      if (cur !== site.secretId) {
        await mods.secrets.rotateSecret(src.secret, site.secretId);
        restore = cur;
      }
    }
  }
  try {
    return await fn();
  } finally {
    if (restore) await mods.secrets.rotateSecret(src.secret, restore).catch(() => {
    });
  }
}
async function waitOnline(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = ctx().onlineStatus;
    if (st && st !== "no_connection") return true;
    await sleep(300);
  }
  return false;
}
function bindPresetToConnection() {
  return !!mods.openai?.oai_settings?.bind_preset_to_connection;
}
function setBindPresetToConnection(on) {
  $("#bind_preset_to_connection").prop("checked", !!on).trigger("input");
  if (mods.openai?.oai_settings) mods.openai.oai_settings.bind_preset_to_connection = !!on;
  ctx().saveSettingsDebounced();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
var DB = "preset-atelier";
var dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("backups")) {
        const s = d.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
        s.createIndex("preset", "preset");
      }
      // 1.3.9：自定义背景图等本地文件，只存在这个浏览器里
      if (!d.objectStoreNames.contains("assets")) d.createObjectStore("assets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result ?? r);
    t.onerror = () => reject(t.error);
  }));
}
async function backupPut(preset, data, reason) {
  await tx("backups", "readwrite", (s) => s.add({ preset, reason, time: Date.now(), data: structuredClone(data) }));
  const list = await backupList(preset);
  for (const old of list.slice(15)) await tx("backups", "readwrite", (s) => s.delete(old.id));
}
async function backupList(preset) {
  const all = await tx("backups", "readonly", (s) => s.index("preset").getAll(preset));
  return (all || []).sort((a, b) => b.time - a.time);
}
async function backupGet(id) {
  return tx("backups", "readonly", (s) => s.get(id));
}
async function assetPut(key, blob) {
  await tx("assets", "readwrite", (s) => s.put(blob, key));
}
async function assetGet(key) {
  return tx("assets", "readonly", (s) => s.get(key));
}
async function assetDel(key) {
  await tx("assets", "readwrite", (s) => s.delete(key));
}
