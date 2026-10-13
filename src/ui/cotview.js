var LEVEL = {
  var: ["pa-lv-ok", "读到了"],
  chain: ["pa-lv-ok", "间接读到"],
  mention: ["pa-lv-maybe", "文字提到"],
  none: ["pa-lv-none", "没提到"]
};
async function repairAllVariables(d, manual = {}) {
  const work = new Draft(d.name, d.toPreset());
  const normalized = applyWrapperNormalization(work);
  const issues = analyze(work, manual).issues.filter(i => i.kind === 'dead' || i.kind === 'cotfrag');
  const keys = [...new Set(issues.map(i => i.varName))];
  const plans = [], skipped = [];
  for (const key of keys) {
    try { plans.push(variableRepairPlan(work, key)); }
    catch(e) { skipped.push({ key, reason:e.message }); }
  }
  if (!keys.length && !normalized.length) return toast('没有需要修复的变量引用或冗余包裹');
  if (plans.length || normalized.length) {
    const byAnchor = new Map();
    for (const plan of plans) {
      if (!byAnchor.has(plan.last)) byAnchor.set(plan.last, []);
      byAnchor.get(plan.last).push(plan);
    }
    mutate(d, '一键修复变量引用', x => {
      applyWrapperNormalization(x);
      for (const [last, list] of byAnchor) {
        x.insertPrompts([{prompt:{
          identifier:uid(), name:'变量读取 · '+list.map(p=>p.name).join('、'),
          content:list.map(p=>p.macro).join('\n'), role:'system',
          system_prompt:false, marker:false, injection_position:0, injection_depth:4, injection_order:100
        },enabled:true}], {after:last}, x.groupOf(last));
      }
    });
  }
  let saveError = null;
  if (plans.length || normalized.length) {
    try { await saveDraft(d.name, '一键修复变量引用'); }
    catch(e) { saveError=e.message; saveErrors.set(d.name,e.message); checkpoint(d); notifyDraft(d.name); }
  }
  const body=el(`<div><p class="pa-p">已整理 <b>${normalized.length}</b> 个冗余外层包裹，补齐 <b>${plans.length}</b> 个变量引用${saveError?'；写回失败，草稿已保留':'；'+(plans.length||normalized.length?'已自动保存':'没有修改预设')}。跳过 <b>${skipped.length}</b> 个。${plans.length||normalized.length?'本次修改可在顶部点「撤销」一起还原。':''}</p>
    ${saveError?`<p class="pa-hint">保存失败：${esc(saveError)}。可点顶部保存重试。</p>`:''}
    ${plans.length?`<details><summary>已修复的变量</summary><p class="pa-p">${plans.map(p=>esc(p.key)).join('、')}</p></details>`:''}
    ${skipped.length?`<h3 class="pa-h">这些需要手动核对</h3>${skipped.map(x=>`<div class="pa-card"><b>${esc(x.key)}</b><p>${esc(x.reason)}</p></div>`).join('')}`:''}
    <p class="pa-hint">读取条目放在最后一个启用的写入条目之后，不改写现有思维链。仅整理带缝合来源、没有任何读取依赖、且只包着一个赋值宏的外层包裹；保留内层正文和原编号标签。这里只补齐能静态判断的引用；实际效果仍需在酒馆发送的提示词中核对。</p></div>`);
  await sheet({title:'一键修复结果',body,wide:true,noFocus:true,actions:[{label:'完成',kind:'primary',value:true}]});
}

