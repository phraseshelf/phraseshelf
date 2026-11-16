"use strict";
/*
 * Web version of PhraseShelf's backend. The shared UI (ui/main.js) talks to the app through
 * window.__TAURI__.core.invoke(command, args). In the desktop and Android apps, Rust answers
 * those calls. Here the browser does: data lives in localStorage and never leaves this device.
 *
 * Loaded by the built index.html just before main.js (see scripts/build_web.py).
 */
(() => {
  const VERSION = "__PHRASESHELF_VERSION__"; // filled in by the build
  const KEY = "phraseshelf:data";
  const BACKUP_KEY = "phraseshelf:data.bak";

  // Same starter tab as the desktop app.
  const seed = () => ({
    version: 1,
    activeTab: "korean",
    theme: null,
    tabs: [
      {
        id: "korean",
        name: "Korean Phrases",
        color: "#3b6fd9",
        snippets: [
          { id: "hello", title: "Hello", content: "안녕하세요" },
          { id: "good-work", title: "Good work", content: "수고하셨습니다" },
          { id: "thank-you", title: "Thank you", content: "감사합니다" },
        ],
      },
    ],
  });

  function loadData() {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return seed();
    try {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.tabs)) return data;
    } catch {}
    // Never overwrite data we can't read: the UI shows this error and saves nothing.
    throw `the saved data in this browser is damaged. A copy is kept under "${KEY}" in site storage.`;
  }

  function saveData(data) {
    const json = JSON.stringify(data);
    try {
      const prev = localStorage.getItem(KEY);
      if (prev != null && prev !== json) localStorage.setItem(BACKUP_KEY, prev);
      localStorage.setItem(KEY, json);
    } catch (e) {
      throw e && e.name === "QuotaExceededError"
        ? "this browser's storage is full. Export your tabs to keep them safe."
        : String(e);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
    // Fallback for browsers that refuse the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw "the browser blocked clipboard access. Check this site's Clipboard permission.";
  }

  /** Opens a file picker. Resolves to {name, text}, or null if cancelled. */
  function pickImportFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,.txt,application/json,text/plain";
      input.addEventListener("cancel", () => resolve(null));
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        try {
          resolve({ name: file.name.replace(/\.[^.]+$/, ""), text: await file.text() });
        } catch (e) {
          reject(String(e));
        }
      });
      input.click();
    });
  }

  /** Downloads the export. Returns the file name for the "Exported to …" message. */
  function saveExport({ fileName, contents }) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return fileName;
  }

  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args = {}) => {
        switch (cmd) {
          case "load_data": return loadData();
          case "save_data": return saveData(args.data);
          case "data_path": return "this browser's local storage";
          case "copy_text": return copyText(args.text);
          case "pick_import_file": return pickImportFile();
          case "save_export": return saveExport(args);
          case "app_version": return VERSION;
          case "platform": return "web";
          case "set_theme": return;
          case "check_update": return null; // the site is always the latest version
          case "install_update": return;
          default: throw "unknown command " + cmd;
        }
      },
    },
  };

  // Ask the browser not to clear our storage when it's low on space (best effort).
  navigator.storage?.persist?.().catch(() => {});

  // Desktop-only hints (tray, Ctrl+N) don't apply in a browser.
  const hint = document.querySelector(".hint-mouse");
  if (hint) {
    hint.textContent =
      "Click to copy · Right-click or ✎ to edit · Drag to reorder (drop on a tab to move) · " +
      "Saved only in this browser: use Export all… to back up";
  }

  // A Privacy link beside the version number in the footer.
  const version = document.querySelector("#version");
  if (version) {
    const link = document.createElement("a");
    link.href = "privacy.html";
    link.textContent = "Privacy";
    link.className = "version";
    link.style.cssText = "color:inherit;margin-left:10px";
    version.after(link);
  }

  // Works offline and can be installed ("Install app" / "Add to Home screen").
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
