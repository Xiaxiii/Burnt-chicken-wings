// 编辑条目（预设页、缝合页共用）：宽屏在右侧详情栏，窄屏整屏推入。打开时不把光标放进正文：手机上点了正文才弹键盘。
// promptOnly：世界书条目只有名称和正文。返回填写的值，取消返回 null；由调用方决定写到哪里
async function editEntrySheet(p, { marker = false, promptOnly = false, hint = "", title = "编辑条目" } = {}) {
  const s = detectShape(p.content);
  const info = s.shape === "wrap" || s.shape === "tagname" ? `${SHAPE_LABEL[s.shape]}「${s.varName}」` : SHAPE_LABEL[s.shape];
  const depthPos = p.injection_position === 1;
  const role = p.role || "system";
  const body = el(html`<div class="cw-form cw-entryform">
      ${hint ? html`<p class="cw-hint">${hint}</p>` : ""}
      <label class="cw-field"><span>名称</span><input class="cw-input" data-f="name" value="${p.name || ""}"></label>
      ${marker ? html`<p class="cw-hint">系统位置条目，正文由酒馆填入，这里只能改名称。</p>` : html`
        ${promptOnly ? "" : html`<div class="cw-field"><span>角色</span>${segHtml([["system", "系统"], ["user", "用户"], ["assistant", "AI"]], role, { attr: "data-role", size: "sm", label: "角色" })}</div>
        <div class="cw-field"><span>位置</span>${segHtml([["0", "按条目顺序"], ["1", "插入聊天记录"]], depthPos ? "1" : "0", { attr: "data-pos", size: "sm", label: "位置" })}</div>
        <div class="cw-form-row" data-show="depth"${depthPos ? "" : raw(" hidden")}>
          <label class="cw-field"><span>深度</span><input class="cw-input" type="number" min="0" inputmode="numeric" data-f="depth" value="${p.injection_depth ?? 4}"></label>
          <label class="cw-field"><span>同深度时的顺序</span><input class="cw-input" type="number" inputmode="numeric" data-f="order" value="${p.injection_order ?? 100}"></label>
        </div>`}
        <div class="cw-field cw-field-grow"><span>正文<small class="cw-dim">${info}</small><span class="cw-gap"></span>${ibtn("expand", "加宽编辑区", { act: "wide", cls: "cw-desk-tool" })}</span>
          <textarea class="cw-input cw-entry-text" data-f="content" spellcheck="false"></textarea></div>`}
    </div>`);
  const text = body.querySelector("[data-f=content]");
  if (text) text.value = p.content || "";
  let roleV = role, posV = depthPos ? "1" : "0";
  body.addEventListener("click", (e) => {
    const r = e.target.closest("[data-role]");
    if (r) {
      roleV = r.dataset.role;
      r.parentElement.querySelectorAll("[data-role]").forEach((x) => { x.classList.toggle("on", x === r); x.setAttribute("aria-selected", String(x === r)); });
    }
    const ps = e.target.closest("[data-pos]");
    if (ps) {
      posV = ps.dataset.pos;
      ps.parentElement.querySelectorAll("[data-pos]").forEach((x) => { x.classList.toggle("on", x === ps); x.setAttribute("aria-selected", String(x === ps)); });
      body.querySelector("[data-show=depth]").hidden = posV !== "1";
    }
    const w = e.target.closest('[data-act="wide"]');
    if (w) {
      const stage = shellRoot.querySelector(".cw-stage");
      const on = !stage.classList.contains("cw-detail-wide");
      stage.classList.toggle("cw-detail-wide", on);
      w.innerHTML = String(iconHtml(on ? "collapse" : "expand"));
      w.setAttribute("aria-label", on ? "收窄编辑区" : "加宽编辑区");
      w.title = w.getAttribute("aria-label");
    }
  });
  // 输入时不保存；点「保存」才写入，点「取消」或关闭不改动
  const r = await openDetail({
    title, body,
    actions: [{ label: "取消", value: null }, { label: "保存", kind: "primary", value: (box) => {
      const v = (k) => box.querySelector(`[data-f=${k}]`)?.value;
      return { name: v("name"), content: v("content"), role: promptOnly || marker ? void 0 : roleV, pos: posV, depth: v("depth"), order: v("order") };
    } }]
  });
  shellRoot?.querySelector(".cw-stage")?.classList.remove("cw-detail-wide");
  return r;
}
