// =========================================================
// Foodix — outils de cuisine repris du prototype « Carnet de recettes » :
//  - lecture d'un ingrédient (« 250 g de pâtes » -> quantité, unité, nom)
//  - rayons du magasin et affichage des quantités
//  - dessins pixel art, fabriqués par le code (aucun fichier image) :
//    chaque dessin est une grille de lettres, chaque lettre = une couleur de la palette PAL.
// =========================================================

// Texte « normalisé » : minuscules, sans accents, œ -> oe (pour comparer des noms)
const norm = s => String(s ?? "").replace(/œ/g,"oe").replace(/Œ/g,"oe").replace(/æ/g,"ae").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();

/* ---------- Ingrédients ---------- */
// Unités reconnues (et leur écriture propre)
const UNITS = {"g":"g","gr":"g","kg":"kg","ml":"ml","cl":"cl","dl":"dl","l":"L","c.a.s":"c. à s.","cas":"c. à s.","cs":"c. à s.","c.a.c":"c. à c.","cac":"c. à c.","cc":"c. à c.","boite":"boîte","boites":"boîte","tranche":"tranche","tranches":"tranche","gousse":"gousse","gousses":"gousse","sachet":"sachet","sachets":"sachet","pot":"pot","pots":"pot","paquet":"paquet","paquets":"paquet","botte":"botte","bottes":"botte","plaque":"plaque","plaques":"plaque","pincee":"pincée","pincees":"pincée","verre":"verre","verres":"verre","brin":"brin","brins":"brin"};
// Cuillères écrites avec des espaces (« c. à s. », « cuillère à soupe »…) : reconnues à part
const CUILLERES = [
  [/^(?:c\.?\s*(?:a|à)\s*s\.?|cuill?(?:e|è)?r?e?s?\.?\s+(?:a|à)\s+soupe)\s+(?:de\s+|d')?/i, "c. à s."],
  [/^(?:c\.?\s*(?:a|à)\s*c\.?|cuill?(?:e|è)?r?e?s?\.?\s+(?:a|à)\s+caf(?:e|é))\s+(?:de\s+|d')?/i, "c. à c."],
];
// Un nombre : « 2 », « 1,5 », « 1/2 », « ½ », « 1 ½ »
const NOMBRE = String.raw`(?:\d+\s*[½¼¾]|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[½¼¾])`;
function lireNombre(t){
  t=t.replace(/\s+/g,"");
  const f={"½":.5,"¼":.25,"¾":.75};
  let m=t.match(/^(\d+)([½¼¾])$/); if(m) return +m[1]+f[m[2]];
  m=t.match(/^(\d+)\/(\d+)$/); if(m) return +m[2] ? m[1]/m[2] : +m[1];
  return f[t] ?? parseFloat(t.replace(",","."));
}
function parseItem(txt){
  let s=txt.trim(); if(!s) return null;
  // Une fourchette (« 2-3 », « 2 à 3 ») : on garde le plus grand, pour ne jamais en manquer
  const m=s.match(new RegExp(`^(${NOMBRE})(?:\\s*(?:-|–|à|a)\\s*(${NOMBRE}))?(?=\\s|[a-zA-Zàâéèêîôûç]|$)\\s*(.*)$`));
  let qty=null, unit="", name=s;
  if(m){
    qty=lireNombre(m[1]);
    if(m[2]!=null) qty=Math.max(qty, lireNombre(m[2]));
    name=m[3];
    const cu=CUILLERES.find(([re])=>re.test(name));
    if(cu){ unit=cu[1]; name=name.replace(cu[0],""); }
    else {
      const um=name.match(/^([^\s]+)\s+(?:de\s+|d')?(.+)$/i);
      if(um && UNITS[norm(um[1])]){ unit=UNITS[norm(um[1])]; name=um[2]; }
    }
  }
  if(unit==="kg"){ qty*=1000; unit="g"; }
  if(unit==="L"){ qty*=100; unit="cl"; } if(unit==="ml"){ qty/=10; unit="cl"; } if(unit==="dl"){ qty*=10; unit="cl"; }
  name=name.trim();
  return {qty, unit, name, key:keyOf(name)};
}
// Clé de regroupement : le nom au singulier (« tomates » = « tomate »).
// Exceptions : des mots dont le pluriel veut dire autre chose (« pâtes » ≠ « pâte » brisée).
const GARDER_PLURIEL = new Set(["pates"]);
function keyOf(name){ return norm(name).replace(/^(de |d')/,"").split(" ").map(w=>w.length>3&&!GARDER_PLURIEL.has(w)?w.replace(/[sx]$/,""):w).join(" "); }
// L'ancienne clé (avant 0.9.4), pour retrouver les réglages de la banque enregistrés avec elle
function keyOfAncien(name){ return norm(name).replace(/^(de |d')/,"").split(" ").map(w=>w.length>3?w.replace(/[sx]$/,""):w).join(" "); }

/* ---------- Rayons et quantités ---------- */
// Rayons : mots-clés testés dans cet ordre (le premier qui correspond gagne)
// (testés sur le nom tel quel ET au singulier : « pommes de terre » trouve « pomme de terre »)
const AISLES = [
  ["surgeles","Surgelés",/surgele/],
  ["epices","Épices et condiments",/(^| )(sel|poivre|moutarde|sauce soja|herbe|epice|cumin|paprika|muscade|thym|bouquet garni|cube|bouillon|levure|cinq epice|safran|anis|cannelle|piment|mayonnaise|zaatar|menthe sechee|tahini|nuoc|pate de curry)/],
  ["conserves","Conserves",/(boite|conserve|concass|lait de coco|(^| )thon|sardine|(^| )mais|coulis|pelee|cornichon|(^| )olive)/],
  ["boissons","Boissons",/(^| )(jus(?! de citron)|eau( |$)|eau gazeuse|vin( |$)|biere|cidre|sirop(?! d.erable)|soda|limonade|cafe|the( |$)|tisane|cognac|rhum|whisky|porto|champagne|martini|pastis)/],
  ["sucre","Sucré",/(^| )(sucre|chocolat|biscuit|confiture|miel|cacao|vanille|caramel|bonbon|gateau|cookie|nutella|pate a tartiner|sirop d.erable|pepites|cassonade|vergeoise|meringue|speculoos|madeleine|praline|creme de marron)/],
  ["epicerie","Épicerie",/(sechee|seches|beurre de cacah|morilles|champignons noirs|croutons|sauce )/],
  ["boucherie","Boucherie, charcuterie, poisson",/(^| )(boeuf|veau|porc|poulet|lardon|jambon|chorizo|saucisse|merguez|chipolata|boudin|magret|steak|cordon|chair a saucisse|petit sale|crevette|saumon|morue|poisson|surimi|rillette|canard|dinde)/],
  ["cremerie","Crèmerie, œufs, frais",/(^| )(oeuf|lait|beurre|creme|fromage|gruyere|parmesan|mozzarella|feta|chevre|roquefort|bleu|reblochon|cheddar|yaourt|pate brisee|ravioles|gnocchi|tofu)/],
  ["boulangerie","Boulangerie",/(^| )(pain|baguette|tortilla)/],
  ["legumes","Légumes et herbes",/(^| )(tomate|courgette|aubergine|poivron|oignon|echalote|ail|carotte|poireau|champignon|salade|roquette|concombre|menthe|persil|basilic|coriandre|ciboulette|aneth|estragon|sauge|gingembre|chou|betterave|epinard|potimarron|navet|legume|pousse|chataigne|pomme de terre|patate|courge|haricots? verts?|petit(s)? pois|fenouil|celeri|radis|asperge|brocoli|endive)/],
  ["fruits","Fruits",/(^| )(pomme|citron|avocat|melon|grenade|peche|poire|banane|fraise|orange|raisin|cerise|kiwi|mangue|ananas|framboise|abricot|clementine|prune|myrtille|datte|figue)/],
];
// Produits ménagers : catégories
const RAYONS_MENAGE = [["m-vaisselle","Vaisselle"],["m-linge","Linge"],["m-nettoyage","Nettoyage"],["m-papier","Papier et sacs"],["m-hygiene","Hygiène"]];
// Ordre des rayons dans la liste (à peu près celui d'un magasin, surgelés à la fin)
const AISLES_FOOD = ["fruits","legumes","boucherie","cremerie","boulangerie","conserves","epicerie","sucre","epices","boissons","surgeles"];
// « Souvent déjà au placard » : une option d'un ingrédient (pas un rayon). Départ deviné d'après le nom.
const RE_PLACARD = /(^| )(sel|poivre|huile|vinaigre|farine|sucre|moutarde|sauce soja|herbe|epice|cumin|paprika|muscade|thym|bouquet garni|cube|bouillon|levure|chapelure|miel|cinq epice|safran|anis|cannelle|piment|mayonnaise|zaatar|menthe sechee|tahini|nuoc|cognac|pate de curry)/;
function auPlacard(name){ return RE_PLACARD.test(norm(name)); }
const AISLE_ORDER = [...AISLES_FOOD,"perso",...RAYONS_MENAGE.map(r=>r[0])];
function aisleOf(name){ const n=norm(name), s=keyOf(name); for(const [id,,re] of AISLES) if(re.test(n)||re.test(s)) return id; return "epicerie"; }
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
  // Arrondis pour faire les courses, mais jamais jusqu'à 0 (« 2 g sel » reste « 2 g »)
  if(unit==="g"){ if(q>=1000) return (Math.round(q/100)/10).toLocaleString("fr-FR")+" kg"; return (q<10?Math.max(1,Math.round(q)):q<50?Math.round(q/5)*5:Math.round(q/10)*10)+" g"; }
  if(unit==="cl"){ if(q>=100) return (Math.round(q/10)/10).toLocaleString("fr-FR")+" L"; if(q<1) return Math.max(1,Math.round(q*10))+" ml"; return (q<10?Math.round(q*2)/2:Math.round(q)).toLocaleString("fr-FR")+" cl"; }
  let v;
  if(!unit && q<1){ v = q<=.25?"¼":q<=.5?"½":q<=.75?"¾":"1"; }
  else v = !unit ? String(Math.ceil(q-0.05)) : Math.max(.5, Math.round(q*2)/2).toLocaleString("fr-FR");
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
 [/vaisselle|lessive|adoucissant|savon|javel|nettoyant|detartrant|desinfectant|produit wc|multi-usage/,"bouteille",{y:"l",Y:"L"}],
 [/pommes? de terre|patate/,"patate"],[/chataigne/,"patate",{t:"b",b:"B"}],[/petit(s)? poi/,"noix",{B:"G",b:"g"}],[/pois chiche/,"noix",{B:"b",b:"t"}],
 [/lentille/,"noix",{B:"G",b:"v"}],[/olive/,"noix",{B:"k",b:"G"}],[/tomate/,"tomate"],[/poivron|piment/,"poivron"],[/betterave/,"tomate",{r:"u",R:"U"}],
 [/potimarron|courges?( |$)/,"tomate",{r:"o",R:"O"}],[/oignon|echalote/,"oignon"],[/(^| )ail( |$)/,"ail"],[/carotte/,"carotte"],[/aubergine/,"courgette",{g:"u",G:"U"}],
 [/courgette|concombre|cornichon/,"courgette"],[/poireau/,"courgette",{g:"v"}],[/champignon|morille/,"champignon"],[/melon/,"pomme",{r:"v",R:"G"}],
 [/peche/,"pomme",{r:"o",R:"O"}],[/pomme|grenade/,"pomme"],[/citron vert/,"citron",{y:"g",Y:"G"}],[/citron/,"citron"],[/avocat/,"avocat"],
 [/chou-fleur|chou fleur/,"salade",{g:"w",G:"W"}],[/salade|roquette|epinard|chou|romaine/,"salade"],[/navet/,"oignon",{t:"w",b:"u"}],
 [/persil|basilic|coriandre|menthe|ciboulette|aneth|estragon|sauge|thym|herbe|bouquet/,"herbe"],[/pousse|vermicelle/,"pates",{t:"w",Y:"W"}],
 [/(^| )oeuf/,"oeuf"],[/mozzarella|feta|tofu|chevre/,"fromage",{y:"w",Y:"W",c:"W"}],[/fromage blanc|yaourt|creme/,"pot",{y:"w",B:"l"}],
 [/lait de coco/,"boite",{r:"w"}],[/lait/,"lait"],[/beurre de cacah/,"pot",{y:"b"}],[/beurre/,"beurre"],
 [/gruyere|parmesan|cheddar|fromage|roquefort|bleu|reblochon/,"fromage"],[/crevette/,"crevette"],[/saumon/,"poisson",{s:"p",S:"P"}],
 [/thon/,"boite",{r:"l"}],[/poisson|morue|cabillaud/,"poisson"],[/surimi/,"saucisse",{P:"w",p:"r",R:"r"}],[/poulet|dinde|cordon|nugget/,"poulet"],
 [/lardon|jambon|chorizo|saucisse|merguez|chipolata|boudin|rillette|chair/,"saucisse"],[/boeuf|veau|porc|steak|magret|canard|petit sale|viande/,"viande"],
 [/boite|concass|haricot|ravioli/,"boite"],[/pate brisee|galette|tortilla|pain|baguette|crouton/,"pain"],
 [/pates|spaghetti|tagliatelle|nouille|orzo|crozet|gnocchi|ravioles/,"pates"],[/riz|semoule|arborio/,"riz"],
 [/noix|cacahu|sesame/,"noix"],[/sauce soja|nuoc/,"bouteille",{y:"B",Y:"k"}],[/(^| )vin|cidre|cognac/,"bouteille",{y:"u",Y:"U"}],
 [/huile|vinaigre/,"bouteille"],[/sauce|mayonnaise|moutarde|miel|tahini|pate de curry/,"pot"],
 [/(^| )sel|poivre|epice|cumin|paprika|muscade|safran|anis|cannelle|cinq|zaatar|curry/,"pot",{y:"o",Y:"O"}],
];
// Icônes qu'on peut choisir à la main pour un ingrédient
const ICONES={tomate:"Tomate",poivron:"Poivron",oignon:"Oignon",ail:"Ail",carotte:"Carotte",courgette:"Courgette",champignon:"Champignon",patate:"Pomme de terre",
  salade:"Salade",herbe:"Herbes",pomme:"Pomme",citron:"Citron",avocat:"Avocat",oeuf:"Œuf",fromage:"Fromage",lait:"Lait",beurre:"Beurre",pot:"Pot",
  poulet:"Poulet",viande:"Viande",saucisse:"Saucisse",poisson:"Poisson",crevette:"Crevette",boite:"Conserve",pates:"Pâtes",riz:"Riz",pain:"Pain",
  noix:"Noix, graines",bouteille:"Bouteille",sachet:"Sachet"};
const spriteCache=new Map();
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
  return {name:m[1], map:m[2]||{}};
}
function mainColor(spr){
  const cnt={}; SPR[spr.name].join("").split("").forEach(ch=>{ if(ch!==" "&&ch!=="k") cnt[ch]=(cnt[ch]||0)+1; });
  const ch=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0][0]; return spr.map[ch]||ch;
}
/* ---------- Textures Minecraft (facultatif) ----------
   Les images ne sont PAS dans le code (dépôt public, textures de Mojang / Farmer's Delight) :
   elles sont importées par l'utilisateur et gardées dans Firebase. app.js remplit MC.tex et MC.actif.
   Ordre : texture choisie dans la banque > nom de l'ingrédient (MC_ING) > famille du dessin Foodix (MC_FAMILLE) > dessin Foodix. */
const MC={actif:false, tex:{}};
const MC_ING=[
 [/pommes? de terre|patate/,"potato"],[/tomates? concass|coulis|sauce tomate|passata|pulpe de tomate/,"tomato_sauce"],[/tomate/,"tomato"],
 [/oignon|echalote/,"onion"],[/carotte/,"carrot"],[/betterave/,"beetroot"],[/potimarron|courges?( |$)|citrouille|potiron/,"pumpkin_slice"],
 [/champignon|morille|cepe|girolle/,"brown_mushroom"],[/chou-fleur|chou fleur/,""],[/chou/,"cabbage"],[/salade|romaine|roquette|epinard|laitue|mache|feuille/,"cabbage_leaf"],
 [/pomme|grenade/,"apple"],[/melon|pasteque/,"melon_slice"],[/fruits rouges|framboise|fraise|myrtille|cassis|groseille|cerise/,"sweet_berries"],
 [/(^| )oeuf/,"egg"],[/lait de coco/,""],[/lait/,"milk_bottle"],[/poulet|dinde|nugget|cordon/,"chicken"],
 [/lardon|bacon/,"bacon"],[/jambon/,"ham"],[/steak hache|viande hachee|(^| )hache/,"minced_beef"],[/agneau|mouton|gigot/,"mutton"],[/lapin/,"rabbit"],
 [/porc|echine|filet mignon|petit sale|travers/,"porkchop"],[/boeuf|veau|steak|bavette|viande/,"beef"],
 [/saumon/,"salmon"],[/cabillaud|morue|colin|lieu|merlu|poisson/,"cod"],
 [/pates brisee|pate brisee|pate feuilletee|pate a tarte|pate sablee/,"pie_crust"],[/pates|spaghetti|tagliatelle|nouille|orzo|crozet|gnocchi|lasagne|penne|ravioles/,"raw_pasta"],
 [/riz|arborio/,"rice"],[/pain|baguette|crouton|brioche/,"bread"],[/farine/,"wheat"],[/(^| )sucre/,"sugar"],[/(^| )sel( |$)/,"sugar"],[/miel/,"honey_bottle"],
 [/chocolat|cacao/,"cocoa_beans"],[/algue|nori|wakame/,"dried_kelp"],[/bouillon/,"bone_broth"],[/huile|vinaigre/,"glass_bottle"],[/biscuit|cookie/,"cookie"],
];
const MC_FAMILLE={patate:"potato",tomate:"tomato",oignon:"onion",carotte:"carrot",champignon:"brown_mushroom",salade:"cabbage_leaf",pomme:"apple",
  oeuf:"egg",lait:"milk_bottle",poulet:"chicken",viande:"beef",saucisse:"bacon",poisson:"cod",pates:"raw_pasta",riz:"rice",pain:"bread",bouteille:"glass_bottle"};
const MC_PLAT=[
 [/burger/,"hamburger"],[/croque|sandwich/,"chicken_sandwich"],[/wrap|fajita|tacos|burrito/,"mutton_wrap"],[/ratatouille/,"ratatouille"],
 [/parmentier|hachi/,"shepherds_pie"],[/soupe a l.oignon|soupe d.oignon/,"onion_soup"],[/(soupe|veloute|potage).*(potiron|potimarron|courge|citrouille)/,"pumpkin_soup"],
 [/ramen|pho|soupe.*nouille/,"noodle_soup"],[/(soupe|bouillon).*poulet/,"chicken_soup"],[/soupe|veloute|potage|gaspacho/,"vegetable_soup"],
 [/bouillabaisse|marmite.*poisson|soupe de poisson/,"fish_stew"],[/bourguignon|pot-au-feu|ragout|mijote|daube|carbonade|blanquette|chili|navarin/,"beef_stew"],
 [/riz (saute|cantonais)|fried rice|nasi/,"fried_rice"],[/risotto/,"mushroom_rice"],[/salade de fruits/,"fruit_salad"],
 [/oeufs? (au plat|brouill)|omelette|chakchouka/,"fried_egg"],[/poulet roti|roti/,"roast_chicken"],[/saumon/,"grilled_salmon"],[/cabillaud|morue|poisson/,"baked_cod_stew"],
 [/bolo|boulette/,"pasta_with_meatballs"],[/wok|pad thai|nouille/,"vegetable_noodles"],[/pates|spaghetti|tagliatelle|lasagne|penne|carbonara/,"pasta_with_meatballs"],
 [/tarte aux pommes|tarte tatin/,"apple_pie"],[/quiche|tarte/,"pumpkin_pie"],[/pommes? de terre farcie/,"stuffed_potato"],[/(courge|potimarron) farci/,"stuffed_pumpkin"],
 [/chou farci/,"cabbage_rolls"],[/sushi|maki/,"kelp_roll_slice"],[/nems|rouleau/,"salmon_roll"],[/gyoza|ravioli|dumpling/,"dumplings"],
 [/brochette|kebab/,"barbecue_stick"],[/jambon/,"honey_glazed_ham"],[/steak|frites/,"steak_and_potatoes"],[/gateau|cake/,"cake_slice"],
];
const MC_TYPE={plate:"steak_and_potatoes",bowl:"beef_stew",salad:"mixed_salad",pan:"fried_rice",gratin:"shepherds_pie",tart:"pumpkin_pie",
  burger:"hamburger",sandwich:"chicken_sandwich",wrap:"mutton_wrap",sauce:"tomato_sauce",roast:"roast_chicken",fish:"grilled_salmon"};
// Texture Minecraft d'un ingrédient (nom de la texture), ou "" s'il n'y en a pas : on garde alors le dessin Foodix
function mcIng(name, icone, mc){
  if(!MC.actif) return "";
  if(mc && MC.tex[mc]) return mc;
  const n=norm(name), m=MC_ING.find(([re])=>re.test(n));
  if(m) return MC.tex[m[1]] ? m[1] : "";
  const f=MC_FAMILLE[(icone && SPR[icone]) ? icone : ingSprite(name).name];
  return f && MC.tex[f] ? f : "";
}
const mcBalise = (t, px, cls) => `<img class="${cls} mc" src="${MC.tex[t]}" width="${px}" height="${px}" alt="">`;

function ingImg(name, px=22, icone, mc){
  const t=mcIng(name, icone, mc); if(t) return mcBalise(t, px, "px");
  const s=(icone && SPR[icone]) ? {name:icone,map:{}} : ingSprite(name); const key="i|"+s.name+JSON.stringify(s.map);
  if(!spriteCache.has(key)) spriteCache.set(key, drawGrid(SPR[s.name],12,s.map));
  return `<img class="px" src="${spriteCache.get(key)}" width="${px}" height="${px}" alt="">`;
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
  if (MC.actif) {
    const m = MC_PLAT.find(([re]) => re.test(r.id)), t = m && MC.tex[m[1]] ? m[1] : MC_TYPE[dishType(r)];
    if (MC.tex[t]) return mcBalise(t, px, "px dish");
  }
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
  return `<img class="px dish" src="${spriteCache.get(key)}" width="${px}" height="${px}" alt="">`;
}

export { norm, parseItem, keyOf, keyOfAncien, aisleOf, auPlacard, rayonMenage, aisleLabel, AISLE_ORDER, AISLES_FOOD, RAYONS_MENAGE, ICONES, fmtQty, ingImg, dishImg, dishType, MC, mcIng };
