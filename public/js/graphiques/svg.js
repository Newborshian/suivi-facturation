// Création d'éléments SVG par createElementNS : jamais de HTML construit à partir de données (CSP stricte).
// L'espace de noms SVG est un identifiant, pas une adresse réseau (rien n'est chargé).
const NS = 'http://www.w3.org/2000/svg';

/** `attributs` : valeur false / null / undefined = attribut absent ; tout est passé par setAttribute (jamais d'attribut de style). */
export function svg(balise, attributs = {}, ...enfants) {
  const noeud = document.createElementNS(NS, balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur === null || valeur === undefined) continue;
    noeud.setAttribute(nom, valeur === true ? '' : String(valeur));
  }
  for (const enfant of enfants) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    noeud.append(typeof enfant === 'string' ? document.createTextNode(enfant) : enfant);
  }
  return noeud;
}
