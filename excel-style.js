// =========================================================
// STYLE EXCEL COMMUN à toutes mes applis.
// Une copie de ce fichier est à la racine du dossier « Mes applications » :
// pour une nouvelle appli, on la recopie telle quelle (comme firebase-config.js).
// =========================================================

// Bibliothèque ExcelJS, version fixe (pour que rien ne casse un jour).
const EXCELJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
// Empreinte du fichier (celle publiée par cdnjs) : si le fichier servi a été modifié, le navigateur refuse de le lancer
const EXCELJS_SRI = "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==";

// Couleurs communes (format ARGB : FF + code couleur)
const COULEURS = {
  entete: "FF1F6F5C",       // fond des en-têtes (vert sapin)
  enteteTexte: "FFFFFFFF",  // texte des en-têtes (blanc)
  ligneAlternee: "FFF2F7F5",// une ligne sur deux, très légèrement teintée
  bordure: "FFD0D5DA",      // traits fins gris
  titre: "FFDCEBE5"         // fond des lignes de titre de groupe (vert sapin très clair)
};

// Charge ExcelJS seulement quand on en a besoin (export / import),
// pour que l'appli démarre vite.
export function chargerExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = EXCELJS_URL;
    s.integrity = EXCELJS_SRI; s.crossOrigin = "anonymous";
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => ko(new Error("Impossible de charger ExcelJS (pas de réseau ?)"));
    document.head.appendChild(s);
  });
}

// Crée une feuille déjà mise en forme.
// colonnes = [{ header: "Titre", key: "cle", width: 20 }, ...]
// lignes   = [{ cle: valeur, ... }, ...]
//   + { _titre: "Fruits" } = ligne de titre de groupe (texte en colonne A, non relue à l'import car sans « Nom »)
//   + _image: "data:image/png;base64,..." = petite image posée dans la 1re colonne
// options  = { hauteur: 21 (points, même hauteur pour toutes les lignes), figer: 2 (colonnes figées à gauche) }
// Version Foodix (2026-11-21) : options, groupes et images ajoutés ; sans options = comme avant.
export function ajouterFeuille(classeur, nom, colonnes, lignes, options = {}) {
  const { hauteur = 0, figer = 0 } = options;
  const ws = classeur.addWorksheet(nom, {
    views: [{ state: "frozen", ySplit: 1, xSplit: figer }] // en-tête (et colonnes de gauche) figés
  });
  // Colonne jamais plus étroite que son en-tête (gras + flèche de filtre)
  ws.columns = colonnes.map(c => c.header ? Object.assign({}, c, { width: Math.max(c.width || 10, Math.ceil(c.header.length * 1.15) + 4) }) : c);
  const plein = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const bord = { style: "thin", color: { argb: COULEURS.bordure } };
  const bordures = { top: bord, left: bord, bottom: bord, right: bord };
  const titreBord = { style: "thin", color: { argb: COULEURS.entete } };

  const entete = ws.getRow(1);
  entete.eachCell({ includeEmpty: true }, cell => {
    cell.border = bordures;
    cell.alignment = { vertical: "middle" };
    cell.fill = plein(COULEURS.entete);
    cell.font = { bold: true, color: { argb: COULEURS.enteteTexte } };
  });
  entete.height = hauteur || 20;

  let pair = false;  // l'alternance repart à chaque groupe
  lignes.forEach(l => {
    const rang = ws.addRow(l._titre ? {} : l);
    if (hauteur) rang.height = hauteur;
    if (l._titre) {
      // Pas de fusion de cases : le texte déborde tout seul sur les cases vides, et le tri d'Excel reste possible
      rang.getCell(1).value = l._titre;
      for (let i = 1; i <= colonnes.length; i++) {
        const c = rang.getCell(i);
        c.fill = plein(COULEURS.titre);
        c.font = { bold: true, color: { argb: COULEURS.entete } };
        c.alignment = { vertical: "middle" };
        c.border = { top: titreBord, bottom: titreBord };
      }
      pair = false;
      return;
    }
    for (let i = 1; i <= colonnes.length; i++) {
      const c = rang.getCell(i);
      c.border = bordures;
      c.alignment = { vertical: "middle", horizontal: colonnes[i - 1].centre ? "center" : undefined };
      if (pair) c.fill = plein(COULEURS.ligneAlternee);
    }
    pair = !pair;
    if (l._image) {
      const id = classeur.addImage({ base64: l._image.split(",")[1], extension: "png" });
      const px = Math.round((hauteur || 20) * 4 / 3) - 6;  // 1 point = 4/3 pixel ; 3 px de marge en haut et en bas
      ws.addImage(id, { tl: { col: 0.18, row: rang.number - 1 + 0.12 }, ext: { width: px, height: px }, editAs: "oneCell" });
    }
  });
  // Petits filtres dans l'en-tête (flèches de tri dans Excel)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };
  return ws;
}

// Télécharge le classeur sous le nom <nom-appli>_AAAA-MM-JJ.xlsx
export async function telechargerClasseur(classeur, nomAppli) {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tampon = await classeur.xlsx.writeBuffer();
  const blob = new Blob([tampon], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nomAppli}_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Lit un fichier .xlsx choisi par l'utilisateur et renvoie le classeur.
export async function lireClasseur(fichier) {
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(await fichier.arrayBuffer());
  return classeur;
}

// Transforme une feuille en tableau d'objets, en se servant des en-têtes.
// Ex. : [{ "Liste": "Sport", "Objet": "Gourde", ... }, ...]
export function lireFeuille(ws) {
  if (!ws) return [];
  const entetes = [];
  ws.getRow(1).eachCell((c, i) => { entetes[i] = String(c.text).trim(); });
  const lignes = [];
  ws.eachRow((rang, n) => {
    if (n === 1) return;
    const o = {};
    entetes.forEach((h, i) => { if (h) o[h] = String(rang.getCell(i).text ?? "").trim(); });
    lignes.push(o);
  });
  return lignes;
}
