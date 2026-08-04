// Pruebas de interacción sobre dist/ servido por `npm run preview`.
// Sale con código 1 si algo falla.
//
//   npm run build && npm run preview     # en una terminal
//   node scripts/interactions-test.mjs   # en otra
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

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
// equipo cargadojusto después de un build, por ejemplo— el scroll todavía no
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
// once. Se comprueban las dos mitades por separado —cuántas la llevan y que la
// que falta es exactamente esa— porque un `=== 10` a secas daría por bueno que
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
// pinte nadani cartel, ni caja vacía—, que es la única forma de que nadie lo
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
// de satisfacción abre por reloj el servidor retiene la URL hasta el cierre
// del evento (server/encuestas.js) y preview NO tiene /api/encuestas, así que
// aquí se ve exactamente el estado «cerrada» (fail-closed). Se verifica cada
// estado por lo que se puede romper sin que se note: cerrada, que el botón sea
// un botón deshabilitado con su aviso y no un enlace a ninguna parte; abierta
// (interceptando /api/encuestas), que el enlace lleve el `rel` seguro sin
// `noopener` la pestaña de destino puede reescribir la de origen—; y el paso
// de una a otra SIN recargar, que es la promesa de «se habilita sola a las 4».
console.log('\nEncuestas (cerrada: preview no tiene /api/encuestas)')
const AVISO_SATISFACCION = 'Se habilitará esta encuesta cuando finalice el evento.'
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
const [oportunidades, panelistas, satisfaccion] = encuestas

// Las dos primeras están abiertas SIEMPRE y se comprueban igual: enlace https
// que sale del sitio con el `rel` seguro. La de satisfacción es la única que no
// es un enlace, y va la última a propósito.
for (const abierta of [oportunidades, panelistas]) {
  check(
    `«${abierta.enlace?.nombre}» apunta a un formulario`,
    Boolean(abierta.enlace?.href.startsWith('https://')),
    abierta.enlace?.href ?? '(sin enlace)',
  )
  check(
    `«${abierta.enlace?.nombre}» abre fuera con rel seguro`,
    abierta.enlace?.target === '_blank' &&
      abierta.enlace?.rel.includes('noopener') &&
      abierta.enlace?.rel.includes('noreferrer'),
    `target=${abierta.enlace?.target} rel=${abierta.enlace?.rel}`,
  )
}
check(
  'la de satisfacción NO es un enlace: no hay URL que seguir',
  satisfaccion.enlace === null,
  satisfaccion.enlace?.href ?? '',
)
check(
  'y es la ÚNICA sin enlace: las otras dos no dependen del reloj',
  encuestas.filter((e) => e.enlace === null).length === 1,
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

// El aviso se VE al pasar el mouse (en móvil lo muestra el toque; con teclado,
// el foco vía :focus-within). Oculto sigue en el DOM para el lector, así que lo
// que se comprueba es visibility, no existencia.
const avisoVisible = () =>
  desktop.$eval('.gt-encuesta__aviso', (el) => getComputedStyle(el).visibility)
check('el aviso arranca oculto a la vista', (await avisoVisible()) === 'hidden')
await desktop.hover('.gt-boton--inactivo')
check('y el hover lo muestra', (await avisoVisible()) === 'visible')

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
