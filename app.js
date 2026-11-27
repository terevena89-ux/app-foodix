// =========================================================
// Foodix — mes recettes, le menu de la semaine et la liste de courses.
// Données : Firebase (connexion Google + base Firestore), synchronisées
// entre le téléphone et le PC, et gardées sur l'appareil pour marcher hors ligne.
//
// Plan du fichier :
//   1. Réglages de base        5. Écran Recettes
//   2. Stockage (Firebase)     6. Fiche recette
//   3. Utilitaires             7. Réglages, thème, Excel
//   4. Affichage général       8. Clics et démarrage
// =========================================================

// Firebase n'est PAS chargé ici d'office : il arrive « à la demande » dans chargerFirebase() (partie 2).
// Ainsi, si ses serveurs ne répondent pas, l'appli démarre quand même et affiche un message
// (et le mode démo, qui n'en a pas besoin, marche toujours).
const FB = "https://www.gstatic.com/firebasejs/12.4.0/";
let initializeApp, getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, deleteField, terminate, clearIndexedDbPersistence;
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur } from "./excel-style.js";
import { norm, parseItem, keyOf, keyOfAncien, aisleOf, auPlacard, rayonMenage, aisleLabel, AISLE_ORDER, AISLES_FOOD, RAYONS_MENAGE, ICONES, fmtQty, ingImg, dishImg, MC, mcCherche, PERSO, brut } from "./pixel.js";
import { ouvrirAtelier, fermerAtelier, atelierOuvert } from "./atelier.js";

/* ---------- 1. Réglages de base ---------- */

const VERSION = "1.2.3";
const NOM_APPLI = "app-foodix"; // dossier dans Firestore et début du nom des fichiers Excel

// Les échelles de 1 à 3 et leurs libellés
const NIVEAUX = {
  prix: ["€", "€€", "€€€"],
  difficulte: ["Facile", "Moyenne", "Difficile"],
  temps: ["Rapide", "Moyen", "Long"],
  maitrise: ["À apprendre", "En progrès", "Maîtrisée"]
};

// Colonnes du fichier Excel : [clé dans l'appli, en-tête Excel, largeur, type]
// Types : oui = Oui / Non ; niv = libellé d'une échelle 1-3 ; liste = éléments séparés par « ; »
const COLONNES = [
  ["id", "ID", 30], ["nom", "Nom", 34], ["famille", "Famille", 16], ["variante", "Variante", 14], ["categorie", "Catégorie", 16],
  ["saison", "Saison", 10], ["origine", "Origine", 15], ["preparation", "Préparation", 13],
  ["vege", "Végé", 8, "oui"], ["favori", "Favori", 8, "oui"], ["prep", "Lunchbox", 11, "oui"], ["date", "Invités", 9, "oui"],
  ["prix", "Prix", 7, "niv"], ["difficulte", "Difficulté", 11, "niv"], ["temps", "Temps", 9, "niv"], ["maitrise", "Maîtrise", 13, "niv"],
  ["portions", "Portions", 9, "nombre"], ["ingredients", "Ingrédients", 70, "liste"],
  ["suggeres", "Ingrédients suggérés", 12, "oui"], ["lien", "Lien", 30], ["notes", "Notes", 40]
];

// Mode démo (adresse qui finit par ?demo) : données gardées dans ce navigateur
// seulement, sans connexion. Sert à tester l'appli sans toucher aux vraies données.
const MODE_DEMO = new URLSearchParams(location.search).has("demo");

// État de l'appli : tout ce qui est affiché vient d'ici
// Réglages du tirage, communs au téléphone et au PC (synchronisés)
const PREFS_DEFAUT = { nb: 5, pers: 2, vege: false, rapide: false, avance: false, invites: false };

const S = {
  recettes: [], pret: false, compte: "",
  menus: [],                              // les listes de courses : la plus récente = en cours, celle d'avant = archive
  propo: { repas: [] },                   // onglet Menu : les plats proposés, pas encore dans la liste
  histo: [],                              // plats des 2 listes effacées avant l'archive (pour varier le tirage)
  prefs: Object.assign({}, PREFS_DEFAUT),
  toujours: [],                           // ancien réglage « Toujours dans la liste » : repris dans la banque au 1er lancement
  banque: [],                             // banque d'ingrédients : seulement ce qui est noté à la main (voir banque())
  bq: { ouvert: false, onglet: "ing", rec: false, placard: false, detail: null, suppr: null, scroll: 0 },  // écran de la banque (voir 4 quater)
  cp: null,                               // mode Compléter (voir 7 ter)
  idees: "",                              // Réglages › Notes : idées d'amélioration (synchronisées)
  avantImport: null,                      // copie de secours d'avant le dernier import : { quand, mode, recettes, banque }
  onglet: lireLocal("fx-onglet", "courses"),
  // filtres de l'écran Recettes
  f: { q: "", cats: [], saisons: [], origines: [], preps: [], prix: [], temps: [], diff: [], fav: false, vege: false, saison: false, avance: false, invites: false }
};

/* ---------- 2. Stockage : Firebase ---------- */
// Rangement dans Firestore :
//   users/{mon uid}/app-foodix/donnees                  -> réglages du tirage (prefs)
//   users/{mon uid}/app-foodix/donnees/recettes/{id}    -> une recette par document
//   users/{mon uid}/app-foodix/donnees/menus/{id}       -> une liste de courses par document (en cours + précédente)
// Un document par recette : deux appareils qui modifient deux recettes différentes
// ne se gênent pas. Si les deux modifient la même : la dernière modification gagne.

let db = null, auth = null, uid = null, arrets = [];
const collRecettes = () => collection(db, "users", uid, NOM_APPLI, "donnees", "recettes");
const collMenus = () => collection(db, "users", uid, NOM_APPLI, "donnees", "menus");
const refDonnees = () => doc(db, "users", uid, NOM_APPLI, "donnees");

// On n'envoie que ce qui a changé depuis la dernière version connue (merge + deleteField) :
// « la dernière modif gagne » joue ainsi case par case, et une coche hors ligne sur le tel
// n'efface plus un article ajouté entre-temps sur le PC (audit A1).
const estObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const stable = v => JSON.stringify(v, (k, x) => estObj(x) ? Object.keys(x).sort().reduce((o, c) => (o[c] = x[c], o), {}) : x);  // Firestore ne rend pas les clés dans le même ordre
const copie = v => JSON.parse(JSON.stringify(v));
function difference(avant, apres) {
  const p = {};
  Object.keys(apres).forEach(k => {
    const a = avant[k], b = apres[k];
    if (b === undefined) return;
    if (estObj(a) && estObj(b)) { const sous = difference(a, b); if (Object.keys(sous).length) p[k] = sous; }
    else if (stable(a) !== stable(b)) p[k] = b;
  });
  Object.keys(avant).forEach(k => { if (apres[k] === undefined) p[k] = deleteField(); });
  return p;
}

const menusConnus = {};   // id -> dernière version de la liste reçue du serveur ou envoyée
function ecrireMenu(m) {
  m.maj = Date.now();
  if (MODE_DEMO) return sauverDemo();
  const avant = menusConnus[m.id];
  menusConnus[m.id] = copie(m);
  const ref = doc(collMenus(), m.id);
  (avant ? setDoc(ref, difference(avant, m), { merge: true }) : setDoc(ref, m)).catch(erreurEcriture);
}
function effacerMenu(id) {
  delete menusConnus[id];
  if (MODE_DEMO) return sauverDemo();
  deleteDoc(doc(collMenus(), id)).catch(erreurEcriture);
}
function sauverPrefs() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { prefs: S.prefs }, { merge: true }).catch(erreurEcriture);
}
// Propositions du menu et historique des plats (dans le même document que les réglages)
function sauverPropo() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { propo: S.propo }, { merge: true }).catch(erreurEcriture);
}
function sauverHisto() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { histo: S.histo.map(l => ({ ids: l })) }, { merge: true }).catch(erreurEcriture);  // Firestore : pas de liste dans une liste
}
// Réglages › Notes (bloc-notes d'idées) : seulement le champ « idees », sans toucher au reste.
function sauverIdees(texte) {
  S.idees = texte;
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { idees: texte }, { merge: true }).catch(erreurEcriture);
}
// Banque d'ingrédients : en base, une carte « bqm » { clé : article } (avant 1.2.0 : un tableau « banque »,
// réécrit en bloc). En mémoire, S.banque reste un tableau. On écrit aussi « toujours » (vidé, voir migrerToujours).
let banqueConnue = null;
const carteBanque = l => Object.fromEntries(l.map(b => [cleStockee(b) || norm(b.nom) || "?", b]));
function sauverBanque() {
  if (MODE_DEMO) return sauverDemo();
  const apres = carteBanque(S.banque);
  const bqm = banqueConnue ? difference(banqueConnue, apres) : apres;
  banqueConnue = copie(apres);
  setDoc(refDonnees(), { bqm, banque: deleteField(), toujours: S.toujours }, { merge: true }).catch(erreurEcriture);
}

// Textures Minecraft : document à part (users/{uid}/app-foodix/donnees/textures/mc), lourd et rarement modifié,
// pour ne pas le renvoyer à chaque coche. Jamais dans le code : le dépôt est public.
// Découpé en morceaux mc, mc1, mc2… : un document Firestore ne dépasse pas 1 Mo.
const collTextures = () => collection(db, "users", uid, NOM_APPLI, "donnees", "textures");
let nbMorceaux = 0;
function sauverTextures() {
  if (MODE_DEMO) { try { localStorage.setItem("fx-demo-tex", JSON.stringify(MC.tex)); } catch (e) { toast("Stockage plein"); } return; }
  const morceaux = [{}]; let taille = 0;
  Object.entries(MC.tex).forEach(([k, v]) => {
    if (taille + v.length > 500000) { morceaux.push({}); taille = 0; }
    morceaux[morceaux.length - 1][k] = v; taille += v.length + k.length;
  });
  const nom = i => i ? "mc" + i : "mc";
  morceaux.forEach((tex, i) => setDoc(doc(collTextures(), nom(i)), { tex }).catch(erreurEcriture));
  for (let i = morceaux.length; i < nbMorceaux; i++) deleteDoc(doc(collTextures(), nom(i))).catch(erreurEcriture);
  nbMorceaux = morceaux.length;
}
const lirePropo = p => ({ repas: p && Array.isArray(p.repas) ? p.repas : [] });

// Icônes faites dans l'atelier : un document par icône (donnees/icones/{clé}), à part car une image
// d'internet peut peser quelques dizaines de Ko. Clé « r:<id recette> » ou « i:<clé ingrédient> » (voir PERSO dans pixel.js).
const collIcones = () => collection(db, "users", uid, NOM_APPLI, "donnees", "icones");
const idIcone = cle => cle.replace(/\//g, "_");
function sauverDemoIcones() { try { localStorage.setItem("fx-demo-icones", JSON.stringify(PERSO)); } catch (e) { toast("Stockage plein"); } }
function sauverIcone(cle, ico) {
  PERSO[cle] = Object.assign({ cle, maj: Date.now() }, ico);
  if (MODE_DEMO) return sauverDemoIcones();
  setDoc(doc(collIcones(), idIcone(cle)), PERSO[cle]).catch(erreurEcriture);
}
function effacerIcone(cle) {
  delete PERSO[cle];
  if (MODE_DEMO) return sauverDemoIcones();
  deleteDoc(doc(collIcones(), idIcone(cle))).catch(erreurEcriture);
}
// Ouvre l'atelier pour une recette (r) ou un ingrédient de la banque (e) ; « apres » redessine l'écran d'où l'on vient
function atelierPour(cle, nom, r, apres) {
  const avant = PERSO[cle] || null;
  const mes = [...new Set(Object.values(PERSO).map(x => x.p && x.p.web && x.p.web.src).filter(Boolean))];
  ouvrirAtelier({ nom, recette: r, actuel: avant, mes, toast,
    garder: ico => { sauverIcone(cle, ico); if (styleIcones() !== "perso") { ecrireLocal("fx-icones", "perso"); appliquerIcones(); }  // sinon on ne verrait pas l'icône faite
      render(); apres(); toast("Icône enregistrée", () => { avant ? sauverIcone(cle, avant) : effacerIcone(cle); render(); apres(); }); },
    effacer: () => { effacerIcone(cle); render(); apres(); toast("Icône par défaut", () => { sauverIcone(cle, avant); render(); apres(); }); } });
}

function erreurEcriture(err) { console.error(err); toast("Échec de l’enregistrement"); }

// Enregistre une recette. On n'attend pas la réponse du serveur : hors ligne,
// Firestore garde l'écriture et l'envoie tout seul au retour du réseau.
function ecrireRecette(r) {
  r.maj = Date.now();
  if (MODE_DEMO) return sauverDemo();
  setDoc(doc(collRecettes(), r.id), r).catch(erreurEcriture);
}
function effacerRecette(id) {
  if (MODE_DEMO) return sauverDemo();
  deleteDoc(doc(collRecettes(), id)).catch(erreurEcriture);
}
// Plusieurs recettes d'un coup (import) : par paquets de 400 (Firestore en accepte 500)
function ecrireRecettes(liste) {
  if (MODE_DEMO) return sauverDemo();
  for (let i = 0; i < liste.length; i += 400) {
    const lot = writeBatch(db);
    liste.slice(i, i + 400).forEach(r => lot.set(doc(collRecettes(), r.id), r));
    lot.commit().catch(erreurEcriture);
  }
}

// Copie de secours prise juste avant chaque import Excel (Réglages › Excel › Restaurer).
// Une seule, synchronisée, dans un document à part (limite Firestore : 1 Mo par document).
const refAvantImport = () => doc(db, "users", uid, NOM_APPLI, "donnees", "sauvegardes", "avant-import");
function sauverAvantImport(c) {
  if (MODE_DEMO) { try { localStorage.setItem("fx-demo-avant-import", JSON.stringify(c)); return true; } catch (e) { return false; } }
  if (JSON.stringify(c).length > 800000) return false;   // accents = 2 octets : on garde de la marge
  setDoc(refAvantImport(), c).catch(erreurEcriture);
  return true;
}

// Mode démo : tout est recopié dans le navigateur après chaque modification
function sauverDemo() {
  try { localStorage.setItem("fx-demo", JSON.stringify({ recettes: S.recettes, menus: S.menus, prefs: S.prefs, toujours: S.toujours, banque: S.banque, idees: S.idees, propo: S.propo, histo: S.histo })); } catch (e) { /* plein ou bloqué */ }
}
function demarrerDemo() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem("fx-demo")) || {}; } catch (e) { /* rien de gardé */ }
  S.recettes = Array.isArray(d.recettes) ? d.recettes : [];
  S.menus = Array.isArray(d.menus) ? d.menus : [];
  S.prefs = Object.assign({}, PREFS_DEFAUT, d.prefs);
  S.toujours = Array.isArray(d.toujours) ? d.toujours : [];
  S.banque = Array.isArray(d.banque) ? d.banque : [];
  S.propo = lirePropo(d.propo);
  S.histo = Array.isArray(d.histo) ? d.histo : [];
  migrerToujours();
  migrerTags();
  S.idees = d.idees || "";
  try { MC.tex = JSON.parse(localStorage.getItem("fx-demo-tex")) || {}; } catch (e) { MC.tex = {}; }
  try { Object.assign(PERSO, JSON.parse(localStorage.getItem("fx-demo-icones")) || {}); } catch (e) { /* rien de gardé */ }
  try { S.avantImport = JSON.parse(localStorage.getItem("fx-demo-avant-import")); } catch (e) { S.avantImport = null; }
  appliquerIcones();
  uid = "demo";
  S.compte = "Mode démo (données sur cet appareil seulement)";
  S.pret = true;
  render();
}

// Indicateur de synchro (affiché dans Réglages) : synchronisé / en attente / hors ligne
let enAttente = false;
function majSynchro(meta) {
  if (meta) enAttente = !!meta.hasPendingWrites;
  const el = $("#sync");
  if (!el) return;
  const etat = MODE_DEMO ? "horsligne" : !navigator.onLine ? "horsligne" : enAttente ? "attente" : "ok";
  const txt = MODE_DEMO ? "mode démo" : { ok: "synchronisé", attente: "en attente d’envoi", horsligne: "hors ligne" }[etat];
  el.className = "sync " + etat;
  el.innerHTML = icone(etat === "horsligne" ? "cloud-off" : "cloud") + txt;
}
window.addEventListener("online", () => majSynchro());
window.addEventListener("offline", () => majSynchro());

// Écoute la base : chaque changement (venu de ce téléphone ou du PC) redessine l'écran
function ecouter() {
  arrets.push(onSnapshot(collRecettes(), { includeMetadataChanges: true }, snap => {
    majSynchro(snap.metadata);
    const recu = snap.docs.map(d => d.data());
    if (JSON.stringify(recu) !== JSON.stringify(S.recettes)) { S.recettes = recu; if (!snap.metadata.fromCache) migrerTags(); rerendre(); }   // migrations : jamais sur une copie locale, elle peut être périmée
    if (!S.pret) { S.pret = true; render(); setTimeout(rappelExport, 3000); }
  }, err => { console.error(err); if (!S.pret) ecranSansAcces(err); else toast("Accès refusé aux données"); }));
  arrets.push(onSnapshot(collMenus(), snap => {
    const recu = snap.docs.map(d => d.data()).sort((a, b) => a.cree - b.cree);
    recu.forEach(m => { menusConnus[m.id] = copie(m); });
    if (JSON.stringify(recu) !== JSON.stringify(S.menus)) { S.menus = recu; rerendre(); }
  }, err => console.error(err)));
  arrets.push(onSnapshot(refDonnees(), { includeMetadataChanges: true }, snap => {   // metadata : pour savoir quand la copie vient du serveur
    const d = snap.exists() ? snap.data() : {};
    const p = Object.assign({}, PREFS_DEFAUT, d.prefs);
    const tj = d.toujours || [], pr = lirePropo(d.propo), hi = (d.histo || []).map(x => x.ids || []);
    const bq = estObj(d.bqm) ? Object.values(d.bqm) : Array.isArray(d.banque) ? d.banque : [];
    banqueConnue = estObj(d.bqm) ? copie(d.bqm) : null;
    S.idees = d.idees || ""; NotesIdees.maj(S.idees); // un autre appareil a pu changer les notes
    if (JSON.stringify(p) !== JSON.stringify(S.prefs) || JSON.stringify(tj) !== JSON.stringify(S.toujours) || stable(carteBanque(bq)) !== stable(carteBanque(S.banque))
      || JSON.stringify(pr) !== JSON.stringify(S.propo) || JSON.stringify(hi) !== JSON.stringify(S.histo)) {
      S.prefs = p; S.toujours = tj; S.banque = bq; S.propo = pr; S.histo = hi;
      if (!snap.metadata.fromCache) migrerToujours();
      rerendre();
    }
    // Passage du tableau « banque » à la carte « bqm » (1.2.0), une fois, sur une copie venue du serveur
    if (!estObj(d.bqm) && Array.isArray(d.banque) && !snap.metadata.fromCache) sauverBanque();
  }, err => console.error(err)));
  // Images reçues : seulement des images en data: (jamais une adresse ou du code glissé dans un src)
  const estImage = v => typeof v === "string" && v.startsWith("data:image/");
  arrets.push(onSnapshot(collTextures(), snap => {
    const tex = {};
    snap.docs.forEach(d => Object.entries(d.data().tex || {}).forEach(([k, v]) => { if (estImage(v)) tex[k] = v; }));
    nbMorceaux = Math.max(nbMorceaux, snap.docs.length);
    if (JSON.stringify(tex) !== JSON.stringify(MC.tex)) { MC.tex = tex; appliquerIcones(); rerendre(); }
  }, err => console.error(err)));
  arrets.push(onSnapshot(collIcones(), snap => {
    const recu = {};
    snap.docs.forEach(d => { const x = d.data(); if (x.cle && estImage(x.src)) recu[x.cle] = x; });
    if (JSON.stringify(recu) !== JSON.stringify(PERSO)) { Object.keys(PERSO).forEach(k => delete PERSO[k]); Object.assign(PERSO, recu); rerendre(); }
  }, err => console.error(err)));
  arrets.push(onSnapshot(refAvantImport(), snap => { S.avantImport = snap.exists() ? snap.data() : null; }, err => console.error(err)));
}

// Va chercher les 3 morceaux de Firebase (appli, connexion, base de données).
// Une fois venus, le « gardien » hors ligne (sw.js) en garde une copie (cache « foodix-libs », gardé d’une version à l’autre).
async function chargerFirebase() {
  const [a, au, fs] = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => import(FB + f)));
  ({ initializeApp } = a);
  ({ getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } = au);
  ({ initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, deleteField, terminate, clearIndexedDbPersistence } = fs);
}

async function demarrerFirebase() {
  try { await chargerFirebase(); }
  catch (e) {
    // Pas de réseau à la toute première ouverture, ou serveurs de Google injoignables
    $("#titre").textContent = "Foodix";
    $("#main").innerHTML = `<div class="vide">Impossible de joindre le serveur.<br>Vérifie le réseau.
      <div class="vide-act"><button class="btn pri" data-act="recharger">Réessayer</button></div></div>`;
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Cache local permanent : l'appli marche hors ligne avec la dernière copie connue
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  onAuthStateChanged(auth, user => {
    arrets.forEach(f => f()); arrets = [];
    if (!user) { uid = null; S.pret = false; renderConnexion(); return; }
    uid = user.uid;
    S.compte = user.email || user.displayName || "";
    ecouter();
  });
}

// Première lecture refusée (autre compte Google, règles changées, session expirée) : avant 1.2.0, « Chargement… » sans fin
function ecranSansAcces(err) {
  const refus = err && err.code === "permission-denied";
  $("#main").innerHTML = `<div class="vide">${refus ? `Ce compte n'a pas accès aux données.<br><small>${esc(S.compte)}</small>` : "Lecture des données impossible."}
    <div class="vide-act">${refus ? "" : `<button class="btn pri" data-act="recharger">Réessayer</button>`}<button class="btn${refus ? " pri" : ""}" data-act="deconnexion">Changer de compte</button></div></div>`;
}

// Déconnexion : efface aussi la copie des données gardée sur l'appareil. Pas tant que des modifs attendent d'être envoyées (elles seraient perdues).
async function deconnecter() {
  if (enAttente && S.pret) return toast("Des modifs ne sont pas encore envoyées : attends le réseau");
  fermer(); S.pret = false;
  arrets.splice(0).forEach(f => f());
  try { await signOut(auth); await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { console.error(e); }
  location.reload();
}

async function seConnecter(btn) {
  const fournisseur = new GoogleAuthProvider();
  btn.disabled = true;
  try {
    await signInWithPopup(auth, fournisseur);
  } catch (e) {
    // Fenêtre de connexion bloquée : on passe par une redirection
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, fournisseur);
    else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") { console.error(e); toast(e.code === "auth/network-request-failed" ? "Pas de réseau, réessaie" : "Connexion impossible, réessaie"); }
  } finally { btn.disabled = false; }
}

/* ---------- 3. Utilitaires ---------- */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icone = (nom, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24"><use href="#i-${nom}"/></svg>`;
function lireLocal(k, defaut) { try { return localStorage.getItem(k) || defaut; } catch (e) { return defaut; } }
function ecrireLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué : vaut pour cette fois */ } }
const parNom = (a, b) => a.nom.localeCompare(b.nom, "fr");
// Identifiant tiré du nom : « Bœuf bourguignon » -> « boeuf-bourguignon » (jamais de « / »)
const idDe = nom => norm(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recette";
// Nouvelle recette : suffixe au hasard, sinon deux « Tarte » créées hors ligne sur deux appareils prenaient le même id (la 2e écrasait la 1re)
function nouvelId(nom) {
  let id;
  do id = idDe(nom) + "-" + Math.random().toString(36).slice(2, 6); while (S.recettes.some(x => x.id === id));
  return id;
}
// « Annuler » : repartir de la liste du moment (une synchro a pu remplacer l'objet gardé dans la fonction)
const actuel = m => S.menus.find(x => x.id === m.id) || m;

// Message en bas de l'écran ; annuler = fonction appelée si on touche « Annuler »
let toastT;
function toast(msg, annuler) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.innerHTML = "";
  const span = document.createElement("span"); span.textContent = msg; t.appendChild(span);
  if (annuler) {
    const b = document.createElement("button"); b.textContent = "Annuler";
    b.onclick = () => { t.hidden = true; annuler(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, annuler ? 6000 : 2800);
}

// Saison : d'avril à septembre = Été, sinon Hiver
// (recalculée à chaque fois : l'appli peut rester ouverte des semaines sur le téléphone)
const saisonActuelle = () => { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9 ? "ete" : "hiver"; };
function deSaison(r) {
  const s = norm(r.saison), SAISON = saisonActuelle();
  return !s || s === "annuel" || s === "aucune" || s === SAISON || (s === "automne" && SAISON === "hiver") || (s === "printemps" && SAISON === "ete");
}

/* ---------- 3 bis. Animations et vibrations ---------- */
// Animations : « Complètes » (par défaut) ou « Simples » dans Réglages (et rien si le téléphone demande moins de mouvement).
const animOK = () => document.documentElement.dataset.anim !== "simples" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const DOUX = "cubic-bezier(.22,.9,.25,1)", RESSORT = "cubic-bezier(.3,1.5,.5,1)";
// Vibrations (téléphone Android), comme Médiathèque : chaque geste a la sienne, on « sent » ce qu'on a fait sans regarder.
// Réglage de CET appareil : Réglages › Vibrations Oui / Non.
const VIBRATIONS = {
  pas: 8,                     // changer d'onglet, petit choix
  coche: [10, 35, 18],        // article pris, plat cuisiné : double tape franche
  decoche: 6,                 // on décoche : une toute petite
  ajout: [8, 40, 8],          // ajouté à la liste : deux petites
  retire: 28,                 // retiré : une seule, plus longue
  seuil: 5,                   // le doigt a assez glissé pour que ça compte
  tirage: [6, 30, 6, 30, 6],  // nouveau menu : trois légères (les dés)
  gros: [14, 50, 22],         // nouvelle liste, liste remise en cours
  carte: 9                    // Compléter : la carte part
};
const estTel = () => matchMedia("(pointer: coarse)").matches;
function vibrer(sorte = "pas") {
  if (lireLocal("fx-vibr", "oui") === "non" || !estTel()) return;
  try { navigator.vibrate && navigator.vibrate(VIBRATIONS[sorte] ?? sorte); } catch (e) { /* pas de vibreur */ }
}
// Technique « FLIP » : on note où sont les lignes (repérées par data-k), on redessine,
// puis chaque ligne glisse en douceur de son ancienne place à la nouvelle ; les nouvelles apparaissent en fondu.
function flip(selecteur, redessiner) {
  if (!animOK()) return redessiner();
  const avant = new Map([...document.querySelectorAll(selecteur)].map(el => [el.dataset.k, el.getBoundingClientRect().top]));
  redessiner();
  document.querySelectorAll(selecteur).forEach(el => {
    const h = avant.get(el.dataset.k);
    if (h == null) return void el.animate([{ opacity: 0, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
    const d = h - el.getBoundingClientRect().top;
    if (Math.abs(d) > 1) el.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 340, easing: DOUX });
  });
}
// Un plat accepté « vole » vers l'onglet Courses (une copie de son dessin), et l'onglet fait un petit bond
function voler(img, delai = 0) {
  const cible = $('#tabs [data-tab="courses"]');
  if (!img || !cible || !animOK()) return;
  const a = img.getBoundingClientRect(), b = cible.getBoundingClientRect();
  if (!a.width) return;
  const c = img.cloneNode(true);
  Object.assign(c.style, { position: "fixed", left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", zIndex: 20, pointerEvents: "none", margin: 0 });
  document.body.appendChild(c);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + 18 - (a.top + a.height / 2);
  const vol = c.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    { transform: `translate(${dx * .5}px, ${dy * .5 - 70}px) scale(1.25)`, opacity: 1, offset: .45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: .2 }
  ], { duration: 620, delay: delai, easing: "cubic-bezier(.45,0,.35,1)", fill: "both" });
  vol.onfinish = () => { c.remove(); cible.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 300, easing: RESSORT }); };
}

/* ---------- 4. Affichage général ---------- */

// Redessine sans gêner une saisie en cours (ex. la recherche)
function rerendre() {
  if (!S.pret) return;
  const a = document.activeElement;
  if (a && a.id === "q") { majListe(); renderPanneau(); return; }
  render();
  // la fiche ouverte suit les changements (mais on ne touche jamais au formulaire en cours de saisie)
  if ($("#modal").dataset.recette && !$("#modal").dataset.form) {
    const f0 = $("#modal .fiche"), haut = f0 ? f0.scrollTop : 0;
    ouvrirFiche($("#modal").dataset.recette);
    const f = $("#modal .fiche"); if (f) { f.style.animation = "none"; f.parentElement.style.animation = "none"; f.scrollTop = haut; }
  }
  if (S.bq.ouvert) majBanque();
  if ($("#cp-ecran")) majCp(false);  // venu de l'autre appareil : pas pendant qu'on tape
}

function render() {
  if (estPC()) { renderCote(); renderRecettes(); renderPanneau(); majCadre(); return; }
  const m = menuEnCours();
  const titres = {
    menu: ["Menu", nbPropo() ? nbPropo() + " proposition" + (nbPropo() > 1 ? "s" : "") : ""],
    courses: ["Liste de courses", m ? "du " + new Date(m.cree).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : ""],
    recettes: ["Recettes", S.recettes.length ? S.recettes.length + " recette" + (S.recettes.length > 1 ? "s" : "") : ""]
  };
  const [titre, sous] = titres[S.onglet];
  $("#titre").textContent = titre;
  $("#sub").textContent = sous;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.onglet));
  placerIndicateur();
  if (S.onglet === "recettes") renderRecettes();
  else if (S.onglet === "menu") renderMenu();
  else renderCourses();
}

// La pastille claire sous l'onglet choisi glisse d'un onglet à l'autre
function placerIndicateur() {
  const on = $("#tabs button.on"), ind = $("#tind");
  if (!ind) return;
  ind.style.opacity = on ? 1 : 0;
  if (on) { ind.style.left = on.offsetLeft + "px"; ind.style.width = on.offsetWidth + "px"; }
}
window.addEventListener("resize", placerIndicateur);
// Pas de zoom : on bloque le pincement à deux doigts (en plus du réglage « viewport » de index.html)
document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener("gesturestart", e => e.preventDefault());

function renderConnexion() {
  $("#titre").textContent = "Foodix";
  $("#sub").textContent = "";
  $("#main").innerHTML = `<div class="vide">Connecte-toi pour retrouver tes recettes<br>sur le téléphone et le PC.
    <div><button class="btn pri" data-act="connexion">Se connecter avec Google</button></div></div>`;
}

/* ---------- 4 ter. Version bureau (PC) ---------- */
// Grand écran + souris : barre à gauche, recettes en grille au centre, Liste / Menu dans une colonne à droite.
// Fiche et formulaire de recette s'ouvrent dans cette colonne (#modal.lateral) ; les autres fenêtres restent au centre.
const largePC = matchMedia("(min-width: 900px) and (hover: hover) and (pointer: fine)");
const estPC = () => largePC.matches;
const zid = () => estPC() ? "#pzone" : "#main";   // où dessiner Courses / Menu
const zl = () => $(zid());
S.ponglet = lireLocal("fx-ponglet", "courses");
S.compact = lireLocal("fx-compact", "") === "1";   // liste de courses compacte (cet appareil)
let panneauOuvert = lireLocal("fx-panneau", "1") === "1";

function appliquerPC() {
  document.body.classList.toggle("pc", estPC());
  document.body.style.setProperty("--lc", lireLocal("fx-lc", "210") + "px");
  document.body.style.setProperty("--lp", lireLocal("fx-lp", "380") + "px");
  majCadre();
}
largePC.addEventListener("change", () => { appliquerPC(); if (S.pret) render(); });

function majCadre() {
  const md = $("#modal"), d = md.dataset;
  const lat = estPC() && !!md.innerHTML && !!(d.recette || d.form) && !["rep", "choix", "asm", "filtres", "archive"].some(k => d[k]);
  md.classList.toggle("lateral", lat);
  document.body.classList.toggle("p-vis", estPC() && (panneauOuvert || lat));
  document.querySelectorAll("#liste .sel").forEach(b => b.classList.remove("sel"));
  if (lat && d.recette) { const c = $(`#liste [data-fiche="${CSS.escape(d.recette)}"]`); if (c) c.classList.add("sel"); }
}
// attributeFilter obligatoire : sinon la classe « lateral » posée ici relancerait l'observateur en boucle
new MutationObserver(majCadre).observe($("#modal"), { childList: true, attributes: true,
  attributeFilter: ["data-recette", "data-form", "data-rep", "data-choix", "data-asm", "data-filtres", "data-archive"] });

function renderCote() {
  if (!estPC()) return;
  const cats = {};
  S.recettes.forEach(r => { if (r.categorie) cats[r.categorie] = (cats[r.categorie] || 0) + 1; });
  const nav = (act, ic, txt, on, n = "") => `<button class="nav ${on ? "on" : ""}" data-act="${act}">${icone(ic)}<span>${txt}</span>${n !== "" ? `<b>${n}</b>` : ""}</button>`;
  $("#cote").innerHTML = `<div class="logo"><img src="icones/icone.svg" width="22" height="22" alt="">Foodix</div>
    ${nav("pc-recettes", "book", "Recettes", !S.bq.ouvert && !S.f.cats.length, S.recettes.length)}
    ${nav("pc-menu", "cal", "Menu", panneauOuvert && S.ponglet === "menu")}
    ${nav("pc-courses", "cart", "Liste de courses", panneauOuvert && S.ponglet === "courses")}
    ${nav("banque", "carrot", "Banque", S.bq.ouvert)}
    <div class="groupe">Catégories</div>
    ${Object.keys(cats).sort((a, b) => a.localeCompare(b, "fr")).map(c =>
      `<button class="nav ${!S.bq.ouvert && S.f.cats.length === 1 && S.f.cats[0] === c ? "on" : ""}" data-cat="${esc(c)}"><span>${esc(c)}</span><b>${cats[c]}</b></button>`).join("")}
    <button class="nav bas" data-act="reglages">${icone("gear")}<span>Réglages</span></button>`;
}

