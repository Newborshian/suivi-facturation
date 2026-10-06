// Horloge et minuteurs simulés pour tester src/presence.js sans attendre.
// `avancer(ms)` : le temps passe, chaque minuteur échu se déclenche à son heure. `saut(ms)` : mise en veille, le temps saute d'un coup
// et chaque minuteur échu ne se déclenche qu'une fois (pas de rattrapage), comme un vrai processus qui se réveille.
export function creerMinuteursSimules() {
  let t = 1_000_000;
  let n = 0;
  let taches = [];
  const ajouter = (fn, delai, repete) => {
    const tache = { id: ++n, fn, delai, at: t + delai, repete };
    taches.push(tache);
    return tache;
  };
  const retirer = (tache) => {
    taches = taches.filter((x) => x !== tache);
  };
  const declencher = (tache) => {
    if (tache.repete) tache.at = t + tache.delai;
    else retirer(tache);
    tache.fn();
  };
  return {
    maintenant: () => t,
    minuteurs: { setInterval: (fn, d) => ajouter(fn, d, true), clearInterval: retirer, setTimeout: (fn, d) => ajouter(fn, d, false), clearTimeout: retirer },
    nombreMinuteurs: () => taches.length,
    avancer(ms) {
      const fin = t + ms;
      for (;;) {
        const prochaine = taches.filter((x) => x.at <= fin).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!prochaine) break;
        t = prochaine.at;
        declencher(prochaine);
      }
      t = fin;
    },
    saut(ms) {
      t += ms;
      for (const tache of taches.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) if (taches.includes(tache)) declencher(tache);
    },
  };
}
