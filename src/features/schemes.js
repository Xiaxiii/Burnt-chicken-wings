// 方案：记录、比对、套用、绑定（原 ui/schemes.js）
var META_KEY = "presetAtelierScheme";

var LIKELY = /文风|风格|人设|人物|角色|情感|基调|性格|题材|狗|daddy|年上|年下|nsfw|涩|色|play|玩法|关系|buff/i;

function schemeStates(d, scheme) {
  const ids = scheme.scope === "all" ? d.order.map((o) => o.identifier) : d.order.filter((o) => scheme.scope.includes(d.groupOf(o.identifier))).map((o) => o.identifier);
  const states = {};
  for (const id of ids) states[id] = d.order.find((o) => o.identifier === id)?.enabled !== false;
  const groupStates = {};
  for (const g of d.groups.groups) if (scheme.scope === "all" || scheme.scope.includes(g.id)) groupStates[g.id] = g.enabled !== false;
  return { states, groupStates };
}

function schemeMatches(d, scheme) {
  for (const [id, on] of Object.entries(scheme.states || {})) {
    const o = d.order.find((x) => x.identifier === id);
    if (o && o.enabled !== false !== on) return false;
  }
  for (const [gid, on] of Object.entries(scheme.groupStates || {})) {
    const g = d.group(gid);
    if (g && g.enabled !== false !== on) return false;
  }
  return true;
}

// 1.9.8 方案记下保存时的 API 连接（不要求先存成站点）。旧方案只记了站点编号的，按站点算
function schemeConn(s) {
  if (s.conn && s.conn.source) return s.conn;
  const site = s.siteId ? settings().sites.find((x) => x.id === s.siteId) : null;
  if (!site) return null;
  const v = keyView(site);
  return { source: site.source, url: site.url || "", model: v.model || "", secretId: v.secretId || null, siteId: site.id, keyId: siteMulti(site) ? v.keyId : null };
}

// 用来连接的「站点」：有对应站点就用站点（带着它的密钥、名称），模型用方案记的
function connSite(conn) {
  if (!conn) return null;
  const site = conn.siteId ? settings().sites.find((x) => x.id === conn.siteId) : null;
  if (site) {
    // 2.5.0 多密钥站点用方案记的那个分组（分组删了就用站点上次用的）
    const v = keyView(site, conn.keyId);
    return { ...v, model: conn.model || v.model };
  }
  return { name: connLabel(conn, { model: false }), source: conn.source, url: conn.url || "", model: conn.model || "", secretId: conn.secretId || null };
}

function connLabel(conn, { model = true } = {}) {
  if (!conn) return "";
  const site = conn.siteId ? settings().sites.find((x) => x.id === conn.siteId) : null;
  let where = site?.name || "";
  if (site && siteMulti(site) && conn.keyId) where += ` · ${keyName(site, siteKey(site, conn.keyId))}`;
  if (!where) {
    try { where = conn.source === "custom" && conn.url ? new URL(conn.url).host : SOURCES[conn.source]?.label || conn.source; } catch { where = conn.url || conn.source; }
  }
  return model && conn.model ? `${where} · ${conn.model}` : where;
}

// 现在酒馆的连接 → 方案里记的样子；能对上已存的站点就顺带记站点编号（显示名称用）
function liveConn() {
  const live = liveConnection();
  if (live.mainApi && live.mainApi !== "openai") return null;
  if (!live.source) return null;
  // 多密钥站点逐个分组比；密钥编号对得上的优先
  const hits = [];
  for (const x of settings().sites) {
    for (const v of siteMulti(x) ? x.keys.map((k) => keyView(x, k.id)) : [x]) {
      if (!siteDiffers({ ...v, model: "" }, { ...live, online: true })) hits.push({ site: x, v });
    }
  }
  const hit = hits.find((h) => h.v.secretId && h.v.secretId === live.secretId) || hits[0];
  return { source: live.source, url: live.url || "", model: live.model || "", secretId: live.secretId || null, siteId: hit?.site.id || null, keyId: hit && siteMulti(hit.site) ? hit.v.keyId : null };
}

function connDiffers(conn) {
  const s = connSite(conn);
  return !!s && siteDiffers(s);
}

