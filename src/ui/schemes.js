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
async function applyScheme(scheme, { quiet = false, why = "", silent = false } = {}) {
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
  scheme.usedAt = Date.now();
  saveSettings();
  if (!silent) toast(`${why ? `自动套用（${why}）：` : "已切换到"}「${scheme.name}」${scheme.persona ? `，人设：${scheme.personaName || ""}` : ""}${site ? `，API：${site.name}` : ""}`, "success");
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
// 方案按角色卡归类（也可切到按预设、按人设看）。每条方案记：角色卡、预设、人设、API 站点、时间。
// 归属角色卡：保存时在聊天里就记当前角色卡；旧方案没有记录的，看有没有绑定在某个角色上，否则归「未分角色」
function schemeCharKey(s) {
  if (s.charKey) return s.charKey;
  const cb = settings().schemeCharBind || {};
  return Object.keys(cb).find((k) => cb[k] === s.id) || "";
}
function charNameOf(key) {
  if (!key) return "未分角色";
  const c = ctx();
  if (key.startsWith("group:")) return c.groups?.find((g) => "group:" + g.id === key)?.name || "群聊";
  return c.characters?.find((x) => x.avatar === key)?.name || key.replace(/\.png$/i, "");
}
function shortTime(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
function mountSchemes(page, { after } = {}) {
  const VIEWS = [["char", "角色卡"], ["preset", "预设"], ["persona", "人设"]];
  page.innerHTML = `
        <div class="pa-row-head"><h3 class="pa-h">方案</h3><button class="pa-btn pa-btn-primary pa-btn-s pa-head-btn" data-s="new">保存当前状态为方案</button></div>
        <div class="pa-scheme-bar"><span class="pa-dim">按</span><button class="pa-namebtn pa-namebtn-s" data-s="view" type="button"><span></span><i aria-hidden="true">▾</i></button><span class="pa-dim">分组</span><span class="pa-scheme-pick"></span></div>
        ${tip("方案记下预设、一组条目开关，可同时记下人设和 API 站点。<br>「切换」：把预设、开关、人设、API 一次换成方案记的样子。<br>✏️ 里可以重命名、用现在的状态覆盖、换 API 站点、改记录范围、设置自动套用、改归属角色、删除。<br>「自动套用」：绑定本聊天或本角色后，进入那个聊天时自动切换一次；之后你手动换预设、改开关，不会被改回来。")}
        <div class="pa-scheme-nudge"></div>
        <div class="pa-schemes"></div>`;
  const box = page.querySelector(".pa-schemes");
  const nudge = page.querySelector(".pa-scheme-nudge");
  const all = () => settings().schemes;
  const open = new Set();
  let opened = false;
  // 🗑️ 勾选删除
  let picking = false;
  const picked = new Set();
  const view = () => VIEWS.some(([k]) => k === settings().schemeView) ? settings().schemeView : "char";
  const groupKey = (s) => view() === "preset" ? s.preset : view() === "persona" ? s.persona ? s.personaName || s.persona : "" : schemeCharKey(s);
  const groupName = (k) => view() === "char" ? charNameOf(k) : k || (view() === "persona" ? "没记人设" : "");
  function row(s, d) {
    const bind = bindingNow();
    const bound = bind?.id === s.id ? bind.scope : null;
    // 「使用中」要和酒馆实际生效的一致：预设正在用、开关一致、人设和 API 站点也对得上
    const switchesOk = !!d && s.preset === d.name && schemeMatches(d, s);
    const site = s.siteId ? settings().sites.find((x) => x.id === s.siteId) : null;
    const on = switchesOk && currentPresetName() === s.preset && (!s.persona || currentPersona() === s.persona) && (!site || !siteDiffers(site, { ...liveConnection(), online: true }));
    const archived = !listPresets().includes(s.preset) && archiveList().some((x) => x.name === s.preset);
    const meta = [
      view() !== "preset" ? esc(s.preset) + (archived ? "（已归档）" : "") : "",
      view() !== "persona" ? s.persona ? esc(s.personaName || s.persona) : "" : "",
      view() !== "char" && schemeCharKey(s) ? esc(charNameOf(schemeCharKey(s))) : "",
      shortTime(Math.max(s.usedAt || 0, s.at || 0))
    ].filter(Boolean).join(" · ");
    if (picking) return `<label class="pa-srow pa-srow-pick" data-id="${esc(s.id)}"><input type="checkbox" data-a="pick" ${picked.has(s.id) ? "checked" : ""}>
        <div class="pa-srow-main"><b>${esc(s.name)}</b>${bound ? `<span class="pa-chip pa-chip-cot">🔗${BIND_LABEL[bound]}</span>` : ""}<small>${meta}</small></div></label>`;
    return `<div class="pa-srow${on ? " pa-srow-on" : ""}" data-id="${esc(s.id)}">
        <div class="pa-srow-main"><b>${esc(s.name)}</b>${on ? '<span class="pa-chip">使用中</span>' : switchesOk ? '<span class="pa-chip pa-chip-dim" title="条目开关和方案一致，但预设、人设或 API 站点不是方案记录的">开关一致</span>' : ""}${bound ? `<span class="pa-chip pa-chip-cot" title="进入${bound === "chat" ? "这个聊天" : "这个角色的聊天"}时自动切换到它">🔗${BIND_LABEL[bound]}</span>` : ""}
        <small>${meta}</small></div>
        <button class="pa-btn pa-btn-s${on ? "" : " pa-btn-primary"}" data-a="apply" title="把预设、开关、人设、API 一次换成方案记的样子">切换</button>
        <button class="pa-icon-btn" data-a="edit" aria-label="编辑方案" title="编辑">✏️</button></div>`;
  }
  function render() {
    let d = null;
    try {
      d = getDraft(currentPresetName());
    } catch {
    }
    page.querySelector('[data-s="view"] span').textContent = VIEWS.find(([k]) => k === view())[1];
    for (const id of [...picked]) if (!all().some((x) => x.id === id)) picked.delete(id);
    if (picking && !all().length) picking = false;
    page.querySelector(".pa-scheme-pick").innerHTML = picking
      ? `<span class="pa-dim">已选 ${picked.size} 个</span><button class="pa-btn pa-btn-s pa-btn-danger" data-s="delpicked" ${picked.size ? "" : "disabled"}>删除</button><button class="pa-btn pa-btn-s" data-s="pickoff">取消</button>`
      : all().length ? '<button class="pa-icon-btn" data-s="pickon" aria-label="勾选删除方案" title="勾选删除方案">🗑️</button>' : "";
    page.classList.toggle("pa-schemes-picking", picking);
    // 当前角色在用的预设还没有方案：提示一句
    const ck = hasChat() ? currentCharKey() : null;
    const cur = currentPresetName();
    nudge.innerHTML = ck && cur && !all().some((s) => schemeCharKey(s) === ck && s.preset === cur)
      ? `<div class="pa-nudge">「${esc(currentCharName())}」还没有「${esc(cur)}」的方案<button class="pa-link" data-s="new">保存一个</button></div>` : "";
    if (!all().length) {
      box.innerHTML = '<p class="pa-empty">还没有方案。先开启需要的条目、连好 API，再点「保存当前状态为方案」。</p>';
      return after?.();
    }
    const groups = new Map();
    for (const s of all()) {
      const k = groupKey(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const t = (s) => Math.max(s.usedAt || 0, s.at || 0);
    // 当前角色（或当前预设、当前人设）那一组排最前，其余按最近用过排；「未分角色」放最后
    const mineKey = view() === "char" ? ck || "" : view() === "preset" ? cur : listPersonas().find((p) => p.avatar === currentPersona())?.name || "";
    const keys = [...groups.keys()].sort((a, b) => (b === mineKey) - (a === mineKey) || (!a) - (!b) || Math.max(...groups.get(b).map(t)) - Math.max(...groups.get(a).map(t)));
    if (!opened) {
      opened = true;
      if (groups.has(mineKey)) open.add(view() + "|" + mineKey);
      else if (keys[0] !== void 0) open.add(view() + "|" + keys[0]);
    }
    box.innerHTML = keys.map((k) => {
      const list = groups.get(k).sort((a, b) => t(b) - t(a));
      const isOpen = open.has(view() + "|" + k);
      return `<section class="pa-sgroup${isOpen ? " open" : ""}" data-k="${esc(k)}">
          <header class="pa-sghead" data-a="fold" tabindex="0"><span class="pa-sgcaret">${isOpen ? "▾" : "▸"}</span>${picking ? `<input type="checkbox" data-a="pickgroup" aria-label="选中这一组" ${list.every((s) => picked.has(s.id)) ? "checked" : ""}>` : ""}<b>${esc(groupName(k))}</b>${k === mineKey && k ? '<span class="pa-chip pa-chip-dim">当前</span>' : ""}<small>${list.length} 个方案</small></header>
          ${isOpen ? `<div class="pa-sgbody">${list.map((s) => row(s, d)).join("")}</div>` : ""}</section>`;
    }).join("");
    after?.();
  }
  async function saveNew() {
    let d;
    try { d = getDraft(currentPresetName()); } catch (e) { return toast(e.message, "error"); }
    const persona = currentPersona();
    const personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
    const groups = d.groups.groups;
    const site = settings().sites.find((x) => x.id === settings().activeSiteId);
    const ck = hasChat() ? currentCharKey() : null;
    const cname = ck ? currentCharName() : "";
    const prevBound = hasChat() ? all().find((x) => x.id === chatMeta()[META_KEY]) : null;
    const body = el(`<div class="pa-form">
            <label class="pa-field"><span>方案名称</span><input class="pa-input" data-f="name" value="${esc(d.name)}" placeholder="例如：纯爱、年上"></label>
            <p class="pa-hint">预设：${esc(d.name)}</p>
            ${ck ? `<label class="pa-inline-check"><input type="checkbox" data-f="char" checked> 记到角色「${esc(cname)}」下面</label>
            <label class="pa-inline-check"><input type="checkbox" data-f="bind"> 进入这个聊天时自动切换到它${prevBound ? `（会替换原来绑定的「${esc(prevBound.name)}」）` : ""}</label>` : '<p class="pa-hint">不在聊天里，方案会放在「未分角色」，之后可在 ✏️ 里改归属。</p>'}
            ${persona ? `<label class="pa-inline-check"><input type="checkbox" data-f="persona" checked> 同时记下人设「${esc(personaName || persona)}」</label>` : ""}
            ${site ? `<label class="pa-inline-check"><input type="checkbox" data-f="site" checked> 同时记下 API 站点「${esc(site.name)}」</label>` : '<p class="pa-hint">当前连接还没存成站点，不能记下 API。可先在上方点「保存为站点」。</p>'}
            <details class="pa-tip"><summary>记录范围：${groups.length ? "勾选的分组" : "全部条目"}</summary><div class="pa-tip-body">
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="groups" ${groups.length ? "checked" : "disabled"}> 只记录勾选的分组（其他条目不受影响）</label>
                <div class="pa-groups-pick">${groups.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${LIKELY.test(g.name) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || '<p class="pa-hint">此预设暂无分组</p>'}</div>
                <label class="pa-inline-check"><input type="radio" name="pa-scope" value="all" ${groups.length ? "" : "checked"}> 记录全部条目</label></div></details>
        </div>`);
    const r = await sheet({
      title: "保存为方案", body, wide: true,
      actions: [{ label: "取消", value: null }, {
        label: "保存", kind: "primary",
        validate: (w) => {
          if (!w.querySelector("[data-f=name]").value.trim()) { toast("请填写方案名称"); return false; }
          return true;
        },
        value: (w) => ({
          name: w.querySelector("[data-f=name]").value.trim(),
          scope: w.querySelector("input[name=pa-scope]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g),
          persona: !!w.querySelector("[data-f=persona]")?.checked,
          site: !!w.querySelector("[data-f=site]")?.checked,
          char: !!w.querySelector("[data-f=char]")?.checked,
          bind: !!w.querySelector("[data-f=bind]")?.checked
        })
      }]
    });
    if (!r) return;
    if (Array.isArray(r.scope) && !r.scope.length) return toast("请至少勾选一个分组，或选择记录全部条目", "warning");
    const s = { id: uid(), name: r.name, preset: d.name, scope: r.scope, persona: r.persona ? persona : null, personaName: r.persona ? personaName : "", siteId: r.site && site ? site.id : null, charKey: r.char && ck ? ck : "", at: Date.now(), usedAt: Date.now() };
    Object.assign(s, schemeStates(d, s));
    all().push(s);
    if (r.bind && hasChat()) {
      chatMeta()[META_KEY] = s.id;
      await saveChatMeta();
      markChatHandled();
    }
    saveSettings();
    open.add(view() + "|" + groupKey(s));
    toast(`已保存方案「${s.name}」${r.bind ? "，进入这个聊天时会自动切换到它" : ""}`, "success");
    render();
  }
  async function editMenu(s) {
    const site = s.siteId ? settings().sites.find((x) => x.id === s.siteId) : null;
    const bind = bindingNow();
    const v = await pickBox(`✏️ ${s.name}`, [
      { label: "重命名", value: "rename" },
      { label: "用现在的状态覆盖", sub: `把方案改成「${s.preset}」现在的开关${s.persona ? "、人设" : ""}${s.siteId ? "、API 站点" : ""}`, value: "update" },
      { label: "换 API 站点", sub: site ? `现在：${site.name}` : "现在：不切换 API", value: "site" },
      { label: "记录范围", sub: s.scope === "all" ? "现在：全部条目" : `现在：${s.scope.length} 个分组`, value: "scope" },
      { label: "自动套用", sub: bind?.id === s.id ? `现在：${bind.scope === "chat" ? "进入这个聊天时" : "进入这个角色的聊天时"}` : "现在：不自动套用", value: "bind" },
      { label: "改归属角色", sub: `现在：${charNameOf(schemeCharKey(s))}`, value: "char" },
      { label: "删除方案", sub: "预设不受影响", value: "del" }
    ]);
    if (!v) return;
    if (v === "rename") {
      const n = await promptBox("方案名称", s.name);
      if (n) { s.name = n; saveSettings(); }
    }
    if (v === "update") {
      let d;
      try { d = getDraft(s.preset); } catch (e) { return toast(e.message, "error"); }
      if (!await confirmBox("用现在的状态覆盖", `用「${s.preset}」现在的开关${s.persona ? "、人设" : ""}${s.siteId ? "、API 站点" : ""}覆盖方案「${s.name}」？`, "覆盖")) return;
      Object.assign(s, schemeStates(d, s));
      const persona = currentPersona();
      if (s.persona && persona) {
        s.persona = persona;
        s.personaName = listPersonas().find((p) => p.avatar === persona)?.name || "";
      }
      if (s.siteId && settings().activeSiteId) s.siteId = settings().activeSiteId;
      s.at = Date.now();
      saveSettings();
      toast("方案已更新", "success");
    }
    if (v === "site") {
      const sites = settings().sites;
      const pick = await pickBox("切换方案时连哪个 API 站点", [...sites.map((x) => ({ label: `${x.id === s.siteId ? "✓ " : ""}${x.name}`, sub: x.model || "", value: x.id })), { label: `${s.siteId ? "" : "✓ "}不切换 API`, value: "__none" }]);
      if (!pick) return;
      s.siteId = pick === "__none" ? null : pick;
      saveSettings();
    }
    if (v === "scope") {
      let d;
      try { d = getDraft(s.preset); } catch (e) { return toast(`读不到预设「${s.preset}」：${e.message}`, "error"); }
      const gs = d.groups.groups;
      const body = el(`<div class="pa-form"><p class="pa-hint">改范围后，按「${esc(s.preset)}」现在的开关重新记录。</p>
          <label class="pa-inline-check"><input type="radio" name="pa-scope2" value="groups" ${s.scope !== "all" ? "checked" : ""} ${gs.length ? "" : "disabled"}> 只记录勾选的分组</label>
          <div class="pa-groups-pick">${gs.map((g) => `<label class="pa-inline-check"><input type="checkbox" data-g="${esc(g.id)}" ${s.scope !== "all" && s.scope.includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`).join("")}</div>
          <label class="pa-inline-check"><input type="radio" name="pa-scope2" value="all" ${s.scope === "all" ? "checked" : ""}> 记录全部条目</label></div>`);
      const r = await sheet({ title: "记录范围", body, wide: true, actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (w) => w.querySelector("input[name=pa-scope2]:checked")?.value === "all" ? "all" : [...w.querySelectorAll("[data-g]:checked")].map((x) => x.dataset.g) }] });
      if (!r) return;
      if (Array.isArray(r) && !r.length) return toast("请至少勾选一个分组，或选择记录全部条目", "warning");
      s.scope = r;
      Object.assign(s, schemeStates(d, s));
      s.at = Date.now();
      saveSettings();
      toast("记录范围已更新", "success");
    }
    if (v === "bind") return bindMenu(s);
    if (v === "char") {
      const chars = (ctx().characters || []).filter((x) => x?.avatar);
      const ck = schemeCharKey(s);
      const pick = await pickName({ title: "归到哪个角色卡", current: ck || "__none", items: [{ value: "__none", label: "未分角色" }, ...chars.map((x) => ({ value: x.avatar, label: x.name }))] });
      if (!pick) return;
      s.charKey = pick === "__none" ? "" : pick;
      saveSettings();
    }
    if (v === "del") {
      if (!await confirmBox("删除方案", `删除「${s.name}」？预设不受影响。`, "删除", true)) return;
      await removeSchemes([s.id]);
    }
    render();
  }
  async function removeSchemes(ids) {
    const gone = new Set(ids);
    settings().schemes = all().filter((x) => !gone.has(x.id));
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
      { label: `${cur === "chat" ? "✓ " : ""}进入这个聊天时`, sub: "只对当前这个聊天生效", value: "chat" },
      ...(ck ? [{ label: `${cur === "char" ? "✓ " : ""}进入「${cname}」的任何聊天时`, sub: "这个角色的新旧聊天都生效；单个聊天另有绑定时，以聊天的为准", value: "char" }] : []),
      { label: `${cur === "none" ? "✓ " : ""}不自动套用`, sub: "只在你点「切换」时切换", value: "none" }
    ], { hint: "自动套用只在进入聊天时切换一次。之后手动换预设、改开关，不会被改回来。" });
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
    render();
  }
  page.addEventListener("click", async (e) => {
    const sv = e.target.closest("[data-s]")?.dataset.s;
    if (sv === "new") return saveNew();
    if (sv === "pickon" || sv === "pickoff") {
      picking = sv === "pickon";
      picked.clear();
      return render();
    }
    if (sv === "delpicked") {
      const names = all().filter((x) => picked.has(x.id)).map((x) => `「${x.name}」`);
      if (!names.length) return;
      if (!await confirmBox("删除方案", `删除 ${names.length} 个方案：${names.slice(0, 6).join("、")}${names.length > 6 ? " 等" : ""}？预设不受影响。`, "删除", true)) return;
      await removeSchemes([...picked]);
      picking = false;
      picked.clear();
      toast(`已删除 ${names.length} 个方案`, "success");
      return render();
    }
    if (sv === "view") {
      const v = await pickName({ title: "方案按什么分组", current: view(), search: false, items: VIEWS.map(([k, l]) => ({ value: k, label: l })) });
      if (!v) return;
      settings().schemeView = v;
      saveSettings();
      opened = false;
      return render();
    }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "pickgroup") {
      const k = e.target.closest(".pa-sgroup").dataset.k;
      const ids = all().filter((x) => String(groupKey(x)) === k).map((x) => x.id);
      for (const id of ids) e.target.checked ? picked.add(id) : picked.delete(id);
      if (e.target.checked) open.add(view() + "|" + k);
      return render();
    }
    if (a === "pick") {
      const id = e.target.closest(".pa-srow").dataset.id;
      e.target.checked ? picked.add(id) : picked.delete(id);
      return render();
    }
    if (picking && e.target.closest(".pa-srow")) return;
    if (a === "fold") {
      const k = view() + "|" + e.target.closest(".pa-sgroup").dataset.k;
      open.has(k) ? open.delete(k) : open.add(k);
      return render();
    }
    const rowEl = e.target.closest(".pa-srow");
    const s = rowEl && all().find((x) => x.id === rowEl.dataset.id);
    if (!s) return;
    if (a === "apply") {
      await applyScheme(s);
      setFocusPreset(s.preset);
      render();
    }
    if (a === "edit") return editMenu(s);
  });
  page.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".pa-sghead")) { e.preventDefault(); e.target.click(); }
  });
  const off = onDraftChange(() => {
    if (page.isConnected && !page.hidden) render();
  });
  return { render, destroy: off };
}
