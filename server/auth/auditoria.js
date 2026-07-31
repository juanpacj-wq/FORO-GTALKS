/**
 * Registro de acceso quién entró al foro y cuándo.
 *
 * Es un dato personal, y por eso se separa en dos flujos con propósitos distintos:
 *
 *   1. **Operación** (stdout → journald): línea seudónima, solo `oid`. Sirve para diagnosticar
 *      («¿alguien está probando cuentas?») sin dejar correos corporativos regados por los logs
 *      del sistema, que los lee cualquiera con acceso al servidor.
 *   2. **Asistencia** (AUDIT_LOG_PATH → JSONL): el registro con UPN, que es el que Comunicaciones
 *      necesita. Vive en un archivo aparte con permisos propios, rotación por logrotate y un
 *      plazo de borrado definido en docs/OPERACION.md.
 *
 * Si `AUDIT_LOG_PATH` no está configurado, solo se emite el flujo de operación: el registro de
 * asistencia es una decisión explícita de despliegue, no algo que aparece por defecto.
 *
 * NUNCA se registran tokens (ni `code`, ni id/access/refresh), ni el `state`, ni el verifier PKCE.
 */
import fs from 'node:fs';

const RUTA = process.env.AUDIT_LOG_PATH || '';

let flujo = null;
if (RUTA) {
  try {
    flujo = fs.createWriteStream(RUTA, { flags: 'a', mode: 0o640 });
    flujo.on('error', (err) => {
      console.error('[auditoria] no se pudo escribir el registro de acceso:', err.message);
      flujo = null;
    });
  } catch (err) {
    console.error('[auditoria] no se pudo abrir', RUTA, '—', err.message);
  }
}

/**
 * @param {object} evento
 * @param {'ok'|'no_asignado'|'revocada'|'revalidacion_fallida'} evento.resultado
 * @param {string} [evento.oid]   identificador opaco del usuario en el tenant
 * @param {string} [evento.upn]   correo corporativo solo va al registro de asistencia
 * @param {string[]} [evento.roles]
 */
export function registrarAcceso({ resultado, oid = '', upn = '', roles = [] }) {
  const ts = new Date().toISOString();

  // Operación: seudónimo, sin correo.
  console.log(`[acceso] ${resultado} oid=${oid || '(sin oid)'} roles=[${roles.join(', ')}]`);

  // Asistencia: el registro con nombre, solo si se configuró destino.
  if (flujo) {
    flujo.write(JSON.stringify({ ts, resultado, oid, upn, roles }) + '\n');
  }
}
