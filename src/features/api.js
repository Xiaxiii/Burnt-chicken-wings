// 站点、模型、测试与站点文件的逻辑（原 ui/apiview.js）
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "";
  }
}

// 2.5.0 按系列分类：一个密钥里 Claude、Gemini、GPT 混在一起时按名字分段。认不出的归「其他」
var MODEL_FAMILIES = [
  ["Claude", /claude|opus|sonnet|haiku/],
  ["Gemini", /gemini|gemma|imagen|veo\d|nano.?banana/],
  ["GPT", /gpt|chatgpt|dall-?e|davinci|codex|sora|(^|[^a-z0-9])o[1-9](?![0-9])/],
  ["DeepSeek", /deepseek/],
  ["Grok", /grok/],
  ["Qwen", /qwen|qwq/],
  ["Kimi", /kimi|moonshot/],
  ["GLM", /glm|zhipu/],
  ["豆包", /doubao/],
  ["MiniMax", /minimax|abab/],
  ["Llama", /llama/],
  ["Mistral", /mistral|mixtral|codestral|magistral/]
];

var FAMILY_ORDER = [...MODEL_FAMILIES.map(([n]) => n), "其他"];

function modelFamily(m) {
  const full = String(m || "").toLowerCase();
  // 中转站常在前面加「[0.07/次][出图gemini3]」这样的标签，先看去掉标签后的模型名
  const bare = full.replace(/^(\s*[\[【(（][^\]】)）]*[\]】)）])+\s*/, "");
  const find = (t) => MODEL_FAMILIES.find(([, re]) => re.test(t))?.[0];
  return find(bare) || find(full) || "其他";
}

function familyGroups(models) {
  const map = new Map();
  for (const m of models) {
    const f = modelFamily(m);
    if (!map.has(f)) map.set(f, []);
    map.get(f).push(m);
  }
  return [...map].sort((a, b) => FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0])).map(([name, list]) => ({ name, list }));
}

// 2.6.13 一段文字里有几个密钥：按换行拆；只有一行时，按空格、逗号、分号拆，但每段都要像密钥（8 个字符以上），
// 「Bearer sk-…」这类不拆。只有一个时返回 null
function splitKeyText(text) {
  const t = String(text || "").trim();
  let list = t.split(/[\r\n\u2028\u2029]+/).map((x) => x.trim()).filter(Boolean);
  if (list.length < 2) {
    const parts = t.split(/[\s,，;；、]+/).filter(Boolean);
    list = parts.length > 1 && parts.every((x) => x.length >= 8) ? parts : [];
  }
  return list.length > 1 ? list : null;
}

// 2.3.3 推理格式记录：列表里看每个预设记住的设置，点「修改」手动改
var REASONING_FLAGS = [["auto_parse", "自动解析"], ["add_to_prompts", "添加到提示词"], ["auto_expand", "自动展开"], ["show_hidden", "显示隐藏内容"]];

const showBreaks = (s) => String(s ?? "").replace(/\r?\n/g, "↵");

function reasoningSummary(r) {
  const wrap = r.prefix || r.suffix ? `${showBreaks(r.prefix)} … ${showBreaks(r.suffix)}` : "无前后缀";
  const flags = [r.auto_parse ? "自动解析" : "不自动解析", ...REASONING_FLAGS.slice(1).filter(([k]) => r[k] === true).map(([, label]) => label)];
  return [r.name, wrap, flags.join("、")].filter(Boolean).join(" · ");
}

function reasoningTemplates() {
  try {
    const list = ctx().getPresetManager?.("reasoning")?.getPresetList?.()?.presets;
    if (Array.isArray(list) && list.length) return list.filter((t) => t?.name);
  } catch {}
  return [...document.querySelectorAll("#reasoning_select option")].map((o) => ({ name: o.value })).filter((t) => t.name);
}

