// 「体检」页：酒馆打开慢，慢在哪。测量在 maintenance/diagnostics.js，汇总在 features/health.js，这里只管显示。
// 每个数字写明口径；测不到的写「未测得」，不拿别的数字顶替
function healthSizeCell(g) {
  if (!g.n) return "—";
  const known = g.n - g.unknownSize;
  if (!known) return "未取得";
  return html`${fmtSize(g.transfer)}${g.decoded && g.decoded !== g.transfer ? html`<small>解压后 ${fmtSize(g.decoded)}</small>` : ""}${g.unknownSize ? html`<small>另 ${g.unknownSize} 笔未取得</small>` : ""}`;
}
function healthNoteCell(g) {
  const n = [];
  if (g.cacheHits) n.push(`缓存命中 ${g.cacheHits}`);
  if (g.revalidated) n.push(`缓存校验 ${g.revalidated}`);
  if (g.viaSw) n.push(`经 Service Worker ${g.viaSw}`);
  for (const [p, k] of Object.entries(g.providers || {})) n.push(`走${p}接口 ${k}`);
  return n.join("；");
}
function mountHealthPage(page) {
  page.innerHTML = String(html`<header class="cw-pagehead"><div class="cw-col"><span class="cw-gap"></span>${btn("重新检查", { act: "h-run", size: "sm", icon: "refresh" })}${btn("每笔明细", { act: "h-detail", size: "sm" })}${btn("导出报告", { act: "h-export", size: "sm", icon: "fileOut" })}</div></header>
    <div class="cw-body"><div class="cw-col cw-health"><div data-r="main"><p class="cw-hint">正在检查…</p></div><div data-r="detail" hidden></div></div></div>`);
  const box = page.querySelector('[data-r="main"]');
  const detail = page.querySelector('[data-r="detail"]');
  let last = null;
  async function run() {
    box.innerHTML = String(html`<p class="cw-hint cw-pad">正在检查…</p>`);
    detail.hidden = true;
    await nextPaint();
    let r;
    try { r = await collectHealth(); } catch (e) { box.innerHTML = String(html`<p class="cw-warn-text">检查出错：${e.message}</p>`); return; }
    last = r;
    const maxP = r.presets[0]?.size || 1;
    const maxE = r.extData[0]?.size || 1;
    const total = Math.max(r.readyAt || 0, ...r.timeline.map((t) => t.end)) || 1;
    const pct = (v) => `${Math.max(0, Math.min(100, v / total * 100)).toFixed(2)}%`;
    const card = (w, warn) => html`<div class="cw-note${warn ? " cw-note-warn" : ""}">${iconHtml(warn ? "warn" : "info")}<div><p class="cw-p">${warn ? html`<b>${w.h || w.t}</b>` : w.h || w.t}</p>
      ${fold("详情", String(html`${w.h ? html`<p class="cw-p">${w.t}</p>` : ""}<p class="cw-p">${w.d}</p>`))}${w.act === "clean" ? html`<button type="button" class="cw-link" data-act="h-clean">去清理 ›</button>` : ""}</div></div>`;
    const bgEnd = r.background.length ? Math.max(...r.background.map((x) => x.end)) : null;
    const readyText = r.readyAt ? fmtMs(r.readyAt) : r.readySource === "late" ? "未记录（本扩展加载时酒馆已启动完成）" : "未记录";
    const n = r.warn.length + r.tips.length;
    const stat = (k, v, sub = "") => html`<div><b>${v}</b><span>${k}${sub ? ` · ${sub}` : ""}</span></div>`;
    const rank = (rows) => html`<div class="cw-rank">${rows}</div>`;
    box.innerHTML = String(html`
      <div class="cw-sum${r.warn.length ? " is-bad" : " is-good"}">
        <div class="cw-stats cw-hstats" style="--n:${r.rate ? 5 : 4}">${stat("启动", r.readyAt ? fmtMs(r.readyAt) : "未记录")}${stat("预设", fmtSize(r.presetTotal), `${r.presets.length} 个`)}${stat("扩展数据", fmtSize(r.extDataTotal))}${stat("角色卡", String(r.charCount), r.lazyChars ? "按需加载" : "")}${r.rate ? stat("接收速率", `${fmtSize(r.rate)}/秒`, "估计") : ""}</div>
        ${fold("这些数字怎么来的", String(html`<dl class="cw-kv">
          <dt>页面 DOM 就绪</dt><dd>${r.domReady ? fmtMs(r.domReady) : "未取得"}</dd>
          <dt>酒馆启动完成（APP_READY）</dt><dd>${readyText}</dd>
          <dt>聊天可操作</dt><dd>未测得。目前无法可靠判断聊天什么时候能正常操作，不用启动完成的时间代替</dd>
          ${r.readyAt ? html`<dt>启动完成后仍在进行</dt><dd>${r.background.length ? `${r.background.length} 笔请求，最后结束于 ${fmtMs(bgEnd)}` : "没有"}</dd>` : ""}
        </dl>
        <p class="cw-p">每次打开要读取：全部预设（内存中约 ${fmtSize(r.presetTotal)}${r.presetByApi.length > 1 ? `：${r.presetByApi.map((x) => `${x.label} ${fmtSize(x.size)}`).join("，")}` : ""}），扩展数据 ${fmtSize(r.extDataTotal)}，角色卡 ${r.charCount} 张${r.lazyChars ? "（按需加载）" : ""}。内存中的大小是序列化后的统计量，不是网络传输量。</p>
        ${r.rate ? html`<p class="cw-p">本次接收速率估计约 ${fmtSize(r.rate)}/秒（按${r.rateSource === "settings" ? "设置请求的接收阶段" : "所有同源请求的接收阶段"}估算，受同时进行的请求和网络波动影响，不是服务器带宽上限）。</p>` : ""}`))}
      </div>
      <section class="cw-sec"><div class="cw-sec-h"><h3>建议</h3>${n ? html`<small>${n}</small>` : ""}</div>
        ${n ? html`<div class="cw-notes">${r.warn.map((w) => card(w, true))}${r.tips.map((w) => card(w, false))}</div>` : html`<div class="cw-note cw-note-ok">${iconHtml("ok")}<div>没有发现明显拖慢打开的地方。</div></div>`}</section>
      <section class="cw-sec">${fold("详细数据", String(html`
        ${r.timeline.length > 1 ? html`<h4 class="cw-h4">打开过程</h4>
          <div class="cw-tl">${r.timeline.map((t) => html`<div><span>${t.label}${t.n > 1 ? html`<i>×${t.n}</i>` : ""}</span><i class="cw-tl-track"><b style="left:${pct(t.start)};width:${pct(Math.max(t.end - t.start, total * 0.006))}"></b></i><em>${fmtMs(t.end)}</em></div>`)}
            ${r.readyAt ? html`<div class="cw-tl-ready"><span>启动完成</span><i class="cw-tl-track"><b style="left:${pct(r.readyAt)}"></b></i><em>${fmtMs(r.readyAt)}</em></div>` : ""}</div>
          <p class="cw-hint">每一行是该类请求从第一笔开始到最后一笔结束的范围，中间可能有空档；右侧是结束于打开后第几秒。</p>` : ""}
        <h4 class="cw-h4">打开时的请求</h4>
        <div class="cw-rtable" role="table">
          <div class="cw-rt-head" role="row"><span>类别</span><span>笔数</span><span>结束于</span><span>忙碌时长</span><span>实际传输</span></div>
          ${r.groups.map((g) => html`<div class="cw-rt-row" role="row"><span>${g.label}${healthNoteCell(g) ? html`<small>${healthNoteCell(g)}</small>` : ""}</span><span>${g.n}</span><span>${fmtMs(g.end)}</span><span>${fmtMs(g.busy)}</span><span>${healthSizeCell(g)}</span></div>`)}
        </div>
        <p class="cw-hint"><span class="cw-narrow-only">窄屏上省略了笔数和忙碌时长，可在宽屏或导出的报告里查看。</span>「结束于」是这一类最后一笔请求在打开后第几秒结束，不是它的耗时。「忙碌时长」是这一类请求时间段的并集，同时进行的不重复计算；各类之间也有重叠，不能相加。「实际传输」是经过网络的字节，缓存命中时为 0。</p>
        <h4 class="cw-h4">单笔耗时最长的请求</h4>
        ${r.slow.length ? html`${rank(r.slow.map((s) => html`<div title="${redactUrl(s.url)}"><span>${CAT_LABEL[s.cat] || s.cat}${s.provider ? html`<i class="cw-dim">·${s.provider}</i>` : ""}</span>${sizeBar(s.dur, r.slow[0].dur)}<em>${fmtMs(s.dur)}${s.transfer ? ` · ${fmtSize(s.transfer)}` : s.transfer == null ? " · 体积未取得" : ""}</em></div>`))}
          <p class="cw-hint">单笔耗时从发出请求算到接收完毕，包含排队、等待首字节和接收数据，不全是服务器处理时间。「每笔明细」可看分段。</p>` : html`<p class="cw-hint">没有超过 0.3 秒的请求，或未记录到。</p>`}
        <h4 class="cw-h4">最大的预设（内存中）</h4>
        ${r.presets.length ? rank(r.presets.slice(0, 8).map((p) => html`<div><span>${p.api !== "openai" ? html`<i class="cw-dim">${PRESET_APIS.find(([a]) => a === p.api)?.[1] || ""}·</i>` : ""}${p.name}</span>${sizeBar(p.size, maxP)}<em>${fmtSize(p.size)}</em></div>`)) : html`<p class="cw-hint">未读取到</p>`}
        <h4 class="cw-h4">扩展在设置文件中的数据</h4>
        ${r.extData.some((p) => p.size >= 1024) ? rank(r.extData.filter((p) => p.size >= 1024).slice(0, 8).map((p) => html`<div><span>${p.key}</span>${sizeBar(p.size, maxE)}<em>${fmtSize(p.size)}</em></div>`)) : html`<p class="cw-hint">均小于 1 KB。</p>`}
        <h4 class="cw-h4">这次测量覆盖不到的</h4>
        <ul class="cw-bullets">${r.gaps.map((x) => html`<li>${x}</li>`)}</ul>
        <p class="cw-hint">${r.extEnabled != null ? `第三方扩展：已开启 ${r.extEnabled} 个，共安装 ${r.extTotal} 个。` : ""}世界书 ${r.worldCount} 本。检查和导出报告都只在本浏览器中进行，不上传任何数据。仅在长时间未使用后首次打开较慢时，可能是云服务器休眠后重新启动；这次测量无法区分。</p>`), { cls: "cw-fold-block" })}</section>`);
  }
  function showDetail() {
    if (!last) return;
    if (!detail.hidden) { detail.hidden = true; return; }
    const rows = last.reqs.slice().sort((a, b) => a.start - b.start).slice(0, 400);
    const cacheText = { hit: "缓存", revalidated: "校验", unknown: "未取得", network: "" };
    detail.innerHTML = String(html`<section class="cw-sec"><div class="cw-sec-h"><h3>每笔请求</h3><small>按开始时间，最多 400 笔</small></div>
      <div class="cw-hscroll"><div class="cw-rtable cw-rt-detail" role="table">
        <div class="cw-rt-head" role="row"><span>地址（已隐去名称）</span><span>开始</span><span>耗时</span><span>首字节／接收</span><span>传输／解压后</span></div>
        ${rows.map((x) => html`<div class="cw-rt-row" role="row"><span>${redactUrl(x.url)}<small>${CAT_LABEL[x.cat] || x.cat}${x.provider ? ` · ${x.provider}接口` : ""}${x.sw ? " · Service Worker" : ""}${cacheText[x.cache] ? ` · ${cacheText[x.cache]}` : ""}</small></span><span>${fmtMs(x.start)}</span><span>${fmtMs(x.dur)}</span><span>${x.ttfb == null ? "—" : fmtMs(x.ttfb)} / ${x.recv == null ? "—" : fmtMs(x.recv)}</span><span>${x.transfer == null ? "未取得" : `${fmtSize(x.transfer)} / ${fmtSize(x.decoded)}`}</span></div>`)}
      </div></div>
      <p class="cw-hint">「首字节」是从发出请求到收到第一个字节，包含网络往返，不等于服务器处理时间。</p></section>`);
    detail.hidden = false;
    detail.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }
  function exportReport() {
    if (!last) return;
    const report = buildDiagReport({ version: VERSION, kind: BUILD_KIND, measure: last, presets: last.presets, extData: last.extData, charCount: last.charCount, lazyChars: last.lazyChars, compat: typeof lastCompatSummary === "function" ? lastCompatSummary() : null });
    const t = new Date(), two = (x) => String(x).padStart(2, "0");
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), `diagnostics-${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}-${two(t.getHours())}${two(t.getMinutes())}.json`);
    toast("已交给浏览器下载诊断报告。报告不含预设正文、聊天内容和密钥，角色、聊天等文件名已隐去");
  }
  page.addEventListener("click", (e) => {
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a === "h-run") return run();
    if (a === "h-detail") return showDetail();
    if (a === "h-export") return exportReport();
    if (a === "h-clean") return show("clean", "preset");
  });
  // 每次切到这一页都重新检查（清理、归档之后数字会变），3 秒内不重复
  let lastRun = 0;
  return {
    render() {
      if (Date.now() - lastRun < 3000) return;
      lastRun = Date.now();
      run();
    }
  };
}
