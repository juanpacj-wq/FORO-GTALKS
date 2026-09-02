/**
 * El acceso a datos de la carta: SQL con parámetros tipados, y nada más.
 *
 * Reglas de la casa:
 *
 * - Ningún texto del cliente entra en una consulta salvo como parámetro tipado. Las consultas
 *   son constantes.
 * - mssql devuelve los UNIQUEIDENTIFIER en MAYÚSCULAS; aquí se normalizan a minúsculas al
 *   salir, para que la URL, el QR y el ETag hablen todos del mismo id.
 * - Cada mutador es UNA transacción con su fila de `carta.auditoria`: no hay forma de cambiar
 *   un perfil sin dejar rastro, y el rastro dice QUÉ campos, nunca sus valores.
 * - La foto se lee en DOS consultas: primero el sha (para el 304), y solo si hace falta los
 *   bytes. Un `If-None-Match` que acierta no mueve el blob.
 * - El público solo ve perfiles ACTIVOS. `obtenerPublico` de un inactivo devuelve null: la
 *   tarjeta retirada es indistinguible de la que nunca existió.
 */
import { sql } from './bd.js';

export class CorreoDuplicado extends Error {
  constructor() {
    super('Ya existe una carta con ese correo');
    this.name = 'CorreoDuplicado';
  }
}

export const REDES_COLUMNAS = ['linkedin', 'instagram', 'x', 'facebook', 'youtube', 'tiktok', 'sitio_web'];
const CAMPOS_PERFIL = [
  'nombres', 'apellidos', 'cargo', 'area', 'correo', 'telefono', 'whatsapp', ...REDES_COLUMNAS,
];

const TIPO = {
  nombres: sql.NVarChar(80),
  apellidos: sql.NVarChar(80),
  cargo: sql.NVarChar(120),
  area: sql.NVarChar(120),
  correo: sql.NVarChar(254),
  telefono: sql.VarChar(20),
  whatsapp: sql.VarChar(20),
  linkedin: sql.NVarChar(200),
  instagram: sql.NVarChar(200),
  x: sql.NVarChar(200),
  facebook: sql.NVarChar(200),
  youtube: sql.NVarChar(200),
  tiktok: sql.NVarChar(200),
  sitio_web: sql.NVarChar(200),
};

const COLUMNAS_PERFIL = `p.id, p.${CAMPOS_PERFIL.join(', p.')}, p.activo, p.creado_en, p.actualizado_en`;
const CON_FOTO = 'f.sha256 AS foto_sha256, f.ancho AS foto_ancho, f.alto AS foto_alto, f.bytes AS foto_bytes';

const esDuplicado = (err) => err?.number === 2627 || err?.number === 2601;
const bajo = (id) => String(id).toLowerCase();

function redesDe(fila) {
  const redes = {};
  for (const r of REDES_COLUMNAS) redes[r] = fila[r] ?? null;
  return redes;
}

function aPublico(fila) {
  if (!fila) return null;
  return {
    id: bajo(fila.id),
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
    creado_en: fila.creado_en instanceof Date ? fila.creado_en.toISOString() : fila.creado_en,
    actualizado_en: fila.actualizado_en instanceof Date ? fila.actualizado_en.toISOString() : fila.actualizado_en,
    foto: fila.foto_sha256
      ? { etag: fila.foto_sha256, ancho: fila.foto_ancho, alto: fila.foto_alto, bytes: fila.foto_bytes }
      : null,
  };
}

/**
 * @param bd  lo que devuelve `crearBd()`
 */
