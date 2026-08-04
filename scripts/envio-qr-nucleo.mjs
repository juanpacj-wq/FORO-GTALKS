// El núcleo del envío del QR: a quién se le escribe, si toca reintentar, y el bucle que compone y
// manda. Vive aparte de `envio-qr.mjs` para que se pueda EJERCER con un Graph falso, sin red, sin
// credenciales y sin navegador — la misma inyección de dependencias que hace `graph-mailer.js` y
// por la misma razón: lo que no se puede probar, no se sabe si funciona.
//
// La CLI (`envio-qr.mjs`) cablea aquí las implementaciones de verdad; el arnés
// (`envio-qr-test.mjs`) cablea las falsas.

import { usuarioDeCorreo } from '../src/data/escarapela.ts'
import { norm } from './envio-qr-comun.mjs'

/**
 * A quién se le escribe, y con qué alias viaja su código.
 *
 * En modo `lista` la fuente única es la CONFIGURACIÓN: tanto la dirección de destino como el
 * alias del QR salen de la MISMA cadena del entorno. Sin esto, la lista blanca controlaría a
 * quién se envía pero NO qué código lleva dentro, y en unas pruebas a cuatro buzones un cruce
 * pasaría todas las comprobaciones sin que nadie lo notara. El registro de Graph solo aporta el
 * `oid` (la clave del libro) y el nombre.
 *
 * En modo `todos` la fuente única pasa a ser la audiencia CONGELADA, y por eso se congela.
 */
export function resolverDestinos({ modo, destinatarios = [], audiencia = [] }) {
  if (modo === 'todos') {
    const limpios = audiencia.filter((p) => !p.anomalias?.length)
    return {
      destinos: limpios.map((p) => ({ oid: p.oid, nombre: p.nombre, correo: p.correo, alias: p.alias })),
      excluidos: audiencia.length - limpios.length,
    }
  }
  const destinos = []
  for (const entrada of destinatarios) {
    const p = audiencia.find(
      (x) => norm(x.correo) === entrada || norm(x.mail) === entrada || norm(x.upn) === entrada,
    )
    if (!p) {
      return { error: `«${entrada}» está en la lista de destinatarios pero no aparece en la audiencia congelada.` }
    }
    destinos.push({ oid: p.oid, nombre: p.nombre, correo: entrada, alias: usuarioDeCorreo(entrada) })
  }
  return { destinos, excluidos: 0 }
}

/**
 * Si a esta persona hay que escribirle en esta corrida.
 *
 * `enviado` no se repite jamás. Un `fallido` por **timeout** y un `reservado` huérfano son estados
 * DESCONOCIDOS —el mensaje pudo haberse entregado— y solo se tocan con `--forzar`: la respuesta
 * está en la carpeta Enviados o en el message trace de Exchange, no en repetir el envío.
 */
export function decidir({ previo, motivo = '', reintentar = false, forzar = false }) {
  if (!previo) return { enviar: true, nuevo: true }
  switch (previo.estado) {
    case 'enviado':
      return { enviar: false, razon: 'ya enviado' }
    case 'simulado':
      return { enviar: true, nuevo: false }
    case 'fallido':
      if (motivo === 'timeout' && !forzar)
        return { enviar: false, razon: 'falló por timeout: pudo haberse entregado (usa --forzar)' }
      return reintentar
        ? { enviar: true, nuevo: false }
        : { enviar: false, razon: 'falló antes (usa --reintentar)' }
    case 'reservado':
      return forzar
        ? { enviar: true, nuevo: false }
        : { enviar: false, razon: 'quedó reservado: estado desconocido (usa --forzar)' }
    default:
      return { enviar: false, razon: previo.estado }
  }
}

/** Lo que lanza el bucle cuando detecta un código cruzado o ilegible. */
export class EnvioAbortado extends Error {}

/**
 * El bucle. SECUENCIAL a propósito: `for…of` + `await`, nunca `Promise.all`. La cola de
 * `graph-mailer` serializa el HTTP, pero no la composición del mensaje, y es en la composición
 * donde se cruzarían dos códigos.
 *
 * @param dep.generarQr        (correo) => {url, png, leido}   nace en cada llamada, sin caché
 * @param dep.componerMensaje  (qrPng)  => {asunto, html, adjuntos}
 * @param dep.enviar           (mensaje) => {ok, http, motivo, peticion}
 * @param dep.idManana         el ID de capacitación que la URL DEBE llevar
 * @throws {EnvioAbortado} ante un QR que no dice lo que debe. No sigue con los siguientes.
 */
