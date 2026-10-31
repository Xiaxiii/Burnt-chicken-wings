// 只检查可见回复的标签与明显格式问题，也不索取思考过程。改写只在用户确认「修正标签」后进行，且只移动或补写标签。
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

// 正文标签外、未被任何成对标签包住的文字。代码块与注释已被遮住，单个 HTML 标签本身不算字。
function replyPairRanges(masked) {
  const ranges = [];
  const stack = [];
  const any = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = any.exec(masked))) {
    if (match[3]) continue;
    const key = match[2].toLowerCase();
    if (!match[1]) { stack.push({ key, start: match.index }); continue; }
    const index = stack.map((open) => open.key).lastIndexOf(key);
    if (index < 0) continue;
    ranges.push({ key, start: stack[index].start, end: any.lastIndex });
    stack.splice(index);
  }
  return ranges;
}
function replyLooseText(source, masked, covered) {
  const ranges = [...covered, ...replyPairRanges(masked)].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  const take = (end) => {
    if (end <= cursor) return;
    const visible = masked.slice(cursor, end).replace(/<[^<>]*>/g, (tag) => " ".repeat(tag.length));
    const letters = (visible.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters) parts.push({ start: cursor, end, letters, excerpt: source.slice(cursor, end).replace(/<[^<>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 80) });
  };
  for (const range of ranges) {
    take(range.start);
    cursor = Math.max(cursor, range.end);
  }
  take(masked.length);
  return parts;
}

// 推理字段只在本地查标签位置，不展示、不发送。正文标签已在可见回复里时不看推理，避免把模型自述的计划误判。
function replyReasoningHasBody(reasoning, bodyTag) {
  const text = replyCheckMask(String(reasoning || ""));
  const name = bodyTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<\\s*${name}(?:\\s+[^<>]*?)?\\s*>`, "iu").test(text);
}

function checkReplyFormat(text, inputRules, extra = {}) {
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
  const add = (kind, text, tag, excerpt) => {
    const key = `${kind}\n${tag || ""}\n${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ kind, text, ...(tag ? { tag } : {}), ...(excerpt ? { excerpt } : {}) });
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
  const body = stats.get(bodyKey);
  const reasoning = typeof extra.reasoning === "string" ? extra.reasoning : "";
  if (!body.opens && !body.closes && reasoning.trim()) {
    if (replyReasoningHasBody(reasoning, rules.bodyTag)) add("reasoning", `酒馆把带 <${rules.bodyTag}> 的部分解析进了思考区，聊天里看到的正文可能缺失或不全`, rules.bodyTag);
    else if (!source.replace(/<[^<>]*>/g, "").trim() && reasoning.trim().length >= 200) add("reasoning", "可见回复为空，但思考区有大段内容；正文可能被整段解析进思考区", rules.bodyTag);
  }
  if (body.opens) {
    const covered = [...scopeRanges];
    for (const [key] of required) for (const range of stats.get(key).ranges) covered.push(range);
    const firstBody = Math.min(...body.ranges.map((range) => range.start), ...scopeRanges.filter((range) => range.key === bodyKey).map((range) => range.start));
    for (const part of replyLooseText(replyCheckMask(source, true), masked, covered)) {
      if (part.letters < 20) continue;
      if (part.end <= firstBody) add("outside", `正文标签前有约 ${part.letters} 字没有被任何标签包住，可能是外泄的思考或分析（爆思维链）`, rules.bodyTag, part.excerpt);
      else add("outside", `正文结束后还有约 ${part.letters} 字没有被标签包住，可能是外泄的分析、总结或掉出正文的段落`, rules.bodyTag, part.excerpt);
    }
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
  const kinds = new Set(report.issues.map((issue) => issue.kind));
  const body = `<${rules.bodyTag}>`;
  // 按上一轮的具体问题加一句针对性要求，只说格式，不要求展示思考
  const extra = [];
  if (kinds.has("swallowed") || kinds.has("reasoning")) extra.push(`上一轮正文被写进了思考区：思考标签必须在 ${body} 开始之前闭合。`);
  if (report.issues.some((issue) => issue.kind === "outside" && issue.text.startsWith("正文标签前"))) extra.push(`上一轮在 ${body} 之前直接输出了分析文字：正文标签外不要写任何分析、计划或说明。`);
  else if (kinds.has("outside")) extra.push(`上一轮在 </${rules.bodyTag}> 之后还有零散文字：正文写完即结束，不追加说明或总结。`);
  if (kinds.has("leak")) extra.push(`正文内不得出现思考标签。`);
  if (kinds.has("missing")) extra.push(`上一轮掉了标签：开头和结尾的标签名一字不改。`);
  return `【回复格式提醒】请让 ${tags.map((tag) => `<${tag}>…</${tag}>`).join("、")} 各完整成对出现一次，准确闭合，并置于思考标签之外。${extra.join("")}正文不夹入思考步骤或内部分析；无需展示思考过程，也不要复述上一轮内容。`;
}

// ---- 修正标签：只改名、补齐或移动标签，不增删正文文字。修不了的返回 null，交给人工。
var REPLY_BODY_ALIASES = ["正文", "正文内容", "内容", "故事", "回复", "content", "contents", "body", "main", "maintext", "main_text", "story", "text", "reply", "response", "output"];
function replyTagTokens(masked, keys) {
  const out = [];
  const tags = /<\s*(\/?)\s*([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]*)(?:\s+[^<>]*?)?\s*(\/?)>/gu;
  let match;
  while ((match = tags.exec(masked))) {
    const key = match[2].toLowerCase();
    if (keys && !keys.has(key)) continue;
    out.push({ key, name: match[2], closing: !!match[1], selfClosing: !!match[3], start: match.index, end: tags.lastIndex });
  }
  return out;
}
function replyBodyAlias(source, masked, rules) {
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const taken = new Set(rules.requiredTags.map((tag) => tag.toLowerCase()));
  const names = REPLY_BODY_ALIASES.filter((name) => !thinking.has(name.toLowerCase()) && !taken.has(name.toLowerCase()));
  if (!names.some((name) => name.toLowerCase() === rules.bodyTag.toLowerCase())) names.push(rules.bodyTag);
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const forms = [
    [new RegExp(`<\\s*(${escaped})\\s*>`, "giu"), (name) => new RegExp(`<\\s*/\\s*${name}\\s*>`, "iu")],
    [new RegExp(`【\\s*(${escaped})\\s*】`, "giu"), (name) => new RegExp(`【\\s*/\\s*${name}\\s*】`, "iu")],
    [new RegExp(`\\[\\s*(${escaped})\\s*\\]`, "giu"), (name) => new RegExp(`\\[\\s*/\\s*${name}\\s*\\]`, "iu")]
  ];
  for (const [openRe, closeOf] of forms) {
    let open;
    while ((open = openRe.exec(masked))) {
      const isBody = open[1].toLowerCase() === rules.bodyTag.toLowerCase();
      // 尖括号写法的正确标签名已由检查器处理；这里只接手方括号写法或别名
      if (isBody && open[0].startsWith("<")) continue;
      const rest = masked.slice(openRe.lastIndex);
      const close = closeOf(open[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).exec(rest);
      return {
        open: { start: open.index, end: openRe.lastIndex, raw: source.slice(open.index, openRe.lastIndex) },
        close: close ? { start: openRe.lastIndex + close.index, end: openRe.lastIndex + close.index + close[0].length, raw: close[0] } : null
      };
    }
  }
  return null;
}
function planReplyFix(text, inputRules, extra = {}) {
  const rules = normalizeReplyRules(inputRules);
  const body = rules.bodyTag, bodyKey = body.toLowerCase();
  const thinking = new Set(rules.thinkingTags.map((tag) => tag.toLowerCase()));
  const requiredKeys = new Set(rules.requiredTags.map((tag) => tag.toLowerCase()));
  let mes = String(text == null ? "" : text);
  let reasoning = typeof extra.reasoning === "string" ? extra.reasoning : null;
  const steps = [];
  const bodyTokens = () => replyTagTokens(replyCheckMask(mes), new Set([bodyKey])).filter((t) => !t.selfClosing);
  // 0. 思考外泄（爆思维链，2.4.1）：回复开头一段没被任何标签包住的文字，原样移进思考区。
  //    开头若是标签（如没闭合的 <thinking>）交给后面的步骤；只移到下一行开头的标签或注释为止，后面的锚定注释、标题等不动
  {
    const masked = replyCheckMask(mes);
    const firstBody = bodyTokens().find((t) => !t.closing);
    const lead = firstBody && replyLooseText(replyCheckMask(mes, true), masked, replyPairRanges(masked))[0];
    const from = masked.search(/\S/);
    if (lead && lead.letters >= 20 && lead.end <= firstBody.start && from >= lead.start && mes[from] !== "<") {
      const next = /\n[ \t]*</g;
      next.lastIndex = from;
      const hit = next.exec(mes);
      const to = hit && hit.index < lead.end ? hit.index : lead.end;
      const block = mes.slice(from, to).trim();
      const letters = (replyCheckMask(block).match(/[\p{L}\p{N}]/gu) || []).length;
      if (letters >= 20) {
        reasoning = (reasoning && reasoning.trim() ? reasoning.trimEnd() + "\n\n" : "") + block;
        const head = mes.slice(0, from).trimEnd();
        mes = head + (head ? "\n" : "") + mes.slice(to).trimStart();
        steps.push(`把正文前约 ${letters} 字没被标签包住的思考（爆思维链）移进思考区`);
      }
    }
  }
  // 1. 正文被酒馆解析进思考区：把思考区里的正文块移回可见回复开头
  if (reasoning && !bodyTokens().length && replyReasoningHasBody(reasoning, body)) {
    const masked = replyCheckMask(reasoning);
    const tokens = replyTagTokens(masked, new Set([bodyKey])).filter((t) => !t.selfClosing);
    const open = tokens.find((t) => !t.closing);
    const close = open && tokens.find((t) => t.closing && t.start > open.start);
    const end = close ? close.end : reasoning.length;
    let block = reasoning.slice(open.start, end).trim();
    if (!close) block += `\n</${body}>`;
    reasoning = (reasoning.slice(0, open.start).trimEnd() + "\n" + reasoning.slice(end).trimStart()).trim();
    mes = block + (mes.trim() ? "\n" + mes.trimStart() : "");
    steps.push(`把思考区里的 <${body}>…</${body}> 移回可见回复开头${close ? "" : "，并补上结束标签"}`);
  }
  // 2. 正文标签写错名或用了方括号：改成配置的正文标签
  if (!bodyTokens().length) {
    const alias = replyBodyAlias(mes, replyCheckMask(mes), rules);
    if (alias) {
      const { open, close } = alias;
      mes = mes.slice(0, open.start) + `<${body}>` + (close ? mes.slice(open.end, close.start) + `</${body}>` + mes.slice(close.end) : mes.slice(open.end));
      steps.push(close ? `把 ${open.raw}…${close.raw} 改成 <${body}>…</${body}>` : `把 ${open.raw} 改成 <${body}>`);
    }
  }
  // 3. 正文落在思考标签里
  {
    const masked = replyCheckMask(mes);
    const tokens = replyTagTokens(masked, new Set([bodyKey, ...thinking])).filter((t) => !t.selfClosing);
    const bodyOpen = tokens.find((t) => t.key === bodyKey && !t.closing);
    const thinkOpen = bodyOpen && [...tokens].reverse().find((t) => thinking.has(t.key) && !t.closing && t.start < bodyOpen.start);
    if (thinkOpen) {
      const thinkClose = tokens.find((t) => t.key === thinkOpen.key && t.closing && t.start > thinkOpen.start);
      const closedBefore = thinkClose && thinkClose.start < bodyOpen.start;
      if (!thinkClose) {
        // 思考标签没有结束：在正文开始前补上
        mes = mes.slice(0, bodyOpen.start).trimEnd() + `\n</${thinkOpen.name}>\n` + mes.slice(bodyOpen.start);
        steps.push(`在 <${body}> 前补上 </${thinkOpen.name}>，让思考区在正文开始前结束`);
      } else if (!closedBefore) {
        const bodyClose = tokens.find((t) => t.key === bodyKey && t.closing && t.start > bodyOpen.start);
        if (bodyClose && bodyClose.end <= thinkClose.start) {
          // 整段正文在思考区内：移到思考区结束之后
          const block = mes.slice(bodyOpen.start, bodyClose.end);
          const inner = mes.slice(0, bodyOpen.start).trimEnd() + "\n" + mes.slice(bodyClose.end, thinkClose.start).trimStart();
          mes = inner.trimEnd() + "\n" + mes.slice(thinkClose.start, thinkClose.end) + "\n" + block + mes.slice(thinkClose.end);
          steps.push(`把 <${body}>…</${body}> 从 <${thinkOpen.name}> 里移到 </${thinkOpen.name}> 之后`);
        }
      }
    }
  }
  // 4. 只有开头或只有结尾：补齐另一半
  {
    const masked = replyCheckMask(mes);
    const tokens = bodyTokens();
    const opens = tokens.filter((t) => !t.closing), closes = tokens.filter((t) => t.closing);
    // extra.noTailClose（自动修正用）：不在回复末尾补结束标签——可能只是被截断，补上后再「继续」会续到标签外面
    const tailOnly = opens.length === 1 && !closes.length && extra.noTailClose && !replyTagTokens(masked).some((t) => !t.closing && !t.selfClosing && t.start > opens[0].end && (requiredKeys.has(t.key) || thinking.has(t.key))) && !replyPairRanges(masked).some((r) => r.start > opens[0].end && r.key !== bodyKey);
    if (opens.length === 1 && !closes.length && !tailOnly) {
      const after = replyTagTokens(masked).find((t) => !t.closing && !t.selfClosing && t.start > opens[0].end && (requiredKeys.has(t.key) || thinking.has(t.key)));
      let end = after ? after.start : mes.length;
      const trim = () => { while (end > opens[0].end && /\s/.test(mes[end - 1])) end--; };
      trim();
      // 末尾单独成行的完整标签块（如状态栏）留在正文之外
      let tail = null;
      if (!after) {
        const pairs = replyPairRanges(masked).filter((r) => r.start > opens[0].end && r.key !== bodyKey);
        for (let r; (r = pairs.find((x) => x.end === end && /(^|\n)[ \t]*$/.test(mes.slice(0, x.start))));) { end = r.start; tail = r; trim(); }
      }
      const stop = after || tail;
      mes = mes.slice(0, end) + `\n</${body}>` + (stop ? "\n" + mes.slice(end).replace(/^\s*/, "") : mes.slice(end));
      steps.push(stop ? `在 ${masked.slice(stop.start, masked.indexOf(">", stop.start) + 1)} 前补上 </${body}>` : `在回复末尾补上 </${body}>`);
    } else if (closes.length === 1 && !opens.length) {
      const thinkClose = replyTagTokens(masked, thinking).filter((t) => t.closing && t.end <= closes[0].start).at(-1);
      let start = thinkClose ? thinkClose.end : 0;
      while (start < closes[0].start && /\s/.test(mes[start])) start++;
      mes = mes.slice(0, start) + `<${body}>\n` + mes.slice(start);
      steps.push(thinkClose ? `在 </${thinkClose.name}> 之后补上 <${body}>` : `在回复开头补上 <${body}>`);
    }
  }
  if (!steps.length) return null;
  return { text: mes, reasoning, reasoningChanged: reasoning !== (typeof extra.reasoning === "string" ? extra.reasoning : null), steps, after: checkReplyFormat(mes, rules, { reasoning: reasoning || "" }) };
}

// 从预设开着的条目里猜正文标签：数各候选标签被写成 <标签> 的次数，取最多的。
// 显示正则用到、条目里也要求输出的其他标签（状态栏之类）作为必需标签建议。
function guessReplyTags(texts, regexTags = []) {
  const all = texts.map((t) => replyCheckMask(String(t || ""))).join("\n");
  const count = (tag) => (all.match(new RegExp(`<\\s*/?\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`, "giu")) || []).length;
  let bodyTag = null, best = 0;
  for (const tag of REPLY_BODY_ALIASES) {
    const n = count(tag);
    if (n > best) { best = n; bodyTag = tag; }
  }
  const skip = new Set(["think", "thinking", (bodyTag || "").toLowerCase()]);
  const suggest = [...new Map(regexTags.map((t) => [String(t).toLowerCase(), String(t)])).values()].filter((t) => !skip.has(t.toLowerCase()) && /^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff-]{0,39}$/u.test(t) && count(t) > 0);
  return { bodyTag, count: best, suggest };
}
