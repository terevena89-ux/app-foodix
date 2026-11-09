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
import { norm, parseItem, keyOf, aisleOf, aisleLabel, AISLE_ORDER, fmtQty, ingImg, dishImg } from "./pixel.js";

/* ---------- 1. Réglages de base ---------- */

const VERSION = "0.4.1";
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
  menus: [],                              // toutes les « livraisons », la plus récente = le menu en cours
  prefs: Object.assign({}, PREFS_DEFAUT),
  toujours: [],                           // articles ajoutés à chaque nouveau menu (Réglages › Toujours)
  idees: "",                              // Réglages › Notes : idées d'amélioration (synchronisées)
  onglet: lireLocal("fx-onglet", "menu"),
  // filtres de l'écran Recettes
  f: { q: "", cat: "", prot: "", fav: false, vege: false, saison: false, avance: false, invites: false }
};

/* ---------- 2. Stockage : Firebase ---------- */
// Rangement dans Firestore :
//   users/{mon uid}/app-foodix/donnees                  -> réglages du tirage (prefs)
//   users/{mon uid}/app-foodix/donnees/recettes/{id}    -> une recette par document
//   users/{mon uid}/app-foodix/donnees/menus/{id}       -> un menu (« livraison ») par document
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
// Réglages › Notes (bloc-notes d'idées) : seulement le champ « idees », sans toucher au reste.
function sauverIdees(texte) {
  S.idees = texte;
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { idees: texte }, { merge: true }).catch(erreurEcriture);
}
function sauverToujours() {
  if (MODE_DEMO) return sauverDemo();
  setDoc(refDonnees(), { toujours: S.toujours }, { merge: true }).catch(erreurEcriture);
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

// Mode démo : tout est recopié dans le navigateur après chaque modification
function sauverDemo() {
  try { localStorage.setItem("fx-demo", JSON.stringify({ recettes: S.recettes, menus: S.menus, prefs: S.prefs, toujours: S.toujours, idees: S.idees })); } catch (e) { /* plein ou bloqué */ }
}
function demarrerDemo() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem("fx-demo")) || {}; } catch (e) { /* rien de gardé */ }
  S.recettes = Array.isArray(d.recettes) ? d.recettes : [];
  S.menus = Array.isArray(d.menus) ? d.menus : [];
  S.prefs = Object.assign({}, PREFS_DEFAUT, d.prefs);
  S.toujours = Array.isArray(d.toujours) ? d.toujours : [];
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
    const p = Object.assign({}, PREFS_DEFAUT, snap.exists() && snap.data().prefs);
    const tj = (snap.exists() && snap.data().toujours) || [];
    S.idees = (snap.exists() && snap.data().idees) || ""; NotesIdees.maj(S.idees); // un autre appareil a pu changer les notes
    if (JSON.stringify(p) !== JSON.stringify(S.prefs) || JSON.stringify(tj) !== JSON.stringify(S.toujours)) { S.prefs = p; S.toujours = tj; rerendre(); }
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
}

function render() {
  const m = menuEnCours();
  const titres = {
    menu: ["Menu", m ? "Livraison du " + new Date(m.cree).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""],
    courses: ["Courses", ""],
    recettes: ["Recettes", ""]
  };
  const [titre, sous] = titres[S.onglet];
  $("#titre").textContent = titre;
  $("#sub").textContent = sous;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.onglet));
  if (S.onglet === "recettes") renderRecettes();
  else if (S.onglet === "menu") renderMenu();
  else renderCourses();
}

function renderConnexion() {
  $("#titre").textContent = "Foodix";
  $("#sub").textContent = "";
  $("#main").innerHTML = `<div class="vide">Connecte-toi pour retrouver tes recettes<br>sur le téléphone et le PC.
    <div><button class="btn pri" data-act="connexion">Se connecter avec Google</button></div></div>`;
}

/* ---------- 4 bis. Menu : la « livraison » de N repas ---------- */
// Pas de jours ni de semaines : un menu est une liste de repas tirée quand on le décide
// (comme une box repas). On coche les repas déjà cuisinés.
// Un repas = { id: recette, side: accompagnement ou null, fait: true/false }.

const menuEnCours = () => S.menus[S.menus.length - 1] || null;
const recette = id => S.recettes.find(r => r.id === id);
const estPlat = r => /plat complet|principal/.test(norm(r.categorie));
const estAccomp = r => /accompagnement/.test(norm(r.categorie));
const veutAccomp = r => /principal/.test(norm(r.categorie));

