// 2.6.17 每张角色卡的状态栏标签。状态栏标签随卡而变（<lxs_status>、<状态栏>、<StatusBlock>……），预设里的必需标签管不了：
// 按卡记下玩家选的条目或填的标签；没记的，从这张卡生效的世界书、角色卡、预设条目和显示正则里自动认。
// 检查回复时把它当作必需标签；掉了时下一轮提醒一次，提醒只点名这张卡的状态栏标签
var STATUS_HINT = /状态栏|状态|status|面板|属性栏|信息栏|仪表|hud/i;
var STATUS_SKIP = new Set(["br", "div", "span", "p", "b", "i", "u", "s", "a", "img", "em", "strong", "font", "center", "small", "big", "sup", "sub", "hr",
  "code", "pre", "blockquote", "q", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "nav", "aside", "details", "summary", "style", "script", "svg", "path", "button", "input", "label", "think", "thinking"]);
// 状态栏掉了时排好的下一轮提醒（与「下一轮提醒一次」一起加入，用完即清，换聊天作废）
var statusRemindNext = null;
var statusCache = null;

// 当前角色卡：单人聊天按头像文件名，群聊按群 id
function statusCard(c = ctx()) {
  const ch = c.characterId != null ? c.characters?.[Number(c.characterId)] : null;
  if (ch?.avatar) return { key: `char:${ch.avatar}`, name: ch.name || ch.avatar };
  if (c.groupId != null && c.groupId !== "") {
    const g = (c.groups || []).find((x) => String(x?.id) === String(c.groupId));
    return { key: `group:${c.groupId}`, name: g?.name || "群聊" };
  }
  return null;
}
function statusSaved(card = statusCard()) {
  return card && settings().statusBars?.[card.key] || null;
}
// value：{ tag, from }（选定的标签和出处）、{ off: true }（这张卡不检查状态栏）；null 删掉，改回自动识别
function statusSave(card, value) {
  const all = { ...(settings().statusBars || {}) };
  if (value) all[card.key] = { ...value, card: card.name };
  else delete all[card.key];
  settings().statusBars = all;
  saveSettings();
  statusCache = null;
}
const statusRemindOn = () => settings().statusRemind !== false;

// 显示正则（作用于 AI 输出、不只改提示词）里锚定的标签：预设、角色卡、全局各自的
function statusDisplayRules(d, c = ctx()) {
  const ch = c.characterId != null ? c.characters?.[Number(c.characterId)] : null;
  const out = [];
  const add = (list, kind, own) => {
    for (const rule of Array.isArray(list) ? list : []) {
      if (!rule || rule.disabled || rule.promptOnly && !rule.markdownOnly || !(rule.placement || []).includes(2)) continue;
      let tags;
      try { tags = presetRegexAnchors(rule).tags; } catch { continue; }
      if (tags.size) out.push({ label: `${kind}「${rule.scriptName || "未命名"}」`, tags, find: String(rule.findRegex || ""), own });
    }
  };
  try { add(presetRegexList(d), "预设正则", false); } catch {}
  add(ch?.data?.extensions?.regex_scripts, "角色卡正则", true);
  add(c.extensionSettings?.regex, "全局正则", false);
  return out;
}
// 写着输出格式的地方：预设开着的条目、角色卡字段、当前生效的世界书条目。own：这张卡自己的（角色卡、角色或聊天绑定的世界书）
function statusSources(d, world, c = ctx()) {
  const out = [];
  try {
    for (const o of d.order) {
      if (!d.isActive(o.identifier)) continue;
      const p = d.prompt(o.identifier);
      if (typeof p?.content === "string" && p.content.includes("<")) out.push({ text: p.content, from: `预设条目「${p.name || o.identifier}」`, title: p.name || "", own: false });
    }
  } catch {}
  const ch = c.characterId != null ? c.characters?.[Number(c.characterId)] : null;
  if (ch) {
    const fields = [["描述", ch.description], ["性格", ch.personality], ["场景", ch.scenario], ["开场白", ch.first_mes], ["对话示例", ch.mes_example],
      ["系统提示", ch.data?.system_prompt], ["历史后指令", ch.data?.post_history_instructions], ...(ch.data?.alternate_greetings || []).map((g) => ["备选开场白", g])];
    for (const [label, text] of fields) if (typeof text === "string" && text.includes("<")) out.push({ text, from: `角色卡${label}`, title: "", own: true });
  }
  const mine = new Set(statusCardBooks(c));
  for (const t of world?.texts || []) out.push({ text: t.text, from: t.from, title: t.title || "", own: mine.has(t.book) });
  return out;
}
// 这张卡自己的世界书：角色绑定、角色附加、聊天绑定（全局启用的不算）
function statusCardBooks(c = ctx()) {
  const wi = mods.wi;
  const ch = c.characterId != null ? c.characters?.[Number(c.characterId)] : null;
  const names = [];
  if (ch?.data?.extensions?.world) names.push(String(ch.data.extensions.world));
  const file = String(ch?.avatar || "").replace(/\.[^.]+$/, "");
  for (const l of Array.isArray(wi?.world_info?.charLore) ? wi.world_info.charLore : []) if (file && l?.name === file) for (const n of l.extraBooks || []) names.push(String(n));
  if (c.chatMetadata?.world_info) names.push(String(c.chatMetadata.world_info));
  return names;
}

