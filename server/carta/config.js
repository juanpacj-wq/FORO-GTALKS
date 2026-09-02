/**
 * La configuración de la carta de presentación, leída del entorno UNA vez.
 *
 * La misma doctrina de server/correo/inscripcion.js y server/certificados.js:
 *
 *   · las cinco DB_* VACÍAS  → `activa: false`, el módulo NO EXISTE (router sin montar,
 *     /api/carta/* → 404, `carta: 'no_aplica'` en /api/me). Es el defecto.
 *   · las cinco puestas      → `activa: true`.
 *   · a medias, o con un valor que no vale → `problemas[]`. En producción `exigirEntorno()`
 *     (server/index.js) ABORTA el arranque con la lista; en desarrollo `iniciarCarta` avisa y
 *     apaga el módulo. Una configuración a medias no enciende nada a medias.
 *
 * Pura: recibe `env` y devuelve un objeto. Sin efectos, para que el arnés la ejerza con
 * entornos inventados.
 */

/** Las cinco que, juntas, encienden el módulo. Sus nombres los eligió el usuario en su .env. */
const CLAVES_BD = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

/** Cortacircuitos por IP y ventana de 15 min. Defectos del plan (docs/RUNBOOK-CARTA.md). */
const LIMITES_POR_DEFECTO = { publico: 1200, admin: 600, foto: 60 };

const ROL_POR_DEFECTO = 'LOGIN_JEFA';

const norm = (v) => String(v ?? '').trim();

function leerEntero(env, clave, defecto, problemas) {
  const crudo = norm(env[clave]);
  if (!crudo) return defecto;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
    problemas.push(`${clave}=«${crudo}» no es un entero positivo`);
    return defecto;
  }
  return n;
}

/**
 * @returns {{
 *   activa: boolean,
 *   problemas: string[],
 *   bd: { host: string, puerto: number, nombre: string, usuario: string, clave: string, confiarCertificado: boolean },
 *   rolAdmin: string,
 *   limites: { publico: number, admin: number, foto: number },
 * }}
 */
export function leerConfiguracionCarta(env = process.env) {
  const problemas = [];
  const puestas = CLAVES_BD.filter((k) => norm(env[k]));

  // ── El motor ──────────────────────────────────────────────────────────────
  // `mssql` (SQL Server, las cinco DB_*) o `sqlite` (embebido, node:sqlite, DB_SQLITE_PATH).
  // Sin DB_MOTOR se deduce: DB_SQLITE_PATH puesto = sqlite; si no, mssql. Las dos familias a la
  // vez es una configuración a medias: no se adivina cuál manda.
  const motorPedido = norm(env.DB_MOTOR).toLowerCase();
  const rutaSqlite = norm(env.DB_SQLITE_PATH);
  let motor = motorPedido || (rutaSqlite ? 'sqlite' : 'mssql');
  if (motorPedido && !['mssql', 'sqlite'].includes(motorPedido)) {
    problemas.push(`DB_MOTOR=«${motorPedido}» no existe (usa mssql o sqlite)`);
    motor = 'mssql';
  }
  if (motor === 'sqlite') {
    if (!rutaSqlite) problemas.push('DB_MOTOR=sqlite exige DB_SQLITE_PATH (ruta absoluta del archivo .db)');
    if (puestas.length) problemas.push(`con DB_MOTOR=sqlite las DB_* de SQL Server sobran (hay ${puestas.join(', ')}): déjalas vacías`);
    const rolAdminS = norm(env.CARTA_ROL_ADMIN) || ROL_POR_DEFECTO;
    return {
      activa: problemas.length === 0,
      motor: 'sqlite',
      problemas,
      sqlite: { ruta: rutaSqlite },
      bd: { host: '', puerto: 0, nombre: '', usuario: '', clave: '', confiarCertificado: false, nombreTls: '' },
      rolAdmin: rolAdminS,
      limites: {
        publico: leerEntero(env, 'CARTA_RATE_PUBLICO', LIMITES_POR_DEFECTO.publico, problemas),
        admin: leerEntero(env, 'CARTA_RATE_ADMIN', LIMITES_POR_DEFECTO.admin, problemas),
        foto: leerEntero(env, 'CARTA_RATE_FOTO', LIMITES_POR_DEFECTO.foto, problemas),
      },
    };
  }
  if (rutaSqlite && puestas.length) {
    problemas.push('DB_SQLITE_PATH y las DB_* de SQL Server a la vez: elige un motor (DB_MOTOR) y vacía el otro bloque');
  }

  const activa = puestas.length === CLAVES_BD.length;

  if (!activa && puestas.length > 0) {
    const faltan = CLAVES_BD.filter((k) => !norm(env[k]));
    problemas.push(
      `el bloque DB_* está a medias (faltan ${faltan.join(', ')}): ponlas las cinco para encender ` +
      'la carta de presentación, o ninguna para que el módulo no exista.',
    );
  }

  const puerto = activa ? leerEntero(env, 'DB_PORT', 1433, problemas) : 1433;
  if (activa && puerto > 65535) problemas.push(`DB_PORT=${puerto} no es un puerto TCP`);

  // Confiar en el certificado del SQL Server es un riesgo ACEPTADO (docs/SEGURIDAD.md): el
  // servidor presenta uno autofirmado y sin `true` la conexión cifrada no se establece. Se pide
  // explícito, nunca por defecto, y solo acepta `true`/`false` literales.
  const confiar = norm(env.DB_TRUST_CERT).toLowerCase();
  if (confiar && confiar !== 'true' && confiar !== 'false') {
    problemas.push(`DB_TRUST_CERT=«${confiar}» solo admite true o false`);
  }

  const rolAdmin = norm(env.CARTA_ROL_ADMIN) || ROL_POR_DEFECTO;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(rolAdmin)) {
    problemas.push(`CARTA_ROL_ADMIN=«${rolAdmin}» no parece un nombre de App Role de Entra`);
  }

  const limites = {
    publico: leerEntero(env, 'CARTA_RATE_PUBLICO', LIMITES_POR_DEFECTO.publico, problemas),
    admin: leerEntero(env, 'CARTA_RATE_ADMIN', LIMITES_POR_DEFECTO.admin, problemas),
    foto: leerEntero(env, 'CARTA_RATE_FOTO', LIMITES_POR_DEFECTO.foto, problemas),
  };

  return {
    activa: activa && problemas.length === 0,
    motor: 'mssql',
    problemas,
    sqlite: { ruta: '' },
    bd: {
      host: norm(env.DB_HOST),
      puerto,
      nombre: norm(env.DB_NAME),
      usuario: norm(env.DB_USER),
      clave: String(env.DB_PASSWORD ?? ''),
      confiarCertificado: confiar === 'true',
      // Opcional: el nombre TLS (SNI) cuando el host es una IP. Ver `nombreTls` en bd.js.
      nombreTls: norm(env.DB_TLS_SERVERNAME),
    },
    rolAdmin,
    limites,
  };
}
