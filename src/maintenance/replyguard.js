// 只检查当前回复原文；格式提醒通过酒馆的临时提示接口加入，不改聊天或预设正文。
// 2.6.11 不再自动提醒。检查发现问题后，玩家在「思维链 → 格式」点「下一轮提醒一次」，下一次生成加入一次，用完即清；
// 生成后发现问题时只弹提示给玩家看（不发给 AI），点提示打开检查
var REPLY_GUARD_KEY = "presetAtelier:reply-format";
function replyGuardConfig(name = currentPresetName()) {
  const saved = settings().replyGuard;
  return saved && Object.hasOwn(saved, name) ? saved[name] : {};
}
function replyGuardAvailable(c = ctx()) {
  return typeof c.setExtensionPrompt === "function" && !!(c.eventTypes || c.event_types)?.GENERATION_AFTER_COMMANDS;
}
function latestReplyForCheck(chat) {
  if (!Array.isArray(chat)) return null;
  let hasUser = false, last = null;
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    if (m.is_user) hasUser = true;
    else if (hasUser && m.is_user === false && typeof m.mes === "string") last = { index: i, message: m };
  }
  return last;
}
// 照第 index 条之前的几条 AI 回复学：状态栏、小剧场等完整块在正文前还是后（开场白也算）
function replyLayoutBefore(chat, index, rules) {
  const texts = [];
  for (let i = Math.min(index, Array.isArray(chat) ? chat.length : 0) - 1; i >= 0 && texts.length < 10; i--) {
    const m = chat[i];
    if (m && !m.is_user && !m.is_system && typeof m.mes === "string") texts.push(m.mes);
  }
  return learnReplyLayout(texts, rules);
}
// 2.5.6 预设开着的条目、预设正则、角色卡文字和正则、全局正则里出现过的标签名（小写）。
// 判断回复里多出来的块是不是写错了名字的必需标签（如把 <lxs_status> 写成 <状态栏>）；读不到预设时返回 null，不判断。
// 2.5.7 tags.children：want 里每个必需标签内部写过哪些子标签（条目里 <lxs_status>…</lxs_status> 之间的、同一条正则里的其他标签），
// 用来确认陌生块的结构对得上
// 2.6.11 tags.asked：条目、角色卡、世界书里写过的（要求模型输出的），不含只在正则里出现的，用来判断必需标签这张卡用不用。
// 2.6.12 预设和角色卡一份、世界书一份，分开扫、分开缓存，用到时合起来。
// 2.6.16 tags.from：每个标签写在哪里（预设条目「名称」、世界书「书名」条目「名称」等），每个标签最多记 8 处，格式检查里列给玩家看
function replyTagScanner(want) {
  const tags = new Set();
  const asked = new Set();
  const from = new Map();
  const children = new Map(want.map((t) => [String(t).toLowerCase(), new Set()]));
  tags.children = children;
  tags.asked = asked;
  tags.from = from;
  const tagRe = /<\s*\/?\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39})/gu;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const note = (key, label) => {
    if (!label) return;
    let set = from.get(key);
    if (!set) from.set(key, set = new Set());
    if (set.size < 8) set.add(label);
  };
  const scan = (text, ask = true, label = "") => {
    const str = String(text || "");
    if (!str.includes("<")) return;
    for (const m of str.matchAll(tagRe)) {
      const key = m[1].toLowerCase();
      tags.add(key);
      if (ask) asked.add(key);
      note(key, label);
    }
    for (const [tag, set] of children) {
      if (!str.toLowerCase().includes(`<${tag}`)) continue;
      for (const m of str.matchAll(new RegExp(`<\\s*${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*${esc(tag)}\\s*>`, "giu"))) {
        for (const c of m[1].matchAll(tagRe)) if (c[1].toLowerCase() !== tag) set.add(c[1].toLowerCase());
      }
    }
  };
  const rules = (list, kind) => {
    for (const rule of Array.isArray(list) ? list : []) {
      if (!rule || rule.disabled) continue;
      const label = `${kind}「${rule.scriptName || "未命名"}」`;
      try {
        const found = presetRegexAnchors(rule).tags;
        for (const t of found) { tags.add(t); note(t, label); }
        for (const [tag, set] of children) if (found.has(tag)) for (const t of found) if (t !== tag) set.add(t);
      } catch {}
      scan(rule.replaceString, false, label);
    }
  };
  return { tags, scan, rules };
}
function replyKnownTags(name = currentPresetName(), want = [], world = null) {
  const own = replyPresetTags(name, want);
  return own && replyMergeTags(own, world ? replyWorldTags(world, want) : null);
}
function replyPresetTags(name, want) {
  const { tags, scan, rules } = replyTagScanner(want);
  try {
    const d = getDraft(name);
    for (const o of d.order) {
      if (!d.isActive(o.identifier)) continue;
      const p = d.prompt(o.identifier);
      scan(p?.content, true, `预设条目「${p?.name || o.identifier}」`);
    }
    try { rules(presetRegexList(d), "预设正则"); } catch {}
  } catch { return null; }
  try {
    const c = ctx();
    const ch = c.characters?.[Number(c.characterId)];
    if (ch) {
      const fields = [["描述", ch.description], ["性格", ch.personality], ["场景", ch.scenario], ["开场白", ch.first_mes], ["对话示例", ch.mes_example],
        ["系统提示", ch.data?.system_prompt], ["历史后指令", ch.data?.post_history_instructions], ...(ch.data?.alternate_greetings || []).map((g) => ["备选开场白", g])];
      for (const [label, text] of fields) scan(text, true, `角色卡${label}`);
      rules(ch.data?.extensions?.regex_scripts, "角色卡正则");
    }
    rules(c.extensionSettings?.regex, "全局正则");
  } catch {}
  return tags;
}
function replyWorldTagsScan(world, want) {
  const { tags, scan } = replyTagScanner(want);
  for (const t of world.texts) scan(t.text, true, t.from);
  return tags;
}
function replyMergeTags(a, b) {
  if (!b) return a;
  const tags = new Set([...a, ...b]);
  tags.asked = new Set([...a.asked, ...b.asked]);
  tags.children = new Map([...a.children].map(([k, v]) => [k, new Set([...v, ...(b.children.get(k) || [])])]));
  tags.from = new Map([...a.from]);
  for (const [k, v] of b.from) tags.from.set(k, new Set([...(tags.from.get(k) || []), ...v]));
  return tags;
}
// 2.6.12 缓存按事件失效：换聊天（含换角色）、换预设、改世界书、改角色卡时重算，最长 10 分钟。
// 以前 60 秒就失效，两轮之间几乎都超过 60 秒，每轮生成后都要重读世界书、重扫预设，大预设、大世界书会卡一下
var REPLY_TAGS_TTL = 600000;
var replyTagsEpoch = 0;
var replyWorldCache = null;
var replyPresetTagsCache = null;
var replyWorldTagsCache = null;
function replyTagsStale() {
  replyTagsEpoch++;
  replyWorldCache = replyPresetTagsCache = replyWorldTagsCache = null;
}
const replyFresh = (cache, key) => cache && cache.key === key && cache.epoch === replyTagsEpoch && Date.now() - cache.at < REPLY_TAGS_TTL;
// 2.6.11 当前生效的世界书：全局启用、角色绑定、角色附加、聊天绑定
function replyWorldNames(c = ctx()) {
  const wi = mods.wi;
  const names = new Set();
  const add = (n) => n && names.add(String(n));
  for (const n of wi?.selected_world_info || []) add(n);
  const ch = c.characters?.[Number(c.characterId)];
  add(ch?.data?.extensions?.world);
  const file = String(ch?.avatar || "").replace(/\.[^.]+$/, "");
  for (const l of Array.isArray(wi?.world_info?.charLore) ? wi.world_info.charLore : []) if (file && l?.name === file) for (const n of l.extraBooks || []) add(n);
  add(c.chatMetadata?.world_info);
  return [...names];
}
// 读好的世界书（没读过、已失效时为 null，不在这里读）
function replyWorldReady() {
  const key = JSON.stringify(replyWorldNames());
  return replyFresh(replyWorldCache, key) ? replyWorldCache : null;
}
async function replyWorldTexts() {
  const key = JSON.stringify(replyWorldNames());
  if (replyFresh(replyWorldCache, key)) return replyWorldCache;
  const epoch = replyTagsEpoch;
  const texts = [];
  // 2.6.12 先读酒馆已缓存的那份（worldInfoCache，只读不改）：酒馆的 loadWorldInfo 每次都把整本世界书复制一份，大世界书要卡一下。
  // 生成时酒馆已经读过生效的世界书，缓存里一般都有；没有时再 loadWorldInfo
  const cache = mods.wi?.worldInfoCache;
  const cached = (n) => cache instanceof Map && Map.prototype.has.call(cache, n) ? Map.prototype.get.call(cache, n) : null;
  for (const n of JSON.parse(key)) {
    try {
      const data = cached(n) || await mods.wi?.loadWorldInfo?.(n);
      for (const e of Object.values(data?.entries || {})) {
        if (e && !e.disable && typeof e.content === "string" && e.content.includes("<")) texts.push({ text: e.content, from: `世界书「${n}」条目「${e.comment || e.uid}」`, title: String(e.comment || ""), book: n });
      }
    } catch {}
  }
  return replyWorldCache = { key, epoch, at: Date.now(), texts };
}
function replyWorldTags(world, want) {
  const key = JSON.stringify([world.key, world.at, want]);
  if (replyFresh(replyWorldTagsCache, key)) return replyWorldTagsCache.value;
  const value = replyWorldTagsScan(world, want);
  replyWorldTagsCache = { key, epoch: replyTagsEpoch, at: Date.now(), value };
  return value;
}
// 用到时才扫（多数回复用不到）；扫过的按上面的规则缓存
function replyKnownTagsLazy(name, want, world = null) {
  let value;
  return () => {
    if (value !== undefined) return value;
    const key = JSON.stringify([name, want, ctx().characterId ?? null]);
    let own;
    if (replyFresh(replyPresetTagsCache, key)) own = replyPresetTagsCache.value;
    else {
      own = replyPresetTags(name, want);
      replyPresetTagsCache = { key, epoch: replyTagsEpoch, at: Date.now(), value: own };
    }
    return value = own && replyMergeTags(own, world ? replyWorldTags(world, want) : null);
  };
}
// 2.6.11 必需标签这张卡用不用得上：预设条目、角色卡、世界书里写过，或聊天开头的开场白（第一条玩家消息之前的 AI 消息）里有。
// 读不到预设时一律算用得上。
// 2.6.16 不再看最近 10 条回复：模型写错一次 <状态栏>，它就一直算「用得上」，写对了的回复反被报缺 <状态栏>，
// 点「下一轮提醒一次」又叫模型写 <状态栏>。开场白是卡的作者写的，照算
function replyGreetingTags(chat) {
  const tags = new Set();
  for (const m of Array.isArray(chat) ? chat : []) {
    if (!m || m.is_system) continue;
    if (m.is_user) break;
    if (typeof m.mes === "string") for (const t of replyTagTokens(replyCheckMask(m.mes))) tags.add(t.key);
  }
  return tags;
}
function replyApplicable(knownTags, chat) {
  let greeting;
  return (key) => {
    const known = knownTags();
    if (!(known instanceof Set) || known.asked?.has(key)) return true;
    return (greeting ??= replyGreetingTags(chat)).has(key);
  };
}
// 这张卡要的规则：去掉预设、角色卡、世界书都没要求的必需标签
function replyCardRules(rules, isApplicable) {
  const requiredTags = rules.requiredTags.filter((tag) => isApplicable(tag.toLowerCase()));
  return requiredTags.length === rules.requiredTags.length ? rules : { ...rules, requiredTags };
}
// 2.6.16 标签出处：预设、角色卡、世界书、正则里写过的地方，作者注释、用户角色描述，以及第 index 条之前含这个标签的 AI 回复、玩家消息。
// 只给玩家看，不算进「这张卡用不用」
function replyTagOrigins(list, knownTags, chat, index) {
  const known = typeof knownTags === "function" ? knownTags() : knownTags;
  const c = ctx();
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const notes = [["作者注释", c.chatMetadata?.note_prompt], ["用户角色描述", c.powerUserSettings?.persona_description]];
  return list.map(({ key, name }) => {
    const re = new RegExp(`<\\s*\\/?\\s*${esc(key)}(?=[\\s>/])`, "iu");
    const from = [...(known instanceof Set && known.from?.get(key) || [])];
    for (const [label, text] of notes) if (typeof text === "string" && re.test(text)) from.push(label);
    let ai = 0, mine = 0;
    for (let i = 0; i < Math.min(index, Array.isArray(chat) ? chat.length : 0); i++) {
      const m = chat[i];
      if (!m || m.is_system || typeof m.mes !== "string" || !re.test(m.mes)) continue;
      if (m.is_user) mine++;
      else ai++;
    }
    return { key, name, from, ai, mine };
  });
}
// 检查一条聊天回复要用到的东西：前几条回复的布局、预设和世界书里的标签（用到时才算）、必需标签适用与否。
// 2.6.12 世界书只在用得上时才读：先用读好的（没有就不带世界书）查一遍，查的过程中确实要用已知标签、世界书又没读好时，
// 读完再查一遍。多数回复没有问题，用不到已知标签，就不读世界书
// 2.6.17 force：这张卡的状态栏标签，玩家选定或自动认出的，一律算这张卡要的
function replyCheckExtras(chat, index, rules, name = currentPresetName(), world = replyWorldReady(), force = null) {
  const state = { needWorld: false };
  const base = replyKnownTagsLazy(name, rules.requiredTags, world);
  const knownTags = () => {
    if (!world) state.needWorld = true;
    return base();
  };
  const applicable = replyApplicable(knownTags, chat);
  const forced = force ? String(force).toLowerCase() : null;
  return { layout: replyLayoutLazy(chat, index, rules), knownTags, isApplicable: forced ? (key) => key === forced || applicable(key) : applicable, needWorld: () => state.needWorld };
}
// 检查聊天里的一条回复（或粘贴的文字）：返回 { report, extra }，extra 可直接交给 planReplyFix
async function replyCheckChat(text, rules, { chat, index, reasoning = "", name = currentPresetName(), force = null }) {
  let extra = { ...replyCheckExtras(chat, index, rules, name, undefined, force), reasoning };
  let report = checkReplyFormat(text, rules, extra);
  if (extra.needWorld()) {
    await replyBreath();
    const world = await replyWorldTexts();
    await replyBreath();
    extra = { ...replyCheckExtras(chat, index, rules, name, world, force), reasoning };
    report = checkReplyFormat(text, rules, extra);
  }
  return { report, extra };
}
// 让出主线程：一段重活之后先让页面画一帧、响应点按
const replyBreath = () => new Promise((r) => setTimeout(r, 0));
// 用到时才学，学一次：多数回复没有问题，也不会在思考区末尾留块，发送前不必去读前几条
function replyLayoutLazy(chat, index, rules) {
  let value;
  return () => value ??= replyLayoutBefore(chat, index, rules);
}
// 2.4.1 自动修正：生成结束后按预设开关，自动做「修正这条回复」能做的修改（2.6.16 起去掉多包的一层、改回结构对得上的错名）。
// 修正前的问题记在这里，点「下一轮提醒一次」时按修正前的问题写提醒；undo 供「格式」窗口撤销
var replyAutoFixed = null;
var replyAutoFixPending = false;
// 这一轮被手动停止过（停止和结束两个事件谁先到都不改）
var replyAutoFixStopped = false;
// 2.6.11 生成后提示玩家的问题：确定的问题才提示，「疑似推理标题」这类要人工判断的不提示；每条回复最多提示一次
var REPLY_NOTICE_KINDS = new Set(["missing", "order", "duplicate", "swallowed", "reasoning", "stranded", "outside", "leak", "empty", "wrapped", "status"]);
var replyNoticed = null;
function replyNoticeToast(text, type = "warning") {
  const t = globalThis.toastr;
  if (!t?.[type]) return console.log("[焦香鸡翅]", text);
  t[type](text, "", { timeOut: 9000, extendedTimeOut: 3000, escapeHtml: true, preventDuplicates: true, onclick: () => openReplyCheck() });
}
// 点提示：打开「思维链」页的格式检查，直接检查最近回复
function openReplyCheck() {
  try {
    open("cot");
    replyFormatDialog(currentPresetName(), { check: true }).catch((e) => toast("格式检查失败：" + e.message, "error"));
  } catch (e) {
    console.warn("[焦香鸡翅] 打开格式检查失败", e);
  }
}
// 2.6.12 第几轮生成：等空闲、读世界书的时候开始了新一轮，这次就不查了
var replyGenSeq = 0;
// 等这一帧画完再动（Safari 没有空闲回调，统一用这个）
const replyIdle = () => nextPaint();
function scheduleReplyAutoFix() {
  if (!replyAutoFixPending) return;
  replyAutoFixPending = false;
  const first = replyGuardConfig();
  // 2.6.17 状态栏自动提醒开着时，提示和自动修正都关了也要查
  if (!first?.bodyTag || !first.autoFix && first.notice === false && !statusRemindOn() && !statusFixOn()) return;
  const seq = replyGenSeq;
  // 等酒馆和其他扩展处理完这条消息（渲染、保存）、页面画完再看
  setTimeout(async () => {
    try {
      await replyIdle();
      const config = replyGuardConfig();
      const c = ctx();
      const latest = latestReplyForCheck(c.chat);
      if (!config?.bodyTag || !latest || replyAutoFixStopped || seq !== replyGenSeq) return;
      const snap = replyMessageSnapshot(latest.index);
      // 2.6.17 这张卡的状态栏标签（玩家选定或自动认出的）加进必需标签
      const status = await statusFor(normalizeReplyRules(config));
      if (seq !== replyGenSeq) return;
      const rules = normalizeReplyRules(statusRules(config, status));
      const { report, extra } = await replyCheckChat(latest.message.mes, rules, { chat: c.chat, index: latest.index, reasoning: latest.message.extra?.reasoning, force: status.tag });
      // 读世界书时又开始生成、或这条回复已被改动：不再处理
      if (seq !== replyGenSeq || replyMessageSnapshot(latest.index) !== snap) return;
      // 2.6.18 状态栏按子标签再查一遍：另写了一份、写成别的名字、没有外层或结尾
      let statusFix = null;
      if (status.tag) {
        const world = await replyWorldTexts();
        if (seq !== replyGenSeq || replyMessageSnapshot(latest.index) !== snap) return;
        statusFix = statusCheck(report, latest.message.mes, status.tag, statusChildren(status.tag, rules, world), rules);
      }
      // 状态栏掉了、写错、写了两份、多包一层或进了思考区：下一轮提醒一次，只点名这张卡的状态栏标签
      const remind = status.tag && statusRemindOn() ? statusReminder(report, status.tag) : "";
      if (remind) armStatusReminder(remind);
      if (!report.issues.length) return;
      const next = remind ? `下一轮将提醒用 <${status.tag}>。点此查看` : "点此查看，可提醒下一轮";
      let left = report.issues;
      // 状态栏写坏了先改回（默认开），开了自动修正时再做一般修正
      {
        const plan = statusPlan(latest.message.mes, rules, extra, statusFixOn() ? statusFix : null, !!config.autoFix, { noTailClose: true, auto: true });
        if (plan) {
          const undo = await applyReplyFix(latest.index, plan, replyMessageSnapshot(latest.index));
          replyAutoFixed = { snapshot: undo.snapshot, report, undo, steps: plan.steps };
          left = plan.after.issues;
          const rest = left.filter((i) => REPLY_NOTICE_KINDS.has(i.kind));
          replyNoticed = undo.snapshot;
          if (rest.length && config.notice !== false) return replyNoticeToast(`已自动修正这条回复：${plan.steps.join("；")}。还有 ${rest.length} 个问题，${next}`);
          return toast(`已自动修正这条回复：${plan.steps.join("；")}${left.length ? `。还有 ${left.length} 个问题要手动处理` : ""}。${remind ? `下一轮将提醒用 <${status.tag}>。` : ""}可在「思维链 → 格式」里撤销`, left.length ? "warning" : "success");
        }
      }
      const sure = left.filter((i) => REPLY_NOTICE_KINDS.has(i.kind));
      if (config.notice === false || !sure.length || replyNoticed === snap) return;
      replyNoticed = snap;
      replyNoticeToast(`上一条回复：${sure[0].text}${sure.length > 1 ? `，另有 ${sure.length - 1} 个问题` : ""}。${next}`);
    } catch (e) {
      console.warn("[焦香鸡翅] 生成后的格式检查失败", e);
    }
  }, 500);
}
// 这条回复是不是刚被自动修正过、之后没再变
function replyAutoFixFor(index) {
  return replyAutoFixed && replyAutoFixed.undo.index === index && replyMessageSnapshot(index) === replyAutoFixed.snapshot ? replyAutoFixed : null;
}
// 2.6.11 一次性提醒：记下提醒原文和当时的聊天；下一次正常生成（新回复、重新生成、滑动）时加入一次，用完即清，换聊天作废
var replyRemindOnce = null;
var REPLY_SKIP_TYPES = ["quiet", "impersonate", "first_message", "continue"];
const replyChatKey = (c = ctx()) => String(c.getCurrentChatId?.() || c.chatId || "");
function armReplyReminder(text) {
  replyRemindOnce = text ? { chat: replyChatKey(), text } : null;
}
function replyReminderArmed() {
  return replyRemindOnce && replyRemindOnce.chat === replyChatKey() ? replyRemindOnce.text : null;
}
function clearReplyGuard() {
  const c = ctx();
  // IN_CHAT=1, depth=0, scan=false, SYSTEM=0（SillyTavern 的提示接口）。
  c.setExtensionPrompt?.(REPLY_GUARD_KEY, "", 1, 0, false, 0);
}
function prepareReplyGuard(type, _options, dryRun) {
  try {
    clearReplyGuard();
    const c = ctx();
    // 续写需要延续已有标签，代拟、后台生成与这条回复无关：都不用掉这次提醒。
    // 2.6.17 玩家点的「下一轮提醒一次」和状态栏掉了时排好的提醒一起加入
    if (!replyRemindOnce && !statusRemindNext || !replyGuardAvailable(c) || dryRun || REPLY_SKIP_TYPES.includes(type)) return;
    if (c.mainApi && c.mainApi !== "openai") return;
    const chat = replyChatKey(c);
    const texts = [replyRemindOnce, statusRemindNext].filter((r) => r && r.chat === chat).map((r) => r.text);
    replyRemindOnce = statusRemindNext = null;
    if (texts.length) c.setExtensionPrompt(REPLY_GUARD_KEY, texts.join("\n"), 1, 0, false, 0);
  } catch (e) {
    console.warn("[焦香鸡翅] 加入格式提醒失败", e);
  }
}
function bindReplyGuard(on, events) {
  on(events.GENERATION_AFTER_COMMANDS, prepareReplyGuard);
  on(events.GENERATION_AFTER_COMMANDS, (type, _options, dryRun) => {
    if (dryRun) return;
    replyGenSeq++;
    replyAutoFixPending = !REPLY_SKIP_TYPES.includes(type);
    replyAutoFixStopped = false;
  });
  // 2.6.12 已知标签、世界书的缓存：换聊天（含换角色）、换预设、改世界书、改角色卡时失效
  for (const ev of [events.CHAT_CHANGED, events.PRESET_CHANGED, events.OAI_PRESET_CHANGED_AFTER, events.WORLDINFO_UPDATED, events.WORLDINFO_SETTINGS_UPDATED, events.CHARACTER_EDITED]) if (ev) on(ev, replyTagsStale);
  on(events.GENERATION_ENDED, scheduleReplyAutoFix);
  // 手动停止的回复不完整，不自动改、不提示
  on(events.GENERATION_STOPPED, () => { replyAutoFixPending = false; replyAutoFixStopped = true; });
  on(events.CHAT_CHANGED, () => { replyAutoFixPending = false; replyAutoFixed = null; replyRemindOnce = null; statusRemindNext = null; });
  for (const ev of [events.CHAT_CHANGED, events.PRESET_CHANGED, events.GENERATION_STARTED, events.GENERATION_ENDED, events.GENERATION_STOPPED]) on(ev, clearReplyGuard);
  cleanups.push(clearReplyGuard);
}

