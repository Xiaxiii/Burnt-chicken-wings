// 2.7.8 运行中的卡顿记录：页面卡顿（浏览器长任务）和本扩展自身处理的耗时，
// 供「体检 → 运行中的卡顿」判断卡顿是不是本扩展造成的。只记时间和名称，不记内容，只在内存里。
// 支持长任务记录的浏览器（Chrome、Edge、安卓）记录单次超过 50 毫秒的任务；Safari 不提供，改用计时器延迟估算。
var JANK = { since: performance.now(), mode: "none", stalls: [], own: new Map(), ownSlow: [], started: false };
var JANK_KEEP = 300;
function jankStart() {
  if (JANK.started) return;
  JANK.started = true;
  try {
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) jankStall(e.startTime, e.duration); });
      po.observe({ type: "longtask", buffered: true });
      JANK.mode = "longtask";
      cleanups.push(() => po.disconnect());
      return;
    }
  } catch {
  }
  // 每秒一次的计时器，晚到超过 120 毫秒记为一次卡顿；页面在后台时浏览器会放慢计时器，不计
  let expect = 0, timer = 0;
  const arm = () => { expect = performance.now() + 1e3; timer = setTimeout(tick, 1e3); };
  const tick = () => {
    const late = performance.now() - expect;
    if (late > 120 && !document.hidden) jankStall(expect, late);
    arm();
  };
  const onVis = () => { clearTimeout(timer); arm(); };
  document.addEventListener("visibilitychange", onVis);
  arm();
  JANK.mode = "timer";
  cleanups.push(() => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); });
}
function jankStall(at, ms) {
  const end = at + ms;
  const own = JANK.ownSlow.filter((x) => x.at < end && x.at + x.ms > at).map((x) => x.label);
  JANK.stalls.push({ at, ms, own: [...new Set(own)] });
  if (JANK.stalls.length > JANK_KEEP) JANK.stalls.shift();
}
function jankOwn(label, at, ms) {
  let s = JANK.own.get(label);
  if (!s) JANK.own.set(label, s = { n: 0, total: 0, max: 0 });
  s.n++;
  s.total += ms;
  if (ms > s.max) s.max = ms;
  if (ms >= 16) {
    JANK.ownSlow.push({ label, at, ms });
    if (JANK.ownSlow.length > JANK_KEEP) JANK.ownSlow.shift();
  }
}
// 包一层计时：只计同步部分（异步处理里真正占住页面的也是同步部分）
function jankWrap(label, fn) {
  return function(...args) {
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      jankOwn(label, t0, performance.now() - t0);
    }
  };
}
function jankTime(label, fn) {
  return jankWrap(label, fn)();
}
function jankClear() {
  JANK.since = performance.now();
  JANK.stalls.length = 0;
  JANK.ownSlow.length = 0;
  JANK.own.clear();
}
// 汇总给体检页：卡顿次数、最长、与本扩展重叠的次数，本扩展各项处理的次数和最长耗时
function jankSummary() {
  const stalls = JANK.stalls;
  const overlapped = stalls.filter((s) => s.own.length);
  const own = [...JANK.own].map(([label, s]) => ({ label, n: s.n, max: s.max, avg: s.total / s.n })).sort((a, b) => b.max - a.max);
  const blame = new Map();
  for (const s of overlapped) for (const l of s.own) blame.set(l, (blame.get(l) || 0) + 1);
  return {
    mode: JANK.mode,
    minutes: (performance.now() - JANK.since) / 6e4,
    count: stalls.length,
    severe: stalls.filter((s) => s.ms >= 200).length,
    longest: stalls.reduce((m, s) => Math.max(m, s.ms), 0),
    overlapped: overlapped.length,
    blame: [...blame].sort((a, b) => b[1] - a[1]),
    own,
    recent: stalls.slice(-12).reverse()
  };
}
