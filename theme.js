// Thème et animations choisis sur CET appareil, appliqués avant l'affichage (évite un flash blanc).
// « auto » (par défaut) : suit le réglage clair / sombre du téléphone ou du PC.
// Fichier à part (1.2.2) : la liste des sites autorisés (CSP, index.html) interdit le code écrit dans la page.
(function () {
  var t = 'auto', a = 'completes';
  try { t = localStorage.getItem('fx-theme') || 'auto'; a = localStorage.getItem('fx-anim') || 'completes'; } catch (e) { /* stockage bloqué */ }
  var sombre = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = t === 'auto' ? (sombre ? 'sombre' : 'clair') : t;
  document.documentElement.dataset.anim = a;
})();
