// server/certificados.js: el módulo que decide QUÉ archivo le corresponde a QUÉ oid.
//
//   node scripts/certificados-server-test.mjs
//
// Sin red, sin servidor levantado, sin credenciales: el módulo es puro archivo + mapa, y aquí se
// ejercita contra directorios fabricados en el momento. Lo que se fija:
//
//   · vacío = apagado (el defecto no existe, no falla)
//   · configurado a medias = el arranque ABORTA (nunca «a medias enciende a medias»)
//   · un manifiesto que intente salirse del directorio (traversal) ABORTA
//   · un oid repetido ABORTA (dos personas no pueden compartir archivo)
//   · `estadoCertificado` responde `disponible` SOLO para oids del manifiesto
//   · el archivo prometido tiene que EXISTIR al arrancar (subida incompleta = no arrancar)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { iniciarCertificados, estadoCertificado, rutaCertificado } from '../server/certificados.js'

let fallos = 0
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`)
  if (!ok) fallos++
}
const abortaCon = (fn, fragmento) => {
  try {
    fn()
    return { aborto: false, mensaje: '(no abortó)' }
  } catch (e) {
    return { aborto: true, contiene: e.message.includes(fragmento), mensaje: e.message.slice(0, 90) }
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtalks-certs-'))
const dirBueno = path.join(tmp, 'bueno')
fs.mkdirSync(dirBueno)
fs.writeFileSync(path.join(dirBueno, 'ana.pdf'), '%PDF-1.7 finge ser un pdf')
fs.writeFileSync(path.join(dirBueno, 'beto.pdf'), '%PDF-1.7 finge ser otro')
const manifiesto = (personas) => JSON.stringify({ generado: 'x', personas })
fs.writeFileSync(path.join(dirBueno, 'manifiesto.json'), manifiesto([
  { oid: 'oid-ana', archivo: 'ana.pdf', sha256: '' },
  { oid: 'oid-beto', archivo: 'beto.pdf', sha256: '' },
]))

console.log('\nApagado por defecto')
{
  const r = iniciarCertificados({})
  check('sin CERTIFICADOS_DIR: inactivo, sin error', r.activo === false)
  check('apagado, todo oid es no_aplica', estadoCertificado('oid-ana') === 'no_aplica')
  check('apagado, ninguna ruta', rutaCertificado('oid-ana') === null)
}

console.log('\nConfigurado bien')
{
  const r = iniciarCertificados({ CERTIFICADOS_DIR: dirBueno })
  check('activo con 2 personas', r.activo === true && r.personas === 2)
  check('el oid del manifiesto es disponible', estadoCertificado('oid-ana') === 'disponible')
  check('y su ruta apunta a su archivo', path.basename(rutaCertificado('oid-ana') ?? '') === 'ana.pdf')
  check('un oid desconocido es no_aplica', estadoCertificado('oid-nadie') === 'no_aplica')
  check('un oid vacío es no_aplica', estadoCertificado('') === 'no_aplica' && rutaCertificado('') === null)
}

console.log('\nConfigurado a medias → aborta')
{
  const sinManifiesto = path.join(tmp, 'sin-manifiesto')
  fs.mkdirSync(sinManifiesto)
  const r = abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: sinManifiesto }), 'no se puede leer')
  check('directorio sin manifiesto aborta', r.aborto && r.contiene, r.mensaje)

  const corrupto = path.join(tmp, 'corrupto')
  fs.mkdirSync(corrupto)
  fs.writeFileSync(path.join(corrupto, 'manifiesto.json'), '{esto no es json')
  check('manifiesto corrupto aborta', abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: corrupto }), 'no se puede leer').aborto)

  const vacio = path.join(tmp, 'vacio')
  fs.mkdirSync(vacio)
  fs.writeFileSync(path.join(vacio, 'manifiesto.json'), manifiesto([]))
  check('manifiesto sin personas aborta', abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: vacio }), 'no trae personas').aborto)

  const roto = path.join(tmp, 'roto')
  fs.mkdirSync(roto)
  fs.writeFileSync(path.join(roto, 'manifiesto.json'), manifiesto([{ oid: 'x', archivo: 'no-esta.pdf' }]))
  check('archivo prometido que falta aborta (subida incompleta)', abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: roto }), 'subida incompleta').aborto)
}

console.log('\nManifiestos hostiles → abortan')
{
  const casos = [
    ['../fuera.pdf', 'traversal con ../'],
    ['sub/../../fuera.pdf', 'traversal escondido'],
    ['/etc/passwd', 'ruta absoluta'],
    ['CON.pdf;x', 'caracteres fuera del allowlist'],
    ['MAYUS.pdf', 'mayúsculas (el generador nunca las produce)'],
  ]
  for (const [archivo, porque] of casos) {
    const dir = fs.mkdtempSync(path.join(tmp, 'hostil-'))
    fs.writeFileSync(path.join(dir, 'manifiesto.json'), manifiesto([{ oid: 'x', archivo }]))
    check(`«${archivo}» aborta (${porque})`, abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: dir }), 'inválida').aborto)
  }

  const duplicado = path.join(tmp, 'duplicado')
  fs.mkdirSync(duplicado)
  fs.writeFileSync(path.join(duplicado, 'ana.pdf'), 'x')
  fs.writeFileSync(path.join(duplicado, 'beto.pdf'), 'x')
  fs.writeFileSync(path.join(duplicado, 'manifiesto.json'), manifiesto([
    { oid: 'mismo', archivo: 'ana.pdf' },
    { oid: 'mismo', archivo: 'beto.pdf' },
  ]))
  check('un oid repetido aborta', abortaCon(() => iniciarCertificados({ CERTIFICADOS_DIR: duplicado }), 'dos veces').aborto)
}

console.log('\nY el aborto NO deja el mapa a medias')
{
  // Tras un intento fallido, el módulo no debe quedarse sirviendo el mapa anterior a medias ni
  // uno nuevo parcial: se re-inicia con el bueno y se comprueba que todo sigue coherente.
  iniciarCertificados({ CERTIFICADOS_DIR: dirBueno })
  check('re-iniciado con el bueno: ana disponible', estadoCertificado('oid-ana') === 'disponible')
  iniciarCertificados({})
  check('re-iniciado apagado: ana ya no está', estadoCertificado('oid-ana') === 'no_aplica')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(fallos === 0 ? '\nserver/certificados.js: todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`)
process.exit(fallos === 0 ? 0 : 1)
