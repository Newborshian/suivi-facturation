// Périodes proposées par le tableau de bord. Module PUR : un choix + la date du jour (donnée par le serveur) -> mois de début et de fin.
import { moisPlusN } from './format.js';

export const PERIODES = [
  { id: '12-mois', libelle: '12 derniers mois' },
  { id: '6-mois', libelle: '6 derniers mois' },
  { id: '3-mois', libelle: '3 derniers mois' },
  { id: 'annee', libelle: 'Année en cours' },
  { id: 'annee-precedente', libelle: 'Année précédente' },
];
export const PERIODE_DEFAUT = '12-mois';

/** -> { de, a } (AAAA-MM) ; un identifiant inconnu donne la période par défaut. Le mois en cours est toujours inclus, sauf pour l'année précédente. */
export function plagePeriode(id, aujourdHui) {
  const courant = aujourdHui.slice(0, 7);
  const annee = Number(courant.slice(0, 4));
  const reculer = (n) => moisPlusN(courant, -n) ?? courant;
  switch (id) {
    case '6-mois':
      return { de: reculer(5), a: courant };
    case '3-mois':
      return { de: reculer(2), a: courant };
    case 'annee':
      return { de: `${annee}-01`, a: courant };
    case 'annee-precedente':
      return annee > 2000 ? { de: `${annee - 1}-01`, a: `${annee - 1}-12` } : { de: `${annee}-01`, a: courant };
    default:
      return { de: reculer(11), a: courant };
  }
}

/** « 12 derniers mois » -> texte de la période pour les sous-titres : « de novembre 2025 à octobre 2026 ». */
export function formaterPlage({ de, a }, formatMois) {
  return de === a ? formatMois(de) : `de ${formatMois(de)} à ${formatMois(a)}`;
}