async function hookExistingDialog(d, id) {
  const p = d.prompt(id);
  if (!p) return;
  const gid = d.groupOf(id);
  const plan0 = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id });
  if (plan0.status !== "hook") {
    await sheet({ title: p.name, body: `<p class="pa-p">${esc(plan0.text)}</p>`, actions: [{ label: "知道了", value: true }] });
    return;
  }
  const initId = findInitEntry(d);
  const cotName = esc(d.prompt(plan0.cotId)?.name || "");
  let how;
  if (plan0.mode === "text") how = `<label class="pa-field"><span>在「${cotName}」里加这一行</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">${plan0.needle ? `加在提到 ${esc(plan0.needle)} 的那一行后面` : "加在这条思维链的末尾"}；「${esc(p.name)}」本身不用改。可以在顶部「撤销」。</p>`;
  else if (plan0.mode === "append") how = `<label class="pa-field"><span>追加的思维链片段</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">「${esc(p.name)}」末尾加 {{addvar::${esc(plan0.varName)}::片段}}；思维链本来就读这个变量，不用改。可以在顶部「撤销」。</p>`;
  else how = `<label class="pa-field"><span>问句变量</span><input class="pa-input" data-h="v" value="${esc(plan0.varName)}"></label>
      <label class="pa-field"><span>思维链里问什么</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">会做三件事：「${esc(p.name)}」末尾加 {{setvar::变量::问句}}；${initId ? `「${esc(d.prompt(initId)?.name)}」里加一行清空` : "（没找到初始化条目，跳过清空）"}；「${cotName}」里${plan0.anchorVar ? `紧跟 {{getvar::${esc(plan0.anchorVar)}}} ` : ""}加一行读取。${plan0.removeRange ? "条目里原来那句没人读的问句会沿用。" : ""}可以在顶部「撤销」。</p>`;
  const body = el(`<div class="pa-form"><p class="pa-p">${esc(plan0.text)}。</p>${how}</div>`);
  const ok = await sheet({ title: `把「${p.name}」挂进思维链`, body, wide: true, actions: [{ label: "取消", value: null }, { label: "挂上", kind: "primary", value: (w) => ({ v: (w.querySelector("[data-h=v]")?.value || "").replace(/[{}:：\s]/g, ""), q: (w.querySelector("[data-h=q]")?.value || "").trim() }) }] });
  if (!ok) return;
  const plan = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id }, { varName: ok.v && ok.v !== plan0.varName ? ok.v : void 0, question: ok.q || void 0 });
  if (plan.status !== "hook") return toast(plan.text);
  if (plan.clash) return toast(`变量「${plan.varName}」在预设里已经有别的用处了，换个名字`, "warning");
  mutate(d, `挂进思维链：${p.name}`, (x) => {
    const q = x.prompt(id);
    q.content = contentWithHook(q.content, plan);
    applyHook(x, plan);
  });
  toast(`已挂进「${d.prompt(plan.cotId)?.name}」，会自动保存`, "success");
}
function mountCot(page, app) {
  const st = { filter: "none" };
  page.innerHTML = `
        <div class="pa-toolbar"><div class="pa-picker-slot"></div><button class="pa-btn pa-btn-primary" data-repair-all>修复变量问题</button></div>
        <div class="pa-scroll pa-cot"></div>`;
  const box = page.querySelector(".pa-cot");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  page.querySelector('[data-repair-all]').addEventListener('click', async () => {
    try { await repairAllVariables(getDraft(focusPreset()), manualFor(focusPreset())); }
    catch(err) { toast('一键修复失败：'+err.message,'error'); }
  });
  const manualFor = (name) => {
    const s = settings();
    if (!s.cotManual[name]) s.cotManual[name] = {};
    return s.cotManual[name];
  };
  function render() {
    let d;
    try {
      d = getDraft(focusPreset());
    } catch (e) {
      box.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    picker.set(d.name);
    const a = analyze(d, manualFor(d.name));
    const nm = (id) => esc(d.prompt(id)?.name || id);
    const dead = a.issues.filter((i) => i.kind === "dead" || i.kind === "cotfrag");
    const counts = { var: 0, chain: 0, mention: 0, none: 0 };
    for (const c2 of a.coverage.values()) counts[c2.level]++;
    const cotVarReads = a.cot.reduce((n, c2) => n + c2.reads.length, 0);
    const okN = counts.var + counts.chain;
    const style = !a.cotIds.length ? "" : cotVarReads >= 3 && okN >= counts.mention ? "以变量读取为主" : cotVarReads >= 3 ? "变量读取与文字点名并用" : "以文字点名为主，不读变量";
    const total = okN + counts.mention + counts.none;
    page.querySelector("[data-repair-all]").disabled = !dead.length;
    let html = `<div class="pa-verdict ${dead.length ? "pa-bad" : a.cotIds.length ? "pa-good" : ""}">
            ${a.cotIds.length ? `<p>思维链 <b>${a.cotIds.length}</b> 条，${style}。</p>
            <p>开启的普通条目 ${total} 条：读到 <b>${okN}</b>，文字提到 <b>${counts.mention}</b>，没提到 <b>${counts.none}</b>。</p>` : `<p>未识别到开启的思维链。名称不含"思维链/COT/思考"时，请在下方列表中手动「设为思维链」。</p>`}
            <p>${dead.length ? `<b>${dead.length}</b> 处变量写入后无人读取，内容不会发送，见下方修复。` : "变量读写一致 ✓"}</p>
            ${counts.none ? `<p class="pa-hint">「没提到」的条目中，破限、规则类无需处理；文风、人设、小剧场等需要模型重点考虑的，可点「挂进思维链」。</p>` : ""}
        </div>
        <details class="pa-card pa-explain-card"><summary><b>说明</b></summary>
            <p class="pa-p">思维链：模型输出正文前执行的思考步骤（通常为 &lt;thinking&gt; 部分）。</p>
            <p class="pa-p">条目开启仅表示内容已发送；未被思维链引用的条目，可能在思考时被忽略。本页检查每条开启条目是否被思维链引用。</p>
            <ul class="pa-legend">
                <li><span class="pa-lv pa-lv-ok">读到了</span>思维链通过 {{getvar}} 读取该条目写入的变量。</li>
                <li><span class="pa-lv pa-lv-maybe">文字提到</span>思维链中出现该条目的名称或标签。</li>
                <li><span class="pa-lv pa-lv-none">没提到</span>思维链中未出现。</li>
                <li><span class="pa-lv pa-lv-none" style="color:var(--pa-warn)">变量没人读</span>条目写入的变量没有被任何开启条目读取，内容不会发送。</li>
            </ul>
        </details>
        <div class="pa-cot-sum">
            <div><b>${a.cotIds.length}</b><span>条思维链</span></div>
            <div><b>${okN}</b><span>条读到</span></div>
            <div><b>${counts.mention}</b><span>条文字提到</span></div>
            <div class="${dead.length ? "pa-bad" : ""}"><b>${dead.length}</b><span>处变量没人读</span></div>
        </div>`;
    if (dead.length) {
      html += `<h3 class="pa-h">变量没人读</h3><p class="pa-hint">以下条目写入的变量无人读取。可开启读取它的条目，或点「查看修复方案」补充读取（应用前可预览）。含条件、脚本的预设以实际发送为准。</p><div class="pa-cards">`;
      for (const i of dead) {
        html += `<div class="pa-card pa-card-warn"><p>${i.ids.map((id) => `「${nm(id)}」`).join("")}${esc(i.text)}</p>
                    <div class="pa-card-act">${i.readersOff?.length ? `<button class="pa-btn pa-btn-soft" data-fix="${esc(i.readersOff.join("|"))}">打开读取它的条目</button>` : ""}
                    <button class="pa-btn" data-repair="${esc(i.varName)}">查看修复方案</button><button class="pa-link" data-goto="${esc(i.ids.join("|"))}">在整理里看</button></div></div>`;
      }
      html += "</div>";
    }
    html += `<h3 class="pa-h">每条思维链在读什么</h3>`;
    if (!a.cotIds.length) html += '<p class="pa-hint">未识别到开启的思维链条目，可在下方列表中手动「设为思维链」。</p>';
    html += '<div class="pa-cards">';
    for (const c2 of a.cot) {
      const reads = c2.reads.map((r) => `<li><span class="pa-chip">${esc(r.name)}</span>${r.suppliers.length ? r.suppliers.map((s) => `<span class="pa-sup">${nm(s)}</span>`).join("") : '<span class="pa-sup pa-dim">没开任何选项（空）</span>'}</li>`).join("");
      html += `<details class="pa-card"><summary><b>${nm(c2.id)}</b><small>${c2.reads.length ? `读了 ${c2.reads.length} 个变量` : "没读变量（靠文字点名）"}</small></summary>
                ${reads ? `<ul class="pa-reads">${reads}</ul>` : ""}
                ${c2.mentions.length ? `<p class="pa-hint">文字里出现的英文标签/词：${c2.mentions.slice(0, 12).map(esc).join("、")}</p>` : ""}
                <button class="pa-link" data-mark="${esc(c2.id)}" data-v="0">这条不是思维链</button></details>`;
    }
    html += "</div>";
    html += `<h3 class="pa-h">每个开着的条目，思维链有没有想到它</h3>
            <div class="pa-seg pa-seg-s" role="tablist">
                ${[["none", `没提到 ${counts.none}`], ["mention", `文字提到 ${counts.mention}`], ["ok", `读到了 ${counts.var + counts.chain}`], ["all", "全部"]].map(([k, l]) => `<button data-f="${k}" class="${st.filter === k ? "on" : ""}">${l}</button>`).join("")}
            </div>
            <p class="pa-hint">「挂进思维链」按本预设的写法处理：读变量的预设补问句变量，文字点名的预设在思维链中加一行名称。可撤销。</p>`;
    const groupsOrder = [];
    const byGroup = /* @__PURE__ */ new Map();
    for (const [id, c2] of a.coverage) {
      const ok = st.filter === "all" || (st.filter === "ok" ? c2.level === "var" || c2.level === "chain" : c2.level === st.filter);
      if (!ok) continue;
      const g = d.groupOf(id);
      const gname = g ? d.group(g)?.name : "未分组";
      if (!byGroup.has(gname)) {
        byGroup.set(gname, []);
        groupsOrder.push(gname);
      }
      byGroup.get(gname).push([id, c2]);
    }
    for (const gname of groupsOrder) {
      html += `<div class="pa-cov-group"><h4>${esc(gname)}</h4>`;
      for (const [id, c2] of byGroup.get(gname)) {
        const [cls, label] = LEVEL[c2.level];
        const via = c2.level === "none" ? "" : `${esc(c2.via)} → ${nm(c2.cot)}`;
        html += `<div class="pa-cov"><span class="pa-lv ${cls}">${label}</span><span class="pa-cov-name">${nm(id)}</span>${via ? `<small>${via}</small>` : ""}${c2.level === "none" ? `<button class="pa-btn pa-btn-soft pa-hookbtn" data-hook="${esc(id)}">挂进思维链</button>` : ""}<button class="pa-link" data-mark="${esc(id)}" data-v="1">设为思维链</button></div>`;
      }
      html += "</div>";
    }
    if (!groupsOrder.length) html += '<p class="pa-hint">这一栏是空的。</p>';
    if (a.optional.length) {
      html += `<details class="pa-card pa-optional"><summary>思维链里留了位置、但没开任何选项的变量（${a.optional.length}）</summary>
                <p class="pa-hint">通常为可选功能，未开启时为空，无需处理。缝合的条目出现在此处，说明写入了其他变量名。</p>
                <ul class="pa-reads">${a.optional.map((o) => `<li><span class="pa-chip">${esc(o.varName)}</span>${o.ids.map((id) => `<span class="pa-sup">${nm(id)}</span>`).join("")}</li>`).join("")}</ul></details>`;
    }
    box.innerHTML = html;
  }
  box.addEventListener("click", async (e) => {
    const d = getDraft(focusPreset());
    if (e.target.closest("[data-repair-all]")) { try { await repairAllVariables(d, manualFor(d.name)); } catch(err) { toast("一键修复失败："+err.message,"error"); } return; }
    const repair = e.target.closest("[data-repair]");
    if (repair) { try { await repairVariableDialog(d, repair.dataset.repair); } catch(err) { toast(err.message, "error"); } return; }
    const hk = e.target.closest("[data-hook]");
    if (hk) { try { await hookExistingDialog(d, hk.dataset.hook); } catch(err) { toast("挂进思维链失败：" + err.message, "error"); } return; }
    const f = e.target.closest("[data-f]");
    if (f) {
      st.filter = f.dataset.f;
      return render();
    }
    const fix = e.target.closest("[data-fix]");
    if (fix) {
      const ids = fix.dataset.fix.split("|");
      mutate(d, "打开读取条目", (x) => { x.setEnabled(ids, true); for(const id of ids) { const gid=x.groupOf(id); if(gid) x.setGroupEnabled(gid,true); } });
      toast(`已打开 ${ids.length} 条，会自动保存`, "success");
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) return app.showOrganize(go.dataset.goto.split("|"));
    const mk = e.target.closest("[data-mark]");
    if (mk) {
      manualFor(d.name)[mk.dataset.mark] = mk.dataset.v === "1";
      saveSettings();
      render();
    }
  });
  const off = onDraftChange(() => {
    if (page.isConnected && !page.hidden) render();
  });
  return { render: () => {
    picker.refresh();
    render();
  }, destroy: off };
}

