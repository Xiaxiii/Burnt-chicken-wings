// 清理：预设使用记录、归档、扩展数据归属、角色卡与世界书、本地备份（原 ui/cleanup.js、ui/cleanmore.js）
// 记录每个预设最近一次被选用的时间（酒馆本身不记）。只记名称和时间。
function notePresetUse(name, { save = true } = {}) {
  if (!name) return;
  const s = settings();
  if (!s.presetUse || typeof s.presetUse !== "object") s.presetUse = {};
  if (!s.presetUseSince) s.presetUseSince = Date.now();
  s.presetUse[name] = Date.now();
  if (save) saveSettings();
}

function archiveList() {
  const s = settings();
  if (!Array.isArray(s.archive)) s.archive = [];
  return s.archive;
}

function relDay(t) {
  if (!t) return "";
  const d = Math.floor((Date.now() - t) / 864e5);
  return d <= 0 ? "今天用过" : d === 1 ? "昨天用过" : `${d} 天前用过`;
}

function dateStr(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 哪些预设被方案或酒馆的「连接配置」用着
function presetUsers() {
  const out = {};
  const add = (n, why) => (out[n] ||= []).push(why);
  for (const s of settings().schemes || []) if (s.preset) add(s.preset, `方案「${s.name}」`);
  for (const p of ctx().extensionSettings?.connectionManager?.profiles || []) if (p?.preset) add(p.preset, `连接配置「${p.name}」`);
  return out;
}

function presetText(name) {
  const { presets } = pm().getPresetList();
  const idx = presetIndex(name);
  const data = name === currentPresetName() ? readPreset(name) : presets[idx];
  return JSON.stringify(data ?? null);
}

// 从归档恢复一个预设。被方案套用时也会调用（方案对应的预设已归档 → 自动恢复后再切换）。
async function restoreArchived(entry, { ask = true } = {}) {
  const text = await userFileGetText(entry.path, entry.gz);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("归档文件已损坏，无法读取");
  }
  if (listPresets().includes(entry.name)) {
    if (ask && !await confirmBox("已有同名预设", `预设文件夹中已有「${entry.name}」。恢复会用归档的版本覆盖它，是否继续？`, "覆盖")) return false;
  }
  await restorePresetFile(entry.name, data);
  const list = archiveList();
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  saveSettings();
  await userFileDel(entry.path).catch((e) => console.warn("[焦香鸡翅] 归档文件删除失败", e));
  dropDraft(entry.name);
  return true;
}

async function restoreArchivedByName(name) {
  const e = archiveList().find((x) => x.name === name);
  if (!e) return false;
  toast(`正在从归档恢复「${name}」…`);
  return restoreArchived(e, { ask: false });
}

// 酒馆自身的设置项，不能删
var CORE_EXT_KEYS = new Set(["disabledExtensions", "autoConnect", "notifyUpdates", "apiUrl", "apiKey", "presetAtelier"]);

// 酒馆内置功能存在 extension_settings 里的键
var BUILTIN_EXT_KEYS = { note: "作者注释", caption: "图片描述", expressions: "表情", connectionManager: "连接配置", dice: "骰子", gallery: "图库", memory: "总结", quickReply: "快速回复（旧版）", quickReplyV2: "快速回复", regex: "正则", tts: "语音朗读", sd: "图片生成", chromadb: "ChromaDB", translate: "翻译", vectors: "向量存储", variables: "变量", attachments: "附件", character_attachments: "角色附件", disabledAttachments: "附件", cfg: "CFG", objective: "目标", rvc: "RVC", speech_recognition: "语音识别", hypebot: "HypeBot", idle: "空闲提醒", assets: "资源下载", tokenCounter: "Token 计数", gallery_folders: "图库", regex_presets: "正则预设", disabled_attachments: "附件", expressionOverrides: "表情", character_allowed_regex: "正则", preset_allowed_regex: "正则" };

// 名字和扩展文件夹对不上、但已经核对过归属的键（扩展名见 maintenance/compat.js 的 PROVIDERS）
var KNOWN_EXT_KEYS = { tavern_helper: "tavernHelper", baiBaiToolkit: "baibaiTools", presetAtelierMaintenance: "self" };

var normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9一-龥]/g, "");

// 键排好序再转成文字：两本世界书字段顺序不同，内容一样时也能算出同一个指纹
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

