// 1.3.8 选位置：点组名＝放在组后（组外），展开组点条目＝放进组内；整组缝过去保持成组；整理页移动整组保持成组
// 用法：先 npm run mock，在仓库根目录起静态服务（python3 -m http.server 8765），再 node test/place-check.mjs
import { chromium } from "playwright";
const exe = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://127.0.0.1:8765/test/site/index.html");
await page.waitForFunction(() => window.__presetAtelier?.open, null, { timeout: 15000 });

// 合成的来源预设 F1：两个分组 + 散条目
const P = (id, name, content) => ({ identifier: id, name, content, role: "system", system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100 });
const prompts = [P("f1-a", "🎨开场白", "开场白要短。"), P("f1-s1", "🖋️白描", "<白描>\n只写动作和对白。\n</白描>"), P("f1-s2", "🖋️古风", "<古风>\n半文半白。\n</古风>"), P("f1-s3", "🖋️冷幽默", "<冷幽默>\n干巴巴的幽默。\n</冷幽默>"), P("f1-t1", "🎭小剧场·日常", "<小剧场>\n日常。\n</小剧场>"), P("f1-z", "📌收尾", "结尾不要总结。")];
const F1 = {
  prompts,
  prompt_order: [{ character_id: 100001, order: prompts.map((p) => ({ identifier: p.identifier, enabled: true })) }],
  extensions: { baibaiToolkit: { presetPromptGroups: { version: 1, groups: [{ id: "g-style", name: "F1文风", order: 0, collapsed: true, enabled: true }, { id: "g-th", name: "F1小剧场", order: 1, collapsed: true, enabled: true }], prompts: { "f1-s1": { groupId: "g-style" }, "f1-s2": { groupId: "g-style" }, "f1-s3": { groupId: "g-style" }, "f1-t1": { groupId: "g-th" } } } } },
};
const T = "【众生相】Claude-Lite-v1.8";
await page.evaluate((F1) => { window.__mock.names.push("F1"); window.__mock.presets.push(F1); window.__presetAtelier.open("suture"); }, F1);
await page.waitForTimeout(400);
await page.selectOption(".pa-dst-picker select", T); await page.waitForTimeout(300);
await page.selectOption(".pa-src-pick select", "F1"); await page.waitForTimeout(300);

// 预设的顶层结构：分组写成 [组名: 成员…]，散条目直接写名字
const layout = () => page.evaluate((T) => {
  const m = window.__mock; const p = m.presets[m.names.indexOf(T)];
  const bb = p.extensions.baibaiToolkit.presetPromptGroups;
  const order = p.prompt_order.find((o) => o.character_id == 100001).order.map((o) => o.identifier);
  const nm = (id) => p.prompts.find((x) => x.identifier === id)?.name || id;
  const out = [];
  for (const id of order) {
    const g = bb.prompts[id]?.groupId; const last = out[out.length - 1];
    if (g && last?.g === g) last.ids.push(nm(id)); else out.push({ g, ids: [nm(id)] });
  }
  return out.map((b) => b.g ? `[${bb.groups.find((x) => x.id === b.g)?.name}: ${b.ids.join("、")}]` : b.ids.join("、"));
}, T);
const fail = [];
const check = (ok, msg) => { console.log(ok ? "✓" : "✗", msg); if (!ok) fail.push(msg); };
const where = () => page.evaluate(() => document.querySelector(".pa-where").textContent);
const ghead = (name, root = ".pa-dst-list") => page.evaluate(({ name, root }) => [...document.querySelectorAll(`${root} .pa-ghead`)].findIndex((h) => h.querySelector(".pa-gname").textContent.trim().startsWith(name)), { name, root });
const clickHead = async (name, root = ".pa-dst-list") => { const i = await ghead(name, root); await page.locator(`${root} .pa-ghead .pa-gname`).nth(i).click(); await page.waitForTimeout(200); };
const clickCaret = async (name, root = ".pa-dst-list") => { const i = await ghead(name, root); await page.locator(`${root} .pa-ghead`).nth(i).locator(".pa-caret").click(); await page.waitForTimeout(200); };
const commit = async () => { await page.click('[data-st="go"]'); await page.waitForTimeout(600); await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500); };

console.log("before:", (await layout()).join(" | "));
check(!(await page.locator('.pa-dst-list [data-act="into"]').count()), "目标列表里没有「缝进这组」按钮");

// 1) 整组 F1文风 → 点「正文规则」组名 ＝ 缝在正文规则和写作指导之间，保持成组
await page.evaluate(() => { const h = [...document.querySelectorAll(".pa-src-list .pa-ghead")].find((x) => x.textContent.includes("F1文风")); h.querySelector('[data-act="gselect"]').click(); });
await page.waitForTimeout(200);
await clickHead("正文规则");
check((await where()) === "缝到：「正文规则」组之后（组外）", "点组名的位置：" + (await where()));
await page.screenshot({ path: "test/shots/p-1-after-group.png" });
await page.click('[data-st="go"]'); await page.waitForTimeout(600);
check((await page.evaluate(() => document.querySelector('.pa-sheet [data-g="grp"]')?.value)) === "keep", "预览默认「保持原分组」");
await page.screenshot({ path: "test/shots/p-2-review.png" });
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500);
let L = await layout();
console.log("after 1:", L.join(" | "));
const i1 = L.indexOf("[F1文风: 🖋️白描、🖋️古风、🖋️冷幽默]");
check(i1 > 0 && L[i1 - 1].startsWith("[正文规则:") && L[i1 + 1].startsWith("[写作指导:"), "F1文风成组落在 正文规则 与 写作指导 之间");
check(L.find((x) => x.startsWith("[正文规则:")) === "[正文规则: 📏字数、🚫禁词]", "正文规则组没被塞东西");
check((await where()).includes("「F1文风」组之后"), "缝完位置接在新组后面：" + (await where()));
await page.screenshot({ path: "test/shots/p-3-done.png" });