// 修正标签：确认后改写这一楼的原文（及推理字段），保留修正前内容供撤销。
function replyMessageSnapshot(index) {
  const c = ctx(), m = c.chat?.[index];
  if (!m) return null;
  return JSON.stringify([String(c.getCurrentChatId?.() || c.chatId || ""), index, m.swipe_id ?? null, m.mes, m.extra?.reasoning ?? null]);
}
async function writeReplyMessage(index, mes, reasoning) {
  await setReplyMessage(index, mes, reasoning);
  await ctx().saveChat?.();
}
async function setReplyMessage(index, mes, reasoning) {
  const c = ctx(), m = c.chat[index];
  m.mes = mes;
  if (Array.isArray(m.swipes) && Number.isInteger(m.swipe_id) && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = mes;
  if (reasoning !== undefined) {
    m.extra = m.extra || {};
    m.extra.reasoning = reasoning;
    const info = Array.isArray(m.swipe_info) && Number.isInteger(m.swipe_id) ? m.swipe_info[m.swipe_id] : null;
    if (info?.extra) info.extra.reasoning = reasoning;
  }
  c.updateMessageBlock?.(index, m);
  const ev = c.eventTypes || c.event_types;
  // 与酒馆手动编辑一致地通知，让其他扩展（如状态栏渲染）按新原文刷新
  if (ev?.MESSAGE_EDITED) await c.eventSource?.emit(ev.MESSAGE_EDITED, index);
  if (ev?.MESSAGE_UPDATED) await c.eventSource?.emit(ev.MESSAGE_UPDATED, index);
}
async function applyReplyFix(index, plan, snapshot) {
  if (replyMessageSnapshot(index) !== snapshot) throw new Error("这条回复已变化，请重新检查");
  const m = ctx().chat[index];
  const undo = { index, mes: m.mes, reasoning: plan.reasoningChanged ? (m.extra?.reasoning ?? "") : undefined };
  await writeReplyMessage(index, plan.text, plan.reasoningChanged ? plan.reasoning : undefined);
  undo.snapshot = replyMessageSnapshot(index);
  return undo;
}
async function undoReplyFix(undo) {
  if (replyMessageSnapshot(undo.index) !== undo.snapshot) throw new Error("这条回复在修正后又被改动，无法撤销");
  await writeReplyMessage(undo.index, undo.mes, undo.reasoning);
}
// 2.6.11 聊天里前面的回复也多包了同一层（如 <状态栏> 包住 <lxs_status>）：模型会照着前面的回复学，一并去掉。
// 2.6.16 也改正结构对得上的写错名（<状态栏> 顶替 <lxs_status>）。rules 用这张卡要的规则（replyCardRules）。
// 只看第 index 条之前最近 200 条 AI 回复当前显示的那一版。
// 2.6.12 先用便宜的规则筛：开始标签后面紧跟着正文或必需标签（「</content>」后跟 <lxs_status> 这种结束标签不算），
// 或缺了必需标签的回复才细查；每 20 条让出一次主线程
async function replyEarlierRepairs(chat, index, rules, knownTags, more = null) {
  const out = [];
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quick = new RegExp(`<\\s*[A-Za-z_\\u3400-\\u9fff][^<>]*>\\s*<\\s*(?:${[rules.bodyTag, ...rules.requiredTags].map(esc).join("|")})(?=[\\s>/])`, "iu");
  const has = rules.requiredTags.map((t) => new RegExp(`<\\s*${esc(t)}(?=[\\s>/])`, "iu"));
  let n = 0;
  for (let i = Math.min(index, Array.isArray(chat) ? chat.length : 0) - 1; i >= 0 && n < 200; i--) {
    const m = chat[i];
    if (!m || m.is_user || m.is_system || typeof m.mes !== "string") continue;
    if (++n % 20 === 0) await replyBreath();
    if (!quick.test(m.mes) && has.every((re) => re.test(m.mes)) && !more?.test.test(m.mes)) continue;
    // 2.6.18 先改回写坏的状态栏，再做原有的改名、去层
    const first = more ? more.fix(m.mes) : null;
    const fix = replyRepairEarlier(first ? first.text : m.mes, rules, knownTags);
    if (first || fix) out.push({ index: i, text: fix ? fix.text : first.text, steps: [...(first?.steps || []), ...(fix?.steps || [])], pairs: [...(first?.pairs || []), ...(fix?.pairs || [])] });
  }
  return out.reverse();
}
async function unwrapEarlierReplies(list) {
  const c = ctx();
  const items = [];
  for (const { index, text } of list) {
    const m = c.chat[index];
    if (!m) continue;
    items.push({ index, before: m.mes, after: text });
    await setReplyMessage(index, text);
  }
  await c.saveChat?.();
  return { chat: replyChatKey(c), items };
}
// 撤销：之后又被改过的那几条不动，返回撤销了几条
async function undoEarlierReplies(undo) {
  const c = ctx();
  if (undo.chat !== replyChatKey(c)) throw new Error("已换了聊天，无法撤销");
  let n = 0;
  for (const { index, before, after } of undo.items) {
    if (c.chat[index]?.mes !== after) continue;
    await setReplyMessage(index, before);
    n++;
  }
  await c.saveChat?.();
  return n;
}
