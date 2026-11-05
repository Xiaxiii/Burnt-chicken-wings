// 列表位置模型：条目标签、搜索高亮、选位置的标记与说明。与视图无关（原 ui/list.js）
// 条目的标签（列表右侧显示的变量名）
function tagText(draft, id) {
  const p = draft.prompt(id);
  if (!p || draft.isMarker(id) || !String(p.content || "").trim()) return "";
  const s = detectShape(p.content);
  return s.shape === "wrap" || s.shape === "tagname" ? String(draft.preset.extensions.presetAtelierEntryLabels?.[id] || s.varName || "") : "";
}

// 把文字里搜到的部分标出来（先拆开再分别转义，不会把转义后的 &amp; 之类拆坏）
function markText(text, q) {
  const t = String(text ?? "");
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + `<mark>${esc(t.slice(i, i + q.length))}</mark>` + esc(t.slice(i + q.length));
}

// 正文里匹配的那一句：前后各取一点，换行压成空格
function hitSnippet(content, i, len) {
  const a = Math.max(0, i - 14), z = Math.min(content.length, i + len + 26);
  const flat = (x) => x.replace(/\s+/g, " ");
  return (a > 0 ? "…" : "") + esc(flat(content.slice(a, i))) + `<mark>${esc(content.slice(i, i + len))}</mark>` + esc(flat(content.slice(i + len, z))) + (z < content.length ? "…" : "");
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
