import { aujourdHuiLocal } from './domain/dates.js';

// Horloge réelle. Les tests injectent une horloge fixe de même forme.
export function creerHorloge() {
  return {
    maintenant: () => new Date(),
    aujourdHui: () => aujourdHuiLocal(new Date()),
  };
}