function renderPanneau() {
  if (!estPC()) return;
  const m = menuEnCours(), n = nbPropo();
  const sous = S.ponglet === "menu" ? (n ? n + " proposition" + (n > 1 ? "s" : "") : "")
    : (m ? "du " + new Date(m.cree).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "");
  $("#p-tete").innerHTML = `<span class="seg">${[["courses", "Liste"], ["menu", "Menu"]].map(([k, t]) =>
    `<button class="${S.ponglet === k ? "on" : ""}" data-ponglet="${k}">${t}</button>`).join("")}</span>
    <span class="sub">${sous}</span><button class="ib" data-act="p-fermer" aria-label="Fermer la colonne">${icone("x")}</button>`;
  if (S.ponglet === "menu") renderMenu(); else renderCourses();
}

function montrerPanneau(onglet, ouvert = true) {
  if ($("#modal").classList.contains("lateral")) fermer();  // la fiche cède la place à la liste
  if (onglet) { S.ponglet = onglet; ecrireLocal("fx-ponglet", onglet); }
  panneauOuvert = ouvert; ecrireLocal("fx-panneau", ouvert ? "1" : "0");
  render();
}

// Bords à glisser pour élargir la barre de gauche (--lc) ou la colonne de droite (--lp), gardés sur cet appareil
function redimensionner(el, cle, min, max, sens) {
  el.addEventListener("pointerdown", e => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    el.classList.add("actif"); document.body.classList.add("redim-en-cours");
    const x0 = e.clientX, v0 = parseInt(getComputedStyle(document.body).getPropertyValue("--" + cle)) || min;
    let v = v0;
    const bouge = ev => { v = Math.max(min, Math.min(max, v0 + sens * (ev.clientX - x0))); document.body.style.setProperty("--" + cle, v + "px"); };
    el.addEventListener("pointermove", bouge);
    el.addEventListener("pointerup", () => {
      el.removeEventListener("pointermove", bouge);
      el.classList.remove("actif"); document.body.classList.remove("redim-en-cours");
      ecrireLocal("fx-" + cle, String(v));
    }, { once: true });
  });
}
redimensionner($("#redim-c"), "lc", 160, 340, 1);
redimensionner($("#redim-p"), "lp", 280, 700, -1);
appliquerPC();

/* ---------- 4 bis. Menu : des propositions de plats ---------- */
// Pas de jours ni de semaines : « Nouveau menu » propose N plats tirés au sort (S.propo).
// Rien n'arrive dans la liste de courses avant d'avoir accepté un plat (ou tous d'un coup).
// Une proposition = { id: recette, side: accompagnement ou null } ;
// un plat de la liste = { id, side, fait: true/false } (fait = cuisiné : ses ingrédients sortent de la liste).

// La liste de courses en cours = la dernière de S.menus ; celle d'avant = l'archive (« Liste précédente »).
const menuEnCours = () => S.menus[S.menus.length - 1] || null;
const listeArchive = () => S.menus.length > 1 ? S.menus[S.menus.length - 2] : null;
const recette = id => S.recettes.find(r => r.id === id);
// Compte affiché : sans les propositions dont la recette a été supprimée (ailleurs, ou avant 1.2.2)
const nbPropo = () => S.propo.repas.filter(p => recette(p.id)).length;
const estPlat = r => /plat complet|principal/.test(norm(r.categorie));
// Bases (sous-recettes) : une recette de catégorie « Base », appelée dans une autre en écrivant son nom entre crochets : [Pâte brisée maison].
// Un seul niveau (les crochets dans une base sont lus comme un ingrédient normal). Jamais proposées dans le menu.
const estBase = r => /^bases?\b/.test(norm(r && r.categorie));
// Sections d'une recette (« Sauce », « Garniture »…) : une ligne « # Sauce » dans les ingrédients.
// Les ingrédients qui suivent appartiennent à la section, jusqu'à la suivante. Ce n'est pas un ingrédient (ni courses, ni banque).
const estSection = t => /^\s*#/.test(t || "");
const nomSection = t => (t || "").replace(/^\s*#+\s*/, "").trim();
const ingsSeuls = r => ((r && r.ingredients) || []).filter(t => !estSection(t));
// Ingrédient optionnel : « 50 g parmesan (optionnel) » (ou option, opt, fac, facultatif, avec ou sans parenthèses)
const RE_OPT = /\s*\(?\s*\b(optionnel(?:le)?|option|opt\.?|fac\.?|facultati(?:f|ve))\s*\)?\s*$/i;
const estOptionnel = t => !!t && !estSection(t) && RE_OPT.test(t);
const sansOpt = t => (t || "").replace(RE_OPT, "").trim();
// Ingrédient au choix : « 4 chipolatas ou merguez » (deux choix). La quantité du premier vaut pour le second s'il n'en a pas.
function alternatives(t) {
  const s = sansOpt(t);
  if (nomCrochets(s)) return null;   // [Aubergine poêlée ou à la provençale] : un nom de plat, pas un choix
  const m = s.split(/\s+ou\s+/i);
  if (m.length !== 2 || !m[0].trim() || !m[1].trim()) return null;
  const a = m[0].trim(), b = m[1].trim(), ia = parseItem(a), ib = parseItem(b);
  const prefixe = ia && ia.name ? a.slice(0, a.length - ia.name.length) : "";
  return [a, ib && ib.qty != null ? b : (prefixe + b).trim()];
}
// L'ingrédient qu'on achète vraiment, selon les choix du repas (x.choix = { alt: { texte: 1 }, sans: [texte] }) ; null = pas pris
function ingChoisi(t, choix) {
  const c = choix || {};
  if (estOptionnel(t) && (c.sans || []).includes(t)) return null;
  const alt = alternatives(t);
  return alt ? alt[(c.alt || {})[t] ? 1 : 0] : sansOpt(t);
}
// Pour l'icône et la banque : le premier choix, sans « (optionnel) »
const maj1 = v => String(v || "").charAt(0).toUpperCase() + String(v || "").slice(1);
const ingPourIcone = t => { const a = alternatives(t); return a ? a[0] : sansOpt(t); };
// Les questions d'un plat : ses lignes « ou » et optionnelles (et celles de ses accompagnements)
// Plat assemblé ([Saumon]; [Riz]) : on descend dans ses plats et ses bases, comme articles() le fait pour la liste.
const lignesAuChoix = (r, niveau = 0) => {
  const out = [];
  ingsSeuls(r).forEach(t => {
    const b = niveau < 2 && sousRecette(t);
    if (b && b !== r) out.push(...lignesAuChoix(b, estBase(b) ? 2 : niveau + 1));
    else if (alternatives(t) || estOptionnel(t)) out.push(t);
  });
  return [...new Set(out)];
};
const nomCrochets = txt => { const m = /^\s*\[(.+)\]\s*$/.exec(txt || ""); return m ? m[1].trim() : null; };
const recetteParNom = nom => S.recettes.find(r => norm(r.nom) === norm(nom));
const sousRecette = txt => { const n = nomCrochets(txt); const r = n && recetteParNom(n); return r && r.ingredients ? r : null; };
// Les bases d'un plat. Un plat assemblé (« Saumon & riz ») appelle des plats entre crochets : on va chercher leurs bases à eux.
const basesDe = r => {
  if (!r) return [];
  const out = [];
  (r.ingredients || []).map(sousRecette).filter(Boolean).forEach(b => {
    if (estBase(b)) out.push(b);
    else if (b !== r) (b.ingredients || []).map(sousRecette).filter(x => x && estBase(x)).forEach(x => out.push(x));
  });
  return [...new Set(out)];
};
// Plat assemblé : ses ingrédients sont seulement des plats entre crochets ([Saumon]; [Riz]). Reconnu aussi après un import Excel.
const estAssemble = r => !!r && (r.assemble || (ingsSeuls(r).length > 1 && ingsSeuls(r).every(t => { const b = sousRecette(t); return b && !estBase(b); })));
// Les accompagnements d'un plat du menu ou de la liste : un seul tiré au sort (side), ou plusieurs choisis en l'assemblant (sides)
const accompsDe = x => x.sides && x.sides.length ? x.sides : x.side ? [x.side] : [];
// Familles (variantes) : des recettes qui sont des versions du même plat (Burger bœuf / végé / poulet), même « famille »
const familleDe = r => r && r.famille ? S.recettes.filter(x => norm(x.famille) === norm(r.famille)).sort((a, b) => (a.variante || a.nom).localeCompare(b.variante || b.nom, "fr")) : (r ? [r] : []);
const cleFamille = r => r.famille ? "f:" + norm(r.famille) : r.id;
const estAccomp = r => /accompagnement/.test(norm(r.categorie));
const estMezze = r => /mezze|apero/.test(norm(r.categorie));
// Ce qu'on peut assembler : Principal seul, Accompagnement, Mezzé / Apéro (pas les plats complets ni les bases)
const assemblable = r => !!r && !estBase(r) && (veutAccomp(r) || estAccomp(r) || estMezze(r));
const veutAccomp = r => /principal/.test(norm(r && r.categorie));
// Les plats déjà pris : propositions + liste en cours (pour ne pas proposer deux fois le même)
const platsPris = () => [...S.propo.repas.map(x => x.id), ...((menuEnCours() || {}).repas || []).map(x => x.id)];
const accompsPris = () => [...S.propo.repas, ...((menuEnCours() || {}).repas || [])].flatMap(accompsDe);

// Les plats que le tirage peut proposer (de saison, et selon Végé / Rapide)
function candidats() {
  const p = S.prefs;
  return S.recettes.filter(r => estPlat(r) && deSaison(r) && (!p.vege || r.vege) && (!p.rapide || !r.temps || r.temps <= 1));
}
// Plats des listes récentes (en cours, précédente, et les 2 d'avant gardées dans S.histo) : ils sortiront moins souvent
function recents() {
  const ids = new Set();
  S.menus.slice(-2).forEach(m => m.repas.forEach(x => { ids.add(x.id); accompsDe(x).forEach(a => ids.add(a)); }));
  S.histo.forEach(l => l.forEach(id => ids.add(id)));
  return ids;
}
// Tirage au sort « pondéré » : chaque plat a un poids, plus il est lourd, plus il a de chances de sortir
function poids(r, deja, recent) {
  const p = S.prefs;
  let w = 1;
  if (r.favori) w *= 2.5;                                    // favoris : plus souvent
  if (recent.has(r.id)) w *= 0.12;                           // servi récemment : beaucoup moins
  if (p.avance && r.prep) w *= 2.5;                          // pastille « Lunchbox »
  if (p.invites && r.date) w *= 2.5;                         // pastille « Invités »
  return w;
}
function tirer(liste, poidsDe) {
  if (!liste.length) return null;
  const ws = liste.map(poidsDe), total = ws.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < liste.length; i++) { x -= ws[i]; if (x <= 0) return liste[i]; }
  return liste[liste.length - 1];
}
// Un plat de plus, différent de ceux déjà proposés ou dans la liste
function tirerPlat(deja = platsPris()) {
  const recent = recents(), fams = new Set(deja.map(id => recette(id)).filter(Boolean).map(cleFamille));
  const l = candidats().filter(r => !deja.includes(r.id) && !fams.has(cleFamille(r)));
  const taille = new Map(); l.forEach(r => taille.set(cleFamille(r), (taille.get(cleFamille(r)) || 0) + 1));
  // une famille de 3 variantes ne sort pas 3 fois plus souvent : la variante est tirée au hasard dans la famille
  return tirer(l, r => poids(r, deja, recent) / taille.get(cleFamille(r)));
}
// Un accompagnement de saison (favoris ×2), différent de ceux déjà pris
function tirerAccomp(exclus = []) {
  const r = tirer(S.recettes.filter(x => estAccomp(x) && deSaison(x) && !exclus.includes(x.id)), x => x.favori ? 2 : 1);
  return r ? r.id : null;
}
// Une proposition : { id: recette, side: accompagnement ou null }
// Suggestions préférées du plat (étoile dans Assembler) : l'une d'elles, sinon un accompagnement au hasard
function tirerPrefere(r) {
  const l = (r.preferes || []).filter(id => { const a = recette(id); return a && !estBase(a); });
  return l.length ? l[Math.floor(Math.random() * l.length)] : null;
}
const nouveauRepas = r => ({ id: r.id, side: veutAccomp(r) ? (tirerPrefere(r) || tirerAccomp(accompsPris())) : null });

// Une liste de courses vide (les plats acceptés, les articles ajoutés, ce qui est coché)
const creerListe = () => ({ id: "m" + Date.now(), cree: Date.now(), pers: S.prefs.pers, repas: [], ajouts: [], coches: {}, dispo: {} });
// La liste en cours, créée si besoin (premier ajout)
function listeEnCours() {
  let m = menuEnCours();
  if (!m) { m = creerListe(); S.menus.push(m); }
  return m;
}

// « Nouveau menu » : de nouvelles propositions (rien n'arrive dans la liste avant d'avoir accepté)
function nouveauMenu() {
  const avant = S.propo.repas;
  S.propo.repas = [];
  for (let i = 0; i < S.prefs.nb; i++) {
    const r = tirerPlat(); if (!r) break;
    S.propo.repas.push(nouveauRepas(r));
  }
  if (!S.propo.repas.length) { S.propo.repas = avant; return toast("Aucun plat ne correspond"); }
  vibrer("tirage"); S.cascade = true;
  sauverPropo(); render();
  toast("Nouvelles propositions", () => { S.propo.repas = avant; sauverPropo(); render(); });
}

// Accepter une proposition (ou toutes) : le plat passe dans la liste de courses
function accepter(i, choixFait) {
  const x = S.propo.repas[i]; if (!x) return;
  if (!choixFait) return demanderBases([x], () => accepter(i, true));
  vibrer("ajout");
  voler($(`.rp.propo [data-repas="${i}"] img`) || $("#modal .fi-hd img"));
  const m = listeEnCours();
  S.propo.repas.splice(i, 1);
  const r = repasListe(x);
  m.repas.push(r);
  sauverPropo(); ecrireMenu(m); fermer(); render();
  toast("Ajouté à la liste", () => { ecrireMenu(enleverRepas(m, [r])); S.propo.repas.splice(i, 0, x); sauverPropo(); render(); });
}
function accepterTout(choixFait) {
  const l = S.propo.repas; if (!l.length) return;
  if (!choixFait) return demanderBases(l, () => accepterTout(true));
  const m = listeEnCours(), ajoutes = l.map(repasListe);
  vibrer("gros");
  document.querySelectorAll(".rp.propo .rp-btn img").forEach((img, k) => voler(img, k * 90));
  m.repas.push(...ajoutes);
  S.propo.repas = [];
  sauverPropo(); ecrireMenu(m); render();
  toast(l.length + " plat" + (l.length > 1 ? "s" : "") + " dans la liste", () => { ecrireMenu(enleverRepas(m, ajoutes)); S.propo.repas = l; sauverPropo(); render(); });
}

// Annuler un ajout : retire ces plats de la liste du moment (les derniers du même id), pas « les n derniers » d'une copie périmée
function enleverRepas(m, ajoutes) {
  const mm = actuel(m);
  ajoutes.forEach(r => { const k = mm.repas.findLastIndex(y => y.id === r.id && (y.side || null) === r.side); if (k >= 0) mm.repas.splice(k, 1); });
  return mm;
}
// Un plat qui entre dans la liste : { id, side, fait, achete: [bases achetées toutes prêtes] }
const repasListe = x => { const o = { id: x.id, side: x.side || null, fait: false }; if (x.sides) o.sides = x.sides; if (x.achete && x.achete.length) o.achete = x.achete; if (x.choix) o.choix = x.choix; return o; };

// Avant d'ajouter des plats qui utilisent une base (pâte, sauce…) : « je la fais » ou « je l'achète toute prête » ?
// On demande à chaque fois (rien n'est retenu). Le choix est noté sur le plat (x.achete), puis on continue.
// Noter un choix sur un repas : « ou » (0 = premier, 1 = second) ou optionnel pas pris
function noterChoix(x, t, sorte, v) {
  const c = x.choix = x.choix || {};
  if (sorte === "alt") { c.alt = c.alt || {}; if (v) c.alt[t] = 1; else delete c.alt[t]; if (!Object.keys(c.alt).length) delete c.alt; }
  else { const l = new Set(c.sans || []); v ? l.add(t) : l.delete(t); if (l.size) c.sans = [...l]; else delete c.sans; }
  if (!Object.keys(c).length) delete x.choix;
}
function demanderBases(plats, ensuite, avecChoix = false) {
  const q = [], qc = [];
  plats.forEach((x, n) => [x.id, ...accompsDe(x)].forEach(id => basesDe(recette(id)).forEach(b => q.push({ n, plat: recette(id).nom, b }))));
  if (avecChoix) plats.forEach((x, n) => [x.id, ...accompsDe(x)].forEach(id => lignesAuChoix(recette(id)).forEach(t => qc.push({ n, plat: recette(id).nom, t }))));
  if (!q.length && !qc.length) return ensuite();
  const md = $("#modal");
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete md.dataset[k]);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Bases">
    <div class="fi-hd"><div class="txt"><h2>${qc.length ? "Avant la liste de courses" : "Je la fais ou je l'achète ?"}</h2><div class="sub">Pour la liste de courses</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${q.map((o, k) => `<div class="base-q"><div class="w"><b>${esc(o.b.nom)}</b><span class="sub">pour ${esc(o.plat)}</span></div>
      <span class="seg" data-base-q="${k}" data-n="${o.n}" data-nom="${esc(o.b.nom)}"><button class="on" data-v="fais">Je la fais</button><button data-v="achete">Je l'achète</button></span></div>`).join("")}
    ${qc.map(o => { const alt = alternatives(o.t);
      return `<div class="base-q choix-q"><div class="w"><b class="${estOptionnel(o.t) ? "opt" : ""}">${esc(sansOpt(o.t))}</b><span class="sub">${alt ? "laquelle ?" : "optionnel"}</span></div>
      ${alt ? `<span class="seg" data-alt-q data-n="${o.n}" data-t="${esc(o.t)}"><button class="on" data-v="0">${imgIng(alt[0], 16)}${esc(maj1(parseItem(alt[0]) ? parseItem(alt[0]).name : alt[0]))}</button><button data-v="1">${imgIng(alt[1], 16)}${esc(maj1(parseItem(alt[1]) ? parseItem(alt[1]).name : alt[1]))}</button></span>` : ""}
      ${estOptionnel(o.t) ? `<span class="seg" data-opt-q data-n="${o.n}" data-t="${esc(o.t)}"><button class="on" data-v="oui">Je le prends</button><button data-v="non">Pas cette fois</button></span>` : ""}</div>`; }).join("")}
    <div class="pied2"><button class="btn" data-act="fermer">Annuler</button><button class="btn pri" data-act="bases-ok">${icone("cart")}Ajouter à la liste</button></div></div></div>`;
  md.suite = () => {
    document.querySelectorAll("[data-base-q]").forEach(g => {
      if (!g.querySelector('[data-v="achete"]').classList.contains("on")) return;
      const x = plats[+g.dataset.n]; x.achete = [...new Set([...(x.achete || []), g.dataset.nom])];
    });
    document.querySelectorAll("[data-alt-q]").forEach(g => { if (g.querySelector('[data-v="1"]').classList.contains("on")) noterChoix(plats[+g.dataset.n], g.dataset.t, "alt", 1); });
    document.querySelectorAll("[data-opt-q]").forEach(g => { if (g.querySelector('[data-v="non"]').classList.contains("on")) noterChoix(plats[+g.dataset.n], g.dataset.t, "sans", true); });
    fermer(); ensuite();
  };
}

// Nombre de propositions : + tire un plat de plus, − retire le dernier
function changerNombre(d) {
  const n = Math.min(14, Math.max(1, S.prefs.nb + d));
  S.prefs.nb = n; sauverPrefs();
  if (S.propo.repas.length) {
    if (d > 0) { const r = tirerPlat(); if (r) S.propo.repas.push(nouveauRepas(r)); else toast("Plus d'autre plat disponible"); }
    if (d < 0 && S.propo.repas.length > 1) S.propo.repas.pop();
    sauverPropo();
  }
  render();
}
function changerPersonnes(d) {
  S.prefs.pers = Math.min(12, Math.max(1, S.prefs.pers + d)); sauverPrefs();
  const m = menuEnCours();
  if (m) { m.pers = S.prefs.pers; ecrireMenu(m); }
  render();
}

function renderMenu() {
  const m = menuEnCours(), p = S.prefs, pr = S.propo.repas;
  const pastille = (k, ic, txt) => `<button class="chip ${p[k] ? "on" : ""}" data-pref="${k}">${icone(ic)}${txt}</button>`;
  const haut = `<div class="ctl">
      <span class="pas"><span class="l">${icone("utensils")}</span><button data-act="nb" data-v="-1" aria-label="Moins de plats">−</button><b class="num">${p.nb}</b><button data-act="nb" data-v="1" aria-label="Plus de plats">+</button></span>
      <span class="pas"><span class="l">${icone("users")}</span><button data-act="pers" data-v="-1" aria-label="Moins de personnes">−</button><b class="num">${p.pers}</b><button data-act="pers" data-v="1" aria-label="Plus de personnes">+</button></span>
      <span class="spacer"></span><button class="btn pri" data-act="nouveau-menu">${icone("shuffle")}Nouveau menu</button></div>
    <div class="defile">${pastille("vege", "leaf", "Végé")}${pastille("rapide", "clock", "Rapide")}${pastille("avance", "box", "Lunchbox")}${pastille("invites", "glass", "Invités")}</div>`;
  if (!S.recettes.length) { zl().innerHTML = `<div class="vide">Pas encore de recettes pour tirer un menu.<div class="vide-act"><button class="btn pri" data-act="aller-recettes">${icone("book")}Aller aux recettes</button></div></div>`; return; }
  const infos = (r, s) => `${dishImg(r, 30)}<span class="txt"><span class="nm">${esc(r.nom)}</span>${s ? `<span class="side">+ ${esc(s)}</span>` : ""}</span>
        <span class="ri">${r.favori ? icone("star", "fav") : ""}${r.vege ? icone("leaf", "acc") : ""}</span>`;
  const propos = pr.map((x, i) => {
    const r = recette(x.id), s = accompsDe(x).map(recette).filter(Boolean).map(a => a.nom).join(", ");
    if (!r) return "";
    const fam = familleDe(r).filter(v => !S.prefs.vege || v.vege);
    const vars = fam.length > 1 ? `<span class="vars">${fam.map(v => `<button class="chip ${v.id === r.id ? "on" : ""}" data-var-propo="${i}" data-v="${esc(v.id)}">${esc(v.variante || v.nom)}</button>`).join("")}</span>` : "";
    return `<div class="rp propo ${vars ? "a-vars" : ""}" style="--i:${i}"><button class="rp-btn" data-repas="${i}" data-src="p">${infos(r, s)}</button>${vars}
      <button class="accepte" data-act="accepter" data-i="${i}" aria-label="Ajouter ${esc(r.nom)} à la liste">${icone("plus")}Liste</button></div>`;
  }).join("");
  const dansListe = ((m && m.repas) || []).map((x, i) => {
    const r = recette(x.id), s = accompsDe(x).map(recette).filter(Boolean).map(a => a.nom).join(", ");
    if (!r) return "";
    return `<div class="rp ${x.fait ? "fait" : ""}">
      <button class="cb" data-act="fait" data-i="${i}" aria-label="${x.fait ? "Pas encore cuisiné" : "Cuisiné"}">${x.fait ? icone("check") : ""}</button>
      <button class="rp-btn" data-repas="${i}" data-src="l">${infos(r, s)}<span class="chev">${icone("right")}</span></button></div>`;
  }).join("");
  const cascade = S.cascade; S.cascade = false;  // la cascade ne se joue qu'une fois, juste après « Nouveau menu »
  zl().innerHTML = haut
    + `<div class="sec-t"><h3>Propositions</h3>${pr.length > 1 ? `<button class="lien-btn" data-act="accepter-tout">${icone("check")}Tout ajouter</button>` : ""}</div>`
    + (propos ? `<div class="repas ${cascade ? "cascade" : ""}">${propos}</div>` : `<div class="vide petit">Touche « Nouveau menu » pour des idées de plats.</div>`)
    + `<button class="btn ajout" data-act="choisir-plat">${icone("search")}Choisir un plat moi-même</button>`
    + `<div class="sec-t"><h3>Dans ma liste</h3>${dansListe ? `<span class="sub">Coche ce qui est cuisiné</span>` : ""}</div>`
    + (dansListe ? `<div class="repas">${dansListe}</div>` : `<div class="vide petit">Aucun plat dans la liste de courses.</div>`);
}

function cocherFait(i) {
  const m = menuEnCours(); if (!m || !m.repas[i]) return;
  m.repas[i].fait = !m.repas[i].fait;
  vibrer(m.repas[i].fait ? "coche" : "decoche");
  ecrireMenu(m); render();
}

// Petit menu d'un plat : gros boutons. src « p » = une proposition, « l » = un plat de la liste
function ouvrirRepas(i, src) {
  const l = src === "p" ? S.propo.repas : ((menuEnCours() || {}).repas || []);
  const x = l[i], r = x && recette(x.id);
  if (!r) return;
  const s = accompsDe(x).map(recette).filter(Boolean).map(a => a.nom).join(", ");
  const md = $("#modal");
  md.dataset.rep = i; md.dataset.src = src; delete md.dataset.recette; delete md.dataset.form;
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd">${dishImg(r, 44)}<div class="txt"><h2>${esc(r.nom)}</h2>${s ? `<div class="sub">+ ${esc(s)}</div>` : ""}</div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${(() => { const lc = [x.id, ...accompsDe(x)].flatMap(id => lignesAuChoix(recette(id))); if (!lc.length) return "";
      const c = x.choix || {};
      return `<div class="pour-repas"><div class="pr-t">Pour ce repas</div>${lc.map(t => { const alt = alternatives(t), nom = v => esc(maj1(parseItem(v) ? parseItem(v).name : v)), a = (c.alt || {})[t] ? 1 : 0, sans = (c.sans || []).includes(t);
        return `<div class="pr-l"><b class="${estOptionnel(t) ? "opt" : ""}">${esc(sansOpt(t))}</b><span class="pr-c">
          ${alt ? `<span class="seg"><button class="${a ? "" : "on"}" data-repas-alt="0" data-t="${esc(t)}">${imgIng(alt[0], 16)}${nom(alt[0])}</button><button class="${a ? "on" : ""}" data-repas-alt="1" data-t="${esc(t)}">${imgIng(alt[1], 16)}${nom(alt[1])}</button></span>` : ""}
          ${estOptionnel(t) ? `<span class="seg"><button class="${sans ? "" : "on"}" data-repas-opt="oui" data-t="${esc(t)}">Je le prends</button><button class="${sans ? "on" : ""}" data-repas-opt="non" data-t="${esc(t)}">Pas cette fois</button></span>` : ""}</span></div>`; }).join("")}</div>`; })()}
    <div class="actions">
      ${src === "p" ? `<button class="act pri" data-act="accepter" data-i="${i}">${icone("cart")}Ajouter à la liste de courses</button>
      <button class="act" data-act="remplacer">${icone("refresh")}Remplacer (au hasard)</button>
      <button class="act" data-act="choisir">${icone("search")}Choisir un autre plat…</button>` : ""}
      ${assemblable(r) ? `<button class="act" data-act="accomp">${icone("utensils")}Changer l'accompagnement</button>` : ""}
      <button class="act" data-act="voir">${icone("book")}Voir la recette</button>
      <button class="act danger" data-act="retirer">${icone("trash")}${src === "p" ? "Retirer des propositions" : "Retirer de la liste de courses"}</button>
    </div></div></div>`;
}
// Le plat ouvert : sa liste (propositions ou liste de courses), sa place, et comment l'enregistrer
function repasOuvert() {
  const md = $("#modal"), i = +md.dataset.rep;
  if (md.dataset.src === "p") return S.propo.repas[i] ? { l: S.propo.repas, i, src: "p", save: sauverPropo } : null;
  const m = menuEnCours();
  return m && m.repas[i] ? { l: m.repas, i, src: "l", save: () => ecrireMenu(m) } : null;
}

function remplacer() {
  const o = repasOuvert(); if (!o) return;
  const r = tirerPlat();
  if (!r) return toast("Plus d'autre plat disponible");
  o.l[o.i] = nouveauRepas(r);
  o.save(); render(); ouvrirRepas(o.i, o.src);
}
function changerAccomp() {
  const o = repasOuvert(); if (!o) return;
  const x = o.l[o.i];
  x.side = tirerAccomp([x.side, ...accompsPris()].filter(Boolean)) || x.side;
  o.save(); render(); ouvrirRepas(o.i, o.src);
}
function retirer() {
  const o = repasOuvert(); if (!o) return;
  const [x] = o.l.splice(o.i, 1);
  vibrer("retire"); o.save(); fermer(); render();
  toast(o.src === "p" ? "Retiré des propositions" : "Retiré de la liste", () => { o.l.splice(o.i, 0, x); o.save(); render(); });
}

// « Choisir… » : liste des plats avec recherche ; i = proposition à remplacer (ou absent = en proposer un de plus)
function ouvrirChoix(i) {
  const md = $("#modal");
  md.dataset.choix = i ?? ""; delete md.dataset.recette;
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Choisir un plat">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Choisir un plat</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <label class="cherche" style="margin:0">${icone("search")}<input id="q-choix" type="search" placeholder="Chercher…" autocomplete="off"></label>
    <div class="choix-l" id="choix-l"></div></div></div>`;
  majChoix();
}
function majChoix() {
  const q = norm($("#q-choix").value);
  const l = S.recettes.filter(r => estPlat(r) && (!q || norm(r.nom + " " + (r.ingredients || []).join(" ")).includes(q))).sort(parNom);
  $("#choix-l").innerHTML = l.map(r => `<button class="ligne" data-choisi="${esc(r.id)}">${dishImg(r, 28)}<span class="nm">${esc(r.nom)}</span>
    <span class="ri">${r.favori ? icone("star", "fav") : ""}${r.vege ? icone("leaf", "acc") : ""}</span></button>`).join("") || `<div class="vide">Aucun plat.</div>`;
}
function choisirPlat(id) {
  const r = recette(id); if (!r) return;
  const i = $("#modal").dataset.choix, x = nouveauRepas(r);
  if (i !== "" && S.propo.repas[+i]) S.propo.repas[+i] = x; else S.propo.repas.push(x);
  sauverPropo(); fermer(); render();
  toast("Ajouté aux propositions");
}
// Bouton « À la liste » de la fiche recette : le plat va directement dans la liste de courses
function auMenu() {
  const r = recette($("#modal").dataset.recette); if (!r) return;
  const x = nouveauRepas(r);
  demanderBases([x], () => {
  const m = listeEnCours();
  m.repas.push(repasListe(x));
  S.propo.repas = S.propo.repas.filter(x => x.id !== r.id);
  sauverPropo(); ecrireMenu(m); render(); ouvrirFiche(r.id);
  toast("Ajouté à la liste de courses"); vibrer("ajout");
  }, true);
}

/* ---------- 4 bis bis. Assembler un plat complet (principal + un ou plusieurs accompagnements) ---------- */
// Depuis la fiche d'un plat principal ou d'un accompagnement : je vois ce qui va avec, je compose,
// puis « Juste au menu » (provisoire, par défaut : rien n'est créé dans mes recettes)
// ou « Garder dans mes recettes » (une vraie recette « Plat complet » : [Principal]; [Accompagnement]…, liée à ses morceaux).
// Dans les deux cas, le plat arrive dans les propositions du menu.

const nomAssemble = (p, as) => p.nom + " & " + as.map(a => a.nom.charAt(0).toLowerCase() + a.nom.slice(1)).join(", ");

