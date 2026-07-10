// シンセマスター の Service Worker。
// ネットワーク優先（常に最新を取得し、成功したらキャッシュを更新）で、
// オフライン時だけキャッシュから返す。古いバージョンが残り続ける罠を避ける方針。
const CACHE = 'synth-anatomy-v4';
const PRECACHE = [
  './', './index.html', './styles.css',
  './content-params.js', './wavetables.js', './mod-engine.js', './describe-engine.js',
  './recipe-engine.js', './content-recipes.js',
  './synth-engine.js', './viz.js', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 成功した同一オリジン応答だけをキャッシュする。4xx/5xxやopaque応答まで
        // 保存すると、オフライン時にエラーページが配信され続けてしまう
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }))
  );
});
