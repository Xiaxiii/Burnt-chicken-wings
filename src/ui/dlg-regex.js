// 缝合预设正则：逐条选择，处理同名或同 ID 冲突，预览新增、替换、跳过和最终顺序。查找表达式和替换内容始终作为文本展示
async function presetRegexDialog(sourceDraft, targetDraft, options = {}) {
  let sourceRules;
  try { sourceRules = presetRegexList(sourceDraft); }
  catch (error) { toast("无法预览预设正则：" + error.message, "error"); return false; }
  if (!sourceRules.length) {
    toast("这个来源预设没有随预设保存的正则");
    return false;
  }
  const sourceSig = presetRegexRulesSnapshot(sourceDraft);
  const targetSig = presetRegexRulesSnapshot(targetDraft);
  const targetGroupSig = presetRegexGroupSnapshot(targetDraft);
  const sourceManaged = drafts.get(sourceDraft.name) === sourceDraft;
  const targetManaged = drafts.get(targetDraft.name) === targetDraft;
  const targetFocus = focusPreset();
  const selected = new Set();
  const choices = new Map();
  const names = sourceRules.map((rule) => presetRegexRuleName(rule));
  const searchText = sourceRules.map((rule, i) => `${names[i]}\n${typeof rule?.id === "string" ? rule.id : ""}\n${typeof rule?.findRegex === "string" ? rule.findRegex : ""}`.toLowerCase());
  sourceRules.forEach((rule, i) => { if (rule?.markdownOnly && !rule?.promptOnly) selected.add(i); });
  // 从缝合预览跳过来时，只预选缝来的格式条目需要的那几条
  if (Array.isArray(options.preselect) && options.preselect.length) {
    selected.clear();
    options.preselect.filter((i) => Number.isInteger(i) && sourceRules[i]).forEach((i) => selected.add(i));
  }
  let plan = null, basePlan = null, planError = "", query = "", stale = false, wrap = null;
  let groupName = sourceDraft.name;
  const activationText = () => {
    const state = presetRegexActivationInfo(targetDraft.name);
    if (state.extensionDisabled) return `正则功能已全局停用，当前不会生效。请在酒馆开启正则功能${state.allowed ? "" : "，再到「正则」面板允许目标预设"}；此处保留现有启用状态。`;
    if (!state.allowed) return "目标预设尚未允许使用内置正则。缝入后请到酒馆「正则」面板允许该预设，才能生效；此处保留现有启用状态。";
    return `目标预设已允许使用内置正则，保留现有启用状态。${state.current ? "保存后" : "切换到该预设后"}，由酒馆按各条规则的开关和作用范围处理。`;
  };
  const body = el(html`<div class="cw-form cw-regex">
    <div class="cw-card">
      <div class="cw-card-h"><b>从「${sourceDraft.name}」缝入「${targetDraft.name}」</b><span class="cw-gap"></span>${tipBtn()}</div>
      ${tipNote(`<p>默认只选仅用于显示美化的正则，保留每条规则原来的开关、作用位置和其他设置。新规则按来源顺序放到目标末尾；明确替换的规则保留目标位置。</p><p>分组保存在目标预设中，由柏宝箱的正则分组面板显示；酒馆原生正则面板仍按平铺列表显示。</p><p>状态栏仍需配套提示词或世界书输出相应的标签和格式，正则才能匹配并显示美化。搬运正则后，请同时核对这些配套内容。</p>`)}
      <label class="cw-field"><span>缝入分组（同名组继续使用）</span><input class="cw-input" data-rx-group-name type="text" value="${groupName}" aria-label="缝入正则的分组名称"></label>
      <p class="cw-hint" data-rx-activation>${activationText()}</p>
      <p class="cw-warn-text" data-rx-stale hidden>来源或目标已变化，请关闭后重新预览。</p></div>
    <div class="cw-rx-tools"><label class="cw-search">${iconHtml("search")}<input data-rx-search type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" placeholder="搜索名称、ID 或查找表达式" aria-label="搜索来源正则"></label>
      <span class="cw-rx-picks">${btn("仅选显示美化", { size: "sm", attrs: 'data-rx-pick="display"' })}${btn("全选", { size: "sm", attrs: 'data-rx-pick="all"' })}${btn("清空", { size: "sm", attrs: 'data-rx-pick="none"' })}<span class="cw-dim" data-rx-count aria-live="polite"></span></span></div>
    <div data-rx-source></div>
    <div class="cw-card" data-rx-plan aria-live="polite"></div>
    <details class="cw-fold" data-rx-order><summary>${iconHtml("chev")}<span>缝合后的正则顺序 <span data-rx-order-count></span></span></summary><div class="cw-fold-body"><ol class="cw-orderlist" data-rx-final-order></ol></div></details>
  </div>`);
  const staleReason = () => {
    try {
      if (sourceManaged && drafts.get(sourceDraft.name) !== sourceDraft) return true;
      if (targetManaged && drafts.get(targetDraft.name) !== targetDraft) return true;
      if (focusPreset() !== targetFocus) return true;
      return sourceSig !== presetRegexRulesSnapshot(sourceDraft) || targetSig !== presetRegexRulesSnapshot(targetDraft) || targetGroupSig !== presetRegexGroupSnapshot(targetDraft);
    } catch {
      return true;
    }
  };
  const confirmBtn = () => wrap?.querySelector(".cw-dlg-foot .cw-btn-primary");
  const markStale = () => {
    stale = true;
    body.querySelector("[data-rx-stale]").hidden = false;
    if (confirmBtn()) confirmBtn().disabled = true;
  };
  const makePlan = (indices) => planPresetRegexTransfer(sourceDraft, targetDraft, { selectedIndices: indices, conflictChoices: Object.fromEntries(choices), groupName });
  try {
    basePlan = makePlan(sourceRules.map((_, i) => i));
  } catch (error) {
    toast("无法预览预设正则：" + error.message, "error");
    return false;
  }
  const rowInfo = (index) => basePlan.rows.find((row) => row.sourceIndex === index);
  const placeName = (v) => ({ 0: "旧版显示", 1: "用户输入", 2: "AI 输出", 3: "快捷命令", 5: "世界书", 6: "推理" }[v] || `位置 ${v}`);
  const ruleMarkup = (rule, i) => {
    const info = rowInfo(i);
    const disabled = !rule || typeof rule !== "object" || Array.isArray(rule) || info?.invalid;
    const conflicts = info?.conflicts || [];
    return html`<article class="cw-card cw-rx-rule" data-rx-index="${i}">
      <label class="cw-check"><input type="checkbox" data-rx-select="${i}"${selected.has(i) ? raw(" checked") : ""}${disabled ? raw(" disabled") : ""}><span><b>${names[i]}</b><small>${presetRegexRuleScope(rule)} · 来源${rule?.disabled ? "关闭" : "开启"}${Array.isArray(rule?.placement) ? ` · 作用位置 ${rule.placement.filter(Number.isInteger).map(placeName).join("、")}` : ""}</small></span></label>
      ${info?.duplicate ? html`<p class="cw-hint">目标已有相同规则，将自动跳过。</p>` : ""}
      ${disabled ? html`<p class="cw-warn-text">规则数据不完整，不能搬运。</p>` : ""}
      ${conflicts.length && !info?.duplicate ? html`<div class="cw-form-row"><label class="cw-field"><span>冲突处理</span><select class="cw-select" data-rx-conflict="${i}" aria-label="${names[i]}的冲突处理"><option value="keep">保留两份</option><option value="skip">跳过来源规则</option><option value="replace">替换目标规则</option></select></label>
        ${conflicts.length > 1 ? html`<label class="cw-field" data-rx-replace-row="${i}" hidden><span>替换哪条</span><select class="cw-select" data-rx-replace="${i}" aria-label="${names[i]}要替换的目标"><option value="">请选择目标规则</option>${conflicts.map((r) => html`<option value="${r.index}">第 ${r.index + 1} 条：${presetRegexRuleName({ scriptName: r.name })}</option>`)}</select></label>` : ""}</div>
        <small class="cw-warn-text">与目标中的 ${conflicts.map((r) => `第 ${r.index + 1} 条「${presetRegexRuleName({ scriptName: r.name })}」`).join("、")} 同名或同 ID，但内容不同。</small>` : ""}
      <details class="cw-fold" data-rx-details="${i}"><summary>${iconHtml("chev")}<span>查看查找与替换内容</span></summary><div class="cw-fold-body" data-rx-code></div></details>
    </article>`;
  };
  const displayIndices = sourceRules.map((rule, i) => rule?.markdownOnly && !rule?.promptOnly ? i : -1).filter((i) => i >= 0);
  const otherIndices = sourceRules.map((_, i) => i).filter((i) => !displayIndices.includes(i));
  body.querySelector("[data-rx-source]").innerHTML = String(html`
    <section data-rx-section="display"><h4>显示美化（${displayIndices.length}）</h4><div class="cw-stack">${displayIndices.length ? displayIndices.map((i) => ruleMarkup(sourceRules[i], i)) : html`<p class="cw-hint">来源没有仅显示美化的规则，可在下面手动选择。</p>`}</div></section>
    ${otherIndices.length ? html`<section data-rx-section="other"><h4>其他规则（${otherIndices.length}）</h4><p class="cw-hint">这些规则也可能改变发送给模型的内容，请核对后选择。</p><div class="cw-stack">${otherIndices.map((i) => ruleMarkup(sourceRules[i], i))}</div></section>` : ""}`);
  body.querySelectorAll("[data-rx-select]:disabled").forEach((input) => {
    selected.delete(Number(input.dataset.rxSelect));
    input.checked = false;
  });
  const paintOrder = () => {
    const order = body.querySelector("[data-rx-order]");
    const list = body.querySelector("[data-rx-final-order]");
    if (!order.open) { list.replaceChildren(); return; }
    list.innerHTML = String(html`${(plan?.rules || []).map((rule) => html`<li><b>${presetRegexRuleName(rule)}</b><small>${rule?.disabled ? "关闭" : "开启"} · ${presetRegexRuleScope(rule)}</small></li>`)}`);
  };
  const refreshPlan = () => {
    if (staleReason()) markStale();
    planError = "";
    try { plan = makePlan([...selected]); }
    catch (error) { plan = null; planError = error.message; }
    body.querySelector("[data-rx-count]").textContent = `已选 ${selected.size} / ${sourceRules.length}`;
    const stats = plan?.stats;
    body.querySelector("[data-rx-plan]").innerHTML = String(planError ? html`<p class="cw-warn-text">${planError}</p>` : html`<b>本次预览</b><p>新增 ${stats.added} 条 · 替换 ${stats.replaced} 条 · 跳过 ${stats.skipped} 条</p><p data-rx-group-preview>${plan.group ? `${plan.group.reused ? "加入已有分组" : "新建分组"}「${plan.group.name}」：${plan.group.memberIds.length} 条` : "没有可缝入的正则，不创建分组"}</p><small class="cw-dim">目标原有顺序保留，新规则按来源顺序追加；不会更改提示词条目或全局正则。</small>`);
    body.querySelector("[data-rx-order-count]").textContent = `（${plan?.rules?.length || 0} 条）`;
    if (confirmBtn()) confirmBtn().disabled = stale || !plan || !(stats.added || stats.replaced);
    paintOrder();
  };
  onSearchInput(body.querySelector("[data-rx-search]"), (value) => {
    query = value.trim().toLowerCase();
    body.querySelectorAll("[data-rx-index]").forEach((row) => { row.hidden = !searchText[Number(row.dataset.rxIndex)].includes(query); });
  }, 80);
  body.querySelector("[data-rx-group-name]").addEventListener("input", (event) => {
    groupName = event.target.value.trim();
    refreshPlan();
  });
  body.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-rx-pick]")?.dataset.rxPick;
    if (!pick) return;
    selected.clear();
    if (pick === "display") displayIndices.forEach((i) => selected.add(i));
    if (pick === "all") sourceRules.forEach((_, i) => selected.add(i));
    body.querySelectorAll("[data-rx-select]").forEach((input) => {
      if (input.disabled) selected.delete(Number(input.dataset.rxSelect));
      input.checked = selected.has(Number(input.dataset.rxSelect));
    });
    refreshPlan();
  });
  body.addEventListener("change", (event) => {
    const sel = event.target.dataset.rxSelect;
    if (sel != null) {
      if (event.target.checked) selected.add(Number(sel));
      else selected.delete(Number(sel));
      refreshPlan();
    }
    const conflict = event.target.dataset.rxConflict;
    if (conflict != null) {
      const targetRow = body.querySelector(`[data-rx-replace-row="${conflict}"]`);
      if (targetRow) targetRow.hidden = event.target.value !== "replace";
      const targetValue = targetRow?.querySelector("select").value;
      choices.set(Number(conflict), event.target.value === "replace" && targetRow ? { action: "replace", ...(targetValue !== "" ? { targetIndex: Number(targetValue) } : {}) } : event.target.value);
      refreshPlan();
    }
    const replacement = event.target.dataset.rxReplace;
    if (replacement != null) {
      const targetValue = event.target.value;
      choices.set(Number(replacement), { action: "replace", ...(targetValue !== "" ? { targetIndex: Number(targetValue) } : {}) });
      refreshPlan();
    }
  });
  body.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details.matches("[data-rx-order]")) return paintOrder();
    if (!details.matches("[data-rx-details]") || !details.open || details.dataset.loaded) return;
    const rule = sourceRules[Number(details.dataset.rxDetails)];
    details.querySelector("[data-rx-code]").innerHTML = String(html`<p class="cw-hint">查找表达式</p><pre class="cw-pre">${typeof rule?.findRegex === "string" ? rule.findRegex : "（查找表达式格式无效）"}</pre><p class="cw-hint">替换文本 / HTML</p><pre class="cw-pre">${typeof rule?.replaceString === "string" ? rule.replaceString : "（替换文本格式无效）"}</pre>`);
    details.dataset.loaded = "1";
  }, true);
  refreshPlan();
  const accepted = await dialog({
    title: "缝合预设正则", body, size: "lg", noFocus: true,
    actions: [{ label: "取消", value: false }, {
      label: "确认缝合正则", kind: "primary", value: true,
      validate: () => {
        if (staleReason()) { markStale(); toast("来源或目标已变化，请重新预览", "error"); return false; }
        if (!plan || planError || !(plan.stats.added || plan.stats.replaced)) return false;
        try { validatePresetRegexTransfer(targetDraft, plan, sourceDraft); }
        catch (error) { markStale(); toast(error.message, "error"); return false; }
        return true;
      }
    }],
    onMount: (mounted) => {
      wrap = mounted;
      body.querySelector("[data-rx-activation]").textContent = activationText();
      options.onMount?.(mounted, body);
      if (confirmBtn()) confirmBtn().disabled = stale || !plan || !(plan.stats.added || plan.stats.replaced);
      const off = onDraftChange((name, kind) => {
        body.querySelector("[data-rx-activation]").textContent = activationText();
        if ((name === sourceDraft.name || name === targetDraft.name || kind === "focus") && staleReason()) markStale();
      });
      mounted.addEventListener("cw-closed", off, { once: true });
    }
  });
  if (!accepted) return false;
  if (staleReason()) { toast("来源或目标已变化，请重新预览", "error"); return false; }
  try {
    validatePresetRegexTransfer(targetDraft, plan, sourceDraft);
    mutate(targetDraft, "缝合预设正则", (draft) => applyPresetRegexTransfer(draft, plan, sourceDraft));
    toast(`已缝入分组「${plan.group.name}」：新增 ${plan.stats.added} 条，替换 ${plan.stats.replaced} 条，可撤销`, "success");
    try { await options.afterApply?.(targetDraft, plan, body); }
    catch (error) { toast("正则已缝合，酒馆列表刷新失败，请重新打开正则面板：" + error.message, "error"); }
    return true;
  } catch (error) {
    toast("未能缝合预设正则：" + error.message, "error");
    return false;
  }
}
