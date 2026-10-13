function mountSuture(page, app) {
  const st = {
    srcType: "preset",
    srcPreset: null,
    srcWorld: null,
    fileDraft: null,
    picked: /* @__PURE__ */ new Map(),
    // key -> {name, content, prompt, from}
    srcCollapsedMap: /* @__PURE__ */ new Map(),
    srcQuery: "",
    dstCollapsed: null,
    dstFor: null,
    marker: null,
    pasteN: 0,
    worldCache: /* @__PURE__ */ new Map()
  };
  page.innerHTML = `
    <div class="pa-suture pa-compact">
        <div class="pa-pane pa-src">
            <div class="pa-pane-head"><b>从哪儿拿</b>
                <div class="pa-seg" role="tablist">
                    <button data-src="preset" class="on">预设</button><button data-src="world">世界书</button><button data-src="file">文件</button><button data-src="paste">粘贴</button>
                </div>
            </div>
            <div class="pa-src-pick"></div>
            <div class="pa-scroll pa-src-list"></div>
        </div>
        <div class="pa-splitter" role="separator" tabindex="0" aria-label="拖动调整上下大小" title="拖动调整大小"><span></span></div>
        <div class="pa-pane pa-dst">
            <div class="pa-pane-head"><b>缝到哪儿</b><div class="pa-dst-picker"></div></div>
            <p class="pa-hint pa-dst-hint">点一个条目＝缝在它后面；点「缝进这组」＝缝到组末尾</p>
            <div class="pa-scroll pa-dst-list"></div>
        </div>
    </div>
    <div class="pa-stitchbar">
        <div class="pa-stitch-info"><b class="pa-picked-n">还没选材料</b><span class="pa-where">还没选位置</span></div>
        <button class="pa-link" data-st="profile">两边写法</button>
        <button class="pa-link" data-st="clear">清空</button>
        <button class="pa-btn pa-btn-primary" data-st="go" disabled>预览缝合</button>
    </div>`;
  const srcPick = page.querySelector(".pa-src-pick");
  const srcList = page.querySelector(".pa-src-list");
  const dstList = page.querySelector(".pa-dst-list");
  const bar = page.querySelector(".pa-stitchbar");
  const dstPicker = presetPicker(page.querySelector(".pa-dst-picker"), (name) => {
    st.marker = null;
    setFocusPreset(name);
  }, { label: "目标" });
  const target = () => getDraft(focusPreset());
  // ---- 上下（宽屏是左右）分区可以拖动调大小，记住比例
  const sutureEl = page.querySelector(".pa-suture");
  const splitter = page.querySelector(".pa-splitter");
  const applySplit = (v) => {
    const r = Math.min(85, Math.max(15, Number(v) || 50));
    sutureEl.style.setProperty("--pa-split", r + "%");
    return r;
  };
  applySplit(settings().sutureSplit ?? 45);
  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("pa-dragging");
    const rect = sutureEl.getBoundingClientRect();
    const vertical = getComputedStyle(sutureEl).gridTemplateColumns.split(" ").length < 3;
    let last = null;
    const move = (ev) => {
      const ratio = vertical ? (ev.clientY - rect.top) / rect.height * 100 : (ev.clientX - rect.left) / rect.width * 100;
      last = applySplit(ratio);
    };
    const up = () => {
      splitter.classList.remove("pa-dragging");
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      if (last != null) {
        settings().sutureSplit = Math.round(last);
        saveSettings();
      }
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
  splitter.addEventListener("keydown", (e) => {
    const k = { ArrowUp: -5, ArrowLeft: -5, ArrowDown: 5, ArrowRight: 5 }[e.key];
    if (!k) return;
    e.preventDefault();
    settings().sutureSplit = applySplit((settings().sutureSplit ?? 45) + k);
    saveSettings();
  });
  page.querySelector(".pa-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-src]");
    if (!b) return;
    st.srcType = b.dataset.src;
    page.querySelectorAll(".pa-seg button").forEach((x) => x.classList.toggle("on", x === b));
    renderSrcPick();
    renderSrc();
  });
  function renderSrcPick() {
    if (st.srcType === "preset") {
      const names = listPresets();
      if (!st.srcPreset || !names.includes(st.srcPreset)) st.srcPreset = names.find((n) => n !== focusPreset()) || names[0];
      srcPick.innerHTML = `<select class="pa-select" aria-label="来源预设">${names.map((n) => `<option ${n === st.srcPreset ? "selected" : ""} value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
                <input class="pa-input pa-search" type="search" placeholder="搜条目名" value="${esc(st.srcQuery)}">`;
    } else if (st.srcType === "world") {
      const names = listWorldbooks();
      if (!st.srcWorld || !names.includes(st.srcWorld)) st.srcWorld = names[0] || null;
      srcPick.innerHTML = names.length ? `<select class="pa-select" aria-label="来源世界书">${names.map((n) => `<option ${n === st.srcWorld ? "selected" : ""} value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
                <input class="pa-input pa-search" type="search" placeholder="搜条目名" value="${esc(st.srcQuery)}">` : '<p class="pa-hint">酒馆里还没有世界书</p>';
    } else if (st.srcType === "file") {
      srcPick.innerHTML = `<label class="pa-btn pa-btn-soft pa-file">选预设 JSON 文件<input type="file" accept=".json,application/json" hidden></label>
                <span class="pa-hint">${st.fileDraft ? esc(st.fileDraft.name) : "别人发你的预设，不用先导入酒馆"}</span>
                <input class="pa-input pa-search" type="search" placeholder="搜条目名" value="${esc(st.srcQuery)}">`;
    } else {
      srcPick.innerHTML = "";
    }
  }
  srcPick.addEventListener("change", async (e) => {
    if (e.target.matches("select")) {
      if (st.srcType === "preset") st.srcPreset = e.target.value;
      else st.srcWorld = e.target.value;
      renderSrc();
    }
    if (e.target.matches("input[type=file]")) {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!Array.isArray(data.prompts)) throw new Error("这不是聊天补全预设（里面没有 prompts）");
        st.fileDraft = new Draft(f.name.replace(/\.json$/i, ""), data);
        renderSrcPick();
        renderSrc();
      } catch (err) {
        toast("读不了这个文件：" + err.message, "error");
      }
    }
  });
  srcPick.addEventListener("input", (e) => {
    if (e.target.matches(".pa-search")) {
      st.srcQuery = e.target.value;
      renderSrc();
    }
  });
  async function renderSrc() {
    const keyOf = (id) => `${st.srcType}:${st.srcType === "preset" ? st.srcPreset : st.srcType === "file" ? st.fileDraft?.name : ""}:${id}`;
    if (st.srcType === "preset" || st.srcType === "file") {
      let d;
      try {
        d = st.srcType === "preset" ? st.srcPreset ? getDraft(st.srcPreset) : null : st.fileDraft;
      } catch (e) {
        srcList.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
        return;
      }
      if (!d) {
        srcList.innerHTML = `<p class="pa-empty">${st.srcType === "file" ? "先选一个文件" : "没有预设"}</p>`;
        return;
      }
      const ck = `${st.srcType}:${d.name}`;
      if (!st.srcCollapsedMap.has(ck)) st.srcCollapsedMap.set(ck, new Set(d.groups.groups.map((g) => g.id)));
      st.srcCollapsed = st.srcCollapsedMap.get(ck);
      const sel = new Set(d.order.map((o) => o.identifier).filter((id) => st.picked.has(keyOf(id))));
      srcList.innerHTML = renderList(d, { mode: "source", selected: sel, collapsed: st.srcCollapsed, query: st.srcQuery });
      srcList.dataset.kind = "draft";
      srcList._draft = d;
      srcList._keyOf = keyOf;
    } else if (st.srcType === "world") {
      if (!st.srcWorld) {
        srcList.innerHTML = '<p class="pa-empty">没有世界书</p>';
        return;
      }
      let items = st.worldCache.get(st.srcWorld);
      if (!items) {
        srcList.innerHTML = '<p class="pa-empty">读取中…</p>';
        try {
          items = await readWorldbook(st.srcWorld);
          st.worldCache.set(st.srcWorld, items);
        } catch (e) {
          srcList.innerHTML = `<p class="pa-empty">读不到：${esc(e.message)}</p>`;
          return;
        }
      }
      const q = st.srcQuery.trim().toLowerCase();
      srcList.dataset.kind = "world";
      srcList._items = items;
      srcList.innerHTML = `<div class="pa-loose">${items.filter((it) => !q || it.name.toLowerCase().includes(q)).map((it) => `<div class="pa-row${st.picked.has(it.id) ? " pa-sel" : ""}${it.enabled ? "" : " pa-off"}" data-wid="${esc(it.id)}"><span class="pa-check"></span><span class="pa-name">${esc(it.name)}</span><button class="pa-icon-btn pa-peek" data-act="peek" aria-label="看内容">${ICON.eye}</button></div>`).join("") || '<p class="pa-empty">没有条目</p>'}</div>`;
    } else {
      srcList.dataset.kind = "paste";
      const pasted = [...st.picked.entries()].filter(([k]) => k.startsWith("paste:"));
      srcList.innerHTML = `<div class="pa-form pa-paste">
                <input class="pa-input" data-p="name" placeholder="条目名，比如：\u{1F3B5}某某文风">
                <textarea class="pa-input pa-text pa-text-s" data-p="content" placeholder="把正文粘进来。带不带 {{addvar}} 都行，会自动按目标改写"></textarea>
                <button class="pa-btn pa-btn-soft" data-p="add">加入材料</button>
                ${pasted.length ? `<p class="pa-hint">已加入：${pasted.map(([, v]) => esc(v.name)).join("、")}</p>` : ""}
            </div>`;
    }
    renderBar();
  }
  srcList.addEventListener("click", async (e) => {
    const kind = srcList.dataset.kind;
    if (kind === "paste") {
      if (e.target.closest("[data-p=add]")) {
        const name = srcList.querySelector("[data-p=name]").value.trim() || `粘贴材料${st.pasteN + 1}`;
        const content = srcList.querySelector("[data-p=content]").value;
        if (!content.trim()) return toast("正文是空的");
        st.picked.set(`paste:${++st.pasteN}`, { name, content, prompt: null, from: "粘贴" });
        renderSrc();
      }
      return;
    }
    const peekBtn = e.target.closest("[data-act=peek]");
    if (kind === "world") {
      const r = e.target.closest("[data-wid]");
      if (!r) return;
      const it = srcList._items.find((x) => x.id === r.dataset.wid);
      if (peekBtn) return showText(it.name, it.content);
      st.picked.has(it.id) ? st.picked.delete(it.id) : st.picked.set(it.id, { name: it.name, content: it.content, prompt: null, from: `世界书 ${st.srcWorld}` });
      return renderSrc();
    }
    const d = srcList._draft;
    const head = e.target.closest(".pa-ghead");
    if (head) {
      const gid = head.dataset.gid;
      if (e.target.closest("[data-act=gselect]")) {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier).filter((id2) => !d.isMarker(id2));
        const all = ids.every((id2) => st.picked.has(srcList._keyOf(id2)));
        for (const id2 of ids) {
          const k2 = srcList._keyOf(id2);
          if (all) st.picked.delete(k2);
          else {
            const p2 = d.prompt(id2);
            st.picked.set(k2, { name: p2.name, content: p2.content, prompt: p2, from: d.name, srcDraft: d, srcId: id2 });
          }
        }
      } else {
        st.srcCollapsed.has(gid) ? st.srcCollapsed.delete(gid) : st.srcCollapsed.add(gid);
      }
      return renderSrc();
    }
    const row = e.target.closest(".pa-row");
    if (!row) return;
    const id = row.dataset.id;
    const p = d.prompt(id);
    if (peekBtn) return showText(p.name, p.content);
    if (d.isMarker(id)) return toast("这是酒馆自动填内容的位置条目，不用缝");
    const k = srcList._keyOf(id);
    st.picked.has(k) ? st.picked.delete(k) : st.picked.set(k, { name: p.name, content: p.content, prompt: p, from: d.name, srcDraft: d, srcId: id });
    renderSrc();
  });
  function showText(name, content) {
    sheet({ title: name, body: `<pre class="pa-pre">${esc(content || "（空）")}</pre>`, wide: true, actions: [] });
  }
  function renderDst() {
    let d;
    try {
      d = target();
    } catch (e) {
      dstList.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    dstPicker.set(d.name);
    if (st.dstFor !== d.name) {
      st.dstFor = d.name;
      st.dstCollapsed = new Set(d.groups.groups.map((g) => g.id));
      st.marker = null;
    }
    const top = dstList.scrollTop;
    dstList.innerHTML = renderList(d, { mode: "target", collapsed: st.dstCollapsed, marker: st.marker, highlight: st.highlight || void 0 });
    dstList.scrollTop = top;
    renderBar();
  }
  dstList.addEventListener("click", (e) => {
    const d = target();
    const head = e.target.closest(".pa-ghead");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "peek") {
      const p = d.prompt(e.target.closest(".pa-row").dataset.id);
      return showText(p.name, p.content);
    }
    if (head) {
      const gid = head.dataset.gid;
      if (act === "into") {
        st.marker = { groupEnd: gid };
        st.dstCollapsed.delete(gid);
      } else {
        st.dstCollapsed.has(gid) ? st.dstCollapsed.delete(gid) : st.dstCollapsed.add(gid);
      }
      return renderDst();
    }
    const row = e.target.closest(".pa-row");
    if (row) {
      st.marker = { after: row.dataset.id };
      renderDst();
    }
  });
  function whereText(d) {
    const m = st.marker;
    if (!m) return "还没选位置";
    if (m.groupEnd) return `缝进「${d.group(m.groupEnd)?.name}」组末尾`;
    if (m.after) {
      const g = d.groupOf(m.after);
      return `缝在「${d.prompt(m.after)?.name}」后面${g ? `（${d.group(g)?.name} 组内）` : ""}`;
    }
    return "缝在最后";
  }
  function renderBar() {
    const n = st.picked.size;
    let d = null;
    try {
      d = target();
    } catch {
    }
    bar.querySelector(".pa-picked-n").textContent = n ? `已选 ${n} 条材料` : "还没选材料";
    bar.querySelector(".pa-where").textContent = d ? whereText(d) : "";
    bar.querySelector("[data-st=go]").disabled = !(n && st.marker);
  }
  bar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-st]")?.dataset.st;
    if (a === "clear") {
      st.picked.clear();
      renderSrc();
    }
    if (a === "go") review();
    if (a === "profile") showProfiles();
  });
  async function review() {
    const d = target();
    const where = { ...st.marker };
    const gid = where.groupEnd || (where.after ? d.groupOf(where.after) : null);
    const t = inferTarget(d, where, gid);
    const tgtProf = profilePreset(d);
    const idx = insertionIndex(d, where);
    const tgtWr = wrappersAt(d, tgtProf, idx);
    const srcProfs = /* @__PURE__ */ new Map();
    const items = [...st.picked.values()].map((src) => {
      let desc = null;
      if (src.srcDraft && src.srcId) {
        try {
          if (!srcProfs.has(src.srcDraft)) srcProfs.set(src.srcDraft, profilePreset(src.srcDraft));
          desc = describeEntry(src.srcDraft, src.srcId, srcProfs.get(src.srcDraft));
        } catch (e) {
          console.warn("[裁缝铺] 来源分析失败", e);
        }
      }
      return { src: { ...src, sections: desc?.inside || [] }, desc, choice: {}, manual: null, enabled: true };
    });
    const body = el(`<div class="pa-review">
            <div class="pa-target-card">
                <div><b>目标「${esc(d.name)}」是这样写的</b></div>
                <ul class="pa-notes">${tgtProf.lines.slice(0, 3).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
                ${tgtProf.lines.length > 3 ? `<details class="pa-explain"><summary>还有 ${tgtProf.lines.length - 3} 条</summary><ul class="pa-notes">${tgtProf.lines.slice(3).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
                <small>缝到这里，附近条目的写法是：${esc(t.summary)}${tgtWr.length ? `；会落在 &lt;${tgtWr.map(esc).join("&gt; / &lt;")}&gt; 里面` : ""}</small>
                <label class="pa-inline-check"><input type="checkbox" data-g="inj" ${settings().followTargetInjection ? "checked" : ""}> 角色和注入位置跟随目标（推荐）</label>
                <details class="pa-explain"><summary>看不懂？这几种写法是什么意思</summary>
                    <ul class="pa-notes">
                        <li><b>直接写正文</b>：没有变量，条目开着就原样发给模型。</li>
                        <li><b>整段包进变量</b>：正文存进变量，要有别的条目用 {{getvar::变量名}} 读出来才会发出去。setvar＝同一个变量只认最后一个开着的（单选）；addvar＝开着的几条接在一起（多选）。</li>
                        <li><b>正文直写＋登记名字</b>：正文照常发，末尾把名字登记到变量里，让读这个变量的条目（常常是思维链）知道开了它。</li>
                        <li><b>挂进思维链</b>：让模型在正式写之前"想到"这一条。思维链读变量的预设，就给条目配一句问句变量；思维链靠文字点名的预设，就在思维链里加一行点它的名字。不挂的话，条目虽然发出去了，思维链可能完全不提它，看起来就像"没生效"。</li>
                    </ul>
                </details>
            </div>
            <div class="pa-items"></div>
        </div>`);
    const box = body.querySelector(".pa-items");
    const shapeOpts = (it) => {
      const cur = it.choice.shape || "auto";
      const o = [["auto", `跟随目标（${SHAPE_LABEL[t.shape]}）`], ["plain", SHAPE_LABEL.plain], ["wrap", SHAPE_LABEL.wrap], ["tagname", SHAPE_LABEL.tagname]];
      return o.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
    };
    const initName = (() => {
      const id = findInitEntry(d);
      return id ? d.prompt(id)?.name : null;
    })();
    const hookBlock = (it) => {
      const h = it.hook;
      if (h.status !== "hook") return `<div class="pa-hook pa-hook-${esc(h.status)}"><small><b>思维链：</b>${esc(h.text)}</small></div>`;
      const cotName = esc(d.prompt(h.cotId)?.name || "");
      let detail = "";
      if (it.hookOn && h.mode === "text") {
        detail = `<label class="pa-field pa-field-wide"><span>在「${cotName}」里加这一行</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>${h.needle ? `加在提到 ${esc(h.needle)} 的那一行后面` : "加在这条思维链的末尾"}。条目正文不用改。</small>`;
      } else if (it.hookOn && h.mode === "append") {
        detail = `<label class="pa-field pa-field-wide"><span>追加的思维链片段</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>条目末尾加 {{addvar::${esc(h.varName)}::片段}}。「${cotName}」本来就读「${esc(h.varName)}」，思维链不用改。${h.removeRange ? "来源自带的问句已经沿用。" : ""}</small>`;
      } else if (it.hookOn) {
        detail = `<div class="pa-item-ctl">
                <label class="pa-field"><span>问句变量</span><input class="pa-input pa-input-s" data-c="hv" value="${esc(h.varName)}"></label>
                <label class="pa-field pa-field-wide"><span>思维链里问什么</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label></div>
            ${h.clash ? `<p class="pa-warn">目标里已经有变量「${esc(h.varName)}」了，用这个名字会和原来的内容互相覆盖，建议换一个</p>` : ""}
            <small>会做三件事：条目末尾加 {{setvar::${esc(h.varName)}::问句}}；${initName ? `「${esc(initName)}」里加一行清空` : "（没找到初始化条目，跳过清空）"}；「${cotName}」里${h.anchorVar ? `紧跟 {{getvar::${esc(h.anchorVar)}}} ` : ""}加 {{getvar::${esc(h.varName)}}}。${h.removeRange ? "来源自带的问句已经沿用。" : ""}</small>`;
      }
      return `<div class="pa-hook">
            <label class="pa-inline-check"><input type="checkbox" data-c="hook" ${it.hookOn ? "checked" : ""}> <b>挂进思维链</b></label>
            <small>${esc(h.text)}${h.on ? "" : "。" + esc(h.offHint || "")}</small>${detail}</div>`;
    };
    const renderItem = (it, i) => {
      const plan = planItem(it.src, t, { ...it.choice, shape: it.choice.shape === "auto" ? void 0 : it.choice.shape });
      it.plan = plan;
      const taken = new Set(items.filter((o) => o !== it && o.hookOn && o.hook?.varName).map((o) => o.hook.varName));
      const srcCot = it.desc?.cot ? ["var", "chain", "mention"].includes(it.desc.cot.level) : null;
      try {
        it.hook = planHook(d, where, gid, { content: plan.content, name: it.src.name, label: plan.label }, { taken, varName: it.choice.hookVar || void 0, question: it.choice.hookQ ?? void 0, srcCot, allowSlot: plan.slotAllowed });
      } catch (e) {
        console.warn("[裁缝铺] 思维链检查失败", e);
        it.hook = { status: "skip", on: false, text: "思维链检查出错，跳过" };
      }
      it.hookOn = it.hook.status === "hook" && (it.choice.hook ?? it.hook.on);
      it.finalContent = it.hookOn ? contentWithHook(plan.content, it.hook) : plan.content;
      // 来源 → 目标 的差异提醒
      const warns = [...plan.warnings];
      const infos = [...plan.notes];
      const sp = it.src.prompt;
      if (sp?.injection_position === 1) infos.push(`来源里它插在聊天记录里（深度 ${sp.injection_depth ?? 4}）。${settings().followTargetInjection ? "跟随目标后会放在普通位置；想保留原来的位置，取消上面「跟随目标」" : "会保留原来的深度注入"}`);
      if ((sp?.injection_trigger || []).length) infos.push("来源里它只在特定生成方式下发送，这个设置会一起带过去");
      if (hasScript(it.src.content || "")) warns.push("带脚本（EJS 等），目标这边也要装同样的插件才会生效");
      if (hasConditional(it.src.content || "")) warns.push("带 {{if}} 条件，用到的变量目标里也要有");
      for (const k of it.desc?.needsVars || []) {
        const nm2 = k.replace(/^全局:/, "");
        const has = d.preset.prompts.some((p) => listVarMacros(p.content || "").some((m) => m.name === nm2 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)));
        if (!has) warns.push(`它会读取变量「${nm2}」，但目标里没有条目写这个变量，这部分会是空的`);
      }
      for (const w of it.desc?.inside || []) {
        const tw = tgtProf.wrappers.find((x) => x.name === w);
        if (!tw) continue;
        if (tgtWr.includes(w)) infos.push(`来源里它在 <${w}> 里面，缝到这里也在目标的 <${w}> 里面，位置对得上`);
        else warns.push(`来源里它在 <${w}> 里面；目标的 <${w}> 在「${d.prompt(tw.openId)?.name}」和「${d.prompt(tw.closeId)?.name}」之间，现在选的位置不在里面，可能要挪进去`);
      }
      const shape = plan.want.shape;
      const needVar = shape === "wrap" || shape === "tagname";
      const canTag = !!(t.tagTpl || t.headerTpl || t.ownTag);
      return `<article class="pa-item" data-i="${i}">
                <header><label class="pa-inline-check"><input type="checkbox" data-c="on" ${it.enabled ? "checked" : ""}> 缝进来后开启</label>
                <input class="pa-input pa-input-s" data-c="name" value="${esc(it.src.name)}" aria-label="条目名"></header>
                ${it.desc ? `<div class="pa-was"><b>在「${esc(it.src.from || "")}」里：</b><ul class="pa-notes">${it.desc.lines.map((l) => `<li>${esc(l)}</li>`).join("")}${it.desc.cot ? `<li>${esc(it.desc.cot.text)}</li>` : ""}</ul></div>` : `<small class="pa-from">来自 ${esc(it.src.from || "")}</small>`}
                <div class="pa-was"><b>缝过去：</b><ul class="pa-notes">${infos.map((n) => `<li>${esc(n)}</li>`).join("")}${warns.map((w) => `<li class="pa-warn">${esc(w)}</li>`).join("")}</ul></div>
                ${hookBlock(it)}
                <details class="pa-adv" ${it.choice.adv ? "open" : ""}><summary>高级：手动改写法</summary>
                <div class="pa-item-ctl">
                    <label class="pa-field"><span>写法</span><select class="pa-select" data-c="shape">${shapeOpts(it)}</select></label>
                    ${needVar ? `<label class="pa-field"><span>变量</span><input class="pa-input pa-input-s" data-c="var" value="${esc(plan.want.varName || "")}"></label>
                    <label class="pa-field"><span>方式</span><select class="pa-select" data-c="op"><option value="add" ${plan.want.op !== "set" ? "selected" : ""}>addvar 追加（可多选）</option><option value="set" ${plan.want.op === "set" ? "selected" : ""}>setvar 覆盖（单选）</option></select></label>` : ""}
                    ${shape === "tagname" || canTag && it.choice.useTag !== false ? `<label class="pa-field"><span>短名字</span><input class="pa-input pa-input-s" data-c="label" value="${esc(plan.label)}"></label>` : ""}
                    ${canTag ? `<label class="pa-inline-check"><input type="checkbox" data-c="tag" ${it.choice.useTag ?? plan.notes.some((n) => n.includes("标签") || n.includes("标题")) ? "checked" : ""}> ${t.ownTag ? "套上自己名字的标签" : `套目标的${t.tagTpl ? `&lt;${esc(t.tagTpl.tag)}&gt; 标签` : "标题格式"}`}</label>` : ""}
                    ${plan.sourceShape.extras?.length ? `<label class="pa-inline-check"><input type="checkbox" data-c="extras" ${it.choice.keepExtras ? "checked" : ""}> 带上来源附带的 ${plan.sourceShape.extras.length} 个额外宏</label>` : ""}
                </div></details>
                <details class="pa-body" ${i === 0 && items.length === 1 ? "open" : ""}><summary>缝进去的正文${it.manual != null ? "（你手动改过）" : ""}</summary>
                <textarea class="pa-input pa-text" data-c="content" spellcheck="false">${esc(it.manual ?? it.finalContent)}</textarea>
                ${it.manual != null ? '<button class="pa-link" data-c="reset">撤销手动修改，按上面的选项重新生成</button>' : ""}</details>
            </article>`;
    };
    const rerender = (art, it) => {
      const i = Number(art.dataset.i);
      const openBody = art.querySelector(".pa-body")?.open;
      it.choice.adv = art.querySelector(".pa-adv")?.open || void 0;
      art.outerHTML = renderItem(it, i);
      if (openBody) box.querySelector(`.pa-item[data-i="${i}"] .pa-body`).open = true;
    };
    box.innerHTML = items.map(renderItem).join("");
    box.addEventListener("change", (e) => {
      const art = e.target.closest(".pa-item");
      if (!art) return;
      const it = items[Number(art.dataset.i)];
      const c2 = e.target.dataset.c;
      if (c2 === "on") {
        it.enabled = e.target.checked;
        return;
      }
      if (c2 === "name") {
        it.src = { ...it.src, name: e.target.value };
        return;
      }
      if (c2 === "content") {
        it.manual = e.target.value;
        return;
      }
      if (c2 === "shape") it.choice.shape = e.target.value;
      if (c2 === "var") it.choice.varName = e.target.value.trim();
      if (c2 === "op") it.choice.op = e.target.value;
      if (c2 === "label") it.choice.label = e.target.value;
      if (c2 === "tag") it.choice.useTag = e.target.checked;
      if (c2 === "extras") it.choice.keepExtras = e.target.checked;
      if (c2 === "hook") it.choice.hook = e.target.checked;
      if (c2 === "hv") it.choice.hookVar = e.target.value.replace(/[{}:：\s]/g, "");
      if (c2 === "hq") it.choice.hookQ = e.target.value.trim() || void 0;
      it.manual = null;
      rerender(art, it);
    });
    box.addEventListener("click", (e) => {
      if (e.target.dataset.c !== "reset") return;
      const art = e.target.closest(".pa-item");
      const it = items[Number(art.dataset.i)];
      it.manual = null;
      rerender(art, it);
    });
    const ok = await sheet({ title: `缝 ${items.length} 条到「${d.name}」`, body, wide: true, noFocus: true, actions: [{ label: "再想想", value: null }, { label: "缝进去", kind: "primary", value: (w) => ({ inj: w.querySelector("[data-g=inj]").checked }) }] });
    if (!ok) return;
    settings().followTargetInjection = ok.inj;
    saveSettings();
    let newIds = [];
    const inits = [];
    const hooked = [];
    mutate(d, `缝合 ${items.length} 条`, (x) => {
      const prompts = items.map((it) => {
        const content = it.manual ?? it.finalContent ?? it.plan.content;
        const prompt = buildPrompt(x, it.src, { content }, t, { keepSourceInjection: !ok.inj });
        prompt.name = it.src.name;
        const v = it.plan.want;
        if ((v.shape === "wrap" || v.shape === "tagname") && v.varName && v.varName !== t.varName) {
          const initId = t.initId || findInitEntry(x);
          if (initId && ensureInit(x, v.varName, initId)) inits.push(v.varName);
        }
        return { prompt, enabled: it.enabled };
      });
      newIds = x.insertPrompts(prompts, where, gid);
      // 挂进思维链：同一个位置挂好几条时，按缝合顺序一条接一条往下排
      const chain = /* @__PURE__ */ new Map();
      items.forEach((it, i) => {
        if (!it.hookOn || it.hook?.status !== "hook") return;
        const h = { ...it.hook };
        const content = x.prompt(newIds[i])?.content || "";
        if (h.mode !== "text" && !content.includes(`var::${h.varName}::`)) return; // 手动改正文时删掉了问句，就不挂
        if (h.mode === "text") h.line = h.prefix + String(h.question || "").replace(/\n+/g, " ");
        const key = `${h.cotId}|${h.mode === "text" ? h.needle || "" : h.anchorVar || ""}`;
        if (chain.has(key)) {
          if (h.mode === "text") h.needle = chain.get(key);
          else h.anchorVar = chain.get(key);
        }
        const r = applyHook(x, h);
        if (r.ok) {
          chain.set(key, h.mode === "text" ? h.line.trim() : h.varName);
          hooked.push(`${it.src.name} → ${r.cotName}`);
        }
      });
    });
    st.picked.clear();
    st.marker = { after: newIds[newIds.length - 1] };
    toast(`缝好了 ${newIds.length} 条${hooked.length ? `，${hooked.length} 条挂进了思维链` : ""}${inits.length ? `，并在初始化条目里补了变量 ${inits.join("、")}` : ""}。会自动保存，不满意可以点「撤销」`, "success");
    if (gid) st.dstCollapsed.delete(gid);
    st.highlight = new Set(newIds);
    renderSrc();
    renderDst();
    dstList.querySelector(".pa-flash")?.scrollIntoView({ block: "center" });
    setTimeout(() => {
      st.highlight = null;
    }, 1500);
  }
  async function showProfiles() {
    const parts = [];
    const add = (title, d2) => {
      if (!d2) return;
      try {
        const pr = profilePreset(d2);
        parts.push(`<section class="pa-card"><header><b>${esc(title)}「${esc(d2.name)}」</b></header><ul class="pa-notes">${pr.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>`);
      } catch (e) {
        parts.push(`<p class="pa-warn">${esc(title)}分析失败：${esc(e.message)}</p>`);
      }
    };
    let srcD = null;
    try {
      srcD = st.srcType === "preset" ? st.srcPreset ? getDraft(st.srcPreset) : null : st.srcType === "file" ? st.fileDraft : null;
    } catch {
    }
    add("来源", srcD);
    add("目标", target());
    await sheet({ title: "两边的写法", body: `<div>${parts.join("") || '<p class="pa-empty">先选来源预设</p>'}<p class="pa-hint">缝合时会按这里看出来的差异自动改写：变量怎么包、要不要挂进思维链、挂到哪里。</p></div>`, wide: true, actions: [{ label: "知道了", kind: "primary", value: true }] });
  }
  const off = onDraftChange(() => {
    if (page.isConnected && !page.hidden) renderDst();
  });
  return {
    render() {
      dstPicker.refresh();
      renderSrcPick();
      renderSrc();
      renderDst();
    },
    destroy: off
  };
}

