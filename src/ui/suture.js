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
            <div class="pa-pane-head"><b>缝到哪儿</b><div class="pa-dst-picker"></div><button class="pa-mini" data-gm="toggle">整理分组</button></div>
            <p class="pa-hint pa-dst-hint"></p>
            <div class="pa-scroll pa-dst-list"></div>
        </div>
    </div>
    <div class="pa-stitchbar pa-groupbar" hidden>
        <div class="pa-stitch-info"><b class="pa-gsel-n">点选条目</b></div>
        <button class="pa-btn" data-gm="new">建新分组</button>
        <button class="pa-btn" data-gm="out">移出分组</button>
        <button class="pa-btn pa-btn-primary" data-gm="done">完成</button>
    </div>
    <div class="pa-stitchbar pa-sbar">
        <div class="pa-stitch-info"><b class="pa-picked-n">还没选材料</b><span class="pa-where">还没选位置</span></div>
        <button class="pa-link" data-st="profile">两边写法</button>
        <button class="pa-link" data-st="clear">清空</button>
        <button class="pa-btn pa-btn-primary" data-st="go" disabled>预览缝合</button>
    </div>`;
  const srcPick = page.querySelector(".pa-src-pick");
  const srcList = page.querySelector(".pa-src-list");
  const dstList = page.querySelector(".pa-dst-list");
  const bar = page.querySelector(".pa-sbar");
  const gbar = page.querySelector(".pa-groupbar");
  st.gsel = /* @__PURE__ */ new Set();
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
                ${st.fileDraft ? `<span class="pa-hint">${esc(st.fileDraft.name)}</span>` : ""}
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
    if (d.isMarker(id)) return toast("酒馆位置条目，不能缝");
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
    // 位置指向的条目/分组已经不在了（换了预设、被撤销、被别的插件改过）就清掉
    st.marker = fixPlace(d, st.marker);
    const top = dstList.scrollTop;
    dstList.classList.toggle("pa-placing", !st.groupEdit);
    dstList.innerHTML = renderList(d, { mode: st.groupEdit ? "target-group" : "target", place: !st.groupEdit, selected: st.groupEdit ? st.gsel : void 0, collapsed: st.dstCollapsed, marker: st.marker, highlight: st.highlight || void 0 });
    const hint = page.querySelector(".pa-dst-hint");
    hint.textContent = st.groupEdit ? "点选条目，再点下面的按钮" : "点组名＝缝在组后；展开组再点条目＝缝进组内";
    hint.hidden = !st.groupEdit && !!st.marker;
    page.querySelector("[data-gm=toggle]").textContent = st.groupEdit ? "退出整理" : "整理分组";
    bar.hidden = !!st.groupEdit;
    gbar.hidden = !st.groupEdit;
    gbar.querySelector(".pa-gsel-n").textContent = st.gsel.size ? `已选 ${st.gsel.size} 条` : "点选条目";
    dstList.scrollTop = top;
    renderBar();
  }
  // ---- 目标预设里建分组 / 解除分组
  page.querySelector("[data-gm=toggle]").addEventListener("click", () => {
    st.groupEdit = !st.groupEdit;
    st.gsel.clear();
    renderDst();
  });
  gbar.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-gm]")?.dataset.gm;
    if (!a) return;
    const d = target();
    if (a === "done") {
      st.groupEdit = false;
      st.gsel.clear();
      return renderDst();
    }
    const ids = d.sortByOrder([...st.gsel]);
    if (!ids.length) return toast("先点选条目");
    if (a === "new") {
      // 选中的正好是某个组的全部条目：建新组就等于给它改名，直接说清楚
      const gids = new Set(ids.map((id) => d.groupOf(id)));
      const only = gids.size === 1 ? [...gids][0] : null;
      if (only && d.order.filter((o) => d.groupOf(o.identifier) === only).length === ids.length) {
        const g = d.group(only);
        const v = await pickBox(`选中的就是「${g?.name}」整组`, [
          { label: "给这个组改名", value: "rename" },
          { label: "还是建新分组", sub: `条目都会挪进新组，「${g?.name}」会变成空的`, value: "new" }
        ]);
        if (!v) return;
        if (v === "rename") {
          const n = await promptBox("分组名", g?.name || "");
          if (n) mutate(d, "分组改名", (x) => x.renameGroup(only, n));
          st.gsel.clear();
          return renderDst();
        }
      }
      const name = await promptBox(`把选中的 ${ids.length} 条建成新分组，叫什么？`, "", "比如：缝进来的文风");
      if (!name) return;
      let newId = null;
      mutate(d, `建分组「${name}」`, (x) => { newId = x.createGroup(name, ids); });
      st.dstCollapsed.delete(newId);
      st.gsel.clear();
      renderDst();
      dstList.querySelector(`.pa-ghead[data-gid="${newId}"]`)?.scrollIntoView({ block: "center" });
      toast(`已建分组「${name}」`, "success");
      // 保存后再看一眼：要是被别的插件盖回去了，要告诉用户
      setTimeout(() => {
        try {
          const back = new Draft(d.name, readPreset(d.name));
          if (!back.groups.groups.some((g) => g.name === name)) toast(`「${name}」保存后又不见了，可能被别的插件（比如百宝箱的分组）改回去了。刷新页面后再试一次；还不行告诉我。`, "error");
        } catch {
        }
      }, 3e3);
      return;
    }
    if (a === "out") {
      if (!ids.some((id) => d.groupOf(id))) return toast("选中的条目本来就不在分组里");
      mutate(d, "移出分组", (x) => x.removeFromGroup(ids));
      toast("已移出分组", "success");
    }
    st.gsel.clear();
    renderDst();
  });
  dstList.addEventListener("click", async (e) => {
    const d = target();
    const head = e.target.closest(".pa-ghead");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "peek") {
      const p = d.prompt(e.target.closest(".pa-row").dataset.id);
      return showText(p.name, p.content);
    }
    if (st.groupEdit) {
      if (head) {
        const gid2 = head.dataset.gid;
        const g = d.group(gid2);
        if (act === "gselect") {
          const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid2).map((o) => o.identifier);
          const all = ids.every((id) => st.gsel.has(id));
          ids.forEach((id) => all ? st.gsel.delete(id) : st.gsel.add(id));
        } else if (act === "gmenu") {
          const v = await pickBox(g?.name || "分组", [{ label: "改名", value: "rename" }, { label: "解除分组", sub: "条目留在原处，只是不再归这个组", value: "dissolve" }]);
          if (v === "rename") {
            const n = await promptBox("分组名", g?.name || "");
            if (n) mutate(d, "分组改名", (x) => x.renameGroup(gid2, n));
          }
          if (v === "dissolve" && await confirmBox("解除分组", `解除「${g?.name}」？里面的条目不会删除，也不会挪位置。`, "解除")) {
            mutate(d, `解除分组「${g?.name}」`, (x) => x.dissolveGroup(gid2));
            toast("已解除分组", "success");
          }
        } else {
          st.dstCollapsed.has(gid2) ? st.dstCollapsed.delete(gid2) : st.dstCollapsed.add(gid2);
        }
        return renderDst();
      }
      const row = e.target.closest(".pa-row");
      if (row) {
        const id = row.dataset.id;
        st.gsel.has(id) ? st.gsel.delete(id) : st.gsel.add(id);
        renderDst();
      }
      return;
    }
    if (act === "top") {
      st.marker = { at: "top" };
      return renderDst();
    }
    if (act === "gstart") {
      st.marker = { at: "gstart", gid: e.target.closest("[data-act]").dataset.gid };
      return renderDst();
    }
    if (head) {
      if (act === "collapse") {
        const gid = head.dataset.gid;
        st.dstCollapsed.has(gid) ? st.dstCollapsed.delete(gid) : st.dstCollapsed.add(gid);
      } else st.marker = { at: "block", id: head.dataset.last };
      return renderDst();
    }
    const row = e.target.closest(".pa-row");
    if (row) {
      st.marker = { at: "row", id: row.dataset.id };
      renderDst();
    }
  });
  function renderBar() {
    const n = st.picked.size;
    let d = null;
    try {
      d = target();
    } catch {
    }
    bar.querySelector(".pa-picked-n").textContent = n ? `已选 ${n} 条材料` : "还没选材料";
    bar.querySelector(".pa-where").textContent = d && st.marker ? `缝到：${placeText(d, st.marker)}` : "还没选位置";
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
  // 这条材料所在的来源分组是不是整组都选了（酒馆位置条目不算）
  function wholeGroupOf(src) {
    const sd = src.srcDraft;
    if (!sd || !src.srcId) return null;
    const g = sd.groupOf(src.srcId);
    if (!g) return null;
    const picked = new Set([...st.picked.values()].filter((v) => v.srcDraft?.name === sd.name).map((v) => v.srcId));
    const mem = sd.order.map((o) => o.identifier).filter((x) => sd.groupOf(x) === g && !sd.isMarker(x));
    return mem.length && mem.every((x) => picked.has(x)) ? { key: `${sd.name}|${g}`, name: sd.group(g)?.name || "分组" } : null;
  }
  async function review() {
    const d = target();
    const marker = fixPlace(d, st.marker);
    if (!marker) return renderDst();
    const { where, gid } = placeOf(d, marker);
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
      return { src: { ...src, sections: desc?.inside || [] }, desc, choice: {}, manual: null, enabled: true, srcGroup: wholeGroupOf(src) };
    });
    // 整组选中的来源分组：成员排在一起（在第一次出现的位置），缝到组外时可以保持成组
    const groupKeys = [];
    for (const it of items) if (it.srcGroup && !groupKeys.some((g) => g.key === it.srcGroup.key)) groupKeys.push(it.srcGroup);
    items.splice(0, items.length, ...items.reduce((acc, it) => {
      if (!it.srcGroup) acc.push(it);
      else if (!acc.some((x) => x.srcGroup?.key === it.srcGroup.key)) acc.push(...items.filter((x) => x.srcGroup?.key === it.srcGroup.key));
      return acc;
    }, []));
    const grpDefault = groupKeys.length ? "keep" : "none";
    const grpRow = gid ? "" : `<div class="pa-field-row"><span>分组</span>
                <select class="pa-select pa-select-s" data-g="grp">
                    ${groupKeys.length ? `<option value="keep">保持原分组（${esc(groupKeys.map((g) => g.name).join("、"))}）</option>` : ""}
                    <option value="none" ${grpDefault === "none" ? "selected" : ""}>不分组</option>
                    <option value="new">放进新分组</option>
                </select>
                <input class="pa-input pa-input-s" data-g="gname" placeholder="新分组名" hidden></div>`;
    const fromLabel = (it) => {
      const f = String(it.src.from || "").replace(/^世界书\s*/, "");
      return f && f !== "粘贴" ? f : "";
    };
    const nameOf = (it) => it.customName ?? (settings().nameWithSource && fromLabel(it) ? `${it.src.name}（来自${fromLabel(it)}）` : it.src.name);
    const body = el(`<div class="pa-review">
            <div class="pa-target-card">
                <div><b>位置：${esc(placeText(d, marker))}</b></div>
                ${grpRow}
                <small>附近条目的写法：${esc(t.summary)}${tgtWr.length ? `；落在 &lt;${tgtWr.map(esc).join("&gt; / &lt;")}&gt; 里面` : ""}</small>
                ${tgtProf.lines.length ? `<details class="pa-explain"><summary>目标预设的写法（${tgtProf.lines.length} 条）</summary><ul class="pa-notes">${tgtProf.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
                <label class="pa-inline-check"><input type="checkbox" data-g="inj" ${settings().followTargetInjection ? "checked" : ""}> 按目标写法缝入时，角色和注入位置也跟随目标</label>
                <label class="pa-inline-check"><input type="checkbox" data-g="from" ${settings().nameWithSource ? "checked" : ""}> 条目名后面加上「（来自 来源预设）」</label>
            </div>
            <div class="pa-items"></div>
        </div>`);
    const box = body.querySelector(".pa-items");
    const initName = (() => {
      const id = findInitEntry(d);
      return id ? d.prompt(id)?.name : null;
    })();
    // 正文缩略预览：开头几行 + 结尾几行（变量、标题这些改动通常就在头尾）
    const snip = (text) => {
      const lines = String(text || "").split("\n").filter((l) => l.trim() && !/^\s*(-{3,}|\*{3,}|={3,})\s*$/.test(l));
      const cut = (l) => (l = l.trim(), l.length > 46 ? l.slice(0, 46) + "…" : l);
      const show = lines.length <= 5 ? lines.map(cut) : [...lines.slice(0, 2).map(cut), "⋯", ...lines.slice(-2).map(cut)];
      return esc(show.join("\n"));
    };
    const hookBlock = (it) => {
      const h = it.hook;
      if (h.status !== "hook") return `<div class="pa-hook pa-hook-${esc(h.status)}"><small><b>思维链：</b>${esc(h.text)}</small></div>`;
      const cotName = esc(d.prompt(h.cotId)?.name || "");
      const more = (h.cotIds || []).length > 1 ? `（共 ${h.cotIds.length} 个思维链版本）` : "";
      let detail = "";
      if (it.hookOn && h.mode === "text") {
        detail = `<label class="pa-field pa-field-wide"><span>在「${cotName}」里加这一行${more}</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>${h.needle ? `加在提到 ${esc(h.needle)} 的那一行后面` : "加在这条思维链的末尾"}。条目正文不用改。</small>`;
      } else if (it.hookOn && (h.mode === "append" || h.mode === "slot")) {
        detail = `<label class="pa-field pa-field-wide"><span>${h.mode === "slot" ? "登记的问句" : "追加的内容"}</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label>
            <small>条目末尾加 {{${h.mode === "slot" ? "setvar" : "addvar"}::${esc(h.varName)}::…}}。「${cotName}」本来就读「${esc(h.varName)}」，思维链不用改。</small>`;
      } else if (it.hookOn) {
        detail = `<div class="pa-item-ctl">
                <label class="pa-field"><span>问句变量</span><input class="pa-input pa-input-s" data-c="hv" value="${esc(h.varName)}"></label>
                <label class="pa-field pa-field-wide"><span>思维链里问什么</span><input class="pa-input" data-c="hq" value="${esc(h.question)}"></label></div>
            ${h.clash ? `<p class="pa-warn">目标里已经有变量「${esc(h.varName)}」了，用这个名字会和原来的内容互相覆盖，建议换一个</p>` : ""}
            <small>条目末尾加 {{setvar::${esc(h.varName)}::…}}；${initName ? `「${esc(initName)}」里加一行清空` : "没找到初始化条目，跳过清空"}；「${cotName}」${more}里${h.anchorVar ? `紧跟 {{getvar::${esc(h.anchorVar)}}} ` : ""}加 {{getvar::${esc(h.varName)}}}。</small>`;
      }
      return `<div class="pa-hook">
            <label class="pa-inline-check"><input type="checkbox" data-c="hook" ${it.hookOn ? "checked" : ""}> <b>挂进思维链</b></label>
            <small>${esc(h.text)}${it.hookOn || h.on ? "" : "。" + esc(h.offHint || "")}</small>${detail}</div>`;
    };
    const renderItem = (it, i) => {
      const src = { ...it.src, name: it.src.name };
      const base = { ...it.choice };
      delete base.shape;
      const planFix = planItem(src, t, base);
      const planSlot = t.slot && !planFix.slotAllowed ? planItem(src, t, { ...base, shape: t.slot.shape }) : null;
      const rawContent = String(it.src.content || "");
      const same = planFix.content.trim() === rawContent.trim();
      let mode = it.choice.mode || (same ? "raw" : "fix");
      if (mode === "slot" && !planSlot) mode = "fix";
      it.mode = mode;
      const chosen = mode === "raw" ? { content: rawContent, label: planFix.label, want: { shape: "plain" }, slotAllowed: false } : mode === "slot" ? planSlot : planFix;
      it.plan = chosen;
      const taken = new Set(items.filter((o) => o !== it && o.hookOn && o.hook?.varName).map((o) => o.hook.varName));
      const srcCot = it.desc?.cot ? ["var", "chain", "mention"].includes(it.desc.cot.level) : null;
      const collectors = chosen.want?.shape === "wrap" && chosen.want.varName === t.varName ? t.readerIds.filter((r) => !isCotEntry(d, r)) : [];
      try {
        it.hook = planHook(d, where, gid, { content: chosen.content, name: it.src.name, label: planFix.label }, { taken, varName: it.choice.hookVar || void 0, question: it.choice.hookQ ?? void 0, srcCot, allowSlot: mode === "slot" || planFix.slotAllowed, collector: collectors.length ? d.prompt(collectors[0])?.name : null });
      } catch (e) {
        console.warn("[裁缝铺] 思维链检查失败", e);
        it.hook = { status: "skip", on: false, text: "思维链检查出错，跳过" };
      }
      it.hookOn = it.hook.status === "hook" && (it.choice.hook ?? (mode === "raw" ? false : it.hook.on));
      it.finalContent = it.hookOn ? contentWithHook(chosen.content, it.hook) : chosen.content;
      // 两边差异提醒（不管哪种缝法都要知道的）
      const warns = [];
      const sp = it.src.prompt;
      if (sp?.injection_position === 1) warns.push(`来源里它插在聊天记录里（深度 ${sp.injection_depth ?? 4}）。直接缝入会保留；按目标写法缝入时${settings().followTargetInjection ? "放到普通位置" : "也保留"}`);
      if ((sp?.injection_trigger || []).length) warns.push("来源里它只在特定生成方式下发送，这个设置会一起带过去");
      if (hasScript(it.src.content || "")) warns.push("带脚本（EJS 等），目标这边也要装同样的插件才会生效");
      if (hasConditional(it.src.content || "")) warns.push("带 {{if}} 条件，用到的变量目标里也要有");
      for (const k of it.desc?.needsVars || []) {
        const nm2 = k.replace(/^全局:/, "");
        const has = d.preset.prompts.some((p) => listVarMacros(p.content || "").some((m) => m.name === nm2 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)));
        if (!has) warns.push(`它会读取变量「${nm2}」，但目标里没有条目写这个变量，这部分会是空的`);
      }
      for (const w of it.desc?.inside || []) {
        const tw = tgtProf.wrappers.find((x) => x.name === w);
        if (!tw || tgtWr.includes(w)) continue;
        warns.push(`来源里它在 ${tw.label} 里面；目标的 ${tw.label} 在「${d.prompt(tw.openId)?.name}」和「${d.prompt(tw.closeId)?.name}」之间，现在选的位置不在里面`);
      }
      const card = (value, title, sub, content, notes = []) => `<label class="pa-mode${mode === value ? " on" : ""}">
            <span class="pa-mode-head"><input type="radio" name="pa-mode-${i}" data-c="mode" value="${value}" ${mode === value ? "checked" : ""}><b>${esc(title)}</b><small>${esc(sub)}</small></span>
            <pre class="pa-snip">${snip(content)}</pre>
            ${notes.length && mode === value ? `<ul class="pa-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</label>`;
      const modes = same && !planSlot ? card("raw", "直接缝入", "目标写法和来源一样，不用改", rawContent) : [
        card("raw", "直接缝入", "不改写法，原样放进去", rawContent),
        card("fix", "按目标写法缝入", `照「${d.name}」的写法改好`, planFix.content, [...(planFix.changes.length ? planFix.changes : ["内容不用改，只是位置、角色跟随目标"]), ...planFix.warnings.map((w) => "⚠ " + w)]),
        planSlot ? card("slot", `按目标写法缝入，并加入单选「${t.slot.varName}」`, "开它会顶掉同类里开着的那条", planSlot.content, planSlot.changes) : ""
      ].join("");
      const showAdv = mode !== "raw" && (/[{]{2}/.test(chosen.content) || t.headerTpl || t.tagTpl || t.ownTag);
      return `<article class="pa-item" data-i="${i}">
                <header><label class="pa-inline-check"><input type="checkbox" data-c="on" ${it.enabled ? "checked" : ""}> 缝进来后开启</label>
                <input class="pa-input pa-input-s" data-c="name" value="${esc(nameOf(it))}" aria-label="条目名"></header>
                ${it.desc ? `<details class="pa-was"><summary>在「${esc(it.src.from || "")}」里是怎么用的</summary><ul class="pa-notes">${it.desc.lines.map((l) => `<li>${esc(l)}</li>`).join("")}${it.desc.cot ? `<li>${esc(it.desc.cot.text)}</li>` : ""}</ul></details>` : `<small class="pa-from">来自 ${esc(it.src.from || "")}</small>`}
                <div class="pa-modes" role="radiogroup">${modes}</div>
                ${warns.length ? `<ul class="pa-notes">${warns.map((w) => `<li class="pa-warn">${esc(w)}</li>`).join("")}</ul>` : ""}
                ${hookBlock(it)}
                ${showAdv ? `<details class="pa-adv" ${it.choice.adv ? "open" : ""}><summary>高级</summary>
                <div class="pa-item-ctl">
                    <label class="pa-field"><span>标题/标签里用的名字</span><input class="pa-input pa-input-s" data-c="label" value="${esc(planFix.label)}"></label>
                    ${chosen.want?.varName && (chosen.want.shape === "wrap" || chosen.want.shape === "tagname") ? `<label class="pa-field"><span>变量</span><input class="pa-input pa-input-s" data-c="var" value="${esc(chosen.want.varName)}"></label>
                    <label class="pa-field"><span>方式</span><select class="pa-select" data-c="op"><option value="add" ${chosen.want.op !== "set" ? "selected" : ""}>addvar 追加（可多选）</option><option value="set" ${chosen.want.op === "set" ? "selected" : ""}>setvar 覆盖（单选）</option></select></label>` : ""}
                    ${planFix.sourceShape.extras?.length ? `<label class="pa-inline-check"><input type="checkbox" data-c="extras" ${it.choice.keepExtras ? "checked" : ""}> 带上来源附带的 ${planFix.sourceShape.extras.length} 个额外宏</label>` : ""}
                </div></details>` : ""}
                <details class="pa-body" ${it.bodyOpen ? "open" : ""}><summary>缝进去的完整正文${it.manual != null ? "（你手动改过）" : ""}</summary>
                <textarea class="pa-input pa-text" data-c="content" spellcheck="false">${esc(it.manual ?? it.finalContent)}</textarea>
                ${it.manual != null ? '<button class="pa-link" data-c="reset">撤销手动修改，按上面的选项重新生成</button>' : ""}</details>
            </article>`;
    };
    const rerender = (art, it) => {
      const i = Number(art.dataset.i);
      it.bodyOpen = art.querySelector(".pa-body")?.open || void 0;
      it.choice.adv = art.querySelector(".pa-adv")?.open || void 0;
      art.outerHTML = renderItem(it, i);
    };
    box.innerHTML = items.map(renderItem).join("");
    const grpSel = body.querySelector("[data-g=grp]");
    const grpName = body.querySelector("[data-g=gname]");
    grpSel?.addEventListener("change", () => {
      grpName.hidden = grpSel.value !== "new";
      if (!grpName.hidden) grpName.focus();
    });
    body.querySelector("[data-g=from]").addEventListener("change", (e) => {
      settings().nameWithSource = e.target.checked;
      saveSettings();
      box.querySelectorAll(".pa-item").forEach((art) => {
        const it = items[Number(art.dataset.i)];
        const inp = art.querySelector("[data-c=name]");
        if (inp && it.customName == null) inp.value = nameOf(it);
      });
    });
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
        it.customName = e.target.value;
        return;
      }
      if (c2 === "content") {
        it.manual = e.target.value;
        return;
      }
      if (c2 === "mode") it.choice.mode = e.target.value;
      if (c2 === "var") it.choice.varName = e.target.value.trim();
      if (c2 === "op") it.choice.op = e.target.value;
      if (c2 === "label") it.choice.label = e.target.value;
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
    const ok = await sheet({ title: `缝 ${items.length} 条到「${d.name}」`, body, wide: true, noFocus: true, actions: [{ label: "再想想", value: null }, {
      label: "缝进去",
      kind: "primary",
      validate: () => {
        if (grpSel?.value === "new" && !grpName.value.trim()) {
          grpName.focus();
          toast("填一下新分组名");
          return false;
        }
        return true;
      },
      value: (w) => ({ inj: w.querySelector("[data-g=inj]").checked, grp: grpSel?.value || "none", gname: grpName?.value.trim() || "" })
    }] });
    if (!ok) return;
    settings().followTargetInjection = ok.inj;
    saveSettings();
    let newIds = [];
    const inits = [];
    const hooked = [];
    mutate(d, `缝合 ${items.length} 条`, (x) => {
      const prompts = items.map((it) => {
        const content = it.manual ?? it.finalContent ?? it.plan.content;
        const prompt = buildPrompt(x, it.src, { content }, t, { keepSourceInjection: it.mode === "raw" || !ok.inj });
        prompt.name = nameOf(it);
        const v = it.plan.want;
        if ((v.shape === "wrap" || v.shape === "tagname") && v.varName && v.varName !== t.varName) {
          const initId = t.initId || findInitEntry(x);
          if (initId && ensureInit(x, v.varName, initId)) inits.push(v.varName);
        }
        return { prompt, enabled: it.enabled };
      });
      newIds = x.insertPrompts(prompts, where, gid);
      if (!gid && ok.grp === "new") x.createGroup(ok.gname, newIds);
      if (!gid && ok.grp === "keep") {
        // 整组选中的来源分组：在目标里照原名建组（它们已经排在一起了）
        for (const g of groupKeys) {
          const mem = newIds.filter((_, i) => items[i].srcGroup?.key === g.key);
          if (mem.length) x.createGroup(g.name, mem);
        }
      }
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
          hooked.push(`${nameOf(it)} → ${r.cotName}`);
        }
      });
    });
    st.picked.clear();
    // 下次接着往后缝：落在新分组里就放在这组后面，否则接在最后一条后面
    const lastNew = newIds[newIds.length - 1];
    st.marker = !gid && d.groupOf(lastNew) ? fixPlace(d, { at: "block", id: lastNew }) : { at: "row", id: lastNew };
    toast(`缝好了 ${newIds.length} 条${hooked.length ? `，${hooked.length} 条挂进思维链` : ""}${inits.length ? `，初始化条目补了变量 ${inits.join("、")}` : ""}`, "success");
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
    await sheet({ title: "两边的写法", body: `<div>${parts.join("") || '<p class="pa-empty">先选来源预设</p>'}</div>`, wide: true, actions: [{ label: "知道了", kind: "primary", value: true }] });
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