// Depuis la fiche d'un plat (ou « Changer l'accompagnement » d'un repas du menu) : on coche ce qui va avec,
// parmi tous les Principal seul / Accompagnement / Mezzé / Apéro. Les suggestions préférées (étoile) sont cochées d'office.
function ouvrirAssembler(depart, accs = [], repasI = null, src = "p") {
  const r = recette(depart); if (!r) return;
  const prefs = (r.preferes || []).filter(id => assemblable(recette(id)));
  // onglet de départ : Favoris s'il y en a, sinon Accomp. pour un plat principal, Principal pour le reste
  const onglet = prefs.length ? "fav" : veutAccomp(r) ? "acc" : "princ";
  S.asm = { depart, sel: new Set(accs.length ? accs : prefs), repasI, src, onglet };
  vibrer("pas");
  majAssembler(true);
}
// Le plat principal du repas : le premier « Principal seul » choisi (sinon le plat de départ) ; le reste l'accompagne
function repasAssemble() {
  const a = S.asm, tous = [a.depart, ...[...a.sel].filter(id => id !== a.depart && recette(id))];
  const princ = tous.find(id => veutAccomp(recette(id))) || a.depart;
  return { princ, accs: tous.filter(id => id !== princ) };
}
function majAssembler(premier) {
  const a = S.asm, md = $("#modal"), r = recette(a.depart); if (!r) return;
  const haut = !premier && $("#modal .as-corps") ? $("#modal .as-corps").scrollTop : 0;
  const prefs = (r.preferes || []).map(recette).filter(x => assemblable(x) && x.id !== r.id);
  const ligne = x => `<div class="ao ${a.sel.has(x.id) ? "on" : ""}"><button type="button" class="ao-c" data-asm-sel="${esc(x.id)}"><span class="cb">${icone("check")}</span>${dishImg(x, 24)}<span class="nm">${esc(x.nom)}</span></button>
    <button type="button" class="ao-p ${(r.preferes || []).includes(x.id) ? "on" : ""}" data-asm-pref="${esc(x.id)}" aria-label="Suggestion préférée">${icone("star")}</button></div>`;
  // Onglets : un favori est aussi dans son onglet normal
  const ONG = [["fav", `${icone("star")}Favoris`, null], ["princ", "Principal", veutAccomp], ["acc", "Accomp.", estAccomp], ["mez", "Mezzé", estMezze]];
  const test = (ONG.find(o => o[0] === a.onglet) || ONG[0])[2];
  const l = test ? S.recettes.filter(x => x.id !== r.id && !estBase(x) && test(x)).sort(parNom) : prefs;
  const groupes = `<div class="as-ong" role="tablist">${ONG.map(([k, lib]) => `<button type="button" role="tab" class="${k === a.onglet ? "on" : ""} ${k}" data-asm-ong="${k}" aria-selected="${k === a.onglet}">${lib}</button>`).join("")}</div>
    ${l.length ? `<div class="as-l">${l.map(ligne).join("")}</div>` : `<p class="as-vide">${a.onglet === "fav" ? "Pas encore de favori pour ce plat : touche l'étoile d'une recette dans les autres onglets." : "Rien dans cette catégorie."}</p>`}`;
  const { princ, accs } = repasAssemble(), pret = accs.length > 0;
  md.dataset.asm = "1";
  ["recette", "form", "rep", "src", "choix", "archive", "filtres", "vc"].forEach(k => delete md.dataset[k]);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche asm2" role="dialog" aria-label="Assembler">
    <div class="as-hd">${dishImg(r, 32)}<div class="txt"><small>Avec quoi ?</small><b>${esc(r.nom)}</b></div><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="as-corps">
      <div class="as-resume">${pret ? `Au menu : ${[princ, ...accs].map(id => `<b>${esc(recette(id).nom)}</b>`).join(" + ")}` : "Coche ce qui va avec."}</div>
      ${groupes}
    </div>
    <div class="as-pied"><div class="l2"><button class="btn sec" data-act="asm-garder" ${pret ? "" : "disabled"}>${icone("book")}Garder comme plat</button>
      <button class="btn pri" data-act="asm-menu" ${pret ? "" : "disabled"}>${icone("cal")}Au menu</button></div>
      <div class="aide">L'étoile : suggestion préférée de ce plat (plusieurs possibles).</div></div>
  </div></div>`;
  if (!premier) { const f = $("#modal .fiche"); f.style.animation = "none"; f.parentElement.style.animation = "none"; $("#modal .as-corps").scrollTop = haut; }
}
// Le plat assemblé arrive dans les propositions (ou remplace le plat du menu qu'on était en train d'assembler)
function poserAuMenu(x, msg) {
  const i = S.asm.repasI, m = menuEnCours();
  // depuis la liste de courses : on remplace le repas dans la liste ; sinon dans les propositions
  if (S.asm.src === "l" && m && i != null && m.repas[i]) {
    const avant = m.repas[i]; m.repas[i] = Object.assign({}, avant, x); ecrireMenu(m); fermer(); render(); vibrer("ajout");
    return toast(msg, () => { m.repas[i] = avant; ecrireMenu(m); render(); });
  }
  const avant = S.propo.repas.slice();
  if (i != null && S.propo.repas[i]) S.propo.repas[i] = x; else S.propo.repas.push(x);
  S.cascade = false; sauverPropo(); fermer(); render();
  vibrer("ajout");
  toast(msg, () => { S.propo.repas = avant; sauverPropo(); render(); });
}
function assemblerAuMenu() {
  const { princ, accs } = repasAssemble(); if (!accs.length) return;
  poserAuMenu({ id: princ, side: accs[0], sides: accs.slice() }, "Au menu");
}
function assemblerGarder() {
  const { princ, accs } = repasAssemble(), p = recette(princ), as = accs.map(recette).filter(Boolean); if (!p || !as.length) return;
  const nom = nomAssemble(p, as);
  const id = nouvelId(nom);
  const r = { id, nom, categorie: "Plat complet", assemble: true, portions: p.portions || 2, ingredients: [p, ...as].map(x => "[" + x.nom + "]"), ingredientsSource: "app",
    favori: false, vege: !!(p.vege && as.every(x => x.vege)), prep: false, date: false };
  ["saison", "origine"].forEach(k => { if (p[k]) r[k] = p[k]; });
  S.recettes.push(r); ecrireRecette(r);
  poserAuMenu({ id: r.id, side: null }, "Gardé dans mes recettes et mis au menu");
}

/* ---------- 4 ter. Liste de courses ---------- */
// Additionne les ingrédients des repas pas encore cuisinés (plats + accompagnements),
// à l'échelle du nombre de personnes, puis les range par rayon du magasin.
// Clé d'un article = nom simplifié (sans accents, sans pluriel) + unité :
// « 2 oignons » et « 1 oignon » deviennent « 3 oignons ».

const cleAjout = a => "perso|" + norm(a);

function articles(m) {
  const map = new Map();
  const idx = new Map(banque().map(e => [e.cle, e]));
  m.repas.filter(x => !x.fait).forEach(x => [x.id, ...accompsDe(x)].forEach(id => {
    const r = recette(id); if (!r) return;
    const pers = m.pers || 2;
    // Chaque ligne avec son échelle (ex. recette pour 2, on est 4 : ×2).
    // Une base entre crochets : ses ingrédients (même échelle que le plat), ou elle-même si je l'achète toute prête.
    // Un plat entre crochets (plat assemblé) : ses ingrédients à son échelle à lui, et ses bases à lui.
    const lignes = [];
    const deplier = (rec, k, niveau) => ingsSeuls(rec).map(t => ingChoisi(t, x.choix)).filter(Boolean).forEach(txt => {
      const b = niveau < 2 && sousRecette(txt);
      if (!b || b === rec) return lignes.push([nomCrochets(txt) || txt, k]);
      if (estBase(b) && (x.achete || []).includes(b.nom)) return lignes.push([b.nom.replace(/\s+maison$/i, "") + " (tout prêt)", null]);
      deplier(b, estBase(b) ? k : pers / (b.portions || 2), estBase(b) ? 2 : niveau + 1);
    });
    deplier(r, pers / (r.portions || 2), 0);
    lignes.forEach(([txt, k]) => {
      const it = parseItem(txt); if (!it) return;
      const cle = it.key + "|" + it.unit;
      const e = map.get(cle) || { cle, nom: it.name, unite: it.unit, qte: null, recettes: [], rayon: idx.has(it.key) ? idx.get(it.key).rayon : aisleOf(it.name), placard: idx.has(it.key) ? idx.get(it.key).placard : auPlacard(it.name) };
      if (it.qty != null) e.qte = (e.qte || 0) + it.qty * (k || 1);
      if (!e.recettes.includes(r.nom)) e.recettes.push(r.nom);
      map.set(cle, e);
    });
  }));
  // « sel » sans quantité rejoint « 5 g sel » s'il existe
  for (const e of [...map.values()]) if (e.qte == null) {
    const autre = [...map.values()].find(o => o !== e && o.cle.split("|")[0] === e.cle.split("|")[0] && o.qte != null);
    if (autre) { e.recettes.forEach(n => { if (!autre.recettes.includes(n)) autre.recettes.push(n); }); map.delete(e.cle); }
  }
  (m.ajouts || []).forEach(a => {
    // « tomate » ajouté à la main alors qu'une recette en demande déjà : une seule ligne (celle des recettes)
    const seul = parseItem(a);
    if (seul && seul.name === a.trim() && [...map.values()].some(x => !x.ajout && x.cle.split("|")[0] === seul.key)) return;
    // « 2 L lait » ajouté à la main alors qu'une recette demande « 50 cl lait » : les quantités s'additionnent
    const meme = seul && seul.qty != null && map.get(seul.key + "|" + seul.unit);
    if (meme && !meme.ajout && meme.qte != null) {
      meme.qte += seul.qty;
      if (!meme.recettes.includes("à la main")) meme.recettes.push("à la main");
      return;
    }
    // rayon choisi pour cette liste seulement (m.rayonsAjouts), sinon celui de la banque, sinon « Ajouts »
    const e = idx.get(cleBanque(a)), choisi = (m.rayonsAjouts || {})[cleAjout(a)];
    map.set(cleAjout(a), { cle: cleAjout(a), nom: a, unite: "", qte: null, recettes: [], rayon: choisi || (e ? e.rayon : "perso"), ajout: true, enBanque: !!e });
  });
  return [...map.values()];
}

// Coches et ingrédients retirés retiennent la QUANTITÉ du moment (ex. 2 pour « 2 oignons »),
// ou `true` pour un article sans quantité (et pour les anciennes listes).
// Si la liste en demande plus ensuite (un plat ajouté), la ligne revient pour ce qui manque.
const PRECIS = 1e-6; // marge pour les nombres à virgule (0,1 + 0,2 ne fait pas tout à fait 0,3 en informatique)
const marque = e => e.qte != null ? e.qte : true;
// Ce qui est déjà pris : true = tout, un nombre = une partie, 0 = rien
function dejaPris(m, e) {
  const v = (m.coches || {})[e.cle];
  if (!v) return 0;
  if (v === true || e.qte == null || v + PRECIS >= e.qte) return true;
  return v;
}
const estPris = (m, e) => dejaPris(m, e) === true;
// Retiré d'un glissement, et la recette n'en demande pas plus depuis
function estMasque(m, e) {
  const v = (m.masques || {})[e.cle];
  return !!v && (v === true || e.qte == null || v + PRECIS >= e.qte);
}

function renderCourses() {
  const m = menuEnCours();
  // ce qui était tapé dans le champ d'ajout reste (la liste peut se redessiner quand l'autre appareil modifie quelque chose)
  const champ = $("#ajout-art"), tape = champ ? champ.value : "", avaitFocus = !!champ && document.activeElement === champ;
  const ajout = `<div class="ajout-art"><div class="srow"><label class="cherche">${icone("plus")}<input id="ajout-art" placeholder="Ajouter un article" autocomplete="off" enterkeyhint="done"></label>
    <button class="fab" data-act="ajouter-art" aria-label="Ajouter">${icone("check")}</button>
    <button class="ib compact-b ${S.compact ? "on" : ""}" data-act="compact" aria-label="Liste compacte" aria-pressed="${!!S.compact}">${icone("rows")}</button>
    <button class="ib compact-b" data-act="courses-plus" aria-label="Plus d'actions">${icone("more")}</button></div><div class="deroul" id="sugg-art"></div></div>`;
  const finir = () => { // remet le champ comme il était
    const c = $("#ajout-art"); if (!c || !tape) return;
    c.value = tape; majSuggArt(); if (avaitFocus) c.focus();
  };
  if (!m) { zl().innerHTML = ajout + `<div class="vide">Liste vide.<br>Ajoute des articles ci-dessus, ou des plats depuis l'onglet Menu.</div>`; return finir(); }
  const dispo = m.dispo || {};
  const groupes = {}, placard = [];
  // Un article « souvent au placard » reste à part tant que je n'ai pas dit « il me faut » ; alors il rejoint son rayon.
  let nbMasques = 0;
  articles(m).forEach(e => {
    if (estMasque(m, e)) { nbMasques++; return; }  // retiré d'un glissement (ingrédient d'une recette)
    e.pris = dejaPris(m, e);  // true, un nombre (une partie déjà prise) ou 0
    if (e.placard && !e.ajout && dispo[e.cle] !== "non") placard.push(e);
    else (groupes[e.rayon] ??= []).push(e);
  });
  // Entièrement pris : quitte son rayon pour le bloc « Dans le panier », replié tout en bas
  const coches = {}, panier = [];
  for (const a in groupes) {
    groupes[a] = groupes[a].filter(e => e.pris === true ? (coches[e.cle] = true, panier.push(e), false) : true);
    if (!groupes[a].length) delete groupes[a];
  }
  // Une partie déjà prise : on affiche ce qui manque, et « 2 déjà pris » sous le nom
  const partiel = e => typeof e.pris === "number" && e.pris > 0;
  const reste = e => partiel(e) ? e.qte - e.pris : e.qte;
  // Mode compact : sans les plats, mais « déjà pris » reste (sinon la quantité affichée trompe)
  const sousNom = e => [partiel(e) ? fmtQty(e.pris, e.unite) + " déjà pris" : "", ...(S.compact ? [] : e.recettes)].filter(Boolean).join(" · ");
  const ligne = e => `<div class="it ${coches[e.cle] ? "fait" : ""}" data-k="${esc(e.cle)}" ${e.ajout ? `data-ajout="${esc(e.nom)}"` : ""}>
      <button class="cb" data-coche="${esc(e.cle)}" aria-label="${coches[e.cle] ? "Pas encore pris" : "Pris"}">${coches[e.cle] ? icone("check") : ""}</button>
      ${imgIng(e.nom, 18)}<span class="w" ${e.ajout ? `data-art-fiche="${esc(e.nom)}"` : ""}><span class="nm">${esc(e.nom)}</span>${sousNom(e) ? `<span class="for">${esc(sousNom(e))}</span>` : ""}</span>
      <span class="q num">${esc(fmtQty(reste(e), e.unite))}</span>
      ${e.ajout && !e.enBanque ? `<button class="ib" data-art-banque="${esc(e.nom)}" aria-label="Ajouter à la banque">${icone("carrot")}</button>` : ""}
      ${e.ajout ? `<button class="ib" data-retirer-art="${esc(e.nom)}" aria-label="Retirer">${icone("x")}</button>` : ""}
      ${!e.ajout ? `<button class="ib souris" data-masquer="${esc(e.cle)}" aria-label="Retirer de cette liste">${icone("x")}</button>` : ""}
      ${e.placard && !e.ajout ? `<button class="ib" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui" aria-label="Finalement je l'ai (remettre au placard)">${icone("box")}</button>` : ""}</div>`;
  // Une ligne : coche = je l'ai (la ligne disparaît), panier = il me faut (rejoint son rayon)
  const lignePlacard = e => `<div class="pl" data-k="${esc(e.cle)}">${imgIng(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${e.recettes.length && !S.compact ? `<span class="for">${esc(e.recettes.join(" · "))}</span>` : ""}</span><span class="q num">${esc(fmtQty(e.qte, e.unite))}</span>
      <button class="ib" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui" aria-label="Je l'ai">${icone("check")}</button>
      <button class="ib" data-act="dispo" data-cle="${esc(e.cle)}" data-v="non" aria-label="Il me faut">${icone("cart")}</button></div>`;
  const tri = l => l.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const cp = S.compact ? " compact" : "";
  let html = "";
  AISLE_ORDER.filter(a => groupes[a]).forEach(a => {
    html += `<div class="rayon${cp}"><h3>${aisleLabel(a)}</h3>${tri(groupes[a]).map(ligne).join("")}</div>`;
  });
  // Ce que j'ai peut-être déjà : replié en bas. Pour chacun : « je l'ai » ou « il me faut ».
  const aVerifier = placard.filter(e => !dispo[e.cle]), dejaLa = placard.length - aVerifier.length;
  if (aVerifier.length) html += `<details class="rayon placard${cp}" ${S.placardOuvert ? "open" : ""}><summary>${icone("right")}Peut-être au placard (${aVerifier.length})</summary>${tri(aVerifier).map(lignePlacard).join("")}</details>`;
  if (dejaLa) html += `<button class="lien-btn remettre" data-act="placard-remettre">${icone("refresh")}${dejaLa} déjà au placard · remettre</button>`;
  if (panier.length) html += `<details class="rayon placard panier${cp}" ${S.panierOuvert ? "open" : ""}><summary>${icone("right")}Dans le panier (${panier.length})</summary>${tri(panier).map(ligne).join("")}</details>`;
  if (nbMasques) html += `<button class="lien-btn remettre" data-act="remettre-masques">${icone("refresh")}${nbMasques} ingrédient${nbMasques > 1 ? "s" : ""} retiré${nbMasques > 1 ? "s" : ""} · remettre</button>`;
  zl().innerHTML = ajout + (html || `<div class="vide">Liste vide.<br>Ajoute des articles ci-dessus, ou des plats depuis l'onglet Menu.</div>`);
  finir();
}

// « Je l'ai » / « Il me faut » pour un article du placard (valable pour cette liste seulement ; retoucher le même choix l'annule)
function definirDispo(cle, v) {
  const m = menuEnCours(); if (!m) return;
  m.dispo = m.dispo || {};
  const avant = m.dispo[cle];
  if (avant === v) delete m.dispo[cle]; else m.dispo[cle] = v;
  ecrireMenu(m); renderCourses();
  if (m.dispo[cle] === "oui") { toast("Au placard", () => { const mm = actuel(m); mm.dispo = mm.dispo || {}; if (avant) mm.dispo[cle] = avant; else delete mm.dispo[cle]; ecrireMenu(mm); renderCourses(); }); }
}
// Menu « ⋯ » des Courses : Parcourir, Nouvelle liste, Précédente
function menuCourses(btn) {
  if ($("#menu-long")) return;   // déjà ouvert : ce clic le referme
  const b = btn.getBoundingClientRect(), m = document.createElement("div");
  m.id = "menu-long"; m.className = "menu-tri menu-long";
  m.innerHTML = `<button data-act="parcourir">${icone("grid")}<span>Parcourir</span></button><button data-act="nouvelle-liste">${icone("file-plus")}<span>Nouvelle liste</span></button>`
    + (listeArchive() ? `<button data-act="archive">${icone("history")}<span>Liste précédente</span></button>` : "")
    + `<button data-act="banque">${icone("carrot")}<span>Banque d'ingrédients</span></button>`;   // sur le tel, seul autre accès : appui long sur l'onglet Recettes
  document.body.appendChild(m);
  m.style.left = Math.max(8, b.right - m.offsetWidth) + "px"; m.style.top = (b.bottom + 6) + "px";
  vibrer("pas");
}

// Sous le champ d'ajout : les articles de la banque qui correspondent à ce qu'on tape.
// On y touche pour ajouter, ce qui évite d'écrire deux fois le même article de deux façons.
function majSuggArt() {
  const box = $("#sugg-art"), champ = $("#ajout-art");
  if (!box || !champ) return;
  const v = champ.value.trim(), q = norm(v);
  if (!q) { box.innerHTML = ""; return; }
  const m = menuEnCours(), deja = new Set(((m && m.ajouts) || []).map(cleBanque));
  const tous = banque();
  const l = tous.filter(e => correspond(e, q) && !deja.has(e.cle))
    .sort((a, b) => (norm(a.court).startsWith(q) ? 0 : 1) - (norm(b.court).startsWith(q) ? 0 : 1) || b.recettes.length - a.recettes.length || parNom(a, b)).slice(0, 8);
  const existe = tous.some(e => e.cle === cleBanque(v));
  // Liste déroulante par-dessus la liste : icône + nom ; en bas, l'article tapé tel quel (liste seule, ou + banque)
  box.innerHTML = l.map(e => `<button class="dr" data-sugg="${esc(e.cle)}">${ingImg(e.nom, 20, e.icone, e.mc, e.menage)}<span class="nm">${esc(e.nom)}</span>${e.menage ? "<small>ménager</small>" : ""}</button>`).join("")
    + (existe ? "" : `<div class="dr nouv"><button class="dr-l" data-act="ajouter-art">${icone("plus")}<span class="nm">« ${esc(v)} »</span></button><button class="dr-b" data-act="art-banque">${icone("carrot")}+ Banque</button></div>`);
}
const fermerSuggArt = () => { const b = $("#sugg-art"); if (b) b.innerHTML = ""; };

// Cocher : la case se remplit avec un rebond, le nom se barre, puis l'article part dans « Dans le panier »
let cocheT;
function cocher(cle, btn) {
  const m = menuEnCours(); if (!m) return;
  m.coches = m.coches || {};
  // Cocher retient la quantité affichée en ce moment ; décocher une ligne entièrement prise l'efface
  const e = articles(m).find(x => x.cle === cle);
  if (!e) delete m.coches[cle];
  else if (estPris(m, e)) delete m.coches[cle];
  else m.coches[cle] = marque(e);
  const fait = !!m.coches[cle];
  vibrer(fait ? "coche" : "decoche");
  ecrireMenu(m);
  const ligne = btn && btn.closest(".it");
  if (!ligne || !animOK()) return renderCourses();
  ligne.classList.toggle("fait", fait);
  btn.innerHTML = fait ? icone("check") : "";
  btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
  clearTimeout(cocheT);
  cocheT = setTimeout(() => flip(zid() + " .it", renderCourses), 480);  // on laisse voir la coche avant de ranger
}
// Ajoute un article à la liste en cours. Un article connu de la banque garde son nom d'origine.
// Un article inconnu ne va dans la banque que si on le demande (versBanque).
function ajouterALaListe(texte, menage = false, versBanque = false) {
  const v = texte.trim(); if (!v) return;
  const it = parseItem(v), avecQte = !!it && it.name !== v;  // « 2 L lait » : la quantité reste dans la liste, pas dans la banque
  const cle = cleBanque(v), connu = banque().find(e => e.cle === cle);
  let nom = v;
  if (connu && !avecQte) nom = connu.nom;
  const m = listeEnCours();
  m.ajouts = m.ajouts || [];
  if (!m.ajouts.some(a => cleBanque(a) === cleBanque(nom))) m.ajouts.push(nom);
  ecrireMenu(m);
  return !connu && versBanque ? versLaBanque(nom, menage) : null;
}
// Article ajouté à la main → banque (avec le rayon choisi pour la liste, s'il y en a un). Renvoie sa clé.
function versLaBanque(nom, menage = false) {
  const it = parseItem(nom), court = it && it.name ? it.name : nom.trim();
  const m = menuEnCours(), r = m && (m.rayonsAjouts || {})[cleAjout(nom)];
  ajouterBanque(court, menage, r && rayonsDe(menage).includes(r) ? r : "");
  if (m && r) { delete m.rayonsAjouts[cleAjout(nom)]; ecrireMenu(m); }  // la banque prend le relais
  toast("Ajouté à la banque");
  return cleBanque(court);
}
function ajouterArticle(versBanque = false) {
  const champ = $("#ajout-art"), v = champ.value.trim();
  if (!v) return champ.focus();
  const nouveau = ajouterALaListe(v, false, versBanque); vibrer("ajout");
  champ.value = ""; flip(zid() + " .it", renderCourses);
  if (nouveau) return ouvrirFicheBanque(nouveau);  // on règle tout de suite rayon, icône, ménager…
  $("#ajout-art").focus(); // on peut enchaîner les ajouts au clavier
}
// Toucher un article ajouté à la main : petite fiche pour le ranger dans un rayon (cette liste seulement)
function ouvrirArtFiche(nom) {
  const m = menuEnCours(); if (!m) return;
  const e = articles(m).find(x => x.ajout && x.nom === nom); if (!e) return;
  const md = $("#modal");
  fermer(); md.dataset.art = nom;
  const rayons = [...AISLES_FOOD, "perso", ...RAYONS_MENAGE.map(r => r[0])];
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(nom)}">
    <div class="fi-hd">${imgIng(nom, 28)}<div class="txt"><h2>${esc(nom)}</h2><div class="sub">Rayon pour cette liste</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="pastilles">${rayons.map(r => `<button class="chip ${r === e.rayon ? "on" : ""}" data-art-rayon="${r}">${esc(libelleRayon(r))}</button>`).join("")}</div>
    ${e.enBanque ? "" : `<div class="pied2"><button class="btn pri" data-art-banque="${esc(nom)}">${icone("carrot")}Ajouter à la banque</button></div>`}</div></div>`;
}
function rangerArt(rayon) {
  const m = menuEnCours(), nom = $("#modal").dataset.art; if (!m || !nom) return;
  m.rayonsAjouts = Object.assign({}, m.rayonsAjouts);
  m.rayonsAjouts[cleAjout(nom)] = rayon;
  ecrireMenu(m); fermer(); vibrer("ajout"); flip(zid() + " .it", renderCourses);
}
// Retirer un ingrédient venu d'une recette (glissement) : il est caché de cette liste, « remettre » le fait revenir
function masquer(cle) {
  const m = menuEnCours(); if (!m) return;
  // On retient la quantité : si un plat ajouté plus tard en redemande, l'ingrédient revient
  const e = articles(m).find(x => x.cle === cle);
  m.masques = Object.assign({}, m.masques, { [cle]: e ? marque(e) : true });
  vibrer("retire"); ecrireMenu(m); renderCourses();
  toast("Ingrédient retiré", () => { const mm = actuel(m); mm.masques = Object.assign({}, mm.masques); delete mm.masques[cle]; ecrireMenu(mm); flip(zid() + " .it", renderCourses); });
}
function remettreMasques() {
  const m = menuEnCours(); if (!m) return;
  m.masques = {}; vibrer("ajout"); ecrireMenu(m); flip(zid() + " .it", renderCourses);
}
function retirerArticle(nom) {
  const m = menuEnCours(); if (!m) return;
  const i = (m.ajouts || []).indexOf(nom); if (i < 0) return;
  m.ajouts.splice(i, 1); vibrer("retire");
  ecrireMenu(m); renderCourses();
  toast("Article retiré", () => { const mm = actuel(m); mm.ajouts = mm.ajouts || []; if (!mm.ajouts.includes(nom)) mm.ajouts.splice(Math.min(i, mm.ajouts.length), 0, nom); ecrireMenu(mm); renderCourses(); });
}

/* ---------- 4 ter bis. Nouvelle liste et liste précédente ---------- */
// « Nouvelle liste » : la liste en cours devient la « Liste précédente » (l'ancienne archive est effacée),
// et une liste vide commence. Avant, on demande ce qu'on garde : les plats pas encore cuisinés,
// les articles ajoutés pas encore cochés, et les articles récurrents de la banque (tout est coché au départ).
function nouvelleListe() {
  const m = menuEnCours(), coches = (m && m.coches) || {};
  const plats = m ? m.repas.map((x, i) => ({ x, i, r: recette(x.id) })).filter(o => !o.x.fait && o.r) : [];
  const restants = m ? (m.ajouts || []).filter(a => !coches[cleAjout(a)]) : [];
  const rec = banque().filter(e => e.rec && !restants.some(a => cleBanque(a) === e.cle));
  if (!plats.length && !restants.length && !rec.length) return creerNouvelleListe([], [], []);
  const md = $("#modal");
  ["recette", "form", "rep", "choix"].forEach(k => delete md.dataset[k]);
  const ligne = (type, v, img, nom, extra = "") => `<button class="rc on" data-rc data-type="${type}" data-v="${esc(v)}"><span class="cb">${icone("check")}</span>${img}<span class="nm">${esc(nom)}</span>${extra}</button>`;
  const bloc = (titre, l) => l.length ? `<div class="sect">${titre}</div><div>${l.join("")}</div>` : "";
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Nouvelle liste">
    <div class="fi-hd"><div class="txt"><h2>Nouvelle liste</h2><div class="sub">Je garde ce qui n'était pas coché ?</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="rc-l">
      ${bloc("Plats pas encore cuisinés", plats.map(o => ligne("plat", o.i, dishImg(o.r, 22), o.r.nom)))}
      ${bloc("Articles pas encore pris", restants.map(a => ligne("art", a, imgIng(a, 18), a)))}
      ${bloc("Articles récurrents", rec.map(e => ligne("art", e.nom, ingImg(e.nom, 18, e.icone, e.mc, e.menage), e.nom, e.menage ? `<span class="t">Ménager</span>` : "")))}
    </div>
    <div class="infos">L'ancienne liste reste dans « Précédente ».</div>
    <div class="pied2"><button class="btn" data-act="liste-zero">Partir de zéro</button><button class="btn pri" data-act="liste-garder">${icone("check")}Nouvelle liste</button></div>
  </div></div>`;
}
// Après la question : ce qui est encore coché passe dans la nouvelle liste
function nouvelleListeChoix(garder) {
  const pris = garder ? [...document.querySelectorAll(".rc.on")] : [];
  const m = menuEnCours();
  const plats = pris.filter(b => b.dataset.type === "plat").map(b => m.repas[+b.dataset.v]).filter(Boolean);
  const arts = pris.filter(b => b.dataset.type === "art").map(b => b.dataset.v);
  fermer();
  creerNouvelleListe(plats, arts);
}
function creerNouvelleListe(plats, arts) {
  const avant = menuEnCours(), nv = creerListe();
  nv.repas = plats.map(repasListe);
  arts.forEach(a => { if (!nv.ajouts.some(x => cleBanque(x) === cleBanque(a))) nv.ajouts.push(a); });
  // Un ingrédient d'un plat gardé, déjà pris dans l'ancienne liste, reste coché
  // (avec sa quantité déjà prise)
  if (avant) articles(nv).forEach(e => { const v = (avant.coches || {})[e.cle]; if (v) nv.coches[e.cle] = v; });
  // On ne garde que la liste précédente : les plus anciennes sont effacées (leurs plats restent dans l'historique du tirage)
  const aEffacer = avant ? S.menus.filter(x => x !== avant) : [], histoAvant = S.histo;
  if (aEffacer.length) S.histo = [...S.histo, ...aEffacer.map(x => x.repas.map(y => y.id))].slice(-2);
  S.menus = [...(avant ? [avant] : []), nv];
  aEffacer.forEach(x => effacerMenu(x.id));
  if (aEffacer.length) sauverHisto();
  ecrireMenu(nv); vibrer("gros");
  render(); window.scrollTo(0, 0);
  if (animOK()) document.querySelectorAll(zid() + " .it").forEach((el, k) => el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: k * 25, easing: DOUX, fill: "backwards" }));
  toast("Nouvelle liste", () => {
    S.menus = [...aEffacer, ...S.menus.filter(x => x !== nv)].sort((a, b) => a.cree - b.cree);
    effacerMenu(nv.id); aEffacer.forEach(ecrireMenu);
    S.histo = histoAvant; sauverHisto(); render();
  });
}

