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
  const sources = statusSources(d, world), display = statusDisplayRules(d);
  const list = statusCandidatesFrom(sources, display, rules);
  statusCache = { key, list, sources, display };
  return list;
}
// 这张卡状态栏的子标签（<时>、<地>……）：写着 <tag> 的条目里它后面出现的标签（到 </tag> 为止），以及美化它的正则里的其他标签
function statusChildrenFrom(tag, sources, display, rules) {
  const key = tag.toLowerCase();
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reserved = new Set([rules.bodyTag, ...rules.thinkingTags, ...rules.requiredTags].map((t) => t.toLowerCase()));
  const kids = new Set();
  for (const src of sources) {
    const open = new RegExp(`<\\s*${esc}(?:\\s[^<>]*)?>`, "iu").exec(src.text);
    if (!open) continue;
    let rest = src.text.slice(open.index + open[0].length);
    const close = new RegExp(`<\\s*\\/\\s*${esc}\\s*>`, "iu").exec(rest);
    if (close) rest = rest.slice(0, close.index);
    for (const t of replyTagTokens(replyCheckMask(rest))) if (!t.closing && !STATUS_SKIP.has(t.key)) kids.add(t.key);
  }
  for (const r of display) if (r.tags.has(key)) for (const t of r.tags) if (!STATUS_SKIP.has(t)) kids.add(t);
  for (const k of reserved) kids.delete(k);
  kids.delete(key);
  return kids;
}
function statusChildren(tag, rules, world, name = currentPresetName()) {
  statusCandidates(rules, world, name);
  return statusChildrenFrom(tag, statusCache.sources, statusCache.display, rules);
}

