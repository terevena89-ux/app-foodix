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

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur } from "./excel-style.js";
import { norm, parseItem, keyOf, aisleOf, auPlacard, rayonMenage, aisleLabel, AISLE_ORDER, AISLES_FOOD, RAYONS_MENAGE, ICONES, fmtQty, ingImg, dishImg } from "./pixel.js";

/* ---------- 1. Réglages de base ---------- */

const VERSION = "0.6.0";
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
  ["id", "ID", 30], ["nom", "Nom", 34], ["categorie", "Catégorie", 16], ["proteine", "Protéine", 16],
  ["saison", "Saison", 10], ["origine", "Origine", 15], ["preparation", "Préparation", 13],
  ["vege", "Végé", 8, "oui"], ["favori", "Favori", 8, "oui"], ["prep", "À l'avance", 11, "oui"], ["date", "Invités", 9, "oui"],
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
  idees: "",                              // Réglages › Notes : idées d'amélioration (synchronisées)
  onglet: lireLocal("fx-onglet", "courses"),
  // filtres de l'écran Recettes
  f: { q: "", cat: "", prot: "", fav: false, vege: false, saison: false, avance: false, invites: false }
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

function ecrireMenu(m) {
  m.maj = Date.now();
  if (MODE_DEMO) return sauverDemo();
  setDoc(doc(collMenus(), m.id), m).catch(erreurEcriture);
}
function effacerMenu(id) {
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
// Banque d'ingrédients. On écrit aussi « toujours » (vidé) : l'ancien réglage est repris dans la banque.
function sauverBanque() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { banque: S.banque, toujours: S.toujours }, { merge: true }).catch(erreurEcriture);
}

const lirePropo = p => ({ repas: p && Array.isArray(p.repas) ? p.repas : [] });

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
  S.idees = d.idees || "";
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
    if (JSON.stringify(recu) !== JSON.stringify(S.recettes)) { S.recettes = recu; rerendre(); }
    if (!S.pret) { S.pret = true; render(); }
  }, err => { console.error(err); toast("Accès refusé aux données"); }));
  arrets.push(onSnapshot(collMenus(), snap => {
    const recu = snap.docs.map(d => d.data()).sort((a, b) => a.cree - b.cree);
    if (JSON.stringify(recu) !== JSON.stringify(S.menus)) { S.menus = recu; rerendre(); }
  }, err => console.error(err)));
  arrets.push(onSnapshot(refDonnees(), snap => {
    const d = snap.exists() ? snap.data() : {};
    const p = Object.assign({}, PREFS_DEFAUT, d.prefs);
    const tj = d.toujours || [], bq = d.banque || [], pr = lirePropo(d.propo), hi = (d.histo || []).map(x => x.ids || []);
    S.idees = d.idees || ""; NotesIdees.maj(S.idees); // un autre appareil a pu changer les notes
    if (JSON.stringify(p) !== JSON.stringify(S.prefs) || JSON.stringify(tj) !== JSON.stringify(S.toujours) || JSON.stringify(bq) !== JSON.stringify(S.banque)
      || JSON.stringify(pr) !== JSON.stringify(S.propo) || JSON.stringify(hi) !== JSON.stringify(S.histo)) {
      S.prefs = p; S.toujours = tj; S.banque = bq; S.propo = pr; S.histo = hi;
      migrerToujours();
      rerendre();
    }
  }, err => console.error(err)));
}

function demarrerFirebase() {
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

async function seConnecter(btn) {
  const fournisseur = new GoogleAuthProvider();
  btn.disabled = true;
  try {
    await signInWithPopup(auth, fournisseur);
  } catch (e) {
    // Fenêtre de connexion bloquée : on passe par une redirection
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, fournisseur);
    else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast("Connexion impossible (" + e.code + ")");
  } finally { btn.disabled = false; }
}

