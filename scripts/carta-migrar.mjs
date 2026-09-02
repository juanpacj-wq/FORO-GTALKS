// El migrador del esquema `carta` (SQL Server). La ÚNICA forma de tocar el esquema.
//
//   node --env-file=.env scripts/carta-migrar.mjs --estado              # qué falta (no toca nada)
//   node --env-file=.env scripts/carta-migrar.mjs --confirmar           # aplica las pendientes (dev)
//   DB_NAME=PortalG3 node --env-file=.env scripts/carta-migrar.mjs --confirmar --bd PortalG3
//
// Doble llave para producción: si DB_NAME no termina en `_dev`, `--confirmar` exige `--bd` con
// el MISMO nombre. Así una variable de entorno cambiada por accidente no puede migrar la base
// de producción sin que quien teclea escriba su nombre.
//
// El servidor JAMÁS aplica migraciones: al arrancar solo las comprueba y aborta si faltan.
// Editar una migración ya aplicada no la vuelve a aplicar: se detecta por sha256 y este script
// se niega a seguir («escribe la siguiente, no edites la aplicada»).
import { leerConfiguracionCarta } from '../server/carta/config.js';
import { crearBd } from '../server/carta/bd.js';
import { aplicarPendientes, estadoMigraciones, listarMigraciones } from '../server/carta/migraciones.js';

const args = process.argv.slice(2);
const modo = args.includes('--confirmar') ? 'confirmar' : args.includes('--estado') ? 'estado' : null;
const iBd = args.indexOf('--bd');
const bdPedida = iBd >= 0 ? args[iBd + 1] : null;

if (!modo) {
  console.error('Uso: carta-migrar.mjs --estado | --confirmar [--bd <DB_NAME>]');
  process.exit(2);
}

const cfg = leerConfiguracionCarta();
if (cfg.problemas.length) {
  for (const p of cfg.problemas) console.error(`  · ${p}`);
  process.exit(2);
}
if (!cfg.activa) {
  console.error('Faltan las DB_* en el entorno (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD).');
  process.exit(2);
}

const esDev = /_dev$/i.test(cfg.bd.nombre);
if (modo === 'confirmar' && !esDev && bdPedida !== cfg.bd.nombre) {
  console.error(
    `DB_NAME=${cfg.bd.nombre} no termina en _dev: para aplicar migraciones ahí hay que escribir ` +
    `--bd ${cfg.bd.nombre} en la línea de comando (doble llave).`,
  );
  process.exit(2);
}

const lista = listarMigraciones();
const bd = crearBd(cfg.bd);
const fecha = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''));

try {
  const pool = await bd.conectar();
  console.log(`\n${cfg.bd.host}:${cfg.bd.puerto} · ${cfg.bd.nombre} · usuario ${cfg.bd.usuario}\n`);

  const pintar = (m) => {
    for (const f of m.filas) {
      const situacion =
        f.situacion === 'aplicada' ? `aplicada ${fecha(f.aplicada_en)}` :
        f.situacion === 'pendiente' ? 'PENDIENTE' : `SHA DISTINTO (aplicada ${fecha(f.aplicada_en)})`;
      console.log(`  ${f.nombre.padEnd(24)} ${situacion}`);
    }
    console.log(`\n  estado: ${m.estado} · ${m.pendientes.length} pendiente(s)\n`);
  };

  const antes = await estadoMigraciones(pool, lista);
  pintar(antes);

  if (modo === 'confirmar') {
    if (antes.estado === 'sha_distinto') {
      console.error('  No se aplica nada: una migración ya aplicada cambió. Escribe la siguiente, no edites la aplicada.');
      process.exit(1);
    }
    if (!antes.pendientes.length) {
      console.log('  Nada que aplicar.');
    } else {
      const n = await aplicarPendientes(pool, { registrar: (m) => console.log(`  aplicada ${m.nombre}`) });
      console.log(`\n  ${n} migración(es) aplicada(s).\n`);
      pintar(await estadoMigraciones(pool, lista));
    }
  }
  process.exitCode = antes.estado === 'al_dia' || modo === 'confirmar' ? 0 : 1;
} catch (err) {
  console.error(`\n  ERROR: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await bd.cerrar();
}
