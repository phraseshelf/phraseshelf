"use strict";

const { invoke } = window.__TAURI__.core;
const $ = (sel) => document.querySelector(sel);

const els = {
  tabs: $("#tabs"),
  grid: $("#grid"),
  empty: $("#empty"),
  search: $("#search"),
  toast: $("#toast"),
  snippetDlg: $("#snippet-dlg"),
  snippetForm: $("#snippet-form"),
  tabDlg: $("#tab-dlg"),
  tabForm: $("#tab-form"),
  confirmDlg: $("#confirm-dlg"),
  addTab: $("#add-tab"),
  theme: $("#theme"),
  version: $("#version"),
  tabColors: $("#tab-colors"),
};

// Tab colors: picked to read well with white text and as a light tint, in light and dark mode.
const PALETTE = [
  "#3b6fd9", // blue
  "#0f8f84", // teal
  "#3d8f3d", // green
  "#b7791f", // amber
  "#d9622b", // orange
  "#cf4040", // red
  "#c03d8c", // pink
  "#7c5cd6", // purple
  "#5f6b7d", // slate
];

const tabColor = (tab) => tab.color || PALETTE[data.tabs.indexOf(tab) % PALETTE.length];

/** @type {{version:number, tabs:{id:string,name:string,snippets:{id:string,title:string,content:string}[]}[], activeTab:string|null}} */
let data = null;

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

const activeTab = () => data.tabs.find((t) => t.id === data.activeTab);

// ---------- persistence ----------

async function init() {
  try {
    data = await invoke("load_data");
  } catch (err) {
    els.grid.replaceChildren();
    els.empty.hidden = false;
    els.empty.textContent = "Could not load your data: " + err;
    return;
  }
  ensureValid();
  applyTheme();
  render();
  invoke("app_version")
    .then((v) => (els.version.textContent = "v" + v))
    .catch(() => {});
  invoke("platform")
    .then((p) => {
      if (p !== "desktop") return;
      els.version.classList.add("clickable");
      els.version.title = "Check for updates";
      setTimeout(() => checkForUpdates(false), 3000);
    })
    .catch(() => {});
}

// ---------- updates (desktop) ----------

async function checkForUpdates(manual) {
  let update;
  try {
    update = await invoke("check_update");
  } catch (err) {
    // Quiet at startup (offline, feed not published yet…); explain only when asked.
    if (manual) toast("Couldn't check for updates: " + err, true);
    return;
  }
  if (!update) {
    if (manual) toast("You're on the latest version");
    return;
  }
  $("#update-text").textContent = `PhraseShelf ${update.version} is available.`;
  $("#update-bar").hidden = false;
}

els.version.addEventListener("click", () => {
  if (els.version.classList.contains("clickable")) checkForUpdates(true);
});
$("#update-later").addEventListener("click", () => ($("#update-bar").hidden = true));
$("#update-now").addEventListener("click", async () => {
  const btn = $("#update-now");
  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    await invoke("install_update"); // the app restarts when done
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Update now";
    toast("Update failed: " + err, true);
  }
});

// ---------- theme ----------

const THEMES = { auto: "◐ Auto", light: "☀ Light", dark: "☾ Dark" };

function applyTheme() {
  const theme = data.theme in THEMES ? data.theme : "auto";
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  els.theme.textContent = THEMES[theme];
  invoke("set_theme", { theme }).catch(() => {}); // title bar; cosmetic only
}

els.theme.addEventListener("click", () => {
  const order = Object.keys(THEMES);
  const current = data.theme in THEMES ? data.theme : "auto";
  const next = order[(order.indexOf(current) + 1) % order.length];
  data.theme = next === "auto" ? null : next;
  applyTheme();
  save();
});

