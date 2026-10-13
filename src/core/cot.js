var COT_NAME = /cot|思维链|思考|thinking|推理|内在思|reasoning|phase/i;
// 1.3.0：思维链区段——从"思维链始/思考开始/打开 <thinking>"到"思维链终/思考结束/关上 </thinking>"之间的条目都算思维链
// （Ariadne 这类预设的思维链步骤名字里不带"思维链"三个字，也没有分组）
var COT_START = /(思维链|cot|ecot|思考|thinking)\s*[·・:：\-—_]?\s*(始|开始|开头|起|start|begin)/i;
var COT_END = /(思维链|cot|ecot|思考|thinking)\s*[·・:：\-—_]?\s*(终|结束|收尾|尾|end)/i;
var cotRegionCache = /* @__PURE__ */ new WeakMap();
function cotRegion(draft) {
  const order = draft.order;
  const sig = order.length + ":" + order.map((o) => (o.enabled === false ? 0 : 1)).join("") + ":" + (draft.history?.length || 0);
  const hit = cotRegionCache.get(order);
  if (hit && hit.sig === sig) return hit.set;
  const set = /* @__PURE__ */ new Set();
  let cur = null;
  for (const o of order) {
    const p = draft.prompt(o.identifier);
    if (!p) continue;
    const active = o.enabled !== false;
    const c = String(p.content || "");
    // 只认单独占一行的 <thinking> / </thinking>（句子里提到的不算）
    const opens = (c.match(/^[ \t]*<thinking>[ \t]*$/gim) || []).length, closes = (c.match(/^[ \t]*<\/thinking>[ \t]*$/gim) || []).length;
    const name = p.name || "";
    if (!cur) {
      if (active && (opens > closes || COT_START.test(name)) && !(closes >= opens && COT_END.test(name) && !COT_START.test(name))) cur = [o.identifier];
      continue;
    }
    cur.push(o.identifier);
    if (active && (closes > opens || COT_END.test(name))) {
      for (const id of cur) set.add(id);
      cur = null;
    }
  }
  // 没有结束的区段不算（比如底部的"思维链锁"只开不关）
  cotRegionCache.set(order, { sig, set });
  return set;
}
function isCotEntry(draft, id, manual = {}) {
  if (manual[id] !== void 0) return !!manual[id];
  const p = draft.prompt(id);
  if (!p) return false;
  if (cotRegion(draft).has(id)) return true;
  const gid = draft.groupOf(id);
  const gname = gid ? draft.group(gid)?.name || "" : "";
  const name = p.name || "";
  if (COT_NAME.test(name)) return true;
  if (/<thinking>|<think>|##\s*phase|##\s*step/i.test(p.content || "")) return true;
  if (gname && COT_NAME.test(gname) && !/锁|lock/i.test(name)) return true;
  return false;
}
function exposedTags(content) {
  const tags = /* @__PURE__ */ new Set();
  const text = String(content || "");
  const shape = detectShape(text);
  const body = shape.body || text;
  const ot = outerTag(body);
  if (ot) tags.add(ot.tag.toLowerCase());
  for (const m of body.matchAll(/<([A-Za-z_][\w-]{2,40})(?:[：:][^>\n]{0,40})?>/g)) tags.add(m[1].toLowerCase());
  for (const m of body.matchAll(/^\s*(?:#+|\[)\s*([A-Za-z_][\w-]{3,40})/gm)) tags.add(m[1].toLowerCase());
  return tags;
}
// 1.3.0：结构标记——单独一行的 <标签>/</标签>，以及 <!-- START: X --> / <!-- END: X --> 这种注释分区
function structureMarks(content) {
  const text = String(content || "").replace(/\{\{\/\/[\s\S]*?\}\}/g, "").replace(/<!--(?!\s*(?:START|BEGIN|END)\s*[:：])[\s\S]*?-->/gi, "");
  const out = [];
  const re = /<!--\s*(START|BEGIN|END)\s*[:：]\s*([^>]*?)\s*-->|^[ \t]*<(\/?)([^\s>\/!][^>\n]{0,40})>[ \t]*$/gim;
  for (const m of text.matchAll(re)) {
    if (m[1]) {
      const name = m[2].trim().split(/\s+/)[0];
      if (name) out.push({ open: !/^END$/i.test(m[1]), name, key: name.toLowerCase(), comment: true });
    } else {
      const name = m[4].split(/[：:\s]/)[0];
      if (name) out.push({ open: !m[3], name, key: name.toLowerCase(), comment: false });
    }
  }
  return out;
}
/** 按顺序扫一遍，返回每个外层区段 {name,key,openId,closeId,openIdx,closeIdx} */
function structureSections(draft, { activeOnly = true, skip = null } = {}) {
  const stack = [];
  const out = [];
  draft.order.forEach((o, i) => {
    if (activeOnly && !draft.isActive(o.identifier)) return;
    if (skip && skip.has(o.identifier)) return;
    for (const mk of structureMarks(draft.prompt(o.identifier)?.content)) {
      if (mk.open) stack.push({ ...mk, openId: o.identifier, openIdx: i });
      else {
        const k = stack.map((x) => x.key).lastIndexOf(mk.key);
        if (k >= 0) {
          const op = stack.splice(k, 1)[0];
          if (op.openId !== o.identifier) out.push({ name: op.name, key: op.key, comment: op.comment, openId: op.openId, closeId: o.identifier, openIdx: op.openIdx, closeIdx: i });
        }
      }
    }
  });
  return out;
}
// 1.3.0：条目的"称呼"——思维链靠文字点名时，会用这些字样提到它（中文标签、[方括号标题]、条目短名）
var CJK = /[㐀-鿿]/;
function cleanLabel(name) {
  return shortLabel(name).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, "").replace(/^[\s·•\-—=_~*#>》【\[（(]+|[\s·•\-—=_~*#<《】\]）)]+$/g, "").trim();
}
function entryHandles(p) {
  const out = [];
  if (!p) return out;
  const raw = String(p.content || "");
  const body = String(detectShape(raw).body || raw);
  const ot = /^\s*<([^>\/\n!]{2,40})>/.exec(body);
  if (ot) {
    // <small_theater: 日记小剧场> 这种：标签是大家共用的，后面那个才是这条自己的名字
    const two = /^([^：:\s]+)\s*[：:]\s*(.+)$/.exec(ot[1]);
    if (two && two[2].trim().length >= 2) out.push({ needle: two[2].trim(), ref: `「${two[2].trim()}」`, cjk: CJK.test(two[2]) });
    const name = ot[1].split(/[：:\s]/)[0];
    if (name.length >= 2) out.push({ needle: name, ref: `<${name}>`, cjk: CJK.test(name) });
  }
  for (const m of body.matchAll(/^\s*#*\s*\[([^\]\n]{2,20})\]/gm)) {
    if (CJK.test(m[1])) out.push({ needle: `[${m[1]}]`, ref: `[${m[1]}]`, cjk: true });
  }
  const label = cleanLabel(p.name || "");
  if (label && CJK.test(label) && label.length >= 3) out.push({ needle: label, ref: `「${label}」`, cjk: true });
  else if (label && CJK.test(label) && label.length === 2) {
    for (const [a, b] of [["「", "」"], ["【", "】"], ["<", ">"], ["[", "]"], ["《", "》"]]) out.push({ needle: a + label + b, ref: a + label + b, cjk: true });
  }
  return out;
}
/** 思维链原文有没有"点名"这个标签：<tag>、[tag]、`tag`、「tag」都算；带下划线的标识符（writing_style）直接出现也算。
 *  普通英文单词（narrative、style）只是碰巧出现在句子里，不算。 */
function mentionsTag(text, key) {
  const t = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!t) return false;
  if (new RegExp(`[<\\[\`「【]\\s*\\/?${t}(?![\\w-])`, "i").test(text)) return true;
  if (/[_-]/.test(key) && new RegExp(`(^|[^\\w-])${t}(?![\\w-])`, "i").test(text)) return true;
  return false;
}
function cotPlainText(content) {
  return String(content || "").replace(/\{\{(?:get|set|add)(?:global)?var::[^{}]*\}\}/gi, "");
}
function mentionedTags(content) {
  const set = /* @__PURE__ */ new Set();
  for (const m of String(content || "").matchAll(/[A-Za-z_][\w-]{3,40}/g)) set.add(m[0].toLowerCase());
  return set;
}
var IGNORE_TAGS = /* @__PURE__ */ new Set(["thinking", "think", "details", "summary", "section", "content", "user", "char", "style", "div", "span", "br", "html", "body", "phase", "step", "note", "rule", "rules", "system", "output", "format", "the", "and", "with", "this", "that", "must", "from", "your", "each", "into", "only", "when", "what", "will", "should", "after", "before", "about", "which", "there", "their", "have", "then", "than", "more", "less", "also", "such", "over", "under", "core", "main", "text", "time", "name", "type", "list", "item", "items", "true", "false", "none", "null"]);
function analyze(draft, manual = {}) {
  const order = draft.order.map((o) => o.identifier);
  const active = order.filter((id) => draft.isActive(id));
  const activeSet = new Set(active);
  const cotIds = active.filter((id) => String(draft.prompt(id)?.content || "").trim() && isCotEntry(draft, id, manual));
  const cotSet = new Set(cotIds);
  const vars = /* @__PURE__ */ new Map();
  const touch = (name) => {
    if (!vars.has(name)) vars.set(name, { writers: [], readers: [], initOnly: [] });
    return vars.get(name);
  };
  const writesOf = /* @__PURE__ */ new Map();
  const readsOf = /* @__PURE__ */ new Map();
  for (const id of active) {
    const p = draft.prompt(id);
    const macros = listVarMacros(p?.content || "");
    const w = /* @__PURE__ */ new Set();
    const r = /* @__PURE__ */ new Set();
    for (const m of macros) {
      const key = (m.scope === "global" ? "全局:" : "") + m.name;
      if (!m.name) continue;
      if (m.op === "get") {
        r.add(key);
        continue;
      }
      if (m.op === "set" || m.op === "add") {
        if (isBlankValue(m.value)) {
          touch(key).initOnly.push(id);
          continue;
        }
        w.add(key);
      }
      if (m.op === "inc" || m.op === "dec") w.add(key);
    }
    writesOf.set(id, w);
    readsOf.set(id, r);
    for (const k of w) touch(k).writers.push(id);
    for (const k of r) touch(k).readers.push(id);
  }
  for (const v of vars.values()) {
    v.writers = [...new Set(v.writers)];
    v.readers = [...new Set(v.readers)];
    v.initOnly = [...new Set(v.initOnly)];
  }
  const cot = cotIds.map((id) => {
    const reads = [...readsOf.get(id) || []].map((name) => ({
      name,
      suppliers: (vars.get(name)?.writers || []).filter((w) => w !== id)
    }));
    const mentions = [...mentionedTags(draft.prompt(id)?.content)].filter((t) => !IGNORE_TAGS.has(t));
    return { id, reads, mentions };
  });
  const cotMentions = new Map(cot.map((c2) => [c2.id, new Set(c2.mentions)]));
  const coverage = /* @__PURE__ */ new Map();
  const tagCache = /* @__PURE__ */ new Map();
  const tagsOf = (id) => {
    if (!tagCache.has(id)) tagCache.set(id, exposedTags(draft.prompt(id)?.content));
    return tagCache.get(id);
  };
  const cotTexts = new Map(cotIds.map((c2) => [c2, cotPlainText(draft.prompt(c2)?.content)]));
  const findMention = (id) => {
    const tags = [...tagsOf(id)].filter((t) => !IGNORE_TAGS.has(t));
    for (const c2 of cotIds) {
      if (c2 === id) continue;
      const hit = tags.find((t) => mentionsTag(cotTexts.get(c2), t));
      if (hit) return { cot: c2, via: hit };
    }
    // 中文：思维链原文里直接写到了这条的标签 / [标题] / 名字
    const hs = entryHandles(draft.prompt(id)).filter((h) => h.cjk);
    if (hs.length) {
      for (const c2 of cotIds) {
        if (c2 === id) continue;
        const h = hs.find((x) => cotTexts.get(c2).includes(x.needle));
        if (h) return { cot: c2, via: h.ref };
      }
    }
    return null;
  };
  // 外层结构标签/注释分区。像 <text_style>、<!-- START: WRITING_STYLE --> 这种由前一个条目开、后面条目关的区段，
  // 中间的条目（例如缝进来的文风）本身不带标签，思维链提到这个区段名就算想到了它。
  const enclosing = /* @__PURE__ */ new Map();
  {
    const secs = structureSections(draft, { skip: cotSet });
    const idxOf = new Map(draft.order.map((o, i) => [o.identifier, i]));
    for (const id of active) {
      const i = idxOf.get(id);
      enclosing.set(id, secs.filter((x) => x.openIdx < i && i < x.closeIdx).sort((a2, b2) => a2.openIdx - b2.openIdx));
    }
  }
  const findEnclosingMention = (id) => {
    const secs = (enclosing.get(id) || []).filter((x) => !IGNORE_TAGS.has(x.key));
    for (let i = secs.length - 1; i >= 0; i--) {
      for (const c2 of cotIds) {
        if (mentionsTag(cotTexts.get(c2), secs[i].key) || CJK.test(secs[i].name) && cotTexts.get(c2).includes(secs[i].name)) return { cot: c2, via: `${secs[i].name}（外层分区）` };
      }
    }
    return null;
  };
  for (const id of active) {
    if (cotSet.has(id) || draft.isMarker(id)) continue;
    const p = draft.prompt(id);
    if (!p || !String(p.content || "").trim()) continue;
    let hit = null;
    for (const k of writesOf.get(id) || []) {
      const r = (vars.get(k)?.readers || []).find((x) => cotSet.has(x));
      if (r) {
        hit = { level: "var", via: k, cot: r };
        break;
      }
    }
    if (!hit) {
      for (const k of writesOf.get(id) || []) {
        for (const reader of vars.get(k)?.readers || []) {
          if (reader === id) continue;
          for (const k2 of writesOf.get(reader) || []) {
            const r2 = (vars.get(k2)?.readers || []).find((x) => cotSet.has(x));
            if (r2) {
              hit = { level: "chain", via: `${k} → ${draft.prompt(reader)?.name || reader} → ${k2}`, cot: r2 };
              break;
            }
          }
          if (hit) break;
          const m = findMention(reader);
          if (m) {
            hit = { level: "chain", via: `${k} → ${draft.prompt(reader)?.name || reader} → <${m.via}>`, cot: m.cot };
            break;
          }
        }
        if (hit) break;
      }
    }
    if (!hit) {
      const m = findMention(id);
      if (m) hit = { level: "mention", via: m.via, cot: m.cot };
    }
    if (!hit) {
      const m = findEnclosingMention(id);
      if (m) hit = { level: "mention", via: m.via, cot: m.cot };
    }
    coverage.set(id, hit || { level: "none", via: "", cot: "" });
  }
  const allReaders = /* @__PURE__ */ new Map();
  for (const id of order) {
    if (activeSet.has(id)) continue;
    for (const m of listVarMacros(draft.prompt(id)?.content || "")) {
      if (m.op !== "get" || !m.name) continue;
      const key = (m.scope === "global" ? "全局:" : "") + m.name;
      if (!allReaders.has(key)) allReaders.set(key, /* @__PURE__ */ new Set());
      allReaders.get(key).add(id);
    }
  }
  const issues = [];
  const optional = [];
  for (const [name, v] of vars) {
    if (v.writers.length && !v.readers.length && !/cot$/i.test(name)) {
      const off = [...allReaders.get(name) || []].map((x) => draft.prompt(x)?.name || x);
      const why = off.length ? `；读取它的「${off.slice(0, 2).join("」「")}」${off.length > 2 ? "等" : ""}没开` : "；整个预设里没有任何条目读取它";
      const registrationOnly = v.writers.every(id => detectShape(draft.prompt(id)?.content).shape === "tagname");
      if (registrationOnly) continue;
      issues.push({ kind: "dead", varName: name, ids: v.writers, readersOff: [...allReaders.get(name) || []], text: `写进了变量「${name}」，但没被读取，等于没生效${why}` });
    }
    if (v.readers.length && !v.writers.length) {
      optional.push({ varName: name, ids: v.readers });
    }
  }
  for (const [name, v] of vars) {
    if (/cot$/i.test(name) && v.writers.length && !v.readers.some((r) => cotSet.has(r))) {
      issues.push({ kind: "cotfrag", varName: name, ids: v.writers, text: `这些条目自带思维链片段「${name}」，但开着的思维链里没有读取它` });
    }
  }
  return { cotIds, vars, cot, coverage, issues, optional, activeSet };
}

