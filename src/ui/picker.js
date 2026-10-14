// 名称选择：一个小按钮「名称 ▾」，点开是带搜索的列表（预设、世界书多的时候好找）。
// 预设、世界书的列表一律带搜索（不看数量），外面就不再另放搜索框；只有几个固定选项的（来源类型、排序）传 search:false。
// 代替系统下拉框：系统下拉框在手机上又大又长，也不能搜索。

/**
 * @param {{title:string, items:{value:string,label?:string,sub?:string}[], current?:string, search?:boolean}} o
 * @returns {Promise<string|null>}
 */
async function pickName({ title, items, current = null, search } = {}) {
  const useSearch = search ?? true;
  const body = el(`<div class="pa-npick">${useSearch ? '<input class="pa-input pa-npick-q" type="search" placeholder="🔍 搜索" autocapitalize="off" autocomplete="off">' : ""}<div class="pa-npick-list" role="listbox"></div></div>`);
  const q = body.querySelector(".pa-npick-q");
  const box = body.querySelector(".pa-npick-list");
  let picked = null;
  const paint = () => {
    const k = (q?.value || "").trim().toLowerCase();
    const hits = items.filter((it) => !k || String(it.label ?? it.value).toLowerCase().includes(k) || String(it.sub || "").toLowerCase().includes(k));
    box.innerHTML = hits.map((it) => `<button class="pa-npick-item${it.value === current ? " on" : ""}" data-v="${esc(it.value)}" role="option" aria-selected="${it.value === current}"><span>${esc(it.label ?? it.value)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</button>`).join("") || '<p class="pa-hint">没有匹配的</p>';
  };
  q?.addEventListener("input", paint);
  paint();
  await sheet({ title, body, noFocus: true, actions: [], onMount: (w) => {
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      picked = b.dataset.v;
      w.querySelector(".pa-sheet-x").click();
    });
    box.querySelector(".on")?.scrollIntoView({ block: "center" });
  } });
  return picked;
}

// 按钮的 HTML：名称过长时省略，整名放在 title 里
function nameBtnHtml(name, cls = "", placeholder = "请选择") {
  return `<button class="pa-namebtn ${cls}" type="button" title="${esc(name || "")}"><span>${esc(name || placeholder)}</span><i aria-hidden="true">▾</i></button>`;
}

function presetPicker(slot, onPick, { label = "预设" } = {}) {
  slot.innerHTML = `<div class="pa-picker">${label ? `<span>${esc(label)}</span>` : ""}${nameBtnHtml("")}</div>`;
  const btn = slot.querySelector(".pa-namebtn");
  btn.setAttribute("aria-label", label || "预设");
  let current2 = null;
  const paintBtn = () => {
    const using = currentPresetName();
    btn.title = current2 || "";
    btn.querySelector("span").textContent = current2 || "请选择";
    btn.classList.toggle("pa-using", !!current2 && current2 === using);
  };
  btn.addEventListener("click", async () => {
    const using = currentPresetName();
    const v = await pickName({ title: label ? `选择${label}` : "选择预设", current: current2, items: listPresets().map((n) => ({ value: n, sub: n === using ? "使用中" : "" })) });
    if (!v || v === current2) return;
    current2 = v;
    paintBtn();
    onPick(v);
  });
  return {
    set(name) {
      current2 = name;
      paintBtn();
    },
    refresh: paintBtn,
    el: btn
  };
}
