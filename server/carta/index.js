/**
 * La carta de presentación digital: el punto de entrada del módulo.
 *
 * `iniciarCarta()` se llama UNA vez desde buildAuthApp() y decide, con la configuración:
 *
 *   · DB_* vacías → `{activa: false}`: router sin montar, `/api/carta/*` cae al 404 genérico,
 *     `/api/me` dice `carta: 'no_aplica'` y /health publica `configurada: false`.
 *   · a medias → en producción no llega aquí (exigirEntorno aborta antes); en desarrollo avisa y
 *     apaga el módulo.
 *   · completa → conecta con tope de 5 s y comprueba las migraciones:
 *       - pendientes o sha distinto → THROW (aborta el arranque; deploy.sh revierte).
 *       - BD inalcanzable → aviso ruidoso, `bd: 'no_disponible'`, las rutas responden 503 con
 *         reintento perezoso; el foro sigue vivo. Es la decisión D2 del plan: una BD caída no
 *         puede tumbar un sitio que no la necesita.
 *     Y auto-comprueba sharp: si el binario nativo no cargó, THROW ahora y no la primera vez que
 *     alguien suba una foto.
 *
 * `iniciarCarta` es SÍNCRONA (buildAuthApp lo es) y deja las comprobaciones asíncronas en
 * marcha: el `listen` no espera, pero `arranque` (la promesa) se resuelve o rechaza y
 * server/index.js la vigila para abortar. Mientras tanto, las rutas de la carta responden 503.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { soloRol } from '../auth/guardias.js';
import { crearLimitador } from '../limites.js';
import { leerConfiguracionCarta } from './config.js';
import { crearBd } from './bd.js';
import { aplicarPendientes, estadoMigraciones, listarMigraciones } from './migraciones.js';
import { crearRepositorio } from './repositorio.js';
import { aplicarPendientesSqlite, crearBdSqlite, estadoMigracionesSqlite } from './bd-sqlite.js';
import { crearRepositorioSqlite } from './repositorio-sqlite.js';
import { crearRutasCarta } from './rutas.js';
import { comprobarSharp } from './foto.js';
import { crearHtmlConOg, prepararOg } from './og.js';
import { crearDirectorio } from './directorio.js';
import { crearProveedorDeToken } from '../correo/graph-mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.resolve(__dirname, '..', '..', 'dist', 'index.html');
const DIR_SQL_SQLITE = path.resolve(__dirname, 'sql-sqlite');

/**
 * La capa de datos para una configuración YA activa, según el motor: `bd`, `repositorio`, la
 * lista de migraciones y dos funciones para comprobarlas y aplicarlas. La comparten el
 * arranque, scripts/carta-migrar.mjs y scripts/carta-db-test.mjs, así que un motor nuevo
 * (o un cambio en uno) se enchufa aquí y en ningún otro sitio.
 */
export function crearCapaDatos(cfg) {
  if (cfg.motor === 'sqlite') {
    const bd = crearBdSqlite(cfg.sqlite);
    const lista = listarMigraciones(DIR_SQL_SQLITE);
    return {
      motor: 'sqlite',
      descripcion: `sqlite ${bd.ruta}`,
      bd,
      repositorio: crearRepositorioSqlite(bd),
      lista,
      estadoMigraciones: (conexion) => estadoMigracionesSqlite(conexion, lista),
      aplicarPendientes: (conexion, opciones) => aplicarPendientesSqlite(conexion, lista, opciones),
    };
  }
  const bd = crearBd(cfg.bd);
  const lista = listarMigraciones();
  return {
    motor: 'mssql',
    descripcion: `mssql ${cfg.bd.host}:${cfg.bd.puerto}/${cfg.bd.nombre}`,
    bd,
    repositorio: crearRepositorio(bd),
    lista,
    estadoMigraciones: (pool) => estadoMigraciones(pool, lista),
    aplicarPendientes: (pool, opciones) => aplicarPendientes(pool, opciones),
  };
}

/** Estado del módulo para /api/me y /health. Uno solo por proceso. */
let estado = {
  configurada: false,
  bd: 'apagada',            // 'apagada' | 'ok' | 'no_disponible' | 'comprobando'
  migraciones: 'apagadas',  // 'apagadas' | 'al_dia' | 'pendientes' | 'sha_distinto' | 'sin_comprobar'
  rolAdmin: null,
  og: false,
};
let htmlConOgActivo = async () => null;
let bdActual = null;

export function estadoSaludCarta() {
  return { ...estado };
}

/** Lo que `/api/me` anuncia: `admin` solo con el módulo encendido Y el rol en la sesión. */
export function estadoCarta(roles) {
  if (!estado.configurada || !estado.rolAdmin) return 'no_aplica';
  return Array.isArray(roles) && roles.includes(estado.rolAdmin) ? 'admin' : 'no_aplica';
}

/** El fallback SPA llama a esto para la ruta de una tarjeta. */
export function htmlConOg(id) {
  return htmlConOgActivo(id);
}

/**
 * @returns {{ activa: boolean, router?: import('express').Router, linea: string, arranque: Promise<void> }}
 */