// « Précédente » : l'ancienne liste, pour la consulter, y reprendre un article (toucher) ou la remettre en cours
function ouvrirArchive() {
  const a = listeArchive();
  if (!a) return toast("Pas encore de liste précédente");
  const md = $("#modal");
  ["recette", "form", "rep", "choix"].forEach(k => delete md.dataset[k]);
  md.dataset.archive = "1";
  const m = menuEnCours(), deja = new Set(m ? articles(m).filter(e => !estPris(m, e)).map(e => cleBanque(e.nom)) : []);
  // Banque calculée une seule fois (et pas une fois par ligne)
  const menagers = new Set(banque().filter(b => b.menage).map(b => b.cle));
  const l = articles(a).sort((x, y) => AISLE_ORDER.indexOf(x.rayon) - AISLE_ORDER.indexOf(y.rayon) || x.nom.localeCompare(y.nom, "fr"));
  const plats = a.repas.map(x => recette(x.id)).filter(Boolean);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Liste précédente">
    <div class="fi-hd"><div class="txt"><h2>Liste précédente</h2><div class="sub">du ${new Date(a.cree).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · touche un article pour le reprendre</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${plats.length ? `<div class="tg">${plats.map(r => `<span class="t">${esc(r.nom)}</span>`).join("")}</div>` : ""}
    <div class="rc-l">${l.map(e => {
      const txt = e.qte != null ? (fmtQty(e.qte, e.unite) + " " + e.nom) : e.nom, dedans = deja.has(cleBanque(e.nom));
      return `<button class="rc arch ${dedans ? "on" : ""}" data-repris="${esc(txt)}" data-menage="${menagers.has(cleBanque(e.nom)) ? 1 : ""}">
        <span class="cb">${icone("check")}</span>${imgIng(e.nom, 18)}<span class="nm ${estPris(a, e) ? "barre" : ""}">${esc(e.nom)}</span><span class="q num">${esc(fmtQty(e.qte, e.unite))}</span></button>`;
    }).join("") || `<div class="vide">Elle était vide.</div>`}</div>
    <div class="pied2"><button class="btn" data-act="fermer">Fermer</button><button class="btn pri" data-act="restaurer">${icone("history")}Remettre cette liste</button></div>
  </div></div>`;
}
// Reprendre un article de la liste précédente dans la liste en cours (retoucher l'enlève)
function reprendre(btn) {
  const txt = btn.dataset.repris, m = listeEnCours();
  const i = m.ajouts.findIndex(a => cleBanque(a) === cleBanque(txt));
  if (btn.classList.contains("on") && i >= 0) { m.ajouts.splice(i, 1); ecrireMenu(m); btn.classList.remove("on"); vibrer("decoche"); }
  else if (!btn.classList.contains("on")) { ajouterALaListe(txt, !!btn.dataset.menage); btn.classList.add("on"); vibrer("ajout"); }
  else return toast("Déjà dans la liste en cours (vient d'un plat)");
  render();
}
// La liste précédente redevient celle en cours, et inversement
function restaurerArchive() {
  const a = listeArchive(), m = menuEnCours(); if (!a || !m) return;
  const echange = () => { [a.cree, m.cree] = [m.cree, a.cree]; S.menus.sort((x, y) => x.cree - y.cree); ecrireMenu(a); ecrireMenu(m); render(); };
  echange(); fermer(); vibrer("gros");
  toast("Liste précédente remise en cours", echange);
}

/* ---------- 4 quater. Banque d'ingrédients ---------- */
// Une seule fiche par ingrédient, quelle que soit la façon de l'écrire (« tomate », « 2 tomates »…).
// La banque réunit : 1) tous les ingrédients des recettes (automatique), 2) ce que j'y ai ajouté à la main
// (depuis la banque ou la liste de courses), dont les produits ménagers.
// Dans S.banque, on ne garde que ce qui est noté à la main : { nom, cle, menage, rec, rayon?, icone? }
//   menage : produit ménager   rec : « récurrent » (proposé à chaque nouvelle liste)
//   rayon : rayon choisi (sinon deviné d'après le nom)   icone : dessin choisi (sinon deviné)
//   placard : « souvent déjà au placard » (vrai / faux choisi à la main, sinon deviné d'après le nom)

const cleBanque = nom => { const it = parseItem(nom); return it && it.key ? it.key : norm(nom); };
// Clé d'une entrée enregistrée. Si elle date d'avant 0.9.4 (ancienne façon de mettre au singulier,
// ex. « pâtes » rangé comme « pâte »), on la recalcule pour qu'elle retrouve son ingrédient.
const cleStockee = b => { if (!b.cle) return cleBanque(b.nom); const it = parseItem(b.nom), n = it && it.name ? it.name : b.nom; return b.cle === keyOfAncien(n) ? cleBanque(b.nom) : b.cle; };
// Une entrée correspond à ce qui est tapé (q = texte déjà normalisé) : même au pluriel, « tomates » trouve « tomate »
const correspond = (e, q) => norm(e.nom).includes(q) || e.cle.includes(keyOf(q));
const rayonAuto = (nom, menage) => menage ? rayonMenage(nom) : aisleOf(nom);
const rayonsDe = menage => menage ? RAYONS_MENAGE.map(r => r[0]) : AISLES_FOOD;
const libelleRayon = id => { const m = RAYONS_MENAGE.find(r => r[0] === id); return m ? m[1] : aisleLabel(id); };
const entreeDe = cle => S.banque.find(x => cleStockee(x) === cle);
// Dessin d'un ingrédient (celui choisi dans la banque, sinon deviné d'après le nom)
const imgIng = (nom0, px = 18) => { const nom = ingPourIcone(nom0); const b = entreeDe(cleBanque(nom)); return ingImg(nom, px, b && b.icone, b && b.mc, b && b.menage); };

function banque() {
  const auto = new Map();
  S.recettes.forEach(r => ingsSeuls(r).flatMap(t => alternatives(t) || [sansOpt(t)]).forEach(txt => {
    if (nomCrochets(txt)) return;  // une base : ce n'est pas un ingrédient
    const it = parseItem(txt); if (!it || !it.name) return;
    const e = auto.get(it.key) || { noms: {}, recettes: [] };
    e.noms[it.name] = (e.noms[it.name] || 0) + 1;
    if (!e.recettes.some(x => x.id === r.id)) e.recettes.push(r);
    auto.set(it.key, e);
  }));
  const out = new Map();
  auto.forEach((e, cle) => {
    const nom = Object.keys(e.noms).sort((a, b) => e.noms[b] - e.noms[a] || a.localeCompare(b, "fr"))[0];  // l'écriture la plus courante
    out.set(cle, { cle, nom, menage: false, rec: false, recettes: e.recettes.sort(parNom) });
  });
  S.banque.forEach(b => {
    const cle = cleStockee(b), e = out.get(cle) || { cle, recettes: [] };
    Object.assign(e, { nom: b.nom || e.nom, menage: !!b.menage, rec: !!b.rec, rayon: b.rayon, icone: b.icone, mc: b.mc, pl: b.placard });
    out.set(cle, e);
  });
  out.forEach(e => {
    const it = parseItem(e.nom); e.court = it && it.name ? it.name : e.nom;  // sans la quantité
    if (!rayonsDe(e.menage).includes(e.rayon)) e.rayon = rayonAuto(e.court, e.menage);
    e.placard = typeof e.pl === "boolean" ? e.pl : auPlacard(e.court);  // choix à la main, sinon deviné d'après le nom
    delete e.pl;
  });
  return [...out.values()].sort(parNom);
}

// Nouvelle entrée à la main (si elle existe déjà, on ne fait rien et on la renvoie)
function ajouterBanque(texte, menage = false, rayon = "") {
  const nom = texte.trim(), cle = cleBanque(nom);
  const ex = banque().find(e => e.cle === cle);
  if (ex) return ex;
  const b = { nom, cle, menage: !!menage, rec: false };
  if (rayon) b.rayon = rayon;
  S.banque.push(b);
  sauverBanque();
  return banque().find(e => e.cle === cle);
}
// Change des réglages d'une entrée (rec, rayon, icone, placard). Elle est créée dans S.banque si elle ne venait que des recettes.
function majEntree(cle, chg) {
  const e = banque().find(x => x.cle === cle); if (!e) return;
  let b = entreeDe(cle);
  if (!b) { b = { nom: e.nom, cle, menage: e.menage, rec: false }; S.banque.push(b); }
  Object.assign(b, chg);
  ["rayon", "icone", "mc"].forEach(k => { if (!b[k]) delete b[k]; });
  // rien de particulier et déjà dans une recette : l'entrée à la main ne sert plus à rien
  if (!b.rec && !b.menage && !b.rayon && !b.icone && !b.mc && !b.nomFixe && typeof b.placard !== "boolean" && e.recettes.length) S.banque = S.banque.filter(x => x !== b);
  sauverBanque();
}
// v0.18.0 : des valeurs renommées (« Poêlée » → « Poêle & casserole », saison « Annuel » → « Aucune »), réécrites une fois dans toutes les recettes
const TAGS_RENOMMES = { poelee: "Poêle & casserole", annuel: "Aucune" };
// v0.20.0 : catégories renommées ou fusionnées
const CATS_RENOMMEES = { mezze: "Mezzé / Apéro", principal: "Principal seul", "sandwichs et burgers": "Plat complet", "sauces et marinades": "Bases (sous-recettes)", base: "Bases (sous-recettes)" };
function migrerTags() {
  const chg = S.recettes.filter(r => {
    let c = false;
    const nc = r.categorie && CATS_RENOMMEES[norm(r.categorie)];
    if (nc && r.categorie !== nc) { r.categorie = nc; c = true; }
    if ("proteine" in r) { delete r.proteine; c = true; }  // le tag Protéine n'existe plus
    ["categorie", "preparation", "origine", "saison"].forEach(k => { const n = r[k] && TAGS_RENOMMES[norm(r[k])]; if (n && r[k] !== n) { r[k] = n; c = true; } });
    return c;
  });
  if (chg.length) ecrireRecettes(chg);
}
// Un ancien « Toujours dans la liste » devient des articles récurrents de la banque (une seule fois)
function migrerToujours() {
  if (!S.toujours.length) return;
  S.toujours.forEach(a => {
    const cle = cleBanque(a), b = entreeDe(cle);
    if (b) b.rec = true; else S.banque.push({ nom: a, cle, menage: false, rec: true });
  });
  S.toujours = [];
  sauverBanque();
}

// Renommer : les recettes qui utilisent l'ingrédient sont réécrites (la quantité reste), pour que la banque et les recettes disent la même chose
function renommerIngredient(cle, saisie) {
  const e = banque().find(x => x.cle === cle); if (!e) return;
  const nom = saisie.trim();
  if (!nom || nom === e.nom) return majBanque();
  const it = parseItem(nom), court = it && it.name ? it.name : nom, nvCle = cleBanque(nom);
  if (nvCle !== cle && banque().some(x => x.cle === nvCle)) { toast("« " + court + " » existe déjà"); return majBanque(); }
  const sauve = JSON.parse(JSON.stringify(S.banque)), avant = [];
  S.recettes.forEach(r => {
    let change = false;
    const ings = (r.ingredients || []).map(t => {
      const i = parseItem(t); if (!i || i.key !== cle) return t;
      change = true; const tt = t.trimEnd();
      return tt.slice(0, tt.length - i.name.length) + court;
    });
    if (change) { avant.push({ r, ings: r.ingredients, src: r.ingredientsSource }); r.ingredients = ings; r.ingredientsSource = "app"; ecrireRecette(r); }
  });
  let b = entreeDe(cle);
  if (b) { b.nom = nom; b.cle = nvCle; }
  else if (rayonAuto(court, e.menage) !== e.rayon) { S.banque.push({ nom, cle: nvCle, menage: e.menage, rec: false, rayon: e.rayon }); }  // on garde le rayon d'avant
  sauverBanque();
  S.bq.detail = nvCle; majBanque();
  toast(avant.length ? `Renommé dans ${avant.length} recette${avant.length > 1 ? "s" : ""}` : "Renommé", () => {
    avant.forEach(a => { a.r.ingredients = a.ings; if (a.src) a.r.ingredientsSource = a.src; else delete a.r.ingredientsSource; ecrireRecette(a.r); });
    S.banque = sauve; sauverBanque(); S.bq.detail = cle; majBanque();
  });
}
// Supprimer : retire l'ingrédient de la banque et de toutes les recettes qui l'utilisent (avec « Annuler »)
function supprimerIngredient(cle) {
  const e = banque().find(x => x.cle === cle); if (!e) return;
  const sauve = JSON.parse(JSON.stringify(S.banque)), avant = [];
  S.recettes.forEach(r => {
    const ings = (r.ingredients || []).filter(t => { const i = parseItem(t); return !(i && i.key === cle); });
    if (ings.length !== (r.ingredients || []).length) { avant.push({ r, ings: r.ingredients, src: r.ingredientsSource }); r.ingredients = ings; r.ingredientsSource = "app"; ecrireRecette(r); }
  });
  S.banque = S.banque.filter(x => cleStockee(x) !== cle);
  sauverBanque();
  fermer();
  toast("« " + e.court + " » supprimé", () => {
    avant.forEach(a => { a.r.ingredients = a.ings; if (a.src) a.r.ingredientsSource = a.src; else delete a.r.ingredientsSource; ecrireRecette(a.r); });
    S.banque = sauve; sauverBanque(); majBanque();
  });
}

// La banque est une vraie fenêtre (plein écran), pas un pop-up : liste par rayon sur 2 colonnes.
// Deux façons de l'ouvrir :
//   - Recettes › « Ingrédients » : toucher un ingrédient ouvre sa fiche (nom, rayon, icône, recettes, supprimer) ;
//   - Courses › « Parcourir » (choisir = vrai) : toucher un article l'ajoute à la liste (retoucher l'enlève).
function ouvrirBanque(choisir = false) {
  fermer();
  fermerBanque();
  S.bq.detail = null; S.bq.suppr = null; S.bq.ouvert = true; S.bq.choisir = choisir;
  const ec = document.createElement("div");
  ec.id = "bq-ecran"; ec.className = "bq-ecran";
  ec.innerHTML = `<div class="bq-in">
    <div class="bq-hd"><button class="ib" data-act="bq-retour" aria-label="Retour">${icone("left")}</button><h2 id="bq-titre">Banque d'ingrédients</h2>
      ${choisir ? `<span class="spacer"></span><button class="btn pri" data-act="bq-retour">${icone("check")}OK</button>` : ""}</div>
    <div class="bq-barre" id="bq-barre">
      <div class="srow" style="margin:0"><label class="cherche">${icone("search")}<input id="q-bq" placeholder="${choisir ? "Chercher ou ajouter…" : "Chercher…"}" autocomplete="off" enterkeyhint="done"></label>
        <button class="fab" data-act="ajouter-banque" aria-label="Ajouter à la banque">${icone("plus")}</button></div>
      <div id="bq-onglets"></div></div>
    <div class="bq-corps" id="bq-corps"></div></div>`;
  document.body.appendChild(ec);
  majBanque();
  renderCote();
}
function fermerBanque() {
  const ec = $("#bq-ecran"); if (ec) ec.remove();
  S.bq.ouvert = false; S.bq.detail = null;
  renderCote();
}
// Fiche d'un article qu'on vient d'ajouter. seule = ouverte depuis les Courses : Retour referme tout.
function ouvrirFicheBanque(cle) {
  S.bq.suppr = null; S.bq.detail = cle;
  majFicheIng();
}
function retourBanque() { fermerBanque(); render(); }

// Redessine la liste de la banque (si elle est ouverte) et la fiche ouverte par-dessus
function majBanque() {
  const ec = $("#bq-ecran");
  if (ec) {
    const corps = $("#bq-corps"), haut = corps.scrollTop;
    $("#bq-titre").textContent = S.bq.choisir ? "Ajouter à la liste" : "Banque d'ingrédients";
    corps.innerHTML = htmlListeBanque(banque());
    corps.scrollTop = haut;
  }
  if (S.bq.detail) majFicheIng();
}

function htmlListeBanque(tous) {
  const men = S.bq.onglet === "menage", q = norm(($("#q-bq") || {}).value || "");
  $("#bq-onglets").innerHTML = `<div class="seg bq-seg">
      <button class="${men ? "" : "on"}" data-act="bq-onglet" data-v="ing">Ingrédients</button>
      <button class="${men ? "on" : ""}" data-act="bq-onglet" data-v="menage">Produits ménagers</button></div>
    <div class="defile" style="margin:0;padding:0"><button class="chip ${S.bq.rec ? "on" : ""}" data-act="bq-rec">${icone("refresh")}Récurrents</button><button class="chip ${S.bq.placard ? "on" : ""}" data-act="bq-placard">${icone("box")}Placard</button></div>`;
  const liste = tous.filter(e => e.menage === men && (!q || correspond(e, q)) && (!S.bq.rec || e.rec) && (!S.bq.placard || e.placard));
  const m = menuEnCours(), dansListe = new Set(((m && m.ajouts) || []).map(cleBanque));
  let html = "";
  if (S.bq.choisir && dansListe.size && !q) html += `<div class="infos" style="margin-top:6px">${dansListe.size} article${dansListe.size > 1 ? "s" : ""} ajouté${dansListe.size > 1 ? "s" : ""} à la main dans la liste</div>`;
  rayonsDe(men).forEach(r => {
    const l = liste.filter(e => e.rayon === r); if (!l.length) return;
    html += `<div class="rayon"><h3>${esc(libelleRayon(r))}</h3><div class="bq-grid">${l.map(e => S.bq.choisir
      ? `<button class="bq-t pick ${dansListe.has(e.cle) ? "on" : ""}" data-bq-pick="${esc(e.cle)}" aria-pressed="${dansListe.has(e.cle)}">${ingImg(e.nom, 18, e.icone, e.mc, e.menage)}<span class="nm">${esc(e.nom)}</span><span class="cb">${icone("check")}</span></button>`
      : `<button class="bq-t" data-bq-ouvrir="${esc(e.cle)}">${ingImg(e.nom, 18, e.icone, e.mc, e.menage)}<span class="nm">${esc(e.nom)}</span>${dansListe.has(e.cle) ? icone("cart", "rec") : ""}${e.placard ? icone("box", "rec") : ""}${e.rec ? icone("refresh", "rec") : ""}</button>`).join("")}</div></div>`;
  });
  if (!html) html = `<div class="vide" style="padding:28px 8px">${q ? "Rien ne correspond. Touche + pour l'ajouter." : S.bq.rec ? "Aucun article récurrent." : S.bq.placard ? "Rien au placard." : "Rien ici pour l'instant."}</div>`;
  return html;
}

// Fiche d'un ingrédient : pop-up (au-dessus de la banque, ou des Courses). Même allure que le formulaire recette :
// nom modifiable en haut, rayon en liste de l'appli, étiquettes Récurrent / Placard / Ménager, Supprimer dans « ⋯ ».
const dansLaListe = cle => { const m = menuEnCours(); return !!m && (m.ajouts || []).some(a => cleBanque(a) === cle); };
function majFicheIng() {
  const e = S.bq.detail && banque().find(x => x.cle === S.bq.detail);
  if (!e) { if (S.bq.detail) fermer(); return; }
  const actif = document.activeElement;
  if (actif && actif.id === "bq-nom" && $("#modal .bqf")) return;   // on ne redessine pas pendant qu'on écrit le nom
  const n = e.recettes.length, confirme = S.bq.suppr === e.cle, liste = dansLaListe(e.cle);
  const tags = [["bq-rec-fiche", "refresh", "Récurrent", e.rec, "rec"], e.menage ? null : ["bq-placard-fiche", "box", "Placard", e.placard, "placard"], n ? null : ["bq-menage-fiche", "drop", "Ménager", e.menage, "menage"]].filter(Boolean);
  const recettes = e.recettes.map(r => `<button class="ligne" data-fiche="${esc(r.id)}">${dishImg(r, 24)}<span class="nm">${esc(r.nom)}</span><span class="chev">${icone("right")}</span></button>`).join("");
  const md = $("#modal"), haut = md.querySelector(".fiche") ? md.querySelector(".fiche").scrollTop : 0;
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete md.dataset[k]);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche bqf" role="dialog" aria-label="${esc(e.court)}">
    <div class="bqf-hd"><button type="button" class="bqf-ic" data-act="bq-icones" aria-label="Changer l'icône">${ingImg(e.nom, 30, e.icone, e.mc, e.menage)}<span class="crayon">${icone("pen")}</span></button>
      <input id="bq-nom" value="${esc(e.nom)}" autocomplete="off" enterkeyhint="done" aria-label="Nom">
      <button type="button" class="ib" data-act="menu3" aria-label="Plus d'actions">${icone("more")}</button>
      <button type="button" class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="menu3" id="menu3" ${confirme ? "" : "hidden"}><button class="danger" data-act="bq-suppr">${icone("trash")}${confirme ? (n ? `Confirmer : retirer de ${n} recette${n > 1 ? "s" : ""}` : "Confirmer") : "Supprimer"}</button></div>
    ${ld("bq-rayon", { lib: "Rayon", teinte: "neutre", val: () => e.rayon, affiche: libelleRayon,
      items: () => rayonsDe(e.menage).map(r => ({ v: r, t: libelleRayon(r) })),
      choisir: v => { majEntree(e.cle, { rayon: v }); majBanque(); } })}
    <div class="fo-bsc">${tags.map(([act, ic, t, on, k]) => `<button type="button" class="bsc ${on ? "on" : ""}" data-act="${act}" data-teinte="${k}">${icone(ic)}${t}</button>`).join("")}</div>
    ${n ? `<div class="champ"><span class="lbl">Recettes</span><div class="bqf-rec">${recettes}</div></div>` : ""}
    <button type="button" class="btn ${liste ? "" : "pri"} bqf-liste" data-act="bq-liste">${icone(liste ? "x" : "cart")}${liste ? "Retirer de la liste" : "À la liste"}</button>
  </div></div>`;
  md.querySelector(".fiche").scrollTop = haut;
}
// Choix de l'icône : petite fenêtre par-dessus la fiche ; choisir la referme
function ouvrirIconesIng() {
  const e = banque().find(x => x.cle === S.bq.detail); if (!e) return;
  fermerIconesIng();
  // Style Minecraft : textures importées (champ « mc », indépendant de l'icône Foodix)
  const icones = brut(() => mcActif() ? htmlChoixTex("bq-mc", e.mc, ingImg(e.court, 24, e.icone, "", e.menage))
    : `<div class="bq-icones"><button type="button" class="bq-ic auto ${e.icone ? "" : "on"}" data-bq-icone="" aria-label="Automatique">${ingImg(e.court, 24)}<small>Auto</small></button>`
      + Object.keys(ICONES).map(k => `<button type="button" class="bq-ic ${e.icone === k ? "on" : ""}" data-bq-icone="${k}" aria-label="${ICONES[k]}">${ingImg(e.court, 24, k)}</button>`).join("") + `</div>`);
  const p = document.createElement("div");
  p.id = "ic-pop"; p.className = "voile ic-pop";
  p.innerHTML = `<div class="fiche" role="dialog" aria-label="Icône"><div class="fi-hd"><h2 class="titre-r" style="flex:1">Icône</h2><button class="btn" data-act="ing-atelier">${icone("sliders")}Atelier</button><button class="ib" data-act="ic-fermer" aria-label="Fermer">${icone("x")}</button></div>${icones}</div>`;
  document.body.appendChild(p);
}
function fermerIconesIng() { const p = $("#ic-pop"); if (p) p.remove(); }

// « + » de la banque (hors Parcourir) : petite fenêtre Nom / Type / Rayon (rayon vide = deviné d'après le nom)
let bqa = null;
function ouvrirAjoutBanque() {
  bqa = { menage: S.bq.onglet === "menage", rayon: "" };
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Nouvel article">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Nouvel article</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="champ"><label for="bqa-nom">Nom</label><input class="saisie" id="bqa-nom" value="${esc(($("#q-bq") || {}).value || "")}" autocomplete="off" enterkeyhint="done"></div>
    <div id="bqa-corps" style="display:flex;flex-direction:column;gap:12px"></div>
    <div class="pied2"><button class="btn" data-act="fermer">Annuler</button><button class="btn pri" data-act="bqa-ok">${icone("plus")}Ajouter</button></div></div></div>`;
  majAjoutBanque();
  const c = $("#bqa-nom"); c.focus(); c.setSelectionRange(c.value.length, c.value.length);
}
function majAjoutBanque() {
  $("#bqa-corps").innerHTML = `<div class="seg bq-seg"><button class="${bqa.menage ? "" : "on"}" data-act="bqa-type" data-v="">Ingrédient</button><button class="${bqa.menage ? "on" : ""}" data-act="bqa-type" data-v="1">Produit ménager</button></div>
    <div class="champ"><span class="lbl">Rayon</span><div class="pastilles"><button type="button" class="chip ${bqa.rayon ? "" : "on"}" data-act="bqa-rayon" data-v="">Auto</button>${rayonsDe(bqa.menage).map(r => `<button type="button" class="chip ${r === bqa.rayon ? "on" : ""}" data-act="bqa-rayon" data-v="${r}">${esc(libelleRayon(r))}</button>`).join("")}</div></div>`;
}
function validerAjoutBanque() {
  const v = $("#bqa-nom").value.trim();
  if (!v) return $("#bqa-nom").focus();
  const ex = banque().find(e => e.cle === cleBanque(v));
  fermer();
  if (ex) { S.bq.onglet = ex.menage ? "menage" : "ing"; return ouvrirFicheBanque(ex.cle), toast("Déjà dans la banque"); }
  const e = ajouterBanque(v, bqa.menage, bqa.rayon);
  S.bq.onglet = e.menage ? "menage" : "ing";
  const q = $("#q-bq"); if (q) q.value = "";
  majBanque(); vibrer("ajout");
  toast("Ajouté dans « " + libelleRayon(e.rayon) + " »");
}
// Appui long sur un article de la banque : il va dans la liste de courses en cours
// (déjà dans la liste : l'appui long l'en retire, avec « Annuler »)
function commanderBanque(el) {
  const e = banque().find(x => x.cle === el.dataset.bqOuvrir); if (e) basculerListe(e);
}
function basculerListe(e) {
  const m = listeEnCours(); m.ajouts = m.ajouts || [];
  const i = m.ajouts.findIndex(a => cleBanque(a) === e.cle);
  if (i >= 0) {
    const a = m.ajouts.splice(i, 1)[0]; ecrireMenu(m); majBanque(); vibrer("decoche");
    return toast("« " + e.court + " » retiré de la liste", () => { const l = listeEnCours(); (l.ajouts = l.ajouts || []).push(a); ecrireMenu(l); majBanque(); });
  }
  ajouterALaListe(e.nom, e.menage); majBanque(); vibrer("ajout");
  toast("« " + e.court + " » dans la liste", () => { const l = listeEnCours(), j = l.ajouts.findIndex(a => cleBanque(a) === e.cle); if (j >= 0) { l.ajouts.splice(j, 1); ecrireMenu(l); } majBanque(); });
}

// Parcourir : « + » (ou Entrée) ajoute ce qui est tapé, sauf si l'article existe déjà : on le montre alors
function ajouterDepuisBanque() {
  if (!S.bq.choisir) return ouvrirAjoutBanque();
  const champ = $("#q-bq"), v = champ.value.trim();
  if (!v) return champ.focus();
  const ex = banque().find(e => e.cle === cleBanque(v));
  if (ex && S.bq.choisir) { ajouterALaListe(ex.nom, ex.menage); champ.value = ""; majBanque(); return toast("« " + ex.court + " » est dans la liste"); }
  if (ex) {
    S.bq.onglet = ex.menage ? "menage" : "ing"; champ.value = ex.court;
    majBanque(); return toast("Déjà dans la banque");
  }
  const e = ajouterBanque(v, S.bq.onglet === "menage");
  if (S.bq.choisir) ajouterALaListe(e.nom, e.menage);
  champ.value = ""; ouvrirFicheBanque(e.cle);
  toast((S.bq.choisir ? "Ajouté à la liste et dans « " : "Ajouté dans « ") + libelleRayon(e.rayon) + " »");
}
// Mode « Parcourir » : toucher un article l'ajoute à la liste en cours, retoucher l'enlève
function basculerPick(cle) {
  const e = banque().find(x => x.cle === cle); if (!e) return;
  const m = listeEnCours(), i = m.ajouts.findIndex(a => cleBanque(a) === cle);
  if (i >= 0) { m.ajouts.splice(i, 1); ecrireMenu(m); } else ajouterALaListe(e.nom, e.menage);
  vibrer(i >= 0 ? "decoche" : "ajout");
  majBanque();
}

/* ---------- 5. Écran Recettes ---------- */

// Les recettes qui passent la recherche et les filtres (plusieurs valeurs d'une famille : l'une OU l'autre ; familles entre elles : ET)
const saisonFiltre = r => /^ete$/.test(norm(r.saison)) ? "Été" : /^hiver$/.test(norm(r.saison)) ? "Hiver" : !r.saison || /^(aucune|annuel)$/.test(norm(r.saison)) ? "Toute l'année" : r.saison;
const FAMILLES_F = [
  ["cats", "Catégorie", "neutre", r => r.categorie || "Sans catégorie"],
  ["saisons", "Saison", "ambre", saisonFiltre],
  ["origines", "Origine", "bleu", r => r.origine],
  ["preps", "Préparation", "prune", r => r.preparation],
  ["prix", "Prix", "accent", r => r.prix],
  ["temps", "Temps", "accent", r => r.temps],
  ["diff", "Difficulté", "accent", r => r.difficulte],
];
const NIV_F = { prix: "prix", temps: "temps", diff: "difficulte" };
const nbFiltres = () => FAMILLES_F.reduce((n, [k]) => n + (S.f[k] || []).length, 0);
function filtrees() {
  const f = S.f, q = norm(f.q);
  return S.recettes.filter(r =>
    (!q || norm([r.nom, r.famille, r.origine, ingsSeuls(r).join(" ")].join(" ")).includes(q)) &&
    FAMILLES_F.every(([k, , , val]) => !(f[k] || []).length || f[k].includes(val(r))) &&
    (!f.fav || r.favori) && (!f.vege || r.vege) && (!f.saison || deSaison(r)) &&
    (!f.avance || r.prep) && (!f.invites || r.date)
  ).sort(parNom);
}

function renderRecettes() {
  if (!S.recettes.length) {
    $("#main").innerHTML = `<div class="vide">Aucune recette pour l’instant.<div class="pied2" style="justify-content:center;margin-top:14px">
      <button class="btn" data-act="reglages">Importer un fichier Excel</button><button class="btn pri" data-act="nouvelle">${icone("plus")}Ajouter</button></div>
      <div style="margin-top:10px"><button class="btn" data-act="banque">${icone("carrot")}Banque d'ingrédients</button></div></div>`;
    return;
  }
  const f = S.f, nf = nbFiltres();
  // Rangée sans défilement : tri, entonnoir des filtres, puis les 5 étiquettes en icônes (appui long = leur nom)
  const ico = (k, ic, nom) => `<button class="chip ico ${f[k] ? "on" : ""}" data-bascule="${k}" data-nom="${nom}" data-teinte="${k}" aria-label="${nom}" aria-pressed="${!!f[k]}">${icone(ic)}</button>`;
  const cherche = `<label class="cherche">${icone("search")}<input id="q" type="search" placeholder="Chercher…" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search">
      ${f.q ? `<button data-act="effacer-q" aria-label="Effacer">${icone("x")}</button>` : ""}</label>`;
  const barre = `<div class="barre-r">
      <button class="chip tri ${S.tri !== "categorie" ? "change" : ""}" data-act="trier" aria-label="Trier">${icone(TRIS[S.tri][1])}<b>${TRIS[S.tri][0]}</b>${S.tri !== "categorie" ? `<span class="tri-x" data-act="tri-reset" aria-label="Revenir au tri par catégorie">${icone("x")}</span>` : ""}</button>
      <button class="chip ico entonnoir ${nf ? "on" : ""}" data-act="filtres" aria-label="Filtres">${icone("entonnoir")}${nf ? `<b>${nf}</b>` : ""}</button>
      <span class="barre-sep"></span>
      ${ico("fav", "star", "Favoris")}${ico("vege", "leaf", "Végé")}${ico("saison", "sun", "De saison")}${ico("avance", "box", "Lunchbox")}${ico("invites", "glass", "Invités")}</div>`;
  $("#main").innerHTML = (estPC()
    ? `<div class="pc-tete"><h1>${f.cats.length === 1 ? esc(f.cats[0]) : "Recettes"}</h1>${cherche}<span class="spacer"></span>
      <button class="btn ${panneauOuvert ? "on" : ""}" data-act="panneau">${icone("cart")}Liste</button>
      <button class="btn pri" data-act="nouvelle" id="fab-r">${icone("plus")}Recette</button></div>`
    : `<div class="srow">${cherche}<button class="fab" data-act="nouvelle" id="fab-r" aria-label="Ajouter une recette">${icone("plus")}</button></div>`) + `
    ${barre}
    <div id="liste"></div>`;
  majListe();
}
// ---------- Tri, regroupement des variantes, catégories repliées (gardés sur l'appareil) ----------
const TRIS = { categorie: ["Catégorie", "rows"], nom: ["Nom", "grid"], recentes: ["Récentes", "history"], temps: ["Temps", "clock"], maitrise: ["Maîtrise", "check"] };
S.tri = TRIS[lireLocal("fx-tri", "categorie")] ? lireLocal("fx-tri", "categorie") : "categorie";
S.regroupe = lireLocal("fx-regroupe", "1") === "1";
S.replies = new Set((() => { try { return JSON.parse(lireLocal("fx-replies", "[]")); } catch (e) { return []; } })());
function choisirTri(v) {
  S.tri = TRIS[v] ? v : "categorie"; ecrireLocal("fx-tri", S.tri); vibrer("pas"); fermerTri(); renderRecettes();
}
function fermerTri() { const m = $("#menu-tri"); if (m) m.remove(); }
function ouvrirTri(btn) {
  if ($("#menu-tri")) return fermerTri();
  const b = btn.getBoundingClientRect(), m = document.createElement("div");
  m.id = "menu-tri"; m.className = "menu-tri";
  m.innerHTML = `<div class="mt-t">Trier par</div>${Object.entries(TRIS).map(([k, [nom, ic]]) => `<button class="${S.tri === k ? "on" : ""}" data-act="tri" data-v="${k}">${icone(ic)}${nom}</button>`).join("")}
    <button class="mt-sw ${S.regroupe ? "on" : ""}" data-act="regroupe">${icone("branche")}Regrouper les variantes<i></i></button>`;
  m.style.left = Math.max(8, b.left) + "px"; m.style.top = (b.bottom + 6) + "px";
  document.body.appendChild(m); vibrer("pas");
}
// Ordre des catégories : réglable (Réglages), sinon Principal seul, Plat complet, Accompagnement, Mezzé / Apéro, les autres, les bases
const ORDRE_CATS = ["Principal seul", "Plat complet", "Accompagnement", "Mezzé / Apéro"];
function ordreCategories() {
  const presentes = [...new Set(S.recettes.map(r => r.categorie || "Sans catégorie"))];
  const base = (S.prefs.ordreCats && S.prefs.ordreCats.length ? S.prefs.ordreCats : ORDRE_CATS);
  const reste = presentes.filter(c => !base.includes(c)).sort((a, b) => (/^bases?\b/.test(norm(a)) - /^bases?\b/.test(norm(b))) || a.localeCompare(b, "fr"));
  return [...base.filter(c => presentes.includes(c)), ...reste];
}
// Réglages › Ordre des catégories : on glisse les lignes
function ouvrirOrdreCats() {
  const l = ordreCategories();
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Ordre des catégories">
    <button class="retour" data-act="reglages">‹ Réglages</button>
    <h2 class="titre-r">Ordre des catégories</h2>
    <p class="sub">Glisse les catégories pour changer l'ordre de la liste des recettes.</p>
    <div class="oc-l" id="oc-l">${l.map(c => `<div class="oc" data-cat-o="${esc(c)}"><span class="poignee" aria-label="Déplacer">${icone("grip")}</span><span>${esc(c)}</span></div>`).join("")}</div>
    <button class="btn" data-act="ordre-defaut" style="align-self:flex-start">${icone("refresh")}Remettre l'ordre par défaut</button>
  </div></div>`;
  rendreTriable($("#oc-l"), ".oc", $("#modal .fiche"));
  $("#oc-l").addEventListener("pointerup", () => setTimeout(() => {
    S.prefs.ordreCats = [...document.querySelectorAll("#oc-l .oc")].map(x => x.dataset.catO); sauverPrefs(); vibrer("pas");
  }, 30));
}

// Redessine seulement la liste (pendant la frappe dans la recherche)
// Une famille = une seule ligne (« Burger · Bœuf, Végé, Poulet »), sur la 1re variante qui passe les filtres.
// Les bases (sous-recettes) sont rangées à part, en bas.
function majListe() {
  const l0 = filtrees();
  const vues = new Set(), l = S.regroupe ? l0.filter(r => { const k = cleFamille(r); if (vues.has(k)) return false; vues.add(k); return true; }) : l0;
  const nomDe = r => { const fam = S.regroupe ? familleDe(r) : [r]; return fam.length > 1 ? r.famille : r.nom; };
  const icones = r => { const fam = S.regroupe ? familleDe(r) : [r];
    return `${fam.some(x => x.favori) ? icone("star", "fav") : ""}${fam.some(x => x.vege) ? icone("leaf", "acc") : ""}${fam.some(x => x.prep) ? icone("box", "lb") : ""}${fam.some(x => x.date) ? icone("glass", "inv") : ""}`; };
  const attrs = r => { const fam = S.regroupe ? familleDe(r) : [r];
    return fam.length > 1 ? `data-famille="${esc(cleFamille(r))}" data-fiche="${esc(r.id)}"` : `data-fiche="${esc(r.id)}"`; };
  const ligne = r => {
    const fam = S.regroupe ? familleDe(r) : [r];
    return `<button class="ligne" ${attrs(r)} data-k="${esc(S.regroupe ? cleFamille(r) : r.id)}">${dishImg(r, 28)}
      <span class="nm">${esc(nomDe(r))}${fam.length > 1 ? `<small>${fam.map(x => esc(x.variante || x.nom)).join(" · ")}</small>` : ""}</span>
      <span class="ri">${fam.length > 1 ? `<span class="t acc">${fam.length} variantes</span>` : ""}${estBase(r) ? `<span class="t fav">Base</span>` : ""}${estAssemble(r) ? `<span class="t acc">Assemblé</span>` : ""}${icones(r)}</span></button>`;
  };
  // PC : cartes en grille (même contenu, rangé en hauteur)
  const carte = r => {
    const fam = S.regroupe ? familleDe(r) : [r];
    const mt = fam.length > 1 ? fam.map(x => x.variante || x.nom).join(" · ") : [r.categorie, r.preparation].filter(Boolean).join(" · ");
    return `<button class="carte-r" ${attrs(r)} data-k="${esc(S.regroupe ? cleFamille(r) : r.id)}"><span class="ph">${dishImg(r, 48)}</span>
      <span class="nm">${esc(nomDe(r))}</span><span class="mt">${esc(mt)}</span>
      <span class="ri">${estBase(r) ? `<span class="t fav">Base</span>` : ""}${estAssemble(r) ? `<span class="t acc">Assemblé</span>` : ""}${icones(r)}</span></button>`;
  };
  const bloc = estPC() ? a => `<div class="grille-r">${a.map(carte).join("")}</div>` : a => a.map(ligne).join("");
  // tri
  const nv = (r, k) => r[k] || 99;
  const tri = { nom: (a, b) => nomDe(a).localeCompare(nomDe(b), "fr"), recentes: (a, b) => (b.maj || 0) - (a.maj || 0) || parNom(a, b),
    temps: (a, b) => nv(a, "temps") - nv(b, "temps") || parNom(a, b), maitrise: (a, b) => (b.maitrise || 0) - (a.maitrise || 0) || parNom(a, b) }[S.tri];
  let html;
  if (!l.length) html = S.f.q.trim() ? `<div class="vide">Aucune recette « ${esc(S.f.q.trim())} ».<button class="btn pri cree-q" data-act="nouvelle-q">${icone("plus")}Créer la recette « ${esc(S.f.q.trim().replace(/^./, c => c.toUpperCase()))} »</button></div>`
    : `<div class="vide">Aucune recette ne correspond.</div>`;
  else if (S.tri === "categorie") {
    html = ordreCategories().map(c => {
      const g = l.filter(r => (r.categorie || "Sans catégorie") === c).sort((a, b) => nomDe(a).localeCompare(nomDe(b), "fr")); if (!g.length) return "";
      const replie = S.replies.has(c);
      return `<button class="grp ${replie ? "replie" : ""}" data-grp="${esc(c)}" aria-expanded="${!replie}"><i></i><span>${esc(c)}</span>${icone("down")}</button>${replie ? "" : `<div class="grp-l">${bloc(g)}</div>`}`;
    }).join("");
  } else {
    const plats = l.filter(r => !estBase(r)).sort(tri), bases = l.filter(estBase).sort(tri);
    html = bloc(plats) + (bases.length ? `<div class="sec-t"><h3>Bases (sous-recettes)</h3></div>` + bloc(bases) : "");
  }
  $("#liste").innerHTML = html;
  // recherche sans résultat : le + devient « + Tajine » et ouvre le formulaire avec ce nom
  const fab = $("#fab-r"), q = S.f.q.trim();
  if (fab && !estPC()) {
    // + : formulaire vide, ou déjà rempli avec ce qui est tapé dans la recherche
    const cree = !l.length && q;
    fab.classList.toggle("large", !!cree); fab.dataset.act = q ? "nouvelle-q" : "nouvelle";
    fab.innerHTML = icone("plus") + (cree ? `<span>${esc(q.replace(/^./, c => c.toUpperCase()))}</span>` : "");
  }
  majCadre();
}
// Une famille regroupée dans la liste : on choisit la variante à ouvrir
function ouvrirChoixVariante(cle) {
  const r0 = S.recettes.find(r => cleFamille(r) === cle); if (!r0) return;
  const fam = familleDe(r0), md = $("#modal");
  ["recette", "form", "rep", "src", "choix", "archive", "filtres", "asm"].forEach(k => delete md.dataset[k]);
  md.dataset.vc = "1";
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche vc" role="dialog" aria-label="${esc(r0.famille)}">
    <div class="vc-t">${icone("branche")}<b>${esc(r0.famille)}</b><small>${fam.length} variantes</small></div>
    ${fam.map(x => `<button class="vc-o" data-fiche="${esc(x.id)}">${dishImg(x, 26)}<span>${esc(x.variante || x.nom)}</span><span class="ri">${x.vege ? icone("leaf", "acc") : ""}${x.prep ? icone("box", "lb") : ""}${x.date ? icone("glass", "inv") : ""}${x.favori ? icone("star", "fav") : ""}</span></button>`).join("")}
  </div></div>`;
  vibrer("pas");
}

