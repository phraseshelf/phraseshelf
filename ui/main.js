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
      b.title = (i < 9 ? `Ctrl+${i + 1} · ` : "") + "Double-click or right-click to rename";
      b.addEventListener("click", () => selectTab(tab.id));
      b.addEventListener("dblclick", () => editTab(tab));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        editTab(tab);
      });
      onLongPress(b, () => editTab(tab));
      sortable(b, data.tabs, tab);
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

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      editSnippet(s);
    });
    onLongPress(card, () => editSnippet(s));
    card.append(copyBtn, edit);
    sortable(card, tab.snippets, s);
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

// ---------- touch: long-press ----------

let suppressClick = false;
document.addEventListener("pointerdown", () => (suppressClick = false), true);
// After a long-press, swallow the click that the same touch produces when lifted.
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

function onLongPress(el, fn) {
  let timer = null;
  let x = 0;
  let y = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return; // mouse users right-click
    x = e.clientX;
    y = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      suppressClick = true;
      navigator.vibrate?.(15);
      fn();
    }, 500);
  });
  el.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
}

// ---------- drag & drop (mouse only; on touch, use the Tab picker in the editor) ----------

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