function ensureValid() {
  if (!data.tabs.length) data.tabs.push({ id: uid(), name: "General", snippets: [] });
  if (!activeTab()) data.activeTab = data.tabs[0].id;
  // Pin a color on any tab that lacks one, so it doesn't change when tabs are reordered.
  data.tabs.forEach((t, i) => (t.color ||= PALETTE[i % PALETTE.length]));
}

async function save() {
  try {
    await invoke("save_data", { data });
  } catch (err) {
    toast("Save failed: " + err, true);
  }
}

// ---------- rendering ----------

function render() {
  renderTabs();
  renderGrid();
}

function renderTabs() {
  els.tabs.replaceChildren(
    ...data.tabs.map((tab, i) => {
      const b = document.createElement("button");
      b.className = "tab" + (tab.id === data.activeTab ? " active" : "");
      b.style.setProperty("--c", tabColor(tab));
      b.textContent = tab.name;
      b.dataset.id = tab.id;
      b.title = (i < 9 ? `Ctrl+${i + 1} · ` : "") + "Double-click or right-click to rename";
      b.addEventListener("click", () => selectTab(tab.id));
      b.addEventListener("dblclick", () => editTab(tab));
      onContextMenu(b, () => editTab(tab));
      sortable(b, data.tabs, tab);
      touchSortable(b, data.tabs, tab, () => editTab(tab));
      acceptSnippetDrop(b, tab);
      return b;
    }),
    els.addTab
  );
  document.documentElement.style.setProperty("--tab-color", tabColor(activeTab()));
}

function renderGrid() {
  const tab = activeTab();
  const q = els.search.value.trim().toLowerCase();
  const items = q
    ? tab.snippets.filter((s) => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q))
    : tab.snippets;

  const nodes = items.map((s) => {
    const card = document.createElement("div");
    card.className = "snippet";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy";
    copyBtn.title = s.content.length > 300 ? s.content.slice(0, 300) + "…" : s.content;
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = s.title;
    const preview = document.createElement("span");
    preview.className = "preview";
    preview.textContent = s.content.split(/\r?\n/)[0] || " ";
    copyBtn.append(title, preview);
    copyBtn.addEventListener("click", () => copy(s, card));

    const edit = document.createElement("button");
    edit.className = "edit";
    edit.title = "Edit";
    edit.textContent = "✎";
    edit.addEventListener("click", () => editSnippet(s));

    onContextMenu(card, () => editSnippet(s));
    card.append(copyBtn, edit);
    sortable(card, tab.snippets, s);
    touchSortable(card, tab.snippets, s);
    return card;
  });

  if (!q) {
    const add = document.createElement("button");
    add.className = "add-card";
    add.textContent = "+ Add button";
    add.addEventListener("click", () => editSnippet(null));
    nodes.push(add);
  }

  els.grid.replaceChildren(...nodes);
  els.empty.hidden = !(q && items.length === 0);
  els.empty.textContent = `Nothing in “${tab.name}” matches “${els.search.value.trim()}”.`;
}

// ---------- actions ----------

function selectTab(id) {
  if (data.activeTab === id) return;
  data.activeTab = id;
  els.search.value = "";
  render();
  save();
}

async function copy(snippet, card) {
  try {
    await invoke("copy_text", { text: snippet.content });
    toast(`Copied “${snippet.title}”`);
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 400);
  } catch (err) {
    toast("Copy failed: " + err, true);
  }
}

