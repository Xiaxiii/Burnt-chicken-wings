// 预设正则的名称与作用范围（原 ui/regex.js）
// 预设正则只搬运原生数据；查找表达式和替换 HTML 在此处始终作为文本展示。
function presetRegexRuleName(rule) {
  return typeof rule?.scriptName === "string" && rule.scriptName ? rule.scriptName : "未命名正则";
}

function presetRegexRuleScope(rule) {
  if (rule?.markdownOnly && !rule?.promptOnly) return "仅显示美化";
  if (rule?.promptOnly && !rule?.markdownOnly) return "发送给模型";
  if (rule?.markdownOnly && rule?.promptOnly) return "显示美化及发送";
  return "通用处理";
}

function presetRegexRulesSnapshot(draft) {
  return presetRegexSnapshot(draft);
}
