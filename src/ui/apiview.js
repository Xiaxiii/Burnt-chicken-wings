function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "";
  }
}
function mountApi(page) {
  page.innerHTML = `<div class="pa-scroll pa-api"></div>`;
  const box = page.querySelector(".pa-api");
  const sites = () => settings().sites;
  const open = /* @__PURE__ */ new Set();
  const modelSelect = (cur, list, attr) => {
    const all = [...new Set([cur, ...list].filter(Boolean))];
    if (!all.length) return '<span class="pa-dim">—</span>';
    return `<select class="pa-select pa-select-s" ${attr}>${all.map((m) => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>`;
  };
  function render() {
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    // 使用中的站点顺带记下模型列表，展开其他站点时也能选
    if (active && active.source === live.source && liveModels.length && JSON.stringify(active.models || []) !== JSON.stringify(liveModels)) {
      active.models = liveModels;
      saveSettings();
    }
    box.innerHTML = `
        <div class="pa-card pa-live">
            <header><b>当前连接</b><span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span></header>
            <p>${esc(active?.name || src?.label || live.source || "—")}${live.url ? ` \xB7 ${esc(hostOf(live.url))}` : ""}${live.secretMask ? ` \xB7 密钥 ${esc(live.secretMask)}` : ""}</p>
            <label class="pa-field pa-field-row"><span>模型</span>${modelSelect(live.model, liveModels, 'data-a="livemodel"')}</label>
            <div class="pa-card-act"><button class="pa-btn" data-a="reconnect">重新连接</button><button class="pa-btn pa-btn-soft" data-a="capture">保存为站点</button></div>
        </div>
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="keep" ${s.keepApi ? "checked" : ""}> 切换预设后恢复当前站点</label>
            <label class="pa-inline-check"><input type="checkbox" data-o="unbind" ${bindPresetToConnection() ? "" : "checked"}> 切换预设时不改变连接设置</label>
        </div>
        <div class="pa-row-head"><h3 class="pa-h">站点</h3><button class="pa-btn pa-btn-primary" data-a="new">＋ 添加站点</button></div>
        ${sites().length ? sites().map((x) => {
      const on = x.id === s.activeSiteId;
      const isOpen = open.has(x.id);
      return `<article class="pa-card pa-site${on ? " pa-site-on" : ""}${isOpen ? " pa-open" : ""}" data-id="${esc(x.id)}">
            <header data-a="toggle"><span class="pa-site-caret">${isOpen ? "▾" : "▸"}</span><b>${esc(x.name)}</b>${on ? '<span class="pa-chip">使用中</span>' : ""}<small class="pa-site-model">${esc(x.model || "")}</small>
              ${on ? "" : '<button class="pa-btn pa-btn-primary pa-btn-s" data-a="use">切换</button>'}</header>
            ${isOpen ? `<dl class="pa-site-dl">
              <dt>类型</dt><dd>${esc(SOURCES[x.source]?.label || x.source)}</dd>
              ${x.url ? `<dt>网址</dt><dd>${esc(x.url)}</dd>` : ""}
              <dt>密钥</dt><dd>${esc(x.keyMask || (x.secretId ? "已保存" : "使用当前密钥"))}</dd>
              <dt>模型</dt><dd>${modelSelect(x.model, x.models || [], 'data-a="sitemodel"')}${(x.models || []).length || x.source !== "custom" ? "" : '<button class="pa-link" data-a="fetch">获取模型列表</button>'}</dd>
              ${x.note ? `<dt>备注</dt><dd>${esc(x.note)}</dd>` : ""}
            </dl>
            <div class="pa-card-act"><button class="pa-btn" data-a="edit">编辑</button><button class="pa-btn pa-btn-danger-soft" data-a="del">删除</button></div>` : ""}
        </article>`;
    }).join("") : '<p class="pa-empty">暂无站点。可点「＋ 添加站点」，或在酒馆中连接后点「保存为站点」。</p>'}`;
  }
  // 模型栏：有列表时下拉选择，最后一项「手动输入」；没有列表时直接输入
  const MANUAL = "\0manual";
  function modelField(cur, list) {
    const all = [...new Set([...list, cur].filter(Boolean))];
    if (!all.length) return `<input class="pa-input" data-f="model" value="${esc(cur || "")}" placeholder="模型名称" autocapitalize="off">`;
    return `<select class="pa-select" data-f="modelsel">${all.map((m) => `<option value="${esc(m)}" ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("")}<option value="${MANUAL}">手动输入…</option></select>
            <input class="pa-input" data-f="model" value="${esc(cur || "")}" placeholder="模型名称" autocapitalize="off" hidden>`;
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
            <label class="pa-field"><span>密钥</span><input class="pa-input" data-f="key" type="password" autocomplete="off" placeholder="${s.secretId || s.legacyKey ? "不修改请留空" : "留空则使用酒馆当前密钥"}"></label>
            <div class="pa-field"><span>模型</span><div class="pa-model-slot">${modelField(s.model, s.models || [])}</div></div>
            <button class="pa-btn pa-btn-soft" data-f="fetch" type="button" data-show="custom">获取模型列表</button>
            <label class="pa-field"><span>备注</span><input class="pa-input" data-f="note" value="${esc(s.note || "")}" placeholder="例如：月卡至 11 月"></label>
            <p class="pa-hint">${multiKeySupported() ? "密钥存入酒馆密钥库，本扩展只记录编号。" : "酒馆版本较旧，密钥存入酒馆设置文件。"}</p>
        </div>`);
    const sync = (w) => {
      const custom = w.querySelector("[data-f=source]").value === "custom";
      w.querySelectorAll("[data-show=custom]").forEach((x) => {
        x.hidden = !custom;
      });
    };
    const bindModel = (w) => {
      const sel = w.querySelector("[data-f=modelsel]");
      sel?.addEventListener("change", () => {
        const inp = w.querySelector("[data-f=model]");
        inp.hidden = sel.value !== MANUAL;
        if (!inp.hidden) inp.focus();
      });
    };
    const readModel = (w) => {
      const sel = w.querySelector("[data-f=modelsel]");
      return (sel && sel.value !== MANUAL ? sel.value : w.querySelector("[data-f=model]").value).trim();
    };
    const read = (w) => ({
      name: w.querySelector("[data-f=name]").value.trim(),
      source: w.querySelector("[data-f=source]").value,
      url: w.querySelector("[data-f=url]").value.trim(),
      key: w.querySelector("[data-f=key]").value.trim(),
      model: readModel(w),
      note: w.querySelector("[data-f=note]").value.trim()
    });
    const persistKey = async (v) => {
      if (!v.key) return;
      if (multiKeySupported()) {
        const id = await storeKey(v.source, v.key, `裁缝铺\xB7${v.name || "站点"}`);
        s.secretId = id;
        delete s.legacyKey;
      } else {
        s.legacyKey = v.key;
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
        bindModel(w);
        w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
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
            w.querySelector(".pa-model-slot").innerHTML = modelField(v.model, models);
            bindModel(w);
            if (models.length) toast(`已获取 ${models.length} 个模型`, "success");
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
    if (!r) return;
    try {
      await persistKey(r);
    } catch (e) {
      return toast("密钥保存失败：" + e.message, "error");
    }
    Object.assign(s, { name: r.name, source: r.source, url: r.source === "custom" ? r.url : "", model: r.model, note: r.note });
    const list = sites();
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s;
    else list.push(s);
    saveSettings();
    render();
  }
  box.addEventListener("change", (e) => {
    const a = e.target.dataset.a;
    if (a === "livemodel" || a === "sitemodel") {
      const m = e.target.value;
      const site = a === "sitemodel" ? sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id) : sites().find((x) => x.id === settings().activeSiteId);
      if (site) site.model = m;
      if (a === "livemodel" || site?.id === settings().activeSiteId) setLiveModel(m);
      saveSettings();
      toast(`模型已切换为 ${m}`, "success");
      return render();
    }
    const o = e.target.dataset.o;
    if (o === "keep") {
      settings().keepApi = e.target.checked;
      saveSettings();
    }
    if (o === "unbind") setBindPresetToConnection(!e.target.checked);
  });
  box.addEventListener("click", async (e) => {
    if (e.target.closest("select")) return;
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
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
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库中的密钥不会删除。`, "删除", true)) return;
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
  });
  return { render };
}
