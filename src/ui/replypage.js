// 2.7.0「回复」页：正文格式检查从「思维链 → 格式」弹窗提为一级页签。
// 先看这张卡的状态栏和生成后的四个开关，开关就地改、立即生效；标签名、AI 语义审查等完整设置和手动检查仍在「格式设置」窗口里。
// 按酒馆正在用的预设显示：生成后检查的正是它。
function mountReply(page) {
  page.innerHTML = `<div class="pa-scroll pa-reply">
    <div class="pa-reply-head"><div><b class="pa-reply-preset"></b><p class="pa-hint pa-reply-sub">生成后检查回复格式。按酒馆正在用的预设设置。</p></div></div>
    <section class="pa-card pa-reply-status" aria-live="polite"></section>
    <div class="pa-reply-acts"><button class="pa-btn pa-btn-primary" data-reply-check>检查最近回复</button><button class="pa-btn" data-reply-format>格式设置</button></div>
    <h3 class="pa-h">生成后</h3>
    <div class="pa-reply-sets"></div>
  </div>`;
  const nameEl = page.querySelector(".pa-reply-preset");
  const statusEl = page.querySelector(".pa-reply-status");
  const setsEl = page.querySelector(".pa-reply-sets");
  let seq = 0;
  const preset = () => currentPresetName();
  const row = (key, label, sub, on, disabled = false) => `<label class="pa-reply-row${disabled ? " pa-reply-off" : ""}"><span><span class="pa-reply-label">${esc(label)}</span>${sub ? `<small class="pa-hint">${esc(sub)}</small>` : ""}</span><span class="pa-switch"><input type="checkbox" data-rs="${key}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}><i></i></span></label>`;
  async function paintStatus(cfg) {
    const my = ++seq;
    const card = statusCard();
    const title = card ? `「${esc(card.name)}」的状态栏` : "状态栏";
    statusEl.innerHTML = `<b>${title}</b><p class="pa-hint">正在读取世界书…</p>`;
    let s;
    try {
      let rules;
      try { rules = normalizeReplyRules(cfg.bodyTag ? cfg : {}); } catch { rules = normalizeReplyRules({}); }
      s = await statusFor(rules, preset());
    } catch (e) {
      if (my === seq) statusEl.innerHTML = `<b>${title}</b><p class="pa-warn">读取状态栏失败：${esc(e.message)}</p>`;
      return;
    }
    if (my !== seq) return;
    let line;
    if (s.state === "nocard") line = '<p class="pa-hint">没有打开角色卡。</p>';
    else if (s.tag) line = `<p class="pa-reply-tag"><b class="pa-status-tag">${esc(`<${s.tag}>`)}</b><small class="pa-hint">${esc([s.from, s.state === "auto" ? "自动识别" : "已选定"].filter(Boolean).join(" · "))}</small></p>`;
    else if (s.state === "off") line = '<p class="pa-hint">这张卡不检查状态栏。</p>';
    else if (s.state === "ambiguous") line = `<p class="pa-hint">找到 ${s.list.length} 个可能的块，需在「格式设置」里选定。</p>`;
    else line = '<p class="pa-hint">世界书、角色卡、预设和显示正则里都没有找到状态栏。</p>';
    statusEl.innerHTML = `<div class="pa-reply-cardhead"><b>${title}</b>${card ? '<button class="pa-link" data-reply-status>更改</button>' : ""}</div>${line}`;
  }
  function render() {
    const name = preset();
    const cfg = replyGuardConfig(name);
    const set = !!cfg.bodyTag;
    nameEl.textContent = name ? `预设「${name}」` : "没有正在使用的预设";
    page.querySelector(".pa-reply-sub").textContent = set ? `正文标签 <${cfg.bodyTag}>${cfg.requiredTags?.length ? ` · 必需标签 ${cfg.requiredTags.map((t) => `<${t}>`).join("、")}` : ""}` : "这个预设还没有设置正文标签。先在「格式设置」里填写，生成后才会检查。";
    setsEl.innerHTML = [
      row("notice", "发现格式问题时提示我", "提示只给你看，不发给 AI", set && cfg.notice !== false, !set),
      row("autofix", "发现问题时自动修正这条回复", "改了会提示，可撤销", set && !!cfg.autoFix, !set),
      row("status-fix", "状态栏写坏时自动改回", "正文和思考区不动", statusFixOn()),
      row("status-remind", "状态栏掉了时，下一轮自动提醒一次", "只点名这张卡的状态栏标签", statusRemindOn())
    ].join("");
    paintStatus(cfg);
  }
  page.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-reply-format], [data-reply-status], [data-reply-check]");
    if (!b) return;
    try {
      await replyFormatDialog(preset(), { check: b.matches("[data-reply-check]") });
    } catch (err) {
      toast("格式检查失败：" + err.message, "error");
    }
    if (draftViewVisible(page)) render();
  });
  setsEl.addEventListener("change", (e) => {
    const box = e.target.closest("[data-rs]");
    if (!box) return;
    const k = box.dataset.rs, on = box.checked;
    if (k === "status-fix") {
      if (on) delete settings().statusFix;
      else settings().statusFix = false;
    } else if (k === "status-remind") {
      if (on) delete settings().statusRemind;
      else { settings().statusRemind = false; statusRemindNext = null; }
    } else {
      const name = preset();
      const cfg = { ...replyGuardConfig(name) };
      if (!cfg.bodyTag) return render();
      if (k === "notice") { if (on) delete cfg.notice; else cfg.notice = false; }
      if (k === "autofix") { if (on) cfg.autoFix = true; else delete cfg.autoFix; }
      settings().replyGuard = { ...settings().replyGuard, [name]: cfg };
      clearReplyGuard();
    }
    saveSettings();
  });
  return { render };
}
