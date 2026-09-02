/**
 * El directorio de Entra como origen del prellenado de una carta.
 *
 * Al crear una carta, el panel busca a la persona en el directorio del tenant (Microsoft Graph,
 * `/users`) y propone nombres, apellidos, cargo, área, correo y teléfonos. Es una PROPUESTA:
 * lo que se guarda es lo que la persona con el rol deje escrito en el formulario, que sigue
 * pasando por validacion.js como si se hubiera tecleado.
 *
 * Decisiones:
 * - Va con el token de APLICACIÓN de la misma App Registration del login (`User.Read.All`, ya
 *   concedido: ver memoria del proyecto), reutilizando `crearProveedorDeToken` del correo. La
 *   ruta vive detrás de `soloRol`: solo quien administra las cartas puede consultar el directorio.
 * - `$filter=startswith(...)` sobre displayName, givenName, surname y mail, y NUNCA `$search`:
 *   `$search` puntúa por relevancia y devuelve «el mejor», que es justo lo que no se quiere
 *   cuando quien busca tiene que ELEGIR (`scripts/personas-resolver.mjs` explica el porqué).
 * - Solo cuentas habilitadas y con correo: una cuenta deshabilitada no tiene carta.
 * - El texto de búsqueda se acota (2..60 caracteres, letras, dígitos, espacio, `@ . - '`) y la
 *   comilla simple se duplica, que es el único escape que OData admite. Nada más entra al filtro.
 * - Los teléfonos de Graph son texto libre: se normalizan a E.164 con la MISMA función de
 *   validacion.js, y si no se reconocen viajan en blanco (mejor vacío que un dato que el
 *   servidor va a rechazar).
 * - Graph caído o lento no tumba nada: el panel recibe un 503 y la carta se escribe a mano.
 */
import { normalizarTelefono } from './validacion.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const CAMPOS = 'id,displayName,givenName,surname,jobTitle,department,mail,userPrincipalName,mobilePhone,businessPhones,accountEnabled';
const TOPE = 8;
const TIMEOUT_MS = 6000;

export class DirectorioNoDisponible extends Error {
  constructor(codigo) {
    super(`El directorio no está disponible (${codigo})`);
    this.name = 'DirectorioNoDisponible';
    this.codigo = codigo;
  }
}

/** Lo que se admite como texto de búsqueda. Devuelve null si no vale. */
export function normalizarBusqueda(q) {
  const s = String(q ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 60) return null;
  if (!/^[\p{L}\p{M}\p{N}@.' -]+$/u.test(s)) return null;
  return s;
}

/** El `$filter` de OData para un texto ya normalizado. La comilla simple se duplica. */
export function filtroDe(q) {
  const v = q.replace(/'/g, "''");
  const sobre = ['displayName', 'givenName', 'surname', 'mail', 'userPrincipalName'];
  return `(${sobre.map((c) => `startswith(${c},'${v}')`).join(' or ')}) and accountEnabled eq true`;
}

/** Nombres y apellidos: los campos de Graph si vienen; si no, el displayName partido. */
export function partirNombre(u) {
  const nombres = String(u.givenName || '').trim();
  const apellidos = String(u.surname || '').trim();
  if (nombres && apellidos) return { nombres, apellidos };
  const partes = String(u.displayName || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) {
    // Convención del directorio de GECELCA: «Nombres Apellidos», con dos apellidos al final.
    const corte = partes.length >= 4 ? partes.length - 2 : partes.length - 1;
    return { nombres: nombres || partes.slice(0, corte).join(' '), apellidos: apellidos || partes.slice(corte).join(' ') };
  }
  return { nombres: nombres || partes[0] || '', apellidos };
}

/** De un usuario de Graph a la propuesta que rellena el formulario. */
export function aPropuesta(u) {
  const { nombres, apellidos } = partirNombre(u);
  const correo = String(u.mail || u.userPrincipalName || '').trim().toLowerCase();
  const fijo = Array.isArray(u.businessPhones) ? u.businessPhones.find((t) => normalizarTelefono(t)) : null;
  const movil = u.mobilePhone ? normalizarTelefono(u.mobilePhone) : null;
  return {
    id: String(u.id || ''),
    nombre: String(u.displayName || `${nombres} ${apellidos}`).trim(),
    nombres,
    apellidos,
    cargo: String(u.jobTitle || '').trim(),
    area: String(u.department || '').trim(),
    correo,
    telefono: (fijo && normalizarTelefono(fijo)) || movil || '',
    whatsapp: movil || '',
  };
}

/**
 * @param {object} dep
 * @param {Function} dep.obtenerToken  () => Promise<string>
 * @param {string}   [dep.baseUrl]     solo para pruebas
 * @param {Function} [dep.fetchImpl]   solo para pruebas
 */
export function crearDirectorio({ obtenerToken, baseUrl = GRAPH, fetchImpl = fetch }) {
  return {
    /** @returns {Promise<Array>} hasta TOPE propuestas, ordenadas por nombre. */
    async buscar(q) {
      const texto = normalizarBusqueda(q);
      if (!texto) return [];
      let token;
      try {
        token = await obtenerToken();
      } catch (err) {
        throw new DirectorioNoDisponible(err.message === 'graph_sin_token' ? 'sin_token' : 'token');
      }
      // Sin `$orderby`: Graph responde 400 «Sorting not supported for current query» cuando el
      // filtro lleva `startswith` sobre varias propiedades (comprobado el 2026-09-02). El orden
      // por nombre se hace aquí abajo, sobre los ocho que llegan.
      const url = `${baseUrl}/users?$filter=${encodeURIComponent(filtroDe(texto))}&$select=${CAMPOS}&$top=${TOPE}`;
      let r;
      try {
        r = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ConsistencyLevel: 'eventual' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new DirectorioNoDisponible(err.name === 'TimeoutError' ? 'timeout' : 'red');
      }
      if (!r.ok) {
        // El cuerpo de Graph puede traer el nombre del tenant y el id de la petición: no se
        // registra entero. El código basta para diagnosticar (403 = falta User.Read.All).
        console.error(`[carta/directorio] Graph respondió ${r.status}`);
        throw new DirectorioNoDisponible(`graph_${r.status}`);
      }
      const datos = await r.json().catch(() => ({}));
      const usuarios = Array.isArray(datos.value) ? datos.value : [];
      return usuarios
        .filter((u) => u && u.accountEnabled !== false && (u.mail || u.userPrincipalName))
        .map(aPropuesta)
        .filter((p) => p.correo)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },
  };
}
