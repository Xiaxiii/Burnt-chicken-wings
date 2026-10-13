var LEVEL = {
  var: ["pa-lv-ok", "已读取"],
  chain: ["pa-lv-ok", "间接读取"],
  mention: ["pa-lv-maybe", "文字提及"],
  none: ["pa-lv-none", "未提及"]
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
  if (!keys.length && !normalized.length) return toast('没有需要修复的变量问题');
  if (plans.length || normalized.length) {
    const byAnchor = new Map();
    for (const plan of plans) {
      if (!byAnchor.has(plan.last)) byAnchor.set(plan.last, []);
      byAnchor.get(plan.last).push(plan);
    }
    mutate(d, '修复变量问题', x => {
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
    try { await saveDraft(d.name, '修复变量问题'); }
    catch(e) { saveError=e.message; saveErrors.set(d.name,e.message); checkpoint(d); notifyDraft(d.name); }
  }
  const body=el(`<div><p class="pa-p">整理冗余外层包裹 <b>${normalized.length}</b> 个，补充变量读取 <b>${plans.length}</b> 个，跳过 <b>${skipped.length}</b> 个。${saveError?'写回失败，草稿已保留。':(plans.length||normalized.length?'已保存。':'预设未修改。')}</p>
    ${saveError?`<p class="pa-hint">保存失败：${esc(saveError)}</p>`:''}
    ${plans.length?`<details><summary>已修复的变量</summary><p class="pa-p">${plans.map(p=>esc(p.key)).join('、')}</p></details>`:''}
    ${skipped.length?`<h3 class="pa-h">需人工核对</h3>${skipped.map(x=>`<div class="pa-card"><b>${esc(x.key)}</b><p>${esc(x.reason)}</p></div>`).join('')}`:''}
    <p class="pa-hint">读取条目放在最后一个写入该变量的开启条目之后，思维链不改动。只整理来自缝合、无读取依赖、只包含一个赋值宏的外层包裹。</p></div>`);
  await sheet({title:'修复结果',body,wide:true,noFocus:true,actions:[{label:'完成',kind:'primary',value:true}]});
}

async function hookExistingDialog(d, id) {
  const p = d.prompt(id);
  if (!p) return;
  const gid = d.groupOf(id);
  const plan0 = planHook(d, { after: id }, gid, { content: p.content, name: p.name, selfId: id });
  if (plan0.status !== "hook") {
    await sheet({ title: p.name, body: `<p class="pa-p">${esc(plan0.text)}</p>`, actions: [{ label: "确定", value: true }] });
    return;
  }
  const initId = findInitEntry(d);
  const cotName = esc(d.prompt(plan0.cotId)?.name || "");
  let how;
  if (plan0.mode === "text") how = `<label class="pa-field"><span>在「${cotName}」中添加一行</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">${plan0.needle ? `添加在提到 ${esc(plan0.needle)} 的一行之后` : "添加在思维链末尾"}。条目正文不变。</p>`;
  else if (plan0.mode === "append") how = `<label class="pa-field"><span>追加的内容</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">「${esc(p.name)}」末尾添加 {{addvar::${esc(plan0.varName)}::内容}}。思维链已读取该变量，不改动。</p>`;
  else how = `<label class="pa-field"><span>问句变量</span><input class="pa-input" data-h="v" value="${esc(plan0.varName)}"></label>
      <label class="pa-field"><span>思维链中的问句</span><input class="pa-input" data-h="q" value="${esc(plan0.question)}"></label>
      <p class="pa-hint">「${esc(p.name)}」末尾添加 {{setvar::变量::问句}}；${initId ? `「${esc(d.prompt(initId)?.name)}」中添加一行清空` : "未找到初始化条目，不添加清空"}；「${cotName}」中${plan0.anchorVar ? `在 {{getvar::${esc(plan0.anchorVar)}}} 之后` : ""}添加一行读取。${plan0.removeRange ? "沿用条目里原有的问句。" : ""}</p>`;
  const body = el(`<div class="pa-form"><p class="pa-p">${esc(plan0.text)}。</p>${how}</div>`);
  const ok = await sheet({ title: `将「${p.name}」接入思维链`, body, wide: true, actions: [{ label: "取消", value: null }, { label: "接入", kind: "primary", value: (w) => ({ v: (w.querySelector("[data-h=v]")?.value || "").replace(/[{}:：\s]/g, ""), q: (w.querySelector("[data-h=q]")?.value || "").trim() }) }] });
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
function mountCot(page, app) {
  const st = { filter: "none" };
  page.innerHTML = `
        <div class="pa-toolbar"><div class="pa-picker-slot"></div><button class="pa-btn pa-btn-primary" data-repair-all>修复变量问题</button></div>
        <div class="pa-scroll pa-cot"></div>`;
  const box = page.querySelector(".pa-cot");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  page.querySelector('[data-repair-all]').addEventListener('click', async () => {
    try { await repairAllVariables(getDraft(focusPreset()), manualFor(focusPreset())); }
    catch(err) { toast('修复失败：'+err.message,'error'); }
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
    const style = !a.cotIds.length ? "" : cotVarReads >= 3 && okN >= counts.mention ? "以变量读取为主" : cotVarReads >= 3 ? "变量读取与文字提及并用" : "以文字提及为主，不读取变量";
    page.querySelector("[data-repair-all]").disabled = !dead.length;
    let html = `<div class="pa-verdict ${dead.length ? "pa-bad" : a.cotIds.length ? "pa-good" : ""}">
            <p>${a.cotIds.length ? `思维链${style}。` : "未识别到开启的思维链，可在下方手动指定。"}${dead.length ? `有 <b>${dead.length}</b> 处变量写入后未被读取，相关内容不会发送。` : "变量读写一致。"}</p>
        </div>
        <details class="pa-card pa-explain-card"><summary><b>说明</b></summary>
            <ul class="pa-legend">
                <li><span class="pa-lv pa-lv-ok">已读取</span><span>思维链通过 {{getvar}} 读取该条目写入的变量。</span></li>
                <li><span class="pa-lv pa-lv-maybe">文字提及</span><span>思维链中出现该条目的名称或标签。</span></li>
                <li><span class="pa-lv pa-lv-none">未提及</span><span>思维链中没有出现该条目。</span></li>
                <li><span class="pa-lv pa-lv-none" style="color:var(--pa-warn)">变量未被读取</span><span>条目写入的变量没有被任何开启条目读取，内容不会发送。</span></li>
                <li><span class="pa-lv pa-lv-term">接入思维链</span><span>在思维链中加入对该条目的读取或提及，使模型思考时考虑这条内容。按本预设原有的写法添加（变量读取或文字提及），可撤销。规则类条目通常不需要接入；文风、人设、玩法等需要模型重点落实的条目可以接入。</span></li>
                <li><span class="pa-lv pa-lv-term">手动指定思维链</span><span>思维链条目名称特殊、未被自动识别时，在此手动指定；识别错误的，在对应思维链下点「不是思维链」。</span></li>
            </ul>
        </details>
        <div class="pa-cot-sum">
            <div><b>${a.cotIds.length}</b><span>条思维链</span></div>
            <div><b>${okN}</b><span>条已读取</span></div>
            <div><b>${counts.mention}</b><span>条文字提及</span></div>
            <div><b>${counts.none}</b><span>条未提及</span></div>
            <div class="${dead.length ? "pa-bad" : ""}"><b>${dead.length}</b><span>处变量未被读取</span></div>
        </div>`;
    if (dead.length) {
      html += `<h3 class="pa-h">变量未被读取</h3><div class="pa-cards">`;
      for (const i of dead) {
        html += `<div class="pa-card pa-card-warn"><p>${i.ids.map((id) => `「${nm(id)}」`).join("")}${esc(i.text)}</p>
                    <div class="pa-card-act">${i.readersOff?.length ? `<button class="pa-btn pa-btn-soft" data-fix="${esc(i.readersOff.join("|"))}">开启读取它的条目</button>` : ""}
                    <button class="pa-btn" data-repair="${esc(i.varName)}">查看修复方案</button><button class="pa-link" data-goto="${esc(i.ids.join("|"))}">在整理页查看</button></div></div>`;
      }
      html += "</div>";
    }
    html += `<div class="pa-row-head"><h3 class="pa-h">思维链读取的变量</h3><button class="pa-link" data-markpick="1">手动指定思维链</button></div>`;
    html += '<div class="pa-cards">';
    for (const c2 of a.cot) {
      const reads = c2.reads.map((r) => `<li><span class="pa-chip">${esc(r.name)}</span>${r.suppliers.length ? r.suppliers.map((s) => `<span class="pa-sup">${nm(s)}</span>`).join("") : '<span class="pa-sup pa-dim">无开启的选项（为空）</span>'}</li>`).join("");
      html += `<details class="pa-card"><summary><b>${nm(c2.id)}</b><small>${c2.reads.length ? `读取 ${c2.reads.length} 个变量` : "不读取变量（文字提及）"}</small></summary>
                ${reads ? `<ul class="pa-reads">${reads}</ul>` : ""}
                ${c2.mentions.length ? `<p class="pa-hint">文中出现的标签和英文词：${c2.mentions.slice(0, 12).map(esc).join("、")}</p>` : ""}
                <button class="pa-link" data-mark="${esc(c2.id)}" data-v="0">不是思维链</button></details>`;
    }
    html += "</div>";
    html += `<h3 class="pa-h">开启条目与思维链的关联</h3>
            <div class="pa-seg pa-seg-s" role="tablist">
                ${[["none", `未提及 ${counts.none}`], ["mention", `文字提及 ${counts.mention}`], ["ok", `已读取 ${counts.var + counts.chain}`], ["all", "全部"]].map(([k, l]) => `<button data-f="${k}" class="${st.filter === k ? "on" : ""}">${l}</button>`).join("")}
            </div>`;
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
        html += `<div class="pa-cov"><span class="pa-lv ${cls}">${label}</span><span class="pa-cov-name">${nm(id)}</span>${via ? `<small>${via}</small>` : ""}${c2.level === "none" ? `<button class="pa-btn pa-btn-soft pa-hookbtn" data-hook="${esc(id)}">接入思维链</button>` : ""}</div>`;
      }
      html += "</div>";
    }
    if (!groupsOrder.length) html += '<p class="pa-hint">无</p>';
    if (a.optional.length) {
      html += `<details class="pa-card pa-optional"><summary>思维链已预留、但没有开启选项的变量（${a.optional.length}）</summary>
                <ul class="pa-reads">${a.optional.map((o) => `<li><span class="pa-chip">${esc(o.varName)}</span>${o.ids.map((id) => `<span class="pa-sup">${nm(id)}</span>`).join("")}</li>`).join("")}</ul></details>`;
    }
    box.innerHTML = html;
  }
  const a0 = (d) => analyze(d, manualFor(d.name));
  box.addEventListener("click", async (e) => {
    const d = getDraft(focusPreset());
    if (e.target.closest("[data-repair-all]")) { try { await repairAllVariables(d, manualFor(d.name)); } catch(err) { toast("修复失败："+err.message,"error"); } return; }
    const repair = e.target.closest("[data-repair]");
    if (repair) { try { await repairVariableDialog(d, repair.dataset.repair); } catch(err) { toast(err.message, "error"); } return; }
    const hk = e.target.closest("[data-hook]");
    if (hk) { try { await hookExistingDialog(d, hk.dataset.hook); } catch(err) { toast("接入思维链失败：" + err.message, "error"); } return; }
    const f = e.target.closest("[data-f]");
    if (f) {
      st.filter = f.dataset.f;
      return render();
    }
    const fix = e.target.closest("[data-fix]");
    if (fix) {
      const ids = fix.dataset.fix.split("|");
      mutate(d, "开启读取条目", (x) => { x.setEnabled(ids, true); for(const id of ids) { const gid=x.groupOf(id); if(gid) x.setGroupEnabled(gid,true); } });
      toast(`已开启 ${ids.length} 条`, "success");
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) return app.showOrganize(go.dataset.goto.split("|"));
    if (e.target.closest("[data-markpick]")) {
      const cot = new Set(a0(d).cotIds);
      const items = d.order.filter((o) => o.enabled !== false && !cot.has(o.identifier) && !d.isMarker(o.identifier)).map((o) => ({ label: d.prompt(o.identifier)?.name || o.identifier, value: o.identifier }));
      const id = await pickBox("选择思维链条目", items);
      if (!id) return;
      manualFor(d.name)[id] = true;
      saveSettings();
      return render();
    }
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