// 2) 散条目 → 展开「写作指导」点组内第一条 ＝ 缝进组内
await page.evaluate(() => [...document.querySelectorAll(".pa-src-list .pa-row")].find((r) => r.textContent.includes("开场白")).click());
await clickCaret("写作指导");
await page.evaluate(() => { const sec = [...document.querySelectorAll(".pa-dst-list .pa-group")].find((s) => s.querySelector(".pa-gname").textContent.includes("写作指导")); sec.querySelector(".pa-row").click(); });
await page.waitForTimeout(200);
check((await where()) === "缝到：「写作指导」组内，「🖋️人物塑造」之后", "组内位置：" + (await where()));
await commit();
L = await layout();
check(L.includes("[写作指导: 🖋️人物塑造、🎨开场白、🎬场景推进]"), "开场白进了写作指导组内");

// 3) 「最前面」
await page.evaluate(() => [...document.querySelectorAll(".pa-src-list .pa-row")].find((r) => r.textContent.includes("收尾")).click());
await page.click('.pa-dst-list [data-act="top"]'); await page.waitForTimeout(200);
check((await where()) === "缝到：最前面", "最前面：" + (await where()));
await commit();
L = await layout();
check(L[0] === "📌收尾", "收尾在最前面（组外）");

// 4) 「组内最前」
await page.evaluate(() => [...document.querySelectorAll(".pa-src-list .pa-row")].find((r) => r.textContent.includes("小剧场·日常")).click());
await clickCaret("思维链");
await page.evaluate(() => { const sec = [...document.querySelectorAll(".pa-dst-list .pa-group")].find((s) => s.querySelector(".pa-gname").textContent.includes("思维链")); sec.querySelector('[data-act="gstart"]').click(); });
await page.waitForTimeout(200);
check((await where()) === "缝到：「思维链」组内最前", "组内最前：" + (await where()));
await page.click('[data-st="go"]'); await page.waitForTimeout(600);
check(!(await page.locator('.pa-sheet [data-g="grp"]').count()), "缝进组内时没有分组选项");
await page.click(".pa-sheet-actions .pa-btn-primary"); await page.waitForTimeout(1500);
L = await layout();
check(L.find((x) => x.startsWith("[思维链:"))?.startsWith("[思维链: 🎭小剧场·日常、"), "小剧场·日常在思维链组第一条");
console.log("after suture:", L.join(" | "));

// 5) 整理页：整组「顶部」移到「文风设定」后面，保持成组
await page.click('[data-tab="organize"]'); await page.waitForTimeout(300);
await page.selectOption(".pa-picker-slot select", T); await page.waitForTimeout(300);
await page.evaluate(() => { const h = [...document.querySelectorAll(".pa-list .pa-ghead")].find((x) => x.textContent.includes("顶部")); h.querySelector('[data-act="gselect"]').click(); });
await page.waitForTimeout(200);
await page.click('[data-sel="moveto"]'); await page.waitForTimeout(200);
await page.screenshot({ path: "test/shots/p-4-move.png" });
check(!(await page.locator('.pa-list [data-act="into"]').count()), "移动模式没有「放进这组」按钮");
await clickHead("文风设定", ".pa-list");
await page.waitForTimeout(800);
L = await layout();
const iS = L.findIndex((x) => x.startsWith("[文风设定:"));
check(L[iS + 1] === "[顶部: 🎭身份、📜破限]", "顶部整组移到文风设定之后，仍是一个组");

// 6) 整理页：组内一条 → 点另一个组名 ＝ 出组，放在那个组后面
await page.click('[data-sel="none"]'); await page.waitForTimeout(200);
await page.click('[data-tool="menu"]'); await page.waitForTimeout(250);
await page.click('.pa-pick-item:has-text("全部展开")'); await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll(".pa-list .pa-row")].find((r) => r.textContent.includes("禁词")).click());
await page.click('[data-sel="moveto"]'); await page.waitForTimeout(200);
await clickHead("写作指导", ".pa-list");
await page.waitForTimeout(800);
L = await layout();
const iW = L.findIndex((x) => x.startsWith("[写作指导:"));
check(L[iW + 1] === "🚫禁词" && L.includes("[正文规则: 📏字数]"), "禁词出组，落在写作指导之后");
console.log("after organize:", L.join(" | "));
await page.screenshot({ path: "test/shots/p-5-organize.png" });

console.log(errs.length ? errs : "no page errors");
await browser.close();
if (fail.length || errs.length) process.exit(1);