async function editSnippet(snippet) {
  if (dialogOpen()) return; // long-press and contextmenu can both fire on touch
  const isNew = !snippet;
  const f = els.snippetForm.elements;
  $("#snippet-dlg-title").textContent = isNew ? "New button" : "Edit button";
  f.label.value = snippet ? snippet.title : "";
  f.body.value = snippet ? snippet.content : "";
  f.tab.replaceChildren(
    ...data.tabs.map((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      o.selected = t.id === data.activeTab;
      return o;
    })
  );
  $("#snippet-delete").hidden = isNew;

  const result = await openDialog(els.snippetDlg);
  const list = activeTab().snippets;

  if (result === "save") {
    const title = f.label.value.trim();
    const content = f.body.value;
    if (!title || !content) return;
    const target = data.tabs.find((t) => t.id === f.tab.value) || activeTab();
    if (isNew) {
      target.snippets.push({ id: uid(), title, content });
      if (target.snippets !== list) toast(`Added “${title}” to “${target.name}”`);
    } else {
      Object.assign(snippet, { title, content });
      if (target.snippets !== list) {
        list.splice(list.indexOf(snippet), 1);
        target.snippets.push(snippet);
        toast(`Moved “${title}” to “${target.name}”`);
      }
    }
  } else if (result === "delete") {
    if (!(await confirmDelete(`Delete the “${snippet.title}” button?`))) return;
    list.splice(list.indexOf(snippet), 1);
  } else {
    return;
  }
  renderGrid();
  save();
}

async function editTab(tab) {
  if (dialogOpen()) return;
  const isNew = !tab;
  const f = els.tabForm.elements;
  $("#tab-dlg-title").textContent = isNew ? "New tab" : "Rename tab";
  f.label.value = tab ? tab.name : "";
  $("#tab-delete").hidden = isNew;
  $("#tab-export").hidden = isNew;
  const current = tab ? tabColor(tab) : PALETTE[data.tabs.length % PALETTE.length];
  els.tabColors.replaceChildren(
    ...PALETTE.map((c) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "color";
      input.value = c;
      input.checked = c === current;
      const dot = document.createElement("span");
      dot.style.setProperty("--c", c);
      label.append(input, dot);
      return label;
    })
  );

  const result = await openDialog(els.tabDlg);

  if (result === "save") {
    const name = f.label.value.trim();
    if (!name) return;
    const color = els.tabColors.querySelector("input:checked")?.value || current;
    if (isNew) {
      const t = { id: uid(), name, color, snippets: [] };
      data.tabs.push(t);
      data.activeTab = t.id;
      els.search.value = "";
    } else {
      tab.name = name;
      tab.color = color;
    }
  } else if (result === "export") {
    exportTabs([tab], tab.name);
    return;
  } else if (result === "delete") {
    const n = tab.snippets.length;
    const msg = n
      ? `Delete the “${tab.name}” tab and its ${n} button${n === 1 ? "" : "s"}?`
      : `Delete the “${tab.name}” tab?`;
    if (!(await confirmDelete(msg))) return;
    const i = data.tabs.indexOf(tab);
    data.tabs.splice(i, 1);
    if (data.activeTab === tab.id) data.activeTab = (data.tabs[i] || data.tabs[i - 1] || {}).id ?? null;
    ensureValid();
  } else {
    return;
  }
  render();
  save();
}

// ---------- import / export ----------

const isHexColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const safeFileName = (name) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "tabs";

async function exportTabs(tabs, baseName) {
  const payload = {
    format: "phraseshelf",
    version: 1,
    tabs: tabs.map((t) => ({
      name: t.name,
      color: t.color,
      snippets: t.snippets.map((s) => ({ title: s.title, content: s.content })),
    })),
  };
  try {
    const path = await invoke("save_export", {
      fileName: safeFileName(baseName) + ".json",
      contents: JSON.stringify(payload, null, 2),
    });
    if (path) toast(`Exported to ${path}`);
  } catch (err) {
    toast("Export failed: " + err, true);
  }
}

/**
 * Accepts either a .json export (ours, or a raw data.json) or a text list
 * with one "Title -> Content" per line. Returns [{name, color?, snippets}].
 */
