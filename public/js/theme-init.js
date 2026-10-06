// Thème clair / sombre : appliqué AVANT l'affichage (script classique, bloquant, sans module) pour éviter un flash.
// Absent ou « auto » : le thème suit le système (prefers-color-scheme, géré par le CSS). Aucune donnée nominative ici.
// Doit rester cohérent avec theme.js (même clé).
try {
  const theme = window.localStorage.getItem('suivi-facturation.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (erreur) {
  // stockage indisponible (fenêtre privée, données bloquées) : thème automatique
}