// Feuille « Filtres » : une ligne par famille, fermée (« Toutes ») ; on l'ouvre pour voir toutes les valeurs et en choisir
function ouvrirFiltres() {
  const f = S.f, n = filtrees().length;
  const libelle = (k, v) => NIV_F[k] ? NIVEAUX[NIV_F[k]][v - 1] : v;
  const fam = ([k, titre, teinte, val]) => {
    const nb = new Map();
    S.recettes.forEach(r => { const v = val(r); if (v != null && v !== "") nb.set(v, (nb.get(v) || 0) + 1); });
    let vals = [...nb.keys()];
    if (NIV_F[k]) vals.sort((a, b) => a - b);
    else if (k === "saisons") vals = ["Été", "Hiver", "Toute l'année", ...vals.filter(v => !["Été", "Hiver", "Toute l'année"].includes(v))].filter(v => nb.has(v));
    else if (k === "cats") vals = ordreCategories().filter(v => nb.has(v));
    else vals.sort((a, b) => String(a).localeCompare(String(b), "fr"));
    if (!vals.length) return "";
    const sel = f[k] || [], ouvert = S.fOuvert === k;
    const resume = sel.length ? sel.map(v => libelle(k, v)).join(", ") : "Toutes";
    return `<div class="ff ${ouvert ? "ouvert" : ""}" data-teinte="${teinte}"><button class="ff-hd" data-ff="${k}" aria-expanded="${ouvert}"><span>${titre}</span><span class="v ${sel.length ? "on" : ""}">${esc(String(resume))}</span>${icone("down")}</button>
      ${ouvert ? `<div class="ff-c">${vals.map(v => `<button class="ffp ${sel.includes(v) ? "on" : ""}" data-ffv="${k}" data-v="${esc(String(v))}">${k === "saisons" && v === "Été" ? icone("sun") : k === "saisons" && v === "Hiver" ? icone("flocon") : ""}${esc(String(libelle(k, v)))} <em>${nb.get(v)}</em></button>`).join("")}</div>` : ""}</div>`;
  };
  ["recette", "form", "rep", "src", "choix", "archive", "vc", "asm"].forEach(k => delete $("#modal").dataset[k]);
  $("#modal").dataset.filtres = "1";
  const haut = $("#modal .filtres-f") ? $("#modal .fiche").scrollTop : 0, deja = !!$("#modal .filtres-f");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche filtres-f" role="dialog" aria-label="Filtres">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Filtres</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${FAMILLES_F.map(fam).join("")}
    <div class="pied2"><button class="btn" data-act="filtres-effacer">Tout effacer</button><button class="btn pri" data-act="fermer">Voir ${n} recette${n > 1 ? "s" : ""}</button></div></div></div>`;
  if (deja) { const fi = $("#modal .fiche"); fi.style.animation = "none"; fi.parentElement.style.animation = "none"; fi.scrollTop = haut; }
}

/* ---------- 6. Fiche recette (mini pop-up) ---------- */

function ouvrirFiche(id) {
  const r = S.recettes.find(x => x.id === id);
  if (!r) return fermer();
  // Catégorie puis les 3 étiquettes sur une ligne ; saison (Été / Hiver seulement), origine, préparation en texte coloré dessous
  const etiq = ETIQUETTES.filter(([k]) => r[k]).map(([k, i, t]) => `<span class="fe" data-teinte="${k}">${icone(i)}<span>${t}</span></span>`).join("");
  const s2 = [/^ete$/.test(norm(r.saison)) ? `<span class="ft ete">${icone("sun")}Été</span>` : /^hiver$/.test(norm(r.saison)) ? `<span class="ft hiver">${icone("flocon")}Hiver</span>` : "",
    r.origine ? `<span class="ft" data-teinte="bleu">${esc(r.origine)}</span>` : "", r.preparation ? `<span class="ft" data-teinte="prune">${esc(r.preparation)}</span>` : ""].filter(Boolean).join("");
  // Niveaux sur une ligne : € (les manquants en gris), difficulté en points, temps en horloges, maîtrise en couleur
  const n3 = (n, f) => [1, 2, 3].map(i => f(i > n)).join("");
  const nivs = Object.keys(NIVEAUX).some(k => r[k]) ? `<div class="fi-niv">
    <div><small>Prix</small><b>${r.prix ? `${"€".repeat(r.prix)}<span class="off">${"€".repeat(3 - r.prix)}</span>` : `<span class="off">—</span>`}</b></div>
    <div><small>Difficulté</small><b>${r.difficulte ? n3(r.difficulte, off => `<i class="pt ${off ? "off" : ""}"></i>`) : `<span class="off">—</span>`}</b></div>
    <div><small>Temps</small><b>${r.temps ? n3(r.temps, off => `<span class="${off ? "off" : ""}">${icone("clock")}</span>`) : `<span class="off">—</span>`}</b></div>
    <div><small>Maîtrise</small><b class="${r.maitrise ? "m" + r.maitrise : ""}">${r.maitrise ? NIVEAUX.maitrise[r.maitrise - 1] : `<span class="off">—</span>`}</b></div></div>` : "";
  // Variantes : pastilles pour passer de l'une à l'autre ; les ingrédients propres à cette variante sont marqués
  const fam = familleDe(r), communs = fam.length > 1 ? (r.ingredients || []).filter(t => fam.every(x => (x.ingredients || []).includes(t))) : null;
  let dansSection = false;
  const ings = (r.ingredients || []).map((t, i) => {
    if (estSection(t)) { dansSection = true; return `<li class="sect-f">${esc(nomSection(t))}</li>`; }
    const b = sousRecette(t), dans = dansSection ? "dans" : "";
    if (b && !estBase(r)) {
      const ouvert = S.basesOuvertes && S.basesOuvertes.has(b.id);
      return `<li class="base-l ${dans} ${ouvert ? "ouvert" : ""}"><button class="base-hd" data-deplier="${esc(b.id)}" aria-expanded="${!!ouvert}">${icone("book")}<span>${esc(b.nom)}<small>${estBase(b) ? "sous-recette" : "plat"}</small></span>${icone("right", "chev")}</button>
        ${ouvert ? `<div class="base-in">${ingsSeuls(b).map(x => `<span>${imgIng(x, 16)}${esc(x)}</span>`).join("")}<button class="lien-btn" data-fiche="${esc(b.id)}">Ouvrir la recette ${icone("right")}</button></div>` : ""}</li>`;
    }
    const propre = communs && !communs.includes(t);
    const txt = esc(sansOpt(t)).replace(/\s+ou\s+/i, ' <i class="ou">ou</i> ');
    return `<li class="${propre ? "propre" : ""} ${dans} ${estOptionnel(t) ? "opt" : ""}">${imgIng(t, 18)}<span>${txt}</span></li>`;
  }).join("");
  const utilisee = estBase(r) ? S.recettes.filter(x => (x.ingredients || []).some(t => norm(nomCrochets(t) || "") === norm(r.nom))) : [];
  ["form", "rep", "choix", "filtres", "vc", "asm"].forEach(k => delete $("#modal").dataset[k]);
  $("#modal").dataset.recette = id;
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche fr" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd"><button type="button" class="bqf-ic fi-ic" data-act="rec-icone" aria-label="Changer l'icône">${dishImg(r, 44)}<span class="crayon">${icone("pen")}</span></button><div class="txt"><h2>${esc(r.nom)}</h2>
      ${fam.length > 1 ? `<button class="fi-var" data-act="var-menu" aria-label="Variante : changer">${icone("branche")}<span class="fv-t"><b>${esc(r.famille)}</b> ·</span><b class="v">${esc(r.variante || r.nom)}${icone("down")}</b></button>` : ""}</div>
      <button class="ib fi-etoile ${r.favori ? "on" : ""}" data-act="favori" aria-label="${r.favori ? "Retirer des favoris" : "Mettre en favori"}">${icone("star")}</button>
      <button class="ib" data-act="menu3" aria-label="Plus d'actions">${icone("more")}</button>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="menu3" id="menu3" hidden>
      <button data-act="modifier">${icone("pen")}Modifier</button>
      <button data-act="dupliquer">${icone("copy")}Dupliquer</button>
      <button data-act="rec-icone">${icone("grid")}Icône</button>
      ${estBase(r) ? "" : `<button data-act="variante">${icone("plus")}Nouvelle variante</button>`}
      <button class="danger" data-act="supprimer">${icone("trash")}Supprimer</button></div>
    ${fam.length > 1 ? `<div class="menu3 var-menu" id="var-menu" hidden>${fam.map(x => `<button class="${x.id === r.id ? "on" : ""}" data-fiche="${esc(x.id)}" data-variante>${x.vege ? icone("leaf") : icone("branche")}${esc(x.variante || x.nom)}</button>`).join("")}</div>` : ""}
    ${r.categorie || etiq ? `<div class="fi-tags1">${r.categorie ? `<span class="fc">${esc(r.categorie)}</span>` : ""}${r.categorie && etiq ? `<span class="fsep"></span>` : ""}${etiq}</div>` : ""}
    ${s2 ? `<div class="fi-tags2">${s2}</div>` : ""}
    ${utilisee.length ? `<p class="infos">Base (sous-recette) : elle sert dans ${utilisee.map(u => `<b>${esc(u.nom)}</b>`).join(", ")}. Jamais proposée dans le menu.</p>` : ""}
    ${nivs}
    <div><div class="h4">Ingrédients <i>pour ${r.portions || 2}${r.ingredientsSource === "suggestion" ? " · suggérés" : ""}</i></div>
      ${communs ? `<div class="legende"><i></i>propre à « ${esc(r.variante || r.nom)} » · le reste est commun</div>` : ""}
      ${ings ? `<ul class="ings">${ings}</ul>` : `<div class="sub">Aucun ingrédient.</div>`}</div>
    ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
    ${/^https?:\/\//.test(r.lien || "") ? `<a class="lien" href="${esc(r.lien)}" target="_blank" rel="noopener">${icone("link")}Voir la recette en ligne</a>` : ""}
    ${estBase(r) ? "" : `<div class="gros">${assemblable(r) ? `<button class="btn fi-asm" data-act="assembler">${icone("utensils")}Assembler</button>` : ""}
      ${menuEnCours() && menuEnCours().repas.some(x => x.id === r.id)
        ? `<button class="btn" disabled>${icone("check")}Dans la liste</button>`
        : `<button class="btn pri" data-act="au-menu">${icone("cart")}À la liste</button>`}</div>`}
  </div></div>`;
  // catégorie + étiquettes sur une seule ligne : si ça ne tient pas, les étiquettes passent en icônes seules
  const t1 = $("#modal .fi-tags1"); if (t1 && t1.scrollWidth > t1.clientWidth + 1) t1.classList.add("icones");
}

function basculerFavori() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  r.favori = !r.favori;
  ecrireRecette(r); vibrer(r.favori ? "coche" : "decoche");
  render(); ouvrirFiche(r.id);
  const f = $("#modal .fiche"); if (f) { f.style.animation = "none"; f.parentElement.style.animation = "none"; }
}

function fermer() {
  $("#modal").innerHTML = "";
  ["recette", "form", "rep", "src", "choix", "archive", "filtres", "asm", "art", "vc"].forEach(k => delete $("#modal").dataset[k]);
  finFicheIng();
}
// Fiche ingrédient refermée : la liste dessous reprend ses changements (panier, nom, icône…)
function finFicheIng() {
  if (!S.bq.detail) return;
  S.bq.detail = null; S.bq.suppr = null; fermerIconesIng();
  if (S.bq.ouvert) majBanque(); else render();
}

// Supprime tout de suite, avec « Annuler » pendant quelques secondes
// Supprimer : part aussi son icône perso (sinon reprise par une future recette du même id) et ses propositions du menu
function supprimer() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  const cle = "r:" + r.id, ico = PERSO[cle], propoAvant = S.propo.repas.slice();
  S.recettes = S.recettes.filter(x => x !== r);
  effacerRecette(r.id);
  if (ico) effacerIcone(cle);
  S.propo.repas = S.propo.repas.filter(p => p.id !== r.id);
  if (S.propo.repas.length !== propoAvant.length) sauverPropo();
  fermer(); render();
  toast("Recette supprimée", () => {
    S.recettes.push(r);
    ecrireRecette(r);
    if (ico) sauverIcone(cle, ico);
    if (S.propo.repas.length !== propoAvant.length) { S.propo.repas = propoAvant; sauverPropo(); }
    render();
  });
}

/* ---------- 6 bis-a. Listes déroulantes de l'appli ---------- */
// Une pastille qui déplie un panneau de choix, aux couleurs de Foodix (pas la liste du téléphone).
// Chaque liste a un identifiant et une « recette » dans LD :
//   lib (nom du tag), teinte, placeholder, plein (pleine largeur), vide (« — » = rien) ou null,
//   val() → valeur choisie, affiche(v) → texte affiché, items() → [{ v, t, g (groupe) }],
//   choisir(v), nouveau (« Nouvelle origine » : dernière ligne pour en taper une), ajouter(v), pied() → html en bas.
const LD = {};
let ldOuvert = null, ldSaisie = false;
function ld(id, conf) { LD[id] = conf; return htmlLd(id); }
function htmlLd(id) {
  const c = LD[id], v = c.val(), o = ldOuvert === id;
  const lib = v ? (c.lib && !c.plein ? `<span class="k">${esc(c.lib)} · </span>` : "") + esc(c.affiche ? c.affiche(v) : v) : `<span class="k">${esc(c.placeholder || c.lib)}</span>`;
  let h = `<div class="ld ${o ? "ouvert" : ""} ${c.plein ? "plein" : ""}" data-ld="${esc(id)}" data-teinte="${c.teinte || "accent"}">
    <button type="button" class="ld-b ${v ? "" : "vide"}" data-ld-b="${esc(id)}" aria-expanded="${o}">${icone("plus", "ld-plus")}<span class="v">${lib}</span>${icone("down", "ld-chev")}</button>`;
  if (o) {
    let g = null;
    const items = c.items().map(x => {
      const tete = x.g && x.g !== g ? `<div class="ld-g">${esc(x.g)}</div>` : ""; g = x.g;
      return tete + `<button type="button" class="ld-o ${x.v === v ? "on" : ""}" data-ld-v="${esc(x.v)}">${esc(x.t || x.v)}${x.v === v ? icone("check", "ld-ck") : ""}</button>`;
    }).join("");
    const nouv = !c.nouveau ? "" : ldSaisie
      ? `<div class="ld-nouv-l"><input data-ld-txt placeholder="${esc(c.nouveau)}" autocomplete="off" enterkeyhint="done"><button type="button" data-ld-ok aria-label="Ajouter">${icone("check")}</button></div>`
      : `<button type="button" class="ld-nouv" data-ld-nouv>${icone("plus")}${esc(c.nouveau)}</button>`;
    h += `<div class="ld-p"><div class="ld-l">${c.vide != null ? `<button type="button" class="ld-o aucun" data-ld-v="">${c.vide}</button>` : ""}${items}</div>${nouv}${c.pied ? c.pied() : ""}</div>`;
  }
  return h + `</div>`;
}
const elLd = id => document.querySelector(`.ld[data-ld="${CSS.escape(id)}"]`);
function majLd(id) {
  const el = elLd(id); if (!el) return;
  el.outerHTML = htmlLd(id);
  const n = elLd(id), p = n && n.querySelector(".ld-p");
  if (!p) return;
  // le panneau ne doit pas sortir de la fenêtre : il se cale à droite si besoin
  const cadre = (n.closest(".fiche, .cp-carte") || document.body).getBoundingClientRect(), r = p.getBoundingClientRect();
  if (r.right > cadre.right - 6) p.classList.add("droite");
  const champ = n.querySelector("[data-ld-txt]");
  if (champ) champ.focus(); else { const on = n.querySelector(".ld-o.on"); if (on) on.scrollIntoView({ block: "nearest" }); }
}
function fermerLd() { const id = ldOuvert; ldOuvert = null; ldSaisie = false; if (id) majLd(id); }
function ldValider() {
  const id = ldOuvert; if (!id) return;
  const c = LD[id], champ = elLd(id) && elLd(id).querySelector("[data-ld-txt]"), v = champ ? champ.value.trim() : "";
  ldOuvert = null; ldSaisie = false;
  if (v) { (c.ajouter || c.choisir)(v); vibrer("ajout"); }
  majLd(id);
}
// Clics sur une liste : true = géré. Toucher ailleurs ferme la liste ouverte (et le clic continue son chemin).
function clicLd(t) {
  const b = t.closest("[data-ld-b]");
  if (b) {
    const id = b.dataset.ldB, avant = ldOuvert;
    ldOuvert = avant === id ? null : id; ldSaisie = false;
    if (avant && avant !== id) majLd(avant);
    majLd(id); vibrer("pas"); return true;
  }
  const dans = t.closest(".ld");
  if (dans && ldOuvert && dans.dataset.ld === ldOuvert) {
    const o = t.closest("[data-ld-v]");
    if (o) { const id = ldOuvert; ldOuvert = null; LD[id].choisir(o.dataset.ldV); majLd(id); vibrer("pas"); return true; }
    if (t.closest("[data-ld-nouv]")) { ldSaisie = true; majLd(ldOuvert); return true; }
    if (t.closest("[data-ld-ok]")) { ldValider(); return true; }
    if (t.closest("[data-ld-txt], .ld-g, .ld-l")) return true;
    return false;  // un bouton du pied de la liste (data-act) : il continue
  }
  if (ldOuvert) fermerLd();
  return false;
}
// Couleur et nom de chaque tag
const TEINTES = { categorie: "neutre", saison: "ambre", origine: "bleu", preparation: "prune" };
const NOMS_TAG = { categorie: "Catégorie", saison: "Saison", origine: "Origine", preparation: "Préparation" };
const NOUV_TAG = { categorie: "Nouvelle catégorie", origine: "Nouvelle origine", preparation: "Nouvelle préparation" };
const ETIQUETTES = [["vege", "leaf", "Végé"], ["prep", "box", "Lunchbox"], ["date", "glass", "Invités"]];

/* ---------- 6 bis. Formulaire (ajouter, modifier, dupliquer) ---------- */
// Le formulaire travaille sur un brouillon : rien n'est enregistré avant « Enregistrer ».
// Les pastilles et les cases changent juste leur allure à l'écran ; au moment
// d'enregistrer, on relit tout le formulaire d'un coup (lireFormulaire).

// Valeurs proposées en pastilles : celles déjà utilisées, les plus fréquentes d'abord
function valeursDe(k, actuelle) {
  const n = {};
  S.recettes.forEach(r => { if (r[k]) n[r[k]] = (n[r[k]] || 0) + 1; });
  const liste = Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, "fr"));
  // la valeur déjà choisie passe en tête, pour être visible sans faire défiler
  return actuelle ? [actuelle, ...liste.filter(v => v !== actuelle)] : liste;
}
const SAISONS = ["Aucune", "Été", "Hiver"];

