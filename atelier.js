// =========================================================
// Foodix — atelier d'icônes : fabriquer l'icône d'un plat ou d'un ingrédient.
// 4 façons : Icône + mini, Assiette, Modèle (couleurs réglables), Internet.
// Rendu Pixel (grille 32×32, contour) ou Normal (lisse, 96 px).
// Résultat : { src (PNG), pixel, p (réglages, pour rouvrir et retoucher) } -> rangé par app.js.
// =========================================================
import { ICONES, ingImg, dishImg, dishType, MC, mcIng, mcCherche, norm, parseItem, auPlacard, brut } from "./pixel.js";

const $a = s => document.querySelector("#atelier " + s);
const ic = n => `<svg class="ic" viewBox="0 0 24 24"><use href="#i-${n}"/></svg>`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const srcDe = html => (String(html).match(/src="([^"]+)"/) || [])[1];

/* ---------- Couleurs ---------- */
function hex2hsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60 + 360) % 360; }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}
const coul = c => typeof c === "string" ? hex2hsl(c) : c;
const css = (c, dl = 0) => { c = coul(c); return `hsl(${c.h} ${c.s}% ${Math.max(3, Math.min(97, c.l + dl))}%)`; };
const dk = (c, dl) => { c = coul(c); return { h: c.h, s: c.s, l: Math.max(3, Math.min(97, c.l + dl)) }; };
const ENCRE = "#2b211c";

/* ---------- Deux « pinceaux » : Pixel (grille 32×32) et Normal (lisse) ----------
   Les dessins sont écrits une fois, en coordonnées 0-32 ; chaque pinceau les rend à sa façon. */
function pinceauPixel() {
  const g = new Array(1024).fill(null);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < 32 && y < 32) g[y * 32 + x] = c; };
  const dans = (clip, x, y) => !clip || (x + .5 >= clip[0] && y + .5 >= clip[1] && x + .5 <= clip[2] && y + .5 <= clip[3]);
  return {
    g,
    rect(x, y, w, h, c) { const s = css(c); for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) set(i, j, s); },
    ell(cx, cy, rx, ry, c, o = {}) {
      const base = css(c), f = css(c, -14), cl = css(c, 12);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (!dans(o.clip, x, y)) continue;
        const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, d = dx * dx + dy * dy;
        if (d > 1 || (o.ring && d < o.ring)) continue;
        let s = base;
        if (o.ombre) { if (dy > .3 && d > .42) s = f; else if (dx < -.1 && dy < -.15 && d > .3 && d < .72) s = cl; }
        set(x, y, s);
      }
    },
    rrect(x, y, w, h, r, c, o = {}) {
      const base = css(c), f = css(c, -14), cl = css(c, 12);
      for (let j = Math.floor(y); j < Math.ceil(y + h); j++) for (let i = Math.floor(x); i < Math.ceil(x + w); i++) {
        const px = i + .5, py = j + .5;
        if (px < x || py < y || px > x + w || py > y + h) continue;
        const qx = Math.max(x + r, Math.min(px, x + w - r)), qy = Math.max(y + r, Math.min(py, y + h - r));
        if ((px - qx) ** 2 + (py - qy) ** 2 > r * r) continue;
        set(i, j, o.ombre ? (py > y + h * .7 ? f : py < y + 1.2 ? cl : base) : base);
      }
    },
    img(im, x, y, w, h = w, lisse = false) {
      if (!im) return;
      const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const cx = cv.getContext("2d"); cx.imageSmoothingEnabled = lisse; cx.imageSmoothingQuality = "high";
      cx.drawImage(im, 0, 0, W, H);
      const d = cx.getImageData(0, 0, W, H).data, X = Math.round(x), Y = Math.round(y);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; if (d[k + 3] > 110) set(X + i, Y + j, `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`); }
    },
  };
}
function pinceauNormal(cx) {
  const ombre = (c, y0, y1) => { const gr = cx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, css(c, 10)); gr.addColorStop(.45, css(c)); gr.addColorStop(1, css(c, -14)); return gr; };
  return {
    rect(x, y, w, h, c) { cx.fillStyle = css(c); cx.fillRect(x, y, w, h); },
    ell(ex, ey, rx, ry, c, o = {}) {
      cx.save();
      if (o.clip) { cx.beginPath(); cx.rect(o.clip[0], o.clip[1], o.clip[2] - o.clip[0], o.clip[3] - o.clip[1]); cx.clip(); }
      cx.beginPath(); cx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
      if (o.ring) { const k = Math.sqrt(o.ring); cx.ellipse(ex, ey, rx * k, ry * k, 0, 0, Math.PI * 2); }
      cx.fillStyle = o.ombre ? ombre(c, ey - ry, ey + ry) : css(c); cx.fill("evenodd");
      cx.restore();
    },
    rrect(x, y, w, h, r, c, o = {}) { cx.beginPath(); cx.roundRect(x, y, w, h, r); cx.fillStyle = o.ombre ? ombre(c, y, y + h) : css(c); cx.fill(); },
    img(im, x, y, w, h = w, lisse = false) { if (!im) return; cx.imageSmoothingEnabled = lisse; cx.drawImage(im, x, y, w, h); },
  };
}
// Pixel : canvas 32×32 (contour encre autour du dessin). Normal : canvas « taille » px, avec une ombre douce.
function rendre(dessin, pixel, taille = 128) {
  if (pixel) {
    const P = pinceauPixel(); dessin(P);
    const g = P.g.slice(), cv = Object.assign(document.createElement("canvas"), { width: 32, height: 32 }), o = cv.getContext("2d");
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (P.g[y * 32 + x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const X = x + a, Y = y + b; return X >= 0 && Y >= 0 && X < 32 && Y < 32 && P.g[Y * 32 + X]; })) g[y * 32 + x] = ENCRE;
    }
    g.forEach((c, i) => { if (c) { o.fillStyle = c; o.fillRect(i % 32, Math.floor(i / 32), 1, 1); } });
    return cv;
  }
  const k = taille / 32, tmp = Object.assign(document.createElement("canvas"), { width: taille, height: taille }), t = tmp.getContext("2d");
  t.scale(k, k); dessin(pinceauNormal(t));
  const cv = Object.assign(document.createElement("canvas"), { width: taille, height: taille }), o = cv.getContext("2d");
  o.shadowColor = "rgba(0,0,0,.28)"; o.shadowBlur = taille / 26; o.shadowOffsetY = taille / 64; o.drawImage(tmp, 0, 0);
  return cv;
}

