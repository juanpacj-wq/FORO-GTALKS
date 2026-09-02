/**
 * El motor EMBEBIDO de la carta: SQLite dentro del propio proceso, con `node:sqlite` (Node 22.13+
 * sin bandera; en la estación, Node 26). Cero dependencias nuevas, cero instalación en el servidor.
 *
 * Existe porque el 2026-09-02 el servidor no alcanzaba ningún SQL Server (el 1433 hacia
 * PortalG3 bloqueado, el administrador de infraestructura de viaje) y la jefa necesitaba su
 * carta ese día. Es la misma capa de datos con otro motor: `DB_MOTOR=sqlite` +
 * `DB_SQLITE_PATH=/var/lib/gtalks/carta.db` (StateDirectory de systemd: sobrevive a los
 * despliegues, como el libro de inscripciones). El código de las rutas, la validación, la foto,
 * el OG y el panel no saben cuál de los dos motores hay debajo.
 *
 * Decisiones:
 * - Un solo `DatabaseSync` por proceso, WAL (lecturas y escrituras no se bloquean entre sí),
 *   `foreign_keys=ON` (la foto cae en cascada con el perfil, como en SQL Server) y
 *   `busy_timeout` por si algún día hay dos procesos.
 * - La API es la misma de bd.js: `conectar`, `consulta(fn)`, `transaccion(fn)`, `estado`,
 *   `cerrar`. Aquí `fn` recibe la base (`DatabaseSync`) y es SÍNCRONA: node:sqlite lo es. Las
 *   promesas se conservan para que el repositorio y las rutas no cambien.
 * - Un fallo de apertura (ruta que no existe, sin permiso, archivo corrupto) es `BdNoDisponible`,
 *   igual que un SQL Server caído: las rutas contestan 503 y el foro sigue.
 * - Copia de seguridad: `VACUUM INTO` produce un archivo consistente con la base en uso; lo
 *   expone `respaldar(destino)` y lo usa scripts/carta-respaldar.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { BdNoDisponible } from './bd.js';

/** ¿Es un error de SQLite por restricción UNIQUE (el correo repetido)? */
export const esDuplicadoSqlite = (err) =>
  err?.errcode === 2067 || /UNIQUE constraint failed/i.test(String(err?.message || ''));

export function crearBdSqlite({ ruta }) {
  let db = null;
  let ultimoCodigo = '';

  function abrir() {
    if (db) return db;
    try {
      const dir = path.dirname(path.resolve(ruta));
      if (!fs.existsSync(dir)) throw Object.assign(new Error(`no existe el directorio ${dir}`), { code: 'ENOENT' });
      const nueva = new DatabaseSync(path.resolve(ruta));
      nueva.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
      db = nueva;
      ultimoCodigo = '';
      return db;
    } catch (err) {
      ultimoCodigo = String(err.code || err.errcode || err.message || 'desconocido');
      console.error(`[carta/bd-sqlite] no se pudo abrir ${ruta}: ${ultimoCodigo}`);
      throw new BdNoDisponible(ultimoCodigo);
    }
  }

  return {
    motor: 'sqlite',
    ruta: path.resolve(ruta),
    async conectar() {
      return abrir();
    },
    async consulta(fn) {
      return fn(abrir());
    },
    async transaccion(fn) {
      const d = abrir();
      d.exec('BEGIN IMMEDIATE');
      try {
        const r = await fn(d);
        d.exec('COMMIT');
        return r;
      } catch (err) {
        try { d.exec('ROLLBACK'); } catch { /* ya deshecha */ }
        throw err;
      }
    },
    estado() {
      return db ? 'ok' : 'no_disponible';
    },
    /** Copia consistente de la base a `destino` (VACUUM INTO). */
    async respaldar(destino) {
      const d = abrir();
      const abs = path.resolve(destino);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      d.exec(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);
      return abs;
    },
    async cerrar() {
      if (db) {
        try { db.close(); } catch { /* ya cerrada */ }
        db = null;
      }
    },
  };
}

// ── Migraciones en SQLite ─────────────────────────────────────────────────────
// Misma disciplina que migraciones.js: archivos NNN-slug.sql (de sql-sqlite/), sha256 por
// archivo, una transacción por migración, y una aplicada que cambió aborta.

export async function leerAplicadasSqlite(db) {
  const existe = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'carta_migracion'").get();
  if (!existe) return new Map();
  const filas = db.prepare('SELECT numero, nombre, sha256, aplicada_en FROM carta_migracion ORDER BY numero').all();
  return new Map(filas.map((f) => [f.numero, f]));
}

export async function estadoMigracionesSqlite(db, lista) {
  const aplicadas = await leerAplicadasSqlite(db);
  const filas = lista.map((m) => {
    const a = aplicadas.get(m.numero);
    if (!a) return { ...m, situacion: 'pendiente' };
    if (a.sha256 !== m.sha256) return { ...m, situacion: 'sha_distinto', aplicada_en: a.aplicada_en };
    return { ...m, situacion: 'aplicada', aplicada_en: a.aplicada_en };
  });
  const pendientes = filas.filter((f) => f.situacion === 'pendiente');
  const estado = filas.some((f) => f.situacion === 'sha_distinto')
    ? 'sha_distinto'
    : pendientes.length ? 'pendientes' : 'al_dia';
  return { estado, filas, pendientes };
}

export async function aplicarPendientesSqlite(db, lista, { registrar = () => {} } = {}) {
  const { estado, pendientes, filas } = await estadoMigracionesSqlite(db, lista);
  if (estado === 'sha_distinto') {
    const mal = filas.filter((f) => f.situacion === 'sha_distinto').map((f) => f.nombre);
    throw new Error(
      `Migración(es) ya aplicada(s) con otro contenido: ${mal.join(', ')}. ` +
      'No se edita una migración aplicada: escribe la siguiente.',
    );
  }
  for (const m of pendientes) {
    db.exec('BEGIN');
    try {
      for (const lote of m.lotes) db.exec(lote);
      db.prepare('INSERT INTO carta_migracion (numero, nombre, sha256) VALUES (?, ?, ?)').run(m.numero, m.nombre, m.sha256);
      db.exec('COMMIT');
      registrar(m);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ya deshecha */ }
      throw new Error(`Falló ${m.archivo}: ${err.message}`);
    }
  }
  return pendientes.length;
}
