// =========================================================
// Service worker : un petit « gardien » qui tourne en arrière-plan.
// Il garde une copie des fichiers de l'appli pour qu'elle s'ouvre
// même sans réseau. (Les données, elles, sont gérées par Firebase.)
// À CHAQUE NOUVELLE VERSION : changer le numéro ci-dessous.
// =========================================================
const CACHE = "foodix-v1.2.4";
// Bibliothèques à version fixe (Firebase, ExcelJS, polices) : cache à part, jamais effacé par une mise à jour.
// Avant 1.2.0 elles partaient avec l'ancien cache : sans réseau juste après une mise à jour, l'appli ne s'ouvrait plus.
const LIBS = "foodix-libs";
const FB = "https://www.gstatic.com/firebasejs/12.4.0/";   // même version que dans app.js
const LIBS_DEPART = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => FB + f);

// Fichiers de l'appli à garder dès l'installation
const FICHIERS = [
  "./", "index.html", "theme.js", "style.css", "app.js", "champs-mobile.js", "notes-idees.js", "pixel.js", "atelier.js", "excel-style.js", "firebase-config.js",
  "manifest.json", "icones/icone.svg", "icones/icone-192.png", "icones/icone-512.png", "icones/icone-maskable-512.png"
];

// IMPORTANT : GitHub autorise le téléphone à garder chaque fichier 10 minutes
// sans revérifier. On demande donc toujours au serveur (« reload » / « no-cache ») ;
// sinon on risquerait de ranger l'ancienne version sous l'étiquette de la nouvelle.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: "reload" }))))
      .then(() => rangerLibs().catch(() => {}))   // sans réseau pour gstatic : pas grave, elles viendront à l'usage
      .then(() => self.skipWaiting())
  );
});

// Reprend les bibliothèques déjà gardées dans les anciens caches, puis va chercher celles qui manquent
async function rangerLibs() {
  const libs = await caches.open(LIBS);
  for (const nom of await caches.keys()) {
    if (nom === LIBS || nom === CACHE) continue;
    const vieux = await caches.open(nom);
    for (const req of await vieux.keys()) {
      if (FIXES.includes(new URL(req.url).hostname) && !(await libs.match(req))) await libs.put(req, await vieux.match(req));
    }
  }
  await Promise.all(LIBS_DEPART.map(async u => { if (!(await libs.match(u))) await libs.add(u); }));
}

// Supprime les copies des anciennes versions (sauf les bibliothèques)
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== CACHE && n !== LIBS).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Bibliothèques et polices à version fixe : on peut garder la copie pour toujours
const FIXES = ["www.gstatic.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (FIXES.includes(url.hostname)) {
    e.respondWith(
      // Copie « opaque » (gardée avant 1.2.2) refusée pour une demande vérifiée (ExcelJS avec empreinte) : on la redemande
      caches.match(req).then(copie => copie && !(copie.type === "opaque" && req.mode === "cors") ? copie : fetch(req).then(rep => {
        if (rep.ok || rep.type === "opaque") {   // une erreur passagère ne doit pas rester gardée pour toujours
          const clone = rep.clone();
          caches.open(LIBS).then(c => c.put(req, clone));
        }
        return rep;
      }))
    );
    return;
  }

  // Fichiers de l'appli : réseau d'abord (pour avoir la dernière version),
  // copie en secours si pas de réseau.
  // On passe req.url et pas req : le navigateur refuse de modifier une demande d'ouverture de page.
  // Réseau trop lent (sous-sol de magasin…) : au bout de 3 secondes on sert la copie,
  // et la réponse du réseau, si elle finit par arriver, est rangée pour la prochaine fois.
  if (url.origin === location.origin) {
    const reseau = fetch(req.url, { cache: "no-cache" }).then(rep => {
      if (!url.search && rep.ok) {
        const clone = rep.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return rep;
    });
    e.waitUntil(reseau.catch(() => {})); // laisse le temps de ranger la réponse tardive
    e.respondWith(new Promise(resoudre => {
      let fini = false;
      const copie = () => caches.match(req, { ignoreSearch: true });
      const minuteur = setTimeout(() => copie().then(c => { if (c && !fini) { fini = true; resoudre(c); } }), 3000);
      reseau.then(rep => { if (!fini) { fini = true; clearTimeout(minuteur); resoudre(rep); } })
        .catch(() => copie().then(c => { if (!fini) { fini = true; clearTimeout(minuteur); resoudre(c || Response.error()); } }));
    }));
  }
  // Le reste (connexion Google, base de données) passe sans être touché.
});
