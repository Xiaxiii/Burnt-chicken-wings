// 「预设」页：视图 条目 / 思维链 / 变量，都作用于当前预设（focusPreset）。
var PRESET_VIEWS = [["entries", "条目"], ["cot", "思维链"], ["vars", "变量"]];
function mountPresetPage(page) {
  page.innerHTML = String(html`
    <header class="cw-pagehead"><div class="cw-col">${segHtml(PRESET_VIEWS, "entries", { attr: "data-view", label: "预设视图" })}<span class="cw-gap"></span><span class="cw-viewtools"></span></div></header>
    ${PRESET_VIEWS.map(([k]) => html`<div class="cw-view" data-v="${k}" hidden></div>`)}`);
  const viewEl = (k) => page.querySelector(`.cw-view[data-v="${k}"]`);
  const tools = page.querySelector(".cw-viewtools");
  const views = {
    entries: mountEntriesView(viewEl("entries"), { goVars: () => setView("vars") }),
    cot: mountCotView(viewEl("cot"), { tools, goEntries: (ids) => { setView("entries"); views.entries.focusIds(ids); }, goVars: () => setView("vars") }),
    vars: mountVarsView(viewEl("vars"), { tools, goEntries: (ids) => { setView("entries"); views.entries.focusIds(ids); } })
  };
  let cur = PRESET_VIEWS.some(([k]) => k === settings().presetView) ? settings().presetView : "entries";
  function setView(k) {
    if (!views[k]) k = "entries";
    cur = k;
    settings().presetView = k;
    page.querySelectorAll("[data-view]").forEach((b) => { b.classList.toggle("on", b.dataset.view === k); b.setAttribute("aria-selected", String(b.dataset.view === k)); });
    page.querySelectorAll(".cw-view").forEach((v) => { v.hidden = v.dataset.v !== k; });
    tools.innerHTML = "";
    views[k].render();
  }
  page.querySelector(".cw-pagehead").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b && b.dataset.view !== cur) { closeDetail(); setView(b.dataset.view); saveSettings(); }
  });
  return {
    render: () => setView(cur),
    setView: (v) => { cur = v === "organize" ? "entries" : v; }
  };
}

