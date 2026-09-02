/**
 * Las migraciones del esquema `carta`: leerlas, compararlas con la BD y aplicarlas.
 *
 * El SERVIDOR solo llama a `estadoMigraciones` al arrancar y aborta si hay pendientes o si el
 * sha256 de una aplicada ya no coincide con el archivo. Aplicarlas es un acto explícito del
 * operador con `scripts/carta-migrar.mjs`, nunca automático: el despliegue no puede alterar el
 * esquema de una base de datos compartida sin que alguien lo haya decidido.
 *
 * Cada archivo `NNN-slug.sql` se parte por `GO` (una línea sola, como en SSMS) y cada lote va
 * con `request.batch()`, que es lo que admite `CREATE SCHEMA` y compañía. Todo el archivo se
 * aplica dentro de UNA transacción y su fila en `carta.migracion` se escribe en la misma:
 * o queda entero y anotado, o no queda nada.
 *
 * Bootstrapping: sin esquema o sin `carta.migracion`, hay cero aplicadas. El 001 crea ambas.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from './bd.js';

const DIR_SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sql');
const NOMBRE = /^(\d{3})-([a-z0-9-]+)\.sql$/;

/**
 * Los archivos de `sql/`, ordenados, con su sha256. Exige numeración contigua desde 001:
 * un hueco es casi siempre un archivo que no llegó al paquete.
 */
export function listarMigraciones(dir = DIR_SQL) {
  const archivos = fs.readdirSync(dir).filter((n) => NOMBRE.test(n)).sort();
  const lista = archivos.map((nombre, i) => {
    const [, num, slug] = nombre.match(NOMBRE);
    const numero = Number(num);
    if (numero !== i + 1) {
      throw new Error(`Las migraciones no van contiguas: se esperaba ${String(i + 1).padStart(3, '0')} y hay ${nombre}`);
    }
    const contenido = fs.readFileSync(path.join(dir, nombre), 'utf8').replace(/\r\n/g, '\n');
    return {
      numero,
      nombre: `${num}-${slug}`,
      archivo: nombre,
      sha256: crypto.createHash('sha256').update(contenido).digest('hex'),
      lotes: partirPorGo(contenido),
    };
  });
  if (!lista.length) throw new Error(`No hay migraciones en ${dir}`);
  return lista;
}

/** Parte un archivo por las líneas que son exactamente `GO` (sin distinguir mayúsculas). */
export function partirPorGo(texto) {
  return texto
    .split(/^\s*GO\s*$/im)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Lo que la BD recuerda: `Map<numero, {nombre, sha256, aplicada_en}>`. Vacío si no hay tabla. */
export async function leerAplicadas(pool) {
  const existe = await pool.request().query("SELECT OBJECT_ID('carta.migracion') AS id");
  if (!existe.recordset[0]?.id) return new Map();
  const r = await pool.request().query(
    'SELECT numero, nombre, sha256, aplicada_en FROM carta.migracion ORDER BY numero',
  );
  return new Map(r.recordset.map((f) => [f.numero, f]));
}

/**
 * Cruza los archivos con la BD.
 * @returns {{ estado: 'al_dia'|'pendientes'|'sha_distinto', filas: Array, pendientes: Array }}
 */
export async function estadoMigraciones(pool, lista = listarMigraciones()) {
  const aplicadas = await leerAplicadas(pool);
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

/**
 * Aplica las pendientes EN ORDEN, cada una en su transacción. Se niega a tocar nada si alguna
 * aplicada tiene otro sha: editar una migración ya aplicada es un error, no una actualización.
 * Solo la llama scripts/carta-migrar.mjs.
 */
export async function aplicarPendientes(pool, { registrar = () => {} } = {}) {
  const { estado, pendientes, filas } = await estadoMigraciones(pool);
  if (estado === 'sha_distinto') {
    const mal = filas.filter((f) => f.situacion === 'sha_distinto').map((f) => f.nombre);
    throw new Error(
      `Migración(es) ya aplicada(s) con otro contenido: ${mal.join(', ')}. ` +
      'No se edita una migración aplicada: escribe la siguiente.',
    );
  }
  for (const m of pendientes) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const lote of m.lotes) {
        await new sql.Request(tx).batch(lote);
      }
      await new sql.Request(tx)
        .input('numero', sql.Int, m.numero)
        .input('nombre', sql.NVarChar(120), m.nombre)
        .input('sha256', sql.Char(64), m.sha256)
        .query('INSERT INTO carta.migracion (numero, nombre, sha256) VALUES (@numero, @nombre, @sha256)');
      await tx.commit();
      registrar(m);
    } catch (err) {
      try { await tx.rollback(); } catch { /* ya deshecha */ }
      throw new Error(`Falló ${m.archivo}: ${err.message}`);
    }
  }
  return pendientes.length;
}