// 2.5.0 测试消息失败时的原因：站点给的报错原文，加一句最简单的解释
function apiErrorText(data) {
  const e = data?.error;
  let m = (typeof e === "object" && e ? e.message || e.msg : typeof e === "string" ? e : "") || data?.message || "";
  // 中转站常把上游的报错整个塞进 message 里，再拆一层
  for (let i = 0; i < 2 && typeof m === "string" && /^\s*\{/.test(m); i++) {
    try {
      const inner = JSON.parse(m);
      m = inner?.error?.message || inner?.message || (typeof inner?.error === "string" ? inner.error : "") || m;
    } catch { break; }
  }
  return typeof m === "string" ? m.trim() : "";
}

// 酒馆后台自己出错时只回 500，站点真正的状态码常写在报错文字里
// 站点常只写英文说法（如「Service Unavailable」），不写数字；酒馆有时还回 200
var HTTP_PHRASES = [[/bad request/i, 400], [/unauthori[sz]ed/i, 401], [/payment required/i, 402], [/forbidden/i, 403], [/not found/i, 404], [/request time-?out/i, 408], [/payload too large|entity too large/i, 413], [/too many requests/i, 429], [/internal server error/i, 500], [/bad gateway/i, 502], [/service unavailable/i, 503], [/gateway time-?out/i, 504]];

function errStatus(status, text) {
  const t = String(text || "");
  const inText = t.match(/\b(40[0-9]|41[0-9]|42[0-9]|5[0-2][0-9])\b/);
  const vague = !status || status < 400 || status === 500;
  if (inText && vague) return Number(inText[1]);
  const phrase = HTTP_PHRASES.find(([re]) => re.test(t))?.[1];
  if (phrase && vague) return phrase;
  return status >= 400 ? status : 0;
}

var API_ERROR_WORDS = [
  [/quota|insufficient|balance|credit|余额|额度|欠费/i, "额度不足"],
  [/invalid.{0,12}(api.?key|token|令牌)|incorrect api key|api key not valid|unauthori[sz]ed|无效的令牌|令牌.{0,6}(无效|过期|不存在)/i, "密钥无效"],
  [/model.?not.?found|does not exist|no available channel|无可用渠道|not support(ed)?.{0,10}model|模型不存在|不支持.{0,4}模型/i, "该分组无此模型"],
  [/rate.?limit|too many requests|请求过于频繁|频率限制/i, "请求太频繁"],
  [/context.?length|maximum context|too long|tokens? .{0,20}exceed|超出.{0,6}长度/i, "内容超长"],
  [/safety|blocked|content.?filter|审核|违规/i, "被审核拦截"],
  [/overloaded|过载/i, "上游过载"]
];

// 笼统的说法：有状态码时用状态码的解释
var API_ERROR_VAGUE = [
  [/timed? ?out|超时|没有回复/i, "超时"],
  [/failed to fetch|networkerror|load failed/i, "连不上酒馆"]
];

var API_STATUS_WORDS = { 400: "请求参数不对", 401: "密钥无效", 402: "余额不足", 403: "无权限", 404: "模型或网址不存在", 408: "超时", 413: "内容超长", 429: "太频繁或额度用完", 500: "站点出错", 502: "上游连不上", 503: "暂无可用渠道", 504: "上游超时", 520: "站点异常", 521: "服务器未开", 522: "连接超时", 523: "连不上服务器", 524: "处理超时", 529: "上游过载" };

// 2.6.15 测试消息的回复：事件流只读到第一个 data 行（注释、event 行、空行跳过）；开头是 { 的是整段 JSON（报错，
// 或站点没按流式回），读完再解析。返回 { error: 报错文字 }，没报错时 error 为空
async function firstReply(res) {
  const errorOf = (text) => {
    let data = null;
    try { data = JSON.parse(text); } catch {}
    // Claude 的事件流报错是 {"type":"error","error":{…}}
    return data?.error || data?.type === "error" ? apiErrorText(data) || text.trim() || "未知错误" : "";
  };
  if (!res.body?.getReader) {
    const text = await res.text();
    return { error: res.ok ? errorOf(text) : errorOf(text) || text.trim() };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: !done });
      const head = buf.trimStart();
      if (head.startsWith("{") || head.startsWith("[") || !res.ok) {
        if (!done) continue;
        return { error: errorOf(head) || (res.ok ? "" : head) };
      }
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        return { error: data === "[DONE]" ? "" : errorOf(data) };
      }
      if (done) return { error: "" };
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// 一句话的问题：「503 暂无可用渠道」；都对不上时用报错原文
function explainApiError(status, text) {
  const word = API_ERROR_WORDS.find(([re]) => re.test(text || ""))?.[1];
  const vague = API_ERROR_VAGUE.find(([re]) => re.test(text || ""))?.[1];
  // 都对不上时也只写中文，英文原文点这一行看
  const why = word || API_STATUS_WORDS[status] || vague || (status >= 500 ? "站点出错" : status >= 400 ? "请求被拒绝" : String(text || "").trim() ? "未知错误" : "没有回复");
  return [status || "", why].filter(Boolean).join(" ");
}

// 2.5.10 站点文件：导出成 JSON，导入时也认别处常见的写法（url / baseUrl / api_key …）
var SITE_FILE_FORMAT = "焦香鸡翅-站点";

var SITE_URL_FIELDS = ["url", "baseUrl", "baseURL", "base_url", "customUrl", "customURL", "custom_url", "apiUrl", "apiURL", "api_url", "api-url", "apiBase", "api_base", "apiHost", "api_host", "endpoint", "proxyUrl", "reverseProxy", "reverse_proxy", "host", "server"];

var SITE_KEY_FIELDS = ["key", "apiKey", "api_key", "apikey", "APIKey", "API_KEY", "token", "secret", "proxy_password", "sk"];

var SITE_NAME_FIELDS = ["name", "groupName", "siteName", "configName", "title", "label", "alias"];

var SITE_MODEL_FIELDS = ["model", "defaultModel", "default_model", "modelName", "model_name"];

var SITE_MODELS_FIELDS = ["models", "modelList", "model_list"];

var SITE_NOTE_FIELDS = ["note", "notes", "remark", "description", "desc"];

