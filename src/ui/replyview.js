// 按预设开着的条目和显示正则猜标签；读不到预设时不猜
function replyTagGuess(name) {
  try {
    const d = getDraft(name);
    const texts = d.order.filter((o) => d.isActive(o.identifier)).map((o) => d.prompt(o.identifier)?.content);
    const regexTags = [];
    try { for (const rule of presetRegexList(d)) if (!rule?.disabled) regexTags.push(...presetRegexAnchors(rule).tags); } catch {}
    return guessReplyTags(texts, regexTags);
  } catch { return null; }
}
// 酒馆「推理内容格式化」的前缀，如 <ECoT>：预设用它包思考，检查时当作思考标签
function stReasoningTag(c = ctx()) {
  const r = c.powerUserSettings?.reasoning;
  const m = /^<\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39})\s*>$/u.exec(String(r?.prefix || "").trim());
  return m ? { tag: m[1], autoParse: !!r.auto_parse } : null;
}
// 模型自带思考（Gemini、Claude 等返回的推理）已经放进思考区时，酒馆不再自动解析 <ECoT>，它会留在正文里
function nativeReasoningNote(message) {
  const st = stReasoningTag();
  if (!st?.autoParse || !message?.extra?.reasoning || message.extra.reasoning_type !== "model") return "";
  if (!new RegExp(`<\\s*${st.tag}\\s*>`, "iu").test(replyCheckMask(String(message.mes || "")))) return "";
  return `<div class="pa-card pa-card-warn"><b>思考区里是模型自带的思考，&lt;${esc(st.tag)}&gt; 留在了正文里</b><p class="pa-hint">模型回传了自己的思考，酒馆不再把 &lt;${esc(st.tag)}&gt; 解析进思考区，生成时它先出现在正文中，写完才被美化正则收起。只保留预设思维链：酒馆「AI 响应配置」关闭「请求思维链」。模型仍会思考，只是不再回传。</p></div>`;
}
// 2.6.11 check：打开后直接检查最近回复（生成后的提示点进来时）
async function replyFormatDialog(name, { check: autoCheck = false } = {}) {
  const saved = replyGuardConfig(name);
  const stTag = stReasoningTag();
  const thinkingDefault = saved.thinkingTag ?? (stTag && !/^think(ing)?$/i.test(stTag.tag) ? stTag.tag : "");
  const fresh = !saved.bodyTag;
  const guess = replyTagGuess(name);
  const bodyDefault = saved.bodyTag || guess?.bodyTag || "content";
  const available = replyGuardAvailable();
  const semanticAvailable = semanticReviewAvailable();
  let reviewCancel = null;
  const body = el(`<div class="pa-form">
    <div class="pa-whyrow"><p class="pa-hint">当前预设「${esc(name)}」</p>${whyBtn("preset")}</div>
    ${whyNote("preset", "每个预设分别设置。标签名须与预设的输出格式一致。")}
    <div class="pa-card" data-r="status-card"><div class="pa-whyrow"><b>${statusCard() ? `角色卡「${esc(statusCard().name)}」的状态栏` : "状态栏"}</b>${whyBtn("status")}</div>
      ${whyNote("status", "状态栏标签随角色卡而变，按卡分别记录，与预设无关，改动立即生效。没选过的卡，从它生效的世界书、角色卡、预设条目和显示正则里自动识别；认不准时请选择。检查回复时当作必需标签，必需标签栏里不必再填状态栏。「写坏时自动改回」按状态栏的字段（如 <时>、<地>）认出写坏的一份：另写了一份的删去，写成别的名字的改名，缺外层或结尾的补上；正文和思考区不动，可撤销。")}
      <div data-r="status-body" aria-live="polite"><p class="pa-hint">正在读取世界书…</p></div>
      <label class="pa-field-row"><input type="checkbox" data-r="status-fix" ${statusFixOn() ? "checked" : ""}>状态栏写坏时自动改回</label>
      <label class="pa-field-row"><input type="checkbox" data-r="status-remind" ${statusRemindOn() ? "checked" : ""}>状态栏掉了时，下一轮自动提醒一次</label></div>
    <label class="pa-field"><span>正文标签名（不填尖括号）${fresh && guess?.bodyTag ? whyBtn("body") : ""}</span><input class="pa-input" data-r="body" value="${esc(bodyDefault)}" placeholder="例如 content 或 正文" maxlength="40" aria-describedby="pa-err-body"><small class="pa-field-err" id="pa-err-body" data-err="body" hidden></small></label>
    ${fresh && guess ? guess.bodyTag ? whyNote("body", `已按预设填入 &lt;${esc(guess.bodyTag)}&gt;（条目中出现 ${guess.count} 处），有误可改。`) : '<p class="pa-warn">预设开启的条目中没有正文标签。预设不要求标签包裹正文时，不要开启提醒，否则会让 AI 输出多余标签。</p>' : ""}
    <label class="pa-field"><span>额外必需标签（可选，逗号分隔）${guess?.suggest.length ? whyBtn("required") : ""}</span><input class="pa-input" data-r="required" value="${esc((saved.requiredTags || []).join("、"))}" placeholder="回复里实际的标签名，如 lxs_status" aria-describedby="pa-err-required"><small class="pa-field-err" id="pa-err-required" data-err="required" hidden></small></label>
    ${guess?.suggest.length ? whyNote("required", `显示正则依赖 ${guess.suggest.map((t) => `&lt;${esc(t)}&gt;`).join("、")} 美化。如需检查是否掉落，可填入这里。`) : ""}
    <label class="pa-field"><span>自定义思考标签（可选，另已识别 think 和 thinking）${!saved.thinkingTag && thinkingDefault ? whyBtn("thinking") : ""}</span><input class="pa-input" data-r="thinking" value="${esc(thinkingDefault)}" maxlength="40" aria-describedby="pa-err-thinking"><small class="pa-field-err" id="pa-err-thinking" data-err="thinking" hidden></small></label>
    ${!saved.thinkingTag && thinkingDefault ? whyNote("thinking", `已按酒馆推理前缀填入 &lt;${esc(thinkingDefault)}&gt;。`) : ""}
    <div class="pa-whyrow pa-whyrow-check"><label class="pa-field-row"><input type="checkbox" data-r="notice" ${saved.notice !== false ? "checked" : ""}>生成后发现格式问题时，提示我</label>${whyBtn("notice")}</div>
    ${whyNote("notice", "提示只给你看，不发给 AI。点提示查看问题，再决定是否提醒下一轮。")}
    <div class="pa-whyrow pa-whyrow-check"><label class="pa-field-row"><input type="checkbox" data-r="autofix" ${saved.autoFix ? "checked" : ""}>发现问题时，自动修正这条回复</label>${whyBtn("autofix")}</div>
    ${whyNote("autofix", "每次生成完自动补齐、移动标签，去掉必需标签外面多包的一层；必需标签写错了名字、子标签和预设或世界书里的写法对得上时，改回原名。改了会提示，可在这里撤销。")}
    ${available ? "" : '<p class="pa-warn">当前酒馆缺少生成前事件或临时提示接口，可以检查和修正，不能提醒下一轮。</p>'}
    <details class="pa-card"><summary>检测范围</summary><ul class="pa-notes">
      <li>检查掉标签、重复或未闭合、正文裹进思考区、状态栏等留在思考区、正文夹入思考标签、正文外大段文字（爆思维链）、疑似推理标题，以及必需标签外面多包的一层（如 &lt;状态栏&gt; 包住 &lt;lxs_status&gt;）。</li>
      <li>不自动提醒 AI。检查发现问题后，点「下一轮提醒一次」：只在下一次生成时加入一次，用完即清，换聊天后作废；续写、代拟不用掉它。提醒只点名出问题的标签，不复述写错的名字。</li>
      <li>预设条目、角色卡、当前生效的世界书和开场白都没有要求的必需标签，视为这张卡不用，不检查；模型在回复里写出它，当作写错的标签。</li>
      <li>代码块和注释中的标签示例不计。可见回复没有正文标签时，在本地查看思考区的标签位置，不展示、不发送。</li>
      <li>一键修正只改名、补齐或移动标签，正文前露出的思考原样移进思考区，不增删文字。提醒不保证模型遵守。</li>
      <li>必需标签整个没出现、回复里却多了预设、角色卡和世界书都没用到的块（如把 &lt;lxs_status&gt; 写成 &lt;状态栏&gt;）时，当作写错了名字：「修正这条回复」把它改名；自动修正只改子标签对得上的。</li>
      <li>正文被吞进思考区时，紧挨着的状态栏、小剧场等完整标签块一起搬出来；正文前的块照前几条回复判断，免得把思考里的步骤搬出来。上次只搬出正文、块还留在思考区末尾的，也会照前几条回复放回原位。</li></ul></details>
    <div class="pa-toolbar"><button class="pa-btn pa-btn-soft" data-r="latest">检查最近回复</button><button class="pa-btn pa-btn-soft" data-r="paste">检查下方文字</button></div>
    <label class="pa-field"><span>粘贴一条 AI 回复（只在本页检测，不保存）</span><textarea class="pa-input" data-r="sample" rows="5"></textarea></label>
    <div data-r="result" aria-live="polite"></div>
    <details class="pa-card"><summary>AI 语义审查（可选）</summary>
      <p class="pa-hint">通过酒馆当前连接发送这一条回复，检查是否夹带任务规划、自我指令等内部分析。每次增加一次请求和费用；结果可能误判，仅供核对，不改动正文。</p>
      <label class="pa-field-row"><input type="checkbox" data-r="semantic" ${saved.semanticAfterReply ? "checked" : ""} ${semanticAvailable ? "" : "disabled"}>生成完成后自动语义审查（默认关闭）</label>
      ${semanticAvailable ? "" : '<p class="pa-warn">当前酒馆或连接不支持独立聊天补全请求，请升级酒馆并选择聊天补全连接。结构检查仍可使用。</p>'}
      <div class="pa-toolbar"><button class="pa-btn" data-r="ai-latest" ${semanticAvailable ? "" : "disabled"}>AI 审查最近回复</button><button class="pa-btn" data-r="ai-paste" ${semanticAvailable ? "" : "disabled"}>AI 审查粘贴文字</button><button class="pa-btn" data-r="ai-cancel" hidden>取消审查</button><button class="pa-link" data-r="ai-result">查看最近结果</button></div>
      <div data-r="semantic-result" aria-live="polite"></div>
    </details>
  </div>`);
  bindWhy(body);
  // 2.6.17 这张卡的状态栏：显示选定或自动认出的标签，可改选
  const statusBox = body.querySelector('[data-r="status-body"]');
  let status = null;
  const rulesNow = () => { try { return normalizeReplyRules(read()); } catch { return normalizeReplyRules(saved.bodyTag ? saved : {}); } };
  const statusLine = (s) => {
    const btn = (label) => `<button class="pa-btn pa-btn-soft" data-r="status-pick">${label}</button>`;
    if (s.state === "nocard") return '<p class="pa-hint">没有打开角色卡。</p>';
    if (s.state === "manual" || s.state === "auto") return `<div class="pa-status-row"><div><b class="pa-status-tag">${esc(`<${s.tag}>`)}</b><p class="pa-hint">${esc([s.from, s.state === "auto" ? "自动识别" : "已选定"].filter(Boolean).join(" · "))}</p></div>${btn("更改")}</div>`;
    if (s.state === "off") return `<div class="pa-status-row"><p class="pa-p">这张卡不检查状态栏。</p>${btn("更改")}</div>`;
    if (s.state === "ambiguous") return `<div class="pa-status-row"><p class="pa-p">找到 ${s.list.length} 个可能的块，认不准哪个是状态栏，请选择。</p>${btn("选择")}</div>`;
    return `<div class="pa-status-row"><p class="pa-p">世界书、角色卡、预设和显示正则里都没有找到状态栏。</p>${btn("选择")}</div>`;
  };
  const showStatus = async () => {
    const rules = rulesNow();
    status = await statusFor(rules, name);
    // 预设条目另要求一个状态栏块：模型会写两份
    let warn = "";
    if (status.tag) {
      const clash = statusConflicts(status.tag, statusCandidates(rules, await replyWorldTexts(), name));
      if (clash.length) warn = `<p class="pa-warn">${esc(clash.map((c) => `${c.from.filter((f) => f.startsWith("预设条目")).join("、")} 要求输出 <${c.name}>`).join("；"))}。与这张卡的 <${status.tag}> 并存时，模型会写两份状态栏；在这张卡上关掉这些条目即可。</p>`;
    }
    statusBox.innerHTML = statusLine(status) + warn;
    return status;
  };
  const pickStatus = async () => {
    const card = statusCard();
    if (!card) return;
    const rules = rulesNow();
    const world = await replyWorldTexts();
    const list = statusCandidates(rules, world, name);
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
      const raw = await promptBox("状态栏标签名", was?.tag || "", "回复里实际的标签名，如 lxs_status");
      if (!raw) return;
      let tag;
      try { tag = replyRuleTag(raw, "状态栏标签", "status"); } catch (e) { toast(e.message, "error"); return; }
      v = { tag, from: "手动填写" };
    }
    statusSave(card, v === "auto" ? null : v === "off" ? { off: true } : v);
    const now = await showStatus();
    toast(now.tag ? `「${card.name}」的状态栏：<${now.tag}>` : now.state === "off" ? `「${card.name}」不检查状态栏` : `「${card.name}」的状态栏改回自动识别`, "success");
  };
  body.addEventListener("click", (e) => {
    if (!e.target.closest('[data-r="status-pick"]')) return;
    pickStatus().catch((err) => toast("设置状态栏失败：" + err.message, "error"));
  });
  body.querySelector('[data-r="status-fix"]').addEventListener("change", (e) => {
    if (e.target.checked) delete settings().statusFix;
    else settings().statusFix = false;
    saveSettings();
  });
  body.querySelector('[data-r="status-remind"]').addEventListener("change", (e) => {
    if (e.target.checked) delete settings().statusRemind;
    else settings().statusRemind = false;
    saveSettings();
    if (!e.target.checked) statusRemindNext = null;
  });
  const read = () => {
    const thinkingTag = body.querySelector('[data-r="thinking"]').value.trim();
    const input = { bodyTag: body.querySelector('[data-r="body"]').value.trim(), requiredTags: body.querySelector('[data-r="required"]').value };
    if (thinkingTag) input.thinkingTag = thinkingTag;
    const rules = normalizeReplyRules(input);
    const value = { bodyTag: rules.bodyTag, requiredTags: rules.requiredTags, thinkingTag };
    if (!body.querySelector('[data-r="notice"]').checked) value.notice = false;
    if (body.querySelector('[data-r="autofix"]').checked) value.autoFix = true;
    if (semanticAvailable && body.querySelector('[data-r="semantic"]').checked) value.semanticAfterReply = true;
    return value;
  };
  const result = body.querySelector('[data-r="result"]');
  // 2.5.1 标签填错时，报错写在那个输入框下面并滚过去；改动时清掉，离开输入框时重新检查
  const fieldError = (key, message) => {
    const box = body.querySelector(`[data-err="${key}"]`);
    const input = body.querySelector(`[data-r="${key}"]`);
    if (!box || !input) return false;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return true;
  };
  const showError = (e, target = result) => {
    if (fieldError(e.field, e.message)) {
      const input = body.querySelector(`[data-r="${e.field}"]`);
      input.scrollIntoView({ block: "center" });
      input.focus({ preventScroll: true });
    } else target.innerHTML = `<p class="pa-warn">${esc(e.message)}</p>`;
  };
  body.addEventListener("input", (e) => { if (e.target.dataset?.r) fieldError(e.target.dataset.r, ""); });
  body.addEventListener("change", (e) => {
    const key = e.target.dataset?.r;
    if (!["body", "required", "thinking"].includes(key)) return;
    try { read(); } catch (err) { if (err.field === key) fieldError(key, err.message); }
  });
  let pending = null, undo = null, earlierUndo = null, earlier = null;
  // 提醒只用于酒馆正在用的预设：看的是别的预设时不给按钮
  const remindable = () => available && name === currentPresetName();
  const remindCard = (reminder) => {
    if (!remindable()) return `<details class="pa-card"><summary>下一轮提醒预览</summary><pre class="pa-pre">${esc(reminder)}</pre></details>${available ? `<p class="pa-hint">酒馆现在用的不是「${esc(name)}」，切到这个预设后才能提醒下一轮。</p>` : ""}`;
    const armed = replyReminderArmed() === reminder;
    return `<div class="pa-card" data-r="remind-card"><div class="pa-whyrow"><b>下一轮提醒</b>${whyBtn("remind")}</div>${whyNote("remind", "只在下一次生成时加入一次，用完即清；换聊天后作废。续写、代拟不用掉它。")}
      <pre class="pa-pre">${esc(reminder)}</pre>
      <div class="pa-toolbar">${armed ? '<span class="pa-hint">已安排：下一次生成时提醒一次</span><button class="pa-link" data-r="unremind">取消</button>' : '<button class="pa-btn" data-r="remind">下一轮提醒一次</button>'}</div></div>`;
  };
  // 前面的回复也多包了一层、写错了名：列出来，一并修正
  const earlierCard = () => {
    if (!earlier?.length) return "";
    const kinds = [...new Set(earlier.flatMap((x) => x.pairs))];
    return `<div class="pa-card" data-r="earlier-card"><p class="pa-p">前面还有 ${earlier.length} 条回复有同样的问题（${esc(kinds.slice(0, 2).join("、"))}${kinds.length > 2 ? " 等" : ""}）。模型会照着前面的回复写，建议一并修正。</p>
      <div class="pa-toolbar"><button class="pa-btn" data-r="fix-earlier">一并修正</button></div></div>`;
  };
  // 2.6.16 标签出处：多包的、写错名的、缺了的、这张卡不用的标签，写在预设、世界书等哪里，聊天里有几条
  const originCard = (origins) => {
    if (!origins.length) return "";
    const row = (o) => {
      const parts = [];
      if (o.from.length) parts.push(o.from.slice(0, 6).join("、") + (o.from.length > 6 ? ` 等 ${o.from.length} 处` : ""));
      const said = [o.ai && `前面 ${o.ai} 条 AI 回复`, o.mine && `你的 ${o.mine} 条消息`].filter(Boolean);
      if (said.length) parts.push(`聊天里${said.join("、")}`);
      return `<li><b>${esc(`<${o.name}>`)}</b>：${esc(parts.length ? parts.join("；") : "预设、角色卡、世界书、正则和聊天记录里都没有")}</li>`;
    };
    return `<div class="pa-card" data-r="origins"><div class="pa-whyrow"><b>标签出处</b>${whyBtn("origins")}</div>${whyNote("origins", "模型照着提示词和聊天记录写。要它不再写某个标签，须删掉或改正下列各处的这个标签。写成「不要用 &lt;某标签&gt;」，模型同样会记住它。")}
      <ul class="pa-notes">${origins.map(row).join("")}</ul></div>`;
  };
  // 2.6.14 检查要先读世界书等（异步）：进行中标 aria-busy，读屏和测试都等它结束
  const check = async (mode) => {
    result.setAttribute("aria-busy", "true");
    try { await checkNow(mode); } finally { result.removeAttribute("aria-busy"); }
  };
  const checkNow = async (mode) => {
    const base = read();
    let text = body.querySelector('[data-r="sample"]').value, source = "粘贴的文字", reasoning = "", latest = null;
    if (mode === "latest") {
      latest = latestReplyForCheck(ctx().chat);
      if (!latest) { result.innerHTML = '<p class="pa-hint">没有可检查的 AI 回复（不检查开场白、用户和系统消息）。</p>'; pending = null; earlier = null; return; }
      text = latest.message.mes;
      reasoning = latest.message.extra?.reasoning || "";
      source = `聊天第 ${latest.index + 1} 条消息`;
    }
    const chat = ctx().chat;
    const at = latest ? latest.index : Array.isArray(chat) ? chat.length : 0;
    // 2.6.17 这张卡的状态栏标签当作必需标签一起查
    const cardStatus = await showStatus();
    const config = statusRules(base, cardStatus);
    const force = cardStatus.tag || null;
    let { report, extra } = await replyCheckChat(text, config, { chat, index: at, reasoning, name, force });
    // 2.6.18 状态栏按字段再查一遍：另写了一份、写成别的名字、缺外层或结尾
    const checkRules = normalizeReplyRules(config);
    const kids = force ? statusChildren(force, checkRules, await replyWorldTexts(), name) : null;
    const statusFix = force ? statusCheck(report, text, force, kids, checkRules) : null;
    const reminder = [buildReplyReminder(report, config), force ? statusReminder(report, force) : ""].filter(Boolean).join("\n");
    const plan = report.issues.length ? statusPlan(text, checkRules, extra, statusFix, true) : null;
    pending = plan && latest ? { index: latest.index, plan, snapshot: replyMessageSnapshot(latest.index) } : null;
    const rules = normalizeReplyRules(config);
    // 前面的回复按这张卡要的必需标签查（预设、角色卡、世界书、开场白都没要求的不算）
    const scanEarlier = () => replyEarlierRepairs(chat, latest.index, replyCardRules(rules, extra.isApplicable), extra.knownTags, force ? statusEarlierFix(force, kids, rules) : null);
    earlier = latest ? await scanEarlier() : null;
    // 前面的回复要用已知标签、世界书却还没读：读完再查一遍（只查筛出来的那几条）
    if (latest && extra.needWorld()) {
      extra = { ...replyCheckExtras(chat, at, rules, name, await replyWorldTexts(), force), reasoning };
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
    const origins = asks.size ? replyTagOrigins([...asks].map(([key, label]) => ({ key, name: label })), extra.knownTags, chat, at)
      .filter((o) => !skippedKeys.has(o.key) || o.from.length || o.ai || o.mine) : [];
    const left = plan ? plan.after.issues : [];
    const fix = plan ? `<div class="pa-card"><div class="pa-whyrow"><b>可修正的标签</b>${whyBtn("fixhow")}</div>${whyNote("fixhow", "只移动文字、补写或去掉标签，不增删文字。")}<ul class="pa-notes">${plan.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${left.length ? `<p class="pa-warn">修正后仍有 ${left.length} 个问题需人工处理：${esc(left.map((i) => i.text).join("；"))}</p>` : ""}
      <details><summary>修正后原文预览</summary><pre class="pa-pre">${esc(plan.text)}</pre></details>
      ${pending ? '<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" data-r="fix">修正这条回复</button></div>' : '<p class="pa-hint">粘贴的文字不写回聊天，可复制上面的预览。</p>'}</div>` : "";
    const auto = latest && replyAutoFixFor(latest.index);
    const note = (auto ? `<div class="pa-card"><p class="pa-p">这条回复已自动修正：${esc(auto.steps.join("；"))}。<button class="pa-link" data-r="undo-auto">撤销</button></p></div>` : "") + (latest ? nativeReasoningNote(latest.message) : "");
    const skipped = report.skipped.length ? `<p class="pa-hint">这张卡没有用到 ${esc(report.skipped.map((t) => `<${t}>`).join("、"))}：预设条目、角色卡、世界书和开场白里都没有，未检查。</p>` : "";
    // 自动修正过的回复，提醒按修正前的问题写
    const remindText = auto ? buildReplyReminder(auto.report, config) : reminder;
    const remind = remindText && latest ? remindCard(remindText) : remindText ? `<details class="pa-card"><summary>下一轮提醒预览</summary><pre class="pa-pre">${esc(remindText)}</pre></details>` : "";
    result.innerHTML = note + `<div class="pa-whyrow"><p class="pa-p">${esc(source)}：${report.issues.length ? `发现 ${report.issues.length} 个格式风险` : "未发现配置范围内的格式问题"}</p>${report.issues.length ? "" : whyBtn("clean")}</div>${skipped}${report.issues.length ? `<ul class="pa-notes">${report.issues.map((i) => `<li>${esc(i.text)}${i.excerpt ? `<pre class="pa-pre">${esc(i.excerpt)}${i.excerpt.length >= 80 ? "…" : ""}</pre>` : ""}</li>`).join("")}</ul>${fix}` : whyNote("clean", "这不代表正文语义、所有变量或其他输出格式已验证。")}${originCard(origins)}${remind}${earlierCard()}`;
  };
  body.addEventListener("click", async (e) => {
    const button = e.target.closest('[data-r="latest"], [data-r="paste"], [data-r="fix"], [data-r="undo-fix"], [data-r="undo-auto"], [data-r="remind"], [data-r="unremind"], [data-r="fix-earlier"], [data-r="undo-earlier"]');
    if (!button) return;
    try {
      const r = button.dataset.r;
      // 2.6.12 只重画提醒卡片，不重新检查
      if (r === "remind" || r === "unremind") {
        const card = button.closest('[data-r="remind-card"]');
        const text = card.querySelector("pre").textContent;
        armReplyReminder(r === "remind" ? text : null);
        card.outerHTML = remindCard(text);
        result.querySelector(r === "remind" ? '[data-r="unremind"]' : '[data-r="remind"]')?.focus({ preventScroll: true });
        return;
      }
      if (r === "fix-earlier") {
        if (!earlier?.length) return;
        button.disabled = true;
        earlierUndo = await unwrapEarlierReplies(earlier);
        await check("latest");
        result.insertAdjacentHTML("afterbegin", `<p class="pa-p">已修正前面 ${earlierUndo.items.length} 条回复的标签。<button class="pa-link" data-r="undo-earlier">撤销</button></p>`);
        return;
      }
      if (r === "undo-earlier") {
        if (!earlierUndo) return;
        const n = await undoEarlierReplies(earlierUndo);
        earlierUndo = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", `<p class="pa-p">已撤销 ${n} 条回复的修改。</p>`);
        return;
      }
      if (r === "fix") {
        if (!pending) return;
        button.disabled = true;
        undo = await applyReplyFix(pending.index, pending.plan, pending.snapshot);
        await check("latest");
        result.insertAdjacentHTML("afterbegin", `<p class="pa-p">已修正聊天第 ${undo.index + 1} 条消息的标签。<button class="pa-link" data-r="undo-fix">撤销</button></p>`);
        return;
      }
      if (r === "undo-auto") {
        if (!replyAutoFixed) return;
        await undoReplyFix(replyAutoFixed.undo);
        replyAutoFixed = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已撤销自动修正。</p>');
        return;
      }
      if (r === "undo-fix") {
        if (!undo) return;
        await undoReplyFix(undo);
        undo = null;
        await check("latest");
        result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已撤销修正。</p>');
        return;
      }
      await check(r);
    } catch (e) { showError(e); }
  });
  const semanticResult = body.querySelector('[data-r="semantic-result"]');
  const showSemantic = (report) => {
    semanticResult.innerHTML = `<p class="pa-p">${report.verdict === "suspected" ? "模型标记了疑似内部分析，请人工确认" : "模型未标记疑似内部分析"}（模型自报置信度 ${Math.round(report.confidence * 100)}%，不是准确率）</p>${report.findings.map((f) => `<div class="pa-card"><pre class="pa-pre">${esc(f.excerpt)}</pre><p>${esc(f.reason)}</p></div>`).join("")}<p class="pa-hint">未改写聊天；未发现问题也不保证没有语义泄露。</p>`;
  };
  body.addEventListener("click", async (e) => {
    if (e.target.closest('[data-r="ai-cancel"]')) { reviewCancel?.abort(); return; }
    if (e.target.closest('[data-r="ai-result"]')) {
      const report = semanticReviewResults.get(semanticReplyIdentity());
      if (report) showSemantic(report);
      else semanticResult.innerHTML = '<p class="pa-hint">最近回复暂无有效审查结果，可手动审查或按预设开启自动审查。</p>';
      return;
    }
    const button = e.target.closest('[data-r="ai-latest"], [data-r="ai-paste"]');
    if (!button || reviewCancel) return;
    let text = body.querySelector('[data-r="sample"]').value, identity = null;
    if (button.dataset.r === "ai-latest") {
      const latest = latestReplyForCheck(ctx().chat);
      if (!latest) { semanticResult.innerHTML = '<p class="pa-hint">没有可审查的最近 AI 回复。</p>'; return; }
      text = latest.message.mes; identity = semanticReplyIdentity(latest);
    }
    reviewCancel = new AbortController();
    const buttons = [...body.querySelectorAll('[data-r="ai-latest"], [data-r="ai-paste"]')];
    buttons.forEach((b) => b.disabled = true);
    body.querySelector('[data-r="ai-cancel"]').hidden = false;
    semanticResult.innerHTML = '<p class="pa-hint">正在请求当前模型审查…</p>';
    try { showSemantic(await reviewReplySemantics(text, { signal: reviewCancel.signal, identity, rules: read() })); }
    catch (error) { showError(error, semanticResult); }
    finally {
      reviewCancel = null; buttons.forEach((b) => b.disabled = !semanticAvailable);
      body.querySelector('[data-r="ai-cancel"]').hidden = true;
    }
  });
  const value = await sheet({ title: "正文格式检查", body, wide: true, noFocus: true, onMount: (wrap) => {
    wrap.addEventListener("pa-closed", () => reviewCancel?.abort());
    if (!autoCheck) showStatus().catch((e) => { statusBox.innerHTML = `<p class="pa-warn">读取状态栏失败：${esc(e.message)}</p>`; });
    if (autoCheck) check("latest").then(() => result.scrollIntoView({ block: "start" })).catch((e) => showError(e));
  }, actions: [
    { label: "取消", value: null },
    { label: "保存设置", kind: "primary", validate: () => { try { read(); return true; } catch (e) { showError(e); return false; } }, value: read }
  ] });
  if (!value) return;
  settings().replyGuard = { ...settings().replyGuard, [name]: value };
  saveSettings();
  clearReplyGuard();
  const on = [value.notice !== false && "提示你", value.autoFix && "自动修正这条回复"].filter(Boolean);
  toast(on.length ? `已保存：生成后发现正文格式问题时${on.join("，并")}` : "已保存正文格式检查设置，生成后不提示、不自动修正", "success");
}