// 1.7.5 双层分组提示。去掉过一次又出现，说明有别的地方拿旧版本写回来了：说清楚是谁（本机能抓到时）、该怎么办
function dupBannerHtml(d, dups) {
  const fixed = settings().mirrorFixed?.[d.name];
  const w = settings().mirrorWrites?.[d.name];
  const when = (t) => { const x = new Date(t); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const names = dups.slice(0, 4).map((g) => g.name).join("、") + (dups.length > 4 ? " 等" : "");
  if (!fixed) return html`<div class="cw-note cw-note-warn cw-dupgroups">${iconHtml("warn")}<div><b>这个预设的分组存了两份，每个分组里又套了一层同名分组。</b>
    <p class="cw-hint">预设里同时有柏宝箱分组和另一种分组格式（entryGrouping），两个扩展各显示一层。共 ${dups.length} 个分组重复：${names}。去掉重复的一层后，条目和分组都不变。</p>
    <div class="cw-card-acts">${btn("去掉重复的一层", { act: "dup-fix", kind: "primary", size: "sm" })}</div></div></div>`;
  const known = w && w.at > fixed && w.by;
  const who = w && w.at > fixed
    ? `${when(w.at)} 在这台设备上，是${w.by ? `「${w.by}」` : "酒馆的「保存预设」"}把旧分组写回了预设。`
    : "这台设备上没看到谁写回来的，多半是另一台设备或另一个浏览器标签页里开着的酒馆：它内存里还是旧版本，一保存就把旧分组写回去了。";
  const todo = known
    ? `「${w.by}」会把它自己记着的分组写进预设（entryGrouping），关掉它的条目分组功能也照写，去掉多少次都会回来。只要酒馆里分组显示正常（没有套两层），这份数据留着不影响使用，点「保留，不再提示」即可；之后焦香鸡翅保存时也不再动它。`
    : "先把其他设备、其他标签页里的酒馆刷新一下（或关掉），再点「再去掉一次」。如果分组显示已经正常，也可以点「保留，不再提示」。";
  return html`<div class="cw-note cw-note-warn cw-dupgroups">${iconHtml("warn")}<div><b>重复的一层去掉过（${when(fixed)}），又被写回来了。</b>
    <p class="cw-hint">${who}</p><p class="cw-hint">${todo}</p><p class="cw-hint">共 ${dups.length} 个分组重复：${names}。</p>
    <div class="cw-card-acts">${btn("保留，不再提示", { act: "dup-keep", kind: "primary", size: "sm" })}${btn("再去掉一次", { act: "dup-fix", size: "sm" })}</div></div></div>`;
}

function mountEntriesView(box) {
  const st = {
    selected: new Set(),
    collapsed: null,
    query: "",
    searchBody: false,
    // null：普通；"move"：给选中的条目选位置；"newgroup"：给新分组选位置
    mode: null,
    newName: "",
    keep: [],
    highlight: new Set()
  };
  box.innerHTML = String(html`
    <div class="cw-toolrow"><div class="cw-col">
      <label class="cw-search">${iconHtml("search")}<input type="text" inputmode="search" enterkeyhint="search" autocorrect="off" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="搜索条目名、标签、分组名" aria-label="搜索条目" data-q>${ibtn("close", "清空搜索", { act: "qclear", cls: "cw-search-x" })}</label>
      ${btn("新建", { act: "add", icon: "plus" })}
      ${ibtn("more", "工具", { act: "tools" })}
    </div></div>
    <div class="cw-placebar" hidden><div class="cw-col"><div class="cw-placebar-info"><b class="cw-place-n"></b><small class="cw-place-hint"></small></div>
      <span class="cw-place-steps">${ibtn("up", "上移一位", { act: "mv-up" })}${ibtn("down", "下移一位", { act: "mv-down" })}${btn("移到最后", { act: "mv-end", size: "sm" })}</span>
      ${btn("取消", { act: "mv-cancel", size: "sm" })}</div></div>
    <div class="cw-body cw-listwrap"><div class="cw-col"><div class="cw-banners"></div><div class="cw-list" role="list"></div></div></div>
    <div class="cw-bar cw-selbar" hidden><div class="cw-col">
      <div class="cw-bar-info"><b class="cw-selcount"></b><span><button type="button" class="cw-link" data-act="sel-all">全选</button><button type="button" class="cw-link" data-act="sel-none">取消选择</button></span></div>
      <div class="cw-bar-acts">${btn("移动", { act: "sel-moveto", kind: "primary", icon: "move" })}${btn("建成分组", { act: "sel-newgroup", icon: "group" })}${btn("删除", { act: "sel-delete", kind: "danger", icon: "trash" })}${ibtn("more", "更多操作", { act: "sel-more" })}</div>
    </div></div>`);
  const scroller = box.querySelector(".cw-listwrap");
  const list = box.querySelector(".cw-list");
  const banners = box.querySelector(".cw-banners");
  const selbar = box.querySelector(".cw-selbar");
  const placebar = box.querySelector(".cw-placebar");
  const search = box.querySelector("[data-q]");
  const draft = () => getDraft(focusPreset());
  let shownFor = null;
  // 分组折叠记住最后一次的状态（fold.org），没动过的组按预设里存的状态
  function setOpen(d, gid, on) {
    const k = groupFoldKeys(d).get(gid);
    if (k) foldSet("org", k, on, 600);
  }
  function ensureCollapsed(d) {
    const keys = groupFoldKeys(d);
    st.collapsed = new Set(d.groups.groups.filter((g) => !foldGet("org", keys.get(g.id), !g.collapsed)).map((g) => g.id));
  }
  const allFolded = (d) => d.groups.groups.length > 0 && d.groups.groups.every((g) => st.collapsed.has(g.id));
  function render() {
    let d;
    try {
      d = draft();
    } catch (e) {
      banners.innerHTML = "";
      list.innerHTML = String(empty(e.message));
      return;
    }
    if (shownFor !== d.name) {
      shownFor = d.name;
      st.selected.clear();
      st.mode = null;
    }
    ensureCollapsed(d);
    for (const id of [...st.selected]) if (!d.order.some((o) => o.identifier === id)) st.selected.delete(id);
    const placing = !!st.mode;
    const top = scroller.scrollTop;
    const dups = placing || st.query || settings().mirrorIgnore?.[d.name] ? [] : d.dupEntryGroups();
    const fragments = placing || st.query ? [] : fragmentedGroups(d);
    banners.innerHTML = String(html`${dups.length ? dupBannerHtml(d, dups) : ""}${fragments.length ? html`<div class="cw-note cw-group-repair">${iconHtml("info")}<div><b>${fragments.length} 个分区被拆成多段</b><p class="cw-hint">${fragments.slice(0, 4).map((g) => `${g.name}（${g.parts} 段）`).join("、")}${fragments.length > 4 ? " 等" : ""}。可按已有归属收拢到各组首段，先预览再应用。</p><div class="cw-card-acts">${btn("归整分区", { act: "repair", size: "sm" })}</div></div></div>` : ""}`);
    list.innerHTML = renderEntryList(d, { mode: "organize", place: placing, inside: st.mode !== "newgroup", selected: st.mode === "newgroup" ? void 0 : st.selected, collapsed: st.collapsed, query: st.query, searchBody: st.searchBody, highlight: st.highlight });
    scroller.scrollTop = top;
    list.classList.toggle("is-placing", placing);
    placebar.hidden = !placing;
    box.querySelector(".cw-place-n").textContent = st.mode === "newgroup" ? `新分组「${st.newName}」放在哪里` : `移动 ${st.selected.size} 条到哪里`;
    box.querySelector(".cw-place-hint").textContent = st.mode === "newgroup" ? "点组名：放在该组之后；点条目：放在该条目之后" : "点组名：移到该组之后；展开分组后点条目：移入组内";
    box.querySelector(".cw-place-steps").hidden = st.mode === "newgroup";
    paintSel();
    if (st.highlight.size) {
      list.querySelector(".cw-flash")?.scrollIntoView({ block: "center" });
      setTimeout(() => {
        st.highlight.clear();
        list.querySelectorAll(".cw-flash").forEach((x) => x.classList.remove("cw-flash"));
      }, 1600);
    }
  }
  // 只改选中状态时不重建整个列表
  function paintSel() {
    const d = draft();
    list.querySelectorAll(".cw-row[data-id]").forEach((r) => r.classList.toggle("is-sel", st.selected.has(r.dataset.id)));
    list.querySelectorAll(".cw-group[data-gid]:not(.is-empty)").forEach((sec) => {
      const gid = sec.dataset.gid;
      const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
      const all = ids.length > 0 && ids.every((i) => st.selected.has(i));
      sec.classList.toggle("is-sel", all);
      sec.querySelector(':scope > .cw-ghead [data-act="gselect"]')?.setAttribute("aria-pressed", String(all));
    });
    const n = st.selected.size;
    selbar.hidden = n === 0 || !!st.mode;
    box.querySelector(".cw-selcount").textContent = `已选 ${n} 条`;
  }
  const ordered = () => {
    const d = draft();
    return settings().keepClickOrder ? [...st.selected] : d.sortByOrder([...st.selected]);
  };
  const flash = (ids) => ids.forEach((i) => st.highlight.add(i));
  // gid：放进哪个组；null＝放在组外（整组选中的分组保持成组）
  function doMove(where, gid, label = "移动") {
    const d = draft();
    const ids = ordered();
    mutate(d, label, (x) => x.place(ids, where, gid, { keep: st.keep }));
    st.mode = null;
    st.keep = [];
    st.selected.clear();
    if (gid) setOpen(d, gid, true);
    toast(`已移动 ${ids.length} 条`, "success");
    flash(ids);
    render();
  }
  function showGroup(gid) {
    setOpen(draft(), gid, true);
    render();
    list.querySelector(`.cw-group[data-gid="${CSS.escape(gid)}"]`)?.scrollIntoView({ block: "center" });
  }
  async function startNewGroup() {
    const name = await promptBox("新分组名称", "", "例如：文风", { hint: "起名后，点列表里的组名或条目，新分组放在它后面。" });
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
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { e.stopPropagation(); setQuery(""); } });
  function setQuery(v) {
    search.value = v;
    st.query = v;
    if (!v.trim()) st.searchBody = false;
    box.querySelector(".cw-search").classList.toggle("has-q", !!v);
    render();
  }
  onSearchInput(search, () => setQuery(search.value));
  // 工具栏、选中底栏、选位置条
  box.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (!a || list.contains(e.target) || banners.contains(e.target) && !a.startsWith("dup") && a !== "repair") return;
    const d = draft();
    if (a === "qclear") { setQuery(""); return search.focus(); }
    if (a === "add") {
      const v = await pickBox("", [
        { label: "新建条目", sub: "放在选中的条目之后；没选时放在最后", value: "newentry" },
        { label: "新建分组", sub: "先起名，再点一个位置", value: "newgroup" }
      ]);
      if (v === "newgroup") return startNewGroup();
      if (v === "newentry") return newEntry();
      return;
    }
    if (a === "tools") {
      const keep = settings().keepClickOrder;
      const v = await pickBox("", [
        { label: "智能分组", sub: "识别未分组条目的归属，或归整分散分区", value: "smart" },
        { label: allFolded(d) ? "全部展开" : "全部折叠", value: "fold" },
        { sep: true },
        { label: "多选排列：按点选先后", sub: "移动、建组时，多选条目按点选的先后排列", value: "order-click", on: keep },
        { label: "多选排列：保持原顺序", sub: "按条目在预设里的先后排列", value: "order-keep", on: !keep }
      ]);
      if (v === "smart") return smartGroups(d);
      if (v === "fold") {
        const openAll = allFolded(d);
        d.groups.groups.forEach((g) => setOpen(d, g.id, openAll));
        return render();
      }
      if (v === "order-click" || v === "order-keep") {
        settings().keepClickOrder = v === "order-click";
        saveSettings();
        return toast(`多选排列：${settings().keepClickOrder ? "按点选先后" : "保持原顺序"}`);
      }
      return;
    }
    if (a === "repair") return repairGroups(d);
    if (a === "dup-keep") {
      if (!settings().mirrorIgnore || typeof settings().mirrorIgnore !== "object") settings().mirrorIgnore = {};
      settings().mirrorIgnore[d.name] = true;
      saveSettings();
      toast("这个预设里的 entryGrouping 保留，不再提示；焦香鸡翅保存时也不再动它", "success");
      return render();
    }
    if (a === "dup-fix") {
      if (settings().mirrorIgnore) delete settings().mirrorIgnore[d.name];
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
      return toast(`已去掉 ${n} 个重复的分组`, "success");
    }
    if (a === "mv-cancel") {
      if (st.mode === "move") st.selected.clear();
      st.mode = null;
      st.keep = [];
      return render();
    }
    if (st.mode === "move" && a === "mv-end") return doMove({ index: d.order.length }, null, "移到最后");
    if (st.mode === "move" && (a === "mv-up" || a === "mv-down")) {
      const ids = ordered();
      mutate(d, "移动", (x) => x.moveStep(ids, a === "mv-up" ? -1 : 1));
      flash(ids);
      return render();
    }
    if (a === "sel-none") { st.selected.clear(); return paintSel(); }
    if (a === "sel-all") {
      // 只选看得见的：折叠分组里的条目不选
      list.querySelectorAll(".cw-row").forEach((r) => { if (!r.closest(".is-col")) st.selected.add(r.dataset.id); });
      return paintSel();
    }
    if (a === "sel-more") {
      const v = await pickBox(`已选 ${st.selected.size} 条`, [
        { label: "移入分组…", value: "intogroup" },
        { label: "移出分组", value: "ungroup" },
        { pair: [{ label: "全部开启", value: "on" }, { label: "全部关闭", value: "off" }] },
        { label: "复制", sub: "每条的副本放在原条目后面", value: "copy" },
        { label: "按变量名排序…", sub: "按登记的变量名（如 文风1、文风2）分类，类别内按编号排", value: "sorttags" }
      ]);
      if (v) selAction(v);
      return;
    }
    if (a.startsWith("sel-")) return selAction(a.slice(4));
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
      setOpen(d, gid, true);
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
    if (a === "on" || a === "off") return mutate(d, a === "on" ? "批量开启" : "批量关闭", (x) => x.setEnabled(ids, a === "on"));
    if (a === "copy") {
      if (ids.some((id) => d.isMarker(id))) return toast("系统位置条目（如聊天记录、角色描述）不能复制", "warning");
      const made = [];
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
    if (a === "ungroup") return mutate(d, "移出分组", (x) => x.removeFromGroup(ids));
    if (a === "delete") {
      if (ids.some((id) => d.isMarker(id))) return toast("选中的条目包含系统位置条目（如聊天记录、角色描述），不能删除", "warning");
      if (!await confirmBox("删除条目", `删除选中的 ${ids.length} 条？可撤销${backupOn() ? "，也可从备份恢复" : ""}。`, "删除", true)) return;
      mutate(d, "删除", (x) => x.deletePrompts(ids));
      st.selected.clear();
      return render();
    }
  }
  // 列表里的点击
  let patchNext = null;
  list.addEventListener("click", async (e) => {
    const d = draft();
    if (e.target.closest('[data-act="qbody"]')) { st.searchBody = !st.searchBody; return render(); }
    const actEl = e.target.closest("[data-act]");
    const act = actEl?.dataset.act;
    const rowEl = e.target.closest(".cw-row");
    const head = e.target.closest(".cw-ghead");
    if (act === "drag" || act === "gdrag") return;
    if (e.target.closest(".cw-switch") && act !== "toggle" && act !== "gtoggle") return;
    if (act === "toggle") {
      patchNext = { kind: "row", id: rowEl.dataset.id };
      return mutate(d, "开关", (x) => x.setEnabled([rowEl.dataset.id], actEl.checked));
    }
    if (act === "edit") {
      e.stopPropagation();
      return peek(d, rowEl.dataset.id);
    }
    // 选位置时：点组名＝放在这组后面，点组名旁的箭头才展开、收起
    if (st.mode && act === "fold" && head && e.target.closest(".cw-ico")) {
      const gid = head.dataset.gid;
      setOpen(d, gid, st.collapsed.has(gid));
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
      if (act === "gtoggle") {
        patchNext = { kind: "group", gid };
        return mutate(d, "分组开关", (x) => x.setGroupEnabled(gid, actEl.checked));
      }
      if (act === "gmenu") return groupMenu(d, gid);
      if (act === "gselect") {
        const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
        const all = ids.every((i) => st.selected.has(i));
        ids.forEach((i) => all ? st.selected.delete(i) : st.selected.add(i));
        return paintSel();
      }
      setOpen(d, gid, st.collapsed.has(gid));
      return render();
    }
    if (rowEl) {
      const id = rowEl.dataset.id;
      st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
      paintSel();
    }
  });
  list.addEventListener("dblclick", (e) => {
    const rowEl = e.target.closest(".cw-row");
    if (!rowEl || st.mode || e.target.closest("[data-act]")) return;
    e.preventDefault();
    const id = rowEl.dataset.id;
    st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
    paintSel();
    peek(draft(), id);
  });
  async function groupMenu(d, gid) {
    const g = d.group(gid);
    if (d.isEmptyGroup(gid)) {
      const v2 = await pickBox(`分组「${g?.name}」`, [{ label: "重命名", value: "rename" }, { label: "删除空分组", value: "dissolve", danger: true }]);
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
      { pair: [{ label: "组内全部开启", value: "allon" }, { label: "组内全部关闭", value: "alloff" }] },
      { label: "移动整组…", sub: "再点目标位置", value: "move" },
      { pair: [{ label: "上移一位", value: "up" }, { label: "下移一位", value: "down" }] }
    ];
    if (parts > 1) items.push({ label: `合并分散的 ${parts} 段`, value: "gather" });
    items.push({ label: "解散分组", sub: "条目保留在原位置", value: "dissolve", danger: true });
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
    if (v === "gather") return repairGroups(d, gid);
    if (v === "allon" || v === "alloff") {
      const ids = d.order.filter((o) => d.groupOf(o.identifier) === gid).map((o) => o.identifier);
      mutate(d, v === "allon" ? "组内全部开启" : "组内全部关闭", (x) => x.setEnabled(ids, v === "allon"));
      toast(`「${g.name}」组内 ${ids.length} 条已全部${v === "allon" ? "开启" : "关闭"}`, "success");
    }
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
    if (g) setOpen(d, g, true);
    flash([id]);
    render();
    return peek(getDraft(d.name), id);
  }
  async function peek(d, id) {
    const p = d.prompt(id);
    if (!p) return;
    list.querySelectorAll(".cw-row.is-editing").forEach((x) => x.classList.remove("is-editing"));
    list.querySelector(`.cw-row[data-id="${CSS.escape(id)}"]`)?.classList.add("is-editing");
    const r = await editEntrySheet(p, { marker: d.isMarker(id), title: p.name || "编辑条目" });
    list.querySelectorAll(".cw-row.is-editing").forEach((x) => x.classList.remove("is-editing"));
    if (!r) return;
    // 编辑期间草稿可能被换过（切换预设、别处修改），按名称重新取
    const dd = getDraft(d.name);
    const cur = dd.prompt(id);
    if (!cur) return toast("条目已不存在，未保存", "warning");
    const next = entryChanges(cur, r);
    if (!next) return;
    mutate(dd, "编辑条目", (x) => Object.assign(x.prompt(id), next));
    toast("已保存", "success");
  }
  // 归整分散分区：勾选、预览完整顺序、应用
  async function repairGroups(d, groupId) {
    const fragments = fragmentedGroups(d).filter((g) => !groupId || g.groupId === groupId);
    if (!fragments.length) return toast("没有需要归整的分散分区");
    const original = JSON.stringify(d.toPreset());
    const positions = new Map(d.order.map((o, i) => [o.identifier, i + 1]));
    const body = el(html`<div class="cw-form">
      <p class="cw-hint">按已有分组归属，把同组条目集中到该组首次出现的位置。保留组内先后、条目正文和开关。核对预览后应用，之后可撤销。</p>
      <div class="cw-checklist">${fragments.map((g, i) => html`<label class="cw-check cw-checkrow"><input type="checkbox" data-gather="${i}" checked><span><b>${g.name}</b><small>${g.parts} 段 · ${g.ids.length} 条 · 汇到「${d.prompt(g.ids[0])?.name || g.ids[0]}」所在首段</small></span></label>`)}</div>
      <div data-preview></div></div>`);
    const selected = () => fragments.filter((g, i) => body.querySelector(`[data-gather="${i}"]`).checked).map((g) => g.groupId);
    const paint = () => {
      const plan = planGroupGather(d, selected());
      body.querySelector("[data-preview]").innerHTML = String(html`<p class="cw-hint">${plan.groups.length ? `将归整 ${plan.groups.length} 个分区，共 ${plan.groups.reduce((n, g) => n + g.ids.length, 0)} 条成员。` : "未选择分区，不会移动条目。"}只按已有归属归整，未分组条目不会被猜测归类。</p>
        ${fold(`归整后的完整顺序（${plan.order.length} 条）`, String(html`<ol class="cw-orderlist">${plan.order.map((o, i) => html`<li data-preview-id="${o.identifier}"><b>${d.prompt(o.identifier)?.name || o.identifier}</b><small>${d.group(d.groupOf(o.identifier))?.name || "未分组"} · 原第 ${positions.get(o.identifier)} 条 → 第 ${i + 1} 条 · ${o.enabled === false ? "关闭" : "开启"}</small></li>`)}</ol>`))}`);
      const apply = body.closest(".cw-dlg")?.querySelector(".cw-btn-primary");
      if (apply) apply.disabled = plan.groups.length === 0;
    };
    body.addEventListener("change", paint);
    const result = await dialog({ title: "归整分散分区", body, size: "lg", noFocus: true, onMount: paint, actions: [{ label: "取消", value: null }, { label: "应用归整", kind: "primary", value: selected }] });
    if (!result?.length) return;
    if (focusPreset() !== d.name || getDraft(d.name) !== d || JSON.stringify(d.toPreset()) !== original) return toast("预设已变化，请重新预览归整", "warning");
    const plan = planGroupGather(d, result);
    if (!plan.groups.length) return;
    mutate(d, "归整分散分区", (x) => { findOrderList(x.preset).order = plan.order; });
    toast(`已归整 ${plan.groups.length} 个分区，可撤销`, "success");
    render();
  }
  // 智能分组：识别未分组条目的归属，逐条可改目标，预览完整顺序后应用
  async function smartGroups(d) {
    const fragments = fragmentedGroups(d);
    if (fragments.length) {
      const mode = await pickBox("智能分组", [
        { label: `归整分散的 ${fragments.length} 个分区`, sub: "按已有归属集中到各组首段，先预览再应用", value: "gather" },
        { label: "识别未分组条目并归入分区", sub: "识别分区标记，可移入已有分区或新建", value: "new" }
      ]);
      if (!mode) return;
      if (mode === "gather") return repairGroups(d);
    }
    const scan = groupingSuggestions(d), rows = [...scan.suggestions, ...scan.unassigned];
    if (!rows.length) return toast("当前没有待归组的条目");
    const original = JSON.stringify(d.toPreset());
    const positions = new Map(d.order.map((o, i) => [o.identifier, i + 1]));
    const rowHtml = (g, i) => {
      const target = g.targetGroupId ? `group:${g.targetGroupId}` : g.needsChoice ? "choose" : "new";
      return html`<div class="cw-card cw-sug" data-grouping-row="${i}">
        <label class="cw-check"><input type="checkbox" data-grouping-on="${i}"${g.needsChoice ? "" : raw(" checked")} aria-label="采用${g.name}的归组建议"><span><b>${g.name} · ${g.ids.length} 条</b><small title="${g.reason}">${g.reason}</small></span></label>
        <div class="cw-form-row">
          <label class="cw-field"><span>归入分区</span><select class="cw-select" data-grouping-target="${i}"><option value="choose"${target === "choose" ? raw(" selected") : ""}>请选择目标</option><option value="new"${target === "new" ? raw(" selected") : ""}>＋ 新建分组</option>${d.groups.groups.map((group) => html`<option value="group:${group.id}"${target === `group:${group.id}` ? raw(" selected") : ""}>${group.name}</option>`)}</select></label>
          <label class="cw-field" data-grouping-namebox="${i}"${target === "new" ? "" : raw(" hidden")}><span>新分组名称</span><input class="cw-input" data-grouping-name="${i}" value="${g.name}" maxlength="120"></label>
        </div>
        ${fold(`查看 ${g.ids.length} 条成员`, String(html`<ul class="cw-bullets">${g.ids.map((id) => html`<li>${d.prompt(id)?.name || id}</li>`)}</ul>`))}</div>`;
    };
    const body = el(html`<div class="cw-form">
      <p class="cw-hint">识别分区标题、明确分类前缀和组内共用变量，可移入已有分区，也可新建。先核对目标与完整顺序；移入已有分区时会收拢该分区的分散成员，应用后可撤销。</p>
      ${scan.suggestions.length ? html`<div class="cw-stack">${scan.suggestions.map(rowHtml)}</div>` : html`<p class="cw-hint">暂未识别出明确归属，下面仍可手动指定目标分区。</p>`}
      ${scan.unassigned.length ? fold(`未识别归属的 ${scan.unassigned.length} 条（可手动指定）`, String(html`<p class="cw-hint">默认保持未分组。选择目标后会勾选该条目，应用前仍可取消。</p><div class="cw-stack">${scan.unassigned.map((g, i) => rowHtml(g, i + scan.suggestions.length))}</div>`), { attrs: "data-grouping-unassigned" }) : ""}
      <div data-grouping-preview></div></div>`);
    let plan = null;
    const paint = () => {
      const choices = [];
      let invalid = false;
      rows.forEach((g, i) => {
        const target = body.querySelector(`[data-grouping-target="${i}"]`).value;
        const name = body.querySelector(`[data-grouping-name="${i}"]`);
        body.querySelector(`[data-grouping-namebox="${i}"]`).hidden = target !== "new";
        if (!body.querySelector(`[data-grouping-on="${i}"]`).checked) return;
        if (target === "choose" || target === "new" && !name.value.trim()) { invalid = true; return; }
        choices.push({ ids: g.ids, name: name.value.trim(), targetGroupId: target.startsWith("group:") ? target.slice(6) : null });
      });
      const preview = body.querySelector("[data-grouping-preview]");
      plan = null;
      try {
        if (invalid) throw new Error("请为已勾选的建议选择目标，并填写新分组名称");
        plan = planGroupingAssignments(d, choices);
        const names = new Map(plan.groups.groups.map((g) => [g.id, g.name]));
        preview.innerHTML = String(html`<p class="cw-hint">将归组 ${plan.assignedIds.length} 条，新建 ${plan.newGroupIds.length} 个分区。未勾选的条目保留原有归属。</p>
          ${fold(`应用后的完整顺序（${plan.order.length} 条）`, String(html`<ol class="cw-orderlist">${plan.order.map((o, i) => html`<li data-grouping-preview-id="${o.identifier}"><b>${d.prompt(o.identifier)?.name || o.identifier}</b><small>${names.get(plan.groups.prompts[o.identifier]?.groupId) || "未分组"} · 原第 ${positions.get(o.identifier)} 条 → 第 ${i + 1} 条 · ${o.enabled === false ? "关闭" : "开启"}</small></li>`)}</ol>`))}`);
      } catch (e) {
        preview.innerHTML = String(html`<p class="cw-warn-text">${e.message}</p>`);
      }
      const apply = body.closest(".cw-dlg")?.querySelector(".cw-btn-primary");
      if (apply) apply.disabled = !plan?.assignedIds.length;
    };
    body.addEventListener("change", (e) => {
      if (e.target.matches("[data-grouping-target]")) body.querySelector(`[data-grouping-on="${e.target.dataset.groupingTarget}"]`).checked = e.target.value !== "choose";
      paint();
    });
    body.addEventListener("input", (e) => { if (e.target.matches("[data-grouping-name]")) paint(); });
    const result = await dialog({ title: "识别并归入分区", body, size: "lg", noFocus: true, onMount: paint, actions: [{ label: "取消", value: null }, { label: "应用分组", kind: "primary", value: () => plan }] });
    if (!result?.assignedIds.length) return;
    if (focusPreset() !== d.name || getDraft(d.name) !== d || JSON.stringify(d.toPreset()) !== original) return toast("预设已变化，请重新识别分区", "warning");
    mutate(d, "识别并归入分区", (x) => { findOrderList(x.preset).order = result.order; x.groups = result.groups; });
    result.newGroupIds.forEach((id) => setOpen(d, id, false));
    toast(`已归组 ${result.assignedIds.length} 条，可撤销`, "success");
    render();
  }
  // ---- 拖动：条目右侧的把手拖条目（选中的则拖全部选中）；分组头的把手拖整组
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".cw-handle");
    if (!h || st.mode) return;
    e.preventDefault();
    const d = draft();
    const head = h.closest(".cw-ghead");
    let ids, label, group = null;
    if (head) {
      group = head.dataset.gid;
      ids = d.order.filter((o) => d.groupOf(o.identifier) === group).map((o) => o.identifier);
      label = `分组「${d.group(group)?.name || ""}」`;
      head.closest(".cw-group").classList.add("is-dragging");
    } else {
      const id = h.closest(".cw-row").dataset.id;
      ids = st.selected.has(id) ? ordered() : [id];
      label = `${d.prompt(id)?.name || id}${ids.length > 1 ? ` 等 ${ids.length} 条` : ""}`;
      ids.forEach((i) => list.querySelector(`.cw-row[data-id="${CSS.escape(i)}"]`)?.classList.add("is-dragging"));
    }
    const ghost = el(html`<div class="cw-ghost">${iconHtml("grip")}<span>${label}</span></div>`);
    box.append(ghost);
    const line = el('<div class="cw-dropline"></div>');
    scroller.append(line);
    drag = { ids, group, ghost, line, target: null, y: e.clientY, x: e.clientX, raf: 0, pid: e.pointerId };
    try { h.setPointerCapture(e.pointerId); } catch {}
    moveGhost(e.clientX, e.clientY);
    drag.raf = requestAnimationFrame(autoScroll);
  });
  // 拖整个分组：只能落在分组之间或散条目之间
  function groupTarget(under, y, sr) {
    const d = draft();
    const sec = under?.closest?.(".cw-group");
    const loose = !sec && under?.closest?.(".cw-loose .cw-row");
    const target = sec || loose;
    if (!target || !list.contains(target) || sec?.dataset.gid === drag.group) return null;
    const r = target.getBoundingClientRect();
    const upper = y < r.top + r.height / 2;
    const lineY = (upper ? r.top - 3 : r.bottom + 3) - sr.top + scroller.scrollTop;
    if (loose) return { where: upper ? { before: loose.dataset.id } : { after: loose.dataset.id }, gid: null, lineY };
    const hd = sec.querySelector(".cw-ghead");
    const gid = hd.dataset.gid;
    if (upper) return { where: hd.dataset.first ? { before: hd.dataset.first } : d.afterEmpty(gid), gid: null, lineY };
    return { where: hd.dataset.last ? { after: hd.dataset.last } : { ...d.afterEmpty(gid), behind: gid }, gid: null, lineY };
  }
  function moveGhost(x, y) {
    drag.x = x;
    drag.y = y;
    const br = box.getBoundingClientRect();
    drag.ghost.style.transform = `translate(${Math.max(8, Math.min(x - br.left - 40, br.width - 200))}px, ${y - br.top - 18}px)`;
    drag.ghost.style.visibility = "hidden";
    const under = document.elementFromPoint(x, y);
    drag.ghost.style.visibility = "";
    const sr = scroller.getBoundingClientRect();
    let target = null, lineY = null;
    if (drag.group) {
      target = groupTarget(under, y, sr);
      lineY = target?.lineY ?? null;
    } else {
      const row = under?.closest?.(".cw-row");
      const head = under?.closest?.(".cw-ghead");
      if (row && list.contains(row) && !drag.ids.includes(row.dataset.id)) {
        const r = row.getBoundingClientRect();
        const after = y > r.top + r.height / 2;
        target = { where: after ? { after: row.dataset.id } : { before: row.dataset.id }, gid: draft().groupOf(row.dataset.id) };
        lineY = (after ? r.bottom : r.top) - sr.top + scroller.scrollTop;
      } else if (head && list.contains(head)) {
        // 组头上半＝放在这组前面（组外）；下半：展开着或空分组＝放进组内最前，折叠着＝这组后面（组外）
        const r = head.getBoundingClientRect();
        const gr = head.closest(".cw-group").getBoundingClientRect();
        const upper = y < r.top + r.height / 2;
        const gid = head.dataset.gid;
        const isEmpty = !head.dataset.first;
        const isOpen = !head.closest(".cw-group").classList.contains("is-col");
        if (isEmpty) { target = { where: draft().afterEmpty(gid), gid }; lineY = r.bottom - sr.top + scroller.scrollTop; }
        else if (upper) { target = { where: { before: head.dataset.first }, gid: null }; lineY = gr.top - sr.top + scroller.scrollTop - 3; }
        else if (isOpen) { target = { where: { before: head.dataset.first }, gid }; lineY = r.bottom - sr.top + scroller.scrollTop; }
        else { target = { where: { after: head.dataset.last }, gid: null }; lineY = gr.bottom - sr.top + scroller.scrollTop + 3; }
      }
    }
    drag.target = target;
    if (lineY == null) drag.line.style.display = "none";
    else {
      drag.line.style.display = "block";
      drag.line.style.transform = `translateY(${lineY - 1}px)`;
    }
  }
  function autoScroll() {
    if (!drag) return;
    const r = scroller.getBoundingClientRect();
    const edge = 56;
    let dy = 0;
    if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 4);
    else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 4);
    if (dy) {
      scroller.scrollTop += dy;
      moveGhost(drag.x, drag.y);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  // 落下后，位置变了的行和组头从原处滑到新位置
  const flipKey = (x) => x.dataset.id ? "r" + x.dataset.id : "g" + x.dataset.gid;
  const snapRows = () => new Map([...list.querySelectorAll(".cw-row[data-id], .cw-ghead[data-gid]")].map((x) => [flipKey(x), x.getBoundingClientRect().top]));
  const endDrag = (commit) => {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.line.remove();
    const { ids, target, group } = drag;
    drag = null;
    if (!commit || !target) return render();
    const d = draft();
    const before = snapRows();
    if (group && !ids.length) {
      // 空分组：只改它跟在哪一条后面
      const w = target.where;
      const anchor = w.index === 0 ? "" : w.after !== void 0 ? w.after : (() => {
        const k = d.order.findIndex((o) => o.identifier === w.before);
        return k > 0 ? d.order[k - 1].identifier : "";
      })();
      mutate(d, "移动分组", (x) => { x.group(group).anchor = anchor; });
    } else {
      mutate(d, group ? "移动分组" : "拖动", (x) => x.place(ids, target.where, target.gid, { keep: group ? [group] : [] }));
      flash(ids);
    }
    flipFrom(list.querySelectorAll(".cw-row[data-id], .cw-ghead[data-gid]"), before, flipKey);
  };
  list.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.pid) {
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    }
  });
  list.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pid) endDrag(true); });
  list.addEventListener("pointercancel", () => endDrag(false));
  const off = onDraftChange((name, kind) => {
    const p = patchNext;
    patchNext = null;
    if (kind !== "status" && name === focusPreset() && draftViewVisible(box)) {
      if (p && kind === "content" && patchEntrySwitch(list, draft(), p)) return;
      render();
    }
  });
  cleanups.push(off);
  return {
    render,
    focusIds(ids) {
      const d = draft();
      ids.forEach((i) => {
        const g = d.groupOf(i);
        if (g) setOpen(d, g, true);
      });
      flash(ids);
      render();
    }
  };
}

