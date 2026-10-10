// Ordres de tri partagés par le domaine. Module pur.
// Un seul endroit par ordre : la liste des prestations, le récapitulatif, l'export CSV et le registre des patients en dépendent.
// Changer un ordre ici change l'affichage ET l'ordre d'écriture dans le fichier de données (registre) : à faire en connaissance de cause.
// Utilisé par prestations.js, recap.js, csv.js et patients.js.

/** Prestations : par date, puis date de création, puis identifiant (ordre stable même pour deux saisies du même jour). */
export const parDateEtCreation = (x, y) => x.date.localeCompare(y.date) || x.creeLe.localeCompare(y.creeLe) || x.id.localeCompare(y.id);

/** La prestation `a` est-elle plus récente que `b` (date, puis date de création) ? À égalité, `a` l'emporte. */
export const estPlusRecente = (a, b) => (a.date !== b.date ? a.date > b.date : a.creeLe >= b.creeLe);

/** Patients ({ id, nom, prenom }) : nom, puis prénom (ordre alphabétique français), puis identifiant. */
export const comparerPatients = (a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || a.id.localeCompare(b.id);
