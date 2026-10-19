async function replyFormatDialog(name) {
  const saved = replyGuardConfig(name);
  const available = replyGuardAvailable();
  const semanticAvailable = semanticReviewAvailable();
  let reviewCancel = null;
  const body = el(`<div class="pa-form">
    <p class="pa-hint">为「${esc(name)}」设置。标签名要与预设的输出格式一致；可先手动检查，开启后只在该预设使用中、有问题时向下一轮加入临时格式提醒。</p>
    <label class="pa-field"><span>正文标签名（不填尖括号）</span><input class="pa-input" data-r="body" value="${esc(saved.bodyTag || "content")}" placeholder="例如 content 或 正文" maxlength="40"></label>
    <label class="pa-field"><span>额外必需标签（可选，逗号分隔）</span><input class="pa-input" data-r="required" value="${esc((saved.requiredTags || []).join("、"))}" placeholder="例如 状态栏、摘要"></label>
    <label class="pa-field"><span>自定义思考标签（可选，另已识别 think 和 thinking）</span><input class="pa-input" data-r="thinking" value="${esc(saved.thinkingTag || "")}" maxlength="40"></label>
    <label class="pa-field-row"><input type="checkbox" data-r="enabled" ${saved.enabled ? "checked" : ""} ${available ? "" : "disabled"}>发现问题时，下一轮提醒 AI</label>
    ${available ? "" : '<p class="pa-warn">当前酒馆缺少生成前事件或临时提示接口，手动检测可用，自动提醒不可用。</p>'}
    <p class="pa-hint">检测掉标签、重复/未闭合标签、正文裹进思考标签、正文夹入思考标签和部分疑似推理标题。代码块和注释中的标签示例不计。纯文字的思考泄露无法可靠识别，提醒也不能保证模型遵守；不会改写回复或补造正文。续写时不自动提醒，以免重复标签。模型单独返回的 reasoning 字段不参与检查。</p>
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
  body.addEventListener("click", (e) => {
    const button = e.target.closest('[data-r="latest"], [data-r="paste"]');
    if (!button) return;
    try {
      const config = read();
      let text = body.querySelector('[data-r="sample"]').value, source = "粘贴的文字";
      if (button.dataset.r === "latest") {
        const latest = latestReplyForCheck(ctx().chat);
        if (!latest) { result.innerHTML = '<p class="pa-hint">没有可检查的 AI 回复（不检查开场白、用户和系统消息）。</p>'; return; }
        text = latest.message.mes;
        source = `聊天第 ${latest.index + 1} 条消息`;
      }
      const report = checkReplyFormat(text, config);
      const reminder = buildReplyReminder(report, config);
      result.innerHTML = `<p class="pa-p">${esc(source)}：${report.issues.length ? `发现 ${report.issues.length} 个格式风险` : "未发现配置范围内的格式问题"}</p>${report.issues.length ? `<ul class="pa-notes">${report.issues.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul><details class="pa-card"><summary>下一轮提醒预览</summary><pre class="pa-pre">${esc(reminder)}</pre></details>` : '<p class="pa-hint">这不代表正文语义、所有变量或其他输出格式已验证。</p>'}`;
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
