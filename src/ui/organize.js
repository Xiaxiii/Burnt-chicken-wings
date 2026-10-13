function mountOrganize(page) {
  const st = {
    selected: /* @__PURE__ */ new Set(),
    collapsed: null,
    collapsedFor: null,
    query: "",
    moveMode: false,
    highlight: /* @__PURE__ */ new Set(),
    expanded: new Set()
  };
  page.innerHTML = `
        <div class="pa-toolbar">
            <div class="pa-picker-slot"></div>
            <div class="pa-search-row"><input class="pa-input pa-search" type="search" placeholder="搜条目名" aria-label="搜索条目">
            <button class="pa-btn pa-tools-more" data-tool="menu">工具</button></div>
            <div class="pa-tools">
                <button class="pa-btn pa-btn-soft" data-tool="smart">智能分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="fold">全部折叠</button>
                <button class="pa-btn pa-btn-soft" data-tool="unfold">全部展开</button>
                <button class="pa-btn pa-btn-soft" data-tool="backup">备份</button>
            </div>
        </div>
        <div class="pa-movebar" hidden><b class="pa-move-n"></b><button class="pa-btn pa-sq" data-mv="up" aria-label="上移一格">↑</button><button class="pa-btn pa-sq" data-mv="down" aria-label="下移一格">↓</button><button class="pa-btn pa-btn-soft" data-mv="end">放到最后</button><button class="pa-btn pa-btn-primary" data-mv="cancel">完成</button><small>点组名＝放在组后；展开组再点条目＝放进组内</small></div>
        <div class="pa-scroll pa-list" role="list"></div>
        <div class="pa-selbar" hidden>
            <div class="pa-selbar-top"><b class="pa-selcount"></b>
                <button class="pa-link" data-sel="all">全选可见</button><button class="pa-link" data-sel="none">取消选择</button></div>
            <div class="pa-selbar-btns">
                <button class="pa-btn pa-btn-primary" data-sel="moveto">移动</button>
                <button class="pa-btn" data-sel="newgroup">建分组</button>
                <button class="pa-btn" data-sel="on">开</button>
                <button class="pa-btn" data-sel="off">关</button>
                <button class="pa-btn" data-sel="more">更多</button>
            </div>
        </div>`;
  const list = page.querySelector(".pa-list");
  const selbar = page.querySelector(".pa-selbar");
  const movebar = page.querySelector(".pa-movebar");
  const search = page.querySelector(".pa-search");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (name) => {
    st.selected.clear();
    setFocusPreset(name);
  });
  const draft = () => getDraft(focusPreset());
  function ensureCollapsed(d) {
    if (st.collapsedFor === d.name && st.collapsed) return;
    st.collapsedFor = d.name;
    st.collapsed = new Set(d.groups.groups.filter((g) => g.collapsed).map((g) => g.id));
  }
  function render() {
    let d;
    try {
      d = draft();
    } catch (e) {
      list.innerHTML = `<p class="pa-empty">${esc(e.message)}</p>`;
      return;
    }
    ensureCollapsed(d);
    picker.set(d.name);
    for (const id of [...st.selected]) if (!d.order.some((o) => o.identifier === id)) st.selected.delete(id);
    const top = list.scrollTop;
    list.innerHTML = renderList(d, { mode: "organize", place: st.moveMode, selected: st.selected, collapsed: st.collapsed, query: st.query, highlight: st.highlight });
    list.scrollTop = top;
    list.classList.toggle("pa-placing", st.moveMode);
    const n = st.selected.size;
    selbar.hidden = n === 0 || st.moveMode;
    movebar.hidden = !st.moveMode;
    page.querySelector(".pa-selcount").textContent = `已选 ${n} 条`;
    page.querySelector(".pa-move-n").textContent = `移动 ${n} 条到…`;
    if (st.highlight.size) {
      const first = list.querySelector(".pa-flash");
      first?.scrollIntoView({ block: "center" });
      setTimeout(() => {
        st.highlight.clear();
        list.querySelectorAll(".pa-flash").forEach((x) => x.classList.remove("pa-flash"));
      }, 1600);
    }
  }
  const ordered = () => {
    const d = draft();
    return settings().keepClickOrder ? [...st.selected] : d.sortByOrder([...st.selected]);
  };
  // gid：放进哪个组；null＝放在组外（整组选中的分组会保持成组）
  function doMove(where, gid, label = "移动") {
    const d = draft();
    const ids = ordered();
    mutate(d, label, (x) => x.place(ids, where, gid));
    st.moveMode = false;
    toast(`已移动 ${ids.length} 条`, "success");
    flash(ids);
    render();
  }
  function flash(ids) {
    ids.forEach((i) => st.highlight.add(i));
  }
  list.addEventListener("click", async (e) => {
    const d = draft();
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const rowEl = e.target.closest(".pa-row");
    const head = e.target.closest(".pa-ghead");
    if (act === "drag") return;
    if (e.target.closest(".pa-switch") && act !== "toggle" && act !== "gtoggle") return;
    if (act === "toggle") {
      const id = rowEl.dataset.id;
      mutate(d, "开关", (x) => x.setEnabled([id], actEl.checked));
      return;
    }
    if (act === "peek") {
      e.stopPropagation();
      return peek(d, rowEl.dataset.id);
    }
    if (st.moveMode && act === "top") return doMove({ index: 0 }, null, "移到最前");
    if (head) {
      const gid = head.dataset.gid;
      if (st.moveMode && act !== "collapse") {
        const blockIds = d.blocks().find((b) => b.ids.includes(head.dataset.last))?.ids || [];
        if (blockIds.every((i) => st.selected.has(i))) return toast("这组就是要移动的，点别处");
        return doMove({ after: head.dataset.last }, null, "移到组后");
      }
      if (act === "collapse" || !act) {
        st.collapsed.has(gid) ? st.collapsed.delete(gid) : st.collapsed.add(gid);
        return render();
      }
      if (act === "gtoggle") {
        mutate(d, "整组开关", (x) => x.setGroupEnabled(gid, actEl.checked));
        return;
      }
      if (act === "gmenu") return groupMenu(d, gid);
      if (act === "gselect") {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
        const all = ids.every((i) => st.selected.has(i));
        ids.forEach((i) => all ? st.selected.delete(i) : st.selected.add(i));
        return render();
      }
      return;
    }
    if (act === "gstart") {
      if (st.moveMode) return doMove({ groupStart: actEl.dataset.gid }, actEl.dataset.gid, "移到组内最前");
      return;
    }
    if (rowEl) {
      const id = rowEl.dataset.id;
      if (st.moveMode) {
        if (st.selected.has(id)) return toast("这条就是要移动的，点别处");
        return doMove({ after: id }, d.groupOf(id), "移到条目后");
      }
      // 点整行＝选中/取消；看内容点右边的眼睛
      st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
      render();
    }
  });
  search.addEventListener("input", () => {
    st.query = search.value;
    render();
  });
  page.querySelector(".pa-toolbar").addEventListener("click", async (e) => {
    let t = e.target.closest("[data-tool]")?.dataset.tool;
    if (!t) return;
    if (t === "menu") {
      t = await pickBox("工具", [{ label: "智能分组", sub: "把挨在一起的同类条目框起来", value: "smart" }, { label: "全部折叠", value: "fold" }, { label: "全部展开", value: "unfold" }, { label: "备份与恢复", value: "backup" }]);
      if (!t) return;
    }
    const d = draft();
    if (t === "fold") {
      d.groups.groups.forEach((g) => st.collapsed.add(g.id));
      render();
    }
    if (t === "unfold") {
      st.collapsed.clear();
      render();
    }
    if (t === "smart") smartGroups(d);
    if (t === "backup") backups(d.name);
  });
  movebar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-mv]")?.dataset.mv;
    if (a === "cancel") {
      st.moveMode = false;
      render();
    }
    if (a === "end") doMove({ index: draft().order.length }, null, "移到最后");
    if (a === "up" || a === "down") {
      const ids = ordered();
      mutate(draft(), "移动", (x) => x.moveStep(ids, a === "up" ? -1 : 1));
      flash(ids);
      render();
    }
  });
  selbar.addEventListener("change", (e) => {
    if (e.target.dataset.opt === "clickorder") {
      settings().keepClickOrder = e.target.checked;
      saveSettings();
    }
  });
  selbar.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-sel]")?.dataset.sel;
    if (!a) return;
    const d = draft();
    const ids = ordered();
    if (a === "none") {
      st.selected.clear();
      return render();
    }
    if (a === "all") {
      list.querySelectorAll(".pa-row").forEach((r) => st.selected.add(r.dataset.id));
      return render();
    }
    if (a === "more") {
      const v = await pickBox(`已选 ${ids.length} 条`, [
        { label: "移入已有分组…", value: "intogroup" },
        { label: "移出分组", value: "ungroup" },
        { label: "按标签顺序排列…", value: "sorttags" },
        { label: settings().keepClickOrder ? "✓ 移动/建组时按点选先后排" : "移动/建组时按点选先后排", sub: "不勾就保持原来的先后", value: "clickorder" },
        { label: "删除", value: "delete" }
      ]);
      if (!v) return;
      if (v === "clickorder") {
        settings().keepClickOrder = !settings().keepClickOrder;
        saveSettings();
        return toast(settings().keepClickOrder ? "已改为按点选先后排" : "已改为保持原来的先后");
      }
      return selAction(v);
    }
    return selAction(a);
  });
  async function selAction(a) {
    const d = draft();
    const ids = ordered();
    if (a === "newgroup") {
      const name = await promptBox("新分组名字", "", "比如：文风、小剧场");
      if (!name) return;
      mutate(d, "新建分组", (x) => x.createGroup(name, ids, { keepClickOrder: settings().keepClickOrder }));
      st.selected.clear();
      flash(ids);
      toast(`已建分组「${name}」`, "success");
      return render();
    }
    if (a === "intogroup") {
      const groups = d.groups.groups.map((g) => ({ label: g.name, sub: `${d.order.filter((o) => d.groupOf(o.identifier) === g.id).length} 条`, value: g.id }));
      groups.push({ label: "＋ 新建一个分组…", value: "__new" });
      const gid = await pickBox("移入哪个分组？", groups, { hint: "会排到这个组的最后面" });
      if (!gid) return;
      if (gid === "__new") return selAction("newgroup");
      mutate(d, "移入分组", (x) => x.moveIntoGroup(ids, gid, { keepClickOrder: settings().keepClickOrder }));
      st.selected.clear();
      flash(ids);
      st.collapsed.delete(gid);
      return render();
    }
    if (a === "sorttags") { await sortTagsDialog(d, ids); return render(); }
    if (a === "moveto") {
      st.moveMode = true;
      return render();
    }
    if (a === "up" || a === "down") {
      mutate(d, "移动", (x) => x.moveStep(ids, a === "up" ? -1 : 1));
      return render();
    }
    if (a === "on" || a === "off") {
      mutate(d, a === "on" ? "批量开" : "批量关", (x) => x.setEnabled(ids, a === "on"));
      return;
    }
    if (a === "ungroup") {
      mutate(d, "移出分组", (x) => x.removeFromGroup(ids));
      return;
    }
    if (a === "delete") {
      if (ids.some((id) => d.isMarker(id))) return toast("选中的里面有酒馆位置条目（聊天记录、角色描述之类），这些不能删", "warning");
      if (!await confirmBox("删除条目", `从预设里删掉选中的 ${ids.length} 条？可使用顶部撤销或备份恢复。`, "删除", true)) return;
      mutate(d, "删除", (x) => x.deletePrompts(ids));
      st.selected.clear();
      return render();
    }
  }
  async function groupMenu(d, gid) {
    const g = d.group(gid);
    const parts = d.blocks().filter((b) => b.groupId === gid).length;
    const items = [
      { label: "重命名", value: "rename" },
      { label: "整组上移", value: "up" },
      { label: "整组下移", value: "down" }
    ];
    if (parts > 1) items.splice(2, 0, { label: `收拢（现在分散成 ${parts} 段）`, value: "gather" });
    items.push({ label: "解散分组（条目保留）", value: "dissolve" });
    const v = await pickBox(`分组「${g?.name}」`, items);
    if (!v) return;
    if (v === "rename") {
      const name = await promptBox("分组名字", g.name);
      if (name) mutate(d, "重命名分组", (x) => x.renameGroup(gid, name));
    }
    if (v === "select") {
      d.order.filter((o) => d.groupOf(o.identifier) === gid).forEach((o) => st.selected.add(o.identifier));
      render();
    }
    if (v === "gather") mutate(d, "收拢分组", (x) => x.gatherGroup(gid));
    if (v === "up" || v === "down") mutate(d, "整组移动", (x) => x.moveGroupBlock(gid, v === "up" ? -1 : 1));
    if (v === "dissolve" && await confirmBox("解散分组", `解散「${g.name}」？条目保留。`, "解散")) mutate(d, "解散分组", (x) => x.dissolveGroup(gid));
  }
  async function peek(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    const s = detectShape(p.content);
    const info = s.shape === "wrap" || s.shape === "tagname" ? `${SHAPE_LABEL[s.shape]}「${s.varName}」` : SHAPE_LABEL[s.shape];
    const marker = d.isMarker(id);
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名字</span><input class="pa-input" data-f="name" value="${esc(p.name || "")}"></label>
            <p class="pa-hint">写法：${esc(info)}${p.injection_position === 1 ? ` \xB7 聊天内注入，深度 ${esc(p.injection_depth)}` : ""} \xB7 角色 ${esc(p.role || "system")}</p>
            ${marker ? '<p class="pa-hint">酒馆位置条目，没有正文。</p>' : `<textarea class="pa-input pa-text" data-f="content" spellcheck="false">${esc(p.content || "")}</textarea>`}
        </div>`);
    body.addEventListener("input", (e) => {
      if (!e.target.matches("[data-f=name], [data-f=content]")) return;
      if (!body._edited) { d.snapshot("编辑条目"); body._edited = true; }
      d.prompt(id)[e.target.dataset.f] = e.target.value;
      d.dirty = true; emitChange(d.name);
    });
    const r = await sheet({ title: "条目内容（输入自动保存）", body, wide: true, noFocus: true, actions: [{ label: "关闭", value: null }, { label: "改好了", kind: "primary", value: (w) => ({ name: w.querySelector("[data-f=name]").value, content: w.querySelector("[data-f=content]")?.value }) }] });
    if (!r) return;
    if (r.name === p.name && (r.content === void 0 || r.content === p.content)) return;
    mutate(d, "编辑条目", (x) => {
      const q = x.prompt(id);
      q.name = r.name;
      if (r.content !== void 0) q.content = r.content;
    });
  }
  async function smartGroups(d) {
    const sug = suggestGroups(d);
    if (!sug.length) return toast("没有可自动分组的连续条目");
    const body = el(`<div><p class="pa-hint">只框连续条目，不改顺序。</p>
            <div class="pa-sug">${sug.map((g, i) => `<div class="pa-sug-item">
                <label class="pa-inline-check"><input type="checkbox" data-i="${i}" checked></label>
                <div class="pa-sug-main"><input class="pa-input pa-input-s" data-n="${i}" value="${esc(g.name)}">
                <small>${g.ids.length} 条 \xB7 ${esc(g.reason)} \xB7 ${esc(d.prompt(g.ids[0])?.name)} … ${esc(d.prompt(g.ids[g.ids.length - 1])?.name)}</small></div></div>`).join("")}</div></div>`);
    const r = await sheet({ title: `建议 ${sug.length} 个分组`, body, wide: true, noFocus: true, actions: [{ label: "取消", value: null }, { label: "建这些分组", kind: "primary", value: (w) => sug.map((g, i) => ({ ...g, on: w.querySelector(`[data-i="${i}"]`).checked, name: w.querySelector(`[data-n="${i}"]`).value.trim() || g.name })).filter((g) => g.on) }] });
    if (!r || !r.length) return;
    mutate(d, "智能分组", (x) => {
      for (const g of r) x.createGroup(g.name, g.ids);
    });
    r.forEach((g) => st.collapsed.add(x_last(d, g)));
    toast(`已建 ${r.length} 个分组`, "success");
    render();
  }
  const x_last = (d, g) => d.groupOf(g.ids[0]);
  async function backups(name) {
    let list2 = [];
    try {
      list2 = await backupList(name);
    } catch (e) {
      return toast("读不到备份：" + e.message, "error");
    }
    if (!list2.length) return toast("这个预设还没有备份");
    const items = list2.map((b2) => ({ label: new Date(b2.time).toLocaleString(), sub: b2.reason, value: b2.id }));
    const id = await pickBox(`「${name}」的备份`, items);
    if (!id) return;
    const b = await backupGet(id);
    const how = await pickBox("这个备份要…", [{ label: "恢复到草稿", value: "restore" }, { label: "下载 JSON 文件", value: "download" }]);
    if (how === "download") {
      const blob = new Blob([JSON.stringify(b.data, null, 4)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}-备份-${new Date(b.time).toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
    }
    if (how === "restore") {
      const d = getDraft(name);
      mutate(d, "恢复备份", (x) => {
        const tmp = new x.constructor(name, b.data);
        x.preset = tmp.preset;
        x.groups = tmp.groups;
      });
      toast("已恢复", "success");
    }
  }
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".pa-handle");
    if (!h || st.moveMode) return;
    e.preventDefault();
    const d = draft();
    const rowEl = h.closest(".pa-row");
    const id = rowEl.dataset.id;
    const ids = st.selected.has(id) ? ordered() : [id];
    const ghost = el(`<div class="pa-ghost">${ICON.grip}<span>${esc(d.prompt(id)?.name || id)}${ids.length > 1 ? ` 等 ${ids.length} 条` : ""}</span></div>`);
    page.append(ghost);
    const line = el('<div class="pa-drop-line"></div>');
    list.append(line);
    ids.forEach((i) => list.querySelector(`.pa-row[data-id="${CSS.escape(i)}"]`)?.classList.add("pa-dragging"));
    drag = { ids, ghost, line, target: null, y: e.clientY, x: e.clientX, raf: 0, pid: e.pointerId };
    try {
      h.setPointerCapture(e.pointerId);
    } catch {
    }
    moveGhost(e.clientX, e.clientY);
    drag.raf = requestAnimationFrame(autoScroll);
  });
  function moveGhost(x, y) {
    drag.x = x;
    drag.y = y;
    const pr = page.getBoundingClientRect();
    drag.ghost.style.transform = `translate(12px, ${y - pr.top - 18}px)`;
    drag.ghost.style.visibility = "hidden";
    const under = document.elementFromPoint(x, y);
    drag.ghost.style.visibility = "";
    const lr = list.getBoundingClientRect();
    let target = null;
    let lineY = null;
    const row = under?.closest?.(".pa-row");
    const head = under?.closest?.(".pa-ghead");
    if (row && list.contains(row) && !drag.ids.includes(row.dataset.id)) {
      const r = row.getBoundingClientRect();
      const after = y > r.top + r.height / 2;
      target = { where: after ? { after: row.dataset.id } : { before: row.dataset.id }, gid: draft().groupOf(row.dataset.id) };
      lineY = (after ? r.bottom : r.top) - lr.top + list.scrollTop;
    } else if (head && list.contains(head)) {
      // 组头上半＝放在这组前面（组外）；下半：展开着＝组内最前，折叠着＝这组后面（组外）
      const r = head.getBoundingClientRect();
      const box = head.closest(".pa-group").getBoundingClientRect();
      const upper = y < r.top + r.height / 2;
      const open = !head.closest(".pa-group").classList.contains("pa-collapsed");
      if (upper) {
        target = { where: { before: head.dataset.first }, gid: null };
        lineY = box.top - lr.top + list.scrollTop - 3;
      } else if (open) {
        target = { where: { before: head.dataset.first }, gid: head.dataset.gid };
        lineY = r.bottom - lr.top + list.scrollTop;
      } else {
        target = { where: { after: head.dataset.last }, gid: null };
        lineY = box.bottom - lr.top + list.scrollTop + 3;
      }
    }
    drag.target = target;
    if (lineY == null) drag.line.style.display = "none";
    else {
      drag.line.style.display = "block";
      drag.line.style.top = `${lineY - 1}px`;
    }
  }
  function autoScroll() {
    if (!drag) return;
    const r = list.getBoundingClientRect();
    const edge = 56;
    let dy = 0;
    if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 4);
    else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 4);
    if (dy) {
      list.scrollTop += dy;
      moveGhost(drag.x, drag.y);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  const endDrag = (commit) => {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.line.remove();
    const { ids, target } = drag;
    drag = null;
    if (commit && target) {
      const d = draft();
      mutate(d, "拖动", (x) => x.place(ids, target.where, target.gid));
      flash(ids);
    } else render();
  };
  list.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.pid) {
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    }
  });
  list.addEventListener("pointerup", (e) => {
    if (drag && e.pointerId === drag.pid) endDrag(true);
  });
  list.addEventListener("pointercancel", () => endDrag(false));
  const off = onDraftChange(() => {
    if (page.isConnected && !page.hidden) render();
  });
  return { render, destroy: off, focusIds: (ids) => {
    const d = draft();
    ids.forEach((i) => {
      const g = d.groupOf(i);
      if (g) st.collapsed.delete(g);
    });
    flash(ids);
    render();
  } };
}

