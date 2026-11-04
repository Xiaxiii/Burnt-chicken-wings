// 「备份」页：自动备份的开关和份数；本浏览器里的全部备份按预设（世界书）分组，可恢复、下载、精简、清空。
// 备份只存在本浏览器（IndexedDB），每批修改开始前存一份修改前的版本
const WB_BACKUP_PREFIX = "世界书：";
function backupFileStamp(t) {
  return new Date(t).toISOString().slice(0, 16).replace(/[:T]/g, "");
}
function mountBackupPage(page) {
  page.innerHTML = String(html`<div class="cw-body"><div class="cw-col cw-backup">
      <section class="cw-sec"><div class="cw-sec-h"><h3>自动备份</h3></div><div class="cw-setlist" data-r="set"></div></section>
      <section class="cw-sec" data-r="sum"></section>
      <section class="cw-sec" data-r="list"></section>
    </div></div>`);
  const $ = (k) => page.querySelector(`[data-r="${k}"]`);
  let info = null;
  let busy = false;
  const open = new Set();
  async function load() {
    const all = await backupAll().catch(() => []);
    const by = new Map();
    for (const b of all) {
      const g = by.get(b.preset) || by.set(b.preset, { name: b.preset, list: [], size: 0 }).get(b.preset);
      g.list.push(b);
      g.size += jsonSize(b.data);
    }
    for (const g of by.values()) g.list.sort((a, b) => b.time - a.time);
    let drafts = 0, draftN = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("presetAtelier:recovery:")) { draftN++; drafts += (localStorage.getItem(k) || "").length * 2; }
      }
    } catch {}
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const groups = [...by.values()];
    // 当前预设排最前，其余按大小
    const cur = focusPreset();
    groups.sort((a, b) => (b.name === cur) - (a.name === cur) || b.size - a.size);
    info = { groups, total: groups.reduce((n, g) => n + g.size, 0), count: all.length, drafts, draftN, est };
  }
  function drawSet() {
    const on = backupOn(), n = backupMax();
    $("set").innerHTML = String(html`
      <label class="cw-setrow"><span><b>修改前自动备份</b><small>${on ? "每批修改开始前，存一份修改前的版本。世界书缝合、编辑前的备份同样适用" : "已关闭。此后的修改无法从备份恢复"}</small></span>${switchHtml({ act: "bk-on", on, label: "修改前自动备份" })}</label>
      <div class="cw-setrow${on ? "" : " is-disabled"}"><span><b>每个预设保留</b><small>超出的旧备份在下次修改时清理</small></span>
        <span class="cw-stepper"><button type="button" data-act="bk-dec" aria-label="减少"${on && n > 1 ? "" : raw(" disabled")}>${iconHtml("minus")}</button><input class="cw-input" data-act="bk-n" inputmode="numeric" aria-label="保留份数" value="${n}"${on ? "" : raw(" disabled")}><button type="button" data-act="bk-inc" aria-label="增加"${on && n < 30 ? "" : raw(" disabled")}>${iconHtml("plus")}</button><small>份</small></span></div>`);
  }
  const extra = () => {
    const n = backupMax();
    const over = (info?.groups || []).filter((g) => g.list.length > n);
    const list = over.flatMap((g) => g.list.slice(n));
    return { n, groups: over.length, list, size: list.reduce((t, b) => t + jsonSize(b.data), 0) };
  };
  function draw() {
    drawSet();
    if (!info) { $("sum").innerHTML = String(html`<p class="cw-hint">正在统计…</p>`); $("list").innerHTML = ""; return; }
    const ex = extra();
    $("sum").innerHTML = String(html`<div class="cw-sum"><div class="cw-sum-h"><p class="cw-sum-main">备份 <b>${info.count}</b> 份 · <b>${fmtSize(info.total)}</b>${info.draftN ? ` · 未保存的草稿 ${info.draftN} 份` : ""}</p><span class="cw-gap"></span>${tipBtn()}</div>
      ${tipNote(`<p>这些备份只存在这个浏览器里，换设备或清除网站数据后丢失，重要版本请下载。占用过多时，iPad、手机可能清除网站数据或重新加载页面。</p>${info.draftN ? `<p>未保存的草稿约 ${fmtSize(info.drafts)}。</p>` : ""}${info.est?.usage ? `<p>这个网站在本浏览器中共占用约 ${fmtSize(info.est.usage)}（含酒馆和其他扩展）。</p>` : ""}`)}
      <div class="cw-card-acts">${btn(ex.list.length ? `精简 ${ex.list.length} 份` : "立即精简", { act: "bk-trim", size: "sm", disabled: !ex.list.length, title: `只留每个预设最近 ${ex.n} 份` })}${btn("删除全部备份", { act: "bk-clear", size: "sm", kind: "danger", disabled: !info.count })}</div></div>`);
    if (!info.groups.length) { $("list").innerHTML = String(empty("没有备份。")); return; }
    const max = info.groups[0] ? Math.max(...info.groups.map((g) => g.size)) : 1;
    const presets = new Set(listPresets());
    $("list").innerHTML = String(html`<div class="cw-sec-h"><h3>按预设</h3><small>${info.groups.length} 个</small></div>
      <div class="cw-bkgroups">${info.groups.map((g) => {
        const isWb = g.name.startsWith(WB_BACKUP_PREFIX);
        const can = !isWb && presets.has(g.name);
        const on = open.has(g.name);
        return html`<section class="cw-bkgroup${on ? " is-open" : ""}" data-name="${g.name}">
          <button type="button" class="cw-bkgroup-h" data-act="bk-fold" aria-expanded="${on}">${iconHtml(on ? "chevDown" : "chev")}<span class="cw-bkgroup-name"><b>${isWb ? g.name.slice(WB_BACKUP_PREFIX.length) : g.name}</b>${isWb ? pill("世界书", "line") : g.name === focusPreset() ? pill("当前预设", "accent") : can ? "" : pill("预设已不在", "muted")}</span>
            <span class="cw-bkgroup-meta">${sizeBar(g.size, max)}<em>${g.list.length} 份 · ${fmtSize(g.size)}</em></span></button>
          ${on ? html`<div class="cw-bklist">${g.list.map((b) => html`<div class="cw-bkrow" data-id="${b.id}"><div class="cw-bkrow-main"><b>${new Date(b.time).toLocaleString()}</b><small>${b.reason || ""} · ${fmtSize(jsonSize(b.data))}</small></div>
              ${can ? btn("恢复", { act: "bk-restore", size: "sm", title: "恢复后自动保存，可撤销" }) : ""}${ibtn("fileOut", "下载 JSON 文件", { act: "bk-dl" })}</div>`)}</div>` : ""}</section>`;
      })}</div>`);
  }
  const setMax = (v) => {
    settings().backupMax = Math.min(30, Math.max(1, Math.round(Number(v)) || backupMax()));
    saveSettings();
    draw();
  };
  page.addEventListener("change", (e) => {
    const a = e.target.dataset?.act;
    if (a === "bk-on") { settings().autoBackup = e.target.checked; saveSettings(); draw(); }
    else if (a === "bk-n") setMax(e.target.value);
  });
  page.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]");
    const a = b?.dataset.act;
    if (!a || busy) return;
    if (a === "bk-dec" || a === "bk-inc") return setMax(backupMax() + (a === "bk-inc" ? 1 : -1));
    if (a === "bk-fold") {
      const name = b.closest("[data-name]").dataset.name;
      open.has(name) ? open.delete(name) : open.add(name);
      return draw();
    }
    if (a === "bk-restore" || a === "bk-dl") {
      const name = b.closest("[data-name]").dataset.name;
      const g = info?.groups.find((x) => x.name === name);
      const bk = g?.list.find((x) => String(x.id) === b.closest("[data-id]").dataset.id);
      if (!bk) return;
      if (a === "bk-dl") {
        const base = name.startsWith(WB_BACKUP_PREFIX) ? name.slice(WB_BACKUP_PREFIX.length) : name;
        return downloadBlob(new Blob([JSON.stringify(bk.data, null, 4)], { type: "application/json" }), `${base}-备份-${backupFileStamp(bk.time)}.json`);
      }
      if (!await confirmBox("恢复备份", `把「${name}」恢复到 ${new Date(bk.time).toLocaleString()} 的版本？恢复后自动保存，可在顶栏撤销。`, "恢复")) return;
      try {
        const d = getDraft(name);
        mutate(d, "恢复备份", (x) => x.replaceWith(bk.data));
        toast(`已恢复「${name}」`, "success");
      } catch (err) {
        toast("恢复失败：" + err.message, "error");
      }
      return;
    }
    if (!info) return;
    let del;
    if (a === "bk-clear") {
      if (!await confirmBox("删除全部备份", `删除本浏览器中的全部 ${info.count} 份备份。`, "删除", true)) return;
      del = info.groups.flatMap((g) => g.list);
    } else if (a === "bk-trim") {
      const ex = extra();
      if (!ex.list.length) return;
      if (!await confirmBox(`精简至每个预设 ${ex.n} 份`, `${ex.groups} 个预设超出，共 ${ex.list.length} 份，${fmtSize(ex.size)}。`, `删除 ${ex.list.length} 份`, true)) return;
      del = ex.list;
    } else return;
    busy = true;
    for (const x of del) await backupDel(x.id).catch(() => {});
    busy = false;
    toast(`已删除 ${del.length} 份备份`, "success");
    info = null;
    draw();
    await load();
    draw();
  });
  // 打开「备份」时，当前预设的那一组默认展开
  async function render() {
    if (!info) draw();
    await load();
    if (!open.size && info.groups.some((g) => g.name === focusPreset())) open.add(focusPreset());
    draw();
  }
  return { render };
}