// Un tag du formulaire : liste déroulante de l'appli. Les valeurs vivent dans S.fo jusqu'à « Enregistrer ».
function ldTag(k) {
  return ld("fo-" + k, {
    lib: NOMS_TAG[k], teinte: TEINTES[k], vide: "—",
    val: () => S.fo.v[k] || "",
    items: () => { const l = k === "saison" ? SAISONS.slice() : valeursDe(k), v = S.fo.v[k]; if (v && !l.includes(v)) l.push(v); return l.map(x => ({ v: x })); },
    choisir: v => { S.fo.v[k] = v; },
    nouveau: NOUV_TAG[k] || null,
    pied: k === "categorie" ? () => `<div class="ld-pied"><button type="button" class="ld-var ${S.fo.famille ? "rempli" : ""}" data-act="fo-variante">${icone("branche")}<span>${S.fo.famille ? texteVariante() : "Variante d'un autre plat…"}</span></button></div>` : null
  });
}
// Variante : sous le nom (« Variante de Curry · Poulet »), réglée dans un petit encadré en haut du formulaire
const texteVariante = () => `Variante de <b>${esc(S.fo.famille)}</b>${S.fo.variante ? " · " + esc(S.fo.variante) : ""}`;
const htmlSousTitre = () => S.fo.famille ? `<button type="button" class="fo-sous" data-act="fo-variante">${icone("branche")}<span>${texteVariante()}</span></button>` : "";
function majSousTitre() { const el = $("#fo-sous"); if (el) el.innerHTML = htmlSousTitre(); }
function familles() {
  const l = [...new Set(S.recettes.map(x => x.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  if (S.fo.famille && !l.includes(S.fo.famille)) l.push(S.fo.famille);
  return l;
}
function htmlVariante() {
  return `<div class="fo-var" id="fo-var"><div class="fo-var-hd">${icone("branche")}<span>Variante d'un autre plat</span></div>
    <div class="fo-var-l">${ld("fo-famille", { lib: "Famille", placeholder: "Famille", teinte: "accent", vide: null,
      val: () => S.fo.famille || "", items: () => familles().map(x => ({ v: x })),
      choisir: v => { S.fo.famille = v; majSousTitre(); majPiedVariante(); }, nouveau: "Nouvelle famille" })}
      <input class="saisie" id="f-variante" placeholder="ex. Végé" value="${esc(S.fo.variante)}" autocomplete="off" enterkeyhint="done" aria-label="Nom de la variante"></div>
    <div class="fo-var-pied" id="fo-var-pied">${piedVariante()}</div></div>`;
}
const piedVariante = () => `${S.fo.famille ? `<button type="button" class="lien-g" data-act="fo-sans-var">Ce n'est pas une variante</button>` : "<span></span>"}
  <button type="button" class="btn pri fo-ok" data-act="fo-var-ok">${icone("check")}OK</button>`;
function majPiedVariante() { const el = $("#fo-var-pied"); if (el) el.innerHTML = piedVariante(); }
function ouvrirVariante() {
  fermerLd();
  if (!$("#fo-var")) $(".fo-corps").insertAdjacentHTML("afterbegin", htmlVariante());
  $(".fo-corps").scrollTop = 0;
}
function fermerVariante() { if (ldOuvert === "fo-famille") fermerLd(); const el = $("#fo-var"); if (el) el.remove(); majSousTitre(); }

// Icône choisie dans le formulaire : gardée de côté jusqu'à « Enregistrer » (undefined = pas touchée, null = icône par défaut)
let iconeForm;
const imgForm = r => {
  const ico = iconeForm !== undefined ? iconeForm : r.id && PERSO["r:" + r.id];
  return ico && styleIcones() === "perso" || iconeForm ? `<img class="px ${ico.pixel ? "" : "lisse "}dish" src="${ico.src}" width="30" height="30" alt="">` : brut(() => dishImg(r, 30));
};
function atelierFormulaire() {
  const r = lireFormulaire(), avant = iconeForm !== undefined ? iconeForm : (r.id && PERSO["r:" + r.id]) || null;
  const maj = () => { const b = $(".fo-plat"); if (b) b.innerHTML = imgForm(r) + `<span class="crayon">${icone("pen")}</span>`; };
  ouvrirAtelier({ nom: r.nom || "Nouvelle recette", recette: r, actuel: avant, toast,
    mes: [...new Set(Object.values(PERSO).map(x => x.p && x.p.web && x.p.web.src).filter(Boolean))],
    garder: ico => { iconeForm = ico; maj(); }, effacer: () => { iconeForm = null; maj(); } });
}
function ouvrirFormulaire(brouillon, titre) {
  iconeForm = undefined;
  const r = brouillon;
  S.fo = { v: { categorie: r.categorie || "", saison: r.saison || "", origine: r.origine || "", preparation: r.preparation || "" }, famille: r.famille || "", variante: r.variante || "" };
  ldOuvert = null; ldSaisie = false;
  const niveaux = Object.keys(NIVEAUX).map(k => `<div class="niv"><span class="lbl">${{ prix: "Prix", difficulte: "Difficulté", temps: "Temps", maitrise: "Maîtrise" }[k]}</span>
    <span class="seg" data-niv="${k}">${NIVEAUX[k].map((l, i) => `<button type="button" class="${r[k] === i + 1 ? "on" : ""}" data-v="${i + 1}">${l}</button>`).join("")}</span></div>`).join("");
  const m = $("#modal");
  m.dataset.form = "1";
  if (r.id) m.dataset.recette = r.id; else delete m.dataset.recette;
  // En-tête et pied fixes, seul le milieu défile
  m.innerHTML = `<div class="voile"><div class="fiche form fo" role="dialog" aria-label="${titre}">
    <div class="fo-hd"><button type="button" class="fo-plat bqf-ic fi-ic" data-act="form-icone" aria-label="Changer l'icône">${imgForm(r)}<span class="crayon">${icone("pen")}</span></button>
      <div class="fo-titre"><small>${titre}</small><input id="f-nom" value="${esc(r.nom)}" placeholder="Nom de la recette" autocomplete="off" aria-label="Nom"><div id="fo-sous">${htmlSousTitre()}</div></div>
      <button type="button" class="ib fo-etoile ${r.favori ? "on" : ""}" data-case="favori" aria-label="Favori" title="Favori">${icone("star")}</button>
      <button type="button" class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="fo-corps">
      <div class="fo-tags">${ldTag("categorie")}</div>
      <div class="fo-bsc">${ETIQUETTES.map(([k, i, t]) => `<button type="button" class="bsc ${r[k] ? "on" : ""}" data-case="${k}" data-teinte="${k}">${icone(i)}${t}</button>`).join("")}</div>
      <div class="fo-sec"><div class="fo-sec-t">Ingrédients<span class="fo-portions"><span>pour</span><button type="button" data-act="portions" data-v="-1" aria-label="Moins">−</button><b id="f-portions">${r.portions || 2}</b><button type="button" data-act="portions" data-v="1" aria-label="Plus">+</button></span></div>
        <div class="ingl" id="f-ings">${(r.ingredients || []).map(t => ligneIngredient(t)).join("")}${ligneIngredient("", true)}</div></div>
      <button type="button" class="fo-pd" data-act="plus" aria-expanded="false"><span><span class="lib">Plus de détails</span>${icone("down")}</span></button>
      <div id="f-plus" class="fo-plus" hidden>
        <div class="fo-tags">${ldTag("saison")}${ldTag("origine")}${ldTag("preparation")}</div>
        <div class="fo-niv">${niveaux}</div>
        <div class="fo-notes">
          <input class="saisie" id="f-lien" type="url" placeholder="Lien vers la recette" value="${esc(r.lien)}" aria-label="Lien">
          <textarea class="saisie" id="f-notes" rows="2" placeholder="Notes : astuces, ce qui a plu…" aria-label="Notes">${esc(r.notes)}</textarea></div>
      </div>
    </div>
    <div class="fo-pied" id="fo-pied">${piedFormulaire()}</div>
  </div></div>`;
  m.brouillon = r; // gardé à côté du formulaire jusqu'à l'enregistrement
  rendreTriable($("#f-ings"), ".li:not(.ajout)", $(".fo-corps"));
  majSections();
  $("#f-ings").addEventListener("pointerup", () => setTimeout(() => { const aj = $("#f-ings .li.ajout"); if (aj && aj.nextElementSibling) $("#f-ings").appendChild(aj); majSections(); }, 30));
  // une ombre sous l'en-tête dès qu'on fait défiler
  const corps = $(".fo-corps"), hd = $(".fo-hd");
  corps.addEventListener("scroll", () => hd.classList.toggle("ombre", corps.scrollTop > 4), { passive: true });
  m.depart = JSON.stringify(lireFormulaire());  // pour savoir si quelque chose a changé en fermant
  if (!r.id) $("#f-nom").focus();
}
const piedFormulaire = () => `<button type="button" class="btn ghost" data-act="fermer">Annuler</button><button type="button" class="btn pri" data-act="enregistrer">Enregistrer</button>`;
const formModifie = () => $("#modal").dataset.form && $("#modal").depart && JSON.stringify(lireFormulaire()) !== $("#modal").depart;
// Fermer avec des changements : on demande avant de tout perdre
function demanderAbandon() {
  $("#fo-pied").innerHTML = `<span class="fo-abandon">Abandonner les modifications ?</span>
    <button type="button" class="btn ghost" data-act="fo-continuer">Continuer</button><button type="button" class="btn danger" data-act="fermer" data-force="1">Abandonner</button>`;
  $(".fo").classList.remove("clavier");
  vibrer("pas");
}

// Une ligne d'ingrédient : poignée pour glisser, dessin, texte, croix
// La dernière ligne (« ajout ») est toujours vide : on y tape, elle devient une vraie ligne et une nouvelle case vide attend dessous.
// Une section (« # Sauce ») : son nom se tape dans la ligne. Une sous-recette ([Pâte brisée]) : ligne discrète avec un livre orange.
const ligneIngredient = (txt = "", ajout = false) => {
  if (!ajout && estSection(txt)) return ligneSection(nomSection(txt));
  const b = !ajout && sousRecette(txt);
  if (b) return `<div class="li sous"><span class="poignee" aria-label="Déplacer">${icone("grip")}</span>${icone("book", "li-livre")}
    <span class="li-nom">${esc(b.nom)}<small>${estBase(b) ? "sous-recette" : "plat"}</small></span><input type="hidden" value="${esc(txt)}"><button type="button" class="ib" data-act="retirer-ing" aria-label="Retirer">${icone("x")}</button></div>`;
  return `<div class="li ${ajout ? "ajout" : ""} ${estOptionnel(txt) ? "opt" : ""}"><span class="poignee" aria-label="Déplacer">${icone("grip")}</span>
  <span class="li-plus">${icone("plus")}</span>${dessinIng(txt)}<input value="${esc(txt)}" placeholder="${ajout ? "Ajouter un ingrédient" : "ex. 250 g pâtes"}" autocomplete="off" enterkeyhint="next">${etiquetteIng(txt)}${ajout ? `<button type="button" class="fo-sect-b" data-act="ajout-section">${icone("plus")}Section</button>` : ""}<button type="button" class="ib" data-act="retirer-ing" aria-label="Retirer">${icone("x")}</button></div>`;
};
// « ou » / « opt. » : petite étiquette discrète au bout de la ligne
const etiquetteIng = t => `<span class="li-tag">${alternatives(t) ? "ou" : ""}${alternatives(t) && estOptionnel(t) ? " · " : ""}${estOptionnel(t) ? "opt." : ""}</span>`;
const ligneSection = (nom = "") => `<div class="li sect"><span class="poignee" aria-label="Déplacer">${icone("grip")}</span>
  <input class="sect-nom" value="${esc(nom)}" placeholder="Nom de la section (ex. Sauce)" autocomplete="off" enterkeyhint="next" aria-label="Nom de la section"><button type="button" class="ib" data-act="retirer-ing" aria-label="Retirer la section">${icone("x")}</button></div>`;
// Les ingrédients qui suivent une section sont décalés d'un cran (jusqu'à la section suivante)
function majSections() {
  let dans = false;
  document.querySelectorAll("#f-ings > .li").forEach(li => {
    if (li.classList.contains("sect")) { dans = true; return; }
    li.classList.toggle("dans", dans && !li.classList.contains("ajout"));
  });
}
// La ligne d'ajout reçoit du texte : elle devient une ligne normale, une nouvelle ligne d'ajout se place en bas
function activerLigneAjout(li) {
  vibrer("pas");
  li.classList.remove("ajout");
  li.querySelector("input").placeholder = "ex. 250 g pâtes";
  const bs = li.querySelector(".fo-sect-b"); if (bs) bs.remove();
  $("#f-ings").insertAdjacentHTML("beforeend", ligneIngredient("", true));
  majSections();
}
// « + Section » : une ligne de section juste avant la case d'ajout ; ce qu'on tape ensuite va dedans
function ajouterSection() {
  const aj = $("#f-ings .li.ajout");
  aj.insertAdjacentHTML("beforebegin", ligneSection());
  majSections(); vibrer("pas");
  aj.previousElementSibling.querySelector("input").focus();
}
function dessinIng(txt) {
  const it = parseItem(txt);
  return imgIng(txt || "sachet", 18);
}
// Sous la ligne en cours de saisie : les ingrédients de la banque qui ressemblent à ce qu'on tape.
// Toucher l'un d'eux remplace le nom (la quantité tapée reste) : pas de « tomate » et « tomates » en double.
function majSuggIng(li) {
  document.querySelectorAll(".sugg-ing").forEach(x => x.remove());
  if (!li) return;
  const it = parseItem(li.querySelector("input").value);
  if (!it || norm(it.name).length < 2) return;
  const q = norm(it.name);
  const bases = S.recettes.filter(b => estBase(b) && norm(b.nom).includes(q)).slice(0, 2);
  const l = banque().filter(e => !e.menage && norm(e.court) !== q && (norm(e.court).includes(q) || e.cle === it.key))
    .sort((a, b) => (a.cle === it.key ? 0 : 1) - (b.cle === it.key ? 0 : 1) || (norm(a.court).startsWith(q) ? 0 : 1) - (norm(b.court).startsWith(q) ? 0 : 1) || b.recettes.length - a.recettes.length || parNom(a, b)).slice(0, 5 - bases.length);
  if (!l.length && !bases.length) return;
  // ce qui est déjà sur une autre ligne de la recette
  const ici = new Set([...document.querySelectorAll("#f-ings .li:not(.sect) input")].filter(i => i.closest(".li") !== li).map(i => { const x = parseItem(i.value); return x && x.key; }));
  const box = document.createElement("div");
  box.className = "sugg-ing";
  box.innerHTML = l.map(e => `<button type="button" class="sg ${ici.has(e.cle) ? "ici" : ""}" data-sugg-ing="${esc(e.court)}">${imgIng(e.court, 18)}<span>${esc(e.court)}</span>${ici.has(e.cle) ? "<small>déjà dans la recette</small>" : ""}</button>`).join("")
    + bases.map(b => `<button type="button" class="sg base" data-sugg-base="${esc(b.nom)}">${icone("book")}<span>${esc(b.nom)}</span><small>sous-recette</small></button>`).join("");
  li.appendChild(box);
  // au-dessus de la ligne, sauf s'il n'y a pas la place (on la met alors dessous)
  const zone = li.closest(".fo-corps");
  if (zone && li.getBoundingClientRect().top - zone.getBoundingClientRect().top < box.offsetHeight + 8) box.classList.add("dessous");
}
function choisirSuggIng(btn) {
  const li = btn.closest(".li"), champ = li.querySelector("input");
  const txt = champ.value.trimEnd(), it = parseItem(txt);
  champ.value = (it ? txt.slice(0, txt.length - it.name.length) : "") + btn.dataset.suggIng;
  li.querySelector("img").outerHTML = dessinIng(champ.value);
  majSuggIng(null);
  champ.focus();
}
function ajouterIngredient(apres) {
  if (apres && apres.classList.contains("ajout")) return;  // Entrée sur la ligne d'ajout vide : rien à faire
  const suiv = apres && apres.nextElementSibling;
  if (suiv && suiv.classList.contains("ajout")) { suiv.querySelector("input").focus(); return; }
  const tmp = document.createElement("div");
  tmp.innerHTML = ligneIngredient();
  const ligne = tmp.firstElementChild;
  if (apres) apres.after(ligne); else $("#f-ings").appendChild(ligne);
  majSections();
  ligne.querySelector("input").focus();
}

// Relit tout le formulaire et renvoie la recette complète
function lireFormulaire() {
  const r = Object.assign({}, $("#modal").brouillon);
  r.nom = $("#f-nom").value.trim();
  Object.keys(S.fo.v).forEach(k => { const v = (S.fo.v[k] || "").trim(); if (v) r[k] = v; else delete r[k]; });
  document.querySelectorAll("#modal [data-case]").forEach(b => { r[b.dataset.case] = b.classList.contains("on"); });
  document.querySelectorAll("[data-niv]").forEach(g => {
    const on = g.querySelector("button.on");
    if (on) r[g.dataset.niv] = +on.dataset.v; else delete r[g.dataset.niv];
  });
  r.portions = +$("#f-portions").textContent || 2;
  const ings = [...document.querySelectorAll("#f-ings > .li")].map(li => {
    const v = li.querySelector("input").value.trim();
    return li.classList.contains("sect") ? (v ? "# " + v : "") : v;
  }).filter(Boolean);
  // Ingrédients touchés : ce ne sont plus des « suggestions »
  if (ings.join("|") !== (r.ingredients || []).join("|")) r.ingredientsSource = "app";
  r.ingredients = ings;
  const fa = (S.fo.famille || "").trim(), va = (S.fo.variante || "").trim();
  if (fa) r.famille = fa; else delete r.famille;
  if (fa && va) r.variante = va; else delete r.variante;
  const lien = $("#f-lien").value.trim(), notes = $("#f-notes").value.trim();
  if (lien) r.lien = lien; else delete r.lien;
  if (notes) r.notes = notes; else delete r.notes;
  return r;
}

// Recette sans ingrédient ou nom déjà pris : on prévient, et un 2e appui sur Enregistrer (dans les 8 s) confirme
let aConfirmer = null;
function enregistrer() {
  const r = lireFormulaire();
  if (!r.nom) { toast("Il faut un nom"); $("#f-nom").focus(); return; }
  const doute = S.recettes.some(x => x.id !== r.id && norm(x.nom) === norm(r.nom)) ? "Ce nom existe déjà"
    : !(r.ingredients || []).length ? "Aucun ingrédient" : null;
  if (doute) {
    const cle = doute + "|" + norm(r.nom);
    if (!aConfirmer || aConfirmer.cle !== cle || Date.now() - aConfirmer.t > 8000) {
      aConfirmer = { cle, t: Date.now() };
      vibrer("retire"); return toast(doute + " : touche encore Enregistrer pour confirmer");
    }
  }
  aConfirmer = null;
  if (!r.id) {
    // Nouvelle recette : identifiant tiré du nom, sans doublon
    r.id = nouvelId(r.nom);
    S.recettes.push(r);
  } else {
    S.recettes = S.recettes.map(x => x.id === r.id ? r : x);
  }
  // Première variante d'une recette seule : l'original rejoint la famille (variante « Classique » si rien n'est dit)
  if (r.varianteDe) {
    const o = recette(r.varianteDe);
    if (o && !o.famille && r.famille) { o.famille = r.famille; o.variante = o.variante || "Classique"; ecrireRecette(o); }
    delete r.varianteDe;
  }
  ecrireRecette(r);
  if (iconeForm) { sauverIcone("r:" + r.id, iconeForm); if (styleIcones() !== "perso") { ecrireLocal("fx-icones", "perso"); appliquerIcones(); } }
  else if (iconeForm === null && PERSO["r:" + r.id]) effacerIcone("r:" + r.id);
  iconeForm = undefined;
  vibrer("ajout");
  render();
  ouvrirFiche(r.id);
  toast("Enregistré");
}

function nouvelle(nom = "") {
  ouvrirFormulaire({ nom, categorie: "Plat complet", vege: false, favori: false, prep: false, date: false, portions: 2, ingredients: [], ingredientsSource: "app" }, "Nouvelle recette");
}
function modifier() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (r) ouvrirFormulaire(JSON.parse(JSON.stringify(r)), "Modifier");
}
// « Nouvelle variante » : une copie rangée dans la même famille (la famille est créée si la recette n'en avait pas)
function nouvelleVariante() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  const copie = JSON.parse(JSON.stringify(r));
  delete copie.id; delete copie.maj; delete copie.variante;
  copie.famille = r.famille || r.nom;
  copie.nom = copie.famille + " (variante)";
  copie.varianteDe = r.id;
  ouvrirFormulaire(copie, "Nouvelle variante");
  ouvrirVariante();
  $("#f-variante").focus();
}
function dupliquer() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  const copie = JSON.parse(JSON.stringify(r));
  delete copie.id; delete copie.maj;
  copie.nom = r.nom + " (copie)";
  ouvrirFormulaire(copie, "Nouvelle recette");
}

// Clics à l'intérieur du formulaire qui ne font que changer l'allure des boutons
function clicFormulaire(t) {
  const cas = t.closest("[data-case]");
  if (cas) { vibrer(cas.classList.toggle("on") ? "coche" : "decoche"); return true; }
  const niv = t.closest("[data-niv] button");
  if (niv) {
    const etait = niv.classList.contains("on");
    niv.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on"));
    if (!etait) niv.classList.add("on");
    vibrer(etait ? "decoche" : "pas");
    return true;
  }
  return false;
}

/* ---------- Glisser-déposer qui suit le doigt (modèle : Stuff to go) ----------
   On attrape une ligne par sa poignée : elle suit le doigt pixel par pixel,
   et les autres lignes s'écartent en douceur pour lui faire de la place. */
function rendreTriable(conteneur, selecteur, zoneDefile) {
  conteneur.addEventListener("pointerdown", e => {
    const prise = e.target.closest(".poignee");
    const ligne = prise && prise.closest(selecteur);
    if (!ligne) return;
    e.preventDefault();
    const doigt = e.pointerId; // on ne suit que ce doigt-là
    // Où le doigt a attrapé la ligne : on garde ce décalage pour qu'elle reste « collée » au doigt
    const prisA = e.clientY - ligne.getBoundingClientRect().top;
    let decalage = 0, dernierY = e.clientY;
    ligne.classList.add("glisse");
    ligne.style.pointerEvents = "none"; // pour « voir » la ligne qui est sous le doigt
    ligne.style.transition = "box-shadow .12s";
    const suivre = () => {
      const vraieHaut = ligne.getBoundingClientRect().top - decalage;
      decalage = dernierY - prisA - vraieHaut;
      ligne.style.transform = `translateY(${decalage}px) scale(1.03)`;
    };
    // Change la ligne de place et fait glisser en douceur celles qui bougent
    // (technique « FLIP » : on note où elles étaient, on déplace, on anime depuis l'ancienne place)
    const deplacer = action => {
      const avant = new Map([...conteneur.querySelectorAll(selecteur)].filter(x => x !== ligne).map(x => [x, x.getBoundingClientRect().top]));
      action();
      for (const [x, haut] of avant) {
        const ecart = haut - x.getBoundingClientRect().top;
        if (ecart && x.animate) x.animate([{ transform: `translateY(${ecart}px)` }, { transform: "none" }], { duration: 160, easing: "ease-out" });
      }
      suivre();
    };
    const bouger = ev => {
      if (ev.pointerId !== doigt) return;
      ev.preventDefault();
      dernierY = ev.clientY;
      // Défilement automatique près des bords de la fiche
      const z = zoneDefile.getBoundingClientRect();
      if (ev.clientY < z.top + 50) zoneDefile.scrollBy(0, -10);
      else if (ev.clientY > z.bottom - 50) zoneDefile.scrollBy(0, 10);
      suivre();
      const sous = document.elementFromPoint(ev.clientX, ev.clientY);
      const cible = sous && sous.closest(selecteur);
      if (!cible || cible === ligne || !conteneur.contains(cible)) return;
      const r = cible.getBoundingClientRect();
      const apres = ev.clientY > r.top + r.height / 2;
      if (apres && cible.nextElementSibling !== ligne) deplacer(() => cible.after(ligne));
      else if (!apres && cible.previousElementSibling !== ligne) deplacer(() => cible.before(ligne));
    };
    const lacher = ev => {
      if (ev.pointerId !== doigt) return;
      document.removeEventListener("pointermove", bouger);
      document.removeEventListener("pointerup", lacher);
      document.removeEventListener("pointercancel", lacher);
      // La ligne se « pose » en douceur à sa nouvelle place
      ligne.style.transition = "transform .15s ease-out";
      ligne.style.transform = "translateY(0) scale(1)";
      setTimeout(() => {
        ligne.classList.remove("glisse");
        ligne.style.transform = ligne.style.transition = ligne.style.pointerEvents = "";
      }, 160);
    };
    document.addEventListener("pointermove", bouger, { passive: false });
    document.addEventListener("pointerup", lacher);
    document.addEventListener("pointercancel", lacher);
  });
}

/* ---------- 7. Réglages, thème, Excel ---------- */

// Thème : réglage de CET appareil (pas synchronisé)
const SOMBRE = window.matchMedia("(prefers-color-scheme: dark)");
function appliquerTheme() {
  const c = lireLocal("fx-theme", "auto");
  document.documentElement.dataset.theme = c === "auto" ? (SOMBRE.matches ? "sombre" : "clair") : c;
}
SOMBRE.addEventListener("change", appliquerTheme); // le téléphone passe en sombre le soir : on suit si « Auto »
const THEMES = [["auto", "Auto", "Suit le téléphone ou le PC"], ["clair", "Clair", ""], ["sombre", "Sombre", "Ardoise et pastel"]];

function ouvrirReglages() {
  importEnAttente = null;
  ["recette", "archive"].forEach(k => delete $("#modal").dataset[k]);
  const th = THEMES.find(t => t[0] === lireLocal("fx-theme", "auto")) || THEMES[0];
  const anim = lireLocal("fx-anim", "completes"), vibr = lireLocal("fx-vibr", "oui");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Réglages">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Réglages</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Apparence</div>
    <button class="reg" data-act="themes"><span>Thème</span><span class="val">${th[1]} ›</span></button>
    <button class="reg" data-act="icones"><span>Icônes</span><span class="val">${styleIcones() === "perso" ? "Perso" : "Foodix"} ›</span></button>
    <div class="reg"><span>Animations</span><span class="seg">
      <button class="${anim === "completes" ? "on" : ""}" data-act="anim" data-v="completes">Complètes</button>
      <button class="${anim === "simples" ? "on" : ""}" data-act="anim" data-v="simples">Simples</button></span></div>
    <div class="reg"><span>Vibrations</span><span class="seg">
      <button class="${vibr === "oui" ? "on" : ""}" data-act="vibr" data-v="oui">Oui</button>
      <button class="${vibr === "non" ? "on" : ""}" data-act="vibr" data-v="non">Non</button></span></div>
    ${uid ? `<div class="sect">Recettes</div>
    <button class="reg" data-act="ordre-cats"><span>${icone("rows")} Ordre des catégories</span><span class="val">›</span></button>
    <button class="reg" data-act="completer"><span>${icone("pen")} Compléter mes recettes</span><span class="val">${(() => { const n = S.recettes.filter(r => Object.values(GROUPES_CP).some(g => g.manque(r))).length; return n ? n + " à compléter ›" : "›"; })()}</span></button>
    <div class="sect">Idées</div>
    <button class="reg" data-act="idees"><span>Notes</span><span class="val">›</span></button>
    <div class="sect">Excel</div>
    <button class="reg" data-act="exporter"><span>${icone("download")} Exporter</span><span class="val">${depuisExport()} ›</span></button>
    <label class="reg"><span>${icone("upload")} Importer</span><span class="val">›</span><input type="file" id="fichier" accept=".xlsx" hidden></label>
    <div id="imp"></div>
    ${S.avantImport && Array.isArray(S.avantImport.recettes) ? `<button class="reg" data-act="restaurer-import"><span>${icone("history")} Restaurer avant l'import</span><span class="val">${dateCourte(S.avantImport.quand)} ›</span></button>` : ""}
    <div class="sect">Compte</div>
    <div class="reg"><span class="sub" style="overflow:hidden;text-overflow:ellipsis">${esc(S.compte)}</span>${MODE_DEMO ? "" : `<button class="btn" data-act="deconnexion">Se déconnecter</button>`}</div>
    <div class="reg"><span>Synchro</span><span id="sync" class="sync"></span></div>` : ""}
    <div class="version">Version ${VERSION}</div>
  </div></div>`;
  majSynchro();
}

function ouvrirThemes() {
  const c = lireLocal("fx-theme", "auto");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Thème">
    <button class="retour" data-act="reglages">‹ Réglages</button>
    <h2 class="titre-r">Thème</h2>
    ${THEMES.map(([v, nom, desc]) => `<button class="choix ${v === c ? "on" : ""}" data-act="theme" data-v="${v}"><span class="rond"></span><span><b>${nom}</b>${desc ? `<small>${desc}</small>` : ""}</span></button>`).join("")}
  </div></div>`;
}

// Icônes : style de CET appareil (comme le thème) ; les textures, elles, sont synchronisées
// « perso » = mes icônes d'atelier, sinon les textures Minecraft, sinon Foodix (l'ancien réglage « minecraft » vaut « perso »)
const styleIcones = () => lireLocal("fx-icones", "foodix") === "foodix" ? "foodix" : "perso";
const mcActif = () => styleIcones() === "perso" && Object.keys(MC.tex).length > 0;
function appliquerIcones() { MC.actif = mcActif(); MC.perso = styleIcones() === "perso"; }
function ouvrirIcones() {
  const c = lireLocal("fx-icones", "foodix"), n = Object.keys(MC.tex).length;
  const choix = [["foodix", "Foodix", "Dessins de base"], ["perso", "Perso", "Mes icônes, sinon Minecraft"]];
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Icônes">
    <button class="retour" data-act="reglages">‹ Réglages</button>
    <h2 class="titre-r">Icônes</h2>
    ${choix.map(([v, nom, desc]) => `<button class="choix ${v === c ? "on" : ""}" data-act="icones-style" data-v="${v}"><span class="rond"></span><span><b>${nom}</b>${desc ? `<small>${desc}</small>` : ""}</span></button>`).join("")}
    ${n ? `<div class="mc-apercu">${Object.keys(MC.tex).slice(0, 40).map(k => `<img class="px" src="${MC.tex[k]}" width="20" height="20" alt="">`).join("")}</div>` : ""}
    <div class="sect">Textures</div>
    <div class="reg" style="justify-content:flex-start"><label class="btn">Importer<input type="file" id="f-tex" accept=".json,.png,application/json,image/png" multiple hidden></label>
      ${n ? `<button class="btn" data-act="tex-effacer">Effacer</button>` : ""}</div>
  </div></div>`;
}
// Choix d'une texture (fiche ingrédient, ou recette) : case Chercher + grille qui défile.
// Seule la grille est redessinée pendant la frappe (sinon le clavier se ferme).
let texCtx = { attr: "", actuel: "", auto: "" }, texQ = "";
function grilleTex() {
  const { attr, actuel, auto } = texCtx;
  return `<button type="button" class="bq-ic auto ${actuel ? "" : "on"}" data-${attr}="" aria-label="Automatique">${auto}<small>Auto</small></button>`
    + mcCherche(texQ).map(k => `<button type="button" class="bq-ic ${actuel === k ? "on" : ""}" data-${attr}="${esc(k)}" aria-label="${esc(k.replace(/[_-]/g, " "))}"><img class="px" src="${MC.tex[k]}" width="24" height="24" alt=""></button>`).join("");
}
function htmlChoixTex(attr, actuel, auto) {
  if (texCtx.attr !== attr) texQ = "";
  texCtx = { attr, actuel: actuel || "", auto };
  return `<input class="saisie tex-q" id="tex-q" placeholder="Chercher… (fromage, curry…)" value="${esc(texQ)}" autocomplete="off" enterkeyhint="search">
    <div class="bq-icones tex-grille" id="tex-grille">${grilleTex()}</div>`;
}

// Import : un paquet .json ({ textures: { nom: "data:image/png;base64,…" } }) et/ou des .png (nom du fichier = nom de la texture)
async function importerTextures(fichiers) {
  const lire = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; f.type === "application/json" || /\.json$/i.test(f.name) ? r.readAsText(f) : r.readAsDataURL(f); });
  const neuf = {};
  try {
    for (const f of fichiers) {
      const v = await lire(f);
      if (/\.json$/i.test(f.name)) {
        const p = JSON.parse(v), t = (p && p.textures) || {};
        Object.entries(t).forEach(([k, d]) => { if (typeof d === "string" && d.startsWith("data:image/png;base64,") && d.length < 20000) neuf[k] = d; });
      } else if (/\.png$/i.test(f.name) && v.length < 20000) neuf[f.name.replace(/\.png$/i, "").toLowerCase().replace(/[^a-z0-9_]/g, "_")] = v;
    }
  } catch (e) { console.error(e); return toast("Fichier illisible"); }
  const n = Object.keys(neuf).length;
  if (!n) return toast("Aucune texture trouvée");
  MC.tex = Object.assign({}, MC.tex, neuf);
  sauverTextures();
  if (styleIcones() !== "perso") ecrireLocal("fx-icones", "perso");  // on vient d'importer : on veut voir le résultat
  appliquerIcones(); render(); ouvrirIcones();
  toast(n + " texture" + (n > 1 ? "s" : "") + " importée" + (n > 1 ? "s" : ""));
}
function effacerTextures() {
  const avant = MC.tex;
  MC.tex = {}; sauverTextures(); appliquerIcones(); render(); ouvrirIcones();
  toast("Textures effacées", () => { MC.tex = avant; sauverTextures(); appliquerIcones(); render(); if ($(".fiche[aria-label=Icônes]")) ouvrirIcones(); });
}

// --- Export : un vrai fichier .xlsx propre, au style commun de mes applis ---
function versCase(type, k, v) {
  if (type === "oui") return v ? "Oui" : "Non";
  if (type === "niv") return v ? NIVEAUX[k][v - 1] : "";
  if (type === "liste") return (v || []).join("; ");
  return v ?? "";
}
// Colonnes des onglets « Ingrédients » et « Produits ménagers » (Type : seulement relu dans les anciens fichiers « Banque d'ingrédients »)
const COLONNES_BANQUE = [["nom", "Nom", 24], ["type", "Type", 11], ["rayon", "Rayon", 24], ["rec", "Récurrent", 10, "c"], ["placard", "Placard", 10, "c"], ["icone", "Icône", 12], ["nb", "Nb", 6, "c"], ["recettes", "Recettes", 80]];
// Largeurs resserrées des colonnes Recettes dans l'Excel (les autres : celles de COLONNES)
const LARG_XL = { nom: 30, famille: 12, variante: 12, categorie: 14, saison: 8, origine: 11, preparation: 11, vege: 6, favori: 7, prep: 9, date: 8, prix: 5, difficulte: 9, temps: 8, maitrise: 11, portions: 8, ingredients: 90, suggeres: 10, lien: 24, notes: 40, id: 28 };
const CENTRE_XL = new Set(["vege", "favori", "prep", "date", "prix", "portions", "suggeres"]);
const HAUTEUR_XL = 21;  // points : toutes les lignes pareilles, image comprise

// Dessin (balise <img> de ingImg / dishImg) -> PNG 32 px aux pixels nets, pour l'Excel (qui lisse les petites images)
const pngCache = new Map();
function pngDe(balise) {
  const src = (balise.match(/src="([^"]+)"/) || [])[1];
  if (!src) return Promise.resolve("");
  if (!pngCache.has(src)) pngCache.set(src, new Promise(ok => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 32;
      const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = false;
      cx.drawImage(im, 0, 0, 32, 32);
      ok(cv.toDataURL("image/png"));
    };
    im.onerror = () => ok("");
    im.src = src;
  }));
  return pngCache.get(src);
}
// Lignes groupées : [{ _titre }, lignes du groupe…, { _titre }, …]
const enGroupes = (groupes) => groupes.flatMap(([titre, l]) => l.length ? [{ _titre: titre }, ...l] : []);

async function classeurRecettes() {
  const ExcelJS = await chargerExcelJS();
  const wb = new ExcelJS.Workbook();
  const opt = { hauteur: HAUTEUR_XL, figer: 2 };
  const colImg = { header: "", key: "_img", width: 4.6 };

  // Recettes, groupées par catégorie (la plus fournie d'abord). Image, Nom… et l'ID tout au bout (il ne sert qu'à l'import).
  const cols = [...COLONNES.filter(c => c[0] !== "id"), COLONNES.find(c => c[0] === "id")];
  const ligneRec = async r => {
    const l = { _image: await pngDe(dishImg(r, 32)) };
    cols.forEach(([k, , , type]) => { l[k] = versCase(type, k, k === "suggeres" ? r.ingredientsSource === "suggestion" : r[k]); });
    return l;
  };
  const parCat = {};
  S.recettes.forEach(r => { (parCat[r.categorie || "Sans catégorie"] ||= []).push(r); });
  const cats = Object.keys(parCat).sort((a, b) => (a === "Sans catégorie") - (b === "Sans catégorie") || parCat[b].length - parCat[a].length || a.localeCompare(b, "fr"));
  const groupesRec = await Promise.all(cats.map(async c => [c, await Promise.all(parCat[c].sort(parNom).map(ligneRec))]));
  ajouterFeuille(wb, "Recettes", [colImg, ...cols.map(([k, h, w]) => ({ header: h, key: k, width: LARG_XL[k] || w, centre: CENTRE_XL.has(k) }))], enGroupes(groupesRec), opt);

  // Ingrédients et Produits ménagers, groupés par rayon (ordre du magasin). Relus à l'import :
  // on peut y changer le nom (même ingrédient), le rayon, « récurrent », « souvent au placard », l'icône, ou ajouter des articles.
  const ordre = r => AISLE_ORDER.indexOf(r) < 0 ? 99 : AISLE_ORDER.indexOf(r);
  const tous = banque();
  const feuilleBanque = async (nom, menage) => {
    const liste = tous.filter(e => e.menage === menage).sort((a, b) => ordre(a.rayon) - ordre(b.rayon) || parNom(a, b));
    const parRayon = new Map();
    for (const e of liste) {
      const l = {
        _image: await pngDe(ingImg(e.nom, 32, e.icone, e.mc, e.menage)),
        nom: e.nom, rayon: libelleRayon(e.rayon), rec: e.rec ? "Oui" : "Non", placard: e.placard ? "Oui" : "Non",
        icone: e.icone && ICONES[e.icone] ? ICONES[e.icone] : "", nb: e.recettes.length || "", recettes: e.recettes.map(r => r.nom).join("; ")
      };
      const t = libelleRayon(e.rayon);
      if (!parRayon.has(t)) parRayon.set(t, []);
      parRayon.get(t).push(l);
    }
    const garder = menage ? ["nom", "rayon", "rec", "icone"] : ["nom", "rayon", "rec", "placard", "icone", "nb", "recettes"];
    const c = COLONNES_BANQUE.filter(x => garder.includes(x[0])).map(([k, h, w, centre]) => ({ header: h, key: k, width: w, centre: !!centre }));
    ajouterFeuille(wb, nom, [colImg, ...c], enGroupes([...parRayon]), opt);
  };
  await feuilleBanque("Ingrédients", false);
  await feuilleBanque("Produits ménagers", true);

  // Onglet « Familles », juste pour lire (ignoré à l'import) : les variantes et ce qu'elles ont en commun
  const fams = [...new Set(S.recettes.map(r => r.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")).map(f => {
    const l = S.recettes.filter(r => r.famille === f);
    return { famille: f, variantes: l.map(r => r.variante || r.nom).join("; "), communs: (l[0].ingredients || []).filter(t => l.every(x => (x.ingredients || []).includes(t))).join("; ") };
  });
  if (fams.length) ajouterFeuille(wb, "Familles", [{ header: "Famille", key: "famille", width: 20 }, { header: "Variantes", key: "variantes", width: 36 }, { header: "Ingrédients communs", key: "communs", width: 90 }], fams, { hauteur: HAUTEUR_XL, figer: 1 });
  return wb;
}
// Date du dernier export (par appareil) : seule vraie sauvegarde hors de Firebase, d'où le rappel au-delà de 30 jours
const JOUR = 864e5;
const joursDepuisExport = () => { const t = +lireLocal("fx-dernier-export", 0); return t ? Math.floor((Date.now() - t) / JOUR) : null; };
function depuisExport() {
  const j = joursDepuisExport();
  return j === null ? "jamais" : j === 0 ? "aujourd'hui" : j === 1 ? "hier" : "il y a " + j + " j";
}
function rappelExport() {
  if (MODE_DEMO || !S.recettes.length) return;
  const j = joursDepuisExport(), vu = +lireLocal("fx-rappel-export", 0);
  if ((j === null || j > 30) && Date.now() - vu > 7 * JOUR) { ecrireLocal("fx-rappel-export", String(Date.now())); toast(j === null ? "Pense à exporter une copie Excel" : "Dernier export Excel il y a " + j + " jours"); }
}
async function exporter(btn) {
  btn.disabled = true;
  try { await telechargerClasseur(await classeurRecettes(), NOM_APPLI); ecrireLocal("fx-dernier-export", String(Date.now())); toast("Fichier téléchargé"); const v = btn.querySelector(".val"); if (v) v.textContent = depuisExport() + " ›"; }
  catch (e) { console.error(e); toast("Export impossible, réessaie"); }
  finally { btn.disabled = false; }
}

// --- Import : fusionne le fichier avec mes recettes ---
// Même ID (ou même nom) : mise à jour, une case vide n'efface rien. Sinon : ajout.
let importEnAttente = null;

// Valeur brute d'une case Excel (texte, nombre, lien, formule…)
function valeurCase(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(t => t.text).join("");
    if (v.hyperlink) return typeof v.text === "string" ? v.text : v.hyperlink;
    if ("result" in v) return valeurCase(v.result);
    return "";
  }
  return v;
}
// Une case -> valeur de l'appli ; undefined = case vide (on ne touche à rien)
function depuisCase(type, k, v) {
  const s = String(v).trim();
  if (s === "") return undefined;
  if (type === "oui") return /^(oui|1|x|vrai|true)$/i.test(s);
  if (type === "niv") {
    const i = NIVEAUX[k].findIndex(l => norm(l) === norm(s));
    return i >= 0 ? i + 1 : [1, 2, 3].includes(+s) ? +s : undefined;
  }
  if (type === "nombre") return +s > 0 ? +s : undefined;
  if (type === "liste") return s.split(/[;\n]+/).map(x => x.trim()).filter(Boolean);
  return s;
}

function lireRecettes(wb) {
  // Pas d'onglet « Recettes » : la 1re feuille, sauf si c'est une feuille de banque (fichier d'ingrédients seuls)
  const ws = wb.worksheets.find(w => norm(w.name).startsWith("recette")) || wb.worksheets.find((w, i) => i === 0 && !/^(banque|ingredient|produits menager)/.test(norm(w.name)));
  if (!ws) return [];
  const parEntete = {};
  COLONNES.forEach(c => { parEntete[norm(c[1])] = c; });
  ["À l'avance", "Prepmeal"].forEach(h => { parEntete[norm(h)] = COLONNES.find(c => c[0] === "prep"); });  // anciens en-têtes de cette colonne
  const cols = [];
  ws.getRow(1).eachCell((c, i) => { cols[i] = parEntete[norm(valeurCase(c.value))]; });
  const out = [];
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    const vides = [];  // colonnes présentes mais vides : effacées en mode « Tout remplacer »
    cols.forEach((c, i) => { if (!c) return; const v = depuisCase(c[3], c[0], valeurCase(rang.getCell(i).value)); if (v !== undefined) o[c[0]] = v; else vides.push(c[0]); });
    if (o.nom) out.push(Object.assign(o, { __vides: vides }));
  });
  return out;
}

