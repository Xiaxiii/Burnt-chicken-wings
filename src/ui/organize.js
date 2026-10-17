// 1.7.5 双层分组提示。去掉过一次又出现，说明有别的地方拿旧版本写回来了：说清楚是谁（本机能抓到时）、该怎么办
function dupBannerHtml(d, dups) {
  const fixed = settings().mirrorFixed?.[d.name];
  const w = settings().mirrorWrites?.[d.name];
  const when = (t) => { const x = new Date(t); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const names = esc(dups.slice(0, 4).map((g) => g.name).join("、")) + (dups.length > 4 ? " 等" : "");
  if (!fixed) return `<div class="pa-card pa-card-warn pa-dupgroups"><p><b>这个预设的分组存了两份，所以每个分组里又套了一层同名分组。</b></p><small>预设里同时有柏宝箱分组和另一种分组格式（entryGrouping），两个扩展各显示一层。共 ${dups.length} 个分组重复：${names}。去掉重复的一层后，条目和分组都不变。</small><div class="pa-card-act"><button class="pa-btn pa-btn-primary pa-btn-s" data-dup="fix">去掉重复的一层</button></div></div>`;
  const who = w && w.at > fixed
    ? `${when(w.at)} 在这台设备上，是${w.by ? `「${esc(w.by)}」` : "酒馆的「保存预设」"}把旧分组写回了预设。`
    : "这台设备上没看到谁写回来的，多半是另一台设备或另一个浏览器标签页里开着的酒馆：它内存里还是旧版本，一保存就把旧分组写回去了。";
  const known = w && w.at > fixed && w.by;
  const todo = known
    ? `「${esc(w.by)}」会把它自己记着的分组写进预设（entryGrouping），关掉它的条目分组功能也照写，去掉多少次都会回来。<br>只要酒馆里分组显示正常（没有套两层），这份数据留着不影响使用，点「保留，不再提示」即可；之后焦香鸡翅保存时也不再动它，不会和它来回改。`
    : "先把其他设备、其他标签页里的酒馆刷新一下（或关掉），再点「再去掉一次」。如果分组显示已经正常，也可以点「保留，不再提示」。";
  return `<div class="pa-card pa-card-warn pa-dupgroups"><p><b>重复的一层去掉过（${when(fixed)}），又被写回来了。</b></p><small>${who}<br>${todo}<br>共 ${dups.length} 个分组重复：${names}。</small><div class="pa-card-act"><button class="pa-btn pa-btn-primary pa-btn-s" data-dup="keep">保留，不再提示</button><button class="pa-btn pa-btn-s" data-dup="fix">再去掉一次</button></div></div>`;
}
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
            <button class="pa-icon-btn" data-tool="search" aria-label="搜索条目" title="搜索条目">🔍</button>
            <button class="pa-icon-btn pa-tools-more" data-tool="add" aria-label="新建" title="新建条目或分组">＋</button>
            <button class="pa-icon-btn pa-tools-more" data-tool="menu" aria-label="工具" title="工具">⋯</button>
            <div class="pa-searchrow" hidden><input class="pa-input pa-search" type="search" placeholder="🔍 搜索条目名、标签、分组名" aria-label="搜索条目"></div>
            <div class="pa-tools">
                <button class="pa-btn pa-btn-soft" data-tool="newgroup">＋ 新建分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="newentry">＋ 新建条目</button>
                <button class="pa-btn pa-btn-soft" data-tool="smart">智能分组</button>
                <button class="pa-btn pa-btn-soft" data-tool="fold">全部折叠</button>
                <button class="pa-btn pa-btn-soft" data-tool="clickorder"></button>
            </div>
        </div>
        <div class="pa-movebar" hidden><b class="pa-move-n"></b>
            <button class="pa-btn pa-sq" data-mv="up" aria-label="上移一位">↑</button><button class="pa-btn pa-sq" data-mv="down" aria-label="下移一位">↓</button><button class="pa-btn pa-btn-soft" data-mv="end">移到最后</button>
            <button class="pa-btn" data-mv="cancel">退出移动</button><small class="pa-move-hint"></small></div>
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
    // 1.7.5 双层分组提示
    const dups = placing || st.query || settings().mirrorIgnore?.[d.name] ? [] : d.dupEntryGroups();
    const dupBanner = dups.length ? dupBannerHtml(d, dups) : "";
    list.innerHTML = dupBanner + renderList(d, { mode: "organize", place: placing, inside: st.mode !== "newgroup", selected: st.mode === "newgroup" ? void 0 : st.selected, collapsed: st.collapsed, query: st.query, searchBody: st.searchBody, highlight: st.highlight });
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
    const co = page.querySelector("[data-tool=clickorder]");
    co.textContent = `多选排列：${settings().keepClickOrder ? "按点选先后" : "保持原顺序"}`;
    co.title = "移动、建组时，多选条目按什么先后排列。点击切换";
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
    if (e.target.closest("[data-act=qbody]")) {
      st.searchBody = !st.searchBody;
      return render();
    }
    if (e.target.closest("[data-dup=keep]")) {
      if (!settings().mirrorIgnore || typeof settings().mirrorIgnore !== "object") settings().mirrorIgnore = {};
      settings().mirrorIgnore[draft().name] = true;
      saveSettings();
      toast("这个预设里的 entryGrouping 保留，不再提示；焦香鸡翅保存时也不再动它", "success");
      return render();
    }
    if (e.target.closest("[data-dup=fix]")) {
      if (settings().mirrorIgnore) delete settings().mirrorIgnore[draft().name];
      const d = draft();
      const n = d.dupEntryGroups().length;
      mutate(d, "去掉重复的分组", (x) => {
        const dupKeys = new Set(x.dupEntryGroups().map((g) => `${g.id}|${g.name}`));
        const eg = x.preset.extensions.entryGrouping.filter((g) => !g || !dupKeys.has(`${g.id}|${g.name}`));
        if (eg.length) x.preset.extensions.entryGrouping = eg;
        else delete x.preset.extensions.entryGrouping;
      });
      if (!settings().mirrorFixed || typeof settings().mirrorFixed !== "object") settings().mirrorFixed = {};
      settings().mirrorFixed[d.name] = Date.now();
      saveSettings();
      toast(`已去掉 ${n} 个重复的分组`, "success");
      return;
    }
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
    if (!search.value.trim()) st.searchBody = false;
    st.query = search.value;
    render();
  });
  page.querySelector(".pa-toolbar").addEventListener("click", async (e) => {
    let t = e.target.closest("[data-tool]")?.dataset.tool;
    if (!t) return;
    const d = draft();
    if (t === "menu") {
      const keep = settings().keepClickOrder;
      t = await pickBox("工具", [
        { label: "智能分组", sub: "把相邻的同类条目建成分组", value: "smart" },
        { label: allFolded(d) ? "全部展开" : "全部折叠", value: "fold" },
        { label: `多选排列：${keep ? "按点选先后" : "保持原顺序"}`, sub: "移动、建组时，多选条目按什么先后排列。点击切换", value: "clickorder" }
      ]);
      if (!t) return;
    }
    if (t === "search") {
      const row = page.querySelector(".pa-searchrow");
      row.hidden = !row.hidden;
      if (row.hidden && st.query) {
        st.query = "";
        search.value = "";
        render();
      }
      if (!row.hidden) search.focus();
      return;
    }
    if (t === "add") {
      t = await pickBox("新建", [
        { label: "＋ 新建条目", sub: "放在选中的条目之后；没选时放在最后", value: "newentry" },
        { label: "＋ 新建分组", sub: "先起名，再点一个位置", value: "newgroup" }
      ]);
      if (!t) return;
    }
    if (t === "newgroup") return startNewGroup();
    if (t === "newentry") return newEntry();
    if (t === "clickorder") {
      settings().keepClickOrder = !settings().keepClickOrder;
      saveSettings();
      toast(`多选排列：${settings().keepClickOrder ? "按点选先后" : "保持原顺序"}`);
      return render();
    }
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
      // 只选看得见的：折叠分组里的条目不选，免得接着「关闭」「删除」动到看不见的条目
      list.querySelectorAll(".pa-row").forEach((r) => {
        if (!r.closest(".pa-collapsed")) st.selected.add(r.dataset.id);
      });
      return render();
    }
    if (a === "more") {
      const v = await pickBox(`已选 ${ids.length} 条`, [
        { label: "移入分组…", value: "intogroup" },
        { label: "移出分组", value: "ungroup" },
        { label: "复制", sub: "每条的副本放在原条目后面", value: "copy" },
        { label: "按变量名排序…", sub: "按条目登记的变量名（如 文风1、文风2）分类，类别内按编号排", value: "sorttags" },
        { label: "删除", value: "delete" }
      ]);
      if (!v) return;
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
    if (a === "copy") {
      if (ids.some((id) => d.isMarker(id))) return toast("系统位置条目（如聊天记录、角色描述）不能复制", "warning");
      let made = [];
      mutate(d, `复制 ${ids.length} 条`, (x) => {
        for (const id of [...ids].reverse()) {
          const p = x.prompt(id);
          const on = x.order.find((o) => o.identifier === id)?.enabled !== false;
          made.push(...x.insertPrompts([{ prompt: { ...clone(p), identifier: uid(), name: `${p.name || id}（副本）` }, enabled: on }], { after: id }, x.groupOf(id)));
        }
      });
      st.selected.clear();
      flash(made);
      toast(`已复制 ${made.length} 条`, "success");
      return render();
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
  // 新建条目：先起名，放在选中的那条后面（没选就放最后），然后打开编辑
  async function newEntry() {
    const d = draft();
    const name = await promptBox("新条目名称", "", "例如：文风·简洁");
    if (!name) return;
    const sel = ordered();
    const after = sel.length ? sel[sel.length - 1] : null;
    let id = null;
    mutate(d, `新建条目「${name}」`, (x) => {
      const where = after ? { after } : { index: x.order.length };
      [id] = x.insertPrompts([{ prompt: { identifier: uid(), name, content: "", role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], forbid_overrides: false }, enabled: true }], where, after ? x.groupOf(after) : null);
    });
    st.selected.clear();
    const g = d.groupOf(id);
    if (g) st.collapsed.delete(g);
    flash([id]);
    render();
    return peek(getDraft(d.name), id);
  }
  async function peek(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    const s = detectShape(p.content);
    const info = s.shape === "wrap" || s.shape === "tagname" ? `${SHAPE_LABEL[s.shape]}「${s.varName}」` : SHAPE_LABEL[s.shape];
    const marker = d.isMarker(id);
    const depthPos = p.injection_position === 1;
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(p.name || "")}"></label>
            ${marker ? '<p class="pa-hint">系统位置条目，正文由酒馆填入，这里只能改名称。</p>' : `
            <div class="pa-item-ctl">
              <label class="pa-field"><span>角色</span><select class="pa-select" data-f="role">${[["system", "系统"], ["user", "用户"], ["assistant", "AI"]].map(([k, l]) => `<option value="${k}" ${(p.role || "system") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
              <label class="pa-field"><span>位置</span><select class="pa-select" data-f="pos"><option value="0" ${depthPos ? "" : "selected"}>按条目顺序</option><option value="1" ${depthPos ? "selected" : ""}>插入聊天记录（按深度）</option></select></label>
              <label class="pa-field" data-show="depth" ${depthPos ? "" : "hidden"}><span>深度</span><input class="pa-input" type="number" min="0" data-f="depth" value="${esc(p.injection_depth ?? 4)}"></label>
              <label class="pa-field" data-show="depth" ${depthPos ? "" : "hidden"}><span>同深度时的顺序</span><input class="pa-input" type="number" data-f="order" value="${esc(p.injection_order ?? 100)}"></label>
            </div>
            <div class="pa-edit-bar"><p class="pa-hint">写法：${esc(info)}</p><button type="button" class="pa-icon-btn pa-expand" data-f="expand" aria-label="展开正文" title="展开正文">${ICON.expand}</button></div>
            <textarea class="pa-input pa-text pa-edit-text" data-f="content" spellcheck="false">${esc(p.content || "")}</textarea>`}
        </div>`);
    // 展开：正文占满弹窗，其他设置先收起；再点一次恢复
    body.querySelector("[data-f=expand]")?.addEventListener("click", (e) => {
      const sh = body.closest(".pa-sheet");
      const on = !sh.classList.contains("pa-sheet-max");
      sh.classList.toggle("pa-sheet-max", on);
      e.currentTarget.innerHTML = on ? ICON.collapse : ICON.expand;
      e.currentTarget.setAttribute("aria-label", on ? "收起正文" : "展开正文");
      e.currentTarget.title = on ? "收起正文" : "展开正文";
      body.querySelector("[data-f=content]")?.focus({ preventScroll: true });
    });
    body.querySelector("[data-f=pos]")?.addEventListener("change", (e) => {
      body.querySelectorAll("[data-show=depth]").forEach((x) => { x.hidden = e.target.value !== "1"; });
    });
    // 输入时不保存；点「保存」才写进预设，点「取消」或 ✕ 不改动
    const r = await sheet({
      title: "编辑条目", body, wide: true, noFocus: true,
      onMount: (w) => { if (!marker) w.querySelector(".pa-sheet").classList.add("pa-sheet-edit"); },
      actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (w) => {
        const v = (k) => w.querySelector(`[data-f=${k}]`)?.value;
        return { name: v("name"), content: v("content"), role: v("role"), pos: v("pos"), depth: v("depth"), order: v("order") };
      } }]
    });
    if (!r) return;
    // 弹窗开着时草稿可能被换过（切换预设、别处修改），按名称重新取
    const dd = getDraft(d.name);
    const cur = dd.prompt(id);
    if (!cur) return toast("条目已不存在，未保存", "warning");
    const next = { name: r.name };
    if (r.content !== void 0) {
      next.content = r.content;
      next.role = r.role || "system";
      next.injection_position = r.pos === "1" ? 1 : 0;
      if (next.injection_position === 1) {
        next.injection_depth = Math.max(0, Math.floor(Number(r.depth) || 0));
        next.injection_order = Math.floor(Number(r.order) || 100);
      }
    }
    const changed = Object.entries(next).some(([k, v]) => (cur[k] ?? (k === "role" ? "system" : k === "injection_position" ? 0 : "")) !== v);
    if (!changed) return;
    mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
    toast("已保存", "success");
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
  return { render: () => {
    picker.refresh();
    render();
  }, destroy: off, focusIds: (ids) => {
    const d = draft();
    ids.forEach((i) => {
      const g = d.groupOf(i);
      if (g) st.collapsed.delete(g);
    });
    flash(ids);
    render();
  } };
}