// 「按变量名排序」：手动调整类别先后，或让当前连接的 AI 推荐一个顺序
async function sortTagsDialog(d, ids) {
  if (ids.length < 2) return toast("至少选择两条");
  const mode = await pickBox("排序方式", [
    { label: "手动排序", sub: "调整类别先后，类别内按编号排列", value: "manual" },
    { label: "AI 推荐", sub: "用当前连接生成一次顺序（会用掉一次请求），只发送类别和少量条目名，生成后可调整", value: "ai" }
  ]);
  if (!mode) return;
  let categories = [...new Set(ids.map((id) => tagKey(d, id).category))];
  const original = JSON.stringify(d.toPreset());
  if (mode === "ai") {
    toast("正在生成推荐顺序…");
    try {
      categories = await recommendTagCategories(d, ids, categories);
    } catch (e) {
      toast("AI 推荐失败：" + e.message + "。已改为手动排序", "warning");
    }
  }
  const body = el(html`<div class="cw-form"><p class="cw-hint">按条目登记的变量名（如 文风1、文风2）分成几类，调整类别先后；同一类里按编号排。只调整选中的条目，其余条目不动。</p>
    <div class="cw-rank-edit"></div><div class="cw-tag-preview"></div></div>`);
  function paint() {
    body.querySelector(".cw-rank-edit").innerHTML = String(html`${categories.map((x, i) => html`<div class="cw-rankrow"><span class="cw-num cw-dim">${i + 1}</span><b>${x}</b>
      ${ibtn("up", "上移", { attrs: `data-rank="${i}" data-dir="-1"${i === 0 ? " disabled" : ""}` })}${ibtn("down", "下移", { attrs: `data-rank="${i}" data-dir="1"${i === categories.length - 1 ? " disabled" : ""}` })}</div>`)}`);
    body.querySelector(".cw-tag-preview").innerHTML = String(fold("预览结果", String(html`<ol class="cw-orderlist">${sortTagIds(d, ids, categories).map((id) => html`<li><b>${d.prompt(id)?.name}</b><small>${tagKey(d, id).label}</small></li>`)}</ol>`)));
  }
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rank]");
    if (!b) return;
    const i = Number(b.dataset.rank), j = i + Number(b.dataset.dir);
    if (j < 0 || j >= categories.length) return;
    [categories[i], categories[j]] = [categories[j], categories[i]];
    paint();
  });
  paint();
  const ok = await dialog({ title: "按变量名排序", body, noFocus: true, actions: [{ label: "取消", value: false }, { label: "应用", kind: "primary", value: true }] });
  if (!ok) return;
  if (JSON.stringify(d.toPreset()) !== original) return toast("预设已变化，请重新排序", "warning");
  const sorted = sortTagIds(d, ids, categories);
  const selected = new Set(ids);
  const byId = new Map(d.order.map((o) => [o.identifier, o]));
  let k = 0;
  mutate(d, "按变量名排序", (x) => {
    findOrderList(x.preset).order = x.order.map((o) => selected.has(o.identifier) ? byId.get(sorted[k++]) : o);
  });
  toast("已排序", "success");
}
