// 只搬运预设内置正则数据，不编译查找表达式、不执行替换内容。
function presetRegexList(draft) {
  const extensions = draft?.preset?.extensions;
  if (extensions != null && (typeof extensions !== "object" || Array.isArray(extensions))) throw new Error("预设扩展数据格式不正确，未修改正则");
  const rules = extensions?.regex_scripts;
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) throw new Error("预设内置正则必须是数组，请先核对原数据");
  return rules;
}
function presetRegexSnapshot(draft) {
  return JSON.stringify({ present: Object.hasOwn(draft?.preset?.extensions || {}, "regex_scripts"), rules: draft?.preset?.extensions?.regex_scripts });
}
function presetRegexCanonical(value) {
  if (Array.isArray(value)) return value.map(presetRegexCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, presetRegexCanonical(value[key])]));
  }
  return value;
}
function presetRegexIdentity(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const { id: _id, ...content } = rule;
  return JSON.stringify(presetRegexCanonical(content));
}
function presetRegexRuleValid(rule) {
  return !!rule && typeof rule === "object" && !Array.isArray(rule)
    && typeof rule.findRegex === "string" && typeof rule.replaceString === "string"
    && Array.isArray(rule.placement) && rule.placement.every(Number.isInteger)
    && (rule.id == null || typeof rule.id === "string");
}
function presetRegexNewId(reserved) {
  for (let i = 0; i < 100; i++) {
    const id = uid();
    if (typeof id === "string" && id && !reserved.has(id)) return id;
  }
  throw new Error("无法生成不重复的正则编号，请重新预览");
}
/** 纯计划：保持目标顺序，新规则按来源顺序追加；替换必须明确选择。 */
function planPresetRegexTransfer(sourceDraft, targetDraft, { selectedIndices = [], conflictChoices = {} } = {}) {
  const source = presetRegexList(sourceDraft), target = presetRegexList(targetDraft);
  if (!Array.isArray(selectedIndices) || selectedIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= source.length)) throw new Error("所选正则不存在，请重新选择");
  const selected = new Set(selectedIndices);
  const rules = clone(target);
  const reserved = new Set(target.map((r) => r?.id).filter((id) => typeof id === "string" && id));
  const replaced = new Set();
  const targetIdentities = target.map(presetRegexIdentity);
  const originalIdentities = new Set(targetIdentities.filter((x) => x !== null));
  const identityCounts = new Map();
  const countIdentity = (identity, delta) => {
    if (identity !== null) identityCounts.set(identity, (identityCounts.get(identity) || 0) + delta);
  };
  targetIdentities.forEach((identity) => countIdentity(identity, 1));
  const rows = [], stats = { added: 0, replaced: 0, skipped: 0 };
  for (let i = 0; i < source.length; i++) {
    const original = source[i], valid = presetRegexRuleValid(original);
    const identity = presetRegexIdentity(original);
    const name = typeof original?.scriptName === "string" ? original.scriptName.trim() : "";
    const id = typeof original?.id === "string" ? original.id : "";
    const conflicts = target.flatMap((r, index) => {
      if (!r || typeof r !== "object") return [];
      const sameId = !!id && r.id === id;
      const sameName = !!name && typeof r.scriptName === "string" && r.scriptName.trim() === name;
      return sameId || sameName ? [{ index, id: r.id, name: typeof r.scriptName === "string" && r.scriptName ? r.scriptName : "未命名正则" }] : [];
    });
    const row = { sourceIndex: i, invalid: !valid, duplicate: identity !== null && originalIdentities.has(identity), conflicts, action: "unselected" };
    rows.push(row);
    if (!selected.has(i)) continue;
    if (!valid) { row.action = "skip"; stats.skipped++; continue; }
    const decision = conflictChoices[i] ?? "keep";
    const action = typeof decision === "string" ? decision : decision?.action;
    if (!["keep", "skip", "replace"].includes(action)) throw new Error("无法识别冲突处理方式，请重新选择");
    if (action === "skip") { row.action = "skip"; stats.skipped++; continue; }
    if (row.duplicate || identityCounts.get(identity) > 0) {
      row.action = "skip";
      row.batchDuplicate = !row.duplicate;
      stats.skipped++;
      continue;
    }
    const copy = clone(original);
    if (action === "replace") {
      const index = typeof decision === "object" ? decision?.targetIndex : conflicts.length === 1 ? conflicts[0].index : undefined;
      if (!Number.isInteger(index) || !conflicts.some((c) => c.index === index)) throw new Error("请明确选择要替换的那一条目标正则，或选择保留两份/跳过");
      if (replaced.has(index)) throw new Error("多条来源正则选择替换同一目标，请只选择一条或调整冲突处理");
      const oldId = target[index]?.id;
      copy.id = typeof oldId === "string" && oldId ? oldId : presetRegexNewId(reserved);
      reserved.add(copy.id);
      countIdentity(targetIdentities[index], -1);
      rules[index] = copy;
      replaced.add(index);
      row.action = "replace";
      row.targetIndex = index;
      stats.replaced++;
    } else {
      if (!copy.id || reserved.has(copy.id)) copy.id = presetRegexNewId(reserved);
      reserved.add(copy.id);
      rules.push(copy);
      row.action = "append";
      row.targetIndex = rules.length - 1;
      stats.added++;
    }
    countIdentity(identity, 1);
  }
  return {
    sourceName: sourceDraft.name, targetName: targetDraft.name,
    sourceSignature: presetRegexSnapshot(sourceDraft), targetSignature: presetRegexSnapshot(targetDraft),
    rows, rules, stats, resultSignature: JSON.stringify(rules)
  };
}
function validatePresetRegexTransfer(targetDraft, plan, sourceDraft) {
  presetRegexList(targetDraft);
  if (!plan || plan.targetName !== targetDraft.name || plan.targetSignature !== presetRegexSnapshot(targetDraft)) throw new Error("目标预设的正则已变化，请重新预览");
  if (!sourceDraft || plan.sourceName !== sourceDraft.name || plan.sourceSignature !== presetRegexSnapshot(sourceDraft)) throw new Error("来源预设的正则已变化，请重新预览");
  if (!Array.isArray(plan.rules) || plan.resultSignature !== JSON.stringify(plan.rules)) throw new Error("正则缝合方案已变化，请重新预览");
}
function applyPresetRegexTransfer(targetDraft, plan, sourceDraft) {
  validatePresetRegexTransfer(targetDraft, plan, sourceDraft);
  if (!plan.stats.added && !plan.stats.replaced) return false;
  if (!targetDraft.preset.extensions) targetDraft.preset.extensions = {};
  targetDraft.preset.extensions.regex_scripts = clone(plan.rules);
  return true;
}
