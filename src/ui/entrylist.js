// 条目列表（预设页、缝合页共用）。
// o.mode："organize"（开关、把手、编辑）| "source"（缝合来源：可选、整组选）| "target"（缝合目标：选位置）
// o.place：选位置模式。点组头＝放在这组后面（组外）；展开后点组内条目＝放进组里、它的后面；
//   顶部「最前面」、展开组的第一行「组内最前」。o.inside === false 时不能放进组里（给新分组选位置、世界书目标）。
// o.marker：{ at: "top" } | { at: "row", id } | { at: "block", id: 组块最后一条 } | { at: "block", gid }（空分组）| { at: "gstart", gid }
function renderEntryList(draft, o) {
  return draft.withReadIndex(() => renderEntryListNow(draft, o));
}
function renderEntryListNow(draft, o) {
  const q = (o.query || "").trim().toLowerCase();
  const sel = o.selected || new Set();
  const collapsed = o.collapsed || new Set();
  const place = !!o.place;
  const inside = place && o.inside !== false;
  const organize = o.mode === "organize" && !place;
  const m = o.marker || null;
  const mark = html`<div class="cw-insert" role="note">${iconHtml("chevDown")}<span>${o.markLabel || "插入位置"}</span></div>`;
  // 搜索：先看名称、标签、分组名；只在正文里出现的另算，打开「正文里还有 N 条」后列出并显示匹配的那一句
  const hits = new Map();
  let nameHits = 0, bodyHits = 0;
  if (q) {
    for (const o2 of draft.order) {
      const id = o2.identifier;
      const p = draft.prompt(id);
      const gName = String(draft.group(draft.groupOf(id))?.name || "").toLowerCase();
      if ((p?.name || id).toLowerCase().includes(q) || tagText(draft, id).toLowerCase().includes(q) || gName.includes(q)) {
        hits.set(id, { body: false });
        nameHits++;
      } else {
        const c = String(p?.content || "");
        const i = c.toLowerCase().indexOf(q);
        if (i >= 0) {
          bodyHits++;
          if (o.searchBody) hits.set(id, { body: true, snip: hitSnippet(c, i, q.length) });
        }
      }
    }
  }
  const matches = (id) => !q || hits.has(id);
  const enabledMap = new Map(draft.order.map((x) => [x.identifier, x.enabled !== false]));
  const manual = draft.cotManual || {};
  let region;
  const row = (id) => {
    if (!matches(id)) return "";
    const p = draft.prompt(id);
    const name = p?.name || id;
    const on = enabledMap.get(id);
    const marker = draft.isMarker(id);
    const empty = !String(p?.content || "").trim();
    let tags = "";
    if (o.badge) tags = o.badge(id);
    else if (marker) tags = pill("系统位置", "line");
    else if (!empty) {
      const s = detectShape(p?.content);
      if (s.shape === "wrap" || s.shape === "tagname") tags += String(html`<span class="cw-pill cw-pill-muted" title="写入变量">${raw(markText(tagText(draft, id), q))}</span>`);
      else if (s.shape === "init") tags += String(pill("变量初始化", "line"));
      if (isCotEntry(draft, id, manual, region || (region = cotRegion(draft)))) tags += String(pill("CoT", "accent"));
    }
    const at = m?.at === "row" && m.id === id;
    const hit = hits.get(id);
    const cls = ["cw-row", tags && "has-tags", at && "is-at", sel.has(id) && "is-sel", !on && "is-off", empty && !marker && "is-sep", o.highlight?.has(id) && "cw-flash"].filter(Boolean).join(" ");
    return String(html`<div class="${cls}" data-id="${id}" tabindex="0" data-key-click role="listitem">
        ${place ? "" : raw('<span class="cw-row-sel" aria-hidden="true"></span>')}
        <span class="cw-row-main">${hit?.body ? html`<span class="cw-row-name">${name}</span><small class="cw-row-hit">正文：${raw(hit.snip)}</small>` : html`<span class="cw-row-name">${raw(markText(name, q))}</span>`}</span>
        ${tags ? html`<span class="cw-row-tags">${raw(tags)}</span>` : ""}
        ${o.mode !== "target" || !place ? ibtn("edit", "查看或编辑", { act: "edit", cls: "cw-row-edit" }) : ibtn("eye", "查看", { act: "edit", cls: "cw-row-edit" })}
        ${organize ? switchHtml({ act: "toggle", on, label: "开关" }) : ""}
        ${organize ? html`<span class="cw-handle" data-act="drag" aria-label="拖动" title="拖动">${iconHtml("grip")}</span>` : ""}
      </div>${at ? mark : ""}`);
  };
  let out = "";
  if (q) {
    const more = bodyHits ? String(html`<button type="button" class="cw-link" data-act="qbody">${o.searchBody ? `收起正文里出现的 ${bodyHits} 条` : `正文里还有 ${bodyHits} 条`}</button>`) : "";
    out += String(html`<div class="cw-qsum">${nameHits ? html`名称、标签、分组名匹配 <b>${nameHits}</b> 条` : "名称、标签、分组名里没有"}${more ? raw(" · " + more) : ""}</div>`);
    if (!nameHits && !(o.searchBody && bodyHits)) return out + (bodyHits ? "" : String(empty("没有匹配的条目")));
  }
  if (place) out += m?.at === "top" ? String(mark) : String(html`<button type="button" class="cw-slot" data-act="top">${iconHtml("move")}<span>放在最前面</span></button>`);
  for (const b of draft.blocks()) {
    if (b.empty && (q || o.mode === "source")) continue;
    if (!b.groupId) {
      const rows = b.ids.map(row).filter(Boolean);
      // --n：行数，屏幕外整块跳过渲染时按它占位
      if (rows.length) out += `<div class="cw-loose" style="--n:${rows.length}">${rows.join("")}</div>`;
      continue;
    }
    const g = draft.group(b.groupId);
    const isCol = !q && collapsed.has(b.groupId);
    const shown = isCol ? [] : b.ids.map(row).filter(Boolean);
    if (q && !shown.length) continue;
    const onCount = b.ids.filter((id) => enabledMap.get(id)).length;
    const allSel = b.ids.length && b.ids.every((id) => sel.has(id));
    const first = b.ids[0] || "", last = b.ids[b.ids.length - 1] || "";
    const afterHere = m?.at === "block" && (b.empty ? !m.id && m.gid === b.groupId : m.id === last);
    const atStart = m?.at === "gstart" && m.gid === b.groupId && b.part === 1;
    const hasAt = atStart || m?.at === "row" && b.ids.includes(m.id);
    const startSlot = inside && !isCol && b.part === 1 ? atStart ? String(mark) : String(html`<button type="button" class="cw-slot cw-slot-in" data-act="gstart" data-gid="${b.groupId}">${iconHtml(b.empty ? "chevDown" : "move")}<span>${b.empty ? "放入此组" : "组内最前"}</span></button>`) : "";
    const emptyNote = b.empty && !startSlot ? '<p class="cw-gempty">空分组</p>' : "";
    const off = draft.groupOff(b.groupId);
    const gcls = ["cw-group", hasAt && "has-at", afterHere && "after-at", isCol && "is-col", b.empty && "is-empty", off && "is-off", allSel && !b.empty && !place && "is-sel"].filter(Boolean).join(" ");
    const selectable = !place && (organize || o.mode === "source");
    out += String(html`<section class="${gcls}" data-gid="${b.groupId}">
        <header class="cw-ghead" data-gid="${b.groupId}" data-first="${first}" data-last="${last}" tabindex="0" data-key-click>
          ${selectable ? html`<button type="button" class="cw-gsel" data-act="gselect" aria-label="选择整组" aria-pressed="${String(!!allSel && !b.empty)}"><span class="cw-row-sel" aria-hidden="true"></span></button>` : ""}
          <button type="button" class="cw-gname" data-act="fold" aria-expanded="${String(!isCol)}"><span>${raw(markText(g?.name || "分组", q))}</span>${b.parts > 1 ? html`<em>第 ${b.part}/${b.parts} 段</em>` : ""}${iconHtml("chev")}</button>
          ${hasAt && isCol ? pill("位置在组内", "accent") : ""}
          <span class="cw-gcount cw-num">${onCount}/${b.ids.length}</span>
          ${organize ? html`${switchHtml({ act: "gtoggle", on: !off, small: true, label: "分组开关（不修改内部条目）" })}${ibtn("more", "分组操作", { act: "gmenu" })}<span class="cw-handle" data-act="gdrag" aria-label="拖动分组" title="拖动分组">${iconHtml("grip")}</span>` : ""}
        </header>
        <div class="cw-gbody" style="--n:${shown.length}">${raw(startSlot)}${raw(emptyNote)}${raw(shown.join(""))}</div>
      </section>${afterHere ? mark : ""}`);
  }
  return out || String(empty("没有条目"));
}
/** 点了列表里的什么 → 位置。inside 为 false 时，点组里的条目也算放在这组后面 */
function placeFromClick(d, e, inside = true) {
  const t = e.target;
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "top") return { at: "top" };
  if (act === "gstart") return { at: "gstart", gid: t.closest("[data-act]").dataset.gid };
  const head = t.closest(".cw-ghead");
  if (head) return head.dataset.last ? { at: "block", id: head.dataset.last } : { at: "block", gid: head.dataset.gid };
  const row = t.closest(".cw-row");
  if (!row) return null;
  const id = row.dataset.id;
  if (inside || !d.groupOf(id)) return { at: "row", id };
  const b = d.blocks().find((x) => x.ids.includes(id));
  return { at: "block", id: b.ids[b.ids.length - 1] };
}
// 分组折叠记忆：按「预设名 + 分组名（同名第几个）」存在设置 fold[area]；没动过的组按 def(g)
function groupFoldKeys(d, prefix = d.name) {
  const seen = new Map(), out = new Map();
  for (const g of d.groups.groups) {
    const n = seen.get(g.name) || 0;
    seen.set(g.name, n + 1);
    out.set(g.id, `${prefix}\u0001${g.name}\u0001${n}`);
  }
  return out;
}
// 列表行开关只改了状态：就地改这一行（或这一组）和计数，不重建整个列表
function patchEntrySwitch(list, d, p) {
  if (p.kind === "group") {
    list.querySelectorAll(`.cw-group[data-gid="${CSS.escape(p.gid)}"]`).forEach((sec) => {
      const off = d.groupOff(p.gid);
      sec.classList.toggle("is-off", off);
      const box = sec.querySelector(':scope > .cw-ghead [data-act="gtoggle"]');
      if (box) box.checked = !off;
    });
    return true;
  }
  const row = list.querySelector(`.cw-row[data-id="${CSS.escape(p.id)}"]`);
  const b = d.blocks().find((x) => x.ids.includes(p.id));
  if (!row || !b) return false;
  const en = new Map(d.order.map((x) => [x.identifier, x.enabled !== false]));
  row.classList.toggle("is-off", !en.get(p.id));
  const box = row.querySelector('[data-act="toggle"]');
  if (box) box.checked = en.get(p.id);
  const count = row.closest(".cw-group")?.querySelector(":scope > .cw-ghead .cw-gcount");
  if (count) count.textContent = `${b.ids.filter((i) => en.get(i)).length}/${b.ids.length}`;
  return true;
}