function sitePick(o, names) {
  for (const n of names) {
    const v = o?.[n];
    if (v != null && v !== "") return v;
  }
  return void 0;
}

// 模型可以是字符串，也可以是对象（customModel / model / id / name；别处的 name 常带站点前缀，排在后面）
const siteModelId = (m) => (typeof m === "string" ? m : String(m?.customModel || m?.model || m?.id || m?.name || "")).trim();

function siteModelsOf(v) {
  if (typeof v === "string") return v.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((m) => !m?.isPlaceholder).map(siteModelId).filter(Boolean))];
}

function siteKeysIn(o) {
  const textKeys = (t) => String(t || "").split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
  const arr = sitePick(o, ["keys", "apiKeys", "api_keys", "tokens"]);
  if (Array.isArray(arr)) {
    return arr.flatMap((k) => {
      if (typeof k === "string") return textKeys(k).map((key) => ({ name: "", key }));
      if (!k || typeof k !== "object") return [];
      const key = String(sitePick(k, SITE_KEY_FIELDS) || "").trim();
      return [{ name: String(sitePick(k, ["name", "label", "group", "title"]) || "").trim(), key, model: String(sitePick(k, SITE_MODEL_FIELDS) || "").trim(), models: siteModelsOf(sitePick(k, SITE_MODELS_FIELDS)) }];
    });
  }
  const one = sitePick(o, SITE_KEY_FIELDS);
  return typeof one === "string" ? textKeys(one).map((key) => ({ name: "", key })) : [];
}

// 一个对象像不像站点：自定义类型要有 http 开头的网址；其他类型（OpenAI、Claude…）认 source
// catNames：文件里的分类（编号 → 名称），模型对象带 categoryIds 时据此建分类
function siteFromObject(o, fallbackName = "", catNames = new Map()) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const source = typeof o.source === "string" && SOURCES[o.source] ? o.source : "custom";
  const url = String(sitePick(o, SITE_URL_FIELDS) || "").trim();
  if (source === "custom" && !/^https?:\/\/\S+$/i.test(url)) return null;
  let host = "";
  try { host = url ? new URL(url).host : ""; } catch {}
  const rawModels = sitePick(o, SITE_MODELS_FIELDS);
  const models = siteModelsOf(rawModels);
  const active = Array.isArray(rawModels) ? rawModels.find((m) => m && typeof m === "object" && m.isActive && !m.isPlaceholder) : null;
  const model = String(sitePick(o, SITE_MODEL_FIELDS) || (active && siteModelId(active)) || "").trim();
  // 分类：我们自己的文件是 cats: [{ name, models }]；别处是模型上的 categoryIds
  const cats = new Map();
  for (const c of Array.isArray(o.cats) ? o.cats : []) if (c?.name) cats.set(String(c.name), new Set(siteModelsOf(c.models)));
  if (Array.isArray(rawModels)) for (const m of rawModels) {
    if (!m || typeof m !== "object" || m.isPlaceholder) continue;
    const id = siteModelId(m);
    for (const cid of new Set([...(Array.isArray(m.categoryIds) ? m.categoryIds : []), m.categoryId].filter(Boolean))) {
      const name = catNames.get(String(cid));
      if (!id || !name) continue;
      if (!cats.has(name)) cats.set(name, new Set());
      cats.get(name).add(id);
    }
  }
  const keys = siteKeysIn(o);
  if (!keys.length) keys.push({ name: "", key: "" });
  for (const k of keys) {
    if (!k.model) k.model = keys.length === 1 ? model : "";
    if (!k.models?.length) k.models = models;
  }
  const name = String(sitePick(o, SITE_NAME_FIELDS) || fallbackName || host || SOURCES[source].label).trim();
  return { name, source, url: source === "custom" ? url : "", note: String(sitePick(o, SITE_NOTE_FIELDS) || "").trim(), keys, cats: [...cats].map(([n, ms]) => ({ name: n, models: [...ms] })).filter((c) => c.models.length) };
}

function parseSiteFile(text) {
  const data = JSON.parse(String(text).replace(/^\uFEFF/, ""));
  // 先找分类表：键名带 categor 的数组，元素有 id 和 name
  const catNames = new Map();
  const findCats = (v, depth) => {
    if (depth > 5 || !v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (Array.isArray(x) && /categor/i.test(k)) for (const c of x) if (c?.id != null && c?.name) catNames.set(String(c.id), String(c.name));
      if (x && typeof x === "object") findCats(x, depth + 1);
    }
  };
  findCats(data, 0);
  const out = [];
  const walk = (v, depth, name = "") => {
    if (depth > 5 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const me = siteFromObject(v, name, catNames);
    if (me) return out.push(me);
    for (const [k, x] of Object.entries(v)) walk(x, depth + 1, k);
  };
  walk(data, 0);
  return out;
}

function keyMaskOf(text) {
  return text.length > 8 ? `${text.slice(0, 3)}…${text.slice(-4)}` : "已保存";
}
