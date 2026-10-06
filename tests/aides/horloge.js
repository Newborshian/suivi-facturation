// Horloge fixe : `maintenant` est un Date en heure locale, `aujourdHui` la date civile correspondante.
export function horlogeFixe(date = '2026-10-02', heure = '09:14:03') {
  const [a, m, j] = date.split('-').map(Number);
  const [h, mi, s] = heure.split(':').map(Number);
  const instant = new Date(a, m - 1, j, h, mi, s);
  return { maintenant: () => new Date(instant), aujourdHui: () => date };
}

/** Horloge réglable : `regler(date, heure)` change l'instant courant (jour suivant, minuit…). */
export function horlogeReglable(date = '2026-10-02', heure = '09:14:03') {
  let courante = horlogeFixe(date, heure);
  return {
    maintenant: () => courante.maintenant(),
    aujourdHui: () => courante.aujourdHui(),
    regler(d, h = '09:14:03') {
      courante = horlogeFixe(d, h);
    },
  };
}
