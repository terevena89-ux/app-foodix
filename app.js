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
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch;
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur } from "./excel-style.js";
import { norm, parseItem, keyOf, keyOfAncien, aisleOf, auPlacard, rayonMenage, aisleLabel, AISLE_ORDER, AISLES_FOOD, RAYONS_MENAGE, ICONES, fmtQty, ingImg, dishImg, MC } from "./pixel.js";

/* ---------- 1. Réglages de base ---------- */

const VERSION = "0.10.0";
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
  ["id", "ID", 30], ["nom", "Nom", 34], ["famille", "Famille", 16], ["variante", "Variante", 14], ["categorie", "Catégorie", 16], ["proteine", "Protéine", 16],
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
  cp: null,                               // mode Compléter (voir 7 ter)
  idees: "",                              // Réglages › Notes : idées d'amélioration (synchronisées)
  onglet: lireLocal("fx-onglet", "courses"),
  // filtres de l'écran Recettes
  f: { q: "", cats: [], prots: [], fav: false, vege: false, saison: false, avance: false, invites: false }
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

// Textures Minecraft : document à part (users/{uid}/app-foodix/donnees/textures/mc), lourd et rarement modifié,
// pour ne pas le renvoyer à chaque coche. Jamais dans le code : le dépôt est public.
const refTextures = () => doc(db, "users", uid, NOM_APPLI, "donnees", "textures", "mc");
function sauverTextures() {
  if (MODE_DEMO) { try { localStorage.setItem("fx-demo-tex", JSON.stringify(MC.tex)); } catch (e) { toast("Stockage plein"); } return; }
  setDoc(refTextures(), { tex: MC.tex }).catch(erreurEcriture);
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
  try { MC.tex = JSON.parse(localStorage.getItem("fx-demo-tex")) || {}; } catch (e) { MC.tex = {}; }
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
  arrets.push(onSnapshot(refTextures(), snap => {
    const tex = (snap.exists() && snap.data().tex) || {};
    if (JSON.stringify(tex) !== JSON.stringify(MC.tex)) { MC.tex = tex; appliquerIcones(); rerendre(); }
  }, err => console.error(err)));
}

// Va chercher les 3 morceaux de Firebase (appli, connexion, base de données).
// Une fois venus, le « gardien » hors ligne (sw.js) en garde une copie pour toujours.
async function chargerFirebase() {
  const [a, au, fs] = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => import(FB + f)));
  ({ initializeApp } = a);
  ({ getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } = au);
  ({ initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch } = fs);
}

async function demarrerFirebase() {
  try { await chargerFirebase(); }
  catch (e) {
    // Pas de réseau à la toute première ouverture, ou serveurs de Google injoignables
    $("#titre").textContent = "Foodix";
    $("#main").innerHTML = `<div class="vide">Impossible de joindre le serveur.<br>Vérifie le réseau.
      <div><button class="btn pri" onclick="location.reload()">Réessayer</button></div></div>`;
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
// (recalculée à chaque fois : l'appli peut rester ouverte des semaines sur le téléphone)
const saisonActuelle = () => { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9 ? "ete" : "hiver"; };
function deSaison(r) {
  const s = norm(r.saison), SAISON = saisonActuelle();
  return !s || s === "annuel" || s === SAISON || (s === "automne" && SAISON === "hiver") || (s === "printemps" && SAISON === "ete");
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
  if (a && a.id === "q") { majListe(); return; }
  render();
  // la fiche ouverte suit les changements (mais on ne touche jamais au formulaire en cours de saisie)
  if ($("#modal").dataset.recette && !$("#modal").dataset.form) ouvrirFiche($("#modal").dataset.recette);
  if (S.bq.ouvert) majBanque();
  if ($("#cp-ecran")) majCp(false);  // venu de l'autre appareil : pas pendant qu'on tape
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
// Bases (sous-recettes) : une recette de catégorie « Base », appelée dans une autre en écrivant son nom entre crochets : [Pâte brisée maison].
// Un seul niveau (les crochets dans une base sont lus comme un ingrédient normal). Jamais proposées dans le menu.
const estBase = r => norm(r.categorie) === "base";
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
const estAssemble = r => !!r && (r.assemble || ((r.ingredients || []).length > 1 && r.ingredients.every(t => { const b = sousRecette(t); return b && !estBase(b); })));
// Les accompagnements d'un plat du menu ou de la liste : un seul tiré au sort (side), ou plusieurs choisis en l'assemblant (sides)
const accompsDe = x => x.sides && x.sides.length ? x.sides : x.side ? [x.side] : [];
// Familles (variantes) : des recettes qui sont des versions du même plat (Burger bœuf / végé / poulet), même « famille »
const familleDe = r => r && r.famille ? S.recettes.filter(x => norm(x.famille) === norm(r.famille)).sort((a, b) => (a.variante || a.nom).localeCompare(b.variante || b.nom, "fr")) : (r ? [r] : []);
const cleFamille = r => r.famille ? "f:" + norm(r.famille) : r.id;
const estAccomp = r => /accompagnement/.test(norm(r.categorie));
const veutAccomp = r => /principal/.test(norm(r.categorie));
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
  m.repas.push(repasListe(x));
  sauverPropo(); ecrireMenu(m); fermer(); render();
  toast("Ajouté à la liste", () => { m.repas.pop(); S.propo.repas.splice(i, 0, x); sauverPropo(); ecrireMenu(m); render(); });
}
function accepterTout(choixFait) {
  const l = S.propo.repas; if (!l.length) return;
  if (!choixFait) return demanderBases(l, () => accepterTout(true));
  const m = listeEnCours(), n = m.repas.length;
  vibrer("gros");
  document.querySelectorAll(".rp.propo .rp-btn img").forEach((img, k) => voler(img, k * 90));
  l.forEach(x => m.repas.push(repasListe(x)));
  S.propo.repas = [];
  sauverPropo(); ecrireMenu(m); render();
  toast(l.length + " plat" + (l.length > 1 ? "s" : "") + " dans la liste", () => { m.repas.splice(n); S.propo.repas = l; sauverPropo(); ecrireMenu(m); render(); });
}

// Un plat qui entre dans la liste : { id, side, fait, achete: [bases achetées toutes prêtes] }
const repasListe = x => { const o = { id: x.id, side: x.side || null, fait: false }; if (x.sides) o.sides = x.sides; if (x.achete && x.achete.length) o.achete = x.achete; return o; };

// Avant d'ajouter des plats qui utilisent une base (pâte, sauce…) : « je la fais » ou « je l'achète toute prête » ?
// On demande à chaque fois (rien n'est retenu). Le choix est noté sur le plat (x.achete), puis on continue.
function demanderBases(plats, ensuite) {
  const q = [];
  plats.forEach((x, n) => [x.id, ...accompsDe(x)].forEach(id => basesDe(recette(id)).forEach(b => q.push({ n, plat: recette(id).nom, b }))));
  if (!q.length) return ensuite();
  const md = $("#modal");
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete md.dataset[k]);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Bases">
    <div class="fi-hd"><div class="txt"><h2>Je la fais ou je l'achète ?</h2><div class="sub">Pour la liste de courses</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${q.map((o, k) => `<div class="base-q"><div class="w"><b>${esc(o.b.nom)}</b><span class="sub">pour ${esc(o.plat)}</span></div>
      <span class="seg" data-base-q="${k}" data-n="${o.n}" data-nom="${esc(o.b.nom)}"><button class="on" data-v="fais">Je la fais</button><button data-v="achete">Je l'achète</button></span></div>`).join("")}
    <div class="pied2"><button class="btn" data-act="fermer">Annuler</button><button class="btn pri" data-act="bases-ok">${icone("cart")}Ajouter à la liste</button></div></div></div>`;
  md.suite = () => {
    document.querySelectorAll("[data-base-q]").forEach(g => {
      if (!g.querySelector('[data-v="achete"]').classList.contains("on")) return;
      const x = plats[+g.dataset.n]; x.achete = [...new Set([...(x.achete || []), g.dataset.nom])];
    });
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
    <div class="defile">${pastille("vege", "leaf", "Végé")}${pastille("rapide", "clock", "Rapide")}${pastille("avance", "box", "À l'avance")}${pastille("invites", "glass", "Invités")}</div>`;
  if (!S.recettes.length) { $("#main").innerHTML = `<div class="vide">Ajoute d’abord des recettes (onglet Recettes).</div>`; return; }
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
  $("#main").innerHTML = haut
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
    <div class="actions">
      ${src === "p" ? `<button class="act pri" data-act="accepter" data-i="${i}">${icone("cart")}Ajouter à la liste de courses</button>
      <button class="act" data-act="remplacer">${icone("refresh")}Remplacer (au hasard)</button>
      <button class="act" data-act="choisir">${icone("search")}Choisir un autre plat…</button>` : ""}
      ${veutAccomp(r) && !x.sides ? `<button class="act" data-act="accomp">${icone("refresh")}Changer l'accompagnement</button>` : ""}
      ${veutAccomp(r) ? `<button class="act" data-act="asm-repas">${icone("utensils")}${x.sides ? "Modifier l'assemblage" : "Assembler avec d'autres accompagnements"}</button>` : ""}
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
  });
}

