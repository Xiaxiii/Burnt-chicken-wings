var META_KEY = "presetAtelierScheme";
var LIKELY = /文风|风格|人设|人物|角色|情感|基调|性格|题材|狗|daddy|年上|年下|nsfw|涩|色|play|玩法|关系|buff/i;
function schemeStates(d, scheme) {
  const ids = scheme.scope === "all" ? d.order.map((o) => o.identifier) : d.order.filter((o) => scheme.scope.includes(d.groupOf(o.identifier))).map((o) => o.identifier);
  const states = {};
  for (const id of ids) states[id] = d.order.find((o) => o.identifier === id)?.enabled !== false;
  const groupStates = {};
  for (const g of d.groups.groups) if (scheme.scope === "all" || scheme.scope.includes(g.id)) groupStates[g.id] = g.enabled !== false;
  return { states, groupStates };
}
function schemeMatches(d, scheme) {
  for (const [id, on] of Object.entries(scheme.states || {})) {
    const o = d.order.find((x) => x.identifier === id);
    if (o && o.enabled !== false !== on) return false;
  }
  for (const [gid, on] of Object.entries(scheme.groupStates || {})) {
    const g = d.group(gid);
    if (g && g.enabled !== false !== on) return false;
  }
  return true;
}
async function applyScheme(scheme, { quiet = false } = {}) {
  if (!listPresets().includes(scheme.preset)) {
    toast(`方案「${scheme.name}」对应的预设「${scheme.preset}」已不存在`, "error");
    return false;
  }
  if (currentPresetName() !== scheme.preset) {
    await selectPreset(scheme.preset);
    dropDraft(scheme.preset);
  }
  const d = getDraft(scheme.preset);
  if (d.dirty && !quiet) {
    if (!await confirmBox("有未保存的修改", `「${scheme.preset}」有未保存的修改，套用方案时将一并保存。是否继续？`, "继续")) return false;
  }
  if (!schemeMatches(d, scheme)) {
    d.snapshot("套用方案");
    for (const [id, on] of Object.entries(scheme.states || {})) d.setEnabled([id], on);
    for (const [gid, on] of Object.entries(scheme.groupStates || {})) d.setGroupEnabled(gid, on);
    await saveDraft(scheme.preset, `套用方案 ${scheme.name}`);
  }
  if (scheme.persona) await setPersona(scheme.persona);
  toast(`已套用「${scheme.name}」${scheme.persona ? `，人设：${scheme.personaName || ""}` : ""}`, "success");
  return true;
}
function boundSchemeId() {
  return hasChat() ? chatMeta()[META_KEY] || null : null;
}
function mountSchemes(page) {
  page.innerHTML = `
        <div class="pa-toolbar"><div class="pa-picker-slot"></div>
            <button class="pa-btn pa-btn-primary" data-s="new">保存当前开关为方案</button></div>
        <p class="pa-hint pa-pad">方案记录一组条目的开关状态，可包含人设，可绑定聊天。</p>
        <div class="pa-scroll pa-schemes"></div>`;
  const box = page.querySelector(".pa-schemes");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  const all = () => settings().schemes;
  function card(s, d) {
    const bound = boundSchemeId() === s.id;
    const scope = s.scope === "all" ? "全部条目" : `${s.scope.map((g) => d?.group(g)?.name).filter(Boolean).slice(0, 4).join("、")}${s.scope.length > 4 ? ` 等 ${s.scope.length} 个分组` : ""}`;
    const on = d && s.preset === d.name && schemeMatches(d, s);
    return `<article class="pa-card pa-scheme${on ? " pa-scheme-on" : ""}" data-id="${esc(s.id)}">
            <header><b>${esc(s.name)}</b>${on ? '<span class="pa-chip">使用中</span>' : ""}${bound ? '<span class="pa-chip pa-chip-cot">已绑定本聊天</span>' : ""}</header>
            <small>${esc(s.preset)} \xB7 ${esc(scope)} \xB7 开启 ${Object.values(s.states).filter(Boolean).length} 条${s.persona ? ` \xB7 人设 ${esc(s.personaName || s.persona)}` : ""}</small>
            <div class="pa-card-act">
                <button class="pa-btn pa-btn-primary" data-a="apply">套用</button>
                <button class="pa-btn" data-a="update">更新为当前开关</button>
                <button class="pa-btn" data-a="bind">${bound ? "解除绑定" : "绑定本聊天"}</button>
                <button class="pa-icon-btn" data-a="more" aria-label="更多">⋯</button>
            </div></article>`;
  }
  function render() {
    let d = null;
    try {
      d = getDraft(focusPreset());
    } catch {
    }
    if (d) picker.set(d.name);
    const mine = all().filter((s) => d && s.preset === d.name);
    const others = all().filter((s) => !d || s.preset !== d.name);
    box.innerHTML = (mine.length ? mine.map((s) => card(s, d)).join("") : `<p class="pa-empty">「${esc(d?.name || "")}」暂无方案。先开启需要的条目，再点「保存当前开关为方案」。</p>`) + (others.length ? `<h3 class="pa-h">其他预设的方案（套用时将切换预设）</h3>${others.map((s) => card(s, null)).join("")}` : "");
  }
  page.querySelector("[data-s=new]").addEventListener("click", async () => {
    const d = getDraft(focusPreset());
    const persona = currentPersona();
    const personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
    const groups = d.groups.groups;
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>方案名称</span><input class="pa-input" data-f="name" placeholder="例如：纯爱、年上"></label>
            <fieldset class="pa-fieldset"><legend>记录范围</legend>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="groups" ${groups.length ? "checked" : ""} ${groups.length ? "" : "disabled"}> 只记录勾选的分组（推荐，其他条目不受影响）</label>
                <div class="pa-groups-pick">${groups.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${LIKELY.test(g.name) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || '<p class="pa-hint">此预设暂无分组，可在整理页新建</p>'}</div>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="all" ${groups.length ? "" : "checked"}> 记录全部条目</label>
            </fieldset>
            ${persona ? `<label class="pa-inline-check"><input type="checkbox" data-f="persona" checked> 同时记录人设（当前为「${esc(personaName || persona)}」）</label>` : ""}
        </div>`);
    const r = await sheet({
      title: "保存为方案",
      body,
      wide: true,
      actions: [{ label: "取消", value: null }, {
        label: "保存",
        kind: "primary",
        validate: (w) => {
          if (!w.querySelector("[data-f=name]").value.trim()) {
            toast("请填写方案名称");
            return false;
          }
          return true;
        },
        value: (w) => ({
          name: w.querySelector("[data-f=name]").value.trim(),
          scope: w.querySelector("input[name=pa-scope]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g),
          persona: !!w.querySelector("[data-f=persona]")?.checked
        })
      }]
    });
    if (!r) return;
    if (Array.isArray(r.scope) && !r.scope.length) return toast("请至少勾选一个分组，或选择记录全部条目", "warning");
    const s = { id: uid(), name: r.name, preset: d.name, scope: r.scope, persona: r.persona ? persona : null, personaName: r.persona ? personaName : "" };
    Object.assign(s, schemeStates(d, s));
    all().push(s);
    saveSettings();
    toast(`已保存方案「${s.name}」`, "success");
    render();
  });
  box.addEventListener("click", async (e) => {
    const art = e.target.closest(".pa-scheme");
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!art || !a) return;
    const s = all().find((x) => x.id === art.dataset.id);
    if (!s) return;
    if (a === "apply") {
      await applyScheme(s);
      setFocusPreset(s.preset);
      render();
    }
    if (a === "update") {
      const d = getDraft(s.preset);
      if (!await confirmBox("更新方案", `用「${s.preset}」当前的开关覆盖方案「${s.name}」？`, "更新")) return;
      Object.assign(s, schemeStates(d, s));
      const persona = currentPersona();
      if (s.persona && persona) {
        s.persona = persona;
        s.personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
      }
      saveSettings();
      toast("方案已更新", "success");
      render();
    }
    if (a === "bind") {
      if (!hasChat()) return toast("请先打开一个聊天");
      const meta = chatMeta();
      if (meta[META_KEY] === s.id) delete meta[META_KEY];
      else meta[META_KEY] = s.id;
      await saveChatMeta();
      toast(meta[META_KEY] ? `已绑定：进入本聊天时自动套用「${s.name}」` : "已解除绑定", "success");
      render();
    }
    if (a === "more") {
      const v = await pickBox(s.name, [{ label: "重命名", value: "rename" }, { label: "删除方案", value: "del" }]);
      if (v === "rename") {
        const n = await promptBox("方案名称", s.name);
        if (n) {
          s.name = n;
          saveSettings();
          render();
        }
      }
      if (v === "del" && await confirmBox("删除方案", `删除「${s.name}」？预设不受影响。`, "删除", true)) {
        settings().schemes = all().filter((x) => x.id !== s.id);
        saveSettings();
        render();
      }
    }
  });
  const off = onDraftChange(() => {
    if (page.isConnected && !page.hidden) render();
  });
  return { render: () => {
    picker.refresh();
    render();
  }, destroy: off };
}

