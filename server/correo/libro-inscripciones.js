/**
 * El libro de inscripciones: la memoria de a quién ya se le escribió.
 *
 * Es la pieza que hace que el correo salga UNA vez y solo una. Microsoft Graph no tiene señal
 * fiable de «primer inicio de sesión» —los sign-in logs piden Entra ID P1, no son inmediatos y
 * exigen `AuditLog.Read.All`—, así que el estado es nuestro.
 *
 * ── Tres decisiones que no son obvias ────────────────────────────────────────
 *
 * 1. **La clave es el `oid`, no el correo.** El `oid` es inmutable dentro del tenant; un UPN
 *    cambia (corrección de alias, matrimonio) y partiría el histórico de una persona en dos,
 *    con un segundo correo como resultado.
 *
 * 2. **Esto es ESTADO, no un log.** Vive en `/var/lib/gtalks/`, nunca en `/var/log/gtalks/`.
 *    `deploy/logrotate/gtalks` usa `copytruncate`: si este archivo rotara, tras el siguiente
 *    reinicio el proceso arrancaría creyendo que nadie se inscribió y VOLVERÍA A ESCRIBIRLE A
 *    TODO EL MUNDO. Un archivo que rota no puede ser la memoria de la idempotencia.
 *
 * 3. **`reservar` es SÍNCRONA a propósito.** El bucle de eventos de Node es de un solo hilo, así
 *    que entre el `has` y el `set` no puede colarse otra ejecución: dos pestañas iniciando sesión
 *    a la vez no pueden reservar las dos. Un `await` en medio abriría exactamente ese hueco. La
 *    escritura va con `O_APPEND`, que en Linux es atómica para líneas de menos de 4 KB.
 *
 * NO se guarda la dirección de correo: para no repetir un envío basta el seudónimo, y quién
 * recibió qué ya lo responden el `message trace` de Exchange (que es el registro autoritativo) y
 * `acceso.log`, que correlaciona `oid` ↔ UPN con su plazo de borrado documentado. Un dato
 * personal menos que custodiar, sin perder ninguna respuesta que una auditoría pueda pedir.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Estados terminales que `resolver` acepta. `reservado` lo pone solo `reservar`. */
export const ESTADOS = ['reservado', 'enviado', 'fallido', 'simulado'];

/**
 * Abre (o crea) un libro sobre `ruta`. Es una fábrica y no un módulo con estado global para que
 * las pruebas puedan trabajar sobre un archivo temporal sin tocar el de producción.
 *
 * @param {string} ruta  archivo JSONL. Su directorio se crea si no existe.
 */
export function crearLibro(ruta) {
  /** @type {Map<string, {estado: string, ts: string}>} última transición por `oid`. */
  const estados = new Map();
  let cargado = false;

  function asegurarDirectorio() {
    const dir = path.dirname(path.resolve(ruta));
    fs.mkdirSync(dir, { recursive: true });
  }

  function anotar(registro) {
    const linea = JSON.stringify(registro) + '\n';
    // mode solo aplica si el archivo no existía: 0640, igual que el registro de acceso.
    fs.appendFileSync(ruta, linea, { mode: 0o640 });
  }

  /**
   * Lee el archivo y reconstruye el estado. Una línea corrupta se salta con un aviso: un byte
   * roto al final del archivo (corte de luz a mitad de escritura) no puede impedir el arranque
   * del sitio, y el efecto de saltarla es a lo sumo un correo repetido, nunca uno perdido.
   */
  function cargar() {
    asegurarDirectorio();
    estados.clear();
    let crudo = '';
    try {
      crudo = fs.readFileSync(ruta, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cargado = true;
      return 0; // primera vez: libro vacío, no es un error
    }

    let malas = 0;
    for (const linea of crudo.split('\n')) {
      if (!linea.trim()) continue;
      try {
        const r = JSON.parse(linea);
        if (r?.oid) estados.set(r.oid, { estado: r.estado, ts: r.ts });
      } catch {
        malas++;
      }
    }
    if (malas) console.warn(`[inscripcion] ${malas} línea(s) ilegibles en ${ruta} (se ignoran)`);
    cargado = true;
    return estados.size;
  }

  /** Última transición conocida de `oid`, o `null` si nunca se le escribió. */
  function estado(oid) {
    return estados.get(oid) || null;
  }

  /**
   * Comprobación y marca ATÓMICAS. `true` significa «te toca a ti mandarle el correo».
   *
   * Vale también como cerrojo de un envío en curso: mientras el estado sea `reservado`, un
   * segundo inicio de sesión no vuelve a entrar.
   */
  function reservar(oid) {
    if (!cargado) throw new Error('libro-inscripciones: hay que llamar a cargar() antes de reservar()');
    if (!oid) return false;
    if (estados.has(oid)) return false;

    const ts = new Date().toISOString();
    estados.set(oid, { estado: 'reservado', ts });
    try {
      anotar({ ts, oid, estado: 'reservado' });
    } catch (err) {
      // Si no se pudo escribir, la reserva no existe: se deshace en memoria para no dejar a la
      // persona marcada como inscrita en un libro que no la tiene. Sin correo, pero recuperable
      // en el siguiente inicio de sesión.
      estados.delete(oid);
      console.error(`[inscripcion] no se pudo escribir la reserva en ${ruta}: ${err.message}`);
      return false;
    }
    return true;
  }

  /** Desenlace de un envío. `meta` va tal cual a la línea (peticion, http, motivo). */
  function resolver(oid, nuevoEstado, meta = {}) {
    if (!ESTADOS.includes(nuevoEstado)) throw new Error(`estado desconocido: ${nuevoEstado}`);
    const ts = new Date().toISOString();
    estados.set(oid, { estado: nuevoEstado, ts });
    try {
      anotar({ ts, oid, estado: nuevoEstado, ...meta });
    } catch (err) {
      console.error(`[inscripcion] no se pudo anotar «${nuevoEstado}» en ${ruta}: ${err.message}`);
    }
  }

  /**
   * Los `oid` que se quedaron en `reservado`: un reinicio entre la reserva y el envío deja uno
   * así, y esa persona no recibe correo ni se reintenta sola (reintentar automáticamente puede
   * duplicar, que es justo el fallo que este módulo existe para evitar). Se revisan a mano.
   */
  function pendientes() {
    return [...estados.entries()].filter(([, v]) => v.estado === 'reservado').map(([oid]) => oid);
  }

  /** Conteo por estado, para la línea de arranque y el diagnóstico. */
  function resumen() {
    const r = {};
    for (const { estado: e } of estados.values()) r[e] = (r[e] || 0) + 1;
    return r;
  }

  return { ruta, cargar, estado, reservar, resolver, pendientes, resumen };
}
