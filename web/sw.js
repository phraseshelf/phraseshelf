/*
 * Offline support for the PhraseShelf web app. The build stamps the version into the cache
 * name, so each release installs a fresh copy and deletes the old one. Page loads go to the
 * network first (falling back to the cache when offline), so a new release shows up right
 * away; the other files come from the cache, which is replaced as a whole on each release.
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
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
  if (e.request.mode === "navigate") {
    // Online: the latest page (its ?v= links pick up a new release). Offline: the cached copy.
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))
      )
    );
    return;
  }
  e.respondWith(
    caches
      .match(e.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(e.request))
  );
});