/* ---------- Contenants (Assiette) ---------- */
const POS_PLAT = { 1: [[16, 16, 18]], 2: [[11, 16, 13], [21, 17, 13]], 3: [[10, 13, 12], [21, 13, 12], [16, 21, 12]], 4: [[10, 12, 11], [21, 12, 11], [10, 21, 11], [21, 21, 11]] };
const decale = (P, dx, dy, k = 1) => Object.fromEntries(Object.entries(P).map(([n, l]) => [n, l.map(([x, y, s]) => [x + dx, y + dy, Math.round(s * k)])]));
const CONT = {
  assiette: { nom: "Assiette", c: "#f1ede4", pos: POS_PLAT,
    fond: (D, c) => { D.ell(16, 17, 15, 12, c, { ombre: 1 }); D.ell(16, 17, 11.5, 8.5, dk(c, -6)); } },
  poele: { nom: "Poêle", c: "#4a4d52", pos: decale(POS_PLAT, -2, 0, .95),
    fond: (D, c) => { D.rect(25, 14.5, 7, 3, dk(c, -10)); D.ell(14, 16, 13, 12, c, { ombre: 1 }); D.ell(14, 16, 10.5, 9.5, dk(c, -10)); } },
  casserole: { nom: "Casserole", c: "#aeb7bf", pos: decale(POS_PLAT, 0, 0, .95),
    fond: (D, c) => { D.rect(0, 14, 4, 3, dk(c, -18)); D.rect(28, 14, 4, 3, dk(c, -18)); D.ell(16, 16, 13, 13, c, { ombre: 1 }); D.ell(16, 16, 11, 11, dk(c, -22)); } },
  bol: { nom: "Bol", c: "#d9cfbd", pos: { 1: [[16, 9, 14]], 2: [[11, 10, 12], [21, 9, 12]], 3: [[9, 10, 11], [16, 8, 11], [23, 10, 11]], 4: [[8, 10, 10], [13, 8, 10], [19, 8, 10], [24, 10, 10]] },
    fond: (D, c) => D.ell(16, 13, 14, 4, dk(c, -30)),
    devant: (D, c) => { D.ell(16, 13, 14, 13, c, { ombre: 1, clip: [0, 13, 32, 32] }); D.rect(11, 26, 10, 2, dk(c, -16)); } },
  planche: { nom: "Planche", c: "#c8935a", pos: decale(POS_PLAT, -1.5, .5, .95),
    fond: (D, c) => { D.rrect(25, 13, 7, 6, 3, c); D.rrect(2, 7, 26, 19, 3, c, { ombre: 1 }); D.rect(5, 12, 8, 1, dk(c, -9)); D.rect(15, 21, 9, 1, dk(c, -9)); } },
  four: { nom: "Plat au four", c: "#d0703a", pos: decale(POS_PLAT, 0, .5, .95),
    fond: (D, c) => { D.rect(0, 13, 3, 6, dk(c, -12)); D.rect(29, 13, 3, 6, dk(c, -12)); D.rrect(2, 8, 28, 18, 4, c, { ombre: 1 }); D.rrect(4, 10, 24, 14, 3, dk(c, -18)); } },
};