function parseImport({ name, text }) {
  text = text.replace(/^﻿/, "");
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error("That file isn't valid JSON.");
    }
    const list = Array.isArray(json) ? json : Array.isArray(json.tabs) ? json.tabs : null;
    if (!list || !list.length) throw new Error("No tabs found in that file.");
    return list.map((t) => ({
      name: String(t.name || name).slice(0, 40),
      color: isHexColor(t.color) ? t.color : null,
      snippets: (Array.isArray(t.snippets) ? t.snippets : [])
        .filter((s) => s && s.title != null && s.content != null)
        .map((s) => ({ title: String(s.title), content: String(s.content) })),
    }));
  }

  const snippets = text
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("->");
      return i < 0 ? null : { title: line.slice(0, i).trim(), content: line.slice(i + 2).trim() };
    })
    .filter((s) => s && s.title && s.content);
  if (!snippets.length) throw new Error("No “Title -> Content” lines found in that file.");
  return [{ name: name.slice(0, 40), color: null, snippets }];
}

async function importTabs() {
  let file;
  try {
    file = await invoke("pick_import_file");
  } catch (err) {
    toast("Import failed: " + err, true);
    return;
  }
  if (!file) return;

  let incoming;
  try {
    incoming = parseImport(file);
  } catch (err) {
    toast("Import failed: " + err.message, true);
    return;
  }

  let buttons = 0;
  const added = incoming.map((t) => {
    // Never merge into or overwrite an existing tab: add "(2)", "(3)"… on a name clash.
    const base = t.name || "Imported";
    let name = base;
    for (let k = 2; data.tabs.some((x) => x.name === name); k++) name = `${base} (${k})`;
    const tab = {
      id: uid(),
      name,
      color: t.color || PALETTE[data.tabs.length % PALETTE.length],
      snippets: t.snippets.map((s) => ({ id: uid(), ...s })),
    };
    buttons += tab.snippets.length;
    data.tabs.push(tab);
    return tab;
  });

  data.activeTab = added[0].id;
  els.search.value = "";
  render();
  save();
  toast(
    `Imported ${added.length} tab${added.length === 1 ? "" : "s"}, ` +
      `${buttons} button${buttons === 1 ? "" : "s"}`
  );
}

$("#import").addEventListener("click", importTabs);
$("#export-all").addEventListener("click", () => exportTabs(data.tabs, "phraseshelf-all-tabs"));

// ---------- dialogs ----------

const dialogOpen = () => !!document.querySelector("dialog[open]");

function openDialog(dlg) {
  return new Promise((resolve) => {
    dlg.returnValue = "";
    dlg.addEventListener("close", () => resolve(dlg.returnValue), { once: true });
    dlg.showModal();
  });
}

$("#snippet-delete").addEventListener("click", () => els.snippetDlg.close("delete"));
$("#tab-delete").addEventListener("click", () => els.tabDlg.close("delete"));
$("#tab-export").addEventListener("click", () => els.tabDlg.close("export"));
document.querySelectorAll("dialog .cancel").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close("cancel"))
);

async function confirmDelete(message) {
  $("#confirm-msg").textContent = message;
  return (await openDialog(els.confirmDlg)) === "ok";
}

// ---------- touch: hold to lift, then drag to reorder ----------

let lastPointer = "mouse";
let suppressClick = false;
document.addEventListener(
  "pointerdown",
  (e) => {
    lastPointer = e.pointerType;
    suppressClick = false;
  },
  true
);
// After a hold, swallow the click that the same touch produces when lifted.
document.addEventListener(
  "click",
  (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true
);

/** Right-click edits with a mouse. On touch, a long-press also fires "contextmenu", but holding is for dragging. */
function onContextMenu(el, fn) {
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (lastPointer === "mouse") fn();
  });
}

const HOLD_MS = 450; // hold this long to lift an item
const OPEN_MS = 450; // ...then this much longer, without moving, to open a tab's editor
const itemOf = new WeakMap(); // rendered element -> its tab / snippet
let touchDrag = null; // the element currently lifted by a finger

/**
 * Touch reordering: hold an item until it lifts (with a little buzz), then drag it.
 * Other items slide out of the way as you go. A button dropped on a tab chip moves to that tab.
 * Holding and letting go without dragging calls onHold (used to edit tabs).
 */
