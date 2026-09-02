/**
 * El repositorio de la carta sobre SQLite (node:sqlite). MISMA interfaz que repositorio.js
 * (SQL Server): `obtenerPublico`, `leerFotoSha`, `leerFoto`, `listar`, `obtenerAdmin`, `crear`,
 * `actualizar`, `cambiarEstado`, `guardarFoto`, `quitarFoto`, y las mismas formas de salida.
 * Las rutas, el OG y el panel no distinguen cuál de los dos hay debajo; lo fija
 * scripts/carta-db-test.mjs, que corre el MISMO guion contra los dos motores.
 *
 * Reglas iguales a las del otro: solo parámetros (nombrados `@x`), cada mutación con su fila
 * de auditoría dentro de la misma transacción, la foto en dos consultas (el sha primero), el
 * público solo ve activos, y `activo` viaja como 1/0 y sale como booleano.
 */
import crypto from 'node:crypto';

import { CorreoDuplicado, REDES_COLUMNAS } from './repositorio.js';
import { esDuplicadoSqlite } from './bd-sqlite.js';

const CAMPOS_PERFIL = ['nombres', 'apellidos', 'cargo', 'area', 'correo', 'telefono', 'whatsapp', ...REDES_COLUMNAS];
const COLUMNAS = `p.id, p.${CAMPOS_PERFIL.join(', p.')}, p.activo, p.creado_en, p.actualizado_en`;
const CON_FOTO = 'f.sha256 AS foto_sha256, f.ancho AS foto_ancho, f.alto AS foto_alto, f.bytes AS foto_bytes';

function redesDe(fila) {
  const redes = {};
  for (const r of REDES_COLUMNAS) redes[r] = fila[r] ?? null;
  return redes;
}

function aPublico(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    cargo: fila.cargo,
    area: fila.area ?? null,
    correo: fila.correo,
    telefono: fila.telefono ?? null,
    whatsapp: fila.whatsapp ?? null,
    redes: redesDe(fila),
    foto: fila.foto_sha256 ? { etag: fila.foto_sha256 } : null,
  };
}

function aAdmin(fila) {
  if (!fila) return null;
  return {
    ...aPublico(fila),
    activo: Boolean(fila.activo),
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
    foto: fila.foto_sha256
      ? { etag: fila.foto_sha256, ancho: fila.foto_ancho, alto: fila.foto_alto, bytes: fila.foto_bytes }
      : null,
  };
}

/** Los parámetros nombrados de un perfil validado, con `@` delante. */
function parametros(valor) {
  const p = {};
  for (const c of CAMPOS_PERFIL) p[`@${c}`] = valor[c] ?? null;
  return p;
}