/* ---------- Modèles à couleurs ---------- */
const pts = (D, l, r, c, o) => l.forEach(([x, y]) => D.ell(x, y, r, r, c, o));
const TPL = {
  burger: { nom: "Burger", couches: [["haut", "Pain haut", "#d99a4e"], ["salade", "Salade", "#66b046"], ["tomate", "Tomate", "#d9432f"], ["fromage", "Fromage", "#f3c53a"], ["viande", "Viande", "#7a4a2a"], ["bas", "Pain bas", "#d99a4e"]],
    draw(D, L) {
      if (L.bas) D.rrect(5, 22, 22, 5, 2, L.bas, { ombre: 1 });
      if (L.viande) D.rrect(4, 18, 24, 5, 2, L.viande, { ombre: 1 });
      if (L.fromage) { D.rect(4, 17, 24, 2, L.fromage); D.rect(8, 19, 2, 2, L.fromage); D.rect(21, 19, 2, 3, L.fromage); }
      if (L.tomate) D.rect(5, 15, 22, 2, L.tomate);
      if (L.salade) { D.rect(3, 13, 26, 2, L.salade); for (let x = 3; x < 29; x += 3) D.rect(x, 15, 2, 1, L.salade); }
      if (L.haut) { D.ell(16, 13, 13, 10, L.haut, { ombre: 1, clip: [0, 0, 32, 13] }); [[10, 7], [15, 5], [20, 7], [13, 9], [19, 10]].forEach(([x, y]) => D.rect(x, y, 1, 1, dk(L.haut, 30))); }
    } },
  sandwich: { nom: "Sandwich", couches: [["pain", "Pain", "#d9a35a"], ["g1", "Garniture 1", "#66b046"], ["g2", "Garniture 2", "#f0a3a0"], ["g3", "Garniture 3", "#f3c53a"]],
    draw(D, L) {
      if (L.pain) D.rrect(2, 19, 28, 5, 2, L.pain, { ombre: 1 });
      if (L.g3) D.rect(3, 17, 26, 2, L.g3);
      if (L.g2) { D.rect(2, 15, 28, 2, L.g2); for (let x = 4; x < 28; x += 5) D.rect(x, 17, 2, 1, L.g2); }
      if (L.g1) { D.rect(3, 13, 26, 2, L.g1); for (let x = 3; x < 29; x += 3) D.rect(x, 15, 2, 1, L.g1); }
      if (L.pain) { D.ell(16, 13, 14, 7, L.pain, { ombre: 1, clip: [0, 0, 32, 13] }); [[8, 9], [14, 8], [20, 9]].forEach(([x, y]) => D.rect(x, y, 3, 1, dk(L.pain, -16))); }
    } },
  croque: { nom: "Croque", couches: [["pain", "Pain", "#e0b06a"], ["fromage", "Fromage", "#f3c53a"], ["jambon", "Jambon", "#f0a3a0"]],
    draw(D, L) {
      if (L.jambon) D.rrect(3, 8, 26, 21, 3, L.jambon);
      if (L.pain) { D.rrect(4, 5, 24, 22, 4, dk(L.pain, -10), { ombre: 1 }); D.rrect(6, 7, 20, 18, 3, L.pain); }
      if (L.fromage) { D.ell(16, 15, 9, 7, L.fromage, { ombre: 1 }); D.rect(9, 19, 3, 6, L.fromage); D.rect(20, 18, 3, 8, L.fromage); pts(D, [[13, 13], [18, 16], [15, 18]], 1, dk(L.fromage, -28)); }
    } },
  pizza: { nom: "Pizza", couches: [["pate", "Pâte", "#e2a85c"], ["sauce", "Sauce", "#d9432f"], ["fromage", "Fromage", "#f7e2a0"], ["g1", "Garniture 1", "#b83a2e"], ["g2", "Garniture 2", "#3b3b3b"]],
    draw(D, L) {
      if (L.pate) D.ell(16, 16, 15, 15, L.pate, { ombre: 1 });
      if (L.sauce) D.ell(16, 16, 12.5, 12.5, L.sauce);
      if (L.fromage) D.ell(16, 16, 11, 11, L.fromage);
      if (L.g1) pts(D, [[10, 10], [21, 11], [15, 17], [9, 21], [22, 21], [16, 25]], 2.3, L.g1, { ombre: 1 });
      if (L.g2) pts(D, [[15, 9], [18, 13], [11, 15], [24, 16], [13, 23], [20, 25]], 1.3, L.g2);
    } },
  tarte: { nom: "Tarte", couches: [["pate", "Pâte", "#d9a35a"], ["garniture", "Garniture", "#f1d27a"], ["dessus", "Dessus", "#66b046"]],
    draw(D, L) {
      if (L.pate) { D.ell(16, 16, 15, 15, L.pate, { ombre: 1 }); D.ell(16, 16, 15, 15, dk(L.pate, -12), { ring: .86 }); }
      if (L.garniture) D.ell(16, 16, 12, 12, L.garniture, { ombre: 1 });
      if (L.dessus) pts(D, [[11, 11], [20, 10], [16, 16], [10, 19], [22, 19], [16, 23], [24, 14]], 1.7, L.dessus);
    } },
  wrap: { nom: "Wrap", couches: [["galette", "Galette", "#ecd3a0"], ["g1", "Garniture 1", "#66b046"], ["g2", "Garniture 2", "#c9883e"], ["g3", "Garniture 3", "#d9432f"]],
    draw(D, L) {
      if (L.galette) { D.rrect(3, 10, 27, 14, 7, L.galette, { ombre: 1 }); D.rect(15, 11, 1, 12, dk(L.galette, -14)); D.rect(21, 11, 1, 12, dk(L.galette, -14)); D.ell(8, 17, 5.5, 7, dk(L.galette, -10)); }
      if (L.g1) D.ell(8, 17, 4, 5.5, L.g1);
      if (L.g2) D.ell(7, 15, 2.3, 2, L.g2);
      if (L.g3) D.ell(9, 19.5, 2.3, 1.8, L.g3);
    } },
  tacos: { nom: "Tacos", couches: [["coque", "Coque", "#e8b64e"], ["viande", "Viande", "#7a4a2a"], ["salade", "Salade", "#66b046"], ["tomate", "Tomate", "#d9432f"], ["fromage", "Fromage", "#f3d03a"]],
    draw(D, L) {
      if (L.viande) D.ell(16, 12, 12, 3.5, L.viande, { ombre: 1 });
      if (L.salade) { D.ell(16, 10, 12, 2.5, L.salade); for (let x = 5; x < 27; x += 3) D.rect(x, 8, 2, 1, L.salade); }
      if (L.tomate) pts(D, [[9, 9], [15, 8.5], [21, 9]], 1.5, L.tomate);
      if (L.fromage) [[7, 7], [12, 6], [18, 6], [24, 7]].forEach(([x, y]) => D.rect(x, y, 1, 2, L.fromage));
      if (L.coque) D.ell(16, 11, 14, 14, L.coque, { ombre: 1, clip: [0, 12, 32, 32] });
    } },
  soupe: { nom: "Bol / soupe", couches: [["bol", "Bol", "#e9e2d2"], ["bouillon", "Bouillon", "#e98a3a"], ["m1", "Morceaux 1", "#f2e6c8"], ["m2", "Morceaux 2", "#d9432f"], ["herbes", "Herbes", "#3f9a5a"]],
    draw(D, L) {
      [[12, 2], [16, 1], [20, 2]].forEach(([x, y]) => D.rect(x, y, 1, 3, "#c9c3b5"));
      if (L.bol) D.ell(16, 13, 14, 4, dk(L.bol, -8));
      if (L.bouillon) D.ell(16, 13, 12.5, 3, L.bouillon);
      if (L.m1) [[11, 13], [19, 12.5]].forEach(([x, y]) => D.ell(x, y, 1.8, 1.2, L.m1));
      if (L.m2) [[15, 13.5], [22, 13.5]].forEach(([x, y]) => D.ell(x, y, 1.5, 1, L.m2));
      if (L.herbes) [[13, 12], [17, 14], [20, 12], [9, 14]].forEach(([x, y]) => D.rect(x, y, 1, 1, L.herbes));
      if (L.bol) { D.ell(16, 13, 14, 13, L.bol, { ombre: 1, clip: [0, 13.5, 32, 32] }); D.rect(11, 26, 10, 2, dk(L.bol, -16)); }
    } },
  pates: { nom: "Pâtes", couches: [["assiette", "Assiette", "#f1ede4"], ["pates", "Pâtes", "#f0d08a"], ["sauce", "Sauce", "#c8402e"], ["garniture", "Garniture", "#3f9a5a"]],
    draw(D, L) {
      if (L.assiette) { D.ell(16, 17, 15, 12, L.assiette, { ombre: 1 }); D.ell(16, 17, 11.5, 8.5, dk(L.assiette, -6)); }
      if (L.pates) { D.ell(16, 16, 9.5, 7.5, L.pates, { ombre: 1 }); D.ell(16, 16, 9.5, 7.5, dk(L.pates, -18), { ring: .8 }); D.ell(16, 16, 6, 4.5, dk(L.pates, -18), { ring: .62 }); }
      if (L.sauce) D.ell(16, 14.5, 5, 3.5, L.sauce, { ombre: 1 });
      if (L.garniture) pts(D, [[12, 18], [20, 18], [16, 21], [22, 14], [10, 14]], 1.3, L.garniture);
    } },
  curry: { nom: "Curry", couches: [["assiette", "Assiette", "#f1ede4"], ["riz", "Riz", "#fbf8ef"], ["sauce", "Sauce", "#e0a030"], ["morceaux", "Morceaux", "#f4e2c4"]],
    draw(D, L) {
      if (L.assiette) { D.ell(16, 17, 15, 12, L.assiette, { ombre: 1 }); D.ell(16, 17, 11.5, 8.5, dk(L.assiette, -6)); }
      if (L.riz) { D.ell(11, 17, 7, 6, L.riz, { ombre: 1 }); [[9, 15], [12, 18], [8, 19], [13, 14]].forEach(([x, y]) => D.rect(x, y, 1, 1, dk(L.riz, -14))); }
      if (L.sauce) D.ell(20, 17, 8, 7, L.sauce, { ombre: 1 });
      if (L.morceaux) pts(D, [[18, 15], [22, 18], [19, 20], [23, 14]], 1.6, L.morceaux, { ombre: 1 });
    } },
};