function touchSortable(el, list, item, onHold = null) {
  itemOf.set(el, item);
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || touchDrag || dialogOpen()) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const stop = () => {
      clearTimeout(timer);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
    const move = (ev) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) stop(); // it's a scroll, not a hold
    };
    const timer = setTimeout(() => {
      stop();
      const r = el.getBoundingClientRect();
      touchDrag = {
        el, list, item, onHold,
        pointerId: e.pointerId,
        x0, y0, x: x0, y: y0,
        offX: x0 - r.left,
        offY: y0 - r.top,
        moved: false,
        dropTab: null,
      };
      suppressClick = true;
      navigator.vibrate?.(15);
      el.classList.add("lifted");
      followFinger();
      requestAnimationFrame(autoScroll);
      // Still holding without dragging a little longer: open the editor without waiting for the lift.
      if (onHold) {
        const d = touchDrag;
        setTimeout(() => {
          if (touchDrag !== d || d.moved) return;
          putDown(d);
          onHold();
        }, OPEN_MS);
      }
    }, HOLD_MS);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  });
}

// While something is lifted, stop the page from scrolling under the finger.
document.addEventListener(
  "touchmove",
  (e) => {
    if (touchDrag && e.cancelable) e.preventDefault();
  },
  { passive: false }
);

document.addEventListener("pointermove", (e) => {
  const d = touchDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  d.x = e.clientX;
  d.y = e.clientY;
  if (Math.hypot(d.x - d.x0, d.y - d.y0) > 8) d.moved = true;
  dragOver();
});

function dragOver() {
  const d = touchDrag;
  const under = document.elementFromPoint(d.x, d.y); // the lifted element has pointer-events: none
  const isSnippet = d.list !== data.tabs;

  // A button over another tab's chip: offer to move it there.
  const chip = isSnippet ? under?.closest(".tab") : null;
  const dropTab = chip && chip.dataset.id !== data.activeTab ? chip : null;
  if (dropTab !== d.dropTab) {
    d.dropTab?.classList.remove("drop-target");
    dropTab?.classList.add("drop-target");
    d.dropTab = dropTab;
  }

  // Over a sibling: shift the items in between past the lifted one. The lifted element itself
  // never moves in the DOM, so the browser keeps delivering this touch to it.
  const sib = under?.closest(isSnippet ? ".snippet" : ".tab");
  if (!dropTab && sib && sib !== d.el && sib.parentNode === d.el.parentNode) {
    const kids = [...d.el.parentNode.children];
    const from = kids.indexOf(d.el);
    const to = kids.indexOf(sib);
    if (to < from) d.el.after(...kids.slice(to, from));
    else d.el.before(...kids.slice(from + 1, to + 1));
  }
  followFinger();
}

/** Draws the lifted element under the finger, wherever the layout currently puts it. */
function followFinger() {
  const d = touchDrag;
  d.el.style.transform = "";
  const r = d.el.getBoundingClientRect();
  d.el.style.transform = `translate(${d.x - d.offX - r.left}px, ${d.y - d.offY - r.top}px) scale(1.05)`;
}

/** Scrolls the button grid while a finger holds a button near its top or bottom edge. */
function autoScroll() {
  const d = touchDrag;
  if (!d) return;
  if (d.list !== data.tabs) {
    const r = els.grid.getBoundingClientRect();
    const edge = 48;
    const step = d.y > r.bottom - edge ? 8 : d.y < r.top + edge && d.y > r.top ? -8 : 0;
    const before = els.grid.scrollTop;
    if (step) els.grid.scrollTop += step;
    if (els.grid.scrollTop !== before) dragOver();
  }
  requestAnimationFrame(autoScroll);
}