// 2.6.18 按子标签认出写坏的状态栏，改回这张卡的标签。子标签至少对上 2 个（定义里只有 1 个时对上它）才算：
// 另写了一份（<lxs_status> 之外又有一份 <状态栏>，字段相同）删去那一份；没有 <tag>、写成别的名字的改名；
// 只有开头的改名并补上结尾；外层整个漏掉、只剩一串字段的补上外层；外面多包一层像状态栏的标签的去掉这一层；
// <tag> 只有开头的补上结尾。正文、思考区里面不动。一次做一处，做到没有可改的为止。
// 返回 { text, steps, issues }，issues 是检查里要列出的问题（只点名这张卡的标签和写错的那个块）
function statusRepair(text, tag, children, rules) {
  let mes = String(text == null ? "" : text);
  const steps = [], issues = [], others = [];
  for (let n = 0; n < 6; n++) {
    const one = statusRepairOnce(mes, tag, children, rules);
    if (!one) break;
    mes = one.text;
    steps.push(one.step);
    if (one.issue && !issues.includes(one.issue)) { issues.push(one.issue); others.push(one.other || ""); }
  }
  return steps.length ? { text: mes, steps, issues, others } : null;
}
function statusRepairOnce(mes, tag, children, rules) {
  const key = tag.toLowerCase();
  const kids = new Set([...children].map((k) => String(k).toLowerCase()).filter((k) => k !== key));
  if (!kids.size) return null;
  const need = Math.min(2, kids.size);
  const masked = replyCheckMask(mes);
  const tokens = replyTagTokens(masked);
  const pairs = replyPairRanges(masked);
  const thinking = new Set(rules.thinkingTags.map((t) => t.toLowerCase()));
  const bodyKey = rules.bodyTag.toLowerCase();
  // 不动正文、思考区和这张卡自己的状态栏；别的必需标签（含填在里面的泛称「状态栏」）照样按字段判断
  const reserved = new Set([rules.bodyTag, ...rules.thinkingTags, tag].map((t) => t.toLowerCase()));
  const guards = pairs.filter((p) => p.key === bodyKey || thinking.has(p.key) || p.key === key);
  const guarded = (pos) => guards.some((g) => pos >= g.start && pos < g.end);
  const distinct = (from, to) => new Set(tokens.filter((t) => t.start >= from && t.end <= to && kids.has(t.key)).map((t) => t.key)).size;
  // 块里的子标签过半是状态栏字段才算（读者段评里偶尔有个 <言> 不算）
  const mostly = (from, to, self) => {
    const all = new Set(tokens.filter((t) => t.start >= from && t.end <= to && t.key !== self).map((t) => t.key));
    const hit = [...all].filter((k) => kids.has(k)).length;
    return hit >= need && hit * 2 >= all.size;
  };
  const label = (b) => `<${b.name}>`;
  const cut = (start, end) => {
    const before = mes.slice(0, start).replace(/\s+$/, ""), after = mes.slice(end).replace(/^\s+/, "");
    return before + (before && after ? "\n" : "") + after;
  };
  const trimEnd = (end, from) => { while (end > from && /\s/.test(mes[end - 1])) end--; return end; };
  const own = pairs.filter((p) => p.key === key);
  // 外面多包一层像状态栏的标签
  if (own.length) {
    const w = replyWrapPairs(masked, (k) => k === key, (k) => !reserved.has(k) && !kids.has(k) && STATUS_HINT.test(k))[0];
    if (w) {
      const name = /^<\s*([^\s<>\/]+)/.exec(mes.slice(w.outer.start, w.outer.start + 60))?.[1] || w.outer.key;
      return { text: mes.slice(0, w.outer.start) + mes.slice(w.inner.start, w.inner.end) + mes.slice(w.outer.end), step: `去掉 <${tag}> 外面多包的 <${name}>…</${name}>`, issue: `<${tag}> 外面多包了一层 <${name}>`, other: name };
    }
  }
  // 写坏的状态栏：成对的别名块、只有开头的别名块、没有外层的一串字段
  const top = replyTopBlocks(mes).filter((b) => b.key !== REPLY_FENCE_KEY);
  const inTop = (pos) => top.some((b) => !kids.has(b.key) && pos >= b.start && pos < b.end);
  const found = [];
  for (const b of top) {
    if (reserved.has(b.key) || kids.has(b.key) || guarded(b.start)) continue;
    if (mostly(b.start, b.end, b.key)) found.push({ kind: "pair", start: b.start, end: b.end, name: b.name });
  }
  // 往后收字段，碰到别的标签停下；末尾的空白不算
  const run = (from, i) => {
    let j = i;
    while (j < tokens.length && kids.has(tokens[j].key)) j++;
    return { end: trimEnd(j < tokens.length ? tokens[j].start : mes.length, from), next: j };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.closing || t.selfClosing || reserved.has(t.key) || guarded(t.start) || inTop(t.start)) continue;
    if (!kids.has(t.key)) {
      if (tokens.some((u) => u.closing && u.key === t.key && u.start > t.start)) continue;
      const r = run(t.end, i + 1);
      if (mostly(t.end, r.end, t.key)) found.push({ kind: "open", start: t.start, openEnd: t.end, end: r.end, name: t.name });
      i = r.next - 1;
    } else {
      const r = run(t.start, i);
      if (distinct(t.start, r.end) >= need) found.push({ kind: "bare", start: t.start, end: r.end });
      i = r.next - 1;
    }
  }
  if (own.length) {
    const f = found.at(-1);
    if (!f) return null;
    const what = f.kind === "bare" ? "一串状态栏字段" : f.kind === "pair" ? `<${f.name}>…</${f.name}>` : `<${f.name}> 开头的一段`;
    return { text: cut(f.start, f.end), step: `删去另写的一份状态栏（${what}）`, issue: `状态栏写了两份：<${tag}> 之外还有${f.kind === "bare" ? "一串没有外层的状态栏字段" : `一份 ${label(f)}`}`, other: f.name };
  }
  // <tag> 只有开头：在字段末尾补上结尾
  const openOwn = tokens.find((t) => t.key === key && !t.closing && !t.selfClosing && !guarded(t.start));
  if (openOwn && !tokens.some((t) => t.key === key && t.closing)) {
    const i = tokens.indexOf(openOwn);
    const r = run(openOwn.end, i + 1);
    if (distinct(openOwn.end, r.end) >= need) return { text: mes.slice(0, r.end) + `\n</${tag}>` + mes.slice(r.end), step: `在状态栏末尾补上 </${tag}>`, issue: `<${tag}> 没有结尾` };
  }
  const f = found.at(-1);
  if (!f) return null;
  if (f.kind === "pair") {
    const openEnd = masked.indexOf(">", f.start) + 1, closeStart = masked.lastIndexOf("<", f.end - 1);
    return { text: mes.slice(0, f.start) + `<${tag}>` + mes.slice(openEnd, closeStart) + `</${tag}>` + mes.slice(f.end), step: `把 <${f.name}>…</${f.name}> 改名为 <${tag}>…</${tag}>`, issue: `状态栏写成了 <${f.name}>…</${f.name}>，应为 <${tag}>`, other: f.name };
  }
  if (f.kind === "open") return { text: mes.slice(0, f.start) + `<${tag}>` + mes.slice(f.openEnd, f.end) + `\n</${tag}>` + mes.slice(f.end), step: `把 <${f.name}> 改为 <${tag}>，并补上 </${tag}>`, issue: `状态栏写成了 <${f.name}>，应为 <${tag}>…</${tag}>`, other: f.name };
  return { text: mes.slice(0, f.start) + `<${tag}>\n` + mes.slice(f.start, f.end) + `\n</${tag}>` + mes.slice(f.end), step: `用 <${tag}>…</${tag}> 包住状态栏字段`, issue: `状态栏字段外面没有 <${tag}>` };
}
// 检查结果里补上状态栏的问题（kind "status"），和已有的问题不重复
function statusCheck(report, text, tag, children, rules) {
  const fix = statusRepair(text, tag, children, rules);
  if (!fix) return null;
  const key = tag.toLowerCase();
  const had = report.issues.filter((i) => i.tag?.toLowerCase() === key && i.kind !== "missing");
  fix.issues.forEach((t, n) => {
    if (t.includes("多包了一层") && had.some((i) => i.kind === "wrapped")) return;
    if (t.endsWith("没有结尾") && had.some((i) => i.kind === "missing" || i.kind === "order")) return;
    report.issues.push({ kind: "status", tag, text: t, ...(fix.others[n] ? { other: fix.others[n] } : {}) });
  });
  // 状态栏改回后不再算缺；写错名字的「缺少」由这里的说法代替
  if (fix.issues.some((t) => t.startsWith("状态栏写成了") || t.startsWith("状态栏字段外面"))) report.issues = report.issues.filter((i) => !(i.kind === "missing" && i.tag?.toLowerCase() === key));
  return fix;
}
const statusFixOn = () => settings().statusFix !== false;

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
  if (kinds.has("wrapped") || mine.some((i) => i.kind === "status" && i.text.includes("多包了一层"))) parts.push(`${t} 直接输出，外面不要再包其他标签。`);
  if (mine.some((i) => i.kind === "status" && i.text.startsWith("状态栏写了两份"))) parts.push(`状态栏只输出一份 ${t}，不要另写一份。`);
  else if (!parts.length && mine.some((i) => i.kind === "status")) parts.push(`状态栏用 ${t} 包住，开头和结尾的标签名一字不改。`);
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
// 状态栏修正和「修正这条回复」能做的合成一份方案（applyReplyFix 用）：先改状态栏；general 时再做一般修正
function statusPlan(text, rules, extra, statusFix, general, opts = {}) {
  const mes = statusFix ? statusFix.text : String(text == null ? "" : text);
  const pre = statusFix ? statusFix.steps : [];
  const plan = general ? planReplyFix(mes, rules, { ...extra, ...opts }) : null;
  if (plan) return { ...plan, steps: [...pre, ...plan.steps] };
  if (!pre.length) return null;
  return { text: mes, reasoning: typeof extra.reasoning === "string" ? extra.reasoning : null, reasoningChanged: false, steps: pre, after: checkReplyFormat(mes, rules, extra) };
}
// 前面的回复里写坏的状态栏（一并修正用）
function statusEarlierFix(tag, children, rules) {
  const kids = [...children].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!kids.length) return null;
  const test = new RegExp(`<\\s*(?:${kids.join("|")})(?=[\\s>/])`, "iu");
  return { test, fix: (text) => { const f = statusRepair(text, tag, children, rules); return f && { text: f.text, steps: f.steps, pairs: f.issues }; } };
}
// 这张卡已有状态栏标签时，预设条目里另要求的状态栏块（会让模型写两份）
function statusConflicts(tag, list) {
  const key = String(tag || "").toLowerCase();
  return (list || []).filter((c) => c.key !== key && c.hint && c.pair && c.from.some((f) => f.startsWith("预设条目")));
}
