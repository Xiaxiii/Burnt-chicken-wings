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
const modelBtn = (cur, attr) => `<button class="pa-model-btn" ${attr} title="${esc(cur || "")}"><span>${esc(cur || "选择模型")}</span><i>▾</i></button>`;
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
// liveBox：当前连接；sitesBox：站点列表和选项（「方案」页把方案放在两者之间）
function mountApi(liveBox, sitesBox) {
  const sites = () => settings().sites;
  const open = /* @__PURE__ */ new Set();
  function render() {
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    // 使用中的站点只同步可选的模型列表；在酒馆里临时换的模型不悄悄写进站点，由用户决定要不要记下
    const sameSite = active && active.source === live.source && (active.source !== "custom" || (active.url || "") === (live.url || ""));
    if (sameSite && liveModels.length && JSON.stringify(active.models || []) !== JSON.stringify(liveModels)) {
      active.models = liveModels;
      saveSettings();
    }
    const modelDiff = sameSite && live.model && active.model && live.model !== active.model;
    const usedBy = (id) => [...new Set(settings().schemes.filter((sc) => schemeConn(sc)?.siteId === id).map((sc) => sc.preset))];
    const dot = `<span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span>`;
    // 1.4.1：「当前连接」就是使用中的站点卡片，不再单独一块；当前连接还没存成站点时，用同样样式显示
    const siteCard = (x, isLive) => {
      const isOpen = isLive || open.has(x.id);
      return `<article class="pa-card pa-site${isLive ? " pa-site-on" : ""}${isOpen ? " pa-open" : ""}" data-id="${esc(x.id)}">
            <header ${isLive ? "" : 'data-a="toggle"'}>${isLive ? "" : `<span class="pa-site-caret">${isOpen ? "▾" : "▸"}</span>`}<b>${esc(x.name)}</b>${isLive ? '<span class="pa-chip">使用中</span>' : ""}<small class="pa-site-model">${usedBy(x.id).length ? `预设：${esc(usedBy(x.id).join("、"))}` : isLive ? "" : esc(x.model || "")}</small>
              ${isLive ? dot : '<button class="pa-btn pa-btn-primary pa-btn-s" data-a="use">切换</button>'}</header>
            ${isOpen ? `<dl class="pa-site-dl">
              <dt>类型</dt><dd>${esc(SOURCES[x.source]?.label || x.source)}</dd>
              ${x.url ? `<dt>网址</dt><dd>${esc(x.url)}</dd>` : ""}
              <dt>密钥</dt><dd>${esc(x.keyMask || (x.secretId ? "已保存" : "使用当前密钥"))}</dd>
              <dt>模型</dt><dd>${modelBtn(isLive ? live.model : x.model, isLive ? 'data-a="livemodel"' : 'data-a="sitemodel"')}${x.source === "custom" && !isLive ? '<button class="pa-link" data-a="fetch">获取模型列表</button>' : ""}
                ${isLive && modelDiff ? `<span class="pa-hint">站点记的是「${esc(x.model)}」。切换预设后会换回它。</span><button class="pa-link" data-a="keepmodel">改记为当前模型</button>` : ""}</dd>
              ${x.note ? `<dt>备注</dt><dd>${esc(x.note)}</dd>` : ""}
            </dl>
            <div class="pa-card-act">${isLive ? '<button class="pa-btn" data-a="reconnect">重新连接</button>' : ""}<button class="pa-btn" data-a="edit">编辑</button>${x.source === "custom" && isLive ? '<button class="pa-btn" data-a="fetch">获取模型列表</button>' : ""}<button class="pa-btn pa-btn-danger-soft" data-a="del">删除</button></div>` : ""}
        </article>`;
    };
    liveBox.innerHTML = `<div class="pa-row-head"><h3 class="pa-h">当前连接</h3></div>` + (active ? siteCard(active, true) : `<article class="pa-card pa-site pa-site-on pa-open">
            <header><b>${esc(src?.label?.split("（")[0] || live.source || "—")}${live.url ? ` ${esc(hostOf(live.url))}` : ""}</b><span class="pa-chip pa-chip-dim">未保存为站点</span><small class="pa-site-model"></small>${dot}</header>
            <dl class="pa-site-dl">
              ${live.url ? `<dt>网址</dt><dd>${esc(live.url)}</dd>` : ""}
              ${live.secretMask ? `<dt>密钥</dt><dd>${esc(live.secretMask)}</dd>` : ""}
              <dt>模型</dt><dd>${modelBtn(live.model, 'data-a="livemodel"')}</dd>
            </dl>
            <div class="pa-card-act"><button class="pa-btn" data-a="reconnect">重新连接</button><button class="pa-btn pa-btn-primary" data-a="capture">保存为站点</button></div>
        </article>`);
    const others = sites().filter((x) => x.id !== s.activeSiteId);
    sitesBox.innerHTML = `
        <div class="pa-row-head"><h3 class="pa-h">${active ? "其他站点" : "API 站点"}</h3><button class="pa-btn pa-btn-primary pa-btn-s pa-head-btn" data-a="new">＋ 添加站点</button></div>
        ${others.length ? others.map((x) => siteCard(x, false)).join("") : `<p class="pa-empty">${active ? "暂无其他站点。" : "暂无站点。可点「＋ 添加站点」，或点上方「保存为站点」。"}</p>`}
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="chattoast" ${s.chatToast !== false ? "checked" : ""}> 换角色或聊天时，提示当前预设和模型</label>
            ${tip("换预设，API 不变。<br>切换方案，恢复方案保存时的预设、条目开关、人设和 API。<br>提示显示 3 秒后自动关闭。")}
        </div>
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="reasoningfollow" ${s.reasoningFollowPreset === true ? "checked" : ""}> 切换预设时，同时切换推理格式</label>
            ${tip(`开启后，离开一个预设时记下酒馆「推理内容格式化」的设置（自动解析、前缀、后缀等），再切回该预设时自动恢复。未记过的预设保持当前设置。${s.reasoningFollowPreset === true ? "<br>下方列出各预设记住的设置，可点「修改」手动改；改当前预设就是改酒馆现在的设置。" : Object.keys(s.reasoningByPreset || {}).length ? `<br>已记住 ${Object.keys(s.reasoningByPreset).length} 个预设。<button class="pa-link" data-a="reasoningclear">清除记录</button>` : ""}`, "说明")}
            ${s.reasoningFollowPreset === true ? reasoningList() : ""}
        </div>`;
  }
  // 跟随开着时，当前预设的记录就是酒馆现在的设置（离开时会照它记下），所以显示实时值，不给删除
  function reasoningList() {
    const store = reasoningStore();
    const live = reasoningNow();
    const rows = Object.keys(store).filter((n) => n !== reasoningPreset).sort((a, b) => a.localeCompare(b, "zh")).map((n) => ({ name: n, r: store[n], cur: false }));
    if (reasoningPreset && live) rows.unshift({ name: reasoningPreset, r: live, cur: true });
    const row = (x) => `<div class="pa-srow pa-rrow${x.cur ? " pa-srow-on" : ""}" data-name="${esc(x.name)}">
          <div class="pa-srow-main"><b title="${esc(x.name)}">${esc(x.name)}</b>${x.cur ? '<span class="pa-chip">当前</span>' : ""}<small title="${esc(reasoningSummary(x.r))}">${esc(reasoningSummary(x.r))}</small></div>
          <button class="pa-link" data-a="reasoningedit">修改</button>${x.cur ? "" : '<button class="pa-link" data-a="reasoningdel">删除</button>'}
        </div>`;
    return `<div class="pa-rlist">${rows.map(row).join("") || '<p class="pa-hint">还没有记录。</p>'}</div>
        <div class="pa-rlist-foot"><button class="pa-link" data-a="reasoningadd">＋ 给其他预设设置</button>${rows.some((x) => !x.cur) ? '<button class="pa-link" data-a="reasoningclear">清除记录</button>' : ""}</div>`;
  }
  async function getModels(site) {
    return withSiteKey(site, () => fetchModelList(site));
  }
  async function editSite(site) {
    const isNew = !site;
    const s = site ? { ...site } : { id: uid(), name: "", source: "custom", url: "", model: "", models: [], secretId: null, keyMask: "", note: "" };
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名称</span><input class="pa-input" data-f="name" value="${esc(s.name)}" placeholder="例如：某中转站"></label>
            <label class="pa-field"><span>类型</span><select class="pa-select" data-f="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === s.source ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
            <label class="pa-field" data-show="custom"><span>网址</span><input class="pa-input" data-f="url" value="${esc(s.url)}" placeholder="https://…/v1" inputmode="url" autocapitalize="off"></label>
            <label class="pa-field"><span>密钥</span><input class="pa-input" data-f="key" type="password" autocomplete="off" placeholder="${s.secretId || s.localKey || s.legacyKey ? "不修改请留空" : "留空则使用酒馆当前密钥"}"></label>
            <div class="pa-field"><span>模型</span>${modelBtn(s.model, 'data-f="modelbtn" type="button"')}<input type="hidden" data-f="model" value="${esc(s.model || "")}"></div>
            <button class="pa-btn pa-btn-soft" data-f="fetch" type="button" data-show="custom">获取模型列表</button>
            <label class="pa-field"><span>备注</span><input class="pa-input" data-f="note" value="${esc(s.note || "")}" placeholder="例如：月卡至 11 月"></label>
            <p class="pa-hint">${multiKeySupported() ? "密钥存入酒馆密钥库，本扩展只记录编号。" : "酒馆版本较旧，没有密钥库。密钥只保存在这个浏览器里，不写进酒馆设置文件；换设备、换浏览器需要重新填写。"}</p>
        </div>`);
    const sync = (w) => {
      const custom = w.querySelector("[data-f=source]").value === "custom";
      w.querySelectorAll("[data-show=custom]").forEach((x) => {
        x.hidden = !custom;
      });
    };
    const setModel = (w, m) => {
      w.querySelector("[data-f=model]").value = m;
      const b = w.querySelector("[data-f=modelbtn]");
      b.title = m;
      b.querySelector("span").textContent = m || "选择模型";
    };
    const readModel = (w) => w.querySelector("[data-f=model]").value.trim();
    const read = (w) => ({
      name: w.querySelector("[data-f=name]").value.trim(),
      source: w.querySelector("[data-f=source]").value,
      url: w.querySelector("[data-f=url]").value.trim(),
      key: w.querySelector("[data-f=key]").value.trim(),
      model: readModel(w),
      note: w.querySelector("[data-f=note]").value.trim()
    });
    // 这个对话框里存进密钥库的新密钥。取消时删掉；同一个对话框里换过密钥，旧的也删掉
    const madeKeys = [];
    let madeLocal = false;
    const persistKey = async (v) => {
      if (!v.key) return;
      if (multiKeySupported()) {
        const id = await storeKey(v.source, v.key, `焦香鸡翅\xB7${v.name || "站点"}`);
        madeKeys.push({ source: v.source, id });
        s.secretId = id;
        delete s.legacyKey;
      } else {
        if (!setLocalKey(s.id, v.key)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
        madeLocal = true;
        s.localKey = true;
        delete s.legacyKey;
      }
      s.keyMask = v.key.length > 8 ? `${v.key.slice(0, 3)}…${v.key.slice(-4)}` : "已保存";
      v.key = "";
    };
    const r = await sheet({
      title: isNew ? "添加站点" : `编辑「${s.name}」`,
      body,
      wide: true,
      noFocus: !isNew,
      onMount: (w) => {
        sync(w);
        w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
        w.querySelector("[data-f=modelbtn]").addEventListener("click", async () => {
          const m = await pickModel(s.models || [], readModel(w));
          if (m) setModel(w, m);
        });
        w.querySelector("[data-f=fetch]").addEventListener("click", async (ev) => {
          const v = read(w);
          if (!v.url) return toast("请填写网址");
          const btn = ev.target;
          btn.disabled = true;
          btn.textContent = "获取中…";
          try {
            await persistKey(v);
            w.querySelector("[data-f=key]").value = "";
            Object.assign(s, { source: v.source, url: v.url, name: v.name || s.name });
            const models = await getModels(s);
            s.models = models;
            if (models.length) {
              toast(`已获取 ${models.length} 个模型`, "success");
              const m = await pickModel(models, v.model);
              if (m) setModel(w, m);
            }
            else toast("站点未返回模型，可手动输入模型名称", "warning");
          } catch (err) {
            toast("获取失败：" + err.message, "error");
          }
          btn.disabled = false;
          btn.textContent = "获取模型列表";
        });
      },
      actions: [{ label: "取消", value: null }, {
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
    if (!r) {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      if (madeLocal && isNew) setLocalKey(s.id, null);
      return;
    }
    try {
      await persistKey(r);
    } catch (e) {
      for (const k of madeKeys) await dropKey(k.source, k.id);
      return toast("密钥保存失败，站点未保存：" + e.message, "error");
    }
    for (const k of madeKeys) if (k.id !== s.secretId) await dropKey(k.source, k.id);
    Object.assign(s, { name: r.name, source: r.source, url: r.source === "custom" ? r.url : "", model: r.model, note: r.note });
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
  sitesBox.addEventListener("change", onChange);
  const onClick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
    if (a === "reasoningclear") {
      if (!await confirmBox("清除推理格式记录", "清除所有预设记住的推理格式？当前酒馆设置不变。", "清除")) return;
      settings().reasoningByPreset = {};
      if (reasoningFollowOn()) rememberReasoning();
      saveSettings();
      return render();
    }
    if (a === "reasoningedit" || a === "reasoningadd") {
      let name = e.target.closest(".pa-rrow")?.dataset.name;
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
      const name = e.target.closest(".pa-rrow")?.dataset.name;
      if (!name || !await confirmBox("删除推理格式记录", `删除「${name}」记住的推理格式？切到它时将保持当时的设置。`, "删除", true)) return;
      delete reasoningStore()[name];
      saveSettings();
      return render();
    }
    if (a === "livemodel" || a === "sitemodel") {
      const live = liveConnection();
      const target = a === "sitemodel" ? site : sites().find((x) => x.id === settings().activeSiteId);
      const list = a === "livemodel" ? liveModelOptions() : target?.models || [];
      const m = await pickModel(list, a === "livemodel" ? live.model : target?.model);
      if (!m) return;
      if (target) target.model = m;
      if (a === "livemodel" || target?.id === settings().activeSiteId) setLiveModel(m);
      saveSettings();
      toast(`模型已切换为 ${m}`, "success");
      return render();
    }
    if (a === "keepmodel") {
      const t = sites().find((x) => x.id === settings().activeSiteId);
      const m = liveConnection().model;
      if (t && m) {
        t.model = m;
        saveSettings();
        toast(`站点「${t.name}」的模型已改为 ${m}`, "success");
      }
      return render();
    }
    if (a === "toggle") {
      open.has(site.id) ? open.delete(site.id) : open.add(site.id);
      return render();
    }
    if (a === "new") return editSite(null);
    if (a === "edit") return editSite(site);
    if (a === "fetch") {
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "获取中…";
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
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "连接中…";
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
  };
  liveBox.addEventListener("click", onClick);
  sitesBox.addEventListener("click", onClick);
  return { render };
}
