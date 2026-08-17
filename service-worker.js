/* ─── Moore Market PWA — Service Worker ─────────────────── */
// IMPORTANTE: sube este número cada vez que despliegues cambios de diseño/código.
// Si no se sube, algunos móviles pueden seguir sirviendo la versión cacheada
// anterior cuando la red va lenta o inestable (ese era el "a veces se ve
// bien, a veces no" en el CRM/agenda).
const CACHE_NAME = 'moore-market-v61';

// Archivos a cachear para uso offline
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/vendor/chart.umd.min.js',
  '/vendor/jspdf.umd.min.js',
  '/vendor/xlsx.full.min.js',
  '/vendor/firebase-app-compat.js',
  '/vendor/firebase-database-compat.js',
  '/vendor/firebase-auth-compat.js',
  'vendor/tabler-icons.min.css',
  '/css/autodiagnostico.css',
  '/config/autodiagnostico-landing.json',
  '/img/hero-autodiagnostico.jpg',
];

/* ─── Instalación: cachear assets ───────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

/* ─── Activación: limpiar caches antiguas ───────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ─── Fetch: Network first, cache como fallback ─────────── */
self.addEventListener('fetch', event => {
  // Solo interceptar GET
  if (event.request.method !== 'GET') return;

  // Firebase y APIs externas: siempre red (no cachear datos)
  const url = event.request.url;
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com')
  ) {
    return; // dejar pasar sin intervenir
  }

  event.respondWith(
    // 'no-store' evita que el propio navegador (no solo este SW) sirva una
    // copia HTTP antigua de index.html/style.css/app.js sin ni siquiera
    // preguntar a la red — la causa más probable de la inconsistencia.
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        // Guardar copia fresca en caché
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Sin red → servir desde caché
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback a index.html para rutas desconocidas
          return caches.match('/index.html');
        });
      })
  );
});