/* ---------- 3. Utilitaires ---------- */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icone = (nom, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24"><use href="#i-${nom}"/></svg>`;
function lireLocal(k, defaut) { try { return localStorage.getItem(k) || defaut; } catch (e) { return defaut; } }
function ecrireLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué : vaut pour cette fois */ } }
const parNom = (a, b) => a.nom.localeCompare(b.nom, "fr");
// Identifiant tiré du nom : « Bœuf bourguignon » -> « boeuf-bourguignon » (jamais de « / »)
const idDe = nom => norm(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recette";

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
const SAISON = (() => { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9 ? "ete" : "hiver"; })();
function deSaison(r) {
  const s = norm(r.saison);
  return !s || s === "annuel" || s === SAISON || (s === "automne" && SAISON === "hiver") || (s === "printemps" && SAISON === "ete");
}

/* ---------- 4. Affichage général ---------- */

// Redessine sans gêner une saisie en cours (ex. la recherche)
function rerendre() {
  if (!S.pret) return;
  const a = document.activeElement;
  if (a && a.id === "q") { majListe(); return; }
  render();
  // la fiche ouverte suit les changements (mais on ne touche jamais au formulaire en cours de saisie)
  if ($("#modal").dataset.recette && !$("#modal").dataset.form) ouvrirFiche($("#modal").dataset.recette);
  if (S.bq.ouvert) majBanque();
}

function render() {
  const m = menuEnCours();
  const titres = {
    menu: ["Menu", S.propo.repas.length ? S.propo.repas.length + " proposition" + (S.propo.repas.length > 1 ? "s" : "") : ""],
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

/* ---------- 4 bis. Menu : des propositions de plats ---------- */
// Pas de jours ni de semaines : « Nouveau menu » propose N plats tirés au sort (S.propo).
// Rien n'arrive dans la liste de courses avant d'avoir accepté un plat (ou tous d'un coup).
// Une proposition = { id: recette, side: accompagnement ou null } ;
// un plat de la liste = { id, side, fait: true/false } (fait = cuisiné : ses ingrédients sortent de la liste).

// La liste de courses en cours = la dernière de S.menus ; celle d'avant = l'archive (« Liste précédente »).
const menuEnCours = () => S.menus[S.menus.length - 1] || null;
const listeArchive = () => S.menus.length > 1 ? S.menus[S.menus.length - 2] : null;
const recette = id => S.recettes.find(r => r.id === id);
const estPlat = r => /plat complet|principal/.test(norm(r.categorie));
const estAccomp = r => /accompagnement/.test(norm(r.categorie));
const veutAccomp = r => /principal/.test(norm(r.categorie));
// Les plats déjà pris : propositions + liste en cours (pour ne pas proposer deux fois le même)
const platsPris = () => [...S.propo.repas.map(x => x.id), ...((menuEnCours() || {}).repas || []).map(x => x.id)];
const accompsPris = () => [...S.propo.repas, ...((menuEnCours() || {}).repas || [])].map(x => x.side).filter(Boolean);

// Les plats que le tirage peut proposer (de saison, et selon Végé / Rapide)
function candidats() {
  const p = S.prefs;
  return S.recettes.filter(r => estPlat(r) && deSaison(r) && (!p.vege || r.vege) && (!p.rapide || !r.temps || r.temps <= 1));
}
// Plats des listes récentes (en cours, précédente, et les 2 d'avant gardées dans S.histo) : ils sortiront moins souvent
function recents() {
  const ids = new Set();
  S.menus.slice(-2).forEach(m => m.repas.forEach(x => { ids.add(x.id); if (x.side) ids.add(x.side); }));
  S.histo.forEach(l => l.forEach(id => ids.add(id)));
  return ids;
}
// Tirage au sort « pondéré » : chaque plat a un poids, plus il est lourd, plus il a de chances de sortir
function poids(r, deja, recent) {
  const p = S.prefs;
  let w = 1;
  if (r.favori) w *= 2.5;                                    // favoris : plus souvent
  if (recent.has(r.id)) w *= 0.12;                           // servi récemment : beaucoup moins
  if (r.proteine && deja.some(id => norm(recette(id)?.proteine) === norm(r.proteine))) w *= 0.45; // varier les protéines
  if (p.avance && r.prep) w *= 2.5;                          // pastille « À l'avance »
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
  const recent = recents();
  return tirer(candidats().filter(r => !deja.includes(r.id)), r => poids(r, deja, recent));
}
// Un accompagnement de saison (favoris ×2), différent de ceux déjà pris
function tirerAccomp(exclus = []) {
  const r = tirer(S.recettes.filter(x => estAccomp(x) && deSaison(x) && !exclus.includes(x.id)), x => x.favori ? 2 : 1);
  return r ? r.id : null;
}
// Une proposition : { id: recette, side: accompagnement ou null }
const nouveauRepas = r => ({ id: r.id, side: veutAccomp(r) ? tirerAccomp(accompsPris()) : null });

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
  sauverPropo(); render();
  toast("Nouvelles propositions", () => { S.propo.repas = avant; sauverPropo(); render(); });
}

// Accepter une proposition (ou toutes) : le plat passe dans la liste de courses
function accepter(i) {
  const x = S.propo.repas[i]; if (!x) return;
  const m = listeEnCours();
  S.propo.repas.splice(i, 1);
  m.repas.push({ id: x.id, side: x.side || null, fait: false });
  sauverPropo(); ecrireMenu(m); fermer(); render();
  toast("Ajouté à la liste", () => { m.repas.pop(); S.propo.repas.splice(i, 0, x); sauverPropo(); ecrireMenu(m); render(); });
}
function accepterTout() {
  const l = S.propo.repas; if (!l.length) return;
  const m = listeEnCours(), n = m.repas.length;
  l.forEach(x => m.repas.push({ id: x.id, side: x.side || null, fait: false }));
  S.propo.repas = [];
  sauverPropo(); ecrireMenu(m); render();
  toast(l.length + " plat" + (l.length > 1 ? "s" : "") + " dans la liste", () => { m.repas.splice(n); S.propo.repas = l; sauverPropo(); ecrireMenu(m); render(); });
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
    <div class="defile">${pastille("vege", "leaf", "Végé")}${pastille("rapide", "clock", "Rapide")}${pastille("avance", "box", "À l'avance")}${pastille("invites", "glass", "Invités")}</div>`;
  if (!S.recettes.length) { $("#main").innerHTML = `<div class="vide">Ajoute d’abord des recettes (onglet Recettes).</div>`; return; }
  const infos = (r, s) => `${dishImg(r, 30)}<span class="txt"><span class="nm">${esc(r.nom)}</span>${s ? `<span class="side">+ ${esc(s.nom)}</span>` : ""}</span>
        <span class="ri">${r.favori ? icone("star", "fav") : ""}${r.vege ? icone("leaf", "acc") : ""}</span>`;
  const propos = pr.map((x, i) => {
    const r = recette(x.id), s = x.side && recette(x.side);
    if (!r) return "";
    return `<div class="rp propo"><button class="rp-btn" data-repas="${i}" data-src="p">${infos(r, s)}</button>
      <button class="accepte" data-act="accepter" data-i="${i}" aria-label="Ajouter ${esc(r.nom)} à la liste">${icone("plus")}Liste</button></div>`;
  }).join("");
  const dansListe = ((m && m.repas) || []).map((x, i) => {
    const r = recette(x.id), s = x.side && recette(x.side);
    if (!r) return "";
    return `<div class="rp ${x.fait ? "fait" : ""}">
      <button class="cb" data-act="fait" data-i="${i}" aria-label="${x.fait ? "Pas encore cuisiné" : "Cuisiné"}">${x.fait ? icone("check") : ""}</button>
      <button class="rp-btn" data-repas="${i}" data-src="l">${infos(r, s)}<span class="chev">${icone("right")}</span></button></div>`;
  }).join("");
  $("#main").innerHTML = haut
    + `<div class="sec-t"><h3>Propositions</h3>${pr.length > 1 ? `<button class="lien-btn" data-act="accepter-tout">${icone("check")}Tout ajouter</button>` : ""}</div>`
    + (propos ? `<div class="repas">${propos}</div>` : `<div class="vide petit">Touche « Nouveau menu » pour des idées de plats.</div>`)
    + `<button class="btn ajout" data-act="choisir-plat">${icone("search")}Choisir un plat moi-même</button>`
    + `<div class="sec-t"><h3>Dans ma liste</h3>${dansListe ? `<span class="sub">Coche ce qui est cuisiné</span>` : ""}</div>`
    + (dansListe ? `<div class="repas">${dansListe}</div>` : `<div class="vide petit">Aucun plat dans la liste de courses.</div>`);
}

function cocherFait(i) {
  const m = menuEnCours(); if (!m || !m.repas[i]) return;
  m.repas[i].fait = !m.repas[i].fait;
  ecrireMenu(m); render();
}

// Petit menu d'un plat : gros boutons. src « p » = une proposition, « l » = un plat de la liste
function ouvrirRepas(i, src) {
  const l = src === "p" ? S.propo.repas : ((menuEnCours() || {}).repas || []);
  const x = l[i], r = x && recette(x.id);
  if (!r) return;
  const s = x.side && recette(x.side);
  const md = $("#modal");
  md.dataset.rep = i; md.dataset.src = src; delete md.dataset.recette; delete md.dataset.form;
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd">${dishImg(r, 44)}<div class="txt"><h2>${esc(r.nom)}</h2>${s ? `<div class="sub">+ ${esc(s.nom)}</div>` : ""}</div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="actions">
      ${src === "p" ? `<button class="act pri" data-act="accepter" data-i="${i}">${icone("cart")}Ajouter à la liste de courses</button>
      <button class="act" data-act="remplacer">${icone("refresh")}Remplacer (au hasard)</button>
      <button class="act" data-act="choisir">${icone("search")}Choisir un autre plat…</button>` : ""}
      ${veutAccomp(r) ? `<button class="act" data-act="accomp">${icone("refresh")}Changer l'accompagnement</button>` : ""}
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
  o.save(); fermer(); render();
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
  const m = listeEnCours();
  m.repas.push(Object.assign(nouveauRepas(r), { fait: false }));
  S.propo.repas = S.propo.repas.filter(x => x.id !== r.id);
  sauverPropo(); ecrireMenu(m); render(); ouvrirFiche(r.id);
  toast("Ajouté à la liste de courses");
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
  m.repas.filter(x => !x.fait).forEach(x => [x.id, x.side].filter(Boolean).forEach(id => {
    const r = recette(id); if (!r) return;
    const k = (m.pers || 2) / (r.portions || 2);       // ex. recette pour 2, on est 4 : ×2
    (r.ingredients || []).forEach(txt => {
      const it = parseItem(txt); if (!it) return;
      const cle = it.key + "|" + it.unit;
      const e = map.get(cle) || { cle, nom: it.name, unite: it.unit, qte: null, recettes: [], rayon: idx.has(it.key) ? idx.get(it.key).rayon : aisleOf(it.name), placard: idx.has(it.key) ? idx.get(it.key).placard : auPlacard(it.name) };
      if (it.qty != null) e.qte = (e.qte || 0) + it.qty * k;
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
    const e = idx.get(cleBanque(a));
    map.set(cleAjout(a), { cle: cleAjout(a), nom: a, unite: "", qte: null, recettes: [], rayon: e ? e.rayon : "perso", ajout: true });
  });
  return [...map.values()];
}

function renderCourses() {
  const m = menuEnCours();
  // ce qui était tapé dans le champ d'ajout reste (la liste peut se redessiner quand l'autre appareil modifie quelque chose)
  const champ = $("#ajout-art"), tape = champ ? champ.value : "", avaitFocus = !!champ && document.activeElement === champ;
  const ajout = `<div class="srow"><label class="cherche">${icone("plus")}<input id="ajout-art" placeholder="Ajouter un article" autocomplete="off" enterkeyhint="done"></label>
    <button class="fab" data-act="ajouter-art" aria-label="Ajouter">${icone("check")}</button></div><div class="sugg" id="sugg-art"></div>
    <div class="outils3"><button class="btn" data-act="parcourir">${icone("grid")}Parcourir</button>
      <button class="btn" data-act="nouvelle-liste">${icone("file-plus")}Nouvelle liste</button>
      <button class="btn ${listeArchive() ? "" : "inactif"}" data-act="archive" aria-label="Liste précédente">${icone("history")}Précédente</button></div>`;
  const finir = () => { // remet le champ comme il était
    const c = $("#ajout-art"); if (!c || !tape) return;
    c.value = tape; majSuggArt(); if (avaitFocus) c.focus();
  };
  if (!m) { $("#main").innerHTML = ajout + `<div class="vide">Liste vide.<br>Ajoute des articles ci-dessus, ou des plats depuis l'onglet Menu.</div>`; return finir(); }
  const coches = m.coches || {}, dispo = m.dispo || {};
  const groupes = {}, placard = [];
  // Un article « souvent au placard » reste à part tant que je n'ai pas dit « il me faut » ; alors il rejoint son rayon.
  articles(m).forEach(e => {
    if (e.placard && !e.ajout && dispo[e.cle] !== "non") placard.push(e);
    else (groupes[e.rayon] ??= []).push(e);
  });
  const ligne = e => `<div class="it ${coches[e.cle] ? "fait" : ""}">
      <button class="cb" data-coche="${esc(e.cle)}" aria-label="${coches[e.cle] ? "Pas encore pris" : "Pris"}">${coches[e.cle] ? icone("check") : ""}</button>
      ${imgIng(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${e.recettes.length ? `<span class="for">${esc(e.recettes.join(" · "))}</span>` : ""}</span>
      <span class="q num">${esc(fmtQty(e.qte, e.unite))}</span>
      ${e.ajout ? `<button class="ib" data-retirer-art="${esc(e.nom)}" aria-label="Retirer">${icone("x")}</button>` : ""}
      ${e.placard && !e.ajout ? `<button class="ib" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui" aria-label="Finalement je l'ai (remettre au placard)">${icone("box")}</button>` : ""}</div>`;
  const lignePlacard = e => `<div class="pl ${dispo[e.cle] === "oui" ? "fait" : ""}">
      <div class="pl-h">${imgIng(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${e.recettes.length ? `<span class="for">${esc(e.recettes.join(" · "))}</span>` : ""}</span><span class="q num">${esc(fmtQty(e.qte, e.unite))}</span></div>
      <div class="pl-b"><button class="chip ${dispo[e.cle] === "oui" ? "on" : ""}" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui">${icone("check")}Je l'ai</button>
        <button class="chip" data-act="dispo" data-cle="${esc(e.cle)}" data-v="non">${icone("cart")}Il me faut</button></div></div>`;
  const tri = l => l.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  let html = "";
  AISLE_ORDER.filter(a => groupes[a]).forEach(a => {
    html += `<div class="rayon"><h3>${aisleLabel(a)}</h3>${tri(groupes[a]).map(ligne).join("")}</div>`;
  });
  // Ce que j'ai peut-être déjà : replié tout en bas. Pour chacun : « je l'ai » ou « il me faut ».
  if (placard.length) {
    const aVerifier = placard.filter(e => !dispo[e.cle]).length;
    html += `<details class="rayon placard" ${S.placardOuvert ? "open" : ""}><summary>${icone("right")}Peut-être au placard (${aVerifier ? aVerifier + " à vérifier" : placard.length})</summary>${tri(placard).map(lignePlacard).join("")}</details>`;
  }
  $("#main").innerHTML = ajout + (html || `<div class="vide">Liste vide.<br>Ajoute des articles ci-dessus, ou des plats depuis l'onglet Menu.</div>`);
  finir();
}

// « Je l'ai » / « Il me faut » pour un article du placard (valable pour cette liste seulement ; retoucher le même choix l'annule)
function definirDispo(cle, v) {
  const m = menuEnCours(); if (!m) return;
  m.dispo = m.dispo || {};
  if (m.dispo[cle] === v) delete m.dispo[cle]; else m.dispo[cle] = v;
  ecrireMenu(m); renderCourses();
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
  box.innerHTML = l.map(e => `<button class="chip" data-sugg="${esc(e.cle)}">${esc(e.nom)}${e.menage ? " <small>ménager</small>" : ""}</button>`).join("")
    + (existe ? "" : `<button class="chip nouv" data-act="art-ingredient">${icone("plus")}« ${esc(v)} »</button><button class="chip nouv" data-act="art-menage">${icone("plus")}« ${esc(v)} » ménager</button>`);
}

function cocher(cle) {
  const m = menuEnCours(); if (!m) return;
  m.coches = m.coches || {};
  if (m.coches[cle]) delete m.coches[cle]; else m.coches[cle] = true;
  ecrireMenu(m); renderCourses();
}
// Ajoute un article à la liste en cours. Un article connu de la banque garde son nom d'origine ;
// un article nouveau y entre (en produit ménager si on l'a demandé), pour être proposé la prochaine fois.
function ajouterALaListe(texte, menage = false) {
  const v = texte.trim(); if (!v) return;
  const it = parseItem(v), avecQte = !!it && it.name !== v;  // « 2 L lait » : la quantité reste dans la liste, pas dans la banque
  const cle = cleBanque(v), connu = banque().find(e => e.cle === cle);
  let nom = v;
  if (connu) { if (!avecQte) nom = connu.nom; }
  else { ajouterBanque(avecQte ? it.name : v, menage); toast(menage ? "Ajouté à la banque (ménager)" : "Ajouté à la banque d'ingrédients"); }
  const m = listeEnCours();
  m.ajouts = m.ajouts || [];
  if (!m.ajouts.some(a => cleBanque(a) === cleBanque(nom))) m.ajouts.push(nom);
  ecrireMenu(m);
}
function ajouterArticle(menage = false) {
  const champ = $("#ajout-art"), v = champ.value.trim();
  if (!v) return champ.focus();
  ajouterALaListe(v, menage);
  champ.value = ""; renderCourses();
  $("#ajout-art").focus(); // on peut enchaîner les ajouts au clavier
}
function retirerArticle(nom) {
  const m = menuEnCours(); if (!m) return;
  const i = (m.ajouts || []).indexOf(nom); if (i < 0) return;
  m.ajouts.splice(i, 1);
  ecrireMenu(m); renderCourses();
  toast("Article retiré", () => { m.ajouts.splice(i, 0, nom); ecrireMenu(m); renderCourses(); });
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
      ${bloc("Articles récurrents", rec.map(e => ligne("art", e.nom, ingImg(e.nom, 18, e.icone), e.nom, e.menage ? `<span class="t">Ménager</span>` : "")))}
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
  nv.repas = plats.map(x => ({ id: x.id, side: x.side || null, fait: false }));
  arts.forEach(a => { if (!nv.ajouts.some(x => cleBanque(x) === cleBanque(a))) nv.ajouts.push(a); });
  // Un ingrédient d'un plat gardé, déjà pris dans l'ancienne liste, reste coché
  if (avant) articles(nv).forEach(e => { if ((avant.coches || {})[e.cle]) nv.coches[e.cle] = true; });
  // On ne garde que la liste précédente : les plus anciennes sont effacées (leurs plats restent dans l'historique du tirage)
  const aEffacer = avant ? S.menus.filter(x => x !== avant) : [], histoAvant = S.histo;
  if (aEffacer.length) S.histo = [...S.histo, ...aEffacer.map(x => x.repas.map(y => y.id))].slice(-2);
  S.menus = [...(avant ? [avant] : []), nv];
  aEffacer.forEach(x => effacerMenu(x.id));
  if (aEffacer.length) sauverHisto();
  ecrireMenu(nv);
  render(); window.scrollTo(0, 0);
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
  const m = menuEnCours(), deja = new Set(m ? articles(m).filter(e => !(m.coches || {})[e.cle]).map(e => cleBanque(e.nom)) : []);
  const coches = a.coches || {};
  const l = articles(a).sort((x, y) => AISLE_ORDER.indexOf(x.rayon) - AISLE_ORDER.indexOf(y.rayon) || x.nom.localeCompare(y.nom, "fr"));
  const plats = a.repas.map(x => recette(x.id)).filter(Boolean);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Liste précédente">
    <div class="fi-hd"><div class="txt"><h2>Liste précédente</h2><div class="sub">du ${new Date(a.cree).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · touche un article pour le reprendre</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${plats.length ? `<div class="tg">${plats.map(r => `<span class="t">${esc(r.nom)}</span>`).join("")}</div>` : ""}
    <div class="rc-l">${l.map(e => {
      const txt = e.qte != null ? (fmtQty(e.qte, e.unite) + " " + e.nom) : e.nom, dedans = deja.has(cleBanque(e.nom));
      return `<button class="rc arch ${dedans ? "on" : ""}" data-repris="${esc(txt)}" data-menage="${banque().some(b => b.cle === cleBanque(e.nom) && b.menage) ? 1 : ""}">
        <span class="cb">${icone("check")}</span>${imgIng(e.nom, 18)}<span class="nm ${coches[e.cle] ? "barre" : ""}">${esc(e.nom)}</span><span class="q num">${esc(fmtQty(e.qte, e.unite))}</span></button>`;
    }).join("") || `<div class="vide">Elle était vide.</div>`}</div>
    <div class="pied2"><button class="btn" data-act="fermer">Fermer</button><button class="btn pri" data-act="restaurer">${icone("history")}Remettre cette liste</button></div>
  </div></div>`;
}
// Reprendre un article de la liste précédente dans la liste en cours (retoucher l'enlève)
function reprendre(btn) {
  const txt = btn.dataset.repris, m = listeEnCours();
  const i = m.ajouts.findIndex(a => cleBanque(a) === cleBanque(txt));
  if (btn.classList.contains("on") && i >= 0) { m.ajouts.splice(i, 1); ecrireMenu(m); btn.classList.remove("on"); }
  else if (!btn.classList.contains("on")) { ajouterALaListe(txt, !!btn.dataset.menage); btn.classList.add("on"); }
  else return toast("Déjà dans la liste en cours (vient d'un plat)");
  render();
}
// La liste précédente redevient celle en cours, et inversement
function restaurerArchive() {
  const a = listeArchive(), m = menuEnCours(); if (!a || !m) return;
  const echange = () => { [a.cree, m.cree] = [m.cree, a.cree]; S.menus.sort((x, y) => x.cree - y.cree); ecrireMenu(a); ecrireMenu(m); render(); };
  echange(); fermer();
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
// Une entrée correspond à ce qui est tapé (q = texte déjà normalisé) : même au pluriel, « tomates » trouve « tomate »
const correspond = (e, q) => norm(e.nom).includes(q) || e.cle.includes(keyOf(q));
const rayonAuto = (nom, menage) => menage ? rayonMenage(nom) : aisleOf(nom);
const rayonsDe = menage => menage ? RAYONS_MENAGE.map(r => r[0]) : AISLES_FOOD;
const libelleRayon = id => { const m = RAYONS_MENAGE.find(r => r[0] === id); return m ? m[1] : aisleLabel(id); };
const entreeDe = cle => S.banque.find(x => (x.cle || cleBanque(x.nom)) === cle);
// Dessin d'un ingrédient (celui choisi dans la banque, sinon deviné d'après le nom)
const imgIng = (nom, px = 18) => { const b = entreeDe(cleBanque(nom)); return ingImg(nom, px, b && b.icone); };

function banque() {
  const auto = new Map();
  S.recettes.forEach(r => (r.ingredients || []).forEach(txt => {
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
    const cle = b.cle || cleBanque(b.nom), e = out.get(cle) || { cle, recettes: [] };
    Object.assign(e, { nom: b.nom || e.nom, menage: !!b.menage, rec: !!b.rec, rayon: b.rayon, icone: b.icone, pl: b.placard });
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
  ["rayon", "icone"].forEach(k => { if (!b[k]) delete b[k]; });
  // rien de particulier et déjà dans une recette : l'entrée à la main ne sert plus à rien
  if (!b.rec && !b.menage && !b.rayon && !b.icone && typeof b.placard !== "boolean" && e.recettes.length) S.banque = S.banque.filter(x => x !== b);
  sauverBanque();
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
  S.banque = S.banque.filter(x => (x.cle || cleBanque(x.nom)) !== cle);
  sauverBanque();
  S.bq.detail = null; S.bq.suppr = null; majBanque();
  toast("« " + e.court + " » supprimé", () => {
    avant.forEach(a => { a.r.ingredients = a.ings; if (a.src) a.r.ingredientsSource = a.src; else delete a.r.ingredientsSource; ecrireRecette(a.r); });
    S.banque = sauve; sauverBanque(); majBanque();
  });
}

// Produits ménagers courants, proposés d'un geste (nom, rayon)
const MENAGER_IDEES = [["Liquide vaisselle", "m-vaisselle"], ["Tablettes lave-vaisselle", "m-vaisselle"], ["Éponges", "m-vaisselle"],
  ["Lessive", "m-linge"], ["Adoucissant", "m-linge"], ["Nettoyant multi-usage", "m-nettoyage"], ["Produit WC", "m-nettoyage"], ["Javel", "m-nettoyage"],
  ["Essuie-tout", "m-papier"], ["Papier toilette", "m-papier"], ["Sacs poubelle", "m-papier"], ["Papier aluminium", "m-papier"], ["Film alimentaire", "m-papier"],
  ["Savon mains", "m-hygiene"], ["Dentifrice", "m-hygiene"], ["Gel douche", "m-hygiene"]];

// La banque est une vraie fenêtre (plein écran), pas un pop-up : liste par rayon sur 2 colonnes.
// Deux façons de l'ouvrir :
//   - Recettes › « Ingrédients » : toucher un ingrédient ouvre sa fiche (nom, rayon, icône, recettes, supprimer) ;
//   - Courses › « Parcourir » (choisir = vrai) : toucher un article l'ajoute à la liste (retoucher l'enlève).
function ouvrirBanque(choisir = false) {
  fermer();
  fermerBanque();
  S.bq.detail = null; S.bq.suppr = null; S.bq.ouvert = true; S.bq.scroll = 0; S.bq.choisir = choisir;
  const ec = document.createElement("div");
  ec.id = "bq-ecran"; ec.className = "bq-ecran";
  ec.innerHTML = `<div class="bq-in">
    <div class="bq-hd"><button class="ib" data-act="bq-retour" aria-label="Retour">${icone("left")}</button><h2 id="bq-titre">Banque d'ingrédients</h2>
      ${choisir ? `<span class="spacer"></span><button class="btn pri" data-act="bq-retour">${icone("check")}OK</button>` : ""}</div>
    <div class="bq-barre" id="bq-barre">
      <div class="srow" style="margin:0"><label class="cherche">${icone("search")}<input id="q-bq" placeholder="Chercher ou ajouter…" autocomplete="off" enterkeyhint="done"></label>
        <button class="fab" data-act="ajouter-banque" aria-label="Ajouter à la banque">${icone("plus")}</button></div>
      <div id="bq-onglets"></div></div>
    <div class="bq-corps" id="bq-corps"></div></div>`;
  document.body.appendChild(ec);
  majBanque();
}
function fermerBanque() {
  const ec = $("#bq-ecran"); if (ec) ec.remove();
  S.bq.ouvert = false; S.bq.detail = null;
}
function retourBanque() {
  if (S.bq.detail) { S.bq.detail = null; S.bq.suppr = null; return majBanque(); }
  fermerBanque(); render();
}

function majBanque() {
  const ec = $("#bq-ecran"); if (!ec) return;
  const corps = $("#bq-corps"), tous = banque();
  const e = S.bq.detail ? tous.find(x => x.cle === S.bq.detail) : null;
  if (S.bq.detail && !e) { S.bq.detail = null; S.bq.suppr = null; }
  const actif = document.activeElement;
  if (e && actif && actif.id === "bq-nom") return;   // on ne redessine pas pendant qu'on écrit le nom
  const mode = e ? "d" + e.cle : "liste", memeMode = ec.dataset.mode === mode, haut = corps.scrollTop;
  ec.dataset.mode = mode;
  $("#bq-barre").hidden = !!e;
  $("#bq-titre").textContent = e ? e.court : S.bq.choisir ? "Ajouter à la liste" : "Banque d'ingrédients";
  corps.innerHTML = e ? htmlFicheIngredient(e) : htmlListeBanque(tous);
  corps.scrollTop = memeMode ? haut : e ? 0 : S.bq.scroll;
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
      ? `<button class="bq-t pick ${dansListe.has(e.cle) ? "on" : ""}" data-bq-pick="${esc(e.cle)}" aria-pressed="${dansListe.has(e.cle)}">${ingImg(e.nom, 18, e.icone)}<span class="nm">${esc(e.nom)}</span><span class="cb">${icone("check")}</span></button>`
      : `<button class="bq-t" data-bq-ouvrir="${esc(e.cle)}">${ingImg(e.nom, 18, e.icone)}<span class="nm">${esc(e.nom)}</span>${e.placard ? icone("box", "rec") : ""}${e.rec ? icone("refresh", "rec") : ""}</button>`).join("")}</div></div>`;
  });
  if (!html) html = `<div class="vide" style="padding:28px 8px">${q ? "Rien ne correspond. Touche + pour l'ajouter." : S.bq.rec ? "Aucun article récurrent." : S.bq.placard ? "Rien au placard." : "Rien ici pour l'instant."}</div>`;
  const idees = men && !q && !S.bq.rec && !S.bq.placard ? MENAGER_IDEES.filter(([n]) => !tous.some(e => e.cle === cleBanque(n))) : [];
  if (idees.length) html += `<div class="rayon"><h3>Idées</h3><div class="sugg">${idees.map(([n, r]) => `<button class="chip nouv" data-bq-idee="${esc(n)}" data-r="${r}">${icone("plus")}${esc(n)}</button>`).join("")}</div></div>`;
  return html;
}

function htmlFicheIngredient(e) {
  const rayons = rayonsDe(e.menage).map(r => `<button type="button" class="chip ${r === e.rayon ? "on" : ""}" data-bq-rayon="${r}">${esc(libelleRayon(r))}</button>`).join("");
  const icones = `<button type="button" class="bq-ic auto ${e.icone ? "" : "on"}" data-bq-icone="" aria-label="Automatique">${ingImg(e.court, 24)}<small>Auto</small></button>`
    + Object.keys(ICONES).map(k => `<button type="button" class="bq-ic ${e.icone === k ? "on" : ""}" data-bq-icone="${k}" aria-label="${ICONES[k]}">${ingImg(e.court, 24, k)}</button>`).join("");
  const recettes = e.recettes.map(r => `<button class="ligne" data-fiche="${esc(r.id)}">${dishImg(r, 28)}<span class="nm">${esc(r.nom)}</span><span class="chev">${icone("right")}</span></button>`).join("");
  const confirme = S.bq.suppr === e.cle;
  const n = e.recettes.length;
  return `<div class="bq-fiche">
    <div class="champ"><label for="bq-nom">Nom</label><input class="saisie" id="bq-nom" value="${esc(e.nom)}" autocomplete="off" enterkeyhint="done"></div>
    <div class="champ"><span class="lbl">Rayon</span><div class="pastilles">${rayons}</div></div>
    <div class="champ"><span class="lbl">Icône</span><div class="bq-icones">${icones}</div></div>
    <button type="button" class="btn ${e.rec ? "pri" : ""}" data-act="bq-rec-fiche" style="justify-content:flex-start">${icone("refresh")}${e.rec ? "Récurrent : proposé à chaque nouvelle liste" : "Proposer à chaque nouvelle liste"}</button>
    <button type="button" class="btn ${e.placard ? "pri" : ""}" data-act="bq-placard-fiche" style="justify-content:flex-start">${icone("box")}${e.placard ? "Souvent au placard : à vérifier à chaque liste" : "Souvent au placard ?"}</button>
    ${n ? `<div class="champ"><span class="lbl">Recettes</span><div>${recettes}</div></div>` : ""}
    <button type="button" class="btn danger-btn" data-act="bq-suppr">${icone("trash")}${confirme ? (n ? `Confirmer : retirer de ${n} recette${n > 1 ? "s" : ""}` : "Confirmer la suppression") : "Supprimer"}</button>
  </div>`;
}

// « + » (ou Entrée) : ajoute ce qui est tapé, sauf si l'article existe déjà : on le montre alors
function ajouterDepuisBanque() {
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
  champ.value = ""; majBanque(); champ.focus();
  toast((S.bq.choisir ? "Ajouté à la liste et dans « " : "Ajouté dans « ") + libelleRayon(e.rayon) + " »");
}
// Mode « Parcourir » : toucher un article l'ajoute à la liste en cours, retoucher l'enlève
function basculerPick(cle) {
  const e = banque().find(x => x.cle === cle); if (!e) return;
  const m = listeEnCours(), i = m.ajouts.findIndex(a => cleBanque(a) === cle);
  if (i >= 0) { m.ajouts.splice(i, 1); ecrireMenu(m); } else ajouterALaListe(e.nom, e.menage);
  if (navigator.vibrate) try { navigator.vibrate(8); } catch (err) { /* pas de vibreur */ }
  majBanque();
}

/* ---------- 5. Écran Recettes ---------- */

// Les recettes qui passent la recherche et les filtres
function filtrees() {
  const f = S.f, q = norm(f.q);
  return S.recettes.filter(r =>
    (!q || norm([r.nom, r.proteine, r.origine, (r.ingredients || []).join(" ")].join(" ")).includes(q)) &&
    (!f.cat || r.categorie === f.cat) && (!f.prot || r.proteine === f.prot) &&
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
  const f = S.f;
  const valeurs = k => [...new Set(S.recettes.map(r => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const liste = (k, tous) => `<select class="chip ${f[k] ? "on" : ""}" data-filtre="${k}" aria-label="${tous}">
    <option value="">${tous}</option>${valeurs(k === "cat" ? "categorie" : "proteine").map(v => `<option ${v === f[k] ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  const bascule = (k, ic, txt) => `<button class="chip ${f[k] ? "on" : ""}" data-bascule="${k}">${ic ? icone(ic) : ""}${txt}</button>`;
  $("#main").innerHTML = `
    <div class="srow"><label class="cherche">${icone("search")}<input id="q" type="search" placeholder="Chercher…" value="${esc(f.q)}" autocomplete="off">
      ${f.q ? `<button data-act="effacer-q" aria-label="Effacer">${icone("x")}</button>` : ""}</label>
      <button class="btn" data-act="banque" aria-label="Banque d'ingrédients">${icone("carrot")}Ingrédients</button>
      <button class="fab" data-act="nouvelle" aria-label="Ajouter une recette">${icone("plus")}</button></div>
    <div class="defile">${liste("cat", "Catégorie")}${liste("prot", "Protéine")}
      ${bascule("fav", "star", "Favoris")}${bascule("vege", "leaf", "Végé")}${bascule("saison", "sun", "De saison")}
      ${bascule("avance", "box", "À l'avance")}${bascule("invites", "glass", "Invités")}</div>
    <div id="liste"></div>`;
  majListe();
}

// Redessine seulement la liste (pendant la frappe dans la recherche)
function majListe() {
  const l = filtrees();
  $("#liste").innerHTML = l.length ? l.map(r => `<button class="ligne" data-fiche="${esc(r.id)}">${dishImg(r, 28)}
      <span class="nm">${esc(r.nom)}</span>
      <span class="ri">${r.favori ? icone("star", "fav") : ""}${r.vege ? icone("leaf", "acc") : ""}${r.prep ? icone("box") : ""}${r.date ? icone("glass") : ""}</span></button>`).join("")
    : `<div class="vide">Aucune recette ne correspond.</div>`;
}

/* ---------- 6. Fiche recette (mini pop-up) ---------- */

function ouvrirFiche(id) {
  const r = S.recettes.find(x => x.id === id);
  if (!r) return fermer();
  const tags = [r.categorie, r.proteine, r.origine, r.saison, r.preparation].filter(Boolean).map(t => `<span class="t">${esc(t)}</span>`);
  if (r.vege) tags.push(`<span class="t acc">${icone("leaf")}Végé</span>`);
  if (r.prep) tags.push(`<span class="t acc">${icone("box")}À l'avance</span>`);
  if (r.date) tags.push(`<span class="t fav">${icone("glass")}Invités</span>`);
  const faits = Object.keys(NIVEAUX).filter(k => r[k]).map(k =>
    `<div><dt>${{ prix: "Prix", difficulte: "Difficulté", temps: "Temps", maitrise: "Maîtrise" }[k]}</dt><dd>${NIVEAUX[k][r[k] - 1]}</dd></div>`).join("");
  const ings = (r.ingredients || []).map(t => { const it = parseItem(t); return `<li>${imgIng(t, 18)}<span>${esc(t)}</span></li>`; }).join("");
  ["form", "rep", "choix"].forEach(k => delete $("#modal").dataset[k]);
  $("#modal").dataset.recette = id;
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd">${dishImg(r, 44)}<div class="txt"><h2>${esc(r.nom)}</h2><div class="tg">${tags.join("")}</div></div>
      <button class="ib" data-act="menu3" aria-label="Plus d'actions">${icone("more")}</button>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="menu3" id="menu3" hidden>
      <button data-act="modifier">${icone("pen")}Modifier</button>
      <button data-act="dupliquer">${icone("copy")}Dupliquer</button>
      <button class="danger" data-act="supprimer">${icone("trash")}Supprimer</button></div>
    ${faits ? `<dl class="faits">${faits}</dl>` : ""}
    <div><div class="h4">Ingrédients <i>pour ${r.portions || 2}${r.ingredientsSource === "suggestion" ? " · suggérés" : ""}</i></div>
      ${ings ? `<ul class="ings">${ings}</ul>` : `<div class="sub">Aucun ingrédient.</div>`}</div>
    ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
    ${/^https?:\/\//.test(r.lien || "") ? `<a class="lien" href="${esc(r.lien)}" target="_blank" rel="noopener">${icone("link")}Voir la recette en ligne</a>` : ""}
    <div class="gros"><button class="btn ${r.favori ? "fav-on" : ""}" data-act="favori">${icone("star")}${r.favori ? "Favori" : "Mettre en favori"}</button>
      ${menuEnCours() && menuEnCours().repas.some(x => x.id === r.id)
        ? `<button class="btn" disabled>${icone("check")}Dans la liste</button>`
        : `<button class="btn pri" data-act="au-menu">${icone("cart")}À la liste</button>`}</div>
  </div></div>`;
}

function basculerFavori() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  r.favori = !r.favori;
  ecrireRecette(r);
  render(); ouvrirFiche(r.id);
}

function fermer() {
  $("#modal").innerHTML = "";
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete $("#modal").dataset[k]);
}

// Supprime tout de suite, avec « Annuler » pendant quelques secondes
function supprimer() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (!r) return;
  S.recettes = S.recettes.filter(x => x !== r);
  effacerRecette(r.id);
  fermer(); render();
  toast("Recette supprimée", () => {
    S.recettes.push(r);
    ecrireRecette(r);
    render();
  });
}

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
const SAISONS = ["Annuel", "Été", "Hiver"];

function ouvrirFormulaire(brouillon, titre) {
  const r = brouillon;
  const pastilles = (k, defile, liste) => `<div class="pastilles ${defile ? "defile" : ""}" data-champ="${k}">
    ${(liste || valeursDe(k, r[k])).map(v => `<button type="button" class="chip ${v === r[k] ? "on" : ""}" data-pastille>${esc(v)}</button>`).join("")}
    <button type="button" class="chip autre" data-act="autre">${icone("plus")}Autre…</button></div>`;
  const cases = [["vege", "leaf", "Végé"], ["favori", "star", "Favori"], ["prep", "box", "À l'avance"], ["date", "glass", "Invités"]]
    .map(([k, i, t]) => `<button type="button" class="chip ${r[k] ? "on" : ""}" data-case="${k}">${icone(i)}${t}</button>`).join("");
  const niveaux = Object.keys(NIVEAUX).map(k => `<div class="niv"><span class="lbl">${{ prix: "Prix", difficulte: "Difficulté", temps: "Temps", maitrise: "Maîtrise" }[k]}</span>
    <span class="seg" data-niv="${k}">${NIVEAUX[k].map((l, i) => `<button type="button" class="${r[k] === i + 1 ? "on" : ""}" data-v="${i + 1}">${l}</button>`).join("")}</span></div>`).join("");
  const m = $("#modal");
  m.dataset.form = "1";
  if (r.id) m.dataset.recette = r.id; else delete m.dataset.recette;
  m.innerHTML = `<div class="voile"><div class="fiche form" role="dialog" aria-label="${titre}">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">${titre}</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="champ"><label for="f-nom">Nom</label><input class="saisie" id="f-nom" value="${esc(r.nom)}" autocomplete="off"></div>
    <div class="champ"><span class="lbl">Catégorie</span>${pastilles("categorie")}</div>
    <div class="champ"><span class="lbl">Protéine</span>${pastilles("proteine", true)}</div>
    <div class="cases">${cases}</div>
    <div class="champ"><span class="lbl">Ingrédients <i>· pour <span id="f-pour">${r.portions || 2}</span></i></span>
      <div class="ingl" id="f-ings">${(r.ingredients || []).map(ligneIngredient).join("")}</div>
      <button type="button" class="btn ajout" data-act="ajout-ing">${icone("plus")}Ajouter un ingrédient</button></div>
    <button type="button" class="plus" data-act="plus" aria-expanded="false">${icone("down")}<span>Plus : saison, origine, prix, notes…</span></button>
    <div id="f-plus" hidden>
      <div class="champ"><span class="lbl">Saison</span>${pastilles("saison", false, SAISONS.includes(r.saison) || !r.saison ? SAISONS : [...SAISONS, r.saison])}</div>
      <div class="champ"><span class="lbl">Origine</span>${pastilles("origine", true)}</div>
      <div class="champ"><span class="lbl">Préparation</span>${pastilles("preparation", true)}</div>
      ${niveaux}
      <div class="duo"><div class="champ"><span class="lbl">Portions</span><span class="pas">
          <button type="button" data-act="portions" data-v="-1" aria-label="Moins">−</button><b id="f-portions">${r.portions || 2}</b><button type="button" data-act="portions" data-v="1" aria-label="Plus">+</button></span></div>
        <div class="champ"><label for="f-lien">Lien</label><input class="saisie" id="f-lien" type="url" placeholder="https://…" value="${esc(r.lien)}"></div></div>
      <div class="champ"><label for="f-notes">Notes</label><textarea class="saisie" id="f-notes" rows="2">${esc(r.notes)}</textarea></div>
    </div>
    <div class="pied2"><button type="button" class="btn" data-act="fermer">Annuler</button><button type="button" class="btn pri" data-act="enregistrer">Enregistrer</button></div>
  </div></div>`;
  m.brouillon = r; // gardé à côté du formulaire jusqu'à l'enregistrement
  rendreTriable($("#f-ings"), ".li", $(".form"));
  if (!r.id) $("#f-nom").focus();
}

// Une ligne d'ingrédient : poignée pour glisser, dessin, texte, croix
const ligneIngredient = (txt = "") => `<div class="li"><span class="poignee" aria-label="Déplacer">${icone("grip")}</span>
  ${dessinIng(txt)}<input value="${esc(txt)}" placeholder="ex. 250 g pâtes" autocomplete="off"><button type="button" class="ib" data-act="retirer-ing" aria-label="Retirer">${icone("x")}</button></div>`;
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
  const l = banque().filter(e => !e.menage && norm(e.court) !== q && (norm(e.court).includes(q) || e.cle === it.key))
    .sort((a, b) => (a.cle === it.key ? 0 : 1) - (b.cle === it.key ? 0 : 1) || (norm(a.court).startsWith(q) ? 0 : 1) - (norm(b.court).startsWith(q) ? 0 : 1) || b.recettes.length - a.recettes.length || parNom(a, b)).slice(0, 6);
  if (!l.length) return;
  const box = document.createElement("div");
  box.className = "sugg-ing";
  // « on » = c'est déjà le même ingrédient, écrit autrement : à uniformiser
  box.innerHTML = l.map(e => `<button type="button" class="chip ${e.cle === it.key ? "on" : ""}" data-sugg-ing="${esc(e.court)}">${esc(e.court)}</button>`).join("");
  li.appendChild(box);
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
  const tmp = document.createElement("div");
  tmp.innerHTML = ligneIngredient();
  const ligne = tmp.firstElementChild;
  if (apres) apres.after(ligne); else $("#f-ings").appendChild(ligne);
  ligne.querySelector("input").focus();
}

// Relit tout le formulaire et renvoie la recette complète
function lireFormulaire() {
  const r = Object.assign({}, $("#modal").brouillon);
  r.nom = $("#f-nom").value.trim();
  document.querySelectorAll("[data-champ]").forEach(g => {
    const autre = g.querySelector("input.autre");
    const on = g.querySelector(".chip.on[data-pastille]");
    const v = autre && autre.value.trim() ? autre.value.trim() : on ? on.textContent.trim() : "";
    if (v) r[g.dataset.champ] = v; else delete r[g.dataset.champ];
  });
  document.querySelectorAll("[data-case]").forEach(b => { r[b.dataset.case] = b.classList.contains("on"); });
  document.querySelectorAll("[data-niv]").forEach(g => {
    const on = g.querySelector("button.on");
    if (on) r[g.dataset.niv] = +on.dataset.v; else delete r[g.dataset.niv];
  });
  r.portions = +$("#f-portions").textContent || 2;
  const ings = [...document.querySelectorAll("#f-ings input")].map(i => i.value.trim()).filter(Boolean);
  // Ingrédients touchés : ce ne sont plus des « suggestions »
  if (ings.join("|") !== (r.ingredients || []).join("|")) r.ingredientsSource = "app";
  r.ingredients = ings;
  const lien = $("#f-lien").value.trim(), notes = $("#f-notes").value.trim();
  if (lien) r.lien = lien; else delete r.lien;
  if (notes) r.notes = notes; else delete r.notes;
  return r;
}

function enregistrer() {
  const r = lireFormulaire();
  if (!r.nom) { toast("Il faut un nom"); $("#f-nom").focus(); return; }
  if (!r.id) {
    // Nouvelle recette : identifiant tiré du nom, sans doublon
    let id = idDe(r.nom), n = 2;
    while (S.recettes.some(x => x.id === id)) id = idDe(r.nom) + "-" + n++;
    r.id = id;
    S.recettes.push(r);
  } else {
    S.recettes = S.recettes.map(x => x.id === r.id ? r : x);
  }
  ecrireRecette(r);
  render();
  ouvrirFiche(r.id);
  toast("Enregistré");
}

function nouvelle() {
  ouvrirFormulaire({ nom: "", categorie: "Plat complet", vege: false, favori: false, prep: false, date: false, portions: 2, ingredients: [], ingredientsSource: "app" }, "Nouvelle recette");
}
function modifier() {
  const r = S.recettes.find(x => x.id === $("#modal").dataset.recette);
  if (r) ouvrirFormulaire(JSON.parse(JSON.stringify(r)), "Modifier");
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
  const pastille = t.closest("[data-pastille]");
  if (pastille) {
    const g = pastille.parentElement, etait = pastille.classList.contains("on");
    g.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
    const autre = g.querySelector("input.autre"); if (autre) autre.value = "";
    if (!etait) pastille.classList.add("on"); // retoucher la pastille choisie la décoche
    return true;
  }
  const cas = t.closest("[data-case]");
  if (cas) { cas.classList.toggle("on"); return true; }
  const niv = t.closest("[data-niv] button");
  if (niv) {
    const etait = niv.classList.contains("on");
    niv.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("on"));
    if (!etait) niv.classList.add("on");
    return true;
  }
  return false;
}
// « Autre… » : la pastille devient une petite case où taper une nouvelle valeur
function pastilleAutre(btn) {
  const g = btn.parentElement;
  g.querySelectorAll(".chip").forEach(c => c.classList.remove("on"));
  const champ = document.createElement("input");
  champ.className = "chip autre on";
  champ.placeholder = "Autre…";
  champ.size = 10;
  btn.replaceWith(champ);
  champ.focus();
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
  const anim = lireLocal("fx-anim", "completes");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Réglages">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Réglages</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Apparence</div>
    <button class="reg" data-act="themes"><span>Thème</span><span class="val">${th[1]} ›</span></button>
    <div class="reg"><span>Animations</span><span class="seg">
      <button class="${anim === "completes" ? "on" : ""}" data-act="anim" data-v="completes">Complètes</button>
      <button class="${anim === "simples" ? "on" : ""}" data-act="anim" data-v="simples">Simples</button></span></div>
    ${uid ? `<div class="sect">Idées</div>
    <button class="reg" data-act="idees"><span>Notes</span><span class="val">›</span></button>
    <div class="sect">Excel</div>
    <div class="reg" style="justify-content:flex-start"><button class="btn" data-act="exporter">Exporter</button>
      <label class="btn">Importer<input type="file" id="fichier" accept=".xlsx" hidden></label></div>
    <div id="imp"></div>
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

// --- Export : un vrai fichier .xlsx propre, au style commun de mes applis ---
function versCase(type, k, v) {
  if (type === "oui") return v ? "Oui" : "Non";
  if (type === "niv") return v ? NIVEAUX[k][v - 1] : "";
  if (type === "liste") return (v || []).join("; ");
  return v ?? "";
}
async function classeurRecettes() {
  const ExcelJS = await chargerExcelJS();
  const wb = new ExcelJS.Workbook();
  const lignes = [...S.recettes].sort(parNom).map(r => {
    const l = {};
    COLONNES.forEach(([k, , , type]) => { l[k] = versCase(type, k, k === "suggeres" ? r.ingredientsSource === "suggestion" : r[k]); });
    return l;
  });
  const ws = ajouterFeuille(wb, "Recettes", COLONNES.map(([k, h, w]) => ({ header: h, key: k, width: w })), lignes);
  ws.getColumn("ingredients").alignment = { wrapText: true, vertical: "middle" };
  return wb;
}
async function exporter(btn) {
  btn.disabled = true;
  try { await telechargerClasseur(await classeurRecettes(), NOM_APPLI); toast("Fichier téléchargé"); }
  catch (e) { toast("Export impossible : " + (e && e.message || e)); }
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
  const ws = wb.worksheets.find(w => norm(w.name).startsWith("recette")) || wb.worksheets[0];
  if (!ws) return [];
  const parEntete = {};
  COLONNES.forEach(c => { parEntete[norm(c[1])] = c; });
  const cols = [];
  ws.getRow(1).eachCell((c, i) => { cols[i] = parEntete[norm(valeurCase(c.value))]; });
  const out = [];
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    cols.forEach((c, i) => { if (!c) return; const v = depuisCase(c[3], c[0], valeurCase(rang.getCell(i).value)); if (v !== undefined) o[c[0]] = v; });
    if (o.nom) out.push(o);
  });
  return out;
}

function fusion(lignes, simuler) {
  const data = S.recettes.map(r => Object.assign({}, r));
  const parId = {}, parNomN = {};
  data.forEach((r, i) => { parId[r.id] = i; parNomN[norm(r.nom)] = i; });
  const touchees = new Set();
  let ajout = 0, maj = 0;
  lignes.forEach(o => {
    let i = o.id && parId[o.id] !== undefined ? parId[o.id] : parNomN[norm(o.nom)];
    if ("suggeres" in o) { o.ingredientsSource = o.suggeres ? "suggestion" : "app"; delete o.suggeres; }
    if (i !== undefined) {
      Object.keys(o).forEach(k => { if (k !== "id") data[i][k] = o[k]; });
      maj++;
    } else {
      let id = o.id ? idDe(o.id) : idDe(o.nom);
      while (parId[id] !== undefined) id += "-2";
      const r = Object.assign({ vege: false, favori: false, prep: false, date: false, portions: 2, ingredients: [], ingredientsSource: "app" }, o, { id });
      data.push(r); i = data.length - 1;
      parId[id] = parNomN[norm(r.nom)] = i;
      ajout++;
    }
    touchees.add(i);
  });
  if (!simuler) {
    const t = Date.now();
    const aEcrire = [...touchees].map(i => Object.assign(data[i], { maj: t }));
    S.recettes = data;
    ecrireRecettes(aEcrire);
  }
  return { ajout, maj };
}

async function importerFichier(fichier) {
  const box = $("#imp");
  box.innerHTML = `<div class="infos">Lecture du fichier…</div>`;
  try {
    const lignes = lireRecettes(await lireClasseur(fichier));
    if (!lignes.length) { box.innerHTML = `<div class="infos">Aucune recette trouvée (il faut une colonne « Nom »).</div>`; return; }
    const r = fusion(lignes, true);
    importEnAttente = lignes;
    box.innerHTML = `<div class="infos">${r.ajout} nouvelle${r.ajout > 1 ? "s" : ""}, ${r.maj} mise${r.maj > 1 ? "s" : ""} à jour</div>
      <div class="pied" style="margin-top:8px"><button class="btn pri" data-act="confirmer-import">Importer</button></div>`;
  } catch (e) {
    box.innerHTML = `<div class="infos">Impossible de lire ce fichier (${esc(e && e.message || e)}).</div>`;
  }
}
function confirmerImport() {
  if (!importEnAttente) return;
  const r = fusion(importEnAttente, false);
  importEnAttente = null;
  fermer(); render();
  toast(`Import terminé : ${r.ajout + r.maj} recettes`);
}

/* ---------- 8. Clics et démarrage ---------- */

document.addEventListener("click", e => {
  const t = e.target;
  const onglet = t.closest("#tabs button");
  if (onglet) { S.onglet = onglet.dataset.tab; ecrireLocal("fx-onglet", S.onglet); if (S.pret) render(); window.scrollTo(0, 0); return; }
  const ligne = t.closest("[data-fiche]");
  if (ligne) return ouvrirFiche(ligne.dataset.fiche);
  const coche = t.closest("[data-coche]");
  if (coche) return cocher(coche.dataset.coche);
  const sugg = t.closest("[data-sugg]");
  if (sugg) { const e = banque().find(x => x.cle === sugg.dataset.sugg); if (e) { ajouterALaListe(e.nom, e.menage); renderCourses(); $("#ajout-art").focus(); } return; }
  const suggIng = t.closest("[data-sugg-ing]");
  if (suggIng) return choisirSuggIng(suggIng);
  const rc = t.closest("[data-rc]");
  if (rc) return rc.classList.toggle("on");
  const bqOuvrir = t.closest("[data-bq-ouvrir]");
  if (bqOuvrir) { S.bq.scroll = $("#bq-corps").scrollTop; S.bq.detail = bqOuvrir.dataset.bqOuvrir; S.bq.suppr = null; return majBanque(); }
  const bqRayon = t.closest("[data-bq-rayon]");
  if (bqRayon) { majEntree(S.bq.detail, { rayon: bqRayon.dataset.bqRayon }); return majBanque(); }
  const bqIcone = t.closest("[data-bq-icone]");
  if (bqIcone) { majEntree(S.bq.detail, { icone: bqIcone.dataset.bqIcone }); return majBanque(); }
  const bqIdee = t.closest("[data-bq-idee]");
  if (bqIdee) { ajouterBanque(bqIdee.dataset.bqIdee, true, bqIdee.dataset.r); return majBanque(); }
  const retArt = t.closest("[data-retirer-art]");
  if (retArt) return retirerArticle(retArt.dataset.retirerArt);
  const repas = t.closest("[data-repas]");
  if (repas) return ouvrirRepas(+repas.dataset.repas, repas.dataset.src);
  const pick = t.closest("[data-bq-pick]");
  if (pick) return basculerPick(pick.dataset.bqPick);
  const repris = t.closest("[data-repris]");
  if (repris) return reprendre(repris);
  const choisi = t.closest("[data-choisi]");
  if (choisi) return choisirPlat(choisi.dataset.choisi);
  const pref = t.closest("[data-pref]");
  if (pref) { const k = pref.dataset.pref; S.prefs[k] = !S.prefs[k]; sauverPrefs(); return renderMenu(); }
  const bascule = t.closest("[data-bascule]");
  if (bascule) { const k = bascule.dataset.bascule; S.f[k] = !S.f[k]; return renderRecettes(); }
  if ($("#modal").dataset.form && clicFormulaire(t)) return;
  const el = t.closest("[data-act]");
  // Menu ⋯ ouvert : un clic n'importe où ailleurs le referme
  const m3 = $("#menu3");
  if (m3 && !m3.hidden && (!el || el.dataset.act !== "menu3")) m3.hidden = true;
  if (!el) return;
  switch (el.dataset.act) {
    case "nouveau-menu": nouveauMenu(); break;
    case "accepter": accepter(+el.dataset.i); break;
    case "accepter-tout": accepterTout(); break;
    case "choisir-plat": ouvrirChoix(); break;
    case "nouvelle-liste": nouvelleListe(); break;
    case "liste-garder": nouvelleListeChoix(true); break;
    case "liste-zero": nouvelleListeChoix(false); break;
    case "archive": ouvrirArchive(); break;
    case "restaurer": restaurerArchive(); break;
    case "parcourir": ouvrirBanque(true); break;
    case "ajouter-art": case "art-ingredient": ajouterArticle(); break;
    case "art-menage": ajouterArticle(true); break;
    case "banque": ouvrirBanque(); break;
    case "ajouter-banque": ajouterDepuisBanque(); break;
    case "bq-onglet": S.bq.onglet = el.dataset.v; majBanque(); break;
    case "bq-rec": S.bq.rec = !S.bq.rec; majBanque(); break;
    case "bq-placard": S.bq.placard = !S.bq.placard; majBanque(); break;
    case "bq-placard-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { placard: !e.placard }); majBanque(); } break; }
    case "dispo": definirDispo(el.dataset.cle, el.dataset.v); break;
    case "bq-retour": retourBanque(); break;
    case "bq-rec-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { rec: !e.rec }); majBanque(); } break; }
    case "bq-suppr":
      if (S.bq.suppr === S.bq.detail) supprimerIngredient(S.bq.detail);
      else { S.bq.suppr = S.bq.detail; majBanque(); }
      break;
    case "nb": changerNombre(+el.dataset.v); break;
    case "pers": changerPersonnes(+el.dataset.v); break;
    case "fait": cocherFait(+el.dataset.i); break;
    case "remplacer": remplacer(); break;
    case "choisir": ouvrirChoix($("#modal").dataset.rep); break;
    case "accomp": changerAccomp(); break;
    case "voir": { const o = repasOuvert(); if (o) ouvrirFiche(o.l[o.i].id); break; }
    case "retirer": retirer(); break;
    case "au-menu": auMenu(); break;
    case "nouvelle": nouvelle(); break;
    case "menu3": $("#menu3").hidden = !$("#menu3").hidden; break;
    case "modifier": modifier(); break;
    case "dupliquer": dupliquer(); break;
    case "supprimer": supprimer(); break;
    case "enregistrer": enregistrer(); break;
    case "autre": pastilleAutre(el); break;
    case "ajout-ing": ajouterIngredient(); break;
    case "retirer-ing": el.closest(".li").remove(); break;
    case "plus": {
      const ouvert = $("#f-plus").hidden;
      $("#f-plus").hidden = !ouvert;
      el.setAttribute("aria-expanded", ouvert);
      el.innerHTML = ouvert ? `${icone("up")}<span>Moins</span>` : `${icone("down")}<span>Plus : saison, origine, prix, notes…</span>`;
      break;
    }
    case "portions": {
      const n = Math.min(12, Math.max(1, +$("#f-portions").textContent + +el.dataset.v));
      $("#f-portions").textContent = n; $("#f-pour").textContent = n;
      break;
    }
    case "connexion": seConnecter(el); break;
    case "deconnexion": fermer(); S.pret = false; signOut(auth); break;
    case "reglages": ouvrirReglages(); break;
    case "themes": ouvrirThemes(); break;
    case "idees": NotesIdees.ouvrir(S.idees, sauverIdees); break;
    case "theme": ecrireLocal("fx-theme", el.dataset.v); appliquerTheme(); ouvrirThemes(); break;
    case "anim": ecrireLocal("fx-anim", el.dataset.v); document.documentElement.dataset.anim = el.dataset.v; ouvrirReglages(); break;
    case "exporter": exporter(el); break;
    case "confirmer-import": confirmerImport(); break;
    case "favori": basculerFavori(); break;
    case "effacer-q": S.f.q = ""; renderRecettes(); break;
    case "fermer": fermer(); break;
    case "fermer-fond": if (t === el) fermer(); break; // toucher le fond grisé ferme, pas la fiche elle-même
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "fichier" && e.target.files[0]) importerFichier(e.target.files[0]);
  if (e.target.id === "bq-nom") renommerIngredient(S.bq.detail, e.target.value);
  const filtre = e.target.dataset && e.target.dataset.filtre;
  if (filtre) { S.f[filtre] = e.target.value; renderRecettes(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { S.f.q = e.target.value; majListe(); }
  if (e.target.id === "q-choix") majChoix();
  if (e.target.id === "ajout-art") majSuggArt();
  if (e.target.id === "q-bq") majBanque();
  // En tapant un ingrédient, son petit dessin se met à jour
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li) { li.querySelector("img").outerHTML = dessinIng(e.target.value); majSuggIng(li); }
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
// Toucher une suggestion ne doit pas faire perdre le champ en cours (le clavier reste ouvert)
document.addEventListener("mousedown", e => { if (e.target.closest && e.target.closest(".sugg-ing, #sugg-art")) e.preventDefault(); });
document.addEventListener("keydown", e => {
  // Entrée dans un ingrédient : nouvelle ligne juste en dessous (comme une liste au clavier)
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li && e.key === "Enter") { e.preventDefault(); ajouterIngredient(li); return; }
  if (e.key === "Enter" && e.target.id === "ajout-art") { e.preventDefault(); ajouterArticle(); return; }
  if (e.key === "Enter" && e.target.id === "q-bq") { e.preventDefault(); ajouterDepuisBanque(); return; }
  if (e.key === "Enter" && e.target.id === "bq-nom") { e.preventDefault(); e.target.blur(); return; }
  // Échap ferme une fiche, mais pas le formulaire (pour ne pas perdre une saisie)
  if (e.key === "Escape" && $("#modal").innerHTML && !$("#modal").dataset.form) fermer();
  else if (e.key === "Escape" && S.bq.ouvert && !$("#modal").innerHTML) retourBanque();
});

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
  // en attendant qu'aucune fiche ne soit ouverte.
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let dejaRecharge = false;
  const recharger = () => {
    if (dejaRecharge) return;
    if ($("#modal").innerHTML) return setTimeout(recharger, 3000);
    dejaRecharge = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (avaitUneVersion) recharger(); });
}

// Mode démo uniquement : accès pour les tests automatiques (préparer et vérifier un fichier Excel)
if (MODE_DEMO) window.foodixTest = { S, classeurRecettes, lireRecettes, fusion, render, candidats };

if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();

// Le placard replié/ouvert reste comme on l'a laissé quand la liste se redessine
document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("placard")) S.placardOuvert = e.target.open; }, true);