/** Ends the lifted state and its visuals; the finger may still be down. */
function putDown(d) {
  touchDrag = null;
  d.el.classList.remove("lifted");
  d.el.style.transform = "";
  d.dropTab?.classList.remove("drop-target");
}

function endTouchDrag(e) {
  const d = touchDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  putDown(d);

  if (e.type === "pointercancel") {
    render(); // put everything back where it was
    return;
  }
  if (d.dropTab) {
    const tab = data.tabs.find((t) => t.id === d.dropTab.dataset.id);
    d.list.splice(d.list.indexOf(d.item), 1);
    tab.snippets.push(d.item);
    toast(`Moved “${d.item.title}” to “${tab.name}”`);
  } else if (!d.moved && d.onHold) {
    d.onHold();
    return;
  } else {
    // Write the on-screen order back. With a filter active only some items are shown, so
    // they are shuffled among their own positions and hidden ones stay put.
    const shown = [...d.el.parentNode.children].map((c) => itemOf.get(c)).filter(Boolean);
    const slots = shown.map((it) => d.list.indexOf(it)).sort((a, b) => a - b);
    const changed = shown.some((it, k) => d.list[slots[k]] !== it);
    if (!changed) return;
    shown.forEach((it, k) => (d.list[slots[k]] = it));
  }
  render();
  save();
}
document.addEventListener("pointerup", endTouchDrag);
document.addEventListener("pointercancel", endTouchDrag);

// ---------- drag & drop (mouse; touch uses touchSortable above) ----------

const HAS_MOUSE = matchMedia("(hover: hover) and (pointer: fine)").matches;
let dragging = null; // { list, item }

function sortable(el, list, item) {
  if (!HAS_MOUSE) return;
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    dragging = { list, item };
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
  });
  el.addEventListener("dragend", () => {
    dragging = null;
    el.classList.remove("dragging");
    document.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target"));
  });
  el.addEventListener("dragover", (e) => {
    if (dragging && dragging.list === list && dragging.item !== item) {
      e.preventDefault();
      el.classList.add("drop-target");
    }
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    if (!dragging || dragging.list !== list) return;
    e.preventDefault();
    const from = list.indexOf(dragging.item);
    const to = list.indexOf(item);
    list.splice(from, 1);
    list.splice(to, 0, dragging.item);
    dragging = null;
    render();
    save();
  });
}

/** Lets a snippet card be dropped onto another tab to move it there. */
function acceptSnippetDrop(tabEl, tab) {
  const isForeignSnippet = () =>
    dragging && dragging.list !== data.tabs && dragging.list !== tab.snippets;
  tabEl.addEventListener("dragover", (e) => {
    if (isForeignSnippet()) {
      e.preventDefault();
      tabEl.classList.add("drop-target");
    }
  });
  tabEl.addEventListener("drop", (e) => {
    if (!isForeignSnippet()) return;
    e.preventDefault();
    const { list, item } = dragging;
    list.splice(list.indexOf(item), 1);
    tab.snippets.push(item);
    dragging = null;
    toast(`Moved “${item.title}” to “${tab.name}”`);
    render();
    save();
  });
}

// ---------- toast ----------

let toastTimer;
function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), isError ? 4000 : 1400);
}

// ---------- keyboard ----------

$("#add-tab").addEventListener("click", () => editTab(null));
els.search.addEventListener("input", renderGrid);
els.search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    els.grid.querySelector(".snippet .copy")?.click();
  } else if (e.key === "Escape") {
    els.search.value = "";
    renderGrid();
  }
});

document.addEventListener("keydown", (e) => {
  if (!data || document.querySelector("dialog[open]")) return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey && key === "f") {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  } else if (e.ctrlKey && key === "n") {
    e.preventDefault();
    editSnippet(null);
  } else if (e.ctrlKey && /^[1-9]$/.test(key)) {
    const tab = data.tabs[Number(key) - 1];
    if (tab) {
      e.preventDefault();
      selectTab(tab.id);
    }
  }
});

init();