/* ---------- Pièces (icônes posées dans le dessin) ----------
   Rangées sans leur image ({t:"mc",k} texture, {t:"fx",k} dessin Foodix, {t:"ing",n,mc} ingrédient auto, {t:"plat",mc} plat auto),
   sauf les images d'internet ({t:"img",src}) : l'image est retrouvée à l'ouverture. */
let A = null;  // état de l'atelier ouvert
const mcOk = () => Object.keys(MC.tex).length > 0;
const avecMC = (on, f) => { const a = MC.actif; MC.actif = on; try { return brut(f); } finally { MC.actif = a; } };
function srcPiece(p) {
  if (!p) return null;
  if (p.t === "mc") return MC.tex[p.k] || null;
  if (p.t === "fx") return avecMC(false, () => srcDe(ingImg(ICONES[p.k] || p.k, 12, p.k)));
  if (p.t === "img") return p.src;
  if (p.t === "ing") return avecMC(!!p.mc && mcOk(), () => srcDe(ingImg(p.n, 12)));
  if (p.t === "plat" && A.recette) return avecMC(!!p.mc && mcOk(), () => srcDe(dishImg(A.recette, 40)));
  return null;
}
const piece = p => p && Object.assign({}, p, { src: srcPiece(p) });
const nu = p => { if (!p) return null; const { src, nom, ...r } = p; return p.t === "img" ? { t: "img", src } : r; };

const IMG = new Map();
function charger(src) {
  if (!src) return Promise.resolve(null);
  if (!IMG.has(src)) IMG.set(src, new Promise(ok => { const i = new Image(); i.onload = () => { IMG.set("§" + src, i); ok(i); }; i.onerror = () => ok(null); i.src = src; }));
  return IMG.get(src);
}
const im = p => p && p.src ? IMG.get("§" + p.src) || null : null;
const precharger = () => Promise.all([A.gp.grande, ...A.gp.minis, ...A.as.ings, A.web.src && { src: A.web.src }, A.web.sansFond && { src: A.web.sansFond }].filter(Boolean).map(p => charger(p.src)));