/* ---------- 4 bis bis. Assembler un plat complet (principal + un ou plusieurs accompagnements) ---------- */
// Depuis la fiche d'un plat principal ou d'un accompagnement : je vois ce qui va avec, je compose,
// puis « Juste au menu » (provisoire, par défaut : rien n'est créé dans mes recettes)
// ou « Garder dans mes recettes » (une vraie recette « Plat complet » : [Principal]; [Accompagnement]…, liée à ses morceaux).
// Dans les deux cas, le plat arrive dans les propositions du menu.

// Ce qui va avec : d'abord ce que j'ai déjà mangé ensemble, puis les favoris, puis ce qui est de saison
function vaAvec(cherche, avec) {
  const ensemble = new Map();
  const noter = (p, a) => { const k = p + "|" + a; ensemble.set(k, (ensemble.get(k) || 0) + 1); };
  [...S.menus.flatMap(m => m.repas), ...S.propo.repas].forEach(x => accompsDe(x).forEach(a => noter(x.id, a)));
  S.recettes.filter(estAssemble).forEach(r => { const [p, ...as] = (r.ingredients || []).map(sousRecette).filter(Boolean); if (p) as.forEach(a => noter(p.id, a.id)); });
  const l = S.recettes.filter(cherche === "accomp" ? estAccomp : veutAccomp);
  const score = r => {
    const deja = avec.reduce((n, id) => n + (ensemble.get(cherche === "accomp" ? id + "|" + r.id : r.id + "|" + id) || 0), 0);
    return { r, deja, s: deja * 10 + (r.favori ? 3 : 0) + (deSaison(r) ? 1 : 0) };
  };
  return l.map(score).sort((a, b) => b.s - a.s || parNom(a.r, b.r));
}
const nomAssemble = (p, as) => p.nom + " & " + as.map(a => a.nom.charAt(0).toLowerCase() + a.nom.slice(1)).join(", ");

