// 「预设 → 思维链」：思维链读取了哪些变量、开启的条目与思维链的关联、接入思维链、手动指定思维链。
// 变量读取的问题（待核对）在「变量」视图。
var COT_LEVEL = {
  var: ["ok", "变量读到"],
  chain: ["ok", "间接读到"],
  mention: ["accent", "文字提及"],
  none: ["muted", "未提及"]
};
const cotManualFor = (name) => {
  const s = settings();
  if (!s.cotManual[name]) s.cotManual[name] = {};
  return s.cotManual[name];
};
function mountCotView(box, { tools, goEntries, goVars }) {
  const st = { filter: "none" };
  box.innerHTML = '<div class="cw-body"><div class="cw-col cw-cot"></div></div>';
  const body = box.querySelector(".cw-cot");
  function render() {
    tools.innerHTML = String(btn("手动指定思维链", { act: "cot-markpick", size: "sm" }));
    let d;
    try {
      d = getDraft(focusPreset());
    } catch (e) {
      body.innerHTML = String(empty(e.message));
      return;
    }
    const a = analyze(d, cotManualFor(d.name));
    const nm = (id) => d.prompt(id)?.name || id;
    const dead = a.issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
    const counts = { var: 0, chain: 0, mention: 0, none: 0 };
    for (const c2 of a.coverage.values()) counts[c2.level]++;
    const cotVarReads = a.cot.reduce((n, c2) => n + c2.reads.length, 0);
    const okN = counts.var + counts.chain;
    const total = counts.var + counts.chain + counts.mention + counts.none;
    const style = !a.cotIds.length ? "" : cotVarReads >= 3 && okN >= counts.mention ? "以变量读取为主" : cotVarReads >= 3 ? "变量读取与文字提及并用" : "以文字提及为主，不读取变量";
    const legend = String(html`<ul class="cw-legend">
        <li>${pill("变量读到", "ok")}<span>思维链用 {{getvar}} 读取该条目写入的变量。</span></li>
        <li>${pill("文字提及", "accent")}<span>思维链写到该条目的名称或标签。</span></li>
        <li>${pill("未提及", "muted")}<span>思维链没有写到该条目。规则、破限、格式类条目无需接入。</span></li>
        <li>${pill("接入思维链", "line")}<span>按本预设原有写法加入读取或提及，可撤销。接入越多，思考越长。</span></li>
        <li>${pill("手动指定思维链", "line")}<span>思维链未被识别时手动指定；误判的，在该条下点「不是思维链」。</span></li></ul>`);
    const filters = [["none", "未提及", counts.none], ["mention", "文字提及", counts.mention], ["ok", "变量读到", okN], ["all", "全部", total]];
    let out = String(html`
      <div class="cw-verdict"><div class="cw-verdict-main">${a.cotIds.length ? html`<b>${a.cotIds.length} 条思维链</b><span>${style}</span>` : html`<b>未识别到开启的思维链</b><span>可点上方「手动指定思维链」</span>`}</div>${tipBtn()}</div>
      ${tipNote(legend)}
      ${dead.length ? html`<button type="button" class="cw-note cw-note-warn cw-note-btn" data-act="cot-govars">${iconHtml("warn")}<div><b>${dead.length} 项变量读取待核对</b><p class="cw-hint">在「变量」视图查看原因和修复方法</p></div>${iconHtml("chev")}</button>` : ""}
      ${a.openers.length > 1 ? html`<div class="cw-note cw-note-warn">${iconHtml("warn")}<div><b>同时开着 ${a.openers.length} 套思维链开头</b><p class="cw-hint">${a.openers.map((id) => `「${nm(id)}」`).join("")}均以思考标签开头，模型会连写多套思考，篇幅变长、易爆思维链。通常只开一套，以条目名称或作者说明为准。</p><div class="cw-card-acts">${btn("在条目视图查看", { act: "cot-goto", size: "sm", attrs: `data-ids="${esc(a.openers.join("|"))}"` })}</div></div></div>` : ""}
      <section class="cw-sec"><div class="cw-sec-h"><h3>思维链读取的变量</h3></div>
        ${a.cot.length ? html`<div class="cw-stack">${a.cot.map((c2) => html`<details class="cw-card cw-cotcard"><summary><b>${nm(c2.id)}</b><small>${c2.reads.length ? `读取 ${c2.reads.length} 个变量` : "不读取变量（文字提及）"}</small>${iconHtml("chev")}</summary>
            ${c2.reads.length ? html`<ul class="cw-reads">${c2.reads.map((r) => html`<li><code>${r.name}</code>${r.suppliers.length ? r.suppliers.map((s) => html`<span class="cw-sup">${nm(s)}</span>`) : html`<span class="cw-sup cw-dim">无开启的选项（为空）</span>`}</li>`)}</ul>` : ""}
            ${c2.mentions.length ? html`<p class="cw-hint">文中出现的标签和英文词：${c2.mentions.slice(0, 12).join("、")}</p>` : ""}
            <div class="cw-card-acts">${btn("不是思维链", { act: "cot-unmark", size: "sm", attrs: `data-id="${esc(c2.id)}"` })}</div></details>`)}</div>` : html`<p class="cw-hint">没有识别到思维链。</p>`}
      </section>
      <section class="cw-sec"><div class="cw-sec-h"><h3>开启条目与思维链的关联</h3></div>
        <p class="cw-hint">「未提及」不等于有问题。只需为文风、人设、玩法等重点条目接入思维链；接入越多，思考越长。</p>
        <div class="cw-stats cw-stats-filter" style="--n:4" role="tablist">${filters.map(([k, l, n]) => html`<button type="button" role="tab" data-filter="${k}" class="${st.filter === k ? "on" : ""}" aria-selected="${st.filter === k}"><b>${n}</b><span>${l}</span></button>`)}</div>
        <div class="cw-covlist"></div>
      </section>
      ${a.optional.length ? html`<section class="cw-sec">${fold(`思维链已预留、但没有开启选项的变量（${a.optional.length}）`, String(html`<ul class="cw-reads">${a.optional.map((o) => html`<li><code>${o.varName}</code>${o.ids.map((id) => html`<span class="cw-sup">${nm(id)}</span>`)}</li>`)}</ul>`))}</section>` : ""}`);
    body.innerHTML = out;
    // 关联列表：按分组列出
    const byGroup = new Map();
    for (const [id, c2] of a.coverage) {
      const ok = st.filter === "all" || (st.filter === "ok" ? c2.level === "var" || c2.level === "chain" : c2.level === st.filter);
      if (!ok) continue;
      const g = d.groupOf(id);
      const gname = g ? d.group(g)?.name : "未分组";
      if (!byGroup.has(gname)) byGroup.set(gname, []);
      byGroup.get(gname).push([id, c2]);
    }
    body.querySelector(".cw-covlist").innerHTML = byGroup.size ? String(html`${[...byGroup].map(([gname, rows]) => html`<div class="cw-covgroup"><h4>${gname}</h4>${rows.map(([id, c2]) => {
      const [tone, label] = COT_LEVEL[c2.level];
      const via = c2.level === "none" ? "" : `${c2.via} → ${nm(c2.cot)}`;
      return html`<div class="cw-cov">${pill(label, tone)}<span class="cw-cov-main"><span>${nm(id)}</span>${via ? html`<small>${via}</small>` : ""}</span>${c2.level === "none" ? btn("接入", { act: "cot-hook", size: "sm", kind: "quiet", attrs: `data-id="${esc(id)}"` }) : ""}</div>`;
    })}</div>`)}`) : String(html`<p class="cw-hint cw-pad">无</p>`);
  }
  box.parentElement.addEventListener("click", async (e) => {
    if (box.hidden) return;
    const b = e.target.closest("[data-act], [data-filter]");
    if (!b) return;
    const d = getDraft(focusPreset());
    if (b.dataset.filter) { st.filter = b.dataset.filter; return render(); }
    const a = b.dataset.act;
    if (a === "cot-govars") return goVars();
    if (a === "cot-goto") return goEntries(b.dataset.ids.split("|"));
    if (a === "cot-hook") {
      try { await hookExistingDialog(d, b.dataset.id); } catch (err) { toast("接入思维链失败：" + err.message, "error"); }
      return;
    }
    if (a === "cot-markpick") {
      const cot = new Set(analyze(d, cotManualFor(d.name)).cotIds);
      const items = d.order.filter((o) => o.enabled !== false && !cot.has(o.identifier) && !d.isMarker(o.identifier)).map((o) => ({ label: d.prompt(o.identifier)?.name || o.identifier, value: o.identifier }));
      const id = await pickName({ title: "选择思维链条目", items });
      if (!id) return;
      cotManualFor(d.name)[id] = true;
      saveSettings();
      return render();
    }
    if (a === "cot-unmark") {
      cotManualFor(d.name)[b.dataset.id] = false;
      saveSettings();
      return render();
    }
  });
  const off = onDraftChange((name, kind) => {
    if (kind !== "status" && name === focusPreset() && draftViewVisible(box)) render();
  });
  cleanups.push(off);
  return { render };
}
// 把一条未提及的条目接入思维链：文本问句 / 追加 addvar / 问句变量三种写法，可改变量名与问句
async function hookExistingDialog(d, id) {
  const p = d.prompt(id);
  if (!p) return;
  const gid = d.groupOf(id);
  const plan0 = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id });
  if (plan0.status !== "hook") {
    await dialog({ size: "sm", title: p.name, body: html`<p class="cw-p">${plan0.text}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const initId = findInitEntry(d);
  const cotName = d.prompt(plan0.cotId)?.name || "";
  let how;
  if (plan0.mode === "text") how = html`<label class="cw-field"><span>在「${cotName}」中添加一行</span><input class="cw-input" data-h="q" value="${plan0.question}"></label>
      <p class="cw-hint">${plan0.needle ? `添加在提到 ${plan0.needle} 的一行之后` : "添加在思维链末尾"}。条目正文不变。</p>`;
  else if (plan0.mode === "append") how = html`<label class="cw-field"><span>追加的内容</span><input class="cw-input" data-h="q" value="${plan0.question}"></label>
      <p class="cw-hint">「${p.name}」末尾添加 {{addvar::${plan0.varName}::内容}}。思维链已读取该变量，不改动。</p>`;
  else how = html`<div class="cw-form-row"><label class="cw-field"><span>问句变量</span><input class="cw-input" data-h="v" value="${plan0.varName}"></label>
      <label class="cw-field"><span>思维链中的问句</span><input class="cw-input" data-h="q" value="${plan0.question}"></label></div>
      <p class="cw-hint">「${p.name}」末尾添加 {{setvar::变量::问句}}；${initId ? `「${d.prompt(initId)?.name}」中添加一行清空` : "未找到初始化条目，不添加清空"}；「${cotName}」中${plan0.anchorVar ? `在 {{getvar::${plan0.anchorVar}}} 之后` : ""}添加一行读取。${plan0.removeRange ? "沿用条目里原有的问句。" : ""}</p>`;
  const body = el(html`<div class="cw-form"><p class="cw-p">${plan0.text}。</p>${(plan0.warns || []).map((w) => html`<p class="cw-warn-text">${w}</p>`)}${how}</div>`);
  const ok = await dialog({ title: `将「${p.name}」接入思维链`, body, actions: [{ label: "取消", value: null }, { label: "接入", kind: "primary", value: (w) => ({ v: (w.querySelector("[data-h=v]")?.value || "").replace(/[{}:：\s]/g, ""), q: (w.querySelector("[data-h=q]")?.value || "").trim() }) }] });
  if (!ok) return;
  const plan = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id }, { varName: ok.v && ok.v !== plan0.varName ? ok.v : void 0, question: ok.q || void 0 });
  if (plan.status !== "hook") return toast(plan.text);
  if (plan.clash) return toast(`变量「${plan.varName}」在预设中已有其他用途，请更换名称`, "warning");
  mutate(d, `接入思维链：${p.name}`, (x) => {
    const q = x.prompt(id);
    q.content = contentWithHook(q.content, plan);
    applyHook(x, plan);
  });
  toast(`已接入「${d.prompt(plan.cotId)?.name}」`, "success");
}
