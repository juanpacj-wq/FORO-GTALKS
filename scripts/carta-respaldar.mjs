// Copia de seguridad de la base SQLite de la carta (DB_MOTOR=sqlite), consistente con la base
// en uso: `VACUUM INTO` escribe un archivo completo y compacto sin parar el servidor.
//
//   node scripts/carta-respaldar.mjs /var/lib/gtalks/carta.db /var/backups/gtalks/carta
//     → /var/backups/gtalks/carta/carta-2026-09-02T18-05-11Z.db (y borra las copias de más de 30 días)
//
// En el servidor va en un cron del usuario gtalks (el archivo es suyo), ver docs/RUNBOOK-CARTA.md.
// NUNCA se copia el .db con `cp` mientras el servicio corre: SQLite lleva WAL y la copia puede
// salir a medias. Este script es la forma correcta, y la única.
import fs from 'node:fs';
import path from 'node:path';

import { crearBdSqlite } from '../server/carta/bd-sqlite.js';

const [origen, destinoDir, diasCrudo] = process.argv.slice(2);
if (!origen || !destinoDir) {
  console.error('Uso: carta-respaldar.mjs <ruta .db> <directorio de copias> [días que se conservan, defecto 30]');
  process.exit(2);
}
const dias = Number(diasCrudo || 30);
if (!fs.existsSync(origen)) {
  console.error(`No existe ${origen}`);
  process.exit(1);
}
fs.mkdirSync(destinoDir, { recursive: true });

const sello = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
const destino = path.join(destinoDir, `carta-${sello}.db`);
const bd = crearBdSqlite({ ruta: origen });
try {
  await bd.respaldar(destino);
  const { size } = fs.statSync(destino);
  console.log(`copia: ${destino} (${(size / 1024).toFixed(0)} KB)`);
  const limite = Date.now() - dias * 86_400_000;
  for (const f of fs.readdirSync(destinoDir)) {
    if (!/^carta-.*\.db$/.test(f)) continue;
    const ruta = path.join(destinoDir, f);
    if (fs.statSync(ruta).mtimeMs < limite) {
      fs.unlinkSync(ruta);
      console.log(`borrada (más de ${dias} días): ${f}`);
    }
  }
} finally {
  await bd.cerrar();
}