export async function procesar({
  destinos,
  libro,
  motivos = new Map(),
  generarQr,
  componerMensaje,
  enviar,
  guardarPng = () => {},
  idManana,
  modo,
  confirmar,
  maximo = Infinity,
  reintentar = false,
  forzar = false,
  ritmoMs = 0,
  dormir = async () => {},
  log = () => {},
}) {
  const resumen = { generados: 0, enviados: 0, simulados: 0, fallidos: 0, omitidos: 0 }
  let hechos = 0

  for (const persona of destinos) {
    const { oid, alias, correo, nombre } = persona
    const decision = decidir({
      previo: libro.estado(oid),
      motivo: motivos.get(oid) || '',
      reintentar,
      forzar,
    })
    if (!decision.enviar) {
      log(`  ·  ${alias.padEnd(16)} omitido — ${decision.razon}`)
      resumen.omitidos++
      continue
    }
    if (hechos >= maximo) {
      log(`  ·  ${alias.padEnd(16)} omitido — se alcanzó el tope de ${maximo}`)
      resumen.omitidos++
      continue
    }

    // 1. El código, y la prueba de que dice lo que tiene que decir. Las tres comprobaciones
    //    ABORTAN el proceso entero en vez de saltar a la siguiente persona: un cruce detectado
    //    significa que el mecanismo está roto, y seguir sería apostar a que solo lo estaba en
    //    esta vuelta.
    const qr = await generarQr(correo)
    if (!qr.url.includes(`ID_CAPACITACION=${idManana}`)) {
      throw new EnvioAbortado(`El QR de ${alias} no lleva el ID de la MAÑANA. No se envió nada más.`)
    }
    if (!qr.url.includes(`USUARIO=${encodeURIComponent(alias)}&`)) {
      throw new EnvioAbortado(`El QR de ${alias} no lleva su propio usuario. No se envió nada más.`)
    }
    if (qr.leido !== qr.url) {
      throw new EnvioAbortado(
        `En ${alias}: el PNG generado no se decodifica como su propia URL.\n` +
        `  esperado: ${qr.url}\n  leído:    ${qr.leido || '(ilegible)'}\n` +
        'Un cruce o un código ilegible significan que el mecanismo está roto.',
      )
    }
    guardarPng(alias, qr.png)
    resumen.generados++

    if (!confirmar) {
      log(`  ok  ${alias.padEnd(16)} QR generado y verificado (ensayo: no se envía)`)
      hechos++
      continue
    }

    // 2. La reserva. La primera vez con `reservar()`, que es síncrona; un reintento explícito
    //    reabre con `resolver()`, que deja su propia línea y no borra el histórico.
    if (decision.nuevo) {
      if (!libro.reservar(oid)) {
        log(`  ·  ${alias.padEnd(16)} omitido — el libro rechazó la reserva`)
        resumen.omitidos++
        continue
      }
    } else {
      libro.resolver(oid, 'reservado', { reintento: true })
    }

    // 3. El envío. Mensaje NUEVO en cada vuelta: nada se reutiliza entre personas.
    if (modo === 'simulacro') {
      libro.resolver(oid, 'simulado')
      log(`  ok  ${alias.padEnd(16)} simulado (sin red)`)
      resumen.simulados++
    } else {
      const mensaje = componerMensaje(qr.png)
      const r = await enviar({ para: correo, ...mensaje })
      if (r.ok) {
        libro.resolver(oid, 'enviado', { peticion: r.peticion, http: r.http })
        log(`  ok  ${alias.padEnd(16)} enviado a ${correo}`)
        resumen.enviados++
      } else {
        libro.resolver(oid, 'fallido', { peticion: r.peticion, http: r.http, motivo: r.motivo })
        log(` FALLA ${alias.padEnd(16)} ${r.motivo || r.http} (${nombre})`)
        resumen.fallidos++
      }
    }

    hechos++
    if (ritmoMs) await dormir(ritmoMs)
  }

  return resumen
}
