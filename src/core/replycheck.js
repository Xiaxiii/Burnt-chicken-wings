// 只检查可见回复的标签与明显格式问题，不改写回复，也不索取思考过程。
function replyRuleTag(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(value.trim())) {
    throw new Error(`${field}须为 1–40 个字的标签名，以字母、中文或下划线开头，仅含字母、数字、中文、下划线或短横线`);
  }
  return value.trim();
}

function normalizeReplyRules(input) {
  if (input == null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("回复格式规则须为对象");
  const bodyTag = replyRuleTag(input.bodyTag === undefined ? "content" : input.bodyTag, "正文标签");
  const thinkingTags = ["think", "thinking"];
  const addThinking = (tag) => {
    const name = replyRuleTag(tag, "思考标签");
    if (!thinkingTags.some((x) => x.toLowerCase() === name.toLowerCase())) thinkingTags.push(name);
  };
  // 同时接受本函数已经规范化的结果，便于检查器与提醒器共用规则。
  if (input.thinkingTags !== undefined) {
    if (!Array.isArray(input.thinkingTags)) throw new Error("思考标签列表须为数组");
    input.thinkingTags.forEach(addThinking);
  }
  if (input.thinkingTag !== undefined && input.thinkingTag !== "") addThinking(input.thinkingTag);
  const thinkingKeys = new Set(thinkingTags.map((tag) => tag.toLowerCase()));
  if (thinkingKeys.has(bodyTag.toLowerCase())) throw new Error("正文标签不可与思考标签重复");
  let required = input.requiredTags === undefined ? [] : input.requiredTags;
  if (typeof required === "string") required = required.split(/[,，、\s]+/u).filter(Boolean);
  if (!Array.isArray(required)) throw new Error("必需标签须为数组或用逗号、空白分隔的字符串");
  const requiredTags = [];
  for (const value of required) {
    const tag = replyRuleTag(value, "必需标签");
    if (thinkingKeys.has(tag.toLowerCase())) throw new Error(`必需标签「${tag}」不可是思考标签`);
    if (!requiredTags.some((x) => x.toLowerCase() === tag.toLowerCase())) requiredTags.push(tag);
  }
  return { bodyTag, thinkingTags, requiredTags };
}

// 按出现顺序进入代码或注释，代码里的注释符、注释里的围栏不改变外层状态。
// 同时屏蔽常见的单行 Markdown 反引号代码示例。
// 保留字符位置与换行；preserveCode 用于检查可见正文，保留代码内容。
function replyCheckMask(text, preserveCode = false) {
  const blank = (part) => part.replace(/[^\r\n]/g, " ");
  let fence = null;
  let inComment = false;
  return text.split(/(?<=\n)/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*?)(?:\r?\n)?$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return preserveCode ? line : blank(line);
    }
    if (!inComment && marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
      fence = { char: marker[1][0], length: marker[1].length };
      return preserveCode ? line : blank(line);
    }
    let cursor = 0;
    let result = "";
    while (cursor < line.length) {
      if (inComment) {
        const close = line.indexOf("-->", cursor);
        const end = close < 0 ? line.length : close + 3;
        result += blank(line.slice(cursor, end));
        cursor = end;
        inComment = close < 0;
      } else {
        const start = line.indexOf("<!--", cursor);
        const tick = line.indexOf("`", cursor);
        if (tick >= 0 && (start < 0 || tick < start)) {
          result += line.slice(cursor, tick);
          let runEnd = tick + 1;
          while (line[runEnd] === "`") runEnd++;
          const ticks = /`+/g;
          ticks.lastIndex = runEnd;
          let close;
          while ((close = ticks.exec(line)) && close[0].length !== runEnd - tick) {}
          if (close) {
            const end = close.index + close[0].length;
            const code = line.slice(tick, end);
            result += preserveCode ? code : blank(code);
            cursor = end;
          } else {
            // 没有成对结束的反引号只是普通字符，不吞掉后面的真实标签。
            result += line.slice(tick, runEnd);
            cursor = runEnd;
          }
          continue;
        }
        const end = start < 0 ? line.length : start;
        result += line.slice(cursor, end);
        cursor = end;
        inComment = start >= 0;
      }
    }
    return result;
  }).join("");
}

function checkReplyFormat(text, inputRules) {
  const rules = normalizeReplyRules(inputRules);
  const source = String(text == null ? "" : text);
  const masked = replyCheckMask(source);
  const bodyKey = rules.bodyTag.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const required = new Map([rules.bodyTag, ...rules.requiredTags].map((tag) => [tag.toLowerCase(), tag]));
  const watched = new Set([...required.keys(), ...thinking]);
  const stats = new Map([...watched].map((key) => [key, { opens: 0, closes: 0, selfClosing: 0, ranges: [] }]));
  const issues = [];
  const seen = new Set();
  const add = (kind, text, tag) => {
    const key = `${kind}\n${tag || ""}\n${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ kind, text, ...(tag ? { tag } : {}) });
    }
  };
  const stack = [];
  const scopeRanges = [];
  const tags = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = tags.exec(masked))) {
    const key = match[2].toLowerCase();
    if (!watched.has(key)) continue;
    const stat = stats.get(key);
    const closing = !!match[1];
    const selfClosing = !!match[3];
    const tag = required.get(key) || rules.thinkingTags.find((name) => name.toLowerCase() === key);
    const inThinking = stack.some((open) => thinking.has(open.key));
    const inBody = stack.some((open) => open.key === bodyKey);
    if (required.has(key) && inThinking) add("swallowed", `「${tag}」标签落在思考标签内部，正文或必需内容可能被吞入思考区`, tag);
    if (thinking.has(key) && inBody) add("leak", `正文内部出现「${tag}」思考标签，可能夹入了思考内容`, tag);
    if (selfClosing) {
      stat.selfClosing++;
      add("order", `「${tag}」须使用完整的开始、结束标签，不能自闭合`, tag);
      continue;
    }
    if (!closing) {
      stat.opens++;
      if (thinking.has(key) && inThinking) add("order", "思考标签互相嵌套，闭合结构不正确", tag);
      stack.push({ key, tag, start: match.index, contentStart: tags.lastIndex });
      continue;
    }
    stat.closes++;
    const index = stack.map((open) => open.key).lastIndexOf(key);
    if (index < 0) {
      add("order", `「${tag}」结束标签前没有对应的开始标签`, tag);
      continue;
    }
    if (index !== stack.length - 1) add("order", `「${tag}」与其他标签交叉，闭合顺序不正确`, tag);
    const open = stack.splice(index, 1)[0];
    const range = { start: open.start, contentStart: open.contentStart, contentEnd: match.index, end: tags.lastIndex, key };
    stat.ranges.push(range);
    if (key === bodyKey || thinking.has(key)) scopeRanges.push(range);
  }
  for (const open of stack) {
    add("order", `「${open.tag}」开始标签没有闭合`, open.tag);
    if (open.key === bodyKey || thinking.has(open.key)) scopeRanges.push({ start: open.start, end: source.length, key: open.key });
  }
  for (const [key, tag] of required) {
    const stat = stats.get(key);
    if (!stat.opens && !stat.closes) add("missing", `缺少完整的 <${tag}>…</${tag}> 标签`, tag);
    else if (!stat.opens) add("missing", `缺少 <${tag}> 开始标签`, tag);
    else if (!stat.closes) add("missing", `缺少 </${tag}> 结束标签`, tag);
    if (stat.opens + stat.selfClosing > 1 || stat.closes > 1) add("duplicate", `「${tag}」应完整成对出现一次，当前重复出现`, tag);
  }
  const visibleSource = replyCheckMask(source, true);
  for (const range of stats.get(bodyKey).ranges) {
    const content = visibleSource.slice(range.contentStart, range.contentEnd).replace(/<[^<>]*>/g, "").trim();
    if (!content) add("empty", "正文标签内没有可见正文", rules.bodyTag);
  }
  // 这里只标记正文与已知思考区之外的明确步骤标题；语义泄露仍须人工判断。
  const heading = /^ {0,3}(?:#{1,6}\s*)?(?:(?:思考|分析|推理)(?:过程|步骤|阶段)?|Analysis|Reasoning|Thinking)(?:\s*[：:]\s*.*|\s*)$|^ {0,3}(?:#{1,6}\s*)?(?:Step|Phase)\s+\d+(?:\s*[.:：)\-–—]\s*.*|\s+.*|\s*)$/i;
  let offset = 0;
  for (const line of masked.split(/(?<=\n)/)) {
    const first = offset + line.search(/\S|$/);
    if (heading.test(line.trimEnd()) && !scopeRanges.some((range) => first >= range.start && first < range.end)) {
      add("suspected", "正文标签外出现疑似思考或推理步骤标题，请人工确认是否泄露了内部分析");
    }
    offset += line.length;
  }
  return { issues, rules };
}

function buildReplyReminder(report, inputRules) {
  if (!report?.issues?.length) return "";
  const rules = normalizeReplyRules(inputRules || report.rules);
  const tags = [rules.bodyTag, ...rules.requiredTags].filter((tag, index, list) => list.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index);
  return `【回复格式提醒】请让 ${tags.map((tag) => `<${tag}>…</${tag}>`).join("、")} 各完整成对出现一次，准确闭合，并置于思考标签之外。正文不夹入思考步骤或内部分析；无需展示思考过程，也不要复述上一轮内容。`;
}
