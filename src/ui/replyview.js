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
async function replyFormatDialog(name) {
  const saved = replyGuardConfig(name);
  const fresh = !saved.bodyTag;
  const guess = replyTagGuess(name);
  const bodyDefault = saved.bodyTag || guess?.bodyTag || "content";
  const available = replyGuardAvailable();
  const semanticAvailable = semanticReviewAvailable();
  let reviewCancel = null;
  const body = el(`<div class="pa-form">
    <p class="pa-hint">为「${esc(name)}」设置。标签名要与预设的输出格式一致；可先手动检查，开启后只在该预设使用中、有问题时向下一轮加入临时格式提醒。</p>
    <label class="pa-field"><span>正文标签名（不填尖括号）</span><input class="pa-input" data-r="body" value="${esc(bodyDefault)}" placeholder="例如 content 或 正文" maxlength="40"></label>
    ${fresh && guess ? guess.bodyTag ? `<p class="pa-hint">按预设识别：条目里有 ${guess.count} 处 &lt;${esc(guess.bodyTag)}&gt;，已填入。不对请改。</p>` : '<p class="pa-warn">预设开着的条目里没找到正文标签。如果预设不要求用标签包正文，不要开启下一轮提醒，否则会让 AI 输出预设没要求的标签。</p>' : ""}
    ${guess?.suggest.length ? `<p class="pa-hint">预设的显示正则靠 ${guess.suggest.map((t) => `&lt;${esc(t)}&gt;`).join("、")} 显示美化，想检查这些有没有掉，可填进下面的必需标签。</p>` : ""}
    <label class="pa-field"><span>额外必需标签（可选，逗号分隔）</span><input class="pa-input" data-r="required" value="${esc((saved.requiredTags || []).join("、"))}" placeholder="例如 状态栏、摘要"></label>
    <label class="pa-field"><span>自定义思考标签（可选，另已识别 think 和 thinking）</span><input class="pa-input" data-r="thinking" value="${esc(saved.thinkingTag || "")}" maxlength="40"></label>
    <label class="pa-field-row"><input type="checkbox" data-r="enabled" ${saved.enabled ? "checked" : ""} ${available ? "" : "disabled"}>发现问题时，下一轮提醒 AI</label>
    ${available ? "" : '<p class="pa-warn">当前酒馆缺少生成前事件或临时提示接口，手动检测可用，自动提醒不可用。</p>'}
    <p class="pa-hint">检测掉标签、重复/未闭合标签、正文裹进思考标签、正文夹入思考标签、正文标签外的大段文字（爆思维链）和部分疑似推理标题。代码块和注释中的标签示例不计。可见回复没有正文标签时，会在本地查看思考区里是否有正文标签，不展示、不发送思考内容。标签改名、补齐、移出思考区可一键修正，只动标签位置、不增删文字；掉出的正文无法补造。提醒不能保证模型遵守；续写时不自动提醒，以免重复标签。</p>
    <div class="pa-toolbar"><button class="pa-btn pa-btn-soft" data-r="latest">检查最近回复</button><button class="pa-btn pa-btn-soft" data-r="paste">检查下方文字</button></div>
    <label class="pa-field"><span>粘贴一条 AI 回复（只在本页检测，不保存）</span><textarea class="pa-input" data-r="sample" rows="5"></textarea></label>
    <div data-r="result" aria-live="polite"></div>
    <details class="pa-card"><summary>AI 语义审查（可选）</summary>
      <p class="pa-hint">使用酒馆当前聊天补全连接，发送这一条可见回复，检查疑似任务规划、自我指令等内部分析。每次会增加一次模型请求、耗时和费用；不主动附带完整聊天或变量值。审查会误判，只提供片段供你确认，不自动删改正文。</p>
      <label class="pa-field-row"><input type="checkbox" data-r="semantic" ${saved.semanticAfterReply ? "checked" : ""} ${semanticAvailable ? "" : "disabled"}>生成完成后自动语义审查（默认关闭）</label>
      ${semanticAvailable ? "" : '<p class="pa-warn">当前酒馆或连接不支持独立聊天补全请求，请升级酒馆并选择聊天补全连接。结构检查仍可使用。</p>'}
      <div class="pa-toolbar"><button class="pa-btn" data-r="ai-latest" ${semanticAvailable ? "" : "disabled"}>AI 审查最近回复</button><button class="pa-btn" data-r="ai-paste" ${semanticAvailable ? "" : "disabled"}>AI 审查粘贴文字</button><button class="pa-btn" data-r="ai-cancel" hidden>取消审查</button><button class="pa-link" data-r="ai-result">查看最近结果</button></div>
      <div data-r="semantic-result" aria-live="polite"></div>
    </details>
  </div>`);
  const read = () => {
    const thinkingTag = body.querySelector('[data-r="thinking"]').value.trim();
    const input = { bodyTag: body.querySelector('[data-r="body"]').value.trim(), requiredTags: body.querySelector('[data-r="required"]').value };
    if (thinkingTag) input.thinkingTag = thinkingTag;
    const rules = normalizeReplyRules(input);
    const value = { bodyTag: rules.bodyTag, requiredTags: rules.requiredTags, thinkingTag, enabled: available && body.querySelector('[data-r="enabled"]').checked };
    if (semanticAvailable && body.querySelector('[data-r="semantic"]').checked) value.semanticAfterReply = true;
    return value;
  };
  const result = body.querySelector('[data-r="result"]');
  let pending = null, undo = null;
  const check = (mode) => {
    const config = read();
    let text = body.querySelector('[data-r="sample"]').value, source = "粘贴的文字", reasoning = "", latest = null;
    if (mode === "latest") {
      latest = latestReplyForCheck(ctx().chat);
      if (!latest) { result.innerHTML = '<p class="pa-hint">没有可检查的 AI 回复（不检查开场白、用户和系统消息）。</p>'; pending = null; return; }
      text = latest.message.mes;
      reasoning = latest.message.extra?.reasoning || "";
      source = `聊天第 ${latest.index + 1} 条消息`;
    }
    const report = checkReplyFormat(text, config, { reasoning });
    const reminder = buildReplyReminder(report, config);
    const plan = report.issues.length ? planReplyFix(text, config, { reasoning }) : null;
    pending = plan && latest ? { index: latest.index, plan, snapshot: replyMessageSnapshot(latest.index) } : null;
    const left = plan ? plan.after.issues : [];
    const fix = plan ? `<div class="pa-card"><b>可修正的标签</b><ul class="pa-notes">${plan.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="pa-hint">${left.length ? `修正后仍有 ${left.length} 个问题需人工处理：${esc(left.map((i) => i.text).join("；"))}` : "修正后未发现配置范围内的格式问题。"}只移动或补写标签，不增删文字。</p>
      <details><summary>修正后原文预览</summary><pre class="pa-pre">${esc(plan.text)}</pre></details>
      ${pending ? '<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" data-r="fix">修正这条回复</button></div>' : '<p class="pa-hint">粘贴的文字不会写回聊天，可复制上面的预览。</p>'}</div>` : "";
    result.innerHTML = `<p class="pa-p">${esc(source)}：${report.issues.length ? `发现 ${report.issues.length} 个格式风险` : "未发现配置范围内的格式问题"}</p>${report.issues.length ? `<ul class="pa-notes">${report.issues.map((i) => `<li>${esc(i.text)}${i.excerpt ? `<pre class="pa-pre">${esc(i.excerpt)}${i.excerpt.length >= 80 ? "…" : ""}</pre>` : ""}</li>`).join("")}</ul>${fix}<details class="pa-card"><summary>下一轮提醒预览</summary><pre class="pa-pre">${esc(reminder)}</pre></details>` : '<p class="pa-hint">这不代表正文语义、所有变量或其他输出格式已验证。</p>'}`;
  };
  body.addEventListener("click", async (e) => {
    const button = e.target.closest('[data-r="latest"], [data-r="paste"], [data-r="fix"], [data-r="undo-fix"]');
    if (!button) return;
    try {
      if (button.dataset.r === "fix") {
        if (!pending) return;
        button.disabled = true;
        undo = await applyReplyFix(pending.index, pending.plan, pending.snapshot);
        check("latest");
        result.insertAdjacentHTML("afterbegin", `<p class="pa-p">已修正聊天第 ${undo.index + 1} 条消息的标签。<button class="pa-link" data-r="undo-fix">撤销</button></p>`);
        return;
      }
      if (button.dataset.r === "undo-fix") {
        if (!undo) return;
        await undoReplyFix(undo);
        undo = null;
        check("latest");
        result.insertAdjacentHTML("afterbegin", '<p class="pa-p">已撤销修正。</p>');
        return;
      }
      check(button.dataset.r);
    } catch (e) { result.innerHTML = `<p class="pa-warn">${esc(e.message)}</p>`; }
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
    catch (error) { semanticResult.innerHTML = `<p class="pa-warn">${esc(error.message)}</p>`; }
    finally {
      reviewCancel = null; buttons.forEach((b) => b.disabled = !semanticAvailable);
      body.querySelector('[data-r="ai-cancel"]').hidden = true;
    }
  });
  const value = await sheet({ title: "正文格式检查", body, wide: true, noFocus: true, onMount: (wrap) => wrap.addEventListener("pa-closed", () => reviewCancel?.abort()), actions: [
    { label: "取消", value: null },
    { label: "保存设置", kind: "primary", validate: () => { try { read(); return true; } catch (e) { result.innerHTML = `<p class="pa-warn">${esc(e.message)}</p>`; return false; } }, value: read }
  ] });
  if (!value) return;
  settings().replyGuard = { ...settings().replyGuard, [name]: value };
  saveSettings();
  clearReplyGuard();
  toast(value.enabled ? "已开启：发现正文格式问题时，下一轮提醒 AI" : "已保存正文格式检查设置，自动提醒未开启", "success");
}
