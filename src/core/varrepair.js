// 变量修复与按变量名排序的判断逻辑（不碰界面）。
// 「修复变量问题」：写进变量却没人读的内容，补一个读取条目；缝合留下的多余外层包裹，整理掉。

// 值里只有简单宏（{{char}}、{{random}}、{{getvar}} 这类），没有嵌套和条件
function simpleValueMacros(text) {
  const input = String(text || "");
  const tops = scanTopMacros(input);
  const allowed = ["char", "user", "random", "pick", "newline", "trim", "noop", "getvar", "getglobalvar", "//"];
  for (const t of tops) {
    const head = t.inner.split("::")[0].trim().toLowerCase();
    if (t.inner.includes("{{") || !allowed.includes(head)) return false;
  }
  let rest = input;
  for (const t of [...tops].reverse()) rest = rest.slice(0, t.start) + rest.slice(t.end);
  return !rest.includes("{{") && !rest.includes("}}");
}

// 正文里的宏都是变量宏，且值只含简单宏
function safeInterpolatedVariableText(text) {
  return scanTopMacros(text).every((t) => {
    const v = parseVarMacro(t.inner);
    return v && !/[{}]/.test(v.name) && (!v.value || simpleValueMacros(v.value));
  });
}

// 整条正文只是 {{setvar::外层::{{setvar|addvar::内层::…}}}} 这种两层包裹
function redundantVariableWrapper(content) {
  const text = String(content || "");
  const tops = scanTopMacros(text);
  if (tops.length !== 1 || text.slice(0, tops[0].start).trim() || text.slice(tops[0].end).trim()) return null;
  const outer = parseVarMacro(tops[0].inner);
  if (!outer || outer.op !== "set" || !outer.value || /[{}]/.test(outer.name)) return null;
  const inside = scanTopMacros(outer.value);
  if (inside.length !== 1 || outer.value.slice(0, inside[0].start).trim() || outer.value.slice(inside[0].end).trim()) return null;
  const inner = parseVarMacro(inside[0].inner);
  if (!inner || !["set", "add"].includes(inner.op) || !inner.value || /[{}]/.test(inner.name) || !simpleValueMacros(inner.value)) return null;
  return { outer, inner, content: outer.value.trim() };
}

// 只整理缝合进来、外层变量没人读取、没有特殊触发的条目
function wrapperPlan(d, id) {
  const p = d.prompt(id);
  const wrap = redundantVariableWrapper(p?.content);
  if (!wrap) return null;
  if (!d.preset.extensions.wi_preset_suture_origins?.[id] && !/\[来自.+\]/.test(p.name || "")) return null;
  if (p.injection_position === 1 || p.injection_trigger?.length) return null;
  const referenced = d.preset.prompts.some((other) => listVarMacros(other.content).some((m) => m.op === "get" && m.name === wrap.outer.name && m.scope === wrap.outer.scope));
  if (referenced) return null;
  return { id, ...wrap };
}

function applyWrapperNormalization(d) {
  const plans = d.order.filter((o) => d.isActive(o.identifier)).map((o) => wrapperPlan(d, o.identifier)).filter(Boolean);
  for (const plan of plans) {
    const p = d.prompt(plan.id);
    if (!d.preset.extensions.presetAtelierEntryLabels) d.preset.extensions.presetAtelierEntryLabels = {};
    d.preset.extensions.presetAtelierEntryLabels[plan.id] = plan.outer.name;
    p.content = plan.content;
  }
  return plans;
}

// 给一个「写了没人读」的变量出修复方案：在最后一个写入它的开启条目后面加一条读取。
// 有任何需要人判断的情况（按深度插入、条件、脚本、复杂嵌套、计数）都不自动改，抛出原因。
function variableRepairPlan(d, key, manual = d.cotManual || {}) {
  const scope = key.startsWith("全局:") ? "global" : "local";
  const name = scope === "global" ? key.slice(3) : key;
  if (!name.trim() || /[{}]/.test(name)) throw new Error("变量名为空或包含动态宏，需人工核对，未添加通用读取");
  const same = (m) => m.name === name && m.scope === scope;
  const WRITE = ["set", "add", "inc", "dec"];
  const touches = d.order
    .filter((o) => d.isActive(o.identifier))
    .filter((o) => listVarMacros(d.prompt(o.identifier)?.content).some((m) => same(m) && WRITE.includes(m.op)));
  if (!touches.length) throw new Error("没有开启的条目写入该变量");
  if (/cot$/i.test(name)) throw new Error("该变量可能保存思维链片段，请使用「接入思维链」核对读取位置，未添加通用读取");
  for (const o of touches) {
    const p = d.prompt(o.identifier);
    const nm = p.name || o.identifier;
    if (isCotEntry(d, o.identifier, manual)) throw new Error(`「${nm}」被识别为思维链条目，请使用「接入思维链」核对读取位置，未添加通用读取`);
    if (listVarMacros(p.content).some((m) => same(m) && (m.op === "inc" || m.op === "dec"))) {
      throw new Error(`「${nm}」对该变量执行计数，需人工核对，未添加通用读取`);
    }
    if (p.injection_position === 1) throw new Error(`「${nm}」按深度插入聊天记录，执行顺序需人工核对`);
    if (p.injection_trigger?.length) throw new Error(`「${nm}」设有触发条件，触发时机需人工核对`);
    if (/\{\{(?:if|else|while|run|eval)|<%/i.test(p.content || "")) throw new Error(`「${nm}」含条件或脚本，需人工核对`);
    if (/\{\{[^{}]*\{\{/i.test(p.content || "") && !safeInterpolatedVariableText(p.content)) {
      if (wrapperPlan(d, o.identifier)) throw new Error("存在未被读取的外层变量包裹。请先点顶部「修复变量问题」整理包裹");
      throw new Error(`「${nm}」嵌套复杂，或外层变量被其他条目读取，未自动修改`);
    }
  }
  const last = touches[touches.length - 1].identifier;
  const finalWrites = listVarMacros(d.prompt(last)?.content).filter((m) => same(m) && WRITE.includes(m.op));
  const lastWrite = finalWrites.at(-1);
  if (lastWrite?.op === "set" && isBlankValue(lastWrite.value)) {
    throw new Error("最后一次写入是清空，需先核对写入顺序");
  }
  const readers = d.order.filter((o) => d.isActive(o.identifier) && listVarMacros(d.prompt(o.identifier)?.content).some((m) => same(m) && m.op === "get"));
  if (readers.length) throw new Error("已有开启的条目读取该变量，请核对其位置和条件");
  return { last, macro: `{{${macroName("get", scope)}::${name}}}`, name, key };
}

// ---- 按变量名排序：文风1、文风2… 拆成「类别 + 编号」
function tagKey(d, id) {
  const shape = detectShape(d.prompt(id)?.content);
  const label = d.preset.extensions.presetAtelierEntryLabels?.[id] || shape.varName || (d.isMarker(id) ? "酒馆位置" : "无变量名");
  const m = /^(.*?)(\d+)$/.exec(label.trim());
  return { label, category: m ? m[1] : label, number: m ? Number(m[2]) : -1 };
}
function sortTagIds(d, ids, categories) {
  const rank = new Map(categories.map((x, i) => [x, i]));
  return ids
    .map((id, i) => ({ id, i, t: tagKey(d, id) }))
    .sort((a, b) => (rank.get(a.t.category) ?? 1e9) - (rank.get(b.t.category) ?? 1e9) || a.t.number - b.t.number || a.i - b.i)
    .map((x) => x.id);
}