/* ---------- Auto (d'après la recette ou l'ingrédient) ---------- */
const ingsUtiles = r => (r.ingredients || []).filter(t => { const n = parseItem(t)?.name; return n && !/^\[|^#/.test(t.trim()) && !auPlacard(n); });
const pieceIng = (txt, mc) => { const n = (parseItem(txt)?.name || txt).replace(/\s*\(.*$/, ""); return piece({ t: "ing", n, mc, nom: n }); };
function auto(mode) {
  const r = A.recette, mc = A.source === "mc" && mcOk();
  if (mode === "gp") {
    if (!r) { A.gp.grande = pieceIng(A.nom, mc); A.gp.minis = [null, null]; return; }
    A.gp.grande = piece({ t: "plat", mc, nom: r.nom });
    const prot = ingsUtiles(r).find(t => /poulet|steak|boeuf|porc|lardon|jambon|saumon|thon|crevette|tofu|oeuf|chevre|cheddar|mozza|poisson|dinde|canard|merguez|saucisse/.test(norm(t)));
    A.gp.minis = [null, prot ? pieceIng(prot, mc) : null];
  } else if (mode === "as") {
    const t = r ? dishType(r) : "";
    A.as.cont = t === "bowl" ? "bol" : t === "pan" ? "poele" : t === "gratin" ? "four" : "assiette";
    A.as.c = hex2hsl(CONT[A.as.cont].c);
    const l = r ? ingsUtiles(r) : [A.nom];
    A.as.ings = [0, 1, 2, 3].map(i => l[i] ? pieceIng(l[i], mc) : null);
  } else if (mode === "mo") {
    const n = norm(A.nom);
    A.mo.tpl = /pizza/.test(n) ? "pizza" : /curry/.test(n) ? "curry" : /pates|spaghetti|carbonara|tagliatelle|bolo/.test(n) ? "pates" : /soupe|veloute|potage|pho|ramen/.test(n) ? "soupe"
      : /sandwich/.test(n) ? "sandwich" : /wrap|fajita|burrito/.test(n) ? "wrap" : /tacos/.test(n) ? "tacos" : /croque/.test(n) ? "croque" : /tarte|quiche/.test(n) ? "tarte" : "burger";
    A.mo.c = {};
  }
}
const couchesDe = t => A.mo.c[t] ||= TPL[t].couches.map(([id, nom, hex]) => ({ id, nom, on: true, ...hex2hsl(hex) }));

/* ---------- Dessin selon le mode ---------- */
function dessin(D) {
  if (A.mode === "gp") {
    const g = im(A.gp.grande), mins = A.gp.minis.map(im);
    if (g) mins.some(Boolean) ? D.img(g, 2, 0, 28) : D.img(g, 1, 1, 30);
    [[8, 24], [24, 24]].forEach(([cx, cy], i) => {
      if (!mins[i]) return;
      if (A.gp.pastille) D.ell(cx, cy, 8, 8, "#f8f5ec");
      D.img(mins[i], cx - 6.5, cy - 6.5, 13);
    });
  } else if (A.mode === "as") {
    const C = CONT[A.as.cont], l = A.as.ings.filter(Boolean);
    C.fond(D, A.as.c);
    if (l.length) C.pos[l.length].forEach(([x, y, s], i) => D.img(im(l[i]), x - s / 2, y - s / 2, s));
    if (C.devant) C.devant(D, A.as.c);
  } else if (A.mode === "mo") {
    const L = {}; couchesDe(A.mo.tpl).forEach(k => { if (k.on) L[k.id] = k; });
    TPL[A.mo.tpl].draw(D, L);
  } else if (A.mode === "web") {
    const i = IMG.get("§" + (A.web.fond ? A.web.sansFond : A.web.src)); if (!i) return;
    const k = 32 * A.web.zoom / 100 / Math.max(i.width, i.height), w = i.width * k, h = i.height * k;
    D.img(i, 16 - w / 2, 16 - h / 2, w, h, true);
  }
}
function majApercu() {
  const cv = rendre(dessin, A.pixel), sortie = $a("#at-sortie"), o = sortie.getContext("2d");
  o.clearRect(0, 0, 128, 128); o.imageSmoothingEnabled = !A.pixel; o.drawImage(cv, 0, 0, 128, 128);
  const url = cv.toDataURL(), cls = A.pixel ? "px" : "px lisse";
  $a("#at-minis").innerHTML = ["clair", "sombre"].map(k => `<div class="at-mini ${k}"><img class="${cls}" src="${url}" alt=""><span>${esc(A.nom)}</span></div>`).join("");
}

/* ---------- Banque : Minecraft / Foodix / Mes images ---------- */
function piecesBanque() {
  const q = norm(A.q);
  if (A.source === "foodix") return Object.entries(ICONES).filter(([, n]) => !q || norm(n).includes(q)).map(([k, nom]) => piece({ t: "fx", k, nom }));
  if (A.source === "mes") return A.mes.map(src => ({ t: "img", src, nom: "Image" }));
  return mcCherche(A.q).slice(0, 300).map(k => ({ t: "mc", k, src: MC.tex[k], nom: k.replace(/[_-]/g, " ") }));
}
function grille() {
  A.liste = piecesBanque();
  return A.liste.length ? A.liste.map((p, i) => `<button type="button" class="at-tile" data-at-p="${i}" aria-label="${esc(p.nom)}"><img class="px" src="${p.src}" alt="" loading="lazy"></button>`).join("")
    : `<div class="at-vide">${A.source === "mes" ? "Les images prises sur internet arrivent ici." : "Rien trouvé."}</div>`;
}
function htmlBanque() {
  const src = (k, t) => `<button type="button" class="at-chip ${A.source === k ? "on" : ""}" data-at-src="${k}">${t}</button>`;
  return `<div class="at-banque"><div class="at-rang"><div class="at-defile" style="flex:none">${mcOk() ? src("mc", "Minecraft") : ""}${src("foodix", "Foodix")}${src("mes", "Mes images")}</div>
    <input class="saisie" id="at-q" placeholder="Chercher…" value="${esc(A.q)}" autocomplete="off" enterkeyhint="search"></div>
    <div class="at-grille" id="at-grille">${grille()}</div></div>`;
}
const slot = (p, lib, on, attr) => `<button type="button" class="at-slot ${on ? "on" : ""}" ${attr}>${p && p.src ? `<img class="px" src="${p.src}" alt="">` : ""}<span>${lib}</span>${p ? `<span class="at-x" data-at-vider>${ic("x")}</span>` : ""}</button>`;
const degradeH = c => `linear-gradient(to right,${[0, 60, 120, 180, 240, 300, 359].map(h => `hsl(${h} ${Math.max(c.s, 35)}% ${Math.min(Math.max(c.l, 35), 65)}%)`).join(",")})`;
const degradeS = c => `linear-gradient(to right,hsl(${c.h} 0% ${c.l}%),hsl(${c.h} 100% ${c.l}%))`;
const degradeL = c => `linear-gradient(to right,hsl(${c.h} ${c.s}% 10%),hsl(${c.h} ${c.s}% 50%),hsl(${c.h} ${c.s}% 90%))`;
const curseurs = (c, attr) => `<input type="range" min="0" max="359" value="${c.h}" data-at-k="h" ${attr} style="--g:${degradeH(c)}" aria-label="Teinte">
  <input type="range" min="0" max="100" value="${c.s}" data-at-k="s" ${attr} style="--g:${degradeS(c)}" aria-label="Vif">
  <input type="range" min="8" max="92" value="${c.l}" data-at-k="l" ${attr} style="--g:${degradeL(c)}" aria-label="Clair">`;
const vignettes = {};
const vignette = (k, f) => vignettes[k + A.pixel] ||= rendre(f, A.pixel, 48).toDataURL();

function panneau() {
  document.querySelectorAll("#atelier [data-at-m]").forEach(b => b.classList.toggle("on", b.dataset.atM === A.mode));
  document.querySelectorAll("#atelier [data-at-r]").forEach(b => b.classList.toggle("on", (b.dataset.atR === "pixel") === A.pixel));
  let h = "";
  if (A.mode === "gp") {
    h = `<div class="at-slots">${slot(A.gp.grande, "Grande", A.slot === "g", `data-at-slot="g"`)}${slot(A.gp.minis[0], "Mini gauche", A.slot === "0", `data-at-slot="0"`)}${slot(A.gp.minis[1], "Mini droite", A.slot === "1", `data-at-slot="1"`)}</div>
      <label class="at-bascule"><input type="checkbox" id="at-pastille" ${A.gp.pastille ? "checked" : ""}>Pastille claire derrière les minis</label>${htmlBanque()}`;
  } else if (A.mode === "as") {
    h = `<div class="at-defile">${Object.entries(CONT).map(([k, C]) => `<button type="button" class="at-chip ${A.as.cont === k ? "on" : ""}" data-at-cont="${k}"><img class="px ${A.pixel ? "" : "lisse"}" src="${vignette("c" + k, D => { CONT[k].fond(D, hex2hsl(C.c)); if (C.devant) C.devant(D, hex2hsl(C.c)); })}" alt="">${C.nom}</button>`).join("")}</div>
      <div class="at-coul"><span>Couleur</span>${curseurs(A.as.c, `data-at-cc`)}</div>
      <div class="at-slots">${A.as.ings.map((p, i) => slot(p, "Ingr. " + (i + 1), A.slotA === i, `data-at-slota="${i}"`)).join("")}</div>${htmlBanque()}`;
  } else if (A.mode === "mo") {
    h = `<div class="at-defile">${Object.entries(TPL).map(([k, T]) => `<button type="button" class="at-chip ${A.mo.tpl === k ? "on" : ""}" data-at-tpl="${k}"><img class="px ${A.pixel ? "" : "lisse"}" src="${vignette("t" + k, D => { const L = {}; T.couches.forEach(([id, , hex]) => L[id] = hex2hsl(hex)); T.draw(D, L); })}" alt="">${T.nom}</button>`).join("")}</div>
      <div class="at-couches"><div class="at-couche tete"><span></span><span></span><span>Teinte</span><span>Vif</span><span>Clair</span></div>
      ${couchesDe(A.mo.tpl).map((c, i) => `<div class="at-couche ${c.on ? "" : "off"}"><button type="button" class="at-ck ${c.on ? "on" : ""}" data-at-on="${i}" style="--pt:${css(c)}" aria-label="Afficher ${esc(c.nom)}">${ic("check")}</button><span class="at-nm">${esc(c.nom)}</span>${curseurs(c, `data-at-ci="${i}"`)}</div>`).join("")}</div>
      <button type="button" class="at-lien" data-at-act="origine">Couleurs d'origine</button>`;
  } else {
    const p = A.web.fond ? A.web.sansFond : A.web.src;
    // vrai lien plutôt que window.open : marche aussi dans l'appli installée
    h = `<a class="btn pri at-google" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(A.nom + " icône pixel art")}">${ic("search")}Chercher sur Google Images</a>
      <div class="at-rang"><button type="button" class="btn" data-at-act="coller">${ic("copy")}Coller l'image</button><label class="btn">${ic("file-plus")}Fichier<input type="file" id="at-fichier" accept="image/*" hidden></label></div>
      <div class="at-rang"><input class="saisie" id="at-url" placeholder="…ou l'adresse de l'image" autocomplete="off"><button type="button" class="btn" data-at-act="url" style="flex:none;width:48px">OK</button></div>
      <div class="at-web">${p ? `<img src="${p}" alt="">` : `<div class="at-vide">Aucune image</div>`}
        <div class="at-web-r"><label class="at-bascule"><input type="checkbox" id="at-fond" ${A.web.fond ? "checked" : ""} ${p ? "" : "disabled"}>Retirer le fond</label>
          <div class="at-coul" style="grid-template-columns:auto 1fr"><span>Zoom</span><input type="range" id="at-zoom" min="60" max="200" value="${A.web.zoom}" style="--g:var(--creux)"></div></div></div>`;
  }
  $a("#at-pan").innerHTML = h;
  majApercu();
}

/* ---------- Image venue d'internet : réduite à 128 px, fond retiré ---------- */
function reduire(i) {
  const k = Math.min(1, 128 / Math.max(i.width, i.height)), w = Math.max(1, Math.round(i.width * k)), h = Math.max(1, Math.round(i.height * k));
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h }), c = cv.getContext("2d");
  c.imageSmoothingQuality = "high"; c.drawImage(i, 0, 0, w, h); return cv;
}
// Remplissage depuis les bords : ce qui ressemble à la couleur des bords devient transparent
function sansFond(cv) {
  const c = cv.getContext("2d"), W = cv.width, H = cv.height, img = c.getImageData(0, 0, W, H), d = img.data;
  const bord = []; for (let x = 0; x < W; x++) bord.push(x, (H - 1) * W + x); for (let y = 0; y < H; y++) bord.push(y * W, y * W + W - 1);
  let r = 0, g = 0, b = 0; bord.forEach(p => { r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2]; }); r /= bord.length; g /= bord.length; b /= bord.length;
  const proche = p => d[p * 4 + 3] < 30 || Math.hypot(d[p * 4] - r, d[p * 4 + 1] - g, d[p * 4 + 2] - b) < 62;
  const vu = new Uint8Array(W * H), pile = bord.filter(proche);
  pile.forEach(p => vu[p] = 1);
  while (pile.length) {
    const p = pile.pop(); d[p * 4 + 3] = 0; const x = p % W, y = (p / W) | 0;
    for (const [a, e] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Y = y + e; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = Y * W + X; if (!vu[q] && proche(q)) { vu[q] = 1; pile.push(q); } }
  }
  const o = Object.assign(document.createElement("canvas"), { width: W, height: H }); o.getContext("2d").putImageData(img, 0, 0); return o.toDataURL();
}
async function prendreImage(i) {
  let cv, src;
  try { cv = reduire(i); src = cv.toDataURL(); } catch (e) { return A.toast("Ce site bloque la copie : fais « Copier l'image » puis Coller"); }
  A.web = { src, sansFond: sansFond(cv), fond: true, zoom: 100 };
  A.mes.unshift(A.web.sansFond);
  await precharger(); panneau(); A.toast("Image ajoutée");
}
const blobVersImage = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = r.result; }; r.onerror = () => ok(null); r.readAsDataURL(blob); });
async function coller() {
  try {
    for (const it of await navigator.clipboard.read()) { const t = it.types.find(x => x.startsWith("image/")); if (t) { const i = await blobVersImage(await it.getType(t)); if (i) return prendreImage(i); } }
    A.toast("Pas d'image copiée");
  } catch (e) { A.toast("Collage refusé : passe par Fichier"); }
}

