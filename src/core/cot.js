var COT_NAME = /cot|思维链|思考|thinking|推理|内在思|reasoning|phase/i;
function isCotEntry(draft, id, manual = {}) {
  if (manual[id] !== void 0) return !!manual[id];
  const p = draft.prompt(id);
  if (!p) return false;
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
  const ot = /^\s*<([^>\/\n!]{2,30})>/.exec(body);
  if (ot) {
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
      const ms = cotMentions.get(c2);
      const hit = tags.find((t) => ms.has(t));
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
  // 1.1.3：外层结构标签。像 <text_style> 这种由前一个条目单独开一行、后面条目单独一行关闭的标签，
  // 中间的条目（例如缝进来的文风）本身不带标签，旧版会一律判成"没提到"。
  const enclosing = /* @__PURE__ */ new Map();
  {
    const stack = [];
    for (const id of active) {
      enclosing.set(id, [...new Set(stack)]);
      if (cotSet.has(id)) continue;
      const text = String(draft.prompt(id)?.content || "").replace(/\{\{\/\/[\s\S]*?\}\}/g, "").replace(/<!--[\s\S]*?-->/g, "");
      for (const m of text.matchAll(/^[ \t]*<(\/?)([A-Za-z_][\w-]{2,40})(?:[：:][^>\n]{0,40})?>[ \t]*$/gm)) {
        const name = m[2].toLowerCase();
        if (!m[1]) stack.push(name);
        else {
          const k = stack.lastIndexOf(name);
          if (k >= 0) stack.splice(k, 1);
        }
      }
    }
  }
  const findEnclosingMention = (id) => {
    const tags = (enclosing.get(id) || []).filter((t) => !IGNORE_TAGS.has(t));
    for (let i = tags.length - 1; i >= 0; i--) {
      for (const c2 of cotIds) if (cotMentions.get(c2)?.has(tags[i])) return { cot: c2, via: `${tags[i]}（外层标签）` };
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

