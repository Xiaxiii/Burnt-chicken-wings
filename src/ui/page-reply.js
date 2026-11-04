// 「回复」页：正文格式检查。按当前预设设置（每个预设分别设置）；状态栏按角色卡记。
// 标签规则改动即校验、即保存；生成后的开关就地生效；检查最近回复或粘贴的文字，可修正、提醒下一轮、一并修正前面的回复。
// 生成后的提示点进来时，跳到本页并检查最近回复（replyFormatDialog 保留旧名，供 maintenance/replyguard.js 调用）
async function replyFormatDialog(name, { check: autoCheck = false } = {}) {
  if (shellRoot && !shellRoot.hidden) show("reply");
  else open("reply");
  if (name && name !== focusPreset()) { setFocusPreset(name); show("reply"); }
  if (autoCheck) await pages.reply?.check("latest", { scroll: true });
}
// 模型自带思考已经放进思考区时，酒馆不再自动解析推理前缀标签，它会留在正文里
function nativeReasoningNote(message) {
  const st = stReasoningTag();
  if (!st?.autoParse || !message?.extra?.reasoning || message.extra.reasoning_type !== "model") return "";
  if (!new RegExp(`<\\s*${st.tag}\\s*>`, "iu").test(replyCheckMask(String(message.mes || "")))) return "";
  return html`<div class="cw-note cw-note-warn">${iconHtml("warn")}<div><b>思考区里是模型自带的思考，&lt;${st.tag}&gt; 留在了正文里</b><p class="cw-hint">模型回传了自己的思考，酒馆不再把 &lt;${st.tag}&gt; 解析进思考区，生成时它先出现在正文中，写完才被美化正则收起。只保留预设思维链：酒馆「AI 响应配置」关闭「请求思维链」。模型仍会思考，只是不再回传。</p></div></div>`;
}
function mountReplyPage(page) {
  page.innerHTML = String(html`
    <div class="cw-body"><div class="cw-col cw-reply">
      <div data-r="for"></div>
      <section class="cw-sec"><div class="cw-sec-h"><h3>检查</h3><span class="cw-gap"></span>${btn("检查最近回复", { act: "rp-latest", kind: "primary", icon: "play" })}</div>
        ${fold("检查粘贴的文字", String(html`<label class="cw-field"><span>粘贴一条 AI 回复，只在本页检测，不保存</span><textarea class="cw-input cw-reply-sample" data-r="sample" rows="4"></textarea></label><div class="cw-card-acts">${btn("检查这段文字", { act: "rp-paste", size: "sm" })}</div>`), { cls: "cw-reply-paste" })}
        <div class="cw-reply-result" data-r="result" aria-live="polite"></div>
        ${fold("检测范围", `<ul class="cw-bullets">
          <li>检查掉标签、重复或未闭合、正文裹进思考区、状态栏等留在思考区、正文夹入思考标签、正文外大段文字（爆思维链）、疑似推理标题，以及必需标签外面多包的一层（如 &lt;状态栏&gt; 包住 &lt;lxs_status&gt;）。</li>
          <li>不自动提醒 AI。检查发现问题后，点「下一轮提醒一次」：只在下一次生成时加入一次，用完即清，换聊天后作废；续写、代拟不用掉它。提醒只点名出问题的标签，不复述写错的名字。</li>
          <li>预设条目、角色卡、当前生效的世界书和开场白都没有要求的必需标签，视为这张卡不用，不检查；模型在回复里写出它，当作写错的标签。</li>
          <li>代码块和注释中的标签示例不计。可见回复没有正文标签时，在本地查看思考区的标签位置，不展示、不发送。</li>
          <li>一键修正只改名、补齐或移动标签，正文前露出的思考原样移进思考区，不增删文字。提醒不保证模型遵守。</li>
          <li>必需标签整个没出现、回复里却多了预设、角色卡和世界书都没用到的块时，当作写错了名字：「修正这条回复」把它改名；自动修正只改子标签对得上的。</li>
          <li>正文被吞进思考区时，紧挨着的状态栏、小剧场等完整标签块一起搬出来；正文前的块照前几条回复判断。</li></ul>`)}
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3 data-r="status-title">状态栏</h3><span class="cw-gap"></span>${tipBtn()}</div>
        ${tipNote("<p>状态栏标签随角色卡而变，按卡分别记录，与预设无关，改动立即生效。没选过的卡，从它生效的世界书、角色卡、预设条目和显示正则里自动识别；认不准时请选择。检查回复时当作必需标签，必需标签栏里不必再填状态栏。</p><p>「写坏时自动改回」按状态栏的字段（如 &lt;时&gt;、&lt;地&gt;）认出写坏的一份：另写了一份的删去，写成别的名字的改名，缺外层或结尾的补上；正文和思考区不动，可撤销。</p>")}
        <div class="cw-card" data-r="status-card"><div data-r="status-body" aria-live="polite"><p class="cw-hint">正在读取世界书…</p></div></div>
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>格式规则</h3><small data-r="rules-state"></small><span class="cw-gap"></span>${tipBtn()}</div>
        ${tipNote("<p>每个预设分别设置。标签名须与预设的输出格式一致。think、thinking 自动识别。必需标签按各出现一对检查，不适合允许同名标签重复多次的格式。</p>")}
        <div class="cw-card cw-form" data-r="rules"></div>
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>生成后</h3></div>
        <div class="cw-setlist" data-r="switches"></div>
        <p class="cw-warn-text" data-r="noapi" hidden>当前酒馆缺少生成前事件或临时提示接口，可以检查和修正，不能提醒下一轮。</p>
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>AI 语义审查</h3><span class="cw-gap"></span>${tipBtn()}</div>
        ${tipNote("<p>通过酒馆当前连接发送这一条回复，检查是否夹带任务规划、自我指令等内部分析。每次增加一次请求和费用；结果可能误判，仅供核对，不改动正文。最多 20000 字符，45 秒超时。</p>")}
        <p class="cw-warn-text" data-r="nosem" hidden>当前酒馆或连接不支持独立聊天补全请求，请升级酒馆并选择聊天补全连接。结构检查仍可使用。</p>
        <div class="cw-card-acts">${btn("审查最近回复", { act: "rp-ai-latest", size: "sm" })}${btn("审查粘贴文字", { act: "rp-ai-paste", size: "sm" })}${btn("取消审查", { act: "rp-ai-cancel", size: "sm", attrs: "hidden" })}<button type="button" class="cw-link" data-act="rp-ai-result">查看最近结果</button></div>
        <div data-r="semantic-result" aria-live="polite"></div>
      </section>
    </div></div>`);
  const $ = (k) => page.querySelector(`[data-r="${k}"]`);
  const result = $("result");
  let reviewCancel = null;
  let pending = null, undo = null, earlierUndo = null, earlier = null;
  let lastName = null;
  const name = () => focusPreset();
  const available = () => replyGuardAvailable();
  const semanticAvailable = () => semanticReviewAvailable();
  const cfg = () => replyGuardConfig(name());
  const saveCfg = (next) => {
    settings().replyGuard = { ...settings().replyGuard, [name()]: next };
    saveSettings();
    clearReplyGuard();
  };
  // ---- 规则表单
  function renderRules() {
    const saved = cfg();
    const fresh = !saved.bodyTag;
    const guess = replyTagGuess(name());
    const stTag = stReasoningTag();
    const thinkingDefault = saved.thinkingTag ?? (stTag && !/^think(ing)?$/i.test(stTag.tag) ? stTag.tag : "");
    const bodyDefault = saved.bodyTag || guess?.bodyTag || "content";
    $("rules-state").textContent = fresh ? "未启用" : "改动即保存";
    $("rules").innerHTML = String(html`
      <label class="cw-field"><span>正文标签名（不填尖括号）</span><input class="cw-input" data-f="body" value="${bodyDefault}" placeholder="例如 content 或 正文" maxlength="40" aria-describedby="cw-err-body"><small class="cw-field-err" id="cw-err-body" data-err="body" hidden></small>
        ${fresh && guess ? guess.bodyTag ? html`<small class="cw-dim">已按预设填入 &lt;${guess.bodyTag}&gt;（条目中出现 ${guess.count} 处），有误可改。</small>` : html`<small class="cw-warn-text">预设开启的条目中没有正文标签。预设不要求标签包裹正文时，不要开启提醒，否则会让 AI 输出多余标签。</small>` : ""}</label>
      <label class="cw-field"><span>额外必需标签（可选，逗号分隔）</span><input class="cw-input" data-f="required" value="${(saved.requiredTags || []).join("、")}" placeholder="回复里实际的标签名，如 lxs_status" aria-describedby="cw-err-required"><small class="cw-field-err" id="cw-err-required" data-err="required" hidden></small>
        ${guess?.suggest.length ? html`<small class="cw-dim">显示正则依赖 ${guess.suggest.map((t) => `<${t}>`).join("、")} 美化。如需检查是否掉落，可填入这里。</small>` : ""}</label>
      <label class="cw-field"><span>自定义思考标签（可选，另已识别 think 和 thinking）</span><input class="cw-input" data-f="thinking" value="${thinkingDefault}" maxlength="40" aria-describedby="cw-err-thinking"><small class="cw-field-err" id="cw-err-thinking" data-err="thinking" hidden></small>
        ${!saved.thinkingTag && thinkingDefault ? html`<small class="cw-dim">已按酒馆推理前缀填入 &lt;${thinkingDefault}&gt;。</small>` : ""}</label>
      ${fresh ? html`<div class="cw-card-acts">${btn("按这些标签启用检查", { act: "rp-enable", kind: "primary" })}<small class="cw-dim">启用后，生成结束检查这条回复，发现问题时提示你。</small></div>` : ""}`);
  }
  // 表单 → 规则（校验失败抛出带 field 的错误）
  function readRules() {
    const box = $("rules");
    const thinkingTag = box.querySelector('[data-f="thinking"]').value.trim();
    const input = { bodyTag: box.querySelector('[data-f="body"]').value.trim(), requiredTags: box.querySelector('[data-f="required"]').value };
    if (thinkingTag) input.thinkingTag = thinkingTag;
    const rules = normalizeReplyRules(input);
    return { bodyTag: rules.bodyTag, requiredTags: rules.requiredTags, thinkingTag };
  }
  const fieldError = (key, message) => {
    const box = $("rules").querySelector(`[data-err="${key}"]`);
    const input = $("rules").querySelector(`[data-f="${key}"]`);
    if (!box || !input) return false;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return true;
  };
  const showError = (e, target = result) => {
    if (fieldError(e.field, e.message)) {
      const input = $("rules").querySelector(`[data-f="${e.field}"]`);
      input.scrollIntoView({ block: "center" });
      input.focus({ preventScroll: true });
    } else target.innerHTML = String(html`<p class="cw-warn-text">${e.message}</p>`);
  };
  $("rules").addEventListener("input", (e) => { if (e.target.dataset?.f) fieldError(e.target.dataset.f, ""); });
  $("rules").addEventListener("change", (e) => {
    const key = e.target.dataset?.f;
    if (!key) return;
    let rules;
    try { rules = readRules(); } catch (err) { if (err.field) fieldError(err.field, err.message); return; }
    // 已启用：改动即保存；未启用：只校验，点「启用」才保存
    if (!cfg().bodyTag) return;
    const next = { ...cfg(), ...rules };
    if (!rules.thinkingTag) next.thinkingTag = "";
    saveCfg(next);
    toast("已保存格式规则", "success");
    renderSwitches();
    showStatus().catch(() => {});
  });
  // ---- 生成后的开关
  function renderSwitches() {
    const c = cfg();
    const on = !!c.bodyTag;
    const row = (act, label, sub, checked, disabled = false) => html`<label class="cw-setrow${disabled ? " is-disabled" : ""}"><span><b>${label}</b>${sub ? html`<small>${sub}</small>` : ""}</span>${switchHtml({ act, on: checked, disabled, label })}</label>`;
    $("switches").innerHTML = String(html`
      ${row("rp-notice", "发现格式问题时提示我", on ? "提示只给你看，不发给 AI。点提示查看问题，再决定是否提醒下一轮" : "先在上方启用检查", on && c.notice !== false, !on)}
      ${row("rp-autofix", "发现问题时，自动修正这条回复", "补齐、移动标签，去掉多包的一层，改回写错名字的块；改了会提示，可在本页撤销", on && !!c.autoFix, !on)}
      ${row("rp-statusfix", "状态栏写坏时自动改回", "正文和思考区不动，可撤销", statusFixOn())}
      ${row("rp-statusremind", "状态栏掉了时，下一轮自动提醒一次", "只点名这张卡的状态栏标签；用完即清，换聊天作废", statusRemindOn())}
      ${row("rp-semantic", "生成完成后自动 AI 语义审查", semanticAvailable() ? "每次多一次请求和费用，默认关闭" : "当前连接不支持", on && !!c.semanticAfterReply && semanticAvailable(), !on || !semanticAvailable())}`);
    $("noapi").hidden = available();
    $("nosem").hidden = semanticAvailable();
  }
  $("switches").addEventListener("change", (e) => {
    const a = e.target.dataset.act;
    const on = e.target.checked;
    if (a === "rp-statusfix") { if (on) delete settings().statusFix; else settings().statusFix = false; return saveSettings(); }
    if (a === "rp-statusremind") {
      if (on) delete settings().statusRemind;
      else { settings().statusRemind = false; statusRemindNext = null; }
      return saveSettings();
    }
    const c = { ...cfg() };
    if (!c.bodyTag) return renderSwitches();
    if (a === "rp-notice") { if (on) delete c.notice; else c.notice = false; }
    if (a === "rp-autofix") { if (on) c.autoFix = true; else delete c.autoFix; }
    if (a === "rp-semantic") { if (on) c.semanticAfterReply = true; else delete c.semanticAfterReply; }
    saveCfg(c);
  });
  // ---- 这张卡的状态栏：显示选定或自动认出的标签，可改选
  let status = null;
  const rulesNow = () => { try { return normalizeReplyRules(readRules()); } catch { const s = cfg(); return normalizeReplyRules(s.bodyTag ? s : {}); } };
  async function showStatus() {
    const box = $("status-body");
    const card = statusCard();
    $("status-title").textContent = card ? `「${card.name}」的状态栏` : "状态栏";
    const rules = rulesNow();
    status = await statusFor(rules, name());
    let warn = "";
    if (status.tag) {
      const clash = statusConflicts(status.tag, statusCandidates(rules, await replyWorldTexts(), name()));
      if (clash.length) warn = String(html`<p class="cw-warn-text">${clash.map((c) => `${c.from.filter((f) => f.startsWith("预设条目")).join("、")} 要求输出 <${c.name}>`).join("；")}。与这张卡的 <${status.tag}> 并存时，模型会写两份状态栏；在这张卡上关掉这些条目即可。</p>`);
    }
    const s = status;
    const change = (label) => btn(label, { act: "rp-status-pick", size: "sm" });
    let line;
    if (s.state === "nocard") line = html`<p class="cw-hint">没有打开角色卡。</p>`;
    else if (s.state === "manual" || s.state === "auto") line = html`<div class="cw-status-row"><div><code class="cw-status-tag">&lt;${s.tag}&gt;</code><small class="cw-dim">${[s.from, s.state === "auto" ? "自动识别" : "已选定"].filter(Boolean).join(" · ")}</small></div>${change("更改")}</div>`;
    else if (s.state === "off") line = html`<div class="cw-status-row"><p class="cw-p">这张卡不检查状态栏。</p>${change("更改")}</div>`;
    else if (s.state === "ambiguous") line = html`<div class="cw-status-row"><p class="cw-p">找到 ${s.list.length} 个可能的块，认不准哪个是状态栏，请选择。</p>${change("选择")}</div>`;
    else line = html`<div class="cw-status-row"><p class="cw-p">世界书、角色卡、预设和显示正则里都没有找到状态栏。</p>${change("选择")}</div>`;
    box.innerHTML = String(line) + warn;
    return status;
  }
  async function pickStatus() {
    const card = statusCard();
    if (!card) return;
    const rules = rulesNow();
    const world = await replyWorldTexts();
    const list = statusCandidates(rules, world, name());
    const chat = ctx().chat;
    const recent = (key) => { const r = statusRecentCount(chat, key.toLowerCase()); return r.seen ? `最近 ${r.seen} 条回复有 ${r.hit} 条写了它` : ""; };
    const was = statusSaved(card);
    const items = list.map((c) => ({ label: `<${c.name}>`, sub: [[...c.from, ...c.regex].slice(0, 3).join("、"), recent(c.key)].filter(Boolean).join(" · "), value: { tag: c.name, from: c.from[0] || c.regex[0] || "" } }));
    items.push({ label: "从世界书条目里选…", sub: "列出当前生效的世界书里写了成对标签的条目", value: "entries" });
    items.push({ label: "手动填写标签名…", value: "type" });
    items.push({ label: "这张卡没有状态栏，不检查", value: "off" });
    if (was) items.push({ label: "改回自动识别", value: "auto" });
    let v = await pickBox(`「${card.name}」的状态栏`, items, { hint: "选这张卡回复里包住状态栏的标签，只对这张卡生效。" });
    if (v == null) return;
    if (v === "entries") {
      const entries = statusEntryTags(world, rules);
      const i = await pickBox("状态栏写在哪个世界书条目", entries.map((x, n) => ({ label: x.from, sub: x.tags.map((t) => `<${t}>`).join("、"), value: n })), { hint: entries.length ? "" : "当前生效的世界书里没有写了成对标签的条目。" });
      if (i == null) return;
      const entry = entries[i];
      let tag = entry.tags[0];
      if (entry.tags.length > 1) {
        tag = await pickBox("这个条目里哪个是状态栏", entry.tags.map((t) => ({ label: `<${t}>`, sub: recent(t), value: t })), { hint: entry.from });
        if (tag == null) return;
      }
      v = { tag, from: entry.from };
    } else if (v === "type") {
      const rawTag = await promptBox("状态栏标签名", was?.tag || "", "回复里实际的标签名，如 lxs_status");
      if (!rawTag) return;
      let tag;
      try { tag = replyRuleTag(rawTag, "状态栏标签", "status"); } catch (e) { toast(e.message, "error"); return; }
      v = { tag, from: "手动填写" };
    }
    statusSave(card, v === "auto" ? null : v === "off" ? { off: true } : v);
    const now = await showStatus();
    toast(now.tag ? `「${card.name}」的状态栏：<${now.tag}>` : now.state === "off" ? `「${card.name}」不检查状态栏` : `「${card.name}」的状态栏改回自动识别`, "success");
  }
  // ---- 检查
  // 提醒只用于酒馆正在用的预设
  const remindable = () => available() && name() === currentPresetName();
  const remindCard = (reminder) => {
    if (!remindable()) return html`${fold("下一轮提醒预览", String(html`<pre class="cw-pre">${reminder}</pre>`))}${available() ? html`<p class="cw-hint">酒馆现在用的不是「${name()}」，切到这个预设后才能提醒下一轮。</p>` : ""}`;
    const armed = replyReminderArmed() === reminder;
    return html`<div class="cw-card" data-r="remind-card"><div class="cw-card-h"><b>下一轮提醒</b><span class="cw-gap"></span>${tipBtn()}</div>${tipNote("只在下一次生成时加入一次，用完即清；换聊天后作废。续写、代拟不用掉它。")}
      <pre class="cw-pre">${reminder}</pre>
      <div class="cw-card-acts">${armed ? html`<span class="cw-ok-text">已安排：下一次生成时提醒一次</span><button type="button" class="cw-link" data-act="rp-unremind">取消</button>` : btn("下一轮提醒一次", { act: "rp-remind", size: "sm" })}</div></div>`;
  };
  const earlierCard = () => {
    if (!earlier?.length) return "";
    const kinds = [...new Set(earlier.flatMap((x) => x.pairs))];
    return html`<div class="cw-card" data-r="earlier-card"><p class="cw-p">前面还有 ${earlier.length} 条回复有同样的问题（${kinds.slice(0, 2).join("、")}${kinds.length > 2 ? " 等" : ""}）。模型会照着前面的回复写，建议一并修正。</p>
      <div class="cw-card-acts">${btn("一并修正", { act: "rp-fix-earlier", size: "sm" })}</div></div>`;
  };
  // 标签出处：多包的、写错名的、缺了的、这张卡不用的标签，写在预设、世界书等哪里，聊天里有几条
  const originCard = (origins) => {
    if (!origins.length) return "";
    const row = (o) => {
      const parts = [];
      if (o.from.length) parts.push(o.from.slice(0, 6).join("、") + (o.from.length > 6 ? ` 等 ${o.from.length} 处` : ""));
      const said = [o.ai && `前面 ${o.ai} 条 AI 回复`, o.mine && `你的 ${o.mine} 条消息`].filter(Boolean);
      if (said.length) parts.push(`聊天里${said.join("、")}`);
      return html`<li><code>&lt;${o.name}&gt;</code>：${parts.length ? parts.join("；") : "预设、角色卡、世界书、正则和聊天记录里都没有"}</li>`;
    };
    return html`<div class="cw-card" data-r="origins"><div class="cw-card-h"><b>标签出处</b><span class="cw-gap"></span>${tipBtn()}</div>${tipNote("模型照着提示词和聊天记录写。要它不再写某个标签，须删掉或改正下列各处的这个标签。写成「不要用 &lt;某标签&gt;」，模型同样会记住它。")}
      <ul class="cw-bullets">${origins.map(row)}</ul></div>`;
  };
  // 检查要先读世界书等（异步）：进行中标 aria-busy
  async function check(mode, { scroll = false } = {}) {
    result.setAttribute("aria-busy", "true");
    result.innerHTML = String(html`<p class="cw-hint">正在检查…</p>`);
    try {
      await checkNow(mode);
      if (scroll) result.closest(".cw-sec").scrollIntoView({ block: "nearest" });
    } catch (e) {
      showError(e);
    } finally {
      result.removeAttribute("aria-busy");
    }
  }
  async function checkNow(mode) {
    const base = readRules();
    let text = $("sample").value, source = "粘贴的文字", reasoning = "", latest = null;
    if (mode === "latest") {
      latest = latestReplyForCheck(ctx().chat);
      if (!latest) { result.innerHTML = String(html`<p class="cw-hint">没有可检查的 AI 回复（不检查开场白、用户和系统消息）。</p>`); pending = null; earlier = null; return; }
      text = latest.message.mes;
      reasoning = latest.message.extra?.reasoning || "";
      source = `聊天第 ${latest.index + 1} 条消息`;
    }
    const chat = ctx().chat;
    const at = latest ? latest.index : Array.isArray(chat) ? chat.length : 0;
    // 这张卡的状态栏标签当作必需标签一起查
    const cardStatus = await showStatus();
    const config = statusRules(base, cardStatus);
    const force = cardStatus.tag || null;
    let { report, extra } = await replyCheckChat(text, config, { chat, index: at, reasoning, name: name(), force });
    // 状态栏按字段再查一遍：另写了一份、写成别的名字、缺外层或结尾
    const checkRules = normalizeReplyRules(config);
    const kids = force ? statusChildren(force, checkRules, await replyWorldTexts(), name()) : null;
    const statusFix = force ? statusCheck(report, text, force, kids, checkRules) : null;
    const reminder = [buildReplyReminder(report, config), force ? statusReminder(report, force) : ""].filter(Boolean).join("\n");
    const plan = report.issues.length ? statusPlan(text, checkRules, extra, statusFix, true) : null;
    pending = plan && latest ? { index: latest.index, plan, snapshot: replyMessageSnapshot(latest.index) } : null;
    const rules = normalizeReplyRules(config);
    // 前面的回复按这张卡要的必需标签查
    const scanEarlier = () => replyEarlierRepairs(chat, latest.index, replyCardRules(rules, extra.isApplicable), extra.knownTags, force ? statusEarlierFix(force, kids, rules) : null);
    earlier = latest ? await scanEarlier() : null;
    if (latest && extra.needWorld()) {
      extra = { ...replyCheckExtras(chat, at, rules, name(), await replyWorldTexts(), force), reasoning };
      earlier = await scanEarlier();
    }
    const asks = new Map();
    const ask = (key, label) => { if (key && key !== rules.bodyTag.toLowerCase() && !asks.has(key)) asks.set(key, label); };
    for (const w of report.wrapped || []) ask(w.key, w.name);
    for (const i of report.issues) if (i.kind === "status" && i.other) ask(i.other.toLowerCase(), i.other);
    for (const b of report.misnamed?.suspects || []) ask(b.key, b.name);
    for (const i of report.issues) if (i.kind === "missing" && i.tag) ask(i.tag.toLowerCase(), i.tag);
    for (const t of report.skipped) ask(t.toLowerCase(), t);
    const skippedKeys = new Set(report.skipped.map((t) => t.toLowerCase()));
    const origins = asks.size ? replyTagOrigins([...asks].map(([key, label]) => ({ key, name: label })), extra.knownTags, chat, at).filter((o) => !skippedKeys.has(o.key) || o.from.length || o.ai || o.mine) : [];
    const left = plan ? plan.after.issues : [];
    const fix = plan ? html`<div class="cw-card"><div class="cw-card-h"><b>可修正的标签</b><span class="cw-gap"></span>${tipBtn()}</div>${tipNote("只移动文字、补写或去掉标签，不增删文字。")}<ul class="cw-bullets">${plan.steps.map((x) => html`<li>${x}</li>`)}</ul>
      ${left.length ? html`<p class="cw-warn-text">修正后仍有 ${left.length} 个问题需人工处理：${left.map((i) => i.text).join("；")}</p>` : ""}
      ${fold("修正后原文预览", String(html`<pre class="cw-pre">${plan.text}</pre>`))}
      ${pending ? html`<div class="cw-card-acts">${btn("修正这条回复", { act: "rp-fix", kind: "primary", size: "sm" })}</div>` : html`<p class="cw-hint">粘贴的文字不写回聊天，可复制上面的预览。</p>`}</div>` : "";
    const auto = latest && replyAutoFixFor(latest.index);
    const note = html`${auto ? html`<div class="cw-note">${iconHtml("info")}<div>这条回复已自动修正：${auto.steps.join("；")}。<button type="button" class="cw-link" data-act="rp-undo-auto">撤销</button></div></div>` : ""}${latest ? raw(String(nativeReasoningNote(latest.message))) : ""}`;
    const skipped = report.skipped.length ? html`<p class="cw-hint">这张卡没有用到 ${report.skipped.map((t) => `<${t}>`).join("、")}：预设条目、角色卡、世界书和开场白里都没有，未检查。</p>` : "";
    // 自动修正过的回复，提醒按修正前的问题写
    const remindText = auto ? buildReplyReminder(auto.report, config) : reminder;
    const remind = remindText && latest ? remindCard(remindText) : remindText ? fold("下一轮提醒预览", String(html`<pre class="cw-pre">${remindText}</pre>`)) : "";
    result.innerHTML = String(html`${note}
      <div class="cw-note ${report.issues.length ? "cw-note-warn" : "cw-note-ok"}">${iconHtml(report.issues.length ? "warn" : "ok")}<div><b>${source}：${report.issues.length ? `发现 ${report.issues.length} 个格式风险` : "未发现配置范围内的格式问题"}</b>${report.issues.length ? "" : html`<p class="cw-hint">这不代表正文语义、所有变量或其他输出格式已验证。</p>`}</div></div>
      ${skipped}
      ${report.issues.length ? html`<ul class="cw-issues">${report.issues.map((i) => html`<li>${i.text}${i.excerpt ? html`<pre class="cw-pre">${i.excerpt}${i.excerpt.length >= 80 ? "…" : ""}</pre>` : ""}</li>`)}</ul>${fix}` : ""}
      ${originCard(origins)}${remind}${earlierCard()}`);
  }
  // ---- AI 语义审查
  const semanticResult = $("semantic-result");
  const showSemantic = (report) => {
    semanticResult.innerHTML = String(html`<div class="cw-card"><p class="cw-p">${report.verdict === "suspected" ? "模型标记了疑似内部分析，请人工确认" : "模型未标记疑似内部分析"}（模型自报置信度 ${Math.round(report.confidence * 100)}%，不是准确率）</p>${report.findings.map((f) => html`<pre class="cw-pre">${f.excerpt}</pre><p class="cw-hint">${f.reason}</p>`)}<p class="cw-hint">未改写聊天；未发现问题也不保证没有语义泄露。</p></div>`);
  };
  async function semantic(mode) {
    if (reviewCancel) return;
    let text = $("sample").value, identity = null;
    if (mode === "latest") {
      const latest = latestReplyForCheck(ctx().chat);
      if (!latest) { semanticResult.innerHTML = String(html`<p class="cw-hint">没有可审查的最近 AI 回复。</p>`); return; }
      text = latest.message.mes;
      identity = semanticReplyIdentity(latest);
    }
    reviewCancel = new AbortController();
    const buttons = [...page.querySelectorAll('[data-act="rp-ai-latest"], [data-act="rp-ai-paste"]')];
    buttons.forEach((b) => { b.disabled = true; });
    page.querySelector('[data-act="rp-ai-cancel"]').hidden = false;
    semanticResult.innerHTML = String(html`<p class="cw-hint">正在请求当前模型审查…</p>`);
    try { showSemantic(await reviewReplySemantics(text, { signal: reviewCancel.signal, identity, rules: readRules() })); }
    catch (error) { showError(error, semanticResult); }
    finally {
      reviewCancel = null;
      buttons.forEach((b) => { b.disabled = !semanticAvailable(); });
      page.querySelector('[data-act="rp-ai-cancel"]').hidden = true;
    }
  }
  page.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    try {
      if (a === "rp-latest") return await check("latest", { scroll: true });
      if (a === "rp-paste") return await check("paste");
      if (a === "rp-status-pick") return await pickStatus();
      if (a === "rp-enable") {
        let rules;
        try { rules = readRules(); } catch (err) { return showError(err); }
        saveCfg({ ...cfg(), ...rules });
        toast("已启用格式检查：生成后发现正文格式问题时提示你", "success");
        return render();
      }
      if (a === "rp-remind" || a === "rp-unremind") {
        const card = b.closest('[data-r="remind-card"]');
        const text = card.querySelector("pre").textContent;
        armReplyReminder(a === "rp-remind" ? text : null);
        card.outerHTML = String(remindCard(text));
        result.querySelector(a === "rp-remind" ? '[data-act="rp-unremind"]' : '[data-act="rp-remind"]')?.focus({ preventScroll: true });
        return;
      }
      if (a === "rp-fix-earlier") {
        if (!earlier?.length) return;
        b.disabled = true;
        earlierUndo = await unwrapEarlierReplies(earlier);
        await check("latest");
        result.insertAdjacentHTML("afterbegin", String(html`<div class="cw-note cw-note-ok">${iconHtml("ok")}<div>已修正前面 ${earlierUndo.items.length} 条回复的标签。<button type="button" class="cw-link" data-act="rp-undo-earlier">撤销</button></div></div>`));
        return;
      }
      if (a === "rp-undo-earlier") {
        if (!earlierUndo) return;
        const n = await undoEarlierReplies(earlierUndo);
        earlierUndo = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", String(html`<p class="cw-hint">已撤销 ${n} 条回复的修改。</p>`));
        return;
      }
      if (a === "rp-fix") {
        if (!pending) return;
        b.disabled = true;
        undo = await applyReplyFix(pending.index, pending.plan, pending.snapshot);
        await check("latest");
        result.insertAdjacentHTML("afterbegin", String(html`<div class="cw-note cw-note-ok">${iconHtml("ok")}<div>已修正聊天第 ${undo.index + 1} 条消息的标签。<button type="button" class="cw-link" data-act="rp-undo-fix">撤销</button></div></div>`));
        return;
      }
      if (a === "rp-undo-auto") {
        if (!replyAutoFixed) return;
        await undoReplyFix(replyAutoFixed.undo);
        replyAutoFixed = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", String(html`<p class="cw-hint">已撤销自动修正。</p>`));
        return;
      }
      if (a === "rp-undo-fix") {
        if (!undo) return;
        await undoReplyFix(undo);
        undo = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", String(html`<p class="cw-hint">已撤销修正。</p>`));
        return;
      }
      if (a === "rp-ai-latest") return await semantic("latest");
      if (a === "rp-ai-paste") return await semantic("paste");
      if (a === "rp-ai-cancel") return reviewCancel?.abort();
      if (a === "rp-ai-result") {
        const report = semanticReviewResults.get(semanticReplyIdentity());
        if (report) showSemantic(report);
        else semanticResult.innerHTML = String(html`<p class="cw-hint">最近回复暂无有效审查结果，可手动审查或开启生成后自动审查。</p>`);
      }
    } catch (err) {
      showError(err);
    }
  });
  function render() {
    const n = name();
    $("for").innerHTML = n === currentPresetName() ? "" : String(html`<div class="cw-note cw-note-warn">${iconHtml("info")}<div>「${n}」未在使用。规则可以先设好；生成后的检查和下一轮提醒只按酒馆正在用的预设。</div></div>`);
    if (lastName !== n) {
      lastName = n;
      result.innerHTML = "";
      pending = null;
      earlier = null;
    }
    renderRules();
    renderSwitches();
    // 未启用时主按钮让给「启用检查」
    page.querySelector('[data-act="rp-latest"]').classList.toggle("cw-btn-primary", !!cfg().bodyTag);
    showStatus().catch((e) => { $("status-body").innerHTML = String(html`<p class="cw-warn-text">读取状态栏失败：${e.message}</p>`); });
    const semOk = semanticAvailable();
    page.querySelectorAll('[data-act="rp-ai-latest"], [data-act="rp-ai-paste"]').forEach((b) => { b.disabled = !semOk || !!reviewCancel; });
  }
  return { render, check };
}
