/* CinéTracker - mode hors connexion
   - Le site : toujours la dernière version quand il y a du réseau, copie de secours sinon.
   - Les affiches (TMDB) et les scripts Firebase : gardés en mémoire une fois vus.
   - Tout le reste (recherche TMDB, synchronisation Firebase...) n'est pas touché. */

var VERSION = 'v1';
var SHELL = 'cinetracker-shell-' + VERSION;
var IMGS = 'cinetracker-imgs-v1';
var LIBS = 'cinetracker-libs-v1';
var SHELL_FILES = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
var MAX_IMGS = 600;
var NAV_TIMEOUT = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return Promise.all(SHELL_FILES.map(function (f) {
        return c.add(new Request(f, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  var keep = [SHELL, IMGS, LIBS];
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n.indexOf('cinetracker-') === 0 && keep.indexOf(n) === -1) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function shellFromCache() {
  return caches.open(SHELL).then(function (c) { return c.match('index.html'); });
}

function navigationResponse(req) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      shellFromCache().then(function (r) {
        if (r && !done) { done = true; resolve(r); }
      });
    }, NAV_TIMEOUT);

    var netReq;
    try { netReq = new Request(req, { cache: 'no-cache' }); } catch (err) { netReq = req; }

    fetch(netReq).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put('index.html', copy); });
      }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      if (done) return;
      shellFromCache().then(function (r) {
        done = true;
        resolve(r || new Response('Hors connexion', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(SHELL).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  });
}

function trim(cache, max) {
  return cache.keys().then(function (keys) {
    if (keys.length <= max) return;
    return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return cache.delete(k); }));
  });
}

function cacheFirstImage(req) {
  return caches.open(IMGS).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req.url, { mode: 'cors' })
        .catch(function () { return fetch(req); })
        .then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            c.put(req.url, res.clone()).then(function () { return trim(c, MAX_IMGS); });
          }
          return res;
        });
    });
  });
}

function cacheFirstLib(req) {
  return caches.open(LIBS).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) c.put(req.url, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(navigationResponse(req));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.hostname === 'image.tmdb.org') {
    e.respondWith(cacheFirstImage(req));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(cacheFirstLib(req));
    return;
  }
});