// Les plats que le tirage peut proposer (de saison, et selon Végé / Rapide)
function candidats() {
  const p = S.prefs;
  return S.recettes.filter(r => estPlat(r) && deSaison(r) && (!p.vege || r.vege) && (!p.rapide || !r.temps || r.temps <= 1));
}
// Plats servis dans les 3 menus précédents : ils sortiront moins souvent
function recents() {
  const ids = new Set();
  S.menus.slice(-4, -1).forEach(m => m.repas.forEach(x => { ids.add(x.id); if (x.side) ids.add(x.side); }));
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
// Un plat de plus, différent de ceux déjà dans le menu
function tirerPlat(deja) {
  const recent = recents();
  return tirer(candidats().filter(r => !deja.includes(r.id)), r => poids(r, deja, recent));
}
// Un accompagnement de saison (favoris ×2), différent de ceux déjà pris
function tirerAccomp(exclus = []) {
  const r = tirer(S.recettes.filter(x => estAccomp(x) && deSaison(x) && !exclus.includes(x.id)), x => x.favori ? 2 : 1);
  return r ? r.id : null;
}
function nouveauRepas(r, m) {
  return { id: r.id, side: veutAccomp(r) ? tirerAccomp(m ? m.repas.map(x => x.side).filter(Boolean) : []) : null, fait: false };
}

// Une livraison vide. Les ajouts à la main la suivent : ceux pas encore achetés
// (pas cochés) passent au menu suivant, et la liste « Toujours » s'y rajoute.
function creerMenu() {
  const avant = menuEnCours();
  const restants = avant ? (avant.ajouts || []).filter(a => !(avant.coches || {})[cleAjout(a)]) : [];
  const ajouts = [...restants];
  S.toujours.forEach(a => { if (!ajouts.some(x => norm(x) === norm(a))) ajouts.push(a); });
  return { id: "m" + Date.now(), cree: Date.now(), pers: S.prefs.pers, repas: [], ajouts, coches: {} };
}

// « Nouveau menu » : une nouvelle livraison ; l'ancienne reste dans l'historique
function nouveauMenu() {
  const m = creerMenu();
  for (let i = 0; i < S.prefs.nb; i++) {
    const r = tirerPlat(m.repas.map(x => x.id));
    if (!r) break;
    m.repas.push(nouveauRepas(r, m));
  }
  if (!m.repas.length) return toast("Aucun plat ne correspond");
  S.menus.push(m);
  ecrireMenu(m);
  render();
  toast("Nouveau menu", () => { S.menus = S.menus.filter(x => x !== m); effacerMenu(m.id); render(); });
}

// Nombre de repas : + tire un plat de plus, − retire le dernier
function changerNombre(d) {
  const m = menuEnCours();
  const n = Math.min(14, Math.max(1, (m ? m.repas.length : S.prefs.nb) + d));
  S.prefs.nb = n; sauverPrefs();
  if (m) {
    if (d > 0 && m.repas.length < 14) {
      const r = tirerPlat(m.repas.map(x => x.id));
      if (r) m.repas.push(nouveauRepas(r, m)); else toast("Plus d'autre plat disponible");
    }
    if (d < 0 && m.repas.length > 1) m.repas.pop();
    ecrireMenu(m);
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
  const m = menuEnCours(), p = S.prefs;
  const pastille = (k, ic, txt) => `<button class="chip ${p[k] ? "on" : ""}" data-pref="${k}">${icone(ic)}${txt}</button>`;
  const haut = `<div class="ctl">
      <span class="pas"><span class="l">${icone("utensils")}</span><button data-act="nb" data-v="-1" aria-label="Moins de repas">−</button><b class="num">${m ? m.repas.length : p.nb}</b><button data-act="nb" data-v="1" aria-label="Plus de repas">+</button></span>
      <span class="pas"><span class="l">${icone("users")}</span><button data-act="pers" data-v="-1" aria-label="Moins de personnes">−</button><b class="num">${p.pers}</b><button data-act="pers" data-v="1" aria-label="Plus de personnes">+</button></span>
      <span class="spacer"></span><button class="btn pri" data-act="nouveau-menu">${icone("shuffle")}Nouveau menu</button></div>
    <div class="defile">${pastille("vege", "leaf", "Végé")}${pastille("rapide", "clock", "Rapide")}${pastille("avance", "box", "À l'avance")}${pastille("invites", "glass", "Invités")}</div>`;
  if (!S.recettes.length) { $("#main").innerHTML = `<div class="vide">Ajoute d’abord des recettes (onglet Recettes).</div>`; return; }
  if (!m) { $("#main").innerHTML = haut + `<div class="vide">Pas encore de menu.</div>`; return; }
  const lignes = m.repas.map((x, i) => {
    const r = recette(x.id), s = x.side && recette(x.side);
    if (!r) return ""; // recette supprimée entre-temps
    return `<div class="rp ${x.fait ? "fait" : ""}">
      <button class="cb" data-act="fait" data-i="${i}" aria-label="${x.fait ? "Pas encore cuisiné" : "Cuisiné"}">${x.fait ? icone("check") : ""}</button>
      <button class="rp-btn" data-repas="${i}">${dishImg(r, 30)}<span class="txt"><span class="nm">${esc(r.nom)}</span>${s ? `<span class="side">+ ${esc(s.nom)}</span>` : ""}</span>
        <span class="ri">${r.favori ? icone("star", "fav") : ""}${r.vege ? icone("leaf", "acc") : ""}</span><span class="chev">${icone("right")}</span></button></div>`;
  }).join("");
  $("#main").innerHTML = haut + `<div class="repas">${lignes}</div>`;
}

function cocherFait(i) {
  const m = menuEnCours(); if (!m || !m.repas[i]) return;
  m.repas[i].fait = !m.repas[i].fait;
  ecrireMenu(m); render();
}

// Petit menu d'un repas : gros boutons
function ouvrirRepas(i) {
  const m = menuEnCours(), x = m && m.repas[i];
  const r = x && recette(x.id);
  if (!r) return;
  const s = x.side && recette(x.side);
  const md = $("#modal");
  md.dataset.rep = i; delete md.dataset.recette; delete md.dataset.form;
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd">${dishImg(r, 44)}<div class="txt"><h2>${esc(r.nom)}</h2>${s ? `<div class="sub">+ ${esc(s.nom)}</div>` : ""}</div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="actions">
      <button class="act" data-act="remplacer">${icone("refresh")}Remplacer (au hasard)</button>
      <button class="act" data-act="choisir">${icone("search")}Choisir…</button>
      ${veutAccomp(r) ? `<button class="act" data-act="accomp">${icone("refresh")}Changer l'accompagnement</button>` : ""}
      <button class="act" data-act="voir">${icone("book")}Voir la recette</button>
      <button class="act danger" data-act="retirer">${icone("trash")}Retirer du menu</button>
    </div></div></div>`;
}
const repasOuvert = () => { const m = menuEnCours(), i = +$("#modal").dataset.rep; return m && m.repas[i] ? { m, i } : null; };

function remplacer() {
  const o = repasOuvert(); if (!o) return;
  const r = tirerPlat(o.m.repas.map(x => x.id));
  if (!r) return toast("Plus d'autre plat disponible");
  o.m.repas[o.i] = nouveauRepas(r, o.m);
  ecrireMenu(o.m); render(); ouvrirRepas(o.i);
}
function changerAccomp() {
  const o = repasOuvert(); if (!o) return;
  const x = o.m.repas[o.i];
  x.side = tirerAccomp([x.side, ...o.m.repas.map(y => y.side)].filter(Boolean)) || x.side;
  ecrireMenu(o.m); render(); ouvrirRepas(o.i);
}
function retirer() {
  const o = repasOuvert(); if (!o) return;
  const [x] = o.m.repas.splice(o.i, 1);
  ecrireMenu(o.m); fermer(); render();
  toast("Retiré du menu", () => { o.m.repas.splice(o.i, 0, x); ecrireMenu(o.m); render(); });
}

// « Choisir… » : liste des plats avec recherche ; i = place du repas à remplacer (ou absent = ajouter)
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
  const i = $("#modal").dataset.choix;
  let m = menuEnCours();
  if (!m) { m = creerMenu(); S.menus.push(m); }
  const x = nouveauRepas(r, m);
  if (i !== "" && m.repas[+i]) m.repas[+i] = x; else m.repas.push(x);
  ecrireMenu(m); fermer(); render();
  toast("Au menu");
}
// Bouton « Au menu » de la fiche recette : ajouté à la fin du menu en cours
function auMenu() {
  const id = $("#modal").dataset.recette;
  $("#modal").dataset.choix = "";
  choisirPlat(id);
}

/* ---------- 4 ter. Liste de courses ---------- */
// Additionne les ingrédients des repas pas encore cuisinés (plats + accompagnements),
// à l'échelle du nombre de personnes, puis les range par rayon du magasin.
// Clé d'un article = nom simplifié (sans accents, sans pluriel) + unité :
// « 2 oignons » et « 1 oignon » deviennent « 3 oignons ».

const cleAjout = a => "perso|" + norm(a);

function articles(m) {
  const map = new Map();
  m.repas.filter(x => !x.fait).forEach(x => [x.id, x.side].filter(Boolean).forEach(id => {
    const r = recette(id); if (!r) return;
    const k = (m.pers || 2) / (r.portions || 2);       // ex. recette pour 2, on est 4 : ×2
    (r.ingredients || []).forEach(txt => {
      const it = parseItem(txt); if (!it) return;
      const cle = it.key + "|" + it.unit;
      const e = map.get(cle) || { cle, nom: it.name, unite: it.unit, qte: null, recettes: [], rayon: aisleOf(it.name) };
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
  (m.ajouts || []).forEach(a => map.set(cleAjout(a), { cle: cleAjout(a), nom: a, unite: "", qte: null, recettes: [], rayon: "perso", ajout: true }));
  return [...map.values()];
}

function renderCourses() {
  const m = menuEnCours();
  const ajout = `<div class="srow"><label class="cherche">${icone("plus")}<input id="ajout-art" placeholder="Ajouter un article" autocomplete="off" enterkeyhint="done"></label>
    <button class="fab" data-act="ajouter-art" aria-label="Ajouter">${icone("check")}</button></div>`;
  if (!m) { $("#main").innerHTML = ajout + `<div class="vide">Pas encore de menu.</div>`; return; }
  const coches = m.coches || {};
  const groupes = {};
  articles(m).forEach(e => (groupes[e.rayon] ??= []).push(e));
  const ligne = e => `<div class="it ${coches[e.cle] ? "fait" : ""}">
      <button class="cb" data-coche="${esc(e.cle)}" aria-label="${coches[e.cle] ? "Pas encore pris" : "Pris"}">${coches[e.cle] ? icone("check") : ""}</button>
      ${ingImg(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${e.recettes.length ? `<span class="for">${esc(e.recettes.join(" · "))}</span>` : ""}</span>
      <span class="q num">${esc(fmtQty(e.qte, e.unite))}</span>
      ${e.ajout ? `<button class="ib" data-retirer-art="${esc(e.nom)}" aria-label="Retirer">${icone("x")}</button>` : ""}</div>`;
  const tri = l => l.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  let html = "";
  AISLE_ORDER.filter(a => a !== "placard" && groupes[a]).forEach(a => {
    html += `<div class="rayon"><h3>${aisleLabel(a)}</h3>${tri(groupes[a]).map(ligne).join("")}</div>`;
  });
  // Ce qu'on a sans doute déjà : replié tout en bas
  if (groupes.placard) html += `<details class="rayon placard" ${S.placardOuvert ? "open" : ""}><summary>${icone("right")}Sans doute au placard (${groupes.placard.length})</summary>${tri(groupes.placard).map(ligne).join("")}</details>`;
  $("#main").innerHTML = ajout + (html || `<div class="vide">Rien à acheter.</div>`);
}

function cocher(cle) {
  const m = menuEnCours(); if (!m) return;
  m.coches = m.coches || {};
  if (m.coches[cle]) delete m.coches[cle]; else m.coches[cle] = true;
  ecrireMenu(m); renderCourses();
}
function ajouterArticle() {
  const champ = $("#ajout-art"), v = champ.value.trim();
  if (!v) return champ.focus();
  let m = menuEnCours();
  if (!m) { m = creerMenu(); S.menus.push(m); }
  m.ajouts = m.ajouts || [];
  if (!m.ajouts.some(a => norm(a) === norm(v))) m.ajouts.push(v);
  ecrireMenu(m); renderCourses();
  $("#ajout-art").focus(); // on peut enchaîner les ajouts au clavier
}
function retirerArticle(nom) {
  const m = menuEnCours(); if (!m) return;
  const i = (m.ajouts || []).indexOf(nom); if (i < 0) return;
  m.ajouts.splice(i, 1);
  ecrireMenu(m); renderCourses();
  toast("Article retiré", () => { m.ajouts.splice(i, 0, nom); ecrireMenu(m); renderCourses(); });
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
      <button class="btn" data-act="reglages">Importer un fichier Excel</button><button class="btn pri" data-act="nouvelle">${icone("plus")}Ajouter</button></div></div>`;
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
  const ings = (r.ingredients || []).map(t => { const it = parseItem(t); return `<li>${ingImg(it ? it.name : t, 18)}<span>${esc(t)}</span></li>`; }).join("");
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
        ? `<button class="btn" disabled>${icone("check")}Au menu</button>`
        : `<button class="btn pri" data-act="au-menu">${icone("plus")}Au menu</button>`}</div>
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
  ["recette", "form", "rep", "choix"].forEach(k => delete $("#modal").dataset[k]);
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
  return ingImg(it ? it.name : (txt || "sachet"), 18);
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
  delete $("#modal").dataset.recette;
  const th = THEMES.find(t => t[0] === lireLocal("fx-theme", "auto")) || THEMES[0];
  const anim = lireLocal("fx-anim", "completes");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Réglages">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Réglages</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Apparence</div>
    <button class="reg" data-act="themes"><span>Thème</span><span class="val">${th[1]} ›</span></button>
    <div class="reg"><span>Animations</span><span class="seg">
      <button class="${anim === "completes" ? "on" : ""}" data-act="anim" data-v="completes">Complètes</button>
      <button class="${anim === "simples" ? "on" : ""}" data-act="anim" data-v="simples">Simples</button></span></div>
    ${uid ? `<div class="sect">Courses</div>
    <button class="reg" data-act="toujours"><span>Toujours dans la liste</span><span class="val">${S.toujours.length} ›</span></button>
    <div class="sect">Idées</div>
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

// « Toujours dans la liste » : articles remis à chaque nouveau menu (lait, pain…)
function ouvrirToujours() {
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Toujours dans la liste">
    <button class="retour" data-act="reglages">‹ Réglages</button>
    <h2 class="titre-r">Toujours dans la liste</h2>
    <div class="ingl">${S.toujours.map((a, i) => `<div class="li"><span class="tj-nm">${ingImg(a, 18)}${esc(a)}</span>
      <button class="ib" data-act="retirer-toujours" data-i="${i}" aria-label="Retirer">${icone("x")}</button></div>`).join("")}</div>
    <div class="srow" style="margin:0"><label class="cherche">${icone("plus")}<input id="ajout-tj" placeholder="ex. 1 L lait" autocomplete="off" enterkeyhint="done"></label>
      <button class="fab" data-act="ajouter-toujours" aria-label="Ajouter">${icone("check")}</button></div>
  </div></div>`;
}
function ajouterToujours() {
  const v = $("#ajout-tj").value.trim();
  if (!v) return $("#ajout-tj").focus();
  if (!S.toujours.some(a => norm(a) === norm(v))) {
    S.toujours.push(v); sauverToujours();
    // et tout de suite dans la liste en cours
    const m = menuEnCours();
    if (m) { m.ajouts = m.ajouts || []; if (!m.ajouts.some(a => norm(a) === norm(v))) { m.ajouts.push(v); ecrireMenu(m); } }
  }
  ouvrirToujours(); $("#ajout-tj").focus();
}
function retirerToujours(i) {
  S.toujours.splice(i, 1); sauverToujours(); ouvrirToujours();
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
  const retArt = t.closest("[data-retirer-art]");
  if (retArt) return retirerArticle(retArt.dataset.retirerArt);
  const repas = t.closest("[data-repas]");
  if (repas) return ouvrirRepas(+repas.dataset.repas);
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
    case "ajouter-art": ajouterArticle(); break;
    case "toujours": ouvrirToujours(); break;
    case "ajouter-toujours": ajouterToujours(); break;
    case "retirer-toujours": retirerToujours(+el.dataset.i); break;
    case "nb": changerNombre(+el.dataset.v); break;
    case "pers": changerPersonnes(+el.dataset.v); break;
    case "fait": cocherFait(+el.dataset.i); break;
    case "remplacer": remplacer(); break;
    case "choisir": ouvrirChoix($("#modal").dataset.rep); break;
    case "accomp": changerAccomp(); break;
    case "voir": { const o = repasOuvert(); if (o) ouvrirFiche(o.m.repas[o.i].id); break; }
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
  const filtre = e.target.dataset && e.target.dataset.filtre;
  if (filtre) { S.f[filtre] = e.target.value; renderRecettes(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { S.f.q = e.target.value; majListe(); }
  if (e.target.id === "q-choix") majChoix();
  // En tapant un ingrédient, son petit dessin se met à jour
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li) li.querySelector("img").outerHTML = dessinIng(e.target.value);
});
document.addEventListener("keydown", e => {
  // Entrée dans un ingrédient : nouvelle ligne juste en dessous (comme une liste au clavier)
  const li = e.target.closest && e.target.closest("#f-ings .li");
  if (li && e.key === "Enter") { e.preventDefault(); ajouterIngredient(li); return; }
  if (e.key === "Enter" && e.target.id === "ajout-art") { e.preventDefault(); ajouterArticle(); return; }
  if (e.key === "Enter" && e.target.id === "ajout-tj") { e.preventDefault(); ajouterToujours(); return; }
  // Échap ferme une fiche, mais pas le formulaire (pour ne pas perdre une saisie)
  if (e.key === "Escape" && $("#modal").innerHTML && !$("#modal").dataset.form) fermer();
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
