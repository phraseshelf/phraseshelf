/*
 * Offline support for the PhraseShelf web app. The build stamps the version into the cache
 * name, so each release installs a fresh copy and deletes the old one. The new version is
 * used from the next time the page is opened.
 */
const CACHE = "phraseshelf-__PHRASESHELF_VERSION__";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "main.js",
  "i18n.js",
  /*__I18N_FILES__*/
  "platform.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches
      .match(e.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(e.request))
  );
});
