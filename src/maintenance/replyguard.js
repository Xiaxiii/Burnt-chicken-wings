// 只检查当前回复原文；格式提醒通过酒馆的临时提示接口加入，不改聊天或预设正文。
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
function replyKnownTags(name = currentPresetName(), want = []) {
  const tags = new Set();
  const children = new Map(want.map((t) => [String(t).toLowerCase(), new Set()]));
  tags.children = children;
  const tagRe = /<\s*\/?\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39})/gu;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scan = (text) => {
    const str = String(text || "");
    for (const m of str.matchAll(tagRe)) tags.add(m[1].toLowerCase());
    for (const [tag, set] of children) {
      if (!str.toLowerCase().includes(`<${tag}`)) continue;
      for (const m of str.matchAll(new RegExp(`<\\s*${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*${esc(tag)}\\s*>`, "giu"))) {
        for (const c of m[1].matchAll(tagRe)) if (c[1].toLowerCase() !== tag) set.add(c[1].toLowerCase());
      }
    }
  };
  const rules = (list) => {
    for (const rule of Array.isArray(list) ? list : []) {
      if (!rule || rule.disabled) continue;
      try {
        const found = presetRegexAnchors(rule).tags;
        for (const t of found) tags.add(t);
        for (const [tag, set] of children) if (found.has(tag)) for (const t of found) if (t !== tag) set.add(t);
      } catch {}
      scan(rule.replaceString);
    }
  };
  try {
    const d = getDraft(name);
    for (const o of d.order) if (d.isActive(o.identifier)) scan(d.prompt(o.identifier)?.content);
    try { rules(presetRegexList(d)); } catch {}
  } catch { return null; }
  try {
    const c = ctx();
    const ch = c.characters?.[Number(c.characterId)];
    if (ch) {
      for (const f of [ch.description, ch.personality, ch.scenario, ch.first_mes, ch.mes_example, ch.data?.system_prompt, ch.data?.post_history_instructions, ...(ch.data?.alternate_greetings || [])]) scan(f);
      rules(ch.data?.extensions?.regex_scripts);
    }
    rules(c.extensionSettings?.regex);
  } catch {}
  return tags;
}
// 用到时才扫，扫过的记 60 秒：模型连着几轮写错名时不必每轮重扫（大预设在手机上扫一次要几十到一百多毫秒）
var replyKnownTagsCache = null;
function replyKnownTagsLazy(name, want) {
  return () => {
    const c = ctx();
    const key = JSON.stringify([name, want, c.characterId ?? null]);
    if (replyKnownTagsCache?.key === key && Date.now() - replyKnownTagsCache.at < 60000) return replyKnownTagsCache.value;
    const value = replyKnownTags(name, want);
    replyKnownTagsCache = { key, at: Date.now(), value };
    return value;
  };
}
// 用到时才学，学一次：多数回复没有问题，也不会在思考区末尾留块，发送前不必去读前几条
function replyLayoutLazy(chat, index, rules) {
  let value;
  return () => value ??= replyLayoutBefore(chat, index, rules);
}
// 2.4.1 自动修正：生成结束后按预设开关，自动做「修正这条回复」能做的修改。
// 修正前的问题记在这里，下一轮照样提醒 AI；undo 供「回复」页撤销
var replyAutoFixed = null;
var replyAutoFixPending = false;
// 这一轮被手动停止过（停止和结束两个事件谁先到都不改）
var replyAutoFixStopped = false;
function scheduleReplyAutoFix() {
  if (!replyAutoFixPending) return;
  replyAutoFixPending = false;
  if (!replyGuardConfig()?.autoFix) return;
  // 等酒馆和其他扩展处理完这条消息（渲染、保存）再改
  setTimeout(async () => {
    try {
      const found = jankTime("生成结束：自动修正检查", () => {
        const config = replyGuardConfig();
        const latest = latestReplyForCheck(ctx().chat);
        if (!config?.autoFix || !latest || replyAutoFixStopped) return null;
        const rules = normalizeReplyRules(config);
        const reasoning = latest.message.extra?.reasoning;
        const layout = replyLayoutLazy(ctx().chat, latest.index, rules);
        const knownTags = replyKnownTagsLazy(currentPresetName(), rules.requiredTags);
        const report = checkReplyFormat(latest.message.mes, rules, { reasoning, layout, knownTags });
        if (!report.issues.length) return null;
        const plan = planReplyFix(latest.message.mes, rules, { reasoning, layout, knownTags, noTailClose: true, strict: true });
        return plan ? { latest, report, plan } : null;
      });
      if (!found) return;
      const { latest, report, plan } = found;
      const undo = await applyReplyFix(latest.index, plan, replyMessageSnapshot(latest.index));
      replyAutoFixed = { snapshot: undo.snapshot, report, undo, steps: plan.steps };
      const left = plan.after.issues.length;
      toast(`已自动修正这条回复：${plan.steps.join("；")}${left ? `。还有 ${left} 个问题要手动处理` : ""}。可在「回复 → 检查」里撤销`, left ? "warning" : "success");
    } catch (e) {
      console.warn("[焦香鸡翅] 自动修正失败", e);
    }
  }, 300);
}
// 这条回复是不是刚被自动修正过、之后没再变
function replyAutoFixFor(index) {
  return replyAutoFixed && replyAutoFixed.undo.index === index && replyMessageSnapshot(index) === replyAutoFixed.snapshot ? replyAutoFixed : null;
}
function clearReplyGuard() {
  const c = ctx();
  // IN_CHAT=1, depth=0, scan=false, SYSTEM=0（SillyTavern 的提示接口）。
  c.setExtensionPrompt?.(REPLY_GUARD_KEY, "", 1, 0, false, 0);
}
function prepareReplyGuard(type, _options, dryRun) {
  try {
    clearReplyGuard();
    const c = ctx(), config = replyGuardConfig();
    // 续写需要延续已有标签，要求再输出一整对可能制造重复，留给手动检查。
    if (!replyGuardAvailable(c) || !config?.enabled || dryRun || ["quiet", "impersonate", "first_message", "continue"].includes(type)) return;
    if (c.mainApi && c.mainApi !== "openai") return;
    // 按当前 mes 重算，编辑、删除、滑动后不会沿用旧问题。extra.reasoning 只在可见回复没有正文标签时本地查标签位置。
    const latest = latestReplyForCheck(c.chat);
    if (!latest) return;
    const rules = normalizeReplyRules(config);
    // 已自动修正过的回复，按修正前的问题提醒
    const report = replyAutoFixFor(latest.index)?.report || checkReplyFormat(latest.message.mes, rules, { reasoning: latest.message.extra?.reasoning, layout: replyLayoutLazy(c.chat, latest.index, rules), knownTags: replyKnownTagsLazy(currentPresetName(), rules.requiredTags) });
    const reminder = buildReplyReminder(report, rules);
    if (reminder) c.setExtensionPrompt(REPLY_GUARD_KEY, reminder, 1, 0, false, 0);
  } catch (e) {
    console.warn("[焦香鸡翅] 正文格式检查失败", e);
  }
}
function bindReplyGuard(on, events) {
  on(events.GENERATION_AFTER_COMMANDS, prepareReplyGuard);
  on(events.GENERATION_AFTER_COMMANDS, (type, _options, dryRun) => {
    if (dryRun) return;
    replyAutoFixPending = !["quiet", "impersonate", "first_message", "continue"].includes(type);
    replyAutoFixStopped = false;
  });
  on(events.GENERATION_ENDED, scheduleReplyAutoFix);
  // 手动停止的回复不完整，不自动改
  on(events.GENERATION_STOPPED, () => { replyAutoFixPending = false; replyAutoFixStopped = true; });
  on(events.CHAT_CHANGED, () => { replyAutoFixPending = false; replyAutoFixed = null; });
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
  await c.saveChat?.();
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
