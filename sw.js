/* ==========================================================================
   TH Baustellenplaner — Service Worker für Offline-Nutzung auf der Baustelle.

   Zweck: Die App-Dateien (index.html, konfigurator.html, config.js, Schrift-
   arten, die Supabase-Bibliothek) werden beim ersten Öffnen zwischengespei-
   chert, damit die App auch ohne oder mit schlechtem Empfang startet und
   bedienbar bleibt. Die eigentlichen Daten (Kunden, Aufträge, Stunden usw.)
   laufen NICHT über diesen Cache, sondern über die eigene Offline-Datenbank
   in index.html (IndexedDB + Warteschlange) — Anfragen an Supabase werden
   hier bewusst nicht zwischengespeichert, damit nie veraltete Kunden-/
   Auftragsdaten angezeigt werden.

   Bei einer neuen Version dieser Datei einfach CACHE_VERSION erhöhen —
   alte Zwischenspeicher werden dann beim nächsten Start automatisch
   aufgeräumt (siehe "activate" weiter unten).
   ========================================================================== */

var CACHE_VERSION = "thbp-shell-v1";

// Relativ zum Ort dieser Datei, damit es unabhängig davon funktioniert, ob
// die App im Hauptverzeichnis oder in einem Unterordner liegt.
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./konfigurator.html",
  "./config.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Inter:wght@400;500;600;700&display=swap"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // Jede Datei einzeln laden (statt cache.addAll), damit eine einzelne
      // fehlschlagende Ressource (z.B. Schriftart bei schwachem Netz) nicht
      // die komplette Installation verhindert.
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return fetch(url, { cache: "reload" })
            .then(function (resp) { if (resp && resp.ok) return cache.put(url, resp); })
            .catch(function () { /* wird beim nächsten Online-Besuch nachgeholt */ });
        })
      );
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_VERSION; }).map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

function isDatabaseRequest(url) {
  // Anfragen an Supabase (REST/Realtime/Auth) laufen immer direkt übers Netz —
  // diese Daten werden separat über IndexedDB offline verfügbar gemacht, nie
  // über diesen Datei-Zwischenspeicher.
  return url.indexOf("supabase.co") !== -1 || url.indexOf("/rest/v1/") !== -1 || url.indexOf("/realtime/v1/") !== -1;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return; // Schreibzugriffe (POST/PATCH/DELETE) unverändert durchlassen
  if (isDatabaseRequest(req.url)) return; // s.o. — nie zwischenspeichern

  event.respondWith(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(req).then(function (cached) {
        // Stale-while-revalidate: sofort die zwischengespeicherte Version zeigen
        // (funktioniert offline sofort), im Hintergrund aber eine frische Kopie
        // holen und für den nächsten Aufruf ablegen, wenn wieder Netz da ist.
        var networkFetch = fetch(req).then(function (resp) {
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        }).catch(function () { return null; });

        if (cached) {
          networkFetch.catch(function () {}); // im Hintergrund laufen lassen, Fehler ignorieren
          return cached;
        }
        return networkFetch.then(function (resp) { return resp || Promise.reject("offline und nicht im Zwischenspeicher"); });
      });
    }).catch(function () {
      // Letzter Ausweg für eine Seitennavigation ohne Netz und ohne Treffer im Cache
      if (req.mode === "navigate") return caches.match("./index.html");
      return new Response("", { status: 503, statusText: "Offline" });
    })
  );
});
