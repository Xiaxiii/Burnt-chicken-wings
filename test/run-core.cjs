// 核心逻辑回归测试：node test/run-core.cjs
const A = require("./core.cjs");
const fs = require("fs"), path = require("path");
const assert = require("assert");
const load = (f) => new A.Draft("t", JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")));
const by = (d, n) => d.preset.prompts.find((p) => p.name === n);
const mk = (list, extra = {}) => new A.Draft("p", { prompts: list.map(([id, name, content, x]) => ({ identifier: id, name, content, ...(x || {}) })), prompt_order: [{ character_id: 100001, order: list.map(([id]) => ({ identifier: id, enabled: true })) }], ...extra });
let n = 0, skipped = 0;
// Ako 预设作者声明禁止二传，不放进仓库；本地有 fixtures/ako-stitched.json 时才跑相关测试
const hasAko = fs.existsSync(path.join(__dirname, "fixtures", "ako-stitched.json"));
const test = (name, fn) => {
  if (!hasAko && /Ako|嬷u|分组：|自带问句/.test(name)) { skipped++; console.log("-", name, "（缺少本地 Ako 预设，跳过）"); return; }
  fn(); n++; console.log("✓", name);
};

test("分组：有百宝箱时保存不再镜像 entryGrouping，二次保存也干净", () => {
  const d = load("ako-stitched.json");
  const out = d.toPreset();
  assert.ok(!out.extensions.entryGrouping);
  assert.equal(out.extensions.baibaiToolkit.presetPromptGroups.groups.length, 22);
  assert.ok(!new A.Draft("x", out).toPreset().extensions.entryGrouping);
});
test("分组：只有 entryGrouping 时读得出成员列表式分组、只写回 entryGrouping", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ako-stitched.json"), "utf8"));
  delete raw.extensions.baibaiToolkit.presetPromptGroups;
  const d = new A.Draft("x", raw);
  assert.equal(d.groups.groups.length, 20);
  const out = d.toPreset();
  assert.ok(!out.extensions.baibaiToolkit.presetPromptGroups);
  assert.equal(out.extensions.entryGrouping.length, 20);
});
test("Ako 每个分组推断出的写法都不会去占用邻居的问句变量", () => {
  const d = load("ako-stitched.json");
  for (const g of d.groups.groups) assert.equal(A.inferTarget(d, { groupEnd: g.id }, g.id).shape, "plain", g.name);
});
test("挂进思维链（问句变量）：嬷u·把玩挂到 COT-头部分析，紧跟 嬷嬷你，并补初始化", () => {
  const d = load("ako-stitched.json");
  const src = JSON.parse(JSON.stringify(by(d, "嬤u·把玩")));
  d.deletePrompts([src.identifier]);
  const anchor = by(d, "🔔建议常驻选一·我是U嬷王").identifier, gid = d.groupOf(anchor);
  const t = A.inferTarget(d, { after: anchor }, gid);
  const plan = A.planItem({ name: src.name, content: src.content }, t, {});
  const h = A.planHook(d, { after: anchor }, gid, { content: plan.content, name: src.name, label: plan.label });
  assert.equal(h.mode, "own"); assert.equal(h.on, true); assert.equal(h.anchorVar, "嬷嬷你");
  const ids = d.insertPrompts([{ prompt: { ...src, identifier: undefined, content: A.contentWithHook(plan.content, h) }, enabled: true }], { after: anchor }, gid);
  const r = A.applyHook(d, h);
  assert.ok(r.inited);
  assert.ok(d.prompt(h.cotId).content.includes(`{{getvar::嬷嬷你}}\n{{getvar::${h.varName}}}`));
  assert.equal(A.analyze(d).coverage.get(ids[0]).level, "var");
});
test("挂进思维链（文字点名）：众生相式思维链在提到邻居那一行后面加点名", () => {
  const d = load("zsx-like.json");
  const g = d.groups.groups.find((x) => x.name === "文风设定");
  const content = "<哥特浪漫>\n华丽、阴郁的意象，月光、废墟、蔷薇；情感浓烈但克制。\n</哥特浪漫>";
  const h = A.planHook(d, { groupEnd: g.id }, g.id, { content, name: "✒️哥特浪漫" });
  assert.equal(h.mode, "text"); assert.equal(h.on, true);
  const ids = d.insertPrompts([{ prompt: { name: "✒️哥特浪漫", content }, enabled: true }], { groupEnd: g.id }, g.id);
  A.applyHook(d, h);
  const cot = by(d, "✨思维链：推演").content;
  assert.ok(/<意识流>.*\n- <哥特浪漫>：/.test(cot), cot);
  assert.equal(A.analyze(d).coverage.get(ids[0]).level, "mention");
});
test("邻居各用各的标签时，不把邻居的标签套给新条目", () => {
  const d = load("zsx-like.json");
  const g = d.groups.groups.find((x) => x.name === "写作指导");
  const t = A.inferTarget(d, { groupEnd: g.id }, g.id);
  assert.ok(!t.tagTpl); assert.ok(t.ownTag);
  const plain = A.planItem({ name: "✒️节奏控制", content: "长短句交替，紧张时用短句。" }, t, {});
  assert.ok(plain.content.startsWith("<节奏控制>"), plain.content);
  const tagged = A.planItem({ name: "x", content: "<自带标签>\n内容内容\n</自带标签>" }, t, {});
  assert.ok(tagged.content.startsWith("<自带标签>"));
});
test("汇总变量：附近都 addvar 追加思维链片段时照样追加，不另开变量", () => {
  const d = mk([["i", "初始化", "{{setvar::cot片段::}}{{setvar::x::}}"], ["a", "A", "规则A正文规则A正文规则A正文规则A\n{{addvar::cot片段::\n- A？}}"], ["b", "B", "规则B正文规则B正文规则B正文规则B\n{{addvar::cot片段::\n- B？}}"], ["c", "思维链", "<thinking>\n{{getvar::cot片段}}\n</thinking>"]]);
  const h = A.planHook(d, { after: "b" }, null, { content: "新规则：角色说话前会停顿一下，再说出真正想说的话。", name: "新规则" });
  assert.equal(h.mode, "append"); assert.equal(h.varName, "cot片段");
  assert.ok(A.contentWithHook("正文", h).includes("{{addvar::cot片段::\n"));
});
test("全局变量：跟着用 setglobalvar / getglobalvar", () => {
  const d = mk([["i", "初始化", "{{setglobalvar::q1::}}{{setglobalvar::q2::}}"], ["a", "功能A", "功能A正文功能A正文功能A正文功能A正文\n{{setglobalvar::q1::### A怎么做？}}"], ["c", "COT", "<thinking>\n{{getglobalvar::q1}}\n</thinking>"]]);
  const h = A.planHook(d, { after: "a" }, null, { content: "新功能：角色在雨天会变得沉默，反复擦拭随身物品。", name: "新功能" });
  assert.equal(h.scope, "global");
  assert.ok(A.contentWithHook("x", h).includes("{{setglobalvar::"));
});
test("来源自带问句：沿用，不重复；撞名自动换名", () => {
  const d = load("ako-stitched.json");
  const anchor = by(d, "🔔建议常驻选一·我是U嬷王").identifier, gid = d.groupOf(anchor);
  const own = A.planHook(d, { after: anchor }, gid, { content: "<撒娇>\n角色会先嘴硬然后让步，让步要具体落在动作上。\n</撒娇>\n{{setvar::撒娇::### 根据<撒娇>，角色会在哪个动作上让步？}}", name: "撒娇" });
  assert.equal(own.varName, "撒娇");
  assert.equal((A.contentWithHook("<撒娇>\n角色会先嘴硬然后让步，让步要具体落在动作上。\n</撒娇>\n{{setvar::撒娇::### 根据<撒娇>，角色会在哪个动作上让步？}}", own).match(/setvar::撒娇/g) || []).length, 1);
  const clash = A.planHook(d, { after: anchor }, gid, { content: "一些正文一些正文一些正文一些正文一些正文\n{{setvar::content::### 问？}}", name: "撞名测试" });
  assert.notEqual(clash.varName, "content");
});
test("写法分析：Ako 认出初始化条目、问句变量写法；众生相式认出靠文字点名", () => {
  const ako = A.profilePreset(load("ako-stitched.json"));
  assert.ok(ako.initId); assert.ok(ako.perEntry.length >= 5);
  const zs = A.profilePreset(load("zsx-like.json"));
  assert.equal(zs.cotStyle, "text");
});
console.log(`\n${n} 项通过${skipped ? `，${skipped} 项跳过` : ""}`);