/* ---------- Évènements (tout reste dans l'atelier : rien ne remonte à app.js) ---------- */
async function clic(e) {
  e.stopPropagation();
  const t = e.target, b = t.closest("button,[data-at-vider]"); if (!b) return;
  const d = b.dataset;
  if (t.closest("[data-at-vider]")) {
    const s = t.closest(".at-slot").dataset;
    if (s.atSlot === "g") A.gp.grande = null; else if (s.atSlot) A.gp.minis[+s.atSlot] = null; else A.as.ings[+s.atSlota] = null;
    return panneau();
  }
  if (d.atR) { A.pixel = d.atR === "pixel"; return panneau(); }
  if (d.atM) { A.mode = d.atM; return panneau(); }
  if (d.atSrc) { A.source = d.atSrc; A.q = ""; return panneau(); }
  if (d.atSlot) { A.slot = d.atSlot; return panneau(); }
  if (d.atSlota) { A.slotA = +d.atSlota; return panneau(); }
  if (d.atP != null) {
    const p = A.liste[+d.atP]; if (!p) return;
    await charger(p.src);
    if (A.mode === "gp") { if (A.slot === "g") { A.gp.grande = p; A.slot = "1"; } else A.gp.minis[+A.slot] = p; }
    else if (A.mode === "as") { A.as.ings[A.slotA] = p; A.slotA = Math.min(3, A.slotA + 1); }
    return panneau();
  }
  if (d.atCont) { A.as.cont = d.atCont; A.as.c = hex2hsl(CONT[d.atCont].c); return panneau(); }
  if (d.atTpl) { A.mo.tpl = d.atTpl; return panneau(); }
  if (d.atOn) { const c = couchesDe(A.mo.tpl)[+d.atOn]; c.on = !c.on; return panneau(); }
  switch (d.atAct) {
    case "fermer": return fermerAtelier();
    case "auto": auto(A.mode); await precharger(); return panneau();
    case "origine": delete A.mo.c[A.mo.tpl]; return panneau();
    case "coller": return coller();
    case "url": {
      const u = $a("#at-url").value.trim(); if (!u) return;
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => prendreImage(i); i.onerror = () => A.toast("Image illisible : essaie Copier l'image puis Coller"); i.src = u; return;
    }
    case "defaut": { const f = A.effacer; fermerAtelier(); return f(); }
    case "garder": {
      const cv = rendre(dessin, A.pixel, 96);
      const p = { mode: A.mode, pixel: A.pixel };
      if (A.mode === "gp") p.gp = { grande: nu(A.gp.grande), minis: A.gp.minis.map(nu), pastille: A.gp.pastille };
      else if (A.mode === "as") p.as = { cont: A.as.cont, c: A.as.c, ings: A.as.ings.map(nu) };
      else if (A.mode === "mo") p.mo = { tpl: A.mo.tpl, couches: couchesDe(A.mo.tpl).map(({ id, on, h, s, l }) => ({ id, on, h, s, l })) };
      else { if (!A.web.src) return A.toast("Aucune image"); p.web = { src: A.web.fond ? A.web.sansFond : A.web.src, zoom: A.web.zoom }; }
      const f = A.garder, res = { src: cv.toDataURL(), pixel: A.pixel, p };
      fermerAtelier(); return f(res);
    }
  }
}
function saisie(e) {
  e.stopPropagation();
  const t = e.target, d = t.dataset;
  if (t.id === "at-q") { A.q = t.value; $a("#at-grille").innerHTML = grille(); return; }
  if (t.id === "at-zoom") { A.web.zoom = +t.value; return majApercu(); }
  if (d.atK) {
    const c = d.atCi != null ? couchesDe(A.mo.tpl)[+d.atCi] : A.as.c;
    c[d.atK] = +t.value;
    // dégradés et pastille suivis en direct, sans reconstruire le panneau (le doigt garde le curseur)
    const [h, s, l] = t.parentElement.querySelectorAll("input[type=range]");
    h.style.setProperty("--g", degradeH(c)); s.style.setProperty("--g", degradeS(c)); l.style.setProperty("--g", degradeL(c));
    t.parentElement.querySelector(".at-ck")?.style.setProperty("--pt", css(c));
    return majApercu();
  }
}
async function change(e) {
  e.stopPropagation();
  const t = e.target;
  if (t.id === "at-pastille") { A.gp.pastille = t.checked; return majApercu(); }
  if (t.id === "at-fond") { A.web.fond = t.checked; return panneau(); }
  if (t.id === "at-fichier" && t.files[0]) { const i = await blobVersImage(t.files[0]); t.value = ""; if (i) prendreImage(i); else A.toast("Image illisible"); }
}
async function colle(e) {
  if (!A || A.mode !== "web") return;
  const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/"));
  if (f) { e.preventDefault(); const i = await blobVersImage(f); if (i) prendreImage(i); }
}

