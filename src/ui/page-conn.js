// 「连接」页：当前连接、方案、站点、选项。
// 当前连接：模型、拉取、测试、余额；站点：切换、编辑、排序、导入导出、查余额；方案：保存、切换、编辑、自动套用；
// 选项：换角色或聊天时的提示、推理格式跟随预设
// ---------- 方案窗口里的人设、API 选择 ----------
function personaPicker(init, name = "") {
  const cur = currentPersona();
  const list = listPersonas();
  if (init && init !== "__none" && !list.some((p) => p.avatar === init)) list.unshift({ avatar: init, name: name || init });
  const opts = [["__none", "不记录（切换方案时人设不变）"], ...list.map((p) => [p.avatar, `${p.name}${p.avatar === cur ? "（当前）" : ""}`])];
  if (!opts.some(([v]) => v === init)) init = "__none";
  const box = el(html`<label class="cw-field"><span>人设</span><select class="cw-select" data-f="persona">${opts.map(([v, l]) => html`<option value="${v}"${v === init ? raw(" selected") : ""}>${l}</option>`)}</select></label>`);
  const sel = box.querySelector("select");
  const read = () => sel.value === "__none" ? { persona: null, personaName: "" } : { persona: sel.value, personaName: list.find((p) => p.avatar === sel.value)?.name || "" };
  return { el: box, read };
}
// API 可选：不记录、当前连接、原记录（对不上已存站点时）、已存站点；模型可另选，多密钥站点一并选分组
function connPicker(init, keep = null) {
  const nowConn = liveConn();
  const sites = settings().sites;
  const keepSite = keep?.siteId && sites.some((x) => x.id === keep.siteId);
  const opts = [
    ["__none", "不记录（切换方案时 API 不变）"],
    ...(nowConn ? [["__live", `当前连接：${connLabel(nowConn, { model: false })}`]] : []),
    ...(keep && !keepSite ? [["__keep", `原来记的：${connLabel(keep, { model: false })}`]] : []),
    ...sites.map((x) => [x.id, `站点：${x.name}`])
  ];
  if (!opts.some(([v]) => v === init)) init = "__none";
  const box = el(html`<div class="cw-form">
      <label class="cw-field"><span>API</span><select class="cw-select" data-f="api">${opts.map(([v, l]) => html`<option value="${v}"${v === init ? raw(" selected") : ""}>${l}</option>`)}</select></label>
      <div class="cw-field" data-f="apimodel"><span>模型</span><div class="cw-modelslot"></div></div>
    </div>`);
  const sel = box.querySelector("[data-f=api]");
  const slot = box.querySelector(".cw-modelslot");
  let model = "";
  let keyId = null;
  const site = () => sites.find((x) => x.id === sel.value);
  const models = () => sel.value === "__live" ? liveModelOptions() : site()?.models || [];
  const setModel = (m, k = null) => {
    model = m || "";
    const x = site();
    keyId = x && siteMulti(x) ? siteKey(x, k).id : null;
    slot.innerHTML = String(modelBtn(model, { attrs: 'data-f="apimodelbtn"', key: keyId ? keyName(x, siteKey(x, keyId)) : "" }));
  };
  // 换了来源就带出它记的模型；原来就是这个站点时用方案记的模型
  const reset = () => {
    const v = sel.value;
    box.querySelector("[data-f=apimodel]").hidden = v === "__none";
    if (v === "__live") setModel(nowConn.model);
    else if (v === "__keep") setModel(keep.model);
    else if (site()) {
      const same = keep?.siteId === v;
      const k = siteKey(site(), same ? keep.keyId : undefined);
      setModel(same && keep.model ? keep.model : k.model, k.id);
    }
  };
  sel.addEventListener("change", reset);
  slot.addEventListener("click", async () => {
    const x = site();
    if (x && siteMulti(x)) {
      const r = await pickKeyModel(x, { keyId, model });
      if (r) setModel(r.model, r.keyId);
      return;
    }
    const m = await pickModel(models(), model, { site: x || null });
    if (m) setModel(m);
  });
  reset();
  const read = () => {
    const v = sel.value;
    if (v === "__none") return null;
    if (v === "__live") return { ...nowConn, model };
    if (v === "__keep") return { ...keep, model };
    const x = site();
    const kv = keyView(x, keyId);
    return { source: x.source, url: x.url || "", model, secretId: kv.secretId || null, siteId: x.id, keyId };
  };
  return { el: box, read, choice: () => sel.value };
}
// 推理格式编辑。live：这是当前预设、跟随开着，保存即改酒馆现在的设置
async function editReasoning(name, init, live) {
  const base = { ...(reasoningNow() || {}), ...init };
  const has = (k) => base[k] !== undefined;
  const tpls = reasoningTemplates();
  if (has("name") && base.name && !tpls.some((t) => t.name === base.name)) tpls.unshift({ name: base.name });
  const text = (k, label) => has(k) ? html`<label class="cw-field"><span>${label}<i class="cw-rws"></i></span><textarea class="cw-input cw-mono" data-k="${k}" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></label>` : "";
  const body = el(html`<div class="cw-form">
      <p class="cw-hint">${live ? "当前预设：保存后立即改酒馆「推理内容格式化」的设置。" : "切到这个预设时套用。"}</p>
      ${has("name") ? html`<label class="cw-field"><span>模板</span>${tpls.length ? html`<select class="cw-select" data-k="name">${tpls.map((t) => html`<option value="${t.name}"${t.name === base.name ? raw(" selected") : ""}>${t.name}</option>`)}</select>` : html`<input class="cw-input" data-k="name" value="${base.name}">`}</label>` : ""}
      ${text("prefix", "前缀")}${text("suffix", "后缀")}${text("separator", "分隔符")}
      <div class="cw-checks">${REASONING_FLAGS.filter(([k]) => has(k)).map(([k, label]) => html`<label class="cw-check"><input type="checkbox" data-k="${k}"${base[k] ? raw(" checked") : ""}><span>${label}</span></label>`)}</div>
      ${has("max_additions") ? html`<label class="cw-field"><span>添加到提示词的最大条数</span><input class="cw-input" type="number" min="0" max="999" step="1" inputmode="numeric" data-k="max_additions" value="${base.max_additions}"></label>` : ""}
    </div>`);
  // 只有换行或空格时框里看着是空的，在标题旁标出来
  const mark = (t) => { t.closest(".cw-field").querySelector(".cw-rws").textContent = t.value && !t.value.trim() ? `（${showBreaks(t.value).replace(/ /g, "␣")}）` : ""; };
  // 前后缀常以换行开头，写进 HTML 会被吞掉，所以直接赋值
  body.querySelectorAll("textarea[data-k]").forEach((t) => {
    t.value = String(base[t.dataset.k] ?? "");
    mark(t);
    t.addEventListener("input", () => mark(t));
  });
  // 换模板时和酒馆一样带出该模板的前缀、后缀、分隔符
  body.querySelector("select[data-k=name]")?.addEventListener("change", (e) => {
    const t = tpls.find((x) => x.name === e.target.value);
    for (const k of ["prefix", "suffix", "separator"]) {
      const box = body.querySelector(`textarea[data-k=${k}]`);
      if (box && typeof t?.[k] === "string") { box.value = t[k]; mark(box); }
    }
  });
  return dialog({
    title: `推理格式：${name}`,
    body,
    noFocus: true,
    actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (w) => {
      const out = { ...init };
      w.querySelectorAll("[data-k]").forEach((x) => {
        const k = x.dataset.k;
        if (x.type === "checkbox") out[k] = x.checked;
        else if (k === "max_additions") {
          const n = Math.round(Number(x.value));
          out[k] = x.value.trim() !== "" && Number.isFinite(n) ? Math.min(999, Math.max(0, n)) : base[k];
        } else out[k] = x.value;
      });
      return out;
    } }]
  });
}
function mountConnPage(page) {
  page.innerHTML = String(html`<div class="cw-body"><div class="cw-col cw-conn">
      <section class="cw-sec" data-r="live"></section>
      <section class="cw-sec" data-r="schemes">
        <div class="cw-sec-h"><h3>方案</h3><button type="button" class="cw-namebtn" data-s="view" title="方案的分组方式"><small>按</small><span></span>${iconHtml("chevDown")}</button><span class="cw-gap"></span>${tipBtn()}<span class="cw-scheme-tools"></span>${btn("保存为方案", { act: "s-new", kind: "primary", size: "sm", icon: "plus", attrs: 'data-s="new"' })}</div>
        ${tipNote("<p>方案保存预设和条目开关，可选记下人设、API 和模型。</p><p>「切换」：恢复方案保存时的全部状态。「自动套用」：绑定聊天或角色后，进入该聊天时切换一次，之后手动修改的内容保持不变。</p><p>换预设时 API 不变；切换方案时，方案记了 API 的才换 API。</p>")}
        <div class="cw-scheme-nudge"></div>
        <div class="cw-schemes"></div>
      </section>
      <section class="cw-sec" data-r="sites"></section>
      <section class="cw-sec" data-r="opts"><div class="cw-sec-h"><h3>选项</h3></div><div data-r="optsbody"></div></section>
    </div></div>`);
  const $ = (k) => page.querySelector(`[data-r="${k}"]`);
  const liveBox = $("live"), sitesBox = $("sites"), optsBox = $("optsbody");
  const sites = () => settings().sites;
  const shortLabel = (source) => (SOURCES[source]?.label || source || "—").split("（")[0];
  // 当前连接还没存成站点时拉取到的模型列表；测试结果（换了模型就不显示）
  let liveFetched = null;
  let liveTest = null;
  let editing = false;
  let dragging = false;
  const liveOpen = () => foldGet("live", "detail");
  // ---------- 余额 ----------
  const balBusy = new Set();
  const balTried = new Map();
  // 当前连接要查余额的站点：存成站点的按站点和分组记，没存的按类型和网址记
  const liveBalTarget = (live, active, ak, same) => same
    ? { site: keyView(active, ak.id), id: balanceId(active, ak), owner: { siteId: active.id, k: ak } }
    : live.source ? { site: { id: "live", name: "当前连接", source: live.source, url: live.url || "", secretId: live.secretId }, id: `live:${live.source}:${live.url || ""}` } : null;
  const balKid = (x, k) => siteMulti(x) ? k.id : "main";
  const balSec = (k) => String(k.secretId || k.localId || (k.localKey ? "local" : ""));
  const balKeys = (x) => siteMulti(x) ? x.keys : [x];
  // 手填后，一个分组第一次查到用量时记下作起点
  function balBase(owner, result) {
    const x = owner && sites().find((y) => y.id === owner.siteId);
    const m = x?.manualBalance;
    if (!m || result?.used == null) return;
    const kid = balKid(x, owner.k), sec = balSec(owner.k);
    if (m.base?.[kid]?.sec === sec) return;
    m.base = { ...(m.base || {}), [kid]: { used: result.used, sec } };
  }
  function balManualNow(x) {
    const readings = balKeys(x).map((k) => ({ kid: balKid(x, k), sec: balSec(k), used: balanceGet(balanceId(x, k))?.used ?? null }));
    return balanceManual(x.manualBalance, readings);
  }
  async function queryBalance(site, id, owner = null) {
    if (balBusy.has(id)) return;
    balBusy.add(id);
    render();
    try {
      const result = await fetchBalance(site);
      balanceSet(id, result);
      balBase(owner, result);
    } catch (e) {
      balanceSet(id, { ok: false, text: "没查到", why: e.message, at: Date.now() });
    } finally {
      balBusy.delete(id);
      saveSettings();
      render();
    }
  }
  async function querySite(x) {
    for (const k of balKeys(x)) {
      const target = keyView(x, k.id);
      if (!balancePlan(target).none) await queryBalance(target, balanceId(x, k), { siteId: x.id, k });
    }
  }
  async function setManualBalance(x, amount) {
    if (amount == null) delete x.manualBalance;
    else x.manualBalance = { amount, at: Date.now(), base: {} };
    saveSettings();
    render();
    if (amount != null) await querySite(x);
  }
  const balLine = (t) => {
    if (!t || balancePlan(t.site).none) return "";
    const b = balanceGet(t.id);
    const again = ibtn("refresh", "重新查余额", { act: "balance" });
    const x = t.owner && sites().find((y) => y.id === t.owner.siteId);
    // 填余额：不限额的令牌、没查到余额时才给；已手填的给「改余额」
    const setBtn = x && balancePlan(t.site).kind === "relay" && (x.manualBalance || b && (!b.ok || b.text === "不限额")) ? html`<button type="button" class="cw-link" data-act="balanceset">${x.manualBalance ? "改余额" : "填余额"}</button>` : "";
    if (balBusy.has(t.id)) return html`<div class="cw-bal"><span class="cw-bal-k">余额</span><small class="cw-dim">正在查…</small></div>`;
    if (x?.manualBalance) {
      const m = balManualNow(x);
      const all = balKeys(x).length;
      const note = [`手填 ${balanceMoney(x.manualBalance.amount)}`, `之后用了 ${balanceMoney(m.spent)}`, m.missing ? `${m.missing === all ? "" : `${m.missing} 个分组`}用量还没查到` : "", b ? balanceAgo(b.at) : ""].filter(Boolean).join(" · ");
      return html`<div class="cw-bal"><span class="cw-bal-k">余额</span><b>${balanceMoney(m.remain)}</b><small>${note}</small>${setBtn}${again}</div>`;
    }
    if (!b) return html`<div class="cw-bal"><span class="cw-bal-k">余额</span><button type="button" class="cw-link" data-act="balance">查余额</button></div>`;
    if (!b.ok) return html`<div class="cw-bal is-bad"${b.why ? raw(` title="${esc(b.why)}"`) : ""}><span class="cw-bal-k">余额</span><small>${b.text} · ${balanceAgo(b.at)}</small>${setBtn}${again}</div>`;
    return html`<div class="cw-bal"><span class="cw-bal-k">余额</span><b>${b.text}</b><small>${[b.sub, balanceAgo(b.at)].filter(Boolean).join(" · ")}</small>${setBtn}${again}</div>`;
  };
  // 站点小字：手填了账户余额的写扣减后的余额（多密钥站点写在站点那一行）
  const balShort = (x, k) => {
    if (x.manualBalance) return k === x || siteMulti(x) && k === siteKey(x) && !foldGet("sites", x.id) ? `余额 ${balanceMoney(balManualNow(x).remain)}` : "";
    const b = balanceGet(balanceId(x, k));
    return b?.ok ? `余额 ${b.text}` : "";
  };
  // ---------- 当前连接 ----------
  const usingModel = (live = liveConnection()) => {
    const c = ctx();
    return (typeof c.getChatCompletionModel === "function" ? c.getChatCompletionModel() : "") || live.model || "";
  };
  const isSame = (site, live) => !!site && site.source === live.source && (site.source !== "custom" || (site.url || "") === (live.url || ""));
  const activeSite = () => sites().find((x) => x.id === settings().activeSiteId);
  function liveModelList(live = liveConnection()) {
    const active = activeSite();
    const fetched = liveFetched && liveFetched.source === live.source && liveFetched.url === (live.url || "") ? liveFetched.models : [];
    return [...new Set([...liveModelOptions(), ...isSame(active, live) ? siteKey(active).models || [] : [], ...fetched])];
  }
  function renderLive() {
    const live = liveConnection();
    const active = activeSite();
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    const sameSite = isSame(active, live);
    // 多密钥站点：在酒馆里换了密钥、正好是这个站点的另一个分组，跟着记过去
    if (sameSite && siteMulti(active) && live.secretId && siteKey(active).secretId !== live.secretId) {
      const k = active.keys.find((x) => x.secretId === live.secretId);
      if (k) { active.keyId = k.id; saveSettings(); }
    }
    const ak = sameSite ? siteKey(active) : null;
    // 单密钥站点只同步可选的模型列表；在酒馆里临时换的模型不悄悄写进站点
    if (ak && !siteMulti(active) && liveModels.length && JSON.stringify(ak.models || []) !== JSON.stringify(liveModels)) {
      ak.models = liveModels;
      saveSettings();
    }
    const modelDiff = ak && live.model && ak.model && live.model !== ak.model;
    const sub = live.url || src?.label || "";
    const testOk = liveTest && liveTest.model === usingModel(live) && liveTest.source === live.source && liveTest.url === (live.url || "") && liveTest.secretId === (live.secretId || null);
    const open = liveOpen();
    let details = "";
    if (open) {
      const source = active ? active.source : live.source;
      const mask = (x) => x.keyMask || (x.secretId ? "已保存" : "使用当前密钥");
      const key = active ? siteMulti(active) ? `${keyName(active, ak || siteKey(active))}：${mask(ak || siteKey(active))}（共 ${active.keys.length} 个分组）` : mask(active) : live.secretMask;
      details = html`<div class="cw-live-detail"><dl class="cw-kv"><dt>类型</dt><dd>${SOURCES[source]?.label || source || "—"}</dd>${key ? html`<dt>密钥</dt><dd>${key}</dd>` : ""}${active?.note ? html`<dt>备注</dt><dd>${active.note}</dd>` : ""}</dl>
        <div class="cw-card-acts">${active ? html`${btn("编辑站点", { act: "edit", size: "sm", icon: "pencil" })}${btn("删除站点", { act: "del", size: "sm", kind: "danger" })}` : btn("保存为站点", { act: "capture", size: "sm", kind: "primary" })}</div></div>`;
    }
    liveBox.innerHTML = String(html`<div class="cw-sec-h"><h3>当前连接</h3></div>
      <article class="cw-card cw-live${live.online ? " is-on" : ""}"${active ? raw(` data-id="${esc(active.id)}"`) : ""}>
        <header class="cw-live-head"><span class="cw-dot${live.online ? " on" : ""}" aria-hidden="true"></span><span class="cw-live-state">${live.online ? "已连接" : "未连接"}</span>
          <b class="cw-live-name" title="${active ? active.name : shortLabel(live.source)}">${active ? active.name : shortLabel(live.source)}</b>
          ${active ? "" : html`<button type="button" class="cw-link" data-act="capture" title="保存为站点">保存为站点</button>`}
          <span class="cw-gap"></span>${ibtn("more", "连接详情", { act: "livemore", attrs: `aria-expanded="${String(open)}"`, cls: open ? "on" : "" })}</header>
        ${sub ? html`<div class="cw-live-url" title="${sub}">${sub}</div>` : ""}
        <div class="cw-live-model">${modelBtn(live.model, { act: "livemodel", arrow: liveModelList(live).length > 0 || !!ak && siteMulti(active), key: ak && siteMulti(active) ? keyName(active, ak) : "" })}
          ${live.source === "custom" ? ibtn("refresh", "拉取模型列表", { act: "livefetch" }) : ""}${ibtn("bolt", "发送测试消息，看选中的模型能不能用", { act: "testmodel" })}</div>
        ${testOk ? html`<p class="cw-test ${liveTest.ok ? "is-ok" : "is-bad"}"${liveTest.raw ? raw(` title="${esc(liveTest.raw)}" data-act="testraw" role="button" tabindex="0"`) : ""}>${iconHtml(liveTest.ok ? "ok" : "warn")}<span>${liveTest.text}</span></p>` : ""}
        ${balLine(liveBalTarget(live, active, ak, sameSite))}
        ${modelDiff ? html`<p class="cw-hint">站点记的是「${ak.model}」，切换预设后会换回它。<button type="button" class="cw-link" data-act="keepmodel">改记为当前模型</button></p>` : ""}
        ${details}
      </article>`);
    // 当前连接的余额超过 10 分钟没查过就查一次；手填了账户余额的站点改为 1 分钟。同一连接节流
    const t = liveBalTarget(live, active, ak, sameSite);
    const b = t && balanceGet(t.id);
    const now = Date.now();
    const gap = sameSite && active.manualBalance ? 60000 : 600000;
    if (t && !balancePlan(t.site).none && (!b || now - b.at > gap) && !(now - (balTried.get(t.id) || 0) < gap)) {
      balTried.set(t.id, now);
      setTimeout(() => queryBalance(t.site, t.id, t.owner), 0);
    }
  }
  // ---------- 站点 ----------
  const usedBy = (id) => [...new Set(settings().schemes.filter((sc) => schemeConn(sc)?.siteId === id).map((sc) => sc.preset))];
  const useBtn = (on) => on ? pill("使用中", "accent") : btn("切换", { act: "use", size: "sm" });
  function siteRow(x, i) {
    const used = usedBy(x.id);
    const on = x.id === settings().activeSiteId;
    if (editing) {
      const info = [siteMulti(x) ? `${x.keys.length} 组` : x.model || "未选模型", x.source === "custom" ? "" : shortLabel(x.source), used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · ");
      return html`<div class="cw-site is-edit${on ? " is-on" : ""}" data-id="${x.id}">
        <button type="button" class="cw-handle cw-site-grip" aria-label="「${x.name}」第 ${i + 1} 个，共 ${sites().length} 个，按上下方向键移动" title="拖动排序">${iconHtml("grip")}</button>
        <div class="cw-site-main"><b>${x.name}</b><small>${info}</small></div>
        ${on ? pill("使用中", "accent") : ""}${ibtn("trash", `删除「${x.name}」`, { act: "del", cls: "cw-ibtn-danger" })}</div>`;
    }
    if (siteMulti(x)) {
      const open = foldGet("sites", x.id);
      const k = siteKey(x);
      const info = [on ? `${keyName(x, k)} · ${k.model || "未选模型"}` : "", x.source === "custom" ? "" : shortLabel(x.source), on || x.manualBalance ? balShort(x, k) : "", used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · ");
      return html`<div class="cw-site is-multi${on ? " is-on" : ""}${open ? " is-open" : ""}" data-id="${x.id}">
        <div class="cw-site-head"><div class="cw-site-main" data-act="edit" role="button" tabindex="0" data-key-click title="查看、编辑"><b>${x.name}</b>${info ? html`<small>${info}</small>` : ""}</div>
          ${on ? pill("使用中", "accent") : ""}<button type="button" class="cw-btn cw-btn-sm cw-btn-ghost cw-site-fold" data-act="sitefold" aria-expanded="${String(open)}">${x.keys.length} 组${iconHtml(open ? "chevDown" : "chev")}</button></div>
        ${open ? html`<div class="cw-site-keys">${x.keys.map((y) => {
          const cur = on && y.id === k.id;
          return html`<div class="cw-site-key${cur ? " is-on" : ""}" data-k="${y.id}"><div class="cw-site-main" data-act="edit" role="button" tabindex="0" data-key-click><b>${keyName(x, y)}</b><small>${[y.model || "未选模型", balShort(x, y)].filter(Boolean).join(" · ")}</small></div>${useBtn(cur)}</div>`;
        })}</div>` : ""}</div>`;
    }
    const info = [x.model || "未选模型", x.source === "custom" ? "" : shortLabel(x.source), balShort(x, x), used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · ");
    return html`<div class="cw-site${on ? " is-on" : ""}" data-id="${x.id}"><div class="cw-site-head"><div class="cw-site-main" data-act="edit" role="button" tabindex="0" data-key-click title="查看、编辑"><b>${x.name}</b><small>${info}</small></div>${useBtn(on)}</div></div>`;
  }
  function renderSites() {
    if (dragging) return;
    const n = sites().length;
    if (!n) editing = false;
    const head = editing
      ? html`${fileBtn("导入", { attr: "data-import-sites", icon: "fileIn", kind: "sm" })}${btn("导出", { act: "exportsites", size: "sm", icon: "fileOut" })}${btn("完成", { act: "sitesdone", size: "sm", kind: "primary" })}`
      : html`${n ? ibtn("wallet", "查全部站点的余额", { act: "balanceall" }) : ""}${n ? ibtn("pencil", "编辑：排序、删除、导入导出", { act: "sitesedit" }) : ""}${ibtn("plus", "添加站点", { act: "new" })}`;
    sitesBox.innerHTML = String(html`<div class="cw-sec-h"><h3>站点</h3>${n ? html`<small>${n} 个</small>` : ""}<span class="cw-gap"></span>${n ? tipBtn() : ""}<span class="cw-sec-acts">${head}</span></div>
      ${n ? html`${tipNote(editing ? "按住左边的把手拖动排序，点垃圾桶删除。导出的站点文件可在重装、换设备后导入。" : "点站点名修改详情。点铅笔可排序、删除，导入或导出站点文件。")}<div class="cw-sites${editing ? " is-editing" : ""}">${sites().map(siteRow)}</div>`
        : html`<div class="cw-empty-line">暂无站点。可点 ＋ 添加、${fileBtn("从文件导入", { attr: "data-import-sites", kind: "quiet" })}，或保存上方的当前连接。</div>`}`);
  }
  // ---------- 选项 ----------
  function renderOpts() {
    const s = settings();
    const follow = s.reasoningFollowPreset === true;
    const kept = Object.keys(s.reasoningByPreset || {}).length;
    let reasoning = "";
    if (follow) {
      const store = reasoningStore();
      const live = reasoningNow();
      const rows = Object.keys(store).filter((n) => n !== reasoningPreset).sort((a, b) => a.localeCompare(b, "zh")).map((n) => ({ name: n, r: store[n], cur: false }));
      if (reasoningPreset && live) rows.unshift({ name: reasoningPreset, r: live, cur: true });
      reasoning = html`<div class="cw-rlist">${rows.map((x) => html`<div class="cw-rrow${x.cur ? " is-on" : ""}" data-name="${x.name}">
          <div class="cw-rrow-main"><b title="${x.name}">${x.name}</b>${x.cur ? pill("当前", "accent") : ""}<small title="${reasoningSummary(x.r)}"><code>${showBreaks(x.r.prefix).trim() || "无前缀"}</code>${x.r.auto_parse ? "自动解析" : "不解析"}</small></div>
          ${btn("修改", { act: "reasoningedit", size: "sm" })}${x.cur ? "" : ibtn("trash", `删除「${x.name}」的记录`, { act: "reasoningdel" })}</div>`)}
        <button type="button" class="cw-addrow" data-act="reasoningadd">${iconHtml("plus")}<span>给其他预设设置</span></button></div>`;
    } else if (kept) reasoning = html`<div class="cw-rlist"><div class="cw-rrow"><div class="cw-rrow-main"><b>已记住 ${kept} 个预设</b></div>${btn("清除", { act: "reasoningclear", size: "sm", kind: "danger" })}</div></div>`;
    optsBox.innerHTML = String(html`<div class="cw-setlist">
        <label class="cw-setrow"><span><b>换角色或聊天时，提示当前预设和模型</b><small>弹出当前预设和模型，3 秒后消失。换预设时 API 不变；切换方案时，方案记了 API 的才换。</small></span>${switchHtml({ act: "chattoast", on: s.chatToast !== false, label: "换角色或聊天时，提示当前预设和模型" })}</label>
        <label class="cw-setrow"><span><b>切换预设时，同时切换推理格式</b><small>离开预设时记下酒馆「推理内容格式化」的设置，切回时恢复</small></span>${switchHtml({ act: "reasoningfollow", on: follow, label: "切换预设时，同时切换推理格式" })}</label>
      </div>${reasoning}`);
  }
  // ---------- 方案 ----------
  const schemesBox = page.querySelector(".cw-schemes");
  const nudge = page.querySelector(".cw-scheme-nudge");
  const SVIEWS = [["char", "角色卡"], ["preset", "预设"], ["persona", "人设"]];
  const allSchemes = () => settings().schemes;
  let picking = false;
  const picked = new Set();
  const sview = () => SVIEWS.some(([k]) => k === settings().schemeView) ? settings().schemeView : "char";
  const groupKey = (s) => sview() === "preset" ? s.preset : sview() === "persona" ? s.persona ? s.personaName || s.persona : "" : schemeCharKey(s);
  const groupName = (k) => sview() === "char" ? charNameOf(k) : k || (sview() === "persona" ? "没记人设" : "");
  function schemeRow(s, d) {
    const bind = bindingNow();
    const bound = bind?.id === s.id ? bind.scope : null;
    // 「使用中」要和酒馆实际生效的一致：预设正在用、开关一致、人设和 API 站点也对得上
    const switchesOk = !!d && s.preset === d.name && schemeMatches(d, s);
    const conn = schemeConn(s);
    const cs = connSite(conn);
    const on = switchesOk && currentPresetName() === s.preset && (!s.persona || currentPersona() === s.persona) && (!cs || !siteDiffers(cs, { ...liveConnection(), online: true }));
    const archived = !listPresets().includes(s.preset) && archiveList().some((x) => x.name === s.preset);
    const meta = [
      sview() !== "preset" ? s.preset + (archived ? "（已归档）" : "") : "",
      sview() !== "persona" && s.persona ? s.personaName || s.persona : "",
      sview() !== "char" && schemeCharKey(s) ? charNameOf(schemeCharKey(s)) : "",
      shortTime(Math.max(s.usedAt || 0, s.at || 0))
    ].filter(Boolean).join(" · ");
    const api = html`<small class="cw-scheme-api${conn ? "" : " is-none"}">API：${conn ? connLabel(conn) : "不切换"}</small>`;
    const bindPill = bound ? html`<span class="cw-pill cw-pill-line" title="进入${bound === "chat" ? "这个聊天" : "这个角色的聊天"}时自动切换到它">${iconHtml("link")}${BIND_LABEL[bound]}</span>` : "";
    if (picking) return html`<label class="cw-scheme is-pick" data-id="${s.id}"><input type="checkbox" class="cw-tickbox" data-act="pick"${picked.has(s.id) ? raw(" checked") : ""}>
        <div class="cw-scheme-main"><div class="cw-scheme-name"><b>${s.name}</b>${bindPill}</div><small>${meta}</small>${api}</div></label>`;
    return html`<div class="cw-scheme${on ? " is-on" : ""}" data-id="${s.id}">
        <div class="cw-scheme-main"><div class="cw-scheme-name"><b>${s.name}</b>${on ? pill("使用中", "accent") : switchesOk ? pill("开关一致", "muted", "条目开关和方案一致，但预设、人设或 API 站点不是方案记录的") : ""}${bindPill}</div><small>${meta}</small>${api}</div>
        ${btn("切换", { act: "apply", size: "sm", kind: on ? "ghost" : "", title: "把预设、开关、人设、API 一次换成方案记的样子" })}${ibtn("pencil", "编辑方案", { act: "sedit" })}</div>`;
  }
  function renderSchemes() {
    let d = null;
    try { d = getDraft(currentPresetName()); } catch {}
    page.querySelector('[data-s="view"] span').textContent = SVIEWS.find(([k]) => k === sview())[1] + "分组";
    for (const id of [...picked]) if (!allSchemes().some((x) => x.id === id)) picked.delete(id);
    if (picking && !allSchemes().length) picking = false;
    page.querySelector(".cw-scheme-tools").innerHTML = String(picking
      ? html`<small class="cw-dim">已选 ${picked.size} 个</small>${btn("删除", { act: "s-delpicked", size: "sm", kind: "danger", disabled: !picked.size, attrs: 'data-s="delpicked"' })}${btn("取消", { size: "sm", attrs: 'data-s="pickoff"' })}`
      : allSchemes().length ? ibtn("trash", "勾选删除方案", { attrs: 'data-s="pickon"' }) : "");
    page.querySelector('[data-s="new"]').hidden = picking;
    const ck = hasChat() ? currentCharKey() : null;
    const cur = currentPresetName();
    nudge.innerHTML = ck && cur && !allSchemes().some((s) => schemeCharKey(s) === ck && s.preset === cur)
      ? String(html`<div class="cw-note">${iconHtml("info")}<div>「${currentCharName()}」还没有「${cur}」的方案。<button type="button" class="cw-link" data-s="new">保存一个</button></div></div>`) : "";
    if (!allSchemes().length) {
      schemesBox.innerHTML = String(html`<div class="cw-empty-line">还没有方案。先开启需要的条目，再点「保存为方案」。</div>`);
      return;
    }
    const groups = new Map();
    for (const s of allSchemes()) {
      const k = groupKey(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const t = (s) => Math.max(s.usedAt || 0, s.at || 0);
    // 当前角色（预设、人设）那一组排最前，其余按最近用过排；「未分角色」放最后
    const mineKey = sview() === "char" ? ck || "" : sview() === "preset" ? cur : listPersonas().find((p) => p.avatar === currentPersona())?.name || "";
    const keys = [...groups.keys()].sort((a, b) => (b === mineKey) - (a === mineKey) || (!a) - (!b) || Math.max(...groups.get(b).map(t)) - Math.max(...groups.get(a).map(t)));
    const defOpen = groups.has(mineKey) ? mineKey : keys[0];
    schemesBox.innerHTML = String(html`${keys.map((k) => {
      const list = groups.get(k).sort((a, b) => t(b) - t(a));
      const open = foldGet("schemes", sview() + "|" + k, k === defOpen);
      return html`<section class="cw-sgroup${open ? " is-open" : ""}" data-k="${k}">
        <div class="cw-sghead">${picking ? html`<input type="checkbox" class="cw-tickbox" data-act="pickgroup" aria-label="选中这一组"${list.every((s) => picked.has(s.id)) ? raw(" checked") : ""}>` : ""}<button type="button" class="cw-sghead-btn" data-act="sfold" aria-expanded="${String(open)}">${iconHtml(open ? "chevDown" : "chev")}<b>${groupName(k)}</b>${k === mineKey && k ? pill("当前", "accent") : ""}<small>${list.length} 个</small></button></div>
        ${open ? html`<div class="cw-sgbody">${list.map((s) => schemeRow(s, d))}</div>` : ""}</section>`;
    })}`);
  }
  async function saveNewScheme() {
    let d;
    try { d = getDraft(currentPresetName()); } catch (e) { return toast(e.message, "error"); }
    const groups = d.groups.groups;
    const ck = hasChat() ? currentCharKey() : null;
    const cname = ck ? currentCharName() : "";
    const prevBound = hasChat() ? allSchemes().find((x) => x.id === chatMeta()[META_KEY]) : null;
    const picker = connPicker(settings().schemeApiPick || "__none");
    const pp = personaPicker(settings().schemePersonaPick === "__none" ? "__none" : currentPersona() || "__none");
    const body = el(html`<div class="cw-form">
        <label class="cw-field"><span>方案名称</span><input class="cw-input" data-f="name" value="${d.name}" placeholder="例如：纯爱、年上"></label>
        <div class="cw-card"><dl class="cw-kv"><dt>预设</dt><dd>${d.name}</dd><dt>条目开关</dt><dd class="cw-save-scope">${groups.length ? "勾选的分组" : "全部条目"}</dd></dl></div>
        <div class="cw-slot-persona"></div><div class="cw-slot-conn"></div>
        ${ck ? html`<label class="cw-check"><input type="checkbox" data-f="char" checked><span>归到角色「${cname}」</span></label>
          <label class="cw-check"><input type="checkbox" data-f="bind"><span>进入这个聊天时自动切换到它${prevBound ? `（替换「${prevBound.name}」）` : ""}</span></label>` : html`<p class="cw-hint">当前不在聊天中，方案归入「未分角色」。</p>`}
        ${fold("条目开关的保存范围", String(html`<div class="cw-form">
          <label class="cw-check"><input type="radio" name="cw-scope" value="groups"${groups.length ? raw(" checked") : raw(" disabled")}><span>只保存勾选的分组（其他条目不受影响）</span></label>
          <div class="cw-checks cw-checks-indent">${groups.length ? groups.map((g) => html`<label class="cw-check"><input type="checkbox" data-g="${g.id}"${LIKELY.test(g.name) ? raw(" checked") : ""}><span>${g.name}</span></label>`) : html`<p class="cw-hint">此预设没有分组</p>`}</div>
          <label class="cw-check"><input type="radio" name="cw-scope" value="all"${groups.length ? "" : raw(" checked")}><span>保存全部条目（整个预设每条的开关都按方案恢复）</span></label></div>`))}
      </div>`);
    body.querySelector(".cw-slot-persona").replaceWith(pp.el);
    body.querySelector(".cw-slot-conn").replaceWith(picker.el);
    body.addEventListener("change", () => {
      const all2 = body.querySelector("input[name=cw-scope]:checked")?.value === "all";
      body.querySelector(".cw-save-scope").textContent = all2 ? "全部条目" : "勾选的分组";
    });
    const r = await dialog({
      title: "保存为方案", body, size: "lg",
      actions: [{ label: "取消", value: null }, {
        label: "保存", kind: "primary",
        validate: (w) => {
          if (!w.querySelector("[data-f=name]").value.trim()) { toast("请填写方案名称"); return false; }
          return true;
        },
        value: (w) => ({
          name: w.querySelector("[data-f=name]").value.trim(),
          scope: w.querySelector("input[name=cw-scope]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g),
          char: !!w.querySelector("[data-f=char]")?.checked,
          bind: !!w.querySelector("[data-f=bind]")?.checked,
          conn: picker.read(),
          ...pp.read()
        })
      }]
    });
    if (!r) return;
    if (Array.isArray(r.scope) && !r.scope.length) return toast("请至少勾选一个分组，或选择保存全部条目", "warning");
    settings().schemeApiPick = picker.choice();
    settings().schemePersonaPick = r.persona ? "current" : "__none";
    const conn = r.conn;
    const s = { id: uid(), name: r.name, preset: d.name, scope: r.scope, persona: r.persona, personaName: r.personaName, conn, siteId: conn?.siteId || null, charKey: r.char && ck ? ck : "", at: Date.now(), usedAt: Date.now() };
    Object.assign(s, schemeStates(d, s));
    allSchemes().push(s);
    if (r.bind && hasChat()) {
      chatMeta()[META_KEY] = s.id;
      await saveChatMeta();
      markChatHandled();
    }
    saveSettings();
    foldSet("schemes", sview() + "|" + groupKey(s), true);
    toast(`已保存方案「${s.name}」${r.bind ? "。进入这个聊天时将自动切换到它" : ""}`, "success");
    render();
  }
  // 编辑菜单：做完一项回到菜单，方便接着改；点别处或删除后才关掉
  async function editScheme(s) {
    while (allSchemes().includes(s)) {
      const conn = schemeConn(s);
      const bind = bindingNow();
      const anchor = schemesBox.querySelector(`.cw-scheme[data-id="${CSS.escape(s.id)}"] [data-act="sedit"]`) || recentAnchor();
      const v = await pickBox(s.name, [
        { label: "重命名", value: "rename" },
        { label: "用现在的状态覆盖", sub: "更新条目开关，人设和 API 可选", value: "update" },
        { label: "人设", sub: s.persona ? `现在：${s.personaName || s.persona}` : "现在：未记录，切换时人设不变", value: "persona" },
        { label: "API 和模型", sub: conn ? `现在：${connLabel(conn)}` : "现在：未记录，切换时 API 不变", value: "site" },
        { label: "条目开关的保存范围", sub: s.scope === "all" ? "现在：全部条目" : `现在：${s.scope.length} 个分组`, value: "scope" },
        { label: "自动套用", sub: bind?.id === s.id ? `现在：${bind.scope === "chat" ? "进入这个聊天时" : "进入这个角色的聊天时"}` : "现在：不自动套用", value: "bind" },
        { label: "改归属角色", sub: `现在：${charNameOf(schemeCharKey(s))}`, value: "char" },
        { sep: true },
        { label: "删除方案", sub: "预设不受影响", value: "del", danger: true }
      ], { anchor });
      if (!v) break;
      if (v === "rename") {
        const b = schemesBox.querySelector(`.cw-scheme[data-id="${CSS.escape(s.id)}"] .cw-scheme-name > b`);
        const n = b ? await inlineEdit(b, s.name) : await promptBox("方案名称", s.name);
        if (n) { s.name = n; saveSettings(); }
        break;
      }
      await schemeAction(s, v);
      render();
    }
    render();
  }
  async function schemeAction(s, v) {
    if (v === "update") {
      let d;
      try { d = getDraft(s.preset); } catch (e) { return toast(e.message, "error"); }
      const nowConn = liveConn();
      const cur = schemeConn(s);
      const persona = currentPersona();
      const personaName = persona ? listPersonas().find((p) => p.avatar === persona)?.name || persona : "";
      const r = await dialog({ size: "sm", title: "用现在的状态覆盖", body: html`<div class="cw-form"><p class="cw-p">用「${s.preset}」现在的条目开关覆盖方案「${s.name}」？</p>
          ${persona ? html`<label class="cw-check"><input type="checkbox" data-f="persona"${s.persona ? raw(" checked") : ""}><span>人设也换成当前人设（${personaName}）</span></label>` : ""}
          ${nowConn ? html`<label class="cw-check"><input type="checkbox" data-f="api"><span>API 也换成当前连接（${connLabel(nowConn)}）</span></label>` : ""}
          <p class="cw-hint">方案现在记的人设：${s.persona ? s.personaName || s.persona : "未记录"}；API：${cur ? connLabel(cur) : "未记录"}。</p></div>`,
        actions: [{ label: "取消", value: null }, { label: "覆盖", kind: "primary", value: (w) => ({ persona: !!w.querySelector("[data-f=persona]")?.checked, api: !!w.querySelector("[data-f=api]")?.checked }) }] });
      if (!r) return;
      Object.assign(s, schemeStates(d, s));
      if (r.persona && persona) { s.persona = persona; s.personaName = personaName; }
      if (r.api && nowConn) { s.conn = nowConn; s.siteId = nowConn.siteId || null; }
      s.at = Date.now();
      saveSettings();
      toast("方案已更新", "success");
    }
    if (v === "persona") {
      const pp = personaPicker(s.persona || "__none", s.personaName);
      const body = el(html`<div class="cw-form"><p class="cw-hint">切换到这个方案时换成的人设。</p></div>`);
      body.append(pp.el);
      const r = await dialog({ size: "sm", title: "人设", body, noFocus: true, actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: () => pp.read() }] });
      if (!r) return;
      Object.assign(s, r);
      saveSettings();
    }
    if (v === "site") {
      const cur = schemeConn(s);
      const init = !cur ? "__none" : cur.siteId && settings().sites.some((x) => x.id === cur.siteId) ? cur.siteId : "__keep";
      const picker = connPicker(init, cur);
      const body = el(html`<div class="cw-form"><p class="cw-hint">切换到这个方案时连接的 API 和模型。</p></div>`);
      body.append(picker.el);
      const r = await dialog({ size: "sm", title: "API 和模型", body, noFocus: true, actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: () => ({ conn: picker.read() }) }] });
      if (!r) return;
      s.conn = r.conn;
      s.siteId = r.conn?.siteId || null;
      saveSettings();
    }
    if (v === "scope") {
      let d;
      try { d = getDraft(s.preset); } catch (e) { return toast(`读不到预设「${s.preset}」：${e.message}`, "error"); }
      const gs = d.groups.groups;
      const r = await dialog({ title: "条目开关的保存范围", size: "md", body: html`<div class="cw-form"><p class="cw-hint">修改范围后，按「${s.preset}」当前的开关重新保存。</p>
          <label class="cw-check"><input type="radio" name="cw-scope2" value="groups"${s.scope !== "all" ? raw(" checked") : ""}${gs.length ? "" : raw(" disabled")}><span>只保存勾选的分组</span></label>
          <div class="cw-checks cw-checks-indent">${gs.map((g) => html`<label class="cw-check"><input type="checkbox" data-g="${g.id}"${s.scope !== "all" && s.scope.includes(g.id) ? raw(" checked") : ""}><span>${g.name}</span></label>`)}</div>
          <label class="cw-check"><input type="radio" name="cw-scope2" value="all"${s.scope === "all" ? raw(" checked") : ""}><span>保存全部条目（整个预设每条的开关都按方案恢复）</span></label></div>`,
        actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (w) => w.querySelector("input[name=cw-scope2]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g) }] });
      if (!r) return;
      if (Array.isArray(r) && !r.length) return toast("请至少勾选一个分组，或选择保存全部条目", "warning");
      s.scope = r;
      Object.assign(s, schemeStates(d, s));
      s.at = Date.now();
      saveSettings();
      toast("保存范围已更新", "success");
    }
    if (v === "bind") return bindMenu(s);
    if (v === "char") {
      const chars = (ctx().characters || []).filter((x) => x?.avatar);
      const ck = schemeCharKey(s);
      const pick = await pickName({ title: "归到哪个角色卡", current: ck || "__none", extra: { value: "__none", label: "取消归属" }, items: chars.map((x) => ({ value: x.avatar, label: x.name })) });
      if (!pick) return;
      s.charKey = pick === "__none" ? "" : pick;
      saveSettings();
    }
    if (v === "del") {
      if (!await confirmBox("删除方案", `删除「${s.name}」？预设不受影响。`, "删除", true)) return;
      await removeSchemes([s.id]);
    }
  }
  async function removeSchemes(ids) {
    const gone = new Set(ids);
    settings().schemes = allSchemes().filter((x) => !gone.has(x.id));
    const cb = settings().schemeCharBind || {};
    for (const k of Object.keys(cb)) if (gone.has(cb[k])) delete cb[k];
    if (hasChat() && gone.has(chatMeta()[META_KEY])) { delete chatMeta()[META_KEY]; await saveChatMeta(); }
    saveSettings();
  }
  async function bindMenu(s) {
    if (!hasChat()) return toast("请先打开一个聊天");
    const meta = chatMeta();
    const ck = currentCharKey();
    const cname = currentCharName();
    const cur = meta[META_KEY] === s.id ? "chat" : ck && settings().schemeCharBind?.[ck] === s.id ? "char" : "none";
    const v = await pickBox(`「${s.name}」什么时候自动套用`, [
      { label: "进入这个聊天时", sub: "只对当前这个聊天生效", value: "chat", on: cur === "chat" },
      ...(ck ? [{ label: `进入「${cname}」的任何聊天时`, sub: "这个角色的新旧聊天都生效；单个聊天另有绑定时，以聊天的为准", value: "char", on: cur === "char" }] : []),
      { label: "不自动套用", sub: "仅在点击「切换」时切换", value: "none", on: cur === "none" }
    ], { hint: "进入聊天时切换一次。之后手动修改的内容保持不变。" });
    if (!v || v === cur) return;
    if (!settings().schemeCharBind || typeof settings().schemeCharBind !== "object") settings().schemeCharBind = {};
    const cb = settings().schemeCharBind;
    if (meta[META_KEY] === s.id) delete meta[META_KEY];
    if (ck && cb[ck] === s.id) delete cb[ck];
    if (v === "chat") meta[META_KEY] = s.id;
    if (v === "char" && ck) cb[ck] = s.id;
    await saveChatMeta();
    saveSettings();
    markChatHandled();
    toast(v === "none" ? "已取消自动套用" : `已设置：进入${v === "chat" ? "这个聊天" : `「${cname}」的聊天`}时自动切换到「${s.name}」`, "success");
  }
  // ---------- 操作 ----------
  async function connectKey(target, keyId, b = null) {
    const k = siteKey(target, keyId);
    if (b) { b.disabled = true; b.classList.add("cw-busy"); }
    try {
      const v = keyView(target, k.id);
      await applyConnection(v);
      keepKeyId(target, v);
      target.keyId = k.id;
      settings().activeSiteId = target.id;
      saveSettings();
      const live = liveConnection();
      toast(live.online ? `已连接「${target.name}」· ${keyName(target, k)}` : `「${keyName(target, k)}」密钥请求失败（额度用完或已失效）`, live.online ? "success" : "warning");
    } catch (err) {
      toast(`「${keyName(target, k)}」切换失败：${err.message}`, "error");
    }
    return render();
  }
  // 测试：用现在的连接和选中的模型发一句「Hi」，流式收到第一段就算通。不先重新套用站点
  async function testModel(b = null) {
    const c = ctx();
    const svc = c.ChatCompletionService;
    if (typeof svc?.presetToGeneratePayload !== "function") {
      const stBtn = globalThis.jQuery?.("#test_api_button");
      if (stBtn?.length) { stBtn.trigger("click"); return toast("已让酒馆发送测试消息，结果看酒馆弹出的提示", "info"); }
      return toast("这个酒馆版本不能单独发送测试消息，请到酒馆的 API 设置里点「测试消息」", "warning");
    }
    const live = liveConnection();
    const model = usingModel(live);
    if (!model) return toast("还没有选模型", "warning");
    const active = activeSite();
    const k = siteMulti(active) && isSame(active, live) ? siteKey(active) : null;
    if (b) { b.disabled = true; b.classList.add("cw-busy"); }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60e3);
    const base = { model, source: live.source, url: live.url || "", secretId: live.secretId || null };
    try {
      const payload = await svc.presetToGeneratePayload({}, {}, { model, messages: [{ role: "user", content: "Hi" }], stream: true, max_tokens: 300, n: 1 });
      const res = await fetch(stUrl("api/backends/chat-completions/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...c.getRequestHeaders?.() || {} },
        body: JSON.stringify(payload),
        cache: "no-cache",
        signal: controller.signal
      });
      // 酒馆转交流式报错时把 401 改成 400，状态说明还是 Unauthorized
      const status = res.status === 400 && /unauthori[sz]ed/i.test(res.statusText) ? 401 : res.status;
      const first = await firstReply(res);
      controller.abort();
      if (!res.ok || first.error) throw { status, message: first.error || res.statusText };
      liveTest = { ...base, ok: true, text: k ? `${keyName(active, k)} · Successful` : "Successful" };
    } catch (err) {
      const rawText = String(timedOut ? "没有回复" : err?.message || "");
      const why = explainApiError(errStatus(err?.status, rawText), rawText);
      liveTest = { ...base, ok: false, text: k ? `${keyName(active, k)} · ${why}` : why, raw: rawText };
    } finally {
      clearTimeout(timer);
    }
    return render();
  }
  async function editSite(site) {
    const r = await editSiteDialog(site, { onSaved: async (s, { newBalance, rekeyed }) => {
      render();
      if (newBalance) querySite(s).catch((e) => console.warn("[焦香鸡翅] 查余额失败", e));
      // 改的是当前连接的站点、又存了新密钥：换上新密钥并重新连接
      if (settings().activeSiteId === s.id && rekeyed) {
        try {
          await applyConnection(siteMulti(s) ? keyView(s, s.keyId) : s);
          const on = liveConnection().online;
          toast(on ? "已保存，已用新密钥重新连接" : "已保存，用新密钥重新连接未成功，请检查网址和密钥", on ? "success" : "warning");
        } catch (e) {
          toast("已保存，但没能换上新密钥：" + e.message, "error");
        }
        render();
      }
    } });
    if (r === "del") return act("del", site);
  }
  async function act(a, site, b = null, from = null) {
    if (a === "livemore") { foldSet("live", "detail", !liveOpen()); return renderLive(); }
    if (a === "reasoningclear") {
      if (!await confirmBox("清除推理格式记录", "清除所有预设记住的推理格式？当前酒馆设置不变。", "清除")) return;
      settings().reasoningByPreset = {};
      if (reasoningFollowOn()) rememberReasoning();
      saveSettings();
      return renderOpts();
    }
    if (a === "reasoningedit" || a === "reasoningadd") {
      let name = from?.closest(".cw-rrow")?.dataset.name;
      if (a === "reasoningadd") {
        const store = reasoningStore();
        const items = listPresets().filter((n) => n !== reasoningPreset && !store[n]).map((n) => ({ value: n }));
        if (!items.length) return toast("所有预设都已有记录", "info");
        name = await pickName({ title: "给哪个预设设置推理格式", items });
        if (!name) return;
      }
      const cur = name === reasoningPreset;
      const init = cur ? reasoningNow() : reasoningStore()[name] || reasoningNow();
      if (!init) return toast("酒馆没有「推理内容格式化」设置", "warning");
      const r = await editReasoning(name, init, cur);
      if (!r) return;
      reasoningStore()[name] = r;
      if (cur) applyReasoning(r);
      saveSettings();
      toast(cur ? "已改酒馆现在的推理格式" : `已保存「${name}」的推理格式`, "success");
      return renderOpts();
    }
    if (a === "reasoningdel") {
      const name = from?.closest(".cw-rrow")?.dataset.name;
      if (!name || !await confirmBox("删除推理格式记录", `删除「${name}」记住的推理格式？切到它时将保持当时的设置。`, "删除", true)) return;
      delete reasoningStore()[name];
      saveSettings();
      return renderOpts();
    }
    if (a === "sitefold") { foldSet("sites", site.id, !foldGet("sites", site.id)); return renderSites(); }
    // 多密钥站点正在用：选模型时一并选分组，换了分组就换密钥重新连接
    if (a === "livemodel") {
      const live = liveConnection();
      const active = activeSite();
      if (siteMulti(active) && isSame(active, live)) {
        const k0 = siteKey(active);
        const r = await pickKeyModel(active, { keyId: k0.id, model: live.model });
        if (!r) return render();
        const k = siteKey(active, r.keyId);
        k.model = r.model;
        if (k === k0) {
          setLiveModel(r.model);
          saveSettings();
          toast(`模型已切换为 ${r.model}`, "success");
          return render();
        }
        return connectKey(active, k.id, b);
      }
      const target = active;
      const m = await pickModel(liveModelList(live), live.model, { site: target || null });
      if (!m) return;
      if (target) siteKey(target).model = m;
      setLiveModel(m);
      saveSettings();
      toast(`模型已切换为 ${m}`, "success");
      return render();
    }
    if (a === "balance") {
      const live = liveConnection();
      const active = activeSite();
      const same = isSame(active, live);
      const t = liveBalTarget(live, active, same ? siteKey(active) : null, same);
      if (t?.owner && active.manualBalance) await querySite(active);
      else if (t) await queryBalance(t.site, t.id, t.owner);
      return;
    }
    if (a === "balanceset") {
      const x = activeSite();
      if (!x) return;
      if (x.manualBalance) {
        const how = await pickBox(`「${x.name}」的账户余额`, [{ label: "改余额", sub: "充值后填网站上现在的余额", value: "edit" }, { label: "不再手填", sub: "改回显示查到的结果", value: "clear" }], { anchor: b });
        if (!how) return;
        if (how === "clear") {
          await setManualBalance(x, null);
          return toast(`「${x.name}」不再手填余额`, "success");
        }
      }
      const rawAmount = await promptBox(`「${x.name}」的账户余额`, x.manualBalance ? String(x.manualBalance.amount) : "", "网站上显示的余额，如 50");
      if (rawAmount == null) return;
      const n = balanceParseAmount(rawAmount);
      if (n == null) return toast("请填一个金额，如 50 或 12.5", "error");
      await setManualBalance(x, n);
      return toast(`「${x.name}」的账户余额记为 ${balanceMoney(n)}，之后按站点查到的用量扣减`, "success");
    }
    // 逐个查全部站点（多密钥站点逐个分组）的余额；官方接口不提供的跳过
    if (a === "balanceall") {
      if (b) { b.disabled = true; b.classList.add("cw-spin"); }
      let ok = 0, bad = 0, skip = 0;
      for (const x of [...sites()]) {
        for (const k of siteMulti(x) ? x.keys : [x]) {
          const target = keyView(x, k.id);
          if (balancePlan(target).none) { skip++; continue; }
          await queryBalance(target, balanceId(x, k), { siteId: x.id, k });
          if (balanceGet(balanceId(x, k))?.ok) ok++;
          else bad++;
        }
      }
      toast([`已查 ${ok} 个余额`, bad && `${bad} 个没查到`, skip && `${skip} 个官方接口不提供`].filter(Boolean).join("，"), bad ? "warning" : "success");
      return render();
    }
    if (a === "livefetch") {
      const live = liveConnection();
      const active = activeSite();
      const same = isSame(active, live);
      if (live.source === "custom" && !live.url) return toast("当前连接没有网址", "warning");
      if (b) { b.disabled = true; b.classList.add("cw-spin"); }
      if (same && siteMulti(active)) {
        const { bad } = await siteFetchAllKeys(active);
        saveSettings();
        const n = new Set(active.keys.flatMap((k) => k.models || [])).size;
        if (bad.length) toast(siteKeyFailText(bad), "warning");
        if (bad.length < active.keys.length) toast(n ? `已拉取 ${n} 个模型，点模型按钮选择` : "站点未返回模型，可点模型按钮手动填写", n ? "success" : "warning");
        return render();
      }
      try {
        const models = await siteModels(same ? active : { name: "当前连接", source: live.source, url: live.url || "", secretId: live.secretId });
        liveFetched = { source: live.source, url: live.url || "", models };
        if (same) { active.models = models; saveSettings(); }
        toast(models.length ? `已拉取 ${models.length} 个模型，点模型按钮选择` : "站点未返回模型，可点模型按钮手动填写", models.length ? "success" : "warning");
      } catch (err) {
        toast("拉取失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "keepmodel") {
      const t = activeSite();
      const m = liveConnection().model;
      if (t && m) {
        siteKey(t).model = m;
        saveSettings();
        toast(`站点「${t.name}」的模型已改为 ${m}`, "success");
      }
      return render();
    }
    if (a === "new") return editSite(null);
    if (a === "sitesedit" || a === "sitesdone") {
      editing = a === "sitesedit";
      renderSites();
      sitesBox.querySelector(editing ? '[data-act="sitesdone"]' : '[data-act="sitesedit"]')?.focus({ preventScroll: true });
      return;
    }
    if (a === "exportsites") return exportSites(b);
    if (a === "edit") return editSite(site);
    if (a === "del") {
      if (!site) return;
      const users = settings().schemes.filter((sc) => schemeConn(sc)?.siteId === site.id);
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库中的密钥不会删除。${users.length ? `${users.length} 个方案使用此站点，将保留其网址、模型和密钥记录。` : ""}`, "删除", true)) return;
      users.forEach((sc) => { sc.conn = { ...schemeConn(sc), siteId: null }; delete sc.siteId; });
      settings().sites = sites().filter((x) => x.id !== site.id);
      if (settings().activeSiteId === site.id) settings().activeSiteId = null;
      saveSettings();
      return render();
    }
    if (a === "testmodel") return testModel(b);
    if (a === "testraw") return liveTest?.raw && toast(`原文：${liveTest.raw.length > 300 ? liveTest.raw.slice(0, 300) + "…" : liveTest.raw}`, "info");
    if (a === "use") {
      const target = site;
      if (siteMulti(target)) return connectKey(target, from?.closest("[data-k]")?.dataset.k, b);
      if (b) { b.disabled = true; b.querySelector("span").textContent = "连接中…"; }
      try {
        await applyConnection(target);
        settings().activeSiteId = target.id;
        saveSettings();
        const live = liveConnection();
        toast(live.online ? `已连接「${target.name}」` : "已切换，未连接成功，请检查网址和密钥", live.online ? "success" : "warning");
      } catch (err) {
        toast("切换失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "capture") {
      await readSecretState();
      const live = liveConnection();
      if (!SOURCES[live.source]) return toast("暂不支持保存当前连接类型", "warning");
      const s = { id: uid(), name: `${SOURCES[live.source].label.split("（")[0]}${live.url ? " " + hostOf(live.url) : ""}`, source: live.source, url: live.url || "", model: live.model || "", models: customModelOptions(), secretId: live.secretId, keyMask: live.secretMask, note: "" };
      sites().push(s);
      settings().activeSiteId = s.id;
      saveSettings();
      toast("已保存为站点", "success");
      render();
    }
  }
  // ---------- 事件 ----------
  page.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-import-sites]")) {
      const file = t.files?.[0];
      t.value = "";
      if (file) importSites(file).then(render);
      return;
    }
    const a = t.dataset.act;
    if (a === "chattoast") { settings().chatToast = t.checked; saveSettings(); }
    if (a === "reasoningfollow") {
      settings().reasoningFollowPreset = t.checked;
      // 打开时先记下当前预设现在的推理格式
      if (t.checked) { initReasoningFollow(); rememberReasoning(); }
      saveSettings();
      renderOpts();
    }
  });
  page.addEventListener("click", async (e) => {
    // 方案
    const sv = e.target.closest("[data-s]")?.dataset.s;
    if (sv === "new") return saveNewScheme();
    if (sv === "pickon" || sv === "pickoff") { picking = sv === "pickon"; picked.clear(); return renderSchemes(); }
    if (sv === "delpicked") {
      const names = allSchemes().filter((x) => picked.has(x.id)).map((x) => `「${x.name}」`);
      if (!names.length) return;
      if (!await confirmBox("删除方案", `删除 ${names.length} 个方案：${names.slice(0, 6).join("、")}${names.length > 6 ? " 等" : ""}？预设不受影响。`, "删除", true)) return;
      await removeSchemes([...picked]);
      picking = false;
      picked.clear();
      toast(`已删除 ${names.length} 个方案`, "success");
      return renderSchemes();
    }
    if (sv === "view") {
      const v = await pickName({ title: "方案按什么分组", current: sview(), search: false, items: SVIEWS.map(([k, l]) => ({ value: k, label: l })) });
      if (!v) return;
      settings().schemeView = v;
      saveSettings();
      return renderSchemes();
    }
    const actEl = e.target.closest("[data-act]");
    const a = actEl?.dataset.act;
    if (!a) return;
    if (e.target.closest(".cw-schemes")) {
      if (a === "pickgroup") {
        const k = e.target.closest(".cw-sgroup").dataset.k;
        const ids = allSchemes().filter((x) => String(groupKey(x)) === k).map((x) => x.id);
        for (const id of ids) e.target.checked ? picked.add(id) : picked.delete(id);
        if (e.target.checked) foldSet("schemes", sview() + "|" + k, true);
        return renderSchemes();
      }
      if (a === "pick") {
        const id = e.target.closest(".cw-scheme").dataset.id;
        e.target.checked ? picked.add(id) : picked.delete(id);
        return renderSchemes();
      }
      if (a === "sfold") {
        const sec = e.target.closest(".cw-sgroup");
        foldSet("schemes", sview() + "|" + sec.dataset.k, !sec.classList.contains("is-open"));
        return renderSchemes();
      }
      const s = allSchemes().find((x) => x.id === e.target.closest(".cw-scheme")?.dataset.id);
      if (!s) return;
      if (a === "apply") {
        await applyScheme(s);
        setFocusPreset(s.preset);
        return render();
      }
      if (a === "sedit") return editScheme(s);
      return;
    }
    if (a === "chattoast" || a === "reasoningfollow") return;
    const site = sites().find((x) => x.id === e.target.closest("[data-id]")?.dataset.id);
    return act(a, site, actEl.closest("button"), e.target);
  });
  page.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-act=testraw]")) { e.preventDefault(); e.target.click(); }
  });
  bindFileKeys(page);
  // ---------- 站点排序：按住把手拖动（各行让位，靠近边缘自动滚动，松手保存）；键盘上下方向键 ----------
  const still = () => reducedMotion();
  function slideFrom(rows, tops, ms = 180) {
    if (still()) return;
    for (const x of rows) {
      const dy = (tops.get(x.dataset.id) ?? x.offsetTop) - x.offsetTop;
      if (dy) x.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: ms, easing: "cubic-bezier(.23,1,.32,1)" });
    }
  }
  function saveOrder(ids) {
    const old = sites().map((x) => x.id).join("\n");
    sites().sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (sites().map((x) => x.id).join("\n") !== old) saveSettings();
  }
  sitesBox.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".cw-site-grip");
    if (!grip || e.button > 0) return;
    e.preventDefault();
    const row = grip.closest(".cw-site");
    const list = row.parentElement;
    const rows = [...list.children];
    const from = rows.indexOf(row);
    const scroller = row.closest(".cw-body");
    const tops = rows.map((x) => x.offsetTop);
    const hs = rows.map((x) => x.offsetHeight);
    const mids = rows.map((x, i) => tops[i] + hs[i] / 2);
    const gap = rows.length > 1 ? Math.max(0, tops[1] - tops[0] - hs[0]) : 0;
    const step = hs[from] + gap;
    const minDy = tops[0] - tops[from];
    const maxDy = tops.at(-1) + hs.at(-1) - hs[from] - tops[from];
    const box = scroller?.getBoundingClientRect();
    const scroll0 = scroller?.scrollTop || 0;
    const y0 = e.clientY;
    const shift = rows.map(() => 0);
    let y = y0, frame = 0, dy = 0, to = from, alive = true;
    dragging = true;
    list.classList.add("is-sorting");
    row.classList.add("is-drag");
    grip.setPointerCapture?.(e.pointerId);
    const update = () => {
      frame = 0;
      if (!alive) return;
      const near = scroller && box ? (y < box.top + 48 && y < y0 ? -1 : y > box.bottom - 48 && y > y0 ? 1 : 0) : 0;
      if (near) scroller.scrollTop += near < 0 ? -Math.min(14, (box.top + 48 - y) / 3) : Math.min(14, (y - box.bottom + 48) / 3);
      dy = Math.max(minDy, Math.min(maxDy, y - y0 + (scroller ? scroller.scrollTop - scroll0 : 0)));
      const mid = mids[from] + dy;
      to = from;
      rows.forEach((x, i) => {
        const s = i < from && mid <= mids[i] ? step : i > from && mid >= mids[i] ? -step : 0;
        if (s > 0) to--;
        if (s < 0) to++;
        if (i !== from && s !== shift[i]) { shift[i] = s; x.style.transform = s ? `translateY(${s}px)` : ""; }
      });
      row.style.transform = `translateY(${dy}px)`;
      if (near) frame = requestAnimationFrame(update);
    };
    const move = (ev) => { y = ev.clientY; if (!frame) frame = requestAnimationFrame(update); };
    const up = (ev) => {
      cancelAnimationFrame(frame);
      if (ev?.clientY != null) y = ev.clientY;
      update();
      cancelAnimationFrame(frame);
      alive = false;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      const ids = rows.map((x) => x.dataset.id);
      const [id] = ids.splice(from, 1);
      ids.splice(to, 0, id);
      const seen = new Map([[id, tops[from] + dy]]);
      dragging = false;
      saveOrder(ids);
      renderSites();
      const now = sitesBox.querySelector(`.cw-site[data-id="${CSS.escape(id)}"]`);
      if (now) { slideFrom([now], seen, 160); now.classList.add("cw-flash"); }
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  sitesBox.addEventListener("keydown", (e) => {
    const grip = e.target.closest?.(".cw-site-grip");
    if (!grip || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const id = grip.closest(".cw-site").dataset.id;
    const ids = sites().map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    const list = grip.closest(".cw-sites");
    const tops = new Map([...list.children].map((x) => [x.dataset.id, x.offsetTop]));
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(ids);
    renderSites();
    const moved = [ids[i], ids[j]].map((x) => sitesBox.querySelector(`.cw-site[data-id="${CSS.escape(x)}"]`)).filter(Boolean);
    slideFrom(moved, tops);
    sitesBox.querySelector(`.cw-site[data-id="${CSS.escape(id)}"] .cw-site-grip`)?.focus();
  });
  function render() {
    if (page.hidden) return;
    renderLive();
    renderSchemes();
    renderSites();
    renderOpts();
  }
  cleanups.push(onDraftChange((name, kind) => { if (kind !== "status" && !page.hidden) renderSchemes(); }));
  return { render };
}