export function crearRepositorioSqlite(bd) {
  function auditar(db, { actor, accion, perfilId = null, detalle = null }) {
    db.prepare(
      'INSERT INTO carta_auditoria (actor_oid, actor_upn, accion, perfil_id, detalle, ip) VALUES (@oid, @upn, @accion, @perfil, @detalle, @ip)',
    ).run({
      '@oid': actor.oid, '@upn': actor.upn, '@accion': accion, '@perfil': perfilId,
      '@detalle': detalle ? JSON.stringify(detalle) : null, '@ip': actor.ip ?? null,
    });
  }

  const existe = (db, id) => Boolean(db.prepare('SELECT 1 AS uno FROM carta_perfil WHERE id = ?').get(id));

  return {
    async obtenerPublico(id) {
      return bd.consulta((db) =>
        aPublico(db.prepare(
          `SELECT ${COLUMNAS}, ${CON_FOTO} FROM carta_perfil p LEFT JOIN carta_foto f ON f.perfil_id = p.id ` +
          'WHERE p.id = ? AND p.activo = 1',
        ).get(String(id).toLowerCase())),
      );
    },

    async leerFotoSha(id) {
      return bd.consulta((db) =>
        db.prepare(
          'SELECT f.sha256 FROM carta_foto f JOIN carta_perfil p ON p.id = f.perfil_id WHERE f.perfil_id = ? AND p.activo = 1',
        ).get(String(id).toLowerCase())?.sha256 ?? null,
      );
    },

    async leerFoto(id) {
      return bd.consulta((db) => {
        const f = db.prepare(
          'SELECT f.tipo, f.sha256, f.bytes, f.contenido FROM carta_foto f JOIN carta_perfil p ON p.id = f.perfil_id ' +
          'WHERE f.perfil_id = ? AND p.activo = 1',
        ).get(String(id).toLowerCase());
        return f ? { tipo: f.tipo, sha256: f.sha256, bytes: f.bytes, contenido: Buffer.from(f.contenido) } : null;
      });
    },

    async listar({ estado = 'activos' } = {}) {
      const filtro = estado === 'todos' ? '' : `WHERE p.activo = ${estado === 'activos' ? 1 : 0}`;
      return bd.consulta((db) =>
        db.prepare(
          'SELECT p.id, p.nombres, p.apellidos, p.cargo, p.area, p.correo, p.activo, p.actualizado_en, f.sha256 AS foto_sha256 ' +
          `FROM carta_perfil p LEFT JOIN carta_foto f ON f.perfil_id = p.id ${filtro} ` +
          'ORDER BY p.apellidos COLLATE NOCASE, p.nombres COLLATE NOCASE LIMIT 500',
        ).all().map((p) => ({
          id: p.id,
          nombre: `${p.nombres} ${p.apellidos}`,
          cargo: p.cargo,
          area: p.area ?? null,
          correo: p.correo,
          activo: Boolean(p.activo),
          foto: Boolean(p.foto_sha256),
          actualizado_en: p.actualizado_en,
        })),
      );
    },

    async obtenerAdmin(id) {
      return bd.consulta((db) => {
        const clave = String(id).toLowerCase();
        const perfil = aAdmin(db.prepare(
          `SELECT ${COLUMNAS}, ${CON_FOTO} FROM carta_perfil p LEFT JOIN carta_foto f ON f.perfil_id = p.id WHERE p.id = ?`,
        ).get(clave));
        if (!perfil) return null;
        const auditoria = db.prepare(
          'SELECT ts, actor_upn, accion, detalle FROM carta_auditoria WHERE perfil_id = ? ORDER BY ts DESC, id DESC LIMIT 20',
        ).all(clave).map((a) => ({
          ts: a.ts,
          actor: a.actor_upn,
          accion: a.accion,
          detalle: a.detalle ? JSON.parse(a.detalle) : null,
        }));
        return { perfil, auditoria };
      });
    },

    async crear(valor, actor) {
      const id = crypto.randomUUID();
      try {
        await bd.transaccion((db) => {
          db.prepare(
            `INSERT INTO carta_perfil (id, ${CAMPOS_PERFIL.join(', ')}, creado_por, actualizado_por) ` +
            `VALUES (@id, ${CAMPOS_PERFIL.map((c) => `@${c}`).join(', ')}, @actor, @actor)`,
          ).run({ ...parametros(valor), '@id': id, '@actor': actor.oid });
          auditar(db, { actor, accion: 'crear', perfilId: id });
        });
      } catch (err) {
        if (esDuplicadoSqlite(err)) throw new CorreoDuplicado();
        throw err;
      }
      return this.obtenerAdmin(id);
    },

    async actualizar(id, valor, actor) {
      const antes = await this.obtenerAdmin(id);
      if (!antes) return null;
      const cambiados = CAMPOS_PERFIL.filter((c) => {
        const previo = c in antes.perfil ? antes.perfil[c] : antes.perfil.redes[c];
        return (previo ?? null) !== (valor[c] ?? null);
      });
      try {
        await bd.transaccion((db) => {
          db.prepare(
            `UPDATE carta_perfil SET ${CAMPOS_PERFIL.map((c) => `${c} = @${c}`).join(', ')}, ` +
            "actualizado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), actualizado_por = @actor WHERE id = @id",
          ).run({ ...parametros(valor), '@id': antes.perfil.id, '@actor': actor.oid });
          auditar(db, { actor, accion: 'editar', perfilId: antes.perfil.id, detalle: { campos: cambiados } });
        });
      } catch (err) {
        if (esDuplicadoSqlite(err)) throw new CorreoDuplicado();
        throw err;
      }
      return this.obtenerAdmin(id);
    },

    async cambiarEstado(id, activo, actor) {
      const clave = String(id).toLowerCase();
      return bd.transaccion((db) => {
        if (!existe(db, clave)) return null;
        db.prepare(
          "UPDATE carta_perfil SET activo = @activo, actualizado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), actualizado_por = @actor WHERE id = @id",
        ).run({ '@activo': activo ? 1 : 0, '@actor': actor.oid, '@id': clave });
        auditar(db, { actor, accion: activo ? 'activar' : 'desactivar', perfilId: clave, detalle: { activo } });
        return { id: clave, activo };
      });
    },

    async guardarFoto(id, foto, actor) {
      const clave = String(id).toLowerCase();
      return bd.transaccion((db) => {
        if (!existe(db, clave)) return null;
        db.prepare(
          'INSERT INTO carta_foto (perfil_id, tipo, ancho, alto, bytes, sha256, contenido, actualizado_por) ' +
          'VALUES (@id, @tipo, @ancho, @alto, @bytes, @sha256, @contenido, @actor) ' +
          'ON CONFLICT (perfil_id) DO UPDATE SET tipo = excluded.tipo, ancho = excluded.ancho, alto = excluded.alto, ' +
          "bytes = excluded.bytes, sha256 = excluded.sha256, contenido = excluded.contenido, " +
          "actualizado_en = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), actualizado_por = excluded.actualizado_por",
        ).run({
          '@id': clave, '@tipo': foto.tipo, '@ancho': foto.ancho, '@alto': foto.alto, '@bytes': foto.bytes.length,
          '@sha256': foto.sha256, '@contenido': new Uint8Array(foto.bytes), '@actor': actor.oid,
        });
        auditar(db, { actor, accion: 'foto_subir', perfilId: clave, detalle: { bytes: foto.bytes.length } });
        return { etag: foto.sha256, ancho: foto.ancho, alto: foto.alto, bytes: foto.bytes.length };
      });
    },

    async quitarFoto(id, actor) {
      const clave = String(id).toLowerCase();
      return bd.transaccion((db) => {
        if (!existe(db, clave)) return null;
        const r = db.prepare('DELETE FROM carta_foto WHERE perfil_id = ?').run(clave);
        if (r.changes) auditar(db, { actor, accion: 'foto_quitar', perfilId: clave });
        return r.changes > 0;
      });
    },
  };
}
