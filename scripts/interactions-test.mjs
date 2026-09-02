// Pruebas de interacción sobre dist/ servido por `npm run preview`.
// Sale con código 1 si algo falla.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/interactions-test.mjs   # en otra
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { ID_FIXTURE, ID_INEXISTENTE, PERFIL_PUBLICO, instalarMocks } from './fixture-carta.mjs'

const base = process.argv[2] ?? 'http://localhost:4173'

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}

// Espera a que el servidor esté listo. Sin esto, la primera corrida justo después de levantar
// `npm run preview` fallaba por arranque en frío y la segunda pasaba: un falso positivo recurrente
// que hacía dudar del código en vez del arnés.
for (let intento = 1; ; intento++) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) })
    break
  } catch {
    if (intento >= 15) throw new Error(`El servidor no respondió en ${base}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

let browser
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel })
    break
  } catch {
    /* siguiente canal */
  }
}
if (!browser) throw new Error('No hay Edge ni Chrome disponibles')

// ───────────────────────────────────────────────────────────── escritorio
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await desktop.goto(base + '/', { waitUntil: 'networkidle' })

console.log('\nAnclas y scrollspy')
check(
  'las 3 secciones existen',
  (await desktop.locator('#bienvenida, #sobre-el-foro, #agenda').count()) === 3,
)

// Qué sección marca el scrollspy. Se lee con `evaluate` y no con un locator a
// propósito: mientras el scroll suave viaja puede no haber ninguna marcada, y
// un locator sin coincidencias no devuelve «ninguna», se queda esperando hasta
// que vence su plazo y revienta.
const anclaActiva = () =>
  desktop.evaluate(
    () => document.querySelector('.gt-header__ancla[aria-current]')?.textContent?.trim() ?? null,
  )

// Espera activa, en vez de dormir una cantidad fija y mirar. Un plazo fijo tras
// un scroll suave es una apuesta sobre lo rápida que vaya la máquina: con el
// equipo cargadojusto después de un build, por ejemplo el scroll todavía no
// ha parado y el scrollspy se lee a medias. Falló así una vez de catorce, que
// es lo peor que le puede pasar a un arnés: un fallo que no se distingue de uno
// de verdad y que se «arregla» volviendo a correrlo. Si el scrollspy está roto
// de verdad, esto sigue fallandosolo que tarda el plazo entero.
async function esperarA(condicion, plazo = 6000) {
  for (const limite = Date.now() + plazo; ; ) {
    if (await condicion()) return true
    if (Date.now() > limite) return false
    await desktop.waitForTimeout(100)
  }
}

await desktop.click('.gt-header__ancla[href="#agenda"]')
check(
  'el scrollspy marca Agenda como activa',
  await esperarA(async () => (await anclaActiva()) === 'Agenda'),
  `leído: ${await anclaActiva()}`,
)

await desktop.evaluate(() => window.scrollTo(0, 0))
check(
  'al volver arriba marca Bienvenida',
  await esperarA(async () => (await anclaActiva()) === 'Bienvenida'),
  `leído: ${await anclaActiva()}`,
)

console.log('\nAgenda → perfil de ponente')
await desktop.locator('.gt-agenda__nombre').first().click()
await desktop.waitForURL('**/ponentes/**')
check('un nombre de la agenda lleva a su perfil', desktop.url().includes('/ponentes/'))
// La URL llega ANTES que el DOM: este salto va con `viewTransition`, y una
// transición de vista retiene la actualización hasta el siguiente fotograma
// para poder fotografiar el estado anterior. Así que `waitForURL` no garantiza
// que el perfil esté pintado, y contar aquí mismo puede leer todavía la home.
// Falló una vez de diecinueve por esto.
check(
  'el perfil lista intervenciones',
  await esperarA(async () => (await desktop.locator('.gt-perfil__item').count()) > 0),
)

console.log('\nCertificado')
// Las interacciones CON sesión (estados del botón, el aviso emergente, Escape) viven en
// sesion-test.mjs, que es donde se intercepta /api/me. Aquí, lo estructural: la ruta es de
// primera clase se llega desde el nav y no redirige y sin sesión solo invita a entrar.
await desktop.goto(base + '/', { waitUntil: 'networkidle' })
await desktop.click('.gt-header__enlace[href="/certificado"], nav a[href="/certificado"]')
await desktop.waitForURL('**/certificado')
check('el nav lleva a /certificado', new URL(desktop.url()).pathname === '/certificado')
check(
  'sin sesión: invita a entrar con retorno a /certificado',
  await esperarA(async () =>
    (await desktop.locator('.gt-certificado__entrar').getAttribute('href')) === '/auth/login?destino=/certificado'),
)
// La vista previa de la pieza existió hasta el 2026-08-12; el usuario la retiró y la página
// quedó en título + lead + párrafo + botón. Este check impide que vuelva sin decisión.
check('y no hay vista previa: la página anuncia y entrega, no enseña',
  (await desktop.locator('.gt-certificado__pieza').count()) === 0)

console.log('\nCarta de presentación')
// Lo estructural de la tarjeta pública. Las interacciones CON sesión (el gate del panel, el
// formulario, el PNG del QR decodificado) viven en sesion-test.mjs. Aquí: que la ruta sea de
// primera clase (un id inexistente pinta su aviso en su URL y NO redirige a `/`, al revés que
// el comodín de abajo), el plegado del QR, la copia del enlace y el `rel` de lo que sale.
{
  const carta = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await carta.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    window.__copiado = null
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t) => { window.__copiado = t } },
      configurable: true,
    })
  })
  await instalarMocks(carta, { me: null })

  await carta.goto(base + `/carta_presentacion/${ID_INEXISTENTE}`, { waitUntil: 'networkidle' })
  check(
    'una tarjeta inexistente NO redirige a /: pinta «no disponible» en su URL',
    new URL(carta.url()).pathname === `/carta_presentacion/${ID_INEXISTENTE}` &&
      (await carta.locator('.gt-carta-pagina__aviso h1').count()) === 1,
    carta.url(),
  )

  await carta.goto(base + `/carta_presentacion/${ID_FIXTURE}`, { waitUntil: 'networkidle' })
  const abrir = carta.locator('.gt-qr-tarjeta__abrir')
  check('el QR arranca plegado', (await abrir.getAttribute('aria-pressed')) === 'false' && (await carta.locator('.gt-qr-tarjeta__codigo').count()) === 0)
  await abrir.click()
  check(
    'y el botón lo despliega',
    await esperarA(async () => (await carta.locator('.gt-qr-tarjeta__codigo').count()) === 1),
  )
  check('  con la URL absoluta de la tarjeta dentro',
    (await carta.locator('.gt-qr-tarjeta__codigo').getAttribute('data-contenido')) === PERFIL_PUBLICO.url)
  await abrir.click()
  check('y lo vuelve a plegar',
    await esperarA(async () => (await carta.locator('.gt-qr-tarjeta__codigo').count()) === 0))

  await carta.click('.gt-tarjeta__compartir')
  check('«Compartir» copia el enlace cuando no hay navigator.share',
    await esperarA(async () => (await carta.evaluate(() => window.__copiado)) === PERFIL_PUBLICO.url))

  const externos = await carta.$$eval('.gt-tarjeta a.gt-boton--externo', (as) =>
    as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })),
  )
  check(
    'los botones que salen del sitio van --externo con target y rel seguros',
    externos.length === 4 &&
      externos.every((a) => a.target === '_blank' && a.rel.includes('noopener') && a.rel.includes('noreferrer')),
    JSON.stringify(externos),
  )
  await carta.close()
}

console.log('\nAltura de arranque')
// Pedido del usuario (2026-08-12): /ponentes, /encuestas y /certificado arrancan a la MISMA
// altura que /escarapela. El recorte del padding vive en `.gt-pagina` (PonentesPage.css) y
// ninguna página lo redefine; aquí se mide sobre píxeles renderizados el canto superior del
// h1 de cada una, no el CSS que se cree que aplica.
// Se mide la distancia del canto INFERIOR del header al h1, no el top absoluto:
// /galeria lleva riel de anclas y su header es más alto, así que el top absoluto
// difiere en exactamente esa fila sin que el arranque de la página cambie.
const alturaH1 = async (ruta) => {
  await desktop.goto(base + ruta, { waitUntil: 'networkidle' })
  return desktop.evaluate(() => {
    const h1 = document.querySelector('h1')
    const header = document.querySelector('.gt-header')
    return Math.round(h1.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
  })
}
const alturas = {}
for (const ruta of ['/escarapela', '/ponentes', '/encuestas', '/certificado', '/galeria']) {
  alturas[ruta] = await alturaH1(ruta)
}
check(
  'las cinco páginas del chasis arrancan a la misma distancia del header',
  new Set(Object.values(alturas)).size === 1,
  JSON.stringify(alturas),
)

console.log('\nRutas inválidas')
await desktop.goto(base + '/ponentes/no-existe', { waitUntil: 'networkidle' })
check(
  'un slug inexistente redirige a /ponentes',
  new URL(desktop.url()).pathname === '/ponentes',
  desktop.url(),
)

await desktop.goto(base + '/ruta-que-no-existe', { waitUntil: 'networkidle' })
check('una ruta inexistente redirige a /', new URL(desktop.url()).pathname === '/')

console.log('\nDatos')
await desktop.goto(base + '/ponentes', { waitUntil: 'networkidle' })
check('hay 11 ponentes', (await desktop.locator('.gt-ponente').count()) === 11)
// La presidencia abre y cierra la jornada: eso es protocolo, no programa, así
// que su fila va sin línea de horas (`SIN_RESUMEN` en foro.ts) y son diez, no
// once. Se comprueban las dos mitades por separado cuántas la llevan y que la
// que falta es exactamente esa porque un `=== 10` a secas daría por bueno que
// la excepción se mueva de persona.
check(
  'las diez filas del programa dicen cuándo intervienen',
  (await desktop.locator('.gt-ponente__resumen').count()) === 10,
)
check(
  'la fila de presidencia va sin horas',
  (await desktop
    .locator('.gt-ponente:has([href$="/erick-wehdeking-arcieri"]) .gt-ponente__resumen')
    .count()) === 0,
)
await desktop.goto(base + '/', { waitUntil: 'networkidle' })
check('hay 12 bloques de agenda', (await desktop.locator('.gt-agenda__fila').count()) === 12)
// El roster de la home comparte componente con /ponentes pero va dos secciones
// por debajo de la agenda: ahí la línea de participación sería decir lo mismo
// dos veces en la misma pantalla, así que va apagada a propósito.
check(
  'el roster de la home no repite las horas de la agenda',
  (await desktop.locator('.gt-ponente__resumen').count()) === 0,
)

// Los dos estados de la biografía. El documento de Comunicaciones no las trae
// todas, y el caso ausente es el que se puede hacer mal: se verifica que NO se
// pinte nadani cartel, ni caja vacía, que es la única forma de que nadie lo
// «arregle» metiendo un «biografía próximamente».
//
// Los dos slugs se DERIVAN de src/data/foro.ts y no se escriben aquí. Estaban
// fijos hasta que llegó la segunda entrega del .docx: el ejemplo «sin bio» era
// Karen Henríquez Leal, le llegó la suya y la prueba empezó a fallar por el
// arnés y no por el sitio. Derivarlos la mantiene cierta según van llegando.
console.log('\nBiografía')
const foro = readFileSync(new URL('../src/data/foro.ts', import.meta.url), 'utf8')
const fichas = [...foro.matchAll(/slug: '([a-z0-9-]+)',([\s\S]*?)\n {2}\},/g)].map((m) => ({
  slug: m[1],
  bio: m[2].includes('bio: ['),
}))
const conBio = fichas.filter((f) => f.bio).map((f) => f.slug)
const sinBio = fichas.find((f) => !f.bio)?.slug

check('src/data/foro.ts trae ponentes con biografía', conBio.length > 0, `${conBio.length}`)

// Y aquí la otra mitad, que es la que se rompió una vez: TODAS las biografías
// llevan entradilla, no solo las que el documento entregó ya partidas.
//
// El estilo lo aplica `p:first-child:not(:only-child)`, así que una bio de un
// párrafo se queda sin él y se lee plana. Pasó de verdad: seis de las diez
// venían de la fuente en un bloque único, y al lado de las otras cuatro
// parecían otro sitio. Se comprueba en el navegador y sobre el tamaño
// REALMENTE calculado, no sobre la clase: es la única forma de que valga
// también si mañana cambia el selector.
for (const slug of conBio) {
  await desktop.goto(base + `/ponentes/${slug}`, { waitUntil: 'networkidle' })
  const parrafos = desktop.locator('.gt-perfil__bio p')
  const total = await parrafos.count()
  if (total < 2) {
    check(`${slug}: la biografía tiene entradilla`, false, `un solo párrafo, se lee plana`)
    continue
  }
  const px = (i) =>
    parrafos.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const [entradilla, cuerpo] = [await px(0), await px(1)]
  check(
    `${slug}: la entradilla destaca sobre el cuerpo`,
    entradilla > cuerpo,
    `${total} párrafos · ${entradilla}px vs ${cuerpo}px`,
  )
}

if (sinBio) {
  await desktop.goto(base + `/ponentes/${sinBio}`, { waitUntil: 'networkidle' })
  check(
    'un perfil sin biografía no deja hueco',
    (await desktop.locator('.gt-perfil__bio').count()) === 0,
    sinBio,
  )
  check('y aun así lista sus intervenciones', (await desktop.locator('.gt-perfil__item').count()) > 0)
} else {
  console.log('   --   ya no queda ningún ponente sin biografía: ese caso no se puede verificar')
}

// La página de encuestas entrega tres destinos, y no son simétricos: la
// PRIMERA ya no es una encuesta anuncia las respuestas del panel y va
// destacada a todo lo ancho (`resultados` en foro.ts) y la de satisfacción
// abre por reloj el servidor retiene la URL hasta el cierre del evento
// (server/encuestas.js) y preview NO tiene /api/encuestas, así que aquí se ve
// exactamente el estado «cerrada» (fail-closed). Se verifica cada estado por
// lo que se puede romper sin que se note: cerrada, que el botón sea un botón
// deshabilitado con su aviso y no un enlace a ninguna parte; abierta
// (interceptando /api/encuestas), que el enlace lleve el `rel` seguro sin
// `noopener` la pestaña de destino puede reescribir la de origen; y el paso
// de una a otra SIN recargar, que es la promesa de «se habilita sola a las 4».
console.log('\nEncuestas (cerrada: /api/encuestas cortado a propósito)')
const AVISO_SATISFACCION = 'Se habilitará esta encuesta cuando finalice el evento.'
// El corte lo hace el arnés y no el entorno: `vite preview` HEREDA el proxy de
// /api de vite.config.ts, así que si hay un server local levantado en :3000
// pasado el cierre del evento, con la URL ya liberada esta sección vería la
// encuesta abierta y fallaría por el entorno, no por el código. Pasó el
// 2026-08-12: abortar la petición reproduce el fail-closed (fetch que revienta
// → botón retenido) sin importar qué esté corriendo al lado.
await desktop.route('**/api/encuestas', (ruta) => ruta.abort())
await desktop.goto(base + '/encuestas', { waitUntil: 'networkidle' })
const encuestas = await desktop.$$eval('.gt-encuesta', (tarjetas) =>
  tarjetas.map((t) => {
    const a = t.querySelector('a.gt-boton')
    const b = t.querySelector('button.gt-boton')
    return {
      enlace: a && {
        href: a.href,
        target: a.target,
        rel: a.rel,
        nombre: a.textContent.trim(),
      },
      boton: b && {
        nombre: b.textContent.trim(),
        inactivo: b.getAttribute('aria-disabled'),
        aviso: document.getElementById(b.getAttribute('aria-describedby'))?.textContent.trim(),
      },
    }
  }),
)

check('hay 3 encuestas', encuestas.length === 3, `hay ${encuestas.length}`)
const [panelistas, oportunidades, satisfaccion] = encuestas

// La de oportunidades es hoy el único enlace que sale del sitio: https con el
// `rel` seguro. Las respuestas del panel se enseñan AQUÍ (visor con descarga,
// 2026-08-13) y la de satisfacción abre por reloj: ninguna de las dos navega.
check(
  `«${oportunidades.enlace?.nombre}» apunta a un formulario`,
  Boolean(oportunidades.enlace?.href.startsWith('https://')),
  oportunidades.enlace?.href ?? '(sin enlace)',
)
check(
  `«${oportunidades.enlace?.nombre}» abre fuera con rel seguro`,
  oportunidades.enlace?.target === '_blank' &&
    oportunidades.enlace?.rel.includes('noopener') &&
    oportunidades.enlace?.rel.includes('noreferrer'),
  `target=${oportunidades.enlace?.target} rel=${oportunidades.enlace?.rel}`,
)

// «Ver respuestas» dejó de redirigir al Forms: es un botón ACTIVO (sin
// aria-disabled, a diferencia del retenido de satisfacción) que abre el visor
// de la pieza con sus 8 páginas y la descarga del PDF.
check(
  '«Ver respuestas» ya no es un enlace al Forms: es un botón activo',
  panelistas.enlace === null && panelistas.boton?.inactivo === null,
  JSON.stringify(panelistas.boton),
)
await desktop.click('.gt-encuesta--respuestas button.gt-boton')
check(
  'y abre el visor de respuestas',
  await esperarA(async () => (await desktop.locator('dialog.gt-respuestas[open]').count()) === 1),
)
check(
  'con las 8 páginas de la pieza',
  (await desktop.locator('.gt-respuestas__paginas img').count()) === 8,
)
check(
  'y la descarga del PDF completo',
  (await desktop
    .locator('.gt-respuestas a[href="/docs/respuestas-panelistas.pdf"][download]')
    .count()) === 1,
)
await desktop.keyboard.press('Escape')
check(
  'Escape cierra el visor de respuestas',
  await esperarA(async () => (await desktop.locator('dialog.gt-respuestas[open]').count()) === 0),
)

check(
  'la de satisfacción NO es un enlace: no hay URL que seguir',
  satisfaccion.enlace === null,
  satisfaccion.enlace?.href ?? '',
)
check(
  'sin enlace van solo la de resultados (visor propio) y la de satisfacción (reloj)',
  encuestas.filter((e) => e.enlace === null).length === 2,
)
check(
  'su botón está deshabilitado pero recibe foco (aria-disabled)',
  satisfaccion.boton?.inactivo === 'true',
  String(satisfaccion.boton?.inactivo),
)
check(
  'y su aviso es la descripción accesible del botón',
  satisfaccion.boton?.aviso === AVISO_SATISFACCION,
  satisfaccion.boton?.aviso ?? '(sin aviso)',
)
// Ningún control puede llamarse como otro: quien navega con lector de pantalla
// recorre la página saltando de enlace en enlace y solo oye su nombre.
{
  const nombres = encuestas.map((e) => e.enlace?.nombre ?? e.boton?.nombre ?? '')
  check(
    'los tres controles se llaman distinto',
    new Set(nombres).size === 3,
    nombres.join(' | '),
  )
}

// El anuncio de resultados es la PRIMERA tarjeta y es la destacada: si la
// clase se cae, la banda vuelve a ser una encuesta navy más sin que nada falle.
check(
  'la tarjeta de respuestas abre la página como lámina destacada',
  await desktop.$eval('.gt-encuesta:first-child', (t) =>
    t.classList.contains('gt-encuesta--respuestas'),
  ),
)

// El aviso se VE al pasar el mouse (en móvil lo muestra el toque; con teclado,
// el foco vía :focus-within). Oculto sigue en el DOM para el lector, así que lo
// que se comprueba es visibility, no existencia.
const avisoVisible = () =>
  desktop.$eval('.gt-encuesta__aviso', (el) => getComputedStyle(el).visibility)
check('el aviso arranca oculto a la vista', (await avisoVisible()) === 'hidden')
await desktop.hover('.gt-boton--inactivo')
check('y el hover lo muestra', (await avisoVisible()) === 'visible')
// El corte era solo para fijar el estado «cerrada»: se retira antes de seguir.
await desktop.unroute('**/api/encuestas')

// ── Abierta: /api/encuestas entrega la URL y el botón es el enlace de siempre.
console.log('\nEncuestas (abierta: /api/encuestas interceptado)')
const URL_PRUEBA = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=prueba'
{
  const abierta = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await abierta.route('**/api/encuestas', (ruta) =>
    ruta.fulfill({
      json: {
        ahora: '2026-08-05T21:30:00.000Z',
        satisfaccion: { habilitada: true, desde: '2026-08-05T16:00:00-05:00', url: URL_PRUEBA },
      },
    }),
  )
  await abierta.goto(base + '/encuestas', { waitUntil: 'networkidle' })
  const enlace = await abierta.$eval('.gt-encuesta:last-child a.gt-boton', (a) => ({
    href: a.href,
    target: a.target,
    rel: a.rel,
  }))
  check('con la URL entregada, el botón es un enlace al formulario', enlace.href === URL_PRUEBA, enlace.href)
  check(
    'y abre fuera con rel seguro',
    enlace.target === '_blank' && enlace.rel.includes('noopener') && enlace.rel.includes('noreferrer'),
    `target=${enlace.target} rel=${enlace.rel}`,
  )
  check(
    'y el botón deshabilitado ya no existe',
    (await abierta.locator('.gt-boton--inactivo').count()) === 0,
  )
  await abierta.close()
}

// ── El volteo automático: cerrada al cargar, el hook se programa con la resta
// de relojes DEL SERVIDOR (desde − ahora) y a la hora pregunta otra vez, sin
// recargar. Se simula con dos respuestas: la primera dice «faltan 2 s», la
// segunda entrega la URL. El enlace tiene que aparecer solo.
console.log('\nEncuestas (el volteo a la hora del cierre, sin recargar)')
{
  const volteo = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let consultas = 0
  await volteo.route('**/api/encuestas', (ruta) => {
    consultas++
    const ahora = new Date('2026-08-05T20:59:58.000Z') // reloj del servidor, no de la máquina
    ruta.fulfill({
      json:
        consultas === 1
          ? {
              ahora: ahora.toISOString(),
              satisfaccion: { habilitada: false, desde: '2026-08-05T16:00:00-05:00' },
            }
          : {
              ahora: new Date('2026-08-05T21:00:00.500Z').toISOString(),
              satisfaccion: {
                habilitada: true,
                desde: '2026-08-05T16:00:00-05:00',
                url: URL_PRUEBA,
              },
            },
    })
  })
  await volteo.goto(base + '/encuestas', { waitUntil: 'networkidle' })
  check('arranca cerrada', (await volteo.locator('.gt-boton--inactivo').count()) === 1)
  // El hook espera max(restante + margen, piso 5 s): el enlace aparece solo.
  await volteo
    .locator('.gt-encuesta:last-child a.gt-boton')
    .waitFor({ state: 'visible', timeout: 15000 })
  check('y a la hora del servidor el enlace aparece SIN recargar', true)
  check('con más de una consulta al servidor', consultas >= 2, `consultas=${consultas}`)
  await volteo.close()
}

// ───────────────────────────────────────────────────────────── galería
console.log('\nGalería: abanico, visor y rejilla')
await desktop.goto(base + '/galeria', { waitUntil: 'networkidle' })

// Cuántas fotos hay NO se escribe aquí: sale del manifiesto generado, que es la
// misma fuente que pinta la página (y sigue siendo independiente del DOM, así
// que «la rejilla lista las N» no es una tautología). Con «80» clavado, retirar
// tres fotos ponía en rojo medio arnés sin que nada estuviera roto.
const TOTAL = (
  readFileSync(new URL('../src/design/galeria.ts', import.meta.url), 'utf8').match(/^ {4}id: '/gm) ?? []
).length
check('el manifiesto de la galería trae fotos', TOTAL > 0, `${TOTAL}`)

check('el abanico arranca en la primera foto', (await desktop.locator('.gt-abanico__cuenta').textContent()).trim() === `1 / ${TOTAL}`)
// El mazo es CIRCULAR: en la primera foto el lado izquierdo va lleno con las
// últimas (N, N-1, …), así que las 11 ranuras están montadas desde el arranque.
check('y aun así el abanico está lleno por los dos lados', (await desktop.locator('.gt-abanico__tarjeta').count()) === 11)

await desktop.click('.gt-abanico__paso:not(.gt-abanico__paso--siguiente)')
check(
  `«anterior» desde la primera da la vuelta a la ${TOTAL}`,
  await esperarA(async () => (await desktop.locator('.gt-abanico__cuenta').textContent()).trim() === `${TOTAL} / ${TOTAL}`),
)
await desktop.click('.gt-abanico__paso--siguiente')
check(
  `y «siguiente» desde la ${TOTAL} vuelve a la 1`,
  await esperarA(async () => (await desktop.locator('.gt-abanico__cuenta').textContent()).trim() === `1 / ${TOTAL}`),
)

await desktop.click('.gt-abanico__paso--siguiente')
check(
  'avanzar mueve el contador y la hora',
  await esperarA(async () => (await desktop.locator('.gt-abanico__cuenta').textContent()).trim() === `2 / ${TOTAL}`),
)

// La tarjeta central abre el visor; Escape lo cierra y devuelve el foco.
await desktop.click('.gt-abanico__tarjeta--activa')
check('la tarjeta central abre el visor', await esperarA(() => desktop.locator('dialog.gt-visor[open]').count()))
await desktop.keyboard.press('ArrowRight')
check(
  'la flecha derecha navega dentro del visor',
  await esperarA(async () => ((await desktop.locator('.gt-visor__pie').textContent()) ?? '').includes(`3 / ${TOTAL}`)),
)
await desktop.keyboard.press('Escape')
check('Escape cierra el visor', await esperarA(async () => (await desktop.locator('dialog.gt-visor[open]').count()) === 0))

// La rejilla es el índice: cualquier celda abre el visor sobre esa foto.
check(`la rejilla lista las ${TOTAL} fotos`, (await desktop.locator('.gt-galeria__celda').count()) === TOTAL)
await desktop.locator('.gt-galeria__celda').nth(9).click()
check(
  'una celda de la rejilla abre el visor sobre su foto',
  await esperarA(async () => ((await desktop.locator('.gt-visor__pie').textContent()) ?? '').includes(`10 / ${TOTAL}`)),
)
await desktop.keyboard.press('Escape')

// La vuelta también en el visor: izquierda desde la 1 es la última.
await desktop.locator('.gt-galeria__celda').first().click()
await esperarA(async () => (await desktop.locator('dialog.gt-visor[open]').count()) === 1)
await desktop.keyboard.press('ArrowLeft')
check(
  `el visor también da la vuelta: izquierda desde la 1 es la ${TOTAL}`,
  await esperarA(async () => ((await desktop.locator('.gt-visor__pie').textContent()) ?? '').includes(`${TOTAL} / ${TOTAL}`)),
)
await desktop.keyboard.press('Escape')

// El riel de anclas: el mismo scrollspy de la home, con las secciones de aquí.
console.log('\nGalería: riel de anclas y descargas')
check(
  'el riel lista las 4 secciones',
  (await desktop.locator('.gt-header__ancla').allTextContents()).join('|') ===
    'Presentaciones|Galería de imágenes|Descargar imágenes|Resumen de la jornada',
  (await desktop.locator('.gt-header__ancla').allTextContents()).join('|'),
)

// El ORDEN es el pedido (2026-08-13): las presentaciones abren, las fotografías
// se descargan después de verlas. Se comprueba sobre los títulos y no sobre los
// ids porque es lo que lee la persona, y de paso ata el copy de cada sección.
check(
  'las cuatro secciones van en el orden pedido',
  (await desktop.locator('.gt-galeria .gt-titulo-seccion__texto').allTextContents()).join('|') ===
    'Descarga las presentaciones de tus ponentes|Galería de imágenes|Descargar imágenes|Resumen de la jornada',
  (await desktop.locator('.gt-galeria .gt-titulo-seccion__texto').allTextContents()).join('|'),
)
check(
  'y el h1 de la página es el título de la primera',
  (await desktop.locator('.gt-galeria h1').textContent()) ===
    'Descarga las presentaciones de tus ponentes',
)

await desktop.click('.gt-header__ancla[href="#resumen-de-jornada"]')
check(
  'el scrollspy marca Resumen de la jornada como activa',
  await esperarA(async () => (await anclaActiva()) === 'Resumen de la jornada'),
  `leído: ${await anclaActiva()}`,
)
await desktop.click('.gt-header__ancla[href="#descargar-presentaciones"]')
check(
  'y vuelve a marcar Presentaciones al subir a la primera',
  await esperarA(async () => (await anclaActiva()) === 'Presentaciones'),
  `leído: ${await anclaActiva()}`,
)

// Sin confirmación del servidor, los botones van RETENIDOS: la página nunca
// ofrece un enlace que va a dar 404. Se intercepta la respuesta «apagada»
// (la forma real de estadoDescargas con DESCARGAS_DIR vacío) en vez de confiar
// en el ambiente: `vite preview` hereda el proxy de /api, así que con el server
// local arriba el estado ambiente puede ser cualquiera de los dos.
{
  const sinDescargas = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await sinDescargas.route('**/api/descargas', (ruta) =>
    ruta.fulfill({ json: { imagenes: null, presentaciones: null } }),
  )
  await sinDescargas.goto(base + '/galeria', { waitUntil: 'networkidle' })
  check(
    'sin confirmación: los dos botones de descarga van retenidos',
    (await sinDescargas.locator('.gt-descarga .gt-boton--inactivo[aria-disabled="true"]').count()) === 2,
  )
  check('y ninguno es un enlace', (await sinDescargas.locator('.gt-descarga a').count()) === 0)
  check(
    'y cada botón lleva su aviso como descripción accesible',
    (await sinDescargas.locator('.gt-descarga .gt-boton--inactivo[aria-describedby]').count()) === 2 &&
      (await sinDescargas.locator('#gt-descarga-aviso-imagenes').textContent()) ===
        (await sinDescargas.locator('#gt-descarga-aviso-presentaciones').textContent()),
  )
  await sinDescargas.close()
}

// Con el estado confirmado (interceptado, como /api/encuestas), son enlaces de
// descarga y el peso que enseñan es el del manifiesto.
{
  const conDescargas = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await conDescargas.route('**/api/descargas', (ruta) =>
    ruta.fulfill({
      json: {
        imagenes: { bytes: 1395641241, elementos: 77 },
        presentaciones: { bytes: 30206836, elementos: 4 },
      },
    }),
  )
  await conDescargas.goto(base + '/galeria', { waitUntil: 'networkidle' })
  const imagenes = conDescargas.locator('.gt-descarga a[href="/descargas/imagenes"]')
  const presentaciones = conDescargas.locator('.gt-descarga a[href="/descargas/presentaciones"]')
  check('confirmado: «Descargar imágenes» es un enlace de descarga',
    (await imagenes.count()) === 1 && (await imagenes.getAttribute('download')) !== null)
  check('confirmado: «Descargar presentaciones» también',
    (await presentaciones.count()) === 1 && (await presentaciones.getAttribute('download')) !== null)
  check(
    // El orden del DOM es el de las secciones: presentaciones primero.
    'y el peso anunciado sale del manifiesto',
    ((await conDescargas.locator('.gt-descarga__meta').allTextContents()).join('|') ===
      '4 presentaciones · 29 MB|77 fotografías originales · 1,3 GB'),
    (await conDescargas.locator('.gt-descarga__meta').allTextContents()).join('|'),
  )
  await conDescargas.close()
}

// La escarapela sin sesión: preview no tiene /api/me, que es exactamente el estado anónimo.
console.log('\nEscarapela sin sesión')
await desktop.goto(base + '/escarapela', { waitUntil: 'networkidle' })
check(
  'el botón de entrar apunta al arranque del login',
  (await desktop.locator('.gt-escarapela__entrar').getAttribute('href')) === '/auth/login',
)
check('no hay carné que ver', (await desktop.locator('.gt-carne').count()) === 0)

await desktop.close()

// ─────────────────────────────────────────────── escarapela con sesión simulada
// El login real no se automatiza (MFA): se intercepta /api/me como en sesion-test.mjs y se
// verifica lo que solo pasa con sesión el volteo y el ciclo completo de la foto.
console.log('\nEscarapela con sesión: volteo y foto')

const IDENTIDAD = {
  authenticated: true,
  user: {
    nombre_completo: 'María Cristina Giraldo',
    cargo: 'Profesional de Comunicaciones',
    area: 'Vicepresidencia de Asuntos Corporativos',
    upn: 'mcgiraldo@gecelca.com.co',
    email: 'mcgiraldo@gecelca.com.co',
    oid: '00000000-1111-2222-3333-444444444444',
    roles: [],
  },
}
// Un PNG de 1×1: suficiente para recorrer createImageBitmap → canvas → localStorage.
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const esc = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
await esc.route('**/api/me', (ruta) => ruta.fulfill({ json: IDENTIDAD }))
await esc.goto(base + '/escarapela', { waitUntil: 'networkidle' })

const voltear = esc.locator('.gt-escarapela-voltear')
check('el carné arranca por el frente', await esc.locator('.gt-carne__cara--frontal').isVisible())
check('el botón de volteo anuncia su estado', (await voltear.getAttribute('aria-pressed')) === 'false')

await voltear.click()
await esc.waitForTimeout(1100) // media vuelta + el retardo de visibility
check('al voltear, el dorso queda a la vista', await esc.locator('.gt-carne__cara--trasera').isVisible())
check('y el frente sale del árbol visible', !(await esc.locator('.gt-carne__cara--frontal').isVisible()))
check('aria-pressed acompaña el volteo', (await voltear.getAttribute('aria-pressed')) === 'true')

await voltear.click()
await esc.waitForTimeout(1100)
check('el segundo clic vuelve al frente', await esc.locator('.gt-carne__cara--frontal').isVisible())

check('sin foto, el retrato son las iniciales', await esc.locator('.gt-carne__iniciales').isVisible())
await esc.setInputFiles('#gt-escarapela-foto', {
  name: 'foto.png',
  mimeType: 'image/png',
  buffer: PNG_MINIMO,
})
await esc.waitForSelector('.gt-carne__foto', { timeout: 5000 })
check('la foto elegida se pinta en el retrato', await esc.locator('.gt-carne__foto').isVisible())

await esc.reload({ waitUntil: 'networkidle' })
check('y sobrevive a una recarga (localStorage)', await esc.locator('.gt-carne__foto').isVisible())

await esc.click('text=Quitar foto')
await esc.waitForTimeout(300)
check('quitarla devuelve las iniciales', await esc.locator('.gt-carne__iniciales').isVisible())
check(
  'y borra la clave del almacenamiento',
  await esc.evaluate(
    (oid) => localStorage.getItem(`gt-escarapela-foto:${oid}`) === null,
    IDENTIDAD.user.oid,
  ),
)
await esc.close()

// ───────────────────────────────────────────────────────────────── móvil
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto(base + '/', { waitUntil: 'networkidle' })

console.log('\nNav móvil')
check('el nav de escritorio está oculto', !(await mobile.locator('.gt-header__nav').isVisible()))

await mobile.click('.gt-header__hamburguesa')
check('el panel abre', await mobile.locator('.gt-navmovil__panel').isVisible())
check(
  'el foco entra al panel',
  await mobile.evaluate(() => !!document.activeElement?.closest('.gt-navmovil__panel')),
)

await mobile.keyboard.press('Escape')
await mobile.waitForTimeout(250)
check('Esc cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)
check(
  'el foco vuelve a la hamburguesa',
  await mobile.evaluate(() =>
    document.activeElement?.classList.contains('gt-header__hamburguesa'),
  ),
)

await mobile.click('.gt-header__hamburguesa')
await mobile.waitForTimeout(250)
await mobile.mouse.click(20, 400) // fuera del panel, que ocupa la derecha
await mobile.waitForTimeout(250)
check('el clic fuera cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)

await mobile.click('.gt-header__hamburguesa')
await mobile.waitForTimeout(250)
await mobile.click('.gt-navmovil__enlace[href="/ponentes"]')
await mobile.waitForURL('**/ponentes')
check('navega y cierra el panel', (await mobile.locator('.gt-navmovil__panel').count()) === 0)

await mobile.close()
await browser.close()

console.log(fallos === 0 ? '\nTodo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)
