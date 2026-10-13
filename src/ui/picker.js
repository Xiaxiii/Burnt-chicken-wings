function presetPicker(slot, onPick, { label = "预设" } = {}) {
  slot.innerHTML = `<label class="pa-picker"><span>${esc(label)}</span><select class="pa-select" aria-label="${esc(label)}"></select></label>`;
  const sel = slot.querySelector("select");
  let current2 = null;
  function fill() {
    const names = listPresets();
    const using = currentPresetName();
    sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}${n === using ? "（在用）" : ""}</option>`).join("");
    if (current2) sel.value = current2;
  }
  fill();
  sel.addEventListener("change", () => {
    current2 = sel.value;
    onPick(sel.value);
  });
  return {
    set(name) {
      current2 = name;
      if (![...sel.options].some((o) => o.value === name)) fill();
      sel.value = name;
    },
    refresh: fill,
    el: sel
  };
}