async function applyScheme(scheme, { quiet = false, why = "", silent = false } = {}) {
  // 1.5.0：预设已归档的，先从归档恢复
  if (!listPresets().includes(scheme.preset) && archiveList().some((x) => x.name === scheme.preset)) {
    try {
      await restoreArchivedByName(scheme.preset);
    } catch (e) {
      toast(`从归档恢复「${scheme.preset}」失败：${e.message}`, "error");
      return false;
    }
  }
  if (!listPresets().includes(scheme.preset)) {
    toast(`方案「${scheme.name}」对应的预设「${scheme.preset}」已不存在`, "error");
    return false;
  }
  // 1.9.8：切方案恢复它记下的 API；不改「使用中」站点，方案之间互不影响。没记 API 的方案不动 API
  const conn = schemeConn(scheme);
  const site = connSite(conn);
  // 先处理这个预设上没存完的修改，再切换（切换后会丢掉旧草稿重新读）
  const old = drafts.get(scheme.preset);
  if (old?.dirty) {
    if (!quiet && !await confirmBox("有未保存的修改", `「${scheme.preset}」有未保存的修改，套用方案前会先保存。是否继续？`, "继续")) return false;
    try {
      await saveDraft(scheme.preset, "套用方案前保存");
    } catch (e) {
      handleSaveError(scheme.preset, e);
      toast(`「${scheme.preset}」的修改没有保存成功，未套用方案`, "error");
      return false;
    }
  }
  // 整个套用过程中由这里负责连接，避免「切换预设后恢复站点」同时再连一次
  if (site) applying = true;
  try {
    if (currentPresetName() !== scheme.preset) {
      await selectPreset(scheme.preset);
      dropDraft(scheme.preset);
    }
    const d = getDraft(scheme.preset);
    if (!schemeMatches(d, scheme)) {
      d.snapshot("套用方案");
      // 分组标记与单条选择分别恢复，分组开关不覆盖内部条目。
      for (const [gid, on] of Object.entries(scheme.groupStates || {})) d.setGroupEnabled(gid, on);
      for (const [id, on] of Object.entries(scheme.states || {})) d.setEnabled([id], on);
      try {
        await saveDraft(scheme.preset, `套用方案 ${scheme.name}`);
      } catch (e) {
        handleSaveError(scheme.preset, e);
        return false;
      }
    }
    if (scheme.persona) await setPersona(scheme.persona);
    if (site && siteDiffers(site)) {
      try {
        const live = await applyConnection(site);
        if (!live.online) toast(`已切换到「${connLabel(conn)}」，但未连接成功。请检查网址和密钥`, "warning");
      } catch (e) {
        toast(`API「${connLabel(conn)}」连接失败：${e.message}`, "error");
      }
    }
  } finally {
    if (site) applying = false;
  }
  scheme.usedAt = Date.now();
  saveSettings();
  if (!silent) toast(`${why ? `自动套用（${why}）：` : "已切换到"}「${scheme.name}」${scheme.persona ? `，人设：${scheme.personaName || ""}` : ""}${conn ? `，API：${connLabel(conn)}` : ""}`, "success");
  return true;
}

// 自动套用的绑定：聊天绑定存在聊天文件里；角色绑定存在本扩展设置里（这个角色的任何聊天都算）。聊天绑定优先
function currentCharKey() {
  const c = ctx();
  if (c.groupId) return "group:" + c.groupId;
  return c.characters?.[Number(c.characterId)]?.avatar || null;
}

function currentCharName() {
  const c = ctx();
  if (c.groupId) return c.groups?.find((g) => g.id === c.groupId)?.name || "本群聊";
  return c.characters?.[Number(c.characterId)]?.name || "";
}

function bindingNow() {
  if (!hasChat()) return null;
  const chatId = chatMeta()[META_KEY];
  if (chatId) return { scope: "chat", id: chatId };
  const k = currentCharKey();
  const charId = k ? settings().schemeCharBind?.[k] : null;
  return charId ? { scope: "char", id: charId } : null;
}

function boundSchemeId() {
  return bindingNow()?.id || null;
}

var BIND_LABEL = { chat: "本聊天", char: "本角色" };

// 方案按角色卡归类（也可切到按预设、按人设看）。每条方案记：角色卡、预设、人设、API 站点、时间。
// 归属角色卡：保存时在聊天里就记当前角色卡；旧方案没有记录的，看有没有绑定在某个角色上，否则归「未分角色」
function schemeCharKey(s) {
  if (s.charKey) return s.charKey;
  const cb = settings().schemeCharBind || {};
  return Object.keys(cb).find((k) => cb[k] === s.id) || "";
}

function charNameOf(key) {
  if (!key) return "未分角色";
  const c = ctx();
  if (key.startsWith("group:")) return c.groups?.find((g) => "group:" + g.id === key)?.name || "群聊";
  return c.characters?.find((x) => x.avatar === key)?.name || key.replace(/\.png$/i, "");
}

function shortTime(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