// 候选的状态栏块：来源里成对写出的标签，加上显示正则锚定、来源里提到过的标签。打分：
// 显示正则美化它 +4；成对写出 +1，里面还有子标签 +1；标签名像状态栏（状态栏、status、面板等）+3；
// 条目名或块前面的说明提到状态栏 +3；出自这张卡自己的角色卡、世界书或正则 +2
function statusCandidatesFrom(sources, display, rules) {
  const skip = new Set([...STATUS_SKIP, rules.bodyTag.toLowerCase(), ...rules.thinkingTags.map((t) => t.toLowerCase())]);
  const map = new Map();
  const get = (key, name) => {
    let c = map.get(key);
    if (!c) map.set(key, c = { key, name, from: [], regex: [], pair: false, children: false, context: false, own: false });
    return c;
  };
  const valid = (name) => /^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(name);
  // 块里面的子标签（<时>、<地>）不算候选；外面只包着 HTML 标签的照算
  const nested = new Set();
  for (const src of sources) {
    const masked = replyCheckMask(src.text);
    let reach = -1;
    for (const p of replyPairRanges(masked).sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (skip.has(p.key)) continue;
      if (p.end <= reach) { nested.add(p.key); continue; }
      reach = p.end;
      const name = /^<\s*([^\s<>\/]+)/.exec(src.text.slice(p.start, p.start + 60))?.[1] || p.key;
      if (!valid(name)) continue;
      const c = get(p.key, name);
      c.pair = true;
      if (replyTagTokens(masked.slice(masked.indexOf(">", p.start) + 1, p.start + masked.slice(p.start, p.end).lastIndexOf("<"))).length) c.children = true;
      if (!c.from.includes(src.from) && c.from.length < 4) c.from.push(src.from);
      if (STATUS_HINT.test(src.title) || STATUS_HINT.test(src.text.slice(Math.max(0, p.start - 40), p.start))) c.context = true;
      if (src.own) c.own = true;
    }
  }
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const r of display) {
    for (const key of r.tags) {
      if (skip.has(key)) continue;
      let c = map.get(key);
      if (!c && nested.has(key)) continue;
      if (!c) {
        // 来源里没成对写出、只有正则美化的：从查找式里取原样大小写
        const name = new RegExp(esc(key), "iu").exec(r.find)?.[0] || key;
        if (!valid(name) || !sources.some((s) => new RegExp(`<\\s*${esc(key)}(?=[\\s>/])`, "iu").test(s.text)) && !STATUS_HINT.test(name)) continue;
        c = get(key, name);
      }
      if (!c.regex.includes(r.label)) c.regex.push(r.label);
      if (r.own) c.own = true;
    }
  }
  const list = [...map.values()].filter((c) => c.regex.length || c.children || STATUS_HINT.test(c.name) || c.context);
  for (const c of list) {
    c.hint = STATUS_HINT.test(c.name) || c.context;
    c.score = (c.regex.length ? 4 : 0) + (c.pair ? 1 : 0) + (c.children ? 1 : 0) + (STATUS_HINT.test(c.name) ? 3 : 0) + (c.context ? 3 : 0) + (c.own ? 2 : 0);
  }
  return list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