// discoverExtensions 在 maintenance/compat.js
// 按名称推测这个键属于哪个已安装的扩展（推测，可能不准）
function guessOwner(key, exts) {
  if (BUILTIN_EXT_KEYS[key]) return { builtin: BUILTIN_EXT_KEYS[key] };
  const kid = KNOWN_EXT_KEYS[key];
  if (kid === "self") return { builtin: "本扩展" };
  if (kid) {
    const pv = PROVIDERS.find((x) => x.id === kid);
    const ext = exts?.find((x) => pv.match?.(x)) || null;
    return { known: pv.name, running: !!pv.running?.(), ext };
  }
  if (!exts) return null;
  const nk = normKey(key);
  if (nk.length < 2) return null;
  for (const x of exts) {
    const nf = normKey(x.base), nd = normKey(x.manifest?.display_name);
    if (nf && (nf === nk || nf.includes(nk) || nk.length >= 4 && nk.includes(nf) && nf.length >= 3)) return { ext: x };
    if (nd && (nd === nk || nd.includes(nk) || nk.length >= 4 && nk.includes(nd) && nd.length >= 3)) return { ext: x };
  }
  return null;
}

// 实际检测：下载每个扩展的脚本（顺着相对路径的 import 往下找），看里面有没有用到这个键
async function scanExtensionCode(exts, keys, onProgress) {
  const used = Object.fromEntries(keys.map((k) => [k, []]));
  const res = keys.map((k) => {
    const e = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [k, new RegExp(`["'\`]${e}["'\`]|\\.${e}\\b`)];
  });
  // 没查完的扩展（文件太多或读取失败），它们有可能用到这些数据
  const partial = [];
  for (const [i, x] of exts.entries()) {
    onProgress?.(i + 1, exts.length, x.manifest?.display_name || x.base);
    const entry = x.manifest?.js;
    if (!entry) continue;
    const root = new URL(`scripts/extensions/${x.name}/`, document.baseURI);
    const queue = [new URL(entry, root).href];
    const seen = new Set();
    let failed = false;
    while (queue.length && seen.size < 400) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      let text = "";
      // 任何一个文件没读到，这个扩展都算没查完
      try {
        const r = await fetch(u);
        if (!r.ok) {
          failed = true;
          continue;
        }
        text = await r.text();
      } catch {
        failed = true;
        continue;
      }
      for (const [k, re] of res) if (re.test(text) && !used[k].includes(x)) used[k].push(x);
      // 只跟进扩展自己文件夹里的模块
      for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
        const next = new URL(m[1], u).href;
        if (next.startsWith(root.href) && !seen.has(next)) queue.push(next);
      }
    }
    if (queue.length || failed) partial.push(x);
  }
  return { used, partial };
}

// 角色卡同名提示里点了「忽略」的组。只记在内存里：这次打开酒馆期间不再提示；
// 点「重新检测」或下次打开酒馆重新检测时清空，提示会再出现。组里的角色卡有增减时算新的一组。
var ignoredCharDups = new Set();

// 同名角色卡的完整内容：酒馆按需加载时列表里只有名字和头像（shallow），这里向服务器单独读取同名的几张来比较
var fullChars = new Map();

async function loadFullChar(avatar) {
  if (fullChars.has(avatar)) return fullChars.get(avatar);
  const p = (async () => {
    const r = await stPost("api/characters/get", { avatar_url: avatar });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  })();
  fullChars.set(avatar, p);
  try {
    const v = await p;
    fullChars.set(avatar, v);
    return v;
  } catch (e) {
    fullChars.set(avatar, e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
}

async function deleteCharacterKeepChats(avatar) {
  const r = await stPost("api/characters/delete", { avatar_url: avatar, delete_chats: false });
  if (!r.ok) throw new Error(`删除失败（${r.status}）`);
}

// 2.6.3 酒馆的 deleteWorldInfo 在它的名单里找不到这本书、或后台没删掉时只返回 false，不给原因。
// 这时直接调删除接口；删完或本来就不在了都算删掉，删不掉时写明酒馆给的原因
async function deleteWorldbook(name) {
  if (typeof mods.wi?.deleteWorldInfo === "function" && await mods.wi.deleteWorldInfo(name) !== false) return;
  const r = await stPost("api/worldinfo/delete", { name });
  const text = r.ok ? "" : await r.text().catch(() => "");
  try { await mods.wi?.updateWorldInfoList?.(); } catch {}
  if (r.ok || !listWorldbooks().includes(name)) return;
  if (/exist|ENOENT|not found/i.test(text)) throw new Error("酒馆找不到这本世界书的文件，刷新页面后再试");
  throw new Error(`酒馆返回 ${r.status}${text && text.length < 80 && !/<\w/.test(text) ? `：${text.trim()}` : ""}`);
}

async function backupAll() {
  return ((await tx("backups", "readonly", (s) => s.getAll())) || []).filter(backupMine);
}

async function backupDel(id) {
  await tx("backups", "readwrite", (s) => s.delete(id));
}
