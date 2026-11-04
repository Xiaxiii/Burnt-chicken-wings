// 「预设 → 变量」：变量读取待核对（写入了却没人读）、批量修复、顺序风险、当前变量状态、生成前后变化。
function mountVarsView(box, { tools, goEntries }) {
  let snapshot = null;
  box.innerHTML = '<div class="cw-body"><div class="cw-col cw-vars"></div></div>';
  const body = box.querySelector(".cw-vars");
  function render() {
    let d;
    try {
      d = getDraft(focusPreset());
    } catch (e) {
      tools.innerHTML = "";
      body.innerHTML = String(empty(e.message));
      return;
    }
    const manual = cotManualFor(d.name);
    const a = analyze(d, manual);
    const nm = (id) => d.prompt(id)?.name || id;
    const dead = a.issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
    tools.innerHTML = String(btn("修复", { act: "vars-repairall", size: "sm", kind: dead.length ? "primary" : "", disabled: !dead.length, title: "补缺失的读取、整理多余的包裹" }));
    const cards = dead.map((i) => {
      const vn = i.varName.replace(/^全局:/, "");
      const similar = (i.similar || []).map((k) => k.replace(/^全局:/, ""));
      // 写入方是思维链本身，或变量名以 cot 结尾：内容是思考步骤，要由思维链读，不能补成普通读取
      const forCot = i.kind === "cotfrag" || i.ids.every((id) => a.cotIds.includes(id));
      // 读它的是另一套关着的思维链时，不提供「开启」：会同时开两套思维链
      const offCot = forCot ? (i.readersOff || []).filter((id) => isCotEntry(d, id, manual)) : [];
      const offIds = (i.readersOff || []).filter((id) => !offCot.includes(id));
      const off = (i.readersOff || []).map((id) => `「${nm(id)}」`).join("");
      const tag = similar.length ? "名字对不上" : off ? "读取它的条目关着" : forCot ? "思维链没读" : "没有条目读取";
      const why = similar.length
        ? `写入的是「${vn}」，读取的是「${similar.join("」「")}」。酒馆变量名区分大小写和空格，不一致即读不到。`
        : forCot
          ? `该条把思考步骤存入变量「${vn}」，需由思维链中的 {{getvar::${vn}}} 取出。${off ? `读取它的 ${off} 未开启。` : "当前思维链没有这一句，模型思考时看不到。"}${offCot.length ? "那是另一套思维链，开启会导致两套并行，应在当前思维链中加入读取。" : "点「加入思维链读取」补上；不需要的可忽略。"}`
          : off
            ? `内容存入变量「${vn}」，读取它的 ${off} 未开启，未进入提示词。开启前核对原用途。`
            : `内容存入变量「${vn}」，没有开启的条目读取，未进入提示词。由脚本、世界书或其他扩展读取的，以实际发送的提示词为准。`;
      const other = i.ids.filter((id) => ["var", "chain"].includes(a.coverage.get(id)?.level)).map((id) => `「${nm(id)}」经变量「${String(a.coverage.get(id).via).split(" → ")[0].replace(/^全局:/, "")}」已被思维链读到`);
      return html`<details class="cw-card cw-card-warn cw-dead"><summary><span class="cw-dead-main"><b>${i.ids.map((id) => nm(id)).join("、")}</b><small>变量「${vn}」</small></span>${pill(tag, "warn")}${iconHtml("chev")}</summary>
        <p class="cw-hint">${why}</p>${other.length ? html`<p class="cw-hint">${other.join("；")}，与本条不矛盾：本条指变量「${vn}」。</p>` : ""}
        <div class="cw-card-acts">
          ${similar.map((k) => btn(`改成「${k}」`, { act: "vars-rename", size: "sm", attrs: `data-from="${esc(i.varName)}" data-to="${esc((i.varName.startsWith("全局:") ? "全局:" : "") + k)}"` }))}
          ${offIds.length ? btn("开启读取它的条目", { act: "vars-enable", size: "sm", attrs: `data-ids="${esc(offIds.join("|"))}"` }) : ""}
          ${forCot ? btn("加入思维链读取", { act: "vars-cotread", size: "sm", kind: "primary", attrs: `data-key="${esc(i.varName)}"` }) : btn("查看修复方案", { act: "vars-repair", size: "sm", kind: "primary", attrs: `data-key="${esc(i.varName)}"` })}
          ${btn("在条目视图查看", { act: "vars-goto", size: "sm", kind: "quiet", attrs: `data-ids="${esc(i.ids.join("|"))}"` })}
        </div></details>`;
    });
    // 顺序检查：按预设列表推演先读后写、清空后读取、未读即覆盖
    const report = auditVariableFlow(d);
    let stateHtml = "";
    if (snapshot) {
      if (snapshot.key !== variableContextKey() || d.name !== currentPresetName()) stateHtml = String(html`<p class="cw-warn-text">已切换聊天或预设，请重新读取变量状态。</p>`);
      else {
        const keys = new Map(report.events.map((e) => [variableIdentity(e.scope, e.name), e]));
        for (const [key, row] of snapshot.rows) if (!keys.has(key)) keys.set(key, row);
        stateHtml = String(html`<p class="cw-hint">读取于 ${new Date(snapshot.at).toLocaleTimeString()}。快照是当前状态；先读后写可能有意读取上一轮的值，不能据此自动调整顺序。</p><div class="cw-kv">${[...keys].map(([key, e]) => {
          const row = snapshot.rows.get(key);
          const status = !snapshot.available[e.scope] ? "当前接口不可读取" : !row ? "当前不存在" : `${row.empty ? "空值" : "有值"} · ${row.type}${row.size == null ? "" : ` · ${row.size} 字符`}`;
          return html`<span>${e.scope === "global" ? "全局" : "聊天"} · ${e.name}</span><b>${status}</b>`;
        })}</div>${keys.size ? "" : html`<p class="cw-hint">没有可显示的变量。</p>`}`);
      }
    }
    const record = variableObservations.get(variableContextKey());
    body.innerHTML = String(html`
      <section class="cw-sec"><div class="cw-sec-h"><h3>变量读取</h3><span class="cw-gap"></span>${tipBtn()}</div>
        ${tipNote(`<p>识别 setvar、getvar、addvar、incvar、decvar、hasvar 及全局写法。「修复」只补缺失的读取、整理缝合留下的多余包裹；计数、条件、脚本、读写顺序及 MVU、酒馆助手等变量系统需人工核对。</p><p>思维链片段（变量名多以 cot 结尾）用「加入思维链读取」，可选思维链和插入行。</p>`)}
        ${dead.length ? html`<p class="cw-hint">${dead.length} 项写入了变量，却没有开启的条目读取。</p><div class="cw-stack">${cards}</div>` : html`<div class="cw-note cw-note-ok">${iconHtml("ok")}<div>没有发现写入后无人读取的变量。<p class="cw-hint">脚本、世界书和其他扩展的读取无法识别。</p></div></div>`}
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>读写顺序</h3><small>${report.issues.length} 项风险 · ${report.unknown.length} 条需运行时核对</small></div>
        <p class="cw-hint">按「${d.name}」的列表顺序检查先读后写、清空后读取和未读即覆盖。只做检查，不移动条目、不执行宏；酒馆可能重排提示词，脚本、条件、深度插入、对象/数组键和其他扩展变量需另行核对。</p>
        ${report.issues.length ? html`<div class="cw-stack">${report.issues.map((i) => html`<div class="cw-card"><b>${i.scope === "global" ? "全局" : "聊天"}变量「${i.name}」</b><p class="cw-hint">${i.text}</p><small class="cw-dim">${i.ids.map(nm).join(" → ")}</small></div>`)}</div>` : ""}
        ${report.unknown.length ? fold(`未推演的条目（${report.unknown.length}）`, String(html`<ul class="cw-bullets">${report.unknown.map((i) => html`<li>「${nm(i.id)}」：${i.reasons.join("；")}</li>`)}</ul>`)) : ""}
        ${fold(`可见变量操作顺序（${report.events.length}）`, String(html`<ol class="cw-list">${report.events.map((e) => html`<li>「${nm(e.id)}」：${e.op} · ${e.scope === "global" ? "全局" : "聊天"}变量「${e.name}」</li>`)}</ol>`))}
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>当前状态</h3><span class="cw-gap"></span>${btn("读取当前变量状态", { act: "vars-snapshot", size: "sm" })}</div>
        <p class="cw-hint">只显示变量名、是否为空及类型，不保存正文。只能读取酒馆正在用的预设。</p>
        ${raw(stateHtml)}
        <label class="cw-setrow"><span><b>记录生成前后变量变化</b><small>只保留在本页内存中，默认关闭；不是每一次宏调用的执行追踪</small></span>${switchHtml({ act: "vars-watch", on: !!settings().variableWatch, label: "记录生成前后变量变化" })}</label>
        ${record && d.name === currentPresetName() ? fold(`最近一次生成前后变化（${record.changes?.length || 0}，${record.phase}）`, String(html`<ul class="cw-bullets">${(record.changes || []).length ? record.changes.map((x) => html`<li>${x.scope === "global" ? "全局" : "聊天"}变量「${x.name}」：${x.kind}${x.empty === true ? "，当前为空" : ""}</li>`) : html`<li>未发现状态变化</li>`}</ul>`), { open: true }) : ""}
      </section>`);
  }
  box.parentElement.addEventListener("click", async (e) => {
    if (box.hidden) return;
    const b = e.target.closest("[data-act]");
    if (!b || !b.dataset.act.startsWith("vars-")) return;
    const d = getDraft(focusPreset());
    const manual = cotManualFor(d.name);
    const a = b.dataset.act;
    try {
      if (a === "vars-repairall") return await repairAllVariables(d, manual);
      if (a === "vars-repair") return await repairVariableDialog(d, b.dataset.key, manual);
      if (a === "vars-cotread") return await cotReadDialog(d, b.dataset.key, manual);
      if (a === "vars-rename") return await renameWritesDialog(d, b.dataset.from, b.dataset.to);
    } catch (err) {
      return toast(err.message, "error");
    }
    if (a === "vars-goto") return goEntries(b.dataset.ids.split("|"));
    if (a === "vars-enable") {
      const ids = b.dataset.ids.split("|");
      // 只开这几条，并去掉所在分组的「关」标记；不带动组里其他条目
      mutate(d, "开启读取条目", (x) => {
        x.setEnabled(ids, true);
        for (const id of ids) {
          const g = x.group(x.groupOf(id));
          if (g && g.enabled === false) {
            g.enabled = true;
            delete g.restoreOn;
          }
        }
      });
      return toast(`已开启 ${ids.length} 条`, "success");
    }
    if (a === "vars-snapshot") {
      if (d.name !== currentPresetName()) return toast("只能读取酒馆当前使用中预设的聊天变量，请先切换预设", "warning");
      snapshot = captureVariableSnapshot();
      return render();
    }
  });
  box.addEventListener("change", (e) => {
    if (!e.target.closest('[data-act="vars-watch"]')) return;
    settings().variableWatch = e.target.checked;
    if (!e.target.checked) { variableObservations.clear(); variableWatchPending = null; }
    saveSettings();
    render();
  });
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && name === focusPreset() && draftViewVisible(box)) render();
  });
  cleanups.push(off);
  return { render };
}
// 批量修复：整理缝合留下的多余包裹、为写入了却没人读的变量新增读取条目；先列出要改什么，确认后再改
async function repairAllVariables(d, manual = {}) {
  const version = JSON.stringify(d.toPreset());
  const work = new Draft(d.name, d.toPreset());
  const normalized = applyWrapperNormalization(work);
  const issues = analyze(work, manual).issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
  const keys = [...new Set(issues.map((i) => i.varName))];
  const plans = [], skipped = [];
  for (const key of keys) {
    try { plans.push(variableRepairPlan(work, key, manual)); }
    catch (e) { skipped.push({ key, reason: e.message }); }
  }
  if (!keys.length && !normalized.length) return toast("未发现可自动补读的变量；这不代表所有变量都正常");
  const byAnchor = new Map();
  for (const plan of plans) {
    if (!byAnchor.has(plan.last)) byAnchor.set(plan.last, []);
    byAnchor.get(plan.last).push(plan);
  }
  const nm = (id) => work.prompt(id)?.name || id;
  const can = plans.length || normalized.length;
  const body = html`<div class="cw-form">
    ${normalized.length ? html`<section><h4>整理外层包裹（${normalized.length}）</h4><ul class="cw-bullets">${normalized.map((x) => html`<li>「${nm(x.id)}」去掉没人读取的外层 {{setvar::${x.outer.name}}}，保留里面的写入</li>`)}</ul></section>` : ""}
    ${byAnchor.size ? html`<section><h4>新增读取条目（${byAnchor.size}）</h4><ul class="cw-bullets">${[...byAnchor].map(([last, list]) => html`<li>在「${nm(last)}」之后新增「变量读取 · ${list.map((p) => p.name).join("、")}」，正文：<code>${list.map((p) => p.macro).join(" ")}</code></li>`)}</ul></section>` : ""}
    ${skipped.length ? html`<section><h4>不自动修改，需人工核对（${skipped.length}）</h4>${skipped.map((x) => html`<div class="cw-card"><b>${x.key}</b><p class="cw-hint">${x.reason}</p></div>`)}</section>` : ""}
    <p class="cw-hint">仅补缺失的读取、整理可确认的多余包裹。计数、思维链片段、脚本/条件和执行顺序需人工核对。修改后可撤销。</p></div>`;
  const ok = await dialog({ title: "修复变量问题", body, size: "lg", noFocus: true, actions: can ? [{ label: "取消", value: false }, { label: "修改", kind: "primary", value: true }] : [{ label: "知道了", kind: "primary", value: false }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开修复方案", "warning");
  mutate(d, "修复变量问题", (x) => {
    applyWrapperNormalization(x);
    for (const [last, list] of byAnchor) {
      x.insertPrompts([{ prompt: {
        identifier: uid(), name: "变量读取 · " + list.map((p) => p.name).join("、"),
        content: list.map((p) => p.macro).join("\n"), role: "system",
        system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100
      }, enabled: true }], { after: last }, x.groupOf(last));
    }
  });
  toast(`已修改：整理包裹 ${normalized.length} 个，新增读取 ${byAnchor.size} 条`, "success");
}
// 思维链片段：选一条思维链和放在哪一行，预览后加入 {{getvar::片段}}
async function cotReadDialog(d, key, manual = {}) {
  const version = JSON.stringify(d.toPreset());
  let plan = cotReadPlan(d, key, null, null, manual);
  const name = (id) => d.prompt(id)?.name || id;
  const body = el(html`<div class="cw-form">
    <p class="cw-p">在思维链中加入一行 <code>${plan.macro}</code>，模型思考时即可读到这段步骤。可撤销。</p>
    <label class="cw-field"><span>加到哪条思维链</span><select class="cw-select" data-k="cot">${plan.choices.map((id) => html`<option value="${id}">${name(id)}</option>`)}</select></label>
    <label class="cw-field"><span>放在哪一行之后</span><select class="cw-select" data-k="line"></select></label>
    <p class="cw-hint">默认位置：最后一个片段读取之后；没有则放在结束标签或最后一个分步标题之前。</p>
    <div class="cw-field"><span>加入后的思维链</span><pre class="cw-pre" data-k="preview"></pre></div></div>`);
  const cotSel = body.querySelector("[data-k=cot]"), lineSel = body.querySelector("[data-k=line]");
  const fillLines = () => {
    const lines = String(d.prompt(plan.cotId)?.content || "").split("\n");
    lineSel.innerHTML = String(html`<option value="0">（最前面）</option>${lines.map((l, i) => html`<option value="${i + 1}">${i + 1}. ${l.trim().slice(0, 40) || "（空行）"}</option>`)}`);
    lineSel.value = String(plan.line);
  };
  const showPlan = () => { body.querySelector("[data-k=preview]").textContent = plan.content; };
  cotSel.value = plan.cotId;
  fillLines();
  showPlan();
  cotSel.addEventListener("change", () => { plan = cotReadPlan(d, key, cotSel.value, null, manual); fillLines(); showPlan(); });
  lineSel.addEventListener("change", () => { plan = cotReadPlan(d, key, cotSel.value, Number(lineSel.value), manual); showPlan(); });
  const ok = await dialog({ title: `加入思维链读取：${key.replace(/^全局:/, "")}`, body, size: "lg", actions: [{ label: "取消", value: false }, { label: "加入", kind: "primary", value: true }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开", "warning");
  mutate(d, `加入思维链读取：${plan.name}`, (x) => { x.prompt(plan.cotId).content = plan.content; });
  toast(`已在「${d.prompt(plan.cotId)?.name}」加入读取`, "success");
}
async function renameWritesDialog(d, from, to) {
  const plan = renameWritesPlan(d, from, to);
  const a = from.replace(/^全局:/, ""), b = to.replace(/^全局:/, "");
  const ok = await dialog({ size: "sm", title: "统一变量名", body: html`<p class="cw-p">将写入宏中的「${a}」改为读取用的「${b}」：</p><ul class="cw-bullets">${plan.edits.map((x) => html`<li>「${d.prompt(x.id)?.name || x.id}」${x.count} 处</li>`)}</ul><p class="cw-hint">只改 setvar、addvar、incvar、decvar 中的变量名，可撤销。</p>`, actions: [{ label: "取消", value: false }, { label: "改名", kind: "primary", value: true }] });
  if (!ok) return;
  const now = renameWritesPlan(d, from, to);
  mutate(d, `统一变量名：${b}`, (x) => { for (const e of now.edits) x.prompt(e.id).content = e.content; });
  toast(`已改名 ${now.edits.reduce((n, e) => n + e.count, 0)} 处`, "success");
}
// 单个变量的修复方案：先说明要加什么，确认后再加
async function repairVariableDialog(d, key, manual = {}) {
  let plan;
  try {
    plan = variableRepairPlan(d, key, manual);
  } catch (e) {
    await dialog({ size: "sm", title: "需人工核对", body: html`<p class="cw-p">${e.message}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const version = JSON.stringify(d.toPreset());
  const p = d.prompt(plan.last);
  const ok = await dialog({ title: "补充变量读取", body: html`<p class="cw-p">新增条目「变量读取 · ${plan.name}」，放在「${p.name}」之后（最后一个写入该变量的开启条目），角色为系统，正文：</p>
    <pre class="cw-pre">${plan.macro}</pre>
    <p class="cw-hint">思维链不改动。内容会进入上下文，模型是否采用需在实际发送的提示词中核对。</p>`, actions: [{ label: "取消", value: false }, { label: "添加", kind: "primary", value: true }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== version) return toast("预设已变化，请重新打开修复方案", "warning");
  variableRepairPlan(d, key, manual);
  mutate(d, "补充变量读取", (x) => x.insertPrompts([{
    prompt: { identifier: uid(), name: "变量读取 · " + plan.name, content: plan.macro, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 },
    enabled: true
  }], { after: plan.last }, d.groupOf(plan.last)));
  toast("已添加读取条目", "success");
}