// 认得准才自动用：最高分像状态栏（名字或说明提到）、有正则美化或子标签结构，且比第二名高出 2 分以上
function statusAutoPick(list) {
  const [top, next] = list;
  if (!top || !top.hint || !(top.regex.length || top.children) || top.score < 7) return null;
  return !next || top.score - next.score >= 2 ? top : null;
}
function statusCandidates(rules, world, name = currentPresetName()) {
  const card = statusCard();
  const key = JSON.stringify([card?.key, name, world?.key, world?.at, replyTagsEpoch, rules.bodyTag, rules.thinkingTags]);
  if (statusCache?.key === key) return statusCache.list;
  let d = null;
  try { d = getDraft(name); } catch {}
  const list = statusCandidatesFrom(statusSources(d, world), statusDisplayRules(d), rules);
  statusCache = { key, list };
  return list;
}
// 这张卡的状态栏：state 为 manual（玩家选定）、auto（自动认出）、ambiguous（有候选、认不准）、none（没找到）、
// off（玩家设为不检查）、nocard（没开角色卡）、pending（要读世界书才知道）
function statusResolve(rules, world, name = currentPresetName()) {
  const card = statusCard();
  if (!card) return { card: null, state: "nocard" };
  const saved = statusSaved(card);
  if (saved?.off) return { card, state: "off" };
  if (saved?.tag) return { card, state: "manual", tag: saved.tag, from: saved.from || "" };
  if (!world) return { card, state: "pending" };
  const list = statusCandidates(rules, world, name);
  const pick = statusAutoPick(list);
  if (pick) return { card, state: "auto", tag: pick.name, from: pick.from[0] || pick.regex[0] || "", list };
  return { card, state: list.length ? "ambiguous" : "none", list };
}
// 需要时读世界书（读过的直接用）
async function statusFor(rules, name = currentPresetName()) {
  const status = statusResolve(rules, replyWorldReady(), name);
  if (status.state !== "pending") return status;
  return statusResolve(rules, await replyWorldTexts(), name);
}
// 把这张卡的状态栏标签加进必需标签
// 与正文标签、思考标签同名的不加（加了规则会报错，整条检查都做不成）
function statusRules(config, status) {
  const req = Array.isArray(config.requiredTags) ? config.requiredTags : String(config.requiredTags || "").split(/[,，、;；\s]+/u).filter(Boolean);
  const key = status?.tag ? String(status.tag).toLowerCase() : "";
  if (!key || req.some((t) => String(t).toLowerCase() === key)) return { ...config, requiredTags: req };
  try {
    const base = normalizeReplyRules({ ...config, requiredTags: req });
    if (base.bodyTag.toLowerCase() === key || base.thinkingTags.some((t) => t.toLowerCase() === key)) return { ...config, requiredTags: req };
  } catch { return { ...config, requiredTags: req }; }
  return { ...config, requiredTags: [...req, status.tag] };
}
// 状态栏出了问题时的下一轮提醒：只点名这张卡的状态栏标签，不复述写错的名字
function statusReminder(report, tag) {
  const key = tag.toLowerCase();
  const mine = report.issues.filter((i) => i.tag?.toLowerCase() === key || i.kind === "stranded" && i.text.toLowerCase().includes(`<${key}>`));
  if (!mine.length) return "";
  const t = `<${tag}>…</${tag}>`;
  const kinds = new Set(mine.map((i) => i.kind));
  const parts = [];
  if (kinds.has("stranded") || kinds.has("swallowed")) parts.push(`上一轮的 <${tag}> 写进了思考区：思考标签先闭合，再输出正文和 ${t}。`);
  else if (mine.some((i) => i.kind === "missing" && i.text.startsWith("缺少完整的"))) parts.push(`上一轮回复没有 ${t}。本轮正文结束后照常输出，标签名一字不改。`);
  else if (kinds.has("missing") || kinds.has("order") || kinds.has("duplicate")) parts.push(`上一轮的 ${t} 不完整或重复。本轮完整输出一次，开头和结尾的标签名一字不改。`);
  if (kinds.has("wrapped")) parts.push(`${t} 直接输出，外面不要再包其他标签。`);
  return parts.length ? `【状态栏提醒】${parts.join("")}这条提醒只管状态栏格式，剧情照常接着写。` : "";
}
function armStatusReminder(text) {
  statusRemindNext = text ? { chat: replyChatKey(), text } : null;
}
// 最近 n 条 AI 回复里有几条写了这个标签（选择时给玩家参考）
function statusRecentCount(chat, key, n = 20) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<\\s*${esc}(?=[\\s>/])`, "iu");
  let seen = 0, hit = 0;
  for (let i = (Array.isArray(chat) ? chat.length : 0) - 1; i >= 0 && seen < n; i--) {
    const m = chat[i];
    if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
    seen++;
    if (re.test(m.mes)) hit++;
  }
  return { seen, hit };
}
// 世界书条目里成对写出的标签，供玩家逐条挑选
function statusEntryTags(world, rules) {
  const skip = new Set([...STATUS_SKIP, rules.bodyTag.toLowerCase(), ...rules.thinkingTags.map((t) => t.toLowerCase())]);
  const out = [];
  for (const t of world?.texts || []) {
    const masked = replyCheckMask(t.text);
    const names = new Map();
    for (const p of replyPairRanges(masked).sort((a, b) => a.start - b.start)) {
      if (skip.has(p.key) || names.has(p.key)) continue;
      const name = /^<\s*([^\s<>\/]+)/.exec(t.text.slice(p.start, p.start + 60))?.[1] || p.key;
      if (/^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(name)) names.set(p.key, name);
    }
    if (names.size) out.push({ from: t.from, tags: [...names.values()] });
  }
  return out;
}