export function crearRepositorio(bd) {
  /** Escribe la fila de auditoría dentro de la transacción. `detalle` es un objeto sin valores. */
  async function auditar(tx, { actor, accion, perfilId = null, detalle = null }) {
    await new sql.Request(tx)
      .input('actor_oid', sql.NVarChar(64), actor.oid)
      .input('actor_upn', sql.NVarChar(254), actor.upn)
      .input('accion', sql.VarChar(20), accion)
      .input('perfil_id', sql.UniqueIdentifier, perfilId)
      .input('detalle', sql.NVarChar(sql.MAX), detalle ? JSON.stringify(detalle) : null)
      .input('ip', sql.VarChar(45), actor.ip ?? null)
      .query(
        'INSERT INTO carta.auditoria (actor_oid, actor_upn, accion, perfil_id, detalle, ip) ' +
        'VALUES (@actor_oid, @actor_upn, @accion, @perfil_id, @detalle, @ip)',
      );
  }

  function ponerCampos(req, valor) {
    for (const c of CAMPOS_PERFIL) req.input(c, TIPO[c], valor[c] ?? null);
    return req;
  }

  return {
    /** Solo activos, solo lo que la tarjeta pinta. */
    async obtenerPublico(id) {
      const r = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query(
          `SELECT ${COLUMNAS_PERFIL}, ${CON_FOTO} FROM carta.perfil p ` +
          'LEFT JOIN carta.foto f ON f.perfil_id = p.id WHERE p.id = @id AND p.activo = 1',
        ),
      );
      return aPublico(r.recordset[0]);
    },

    /** El sha de la foto de un perfil ACTIVO, o null. Para el 304 sin mover el blob. */
    async leerFotoSha(id) {
      const r = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query(
          'SELECT f.sha256 FROM carta.foto f JOIN carta.perfil p ON p.id = f.perfil_id ' +
          'WHERE f.perfil_id = @id AND p.activo = 1',
        ),
      );
      return r.recordset[0]?.sha256 ?? null;
    },

    async leerFoto(id) {
      const r = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query(
          'SELECT f.tipo, f.sha256, f.bytes, f.contenido FROM carta.foto f ' +
          'JOIN carta.perfil p ON p.id = f.perfil_id WHERE f.perfil_id = @id AND p.activo = 1',
        ),
      );
      const f = r.recordset[0];
      return f ? { tipo: f.tipo, sha256: f.sha256, bytes: f.bytes, contenido: f.contenido } : null;
    },

    /** Listado del panel. `estado`: 'activos' | 'inactivos' | 'todos'. Tope 500. */
    async listar({ estado = 'activos' } = {}) {
      const filtro = estado === 'todos' ? '' : `WHERE p.activo = ${estado === 'activos' ? 1 : 0}`;
      const r = await bd.consulta((req) =>
        req.query(
          'SELECT TOP 500 p.id, p.nombres, p.apellidos, p.cargo, p.area, p.correo, p.activo, ' +
          'p.actualizado_en, f.sha256 AS foto_sha256 FROM carta.perfil p ' +
          `LEFT JOIN carta.foto f ON f.perfil_id = p.id ${filtro} ORDER BY p.apellidos, p.nombres`,
        ),
      );
      return r.recordset.map((p) => ({
        id: bajo(p.id),
        nombre: `${p.nombres} ${p.apellidos}`,
        cargo: p.cargo,
        area: p.area ?? null,
        correo: p.correo,
        activo: Boolean(p.activo),
        foto: Boolean(p.foto_sha256),
        actualizado_en: p.actualizado_en instanceof Date ? p.actualizado_en.toISOString() : p.actualizado_en,
      }));
    },

    /** Todo, activo o no, más las últimas 20 filas de auditoría. */
    async obtenerAdmin(id) {
      const r = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query(
          `SELECT ${COLUMNAS_PERFIL}, ${CON_FOTO} FROM carta.perfil p ` +
          'LEFT JOIN carta.foto f ON f.perfil_id = p.id WHERE p.id = @id; ' +
          'SELECT TOP 20 ts, actor_upn, accion, detalle FROM carta.auditoria ' +
          'WHERE perfil_id = @id ORDER BY ts DESC, id DESC',
        ),
      );
      const perfil = aAdmin(r.recordsets[0][0]);
      if (!perfil) return null;
      const auditoria = r.recordsets[1].map((a) => ({
        ts: a.ts instanceof Date ? a.ts.toISOString() : a.ts,
        actor: a.actor_upn,
        accion: a.accion,
        detalle: a.detalle ? JSON.parse(a.detalle) : null,
      }));
      return { perfil, auditoria };
    },

    /** @throws {CorreoDuplicado} */
    async crear(valor, actor) {
      const id = crypto.randomUUID();
      try {
        await bd.transaccion(async (tx) => {
          await ponerCampos(new sql.Request(tx), valor)
            .input('id', sql.UniqueIdentifier, id)
            .input('actor', sql.NVarChar(64), actor.oid)
            .query(
              `INSERT INTO carta.perfil (id, ${CAMPOS_PERFIL.join(', ')}, creado_por, actualizado_por) ` +
              `VALUES (@id, ${CAMPOS_PERFIL.map((c) => `@${c}`).join(', ')}, @actor, @actor)`,
            );
          await auditar(tx, { actor, accion: 'crear', perfilId: id });
        });
      } catch (err) {
        if (esDuplicado(err)) throw new CorreoDuplicado();
        throw err;
      }
      return this.obtenerAdmin(id);
    },

    /** Reemplazo completo. Devuelve null si el id no existe. @throws {CorreoDuplicado} */
    async actualizar(id, valor, actor) {
      const antes = await this.obtenerAdmin(id);
      if (!antes) return null;
      const cambiados = CAMPOS_PERFIL.filter((c) => {
        const previo = c in antes.perfil ? antes.perfil[c] : antes.perfil.redes[c];
        return (previo ?? null) !== (valor[c] ?? null);
      });
      try {
        await bd.transaccion(async (tx) => {
          await ponerCampos(new sql.Request(tx), valor)
            .input('id', sql.UniqueIdentifier, id)
            .input('actor', sql.NVarChar(64), actor.oid)
            .query(
              `UPDATE carta.perfil SET ${CAMPOS_PERFIL.map((c) => `${c} = @${c}`).join(', ')}, ` +
              'actualizado_en = SYSUTCDATETIME(), actualizado_por = @actor WHERE id = @id',
            );
          await auditar(tx, { actor, accion: 'editar', perfilId: id, detalle: { campos: cambiados } });
        });
      } catch (err) {
        if (esDuplicado(err)) throw new CorreoDuplicado();
        throw err;
      }
      return this.obtenerAdmin(id);
    },

    /** Devuelve `{id, activo}` o null si no existe. */
    async cambiarEstado(id, activo, actor) {
      const existe = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query('SELECT activo FROM carta.perfil WHERE id = @id'),
      );
      if (!existe.recordset.length) return null;
      await bd.transaccion(async (tx) => {
        await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, id)
          .input('activo', sql.Bit, activo)
          .input('actor', sql.NVarChar(64), actor.oid)
          .query(
            'UPDATE carta.perfil SET activo = @activo, actualizado_en = SYSUTCDATETIME(), ' +
            'actualizado_por = @actor WHERE id = @id',
          );
        await auditar(tx, { actor, accion: activo ? 'activar' : 'desactivar', perfilId: id, detalle: { activo } });
      });
      return { id: bajo(id), activo };
    },

    /** Inserta o reemplaza. Devuelve la ficha de la foto, o null si el perfil no existe. */
    async guardarFoto(id, foto, actor) {
      const existe = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query('SELECT 1 AS uno FROM carta.perfil WHERE id = @id'),
      );
      if (!existe.recordset.length) return null;
      await bd.transaccion(async (tx) => {
        await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, id)
          .input('tipo', sql.VarChar(20), foto.tipo)
          .input('ancho', sql.SmallInt, foto.ancho)
          .input('alto', sql.SmallInt, foto.alto)
          .input('bytes', sql.Int, foto.bytes.length)
          .input('sha256', sql.Char(64), foto.sha256)
          .input('contenido', sql.VarBinary(sql.MAX), foto.bytes)
          .input('actor', sql.NVarChar(64), actor.oid)
          .query(
            'MERGE carta.foto AS f USING (SELECT @id AS perfil_id) AS s ON f.perfil_id = s.perfil_id ' +
            'WHEN MATCHED THEN UPDATE SET tipo = @tipo, ancho = @ancho, alto = @alto, bytes = @bytes, ' +
            'sha256 = @sha256, contenido = @contenido, actualizado_en = SYSUTCDATETIME(), actualizado_por = @actor ' +
            'WHEN NOT MATCHED THEN INSERT (perfil_id, tipo, ancho, alto, bytes, sha256, contenido, actualizado_por) ' +
            'VALUES (@id, @tipo, @ancho, @alto, @bytes, @sha256, @contenido, @actor);',
          );
        await auditar(tx, { actor, accion: 'foto_subir', perfilId: id, detalle: { bytes: foto.bytes.length } });
      });
      return { etag: foto.sha256, ancho: foto.ancho, alto: foto.alto, bytes: foto.bytes.length };
    },

    /** true si había foto y se quitó; false si no había; null si el perfil no existe. */
    async quitarFoto(id, actor) {
      const existe = await bd.consulta((req) =>
        req.input('id', sql.UniqueIdentifier, id).query('SELECT 1 AS uno FROM carta.perfil WHERE id = @id'),
      );
      if (!existe.recordset.length) return null;
      let borradas = 0;
      await bd.transaccion(async (tx) => {
        const r = await new sql.Request(tx)
          .input('id', sql.UniqueIdentifier, id)
          .query('DELETE FROM carta.foto WHERE perfil_id = @id');
        borradas = r.rowsAffected[0] ?? 0;
        if (borradas) await auditar(tx, { actor, accion: 'foto_quitar', perfilId: id });
      });
      return borradas > 0;
    },
  };
}

// crypto solo para randomUUID; va al final para que el lector vea primero las reglas.
import crypto from 'node:crypto';
