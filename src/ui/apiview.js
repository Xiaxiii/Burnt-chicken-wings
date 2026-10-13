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
  function render() {
    const live = liveConnection();
    const s = settings();
    const active = sites().find((x) => x.id === s.activeSiteId);
    const src = SOURCES[live.source];
    box.innerHTML = `
        <div class="pa-card pa-live">
            <header><b>现在连着</b><span class="pa-dot ${live.online ? "pa-dot-on" : ""}">${live.online ? "已连接" : "未连接"}</span></header>
            <p>${esc(src?.label || live.source || "—")}${live.url ? ` \xB7 ${esc(hostOf(live.url))}` : ""}</p>
            <p>模型：${esc(live.model || "—")}${live.secretMask ? ` \xB7 key ${esc(live.secretMask)}` : ""}</p>
            ${active ? `<small>站点：${esc(active.name)}</small>` : ""}
            <div class="pa-card-act"><button class="pa-btn" data-a="reconnect">重新连接</button><button class="pa-btn pa-btn-soft" data-a="capture">把现在的连接存成站点</button></div>
        </div>
        <div class="pa-card">
            <label class="pa-inline-check"><input type="checkbox" data-o="keep" ${s.keepApi ? "checked" : ""}> 换预设后自动恢复到当前站点（解决"换预设 API 就断"）</label>
            <label class="pa-inline-check"><input type="checkbox" data-o="unbind" ${bindPresetToConnection() ? "" : "checked"}> 换预设时不改连接设置（关掉酒馆的"绑定预设与连接"）</label>
        </div>
        <div class="pa-row-head"><h3 class="pa-h">我的站点</h3><button class="pa-btn pa-btn-primary" data-a="new">＋ 新站点</button></div>
        ${sites().length ? sites().map((x) => `<article class="pa-card pa-site${x.id === s.activeSiteId ? " pa-site-on" : ""}" data-id="${esc(x.id)}">
            <header><b>${esc(x.name)}</b>${x.id === s.activeSiteId ? '<span class="pa-chip">在用</span>' : ""}</header>
            <small>${esc(SOURCES[x.source]?.label || x.source)}${x.url ? ` \xB7 ${esc(hostOf(x.url))}` : ""}</small>
            <small>模型 ${esc(x.model || "—")} \xB7 key ${esc(x.keyMask || (x.secretId ? "已存" : "沿用当前"))}${x.note ? ` \xB7 ${esc(x.note)}` : ""}</small>
            <div class="pa-card-act"><button class="pa-btn pa-btn-primary" data-a="use">切换</button><button class="pa-btn" data-a="edit">编辑</button><button class="pa-btn pa-btn-danger-soft" data-a="del">删除</button></div>
        </article>`).join("") : '<p class="pa-empty">还没有站点。点「＋ 新站点」，或者先在酒馆里连好再点「把现在的连接存成站点」。</p>'}`;
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
            <p class="pa-hint">${multiKeySupported() ? "Key 会存进酒馆自己的密钥库（和你在酒馆里填 key 一样安全），裁缝铺只记它的编号。" : "你的酒馆版本较旧，key 会存在酒馆的设置文件里。"}</p>
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
    const o = e.target.dataset.o;
    if (o === "keep") {
      settings().keepApi = e.target.checked;
      saveSettings();
    }
    if (o === "unbind") setBindPresetToConnection(!e.target.checked);
  });
  box.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const site = sites().find((x) => x.id === e.target.closest(".pa-site")?.dataset.id);
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
      toast("存好了，可以点「编辑」改个好记的名字", "success");
      render();
    }
  });
  return { render };
}