// Relit l'onglet « Banque d'ingrédients » (s'il est là) : [{ nom, menage, rayon, rec, placard }]. Une case vide ne change rien.
// Onglets lus : « Ingrédients » et « Produits ménagers » (depuis 0.13.0), ou l'ancien « Banque d'ingrédients » (colonne Type).
function lireBanque(wb) {
  const out = [];
  wb.worksheets.forEach(ws => {
    const nomF = norm(ws.name);
    const menageF = nomF.startsWith("produits menager") ? true : nomF.startsWith("ingredient") ? false : nomF.startsWith("banque") ? undefined : null;
    if (menageF !== null) lireUneBanque(wb, ws, menageF, out);
  });
  return out;
}
// Image posée dans une ligne (1re colonne) -> data URL. ExcelJS les range à part : ancrage (ligne) + fichier du classeur.
function imagesParLigne(wb, ws) {
  const m = new Map();
  ws.getImages().forEach(im => {
    const f = wb.getImage(Number(im.imageId));
    if (!f || !f.buffer || !/png|jpe?g|gif/i.test(f.extension || "")) return;
    const o = new Uint8Array(f.buffer); let s = "";
    for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    m.set(Math.round(im.range.tl.nativeRow ?? im.range.tl.row) + 1, `data:image/${f.extension === "jpg" ? "jpeg" : f.extension};base64,` + btoa(s));
  });
  return m;
}
function lireUneBanque(wb, ws, menageF, out) {
  const images = imagesParLigne(wb, ws);
  const parEntete = {}, cols = [];
  COLONNES_BANQUE.forEach(c => { parEntete[norm(c[1])] = c[0]; });
  parEntete[norm("Souvent au placard")] = "placard";  // en-tête des fichiers d'avant 0.13.0
  ws.getRow(1).eachCell((c, i) => { cols[i] = parEntete[norm(valeurCase(c.value))]; });
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    cols.forEach((k, i) => { if (k) o[k] = String(valeurCase(rang.getCell(i).value)).trim(); });
    if (!o.nom) return;  // ligne vide ou titre de rayon
    const oui = v => v === "" || v == null ? undefined : /^(oui|1|x|vrai|true)$/i.test(v);
    const menage = o.type ? /menag/.test(norm(o.type)) : menageF;
    const e = { nom: o.nom, menage, rec: oui(o.rec), placard: oui(o.placard) };
    if (o.rayon) { const id = [...rayonsDe(true), ...rayonsDe(false)].find(r => norm(libelleRayon(r)) === norm(o.rayon) || r === o.rayon); if (id) e.rayon = id; }
    // Icône : son nom (« Oignon »), ou « Auto » pour revenir au dessin deviné d'après le nom. Vide = pas de changement.
    if (o.icone) {
      if (norm(o.icone) === "auto") e.icone = null;
      else { const id = Object.keys(ICONES).find(k => norm(ICONES[k]) === norm(o.icone) || k === norm(o.icone)); if (id) e.icone = id; }
    }
    if (images.has(n)) e.img = images.get(n);  // devient une texture (imagesVersTextures)
    out.push(e);
  });
}
// Applique la banque relue (simuler = juste compter). Modes :
//   ajout     : seulement les articles inconnus
//   fusion    : + réglages des articles connus mis à jour (une case vide ne change rien)
//   remplacer : la banque devient celle du fichier ; ce qui n'y est pas perd ses réglages (ou disparaît s'il n'est dans aucune recette).
//               Une texture choisie à la main est gardée, sauf si le fichier donne une image pour cet article.
function fusionBanque(lignes, simuler, mode = "fusion") {
  let ajout = 0, maj = 0, retire = 0, efface = 0;
  let ancien = null;
  if (mode === "remplacer") {
    // retire = ajoutés à la main (disparaissent) ; efface = ingrédients de recettes qui reprennent leurs réglages automatiques
    const dansFichier = new Set(lignes.map(l => cleBanque(l.nom)));
    const deRecettes = new Set(banque().filter(e => e.recettes.length).map(e => e.cle));
    S.banque.filter(b => !dansFichier.has(cleStockee(b))).forEach(b => { if (deRecettes.has(cleStockee(b))) efface++; else retire++; });
    if (!simuler) { ancien = S.banque; S.banque = []; }
  }
  const tous = new Map(banque().map(e => [e.cle, e]));
  lignes.forEach(l => {
    const cle = cleBanque(l.nom), e = tous.get(cle);
    if (!e) {
      ajout++;
      if (simuler) return;
      const b = { nom: l.nom, cle, menage: !!l.menage, rec: !!l.rec };
      if (l.rayon && rayonsDe(b.menage).includes(l.rayon)) b.rayon = l.rayon;
      if (typeof l.placard === "boolean" && !b.menage) b.placard = l.placard;
      if (l.icone) b.icone = l.icone;
      if (l.mc) b.mc = l.mc;
      S.banque.push(b); tous.set(cle, b); return;
    }
    if (mode === "ajout") return;
    const chg = {};
    // Même ingrédient écrit autrement (« carotte » pour « carottes », « Pain » -> « pain ») : on garde la nouvelle écriture
    if (l.nom !== e.nom) Object.assign(chg, { nom: l.nom, nomFixe: true });
    if (l.menage !== undefined && l.menage !== e.menage) chg.menage = l.menage;
    if (l.rec !== undefined && l.rec !== e.rec) chg.rec = l.rec;
    if (l.rayon && l.rayon !== e.rayon && rayonsDe(l.menage ?? e.menage).includes(l.rayon)) chg.rayon = l.rayon;
    if (l.placard !== undefined && !(l.menage ?? e.menage) && l.placard !== e.placard) chg.placard = l.placard;
    if (l.icone !== undefined && (l.icone || null) !== (e.icone || null)) chg.icone = l.icone;  // null = revenir au dessin automatique
    if (l.mc && l.mc !== e.mc) chg.mc = l.mc;
    if (!Object.keys(chg).length) return;
    maj++;
    if (simuler) return;
    let b = entreeDe(cle);
    if (!b) { b = { nom: e.nom, cle, menage: e.menage, rec: false }; S.banque.push(b); }
    Object.assign(b, chg);
    if (b.icone === null) delete b.icone;
  });
  if (ancien) {
    const connus = new Set(banque().map(e => e.cle));
    ancien.filter(b => b.mc && connus.has(cleStockee(b))).forEach(b => {
      const cle = cleStockee(b);
      let n = entreeDe(cle);
      if (!n) { const e = banque().find(x => x.cle === cle); n = { nom: e.nom, cle, menage: e.menage, rec: false }; S.banque.push(n); }
      if (!n.mc) n.mc = b.mc;  // l'image du fichier passe avant
    });
  }
  if (!simuler && (ajout || maj || ancien)) sauverBanque();
  return { ajout, maj, retire, efface };
}

// Recettes relues. Modes : ajout (nouvelles seulement), fusion (+ mises à jour, une case vide ne change rien),
// remplacer (les recettes deviennent celles du fichier : cases vides effacées, recettes absentes supprimées).
function fusion(lignes, simuler, mode = "fusion") {
  const data = S.recettes.map(r => Object.assign({}, r));
  const parId = {}, parNomN = {};
  data.forEach((r, i) => { parId[r.id] = i; parNomN[norm(r.nom)] = i; });
  const touchees = new Set(), vues = new Set();
  const TYPES = Object.fromEntries(COLONNES.map(c => [c[0], c[3]]));
  let ajout = 0, maj = 0;
  lignes.forEach(ligne => {
    const o = Object.assign({}, ligne), vides = o.__vides || [];
    delete o.__vides;
    let i = o.id && parId[o.id] !== undefined ? parId[o.id] : parNomN[norm(o.nom)];
    if ("suggeres" in o) { o.ingredientsSource = o.suggeres ? "suggestion" : "app"; delete o.suggeres; }
    if (i !== undefined) {
      vues.add(i);
      if (mode === "ajout") return;
      const avant = JSON.stringify(data[i]);
      Object.keys(o).forEach(k => { if (k !== "id") data[i][k] = o[k]; });
      if (mode === "remplacer") vides.forEach(k => {
        if (k === "id" || k === "nom" || TYPES[k] === "nombre") return;  // une recette garde toujours ses portions
        if (k === "suggeres") data[i].ingredientsSource = "app";
        else if (TYPES[k] === "oui") data[i][k] = false;
        else if (TYPES[k] === "liste") data[i][k] = [];
        else delete data[i][k];
      });
      if (JSON.stringify(data[i]) === avant) return;  // rien n'a changé
      maj++;
    } else {
      let id = o.id ? idDe(o.id) : idDe(o.nom);
      while (parId[id] !== undefined) id += "-2";
      const r = Object.assign({ vege: false, favori: false, prep: false, date: false, portions: 2, ingredients: [], ingredientsSource: "app" }, o, { id });
      data.push(r); i = data.length - 1;
      parId[id] = parNomN[norm(r.nom)] = i;
      vues.add(i);
      ajout++;
    }
    touchees.add(i);
  });
  const aSuppr = mode === "remplacer" ? data.filter((r, i) => !vues.has(i)) : [];
  if (!simuler) {
    const t = Date.now();
    const aEcrire = [...touchees].map(i => Object.assign(data[i], { maj: t }));
    S.recettes = data.filter(r => !aSuppr.includes(r));
    ecrireRecettes(aEcrire);
    aSuppr.forEach(r => effacerRecette(r.id));
  }
  return { ajout, maj, suppr: aSuppr.length };
}

// Images de l'onglet Ingrédients / Produits ménagers -> icône (texture « mc ») de l'article.
// Comparées pixel à pixel en 32 px : une image déjà dans les textures reprend son nom ; une image identique
// au dessin que l'appli ferait de toute façon ne force rien ; une nouvelle devient la texture « xl_<clé> ».
const signature = src => new Promise(ok => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0, 32, 32);
    const d = new Uint32Array(x.getImageData(0, 0, 32, 32).data.buffer);
    let h = 2166136261; for (const v of d) h = Math.imul(h ^ v, 16777619);
    ok({ h: h >>> 0, url: c.toDataURL("image/png") });
  };
  im.onerror = () => ok(null);
  im.src = src;
});
async function imagesVersTextures(bq) {
  const avecImg = bq.filter(l => l.img);
  if (!avecImg.length) return;
  const parSig = new Map();
  await Promise.all(Object.entries(MC.tex).map(async ([k, v]) => { const s = await signature(v); if (s && !parSig.has(s.h)) parSig.set(s.h, k); }));
  for (const l of avecImg) {
    const s = await signature(l.img); delete l.img;
    if (!s) continue;
    if (parSig.has(s.h)) { l.mc = parSig.get(s.h); continue; }
    const b = entreeDe(cleBanque(l.nom));
    const auto = await signature(await pngDe(ingImg(l.nom, 32, l.icone || (b && b.icone), "", l.menage ?? (b && b.menage))));
    if (auto && auto.h === s.h) continue;  // dessin Foodix (export fait en style Foodix) : rien à figer
    l.mc = "xl_" + cleBanque(l.nom).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    l.tex = s.url;
    parSig.set(s.h, l.mc);
  }
}

// Un onglet absent du fichier ne touche à rien : avant 1.2.0, « Tout remplacer » sans onglet Recettes effaçait toutes les recettes.
const fusionRecettesSi = (lignes, simuler, mode) => lignes.length ? fusion(lignes, simuler, mode) : { ajout: 0, maj: 0, suppr: 0 };
const fusionBanqueSi = (bq, simuler, mode) => bq.length ? fusionBanque(bq, simuler, mode) : { ajout: 0, maj: 0, retire: 0, efface: 0 };

// Réglages › Excel › Restaurer : remet les recettes et la banque d'avant le dernier import (2e appui pour confirmer)
const dateCourte = t => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function restaurerAvantImport(el) {
  const s = S.avantImport; if (!s || !Array.isArray(s.recettes)) return;
  if (!el.dataset.sur) { el.dataset.sur = "1"; el.classList.add("sur"); el.querySelector(".val").textContent = "Confirmer ›"; return; }
  const garde = new Set(s.recettes.map(r => r.id));
  const aSuppr = S.recettes.filter(r => !garde.has(r.id));
  S.recettes = copie(s.recettes);
  ecrireRecettes(S.recettes);
  aSuppr.forEach(r => effacerRecette(r.id));
  S.banque = copie(s.banque || []); sauverBanque();
  fermer(); render();
  toast("Recettes et banque remises au " + dateCourte(s.quand));
}

// Après lecture : un résumé par mode et trois boutons. « Tout remplacer » demande un 2e appui (bouton rouge avec le décompte).
async function importerFichier(fichier) {
  const box = $("#imp");
  box.innerHTML = `<div class="infos">Lecture du fichier…</div>`;
  try {
    const wb = await lireClasseur(fichier);
    const lignes = lireRecettes(wb), bq = lireBanque(wb);
    if (!lignes.length && !bq.length) { box.innerHTML = `<div class="infos">Aucune recette trouvée (il faut une colonne « Nom »).</div>`; return; }
    await imagesVersTextures(bq);
    const res = {};
    ["ajout", "fusion", "remplacer"].forEach(m => { res[m] = { r: fusionRecettesSi(lignes, true, m), b: fusionBanqueSi(bq, true, m) }; });
    importEnAttente = { lignes, bq, res };
    const n = (x, un, plusieurs) => x + " " + (x > 1 ? plusieurs : un);
    const detail = m => {
      const { r, b } = res[m], t = [];
      if (r.ajout) t.push("+" + n(r.ajout, "recette", "recettes"));
      if (b.ajout) t.push("+" + n(b.ajout, "article", "articles"));
      if (m !== "ajout") { if (r.maj) t.push(n(r.maj, "recette modifiée", "recettes modifiées")); if (b.maj) t.push(n(b.maj, "article modifié", "articles modifiés")); }
      if (m === "remplacer") { if (r.suppr) t.push(n(r.suppr, "recette supprimée", "recettes supprimées")); if (b.retire) t.push(n(b.retire, "article retiré", "articles retirés")); if (b.efface) t.push(n(b.efface, "réglage effacé", "réglages effacés")); }
      return t.join(" · ") || "Rien ne change";
    };
    const bouton = (m, titre, cls = "") => `<button class="btn imp-mode ${cls}" data-act="confirmer-import" data-mode="${m}"><b>${titre}</b><small>${detail(m)}</small></button>`;
    box.innerHTML = `<div class="imp-modes">${bouton("ajout", "Ajouter le nouveau", "pri")}${bouton("fusion", "Fusionner")}${bouton("remplacer", "Tout remplacer", "danger-btn")}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="infos">Impossible de lire ce fichier. Est-ce bien un export Excel de Foodix ?</div>`;
  }
}
function confirmerImport(el) {
  if (!importEnAttente) return;
  const mode = el && el.dataset.mode || "fusion";
  const { lignes, bq, res } = importEnAttente;
  if (mode === "remplacer" && !el.dataset.sur) {
    const { r, b } = res.remplacer, t = [];
    if (r.suppr) t.push(`supprimer ${r.suppr} recette${r.suppr > 1 ? "s" : ""}`);
    if (b.retire) t.push(`retirer ${b.retire} article${b.retire > 1 ? "s" : ""}`);
    if (b.efface) t.push(`effacer ${b.efface} réglage${b.efface > 1 ? "s" : ""}`);
    el.dataset.sur = "1";
    el.classList.add("sur");
    el.innerHTML = `<b>Confirmer</b><small>${t.length ? t.join(", ") : "Tout remplacer"}</small>`;
    return;
  }
  const avant = { quand: Date.now(), mode, recettes: copie(S.recettes), banque: copie(S.banque) };
  if (!sauverAvantImport(avant)) return toast("Copie de secours impossible : import annulé");
  S.avantImport = avant;
  const r = fusionRecettesSi(lignes, false, mode);
  // Nouvelles textures venues des images : enregistrées avant la banque qui les cite (sauf « ajout » : articles connus non touchés)
  const neuves = Object.fromEntries(bq.filter(l => l.tex).map(l => [l.mc, l.tex]));
  if (Object.keys(neuves).length) {
    MC.tex = Object.assign({}, MC.tex, neuves); sauverTextures();
    if (styleIcones() !== "perso") ecrireLocal("fx-icones", "perso");  // les images du fichier ne s'affichent qu'en style Minecraft
    appliquerIcones();
  }
  const b = fusionBanqueSi(bq, false, mode);  // après les recettes : les ingrédients des nouvelles recettes sont déjà connus
  importEnAttente = null;
  fermer(); render();
  const t = [`${r.ajout + r.maj} recettes`];
  if (r.suppr) t.push(`${r.suppr} supprimées`);
  if (b.ajout + b.maj) t.push(`${b.ajout + b.maj} articles`);
  toast("Import terminé : " + t.join(", "));
}