export function iniciarCarta(env = process.env, { dependencias = {} } = {}) {
  const cfg = leerConfiguracionCarta(env);
  const esProduccion = env.NODE_ENV === 'production';

  if (cfg.problemas.length) {
    // En producción exigirEntorno() ya abortó; aquí solo se llega en desarrollo.
    for (const p of cfg.problemas) console.warn(`  ⚠  [carta] ${p}`);
    console.warn('  ⚠  [carta] configuración a medias: el módulo queda APAGADO');
    estado = { ...estado, configurada: false, bd: 'apagada', migraciones: 'apagadas' };
    return { activa: false, linea: '  [carta] módulo APAGADO (configuración a medias)', arranque: Promise.resolve() };
  }
  if (!cfg.activa) {
    estado = { ...estado, configurada: false, bd: 'apagada', migraciones: 'apagadas', rolAdmin: null };
    return { activa: false, linea: '  [carta] módulo APAGADO (DB_* vacías: la carta de presentación no existe)', arranque: Promise.resolve() };
  }

  const capa = dependencias.capa || crearCapaDatos(cfg);
  const bd = capa.bd;
  bdActual = bd;
  const repositorio = dependencias.repositorio || capa.repositorio;
  const origen = String(env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  const limites = {
    publico: crearLimitador({ nombre: 'carta/publico', limite: cfg.limites.publico }),
    admin: crearLimitador({ nombre: 'carta/admin', limite: cfg.limites.admin }),
    foto: crearLimitador({ nombre: 'carta/foto', limite: cfg.limites.foto }),
  };
  // El directorio de Entra para prellenar cartas: con las mismas credenciales de aplicación del
  // login (User.Read.All). Sin ellas (un entorno sin M365_*), el buscador no existe y la carta
  // se escribe a mano; nada más cambia.
  let directorio = null;
  if (env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET) {
    directorio = dependencias.directorio || crearDirectorio({
      obtenerToken: crearProveedorDeToken({
        tenantId: env.M365_TENANT_ID, clientId: env.M365_CLIENT_ID, clientSecret: env.M365_CLIENT_SECRET,
      }),
    });
  }
  const router = crearRutasCarta({ repositorio, guardias: { soloRol }, limites, cfg, origen, directorio });

  estado = { configurada: true, motor: capa.motor, bd: 'comprobando', migraciones: 'sin_comprobar', rolAdmin: cfg.rolAdmin, og: false };

  // Open Graph: la plantilla se lee una vez. Sin dist/index.html (dev sin build) queda apagado.
  let og = { activo: false, motivo: 'dist/index.html no existe' };
  if (fs.existsSync(INDEX_HTML)) og = prepararOg(fs.readFileSync(INDEX_HTML, 'utf8'));
  if (og.activo) {
    htmlConOgActivo = crearHtmlConOg({ plantilla: og.plantilla, repositorio, origen });
    estado.og = true;
  } else {
    console.warn(`  ⚠  [carta] Open Graph dinámico apagado: ${og.motivo}`);
    htmlConOgActivo = async () => null;
  }

  const lista = capa.lista;

  // Las comprobaciones asíncronas. `arranque` rechaza SOLO por lo que debe abortar el proceso
  // (sharp roto, migraciones pendientes o alteradas); la BD inalcanzable se degrada.
  const arranque = (async () => {
    const versiones = await comprobarSharp().catch((err) => {
      throw new Error(`[carta] sharp no funciona en esta máquina: ${err.message}. ¿El lockfile trae @img/sharp-linux-x64?`);
    });
    let pool;
    try {
      pool = await bd.conectar();
    } catch (err) {
      estado.bd = 'no_disponible';
      console.error(`  ⚠  [carta] la base de datos NO responde al arrancar (${err.codigo || err.message}): las rutas de la carta contestan 503 hasta que vuelva; el foro sigue vivo.`);
      return;
    }
    let m;
    try {
      m = await capa.estadoMigraciones(pool);
    } catch (err) {
      estado.bd = 'no_disponible';
      console.error(`  ⚠  [carta] no se pudieron leer las migraciones: ${err.message}`);
      return;
    }
    estado.migraciones = m.estado;
    if (m.estado !== 'al_dia') {
      const detalle = m.filas
        .filter((f) => f.situacion !== 'aplicada')
        .map((f) => `${f.nombre} (${f.situacion})`)
        .join(', ');
      throw new Error(
        `[carta] el esquema de la base de datos no está al día: ${detalle}. ` +
        'Aplica las migraciones con `node --env-file=.env scripts/carta-migrar.mjs --confirmar` ' +
        '(en producción, con --bd <DB_NAME>) antes de arrancar.',
      );
    }
    estado.bd = 'ok';
    console.log(`  [carta] activa · ${capa.motor} ok · ${lista.length} migraciones al día · rol ${cfg.rolAdmin} · sharp ${versiones.sharp || ''} libvips ${versiones.vips || ''}`);
  })();

  // Un fallo del arranque en producción tiene que TUMBAR el proceso (deploy.sh revierte); en
  // desarrollo se grita y se sigue, para no dejar a nadie sin sitio por una migración.
  arranque.catch((err) => {
    if (esProduccion) {
      console.error(err.message);
      process.exit(1);
    } else {
      console.error(`  ⚠  ${err.message}`);
    }
  });

  return {
    activa: true,
    router,
    linea: `  [carta] configurada · ${capa.descripcion} · rol ${cfg.rolAdmin} · límites ${cfg.limites.publico}/${cfg.limites.admin}/${cfg.limites.foto} · OG ${estado.og ? 'sí' : 'no'} (comprobando BD y migraciones…)`,
    arranque,
  };
}

/** Cierra el pool. Para el apagado ordenado y para los arneses. */
export async function cerrarCarta() {
  if (bdActual) await bdActual.cerrar();
}
