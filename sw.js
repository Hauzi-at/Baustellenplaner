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

   Zusätzlich (neu): Web-Push-Benachrichtigungen für den Chef, wenn ein
   Mitarbeiter einen Auftrag abschließt oder zurückstellt — siehe die
   "push"- und "notificationclick"-Handler ganz unten. Das läuft komplett
   unabhängig vom Datei-Cache oben.
   ========================================================================== */

var CACHE_VERSION = "thbp-shell-v4";

// Relativ zum Ort dieser Datei, damit es unabhängig davon funktioniert, ob
// die App im Hauptverzeichnis oder in einem Unterordner liegt.
var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./konfigurator.html",
  "./config.js",
  "./manifest.json",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
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

/* ==========================================================================
   Push-Benachrichtigungen (nur für den Chef — siehe "Push aktivieren" in
   den Einstellungen von index.html). Eine Supabase Edge Function schickt bei
   Abschluss/Zurückstellung eines Auftrags eine Web-Push-Nachricht mit einem
   JSON-Payload { title, body, reportId } an genau die Browser, die sich
   zuvor über pushManager.subscribe() registriert haben.
   ========================================================================== */
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: "TH Baustellenplaner", body: event.data ? event.data.text() : "" };
  }
  var title = data.title || "TH Baustellenplaner";
  var options = {
    body: data.body || "",
    icon: "./icon-192.png",
    badge: "./favicon-32.png",
    data: { reportId: data.reportId || null, url: data.url || "./index.html" },
    tag: data.reportId ? ("report-" + data.reportId) : undefined
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if ("focus" in client) { client.focus(); return; }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