/* ---------- 7 bis. Gestes au doigt : changer d’onglet ---------- */
const ORDRE_ONGLETS = ["courses", "recettes", "menu"];
// Change d'onglet : la page part d'un côté et la nouvelle arrive de l'autre (depuisX = où le doigt l'avait laissée)
function changerOnglet(tab, depuisX = 0) {
  if (estPC()) return tab === "recettes" ? render() : montrerPanneau(tab);
  const avant = S.onglet;
  if (!S.pret) { S.onglet = tab; ecrireLocal("fx-onglet", tab); return; }
  if (tab === avant) { window.scrollTo({ top: 0, behavior: animOK() ? "smooth" : "auto" }); return; }
  S.onglet = tab; ecrireLocal("fx-onglet", tab);
  vibrer("pas");
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  placerIndicateur();
  const main = $("#main"), dir = ORDRE_ONGLETS.indexOf(tab) > ORDRE_ONGLETS.indexOf(avant) ? 1 : -1, w = innerWidth;
  const montrer = () => { main.style.transform = ""; render(); window.scrollTo(0, 0); };
  if (!animOK()) return montrer();
  main.animate([{ transform: `translateX(${depuisX}px)`, opacity: 1 }, { transform: `translateX(${-dir * w * .35}px)`, opacity: 0 }],
    { duration: 130, easing: "ease-in" }).onfinish = () => {
    montrer();
    main.animate([{ transform: `translateX(${dir * w * .35}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: DOUX });
  };
}

// 1.2.0 : plus de glisser pour retirer un article (partait trop facilement en magasin) : croix sur chaque ligne.

// Fermer une fenêtre en douceur : elle redescend, le fond s'éclaircit (si rien d'autre ne s'est ouvert entre-temps)
function fermerDoux() {
  const fiche = $("#modal .fiche"), voile = $("#modal .voile");
  if (!fiche || !animOK() || $("#modal").dataset.form || $("#modal").classList.contains("lateral")) return fermer();
  const contenu = $("#modal").firstElementChild;
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete $("#modal").dataset[k]);
  finFicheIng();
  voile.style.pointerEvents = "none";
  voile.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" });
  fiche.animate([{ transform: "none" }, { transform: "translateY(60%)" }], { duration: 180, easing: "ease-in", fill: "forwards" })
    .onfinish = () => { if ($("#modal").firstElementChild === contenu) $("#modal").innerHTML = ""; };
}

/* ---------- 7 ter. Mode « Compléter » (Réglages › Compléter mes recettes) ---------- */
// Comme dans Médiathèque : les recettes incomplètes défilent une par une, comme des cartes.
// Je remplis ce qui manque (tout est enregistré au fur et à mesure), puis je jette la carte :
// à gauche = recette suivante, à droite = retour à la précédente (ou les boutons en bas).
const GROUPES_CP = {
  cat: { nom: "Catégorie", manque: r => !r.categorie },
  ing: { nom: "Ingrédients", manque: r => !(r.ingredients || []).length || r.ingredientsSource === "suggestion" },
  niv: { nom: "Prix, difficulté, temps, maîtrise", manque: r => Object.keys(NIVEAUX).some(k => !r[k]) },
  opt: { nom: "Saison, végé, lunchbox, invités", manque: r => !r.saison }
};
const manquesCp = r => [...S.cp.champs].filter(g => GROUPES_CP[g].manque(r));
const recetteCp = () => S.cp && S.cp.etape === "cartes" ? recette(S.cp.ids[S.cp.i]) : null;

function ouvrirCompleter() {
  fermer();
  S.cp = Object.assign({ champs: new Set(["cat", "ing", "niv", "opt"]) }, S.cp, { etape: "choix", ids: [], i: 0 });
  const ec = document.createElement("div");
  ec.id = "cp-ecran"; ec.className = "bq-ecran cp-ecran";
  ec.innerHTML = `<div class="bq-in">
    <div class="bq-hd"><button class="ib" data-act="cp-fermer" aria-label="Fermer">${icone("left")}</button><h2>Compléter mes recettes</h2><span class="spacer"></span><span class="sub num" id="cp-n"></span></div>
    <div class="cp-corps" id="cp-corps"></div></div>`;
  document.body.appendChild(ec);
  majCp();
}
function fermerCompleter() {
  const ec = $("#cp-ecran"); if (ec) ec.remove();
  S.cp.etape = "ferme"; render();
}

function majCp(force = true) {
  const corps = $("#cp-corps"); if (!corps) return;
  const a = document.activeElement;
  if (!force && a && a.id === "cp-ing") return;   // on ne redessine pas pendant qu'on tape un ingrédient
  $("#cp-n").textContent = S.cp.etape === "cartes" ? `${S.cp.i + 1} / ${S.cp.ids.length}` : "";
  if (S.cp.etape === "choix") {
    const n = S.recettes.filter(r => manquesCp(r).length).length;
    corps.innerHTML = `<div class="cp-choix"><p class="sub">Qu'est-ce que je veux compléter ?</p>
      ${Object.entries(GROUPES_CP).map(([k, g]) => {
        const c = S.recettes.filter(r => g.manque(r)).length;
        return `<button class="rc ${S.cp.champs.has(k) ? "on" : ""}" data-cp-champ="${k}"><span class="cb">${icone("check")}</span><span class="nm">${g.nom}</span><span class="t">${c}</span></button>`;
      }).join("")}
      <button class="btn pri cp-go" data-act="cp-go" ${n ? "" : "disabled"}>${n ? `${icone("right")}Commencer · ${n} recette${n > 1 ? "s" : ""}` : "Tout est complet !"}</button>
      <p class="sub cp-aide">Glisse la carte à gauche pour passer à la suivante, à droite pour revenir.</p></div>`;
    return;
  }
  if (S.cp.etape === "fin") {
    const finies = S.cp.ids.filter(id => { const r = recette(id); return r && !manquesCp(r).length; }).length;
    corps.innerHTML = `<div class="cp-fin"><div class="cp-bravo">${icone("check")}</div><h3>${finies ? "Bravo !" : "C'est tout pour cette fois"}</h3>
      <p class="sub">${finies} recette${finies > 1 ? "s" : ""} complète${finies > 1 ? "s" : ""} sur ${S.cp.ids.length}.</p>
      <div class="pied2"><button class="btn" data-act="cp-retour">${icone("left")}Revenir</button><button class="btn pri" data-act="cp-fermer">Terminer</button></div></div>`;
    return;
  }
  const r = recetteCp();
  if (!r) { S.cp.etape = "fin"; return majCp(); }
  const haut = corps.querySelector(".cp-carte") ? corps.querySelector(".cp-carte").scrollTop : 0;
  const memeCarte = corps.dataset.id === r.id;
  corps.dataset.id = r.id;
  corps.innerHTML = `<div class="cp-pile"><div class="cp-dessous"></div><div class="cp-carte" id="cp-carte">${htmlCarteCp(r)}</div></div>
    <div class="cp-nav"><button class="btn" data-act="cp-prec" ${S.cp.i ? "" : "disabled"}>${icone("left")}Précédente</button>
      <button class="btn pri" data-act="cp-suiv">${S.cp.i < S.cp.ids.length - 1 ? "Suivante" : "Terminer"}${icone("right")}</button></div>`;
  if (memeCarte) $("#cp-carte").scrollTop = haut;
}

function htmlCarteCp(r) {
  const m = manquesCp(r), titre = g => `<div class="cp-t ${m.includes(g) ? "manque" : "ok"}">${m.includes(g) ? "" : icone("check")}${GROUPES_CP[g].nom}</div>`;
  const liste = (k, l) => { if (r[k] && !l.includes(r[k])) l.push(r[k]); return ld("cp-" + k, { lib: NOMS_TAG[k], teinte: TEINTES[k], vide: "—",
    val: () => r[k] || "", items: () => l.map(v => ({ v })), choisir: v => majRecetteCp(x => { if (v) x[k] = v; else delete x[k]; }) }); };
  const parts = [`<div class="cp-hd">${dishImg(r, 52)}<div><h3>${esc(r.nom)}</h3><div class="sub">${m.length ? m.length + " chose" + (m.length > 1 ? "s" : "") + " à compléter" : "Complète !"}</div></div></div>`];
  if (S.cp.champs.has("cat")) parts.push(`<section>${titre("cat")}
    <span class="lbl">Catégorie</span>${liste("categorie", valeursDe("categorie"))}</section>`);
  if (S.cp.champs.has("ing")) {
    const ings = r.ingredients || [];
    parts.push(`<section>${titre("ing")}
      ${r.ingredientsSource === "suggestion" && ings.length ? `<div class="cp-sugg">Ingrédients suggérés, à vérifier <button class="chip on" data-act="cp-ing-ok">${icone("check")}C'est bon</button></div>` : ""}
      <div class="cp-ings">${ings.map((t, i) => `<span class="chip cp-ing">${imgIng(t, 16)}${esc(t)}<button data-cp-ing-x="${i}" aria-label="Retirer">${icone("x")}</button></span>`).join("") || `<span class="sub">Aucun ingrédient.</span>`}</div>
      <label class="cherche" style="margin:0">${icone("plus")}<input id="cp-ing" placeholder="ex. 250 g pâtes" autocomplete="off" enterkeyhint="done"></label>
      <div class="sugg" id="cp-ing-sugg"></div></section>`);
  }
  if (S.cp.champs.has("niv")) parts.push(`<section>${titre("niv")}${Object.keys(NIVEAUX).map(k => `<div class="niv"><span class="lbl">${{ prix: "Prix", difficulte: "Difficulté", temps: "Temps", maitrise: "Maîtrise" }[k]}</span>
    <span class="seg">${NIVEAUX[k].map((l, i) => `<button class="${r[k] === i + 1 ? "on" : ""}" data-cp-niv="${k}" data-v="${i + 1}">${l}</button>`).join("")}</span></div>`).join("")}</section>`);
  if (S.cp.champs.has("opt")) parts.push(`<section>${titre("opt")}
    <span class="lbl">Saison</span>${liste("saison", SAISONS.slice())}
    <div class="cases">${[["vege", "leaf", "Végé"], ["prep", "box", "Lunchbox"], ["date", "glass", "Invités"], ["favori", "star", "Favori"]]
      .map(([k, i, t]) => `<button class="chip ${r[k] ? "on" : ""}" data-cp-case="${k}">${icone(i)}${t}</button>`).join("")}</div></section>`);
  return parts.join("");
}

// Chaque toucher enregistre tout de suite la recette
function majRecetteCp(chg) {
  const r = recetteCp(); if (!r) return;
  chg(r); ecrireRecette(r); vibrer("pas"); majCp(true);
}
function cpIngredient(texte) {
  const v = texte.trim(); if (!v) return;
  majRecetteCp(r => { r.ingredients = [...(r.ingredients || []), v]; r.ingredientsSource = "app"; });
  const c = $("#cp-ing"); if (c) { c.value = ""; $("#cp-ing-sugg").innerHTML = ""; c.focus(); }
}
// En tapant un ingrédient : ceux de la banque qui ressemblent (toucher = ajouter, la quantité tapée reste)
function majSuggCp() {
  const champ = $("#cp-ing"), box = $("#cp-ing-sugg"); if (!champ || !box) return;
  const it = parseItem(champ.value);
  if (!it || norm(it.name).length < 2) { box.innerHTML = ""; return; }
  const q = norm(it.name);
  box.innerHTML = banque().filter(e => !e.menage && norm(e.court).includes(q)).slice(0, 6)
    .map(e => `<button class="chip" data-cp-sugg="${esc(e.court)}">${esc(e.court)}</button>`).join("");
}

// Passer à la carte suivante (sens 1) ou précédente (-1). La carte part du côté où on l'a jetée, la suivante arrive de derrière.
function allerCp(sens, depuisX = 0) {
  const n = S.cp.i + sens;
  if (n < 0) return rebondCp();
  const carte = $("#cp-carte");
  if (document.activeElement && document.activeElement.id === "cp-ing") document.activeElement.blur();
  const changer = () => {
    if (n >= S.cp.ids.length) S.cp.etape = "fin"; else S.cp.i = n;
    majCp();
    const c = $("#cp-carte");
    if (c && animOK()) c.animate([{ transform: `translateX(${sens > 0 ? 0 : -40}px) scale(.94)`, opacity: .3 }, { transform: "none", opacity: 1 }], { duration: 260, easing: DOUX });
  };
  vibrer("carte");
  if (!carte || !animOK()) return changer();
  const w = innerWidth;
  carte.animate([{ transform: `translateX(${depuisX}px) rotate(${depuisX / 22}deg)` }, { transform: `translateX(${-sens * w * 1.2}px) rotate(${-sens * 18}deg)`, opacity: .6 }],
    { duration: 220, easing: "ease-in", fill: "forwards" }).onfinish = changer;
}
function rebondCp() {
  const c = $("#cp-carte"); vibrer("decoche");
  if (c && animOK()) c.animate([{ transform: "translateX(0)" }, { transform: "translateX(18px)" }, { transform: "translateX(0)" }], { duration: 260, easing: RESSORT });
}

// La carte suit le doigt (avec un peu de rotation) ; passé un tiers de l'écran : elle part
let gesteCp = null;
document.addEventListener("touchstart", e => {
  gesteCp = null;
  const carte = e.target.closest && e.target.closest("#cp-carte");
  if (!carte || e.touches.length !== 1 || e.target.closest("input")) return;
  gesteCp = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, t0: Date.now(), h: false, seuil: false, carte };
}, { passive: true });
document.addEventListener("touchmove", e => {
  const g = gesteCp; if (!g) return;
  const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0;
  if (!g.h) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesteCp = null; return; }  // on fait défiler la carte
    if (Math.abs(dx) < 12) return;
    g.h = true;
  }
  e.preventDefault();
  g.dx = dx;
  const x = dx > 0 && !S.cp.i ? dx / 4 : dx;   // pas de carte avant la première : ça résiste
  g.carte.style.transform = `translateX(${x}px) rotate(${x / 22}deg)`;
  g.carte.style.setProperty("--g", Math.max(-1, Math.min(1, x / (innerWidth * .33))));
  g.carte.classList.toggle("vers-g", x < -20); g.carte.classList.toggle("vers-d", x > 20);
  const passe = Math.abs(x) > innerWidth * .33;
  if (passe !== g.seuil) { g.seuil = passe; if (passe) vibrer("seuil"); }
}, { passive: false });
document.addEventListener("touchend", () => {
  const g = gesteCp; gesteCp = null;
  if (!g || !g.h) return;
  const rapide = Math.abs(g.dx) > 60 && Date.now() - g.t0 < 250;
  if (Math.abs(g.dx) > innerWidth * .33 || rapide) return allerCp(g.dx < 0 ? 1 : -1, g.dx);
  const t = g.carte.style.transform;
  g.carte.style.transform = ""; g.carte.classList.remove("vers-g", "vers-d");
  if (animOK()) g.carte.animate([{ transform: t }, { transform: "none" }], { duration: 260, easing: RESSORT });
});

// Clics propres au mode Compléter (renvoie vrai si le clic a été traité)
function clicCompleter(t) {
  if (!$("#cp-ecran")) return false;
  const ch = t.closest("[data-cp-champ]");
  if (ch) { const k = ch.dataset.cpChamp; S.cp.champs.has(k) ? S.cp.champs.delete(k) : S.cp.champs.add(k); vibrer("pas"); majCp(); return true; }
  const niv = t.closest("[data-cp-niv]");
  if (niv) { const k = niv.dataset.cpNiv, v = +niv.dataset.v; majRecetteCp(r => { if (r[k] === v) delete r[k]; else r[k] = v; }); return true; }
  const cas = t.closest("[data-cp-case]");
  if (cas) { const k = cas.dataset.cpCase; majRecetteCp(r => { r[k] = !r[k]; }); return true; }
  const x = t.closest("[data-cp-ing-x]");
  if (x) { const i = +x.dataset.cpIngX; majRecetteCp(r => { r.ingredients = r.ingredients.filter((_, j) => j !== i); r.ingredientsSource = "app"; }); return true; }
  const sg = t.closest("[data-cp-sugg]");
  if (sg) { const c = $("#cp-ing"), it = parseItem(c.value), txt = c.value.trimEnd(); cpIngredient((it ? txt.slice(0, txt.length - it.name.length) : "") + sg.dataset.cpSugg); return true; }
  const el = t.closest("[data-act]");
  switch (el && el.dataset.act) {
    case "cp-go":
      S.cp.ids = S.recettes.filter(r => manquesCp(r).length).sort(parNom).map(r => r.id);
      S.cp.i = 0; S.cp.etape = S.cp.ids.length ? "cartes" : "choix"; vibrer("carte"); majCp(); return true;
    case "cp-suiv": allerCp(1); return true;
    case "cp-prec": allerCp(-1); return true;
    case "cp-retour": S.cp.etape = "cartes"; S.cp.i = S.cp.ids.length - 1; majCp(); return true;
    case "cp-ing-ok": majRecetteCp(r => { r.ingredientsSource = "app"; }); return true;
    case "cp-fermer": fermerCompleter(); return true;
  }
  return false;
}

/* ---------- 8. Clics et démarrage ---------- */

document.addEventListener("click", e => {
  const t = e.target;
  // après un appui long, le clic qui suit ne compte pas
  const lg = t.closest && t.closest("[data-long]");
  if (lg) { delete lg.dataset.long; e.preventDefault(); return; }
  if (t.id === "ic-pop") return fermerIconesIng();   // toucher le fond grisé de la fenêtre des icônes
  if ($("#menu-tri") && !t.closest("#menu-tri") && !t.closest("[data-act='trier']")) fermerTri();
  // le petit menu de l'appui long se ferme au clic suivant (après avoir fait ce qu'on a touché dedans)
  const ml = $("#menu-long"); if (ml) setTimeout(() => ml.remove(), 0);
  if ($("#var-menu") && !$("#var-menu").hidden && !t.closest("#var-menu") && !t.closest("[data-act='var-menu']")) $("#var-menu").hidden = true;
  if (clicLd(t)) return;
  if (clicCompleter(t)) return;
  // PC : le formulaire reste ouvert à côté de la grille ; on ne le remplace pas par mégarde
  if (estPC() && $("#modal").dataset.form && !t.closest("#modal")
    && t.closest("[data-fiche], [data-act='pc-menu'], [data-act='pc-courses'], [data-act='panneau'], [data-act='banque'], [data-act='reglages'], [data-act='nouvelle'], [data-ponglet]")) {
    return toast("Enregistre ou annule d’abord la recette");
  }
  const cat = t.closest("[data-cat]");
  if (cat) {
    if (S.bq.ouvert) fermerBanque();
    const c = cat.dataset.cat;
    S.f.cats = S.f.cats.length === 1 && S.f.cats[0] === c ? [] : [c];
    $("#main").scrollTop = 0; renderRecettes(); renderCote(); return;
  }
  const po = t.closest("[data-ponglet]");
  if (po) return montrerPanneau(po.dataset.ponglet);
  const pcAct = t.closest("[data-act^='pc-'], [data-act='panneau'], [data-act='p-fermer']");
  if (pcAct) {
    const a = pcAct.dataset.act;
    if (a === "pc-recettes") { if (S.bq.ouvert) fermerBanque(); S.f.cats = []; return render(); }
    if (a === "pc-menu") return montrerPanneau("menu");
    if (a === "pc-courses") return montrerPanneau("courses");
    if (a === "p-fermer") return montrerPanneau(null, false);
    if (a === "panneau") return montrerPanneau(null, !panneauOuvert || $("#modal").classList.contains("lateral"));
  }
  const onglet = t.closest("#tabs button");
  if (onglet) return changerOnglet(onglet.dataset.tab);
  const dep = t.closest("[data-deplier]");
  if (dep) { S.basesOuvertes = S.basesOuvertes || new Set(); const k = dep.dataset.deplier; S.basesOuvertes.has(k) ? S.basesOuvertes.delete(k) : S.basesOuvertes.add(k); vibrer("pas"); const fi = $("#modal .fiche"), h = fi ? fi.scrollTop : 0; ouvrirFiche($("#modal").dataset.recette); const f2 = $("#modal .fiche"); if (f2) { f2.style.animation = "none"; f2.parentElement.style.animation = "none"; f2.scrollTop = h; } return; }
  // une famille regroupée dans la liste : on choisit d'abord la variante
  const famL = t.closest("#liste [data-famille]");
  if (famL) return ouvrirChoixVariante(famL.dataset.famille);
  const ligne = t.closest("[data-fiche]");
  if (ligne) {
    S.bq.detail = null; S.bq.suppr = null;   // depuis la fiche d'un ingrédient : la recette la remplace
    const garder = ligne.hasAttribute("data-variante"), fi = $("#modal .fiche");
    if (garder) vibrer("pas");
    ouvrirFiche(ligne.dataset.fiche);
    if (garder && fi) { const f2 = $("#modal .fiche"); f2.style.animation = "none"; f2.parentElement.style.animation = "none"; }
    return;
  }
  const ff = t.closest("[data-ff]");
  if (ff) {
    const k = ff.dataset.ff, y0 = ff.getBoundingClientRect().top;
    S.fOuvert = S.fOuvert === k ? null : k; vibrer("pas"); ouvrirFiltres();
    const n = $(`[data-ff="${k}"]`), fi = $("#modal .fiche"); if (n && fi) fi.scrollTop += n.getBoundingClientRect().top - y0;
    return;
  }
  const ffv = t.closest("[data-ffv]");
  if (ffv) {
    const k = ffv.dataset.ffv, v = NIV_F[k] ? +ffv.dataset.v : ffv.dataset.v, l = S.f[k] = S.f[k] || [], i = l.indexOf(v);
    i >= 0 ? l.splice(i, 1) : l.push(v); vibrer(i >= 0 ? "decoche" : "pas"); renderRecettes(); return ouvrirFiltres();
  }
  const grp = t.closest("[data-grp]");
  if (grp) { const c = grp.dataset.grp; S.replies.has(c) ? S.replies.delete(c) : S.replies.add(c); ecrireLocal("fx-replies", JSON.stringify([...S.replies])); vibrer("pas"); return majListe(); }
  const fc = t.closest("[data-filtre-case]");
  if (fc) { const l = S.f[fc.dataset.filtreCase], v = fc.dataset.v, i = l.indexOf(v); i >= 0 ? l.splice(i, 1) : l.push(v); vibrer("pas"); renderRecettes(); return ouvrirFiltres(); }
  const rf = t.closest("[data-retire-f]");
  if (rf) { const l = S.f[rf.dataset.retireF], i = l.indexOf(rf.dataset.v); if (i >= 0) l.splice(i, 1); vibrer("decoche"); return flip("#liste [data-k]", renderRecettes); }
  const prc = t.closest("[data-repas-alt], [data-repas-opt]");
  if (prc) {
    const o = repasOuvert(); if (!o) return;
    const x = o.l[o.i], tt = prc.dataset.t;
    if (prc.dataset.repasAlt != null) noterChoix(x, tt, "alt", prc.dataset.repasAlt === "1"); else noterChoix(x, tt, "sans", prc.dataset.repasOpt === "non");
    o.save(); vibrer("pas"); render(); ouvrirRepas(o.i, o.src);
    const f = $("#modal .fiche"); if (f) { f.style.animation = "none"; f.parentElement.style.animation = "none"; }
    return;
  }
  const bq = t.closest("[data-base-q] button, [data-alt-q] button, [data-opt-q] button");
  if (bq) { bq.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === bq)); vibrer("pas"); return; }
  const coche = t.closest("[data-coche]");
  if (coche) return cocher(coche.dataset.coche, coche);
  const sugg = t.closest("[data-sugg]");
  if (!t.closest(".ajout-art")) fermerSuggArt();
  const artR = t.closest("[data-art-rayon]");
  if (artR) return rangerArt(artR.dataset.artRayon);
  const artB = t.closest("[data-art-banque]");
  if (artB) { const cle = versLaBanque(artB.dataset.artBanque); fermer(); renderCourses(); return ouvrirFicheBanque(cle); }
  if (sugg) { const e = banque().find(x => x.cle === sugg.dataset.sugg); if (e) { ajouterALaListe(e.nom, e.menage); vibrer("ajout"); flip(zid() + " .it", renderCourses); $("#ajout-art").focus(); } return; }
  const sb = t.closest("[data-sugg-base]");
  if (sb) {
    const li = sb.closest(".li"); majSuggIng(null);
    if (li.classList.contains("ajout")) activerLigneAjout(li);
    li.outerHTML = ligneIngredient("[" + sb.dataset.suggBase + "]");
    majSections(); vibrer("ajout"); $("#f-ings .li.ajout input").focus(); return;
  }
  const suggIng = t.closest("[data-sugg-ing]");
  if (suggIng) return choisirSuggIng(suggIng);
  const rc = t.closest("[data-rc]");
  if (rc) { vibrer(rc.classList.toggle("on") ? "pas" : "decoche"); return; }
  const bqOuvrir = t.closest("[data-bq-ouvrir]");
  if (bqOuvrir) return ouvrirFicheBanque(bqOuvrir.dataset.bqOuvrir);
  const aong = t.closest("[data-asm-ong]");
  if (aong) { S.asm.onglet = aong.dataset.asmOng; vibrer("pas"); majAssembler(); $("#modal .as-corps").scrollTop = 0; return; }
  const asel = t.closest("[data-asm-sel]");
  if (asel) { const id = asel.dataset.asmSel, l = S.asm.sel; l.has(id) ? l.delete(id) : l.add(id); vibrer(l.has(id) ? "coche" : "decoche"); return majAssembler(); }
  const apref = t.closest("[data-asm-pref]");
  if (apref) {
    const r = recette(S.asm.depart), id = apref.dataset.asmPref; if (!r) return;
    const l = r.preferes || [], on = !l.includes(id);
    r.preferes = on ? [...l, id] : l.filter(x => x !== id); if (!r.preferes.length) delete r.preferes;
    if (on) S.asm.sel.add(id);
    ecrireRecette(r); vibrer(on ? "coche" : "decoche"); return majAssembler();
  }
  const vp = t.closest("[data-var-propo]");
  if (vp) { const x = S.propo.repas[+vp.dataset.varPropo], r = recette(vp.dataset.v); if (x && r) { x.id = r.id; if (!veutAccomp(r)) x.side = null; else if (!x.side) x.side = tirerAccomp(accompsPris()); sauverPropo(); vibrer("pas"); renderMenu(); } return; }
  const bqIcone = t.closest("[data-bq-icone]");
  if (bqIcone) { majEntree(S.bq.detail, { icone: bqIcone.dataset.bqIcone }); fermerIconesIng(); return majBanque(); }
  const bqMc = t.closest("[data-bq-mc]");
  if (bqMc) { majEntree(S.bq.detail, { mc: bqMc.dataset.bqMc }); fermerIconesIng(); return majBanque(); }
  const retArt = t.closest("[data-retirer-art]");
  if (retArt) return retirerArticle(retArt.dataset.retirerArt);
  const msq = t.closest("[data-masquer]");  // croix au survol de la souris (PC) : comme glisser au doigt
  if (msq) return masquer(msq.dataset.masquer);
  const repas = t.closest("[data-repas]");
  if (repas) return ouvrirRepas(+repas.dataset.repas, repas.dataset.src);
  const pick = t.closest("[data-bq-pick]");
  if (pick) return basculerPick(pick.dataset.bqPick);
  const repris = t.closest("[data-repris]");
  if (repris) return reprendre(repris);
  const choisi = t.closest("[data-choisi]");
  if (choisi) return choisirPlat(choisi.dataset.choisi);
  const pref = t.closest("[data-pref]");
  if (pref) { const k = pref.dataset.pref; S.prefs[k] = !S.prefs[k]; sauverPrefs(); vibrer("pas"); return renderMenu(); }
  const bascule = t.closest("[data-bascule]");
  if (bascule) { const k = bascule.dataset.bascule; S.f[k] = !S.f[k]; vibrer("pas"); return flip("#liste [data-k]", renderRecettes); }
  if ($("#modal").dataset.form && clicFormulaire(t)) return;
  const el = t.closest("[data-act]");
  // Menu ⋯ ouvert : un clic n'importe où ailleurs le referme
  const m3 = $("#menu3");
  if (m3 && !m3.hidden && (!el || el.dataset.act !== "menu3")) m3.hidden = true;
  if (!el) return;
  switch (el.dataset.act) {
    case "nouveau-menu": nouveauMenu(); break;
    case "bases-ok": if ($("#modal").suite) $("#modal").suite(); break;
    case "accepter": accepter(+el.dataset.i); break;
    case "accepter-tout": accepterTout(); break;
    case "choisir-plat": ouvrirChoix(); break;
    case "nouvelle-liste": nouvelleListe(); break;
    case "liste-garder": nouvelleListeChoix(true); break;
    case "liste-zero": nouvelleListeChoix(false); break;
    case "archive": ouvrirArchive(); break;
    case "restaurer": restaurerArchive(); break;
    case "parcourir": ouvrirBanque(true); break;
    case "ajouter-art": ajouterArticle(); break;
    case "art-banque": ajouterArticle(true); break;
    case "bq-menage-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { menage: !e.menage, rayon: "" }); majBanque(); } break; }
    case "banque": ouvrirBanque(); break;
    case "completer": ouvrirCompleter(); break;
    case "ajouter-banque": ajouterDepuisBanque(); break;
    case "bqa-type": bqa.menage = !!el.dataset.v; bqa.rayon = ""; majAjoutBanque(); break;
    case "bqa-rayon": bqa.rayon = el.dataset.v; majAjoutBanque(); break;
    case "bqa-ok": validerAjoutBanque(); break;
    case "bq-onglet": S.bq.onglet = el.dataset.v; majBanque(); break;
    case "bq-rec": S.bq.rec = !S.bq.rec; majBanque(); break;
    case "bq-placard": S.bq.placard = !S.bq.placard; majBanque(); break;
    case "bq-placard-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { placard: !e.placard }); majBanque(); } break; }
    case "dispo": vibrer(el.dataset.v === "oui" ? "coche" : "pas"); definirDispo(el.dataset.cle, el.dataset.v); break;
    case "remettre-masques": remettreMasques(); break;
    case "courses-plus": menuCourses(el); break;
    case "placard-remettre": { const m = menuEnCours(); if (m && m.dispo) { for (const k in m.dispo) if (m.dispo[k] === "oui") delete m.dispo[k]; ecrireMenu(m); renderCourses(); } break; }
    case "compact": S.compact = !S.compact; ecrireLocal("fx-compact", S.compact ? "1" : ""); vibrer("pas"); renderCourses(); break;
    case "bq-retour": retourBanque(); break;
    case "bq-rec-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { rec: !e.rec }); majBanque(); } break; }
    case "bq-icones": ouvrirIconesIng(); break;
    case "ic-fermer": fermerIconesIng(); break;
    case "bq-liste": { const e = banque().find(x => x.cle === S.bq.detail); if (e) basculerListe(e); break; }
    case "bq-suppr":
      if (S.bq.suppr === S.bq.detail) supprimerIngredient(S.bq.detail);
      else { S.bq.suppr = S.bq.detail; majBanque(); }
      break;
    case "nb": changerNombre(+el.dataset.v); break;
    case "pers": changerPersonnes(+el.dataset.v); break;
    case "fait": cocherFait(+el.dataset.i); break;
    case "remplacer": remplacer(); break;
    case "choisir": ouvrirChoix($("#modal").dataset.rep); break;
    case "accomp": case "asm-repas": { const o = repasOuvert(); if (o) { const x = o.l[o.i]; ouvrirAssembler(x.id, accompsDe(x), o.i, o.src); } break; }
    case "voir": { const o = repasOuvert(); if (o) ouvrirFiche(o.l[o.i].id); break; }
    case "retirer": retirer(); break;
    case "au-menu": auMenu(); break;
    case "nouvelle": nouvelle(); break;
    case "menu3": $("#menu3").hidden = !$("#menu3").hidden; break;
    case "modifier": modifier(); break;
    case "form-icone": atelierFormulaire(); break;
    case "rec-icone": { const id = $("#modal").dataset.recette, r = S.recettes.find(x => x.id === id); if (r) atelierPour("r:" + id, r.nom, r, () => ouvrirFiche(id)); break; }
    case "ing-atelier": { const e = banque().find(x => x.cle === S.bq.detail); fermerIconesIng(); if (e) atelierPour("i:" + e.cle, e.court || e.nom, null, majBanque); break; }
    case "dupliquer": dupliquer(); break;
    case "variante": nouvelleVariante(); break;
    case "assembler": ouvrirAssembler($("#modal").dataset.recette); break;
    case "asm-menu": assemblerAuMenu(); break;
    case "asm-garder": assemblerGarder(); break;
    case "filtres": ouvrirFiltres(); break;
    case "filtres-effacer": FAMILLES_F.forEach(([k]) => { S.f[k] = []; }); renderRecettes(); ouvrirFiltres(); break;
    case "supprimer": supprimer(); break;
    case "enregistrer": enregistrer(); break;
    case "ajout-ing": ajouterIngredient(); break;
    case "retirer-ing": el.closest(".li").remove(); majSections(); vibrer("retire"); break;
    case "ajout-section": ajouterSection(); break;
    case "plus": {
      const ouvert = $("#f-plus").hidden;
      fermerLd(); vibrer("pas");
      $("#f-plus").hidden = !ouvert;
      el.setAttribute("aria-expanded", ouvert);
      el.querySelector(".lib").textContent = ouvert ? "Moins de détails" : "Plus de détails";
      break;
    }
    case "fo-variante": $("#fo-var") ? fermerVariante() : ouvrirVariante(); vibrer("pas"); break;
    case "fo-var-ok": fermerVariante(); vibrer("coche"); break;
    case "fo-sans-var": S.fo.famille = ""; S.fo.variante = ""; fermerVariante(); vibrer("decoche"); break;
    case "fo-continuer": $("#fo-pied").innerHTML = piedFormulaire(); break;
    case "portions": {
      const n = Math.min(12, Math.max(1, +$("#f-portions").textContent + +el.dataset.v));
      $("#f-portions").textContent = n; vibrer("pas");
      break;
    }
    case "connexion": seConnecter(el); break;
    case "deconnexion": deconnecter(); break;
    case "recharger": location.reload(); break;
    case "aller-recettes": changerOnglet("recettes"); break;
    case "reglages": ouvrirReglages(); break;
    case "themes": ouvrirThemes(); break;
    case "icones": ouvrirIcones(); break;
    case "icones-style": ecrireLocal("fx-icones", el.dataset.v); appliquerIcones(); render(); ouvrirIcones(); break;
    case "tex-effacer": effacerTextures(); break;
    case "idees": NotesIdees.ouvrir(S.idees, sauverIdees); break;
    case "theme": ecrireLocal("fx-theme", el.dataset.v); appliquerTheme(); ouvrirThemes(); break;
    case "vibr": ecrireLocal("fx-vibr", el.dataset.v); vibrer("coche"); ouvrirReglages(); break;
    case "anim": ecrireLocal("fx-anim", el.dataset.v); document.documentElement.dataset.anim = el.dataset.v; ouvrirReglages(); break;
    case "exporter": exporter(el); break;
    case "confirmer-import": confirmerImport(el); break;
    case "restaurer-import": restaurerAvantImport(el); break;
    case "favori": basculerFavori(); break;
    case "var-menu": { const vm = $("#var-menu"); if (vm) { vm.hidden = !vm.hidden; vibrer("pas"); } break; }
    case "trier": ouvrirTri(el); break;
    case "tri": choisirTri(el.dataset.v); break;
    case "tri-reset": choisirTri("categorie"); break;
    case "regroupe": S.regroupe = !S.regroupe; ecrireLocal("fx-regroupe", S.regroupe ? "1" : "0"); vibrer("pas"); fermerTri(); majListe(); break;
    case "nouvelle-q": nouvelle(S.f.q.trim().replace(/^./, c => c.toUpperCase())); break;
    case "ordre-cats": ouvrirOrdreCats(); break;
    case "ordre-defaut": delete S.prefs.ordreCats; sauverPrefs(); vibrer("pas"); ouvrirOrdreCats(); break;
    case "effacer-q": S.f.q = ""; renderRecettes(); break;
    case "fermer": if (formModifie() && !el.dataset.force) { demanderAbandon(); break; }
      if ($("#modal").dataset.filtres) { delete $("#modal").dataset.filtres; flip("#liste [data-k]", renderRecettes); } fermerDoux(); break;
    case "fermer-fond": if (t === el) { delete $("#modal").dataset.filtres; fermerDoux(); } break; // toucher le fond grisé ferme, pas la fiche elle-même
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "fichier" && e.target.files[0]) importerFichier(e.target.files[0]);
  if (e.target.id === "f-tex" && e.target.files.length) importerTextures([...e.target.files]);
  if (e.target.id === "bq-nom") renommerIngredient(S.bq.detail, e.target.value);
});
// Revenir dans la case d'ajout rouvre la liste déroulante (elle se ferme quand on touche ailleurs)
document.addEventListener("focusin", e => { if (e.target.id === "ajout-art") majSuggArt(); });
document.addEventListener("input", e => {
  if (e.target.id === "q") { S.f.q = e.target.value; majListe(); }
  if (e.target.id === "q-choix") majChoix();
  if (e.target.id === "ajout-art") majSuggArt();
  if (e.target.id === "q-bq") majBanque();
  if (e.target.id === "tex-q") { texQ = e.target.value; $("#tex-grille").innerHTML = grilleTex(); }
  if (e.target.id === "cp-ing") majSuggCp();
  if (e.target.id === "f-variante") { S.fo.variante = e.target.value; majSousTitre(); }
  // En tapant un ingrédient, son petit dessin se met à jour
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li && li.classList.contains("ajout") && e.target.value.trim()) activerLigneAjout(li);
  if (li && !li.classList.contains("sect") && li.querySelector("img")) {
    li.querySelector("img").outerHTML = dessinIng(e.target.value); majSuggIng(li);
    li.classList.toggle("opt", estOptionnel(e.target.value));
    const tg = li.querySelector(".li-tag"); if (tg) tg.outerHTML = etiquetteIng(e.target.value);
  }
});
// Les suggestions suivent la ligne où l'on écrit, et disparaissent quand on la quitte
document.addEventListener("focusin", e => {
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li && e.target.tagName === "INPUT") majSuggIng(li);
});
document.addEventListener("focusout", e => {
  if (!(e.target.closest && e.target.closest("#f-ings .li"))) return;
  setTimeout(() => { if (!(document.activeElement && document.activeElement.closest("#f-ings .li"))) majSuggIng(null); }, 150);
});
// Appui long (450 ms sans bouger) : ce qui est appuyé reçoit data-long, pour que le clic qui suit soit ignoré
function appuiLong(selecteur, action) {
  let t = null, x = 0, y = 0;
  const stop = () => { if (t) { clearTimeout(t); t = null; } };
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest && e.target.closest(selecteur); if (!el) return;
    x = e.clientX; y = e.clientY; stop();
    t = setTimeout(() => { t = null; el.dataset.long = "1"; vibrer("pas"); action(el); setTimeout(() => delete el.dataset.long, 800); }, 450);
  });
  document.addEventListener("pointermove", e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  ["pointerup", "pointercancel", "scroll"].forEach(ev => document.addEventListener(ev, stop, true));
  document.addEventListener("contextmenu", e => { if (e.target.closest && e.target.closest(selecteur)) e.preventDefault(); });
}
// La bulle : de la couleur de l'étiquette, avec le nombre de recettes ; jamais hors de l'écran (la flèche reste sur l'icône)
const NB_ICO = { fav: r => r.favori, vege: r => r.vege, saison: r => deSaison(r), avance: r => r.prep, invites: r => r.date };
appuiLong(".barre-r [data-bascule]", el => {
  document.querySelectorAll(".bulle-l").forEach(x => x.remove());
  const k = el.dataset.bascule, n = S.recettes.filter(NB_ICO[k]).length, b = el.getBoundingClientRect();
  const bu = document.createElement("div"); bu.className = "bulle-l"; bu.dataset.teinte = k;
  bu.innerHTML = `${el.innerHTML}<span>${esc(el.dataset.nom)}</span><small>· ${n} recette${n > 1 ? "s" : ""}</small><i></i>`;
  document.body.appendChild(bu);
  const w = bu.offsetWidth, cx = b.left + b.width / 2, gauche = Math.min(Math.max(cx - w / 2, 8), innerWidth - w - 8);
  bu.style.left = gauche + "px"; bu.style.top = (b.top - bu.offsetHeight - 10) + "px";
  bu.querySelector("i").style.left = (cx - gauche - 5) + "px";
  setTimeout(() => bu.remove(), 1800);
});
appuiLong(".bq-t[data-bq-ouvrir]", commanderBanque);
// Courses : toucher le nom d'un article ne fait rien (seule la case coche, choix du propriétaire) ; l'appui long ouvre sa fiche
appuiLong(".it [data-art-fiche]", el => ouvrirArtFiche(el.dataset.artFiche));
// Appui long sur l'onglet Recettes : Ingrédients (la banque) et Nouvelle recette
appuiLong('#tabs button[data-tab="recettes"]', el => {
  const b = el.getBoundingClientRect(), m = document.createElement("div");
  m.id = "menu-long"; m.className = "menu-tri menu-long";
  m.innerHTML = `<button data-act="banque">${icone("carrot")}<span>Ingrédients<small>La banque d'ingrédients</small></span></button><button data-act="nouvelle">${icone("plus")}<span>Nouvelle recette</span></button>`;
  document.body.appendChild(m);
  m.style.left = Math.min(Math.max(b.left + b.width / 2 - m.offsetWidth / 2, 8), innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = (b.top - m.offsetHeight - 8) + "px";
});
// Formulaire sur téléphone : pendant qu'on tape, le pied (Annuler / Enregistrer) laisse sa place au clavier
const tactile = matchMedia("(pointer: coarse)");
const champFo = el => el && el.matches && el.matches(".fo-corps input, .fo-corps textarea");
document.addEventListener("focusin", e => { if (tactile.matches && champFo(e.target) && $(".fo") && !$(".fo-abandon")) $(".fo").classList.add("clavier"); });
document.addEventListener("focusout", () => setTimeout(() => { const f = $(".fo"); if (f && !champFo(document.activeElement)) f.classList.remove("clavier"); }, 60));
// Android : fermer le clavier (flèche du bas) ne fait pas perdre le champ (pas de focusout), le pied restait caché.
// On repère le clavier à la hauteur de la fenêtre (interactive-widget=resizes-content) : revenue à sa taille = clavier fermé.
let hautMax = innerHeight, clavierVu = false;
addEventListener("resize", () => {
  hautMax = Math.max(hautMax, innerHeight);
  const f = $(".fo"); if (!f || !f.classList.contains("clavier")) { clavierVu = false; return; }
  if (innerHeight < hautMax * .8) { clavierVu = true; return; }
  if (!clavierVu) return;
  clavierVu = false; f.classList.remove("clavier");
  if (champFo(document.activeElement)) document.activeElement.blur();
});
// Toucher une suggestion ne doit pas faire perdre le champ en cours (le clavier reste ouvert)
document.addEventListener("mousedown", e => { if (e.target.closest && e.target.closest(".sugg-ing, #sugg-art")) e.preventDefault(); });
document.addEventListener("keydown", e => {
  // Listes de l'appli : Entrée valide la nouvelle valeur, Échap referme
  if (e.key === "Enter" && e.target.matches && e.target.matches("[data-ld-txt]")) { e.preventDefault(); ldValider(); return; }
  if (e.key === "Escape" && ldOuvert) { fermerLd(); return; }
  if (e.key === "Enter" && e.target.id === "f-variante") { e.preventDefault(); fermerVariante(); return; }
  // Entrée dans un ingrédient : nouvelle ligne juste en dessous (comme une liste au clavier)
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li && e.key === "Enter") { e.preventDefault(); ajouterIngredient(li); return; }
  if (e.key === "Enter" && e.target.id === "ajout-art") { e.preventDefault(); ajouterArticle(); return; }
  if (e.key === "Enter" && e.target.id === "q-bq") { e.preventDefault(); ajouterDepuisBanque(); return; }
  if (e.key === "Enter" && e.target.id === "cp-ing") { e.preventDefault(); cpIngredient(e.target.value); return; }
  if (e.key === "Escape" && $("#cp-ecran")) { fermerCompleter(); return; }
  if (e.key === "Enter" && e.target.id === "bq-nom") { e.preventDefault(); e.target.blur(); return; }
  if (e.key === "Enter" && e.target.id === "bqa-nom") { e.preventDefault(); validerAjoutBanque(); return; }
  // Échap ferme une fiche, mais pas le formulaire (pour ne pas perdre une saisie)
  if (e.key === "Escape" && $("#modal").innerHTML && !$("#modal").dataset.form) fermer();
  else if (e.key === "Escape" && S.bq.ouvert && !$("#modal").innerHTML) retourBanque();
});

/* ---------- Bouton Retour d'Android ---------- */
// Le navigateur a un « historique » (la pile des pages visitées). Retour = dépiler une page.
// Dès qu'une fenêtre ou un écran s'ouvre, on empile des fausses pages : chaque Retour en dépile une
// et ferme la fenêtre du dessus, au lieu de quitter l'appli. Rien d'ouvert : Retour quitte, comme d'habitude.
// (Un « observateur » regarde la page changer, ce qui évite de toucher à chaque fonction qui ouvre quelque chose.)
// Piège (1.0.1) : Chrome saute au Retour une page ajoutée sans toucher l'écran. Re-empiler après un Retour
// (formulaire « Encore Retour », sous-écran) faisait donc quitter l'appli au Retour suivant.
// D'où une réserve de pages, posée seulement juste après un toucher (userActivation).
const RESERVE = 3;
let pile = (history.state && history.state.fx) || 0, ignorerPop = false, retourFormT = 0;
const quelqueChoseOuvert = () => !!($("#modal").innerHTML || S.bq.ouvert || $("#cp-ecran") || $(".ni-ecran") || $("#menu-tri") || $("#menu-long") || $("#ic-pop") || atelierOuvert());
function majGardeRetour() {
  if (ignorerPop) return;
  const ouvert = quelqueChoseOuvert(), touche = !navigator.userActivation || navigator.userActivation.isActive;
  if (ouvert && pile < RESERVE && touche) while (pile < RESERVE) history.pushState({ fx: ++pile }, "");
  else if (!ouvert && pile > 0) { ignorerPop = true; const n = pile; pile = 0; history.go(-n); } // fermé par un bouton : on retire les fausses pages
}
function fermerDessus() {
  // petits menus d'abord (tri, appui long, ⋯, variantes, listes du formulaire)
  if (atelierOuvert()) return fermerAtelier();
  if ($("#ic-pop")) return fermerIconesIng();
  if ($("#menu-tri")) return fermerTri();
  if ($("#menu-long")) return $("#menu-long").remove();
  const petit = ["#menu3", "#var-menu"].map(s => $(s)).find(m => m && !m.hidden);
  if (petit) { petit.hidden = true; return; }
  if (ldOuvert) return fermerLd();
  const notes = $(".ni-ecran [data-ni='retour']");
  if (notes) return notes.click();
  const md = $("#modal");
  if (md.innerHTML) {
    const retour = md.querySelector(".retour");  // sous-écran (ex. Thème) : on remonte d'un cran
    if (retour) return retour.click();
    if (md.dataset.form && Date.now() - retourFormT > 3000) {  // formulaire : pour ne pas perdre la saisie, il faut appuyer deux fois
      retourFormT = Date.now();
      return toast("Encore Retour pour abandonner la saisie");
    }
    if (md.dataset.form) return fermer();
    const x = md.querySelector('[data-act="fermer"]');
    return x ? x.click() : fermer();
  }
  if ($("#cp-ecran")) return fermerCompleter();
  if (S.bq.ouvert) return retourBanque();
}
window.addEventListener("popstate", () => {
  const n = (history.state && history.state.fx) || 0;
  if (ignorerPop) { ignorerPop = false; pile = n; setTimeout(majGardeRetour, 50); return; }
  pile = n;
  fermerDessus();
  setTimeout(majGardeRetour, 50); // encore quelque chose d'ouvert : on complète la réserve si on vient de toucher l'écran
});
let gardeRetourPrevue = false;
new MutationObserver(() => {
  if (gardeRetourPrevue) return;
  gardeRetourPrevue = true;
  setTimeout(() => { gardeRetourPrevue = false; majGardeRetour(); }, 30);
}).observe(document.body, { childList: true, subtree: true });

// Le « gardien » hors ligne (service worker) : garde une copie des fichiers de l'appli
// et installe tout seul les nouvelles versions.
if ("serviceWorker" in navigator && !MODE_DEMO && location.protocol === "https:") {
  // updateViaCache "none" : toujours demander sw.js au serveur pour savoir s'il y a du neuf
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    // Sur Android l'appli reste ouverte en arrière-plan : on vérifie à chaque retour dessus
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {}); // pas de gardien possible : l'appli marche quand même
  // Nouvelle version installée : on recharge une fois (pas à la 1re installation),
  // en attendant que je ne sois pas en train de faire quelque chose
  // (fiche ouverte, banque, Notes, « Compléter », ou une case où je tape).
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let dejaRecharge = false;
  const occupe = () => {
    const a = document.activeElement;
    return !!$("#modal").innerHTML || S.bq.ouvert || !!$(".ni-ecran") || !!$("#cp-ecran")
      || !!(a && (a.matches("input, textarea, select") || a.isContentEditable));
  };
  const recharger = () => {
    if (dejaRecharge) return;
    if (occupe()) return setTimeout(recharger, 3000);
    dejaRecharge = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (avaitUneVersion) recharger(); });
}

// Mode démo uniquement : accès pour les tests automatiques (préparer et vérifier un fichier Excel)
if (MODE_DEMO) window.foodixTest = { S, lireBanque, fusionBanque, banque, classeurRecettes, lireRecettes, fusion, render, candidats, articles, cocher, masquer, dejaPris, estMasque, menuEnCours, listeEnCours, repasListe, renderCourses };

appliquerIcones();
if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();

// Le placard replié/ouvert reste comme on l'a laissé quand la liste se redessine
document.addEventListener("toggle", e => {
  const c = e.target.classList; if (!c) return;
  if (c.contains("panier")) S.panierOuvert = e.target.open;   // le panier porte aussi la classe placard (même style)
  else if (c.contains("placard")) S.placardOuvert = e.target.open;
}, true);
