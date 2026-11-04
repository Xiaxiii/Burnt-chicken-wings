// 2.6.19 站点余额。按站点网址认出余额接口，经酒馆后端用站点自己的密钥去问（浏览器直连多被跨域挡住）：
// 酒馆的 /status 接口把 custom_url 接上 /models 去请求，网址末尾加 # 后，/models 落进 # 后面不发出去，请求就落在余额接口上。
// 中转站（one-api、new-api 及其衍生）用 OpenAI 旧版的 /dashboard/billing/subscription 和 /usage；
// DeepSeek、OpenRouter、硅基流动、Moonshot 用各自的接口；OpenAI、Claude、Gemini 官方不提供
var BALANCE_FIXED_BASE = { deepseek: "https://api.deepseek.com", openrouter: "https://openrouter.ai/api/v1" };
var BALANCE_NONE = /(^|\.)(openai\.com|anthropic\.com|googleapis\.com|azure\.com|x\.ai|mistral\.ai|cohere\.(ai|com))$/i;
function balanceBase(site) {
  if (!site) return "";
  if (site.source === "custom") return String(site.url || "").trim().replace(/\/+$/, "");
  return BALANCE_FIXED_BASE[site.source] || "";
}
// 要发的请求：{ kind, urls }，或 { none: 原因 }
function balancePlan(site, now = new Date()) {
  const base = balanceBase(site);
  if (!base) return { none: site?.source && site.source !== "custom" ? "官方接口不提供余额查询" : "没有网址" };
  let url;
  try { url = new URL(base); } catch { return { none: "网址不对" }; }
  const host = url.hostname.toLowerCase();
  if (BALANCE_NONE.test(host)) return { none: "官方接口不提供余额查询" };
  if (/(^|\.)deepseek\.com$/.test(host)) return { kind: "deepseek", urls: [`${url.origin}/user/balance`] };
  if (/(^|\.)openrouter\.ai$/.test(host)) return { kind: "openrouter", urls: ["https://openrouter.ai/api/v1/credits", "https://openrouter.ai/api/v1/key"] };
  if (/(^|\.)siliconflow\.(cn|com)$/.test(host)) return { kind: "siliconflow", urls: [`${url.origin}/v1/user/info`], cny: host.endsWith(".cn") };
  if (/(^|\.)moonshot\.(cn|ai)$/.test(host)) return { kind: "moonshot", urls: [`${url.origin}/v1/users/me/balance`], cny: host.endsWith(".cn") };
  // 中转站：额度和用量。用量按日期查，new-api、one-api 不看日期，返回累计用量；OpenAI 旧版最多查 100 天
  const day = (d) => d.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 864e5), start = new Date(now.getTime() - 99 * 864e5);
  return { kind: "relay", urls: [`${base}/dashboard/billing/subscription`, `${base}/dashboard/billing/usage?start_date=${day(start)}&end_date=${day(end)}`] };
}
const balanceNum = (v) => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
// 金额一律两位小数，千位加逗号
function balanceMoney(n, cur = "$") {
  const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}${cur}${text}`;
}
// 把接口回的数据（按 urls 的顺序，没回的是 null）读成 { ok, text, sub } 或 { ok: false, text: 原因 }
function balanceRead(plan, data) {
  const [a, b] = data;
  const fail = (text = "没查到", why = "站点没有返回余额，可能是密钥失效或站点不提供") => ({ ok: false, text, why });
  if (plan.kind === "deepseek") {
    const infos = Array.isArray(a?.balance_infos) ? a.balance_infos : [];
    const parts = infos.map((x) => { const n = balanceNum(x?.total_balance); return n == null ? "" : balanceMoney(n, x.currency === "USD" ? "$" : "¥"); }).filter(Boolean);
    return parts.length ? { ok: true, text: parts.join(" + "), sub: a.is_available === false ? "余额不足，暂不可用" : "" } : fail();
  }
  if (plan.kind === "openrouter") {
    const total = balanceNum(a?.data?.total_credits), used = balanceNum(a?.data?.total_usage);
    if (total != null && used != null) return { ok: true, text: balanceMoney(total - used), sub: `已用 ${balanceMoney(used)}` };
    const k = b?.data;
    if (!k) return fail();
    const usage = balanceNum(k.usage) ?? 0;
    if (k.limit == null) return { ok: true, text: "不限额", sub: `这个密钥已用 ${balanceMoney(usage)}；账户余额要到网站看` };
    const left = balanceNum(k.limit_remaining) ?? (balanceNum(k.limit) - usage);
    return { ok: true, text: balanceMoney(left), sub: `密钥限额 ${balanceMoney(balanceNum(k.limit))}，已用 ${balanceMoney(usage)}` };
  }
  if (plan.kind === "siliconflow") {
    const n = balanceNum(a?.data?.totalBalance ?? a?.data?.balance);
    return n == null ? fail() : { ok: true, text: balanceMoney(n, plan.cny ? "¥" : "$"), sub: "" };
  }
  if (plan.kind === "moonshot") {
    const n = balanceNum(a?.data?.available_balance);
    return n == null ? fail() : { ok: true, text: balanceMoney(n, plan.cny ? "¥" : "$"), sub: "" };
  }
  // 中转站：额度减去用量（用量单位是美分）；额度 1 亿以上是不限额的令牌
  const limit = balanceNum(a?.hard_limit_usd ?? a?.system_hard_limit_usd);
  if (limit == null) return fail("站点不提供查询", "这个中转站没有开放余额接口，或密钥失效");
  const used = balanceNum(b?.total_usage);
  // used：这个密钥累计用了多少（美元），手填账户余额时拿它扣减
  const spent = used == null ? null : used / 100;
  if (limit >= 1e8) return { ok: true, text: "不限额", sub: spent == null ? "这个密钥不限额；可手填账户余额" : `这个密钥已用 ${balanceMoney(spent)}；可手填账户余额`, used: spent };
  if (spent == null) return { ok: true, text: balanceMoney(limit), sub: "总额度，用量没查到", used: null };
  return { ok: true, text: balanceMoney(limit - spent), sub: `总额度 ${balanceMoney(limit)}，已用 ${balanceMoney(spent)}`, used: spent };
}
// 多久以前：刚刚、3 分钟前、2 小时前、昨天、3 天前
function balanceAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return s < 172800 ? "昨天" : `${Math.floor(s / 86400)} 天前`;
}
// 2.6.20 手填的账户余额。不限额的令牌查不到账户余额，但查得到它累计用了多少：
// 填的时候记下各密钥已用（base[kid] = { used, sec }），之后余额 = 填的数 − 各密钥此后多用的。
// 密钥换了（sec 不同）或用量比记下的少（令牌重建），从 0 算。readings：[{ kid, sec, used }]，used 查不到时为 null
function balanceManual(manual, readings) {
  let spent = 0, missing = 0;
  for (const r of readings) {
    const b = manual?.base?.[r.kid];
    if (r.used == null || !b) { missing++; continue; }
    spent += b.sec === r.sec && r.used >= b.used ? r.used - b.used : r.used;
  }
  return { remain: (manual?.amount ?? 0) - spent, spent, missing };
}
// 玩家填的金额：去掉货币符号、逗号、空白；不是非负数时为 null
function balanceParseAmount(text) {
  const t = String(text == null ? "" : text).replace(/[$¥￥,，\s]|美元|元|刀/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
