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
// liveBox：当前连接；sitesBox：站点列表和选项（「方案与 API」页把方案放在两者之间）
function mountApi(liveBox, sitesBox) {
  const sites = () => settings().sites;
  const open = /* @__PURE__ */ new Set();
  function render() {
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    const liveModels = liveModelOptions();
    // 使用中的站点跟随实际连接：记下模型列表，酒馆里换了模型也同步过来
    if (active && active.source === live.source && (active.source !== "custom" || (active.url || "") === (live.url || ""))) {
      let changed = false;
      if (liveModels.length && JSON.stringify(active.models || []) !== JSON.stringify(liveModels)) active.models = liveModels, changed = true;
      if (live.model && active.model !== live.model) active.model = live.model, changed = true;
      if (changed) saveSettings();
    }
    const usedBy = (id) => [...new Set(settings().schemes.filter((sc) => sc.siteId === id).map((sc) => sc.preset))];
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
              <dt>模型</dt><dd>${modelBtn(isLive ? live.model : x.model, isLive ? 'data-a="livemodel"' : 'data-a="sitemodel"')}${x.source === "custom" && !isLive ? '<button class="pa-link" data-a="fetch">获取模型列表</button>' : ""}</dd>
              ${usedBy(x.id).length ? `<dt>用于</dt><dd>${settings().schemes.filter((sc) => sc.siteId === x.id).map((sc) => `方案「${esc(sc.name)}」（${esc(sc.preset)}）`).join("、")}</dd>` : ""}
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
        <div class="pa-row-head"><h3 class="pa-h">${active ? "其他站点" : "API 站点"}</h3><button class="pa-btn pa-btn-primary" data-a="new">＋ 添加站点</button></div>
        ${others.length ? others.map((x) => siteCard(x, false)).join("") : `<p class="pa-empty">${active ? "暂无其他站点。" : "暂无站点。可点「＋ 添加站点」，或点上方「保存为站点」。"}</p>`}
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="keep" ${s.keepApi ? "checked" : ""}> 切换预设后恢复当前站点</label>
            <label class="pa-inline-check"><input type="checkbox" data-o="unbind" ${bindPresetToConnection() ? "" : "checked"}> 切换预设时不改变连接设置</label>
        </div>`;
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
            <div class="pa-field"><span>模型</span>${modelBtn(s.model, 'data-f="modelbtn" type="button"')}<input type="hidden" data-f="model" value="${esc(s.model || "")}"></div>
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
  const onChange = (e) => {
    const o = e.target.dataset.o;
    if (o === "keep") {
      settings().keepApi = e.target.checked;
      saveSettings();
    }
    if (o === "unbind") setBindPresetToConnection(!e.target.checked);
  };
  sitesBox.addEventListener("change", onChange);
  const onClick = async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
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
      const users = settings().schemes.filter((sc) => sc.siteId === site.id);
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库中的密钥不会删除。${users.length ? `使用它的 ${users.length} 个方案将不再切换 API。` : ""}`, "删除", true)) return;
      users.forEach((sc) => delete sc.siteId);
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
