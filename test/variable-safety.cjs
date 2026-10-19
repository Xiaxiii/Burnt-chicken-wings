// 通用补读取的安全边界：node test/variable-safety.cjs
const assert = require("node:assert/strict");
const A = require("./core.cjs");
const mk = (rows) => new A.Draft("p", {
  prompts: rows.map(([identifier, name, content]) => ({ identifier, name, content, role: "system" })),
  prompt_order: [{ character_id: 100001, order: rows.map(([identifier]) => ({ identifier, enabled: true })) }]
});
let count = 0;
const test = (name, fn) => { fn(); count++; console.log("✓", name); };
const refuses = (draft, key, reason, manual) => {
  const before = JSON.stringify(draft.toPreset());
  assert.throws(() => A.variableRepairPlan(draft, key, manual), reason);
  assert.equal(JSON.stringify(draft.toPreset()), before, "拒绝时不修改预设");
};

test("普通 local/global set/add 仍在最后一个写入条目后补读取", () => {
  for (const global of [false, true]) {
    const scope = global ? "global" : "";
    const d = mk([["a", "甲", `{{set${scope}var::文风::细腻}}`], ["b", "乙", `{{add${scope}var::文风::，克制}}`]]);
    const before = JSON.stringify(d.toPreset());
    assert.deepEqual(A.variableRepairPlan(d, (global ? "全局:" : "") + "文风"), {
      last: "b", macro: `{{get${scope}var::文风}}`, name: "文风", key: (global ? "全局:" : "") + "文风"
    });
    assert.equal(JSON.stringify(d.toPreset()), before, "生成方案不修改预设");
  }
});

test("已有 local/global 读取时拒绝重复添加", () => {
  for (const global of [false, true]) {
    const scope = global ? "global" : "";
    refuses(mk([["w", "写入", `{{set${scope}var::x::内容}}`], ["r", "读取", `{{get${scope}var::x}}`]]), (global ? "全局:" : "") + "x", /已有开启的条目读取/);
  }
});

test("任一开启写入有 inc/dec 时均拒绝，即使后面另有 set/add", () => {
  for (const global of [false, true]) for (const op of ["inc", "dec"]) {
    const scope = global ? "global" : "";
    const key = (global ? "全局:" : "") + "x";
    refuses(mk([["w", "计数", `{{${op}${scope}var::x}}`]]), key, /计数/);
    refuses(mk([["w", "计数", `{{${op}${scope}var::x}}`], ["s", "赋值", `{{set${scope}var::x::内容}}`], ["a", "追加", `{{add${scope}var::x::补充}}`]]), key, /计数/);
  }
});

test("其他变量的计数不阻止普通内容变量补读取", () => {
  const d = mk([["w", "正文", "{{incvar::轮数}}{{setvar::文风::细腻}}"]]);
  assert.equal(A.variableRepairPlan(d, "文风").macro, "{{getvar::文风}}");
});

test("cotfrag 片段变量不通过通用读取输出", () => {
  const d = mk([["w", "片段", "{{setvar::sampleCOT::内部片段}}"], ["c", "思维链", "<thinking>\n其他步骤\n</thinking>"]]);
  assert.ok(A.analyze(d).issues.some((issue) => issue.kind === "cotfrag"));
  refuses(d, "sampleCOT", /接入思维链/);
  refuses(mk([["w", "片段", "{{setglobalvar::samplecot::内部片段}}"]]), "全局:samplecot", /接入思维链/);
});

test("名称、正文标签和跨条目区段识别的思维链写入均拒绝", () => {
  refuses(mk([["w", "思维链", "{{setvar::x::片段}}"]]), "x", /接入思维链/);
  refuses(mk([["w", "步骤", "<thinking>\n{{setvar::x::片段}}\n</thinking>"]]), "x", /接入思维链/);
  refuses(mk([["a", "开头", "<thinking>"], ["w", "中间", "{{setvar::x::片段}}"], ["z", "结尾", "</thinking>"]]), "x", /接入思维链/);
});

test("支持草稿和第三参数的手动思维链识别", () => {
  const d = mk([["w", "自定义步骤", "{{setvar::x::片段}}"]]);
  refuses(d, "x", /接入思维链/, { w: true });
  d.cotManual = { w: true };
  refuses(d, "x", /接入思维链/);
  assert.equal(A.variableRepairPlan(d, "x", { w: false }).macro, "{{getvar::x}}");
});

test("动态和空变量名拒绝生成读取宏", () => {
  refuses(mk([["w", "动态变量", "{{setvar::{{getvar::名字}}::内容}}"]]), "{{getvar::名字}}", /动态宏/);
  refuses(mk([["w", "动态变量", "{{setglobalvar::{{getvar::名字}}::内容}}"]]), "全局:{{getvar::名字}}", /动态宏/);
  refuses(mk([["w", "空名", "{{setvar::::内容}}"]]), "", /变量名为空/);
});

console.log(`\n${count} 项变量安全检查通过`);
