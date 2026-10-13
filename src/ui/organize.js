function mountOrganize(page) {
  const st = {
    selected: /* @__PURE__ */ new Set(),
    collapsed: null,
    collapsedFor: null,
    query: "",
    // null：普通；"move"：给选中的条目选位置；"newgroup"：给新分组选位置
    mode: null,
    newName: "",
    keep: [],
    highlight: /* @__PURE__ */ new Set()
  };
  page.innerHTML = `
        <div class="pa-toolbar">
            <div class="pa-picker-slot"></div>
            <div class="pa-search-row"><input class="pa-input pa-search" type="search" placeholder="搜索条目" aria-label="搜索条目">
            <button class="pa-btn" data-tool="newgroup">＋ 新建分组</button>
            <button class="pa-btn pa-tools-more" data-tool="menu">工具</button></div>
            <div class="pa-tools">
                <button class="pa-btn pa-btn-soft" data-tool="smart">智能分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="fold">全部折叠</button>
            </div>
        </div>
        <div class="pa-movebar" hidden><b class="pa-move-n"></b>
            <button class="pa-btn pa-sq" data-mv="up" aria-label="上移一位">↑</button><button class="pa-btn pa-sq" data-mv="down" aria-label="下移一位">↓</button><button class="pa-btn pa-btn-soft" data-mv="end">移到最后</button>
            <button class="pa-btn pa-btn-primary" data-mv="cancel">取消</button><small class="pa-move-hint"></small></div>
        <div class="pa-scroll pa-list" role="list"></div>
        <div class="pa-selbar" hidden>
            <div class="pa-selbar-top"><b class="pa-selcount"></b>
                <button class="pa-link" data-sel="all">全选</button><button class="pa-btn pa-btn-s pa-selcancel" data-sel="none">取消</button></div>
            <div class="pa-selbar-btns">
                <button class="pa-btn pa-btn-primary" data-sel="moveto">移动</button>
                <button class="pa-btn" data-sel="newgroup">建成分组</button>
                <button class="pa-btn" data-sel="on">开启</button>
                <button class="pa-btn" data-sel="off">关闭</button>
                <button class="pa-btn" data-sel="more">更多</button>
            </div>
        </div>`;
  const list = page.querySelector(".pa-list");
  const selbar = page.querySelector(".pa-selbar");
  const movebar = page.querySelector(".pa-movebar");
  const search = page.querySelector(".pa-search");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (name) => {
    st.selected.clear();
    st.mode = null;
    setFocusPreset(name);
  });
  const draft = () => getDraft(focusPreset());
  function ensureCollapsed(d) {
    if (st.collapsedFor === d.name && st.collapsed) return;
    st.collapsedFor = d.name;
    st.collapsed = new Set(d.groups.groups.filter((g) => g.collapsed).map((g) => g.id));
  }
  const allFolded = (d) => d.groups.groups.length > 0 && d.groups.groups.every((g) => st.collapsed.has(g.id));
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
    const placing = !!st.mode;
    const top = list.scrollTop;
    list.innerHTML = renderList(d, { mode: "organize", place: placing, inside: st.mode !== "newgroup", selected: st.mode === "newgroup" ? void 0 : st.selected, collapsed: st.collapsed, query: st.query, highlight: st.highlight });
    list.scrollTop = top;
    list.classList.toggle("pa-placing", placing);
    const n = st.selected.size;
    selbar.hidden = n === 0 || placing;
    movebar.hidden = !placing;
    movebar.classList.toggle("pa-movebar-ng", st.mode === "newgroup");
    page.querySelector(".pa-selcount").textContent = `已选 ${n} 条`;
    page.querySelector(".pa-move-n").textContent = st.mode === "newgroup" ? `新分组「${st.newName}」的位置` : `移动 ${n} 条`;
    page.querySelector(".pa-move-hint").textContent = st.mode === "newgroup" ? "点组名：放在该组之后。点条目：放在该条目之后。" : "点组名：移到该组之后。展开分组后点条目：移入组内。";
    movebar.querySelectorAll("[data-mv=up], [data-mv=down], [data-mv=end]").forEach((b) => { b.hidden = st.mode === "newgroup"; });
    page.querySelector("[data-tool=fold]").textContent = allFolded(d) ? "全部展开" : "全部折叠";
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
  // gid：放进哪个组；null＝放在组外（整组选中的分组保持成组）
  function doMove(where, gid, label = "移动") {
    const d = draft();
    const ids = ordered();
    mutate(d, label, (x) => x.place(ids, where, gid, { keep: st.keep }));
    st.mode = null;
    st.keep = [];
    st.selected.clear();
    if (gid) st.collapsed.delete(gid);
    toast(`已移动 ${ids.length} 条`, "success");
    flash(ids);
    render();
  }
  function flash(ids) {
    ids.forEach((i) => st.highlight.add(i));
  }
  function showGroup(gid) {
    st.collapsed.delete(gid);
    render();
    list.querySelector(`.pa-group[data-gid="${CSS.escape(gid)}"]`)?.scrollIntoView({ block: "center" });
  }
  // 新建空白分组：先起名，再点位置
  async function startNewGroup() {
    const name = await promptBox("新分组名称", "", "例如：文风");
    if (!name) return;
    st.newName = name;
    st.mode = "newgroup";
    render();
  }
  function placeNewGroup(m) {
    const d = draft();
    const p = placeOf(d, m);
    const anchor = p.where.index === 0 ? "" : p.where.after;
    let gid = null;
    mutate(d, `新建分组「${st.newName}」`, (x) => { gid = x.createEmptyGroup(st.newName, anchor); });
    toast(`已新建分组「${st.newName}」`, "success");
    st.mode = null;
    showGroup(gid);
  }
  list.addEventListener("click", async (e) => {
    const d = draft();
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const rowEl = e.target.closest(".pa-row");
    const head = e.target.closest(".pa-ghead");
    if (act === "drag" || act === "gdrag") return;
    if (e.target.closest(".pa-switch") && act !== "toggle" && act !== "gtoggle") return;
    if (act === "toggle") {
      mutate(d, "开关", (x) => x.setEnabled([rowEl.dataset.id], actEl.checked));
      return;
    }
    if (act === "peek") {
      e.stopPropagation();
      return peek(d, rowEl.dataset.id);
    }
    if (st.mode && act === "collapse" && head) {
      const gid = head.dataset.gid;
      st.collapsed.has(gid) ? st.collapsed.delete(gid) : st.collapsed.add(gid);
      return render();
    }
    if (st.mode) {
      const m = placeFromClick(d, e, st.mode !== "newgroup");
      if (!m) return;
      if (st.mode === "newgroup") return placeNewGroup(m);
      if (m.at === "row" && st.selected.has(m.id)) return toast("不能移到自身之后");
      if (m.at === "block" && m.id) {
        const b = d.blocks().find((x) => x.ids.includes(m.id));
        if (b?.ids.every((i) => st.selected.has(i))) return toast("不能移到自身之后");
      }
      const p = placeOf(d, m);
      return doMove(p.where, p.gid, m.at === "block" ? "移到组后" : m.at === "gstart" ? "移入分组" : m.at === "top" ? "移到最前" : "移动");
    }
    if (head) {
      const gid = head.dataset.gid;
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
    if (rowEl) {
      const id = rowEl.dataset.id;
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
    const d = draft();
    if (t === "menu") {
      t = await pickBox("工具", [
        { label: "智能分组", sub: "把相邻的同类条目建成分组", value: "smart" },
        { label: allFolded(d) ? "全部展开" : "全部折叠", value: "fold" }
      ]);
      if (!t) return;
    }
    if (t === "newgroup") return startNewGroup();
    if (t === "fold") {
      if (allFolded(d)) st.collapsed.clear();
      else d.groups.groups.forEach((g) => st.collapsed.add(g.id));
      render();
    }
    if (t === "smart") smartGroups(d);
  });
  movebar.addEventListener("click", (e) => {
    const a = e.target.closest("[data-mv]")?.dataset.mv;
    if (a === "cancel") {
      if (st.mode === "move") st.selected.clear();
      st.mode = null;
      st.keep = [];
      return render();
    }
    if (st.mode !== "move") return;
    if (a === "end") doMove({ index: draft().order.length }, null, "移到最后");
    if (a === "up" || a === "down") {
      const ids = ordered();
      mutate(draft(), "移动", (x) => x.moveStep(ids, a === "up" ? -1 : 1));
      flash(ids);
      render();
    }
  });
  selbar.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-sel]")?.dataset.sel;
    if (!a) return;
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
      const keep = settings().keepClickOrder;
      const v = await pickBox(`已选 ${ids.length} 条`, [
        { label: "移入分组…", value: "intogroup" },
        { label: "移出分组", value: "ungroup" },
        { label: "按标签排序…", value: "sorttags" },
        { label: `排列方式：${keep ? "按点选先后" : "保持原顺序"}`, sub: "移动、建组时条目的先后。点击切换", value: "clickorder" },
        { label: "删除", value: "delete" }
      ]);
      if (!v) return;
      if (v === "clickorder") {
        settings().keepClickOrder = !keep;
        saveSettings();
        return toast(`排列方式：${!keep ? "按点选先后" : "保持原顺序"}`);
      }
      return selAction(v);
    }
    return selAction(a);
  });
  async function selAction(a) {
    const d = draft();
    const ids = ordered();
    if (a === "newgroup") {
      const name = await promptBox("新分组名称", "", "例如：文风");
      if (!name) return;
      let gid = null;
      mutate(d, "建成分组", (x) => { gid = x.createGroup(name, ids, { keepClickOrder: settings().keepClickOrder }); });
      st.selected.clear();
      flash(ids);
      toast(`已建成分组「${name}」`, "success");
      return showGroup(gid);
    }
    if (a === "intogroup") {
      const groups = d.groups.groups.filter((g) => !d.isEmptyGroup(g.id) || g.anchor !== void 0).map((g) => ({ label: g.name, sub: `${d.order.filter((o) => d.groupOf(o.identifier) === g.id).length} 条`, value: g.id }));
      groups.push({ label: "＋ 新建分组…", value: "__new" });
      const gid = await pickBox("移入分组", groups, { hint: "条目排在组内最后" });
      if (!gid) return;
      if (gid === "__new") return selAction("newgroup");
      mutate(d, "移入分组", (x) => x.moveIntoGroup(ids, gid, { keepClickOrder: settings().keepClickOrder }));
      st.selected.clear();
      flash(ids);
      st.collapsed.delete(gid);
      return render();
    }
    if (a === "sorttags") {
      await sortTagsDialog(d, ids);
      return render();
    }
    if (a === "moveto") {
      st.mode = "move";
      st.keep = [];
      return render();
    }
    if (a === "on" || a === "off") {
      mutate(d, a === "on" ? "批量开启" : "批量关闭", (x) => x.setEnabled(ids, a === "on"));
      return;
    }
    if (a === "ungroup") {
      mutate(d, "移出分组", (x) => x.removeFromGroup(ids));
      return;
    }
    if (a === "delete") {
      if (ids.some((id) => d.isMarker(id))) return toast("选中的条目包含系统位置条目（如聊天记录、角色描述），不能删除", "warning");
      if (!await confirmBox("删除条目", `删除选中的 ${ids.length} 条？可撤销，也可从备份恢复。`, "删除", true)) return;
      mutate(d, "删除", (x) => x.deletePrompts(ids));
      st.selected.clear();
      return render();
    }
  }
  async function groupMenu(d, gid) {
    const g = d.group(gid);
    if (d.isEmptyGroup(gid)) {
      const v2 = await pickBox(`分组「${g?.name}」`, [{ label: "重命名", value: "rename" }, { label: "删除空分组", value: "dissolve" }]);
      if (v2 === "rename") {
        const name = await promptBox("分组名称", g.name);
        if (name) mutate(d, "重命名分组", (x) => x.renameGroup(gid, name));
      }
      if (v2 === "dissolve") mutate(d, "删除空分组", (x) => x.dissolveGroup(gid));
      return;
    }
    const parts = d.blocks().filter((b) => b.groupId === gid).length;
    const items = [
      { label: "重命名", value: "rename" },
      { label: "移动整组…", sub: "再点目标位置", value: "move" },
      { label: "上移一位", value: "up" },
      { label: "下移一位", value: "down" }
    ];
    if (parts > 1) items.push({ label: `合并分散的 ${parts} 段`, value: "gather" });
    items.push({ label: "解散分组", sub: "条目保留在原位置", value: "dissolve" });
    const v = await pickBox(`分组「${g?.name}」`, items);
    if (!v) return;
    if (v === "rename") {
      const name = await promptBox("分组名称", g.name);
      if (name) mutate(d, "重命名分组", (x) => x.renameGroup(gid, name));
    }
    if (v === "move") {
      st.selected = new Set(d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier));
      st.keep = [gid];
      st.mode = "move";
      render();
    }
    if (v === "gather") mutate(d, "合并分组", (x) => x.gatherGroup(gid));
    if (v === "up" || v === "down") mutate(d, "移动分组", (x) => x.moveGroupBlock(gid, v === "up" ? -1 : 1));
    if (v === "dissolve" && await confirmBox("解散分组", `解散「${g.name}」？条目保留在原位置。`, "解散")) mutate(d, "解散分组", (x) => x.dissolveGroup(gid));
  }
  async function peek(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    const s = detectShape(p.content);
    const info = s.shape === "wrap" || s.shape === "tagname" ? `${SHAPE_LABEL[s.shape]}「${s.varName}」` : SHAPE_LABEL[s.shape];
    const marker = d.isMarker(id);
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(p.name || "")}"></label>
            <p class="pa-hint">写法：${esc(info)} \xB7 角色：${esc(p.role || "system")}${p.injection_position === 1 ? ` \xB7 插入聊天记录，深度 ${esc(p.injection_depth)}` : ""}</p>
            ${marker ? '<p class="pa-hint">系统位置条目，无正文。</p>' : `<textarea class="pa-input pa-text" data-f="content" spellcheck="false">${esc(p.content || "")}</textarea>`}
        </div>`);
    body.addEventListener("input", (e) => {
      if (!e.target.matches("[data-f=name], [data-f=content]")) return;
      if (!body._edited) {
        d.snapshot("编辑条目");
        body._edited = true;
      }
      d.prompt(id)[e.target.dataset.f] = e.target.value;
      d.dirty = true;
      emitChange(d.name);
    });
    await sheet({ title: "编辑条目", body, wide: true, noFocus: true, actions: [{ label: "完成", kind: "primary", value: true }] });
  }
  async function smartGroups(d) {
    const sug = suggestGroups(d);
    if (!sug.length) return toast("没有可自动分组的相邻条目");
    const body = el(`<div><p class="pa-hint">只把相邻条目建成分组，不改变顺序。</p>
            <div class="pa-sug">${sug.map((g, i) => `<div class="pa-sug-item">
                <label class="pa-inline-check"><input type="checkbox" data-i="${i}" checked></label>
                <div class="pa-sug-main"><input class="pa-input pa-input-s" data-n="${i}" value="${esc(g.name)}">
                <small>${g.ids.length} 条 \xB7 ${esc(g.reason)} \xB7 ${esc(d.prompt(g.ids[0])?.name)} … ${esc(d.prompt(g.ids[g.ids.length - 1])?.name)}</small></div></div>`).join("")}</div></div>`);
    const r = await sheet({ title: `建议新建 ${sug.length} 个分组`, body, wide: true, noFocus: true, actions: [{ label: "取消", value: null }, { label: "新建分组", kind: "primary", value: (w) => sug.map((g, i) => ({ ...g, on: w.querySelector(`[data-i="${i}"]`).checked, name: w.querySelector(`[data-n="${i}"]`).value.trim() || g.name })).filter((g) => g.on) }] });
    if (!r || !r.length) return;
    mutate(d, "智能分组", (x) => {
      for (const g of r) x.createGroup(g.name, g.ids);
    });
    r.forEach((g) => st.collapsed.add(d.groupOf(g.ids[0])));
    toast(`已新建 ${r.length} 个分组`, "success");
    render();
  }
  // ---- 拖动：条目右侧的把手拖条目；分组头右侧的把手拖整个分组
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".pa-handle");
    if (!h || st.mode) return;
    e.preventDefault();
    const d = draft();
    const head = h.closest(".pa-ghead");
    let ids, label, group = null;
    if (head) {
      group = head.dataset.gid;
      ids = d.order.filter((o) => d.groupOf(o.identifier) === group).map((o) => o.identifier);
      label = `分组「${d.group(group)?.name || ""}」`;
      head.closest(".pa-group").classList.add("pa-dragging");
    } else {
      const id = h.closest(".pa-row").dataset.id;
      ids = st.selected.has(id) ? ordered() : [id];
      label = `${d.prompt(id)?.name || id}${ids.length > 1 ? ` 等 ${ids.length} 条` : ""}`;
      ids.forEach((i) => list.querySelector(`.pa-row[data-id="${CSS.escape(i)}"]`)?.classList.add("pa-dragging"));
    }
    const ghost = el(`<div class="pa-ghost">${ICON.grip}<span>${esc(label)}</span></div>`);
    page.append(ghost);
    const line = el('<div class="pa-drop-line"></div>');
    list.append(line);
    drag = { ids, group, ghost, line, target: null, y: e.clientY, x: e.clientX, raf: 0, pid: e.pointerId };
    try {
      h.setPointerCapture(e.pointerId);
    } catch {
    }
    moveGhost(e.clientX, e.clientY);
    drag.raf = requestAnimationFrame(autoScroll);
  });
  // 拖整个分组：只能落在分组之间或散条目之间
  function groupTarget(under, y, lr) {
    const d = draft();
    const sec = under?.closest?.(".pa-group");
    const loose = !sec && under?.closest?.(".pa-loose .pa-row");
    const box = sec || loose;
    if (!box || !list.contains(box) || sec?.dataset.gid === drag.group) return null;
    const r = box.getBoundingClientRect();
    const upper = y < r.top + r.height / 2;
    const lineY = (upper ? r.top - 3 : r.bottom + 3) - lr.top + list.scrollTop;
    if (loose) return { where: upper ? { before: loose.dataset.id } : { after: loose.dataset.id }, gid: null, lineY };
    const hd = sec.querySelector(".pa-ghead");
    const gid = hd.dataset.gid;
    if (upper) return { where: hd.dataset.first ? { before: hd.dataset.first } : d.afterEmpty(gid), gid: null, lineY };
    return { where: hd.dataset.last ? { after: hd.dataset.last } : { ...d.afterEmpty(gid), behind: gid }, gid: null, lineY };
  }
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
    if (drag.group) {
      target = groupTarget(under, y, lr);
      lineY = target?.lineY ?? null;
    } else {
      const row = under?.closest?.(".pa-row");
      const head = under?.closest?.(".pa-ghead");
      if (row && list.contains(row) && !drag.ids.includes(row.dataset.id)) {
        const r = row.getBoundingClientRect();
        const after = y > r.top + r.height / 2;
        target = { where: after ? { after: row.dataset.id } : { before: row.dataset.id }, gid: draft().groupOf(row.dataset.id) };
        lineY = (after ? r.bottom : r.top) - lr.top + list.scrollTop;
      } else if (head && list.contains(head)) {
        // 组头上半＝放在这组前面（组外）；下半：展开着或空分组＝放进组内最前，折叠着＝这组后面（组外）
        const r = head.getBoundingClientRect();
        const box = head.closest(".pa-group").getBoundingClientRect();
        const upper = y < r.top + r.height / 2;
        const gid = head.dataset.gid;
        const empty = !head.dataset.first;
        const open = !head.closest(".pa-group").classList.contains("pa-collapsed");
        if (empty) {
          target = { where: draft().afterEmpty(gid), gid };
          lineY = r.bottom - lr.top + list.scrollTop;
        } else if (upper) {
          target = { where: { before: head.dataset.first }, gid: null };
          lineY = box.top - lr.top + list.scrollTop - 3;
        } else if (open) {
          target = { where: { before: head.dataset.first }, gid };
          lineY = r.bottom - lr.top + list.scrollTop;
        } else {
          target = { where: { after: head.dataset.last }, gid: null };
          lineY = box.bottom - lr.top + list.scrollTop + 3;
        }
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
    const { ids, target, group } = drag;
    drag = null;
    if (!commit || !target) return render();
    const d = draft();
    if (group && !ids.length) {
      // 空分组：只改它跟在哪一条后面
      const w = target.where;
      const anchor = w.index === 0 ? "" : w.after !== void 0 ? w.after : (() => {
        const k = d.order.findIndex((o) => o.identifier === w.before);
        return k > 0 ? d.order[k - 1].identifier : "";
      })();
      mutate(d, "移动分组", (x) => {
        x.group(group).anchor = anchor;
      });
      return;
    }
    mutate(d, group ? "移动分组" : "拖动", (x) => x.place(ids, target.where, target.gid, { keep: group ? [group] : [] }));
    flash(ids);
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
