// 1.3.0：写法分析——一个预设"是怎么让条目生效的"，以及某一条在它自己的预设里是怎么起作用的。
// 缝合时同时分析来源和目标，按两边的差异自动改写，并决定要不要挂进思维链。

var TRIGGER_NAMES = { normal: "普通发送", continue: "继续", impersonate: "代拟", swipe: "重抽", regenerate: "重新生成", quiet: "后台生成" };
function hasConditional(text) {
  return /\{\{\s*(?:if|else|\/if)\b/i.test(text);
}
function hasScript(text) {
  return /<%[\s\S]*?%>/.test(text) || /\{\{\s*(?:run|eval)\b/i.test(text);
}
function hasRandom(text) {
  return /\{\{\s*(?:random|pick|roll)\s*[:}]/i.test(text);
}
function namesOf(draft, ids, n = 3) {
  const list = ids.map((id) => draft.prompt(id)?.name || id);
  return list.slice(0, n).map((x) => `「${x}」`).join("") + (list.length > n ? ` 等 ${list.length} 条` : "");
}

/** 整个预设的写法画像 */
function profilePreset(draft) {
  const a = analyze(draft);
  const cotSet = new Set(a.cotIds);
  const order = draft.order.map((o) => o.identifier);
  const active = order.filter((id) => draft.isActive(id));
  const P = (id) => draft.prompt(id);
  // 思维链怎么读条目
  const cotVarReads = a.cotIds.reduce((n, id) => n + listVarMacros(P(id)?.content || "").filter((m) => m.op === "get").length, 0);
  let covVar = 0, covMention = 0;
  for (const c2 of a.coverage.values()) {
    if (c2.level === "var" || c2.level === "chain") covVar++;
    else if (c2.level === "mention") covMention++;
  }
  const cotStyle = !a.cotIds.length ? "none" : cotVarReads >= 3 && covVar >= covMention ? "vars" : covMention > 0 && cotVarReads < 3 ? "text" : cotVarReads ? "mixed" : "text";
  // 变量用法
  const perEntry = [];
  const shared = [];
  for (const [key, v] of a.vars) {
    const name = key.replace(/^全局:/, "");
    const cotReaders = v.readers.filter((r) => cotSet.has(r));
    const writers = v.writers.filter((w) => !cotSet.has(w));
    if (!writers.length) continue;
    if (writers.length === 1 && cotReaders.length) perEntry.push(name);
    if (writers.length >= 2) {
      const ops = writers.flatMap((w) => listVarMacros(P(w)?.content || "").filter((m) => m.name === name && (m.op === "set" || m.op === "add") && !isBlankValue(m.value)).map((m) => m.op));
      const shapes = writers.map((w) => detectShape(P(w)?.content).shape);
      shared.push({ name, writers, op: mostCommon(ops) || "set", wrap: shapes.filter((s) => s === "wrap").length >= writers.length / 2, cotReads: cotReaders.length > 0, readers: v.readers });
    }
  }
  const usesGlobal = [...a.vars.keys()].some((k) => k.startsWith("全局:"));
  const initId = findInitEntry(draft);
  // 外层结构标签（比如 <text_style> 由一条开、另一条关）
  const wrappers = [];
  {
    const stack = [];
    for (const id of active) {
      if (cotSet.has(id)) continue;
      const text = String(P(id)?.content || "").replace(/\{\{\/\/[\s\S]*?\}\}/g, "").replace(/<!--[\s\S]*?-->/g, "");
      for (const m of text.matchAll(/^[ \t]*<(\/?)([^\s>\/!][^>\n]{0,30})>[ \t]*$/gm)) {
        const name = m[2].split(/[：:\s]/)[0];
        if (!m[1]) stack.push({ name, id });
        else {
          const k = stack.map((x) => x.name).lastIndexOf(name);
          if (k >= 0) {
            const o = stack.splice(k, 1)[0];
            if (o.id !== id) wrappers.push({ name, openId: o.id, closeId: id });
          }
        }
      }
    }
  }
  // 特殊触发
  const depth = active.filter((id) => P(id)?.injection_position === 1);
  const gen = active.filter((id) => (P(id)?.injection_trigger || []).length);
  const cond = active.filter((id) => hasConditional(P(id)?.content || ""));
  const script = active.filter((id) => hasScript(P(id)?.content || ""));
  const random = active.filter((id) => hasRandom(P(id)?.content || ""));
  const regex = (draft.preset.extensions?.regex_scripts || []).filter((r) => !r.disabled);
  const regexPrompt = regex.filter((r) => r.promptOnly || !r.markdownOnly);
  // 用大白话总结
  const lines = [];
  if (cotStyle === "none") lines.push("没认出开着的思维链（名字特别的话，可以在「思维链」页手动设为思维链）。");
  else {
    const how = cotStyle === "vars" ? "主要靠变量把条目读进来（{{getvar}}）" : cotStyle === "text" ? "靠文字点名——在思维链里写到条目的名字或标签，不读变量" : "一部分靠变量读，一部分靠文字点名";
    lines.push(`思维链 ${a.cotIds.length} 条（${namesOf(draft, a.cotIds, 2)}），${how}。`);
  }
  if (perEntry.length >= 2) lines.push(`条目各自登记一个问句变量，再由思维链逐个读出（比如 ${perEntry.slice(0, 3).join("、")}）——缝进来的条目最好也照这样挂上。`);
  for (const s of shared.slice(0, 4)) {
    if (s.op === "add" && s.cotReads) lines.push(`${s.writers.length} 条用 addvar 往「${s.name}」里追加思维链片段，思维链统一读它。`);
    else if (s.wrap) lines.push(`${s.writers.length} 条把整段正文包进「${s.name}」（${s.op === "set" ? "setvar：同时开几条只认最后一条，相当于单选" : "addvar：开着的会接在一起"}），由 ${namesOf(draft, s.readers, 2)} 读出。`);
    else lines.push(`${s.writers.length} 条往同一个变量「${s.name}」里写（${s.op}var）。`);
  }
  if (usesGlobal) lines.push("用到了全局变量（setglobalvar），换聊天也会保留。");
  if (initId) lines.push(`「${P(initId)?.name}」负责每轮把变量清空（初始化条目）。`);
  for (const w of wrappers.slice(0, 3)) lines.push(`<${w.name}> 由「${P(w.openId)?.name}」开始、「${P(w.closeId)?.name}」结束，中间的条目都算在它里面。`);
  const trig = [];
  if (depth.length) trig.push(`${depth.length} 条插在聊天记录里（深度注入）`);
  if (gen.length) trig.push(`${gen.length} 条只在特定生成方式下发送`);
  if (cond.length) trig.push(`${cond.length} 条带 {{if}} 条件`);
  if (script.length) trig.push(`${script.length} 条带脚本（EJS 等，需要对应插件）`);
  if (random.length) trig.push(`${random.length} 条带随机宏`);
  if (regexPrompt.length) trig.push(`${regexPrompt.length} 条正则会改发出去的内容`);
  if (trig.length) lines.push(`特殊的生效方式：${trig.join("，")}。`);
  if (!lines.length) lines.push("条目都是直接写正文，开着就发送。");
  return { a, cotStyle, perEntry, shared, usesGlobal, initId, wrappers, depth, gen, cond, script, random, regex: regexPrompt, lines };
}

/** 某一条在它自己的预设里是怎么起作用的 */
function describeEntry(draft, id, prof = null) {
  const p = draft.prompt(id);
  if (!p) return { lines: [], cot: null, needsVars: [] };
  const pr = prof || profilePreset(draft);
  const a = pr.a;
  const content = String(p.content || "");
  const s = detectShape(content);
  const lines = [];
  const nm = (x) => draft.prompt(x)?.name || x;
  const readersOf = (name) => (a.vars.get(name)?.readers || []).filter((r) => r !== id);
  const vk = (s.scope === "global" ? "全局:" : "") + (s.varName || "");
  if (!draft.isActive(id)) lines.push("在原预设里是关着的");
  if (s.shape === "wrap") {
    const rs = readersOf(vk);
    lines.push(`整段正文包在变量「${s.varName}」里（${s.op}var），${rs.length ? `由「${nm(rs[0])}」读出来才会发送` : "原预设里没看到谁读它"}`);
  } else if (s.shape === "tagname") {
    const rs = readersOf(vk);
    lines.push(`正文直接发送，末尾把名字登记到「${s.varName}」${rs.length ? `（「${nm(rs[0])}」会读）` : ""}`);
  } else if (s.shape === "init") lines.push("这是变量初始化条目，只负责清空变量");
  else lines.push("正文直接写，开着就发送");
  const extraWrites = listVarMacros(content).filter((m) => m.depth === 0 && (m.op === "set" || m.op === "add") && !isBlankValue(m.value) && m.name !== s.varName);
  for (const m of extraWrites.slice(0, 2)) {
    const rs = readersOf((m.scope === "global" ? "全局:" : "") + m.name);
    lines.push(`另外登记了「${m.name}」${rs.length ? `，给「${nm(rs[0])}」读` : ""}`);
  }
  if (p.injection_position === 1) lines.push(`插在聊天记录里：深度 ${p.injection_depth ?? 4}，以 ${p.role || "system"} 身份`);
  if ((p.injection_trigger || []).length) lines.push(`只在 ${p.injection_trigger.map((t) => TRIGGER_NAMES[t] || t).join("、")} 时发送`);
  if (hasConditional(content)) lines.push("带 {{if}} 条件，要满足条件才发送对应部分");
  if (hasScript(content)) lines.push("带脚本（EJS 等），目标也要装同样的插件才会生效");
  if (hasRandom(content)) lines.push("带随机宏，每次发送内容可能不同");
  const reads = [...new Set(listVarMacros(content).filter((m) => m.op === "get" && m.name).map((m) => (m.scope === "global" ? "全局:" : "") + m.name))];
  const needsVars = reads.filter((k) => (a.vars.get(k)?.writers || []).some((w) => w !== id));
  if (needsVars.length) lines.push(`会读取变量 ${needsVars.slice(0, 4).map((k) => `「${k}」`).join("")}，这些是别的条目写的`);
  let cov = a.coverage.get(id);
  if (!cov || cov.level === "none") {
    // 关着的条目不在分析范围里，单独看一下：它写的变量有没有思维链读、思维链里有没有提到它
    const cotSet = new Set(a.cotIds);
    for (const m of listVarMacros(content)) {
      if (!m.name || !(m.op === "set" || m.op === "add") || isBlankValue(m.value)) continue;
      const r = (a.vars.get((m.scope === "global" ? "全局:" : "") + m.name)?.readers || []).find((x) => cotSet.has(x));
      if (r) { cov = { level: "var", via: m.name, cot: r }; break; }
    }
    if (!cov || cov.level === "none") {
      const tags = [...exposedTags(content)].filter((t) => !IGNORE_TAGS.has(t));
      const hs = entryHandles(p).filter((h) => h.cjk);
      for (const c2 of a.cot) {
        const t = tags.find((x) => c2.mentions.includes(x));
        if (t) { cov = { level: "mention", via: t, cot: c2.id }; break; }
        const txt = cotPlainText(draft.prompt(c2.id)?.content);
        const h = hs.find((x) => txt.includes(x.needle));
        if (h) { cov = { level: "mention", via: h.ref, cot: c2.id }; break; }
      }
    }
  }
  let cot = null;
  if (a.cotIds.includes(id) || isCotEntry(draft, id)) cot = { level: "self", text: "它本身就是思维链" };
  else if (cov && cov.level !== "none") cot = { level: cov.level, text: cov.level === "mention" ? `思维链「${nm(cov.cot)}」里提到了它（${cov.via}）` : `思维链「${nm(cov.cot)}」通过「${cov.via}」读到它` };
  else if (pr.cotStyle !== "none") cot = { level: "none", text: "原预设的思维链没有读到/提到它" };
  // 在原预设里位于哪个外层标签里
  const pos = draft.order.findIndex((o) => o.identifier === id);
  const inside = pr.wrappers.filter((w) => {
    const i1 = draft.order.findIndex((o) => o.identifier === w.openId);
    const i2 = draft.order.findIndex((o) => o.identifier === w.closeId);
    return i1 < pos && pos < i2;
  }).map((w) => w.name);
  if (inside.length) lines.push(`在原预设里位于 <${inside.join("> / <")}> 里面`);
  return { lines, cot, needsVars, inside };
}

/** 缝到目标的某个位置后，会在哪些外层标签里 */
function wrappersAt(draft, prof, idx) {
  return prof.wrappers.filter((w) => {
    const i1 = draft.order.findIndex((o) => o.identifier === w.openId);
    const i2 = draft.order.findIndex((o) => o.identifier === w.closeId);
    return i1 < idx && idx <= i2;
  }).map((w) => w.name);
}
