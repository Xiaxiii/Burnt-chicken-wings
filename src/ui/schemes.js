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
async function applyScheme(scheme, { quiet = false, why = "" } = {}) {
  // 1.5.0：预设已归档的，先从归档恢复
  if (!listPresets().includes(scheme.preset) && archiveList().some((x) => x.name === scheme.preset)) {
    try {
      await restoreArchivedByName(scheme.preset);
    } catch (e) {
      toast(`从归档恢复「${scheme.preset}」失败：${e.message}`, "error");
      return false;
    }
  }
  if (!listPresets().includes(scheme.preset)) {
    toast(`方案「${scheme.name}」对应的预设「${scheme.preset}」已不存在`, "error");
    return false;
  }
  // 1.4.0：方案可记录 API 站点。先改「使用中的站点」，切换预设后的自动恢复连接就会连到这个站点
  const site = scheme.siteId ? settings().sites.find((x) => x.id === scheme.siteId) : null;
  if (scheme.siteId && !site) toast(`方案「${scheme.name}」记录的 API 站点已删除，本次不切换 API`, "warning");
  // 先处理这个预设上没存完的修改，再切换（切换后会丢掉旧草稿重新读）
  const old = drafts.get(scheme.preset);
  if (old?.dirty) {
    if (!quiet && !await confirmBox("有未保存的修改", `「${scheme.preset}」有未保存的修改，套用方案前会先保存。是否继续？`, "继续")) return false;
    try {
      await saveDraft(scheme.preset, "套用方案前保存");
    } catch (e) {
      handleSaveError(scheme.preset, e);
      toast(`「${scheme.preset}」的修改没有保存成功，未套用方案`, "error");
      return false;
    }
  }
  // 整个套用过程中由这里负责连接，避免「切换预设后恢复站点」同时再连一次
  if (site) applying = true;
  try {
    if (site) {
      settings().activeSiteId = site.id;
      saveSettings();
    }
    if (currentPresetName() !== scheme.preset) {
      await selectPreset(scheme.preset);
      dropDraft(scheme.preset);
    }
    const d = getDraft(scheme.preset);
    if (!schemeMatches(d, scheme)) {
      d.snapshot("套用方案");
      // 先整组、后单条：整组开关会带动组内条目，单条的记录要最后生效
      for (const [gid, on] of Object.entries(scheme.groupStates || {})) d.setGroupEnabled(gid, on);
      for (const [id, on] of Object.entries(scheme.states || {})) d.setEnabled([id], on);
      try {
        await saveDraft(scheme.preset, `套用方案 ${scheme.name}`);
      } catch (e) {
        handleSaveError(scheme.preset, e);
        return false;
      }
    }
    if (scheme.persona) await setPersona(scheme.persona);
    if (site && siteDiffers(site)) {
      try {
        const live = await applyConnection(site);
        if (!live.online) toast(`已切换到「${site.name}」，但没有连上，请检查网址和密钥`, "warning");
      } catch (e) {
        toast(`API 站点「${site.name}」连接失败：${e.message}`, "error");
      }
    }
  } finally {
    if (site) applying = false;
  }
  toast(`${why ? `自动套用（${why}）：` : "已切换到"}「${scheme.name}」${scheme.persona ? `，人设：${scheme.personaName || ""}` : ""}${site ? `，API：${site.name}` : ""}`, "success");
  return true;
}
// 自动套用的绑定：聊天绑定存在聊天文件里；角色绑定存在本扩展设置里（这个角色的任何聊天都算）。聊天绑定优先
function currentCharKey() {
  const c = ctx();
  if (c.groupId) return "group:" + c.groupId;
  return c.characters?.[Number(c.characterId)]?.avatar || null;
}
function currentCharName() {
  const c = ctx();
  if (c.groupId) return c.groups?.find((g) => g.id === c.groupId)?.name || "本群聊";
  return c.characters?.[Number(c.characterId)]?.name || "";
}
function bindingNow() {
  if (!hasChat()) return null;
  const chatId = chatMeta()[META_KEY];
  if (chatId) return { scope: "chat", id: chatId };
  const k = currentCharKey();
  const charId = k ? settings().schemeCharBind?.[k] : null;
  return charId ? { scope: "char", id: charId } : null;
}
function boundSchemeId() {
  return bindingNow()?.id || null;
}
var BIND_LABEL = { chat: "本聊天", char: "本角色" };
function mountSchemes(page, { after } = {}) {
  page.innerHTML = `
        <div class="pa-row-head"><h3 class="pa-h">方案</h3><button class="pa-btn pa-btn-primary pa-btn-s pa-head-btn" data-s="new">保存当前状态为方案</button></div>
        <div class="pa-toolbar pa-toolbar-flat"><div class="pa-picker-slot"></div></div>
        ${tip("方案记下一组条目开关，可同时记下人设和 API 站点。<br>「切换到此方案」：把预设、开关、人设、API 一次换成方案记的样子。<br>「用现在的覆盖」：把方案改成你现在的开关（和人设、API）。<br>「自动套用」：绑定本聊天或本角色后，进入那个聊天时自动切换一次；之后你手动换预设、改开关，不会被改回来。")}
        <div class="pa-schemes"></div>`;
  const box = page.querySelector(".pa-schemes");
  const picker = presetPicker(page.querySelector(".pa-picker-slot"), (n) => setFocusPreset(n));
  const all = () => settings().schemes;
  function card(s, d) {
    const bind = bindingNow();
    const bound = bind?.id === s.id ? bind.scope : null;
    const scope = s.scope === "all" ? "全部条目" : `${s.scope.map((g) => d?.group(g)?.name).filter(Boolean).slice(0, 4).join("、")}${s.scope.length > 4 ? ` 等 ${s.scope.length} 个分组` : ""}`;
    // 「使用中」要和酒馆实际生效的一致：预设正在用、开关一致、人设和 API 站点也对得上。只有开关一致时标「开关一致」
    const switchesOk = !!d && s.preset === d.name && schemeMatches(d, s);
    const site = s.siteId ? settings().sites.find((x) => x.id === s.siteId) : null;
    const on = switchesOk && currentPresetName() === s.preset && (!s.persona || currentPersona() === s.persona) && (!site || !siteDiffers(site, { ...liveConnection(), online: true }));
    return `<article class="pa-card pa-scheme${on ? " pa-scheme-on" : ""}" data-id="${esc(s.id)}">
            <header><b>${esc(s.name)}</b>${on ? '<span class="pa-chip">使用中</span>' : switchesOk ? '<span class="pa-chip pa-chip-dim" title="条目开关和方案一致，但预设、人设或 API 站点不是方案记录的">开关一致</span>' : ""}</header>
            <small>${esc(s.preset)}${!listPresets().includes(s.preset) && archiveList().some((x) => x.name === s.preset) ? "（已归档，套用时自动恢复）" : ""} \xB7 ${esc(scope)} \xB7 开启 ${Object.values(s.states).filter(Boolean).length} 条${s.persona ? ` \xB7 人设 ${esc(s.personaName || s.persona)}` : ""}${s.siteId ? ` \xB7 API ${esc(settings().sites.find((x) => x.id === s.siteId)?.name || "（站点已删除）")}` : ""}</small>
            ${bound ? `<div class="pa-bindline">🔗 自动套用：进入${bound === "chat" ? "这个聊天" : `「${esc(currentCharName())}」的聊天`}时切换到此方案<button class="pa-link" data-a="bind">改</button></div>` : ""}
            <div class="pa-card-act">
                <button class="pa-btn pa-btn-primary" data-a="apply" title="把预设、开关、人设、API 一次换成方案记的样子">切换到此方案</button>
                <button class="pa-btn" data-a="update" title="把方案改成现在的开关（和人设、API）">用现在的覆盖</button>
                ${bound ? "" : '<button class="pa-btn" data-a="bind" title="进入聊天时自动切换到此方案">🔗 自动套用…</button>'}
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
    box.innerHTML = (mine.length ? mine.map((s) => card(s, d)).join("") : `<p class="pa-empty">「${esc(d?.name || "")}」暂无方案。先开启需要的条目、连好 API，再点「保存当前状态为方案」。</p>`) + (others.length ? `<h3 class="pa-h">其他预设的方案（套用时将切换预设）</h3>${others.map((s) => card(s, null)).join("")}` : "");
    after?.();
  }
  page.querySelector("[data-s=new]").addEventListener("click", async () => {
    const d = getDraft(focusPreset());
    const persona = currentPersona();
    const personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
    const groups = d.groups.groups;
    const site = settings().sites.find((x) => x.id === settings().activeSiteId);
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>方案名称</span><input class="pa-input" data-f="name" placeholder="例如：纯爱、年上"></label>
            <fieldset class="pa-fieldset"><legend>记录范围</legend>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="groups" ${groups.length ? "checked" : ""} ${groups.length ? "" : "disabled"}> 只记录勾选的分组（推荐，其他条目不受影响）</label>
                <div class="pa-groups-pick">${groups.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${LIKELY.test(g.name) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || '<p class="pa-hint">此预设暂无分组，可在整理页新建</p>'}</div>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="all" ${groups.length ? "" : "checked"}> 记录全部条目</label>
            </fieldset>
            ${persona ? `<label class="pa-inline-check"><input type="checkbox" data-f="persona" checked> 同时记录人设（当前为「${esc(personaName || persona)}」）</label>` : ""}
            ${site ? `<label class="pa-inline-check"><input type="checkbox" data-f="site" checked> 同时记录 API 站点（当前为「${esc(site.name)}」）</label>` : '<p class="pa-hint">当前连接未保存为 API 站点，无法记录。可先在上方点「保存为站点」。</p>'}
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
          persona: !!w.querySelector("[data-f=persona]")?.checked,
          site: !!w.querySelector("[data-f=site]")?.checked
        })
      }]
    });
    if (!r) return;
    if (Array.isArray(r.scope) && !r.scope.length) return toast("请至少勾选一个分组，或选择记录全部条目", "warning");
    const s = { id: uid(), name: r.name, preset: d.name, scope: r.scope, persona: r.persona ? persona : null, personaName: r.persona ? personaName : "", siteId: r.site && site ? site.id : null };
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
      if (!await confirmBox("更新方案", `用当前的开关${s.persona ? "、人设" : ""}${s.siteId ? "、API 站点" : ""}覆盖方案「${s.name}」？`, "更新")) return;
      Object.assign(s, schemeStates(d, s));
      const persona = currentPersona();
      if (s.persona && persona) {
        s.persona = persona;
        s.personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
      }
      if (s.siteId && settings().activeSiteId) s.siteId = settings().activeSiteId;
      saveSettings();
      toast("方案已更新", "success");
      render();
    }
    if (a === "bind") {
      if (!hasChat()) return toast("请先打开一个聊天");
      const meta = chatMeta();
      const ck = currentCharKey();
      const cname = currentCharName();
      const cur = meta[META_KEY] === s.id ? "chat" : ck && settings().schemeCharBind?.[ck] === s.id ? "char" : "none";
      const v = await pickBox(`「${s.name}」什么时候自动套用`, [
        { label: `${cur === "chat" ? "✓ " : ""}进入这个聊天时`, sub: "只对当前这个聊天生效", value: "chat" },
        ...(ck ? [{ label: `${cur === "char" ? "✓ " : ""}进入「${cname}」的任何聊天时`, sub: "这个角色的新旧聊天都生效；单个聊天另有绑定时，以聊天的为准", value: "char" }] : []),
        { label: `${cur === "none" ? "✓ " : ""}不自动套用`, sub: "只在你点「切换到此方案」时切换", value: "none" }
      ], { hint: "自动套用只在进入聊天时切换一次。之后手动换预设、改开关，不会被改回来。" });
      if (!v || v === cur) return;
      if (!settings().schemeCharBind || typeof settings().schemeCharBind !== "object") settings().schemeCharBind = {};
      const cb = settings().schemeCharBind;
      // 先清掉这个方案在当前聊天、当前角色上的旧绑定
      if (meta[META_KEY] === s.id) delete meta[META_KEY];
      if (ck && cb[ck] === s.id) delete cb[ck];
      if (v === "chat") meta[META_KEY] = s.id;
      if (v === "char" && ck) cb[ck] = s.id;
      await saveChatMeta();
      saveSettings();
      // 刚绑定的这个聊天算已经处理过，不会马上又切换一次
      markChatHandled();
      toast(v === "none" ? "已取消自动套用" : `已设置：进入${v === "chat" ? "这个聊天" : `「${cname}」的聊天`}时自动切换到「${s.name}」`, "success");
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

