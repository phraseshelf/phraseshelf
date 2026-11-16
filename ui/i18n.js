"use strict";
/*
 * Translations. Each language is a flat JSON file in ui/i18n/ (e.g. "fr.json") mapping keys
 * to text. Missing keys fall back to English, so a partial translation never breaks the app.
 *
 *   t("copied", { title: "Hello" })            "Copied “{title}”"  -> Copied “Hello”
 *   t("count.buttons", { n: 3 })                { "one": "{n} button", "other": "{n} buttons" }
 *
 * Plural forms use the language's own rules (Intl.PluralRules: zero/one/two/few/many/other).
 * The special "welcome" entry is the starter tab created on first run.
 *
 * To add a language: copy en.json to <code>.json, translate it, add it to LANGUAGES below,
 * then run `python scripts/check_i18n.py`.
 */
const I18N = (() => {
  // Code -> name in that language (shown in the language picker as-is, never translated).
  const LANGUAGES = {
    en: "English",
    fr: "Français",
    es: "Español",
    "pt-BR": "Português (Brasil)",
    ko: "한국어",
    ja: "日本語",
  };
  const BASE = window.PHRASESHELF_I18N_BASE || "i18n/";

  let english = null;
  let strings = {};
  let lang = "en";
  let plurals = new Intl.PluralRules("en");

  /** Best match for the system/browser language, e.g. "fr-CA" -> "fr", "pt-PT" -> "pt-BR". */
  function detect() {
    const wanted = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
    const codes = Object.keys(LANGUAGES);
    for (const w of wanted) {
      const exact = codes.find((c) => c.toLowerCase() === w.toLowerCase());
      if (exact) return exact;
      const base = w.split("-")[0].toLowerCase();
      const near = codes.find((c) => c.split("-")[0].toLowerCase() === base);
      if (near) return near;
    }
    return "en";
  }

  async function fetchJson(code) {
    const res = await fetch(BASE + code + ".json");
    if (!res.ok) throw new Error(`${code}.json: HTTP ${res.status}`);
    return res.json();
  }

  /** Loads a language. `preference` is a code from LANGUAGES, or null/"" for the system language. */
  async function setLanguage(preference) {
    const code = LANGUAGES[preference] ? preference : detect();
    english ??= await fetchJson("en").catch(() => ({}));
    strings = code === "en" ? english : await fetchJson(code).catch(() => english);
    lang = code;
    plurals = new Intl.PluralRules(code);
    document.documentElement.lang = code;
    return code;
  }

  function t(key, vars = {}) {
    let s = strings[key] ?? english?.[key] ?? key;
    if (s && typeof s === "object") s = s[plurals.select(vars.n ?? 0)] ?? s.other ?? key;
    return String(s).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  }

  /** Fills in elements marked data-i18n (text), data-i18n-title, -placeholder and -aria-label. */
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    for (const attr of ["title", "placeholder", "aria-label"]) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) =>
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)))
      );
    }
  }

  /** The starter tab for the current language: { name, snippets: [{title, content}] }. */
  function welcome() {
    const w = strings.welcome?.snippets?.length ? strings.welcome : english?.welcome;
    return w || { name: "Welcome", snippets: [] };
  }

  return { LANGUAGES, setLanguage, t, apply, welcome, get lang() { return lang; } };
})();

const t = I18N.t;
