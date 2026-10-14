// 1.7.0「清理」的其他几栏：扩展数据、角色卡、世界书、本地备份。
// 只有「扩展数据」和「角色卡」会影响酒馆打开速度（设置文件、角色列表每次打开都下载）；世界书、本地备份只是整理。

// 酒馆自身的设置项，不能删
var CORE_EXT_KEYS = new Set(["disabledExtensions", "autoConnect", "notifyUpdates", "apiUrl", "apiKey", "presetAtelier"]);
// 酒馆内置功能存在 extension_settings 里的键
var BUILTIN_EXT_KEYS = { note: "作者注释", caption: "图片描述", expressions: "表情", connectionManager: "连接配置", dice: "骰子", gallery: "图库", memory: "总结", quickReply: "快速回复（旧版）", quickReplyV2: "快速回复", regex: "正则", tts: "语音朗读", sd: "图片生成", chromadb: "ChromaDB", translate: "翻译", vectors: "向量存储", variables: "变量", attachments: "附件", character_attachments: "角色附件", disabledAttachments: "附件", cfg: "CFG", objective: "目标", rvc: "RVC", speech_recognition: "语音识别", hypebot: "HypeBot", idle: "空闲提醒", assets: "资源下载", tokenCounter: "Token 计数", gallery_folders: "图库" };
var normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9一-龥]/g, "");
// 键排好序再转成文字：两本世界书字段顺序不同，内容一样时也能算出同一个指纹
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
// discoverExtensions 在 maintenance/compat.js
// 按名称推测这个键属于哪个已安装的扩展（推测，可能不准）
function guessOwner(key, exts) {
  if (BUILTIN_EXT_KEYS[key]) return { builtin: BUILTIN_EXT_KEYS[key] };
  const nk = normKey(key);
  if (nk.length < 2) return null;
  for (const x of exts) {
    const nf = normKey(x.base), nd = normKey(x.manifest?.display_name);
    if (nf && (nf === nk || nf.includes(nk) || nk.length >= 4 && nk.includes(nf) && nf.length >= 3)) return { ext: x };
    if (nd && (nd === nk || nd.includes(nk) || nk.length >= 4 && nk.includes(nd) && nd.length >= 3)) return { ext: x };
  }
  return null;
}
// 实际检测：下载每个扩展的脚本（顺着相对路径的 import 往下找），看里面有没有用到这个键
async function scanExtensionCode(exts, keys, onProgress) {
  const used = Object.fromEntries(keys.map((k) => [k, []]));
  const res = keys.map((k) => {
    const e = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [k, new RegExp(`["'\`]${e}["'\`]|\\.${e}\\b`)];
  });
  // 没查完的扩展（文件太多或读取失败），它们有可能用到这些数据
  const partial = [];
  for (const [i, x] of exts.entries()) {
    onProgress?.(i + 1, exts.length, x.manifest?.display_name || x.base);
    const entry = x.manifest?.js;
    if (!entry) continue;
    const root = new URL(`scripts/extensions/${x.name}/`, document.baseURI);
    const queue = [new URL(entry, root).href];
    const seen = new Set();
    let failed = false;
    while (queue.length && seen.size < 400) {
      const u = queue.shift();
      if (seen.has(u)) continue;
      seen.add(u);
      let text = "";
      // 任何一个文件没读到，这个扩展都算没查完
      try {
        const r = await fetch(u);
        if (!r.ok) {
          failed = true;
          continue;
        }
        text = await r.text();
      } catch {
        failed = true;
        continue;
      }
      for (const [k, re] of res) if (re.test(text) && !used[k].includes(x)) used[k].push(x);
      // 只跟进扩展自己文件夹里的模块
      for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
        const next = new URL(m[1], u).href;
        if (next.startsWith(root.href) && !seen.has(next)) queue.push(next);
      }
    }
    if (queue.length || failed) partial.push(x);
  }
  return { used, partial };
}
// 角色卡同名提示里点了「忽略」的组。只记在内存里：这次打开酒馆期间不再提示；
// 点「重新检测」或下次打开酒馆重新检测时清空，提示会再出现。组里的角色卡有增减时算新的一组。
var ignoredCharDups = new Set();
async function deleteCharacterKeepChats(avatar) {
  const r = await stPost("api/characters/delete", { avatar_url: avatar, delete_chats: false });
  if (!r.ok) throw new Error(`删除失败（${r.status}）`);
}
async function deleteWorldbook(name) {
  if (typeof mods.wi?.deleteWorldInfo === "function") {
    const ok = await mods.wi.deleteWorldInfo(name);
    if (ok === false) throw new Error("删除失败");
    return;
  }
  const r = await stPost("api/worldinfo/delete", { name });
  if (!r.ok) throw new Error(`删除失败（${r.status}）`);
}
async function backupAll() {
  return ((await tx("backups", "readonly", (s) => s.getAll())) || []).filter(backupMine);
}
async function backupDel(id) {
  await tx("backups", "readwrite", (s) => s.delete(id));
}