/* ---------- Ouvrir / fermer ----------
   o = { nom, recette (ou null pour un ingrédient), actuel ({src,pixel,p} ou null), mes [images d'internet déjà prises],
         toast(msg), garder(resultat), effacer() } */
export async function ouvrirAtelier(o) {
  fermerAtelier();
  A = { nom: o.nom, recette: o.recette || null, toast: o.toast, garder: o.garder, effacer: o.effacer,
    mes: [...(o.mes || [])], mode: "gp", pixel: true, source: MC.actif && mcOk() ? "mc" : "foodix", q: "",
    gp: { grande: null, minis: [null, null], pastille: true }, slot: "g",
    as: { cont: "assiette", c: hex2hsl(CONT.assiette.c), ings: [null, null, null, null] }, slotA: 0,
    mo: { tpl: "burger", c: {} }, web: { src: null, sansFond: null, fond: false, zoom: 100 }, liste: [] };
  ["gp", "as", "mo"].forEach(auto);
  // Icône déjà faite : on la rouvre telle quelle
  const p = o.actuel && o.actuel.p;
  if (p) {
    A.mode = p.mode || "gp"; A.pixel = p.pixel !== false;
    if (p.gp) A.gp = { grande: piece(p.gp.grande), minis: (p.gp.minis || []).map(piece), pastille: p.gp.pastille !== false };
    if (p.as && CONT[p.as.cont]) A.as = { cont: p.as.cont, c: p.as.c || hex2hsl(CONT[p.as.cont].c), ings: (p.as.ings || []).map(piece) };
    if (p.mo && TPL[p.mo.tpl]) {
      A.mo.tpl = p.mo.tpl;
      A.mo.c[p.mo.tpl] = TPL[p.mo.tpl].couches.map(([id, nom, hex]) => Object.assign({ id, nom, on: true, ...hex2hsl(hex) }, (p.mo.couches || []).find(c => c.id === id)));
    }
    if (p.web) A.web = { src: p.web.src, sansFond: p.web.src, fond: false, zoom: p.web.zoom || 100 };
  }
  const el = document.createElement("div");
  el.id = "atelier"; el.className = "atelier"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Icône");
  el.innerHTML = `<div class="at-in">
    <div class="at-hd"><button type="button" class="ib" data-at-act="fermer" aria-label="Retour">${ic("left")}</button><h2>Icône</h2><span class="at-titre">${esc(A.nom)}</span>
      ${o.actuel ? `<button type="button" class="at-lien" data-at-act="defaut">Par défaut</button>` : ""}</div>
    <div class="at-ap"><div class="at-grand"><canvas id="at-sortie" width="128" height="128"></canvas></div>
      <div class="at-ap-d"><div class="seg at-seg"><button type="button" data-at-r="pixel">Pixel</button><button type="button" data-at-r="normal">Normal</button></div>
        <div class="at-minis" id="at-minis"></div>
        <div class="at-rang" style="margin-top:auto"><button type="button" class="btn" data-at-act="auto">${ic("refresh")}Auto</button><button type="button" class="btn pri" data-at-act="garder">${ic("check")}Garder</button></div></div></div>
    <div class="at-modes"><button type="button" data-at-m="gp">Icône + mini</button><button type="button" data-at-m="as">Assiette</button><button type="button" data-at-m="mo">Modèle</button><button type="button" data-at-m="web">Internet</button></div>
    <div class="at-pan" id="at-pan"></div></div>`;
  el.addEventListener("click", clic); el.addEventListener("input", saisie); el.addEventListener("change", change);
  document.addEventListener("paste", colle);
  document.body.appendChild(el);
  await precharger();
  if (A) panneau();
}
export function fermerAtelier() {
  const el = document.getElementById("atelier"); if (el) el.remove();
  document.removeEventListener("paste", colle);
  A = null;
}
export const atelierOuvert = () => !!document.getElementById("atelier");
