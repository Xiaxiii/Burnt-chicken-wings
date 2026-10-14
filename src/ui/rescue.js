// 1.7.1 后台中断补救：iOS 切到别的 App 后会暂停网页、断开正在生成的请求（回复被截断），
// 内存紧张时还会整页重新加载（回复没收到）。扩展无法阻止这两件事，只能在你回来时提醒，并一键续写或重新生成。
var RESCUE_KEY = "presetAtelier:generating";
function rescueOn() {
  try {
    return settings().rescue !== false;
  } catch {
    return false;
  }
}
function curChatId() {
  const c = ctx();
  return String(c.getCurrentChatId?.() || c.chatId || "");
}
function rescueBar(text, actions) {
  document.getElementById("pa-rescue")?.remove();
  const bar = document.createElement("div");
  bar.id = "pa-rescue";
  bar.innerHTML = `<span>${esc(text)}</span>${actions.map((a, i) => `<button class="menu_button" data-i="${i}">${esc(a.label)}</button>`).join("")}<button class="menu_button pa-rescue-x" data-i="x" aria-label="关闭">✕</button>`;
  bar.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    bar.remove();
    if (b.dataset.i === "x") return;
    try {
      await actions[Number(b.dataset.i)].run();
    } catch (er) {
      toast("操作失败：" + er.message, "error");
    }
  });
  document.body.append(bar);
}
// 按最后一条消息给出能做的事
function rescueActions() {
  const c = ctx();
  const chat = c.chat || [];
  const last = chat[chat.length - 1];
  const gen = (type) => () => c.generate ? c.generate(type) : c.executeSlashCommandsWithOptions?.(type === "continue" ? "/continue" : "/trigger");
  if (!last || last.is_user) return [{ label: "生成回复", run: gen("normal") }];
  return [{ label: "续写", run: gen("continue") }, { label: "重新生成", run: gen("regenerate") }];
}
function initRescue() {
  const c = ctx();
  const et = c.eventTypes || c.event_types;
  if (!et?.GENERATION_STARTED || !c.eventSource) return () => {};
  let live = null; // 进行中的生成：{ chatId, hidden }
  let pending = null; // 后台结束、等你回来再提醒
  let shownAt = document.hidden ? 0 : Date.now(); // 页面最近一次回到前台的时间
  const save = (v) => {
    try {
      v ? localStorage.setItem(RESCUE_KEY, JSON.stringify(v)) : localStorage.removeItem(RESCUE_KEY);
    } catch {
    }
  };
  const onStart = (type, _opt, dryRun) => {
    if (dryRun || type === "quiet" || !rescueOn()) return;
    document.getElementById("pa-rescue")?.remove();
    live = { chatId: curChatId(), hidden: document.hidden, at: Date.now(), len: (ctx().chat || []).length };
    save(live);
  };
  // 最后一条是不是一条有内容的 AI 回复
  const gotReply = () => {
    const chat = ctx().chat || [];
    const last = chat[chat.length - 1];
    return !!last && !last.is_user && String(last.mes || "").trim().length > 0;
  };
  const onEnd = () => {
    if (!live) return;
    const wasHidden = live.hidden || document.hidden;
    const chatId = live.chatId;
    const endedHidden = document.hidden;
    live = null;
    save(null);
    if (!wasHidden || !rescueOn()) return;
    // 在后台安安稳稳生成完、而且回复已经到了（电脑上切标签页常见），不打扰
    if (endedHidden && gotReply()) return;
    // 回到前台后很快才结束：多半是后台时连接被断，回来才报错收尾
    const justBack = !endedHidden && Date.now() - shownAt < 4000;
    if (!justBack && gotReply()) return;
    pending = { chatId, noReply: !gotReply() };
    if (!document.hidden) setTimeout(remind, 600);
  };
  const onStop = () => {
    // 自己点了停止
    live = null;
    save(null);
  };
  function remind() {
    if (!pending || document.hidden) return;
    const p = pending;
    pending = null;
    if (p.chatId !== curChatId()) return;
    rescueBar(p.noReply ? "刚才切到后台时，回复没有收到。" : "刚才切到后台时，回复可能被截断了。如果回复是完整的，关掉这条提示即可。", rescueActions());
  }
  const onVis = () => {
    if (document.hidden) {
      if (live) {
        live.hidden = true;
        save(live);
      }
    } else {
      shownAt = Date.now();
      if (pending) setTimeout(remind, 600);
    }
  };
  // 页面被重新加载：上次的生成没有结束记录
  const checkReload = () => {
    let prev = null;
    try {
      prev = JSON.parse(localStorage.getItem(RESCUE_KEY) || "null");
    } catch {
    }
    if (!prev || live || !rescueOn()) return;
    save(null);
    if (Date.now() - (prev.at || 0) > 2 * 3600e3 || prev.chatId !== curChatId()) return;
    rescueBar("上次生成时页面被重新加载，回复可能没有收到。", rescueActions());
  };
  const on = (ev, fn) => ev && c.eventSource.on(ev, fn);
  on(et.GENERATION_STARTED, onStart);
  on(et.GENERATION_ENDED, onEnd);
  on(et.GENERATION_STOPPED, onStop);
  document.addEventListener("visibilitychange", onVis);
  // 聊天加载出来后再检查（打开酒馆时会自动进入上次的聊天）
  let checked = false;
  const onChat = () => {
    if (checked) return;
    checked = true;
    setTimeout(checkReload, 1500);
  };
  on(et.CHAT_CHANGED, onChat);
  if (curChatId()) onChat();
  return () => {
    for (const [ev, fn] of [[et.GENERATION_STARTED, onStart], [et.GENERATION_ENDED, onEnd], [et.GENERATION_STOPPED, onStop], [et.CHAT_CHANGED, onChat]]) if (ev) c.eventSource.removeListener?.(ev, fn);
    document.removeEventListener("visibilitychange", onVis);
    document.getElementById("pa-rescue")?.remove();
  };
}
