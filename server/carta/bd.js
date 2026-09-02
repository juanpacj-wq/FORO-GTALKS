/**
 * El pool único hacia el SQL Server, con cortacircuitos.
 *
 * Es la primera base de datos del sitio y solo la usa la carta de presentación: el foro no pasa
 * por aquí, así que una BD caída deja el foro entero de pie y solo la carta contesta 503.
 *
 * Decisiones que no son obvias:
 *
 * - `conectar()` MEMORIZA la promesa de conexión: cien peticiones simultáneas con la BD fría
 *   abren UN pool, no cien. Si la conexión falla, la promesa se descarta y durante
 *   `CORTACIRCUITOS_MS` toda consulta responde `BdNoDisponible` en el acto, sin volver a
 *   intentar: una BD caída no puede convertir cada petición en 5 s de espera.
 * - `pool.on('error')` (la BD se cae en caliente) registra y resetea, para que la siguiente
 *   petición reconecte en vez de reusar un pool muerto.
 * - Los errores de transporte de tedious (ETIMEOUT, ESOCKET, ELOGIN, ECONNRESET, ECONNCLOSED)
 *   se traducen a `BdNoDisponible`, que las rutas convierten en 503 + Retry-After. Los demás
 *   errores (un CHECK violado, un UNIQUE) suben tal cual: son del dominio, no del transporte.
 * - Los logs llevan el CÓDIGO del error, nunca la cadena de conexión ni la consulta: van a
 *   journald, que lee cualquiera con acceso al servidor.
 * - Solo parámetros tipados. No hay ni una consulta que concatene texto del cliente.
 */
import net from 'node:net';
import sql from 'mssql';

export { sql };

/**
 * El nombre que viaja en el SNI del TLS. tedious lo copia de `server` tal cual, y Node (26 en la
 * estación; 22 en el servidor lo avisa y algún día lo prohibirá) se niega a poner una DIRECCIÓN
 * IP ahí: «Setting the TLS ServerName to an IP address is not permitted», que tedious reporta
 * como ESOCKET y que se parece a una BD caída. El SQL Server de GECELCA se alcanza por IP, así
 * que cuando `host` es una IP se manda un nombre fijo. Con `DB_TRUST_CERT=true` el nombre no se
 * comprueba contra el certificado; el día que se instale la CA y se ponga `false`, habrá que dar
 * el nombre que el certificado lleve, con `DB_TLS_SERVERNAME`.
 */
export function nombreTls(host, explicito = '') {
  if (explicito) return explicito;
  return net.isIP(host) ? 'sqlserver.gecelca.invalid' : host;
}

export class BdNoDisponible extends Error {
  constructor(codigo) {
    super(`La base de datos no está disponible (${codigo})`);
    this.name = 'BdNoDisponible';
    this.codigo = codigo;
  }
}

const CORTACIRCUITOS_MS = 5000;
const CODIGOS_TRANSPORTE = new Set([
  'ETIMEOUT', 'ESOCKET', 'ELOGIN', 'ECONNRESET', 'ECONNCLOSED', 'ECONNREFUSED', 'EHOSTUNREACH',
  'ENOTFOUND', 'EINSTLOOKUP', 'ENOCONN', 'EALREADYCONNECTED', 'EPIPE',
]);

function codigoDe(err) {
  return String(err?.code || err?.originalError?.code || err?.name || 'desconocido');
}

/** ¿Es un fallo del transporte (BD caída, red, credenciales) y no del dominio? */
export function esErrorDeTransporte(err) {
  if (err instanceof BdNoDisponible) return true;
  if (err instanceof sql.ConnectionError) return true;
  return CODIGOS_TRANSPORTE.has(codigoDe(err));
}

/**
 * Crea la capa de datos para una configuración. Devuelve funciones cerradas sobre SU pool, para
 * que el arnés pueda levantar una contra un puerto cerrado sin tocar la del servidor.
 */
export function crearBd(cfg) {
  const config = {
    server: cfg.host,
    port: cfg.puerto,
    database: cfg.nombre,
    user: cfg.usuario,
    password: cfg.clave,
    options: {
      encrypt: true,
      trustServerCertificate: cfg.confiarCertificado,
      serverName: nombreTls(cfg.host, cfg.nombreTls),
      useUTC: true,
      appName: 'gtalks-carta',
      enableArithAbort: true,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000, acquireTimeoutMillis: 5000 },
    connectionTimeout: 5000,
    requestTimeout: 10_000,
  };

  let pool = null;
  let conexion = null;      // la promesa memorizada
  let ultimoFallo = 0;      // Date.now() del último fallo de conexión
  let ultimoCodigo = '';

  function resetear() {
    const viejo = pool;
    pool = null;
    conexion = null;
    if (viejo) viejo.close().catch(() => {});
  }

  async function conectar() {
    if (pool?.connected) return pool;
    if (conexion) return conexion;
    if (Date.now() - ultimoFallo < CORTACIRCUITOS_MS) throw new BdNoDisponible(ultimoCodigo || 'cortacircuitos');

    const nuevo = new sql.ConnectionPool(config);
    nuevo.on('error', (err) => {
      console.error(`[carta/bd] error del pool: ${codigoDe(err)}`);
      resetear();
    });
    conexion = nuevo.connect().then(
      (p) => {
        pool = p;
        ultimoFallo = 0;
        ultimoCodigo = '';
        return p;
      },
      (err) => {
        conexion = null;
        ultimoFallo = Date.now();
        ultimoCodigo = codigoDe(err);
        console.error(`[carta/bd] no se pudo conectar: ${ultimoCodigo}`);
        nuevo.close().catch(() => {});
        throw new BdNoDisponible(ultimoCodigo);
      },
    );
    return conexion;
  }

  /** Traduce el transporte a BdNoDisponible y deja pasar el resto. */
  function traducir(err) {
    if (err instanceof BdNoDisponible) return err;
    if (esErrorDeTransporte(err)) {
      resetear();
      ultimoFallo = Date.now();
      ultimoCodigo = codigoDe(err);
      console.error(`[carta/bd] transporte: ${ultimoCodigo}`);
      return new BdNoDisponible(ultimoCodigo);
    }
    return err;
  }

  /**
   * Ejecuta `fn(request)` con una petición nueva del pool. `fn` recibe un `sql.Request` con el
   * que declarar los parámetros tipados (`.input('id', sql.UniqueIdentifier, id)`).
   */
  async function consulta(fn) {
    let p;
    try {
      p = await conectar();
    } catch (err) {
      throw traducir(err);
    }
    try {
      return await fn(p.request());
    } catch (err) {
      throw traducir(err);
    }
  }

  /** Lo mismo dentro de una transacción: `fn(tx)` recibe la transacción y crea sus requests. */
  async function transaccion(fn) {
    let p;
    try {
      p = await conectar();
    } catch (err) {
      throw traducir(err);
    }
    const tx = new sql.Transaction(p);
    try {
      await tx.begin();
    } catch (err) {
      throw traducir(err);
    }
    try {
      const resultado = await fn(tx);
      await tx.commit();
      return resultado;
    } catch (err) {
      try { await tx.rollback(); } catch { /* la conexión ya murió: no hay nada que deshacer */ }
      throw traducir(err);
    }
  }

  /** `ok` con pool conectado; `no_disponible` en cortacircuitos o sin conexión aún. */
  function estado() {
    if (pool?.connected) return 'ok';
    return 'no_disponible';
  }

  async function cerrar() {
    resetear();
  }

  return { conectar, consulta, transaccion, estado, cerrar, config: { ...config, password: undefined } };
}