function ouvrirAssembler(depart, accs = [], repasI = null) {
  const r = recette(depart); if (!r) return;
  S.asm = { princ: veutAccomp(r) ? r.id : null, accs: estAccomp(r) ? [r.id] : accs.slice(), nom: "", tout: false, repasI };
  vibrer("pas");
  majAssembler(true);
}
function majAssembler(premier) {
  const a = S.asm, md = $("#modal"), haut = !premier && $("#modal .fiche") ? $("#modal .fiche").scrollTop : 0;
  const p = a.princ && recette(a.princ), as = a.accs.map(recette).filter(Boolean);
  const chips = (cherche, avec, choisis, attr) => {
    const l = vaAvec(cherche, avec), n = a.tout ? l.length : 8;
    // ce qui est déjà choisi reste visible même s'il est loin dans la liste
    const vus = l.slice(0, n), reste = l.slice(n).filter(o => choisis.includes(o.r.id));
    return [...vus, ...reste].map(o => `<button class="chip ${choisis.includes(o.r.id) ? "on" : ""}" data-${attr}="${esc(o.r.id)}">${choisis.includes(o.r.id) ? icone("check") : ""}${esc(o.r.nom)}${o.deja ? ` <small>déjà ensemble</small>` : o.r.favori ? icone("star") : ""}</button>`).join("")
      + (l.length > n ? `<button class="chip nouv" data-act="asm-tout">Tout voir (${l.length})</button>` : "");
  };
  const nom = a.nom || (p && as.length ? nomAssemble(p, as) : "");
  const pret = p && as.length;
  md.dataset.asm = "1";
  ["recette", "form", "rep", "src", "choix", "archive", "filtres"].forEach(k => delete md.dataset[k]);
  md.innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche asm" role="dialog" aria-label="Assembler un plat complet">
    <div class="fi-hd"><div class="txt"><h2>Assembler un plat complet</h2><div class="sub">Provisoire tant que je ne le garde pas</div></div>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Plat principal</div><div class="pastilles">${chips("princ", a.accs, a.princ ? [a.princ] : [], "asm-p")}</div>
    <div class="sect">Accompagnements <i>· un ou plusieurs</i></div><div class="pastilles">${chips("accomp", a.princ ? [a.princ] : [], a.accs, "asm-a")}</div>
    ${pret ? `<div class="asm-apercu">${[p, ...as].map((x, k) => `${k ? `<span class="asm-plus">+</span>` : ""}<div class="asm-bloc">${dishImg(x, 26)}<div><b>${esc(x.nom)}</b><small>${(x.ingredients || []).length} ingrédient${(x.ingredients || []).length > 1 ? "s" : ""} · pour ${x.portions || 2}</small></div></div>`).join("")}</div>
    <div class="champ"><label for="asm-nom">Nom</label><input class="saisie" id="asm-nom" value="${esc(nom)}" autocomplete="off"></div>` : `<p class="infos">Choisis un plat principal et au moins un accompagnement.</p>`}
    <div class="pied2"><button class="btn" data-act="asm-garder" ${pret ? "" : "disabled"}>${icone("book")}Garder dans mes recettes</button>
      <button class="btn pri" data-act="asm-menu" ${pret ? "" : "disabled"}>${icone("cal")}Juste au menu</button></div>
  </div></div>`;
  if (!premier) { const f = $("#modal .fiche"); f.style.animation = "none"; f.parentElement.style.animation = "none"; f.scrollTop = haut; }
}
// Le plat assemblé arrive dans les propositions (ou remplace le plat du menu qu'on était en train d'assembler)
function poserAuMenu(x, msg) {
  const i = S.asm.repasI, avant = S.propo.repas.slice();
  if (i != null && S.propo.repas[i]) S.propo.repas[i] = x; else S.propo.repas.push(x);
  S.cascade = false; sauverPropo(); fermer(); render();
  vibrer("ajout");
  toast(msg, () => { S.propo.repas = avant; sauverPropo(); render(); });
}
function assemblerAuMenu() {
  const a = S.asm; if (!a.princ || !a.accs.length) return;
  poserAuMenu({ id: a.princ, side: a.accs[0], sides: a.accs.slice() }, "Au menu (provisoire)");
}
function assemblerGarder() {
  const a = S.asm, p = recette(a.princ), as = a.accs.map(recette).filter(Boolean); if (!p || !as.length) return;
  const nom = ($("#asm-nom").value || "").trim() || nomAssemble(p, as);
  let id = idDe(nom), n = 2;
  while (S.recettes.some(x => x.id === id)) id = idDe(nom) + "-" + n++;
  const r = { id, nom, categorie: "Plat complet", assemble: true, portions: p.portions || 2, ingredients: [p, ...as].map(x => "[" + x.nom + "]"), ingredientsSource: "app",
    favori: false, vege: !!(p.vege && as.every(x => x.vege)), prep: false, date: false };
  ["proteine", "saison", "origine"].forEach(k => { if (p[k]) r[k] = p[k]; });
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
    const deplier = (rec, k, niveau) => (rec.ingredients || []).forEach(txt => {
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
    const e = idx.get(cleBanque(a));
    map.set(cleAjout(a), { cle: cleAjout(a), nom: a, unite: "", qte: null, recettes: [], rayon: e ? e.rayon : "perso", ajout: true });
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
  const coches = {}; // pour le tri : seulement les lignes entièrement prises
  Object.values(groupes).flat().concat(placard).forEach(e => { if (e.pris === true) coches[e.cle] = true; });
  // Une partie déjà prise : on affiche ce qui manque, et « 2 déjà pris » sous le nom
  const partiel = e => typeof e.pris === "number" && e.pris > 0;
  const reste = e => partiel(e) ? e.qte - e.pris : e.qte;
  const sousNom = e => [partiel(e) ? fmtQty(e.pris, e.unite) + " déjà pris" : "", ...e.recettes].filter(Boolean).join(" · ");
  const ligne = e => `<div class="it ${coches[e.cle] ? "fait" : ""}" data-k="${esc(e.cle)}" ${e.ajout ? `data-ajout="${esc(e.nom)}"` : ""}>
      <button class="cb" data-coche="${esc(e.cle)}" aria-label="${coches[e.cle] ? "Pas encore pris" : "Pris"}">${coches[e.cle] ? icone("check") : ""}</button>
      ${imgIng(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${sousNom(e) ? `<span class="for">${esc(sousNom(e))}</span>` : ""}</span>
      <span class="q num">${esc(fmtQty(reste(e), e.unite))}</span>
      ${e.ajout ? `<button class="ib" data-retirer-art="${esc(e.nom)}" aria-label="Retirer">${icone("x")}</button>` : ""}
      ${!e.ajout ? `<button class="ib souris" data-masquer="${esc(e.cle)}" aria-label="Retirer de cette liste">${icone("x")}</button>` : ""}
      ${e.placard && !e.ajout ? `<button class="ib" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui" aria-label="Finalement je l'ai (remettre au placard)">${icone("box")}</button>` : ""}</div>`;
  const lignePlacard = e => `<div class="pl ${dispo[e.cle] === "oui" ? "fait" : ""}">
      <div class="pl-h">${imgIng(e.nom, 18)}<span class="w"><span class="nm">${esc(e.nom)}</span>${e.recettes.length ? `<span class="for">${esc(e.recettes.join(" · "))}</span>` : ""}</span><span class="q num">${esc(fmtQty(e.qte, e.unite))}</span></div>
      <div class="pl-b"><button class="chip ${dispo[e.cle] === "oui" ? "on" : ""}" data-act="dispo" data-cle="${esc(e.cle)}" data-v="oui">${icone("check")}Je l'ai</button>
        <button class="chip" data-act="dispo" data-cle="${esc(e.cle)}" data-v="non">${icone("cart")}Il me faut</button></div></div>`;
  // Dans chaque rayon : ce qui reste à prendre en haut, ce qui est déjà pris en bas
  const tri = l => l.sort((a, b) => (coches[a.cle] ? 1 : 0) - (coches[b.cle] ? 1 : 0) || a.nom.localeCompare(b.nom, "fr"));
  let html = "";
  AISLE_ORDER.filter(a => groupes[a]).forEach(a => {
    html += `<div class="rayon"><h3>${aisleLabel(a)}</h3>${tri(groupes[a]).map(ligne).join("")}</div>`;
  });
  // Ce que j'ai peut-être déjà : replié tout en bas. Pour chacun : « je l'ai » ou « il me faut ».
  if (placard.length) {
    const aVerifier = placard.filter(e => !dispo[e.cle]).length;
    html += `<details class="rayon placard" ${S.placardOuvert ? "open" : ""}><summary>${icone("right")}Peut-être au placard (${aVerifier ? aVerifier + " à vérifier" : placard.length})</summary>${tri(placard).map(lignePlacard).join("")}</details>`;
  }
  if (nbMasques) html += `<button class="lien-btn remettre" data-act="remettre-masques">${icone("refresh")}${nbMasques} ingrédient${nbMasques > 1 ? "s" : ""} retiré${nbMasques > 1 ? "s" : ""} · remettre</button>`;
  $("#main").innerHTML = ajout + (html || `<div class="vide">Liste vide.<br>Ajoute des articles ci-dessus, ou des plats depuis l'onglet Menu.</div>`);
  if (html) $("#main").insertAdjacentHTML("beforeend", `<div class="astuce">Glisse un article vers la gauche pour le retirer</div>`);
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

// Cocher : la case se remplit avec un rebond, le nom se barre, puis l'article descend en bas de son rayon
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
  cocheT = setTimeout(() => flip("#main .it", renderCourses), 480);  // on laisse voir la coche avant de ranger
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
  return connu ? null : cleBanque(avecQte ? it.name : v);  // clé du nouvel article de la banque
}
function ajouterArticle(menage = false) {
  const champ = $("#ajout-art"), v = champ.value.trim();
  if (!v) return champ.focus();
  const nouveau = ajouterALaListe(v, menage); vibrer("ajout");
  champ.value = ""; flip("#main .it", renderCourses);
  if (nouveau) return ouvrirFicheBanque(nouveau, true);  // article inconnu : on règle tout de suite rayon, icône…
  $("#ajout-art").focus(); // on peut enchaîner les ajouts au clavier
}
// Retirer un ingrédient venu d'une recette (glissement) : il est caché de cette liste, « remettre » le fait revenir
function masquer(cle) {
  const m = menuEnCours(); if (!m) return;
  // On retient la quantité : si un plat ajouté plus tard en redemande, l'ingrédient revient
  const e = articles(m).find(x => x.cle === cle);
  m.masques = Object.assign({}, m.masques, { [cle]: e ? marque(e) : true });
  vibrer("retire"); ecrireMenu(m); renderCourses();
  toast("Ingrédient retiré", () => { delete m.masques[cle]; ecrireMenu(m); flip("#main .it", renderCourses); });
}
function remettreMasques() {
  const m = menuEnCours(); if (!m) return;
  m.masques = {}; vibrer("ajout"); ecrireMenu(m); flip("#main .it", renderCourses);
}
function retirerArticle(nom) {
  const m = menuEnCours(); if (!m) return;
  const i = (m.ajouts || []).indexOf(nom); if (i < 0) return;
  m.ajouts.splice(i, 1); vibrer("retire");
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
      ${bloc("Articles récurrents", rec.map(e => ligne("art", e.nom, ingImg(e.nom, 18, e.icone, e.mc), e.nom, e.menage ? `<span class="t">Ménager</span>` : "")))}
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
  if (animOK()) document.querySelectorAll("#main .it").forEach((el, k) => el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: k * 25, easing: DOUX, fill: "backwards" }));
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
const imgIng = (nom, px = 18) => { const b = entreeDe(cleBanque(nom)); return ingImg(nom, px, b && b.icone, b && b.mc); };

function banque() {
  const auto = new Map();
  S.recettes.forEach(r => (r.ingredients || []).forEach(txt => {
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
  if (!b.rec && !b.menage && !b.rayon && !b.icone && !b.mc && typeof b.placard !== "boolean" && e.recettes.length) S.banque = S.banque.filter(x => x !== b);
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
  S.banque = S.banque.filter(x => cleStockee(x) !== cle);
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
  S.bq.detail = null; S.bq.suppr = null; S.bq.ouvert = true; S.bq.scroll = 0; S.bq.choisir = choisir; S.bq.seule = false;
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
// Fiche d'un article qu'on vient d'ajouter. seule = ouverte depuis les Courses : Retour referme tout.
function ouvrirFicheBanque(cle, seule = false) {
  if (!S.bq.ouvert) ouvrirBanque();
  S.bq.seule = seule; S.bq.suppr = null; S.bq.detail = cle;
  majBanque();
}
function retourBanque() {
  if (S.bq.detail && !S.bq.seule) { S.bq.detail = null; S.bq.suppr = null; return majBanque(); }
  S.bq.seule = false;
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
      ? `<button class="bq-t pick ${dansListe.has(e.cle) ? "on" : ""}" data-bq-pick="${esc(e.cle)}" aria-pressed="${dansListe.has(e.cle)}">${ingImg(e.nom, 18, e.icone, e.mc)}<span class="nm">${esc(e.nom)}</span><span class="cb">${icone("check")}</span></button>`
      : `<button class="bq-t" data-bq-ouvrir="${esc(e.cle)}">${ingImg(e.nom, 18, e.icone, e.mc)}<span class="nm">${esc(e.nom)}</span>${e.placard ? icone("box", "rec") : ""}${e.rec ? icone("refresh", "rec") : ""}</button>`).join("")}</div></div>`;
  });
  if (!html) html = `<div class="vide" style="padding:28px 8px">${q ? "Rien ne correspond. Touche + pour l'ajouter." : S.bq.rec ? "Aucun article récurrent." : S.bq.placard ? "Rien au placard." : "Rien ici pour l'instant."}</div>`;
  const idees = men && !q && !S.bq.rec && !S.bq.placard ? MENAGER_IDEES.filter(([n]) => !tous.some(e => e.cle === cleBanque(n))) : [];
  if (idees.length) html += `<div class="rayon"><h3>Idées</h3><div class="sugg">${idees.map(([n, r]) => `<button class="chip nouv" data-bq-idee="${esc(n)}" data-r="${r}">${icone("plus")}${esc(n)}</button>`).join("")}</div></div>`;
  return html;
}

function htmlFicheIngredient(e) {
  const rayons = rayonsDe(e.menage).map(r => `<button type="button" class="chip ${r === e.rayon ? "on" : ""}" data-bq-rayon="${r}">${esc(libelleRayon(r))}</button>`).join("");
  // Style Minecraft : on choisit parmi les textures importées (champ « mc », indépendant de l'icône Foodix)
  const icones = mcActif() ? `<button type="button" class="bq-ic auto ${e.mc ? "" : "on"}" data-bq-mc="" aria-label="Automatique">${ingImg(e.court, 24, e.icone)}<small>Auto</small></button>`
    + Object.keys(MC.tex).map(k => `<button type="button" class="bq-ic ${e.mc === k ? "on" : ""}" data-bq-mc="${esc(k)}" aria-label="${esc(k.replace(/_/g, " "))}"><img class="px" src="${MC.tex[k]}" width="24" height="24" alt=""></button>`).join("")
    : `<button type="button" class="bq-ic auto ${e.icone ? "" : "on"}" data-bq-icone="" aria-label="Automatique">${ingImg(e.court, 24)}<small>Auto</small></button>`
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

// Les recettes qui passent la recherche et les filtres
function filtrees() {
  const f = S.f, q = norm(f.q);
  return S.recettes.filter(r =>
    (!q || norm([r.nom, r.proteine, r.origine, (r.ingredients || []).join(" ")].join(" ")).includes(q)) &&
    // plusieurs catégories (ou protéines) cochées : l'une OU l'autre
    (!f.cats.length || f.cats.includes(r.categorie)) && (!f.prots.length || f.prots.includes(r.proteine)) &&
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
  const f = S.f, n = f.cats.length + f.prots.length;
  // Bouton « Filtres » (ouvre une feuille avec des cases) ; les filtres choisis restent en pastilles, une croix pour les enlever
  const liste = () => `<button class="chip filtres ${n ? "on" : ""}" data-act="filtres">${icone("sliders")}Filtres${n ? `<b>${n}</b>` : ""}</button>`
    + f.cats.map(c => `<button class="chip on" data-retire-f="cats" data-v="${esc(c)}">${esc(c)}${icone("x")}</button>`).join("")
    + f.prots.map(c => `<button class="chip on" data-retire-f="prots" data-v="${esc(c)}">${esc(c)}${icone("x")}</button>`).join("");
  const bascule = (k, ic, txt) => `<button class="chip ${f[k] ? "on" : ""}" data-bascule="${k}">${ic ? icone(ic) : ""}${txt}</button>`;
  $("#main").innerHTML = `
    <div class="srow"><label class="cherche">${icone("search")}<input id="q" type="search" placeholder="Chercher…" value="${esc(f.q)}" autocomplete="off">
      ${f.q ? `<button data-act="effacer-q" aria-label="Effacer">${icone("x")}</button>` : ""}</label>
      <button class="btn" data-act="banque" aria-label="Banque d'ingrédients">${icone("carrot")}Ingrédients</button>
      <button class="fab" data-act="nouvelle" aria-label="Ajouter une recette">${icone("plus")}</button></div>
    <div class="defile">${liste()}
      ${bascule("fav", "star", "Favoris")}${bascule("vege", "leaf", "Végé")}${bascule("saison", "sun", "De saison")}
      ${bascule("avance", "box", "À l'avance")}${bascule("invites", "glass", "Invités")}</div>
    <div id="liste"></div>`;
  majListe();
}

// Redessine seulement la liste (pendant la frappe dans la recherche)
// Une famille = une seule ligne (« Burger · Bœuf, Végé, Poulet »), sur la 1re variante qui passe les filtres.
// Les bases (sous-recettes) sont rangées à part, en bas.
function majListe() {
  const vues = new Set(), l = filtrees().filter(r => { const k = cleFamille(r); if (vues.has(k)) return false; vues.add(k); return true; });
  const ligne = r => {
    const fam = familleDe(r), nom = fam.length > 1 ? r.famille : r.nom;
    return `<button class="ligne" data-fiche="${esc(r.id)}" data-k="${esc(cleFamille(r))}">${dishImg(r, 28)}
      <span class="nm">${esc(nom)}${fam.length > 1 ? `<small>${fam.map(x => esc(x.variante || x.nom)).join(" · ")}</small>` : ""}</span>
      <span class="ri">${fam.length > 1 ? `<span class="t acc">${fam.length} variantes</span>` : ""}${estBase(r) ? `<span class="t fav">Base</span>` : ""}${estAssemble(r) ? `<span class="t acc">Assemblé</span>` : ""}${fam.some(x => x.favori) ? icone("star", "fav") : ""}${fam.some(x => x.vege) ? icone("leaf", "acc") : ""}${r.prep ? icone("box") : ""}${r.date ? icone("glass") : ""}</span></button>`;
  };
  const plats = l.filter(r => !estBase(r)), bases = l.filter(estBase);
  $("#liste").innerHTML = l.length ? plats.map(ligne).join("") + (bases.length ? `<div class="sec-t"><h3>Bases (sous-recettes)</h3></div>` + bases.map(ligne).join("") : "")
    : `<div class="vide">Aucune recette ne correspond.</div>`;
}

// Feuille « Filtres » : catégories et protéines, plusieurs à la fois
function ouvrirFiltres() {
  const f = S.f, valeurs = k => [...new Set(S.recettes.map(r => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const nb = (k, v) => S.recettes.filter(r => r[k] === v).length;
  const cases = (fk, k) => valeurs(k).map(v => `<button class="rc ${f[fk].includes(v) ? "on" : ""}" data-filtre-case="${fk}" data-v="${esc(v)}"><span class="cb">${icone("check")}</span><span class="nm">${esc(v)}</span><span class="t">${nb(k, v)}</span></button>`).join("");
  const n = filtrees().length;
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete $("#modal").dataset[k]);
  $("#modal").dataset.filtres = "1";
  const haut = $("#modal .fiche") && $("#modal").dataset.filtres ? $("#modal .fiche").scrollTop : 0, deja = !!$("#modal .filtres-f");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche filtres-f" role="dialog" aria-label="Filtres">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Filtres</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Catégories</div><div class="grille2">${cases("cats", "categorie")}</div>
    <div class="sect">Protéines</div><div class="grille2">${cases("prots", "proteine")}</div>
    <div class="pied2"><button class="btn" data-act="filtres-effacer">Tout effacer</button><button class="btn pri" data-act="fermer">Voir ${n} recette${n > 1 ? "s" : ""}</button></div></div></div>`;
  if (deja) { const fi = $("#modal .fiche"); fi.style.animation = "none"; fi.parentElement.style.animation = "none"; fi.scrollTop = haut; }
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
  // Variantes : pastilles pour passer de l'une à l'autre ; les ingrédients propres à cette variante sont marqués
  const fam = familleDe(r), communs = fam.length > 1 ? (r.ingredients || []).filter(t => fam.every(x => (x.ingredients || []).includes(t))) : null;
  const ings = (r.ingredients || []).map((t, i) => {
    const b = sousRecette(t);
    if (b && !estBase(r)) {
      const ouvert = S.basesOuvertes && S.basesOuvertes.has(b.id);
      return `<li class="base-l ${ouvert ? "ouvert" : ""}"><button class="base-hd" data-deplier="${esc(b.id)}" aria-expanded="${!!ouvert}">${icone("book")}<span>${esc(b.nom)}</span>${icone("right", "chev")}</button>
        ${ouvert ? `<div class="base-in">${(b.ingredients || []).map(x => `<span>${imgIng(x, 16)}${esc(x)}</span>`).join("")}<button class="lien-btn" data-fiche="${esc(b.id)}">Ouvrir la recette ${icone("right")}</button></div>` : ""}</li>`;
    }
    const propre = communs && !communs.includes(t);
    return `<li class="${propre ? "propre" : ""}">${imgIng(t, 18)}<span>${esc(t)}</span></li>`;
  }).join("");
  const utilisee = estBase(r) ? S.recettes.filter(x => (x.ingredients || []).some(t => norm(nomCrochets(t) || "") === norm(r.nom))) : [];
  ["form", "rep", "choix", "filtres"].forEach(k => delete $("#modal").dataset[k]);
  $("#modal").dataset.recette = id;
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="${esc(r.nom)}">
    <div class="fi-hd">${dishImg(r, 44)}<div class="txt"><h2>${esc(fam.length > 1 ? r.famille : r.nom)}</h2><div class="tg">${tags.join("")}</div></div>
      <button class="ib" data-act="menu3" aria-label="Plus d'actions">${icone("more")}</button>
      <button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="menu3" id="menu3" hidden>
      <button data-act="modifier">${icone("pen")}Modifier</button>
      <button data-act="dupliquer">${icone("copy")}Dupliquer</button>
      ${estBase(r) ? "" : `<button data-act="variante">${icone("plus")}Nouvelle variante</button>`}
      <button class="danger" data-act="supprimer">${icone("trash")}Supprimer</button></div>
    ${fam.length > 1 ? `<div class="variantes">${fam.map(x => `<button class="chip ${x.id === r.id ? "on" : ""}" data-fiche="${esc(x.id)}" data-variante>${x.vege ? icone("leaf") : ""}${esc(x.variante || x.nom)}</button>`).join("")}</div>` : ""}
    ${utilisee.length ? `<p class="infos">Base (sous-recette) : elle sert dans ${utilisee.map(u => `<b>${esc(u.nom)}</b>`).join(", ")}. Jamais proposée dans le menu.</p>` : ""}
    ${faits ? `<dl class="faits">${faits}</dl>` : ""}
    <div><div class="h4">Ingrédients <i>pour ${r.portions || 2}${r.ingredientsSource === "suggestion" ? " · suggérés" : ""}</i></div>
      ${communs ? `<div class="legende"><i></i>propre à « ${esc(r.variante || r.nom)} » · le reste est commun</div>` : ""}
      ${ings ? `<ul class="ings">${ings}</ul>` : `<div class="sub">Aucun ingrédient.</div>`}</div>
    ${veutAccomp(r) || estAccomp(r) ? `<button class="btn asm-btn" data-act="assembler">${icone("utensils")}${estAccomp(r) ? "Avec quel plat ? Assembler un plat complet" : "Avec quoi ? Assembler un plat complet"}</button>` : ""}
    ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
    ${/^https?:\/\//.test(r.lien || "") ? `<a class="lien" href="${esc(r.lien)}" target="_blank" rel="noopener">${icone("link")}Voir la recette en ligne</a>` : ""}
    <div class="gros"><button class="btn ${r.favori ? "fav-on" : ""}" data-act="favori">${icone("star")}${r.favori ? "Favori" : "Mettre en favori"}</button>
      ${estBase(r) ? "" : menuEnCours() && menuEnCours().repas.some(x => x.id === r.id)
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
  ["recette", "form", "rep", "src", "choix", "archive", "filtres", "asm"].forEach(k => delete $("#modal").dataset[k]);
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
      <div class="duo2"><div class="champ"><label for="f-famille">Famille</label><input class="saisie" id="f-famille" list="familles" placeholder="ex. Burger" value="${esc(r.famille || "")}" autocomplete="off"></div>
        <div class="champ"><label for="f-variante">Variante</label><input class="saisie" id="f-variante" placeholder="ex. Végé" value="${esc(r.variante || "")}" autocomplete="off"></div></div>
      <datalist id="familles">${[...new Set(S.recettes.map(x => x.famille).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join("")}</datalist>
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
  const bases = S.recettes.filter(b => estBase(b) && norm(b.nom).includes(q)).slice(0, 3);
  const l = banque().filter(e => !e.menage && norm(e.court) !== q && (norm(e.court).includes(q) || e.cle === it.key))
    .sort((a, b) => (a.cle === it.key ? 0 : 1) - (b.cle === it.key ? 0 : 1) || (norm(a.court).startsWith(q) ? 0 : 1) - (norm(b.court).startsWith(q) ? 0 : 1) || b.recettes.length - a.recettes.length || parNom(a, b)).slice(0, 6);
  if (!l.length && !bases.length) return;
  const box = document.createElement("div");
  box.className = "sugg-ing";
  // « on » = c'est déjà le même ingrédient, écrit autrement : à uniformiser
  box.innerHTML = bases.map(b => `<button type="button" class="chip base" data-sugg-base="${esc(b.nom)}">${icone("book")}${esc(b.nom)}</button>`).join("")
    + l.map(e => `<button type="button" class="chip ${e.cle === it.key ? "on" : ""}" data-sugg-ing="${esc(e.court)}">${esc(e.court)}</button>`).join("");
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
  const fa = $("#f-famille").value.trim(), va = $("#f-variante").value.trim();
  if (fa) r.famille = fa; else delete r.famille;
  if (fa && va) r.variante = va; else delete r.variante;
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
  // Première variante d'une recette seule : l'original rejoint la famille (variante « Classique » si rien n'est dit)
  if (r.varianteDe) {
    const o = recette(r.varianteDe);
    if (o && !o.famille && r.famille) { o.famille = r.famille; o.variante = o.variante || "Classique"; ecrireRecette(o); }
    delete r.varianteDe;
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
  $("#f-plus").hidden = false;
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
  const anim = lireLocal("fx-anim", "completes"), vibr = lireLocal("fx-vibr", "oui");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Réglages">
    <div class="fi-hd"><h2 class="titre-r" style="flex:1">Réglages</h2><button class="ib" data-act="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="sect">Apparence</div>
    <button class="reg" data-act="themes"><span>Thème</span><span class="val">${th[1]} ›</span></button>
    <button class="reg" data-act="icones"><span>Icônes</span><span class="val">${lireLocal("fx-icones", "foodix") === "minecraft" ? "Minecraft" : "Foodix"} ›</span></button>
    <div class="reg"><span>Animations</span><span class="seg">
      <button class="${anim === "completes" ? "on" : ""}" data-act="anim" data-v="completes">Complètes</button>
      <button class="${anim === "simples" ? "on" : ""}" data-act="anim" data-v="simples">Simples</button></span></div>
    <div class="reg"><span>Vibrations</span><span class="seg">
      <button class="${vibr === "oui" ? "on" : ""}" data-act="vibr" data-v="oui">Oui</button>
      <button class="${vibr === "non" ? "on" : ""}" data-act="vibr" data-v="non">Non</button></span></div>
    ${uid ? `<div class="sect">Recettes</div>
    <button class="reg" data-act="completer"><span>${icone("pen")} Compléter mes recettes</span><span class="val">${(() => { const n = S.recettes.filter(r => Object.values(GROUPES_CP).some(g => g.manque(r))).length; return n ? n + " à compléter ›" : "›"; })()}</span></button>
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

function ouvrirThemes() {
  const c = lireLocal("fx-theme", "auto");
  $("#modal").innerHTML = `<div class="voile" data-act="fermer-fond"><div class="fiche" role="dialog" aria-label="Thème">
    <button class="retour" data-act="reglages">‹ Réglages</button>
    <h2 class="titre-r">Thème</h2>
    ${THEMES.map(([v, nom, desc]) => `<button class="choix ${v === c ? "on" : ""}" data-act="theme" data-v="${v}"><span class="rond"></span><span><b>${nom}</b>${desc ? `<small>${desc}</small>` : ""}</span></button>`).join("")}
  </div></div>`;
}

// Icônes : style de CET appareil (comme le thème) ; les textures, elles, sont synchronisées
const mcActif = () => lireLocal("fx-icones", "foodix") === "minecraft" && Object.keys(MC.tex).length > 0;
function appliquerIcones() { MC.actif = mcActif(); }
function ouvrirIcones() {
  const c = lireLocal("fx-icones", "foodix"), n = Object.keys(MC.tex).length;
  const choix = [["foodix", "Foodix", ""], ["minecraft", "Minecraft", n ? "" : "Importer d'abord des textures"]];
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
  if (lireLocal("fx-icones", "foodix") !== "minecraft") ecrireLocal("fx-icones", "minecraft");  // on vient d'importer : on veut voir le résultat
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
// Colonnes de l'onglet « Banque d'ingrédients »
const COLONNES_BANQUE = [["nom", "Nom", 28], ["type", "Type", 12], ["rayon", "Rayon", 26], ["rec", "Récurrent", 11], ["placard", "Souvent au placard", 18], ["icone", "Icône", 16], ["nb", "Nb de recettes", 14], ["recettes", "Recettes", 60]];

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
  // Onglet « Familles », juste pour lire (ignoré à l'import) : les variantes et ce qu'elles ont en commun
  const fams = [...new Set(S.recettes.map(r => r.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")).map(f => {
    const l = S.recettes.filter(r => r.famille === f);
    return { famille: f, variantes: l.map(r => r.variante || r.nom).join("; "), communs: (l[0].ingredients || []).filter(t => l.every(x => (x.ingredients || []).includes(t))).join("; ") };
  });
  // Onglet « Banque d'ingrédients » : tout ce que la banque connaît (ingrédients des recettes + ajouts à la main + produits ménagers).
  // Relu à l'import : on peut y changer le type, le rayon, « récurrent » et « souvent au placard », ou ajouter des articles.
  const ordre = r => AISLE_ORDER.indexOf(r) < 0 ? 99 : AISLE_ORDER.indexOf(r);
  const bq = banque().sort((a, b) => a.menage - b.menage || ordre(a.rayon) - ordre(b.rayon) || parNom(a, b)).map(e => ({
    nom: e.nom, type: e.menage ? "Ménager" : "Ingrédient", rayon: libelleRayon(e.rayon), rec: e.rec ? "Oui" : "Non",
    placard: e.menage ? "" : e.placard ? "Oui" : "Non", icone: e.icone && ICONES[e.icone] ? ICONES[e.icone] : "", nb: e.recettes.length || "", recettes: e.recettes.map(r => r.nom).join("; ")
  }));
  const wsB = ajouterFeuille(wb, "Banque d'ingrédients", COLONNES_BANQUE.map(([k, h, w]) => ({ header: h, key: k, width: w })), bq);
  wsB.getColumn("recettes").alignment = { wrapText: true, vertical: "middle" };
  if (fams.length) ajouterFeuille(wb, "Familles", [{ header: "Famille", key: "famille", width: 20 }, { header: "Variantes", key: "variantes", width: 36 }, { header: "Ingrédients communs", key: "communs", width: 70 }], fams);
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

// Relit l'onglet « Banque d'ingrédients » (s'il est là) : [{ nom, menage, rayon, rec, placard }]. Une case vide ne change rien.
function lireBanque(wb) {
  const ws = wb.worksheets.find(w => norm(w.name).startsWith("banque"));
  if (!ws) return [];
  const parEntete = {}, cols = [];
  COLONNES_BANQUE.forEach(c => { parEntete[norm(c[1])] = c[0]; });
  ws.getRow(1).eachCell((c, i) => { cols[i] = parEntete[norm(valeurCase(c.value))]; });
  const out = [];
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    cols.forEach((k, i) => { if (k) o[k] = String(valeurCase(rang.getCell(i).value)).trim(); });
    if (!o.nom) return;
    const oui = v => v === "" || v == null ? undefined : /^(oui|1|x|vrai|true)$/i.test(v);
    const menage = o.type ? /menag/.test(norm(o.type)) : undefined;
    const e = { nom: o.nom, menage, rec: oui(o.rec), placard: oui(o.placard) };
    if (o.rayon) { const id = [...rayonsDe(true), ...rayonsDe(false)].find(r => norm(libelleRayon(r)) === norm(o.rayon) || r === o.rayon); if (id) e.rayon = id; }
    // Icône : son nom (« Oignon »), ou « Auto » pour revenir au dessin deviné d'après le nom. Vide = pas de changement.
    if (o.icone) {
      if (norm(o.icone) === "auto") e.icone = null;
      else { const id = Object.keys(ICONES).find(k => norm(ICONES[k]) === norm(o.icone) || k === norm(o.icone)); if (id) e.icone = id; }
    }
    out.push(e);
  });
  return out;
}
// Applique la banque relue : articles inconnus ajoutés, réglages des autres mis à jour (simuler = juste compter)
function fusionBanque(lignes, simuler) {
  let ajout = 0, maj = 0;
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
      S.banque.push(b); return;
    }
    const chg = {};
    if (l.menage !== undefined && l.menage !== e.menage) chg.menage = l.menage;
    if (l.rec !== undefined && l.rec !== e.rec) chg.rec = l.rec;
    if (l.rayon && l.rayon !== e.rayon && rayonsDe(l.menage ?? e.menage).includes(l.rayon)) chg.rayon = l.rayon;
    if (l.placard !== undefined && !(l.menage ?? e.menage) && l.placard !== e.placard) chg.placard = l.placard;
    if (l.icone !== undefined && (l.icone || null) !== (e.icone || null)) chg.icone = l.icone;  // null = revenir au dessin automatique
    if (!Object.keys(chg).length) return;
    maj++;
    if (simuler) return;
    let b = entreeDe(cle);
    if (!b) { b = { nom: e.nom, cle, menage: e.menage, rec: false }; S.banque.push(b); }
    Object.assign(b, chg);
    if (b.icone === null) delete b.icone;
  });
  if (!simuler && (ajout || maj)) sauverBanque();
  return { ajout, maj };
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
    const wb = await lireClasseur(fichier);
    const lignes = lireRecettes(wb), bq = lireBanque(wb);
    if (!lignes.length && !bq.length) { box.innerHTML = `<div class="infos">Aucune recette trouvée (il faut une colonne « Nom »).</div>`; return; }
    const r = fusion(lignes, true), b = fusionBanque(bq, true);
    importEnAttente = { lignes, bq };
    const pl = (n, mot) => n + " " + mot + (n > 1 ? "s" : "");
    box.innerHTML = `<div class="infos">Recettes : ${pl(r.ajout, "nouvelle")}, ${pl(r.maj, "mise")} à jour${bq.length ? `<br>Banque d'ingrédients : ${pl(b.ajout, "nouvel article")}, ${pl(b.maj, "réglage")} ${b.maj > 1 ? "changés" : "changé"}` : ""}</div>
      <div class="pied" style="margin-top:8px"><button class="btn pri" data-act="confirmer-import">Importer</button></div>`;
  } catch (e) {
    box.innerHTML = `<div class="infos">Impossible de lire ce fichier (${esc(e && e.message || e)}).</div>`;
  }
}
function confirmerImport() {
  if (!importEnAttente) return;
  const { lignes, bq } = importEnAttente;
  const r = lignes.length ? fusion(lignes, false) : { ajout: 0, maj: 0 };
  const b = fusionBanque(bq, false);  // après les recettes : les ingrédients des nouvelles recettes sont déjà connus
  importEnAttente = null;
  fermer(); render();
  toast(`Import terminé : ${r.ajout + r.maj} recettes${b.ajout + b.maj ? `, ${b.ajout + b.maj} articles de la banque` : ""}`);
}

/* ---------- 7 bis. Gestes au doigt : changer d'onglet, retirer un article ---------- */
const ORDRE_ONGLETS = ["courses", "recettes", "menu"];
// Change d'onglet : la page part d'un côté et la nouvelle arrive de l'autre (depuisX = où le doigt l'avait laissée)
function changerOnglet(tab, depuisX = 0) {
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

// Un seul doigt qui glisse à l'horizontale :
//  - sur un article de la liste, vers la gauche : il suit le doigt, et passé un tiers de l'écran il est retiré ;
//  - ailleurs : la page suit le doigt, et passé un quart de l'écran (ou d'un coup sec) on change d'onglet.
// On ne touche à rien dans les champs, les rangées de pastilles qui défilent, les fenêtres et la banque.
let geste = null;
document.addEventListener("touchstart", e => {
  geste = null;
  if (e.touches.length !== 1 || !S.pret || $("#modal").innerHTML || S.bq.ouvert || $("#cp-ecran")) return;
  const t = e.target;
  if (t.closest("header, #tabs, .toast, #modal, input, textarea, select, .defile, .pastilles, .sugg, .poignee")) return;
  const p = e.touches[0];
  geste = { x0: p.clientX, y0: p.clientY, dx: 0, t0: Date.now(), mode: null, it: t.closest(".it"), seuil: false };
}, { passive: true });
document.addEventListener("touchmove", e => {
  if (!geste) return;
  const p = e.touches[0], dx = p.clientX - geste.x0, dy = p.clientY - geste.y0;
  if (!geste.mode) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { geste = null; return; }   // on fait défiler : pas un glissement
    if (Math.abs(dx) < 12) return;
    geste.mode = geste.it && dx < 0 ? "article" : "page";
    if (geste.mode === "article") geste.it.classList.add("glisse-g");
  }
  e.preventDefault();
  geste.dx = dx;
  const w = innerWidth;
  if (geste.mode === "article") {
    const x = Math.min(0, dx);
    geste.it.style.transform = `translateX(${x}px)`;
    geste.it.style.setProperty("--g", Math.min(1, -x / (w * .33)));
    const passe = -x > w * .33;
    if (passe !== geste.seuil) { geste.seuil = passe; if (passe) vibrer("seuil"); geste.it.classList.toggle("pret", passe); }
  } else {
    const i = ORDRE_ONGLETS.indexOf(S.onglet), voisin = ORDRE_ONGLETS[i + (dx < 0 ? 1 : -1)];
    const x = voisin ? dx : dx / 4;   // pas d'onglet de ce côté : ça résiste
    $("#main").style.transform = `translateX(${x}px)`;
    $("#main").style.opacity = 1 - Math.min(.5, Math.abs(x) / w);
    const passe = !!voisin && Math.abs(dx) > w * .25;
    if (passe !== geste.seuil) { geste.seuil = passe; if (passe) vibrer("seuil"); }
  }
}, { passive: false });
function finGeste() {
  const g = geste; geste = null;
  if (!g || !g.mode) return;
  const w = innerWidth, rapide = Math.abs(g.dx) > 60 && Date.now() - g.t0 < 250;
  if (g.mode === "article") {
    const el = g.it;
    if (-g.dx > w * .33 || (rapide && g.dx < 0)) {
      const fin = () => { const a = el.dataset.ajout; a ? retirerArticle(a) : masquer(el.dataset.k); };
      if (!animOK()) return fin();
      el.animate([{ transform: el.style.transform }, { transform: `translateX(${-w}px)` }], { duration: 160, easing: "ease-in", fill: "forwards" }).onfinish = () => {
        el.animate([{ height: el.offsetHeight + "px" }, { height: "0px", minHeight: "0px", paddingTop: 0, paddingBottom: 0 }], { duration: 160, easing: "ease-out", fill: "forwards" }).onfinish = fin;
      };
    } else {
      el.classList.remove("pret");
      el.animate([{ transform: el.style.transform }, { transform: "none" }], { duration: 220, easing: RESSORT }).onfinish = () => { el.style.transform = ""; el.classList.remove("glisse-g"); };
      el.style.transform = "";
    }
    return;
  }
  const main = $("#main"), i = ORDRE_ONGLETS.indexOf(S.onglet), voisin = ORDRE_ONGLETS[i + (g.dx < 0 ? 1 : -1)];
  main.style.opacity = "";
  if (voisin && (Math.abs(g.dx) > w * .25 || rapide)) return changerOnglet(voisin, g.dx);
  const x = main.style.transform; main.style.transform = "";
  if (animOK()) main.animate([{ transform: x }, { transform: "none" }], { duration: 260, easing: RESSORT });
}
document.addEventListener("touchend", finGeste);
document.addEventListener("touchcancel", finGeste);

// Fermer une fenêtre en douceur : elle redescend, le fond s'éclaircit (si rien d'autre ne s'est ouvert entre-temps)
function fermerDoux() {
  const fiche = $("#modal .fiche"), voile = $("#modal .voile");
  if (!fiche || !animOK() || $("#modal").dataset.form) return fermer();
  const contenu = $("#modal").firstElementChild;
  ["recette", "form", "rep", "src", "choix", "archive"].forEach(k => delete $("#modal").dataset[k]);
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
  cat: { nom: "Catégorie et protéine", manque: r => !r.categorie || (estPlat(r) && !r.proteine) },
  ing: { nom: "Ingrédients", manque: r => !(r.ingredients || []).length || r.ingredientsSource === "suggestion" },
  niv: { nom: "Prix, difficulté, temps, maîtrise", manque: r => Object.keys(NIVEAUX).some(k => !r[k]) },
  opt: { nom: "Saison, végé, à l'avance, invités", manque: r => !r.saison }
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
  const pastilles = (k, liste) => `<div class="pastilles">${liste.map(v => `<button class="chip ${v === r[k] ? "on" : ""}" data-cp-val="${k}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div>`;
  const parts = [`<div class="cp-hd">${dishImg(r, 52)}<div><h3>${esc(r.nom)}</h3><div class="sub">${m.length ? m.length + " chose" + (m.length > 1 ? "s" : "") + " à compléter" : "Complète !"}</div></div></div>`];
  if (S.cp.champs.has("cat")) parts.push(`<section>${titre("cat")}
    <span class="lbl">Catégorie</span>${pastilles("categorie", valeursDe("categorie", r.categorie).slice(0, 8))}
    <span class="lbl">Protéine</span>${pastilles("proteine", valeursDe("proteine", r.proteine).slice(0, 10))}</section>`);
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
    <span class="lbl">Saison</span>${pastilles("saison", SAISONS.includes(r.saison) || !r.saison ? SAISONS : [...SAISONS, r.saison])}
    <div class="cases">${[["vege", "leaf", "Végé"], ["prep", "box", "À l'avance"], ["date", "glass", "Invités"], ["favori", "star", "Favori"]]
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
  const val = t.closest("[data-cp-val]");
  if (val) { const k = val.dataset.cpVal, v = val.dataset.v; majRecetteCp(r => { if (r[k] === v) delete r[k]; else r[k] = v; }); return true; }
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
  if (clicCompleter(t)) return;
  const onglet = t.closest("#tabs button");
  if (onglet) return changerOnglet(onglet.dataset.tab);
  const dep = t.closest("[data-deplier]");
  if (dep) { S.basesOuvertes = S.basesOuvertes || new Set(); const k = dep.dataset.deplier; S.basesOuvertes.has(k) ? S.basesOuvertes.delete(k) : S.basesOuvertes.add(k); vibrer("pas"); const fi = $("#modal .fiche"), h = fi ? fi.scrollTop : 0; ouvrirFiche($("#modal").dataset.recette); const f2 = $("#modal .fiche"); if (f2) { f2.style.animation = "none"; f2.parentElement.style.animation = "none"; f2.scrollTop = h; } return; }
  const ligne = t.closest("[data-fiche]");
  if (ligne) {
    const garder = ligne.hasAttribute("data-variante"), fi = $("#modal .fiche");
    if (garder) vibrer("pas");
    ouvrirFiche(ligne.dataset.fiche);
    if (garder && fi) { const f2 = $("#modal .fiche"); f2.style.animation = "none"; f2.parentElement.style.animation = "none"; }
    return;
  }
  const fc = t.closest("[data-filtre-case]");
  if (fc) { const l = S.f[fc.dataset.filtreCase], v = fc.dataset.v, i = l.indexOf(v); i >= 0 ? l.splice(i, 1) : l.push(v); vibrer("pas"); renderRecettes(); return ouvrirFiltres(); }
  const rf = t.closest("[data-retire-f]");
  if (rf) { const l = S.f[rf.dataset.retireF], i = l.indexOf(rf.dataset.v); if (i >= 0) l.splice(i, 1); vibrer("decoche"); return flip("#liste .ligne", renderRecettes); }
  const bq = t.closest("[data-base-q] button");
  if (bq) { bq.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === bq)); vibrer("pas"); return; }
  const coche = t.closest("[data-coche]");
  if (coche) return cocher(coche.dataset.coche, coche);
  const sugg = t.closest("[data-sugg]");
  if (sugg) { const e = banque().find(x => x.cle === sugg.dataset.sugg); if (e) { ajouterALaListe(e.nom, e.menage); vibrer("ajout"); flip("#main .it", renderCourses); $("#ajout-art").focus(); } return; }
  const sb = t.closest("[data-sugg-base]");
  if (sb) { const li = sb.closest(".li"), c = li.querySelector("input"); c.value = "[" + sb.dataset.suggBase + "]"; li.querySelector("img").outerHTML = dessinIng(c.value); majSuggIng(null); c.focus(); return; }
  const suggIng = t.closest("[data-sugg-ing]");
  if (suggIng) return choisirSuggIng(suggIng);
  const rc = t.closest("[data-rc]");
  if (rc) { vibrer(rc.classList.toggle("on") ? "pas" : "decoche"); return; }
  const bqOuvrir = t.closest("[data-bq-ouvrir]");
  if (bqOuvrir) { S.bq.scroll = $("#bq-corps").scrollTop; S.bq.detail = bqOuvrir.dataset.bqOuvrir; S.bq.suppr = null; return majBanque(); }
  const ap = t.closest("[data-asm-p]");
  if (ap) { S.asm.princ = S.asm.princ === ap.dataset.asmP ? null : ap.dataset.asmP; S.asm.nom = ""; vibrer("pas"); return majAssembler(); }
  const aa = t.closest("[data-asm-a]");
  if (aa) { const l = S.asm.accs, v = aa.dataset.asmA, i = l.indexOf(v); i >= 0 ? l.splice(i, 1) : l.push(v); S.asm.nom = ""; vibrer(i >= 0 ? "decoche" : "pas"); return majAssembler(); }
  const vp = t.closest("[data-var-propo]");
  if (vp) { const x = S.propo.repas[+vp.dataset.varPropo], r = recette(vp.dataset.v); if (x && r) { x.id = r.id; if (!veutAccomp(r)) x.side = null; else if (!x.side) x.side = tirerAccomp(accompsPris()); sauverPropo(); vibrer("pas"); renderMenu(); } return; }
  const bqRayon = t.closest("[data-bq-rayon]");
  if (bqRayon) { majEntree(S.bq.detail, { rayon: bqRayon.dataset.bqRayon }); return majBanque(); }
  const bqIcone = t.closest("[data-bq-icone]");
  if (bqIcone) { majEntree(S.bq.detail, { icone: bqIcone.dataset.bqIcone }); return majBanque(); }
  const bqMc = t.closest("[data-bq-mc]");
  if (bqMc) { majEntree(S.bq.detail, { mc: bqMc.dataset.bqMc }); return majBanque(); }
  const bqIdee = t.closest("[data-bq-idee]");
  if (bqIdee) { const e = ajouterBanque(bqIdee.dataset.bqIdee, true, bqIdee.dataset.r); return e ? ouvrirFicheBanque(e.cle) : majBanque(); }
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
  if (bascule) { const k = bascule.dataset.bascule; S.f[k] = !S.f[k]; vibrer("pas"); return flip("#liste .ligne", renderRecettes); }
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
    case "ajouter-art": case "art-ingredient": ajouterArticle(); break;
    case "art-menage": ajouterArticle(true); break;
    case "banque": ouvrirBanque(); break;
    case "completer": ouvrirCompleter(); break;
    case "ajouter-banque": ajouterDepuisBanque(); break;
    case "bq-onglet": S.bq.onglet = el.dataset.v; majBanque(); break;
    case "bq-rec": S.bq.rec = !S.bq.rec; majBanque(); break;
    case "bq-placard": S.bq.placard = !S.bq.placard; majBanque(); break;
    case "bq-placard-fiche": { const e = banque().find(x => x.cle === S.bq.detail); if (e) { majEntree(e.cle, { placard: !e.placard }); majBanque(); } break; }
    case "dispo": vibrer(el.dataset.v === "oui" ? "coche" : "pas"); definirDispo(el.dataset.cle, el.dataset.v); break;
    case "remettre-masques": remettreMasques(); break;
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
    case "variante": nouvelleVariante(); break;
    case "assembler": ouvrirAssembler($("#modal").dataset.recette); break;
    case "asm-tout": S.asm.tout = true; majAssembler(); break;
    case "asm-menu": assemblerAuMenu(); break;
    case "asm-garder": assemblerGarder(); break;
    case "asm-repas": { const o = repasOuvert(); if (o) { const x = o.l[o.i]; ouvrirAssembler(x.id, accompsDe(x), o.src === "p" ? o.i : null); } break; }
    case "filtres": ouvrirFiltres(); break;
    case "filtres-effacer": S.f.cats = []; S.f.prots = []; renderRecettes(); ouvrirFiltres(); break;
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
    case "icones": ouvrirIcones(); break;
    case "icones-style": ecrireLocal("fx-icones", el.dataset.v); appliquerIcones(); render(); ouvrirIcones(); break;
    case "tex-effacer": effacerTextures(); break;
    case "idees": NotesIdees.ouvrir(S.idees, sauverIdees); break;
    case "theme": ecrireLocal("fx-theme", el.dataset.v); appliquerTheme(); ouvrirThemes(); break;
    case "vibr": ecrireLocal("fx-vibr", el.dataset.v); vibrer("coche"); ouvrirReglages(); break;
    case "anim": ecrireLocal("fx-anim", el.dataset.v); document.documentElement.dataset.anim = el.dataset.v; ouvrirReglages(); break;
    case "exporter": exporter(el); break;
    case "confirmer-import": confirmerImport(); break;
    case "favori": basculerFavori(); break;
    case "effacer-q": S.f.q = ""; renderRecettes(); break;
    case "fermer": if ($("#modal").dataset.filtres) { delete $("#modal").dataset.filtres; flip("#liste .ligne", renderRecettes); } fermerDoux(); break;
    case "fermer-fond": if (t === el) { delete $("#modal").dataset.filtres; fermerDoux(); } break; // toucher le fond grisé ferme, pas la fiche elle-même
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "fichier" && e.target.files[0]) importerFichier(e.target.files[0]);
  if (e.target.id === "f-tex" && e.target.files.length) importerTextures([...e.target.files]);
  if (e.target.id === "bq-nom") renommerIngredient(S.bq.detail, e.target.value);
});
document.addEventListener("input", e => {
  if (e.target.id === "asm-nom") S.asm.nom = e.target.value;
  if (e.target.id === "q") { S.f.q = e.target.value; majListe(); }
  if (e.target.id === "q-choix") majChoix();
  if (e.target.id === "ajout-art") majSuggArt();
  if (e.target.id === "q-bq") majBanque();
  if (e.target.id === "cp-ing") majSuggCp();
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
  if (e.key === "Enter" && e.target.id === "cp-ing") { e.preventDefault(); cpIngredient(e.target.value); return; }
  if (e.key === "Escape" && $("#cp-ecran")) { fermerCompleter(); return; }
  if (e.key === "Enter" && e.target.id === "bq-nom") { e.preventDefault(); e.target.blur(); return; }
  // Échap ferme une fiche, mais pas le formulaire (pour ne pas perdre une saisie)
  if (e.key === "Escape" && $("#modal").innerHTML && !$("#modal").dataset.form) fermer();
  else if (e.key === "Escape" && S.bq.ouvert && !$("#modal").innerHTML) retourBanque();
});

/* ---------- Bouton Retour d'Android ---------- */
// Le navigateur a un « historique » (la pile des pages visitées). Retour = dépiler une page.
// Dès qu'une fenêtre ou un écran s'ouvre, on empile une fausse page : Retour la dépile
// et on ferme la fenêtre du dessus, au lieu de quitter l'appli. Rien d'ouvert : Retour quitte, comme d'habitude.
// (Un « observateur » regarde la page changer, ce qui évite de toucher à chaque fonction qui ouvre quelque chose.)
let gardeRetour = false, ignorerPop = false, retourFormT = 0;
const quelqueChoseOuvert = () => !!($("#modal").innerHTML || S.bq.ouvert || $("#cp-ecran") || $(".ni-ecran"));
function majGardeRetour() {
  const ouvert = quelqueChoseOuvert();
  if (ouvert && !gardeRetour) { history.pushState({ foodix: 1 }, ""); gardeRetour = true; }
  else if (!ouvert && gardeRetour) { gardeRetour = false; ignorerPop = true; history.back(); } // fermé par un bouton : on retire la fausse page
}
function fermerDessus() {
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
    const x = md.querySelector('[data-act="fermer"]');
    return x ? x.click() : fermer();
  }
  if ($("#cp-ecran")) return fermerCompleter();
  if (S.bq.ouvert) return retourBanque();
}
window.addEventListener("popstate", () => {
  if (ignorerPop) { ignorerPop = false; return; }
  gardeRetour = false;
  fermerDessus();
  setTimeout(majGardeRetour, 50); // encore quelque chose d'ouvert (fenêtre sur la banque…) : on remet une fausse page
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

if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();

// Le placard replié/ouvert reste comme on l'a laissé quand la liste se redessine
document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("placard")) S.placardOuvert = e.target.open; }, true);
