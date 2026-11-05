// 加载体检：汇总测量结果与建议（原 ui/health.js）。测量在 maintenance/diagnostics.js
async function collectHealth() {
  const c2 = ctx();
  const m = measureLoad();
  const out = { ...m, warn: [], tips: [] };
  // ---- 每次打开要读取的数据（内存里的统计量）
  out.presets = allPresetSizes();
  out.presetTotal = out.presets.reduce((n, x) => n + x.size, 0);
  out.presetByApi = PRESET_APIS.map(([api, label]) => {
    const l = out.presets.filter((x) => x.api === api);
    return { api, label, n: l.length, size: l.reduce((n, x) => n + x.size, 0) };
  }).filter((x) => x.n);
  const es = c2.extensionSettings || {};
  out.extData = Object.keys(es).map((k) => ({ key: k, size: jsonSize(es[k]) })).sort((a, b) => b.size - a.size);
  out.extDataTotal = out.extData.reduce((n, x) => n + x.size, 0);
  const chars = c2.characters || [];
  out.charCount = chars.length;
  out.lazyChars = chars.length > 0 && chars.some((ch) => ch?.shallow);
  out.chatLen = (c2.chat || []).length;
  out.chatSize = jsonSize(c2.chat || []);
  const pu = c2.powerUserSettings || {};
  out.autoLoadChat = pu.auto_load_chat;
  out.chatTruncation = pu.chat_truncation;
  out.worldCount = (mods.wi?.world_names || []).length;
  try {
    const r = await fetch(stUrl("api/extensions/discover"), { headers: c2.getRequestHeaders?.() || {} });
    if (r.ok) {
      const list = await r.json();
      const disabled = new Set(es.disabledExtensions || []);
      out.extTotal = list.filter((x) => x.type !== "system").length;
      out.extEnabled = list.filter((x) => x.type !== "system" && !disabled.has(x.name)).length;
    }
  } catch {
  }
  // ---- 请求
  out.groups = summarizeRequests(m.reqs);
  out.byCat = Object.fromEntries(out.groups.map((g) => [g.cat, g]));
  out.slow = m.reqs.filter((r) => r.dur > 300).sort((a, b) => b.dur - a.dur).slice(0, 8);
  out.gaps = diagGaps(m);
  const TL = ["settings", "chars", "charGet", "chats", "extList", "extFiles", "media", "settingsSave"];
  out.timeline = [
    ...(out.domReady ? [{ label: "页面 DOM", start: 0, end: out.domReady }] : []),
    ...TL.map((k) => out.byCat[k]).filter(Boolean).map((g) => ({ label: g.label, start: g.start, end: g.end, n: g.n }))
  ];
  // ---- 建议（只说测得到的事实；拿不准的写「可能」，不指认是哪个扩展）
  const MB = 1024 * 1024;
  const st = out.byCat.settings;
  const prov = (g) => Object.keys(g?.providers || {});
  if (out.settingsCount > 1) out.warn.push({ h: `设置读取了 ${out.settingsCount} 次`, t: `本次记录到 ${out.settingsCount} 笔「设置及预设」读取请求${out.settingsBytes ? `，实际传输共 ${fmtSize(out.settingsBytes)}` : ""}。`, d: `正常打开只读取一次。可能是两个启动加速功能同时接管了设置读取，也可能是有扩展在启动后又读了一次；这里无法确定是哪个扩展发起的。${prov(st).length ? `本次走过的第三方接口：${prov(st).join("、")}。` : ""}可在扩展页「${appName()}」设置框里点「检查兼容性」查看已识别的加速提供者，逐个停用对比。` });
  const byApi = out.presetByApi.length > 1 ? `（${out.presetByApi.map((x) => `${x.label} ${x.n} 个 ${fmtSize(x.size)}`).join("，")}）` : `（${out.presets.length} 个）`;
  const others = out.presetByApi.filter((x) => x.api !== "openai");
  const wireNote = out.settingsOnce ? `本次「设置及预设」请求实际传输 ${fmtSize(out.settingsOnce)}${out.settingsDecoded ? `，解压后 ${fmtSize(out.settingsDecoded)}` : ""}。` : "";
  if (out.presetTotal > 5 * MB) out.warn.push({ h: `预设共 ${fmtSize(out.presetTotal)}，拖慢打开`, t: `全部预设在内存中约 ${fmtSize(out.presetTotal)}${byApi}，酒馆打开时会随设置一起读取。${wireNote}`, d: `内存中的大小是序列化后的统计量，不等于网络传输量。不常用的聊天补全预设可在「清理」中归档：移到服务器上的另一个位置，打开时不再读取，需要时可恢复。${others.length ? `${others.map((x) => x.label).join("、")}预设「清理」页不处理，可在酒馆对应的预设菜单中删除。` : ""}`, act: "clean" });
  else if (out.presetTotal > 2 * MB) out.tips.push({ h: `预设共 ${fmtSize(out.presetTotal)}，可以清理一些`, t: `全部预设在内存中约 ${fmtSize(out.presetTotal)}（${out.presets.length} 个），打开时随设置一起读取。${wireNote}`, d: "不常用的预设可在「清理」中归档。", act: "clean" });
  if (out.saveDuringLoad) out.tips.push({ h: "启动时有设置保存请求", t: "启动完成前记录到设置保存请求。", d: "保存会上传整个设置文件，可能和启动时的下载争用网络。这里无法判断是哪个扩展触发的；如果每次打开都出现，可逐个停用扩展对比。" });
  const bigExt = out.extData.filter((x) => x.size > 512 * 1024);
  if (bigExt.length) out.warn.push({ h: `${bigExt.length} 个扩展存的数据较多`, t: `以下扩展在设置文件中存有较多数据：${bigExt.slice(0, 3).map((x) => `「${x.key}」${fmtSize(x.size)}`).join("、")}。`, d: "设置文件每次打开都要读取，每次修改设置都要完整上传。可查看这些扩展是否提供清理或导出旧数据的功能，不用的扩展可停用。" });
  if (out.charCount > 150 && !out.lazyChars) out.tips.push({ h: `角色卡 ${out.charCount} 张，打开时全部读取`, t: `角色卡共 ${out.charCount} 张，打开时全部读取。`, d: "如能修改服务器上的 config.yaml，可将 performance 下的 lazyLoadCharacters 设为 true（按需加载角色卡），然后重启酒馆。" });
  if (out.autoLoadChat && out.chatLen > 300) out.tips.push({ h: `自动进入的聊天有 ${out.chatLen} 楼`, t: `打开时自动进入上次的聊天，该聊天共 ${out.chatLen} 楼（内存中约 ${fmtSize(out.chatSize)}）。`, d: "可在「用户设置」中关闭「自动加载上次聊天」；长聊天可新开存档，或总结后隐藏旧楼层。" });
  if (out.chatTruncation && out.chatTruncation > 100) out.tips.push({ h: `一次加载 ${out.chatTruncation} 条消息`, t: `「一次加载的消息数」为 ${out.chatTruncation}。`, d: "可在「用户设置」中调小（如 30～50），进入聊天时渲染的楼层更少，向上翻阅时可继续加载。" });
  if (out.extEnabled != null && out.extEnabled > 15) out.tips.push({ h: `开了 ${out.extEnabled} 个扩展`, t: `已开启 ${out.extEnabled} 个第三方扩展。`, d: "每个扩展在打开时都要加载脚本和设置。不常用的扩展可在扩展管理中停用，无需卸载。" });
  const extMax = new Map();
  for (const r of out.reqs) if (r.cat === "extFiles" && r.ext) extMax.set(r.ext, Math.max(extMax.get(r.ext) || 0, r.dur));
  const slowExt = [...extMax].filter(([, d]) => d > 1500).sort((a, b) => b[1] - a[1]);
  if (slowExt.length) out.tips.push({ h: `${slowExt.length} 个扩展的文件加载较久`, t: `文件加载较久的扩展：${slowExt.slice(0, 4).map(([x, d]) => `「${x}」（单个文件最长 ${fmtMs(d)}）`).join("、")}。`, d: "耗时包含排在其他请求后面等待的时间，不一定是扩展本身慢。可先停用，比较打开速度是否改善。" });
  const extHost = new Map();
  for (const r of out.reqs) if (r.cat === "external") extHost.set(r.host, Math.max(extHost.get(r.host) || 0, r.dur));
  const slowHost = [...extHost].filter(([, d]) => d > 1500);
  if (slowHost.length) out.tips.push({ h: "有扩展从外部网站加载资源", t: `有扩展从外部网站加载资源：${slowHost.slice(0, 3).map(([h, d]) => `${h}（最长 ${fmtMs(d)}）`).join("、")}。`, d: "这些网站在国内可能访问缓慢或无法访问，会拖慢打开过程。" });
  return out;
}
