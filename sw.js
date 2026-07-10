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
  // cache:'no-cache' でHTTPキャッシュに必ず再検証させる。キャッシュヘッダーを返さない
  // ホスティングだと、ヒューリスティックキャッシュが古いファイルを「新鮮」とみなして
  // fetchがネットワークに出ず、ネットワーク優先の意図が崩れるため
  const network = fetch(e.request, { cache: 'no-cache' }).then((res) => ({
    res,
    // respondWithが応答本文を消費する前に、キャッシュ保存用を複製する
    // 4xx/5xxやopaque応答は、オフライン時のエラー固定を避けるため保存しない
    copy: res.ok && res.type === 'basic' ? res.clone() : null,
  }));

  // キャッシュ更新をイベント寿命に紐づけつつ、ネットワーク応答自体は待たせない
  const cacheUpdate = network.then(({ copy }) => {
    if (!copy) return;
    return caches.open(CACHE).then((c) => c.put(e.request, copy));
  });
  e.waitUntil(cacheUpdate.catch(() => {}));

  e.respondWith(
    network
      .then(({ res }) => res)
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }))
  );
});
