function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "";
  }
}
// 1.4.0：模型选择框。系统下拉框在平板上又宽又长，改为带搜索的列表，高度限制在屏幕内
async function pickModel(list, cur, { title = "选择模型" } = {}) {
  const all = [...new Set([cur, ...list].filter(Boolean))];
  const body = el(`<div class="pa-mpick"><input class="pa-input" type="search" placeholder="搜索，或输入模型名称" autocapitalize="off" autocomplete="off"><div class="pa-mpick-list" role="listbox"></div></div>`);
  const input = body.querySelector("input");
  const box = body.querySelector(".pa-mpick-list");
  let picked = null;
  const paint = () => {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const hits = all.filter((m) => !ql || m.toLowerCase().includes(ql));
    const custom = q && !all.includes(q) ? `<button class="pa-mpick-item pa-mpick-custom" data-m="${esc(q)}">使用「${esc(q)}」</button>` : "";
    box.innerHTML = custom + hits.map((m) => `<button class="pa-mpick-item${m === cur ? " on" : ""}" data-m="${esc(m)}">${esc(m)}${m === cur ? " ✓" : ""}</button>`).join("") || '<p class="pa-hint">没有匹配的模型，可直接输入名称</p>';
  };
  input.addEventListener("input", paint);
  paint();
  await sheet({ title: `${title}（${all.length}）`, body, noFocus: true, actions: [{ label: "取消", value: null }], onMount: (w) => {
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-m]");
      if (!b) return;
      picked = b.dataset.m;
      w.querySelector(".pa-sheet-x").click();
    });
    w.querySelector(".pa-mpick-item.on")?.scrollIntoView({ block: "center" });
  } });
  return picked;
}
// 2.5.0 多密钥站点的模型选择：选模型时一并选分组（密钥）。
// 「按模型」每个模型列一次，后面标出哪些分组有它，点模型名用排在上面的分组，点标签换；标签超过 2 个时收成「+N」。
// 「按分组」一个分组一段，只展开第一段，搜索时全部展开。选哪种记在站点上。cur：{ keyId, model }
async function pickKeyModel(site, cur, { title = "选择模型" } = {}) {
  const keys = site.keys;
  const kname = (k) => keyName(site, k);
  const curKey = cur?.keyId || null;
  const curModel = cur?.model || "";
  let mode = site.modelView === "group" ? "group" : "model";
  const secOpen = new Set([keys[0].id]);
  const more = new Set();
  const all = [...new Set(keys.flatMap((k) => k.models || []))];
  // 每个模型有哪些分组：先算好，搜索时不再逐个分组查（中转站动辄几百个模型）
  const ownersOf = new Map(all.map((m) => [m, []]));
  for (const k of keys) for (const m of new Set(k.models || [])) ownersOf.get(m).push(k);
  const body = el(`<div class="pa-mpick">
      <div class="pa-seg pa-seg-s pa-kview" role="tablist" aria-label="模型显示方式"><button type="button" data-v="model" role="tab">按模型</button><button type="button" data-v="group" role="tab">按分组</button></div>
      <input class="pa-input" type="search" placeholder="搜索，或输入模型名称" autocapitalize="off" autocomplete="off"><div class="pa-mpick-list pa-kpick" role="listbox"></div></div>`);
  const input = body.querySelector("input");
  const box = body.querySelector(".pa-mpick-list");
  let picked = null;
  const chip = (m, k) => {
    const on = m === curModel && k.id === curKey;
    return `<button type="button" class="pa-kchip${on ? " on" : ""}" data-m="${esc(m)}" data-k="${esc(k.id)}" aria-pressed="${on}">${esc(kname(k))}</button>`;
  };
  const paint = () => {
    body.querySelectorAll(".pa-kview button").forEach((b) => {
      b.classList.toggle("on", b.dataset.v === mode);
      b.setAttribute("aria-selected", b.dataset.v === mode);
    });
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const hit = (m) => !ql || m.toLowerCase().includes(ql);
    const known = all.includes(q);
    if (mode === "model") {
      const custom = q && !known ? `<button class="pa-mpick-item pa-mpick-custom" data-m="${esc(q)}" data-k="${esc(keys[0].id)}">使用「${esc(q)}」</button>` : "";
      const rows = all.filter(hit).map((m) => {
        const owners = ownersOf.get(m);
        const on = m === curModel;
        let tail;
        if (owners.length <= 2) tail = owners.map((k) => chip(m, k)).join("");
        else if (more.has(m)) tail = `<button type="button" class="pa-kmore" data-more="${esc(m)}" aria-expanded="true">收起</button><div class="pa-kall">${owners.map((k) => chip(m, k)).join("")}</div>`;
        else {
          const shown = owners.find((k) => on && k.id === curKey) || owners[0];
          tail = chip(m, shown) + `<button type="button" class="pa-kmore" data-more="${esc(m)}" aria-expanded="false" aria-label="还有 ${owners.length - 1} 个分组">+${owners.length - 1}</button>`;
        }
        return `<div class="pa-krow${on ? " on" : ""}"><button type="button" class="pa-kname" data-m="${esc(m)}" data-k="${esc(owners[0].id)}">${esc(m)}${on ? " ✓" : ""}</button>${tail}</div>`;
      }).join("");
      box.innerHTML = custom + rows || '<p class="pa-hint">没有匹配的模型，可直接输入名称</p>';
    } else {
      box.innerHTML = keys.map((k) => {
        const ms = (k.models || []).filter(hit);
        const open = !!q || secOpen.has(k.id);
        const custom = q && !(k.models || []).includes(q) ? `<button class="pa-mpick-item pa-mpick-custom" data-m="${esc(q)}" data-k="${esc(k.id)}">使用「${esc(q)}」</button>` : "";
        const items = ms.map((m) => {
          const on = m === curModel && k.id === curKey;
          return `<button class="pa-mpick-item${on ? " on" : ""}" data-m="${esc(m)}" data-k="${esc(k.id)}">${esc(m)}${on ? " ✓" : ""}</button>`;
        }).join("");
        const empty = !ms.length && !custom ? `<p class="pa-hint">${(k.models || []).length ? "没有匹配的模型" : "还没有模型列表，可在搜索框输入模型名称"}</p>` : "";
        return `<button type="button" class="pa-ksec" data-fold="${esc(k.id)}" aria-expanded="${open}"><span class="pa-sgcaret">${open ? "▾" : "▸"}</span><b>${esc(kname(k))}</b>${k.keyMask ? `<small>${esc(k.keyMask)}</small>` : ""}<span class="pa-ksec-n">${(k.models || []).length}</span></button>${open ? custom + items + empty : ""}`;
      }).join("");
    }
  };
  // 模型多时逐字重画会卡：停顿一下再画
  let typing = null;
  input.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(paint, all.length > 150 ? 120 : 0);
  });
  paint();
  await sheet({ title: `${title}（${all.length}）`, body, noFocus: true, actions: [{ label: "取消", value: null }], onMount: (w) => {
    body.querySelector(".pa-kview").addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b || b.dataset.v === mode) return;
      mode = b.dataset.v;
      site.modelView = mode;
      saveSettings();
      paint();
    });
    box.addEventListener("click", (e) => {
      const mo = e.target.closest("[data-more]");
      if (mo) {
        more.has(mo.dataset.more) ? more.delete(mo.dataset.more) : more.add(mo.dataset.more);
        return paint();
      }
      const f = e.target.closest("[data-fold]");
      if (f) {
        secOpen.has(f.dataset.fold) ? secOpen.delete(f.dataset.fold) : secOpen.add(f.dataset.fold);
        return paint();
      }
      const b = e.target.closest("[data-m]");
      if (!b) return;
      let k = b.dataset.k;
      // 按模型：点的是已选中的模型名，保留现在的分组
      if (b.classList.contains("pa-kname") && b.dataset.m === curModel && (ownersOf.get(curModel) || []).some((x) => x.id === curKey)) k = curKey;
      picked = { model: b.dataset.m, keyId: k };
      w.querySelector(".pa-sheet-x").click();
    });
    box.querySelector(".pa-krow.on, .pa-mpick-item.on")?.scrollIntoView({ block: "center" });
  } });
  return picked;
}
// arrow：有模型列表可选时才显示 ▾（2.4.1 当前连接拉取到列表后才出现）
// key：多密钥站点当前分组的名称，跟在模型名后面
const modelBtn = (cur, attr, arrow = true, key = "") => `<button class="pa-model-btn" ${attr} title="${esc([cur, key].filter(Boolean).join(" · "))}"><span>${esc(cur || "选择模型")}</span>${key ? `<em class="pa-chip pa-chip-cot pa-model-key">${esc(key)}</em>` : ""}${arrow ? "<i>▾</i>" : ""}</button>`;
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
// live：这是当前预设、跟随开着，保存即改酒馆现在的设置
async function editReasoning(name, init, live) {
  const base = { ...(reasoningNow() || {}), ...init };
  const has = (k) => base[k] !== undefined;
  const tpls = reasoningTemplates();
  if (has("name") && base.name && !tpls.some((t) => t.name === base.name)) tpls.unshift({ name: base.name });
  const text = (k, label) => has(k) ? `<label class="pa-field"><span>${label}<i class="pa-rws"></i></span><textarea class="pa-input pa-rtext" data-k="${k}" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></label>` : "";
  const body = el(`<div class="pa-form">
      <p class="pa-hint">${live ? "当前预设：保存后立即改酒馆「推理内容格式化」的设置。" : "切到这个预设时套用。"}</p>
      ${has("name") ? `<label class="pa-field"><span>模板</span>${tpls.length ? `<select class="pa-select" data-k="name">${tpls.map((t) => `<option value="${esc(t.name)}"${t.name === base.name ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : `<input class="pa-input" data-k="name" value="${esc(base.name)}">`}</label>` : ""}
      ${text("prefix", "前缀")}${text("suffix", "后缀")}${text("separator", "分隔符")}
      <div class="pa-rflags">${REASONING_FLAGS.filter(([k]) => has(k)).map(([k, label]) => `<label class="pa-inline-check"><input type="checkbox" data-k="${k}"${base[k] ? " checked" : ""}> ${label}</label>`).join("")}</div>
      ${has("max_additions") ? `<label class="pa-field"><span>添加到提示词的最大条数</span><input class="pa-input" type="number" min="0" max="999" step="1" inputmode="numeric" data-k="max_additions" value="${esc(base.max_additions)}"></label>` : ""}
    </div>`);
  // 只有换行或空格时框里看着是空的，在标题旁标出来
  const mark = (t) => { t.closest(".pa-field").querySelector(".pa-rws").textContent = t.value && !t.value.trim() ? `（${showBreaks(t.value).replace(/ /g, "␣")}）` : ""; };
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
      if (box && typeof t?.[k] === "string") {
        box.value = t[k];
        mark(box);
      }
    }
  });
  return sheet({
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
// liveBox：当前连接；sitesBox：站点列表；optsBox：两个选项（「方案」页把方案放在当前连接和选项之间）
function mountApi(liveBox, sitesBox, optsBox = sitesBox) {
  const sites = () => settings().sites;
  // 2.4.0：底部选项行点开的（只在面板打开期间记住）
  const optOpen = /* @__PURE__ */ new Set();
  // 2.5.0：点开的多密钥站点（只在面板打开期间记住）
  const siteOpen = /* @__PURE__ */ new Set();
  const shortLabel = (source) => (SOURCES[source]?.label || source || "—").split("（")[0];
  // 2.4.1：当前连接还没存成站点时，拉取到的模型列表先记在这里（面板打开期间）
  let liveFetched = null;
  const isSame = (site, live) => !!site && site.source === live.source && (site.source !== "custom" || (site.url || "") === (live.url || ""));
  // 当前连接可选的模型：酒馆下拉框里的、站点记的、刚拉取到的
  function liveModelList(live = liveConnection()) {
    const active = sites().find((x) => x.id === settings().activeSiteId);
    const fetched = liveFetched && liveFetched.source === live.source && liveFetched.url === (live.url || "") ? liveFetched.models : [];
    return [...new Set([...liveModelOptions(), ...isSame(active, live) ? siteKey(active).models || [] : [], ...fetched])];
  }
  function render() {
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    // 使用中的站点只同步可选的模型列表；在酒馆里临时换的模型不悄悄写进站点，由用户决定要不要记下
    const sameSite = isSame(active, live);
    // 2.5.0 多密钥站点：在酒馆里换了密钥、正好是这个站点的另一个分组，跟着记过去
    if (sameSite && siteMulti(active) && live.secretId && siteKey(active).secretId !== live.secretId) {
      const k = active.keys.find((x) => x.secretId === live.secretId);
      if (k) {
        active.keyId = k.id;
        saveSettings();
      }
    }
    const ak = sameSite ? siteKey(active) : null;
    // 多密钥站点不从酒馆下拉框同步：刚换密钥时下拉框里可能还是上一个分组的列表，各分组的模型以「拉取」为准
    if (ak && !siteMulti(active) && liveModels.length && JSON.stringify(ak.models || []) !== JSON.stringify(liveModels)) {
      ak.models = liveModels;
      saveSettings();
    }
    const modelDiff = ak && live.model && ak.model && live.model !== ak.model;
    const usedBy = (id) => [...new Set(settings().schemes.filter((sc) => schemeConn(sc)?.siteId === id).map((sc) => sc.preset))];
    const dot = `<span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span>`;
    // 2.4.0：当前连接只留名称、网址、模型；类型、密钥、备注和操作收进 ⋯
    // 2.4.1：模型旁放「拉取」（中转站）和「测试」；拉取到列表后模型框才出现 ▾
    const sub = live.url || src?.label || "";
    liveBox.innerHTML = `<div class="pa-row-head"><h3 class="pa-h">当前连接</h3></div>
        <article class="pa-card pa-site pa-site-on pa-live"${active ? ` data-id="${esc(active.id)}"` : ""}>
            <header>${dot}<b>${esc(active ? active.name : shortLabel(live.source))}</b>${active ? "" : '<button class="pa-chip pa-chip-dim pa-chip-btn" data-a="capture" title="保存为站点">未保存为站点</button>'}<button class="pa-icon-btn pa-live-more" data-a="livemore" aria-label="连接详情" title="连接详情">⋯</button></header>
            ${sub ? `<div class="pa-live-url" title="${esc(sub)}">${esc(sub)}</div>` : ""}
            <div class="pa-live-model">${modelBtn(live.model, 'data-a="livemodel"', liveModelList(live).length > 0 || !!ak && siteMulti(active), ak ? keyName(active, ak) : "")}${live.source === "custom" ? `<button class="pa-icon-btn pa-live-fetch" data-a="livefetch" type="button" aria-label="拉取模型列表" title="拉取模型列表">${ICON.refresh}</button>` : ""}<button class="pa-icon-btn pa-live-test" data-a="reconnect" type="button" aria-label="测试连接" title="测试连接">${ICON.bolt}</button></div>
            ${modelDiff ? `<p class="pa-hint pa-live-diff">站点记的是「${esc(ak.model)}」。切换预设后会换回它。<button class="pa-link" data-a="keepmodel">改记为当前模型</button></p>` : ""}
        </article>`;
    // 2.4.0：站点不分组，每个站点一个独立的框（和方案下面的选项一样）
    const siteRow = (x) => {
      const used = usedBy(x.id);
      const on = x.id === s.activeSiteId;
      if (siteMulti(x)) return multiRow(x, on, used);
      const info = [x.model || "未选模型", x.source === "custom" ? "" : shortLabel(x.source), used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · ");
      return `<div class="pa-sgroup pa-sitecard pa-site${on ? " pa-srow-on" : ""}" data-id="${esc(x.id)}">
            <div class="pa-srow-main pa-site-name" data-a="edit" title="查看、编辑"><b>${esc(x.name)}</b><small class="pa-site-model">${esc(info)}</small></div>
            ${on ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : '<button class="pa-swpill" data-a="use" type="button">切换</button>'}</div>`;
    };
    // 2.5.0 多密钥站点：左边小三角，点开每个分组一行，各有「切换」；折起时小字是当前分组和模型
    const multiRow = (x, on, used) => {
      const open = siteOpen.has(x.id);
      const k = siteKey(x);
      const info = [on ? `${keyName(x, k)} · ${k.model || "未选模型"}` : "", `${x.keys.length} 个分组`, x.source === "custom" ? "" : shortLabel(x.source), used.length ? `用于 ${used.join("、")}` : ""].filter(Boolean).join(" · ");
      const lines = open ? `<div class="pa-klines">${x.keys.map((y) => {
        const cur = on && y.id === k.id;
        return `<div class="pa-kline${cur ? " pa-srow-on" : ""}" data-k="${esc(y.id)}"><div class="pa-srow-main"><b>${esc(keyName(x, y))}</b><small>${esc(y.model || "未选模型")}</small></div>${cur ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : '<button class="pa-swpill" data-a="use" type="button">切换</button>'}</div>`;
      }).join("")}</div>` : "";
      return `<div class="pa-sgroup pa-sitecard pa-site pa-site-multi${on ? " pa-srow-on" : ""}${open ? " open" : ""}" data-id="${esc(x.id)}">
            <div class="pa-site-mhead"><button class="pa-icon-btn pa-site-fold" data-a="sitefold" type="button" aria-expanded="${open}" aria-label="${open ? "收起分组" : "展开分组"}"><span class="pa-sgcaret">${open ? "▾" : "▸"}</span></button>
            <div class="pa-srow-main pa-site-name" data-a="edit" title="查看、编辑"><b>${esc(x.name)}</b><small class="pa-site-model">${esc(info)}</small></div>
            ${on ? '<span class="pa-chip pa-site-on-chip">使用中</span>' : ""}</div>${lines}</div>`;
    };
    const info = (t, d) => `<div class="pa-srow"><div class="pa-srow-main"><b>${t}</b><small>${d}</small></div></div>`;
    const follow = s.reasoningFollowPreset === true;
    const rows = follow ? reasoningRows() : [];
    const kept = Object.keys(s.reasoningByPreset || {}).length;
    const reasoningBody = follow
      ? rows.map(reasoningRow).join("") + '<button class="pa-srow pa-optadd" data-a="reasoningadd" type="button">＋ 给其他预设设置</button>'
      : info("开启后", "离开预设时记下推理格式，切回时恢复") + (kept ? `<div class="pa-srow"><div class="pa-srow-main"><b>已记住 ${kept} 个预设</b></div><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-a="reasoningclear">清除</button></div>` : "");
    sitesBox.innerHTML = `
        <div class="pa-row-head"><h3 class="pa-h">站点${sites().length ? whyBtn("sites") : ""}</h3><button class="pa-btn pa-btn-primary pa-btn-s pa-head-btn" data-a="new">＋ 添加站点</button></div>
        ${sites().length ? `${whyNote("sites", "点站点名查看、编辑完整信息，删除也在里面。")}${sites().map(siteRow).join("")}` : '<p class="pa-empty">暂无站点。点「＋ 添加站点」，或点上方「未保存为站点」保存当前连接。</p>'}`;
    optsBox.innerHTML = `
        ${optCard("chattoast", `<input type="checkbox" data-o="chattoast" aria-label="换角色或聊天时，提示当前预设和模型" ${s.chatToast !== false ? "checked" : ""}>`, "换角色或聊天时，提示当前预设和模型", 0,
          info("换角色或聊天", "弹出当前预设和模型，3 秒后消失") + info("换预设", "API 不变") + info("切换方案", "预设、条目开关、人设一起换；方案记了 API 的也换"))}
        ${optCard("reasoning", `<input type="checkbox" data-o="reasoningfollow" aria-label="切换预设时，同时切换推理格式" ${follow ? "checked" : ""}>`, "切换预设时，同时切换推理格式", rows.length, reasoningBody)}`;
  }
  // 2.4.0 选项行：只有方框管勾选，点这一行其他地方展开
  function optCard(key, check, label, count, body) {
    const on = optOpen.has(key);
    return `<section class="pa-sgroup pa-optgroup${on ? " open" : ""}" data-w="${key}">
        <header class="pa-sghead pa-opthead" data-a="optfold" tabindex="0" aria-expanded="${on}"><label class="pa-optcheck">${check}</label><span class="pa-optlabel">${label}</span>${count ? `<span class="pa-optcount">${count}</span>` : ""}<span class="pa-sgcaret">${on ? "▾" : "▸"}</span></header>
        ${on ? `<div class="pa-sgbody">${body}</div>` : ""}</section>`;
  }
  // 跟随开着时，当前预设的记录就是酒馆现在的设置（离开时会照它记下），所以显示实时值，不给删除
  function reasoningRows() {
    const store = reasoningStore();
    const live = reasoningNow();
    const rows = Object.keys(store).filter((n) => n !== reasoningPreset).sort((a, b) => a.localeCompare(b, "zh")).map((n) => ({ name: n, r: store[n], cur: false }));
    if (reasoningPreset && live) rows.unshift({ name: reasoningPreset, r: live, cur: true });
    return rows;
  }
  // 2.4.0：前缀放进小方框，自动解析用圆点表示；完整设置在悬停提示里
  function reasoningRow(x) {
    const tag = showBreaks(x.r.prefix).trim();
    return `<div class="pa-srow pa-rrow${x.cur ? " pa-srow-on" : ""}" data-name="${esc(x.name)}">
          <div class="pa-srow-main"><b title="${esc(x.name)}">${esc(x.name)}</b>${x.cur ? '<span class="pa-chip">当前</span>' : ""}<small class="pa-rfmt" title="${esc(reasoningSummary(x.r))}"><code class="pa-rtag">${esc(tag || "无前缀")}</code><span class="pa-rauto${x.r.auto_parse ? " on" : ""}">${x.r.auto_parse ? "自动解析" : "不解析"}</span></small></div>
          <button class="pa-btn pa-btn-s" data-a="reasoningedit">修改</button>${x.cur ? "" : '<button class="pa-btn pa-btn-s pa-btn-danger-soft" data-a="reasoningdel">删除</button>'}
        </div>`;
  }
  // ⋯：当前连接的完整信息和操作
  async function liveSheet() {
    const live = liveConnection();
    const active = sites().find((x) => x.id === settings().activeSiteId);
    const source = active ? active.source : live.source;
    const url = active ? active.url : live.url;
    const mask = (x) => x.keyMask || (x.secretId ? "已保存" : "使用当前密钥");
    const ak = active ? siteKey(active) : null;
    const key = active ? siteMulti(active) ? `${keyName(active, ak)}：${mask(ak)}（共 ${active.keys.length} 个分组）` : mask(active) : live.secretMask;
    const body = el(`<dl class="pa-site-dl">
          <dt>类型</dt><dd>${esc(SOURCES[source]?.label || source || "—")}</dd>
          ${url ? `<dt>网址</dt><dd>${esc(url)}</dd>` : ""}
          ${key ? `<dt>密钥</dt><dd>${esc(key)}</dd>` : ""}
          ${active?.note ? `<dt>备注</dt><dd>${esc(active.note)}</dd>` : ""}
        </dl>`);
    // 拉取、测试在模型那一行，这里只留编辑、删除（没存成站点时是保存）
    const actions = active
      ? [{ label: "删除", kind: "danger-soft", value: "del" }, { label: "编辑", kind: "primary", value: "edit" }]
      : [{ label: "保存为站点", kind: "primary", value: "capture" }];
    const a = await sheet({ title: active ? active.name : "当前连接", body, noFocus: true, actions });
    if (a) await act(a, active);
  }
  async function getModels(site) {
    return withSiteKey(site, () => fetchModelList(site));
  }
  // 2.5.0 多密钥站点：每个分组各拉一次模型列表。返回 { ok, bad: [失败的分组名] }
  async function fetchAllKeys(site, keys = site.keys) {
    const bad = [];
    let ok = 0;
    for (const k of keys) {
      try {
        k.models = await getModels(keyView(site, k.id));
        ok++;
      } catch (e) {
        bad.push(keyName(site, k));
        console.warn("[焦香鸡翅] 拉取模型失败", keyName(site, k), e);
      }
    }
    return { ok, bad };
  }
  const failMsg = (site, k) => `「${keyName(site, k)}」密钥请求失败（额度用完或已失效）`;
  // 编辑窗口里的一个密钥：已有的带着密钥库编号、模型；新加的只有编号
  const blankKey = () => ({ id: uid(), name: "", secretId: null, keyMask: "", localKey: false, model: "", models: [] });
  async function editSite(site) {
    const isNew = !site;
    const s = site ? structuredClone(site) : { id: uid(), name: "", source: "custom", url: "", model: "", models: [], secretId: null, keyMask: "", note: "" };
    // 单密钥站点的密钥就是站点自己；进窗口时统一成一组，保存时一个就写回站点上
    let ks = siteMulti(s) ? s.keys : [{ id: uid(), name: "", secretId: s.secretId || null, keyMask: s.keyMask || "", localKey: !!s.localKey, localId: s.localId || (s.localKey || s.legacyKey ? s.id : undefined), legacyKey: s.legacyKey, model: s.model || "", models: s.models || [] }];
    let curKey = siteMulti(s) ? siteKey(s).id : ks[0].id;
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(s.name)}" placeholder="例如：某中转站"></label>
            <label class="pa-field"><span>类型</span><select class="pa-select" data-f="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === s.source ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
            <label class="pa-field" data-show="custom"><span>网址</span><input class="pa-input" data-f="url" value="${esc(s.url)}" placeholder="https://…/v1" inputmode="url" autocapitalize="off"></label>
            <div class="pa-field"><span class="pa-keyhead">密钥<button class="pa-icon-btn pa-key-add" data-f="keyadd" type="button" aria-label="加一个密钥" title="加一个密钥（同一站点的其他分组）">＋</button></span><div class="pa-keys" data-f="keys"></div></div>
            <div class="pa-field"><span>模型</span>${modelBtn(s.model, 'data-f="modelbtn" type="button"')}<input type="hidden" data-f="model" value="${esc(s.model || "")}"></div>
            <button class="pa-btn pa-btn-soft" data-f="fetch" type="button" data-show="custom">获取模型列表</button>
            <label class="pa-field"><span>备注</span><input class="pa-input" data-f="note" value="${esc(s.note || "")}" placeholder="例如：月卡至 11 月"></label>
            <p class="pa-hint">${multiKeySupported() ? "密钥存入酒馆密钥库，本扩展只记录编号。" : "酒馆版本较旧，没有密钥库。密钥只保存在这个浏览器里，不写进酒馆设置文件；换设备、换浏览器需要重新填写。"}</p>
        </div>`);
    const keysBox = body.querySelector("[data-f=keys]");
    const hasKey = (k) => !!(k.secretId || k.localKey || k.legacyKey);
    // 框里还没存的密钥文字，按编号记下（重画密钥行时不丢）
    const typed = new Map();
    const syncTyped = () => {
      keysBox.querySelectorAll(".pa-keyrow").forEach((row) => {
        const k = ks.find((x) => x.id === row.dataset.k);
        if (!k) return;
        typed.set(k.id, row.querySelector("[data-f=key]").value.trim());
        const n = row.querySelector("[data-f=keyname]");
        if (n) k.name = n.value.trim();
      });
    };
    const paintKeys = () => {
      const many = ks.length > 1;
      keysBox.classList.toggle("pa-keys-many", many);
      keysBox.innerHTML = ks.map((k, i) => {
        const ph = hasKey(k) ? (k.keyMask ? `${k.keyMask} · 留空不改` : "不修改请留空") : many ? "粘贴密钥，可多行" : "留空则使用酒馆当前密钥，可多行粘贴";
        const cnt = (k.models || []).length ? `<span class="pa-key-cnt" title="拉取到的模型">✓ ${k.models.length}</span>` : "";
        return `<div class="pa-keyrow" data-k="${esc(k.id)}">
            ${many ? `<span class="pa-key-grip" aria-hidden="true" title="拖动调顺序，排在上面的优先">⋮⋮</span><input class="pa-input pa-key-name" data-f="keyname" value="${esc(k.name)}" placeholder="密钥 ${i + 1}" aria-label="密钥 ${i + 1} 的名称（分组名，可不填）">` : ""}
            <input class="pa-input pa-key-val" data-f="key" type="password" autocomplete="off" placeholder="${ph}" aria-label="${many ? `密钥 ${i + 1}` : "密钥"}" value="${esc(typed.get(k.id) || "")}">
            ${cnt}${many ? `<button class="pa-icon-btn pa-key-del" data-f="keydel" type="button" aria-label="删除这个密钥" title="删除这个密钥">✕</button>` : ""}
          </div>`;
      }).join("");
    };
    paintKeys();
    const sync = (w) => {
      const custom = w.querySelector("[data-f=source]").value === "custom";
      w.querySelectorAll("[data-show=custom]").forEach((x) => {
        x.hidden = !custom;
      });
    };
    const viewSite = () => ({ ...s, keys: ks, keyId: curKey });
    const setModel = (w, m, keyId = curKey) => {
      if (keyId) curKey = keyId;
      const k = ks.find((x) => x.id === curKey) || ks[0];
      k.model = m;
      w.querySelector("[data-f=model]").value = m;
      const b = w.querySelector("[data-f=modelbtn]");
      const kn = ks.length > 1 ? keyName(viewSite(), k) : "";
      b.title = [m, kn].filter(Boolean).join(" · ");
      b.querySelector("span").textContent = m || "选择模型";
      b.querySelector(".pa-model-key")?.remove();
      if (kn) b.querySelector("span").insertAdjacentHTML("afterend", `<em class="pa-chip pa-chip-cot pa-model-key">${esc(kn)}</em>`);
    };
    const readModel = (w) => w.querySelector("[data-f=model]").value.trim();
    const read = (w) => {
      syncTyped();
      return {
        name: w.querySelector("[data-f=name]").value.trim(),
        source: w.querySelector("[data-f=source]").value,
        url: w.querySelector("[data-f=url]").value.trim(),
        model: readModel(w),
        note: w.querySelector("[data-f=note]").value.trim()
      };
    };
    // 这个对话框里存进密钥库的新密钥。取消时删掉；同一个对话框里换过、删掉的，旧的也删掉
    const madeKeys = [];
    const madeLocal = [];
    const localIdOf = (k) => k.localId || (ks.length > 1 || ks[0] !== k ? `${s.id}.${k.id}` : s.id);
    const persistKey = async (k, v) => {
      const text = typed.get(k.id);
      if (!text) return;
      if (multiKeySupported()) {
        const label = ks.length > 1 ? `焦香鸡翅\xB7${v.name || "站点"}\xB7${keyName(viewSite(), k)}` : `焦香鸡翅\xB7${v.name || "站点"}`;
        const id = await storeKey(v.source, text, label);
        madeKeys.push({ source: v.source, id });
        k.secretId = id;
        delete k.legacyKey;
      } else {
        const lid = localIdOf(k);
        if (!setLocalKey(lid, text)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
        madeLocal.push(lid);
        k.localKey = true;
        k.localId = lid;
        delete k.legacyKey;
      }
      k.keyMask = text.length > 8 ? `${text.slice(0, 3)}…${text.slice(-4)}` : "已保存";
      typed.delete(k.id);
    };
    // 多个密钥时，新加了却没填的行不算
    const liveKeys = () => {
      if (ks.length < 2) return ks;
      const hit = ks.filter((k) => hasKey(k) || typed.get(k.id));
      return hit.length ? hit : [ks[0]];
    };
    const r = await sheet({
      title: isNew ? "添加站点" : `编辑「${s.name}」`,
      body,
      wide: true,
      noFocus: !isNew,
      onMount: (w) => {
        sync(w);
        setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
        w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
        w.querySelector("[data-f=keyadd]").addEventListener("click", () => {
          syncTyped();
          ks.push(blankKey());
          paintKeys();
          setModel(w, readModel(w));
          keysBox.querySelector(".pa-keyrow:last-child [data-f=key]")?.focus();
        });
        keysBox.addEventListener("click", (e) => {
          if (!e.target.closest("[data-f=keydel]")) return;
          syncTyped();
          const id = e.target.closest(".pa-keyrow").dataset.k;
          ks = ks.filter((k) => k.id !== id);
          typed.delete(id);
          if (curKey === id) curKey = ks[0].id;
          paintKeys();
          setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
        });
        keysBox.addEventListener("input", (e) => {
          if (e.target.matches("[data-f=keyname]")) {
            syncTyped();
            setModel(w, readModel(w));
          }
        });
        // 一次粘贴多行：一行一个密钥，拆成多行
        keysBox.addEventListener("paste", (e) => {
          const box = e.target.closest("[data-f=key]");
          if (!box) return;
          const lines = (e.clipboardData?.getData("text") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          if (lines.length < 2) return;
          e.preventDefault();
          syncTyped();
          const id = box.closest(".pa-keyrow").dataset.k;
          let i = ks.findIndex((k) => k.id === id);
          typed.set(id, lines[0]);
          for (const line of lines.slice(1)) {
            const k = blankKey();
            ks.splice(++i, 0, k);
            typed.set(k.id, line);
          }
          paintKeys();
          setModel(w, readModel(w));
          toast(`已拆成 ${lines.length} 个密钥，可在左边填分组名`, "success");
        });
        // 按住 ⋮⋮ 拖动调顺序（排在上面的优先）
        keysBox.addEventListener("pointerdown", (e) => {
          const grip = e.target.closest(".pa-key-grip");
          if (!grip) return;
          e.preventDefault();
          syncTyped();
          const row = grip.closest(".pa-keyrow");
          row.classList.add("pa-dragging");
          grip.setPointerCapture?.(e.pointerId);
          const move = (ev) => {
            const rows = [...keysBox.querySelectorAll(".pa-keyrow")];
            const over = rows.find((x) => x !== row && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
            if (over) {
              if (over !== row.nextElementSibling) keysBox.insertBefore(row, over);
            } else if (row !== keysBox.lastElementChild) keysBox.append(row);
          };
          const up = () => {
            grip.removeEventListener("pointermove", move);
            grip.removeEventListener("pointerup", up);
            grip.removeEventListener("pointercancel", up);
            const order = [...keysBox.querySelectorAll(".pa-keyrow")].map((x) => x.dataset.k);
            ks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
            paintKeys();
            setModel(w, readModel(w));
          };
          grip.addEventListener("pointermove", move);
          grip.addEventListener("pointerup", up);
          grip.addEventListener("pointercancel", up);
        });
        w.querySelector("[data-f=modelbtn]").addEventListener("click", async () => {
          syncTyped();
          const view = viewSite();
          if (ks.length > 1) {
            const m = await pickKeyModel(view, { keyId: curKey, model: readModel(w) });
            s.modelView = view.modelView;
            if (m) setModel(w, m.model, m.keyId);
            return;
          }
          const m = await pickModel(ks[0].models || [], readModel(w));
          if (m) setModel(w, m);
        });
        w.querySelector("[data-f=fetch]").addEventListener("click", async (ev) => {
          const v = read(w);
          if (!v.url) return toast("请填写网址");
          const btn = ev.target;
          btn.disabled = true;
          btn.textContent = "获取中…";
          try {
            const use = liveKeys();
            for (const k of use) await persistKey(k, v);
            Object.assign(s, { source: v.source, url: v.url, name: v.name || s.name });
            if (use.length > 1) {
              const view = { ...viewSite(), keys: use };
              const { ok, bad } = await fetchAllKeys(view, use);
              paintKeys();
              const n = new Set(use.flatMap((k) => k.models || [])).size;
              if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
              if (ok && n) {
                toast(`已获取 ${n} 个模型`, "success");
                const m = await pickKeyModel(view, { keyId: curKey, model: v.model });
                s.modelView = view.modelView;
                if (m) setModel(w, m.model, m.keyId);
              } else if (ok) toast("站点未返回模型，可手动输入模型名称", "warning");
            } else {
              const k = use[0];
              const models = await getModels({ ...s, secretId: k.secretId, localId: k.localId, localKey: k.localKey, legacyKey: k.legacyKey });
              k.models = models;
              paintKeys();
              if (models.length) {
                toast(`已获取 ${models.length} 个模型`, "success");
                const m = await pickModel(models, v.model);
                if (m) setModel(w, m);
              }
              else toast("站点未返回模型，可手动输入模型名称", "warning");
            }
          } catch (err) {
            toast("获取失败：" + err.message, "error");
          }
          btn.disabled = false;
          btn.textContent = "获取模型列表";
        });
      },
      actions: [...isNew ? [] : [{ label: "删除", kind: "danger-soft", value: "del" }], { label: "取消", value: null }, {
        label: "保存",
        kind: "primary",
        validate: (w) => {
          const v = read(w);
          if (!v.name) {
            toast("请填写名称");
            return false;
          }
          if (v.source === "custom" && !v.url) {
            toast("自定义类型需填写网址");
            return false;
          }
          return true;
        },
        value: read
      }]
    });
    if (!r || r === "del") {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      if (isNew) for (const id of madeLocal) setLocalKey(id, null);
      if (r === "del") return act("del", site);
      return;
    }
    const final = liveKeys();
    try {
      for (const k of final) await persistKey(k, r);
    } catch (e) {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      return toast("密钥保存失败，站点未保存：" + e.message, "error");
    }
    const keep = new Set(final.map((k) => k.secretId).filter(Boolean));
    for (const k of madeKeys) if (!keep.has(k.id)) await dropKey(k.source, k.id);
    Object.assign(s, { name: r.name, source: r.source, url: r.source === "custom" ? r.url : "", note: r.note });
    for (const f of ["secretId", "keyMask", "localKey", "localId", "legacyKey", "model", "models", "keys", "keyId"]) delete s[f];
    if (final.length > 1) {
      s.keys = final.map((k) => {
        const out = { id: k.id, name: k.name, secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || "", models: k.models || [] };
        if (k.localKey) Object.assign(out, { localKey: true, localId: localIdOf(k) });
        return out;
      });
      s.keyId = final.some((k) => k.id === curKey) ? curKey : final[0].id;
    } else {
      // 一个密钥：照旧记在站点上
      const k = final[0];
      Object.assign(s, { secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || r.model || "", models: k.models || [] });
      if (k.localKey) {
        s.localKey = true;
        if (localIdOf(k) !== s.id) s.localId = localIdOf(k);
      }
      if (k.legacyKey) s.legacyKey = k.legacyKey;
    }
    const list = sites();
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s;
    else list.push(s);
    saveSettings();
    render();
  }
  const onChange = (e) => {
    const o = e.target.dataset.o;
    if (o === "chattoast") {
      settings().chatToast = e.target.checked;
      saveSettings();
    }
    if (o === "reasoningfollow") {
      settings().reasoningFollowPreset = e.target.checked;
      // 打开时先记下当前预设现在的推理格式
      if (e.target.checked) { initReasoningFollow(); rememberReasoning(); }
      saveSettings();
      render();
    }
  };
  for (const box of new Set([sitesBox, optsBox])) box.addEventListener("change", onChange);
  const onClick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "optfold") {
      if (e.target.closest(".pa-optcheck")) return;
      const k = e.target.closest("[data-w]").dataset.w;
      optOpen.has(k) ? optOpen.delete(k) : optOpen.add(k);
      return render();
    }
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
    return act(a, site, e.target.closest("button"), e.target);
  };
  // 2.5.0 用多密钥站点的某个分组连接：换成这个分组的密钥和它上次用的模型
  async function connectKey(target, keyId, btn = null) {
    const k = siteKey(target, keyId);
    if (btn) {
      btn.disabled = true;
      if (btn.querySelector("svg")) btn.classList.add("pa-busy");
      else if (!btn.classList.contains("pa-model-btn")) btn.textContent = "连接中…";
    }
    try {
      const v = keyView(target, k.id);
      await applyConnection(v);
      keepKeyId(target, v);
      target.keyId = k.id;
      settings().activeSiteId = target.id;
      saveSettings();
      const live = liveConnection();
      toast(live.online ? `已连接「${target.name}」· ${keyName(target, k)}` : failMsg(target, k), live.online ? "success" : "warning");
    } catch (err) {
      toast(`「${keyName(target, k)}」切换失败：${err.message}`, "error");
    }
    return render();
  }
  // btn：点的按钮（连接、获取时显示进度）；from：点的位置（找推理格式那一行）
  async function act(a, site, btn = null, from = null) {
    // 图标按钮（测试的闪电）忙时闪动，文字按钮换成提示文字
    const busy = (t) => {
      if (!btn) return;
      btn.disabled = true;
      if (btn.querySelector("svg")) btn.classList.add("pa-busy");
      else btn.textContent = t;
    };
    if (a === "livemore") return liveSheet();
    if (a === "reasoningclear") {
      if (!await confirmBox("清除推理格式记录", "清除所有预设记住的推理格式？当前酒馆设置不变。", "清除")) return;
      settings().reasoningByPreset = {};
      if (reasoningFollowOn()) rememberReasoning();
      saveSettings();
      return render();
    }
    if (a === "reasoningedit" || a === "reasoningadd") {
      let name = from?.closest(".pa-rrow")?.dataset.name;
      if (a === "reasoningadd") {
        const store = reasoningStore();
        const items = listPresets().filter((n) => n !== reasoningPreset && !store[n]).map((n) => ({ label: n, value: n }));
        if (!items.length) return toast("所有预设都已有记录", "info");
        name = await pickBox("给哪个预设设置推理格式", items, { hint: "先填入酒馆现在的设置，可再修改。" });
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
      return render();
    }
    if (a === "reasoningdel") {
      const name = from?.closest(".pa-rrow")?.dataset.name;
      if (!name || !await confirmBox("删除推理格式记录", `删除「${name}」记住的推理格式？切到它时将保持当时的设置。`, "删除", true)) return;
      delete reasoningStore()[name];
      saveSettings();
      return render();
    }
    if (a === "sitefold") {
      siteOpen.has(site.id) ? siteOpen.delete(site.id) : siteOpen.add(site.id);
      return render();
    }
    // 2.5.0 多密钥站点正在用：选模型时一并选分组，换了分组就换密钥重新连接
    if (a === "livemodel") {
      const live = liveConnection();
      const active = sites().find((x) => x.id === settings().activeSiteId);
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
        return connectKey(active, k.id, btn);
      }
    }
    if (a === "livemodel" || a === "sitemodel") {
      const live = liveConnection();
      const target = a === "sitemodel" ? site : sites().find((x) => x.id === settings().activeSiteId);
      const list = a === "livemodel" ? liveModelList(live) : target?.models || [];
      const m = await pickModel(list, a === "livemodel" ? live.model : target?.model);
      if (!m) return;
      if (target) siteKey(target).model = m;
      if (a === "livemodel" || target?.id === settings().activeSiteId) setLiveModel(m);
      saveSettings();
      toast(`模型已切换为 ${m}`, "success");
      return render();
    }
    if (a === "livefetch") {
      const live = liveConnection();
      const active = sites().find((x) => x.id === settings().activeSiteId);
      const same = isSame(active, live);
      if (live.source === "custom" && !live.url) return toast("当前连接没有网址", "warning");
      if (btn) { btn.disabled = true; btn.classList.add("pa-spin"); }
      // 多密钥站点：每个分组各拉一次
      if (same && siteMulti(active)) {
        const { bad } = await fetchAllKeys(active);
        saveSettings();
        const n = new Set(active.keys.flatMap((k) => k.models || [])).size;
        if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
        if (bad.length < active.keys.length) toast(n ? `已拉取 ${n} 个模型，点模型框的 ▾ 选择` : "站点未返回模型，可点模型框手动填写", n ? "success" : "warning");
        return render();
      }
      try {
        const models = await getModels(same ? active : { name: "当前连接", source: live.source, url: live.url || "", secretId: live.secretId });
        liveFetched = { source: live.source, url: live.url || "", models };
        if (same) {
          active.models = models;
          saveSettings();
        }
        toast(models.length ? `已拉取 ${models.length} 个模型，点模型框的 ▾ 选择` : "站点未返回模型，可点模型框手动填写", models.length ? "success" : "warning");
      } catch (err) {
        toast("拉取失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "keepmodel") {
      const t = sites().find((x) => x.id === settings().activeSiteId);
      const m = liveConnection().model;
      if (t && m) {
        siteKey(t).model = m;
        saveSettings();
        toast(`站点「${t.name}」的模型已改为 ${m}`, "success");
      }
      return render();
    }
    if (a === "new") return editSite(null);
    if (a === "edit") return editSite(site);
    if (a === "fetch") {
      busy("获取中…");
      if (siteMulti(site)) {
        const { bad } = await fetchAllKeys(site);
        saveSettings();
        if (bad.length) toast(`${bad.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`, "warning");
        return render();
      }
      try {
        site.models = await getModels(site);
        saveSettings();
        toast(site.models.length ? `已获取 ${site.models.length} 个模型` : "站点未返回模型", site.models.length ? "success" : "warning");
      } catch (err) {
        toast("获取失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "del") {
      const users = settings().schemes.filter((sc) => schemeConn(sc)?.siteId === site.id);
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库中的密钥不会删除。${users.length ? `${users.length} 个方案使用此站点，将保留其网址、模型和密钥记录。` : ""}`, "删除", true)) return;
      users.forEach((sc) => { sc.conn = { ...schemeConn(sc), siteId: null }; delete sc.siteId; });
      settings().sites = sites().filter((x) => x.id !== site.id);
      if (settings().activeSiteId === site.id) settings().activeSiteId = null;
      saveSettings();
      return render();
    }
    if (a === "use" || a === "reconnect") {
      const target = a === "use" ? site : sites().find((x) => x.id === settings().activeSiteId);
      if (siteMulti(target)) return connectKey(target, a === "use" ? from?.closest("[data-k]")?.dataset.k : siteKey(target).id, btn);
      busy("连接中…");
      try {
        if (target) {
          await applyConnection(target);
          settings().activeSiteId = target.id;
          saveSettings();
        } else {
          globalThis.jQuery("#api_button_openai").trigger("click");
          await waitConnect(15e3);
        }
        const live = liveConnection();
        toast(live.online ? `已连接${target ? `「${target.name}」` : ""}` : "已切换，未连接成功，请检查网址和密钥", live.online ? "success" : "warning");
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
  const onKey = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".pa-sghead")) { e.preventDefault(); e.target.click(); }
  };
  bindWhy(sitesBox);
  for (const box of new Set([liveBox, sitesBox, optsBox])) box.addEventListener("click", onClick);
  for (const box of new Set([sitesBox, optsBox])) box.addEventListener("keydown", onKey);
  return { render };
}
