// 酒馆扩展页里的设置框：打开、名称、版本与更新、入口、防止下拉误刷新、加载与兼容、更新说明。
// 设置框在酒馆自己的界面里，按钮、开关沿用酒馆的样式（menu_button、checkbox_label、text_pole）
function compatCardHtml() {
  return html`<details class="cw-set-fold" data-r="compat"><summary><span class="cw-set-fold-t">加载与兼容</span><small class="cw-set-sum"></small></summary>
    <div class="cw-set-fold-body"><div class="cw-set-quick"></div><div class="cw-set-full"></div>
      <div class="cw-set-btns"><div class="menu_button menu_button_icon" data-c="check" tabindex="0" role="button"><i class="fa-solid fa-stethoscope"></i><span>检查兼容性</span></div></div></div></details>`;
}
// 维护模块的小卡片：平时只显示不用发请求就能知道的状态；详细检查点按钮才做
function mountCompatCard(box) {
  const yes = (v) => v === true ? "是" : v === false ? "否" : "未知";
  const names = { baibaiTools: "柏宝箱", cocktail: "鸡尾酒", cocktailPlus: "鸡尾酒+", tavernHelper: "酒馆助手" };
  const runningOf = (q) => Object.entries(q.running).filter(([, v]) => v).map(([k]) => names[k]);
  function quickHtml() {
    const q = compatQuick();
    const running = runningOf(q);
    const bridges = [q.bridges.baibaoku && "柏宝库", q.bridges.cocktailPlus && "鸡尾酒+"].filter(Boolean);
    const t = q.takeover.settingsRead;
    const via = !t?.seen ? "没有记录到" : [...(t.providers || []).map((p) => `${p}接口`), ...(t.viaSw ? [`Service Worker（${q.sw?.owner || "提供者未知"}）`] : []), ...(t.plain ? ["酒馆原接口"] : [])].join("、");
    return html`<dl class="cw-set-kv">
        <dt>已在运行的相关扩展</dt><dd>${running.length ? running.join("、") : "未发现"}</dd>
        <dt>启动桥接</dt><dd>${bridges.length ? `${bridges.join("、")}（已加载）` : "未发现"}</dd>
        <dt>Service Worker</dt><dd>${q.sw ? q.sw.owner ? `由${q.sw.owner}控制` : "有，提供者未知" : q.secure ? "没有" : "当前是 HTTP 访问，浏览器不允许使用"}</dd>
        <dt>本次设置读取</dt><dd>${via}</dd>
        <dt>本扩展的读取加速</dt><dd>未提供</dd></dl>
      <p class="cw-set-note">本扩展只做检测和体检，不接管任何请求，也不改其他扩展的开关。${q.secure ? "" : "HTTP 访问只影响 Service Worker 类的缓存，接口类加速不受这个限制。"}</p>`;
  }
  function fullHtml(c) {
    const areas = areaStatus(c);
    return html`${c.extErr ? html`<p class="cw-set-note cw-set-bad">读取扩展列表失败：${c.extErr}</p>` : ""}
      <div class="cw-set-tablewrap"><table class="cw-set-table"><thead><tr><th></th><th>安装</th><th>开启</th><th>后端</th><th>运行中</th><th>版本</th></tr></thead><tbody>
        ${c.rows.map((r) => html`<tr><th>${r.name}</th><td>${r.installed == null ? "未知" : r.installed ? "已安装" : "未安装"}</td><td>${r.enabled === undefined ? "—" : yes(r.enabled)}</td><td>${r.backend ? r.backend === "ok" ? "可用" : "不可用" : "—"}</td><td>${r.running == null ? "—" : yes(r.running)}</td><td>${r.backendVersion || r.version || "—"}<small>${r.level}</small></td></tr>`)}</tbody></table></div>
      <p class="cw-set-note">「已识别但未验证」：核对过这个版本的源码，但没有在真实酒馆里和本扩展一起测试过；「未知」：没核对过的版本，本扩展默认不接管任何相关请求。</p>
      <ul class="cw-set-areas">${areas.map((a) => html`<li><b>${a.label}</b>：${a.who.length ? a.who.map((w) => `${w.name}（${w.state}）`).join("、") : "没有发现提供者"}${a.seen.length ? `；本次实际走了 ${a.seen.join("、")}` : ""}${a.overlap === "yes" ? html`<em class="cw-set-bad">重叠：同一请求可能被两个功能接管，建议只保留一个</em>` : a.overlap === "maybe" ? html`<em class="cw-set-bad">可能重叠：开关状态读不到，请到对应扩展里确认只开了一个</em>` : ""}<small>本扩展：${a.rule}</small></li>`)}</ul>`;
  }
  const sumText = () => { const r = runningOf(compatQuick()); return r.length ? `在运行：${r.join("、")}` : "没发现相关扩展"; };
  const full = box.querySelector(".cw-set-full");
  const refresh = () => {
    box.querySelector(".cw-set-quick").innerHTML = String(quickHtml());
    box.querySelector(".cw-set-sum").textContent = sumText();
  };
  refresh();
  let busy = false;
  const handler = async (e) => {
    const b = e.target.closest("[data-c]");
    if (!b || !box.contains(b)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.c !== "check" || busy) return;
    busy = true;
    b.querySelector("i")?.classList.add("fa-spin");
    full.innerHTML = String(html`<p class="cw-set-note">正在检查…（读取扩展列表、探测柏宝库和鸡尾酒+ 的后端）</p>`);
    try {
      const c = await compatFull();
      refresh();
      full.innerHTML = String(fullHtml(c));
    } catch (er) {
      full.innerHTML = String(html`<p class="cw-set-note cw-set-bad">检查出错：${er.message}</p>`);
    } finally {
      b.querySelector("i")?.classList.remove("fa-spin");
      busy = false;
    }
  };
  box.addEventListener("click", handler);
  box.addEventListener("keydown", handler);
  return { refresh };
}
function addSettingsEntry() {
  if (document.getElementById("cw-settings")) return;
  const host2 = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
  if (!host2) return;
  const log = changelogSections();
  const scriptKind = BUILD_KIND === "extension" ? "" : " · 脚本版";
  const nameRow = () => html`<span class="cw-set-k">名称</span><span class="cw-set-v cw-appname">${appName()}</span><div class="menu_button menu_button_icon cw-set-mini" data-a="rename" tabindex="0" role="button" title="修改名称（留空恢复默认）"><i class="fa-solid fa-pencil"></i><span>修改</span></div>`;
  const box = el(html`<div id="cw-settings" class="cw-set">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b><span class="cw-appname">${appName()}</span><span class="cw-set-badge">${VERSION}</span></b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <p class="cw-set-intro">预设条目整理、跨预设缝合、思维链与变量检查、回复格式检查、连接与方案、加载体检、清理。</p>
        <div class="cw-set-btns">
          <div class="menu_button menu_button_icon cw-set-main" data-a="open" tabindex="0" role="button"><i class="fa-solid fa-scissors"></i><span>打开<span class="cw-appname">${appName()}</span></span></div>
          <div class="menu_button menu_button_icon" data-a="health" tabindex="0" role="button"><i class="fa-solid fa-gauge-high"></i><span>加载体检</span></div>
        </div>
        <div class="cw-set-card">
          <div class="cw-set-row" data-r="name">${nameRow()}</div>
          <div class="cw-set-row"><span class="cw-set-k">版本</span><span class="cw-set-v">${VERSION}${scriptKind}<small class="cw-set-by">by EC</small></span>
            ${EXT_DIR ? html`<div class="menu_button menu_button_icon cw-set-mini" data-a="check" tabindex="0" role="button"><i class="fa-solid fa-rotate"></i><span>检查更新</span></div>` : ""}</div>
          <div class="cw-set-status" hidden></div>
          <div class="cw-set-row"><span class="cw-set-k">入口</span><select class="text_pole cw-set-select" data-opt="entry" aria-label="入口">${ENTRY_MODES.map(([k, l]) => html`<option value="${k}"${k === entryMode() ? raw(" selected") : ""}>${l}</option>`)}</select></div>
          <p class="cw-set-note cw-noentry"${entryMode() === "none" ? "" : raw(" hidden")}>${NO_ENTRY_NOTE}</p>
          <div class="cw-set-row"><label class="checkbox_label cw-set-check"><input type="checkbox" data-opt="noPullRefresh"${settings().noPullRefresh !== false ? raw(" checked") : ""}><span>防止下拉误刷新</span></label>
            <div class="cw-set-why" data-a="why" tabindex="0" role="button" aria-label="说明" title="说明">?</div></div>
          <p class="cw-set-note cw-set-whynote" hidden>在页面顶部往下拖时，浏览器会刷新整个酒馆（iPhone、iPad 的 Safari 最常见，安卓 Chrome 也会）。开启后阻止这种刷新；浏览器的刷新按钮照常可用。</p>
        </div>
        <div data-r="compat">${compatCardHtml()}</div>
        ${log.length ? html`<details class="cw-set-fold"><summary><span class="cw-set-fold-t">更新说明</span><small class="cw-set-sum">${log[0].head}</small></summary><div class="cw-set-logs">${log.slice(0, 2).map((x) => html`<div class="cw-set-logv"><b>${x.head}</b><div>${raw(esc(x.body).replace(/\n/g, "<br>"))}</div></div>`)}</div></details>` : ""}
        <p class="cw-set-foot">打开方式：点上方按钮，或用选好的入口（魔棒菜单、悬浮球），或在聊天输入框发送 /atelier。<a href="https://github.com/Xiaxiii/Burnt-chicken-wings" target="_blank" rel="noopener">GitHub</a></p>
      </div>
    </div>
  </div>`);
  const card = mountCompatCard(box.querySelector('[data-r="compat"] > details'));
  box.querySelector(".inline-drawer-toggle")?.addEventListener("click", () => setTimeout(() => card.refresh(), 0));
  const status = box.querySelector(".cw-set-status");
  const say = (content, cls = "") => {
    status.hidden = false;
    status.className = "cw-set-status " + cls;
    status.innerHTML = String(content);
  };
  const reloadBtn = html`<div class="menu_button menu_button_icon cw-set-mini" data-a="reload" tabindex="0" role="button"><i class="fa-solid fa-arrows-rotate"></i><span>刷新页面</span></div>`;
  const diskVersion = () => manifestVersion(stUrl(`scripts/extensions/third-party/${EXT_DIR}/manifest.json`));
  let busy = false;
  async function act(a, b) {
    if (a === "open") return open();
    if (a === "health") return open("health");
    if (a === "reload") return location.reload();
    if (a === "why") { const n = box.querySelector(".cw-set-whynote"); n.hidden = !n.hidden; return; }
    // 改名就在这一行里改
    if (a === "rename") {
      const row = box.querySelector('[data-r="name"]');
      row.innerHTML = String(html`<span class="cw-set-k">名称</span><input class="text_pole cw-set-input" maxlength="30" value="${appName()}" placeholder="${DEFAULT_APP_NAME}" aria-label="扩展名称">
        <div class="menu_button menu_button_icon cw-set-mini" data-a="rename-ok" tabindex="0" role="button"><i class="fa-solid fa-check"></i><span>保存</span></div>
        <div class="menu_button menu_button_icon cw-set-mini" data-a="rename-cancel" tabindex="0" role="button"><i class="fa-solid fa-xmark"></i><span>取消</span></div>`);
      const input = row.querySelector("input");
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !imeEnter(ev)) { ev.preventDefault(); act("rename-ok", null); }
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); act("rename-cancel", null); }
      });
      input.focus();
      input.select();
      return;
    }
    if (a === "rename-ok" || a === "rename-cancel") {
      const row = box.querySelector('[data-r="name"]');
      if (a === "rename-ok") {
        const v = String(row.querySelector("input")?.value || "").trim();
        settings().appName = v && v !== DEFAULT_APP_NAME ? v : "";
        saveSettings();
      }
      row.innerHTML = String(nameRow());
      refreshAppName();
      return;
    }
    if (busy) return;
    busy = true;
    const icon = b?.querySelector("i");
    icon?.classList.add("fa-spin");
    try {
      if (a === "check") {
        say("正在检查更新…");
        const v = await extApi("version");
        if (v.isUpToDate) {
          // 已经更新但还没刷新页面时，磁盘上的版本比正在运行的新
          const disk = await diskVersion() || VERSION;
          say(disk !== VERSION ? html`<span>已是最新版本（${disk}），刷新页面后生效。</span>${reloadBtn}` : `已是最新版本（${VERSION}）。`, "ok");
        } else {
          const remote = await manifestVersion(`https://raw.githubusercontent.com/Xiaxiii/Burnt-chicken-wings/${encodeURIComponent(v.currentBranchName || "main")}/manifest.json`);
          say(html`<span>检测到新版本${remote ? `（${remote}）` : ""}。</span><div class="menu_button menu_button_icon cw-set-mini" data-a="update" tabindex="0" role="button"><i class="fa-solid fa-download"></i><span>更新</span></div>`, "new");
        }
      } else if (a === "update") {
        say("正在更新…");
        const v = await extApi("update");
        if (v.isUpToDate) say("已是最新版本。", "ok");
        else { const x = await diskVersion(); say(html`<span>已更新${x ? `到 ${x}` : ""}，刷新页面后生效。</span>${reloadBtn}`, "ok"); }
      }
    } catch (e) {
      say(html`<span>更新失败：${String(e.message).slice(0, 200)}。可在「扩展管理」中更新。</span>`, "bad");
    } finally {
      icon?.classList.remove("fa-spin");
      busy = false;
    }
  }
  const handler = (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || !box.contains(b)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    act(b.dataset.a, b);
  };
  box.addEventListener("click", handler);
  box.addEventListener("keydown", handler);
  box.addEventListener("change", (e) => {
    if (e.target.closest("[data-opt=entry]")) return setEntryMode(e.target.value);
    const t = e.target.closest("[data-opt=noPullRefresh]");
    if (!t) return;
    settings().noPullRefresh = t.checked;
    saveSettings();
    applyPullGuard();
  });
  host2.append(box);
}
