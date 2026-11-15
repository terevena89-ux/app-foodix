// =========================================================
// Foodix — outils de cuisine repris du prototype « Carnet de recettes » :
//  - lecture d'un ingrédient (« 250 g de pâtes » -> quantité, unité, nom)
//  - rayons du magasin et affichage des quantités
//  - dessins pixel art, fabriqués par le code (remplacés par les textures de icones/mc/ quand elles existent) :
//    chaque dessin est une grille de lettres, chaque lettre = une couleur de la palette PAL.
// =========================================================

// Texte « normalisé » : minuscules, sans accents, œ -> oe (pour comparer des noms)
const norm = s => String(s ?? "").replace(/œ/g,"oe").replace(/Œ/g,"oe").replace(/æ/g,"ae").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();

/* ---------- Ingrédients ---------- */
// Unités reconnues (et leur écriture propre)
const UNITS = {"g":"g","gr":"g","kg":"kg","ml":"ml","cl":"cl","dl":"dl","l":"L","c.a.s":"c. à s.","cas":"c. à s.","c.a.c":"c. à c.","cac":"c. à c.","boite":"boîte","boites":"boîte","tranche":"tranche","tranches":"tranche","gousse":"gousse","gousses":"gousse","sachet":"sachet","sachets":"sachet","pot":"pot","pots":"pot","paquet":"paquet","paquets":"paquet","botte":"botte","bottes":"botte","plaque":"plaque","plaques":"plaque"};
function parseItem(txt){
  let s=txt.trim(); if(!s) return null;
  const m=s.match(/^(\d+(?:[.,]\d+)?|½|¼|¾)\s*(.*)$/);
  let qty=null, unit="", name=s;
  if(m){
    qty={"½":.5,"¼":.25,"¾":.75}[m[1]] ?? parseFloat(m[1].replace(",","."));
    name=m[2];
    const um=name.match(/^([^\s]+)\s+(?:de\s+|d')?(.+)$/i);
    if(um && UNITS[norm(um[1])]){ unit=UNITS[norm(um[1])]; name=um[2]; }
  }
  if(unit==="kg"){ qty*=1000; unit="g"; }
  if(unit==="L"){ qty*=100; unit="cl"; } if(unit==="ml"){ qty/=10; unit="cl"; } if(unit==="dl"){ qty*=10; unit="cl"; }
  name=name.trim();
  return {qty, unit, name, key:keyOf(name)};
}
function keyOf(name){ return norm(name).replace(/^(de |d')/,"").split(" ").map(w=>w.length>3?w.replace(/[sx]$/,""):w).join(" "); }

/* ---------- Rayons et quantités ---------- */
// Rayons : mots-clés testés dans cet ordre (le premier qui correspond gagne)
const AISLES = [
  ["epices","Épices et condiments",/(^| )(sel|poivre|moutarde|sauce soja|herbe|epice|cumin|paprika|muscade|thym|bouquet garni|cube|bouillon|levure|cinq epice|safran|anis|cannelle|piment|mayonnaise|zaatar|menthe sechee|tahini|nuoc|pate de curry)/],
  ["conserves","Conserves",/(boite|conserve|concass|lait de coco|(^| )thon|sardine|(^| )mais|coulis|pelee|cornichon|olive)/],
  ["epicerie","Épicerie",/(sechee|seches|beurre de cacah|morilles|champignons noirs|vin |cidre|croutons|sauce )/],
  ["boucherie","Boucherie, charcuterie, poisson",/(^| )(boeuf|veau|porc|poulet|lardon|jambon|chorizo|saucisse|merguez|chipolata|boudin|magret|steak|cordon|chair a saucisse|petit sale|crevette|saumon|morue|poisson|surimi|rillette|canard|dinde)/],
  ["cremerie","Crèmerie, œufs, frais",/(^| )(oeuf|lait|beurre|creme|fromage|gruyere|parmesan|mozzarella|feta|chevre|roquefort|bleu|reblochon|cheddar|yaourt|pate brisee|ravioles|gnocchi|tofu)/],
  ["boulangerie","Boulangerie",/(^| )(pain|baguette|tortilla)/],
  ["legumes","Légumes et herbes",/(^| )(tomate|courgette|aubergine|poivron|oignon|echalote|ail|carotte|poireau|champignon|salade|roquette|concombre|menthe|persil|basilic|coriandre|ciboulette|aneth|estragon|sauge|gingembre|chou|betterave|epinard|potimarron|navet|legume|pousse|chataigne|pomme de terre|patate|courge|haricots? verts?|petit(s)? pois|fenouil|celeri|radis|asperge|brocoli|endive)/],
  ["fruits","Fruits",/(^| )(pomme|citron|avocat|melon|grenade|peche|poire|banane|fraise|orange|raisin|cerise|kiwi|mangue|ananas|framboise|abricot|clementine|prune|myrtille|datte|figue)/],
];
// Produits ménagers : catégories
const RAYONS_MENAGE = [["m-vaisselle","Vaisselle"],["m-linge","Linge"],["m-nettoyage","Nettoyage"],["m-papier","Papier et sacs"],["m-hygiene","Hygiène"]];
const AISLES_FOOD = ["fruits","legumes","boucherie","cremerie","boulangerie","conserves","epicerie","epices"];
// « Souvent déjà au placard » : une option d'un ingrédient (pas un rayon). Départ deviné d'après le nom.
const RE_PLACARD = /(^| )(sel|poivre|huile|vinaigre|farine|sucre|moutarde|sauce soja|herbe|epice|cumin|paprika|muscade|thym|bouquet garni|cube|bouillon|levure|chapelure|miel|cinq epice|safran|anis|cannelle|piment|mayonnaise|zaatar|menthe sechee|tahini|nuoc|cognac|pate de curry)/;
function auPlacard(name){ return RE_PLACARD.test(norm(name)); }
const AISLE_ORDER = [...AISLES_FOOD,"perso",...RAYONS_MENAGE.map(r=>r[0])];
function aisleOf(name){ const n=norm(name); for(const [id,,re] of AISLES) if(re.test(n)) return id; return "epicerie"; }
function rayonMenage(name){
  const n=norm(name);
  if(/vaisselle|eponge|lave-vaisselle/.test(n)) return "m-vaisselle";
  if(/lessive|adoucissant|linge|detachant/.test(n)) return "m-linge";
  if(/papier|sac|essuie|alu|film|mouchoir/.test(n)) return "m-papier";
  if(/savon|shampoing|dentifrice|gel douche|deodorant|coton/.test(n)) return "m-hygiene";
  return "m-nettoyage";
}
function aisleLabel(id){
  if(id==="perso") return "Ajouts";
  const m=RAYONS_MENAGE.find(r=>r[0]===id); if(m) return "Ménage · "+m[1];
  return (AISLES.find(a=>a[0]===id)||[,"Épicerie"])[1];
}
function fmtQty(q, unit){
  if(q==null) return "";
  if(unit==="g"){ if(q>=1000) return (Math.round(q/100)/10).toLocaleString("fr-FR")+" kg"; return (q<50?Math.round(q/5)*5:Math.round(q/10)*10)+" g"; }
  if(unit==="cl"){ if(q>=100) return (Math.round(q/10)/10).toLocaleString("fr-FR")+" L"; return Math.round(q)+" cl"; }
  let v;
  if(!unit && q<1){ v = q<=.25?"¼":q<=.5?"½":q<=.75?"¾":"1"; }
  else v = !unit ? String(Math.ceil(q-0.05)) : (Math.round(q*2)/2).toLocaleString("fr-FR");
  if(!unit) return v;
  const plural = q>1 && !unit.includes(".") ? (unit.endsWith("s")?"":"s") : "";
  return `${v} ${unit}${plural}`;
}

/* ---------- pixel art ---------- */
const PAL={k:"#2b211c",r:"#d9432f",R:"#9c2a1f",o:"#f08c2a",O:"#b65a16",y:"#f3cf45",Y:"#c69a22",g:"#66b046",G:"#2f6e2c",v:"#c8dc72",
  b:"#9a6436",B:"#5c3a22",t:"#e6bb7a",c:"#fbe8bd",C:"#dcbf86",w:"#f8f5ec",W:"#c9c3b5",p:"#f3a49a",P:"#c45a50",u:"#7d3f8f",U:"#4e2560",
  s:"#9fb0bf",S:"#5f6e7c",l:"#8fc1e6",L:"#4f86b5"};
const SPR={
tomate:["","     GG","    GGGG","  rrrGGrrr"," rrrrrrrrRr"," rwrrrrrrRr"," rrrrrrrrRr"," rrrrrrrrRr"," rrrrrrrRRr","  rrrrrRRr","   RRRRRR"],
poivron:["      G","     GG","   rrrrrr","  rrrrrrrR","  rwrrrrrR","  rrrrrrrR","  rrrrrrrR","  rrrRrrrR","   rrRrrR","    R  R"],
oignon:["      b","     bb","    tttt","   tbttbt","  ttbttbtt","  ttbttbtt","  ttbttbtt","   tbttbt","    tttt","     bb"],
carotte:["        g g","       gGg","      OoG","     ooO","    oOoo","   ooOo","   oOo","  ooo","  oO"," oo"," o"],
courgette:["","          G","         gG","        ggG","       ggG","      ggG","     ggG","    ggG","   ggG","  gGG","  G"],
champignon:["","   BBBBBB","  BbbbbbbB"," BbbcbbbcbB"," BBBBBBBBBB","    cccc","    cccC","    cccC","   ccccCC"],
patate:["","","   tttttt","  tttbtttt"," ttttttttbt"," tbtttttttt"," tttttbtttb","  tttttttb","   bbbbbb"],
pomme:["     B","     Bg","  rrrBrrr"," rrrrrrrrR"," rwrrrrrrR"," rrrrrrrrR"," rrrrrrrrR","  rrrrrrR","   rRRRR"],
citron:["","","    yyyy","  yyyyyyy"," yyywyyyyy","yyyyyyyyyyY"," yyyyyyyyY","  yyyyyYY","    YYY"],
avocat:["    GGG","   GvvvG","  GvvvvvG","  GvvvvvvG"," GvvvBBvvG"," GvvBBBBvG"," GvvBBBBvG"," GvvvBBvvG","  GvvvvvG","   GGGGG"],
salade:["","   gggg","  gGggGgg"," ggGgggGgg"," gggGgGggg"," ggggGgggg","  gggGggg","   GGGGG"],
herbe:["","      g","     ggg","   g  G  g","  ggg G ggg","   G  G  G","    GGGGG","      G","      G","      G"],
ail:["","     w","     w","    wWw","   wwWww","  wwWwwWw","  wWwwwWw","  wwWwwWw","   wwwww","    WWW"],
oeuf:["","     cc","    cccc","   cwcccc","   cwccccC","  ccccccCC","  cccccccC","  cccccccC","   cccccC","    CCCC"],
fromage:["","","        yy","      yyyY","    yyyyyY","  yyyyyyyY","  YYYYYYYY","  yyycyyyy","  yycyyycy","  yyyyyyyY","  YYYYYYYY"],
lait:["","    SSSS","    wwww","   wwwwww","   wllllw","   wllllw","   wwwwww","   wwwwwW","   wwwwwW","   WWWWWW"],
beurre:["","","","   cccccc","  ccccccCc"," yyyyyyyyY"," yyyyyyyyY"," yyyyyyyyY"," YYYYYYYYY"],
crevette:["","   pppp","  ppPPpp"," pp    pp"," p      pp"," pp     pP","  pp   ppP","   ppppPP","     pP","    p p"],
poisson:["","","   ssss","  ssssss  s"," sksssssssS"," sssssssssS","  SSSSSS  S","   SSSS"],
poulet:["","        ww","       www","      Ww","     bb","   btttb","  btttttb","  bttttttb","  btttttb","   bbbbb"],
saucisse:["","","          P","         PP","  PPPPPPPP"," PPpPPPPPPR"," PPPPPPPPRR","  RRRRRRRR"],
viande:["","","   PPPPP","  PPPPPPPP"," PPpPPPPPPP"," PPPPwPPPPR"," PPPPPwPPPR","  PPPPPPRR","   RRRRRR"],
boite:["","   SSSSSS","  SssssssS","  SSSSSSSS","  rrrrrrrr","  rwwwwwwr","  rwwwwwwr","  rrrrrrrr","  SSSSSSSS","   SSSSSS"],
pates:["","","  t t t t"," tttttttttt","t tYtt tYt t"," tttttttttt","t ttYt tt t"," tttttttttt","  t t t t"],
riz:["","","   wwwww","  wwWwwwww"," wwwwwwWwww"," llllllllll","  llllllll","   llllll"],
pain:["","          tb","         ttb","        tbt","       tbt","      ttt","     tbt","    tbt","   ttt","  tbt"," tbt","bb"],
noix:["","","   BB  BB","  BbbBBbbB","  BbbBBbbB","   BB  BB","","  BB   BB"," BbbB BbbB"," BbbB BbbB","  BB   BB"],
bouteille:["     SS","     kk","     yy","    yyyy","   yyyyyy","   ywyyyy","   yyyyyY","   yyyyyY","   yyyyyY","   YYYYYY"],
pot:["","    BBBB","   BBBBBB","   wwwwww","  wyyyyyyw","  wyyyyyyw","  wywwwwyw","  wyyyyyyw","   wwwwww"],
sachet:["","    WWWW","   wwwwww","  wwwwwwww","  wwbbbbww","  wwbwwbww","  wwbbbbww","  wwwwwwwW","  wwwwwwwW","   WWWWWW"],
};
const DISH={
plate:["","","","","","","      1221","    12113121","   1312112131","  121131211312"," ww2113121211ww","wwww12111121wwww","wwwwwwwwwwwwwwwW"," WwwwwwwwwwwwwW","  WWWWWWWWWWWW"],
bowl:["","      W  W","     W  W  W","      W  W","","","  112131121311"," l121311213121l"," llllllllllllll"," llllllllllllLL","  llllllllllLL","   lllllllLLL","     LLLLLL"],
salad:["","","","","","   g 2 g1 g","  12g131g21g1"," l1g21g3121g1l"," llllllllllllll"," llllllllllllLL","  llllllllllLL","   lllllllLLL","     LLLLLL"],
pan:["","","","","    SSSSSS","  SS111111SS"," S1121121211S"," S1211211121S"," S1121121211SSSS"," S1211211121SSSS"," S1121211211S","  SS111111SS","    SSSSSS"],
gratin:["","","","","","  OOOOOOOOOOOO"," O1y12y1y21y12O"," O21b1y21b1y21O"," O1y21b1y2b1y2O"," O21y1b21y12b1O"," OOOOOOOOOOOOOO","  O          O"],
tart:["","","","","","","   tbtbtbtbtb","  t1121121121t"," b121121211212b"," t112121121121t"," bttttttttttttb","  bbbbbbbbbbbb"],
burger:["","","","     tttttt","   ttwttttwtt","  tttttttwtttt","  gggggggggggg","  yyyyyyyyyyyy"," rrrrrrrrrrrrrr","  BBBBBBBBBBBB","  BBBBBBBBBBBB","  tttttttttttt","   bbbbbbbbbb"],
sandwich:["","","","","","","  tttttttttttt"," tbttbttbttbttt"," 11211311211211"," 22122232122312"," tttttttttttttt","  bbbbbbbbbbbb"],
wrap:["","","","","","      cccccc","    cc1213ccc","   c1121312ccC","  c11231213cccC","  cccccccccccCC","   cccccccccCC","    CCCCCCCC"],
sauce:["","","","","","","    wwwwwwww","   w11111111w","   w12111211w","   wwwwwwwwww","   wwwwwwwwwW","    WWWWWWWW"],
roast:["","","","","     bbbbb","   bbtttttbb","  btttttttttb"," btttwtttttttb"," bttttttttttbww","wwbbbbbbbbbbbwww","wwwwwwwwwwwwwwwW"," WWWWWWWWWWWWWW"],
fish:["","","","","","","    1111111   1","  111111111111 1"," 1k1111111111111","  22222222222 22","wwww2222222wwwww","wwwwwwwwwwwwwwwW"," WWWWWWWWWWWWWW"],
};
const ING_SPR=[
 [/vaisselle|lessive|adoucissant|savon|javel|nettoyant|detartrant|desinfectant|produit wc|multi-usage/,"bouteille",{y:"l",Y:"L"},"produit"],
 [/pomme de terre|patate/,"patate"],[/chataigne/,"patate",{t:"b",b:"B"},"chataigne"],[/petit(s)? poi/,"noix",{B:"G",b:"g"},"petitpois"],[/pois chiche/,"noix",{B:"b",b:"t"},"poischiche"],
 [/lentille/,"noix",{B:"G",b:"v"},"lentille"],[/olive/,"noix",{B:"k",b:"G"},"olive"],[/tomate/,"tomate"],[/poivron|piment/,"poivron"],[/betterave/,"tomate",{r:"u",R:"U"},"betterave"],
 [/potimarron|courge/,"tomate",{r:"o",R:"O"},"courge"],[/oignon|echalote/,"oignon"],[/(^| )ail( |$)/,"ail"],[/carotte/,"carotte"],[/aubergine/,"courgette",{g:"u",G:"U"},"aubergine"],
 [/courgette|concombre|cornichon/,"courgette"],[/poireau/,"courgette",{g:"v"},"poireau"],[/champignon|morille/,"champignon"],[/melon/,"pomme",{r:"v",R:"G"},"melon"],
 [/peche/,"pomme",{r:"o",R:"O"},"peche"],[/pomme|grenade/,"pomme"],[/citron vert/,"citron",{y:"g",Y:"G"},"citronvert"],[/citron/,"citron"],[/avocat/,"avocat"],
 [/chou-fleur|chou fleur/,"salade",{g:"w",G:"W"},"choufleur"],[/salade|roquette|epinard|chou|romaine/,"salade"],[/navet/,"oignon",{t:"w",b:"u"},"navet"],
 [/persil|basilic|coriandre|menthe|ciboulette|aneth|estragon|sauge|thym|herbe|bouquet/,"herbe"],[/pousse|vermicelle/,"pates",{t:"w",Y:"W"},"vermicelle"],
 [/(^| )oeuf/,"oeuf"],[/mozzarella|feta|tofu|chevre/,"fromage",{y:"w",Y:"W",c:"W"},"mozzarella"],[/fromage blanc|yaourt|creme/,"pot",{y:"w",B:"l"},"creme"],
 [/lait de coco/,"boite",{r:"w"},"laitcoco"],[/lait/,"lait"],[/beurre de cacah/,"pot",{y:"b"},"beurrecacahuete"],[/beurre/,"beurre"],
 [/gruyere|parmesan|cheddar|fromage|roquefort|bleu|reblochon/,"fromage"],[/crevette/,"crevette"],[/saumon/,"poisson",{s:"p",S:"P"},"saumon"],
 [/thon/,"boite",{r:"l"},"thon"],[/poisson|morue|cabillaud/,"poisson"],[/surimi/,"saucisse",{P:"w",p:"r",R:"r"},"surimi"],[/poulet|dinde|cordon|nugget/,"poulet"],
 [/lardon|jambon|chorizo|saucisse|merguez|chipolata|boudin|rillette|chair/,"saucisse"],[/boeuf|veau|porc|steak|magret|canard|petit sale|viande/,"viande"],
 [/boite|concass|haricot|ravioli/,"boite"],[/pate brisee|galette|tortilla|pain|baguette|crouton/,"pain"],
 [/pates|spaghetti|tagliatelle|nouille|orzo|crozet|gnocchi|ravioles/,"pates"],[/riz|semoule|arborio/,"riz"],
 [/noix|cacahu|sesame/,"noix"],[/sauce soja|nuoc/,"bouteille",{y:"B",Y:"k"},"saucesoja"],[/(^| )vin|cidre|cognac/,"bouteille",{y:"u",Y:"U"},"vin"],
 [/huile|vinaigre/,"bouteille"],[/sauce|mayonnaise|moutarde|miel|tahini|pate de curry/,"pot"],
 [/(^| )sel|poivre|epice|cumin|paprika|muscade|safran|anis|cannelle|cinq|zaatar|curry/,"pot",{y:"o",Y:"O"},"epice"],
];
// Icônes qu'on peut choisir à la main pour un ingrédient
const ICONES={tomate:"Tomate",poivron:"Poivron",oignon:"Oignon",ail:"Ail",carotte:"Carotte",courgette:"Courgette",champignon:"Champignon",patate:"Pomme de terre",
  salade:"Salade",herbe:"Herbes",pomme:"Pomme",citron:"Citron",avocat:"Avocat",oeuf:"Œuf",fromage:"Fromage",lait:"Lait",beurre:"Beurre",pot:"Pot",
  poulet:"Poulet",viande:"Viande",saucisse:"Saucisse",poisson:"Poisson",crevette:"Crevette",boite:"Conserve",pates:"Pâtes",riz:"Riz",pain:"Pain",
  noix:"Noix, graines",bouteille:"Bouteille",sachet:"Sachet"};
const spriteCache=new Map();
/* ---------- textures Minecraft (facultatif) ----------
   Si un fichier icones/mc/<nom>.png existe, il remplace le dessin fait par le code.
   S'il manque, l'image ne se charge pas : on remet le dessin, et on ne redemande plus ce fichier.
   Liste des noms attendus : icones/mc/LISEZ-MOI.md (aperçu : icones/mc/index.html). */
const MC_DIR="icones/mc/";
const mcAbsents=new Set();
const attr = s => String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;");
function pxImg(fichier, cle, px, cls){
  if(mcAbsents.has(fichier)) return `<img class="${cls}" src="${spriteCache.get(cle)}" width="${px}" height="${px}" alt="">`;
  return `<img class="${cls} mc" src="${MC_DIR}${fichier}.png" data-mc="${fichier}" data-secours="${attr(cle)}" width="${px}" height="${px}" alt="">`;
}
document.addEventListener("error", e => {
  const im=e.target; if(!im || im.tagName!=="IMG" || !im.dataset.mc) return;
  mcAbsents.add(im.dataset.mc); delete im.dataset.mc; im.classList.remove("mc");
  const secours=spriteCache.get(im.dataset.secours); if(secours) im.src=secours;
}, true);
// Tous les noms de fichier reconnus (pour la page d'aperçu)
const MC_NOMS = () => ({
  ingredients: [...new Set([...Object.keys(SPR), ...ING_SPR.map(r => r[3] || r[1])])],
  plats: Object.keys(DISH).map(t => "plat-" + t),
});

function drawGrid(rows, size, map={}, fill=[]){
  const cv=document.createElement("canvas"); cv.width=cv.height=size; const cx=cv.getContext("2d");
  rows.forEach((row,y)=>{ [...row].forEach((ch,x)=>{
    if(ch===" "||x>=size) return;
    let c = /[123]/.test(ch) ? fill[+ch-1] : (map[ch]||ch);
    if(PAL[c]){ cx.fillStyle=PAL[c]; cx.fillRect(x,y,1,1); }
  }); });
  return cv.toDataURL();
}
function ingSprite(name){
  const n=norm(name);
  const m=ING_SPR.find(([re])=>re.test(n)) || [null,"sachet"];
  return {name:m[1], map:m[2]||{}, mc:m[3]||m[1]};
}
function mainColor(spr){
  const cnt={}; SPR[spr.name].join("").split("").forEach(ch=>{ if(ch!==" "&&ch!=="k") cnt[ch]=(cnt[ch]||0)+1; });
  const ch=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0]; return spr.map[ch]||ch;
}
function ingImg(name, px=22, icone){
  const s=(icone && SPR[icone]) ? {name:icone,map:{},mc:icone} : ingSprite(name); const key="i|"+s.name+JSON.stringify(s.map);
  if(!spriteCache.has(key)) spriteCache.set(key, drawGrid(SPR[s.name],12,s.map));
  return pxImg(s.mc, key, px, "px");
}
function dishType(r){
  const n=r.id, c=norm(r.categorie);
  if(/burger/.test(n)) return "burger";
  if(/sandwich|croque/.test(n)) return "sandwich";
  if(/wrap|rouleau|nems/.test(n)) return "wrap";
  if(/gratin|grattin|croziflette|hachi|parmentier|dauphinois|ravioles|brandade|raviolis/.test(n)) return "gratin";
  if(/quiche|cake|tarte/.test(n)) return "tart";
  if(/sauce|mayo|beurre blanc|marinade|bearnaise|houmous|tzatziki|fromage blanc|rillette/.test(n)||/sauce/.test(c)) return "sauce";
  if(/salade|taboule|coleslaw|bowls/.test(n)) return "salad";
  if(/soupe|pho|curry|chili|blanquette|bourguignon|pot-au-feu|couscous|petit sale|lentille|ratatouille/.test(n)) return "bowl";
  if(/omelette|oeuf|chakchouka|poelee|rissol|champignon|epinard|fondue/.test(n)) return "pan";
  if(/poulet roti|magret|filet mignon/.test(n)) return "roast";
  if(/poisson|saumon|morue/.test(n)) return "fish";
  return "plate";
}

// Dessin d'une recette : un gabarit (bol, poêle…) rempli avec la couleur
// des 3 premiers ingrédients qui ne viennent pas du placard.
function dishImg(r, px = 40) {
  const key = "d|" + r.id + "|" + (r.ingredients || []).join(";");
  if (!spriteCache.has(key)) {
    const type = dishType(r);
    const cols = [];
    for (const txt of r.ingredients || []) {
      const it = parseItem(txt); if (!it || auPlacard(it.name)) continue;
      const col = mainColor(ingSprite(it.name));
      if (!cols.includes(col)) cols.push(col);
      if (cols.length === 3) break;
    }
    if (type === "salad" && !cols.includes("g")) cols.unshift("g");
    for (const f of ["t", "g", "y", "r"]) if (cols.length < 3 && !cols.includes(f)) cols.push(f);
    const fill = type === "fish" ? (/saumon/.test(r.id) ? ["p", "P"] : ["s", "S"]) : cols;
    spriteCache.set(key, drawGrid(DISH[type], 16, {}, fill));
  }
  return pxImg("plat-" + dishType(r), key, px, "px dish");
}

export { norm, parseItem, keyOf, aisleOf, auPlacard, rayonMenage, aisleLabel, AISLE_ORDER, AISLES_FOOD, RAYONS_MENAGE, ICONES, fmtQty, ingImg, dishImg, dishType, MC_NOMS, MC_DIR };
