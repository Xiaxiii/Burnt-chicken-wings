var GLOBAL_ORDER_ID = 100001;
function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}
function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c2) => {
    const r = Math.random() * 16 | 0;
    return (c2 === "x" ? r : r & 3 | 8).toString(16);
  });
}
function findOrderList(preset) {
  if (!Array.isArray(preset.prompt_order)) preset.prompt_order = [];
  const po = preset.prompt_order;
  let entry = po.find((o) => Number(o.character_id) === GLOBAL_ORDER_ID) || po.find((o) => Number(o.character_id) === 1e5) || po[po.length - 1];
  if (!entry) {
    entry = { character_id: GLOBAL_ORDER_ID, order: (preset.prompts || []).map((p) => ({ identifier: p.identifier, enabled: true })) };
    po.push(entry);
  }
  if (!Array.isArray(entry.order)) entry.order = [];
  return entry;
}
var SYSTEM_MARKERS = /* @__PURE__ */ new Set(["main", "nsfw", "jailbreak", "chatHistory", "worldInfoAfter", "worldInfoBefore", "enhanceDefinitions", "charDescription", "charPersonality", "scenario", "personaDescription", "dialogueExamples"]);
var Draft = class {
  /** @param {string} name @param {object} preset */
  constructor(name, preset) {
    this.name = name;
    this.preset = clone(preset);
    if (!Array.isArray(this.preset.prompts)) this.preset.prompts = [];
    this.history = [];
    this.dirty = false;
    this._normalize();
  }
  _normalize() {
    const p = this.preset;
    if (!p.extensions || typeof p.extensions !== "object" || Array.isArray(p.extensions)) p.extensions = {};
    const ext = p.extensions;
    const bai = ext.baibaiToolkit?.presetPromptGroups;
    this.hadBaibai = !!bai;
    this.hadEntryGrouping = Array.isArray(ext.entryGrouping);
    const groups = { version: 1, groups: [], prompts: {} };
    if (bai && Array.isArray(bai.groups)) {
      groups.groups = bai.groups.map((g) => ({ ...g }));
      for (const [k, v] of Object.entries(bai.prompts || {})) {
        if (v && v.groupId) groups.prompts[k] = { ...v };
      }
      for (const key of Object.keys(bai)) if (!(key in groups)) groups[key] = clone(bai[key]);
    } else if (this.hadEntryGrouping) {
      const ids = this.order.map((o) => o.identifier);
      ext.entryGrouping.forEach((g, i) => {
        if (g && Array.isArray(g.memberIdentifiers)) {
          // 1.1.3：成员列表式分组（旧版只认首尾范围式，这类分组会被丢掉，保存后条目全散开）
          const mem = g.memberIdentifiers.filter((x) => ids.includes(x));
          if (!mem.length) return;
          const id = g.id || uid();
          groups.groups.push({ id, name: g.name || "分组", order: i, collapsed: true, enabled: true });
          for (const x of mem) groups.prompts[x] = { groupId: id };
          return;
        }
        const a = ids.indexOf(g.startIdentifier);
        const b = ids.indexOf(g.endIdentifier);
        if (a < 0 || b < 0) return;
        const id = g.id || uid();
        groups.groups.push({ id, name: g.name || "分组", order: i, collapsed: true, enabled: true });
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) groups.prompts[ids[k]] = { groupId: id };
      });
    }
    const valid = new Set(groups.groups.map((g) => g.id));
    for (const [k, v] of Object.entries(groups.prompts)) if (!valid.has(v.groupId)) delete groups.prompts[k];
    this.groups = groups;
    // 读进来时就存在的分组 id：保存时用来识别 entryGrouping 里旧版本镜像出来的同名分组
    this.loadedGroupIds = new Set(valid);
  }
  get order() {
    return findOrderList(this.preset).order;
  }
  prompt(id) {
    return this.preset.prompts.find((p) => p.identifier === id);
  }
  promptMap() {
    return new Map(this.preset.prompts.map((p) => [p.identifier, p]));
  }
  isMarker(id) {
    const p = this.prompt(id);
    return !!(p && (p.marker || SYSTEM_MARKERS.has(id) && !p.content));
  }
  groupOf(id) {
    return this.groups.prompts[id]?.groupId || null;
  }
  group(gid) {
    return this.groups.groups.find((g) => g.id === gid) || null;
  }
  isActive(id) {
    const o = this.order.find((x) => x.identifier === id);
    if (!o || o.enabled === false) return false;
    const p = this.prompt(id);
    if (!p) return false;
    const gid = this.groupOf(id);
    if (gid && this.group(gid)?.enabled === false) return false;
    return true;
  }
  // ---------- 撤销 ----------
  snapshot(label) {
    this.history.push({ label, order: clone(this.order), prompts: clone(this.preset.prompts), groups: clone(this.groups), extensions: clone(this.preset.extensions) });
    if (this.history.length > 60) this.history.shift();
    this.dirty = true;
  }
  undo() {
    const h = this.history.pop();
    if (!h) return null;
    findOrderList(this.preset).order = h.order;
    this.preset.prompts = h.prompts;
    this.groups = h.groups;
    if(h.extensions) this.preset.extensions = h.extensions;
    this.dirty = true;
    return h.label;
  }
  // ---------- 显示用：按顺序切成"分组框 / 散条目"块 ----------
  blocks() {
    const out = [];
    const seen = /* @__PURE__ */ new Map();
    for (const o of this.order) {
      const gid = this.groupOf(o.identifier);
      const last = out[out.length - 1];
      if (last && last.groupId === gid) {
        last.ids.push(o.identifier);
        continue;
      }
      const part = gid ? (seen.get(gid) || 0) + 1 : 0;
      if (gid) seen.set(gid, part);
      out.push({ groupId: gid, ids: [o.identifier], part });
    }
    for (const b of out) if (b.groupId) b.parts = seen.get(b.groupId);
    return out;
  }
  // ---------- 基础移动 ----------
  _take(ids) {
    const set = new Set(ids);
    const order = this.order;
    const taken = [];
    for (let i = order.length - 1; i >= 0; i--) {
      if (set.has(order[i].identifier)) taken.unshift(order.splice(i, 1)[0]);
    }
    const byId = new Map(taken.map((o) => [o.identifier, o]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }
  /**
   * 把条目移到某处。
   * @param {string[]} ids 按想要的先后排列
   * @param {{after?:string, before?:string, groupStart?:string, groupEnd?:string, index?:number}} where
   * @param {string|null|undefined} groupId 移动后归属的分组；undefined 表示按落点自动决定
   */
  move(ids, where, groupId) {
    ids = ids.filter((id) => this.order.some((o) => o.identifier === id));
    if (!ids.length) return;
    if (where.after && ids.includes(where.after)) {
      const idx2 = this.order.findIndex((o) => o.identifier === where.after);
      let k = idx2;
      while (k >= 0 && ids.includes(this.order[k].identifier)) k--;
      where = k >= 0 ? { after: this.order[k].identifier } : { index: 0 };
    }
    if (where.before && ids.includes(where.before)) {
      const idx2 = this.order.findIndex((o) => o.identifier === where.before);
      let k = idx2;
      while (k < this.order.length && ids.includes(this.order[k].identifier)) k++;
      where = k < this.order.length ? { before: this.order[k].identifier } : { index: this.order.length };
    }
    const autoGroup = this._groupAt(where);
    const taken = this._take(ids);
    const idx = this._resolveIndex(where);
    this.order.splice(idx, 0, ...taken);
    const g = groupId === void 0 ? autoGroup : groupId;
    for (const id of ids) this._setGroup(id, g);
  }
  /**
   * 按"选位置"的结果移动：groupId 为某组＝放进该组；为 null＝放在组外（顶层）。
   * 放在组外时，整组都被选中的分组保持成组，跟着一起挪（相当于移动整个分组）。
   * 只有一条的组不算：把那一条拖出来就是要它出组。
   */
  place(ids, where, groupId) {
    if (groupId) return this.move(ids, where, groupId);
    const set = new Set(ids);
    const whole = /* @__PURE__ */ new Map();
    const was = new Map(ids.map((id) => [id, this.groupOf(id)]));
    for (const g of new Set(was.values())) {
      if (!g) continue;
      const mem = this.order.filter((o) => this.groupOf(o.identifier) === g);
      whole.set(g, mem.length > 1 && mem.every((o) => set.has(o.identifier)));
    }
    this.move(ids, where, null);
    for (const id of ids) {
      const g = was.get(id);
      if (g && whole.get(g)) this._setGroup(id, g);
    }
  }
  _groupAt(where) {
    if (where.groupStart) return where.groupStart;
    if (where.groupEnd) return where.groupEnd;
    if (where.after) return this.groupOf(where.after);
    if (where.before) return this.groupOf(where.before);
    return null;
  }
  _resolveIndex(where) {
    const order = this.order;
    const pos = (id) => order.findIndex((o) => o.identifier === id);
    if (where.after) {
      const i = pos(where.after);
      return i < 0 ? order.length : i + 1;
    }
    if (where.before) {
      const i = pos(where.before);
      return i < 0 ? order.length : i;
    }
    if (where.groupStart) {
      const i = order.findIndex((o) => this.groupOf(o.identifier) === where.groupStart);
      return i < 0 ? order.length : i;
    }
    if (where.groupEnd) {
      let last = -1;
      order.forEach((o, i) => {
        if (this.groupOf(o.identifier) === where.groupEnd) last = i;
      });
      return last < 0 ? order.length : last + 1;
    }
    if (typeof where.index === "number") return Math.max(0, Math.min(order.length, where.index));
    return order.length;
  }
  _setGroup(id, gid) {
    if (gid) this.groups.prompts[id] = { ...this.groups.prompts[id] || {}, groupId: gid };
    else delete this.groups.prompts[id];
  }
  /** 按顺序排序一组 id（保持在预设里的相对先后） */
  sortByOrder(ids) {
    const pos = new Map(this.order.map((o, i) => [o.identifier, i]));
    return [...ids].sort((a, b) => (pos.get(a) ?? 1e9) - (pos.get(b) ?? 1e9));
  }
  // ---------- 分组操作 ----------
  createGroup(name, ids, { keepClickOrder = false } = {}) {
    const id = uid();
    const list = keepClickOrder ? ids : this.sortByOrder(ids);
    const firstIdx = Math.min(...list.map((x) => this.order.findIndex((o) => o.identifier === x)).filter((i) => i >= 0));
    const rest = this.order.filter((o) => !list.includes(o.identifier));
    let anchor = this.order.slice(0, firstIdx).filter((o) => !list.includes(o.identifier)).pop();
    if (anchor) {
      const g = this.groupOf(anchor.identifier);
      const next = rest[rest.indexOf(anchor) + 1];
      if (g && next && this.groupOf(next.identifier) === g) {
        const members = rest.filter((o) => this.groupOf(o.identifier) === g);
        anchor = members[members.length - 1];
      }
    }
    this.groups.groups.push({ id, name: name || "新分组", order: this.groups.groups.length, collapsed: false, enabled: true });
    this.move(list, anchor ? { after: anchor.identifier } : { index: 0 }, id);
    return id;
  }
  moveIntoGroup(ids, gid, { keepClickOrder = false, atStart = false } = {}) {
    const list = keepClickOrder ? ids : this.sortByOrder(ids);
    const members = this.order.filter((o) => this.groupOf(o.identifier) === gid && !list.includes(o.identifier));
    if (!members.length) {
      this.move(list, { index: this.order.length }, gid);
    } else if (atStart) {
      this.move(list, { before: members[0].identifier }, gid);
    } else {
      this.move(list, { after: members[members.length - 1].identifier }, gid);
    }
  }
  removeFromGroup(ids) {
    const list = this.sortByOrder(ids);
    const byGroup = /* @__PURE__ */ new Map();
    for (const id of list) {
      const g = this.groupOf(id);
      if (!g) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(id);
    }
    for (const [g, mem] of byGroup) {
      const rest = this.order.filter((o) => this.groupOf(o.identifier) === g && !mem.includes(o.identifier));
      if (rest.length) this.move(mem, { after: rest[rest.length - 1].identifier }, null);
      else for (const id of mem) this._setGroup(id, null);
    }
  }
  renameGroup(gid, name) {
    const g = this.group(gid);
    if (g) g.name = name;
  }
  dissolveGroup(gid) {
    for (const [k, v] of Object.entries(this.groups.prompts)) if (v.groupId === gid) delete this.groups.prompts[k];
    this.groups.groups = this.groups.groups.filter((g) => g.id !== gid);
  }
  setGroupEnabled(gid, on) {
    const g = this.group(gid);
    if (g) g.enabled = !!on;
  }
  /** 把分散成几段的分组收拢到第一段的位置 */
  gatherGroup(gid) {
    const ids = this.order.filter((o) => this.groupOf(o.identifier) === gid).map((o) => o.identifier);
    if (ids.length < 2) return;
    this.move(ids.slice(1), { after: ids[0] }, gid);
  }
  /** 整组上移/下移一个"块" */
  moveGroupBlock(gid, dir) {
    const blocks = this.blocks();
    const i = blocks.findIndex((b) => b.groupId === gid);
    if (i < 0) return;
    const ids = this.order.filter((o) => this.groupOf(o.identifier) === gid).map((o) => o.identifier);
    if (dir < 0) {
      const prev = blocks[i - 1];
      if (!prev) return;
      this.move(ids, { before: prev.ids[0] }, gid);
    } else {
      let j = i + 1;
      while (blocks[j] && blocks[j].groupId === gid) j++;
      const next = blocks[j];
      if (!next) return;
      this.move(ids, { after: next.ids[next.ids.length - 1] }, gid);
    }
  }
  moveStep(ids, dir) {
    const list = [...ids];
    const order = this.order;
    const positions = list.map(id => order.findIndex(o => o.identifier === id)).filter(i => i >= 0);
    const first = Math.min(...positions); const last = Math.max(...positions);
    if (dir < 0) {
      let k = first - 1;
      while (k >= 0 && list.includes(order[k].identifier)) k--;
      if (k < 0) return;
      this.move(list, { before: order[k].identifier });
    } else {
      let k = last + 1;
      while (k < order.length && list.includes(order[k].identifier)) k++;
      if (k >= order.length) return;
      this.move(list, { after: order[k].identifier });
    }
  }
  setEnabled(ids, on) {
    const set = new Set(ids);
    for (const o of this.order) if (set.has(o.identifier)) o.enabled = !!on;
  }
  /** 插入新条目（缝合用） */
  insertPrompts(items, where, groupId) {
    const ids = [];
    for (const it of items) {
      let id = it.prompt.identifier;
      if (!id || this.prompt(id)) id = uid();
      const prompt = { ...it.prompt, identifier: id };
      this.preset.prompts.push(prompt);
      this.order.push({ identifier: id, enabled: it.enabled !== false });
      ids.push(id);
    }
    this.move(ids, where, groupId);
    return ids;
  }
  deletePrompts(ids) {
    const set = new Set(ids);
    findOrderList(this.preset).order = this.order.filter((o) => !set.has(o.identifier));
    for (const po of this.preset.prompt_order) po.order = (po.order || []).filter((o) => !set.has(o.identifier));
    this.preset.prompts = this.preset.prompts.filter((p) => !set.has(p.identifier));
    for (const id of ids) delete this.groups.prompts[id];
  }
  // ---------- 写回 ----------
  /** 生成要保存的完整预设对象 */
  toPreset() {
    const out = clone(this.preset);
    const ext = out.extensions;
    const order = findOrderList(out).order;
    const firstIdx = /* @__PURE__ */ new Map();
    order.forEach((o, i) => {
      const g = this.groups.prompts[o.identifier]?.groupId;
      if (g && !firstIdx.has(g)) firstIdx.set(g, i);
    });
    const groups = clone(this.groups);
    groups.groups.sort((a, b) => (firstIdx.get(a.id) ?? 1e9) - (firstIdx.get(b.id) ?? 1e9));
    groups.groups.forEach((g, i) => {
      g.order = i;
    });
    const inOrder = new Set(order.map((o) => o.identifier));
    for (const k of Object.keys(groups.prompts)) if (!inOrder.has(k)) delete groups.prompts[k];
    const hasGroups = groups.groups.length > 0;
    // 1.1.3：分组按"读进来时的格式"写回，只写一种。
    // 旧版本会把百宝箱分组再镜像一份到 entryGrouping，两个插件同时显示时，
    // 百宝箱分组里就会再套一层同名分组；用户解除后，下次保存又被写回来。
    const useEntryGrouping = this.hadEntryGrouping && !this.hadBaibai;
    if (useEntryGrouping) {
      const pos = new Map(order.map((o, i) => [o.identifier, i]));
      const list = [];
      for (const g of groups.groups) {
        const mem = order.filter((o) => groups.prompts[o.identifier]?.groupId === g.id).map((o) => o.identifier);
        if (!mem.length) continue;
        const contiguous = pos.get(mem[mem.length - 1]) - pos.get(mem[0]) === mem.length - 1;
        list.push(contiguous
          ? { id: g.id, name: g.name, mode: "inclusive", startIdentifier: mem[0], endIdentifier: mem[mem.length - 1] }
          : { id: g.id, name: g.name, memberIdentifiers: mem, mode: "inclusive" });
      }
      ext.entryGrouping = list;
    } else {
      if (hasGroups || this.hadBaibai) {
        if (!ext.baibaiToolkit || typeof ext.baibaiToolkit !== "object") ext.baibaiToolkit = {};
        ext.baibaiToolkit.presetPromptGroups = groups;
      }
      if (Array.isArray(ext.entryGrouping)) {
        // 去掉和百宝箱分组同 id 的镜像，以及成员已经不存在的旧分组；别的插件自己建的分组保留
        const mirror = new Set([...(this.loadedGroupIds || []), ...groups.groups.map((g) => g.id)]);
        const live = new Set(order.map((o) => o.identifier));
        ext.entryGrouping = ext.entryGrouping.filter((g) => g && !mirror.has(g.id) && (Array.isArray(g.memberIdentifiers)
          ? g.memberIdentifiers.some((id) => live.has(id))
          : live.has(g.startIdentifier) && live.has(g.endIdentifier)));
        if (!ext.entryGrouping.length) delete ext.entryGrouping;
      }
    }
    return out;
  }
};

