// 站点编辑窗口、导入导出站点文件。
// 单密钥站点的密钥就是站点自己；进窗口时统一成一组，保存时只有一个就写回站点上。
// 密钥存入酒馆密钥库（旧版酒馆存在本浏览器）；取消时删掉本窗口新存的，换过、删掉的旧密钥同样删掉
async function siteModels(site) {
  return withSiteKey(site, () => fetchModelList(site));
}
// 多密钥站点：每个分组各拉一次模型列表。返回 { ok, bad: [失败的分组名] }
async function siteFetchAllKeys(site, keys = site.keys) {
  const bad = [];
  let ok = 0;
  for (const k of keys) {
    try {
      k.models = await siteModels(keyView(site, k.id));
      ok++;
    } catch (e) {
      bad.push(keyName(site, k));
      console.warn("[焦香鸡翅] 拉取模型失败", keyName(site, k), e);
    }
  }
  return { ok, bad };
}
const siteKeyFailText = (names) => `${names.map((x) => `「${x}」`).join("")}密钥请求失败（额度用完或已失效）`;
const blankSiteKey = () => ({ id: uid(), name: "", secretId: null, keyMask: "", localKey: false, model: "", models: [] });
const keysOfSite = (s) => siteMulti(s) ? s.keys : [{ id: null, name: "", secretId: s.secretId || null, keyMask: s.keyMask || "", localKey: !!s.localKey, localId: s.localId, legacyKey: s.legacyKey, model: s.model || "", models: s.models || [] }];
const savedKey = (k) => !!(k.secretId || k.localKey || k.legacyKey);
async function keyTextOf(site, k) {
  if (k.secretId) return (await revealSecret(site.source, k.secretId)).value || "";
  if (k.localKey || k.legacyKey) return getLocalKey({ id: site.id, localId: k.localId, legacyKey: k.legacyKey }) || "";
  return "";
}
// 返回 "del"（点了删除）、站点对象（已保存）或 null。onSaved(site, { newBalance, rekeyed })
async function editSiteDialog(site, { onSaved } = {}) {
  const isNew = !site;
  const s = site ? structuredClone(site) : { id: uid(), name: "", source: "custom", url: "", model: "", models: [], secretId: null, keyMask: "", note: "" };
  let ks = siteMulti(s) ? s.keys : [{ id: uid(), name: "", secretId: s.secretId || null, keyMask: s.keyMask || "", localKey: !!s.localKey, localId: s.localId || (s.localKey || s.legacyKey ? s.id : undefined), legacyKey: s.legacyKey, model: s.model || "", models: s.models || [] }];
  let curKey = siteMulti(s) ? siteKey(s).id : ks[0].id;
  const body = el(html`<div class="cw-form cw-siteform">
      <label class="cw-field"><span>名称</span><input class="cw-input" data-f="name" value="${s.name}" placeholder="例如：某中转站"></label>
      <label class="cw-field"><span>类型</span><select class="cw-select" data-f="source">${Object.entries(SOURCES).map(([k, v]) => html`<option value="${k}"${k === s.source ? raw(" selected") : ""}>${v.label}</option>`)}</select></label>
      <label class="cw-field" data-show="custom"><span>网址</span><input class="cw-input" data-f="url" value="${s.url}" placeholder="https://…/v1" inputmode="url" autocapitalize="off" spellcheck="false"></label>
      <div class="cw-field"><span>密钥<span class="cw-gap"></span>${btn("加一个密钥", { act: "keyadd", size: "sm", kind: "quiet", icon: "plus", title: "同一站点的其他分组" })}</span><div class="cw-keys" data-f="keys"></div></div>
      <div class="cw-field"><span>模型</span><div class="cw-modelline">${modelBtn(s.model, { attrs: 'data-f="modelbtn"' })}${btn("获取模型列表", { act: "fetch", size: "sm", icon: "refresh", attrs: 'data-show="custom"' })}</div><input type="hidden" data-f="model" value="${s.model || ""}"></div>
      <label class="cw-field" data-show="custom"><span>账户余额（可选）</span><input class="cw-input" data-f="manualbal" value="${s.manualBalance ? String(s.manualBalance.amount) : ""}" inputmode="decimal" autocomplete="off" placeholder="密钥不限额时，填网站上的余额，之后按用量扣减"></label>
      <label class="cw-field"><span>备注</span><input class="cw-input" data-f="note" value="${s.note || ""}" placeholder="例如：月卡至 11 月"></label>
      <p class="cw-hint">${multiKeySupported() ? "密钥存入酒馆密钥库，本扩展只记录编号。" : "酒馆版本较旧，没有密钥库。密钥只保存在这个浏览器里，不写进酒馆设置文件；换设备、换浏览器需要重新填写。"}</p>
    </div>`);
  const keysBox = body.querySelector("[data-f=keys]");
  const hasKey = (k) => !!(k.secretId || k.localKey || k.legacyKey);
  // 框里还没存的密钥文字（重画时不丢）；正显示明文的；已保存且能看到的；看不了时的说明
  const typed = new Map();
  const shown = new Set();
  const revealed = new Map();
  const keyNote = new Map();
  const syncTyped = () => {
    keysBox.querySelectorAll(".cw-keyrow").forEach((row) => {
      const k = ks.find((x) => x.id === row.dataset.k);
      if (!k) return;
      // 框里是看到的已存密钥（没改）时，不算新填的
      const v = row.querySelector("[data-f=key]").value.trim();
      if (v && v === revealed.get(k.id)) typed.delete(k.id);
      else typed.set(k.id, v);
      const n = row.querySelector("[data-f=keyname]");
      if (n) k.name = n.value.trim();
    });
  };
  const paintKeys = () => {
    const many = ks.length > 1;
    keysBox.classList.toggle("is-many", many);
    keysBox.innerHTML = String(html`${ks.map((k, i) => {
      const ph = hasKey(k) ? (k.keyMask ? `${k.keyMask} · 留空不改` : "不修改请留空") : many ? "粘贴密钥，回车填下一个" : "留空则用酒馆当前密钥；多个可一次粘贴，或回车分行";
      const vis = shown.has(k.id);
      const val = typed.get(k.id) || vis && revealed.get(k.id) || "";
      return html`<div class="cw-keyrow" data-k="${k.id}">
          ${many ? html`<span class="cw-handle cw-key-grip" aria-hidden="true" title="拖动调顺序，排在上面的优先">${iconHtml("grip")}</span><input class="cw-input cw-key-name" data-f="keyname" value="${k.name}" placeholder="密钥 ${i + 1}" aria-label="密钥 ${i + 1} 的名称（分组名，可不填）">` : ""}
          <input class="cw-input cw-key-val" data-f="key" type="${vis ? "text" : "password"}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ph}" aria-label="${many ? `密钥 ${i + 1}` : "密钥"}" value="${val}">
          ${ibtn("eye", vis ? "隐藏密钥" : "显示密钥", { attrs: 'data-f="keyeye"', pressed: vis })}
          ${vis && val ? ibtn("copy", "复制密钥", { attrs: 'data-f="keycopy"' }) : ""}
          ${(k.models || []).length ? html`<span class="cw-pill cw-pill-ok" title="拉取到的模型">${k.models.length} 个模型</span>` : ""}
          ${many ? ibtn("close", "删除这个密钥", { attrs: 'data-f="keydel"' }) : ""}
        </div>${keyNote.has(k.id) ? html`<p class="cw-hint cw-key-note">${keyNote.get(k.id)}</p>` : ""}`;
    })}`);
  };
  paintKeys();
  const sync = (w) => {
    const custom = w.querySelector("[data-f=source]").value === "custom";
    w.querySelectorAll("[data-show=custom]").forEach((x) => { x.hidden = !custom; });
  };
  const viewSite = () => ({ ...s, keys: ks, keyId: curKey });
  const setModel = (w, m, keyId = curKey) => {
    if (keyId) curKey = keyId;
    const k = ks.find((x) => x.id === curKey) || ks[0];
    k.model = m;
    w.querySelector("[data-f=model]").value = m;
    const kn = ks.length > 1 ? keyName(viewSite(), k) : "";
    w.querySelector("[data-f=modelbtn]").outerHTML = String(modelBtn(m, { attrs: 'data-f="modelbtn"', key: kn }));
  };
  const readModel = (w) => w.querySelector("[data-f=model]").value.trim();
  const read = (w) => {
    syncTyped();
    return {
      name: w.querySelector("[data-f=name]").value.trim(),
      source: w.querySelector("[data-f=source]").value,
      url: w.querySelector("[data-f=url]").value.trim(),
      model: readModel(w),
      note: w.querySelector("[data-f=note]").value.trim(),
      manualbal: w.querySelector("[data-f=manualbal]").value.trim()
    };
  };
  const madeKeys = [];
  const madeLocal = [];
  const localIdOf = (k) => k.localId || (ks.length > 1 || ks[0] !== k ? `${s.id}.${k.id}` : s.id);
  const persistKey = async (k, v) => {
    const text = typed.get(k.id);
    if (!text) return;
    if (multiKeySupported()) {
      const label = ks.length > 1 ? `焦香鸡翅\xB7${v.name || "站点"}\xB7${keyName(viewSite(), k)}` : `焦香鸡翅\xB7${v.name || "站点"}`;
      const id = await storeKey(v.source, text, label);
      madeKeys.push({ source: v.source, id });
      k.secretId = id;
      delete k.legacyKey;
    } else {
      const lid = localIdOf(k);
      if (!setLocalKey(lid, text)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
      madeLocal.push(lid);
      k.localKey = true;
      k.localId = lid;
      delete k.legacyKey;
    }
    k.keyMask = keyMaskOf(text);
    typed.delete(k.id);
  };
  // 多个密钥时，新加了却没填的行不算
  const liveKeys = () => {
    if (ks.length < 2) return ks;
    const hit = ks.filter((k) => hasKey(k) || typed.get(k.id));
    return hit.length ? hit : [ks[0]];
  };
  const fieldOk = (w, v) => {
    if (!v.name) { toast("请填写名称"); w.querySelector("[data-f=name]").focus(); return false; }
    if (v.source === "custom" && !v.url) { toast("自定义类型需填写网址"); w.querySelector("[data-f=url]").focus(); return false; }
    if (v.source === "custom" && v.manualbal && balanceParseAmount(v.manualbal) == null) { toast("账户余额请填一个金额，如 50 或 12.5"); w.querySelector("[data-f=manualbal]").focus(); return false; }
    return true;
  };
  const r = await dialog({
    title: isNew ? "添加站点" : `编辑「${s.name}」`,
    body,
    size: "lg",
    noFocus: !isNew,
    onMount: (w) => {
      sync(w);
      setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
      w.querySelector("[data-f=source]").addEventListener("change", () => sync(w));
      const focusKey = (id) => keysBox.querySelector(`.cw-keyrow[data-k="${CSS.escape(id)}"] [data-f=key]`)?.focus();
      w.querySelector('[data-act="keyadd"]').addEventListener("click", () => {
        syncTyped();
        const k = blankSiteKey();
        ks.push(k);
        paintKeys();
        setModel(w, readModel(w));
        focusKey(k.id);
      });
      keysBox.addEventListener("click", async (e) => {
        const f = e.target.closest("[data-f]")?.dataset.f;
        const row = e.target.closest(".cw-keyrow");
        if (!row || !f) return;
        const id = row.dataset.k;
        const k = ks.find((x) => x.id === id);
        if (f === "keyeye") {
          syncTyped();
          if (shown.has(id)) shown.delete(id);
          else {
            shown.add(id);
            if (!typed.get(id) && hasKey(k) && !revealed.has(id)) {
              // 只存在这个浏览器里的直接读；存在酒馆密钥库的去问酒馆
              const local = !k.secretId ? getLocalKey({ id: s.id, localId: k.localId, legacyKey: k.legacyKey }) : null;
              const got = local ? { value: local } : k.secretId ? await revealSecret(w.querySelector("[data-f=source]").value, k.secretId) : {};
              if (got.value) revealed.set(id, got.value);
              else {
                shown.delete(id);
                keyNote.set(id, got.blocked ? "这把密钥是更新前或在别的浏览器里存的，这里没留底。重新粘贴一次保存，以后就能看；或在酒馆的 config.yaml 里把 allowKeysExposure 改成 true，重启酒馆。" : k.secretId ? "没取到这个密钥，可能已从酒馆密钥库删除。重新粘贴一次即可。" : "这个密钥只存在这个浏览器里，看不了全文；要确认请重新粘贴一次。");
              }
            }
          }
          paintKeys();
          return;
        }
        if (f === "keycopy") {
          const input = row.querySelector("[data-f=key]");
          const text = input.value.trim();
          if (!text) return;
          const ok = await copyText(text, input);
          toast(ok ? "已复制" : "复制失败，长按框里的密钥手动复制", ok ? "success" : "warning");
          return;
        }
        if (f === "keydel") {
          syncTyped();
          ks = ks.filter((x) => x.id !== id);
          typed.delete(id);
          if (curKey === id) curKey = ks[0].id;
          paintKeys();
          setModel(w, (ks.find((x) => x.id === curKey) || ks[0]).model || "");
        }
      });
      // 一次填进多个密钥：一个一行，拆成多行
      const spreadKeys = (box, list) => {
        syncTyped();
        const id = box.closest(".cw-keyrow").dataset.k;
        let i = ks.findIndex((k) => k.id === id);
        typed.set(id, list[0]);
        for (const key of list.slice(1)) {
          const k = blankSiteKey();
          ks.splice(++i, 0, k);
          typed.set(k.id, key);
        }
        paintKeys();
        setModel(w, readModel(w));
        focusKey(ks[i].id);
        toast(`已拆成 ${list.length} 个密钥，可在左边填分组名`, "success");
      };
      keysBox.addEventListener("paste", (e) => {
        const box = e.target.closest("[data-f=key]");
        const list = box && splitKeyText(e.clipboardData?.getData("text"));
        if (!list) return;
        e.preventDefault();
        spreadKeys(box, list);
      });
      // 手机输入法的剪贴板、拖放不触发粘贴：一次插进来的一串里有几个密钥时照样拆开
      keysBox.addEventListener("input", (e) => {
        if (e.target.matches("[data-f=keyname]")) { syncTyped(); setModel(w, readModel(w)); return; }
        const box = e.target.closest?.("[data-f=key]");
        if (!box || e.isComposing) return;
        const bulk = /^insertFrom|^insertReplacement/.test(e.inputType || "") || (e.inputType === "insertText" && (e.data || "").length > 1);
        const list = bulk && splitKeyText(box.value);
        if (list) spreadKeys(box, list);
      });
      // 回车：新开一行，接着填下一个密钥
      keysBox.addEventListener("keydown", (e) => {
        const box = e.target.closest?.("[data-f=key]");
        if (!box || e.key !== "Enter" || imeEnter(e)) return;
        e.preventDefault();
        if (!box.value.trim()) return;
        syncTyped();
        const id = box.closest(".cw-keyrow").dataset.k;
        const k = blankSiteKey();
        ks.splice(ks.findIndex((x) => x.id === id) + 1, 0, k);
        paintKeys();
        setModel(w, readModel(w));
        focusKey(k.id);
      });
      // 拖动左边的把手调顺序（排在上面的优先）
      keysBox.addEventListener("pointerdown", (e) => {
        const grip = e.target.closest(".cw-key-grip");
        if (!grip) return;
        e.preventDefault();
        keyNote.clear();
        keysBox.querySelectorAll(".cw-key-note").forEach((n) => n.remove());
        syncTyped();
        const row = grip.closest(".cw-keyrow");
        row.classList.add("is-drag");
        grip.setPointerCapture?.(e.pointerId);
        const move = (ev) => {
          const rows = [...keysBox.querySelectorAll(".cw-keyrow")];
          const over = rows.find((x) => x !== row && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
          if (over) { if (over !== row.nextElementSibling) keysBox.insertBefore(row, over); }
          else if (row !== keysBox.lastElementChild) keysBox.append(row);
        };
        const up = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", up);
          grip.removeEventListener("pointercancel", up);
          const order = [...keysBox.querySelectorAll(".cw-keyrow")].map((x) => x.dataset.k);
          ks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
          paintKeys();
          setModel(w, readModel(w));
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", up);
        grip.addEventListener("pointercancel", up);
      });
      body.addEventListener("click", async (e) => {
        if (e.target.closest("[data-f=modelbtn]")) {
          syncTyped();
          const view = viewSite();
          if (ks.length > 1) {
            const m = await pickKeyModel(view, { keyId: curKey, model: readModel(w) });
            s.modelView = view.modelView;
            if (view.modelCats) s.modelCats = view.modelCats;
            if (m) setModel(w, m.model, m.keyId);
            return;
          }
          const m = await pickModel(ks[0].models || [], readModel(w), { site: s });
          if (m) setModel(w, m);
          return;
        }
        const fb = e.target.closest('[data-act="fetch"]');
        if (!fb) return;
        const v = read(w);
        if (!v.url) return toast("请填写网址");
        fb.disabled = true;
        fb.classList.add("cw-spin");
        try {
          const use = liveKeys();
          for (const k of use) await persistKey(k, v);
          Object.assign(s, { source: v.source, url: v.url, name: v.name || s.name });
          if (use.length > 1) {
            const view = { ...viewSite(), keys: use };
            const { ok, bad } = await siteFetchAllKeys(view, use);
            paintKeys();
            const n = new Set(use.flatMap((k) => k.models || [])).size;
            if (bad.length) toast(siteKeyFailText(bad), "warning");
            if (ok && n) {
              toast(`已获取 ${n} 个模型`, "success");
              const m = await pickKeyModel(view, { keyId: curKey, model: v.model });
              s.modelView = view.modelView;
              if (view.modelCats) s.modelCats = view.modelCats;
              if (m) setModel(w, m.model, m.keyId);
            } else if (ok) toast("站点未返回模型，可手动输入模型名称", "warning");
          } else {
            const k = use[0];
            const models = await siteModels({ ...s, secretId: k.secretId, localId: k.localId, localKey: k.localKey, legacyKey: k.legacyKey });
            k.models = models;
            paintKeys();
            if (models.length) {
              toast(`已获取 ${models.length} 个模型`, "success");
              const m = await pickModel(models, v.model, { site: s });
              if (m) setModel(w, m);
            } else toast("站点未返回模型，可手动输入模型名称", "warning");
          }
        } catch (err) {
          toast("获取失败：" + err.message, "error");
        }
        fb.disabled = false;
        fb.classList.remove("cw-spin");
      });
    },
    actions: [...isNew ? [] : [{ label: "删除", kind: "danger", value: "del" }], { label: "取消", value: null }, {
      label: "保存", kind: "primary",
      validate: (w) => fieldOk(w, read(w)),
      value: read
    }]
  });
  if (!r || r === "del") {
    for (const k of madeKeys) await dropKey(k.source, k.id);
    if (isNew) for (const id of madeLocal) setLocalKey(id, null);
    return r === "del" ? "del" : null;
  }
  const final = liveKeys();
  try {
    for (const k of final) await persistKey(k, r);
  } catch (e) {
    for (const k of madeKeys) await dropKey(k.source, k.id);
    toast("密钥保存失败，站点未保存：" + e.message, "error");
    return null;
  }
  const keep = new Set(final.map((k) => k.secretId).filter(Boolean));
  for (const k of madeKeys) if (!keep.has(k.id)) await dropKey(k.source, k.id);
  Object.assign(s, { name: r.name, source: r.source, url: r.source === "custom" ? r.url : "", note: r.note });
  // 手填的账户余额：改了数就重新起算，清空则不再手填
  const amount = r.source === "custom" && r.manualbal ? balanceParseAmount(r.manualbal) : null;
  const newBalance = amount != null && amount !== s.manualBalance?.amount;
  if (amount == null) delete s.manualBalance;
  else if (newBalance) s.manualBalance = { amount, at: Date.now(), base: {} };
  for (const f of ["secretId", "keyMask", "localKey", "localId", "legacyKey", "model", "models", "keys", "keyId"]) delete s[f];
  if (final.length > 1) {
    s.keys = final.map((k) => {
      const out = { id: k.id, name: k.name, secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || "", models: k.models || [] };
      if (k.localKey) Object.assign(out, { localKey: true, localId: localIdOf(k) });
      return out;
    });
    s.keyId = final.some((k) => k.id === curKey) ? curKey : final[0].id;
  } else {
    const k = final[0];
    Object.assign(s, { secretId: k.secretId || null, keyMask: k.keyMask || "", model: k.model || r.model || "", models: k.models || [] });
    if (k.localKey) {
      s.localKey = true;
      if (localIdOf(k) !== s.id) s.localId = localIdOf(k);
    }
    if (k.legacyKey) s.legacyKey = k.legacyKey;
  }
  const list = settings().sites;
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s;
  else list.push(s);
  saveSettings();
  await onSaved?.(s, { newBalance, rekeyed: madeKeys.some((m) => keep.has(m.id)) || madeLocal.length > 0 });
  return s;
}
// ---------- 导出、导入站点（JSON）。单密钥站点在文件里写成只有一个的 keys ----------
async function exportSites(anchor) {
  const list = settings().sites;
  if (!list.length) return toast("还没有站点");
  const how = await pickBox("导出站点", [
    { label: "含密钥", sub: "密钥为明文", value: "keys" },
    { label: "不含密钥", sub: "仅名称、网址、模型、备注", value: "bare" }
  ], { anchor });
  if (!how) return;
  let missing = 0;
  const out = [];
  for (const s of list) {
    const keys = [];
    for (const k of keysOfSite(s)) {
      const item = { name: k.name || "", model: k.model || "", models: k.models || [] };
      if (how === "keys" && savedKey(k)) {
        const v = await keyTextOf(s, k);
        if (v) item.key = v;
        else missing++;
      }
      keys.push(item);
    }
    out.push({ name: s.name, source: s.source, url: s.url || "", note: s.note || "", keys, ...(s.modelCats?.length ? { cats: s.modelCats.map((c) => ({ name: c.name, models: c.models || [] })) } : {}) });
  }
  // 文件名只用英文数字：有的浏览器遇到中文文件名会存成「download」
  const d = new Date(), two = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  downloadBlob(new Blob([JSON.stringify({ format: SITE_FILE_FORMAT, version: 1, exported: d.toISOString(), sites: out }, null, 2)], { type: "application/json" }), `api-sites-${stamp}.json`);
  toast(missing ? `已导出 ${out.length} 个站点；${missing} 个密钥读不到，未写入` : `已导出 ${out.length} 个站点${how === "keys" ? "（含密钥）" : ""}`, missing ? "warning" : "success");
}
// 同名、同网址的站点算同一个：更新它，不再新增
const normSiteUrl = (u) => String(u || "").trim().replace(/\/+$/, "").toLowerCase();
const sameSiteAs = (f) => settings().sites.find((s) => s.source === f.source && s.name === f.name && normSiteUrl(s.url) === normSiteUrl(f.url));
async function importSites(file) {
  let found;
  try { found = parseSiteFile(await file.text()); } catch { return toast("不是 JSON 文件", "error"); }
  if (!found.length) return toast("没找到站点（需有 http 开头的网址）", "warning");
  const plan = found.map((f) => ({ f, old: sameSiteAs(f) }));
  const updates = plan.filter((x) => x.old).length;
  const ok = await dialog({
    title: `导入 ${plan.length} 个站点`,
    size: "md",
    body: html`<div class="cw-implist">${plan.map(({ f, old }) => {
      const n = f.keys.filter((k) => k.key).length;
      const nm = new Set(f.keys.flatMap((k) => k.models || [])).size;
      const what = [f.url ? hostOf(f.url) : SOURCES[f.source].label, n ? `${n} 个密钥` : "没有密钥", nm && `${nm} 个模型`, f.cats.length && `${f.cats.length} 个分类`].filter(Boolean);
      return html`<div class="cw-implist-row"><div><b>${f.name}</b><small>${what.join(" · ")}</small></div>${pill(old ? "更新" : "新增", old ? "line" : "accent")}</div>`;
    })}</div>${updates ? html`<p class="cw-hint">更新：同名同网址的站点，密钥和模型列表以文件为准。</p>` : ""}`,
    actions: [{ label: "取消", value: false }, { label: "导入", kind: "primary", value: true }]
  });
  if (!ok) return;
  let added = 0, updated = 0;
  const failed = [];
  for (const { f, old } of plan) {
    try {
      await saveImportedSite(f, old);
      old ? updated++ : added++;
    } catch (e) {
      failed.push(`「${f.name}」${e.message}`);
    }
  }
  saveSettings();
  const done = [added && `新增 ${added} 个`, updated && `更新 ${updated} 个`].filter(Boolean).join("，");
  if (failed.length) toast(`${done ? done + "；" : ""}未导入：${failed.join("；")}`, "error");
  else toast(`已导入：${done}`, "success");
}
async function saveImportedSite(f, old) {
  const s = old || { id: uid(), name: f.name, source: f.source, url: f.url, note: f.note };
  const before = old ? keysOfSite(old) : [];
  const made = [], madeLocal = [];
  const many = f.keys.length > 1;
  const keys = [];
  try {
    for (const [i, ik] of f.keys.entries()) {
      const prev = (ik.name && before.find((k) => k.name === ik.name)) || before[i] || null;
      const k = { id: (many && prev?.id) || uid(), name: ik.name || "", secretId: null, keyMask: "", model: ik.model || prev?.model || "", models: ik.models?.length ? ik.models : prev?.models || [] };
      const keepPrev = () => Object.assign(k, { secretId: prev.secretId || null, keyMask: prev.keyMask || "", localKey: !!prev.localKey, localId: prev.localId, legacyKey: prev.legacyKey });
      if (ik.key && prev && savedKey(prev) && await keyTextOf(s, prev) === ik.key) keepPrev();
      else if (ik.key) {
        if (multiKeySupported()) {
          k.secretId = await storeKey(f.source, ik.key, many ? `焦香鸡翅·${f.name}·${ik.name || `密钥 ${i + 1}`}` : `焦香鸡翅·${f.name}`);
          made.push(k.secretId);
        } else {
          const lid = many ? `${s.id}.${k.id}` : s.id;
          if (!setLocalKey(lid, ik.key)) throw new Error("浏览器不允许保存密钥（可能是无痕模式）");
          madeLocal.push(lid);
          Object.assign(k, { localKey: true, localId: lid });
        }
        k.keyMask = keyMaskOf(ik.key);
      } else if (prev && savedKey(prev)) keepPrev();
      keys.push(k);
    }
  } catch (e) {
    for (const id of made) await dropKey(f.source, id);
    for (const id of madeLocal) if (!old) setLocalKey(id, null);
    throw e;
  }
  if (f.note) s.note = f.note;
  // 分类按名称合并：同名的并进模型，没有的新建
  if (f.cats.length) {
    const mine = s.modelCats || (s.modelCats = []);
    for (const c of f.cats) {
      const hit = mine.find((x) => x.name === c.name);
      if (hit) hit.models = [...new Set([...(hit.models || []), ...c.models])];
      else mine.push({ id: uid(), name: c.name, models: [...c.models] });
    }
  }
  for (const x of ["secretId", "keyMask", "localKey", "localId", "legacyKey", "model", "models", "keys", "keyId"]) delete s[x];
  if (many) {
    s.keys = keys.map((k) => {
      const o = { id: k.id, name: k.name, secretId: k.secretId, keyMask: k.keyMask, model: k.model, models: k.models };
      if (k.localKey) Object.assign(o, { localKey: true, localId: k.localId });
      if (k.legacyKey) o.legacyKey = k.legacyKey;
      return o;
    });
    s.keyId = old?.keyId && keys.some((k) => k.id === old.keyId) ? old.keyId : keys[0].id;
  } else {
    const k = keys[0];
    Object.assign(s, { secretId: k.secretId, keyMask: k.keyMask, model: k.model, models: k.models });
    if (k.localKey) {
      s.localKey = true;
      if (k.localId && k.localId !== s.id) s.localId = k.localId;
    }
    if (k.legacyKey) s.legacyKey = k.legacyKey;
  }
  if (!old) settings().sites.push(s);
}
