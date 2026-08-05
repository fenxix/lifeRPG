const CACHE_NAME = 'liferpg-v1';
const APP_SHELL = [
  'index.html', 'auth.html', 'quests.html', 'inventory.html', 'world.html', 'shop.html',
  'profile.html', 'plans.html', 'notes.html', 'settings.html', 'zen.html', 'quotes.html',
  'knowledge.html', 'mood.html', 'forgot-password.html', 'reset-password.html', 'confirm.html',
  'js/supabase-client.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Не кэшируем запросы к Supabase и внешним CDN — только свои файлы приложения
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
