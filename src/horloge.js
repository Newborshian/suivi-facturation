// Horloge réelle de l'application : { maintenant() -> Date, aujourdHui() -> 'AAAA-MM-JJ' (date LOCALE du PC) }.
// Créée par server.js et passée au store et aux routes. Les tests injectent une horloge fixe de même forme (tests/aides/horloge.js) :
// ne jamais appeler `new Date()` dans le domaine, toujours passer par l'horloge ou par `ctx`.
import { aujourdHuiLocal } from './domain/dates.js';

export function creerHorloge() {
  return {
    maintenant: () => new Date(),
    aujourdHui: () => aujourdHuiLocal(new Date()),
  };
}
