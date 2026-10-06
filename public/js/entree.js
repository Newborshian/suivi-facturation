// Règle du design system : la touche Entrée valide le formulaire (ici des formulaires sans <form> : lignes et ajout de Paramètres).
// Seuls les champs de saisie (texte, nombre) déclenchent la validation : pas les listes, cases, boutons ni la composition de texte.

/** L'événement clavier doit-il valider ? Fonction pure (testée sans navigateur) : `evt` = { key, isComposing, target: { tagName, type } }. */
export function entreeValide(evt) {
  if (evt?.key !== 'Enter' || evt.isComposing === true) return false;
  const cible = evt.target ?? {};
  if (String(cible.tagName).toUpperCase() !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range'].includes(String(cible.type ?? 'text').toLowerCase());
}

/** Entrée dans un champ de `zone` : clic sur `bouton` (sans effet s'il est désactivé ; ignoré pendant son traitement). */
export function validerParEntree(zone, bouton) {
  zone.addEventListener('keydown', (evt) => {
    if (!entreeValide(evt)) return;
    evt.preventDefault();
    if (bouton.disabled || bouton.getAttribute('aria-busy') === 'true') return;
    bouton.click();
  });
}
