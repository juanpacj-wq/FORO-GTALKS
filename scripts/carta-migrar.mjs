// El migrador del esquema de la carta. La ÚNICA forma de tocar el esquema, en cualquier motor.
//
//   node --env-file=.env scripts/carta-migrar.mjs --estado              # qué falta (no toca nada)
//   node --env-file=.env scripts/carta-migrar.mjs --confirmar           # aplica las pendientes (dev)
//   DB_NAME=PortalG3 node --env-file=.env scripts/carta-migrar.mjs --confirmar --bd PortalG3
//
// Motor: el de la configuración (DB_MOTOR / DB_SQLITE_PATH / las DB_*; ver server/carta/config.js).
// Doble llave para SQL Server en producción: si DB_NAME no termina en `_dev`, `--confirmar` exige
// `--bd` con el MISMO nombre. En SQLite la doble llave es la RUTA: fuera de `.datos/` (la carpeta
// local de la estación) hay que repetirla con `--bd <ruta>`, para que un DB_SQLITE_PATH heredado
// del entorno del servidor no migre otra base sin que quien teclea la nombre.
//
// El servidor JAMÁS aplica migraciones: al arrancar solo las comprueba y aborta si faltan.
// Editar una migración ya aplicada no la vuelve a aplicar: se detecta por sha256 y este script
// se niega a seguir («escribe la siguiente, no edites la aplicada»).
import { leerConfiguracionCarta } from '../server/carta/config.js';
import { crearCapaDatos } from '../server/carta/index.js';

const args = process.argv.slice(2);
const modo = args.includes('--confirmar') ? 'confirmar' : args.includes('--estado') ? 'estado' : null;
const iBd = args.indexOf('--bd');
const bdPedida = iBd >= 0 ? args[iBd + 1] : null;

if (!modo) {
  console.error('Uso: carta-migrar.mjs --estado | --confirmar [--bd <DB_NAME | ruta .db>]');
  process.exit(2);
}

const cfg = leerConfiguracionCarta();
if (cfg.problemas.length) {
  for (const p of cfg.problemas) console.error(`  · ${p}`);
  process.exit(2);
}
if (!cfg.activa) {
  console.error('Sin motor configurado: DB_MOTOR=sqlite + DB_SQLITE_PATH, o las cinco DB_* de SQL Server.');
  process.exit(2);
}

const capa = crearCapaDatos(cfg);
const nombreBd = cfg.motor === 'sqlite' ? capa.bd.ruta : cfg.bd.nombre;
const esDev = cfg.motor === 'sqlite' ? /[\\/]\.datos[\\/]/.test(nombreBd) : /_dev$/i.test(nombreBd);
if (modo === 'confirmar' && !esDev && bdPedida !== nombreBd && bdPedida !== cfg.sqlite.ruta) {
  console.error(
    `${cfg.motor === 'sqlite' ? 'DB_SQLITE_PATH' : 'DB_NAME'}=${nombreBd} no es de desarrollo: para aplicar ` +
    `migraciones ahí hay que escribir --bd ${cfg.motor === 'sqlite' ? cfg.sqlite.ruta : nombreBd} en la línea de comando (doble llave).`,
  );
  process.exit(2);
}

const fecha = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

try {
  const conexion = await capa.bd.conectar();
  console.log(`\n${capa.descripcion}\n`);

  const pintar = (m) => {
    for (const f of m.filas) {
      const situacion =
        f.situacion === 'aplicada' ? `aplicada ${fecha(f.aplicada_en)}` :
        f.situacion === 'pendiente' ? 'PENDIENTE' : `SHA DISTINTO (aplicada ${fecha(f.aplicada_en)})`;
      console.log(`  ${f.nombre.padEnd(24)} ${situacion}`);
    }
    console.log(`\n  estado: ${m.estado} · ${m.pendientes.length} pendiente(s)\n`);
  };

  const antes = await capa.estadoMigraciones(conexion);
  pintar(antes);

  if (modo === 'confirmar') {
    if (antes.estado === 'sha_distinto') {
      console.error('  No se aplica nada: una migración ya aplicada cambió. Escribe la siguiente, no edites la aplicada.');
      process.exit(1);
    }
    if (!antes.pendientes.length) {
      console.log('  Nada que aplicar.');
    } else {
      const n = await capa.aplicarPendientes(conexion, { registrar: (m) => console.log(`  aplicada ${m.nombre}`) });
      console.log(`\n  ${n} migración(es) aplicada(s).\n`);
      pintar(await capa.estadoMigraciones(conexion));
    }
  }
  process.exitCode = antes.estado === 'al_dia' || modo === 'confirmar' ? 0 : 1;
} catch (err) {
  console.error(`\n  ERROR: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await capa.bd.cerrar();
}
