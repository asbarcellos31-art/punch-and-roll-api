const CACHE = 'punch-and-roll-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/punch-and-roll-portal.html',
  '/punch-and-roll-matricula.html',
  '/shop.html',
  '/horarios.html',
  '/assinar-contrato.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/og-image.png',
];

// ── Instala e pré-carrega assets ──────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Limpa caches antigos ──────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Estratégia: Network first, fallback para cache ────────────────────────────
self.addEventListener('fetch', (e) => {
  // Ignora requisições não-GET e de outros domínios (API, fonts, etc.)
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Atualiza cache com versão fresca
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
