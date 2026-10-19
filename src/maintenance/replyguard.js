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
    // 按当前 mes 重算，编辑、删除、滑动后不会沿用旧问题；不检查 extra.reasoning。
    const latest = latestReplyForCheck(c.chat);
    if (!latest) return;
    const rules = normalizeReplyRules(config);
    const reminder = buildReplyReminder(checkReplyFormat(latest.message.mes, rules), rules);
    if (reminder) c.setExtensionPrompt(REPLY_GUARD_KEY, reminder, 1, 0, false, 0);
  } catch (e) {
    console.warn("[焦香鸡翅] 正文格式检查失败", e);
  }
}
function bindReplyGuard(on, events) {
  on(events.GENERATION_AFTER_COMMANDS, prepareReplyGuard);
  for (const ev of [events.CHAT_CHANGED, events.PRESET_CHANGED, events.GENERATION_STARTED, events.GENERATION_ENDED, events.GENERATION_STOPPED]) on(ev, clearReplyGuard);
  cleanups.push(clearReplyGuard);
}
