// fs simulé : délègue au vrai fs/promises mais peut refuser rename un nombre de fois donné (verrou Windows).
import fsp from 'node:fs/promises';

/** fs simulé : tant que `etat.bloque` est vrai, le dossier sauvegardes/ est inaccessible (création refusée). */
export function fsSauvegardesBloquees() {
  const etat = { bloque: false };
  const fs = {
    ...fsp,
    open: (...a) => fsp.open(...a),
    mkdir: async (chemin, ...a) => {
      if (etat.bloque && /sauvegardes/.test(String(chemin))) throw Object.assign(new Error('simulé'), { code: 'EACCES' });
      return fsp.mkdir(chemin, ...a);
    },
  };
  return { fs, etat };
}

export function fsAvecRenameRefuse(refus, code = 'EPERM') {
  const etat = { appels: 0 };
  const fs = {
    ...fsp,
    open: (...a) => fsp.open(...a),
    rename: async (...a) => {
      etat.appels += 1;
      if (etat.appels <= refus) throw Object.assign(new Error('simulé'), { code });
      return fsp.rename(...a);
    },
  };
  return { fs, etat };
}

/**
 * fs simulé : tant que `etat.bloque` est vrai, rename refuse (EPERM, verrou Windows) quand la DESTINATION correspond à `motif`
 * (ex. /suivi-facturation\.json$/ : le fichier actif est occupé, mais les sauvegardes s'écrivent normalement).
 */
export function fsRenameRefuseSur(motif, code = 'EPERM') {
  const etat = { bloque: true, refus: 0 };
  const fs = {
    ...fsp,
    open: (...a) => fsp.open(...a),
    rename: async (source, destination, ...reste) => {
      if (etat.bloque && motif.test(String(destination))) {
        etat.refus += 1;
        throw Object.assign(new Error('simulé'), { code });
      }
      return fsp.rename(source, destination, ...reste);
    },
  };
  return { fs, etat };
}
