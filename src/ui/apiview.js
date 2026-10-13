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
    // 在用的站点顺手记下它的模型列表，展开别的站点时也能选
    if (active && active.source === live.source && liveModels.length && JSON.stringify(active.models || []) !== JSON.stringify(liveModels)) {
      active.models = liveModels;
      saveSettings();
    }
    box.innerHTML = `
        <div class="pa-card pa-live">
            <header><b>现在连着</b><span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span></header>
            <p>${esc(active?.name || src?.label || live.source || "—")}${live.url ? ` \xB7 ${esc(hostOf(live.url))}` : ""}${live.secretMask ? ` \xB7 key ${esc(live.secretMask)}` : ""}</p>
            <label class="pa-field pa-field-row"><span>模型</span>${modelSelect(live.model, liveModels, 'data-a="livemodel"')}</label>
            <div class="pa-card-act"><button class="pa-btn" data-a="reconnect">重新连接</button><button class="pa-btn pa-btn-soft" data-a="capture">存成站点</button></div>
        </div>
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="keep" ${s.keepApi ? "checked" : ""}> 换预设后自动恢复到当前站点</label>
            <label class="pa-inline-check"><input type="checkbox" data-o="unbind" ${bindPresetToConnection() ? "" : "checked"}> 换预设时不改连接设置</label>
        </div>
        <div class="pa-row-head"><h3 class="pa-h">我的站点</h3><button class="pa-btn pa-btn-primary" data-a="new">＋ 新站点</button></div>
        ${sites().length ? sites().map((x) => {
      const on = x.id === s.activeSiteId;
      const isOpen = open.has(x.id);
      return `<article class="pa-card pa-site${on ? " pa-site-on" : ""}${isOpen ? " pa-open" : ""}" data-id="${esc(x.id)}">
            <header data-a="toggle"><span class="pa-site-caret">${isOpen ? "▾" : "▸"}</span><b>${esc(x.name)}</b>${on ? '<span class="pa-chip">在用</span>' : ""}<small class="pa-site-model">${esc(x.model || "")}</small>
              ${on ? "" : '<button class="pa-btn pa-btn-primary pa-btn-s" data-a="use">切换</button>'}</header>
            ${isOpen ? `<dl class="pa-site-dl">
              <dt>类型</dt><dd>${esc(SOURCES[x.source]?.label || x.source)}</dd>
              ${x.url ? `<dt>网址</dt><dd>${esc(x.url)}</dd>` : ""}
              <dt>Key</dt><dd>${esc(x.keyMask || (x.secretId ? "已存" : "沿用当前"))}</dd>
              <dt>模型</dt><dd>${modelSelect(x.model, x.models || [], 'data-a="sitemodel"')}${(x.models || []).length ? "" : '<small class="pa-dim">（切换到这个站点后能拉到模型列表）</small>'}</dd>
              ${x.note ? `<dt>备注</dt><dd>${esc(x.note)}</dd>` : ""}
            </dl>
            <div class="pa-card-act"><button class="pa-btn" data-a="edit">编辑</button><button class="pa-btn pa-btn-danger-soft" data-a="del">删除</button></div>` : ""}
        </article>`;
    }).join("") : '<p class="pa-empty">还没有站点。点「＋ 新站点」，或者先在酒馆里连好再点「存成站点」。</p>'}`;
  }
  async function editSite(site) {
    const isNew = !site;
    const s = site ? { ...site } : { id: uid(), name: "", source: "custom", url: "", model: "", models: [], secretId: null, keyMask: "", note: "" };
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>名字</span><input class="pa-input" data-f="name" value="${esc(s.name)}" placeholder="比如：某某中转站-克劳德"></label>
            <label class="pa-field"><span>类型</span><select class="pa-select" data-f="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === s.source ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
            <label class="pa-field" data-show="custom"><span>网址</span><input class="pa-input" data-f="url" value="${esc(s.url)}" placeholder="https://…/v1" inputmode="url" autocapitalize="off"></label>
            <label class="pa-field"><span>Key</span><input class="pa-input" data-f="key" type="password" autocomplete="off" placeholder="${s.secretId || s.legacyKey ? "不改就留空" : "留空就沿用酒馆里当前的 key"}"></label>
            <label class="pa-field"><span>模型</span><input class="pa-input" data-f="model" value="${esc(s.model)}" list="pa-models" autocapitalize="off"><datalist id="pa-models">${(s.models || []).map((m) => `<option value="${esc(m)}">`).join("")}</datalist></label>
            <button class="pa-btn pa-btn-soft" data-f="fetch" type="button" data-show="custom">连上并拉取模型列表</button>
            <label class="pa-field"><span>备注</span><input class="pa-input" data-f="note" value="${esc(s.note || "")}" placeholder="比如：月卡到 11 月"></label>
            <p class="pa-hint">${multiKeySupported() ? "Key 存在酒馆密钥库，裁缝铺只记编号。" : "酒馆版本较旧，key 存在酒馆设置文件里。"}</p>
        </div>`);
    const sync = (w) => {
      const custom = w.querySelector("[data-f=source]").value === "custom";
      w.querySelectorAll("[data-show=custom]").forEach((x) => {
        x.hidden = !custom;
      });
    };
    const read = (w) => ({
      name: w.querySelector("[data-f=name]").value.trim(),
      source: w.querySelector("[data-f=source]").value,
      url: w.querySelector("[data-f=url]").value.trim(),
      key: w.querySelector("[data-f=key]").value.trim(),
      model: w.querySelector("[data-f=model]").value.trim(),
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
      s.keyMask = v.key.length > 8 ? `${v.key.slice(0, 3)}…${v.key.slice(-4)}` : "已存";
      v.key = "";
    };
    const r = await sheet({
      title: isNew ? "新站点" : `编辑「${s.name}」`,
      body,
      wide: true,
      noFocus: !isNew,
      onMount: (w) => {
        sync(w);
        w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
        w.querySelector("[data-f=fetch]").addEventListener("click", async (ev) => {
          const v = read(w);
          if (!v.url) return toast("先填网址");
          ev.target.disabled = true;
          ev.target.textContent = "连接中…";
          try {
            await persistKey(v);
            w.querySelector("[data-f=key]").value = "";
            Object.assign(s, { source: v.source, url: v.url });
            await applyConnection({ ...s, model: "" });
            const models = customModelOptions();
            s.models = models;
            w.querySelector("#pa-models").innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
            toast(models.length ? `拉到 ${models.length} 个模型，在"模型"里选` : "连上了，但没拿到模型列表，手填模型名就行", models.length ? "success" : "warning");
          } catch (err) {
            toast("连接失败：" + err.message, "error");
          }
          ev.target.disabled = false;
          ev.target.textContent = "连上并拉取模型列表";
        });
      },
      actions: [{ label: "取消", value: null }, {
        label: "保存",
        kind: "primary",
        validate: (w) => {
          const v = read(w);
          if (!v.name) {
            toast("起个名字");
            return false;
          }
          if (v.source === "custom" && !v.url) {
            toast("自定义类型要填网址");
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
      return toast("key 没存进去：" + e.message, "error");
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
      toast(`模型改成 ${m}`, "success");
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
    if (a === "del") {
      if (!await confirmBox("删除站点", `删除「${site.name}」？酒馆密钥库里的 key 不会删，可以在酒馆的 API 设置里管理。`, "删除", true)) return;
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
          await sleep(2500);
        }
        const live = liveConnection();
        toast(live.online ? `已连上${target ? `「${target.name}」` : ""}` : "已切换，但还没连上，看看网址和 key 对不对", live.online ? "success" : "warning");
      } catch (err) {
        toast("切换失败：" + err.message, "error");
      }
      return render();
    }
    if (a === "capture") {
      await readSecretState();
      const live = liveConnection();
      if (!SOURCES[live.source]) return toast("现在的连接类型裁缝铺还不支持保存", "warning");
      const s = { id: uid(), name: `${SOURCES[live.source].label.split("（")[0]}${live.url ? " " + hostOf(live.url) : ""}`, source: live.source, url: live.url || "", model: live.model || "", models: customModelOptions(), secretId: live.secretId, keyMask: live.secretMask, note: "" };
      sites().push(s);
      settings().activeSiteId = s.id;
      saveSettings();
      toast("已保存", "success");
      render();
    }
  });
  return { render };
}