function mountCleanKind(kind, box) {
  const S = { sel: new Set(), busy: false };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const actBar = (n, size, btns) => n ? `<div class="pa-ck-act"><b>已选 ${n} 个${size ? ` · ${fmtSize(size)}` : ""}</b>${btns}</div>` : "";
  const chk = (id, on, locked) => `<input type="checkbox" data-x="pick" data-k="${esc(id)}" ${on ? "checked" : ""} ${locked ? "disabled" : ""}>`;
  const toggle = (k, on) => on ? S.sel.add(k) : S.sel.delete(k);

  // ---------- 扩展数据 ----------
  if (kind === "ext") {
    let exts = null, scan = null, err = "";
    const rows = () => {
      const es = ctx().extensionSettings || {};
      return Object.keys(es).map((k) => {
        const size = jsonSize(es[k]);
        const owner = exts ? guessOwner(k, exts) : null;
        const users = scan?.used[k];
        let state, label;
        if (CORE_EXT_KEYS.has(k)) [state, label] = ["core", k === "presetAtelier" ? "本扩展" : "酒馆设置"];
        else if (owner?.builtin) [state, label] = ["used", `酒馆内置：${owner.builtin}`];
        else if (users?.length) [state, label] = ["used", `检测：${users.map((x) => x.manifest?.display_name || x.base).slice(0, 2).join("、")}${users.some((x) => !x.enabled) ? "（已停用）" : ""}在用`];
        else if (scan && owner?.ext) [state, label] = ["maybe", `检测：未找到使用者，但名称像「${owner.ext.manifest?.display_name || owner.ext.base}」，请确认`];
        else if (scan && scan.partial.length) [state, label] = ["maybe", `检测：未找到使用者，但「${scan.partial.map((x) => x.manifest?.display_name || x.base).slice(0, 2).join("、")}」没有查完，请确认`];
        // 没找到使用者不等于可以安全删除（扩展可能用拼出来的名字读数据），只标为「疑似残留」，删前由用户核对
        else if (scan) [state, label] = ["orphan", "检测：已安装扩展的代码里没找到它，疑似卸载残留，删除前请核对"];
        else if (owner?.ext) [state, label] = ["used", `推测属于：${owner.ext.manifest?.display_name || owner.ext.base}${owner.ext.enabled ? "" : "（已停用）"}`];
        else [state, label] = ["maybe", "可能已卸载"];
        return { k, size, state, label };
      }).sort((a, b) => b.size - a.size);
    };
    const draw = () => {
      const list = rows();
      const total = list.reduce((n, r) => n + r.size, 0);
      const max = list[0]?.size || 1;
      const pick = list.filter((r) => S.sel.has(r.k));
      const orphans = list.filter((r) => r.state === "orphan");
      box.innerHTML = `
        <div class="pa-sum"><p class="pa-sum-main">扩展数据 <b>${fmtSize(total)}</b> · ${list.length} 项${orphans.length ? ` · <span class="pa-warn">疑似残留 ${orphans.length}</span>` : ""}</p>
          <div class="pa-tiprow">${tip(`<p>设置文件每次打开酒馆都要下载，每次保存都要上传，删掉已卸载扩展的残留数据能减少这部分。</p>
            <p>「可能已卸载」只是按名称推测。「实际检测」会下载已安装扩展的脚本，查找谁在使用这些数据；扩展用拼接出来的名字读数据时查不出来，结果只能作参考。</p>
            <p>正在使用的数据不能勾选。删除前会先下载一份备份（JSON），需要时可交给对应扩展重新导入。</p>`)}<span class="pa-golinks">${orphans.length ? `<button type="button" class="pa-golink" data-x="pickorphans">勾选 ${orphans.length} 项疑似残留</button>` : ""}<button type="button" class="pa-golink" data-x="scan" ${S.busy ? "disabled" : ""}>${S.busy ? "检测中…" : scan ? "重新检测 ›" : "实际检测 ›"}</button></span></div>
          ${S.busy ? '<p class="pa-hint pa-ck-prog"></p>' : ""}
          ${scan ? `<p class="pa-hint">${orphans.length ? "勾选后请逐项确认名称再删除。" : "没有找到疑似残留的数据。"}${scan.partial.length ? `「${scan.partial.map((x) => x.manifest?.display_name || x.base).join("、")}」没有查完，标「请确认」的需要你自己判断。` : ""}</p>` : ""}</div>
        ${err ? `<p class="pa-warn">${esc(err)}</p>` : ""}
        <div class="pa-clist">${list.map((r) => `<label class="pa-crow${S.sel.has(r.k) ? " on" : ""}${r.state === "core" || r.state === "used" ? " pa-locked" : ""}">
          ${chk(r.k, S.sel.has(r.k), r.state === "core" || r.state === "used")}
          <span class="pa-crow-main"><b>${esc(r.k)}</b><span class="pa-crow-tags"><span class="pa-chip ${r.state === "orphan" ? "pa-ctag-same" : r.state === "maybe" ? "pa-ctag-old" : r.state === "used" ? "pa-ctag-use" : "pa-chip-dim"}">${esc(r.label)}</span></span></span>
          <span class="pa-crow-size"><i class="pa-bar"><b style="width:${Math.max(2, Math.round(r.size / max * 100))}%"></b></i><em>${fmtSize(r.size)}</em></span></label>`).join("")}</div>
        ${actBar(pick.length, pick.reduce((n, r) => n + r.size, 0), '<button class="pa-btn pa-btn-danger-soft" data-x="del">下载备份并删除</button>')}`;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy) return;
      if (x === "scan") {
        S.busy = true;
        draw();
        try {
          exts ||= await discoverExtensions();
          const keys = Object.keys(ctx().extensionSettings || {}).filter((k) => !CORE_EXT_KEYS.has(k) && !BUILTIN_EXT_KEYS[k]);
          scan = await scanExtensionCode(exts, keys, (i, n, nm) => {
            const p = box.querySelector(".pa-ck-prog");
            if (p) p.textContent = `正在检测 ${i}/${n}：${nm}`;
          });
          for (const k of [...S.sel]) if (scan.used[k]?.length) S.sel.delete(k);
        } catch (er) {
          err = er.message;
        }
        S.busy = false;
        return draw();
      }
      if (x === "pickorphans") {
        for (const r of rows()) if (r.state === "orphan") S.sel.add(r.k);
        return draw();
      }
      if (x === "del") {
        const keys = [...S.sel];
        if (!keys.length) return;
        if (!await confirmBox("删除扩展数据", `将从设置文件中删除 ${keys.length} 项数据：${keys.slice(0, 5).join("、")}${keys.length > 5 ? " 等" : ""}。删除前会先下载备份。如果对应的扩展其实还在使用，它会恢复成默认设置。`, "下载备份并删除", true)) return;
        const es = ctx().extensionSettings;
        const fname = `extension-data-backup-${stamp()}.json`;
        const blob = new Blob([JSON.stringify(Object.fromEntries(keys.map((k) => [k, es[k]])), null, 2)], { type: "application/json" });
        downloadBlob(blob, fname);
        if (!await confirmDownloaded(fname, () => downloadBlob(blob, fname))) return;
        for (const k of keys) {
          delete es[k];
          S.sel.delete(k);
        }
        ctx().saveSettingsDebounced();
        toast(`已删除 ${keys.length} 项扩展数据`, "success");
        return draw();
      }
    });
    draw();
    discoverExtensions().then((x) => { exts = x; draw(); }).catch((er) => { err = er.message; draw(); });
    return;
  }

  // ---------- 角色卡 ----------
  if (kind === "char") {
    const draw = () => {
      const c = ctx();
      const chars = c.characters || [];
      const cur = chars[Number(c.characterId)]?.avatar;
      const groups = new Map();
      for (const ch of chars) {
        const k = String(ch?.name || "").trim().toLowerCase();
        if (!k) continue;
        (groups.get(k) || groups.set(k, []).get(k)).push(ch);
      }
      const dupKey = (g) => `${String(g[0].name || "").trim().toLowerCase()}\n${g.map((ch) => ch.avatar).sort().join("\n")}`;
      const allDups = [...groups.values()].filter((g) => g.length > 1);
      const dups = allDups.filter((g) => !ignoredCharDups.has(dupKey(g)));
      const nIgnored = allDups.length - dups.length;
      // 忽略的组里不留勾选
      for (const g of allDups) if (ignoredCharDups.has(dupKey(g))) for (const ch of g) S.sel.delete(ch.avatar);
      // 指纹覆盖角色卡的全部内容字段；按需加载（shallow）的角色卡没有完整数据，不判断相同
      const FIELDS = ["description", "personality", "scenario", "first_mes", "mes_example", "alternate_greetings", "system_prompt", "post_history_instructions", "creator_notes", "character_book", "tags", "extensions"];
      const fp = (ch) => {
        if (ch.shallow) return null;
        const src = ch.data && typeof ch.data === "object" ? ch.data : ch;
        return hashStr(stableJson(FIELDS.map((k) => src[k] ?? ch[k] ?? null)));
      };
      const pickList = chars.filter((ch) => S.sel.has(ch.avatar));
      box.innerHTML = `
        <div class="pa-sum"><p class="pa-sum-main">角色卡 <b>${chars.length}</b> 张 · ${dups.length ? `<span class="pa-warn">同名 ${dups.length} 组</span>` : allDups.length ? "同名的都已忽略" : "没有同名"}${nIgnored && dups.length ? ` · 已忽略 ${nIgnored} 组` : ""}</p>
          <div class="pa-tiprow">${tip(`<p>角色列表每次打开酒馆都要下载，删除重复的角色卡能减少一些。</p>
            <p>「文字设定相同」比较的是描述、性格、场景、开场白、示例对话、角色书、标签等文字内容，不比较头像图片。删除时保留聊天记录；正在聊天的角色卡不能勾选。</p>
            <p>不想清理的同名组可以点「忽略」，这次打开酒馆期间不再提示；点「重新检测」或下次打开酒馆时会重新列出。</p>`)}<span class="pa-golinks">${dups.length > 1 ? '<button type="button" class="pa-golink" data-x="ignoreall">全部忽略</button>' : ""}${allDups.length || nIgnored ? `<button type="button" class="pa-golink" data-x="recheck" ${S.busy ? "disabled" : ""}>重新检测 ›</button>` : ""}</span></div></div>
        ${dups.map((g) => {
          const prints = g.map(fp);
          const unknown = prints.some((x) => x == null);
          const same = !unknown && new Set(prints).size === 1;
          const keep = g.reduce((a, b) => (Number(b.date_last_chat) || 0) > (Number(a.date_last_chat) || 0) ? b : a);
          return `<h3 class="pa-h pa-dup-h">${esc(g[0].name)}<span class="pa-chip ${same ? "pa-ctag-same" : "pa-chip-dim"}">${same ? "文字设定相同（头像图片未比较）" : unknown ? "同名，未加载完整内容，无法比较" : "同名，文字设定不同"}</span><button type="button" class="pa-golink pa-dup-ign" data-x="ignore" data-g="${esc(dupKey(g))}" title="这次打开酒馆期间不再提示这一组">忽略</button></h3>
          <div class="pa-clist">${g.map((ch) => `<label class="pa-crow${S.sel.has(ch.avatar) ? " on" : ""}${ch.avatar === cur ? " pa-locked" : ""}">${chk(ch.avatar, S.sel.has(ch.avatar), ch.avatar === cur)}
            <span class="pa-crow-main"><b>${esc(ch.avatar)}</b><span class="pa-crow-tags">${ch.avatar === cur ? '<span class="pa-chip pa-chip-cot">正在聊天</span>' : ""}${ch === keep && ch.date_last_chat ? '<span class="pa-chip pa-ctag-use">最近聊过</span>' : ""}${ch.date_last_chat ? `<span class="pa-chip pa-chip-dim">${relDay(Number(ch.date_last_chat)).replace("用过", "聊过")}</span>` : '<span class="pa-chip pa-chip-dim">没有聊过</span>'}${ch.chat_size ? `<span class="pa-chip pa-chip-dim">聊天 ${fmtSize(ch.chat_size)}</span>` : ""}</span></span>
            <span class="pa-crow-size"><em>${ch.data_size ? fmtSize(ch.data_size) : ""}</em></span></label>`).join("")}</div>`;
        }).join("")}
        ${actBar(pickList.length, 0, '<button class="pa-btn pa-btn-danger-soft" data-x="del">删除（保留聊天记录）</button>')}`;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const xb = e.target.closest("[data-x]");
      const x = xb?.dataset.x;
      if (S.busy) return;
      if (x === "ignore") {
        e.preventDefault();
        ignoredCharDups.add(xb.dataset.g);
        return draw();
      }
      if (x === "ignoreall") {
        for (const b of box.querySelectorAll('[data-x="ignore"]')) ignoredCharDups.add(b.dataset.g);
        return draw();
      }
      if (x === "recheck") {
        ignoredCharDups.clear();
        S.busy = true;
        draw();
        try {
          await ctx().getCharacters?.();
        } catch {
        }
        S.busy = false;
        return draw();
      }
      if (x !== "del") return;
      const list = [...S.sel];
      if (!await confirmBox("删除角色卡", `将删除 ${list.length} 张角色卡（${list.slice(0, 3).join("、")}${list.length > 3 ? " 等" : ""}），聊天记录保留在服务器上。角色卡删除后无法在酒馆中恢复。`, "删除", true)) return;
      S.busy = true;
      let n = 0;
      const fail = [];
      for (const a of list) {
        try {
          await deleteCharacterKeepChats(a);
          S.sel.delete(a);
          n++;
        } catch (er) {
          fail.push(`${a}：${er.message}`);
        }
      }
      try {
        await ctx().getCharacters?.();
      } catch {
      }
      S.busy = false;
      if (n) toast(`已删除 ${n} 张角色卡`, "success");
      if (fail.length) toast(fail.slice(0, 2).join("；"), "error");
      draw();
    });
    draw();
    return;
  }

  // ---------- 世界书 ----------
  if (kind === "world") {
    let res = null;
    const usage = () => {
      const out = {};
      const add = (n, w) => n && (out[n] ||= []).push(w);
      for (const n of mods.wi?.selected_world_info || []) add(n, "全局启用");
      for (const ch of ctx().characters || []) add(ch?.data?.extensions?.world, `角色「${ch.name}」绑定`);
      add(ctx().chatMetadata?.world_info, "当前聊天绑定");
      return out;
    };
    const draw = () => {
      const names = listWorldbooks();
      const use = usage();
      const pickN = [...S.sel].length;
      let html = `<div class="pa-sum"><p class="pa-sum-main">世界书 <b>${names.length}</b> 本</p>
        ${tip(`<p>世界书只在用到时才下载，删除重复的不会让酒馆打开变快，只是更整齐。</p>
          <p>比对要把全部世界书下载一遍，世界书多、网速慢时要等一会儿。比较每个条目的正文和全部设置（关键词、启用、概率、位置、深度等），只忽略条目编号和排列下标。</p>
          <p>标有「绑定」「全局启用」的世界书删除后，对应的角色或聊天将失去它。</p>`)}
        <div class="pa-card-act"><button class="pa-btn pa-btn-soft pa-btn-s" data-x="scan" ${S.busy ? "disabled" : ""}>${res ? "重新比对" : "比对全部世界书"}</button><span class="pa-hint pa-ck-prog"></span></div></div>`;
      if (res) {
        const groups = [...res.byHash.values()].filter((g) => g.length > 1);
        const row = (w) => `<label class="pa-crow${S.sel.has(w.name) ? " on" : ""}">${chk(w.name, S.sel.has(w.name), false)}
          <span class="pa-crow-main"><b>${esc(w.name)}</b><span class="pa-crow-tags"><span class="pa-chip pa-chip-dim">${w.n} 条</span>${(use[w.name] || []).slice(0, 2).map((u) => `<span class="pa-chip pa-ctag-use">${esc(u)}</span>`).join("")}</span></span>
          <span class="pa-crow-size"><em>${fmtSize(w.size)}</em></span></label>`;
        if (res.failed.length) html += `<p class="pa-warn">${res.failed.length} 本读取失败，没有参与比对：${esc(res.failed.slice(0, 4).join("、"))}${res.failed.length > 4 ? " 等" : ""}</p>`;
        html += groups.length ? `<h3 class="pa-h">条目完全相同（${groups.length} 组）</h3>${groups.map((g) => `<div class="pa-clist pa-ck-group">${g.map(row).join("")}</div>`).join("")}` : '<p class="pa-empty">没有条目完全相同的世界书。</p>';
        if (res.empty.length) html += `<h3 class="pa-h">没有条目的世界书（${res.empty.length}）</h3><div class="pa-clist">${res.empty.map(row).join("")}</div>`;
      }
      html += actBar(pickN, 0, '<button class="pa-btn pa-btn-danger-soft" data-x="del">下载后删除</button>');
      box.innerHTML = html;
    };
    box.addEventListener("change", (e) => {
      if (e.target.dataset.x !== "pick") return;
      toggle(e.target.dataset.k, e.target.checked);
      draw();
    });
    box.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy) return;
      if (x === "scan") {
        S.busy = true;
        draw();
        const names = listWorldbooks();
        const byHash = new Map(), empty = [], failed = [];
        res = null;
        for (const [i, n] of names.entries()) {
          const p = box.querySelector(".pa-ck-prog");
          if (p) p.textContent = `正在读取 ${i + 1}/${names.length}：${n}`;
          try {
            const data = await mods.wi.loadWorldInfo(n);
            const list = wiSorted(data);
            const w = { name: n, n: list.length, size: jsonSize(data) };
            if (!list.length) { empty.push(w); continue; }
            // 比较条目的全部设置（启用、概率、位置、深度……），只忽略编号和排列下标
            const h = hashStr(JSON.stringify(list.map((e2) => {
              const { uid: _u, displayIndex: _d, ...rest } = e2;
              return stableJson(rest);
            })));
            (byHash.get(h) || byHash.set(h, []).get(h)).push(w);
          } catch {
            failed.push(n);
          }
        }
        res = { byHash, empty, failed };
        S.busy = false;
        return draw();
      }
      if (x === "del") {
        const list = [...S.sel];
        const use = usage();
        const bound = list.filter((n) => use[n]?.length);
        if (!await confirmBox("删除世界书", `将删除 ${list.length} 本世界书：${list.slice(0, 4).join("、")}${list.length > 4 ? " 等" : ""}。删除前会先下载一份 zip。${bound.length ? `其中 ${bound.join("、")} 正被使用，删除后对应的角色或聊天将失去它。` : ""}`, "下载后删除", true)) return;
        S.busy = true;
        const files = [];
        const unread = [];
        for (const n of list) {
          try {
            const data = await mods.wi.loadWorldInfo(n);
            if (!data || typeof data !== "object") throw new Error("读取结果为空");
            files.push({ name: `${n}.json`, data: JSON.stringify(data, null, 2) });
          } catch {
            unread.push(n);
          }
        }
        // 没备份下来的不删
        if (unread.length) toast(`${unread.join("、")} 读取失败、没有备份下来，这些不删除`, "warning");
        if (files.length) {
          const fname = `worldbooks-backup-${stamp()}.zip`;
          const zip = makeZip(files);
          downloadBlob(zip, fname);
          if (!await confirmDownloaded(fname, () => downloadBlob(zip, fname))) {
            S.busy = false;
            return draw();
          }
        }
        let ok = 0;
        for (const n of list.filter((x) => !unread.includes(x))) {
          try {
            await deleteWorldbook(n);
            S.sel.delete(n);
            ok++;
          } catch (er) {
            toast(`删除「${n}」失败：${er.message}`, "error");
          }
        }
        if (res) {
          for (const g of res.byHash.values()) for (let i = g.length - 1; i >= 0; i--) if (!listWorldbooks().includes(g[i].name)) g.splice(i, 1);
          res.empty = res.empty.filter((w) => listWorldbooks().includes(w.name));
          res.failed = res.failed.filter((n) => listWorldbooks().includes(n));
        }
        S.busy = false;
        if (ok) toast(`已删除 ${ok} 本世界书`, "success");
        return draw();
      }
    });
    draw();
    return;
  }

  // ---------- 本地备份（本扩展在这个浏览器里存的东西） ----------
  if (kind === "local") {
    let info = null;
    const load = async () => {
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
      } catch {
      }
      const est = await navigator.storage?.estimate?.().catch(() => null);
      info = { groups: [...by.values()].sort((a, b) => b.size - a.size), total: [...by.values()].reduce((n, g) => n + g.size, 0), count: all.length, drafts, draftN, est };
    };
    const draw = () => {
      if (!info) { box.innerHTML = '<p class="pa-hint">正在统计…</p>'; return; }
      const max = info.groups[0]?.size || 1;
      box.innerHTML = `
        <div class="pa-sum"><p class="pa-sum-main">备份 <b>${info.count}</b> 份 · <b>${fmtSize(info.total)}</b>${info.draftN ? ` · 草稿 ${info.draftN} 份` : ""}</p>
          ${tip(`<p>这些备份只存在这个浏览器里，不影响酒馆打开速度；占用过多时，iPad、手机可能清除网站数据或重新加载页面。</p>
            ${info.draftN ? `<p>未保存的草稿约 ${fmtSize(info.drafts)}。</p>` : ""}
            ${info.est?.usage ? `<p>这个网站在本浏览器中共占用约 ${fmtSize(info.est.usage)}（含酒馆和其他扩展）。</p>` : ""}`)}
          <div class="pa-card-act"><button class="pa-btn pa-btn-s" data-x="keep3" ${info.count ? "" : "disabled"}>每个预设只留最近 3 份</button><button class="pa-btn pa-btn-s pa-btn-danger-soft" data-x="clear" ${info.count ? "" : "disabled"}>删除全部备份</button></div></div>
        <div class="pa-rank">${info.groups.map((g) => `<div><span>${esc(g.name)}（${g.list.length} 份）</span><i class="pa-bar"><b style="width:${Math.max(2, Math.round(g.size / max * 100))}%"></b></i><em>${fmtSize(g.size)}</em></div>`).join("") || '<p class="pa-hint">没有备份。</p>'}</div>`;
    };
    box.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (!x || S.busy) return;
      const all = x === "clear";
      if (!await confirmBox(all ? "删除全部备份" : "精简备份", all ? "将删除本浏览器中本扩展保存的全部预设备份。预设本身不受影响。" : "每个预设只保留最近 3 份备份，其余删除。预设本身不受影响。", "删除", true)) return;
      S.busy = true;
      let n = 0;
      for (const g of info.groups) for (const b of all ? g.list : g.list.slice(3)) { await backupDel(b.id).catch(() => {}); n++; }
      S.busy = false;
      toast(`已删除 ${n} 份备份`, "success");
      info = null;
      draw();
      await load();
      draw();
    });
    draw();
    load().then(draw);
  }
}
