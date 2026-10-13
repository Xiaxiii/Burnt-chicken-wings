var SEP_PAIRS = [
  [/^\s*╔(.+?)╗\s*$/, /^\s*╚(.+?)╝\s*$/],
  [/^\s*╓(.+?)╖\s*$/, /^\s*╙(.+?)╜\s*$/]
];
var SEP_SINGLE = [
  /^\s*[—–-]{2,}\s*(.+?)\s*[—–-]{2,}\s*$/,
  /^\s*✧[─—-]+(.+?)[─—-]+✧/,
  /^\s*♬[─—-]+(.+?)[─—-]+♬/,
  /^\s*♫•\*(.+?)\*•♫/,
  /^\s*˙⟡(.+?)₊˚⊹\s*$/,
  /^\s*[=＝]{2,}\s*(.+?)\s*[=＝]{2,}\s*$/,
  /^\s*[【\[](.+?)[】\]]\s*$/
];
function cleanTitle(t) {
  return String(t || "").replace(/(开始|结束|开启|关闭|start|end|↓|↑)\s*$/i, "").replace(/[↓↑]/g, "").trim();
}
function separatorInfo(name, content) {
  const n = String(name || "").trim();
  for (const [o, c2] of SEP_PAIRS) {
    let m = o.exec(n);
    if (m) return { title: cleanTitle(m[1]), kind: "open" };
    m = c2.exec(n);
    if (m) return { title: cleanTitle(m[1]), kind: "close" };
  }
  const short = String(content || "").trim().length < 60;
  for (let k = 0; k < SEP_SINGLE.length; k++) {
    const m = SEP_SINGLE[k].exec(n);
    if (m && short) {
      const raw = m[1];
      const kind = /(结束|关闭|end|↑)\s*$/i.test(raw) ? "close" : /(开始|开启|start|↓)\s*$/i.test(raw) ? "open" : "line";
      return { title: cleanTitle(raw), kind, style: k };
    }
  }
  return null;
}
function leadingSymbol(name) {
  const m = /^\s*([^\p{L}\p{N}\s]+)/u.exec(String(name || ""));
  if (!m) return "";
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(m[1])][0]?.segment : [...m[1]][0];
  return seg || "";
}
function suggestGroups(draft, { minSize = 3, onlyUngrouped = true } = {}) {
  const order = draft.order.map((o) => o.identifier);
  const free = (id) => !onlyUngrouped || !draft.groupOf(id);
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (!free(id) || used.has(id)) continue;
    const p = draft.prompt(id);
    const sep = separatorInfo(p?.name, p?.content);
    if (!sep || sep.kind === "close") continue;
    let end = -1;
    for (let j = i + 1; j < order.length; j++) {
      const q = draft.prompt(order[j]);
      if (!free(order[j])) break;
      const s2 = separatorInfo(q?.name, q?.content);
      if (!s2) continue;
      const same = s2.title && sep.title && (s2.title.includes(sep.title) || sep.title.includes(s2.title));
      if (same && (s2.kind === "close" || s2.kind === "line" || s2.kind === "open")) {
        end = j;
        break;
      }
      if (s2.kind === "open" && !same) {
        end = j - 1;
        break;
      }
    }
    if (end < 0) continue;
    const ids = order.slice(i, end + 1).filter((x) => free(x) && !used.has(x));
    if (ids.length >= minSize) {
      out.push({ name: sep.title || (p?.name || "分组"), ids, reason: "首尾分隔条目" });
      ids.forEach((x) => used.add(x));
    }
  }
  const heads = [];
  order.forEach((id, i) => {
    if (!free(id) || used.has(id)) return;
    const p = draft.prompt(id);
    const sep = separatorInfo(p?.name, p?.content);
    if (sep && sep.kind === "line" && sep.style !== void 0) heads.push({ i, id, style: sep.style, title: sep.title });
  });
  const styles = [...new Set(heads.map((h) => h.style))].filter((st) => heads.filter((h) => h.style === st).length >= 3);
  if (styles.length) {
    const primary = heads.find((h) => styles.includes(h.style)).style;
    const secondary = styles.find((st) => st !== primary);
    const prim = heads.filter((h) => h.style === primary);
    const sections = [];
    prim.forEach((h, k) => {
      const stop = k + 1 < prim.length ? prim[k + 1].i : order.length;
      let ids = order.slice(h.i, stop).filter((x) => free(x) && !used.has(x));
      const cut = order.slice(h.i, stop).findIndex((x) => !free(x));
      if (cut > 0) ids = order.slice(h.i, h.i + cut).filter((x) => !used.has(x));
      sections.push({ title: h.title, ids, start: h.i });
    });
    for (const sec of sections) {
      const subs = secondary === void 0 ? [] : heads.filter((h) => h.style === secondary && sec.ids.includes(h.id));
      if (sec.ids.length > 25 && subs.length) {
        const first = sec.ids.indexOf(subs[0].id);
        const headPart = sec.ids.slice(0, first);
        if (headPart.length >= minSize) out.push({ name: sec.title, ids: headPart, reason: "分隔小标题" });
        headPart.forEach((x) => used.add(x));
        subs.forEach((sub, k) => {
          const a = sec.ids.indexOf(sub.id);
          const b = k + 1 < subs.length ? sec.ids.indexOf(subs[k + 1].id) : sec.ids.length;
          const ids = sec.ids.slice(a, b);
          if (ids.length >= Math.min(minSize, 2)) {
            out.push({ name: `${sec.title}\xB7${sub.title}`, ids, reason: "分隔小标题" });
            ids.forEach((x) => used.add(x));
          }
        });
      } else if (sec.ids.length >= minSize) {
        out.push({ name: sec.title, ids: sec.ids, reason: "分隔小标题" });
        sec.ids.forEach((x) => used.add(x));
      }
    }
  }
  const varOf = (id) => {
    const s = detectShape(draft.prompt(id)?.content);
    return s.shape === "wrap" || s.shape === "tagname" ? s.varName : null;
  };
  let run = [];
  let runVar = null;
  const flushVar = () => {
    if (runVar && run.length >= minSize) {
      out.push({ name: runVar, ids: [...run], reason: `均写入变量「${runVar}」` });
      run.forEach((x) => used.add(x));
    }
    run = [];
    runVar = null;
  };
  for (const id of order) {
    if (!free(id) || used.has(id)) {
      flushVar();
      continue;
    }
    const v = varOf(id);
    const p = draft.prompt(id);
    const isBlank = !String(p?.content || "").trim();
    if (v && v === runVar) {
      run.push(id);
      continue;
    }
    if (!v && isBlank && runVar) {
      continue;
    }
    flushVar();
    if (v) {
      runVar = v;
      run = [id];
    }
  }
  flushVar();
  let sym = "";
  run = [];
  const flushSym = () => {
    if (sym && run.length >= minSize) {
      const names = run.map((x) => draft.prompt(x)?.name || "");
      out.push({ name: guessName(sym, names), ids: [...run], reason: `均以「${sym}」开头` });
      run.forEach((x) => used.add(x));
    }
    run = [];
    sym = "";
  };
  for (const id of order) {
    if (!free(id) || used.has(id)) {
      flushSym();
      continue;
    }
    const s = leadingSymbol(draft.prompt(id)?.name);
    if (s && s === sym) {
      run.push(id);
      continue;
    }
    flushSym();
    if (s) {
      sym = s;
      run = [id];
    }
  }
  flushSym();
  const pos = new Map(order.map((x, i) => [x, i]));
  out.sort((a, b) => pos.get(a.ids[0]) - pos.get(b.ids[0]));
  return out;
}
function guessName(sym, names) {
  const stripped = names.map((n) => n.replace(/^[^\p{L}\p{N}]+/u, ""));
  let pre = stripped[0] || "";
  for (const n of stripped) {
    while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  }
  pre = pre.replace(/[|｜\-—_·:：\s]+$/, "");
  if (pre.length >= 2) return `${sym}${pre}`;
  return `${sym}${stripped[0] ? stripped[0].slice(0, 6) : ""}等`;
}

