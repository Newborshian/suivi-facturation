// Choix du thème (Paramètres › Apparence) : « auto » (suit le système, défaut), « light » ou « dark ».
// Le choix manuel est mémorisé dans localStorage (convenance personnelle, non nominative) ; chaque accès est protégé par try/catch.
// Le thème est appliqué dès le chargement de chaque page par theme-init.js (même clé).
export const CLE_THEME = 'suivi-facturation.theme';
export const THEMES = ['auto', 'light', 'dark'];

/** Thème mémorisé ; « auto » si rien n'est mémorisé ou si le stockage est indisponible. */
export function lireTheme() {
  try {
    const valeur = window.localStorage.getItem(CLE_THEME);
    return valeur === 'light' || valeur === 'dark' ? valeur : 'auto';
  } catch {
    return 'auto';
  }
}

/** Applique le thème au document (« auto » retire l'attribut : le CSS suit alors le système). */
export function appliquerTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

/** Mémorise et applique. -> false si le choix n'a pas pu être mémorisé (il reste appliqué pour la page en cours). */
export function choisirTheme(theme) {
  if (!THEMES.includes(theme)) return false;
  appliquerTheme(theme);
  try {
    if (theme === 'auto') window.localStorage.removeItem(CLE_THEME);
    else window.localStorage.setItem(CLE_THEME, theme);
    return true;
  } catch {
    return false;
  }
}
