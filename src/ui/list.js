var ICON = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  needle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4 7 17"/><path d="M17 4h3v3"/><path d="M7 17c-2 2-4 2-4 2s0-2 2-4"/></svg>'
};
/**
 * 列表渲染。o.place 为 true 时是"选位置"：
 *   点组头＝放在这组后面（组外）；展开后点组内条目＝放进组里、它的后面；
 *   顶部「最前面」、展开组的第一行「组内最前」。o.inside === false 时不能放进组里（给新分组选位置）。
 * o.marker：{ at: "top" } | { at: "row", id } | { at: "block", id: 组块最后一条 } | { at: "block", gid }（空分组）| { at: "gstart", gid }
 */
function renderList(draft, o) {
  const q = (o.query || "").trim().toLowerCase();
  const sel = o.selected || /* @__PURE__ */ new Set();
  const collapsed = o.collapsed || /* @__PURE__ */ new Set();
  const place = !!o.place;
  const inside = place && o.inside !== false;
  const showSwitch = o.mode === "organize" && !place;
  const showHandle = showSwitch;
  const m = o.marker || null;
  const mark = `<div class="pa-insert-mark">${esc(o.markLabel || "插入位置")}</div>`;
  const matches = (id) => {
    if (!q) return true;
    const p = draft.prompt(id);
    // 名称和正文都搜
    return (p?.name || id).toLowerCase().includes(q) || String(p?.content || "").toLowerCase().includes(q);
  };
  const enabledMap = new Map(draft.order.map((x) => [x.identifier, x.enabled !== false]));
  const row = (id) => {
    if (!matches(id)) return "";
    const p = draft.prompt(id);
    const name = p?.name || id;
    const on = enabledMap.get(id);
    const marker = draft.isMarker(id);
    const empty = !String(p?.content || "").trim();
    let badge = "";
    if (o.badge) badge = o.badge(id);
    else if (!marker && !empty) {
      const s = detectShape(p?.content);
      if (s.shape === "wrap" || s.shape === "tagname") badge = `<span class="pa-chip" title="写入变量">${esc(draft.preset.extensions.presetAtelierEntryLabels?.[id] || s.varName)}</span>`;
      else if (s.shape === "init") badge = '<span class="pa-chip pa-chip-dim">变量初始化</span>';
      if (isCotEntry(draft, id)) badge += '<span class="pa-chip pa-chip-cot">CoT</span>';
    }
    if (marker) badge = '<span class="pa-chip pa-chip-dim">系统位置</span>';
    const at = m?.at === "row" && m.id === id;
    const hl = o.highlight?.has(id) ? " pa-flash" : "";
    return `<div class="pa-row${at ? " pa-at" : ""}${sel.has(id) ? " pa-sel" : ""}${on ? "" : " pa-off"}${empty && !marker ? " pa-sep" : ""}${hl}" data-id="${esc(id)}" tabindex="0">
            <span class="pa-check" aria-hidden="true"></span>
            <span class="pa-name">${esc(name)}</span>${badge ? `<span class="pa-badges">${badge}</span>` : ""}
            <button class="pa-icon-btn pa-peek" data-act="peek" aria-label="${o.mode === "organize" ? "查看或编辑" : "查看内容"}" title="${o.mode === "organize" ? "查看或编辑" : "查看内容"}">${ICON.eye}</button>
            ${showSwitch ? `<label class="pa-switch" title="开关"><input type="checkbox" data-act="toggle" ${on ? "checked" : ""}><i></i></label>` : ""}
            ${showHandle ? `<span class="pa-handle" data-act="drag" aria-label="拖动">${ICON.grip}</span>` : ""}
        </div>${at ? mark : ""}`;
  };
  let html = "";
  if (place) html += m?.at === "top" ? mark : `<button class="pa-slot" data-act="top">↑ 最前面</button>`;
  for (const b of draft.blocks()) {
    if (b.empty && (q || o.mode === "source")) continue;
    if (!b.groupId) {
      const inner = b.ids.map(row).join("");
      if (inner) html += `<div class="pa-loose">${inner}</div>`;
      continue;
    }
    const g = draft.group(b.groupId);
    const visibleRows = b.ids.map(row).join("");
    if (q && !visibleRows) continue;
    const isCol = !q && collapsed.has(b.groupId);
    const onCount = b.ids.filter((id) => enabledMap.get(id)).length;
    const allSel = b.ids.length && b.ids.every((id) => sel.has(id));
    const first = b.ids[0] || "";
    const last = b.ids[b.ids.length - 1] || "";
    const afterHere = m?.at === "block" && (b.empty ? !m.id && m.gid === b.groupId : m.id === last);
    const atStart = m?.at === "gstart" && m.gid === b.groupId && b.part === 1;
    const hasAt = atStart || m?.at === "row" && b.ids.includes(m.id);
    const caret = place || o.mode === "target";
    const startSlot = inside && !isCol && b.part === 1 ? atStart ? mark : `<button class="pa-slot pa-slot-in" data-act="gstart" data-gid="${esc(b.groupId)}">${b.empty ? "↓ 放入此组" : "↑ 组内最前"}</button>` : "";
    const emptyNote = b.empty && !startSlot ? '<p class="pa-gempty">空分组</p>' : "";
    html += `<section class="pa-group${hasAt ? " pa-has-at" : ""}${afterHere ? " pa-after-at" : ""}${isCol ? " pa-collapsed" : ""}${b.empty ? " pa-gempty-box" : ""}${g?.enabled === false ? " pa-goff" : ""}${allSel && !b.empty ? " pa-gsel" : ""}" data-gid="${esc(b.groupId)}">
            <header class="pa-ghead" data-gid="${esc(b.groupId)}" data-first="${esc(first)}" data-last="${esc(last)}" tabindex="0">
                ${caret ? `<button class="pa-icon-btn pa-caret${isCol ? "" : " open"}" data-act="collapse" aria-label="展开或折叠">${ICON.caret}</button>` : `<button class="pa-icon-btn pa-group-select" data-act="gselect" aria-label="选择整组" aria-pressed="${!!allSel && !b.empty}"><span class="pa-check"></span></button>`}
                <span class="pa-gname"${place ? "" : ' data-act="collapse"'}>${esc(g?.name || "分组")}${b.parts > 1 ? `<em class="pa-split">第 ${b.part}/${b.parts} 段</em>` : ""}</span>
                ${hasAt && isCol ? '<span class="pa-at-chip">位置在组内</span>' : ""}<span class="pa-count">${onCount}/${b.ids.length}</span>
                ${showSwitch ? `<label class="pa-switch pa-switch-s" title="分组开关（不修改内部条目）"><input type="checkbox" aria-label="分组开关" data-act="gtoggle" ${draft.groupOff(b.groupId) ? "" : "checked"}><i></i></label>
                <button class="pa-icon-btn" data-act="gmenu" aria-label="分组操作">${ICON.more}</button>
                <span class="pa-handle" data-act="gdrag" aria-label="拖动分组">${ICON.grip}</span>` : ""}
            </header>
            <div class="pa-gbody">${startSlot}${emptyNote}${visibleRows}</div>
        </section>${afterHere ? mark : ""}`;
  }
  return html || '<p class="pa-empty">没有匹配的条目</p>';
}
/** 选好的位置 → 插入点 + 归属分组（null＝组外） */
function placeOf(d, m) {
  if (!m) return null;
  if (m.at === "top") return { where: { index: 0 }, gid: null };
  if (m.at === "gstart") return d.isEmptyGroup(m.gid) ? { where: d.afterEmpty(m.gid), gid: m.gid } : { where: { groupStart: m.gid }, gid: m.gid };
  if (m.at === "block") return m.id ? { where: { after: m.id }, gid: null } : { where: { ...d.afterEmpty(m.gid), behind: m.gid }, gid: null };
  return { where: { after: m.id }, gid: d.groupOf(m.id) };
}
/** 点了列表里的什么 → 位置。inside 为 false 时，点组里的条目也算放在这组后面 */
function placeFromClick(d, e, inside = true) {
  const t = e.target;
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "top") return { at: "top" };
  if (act === "gstart") return { at: "gstart", gid: t.closest("[data-act]").dataset.gid };
  const head = t.closest(".pa-ghead");
  if (head) return head.dataset.last ? { at: "block", id: head.dataset.last } : { at: "block", gid: head.dataset.gid };
  const row = t.closest(".pa-row");
  if (!row) return null;
  const id = row.dataset.id;
  if (inside || !d.groupOf(id)) return { at: "row", id };
  const b = d.blocks().find((x) => x.ids.includes(id));
  return { at: "block", id: b.ids[b.ids.length - 1] };
}
/** 位置还有效吗；组块标记总是指向那一块的最后一条（组被改过就跟着挪），失效返回 null */
function fixPlace(d, m) {
  if (!m) return null;
  if (m.at === "top") return m;
  if (m.at === "gstart") return d.group(m.gid) && (!d.isEmptyGroup(m.gid) || d.group(m.gid).anchor !== void 0) ? m : null;
  if (m.at === "block" && !m.id) {
    if (!d.group(m.gid)) return null;
    if (!d.isEmptyGroup(m.gid)) {
      const bs = d.blocks().filter((b) => b.groupId === m.gid);
      const lb = bs[bs.length - 1];
      return { at: "block", id: lb.ids[lb.ids.length - 1] };
    }
    return m;
  }
  if (!d.order.some((o) => o.identifier === m.id)) return null;
  if (m.at === "block") {
    const b = d.blocks().find((x) => x.ids.includes(m.id));
    if (!b?.groupId) return { at: "row", id: m.id };
    const last = b.ids[b.ids.length - 1];
    return last === m.id ? m : { at: "block", id: last };
  }
  return m;
}
function placeText(d, m) {
  const nm = (id) => d.prompt(id)?.name || id;
  const gn = (g) => d.group(g)?.name || "分组";
  if (m.at === "top") return "最前面";
  if (m.at === "gstart") return d.isEmptyGroup(m.gid) ? `「${gn(m.gid)}」组内` : `「${gn(m.gid)}」组内最前`;
  if (m.at === "block") return `「${gn(m.id ? d.groupOf(m.id) : m.gid)}」组之后（组外）`;
  const g = d.groupOf(m.id);
  return g ? `「${gn(g)}」组内，「${nm(m.id)}」之后` : `「${nm(m.id)}」之后`;
}
