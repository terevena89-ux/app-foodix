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
  ["placard","Sans doute au placard",/(^| )(sel|poivre|huile|vinaigre|farine|sucre|moutarde|sauce soja|herbe|epice|cumin|paprika|muscade|thym|bouquet garni|cube|bouillon|levure|chapelure|miel|cinq epice|safran|anis|cannelle|piment|mayonnaise|zaatar|menthe sechee|tahini|nuoc|cognac|pate de curry)/],
  ["epicerie","Épicerie",/(boite|concass|sechee|seches|lait de coco|beurre de cacah|morilles|champignons noirs|vin |cidre|croutons|sauce )/],
  ["boucherie","Boucherie, charcuterie, poisson",/(^| )(boeuf|veau|porc|poulet|lardon|jambon|chorizo|saucisse|merguez|chipolata|boudin|magret|steak|cordon|chair a saucisse|petit sale|crevette|saumon|morue|poisson|surimi|rillette|canard|dinde)/],
  ["cremerie","Crèmerie, œufs, frais",/(^| )(oeuf|lait|beurre|creme|fromage|gruyere|parmesan|mozzarella|feta|chevre|roquefort|bleu|reblochon|cheddar|yaourt|pate brisee|ravioles|gnocchi|tofu)/],
  ["boulangerie","Boulangerie",/(^| )(pain|baguette|tortilla)/],
  ["fruits","Fruits et légumes",/(^| )(tomate|courgette|aubergine|poivron|oignon|echalote|ail|carotte|poireau|pomme|champignon|salade|roquette|concombre|avocat|citron|menthe|persil|basilic|coriandre|ciboulette|aneth|estragon|sauge|gingembre|chou|betterave|epinard|potimarron|navet|melon|grenade|legume|pousse|chataigne|olive)/],
];
const AISLE_ORDER = ["fruits","boucherie","cremerie","boulangerie","epicerie","placard","perso"];
function aisleOf(name){ const n=norm(name); for(const [id,,re] of AISLES) if(re.test(n)) return id; return "epicerie"; }
function aisleLabel(id){ return id==="perso" ? "Ajouts" : (AISLES.find(a=>a[0]===id)||[,"Épicerie"])[1]; }
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
 [/pomme de terre|patate/,"patate"],[/chataigne/,"patate",{t:"b",b:"B"}],[/petit(s)? poi/,"noix",{B:"G",b:"g"}],[/pois chiche/,"noix",{B:"b",b:"t"}],
 [/lentille/,"noix",{B:"G",b:"v"}],[/olive/,"noix",{B:"k",b:"G"}],[/tomate/,"tomate"],[/poivron|piment/,"poivron"],[/betterave/,"tomate",{r:"u",R:"U"}],
 [/potimarron|courge/,"tomate",{r:"o",R:"O"}],[/oignon|echalote/,"oignon"],[/(^| )ail( |$)/,"ail"],[/carotte/,"carotte"],[/aubergine/,"courgette",{g:"u",G:"U"}],
 [/courgette|concombre|cornichon/,"courgette"],[/poireau/,"courgette",{g:"v"}],[/champignon|morille/,"champignon"],[/melon/,"pomme",{r:"v",R:"G"}],
 [/peche/,"pomme",{r:"o",R:"O"}],[/pomme|grenade/,"pomme"],[/citron vert/,"citron",{y:"g",Y:"G"}],[/citron/,"citron"],[/avocat/,"avocat"],
 [/chou-fleur|chou fleur/,"salade",{g:"w",G:"W"}],[/salade|roquette|epinard|chou|romaine/,"salade"],[/navet/,"oignon",{t:"w",b:"u"}],
 [/persil|basilic|coriandre|menthe|ciboulette|aneth|estragon|sauge|thym|herbe|bouquet/,"herbe"],[/pousse|vermicelle/,"pates",{t:"w",Y:"W"}],
 [/oeuf/,"oeuf"],[/mozzarella|feta|tofu|chevre/,"fromage",{y:"w",Y:"W",c:"W"}],[/fromage blanc|yaourt|creme/,"pot",{y:"w",B:"l"}],
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
function ingImg(name, px=22){
  const s=ingSprite(name); const key="i|"+s.name+JSON.stringify(s.map);
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
  const key = "d|" + r.id + "|" + (r.ingredients || []).join(";");
  if (!spriteCache.has(key)) {
    const type = dishType(r);
    const cols = [];
    for (const txt of r.ingredients || []) {
      const it = parseItem(txt); if (!it || aisleOf(it.name) === "placard") continue;
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

export { norm, parseItem, keyOf, aisleOf, aisleLabel, AISLE_ORDER, fmtQty, ingImg, dishImg, dishType };
