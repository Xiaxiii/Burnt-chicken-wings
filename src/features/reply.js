// 正文格式检查的辅助逻辑（原 ui/replyview.js）
// 按预设开着的条目和显示正则猜标签；读不到预设时不猜
function replyTagGuess(name) {
  try {
    const d = getDraft(name);
    const texts = d.order.filter((o) => d.isActive(o.identifier)).map((o) => d.prompt(o.identifier)?.content);
    const regexTags = [];
    try { for (const rule of presetRegexList(d)) if (!rule?.disabled) regexTags.push(...presetRegexAnchors(rule).tags); } catch {}
    return guessReplyTags(texts, regexTags);
  } catch { return null; }
}

// 酒馆「推理内容格式化」的前缀，如 <ECoT>：预设用它包思考，检查时当作思考标签
function stReasoningTag(c = ctx()) {
  const r = c.powerUserSettings?.reasoning;
  const m = /^<\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39})\s*>$/u.exec(String(r?.prefix || "").trim());
  return m ? { tag: m[1], autoParse: !!r.auto_parse } : null;
}
