// Outil de mesure (pas un test) : N courses de K processus `node src/server.js` lancés en même temps sur le même dossier de données.
// Usage : node tests/aides/course-stress.js <courses> <processus> <meme|differents>
// Sortie : histogramme des codes de sortie des perdants + extrait de la sortie/du journal des perdants hors code 3. Dossiers sous .tmp/tests/ uniquement.
import fs from 'node:fs/promises';
import path from 'node:path';
import { arreterParBouton, attendrePret, avecDossiers, pause, portLibre } from './instance-aide.js';

const [courses = 300, k = 5, mode = 'meme'] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const histo = {};
const anomalies = [];
let sansSurvivantUnique = 0;

for (let tour = 1; tour <= courses; tour++) {
  await avecDossiers(async (ctx) => {
    const ports = [];
    const premier = await portLibre();
    for (let i = 0; i < k; i++) ports.push(mode === 'meme' ? premier : await portLibre());
    const serveurs = ports.map((port) => ctx.lancer({ port }));
    const codes = new Array(k).fill(null);
    serveurs.forEach((s, i) => s.fin.then((c) => (codes[i] = c)));
    const limite = Date.now() + 25_000;
    while (codes.filter((c) => c !== null).length < k - 1 && Date.now() < limite) await pause(30);
    await pause(300);
    const survivants = serveurs.filter((_, i) => codes[i] === null);
    if (survivants.length !== 1) sansSurvivantUnique++;
    for (const [i, s] of serveurs.entries()) {
      if (codes[i] === null) continue;
      histo[codes[i]] = (histo[codes[i]] ?? 0) + 1;
      if (codes[i] !== 3 && anomalies.length < 6) {
        const journal = await fs.readFile(path.join(ctx.logs, 'suivi-facturation.log'), 'utf8').catch(() => '');
        const lignes = journal.split('\n').filter((l) => /inattendue|ERREUR|AVERT|verrou/i.test(l)).join(' | ').slice(0, 900);
        anomalies.push(`tour ${tour} code ${codes[i]} : ${s.sortie().trim().slice(0, 200)} // JOURNAL : ${lignes}`);
      }
    }
    if (survivants.length === 1) {
      try { await attendrePret(survivants[0]); await arreterParBouton(survivants[0]); } catch (e) { anomalies.push(`tour ${tour} arrêt du survivant : ${e.message.slice(0, 150)}`); }
    }
  });
}
console.log(JSON.stringify({ courses, processus: k, mode, codesDesPerdants: histo, coursesSansSurvivantUnique: sansSurvivantUnique, anomalies }, null, 1));
