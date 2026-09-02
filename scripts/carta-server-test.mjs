// Verificación PURA del módulo de la carta de presentación (server/carta/): sin BD, sin
// servidor levantado, sin red. Sale con código 1 si algo falla.
//
//   node scripts/carta-server-test.mjs
//
// Qué ejerce, por capa:
//   · config: vacío / a medias / completo / valores que no valen
//   · migraciones: cuatro archivos contiguos, partidos por GO, sha estable
//   · validación: corpus bueno (tildes, ñ, teléfonos colombianos) y corpus HOSTIL
//   · vCard: N/FN, escapes, CRLF, plegado a 75 octetos con tildes
//   · foto: magia de bytes, lado mínimo, WebP ≤ 800 con sha estable, bomba de píxeles
//   · guardias: 401, vida absoluta vencida, [] → 403, 'ROL' como cadena → 403, ['ROL'] pasa
//   · og: apagado si faltan etiquetas; escapado; el resto del HTML byte-idéntico
//   · la matriz HTTP con un repositorio FALSO y la sesión inyectada por cabecera (solo aquí)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import sharp from 'sharp';

import { leerConfiguracionCarta } from '../server/carta/config.js';
import { listarMigraciones, partirPorGo } from '../server/carta/migraciones.js';
import { normalizarTelefono, validarEstado, validarPerfil, validarRed, LIMITES } from '../server/carta/validacion.js';
import { escaparVcard, generarVcard, nombreArchivoVcard, plegar } from '../server/carta/vcard.js';
import { FotoInvalida, procesarFoto, tipoPorMagia } from '../server/carta/foto.js';
import { requiereRol, requiereSesion } from '../server/auth/guardias.js';
import { componerOg, escapar, prepararOg } from '../server/carta/og.js';
import { crearRutasCarta } from '../server/carta/rutas.js';
import { BdNoDisponible, nombreTls } from '../server/carta/bd.js';
import { CorreoDuplicado } from '../server/carta/repositorio.js';
import { DirectorioNoDisponible, aPropuesta, crearDirectorio, filtroDe, normalizarBusqueda, partirNombre } from '../server/carta/directorio.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`);
  if (!ok) fallos++;
}

// ───────────────────────────────────────────────────────────── configuración
console.log('\nConfiguración: vacío = no existe; a medias = problemas; completo = activa');
{
  const vacio = leerConfiguracionCarta({});
  check('sin DB_*: apagada y sin problemas', !vacio.activa && vacio.problemas.length === 0);
  check('  con el rol por defecto LOGIN_JEFA', vacio.rolAdmin === 'LOGIN_JEFA');
  check('  y los tres diales por defecto', vacio.limites.publico === 1200 && vacio.limites.admin === 600 && vacio.limites.foto === 60);

  const medias = leerConfiguracionCarta({ DB_HOST: 'h', DB_NAME: 'n' });
  check('a medias: apagada CON problemas', !medias.activa && medias.problemas.length === 1, medias.problemas[0]);
  check('  que nombran las que faltan', /DB_PORT.*DB_USER.*DB_PASSWORD/.test(medias.problemas[0]));

  const base = { DB_HOST: '10.0.0.1', DB_PORT: '1433', DB_NAME: 'PortalG3_dev', DB_USER: 'u', DB_PASSWORD: 'p' };
  const completa = leerConfiguracionCarta({ ...base, DB_TRUST_CERT: 'true', CARTA_RATE_FOTO: '5' });
  check('completa: activa', completa.activa && completa.problemas.length === 0);
  check('  confía en el certificado solo con true literal', completa.bd.confiarCertificado === true);
  check('  y toma el dial de la foto', completa.limites.foto === 5 && completa.limites.admin === 600);
  check('  sin DB_TRUST_CERT no confía', leerConfiguracionCarta(base).bd.confiarCertificado === false);

  check('DB_PORT=abc es un problema', leerConfiguracionCarta({ ...base, DB_PORT: 'abc' }).problemas.length === 1);
  check('DB_TRUST_CERT=yes es un problema', leerConfiguracionCarta({ ...base, DB_TRUST_CERT: 'yes' }).problemas.length === 1);
  check('CARTA_ROL_ADMIN con espacios es un problema', leerConfiguracionCarta({ ...base, CARTA_ROL_ADMIN: 'LOGIN JEFA' }).problemas.length === 1);
  check('CARTA_RATE_ADMIN=0 es un problema', leerConfiguracionCarta({ ...base, CARTA_RATE_ADMIN: '0' }).problemas.length === 1);
  check('el motor por defecto es mssql', completa.motor === 'mssql' && vacio.motor === 'mssql');
  const sq = leerConfiguracionCarta({ DB_SQLITE_PATH: '/var/lib/gtalks/carta.db' });
  check('DB_SQLITE_PATH solo → motor sqlite, activa', sq.activa && sq.motor === 'sqlite' && sq.sqlite.ruta === '/var/lib/gtalks/carta.db');
  check('DB_MOTOR=sqlite sin ruta → problema', leerConfiguracionCarta({ DB_MOTOR: 'sqlite' }).problemas.length === 1);
  check('DB_MOTOR=sqlite con DB_* puestas → problema', leerConfiguracionCarta({ DB_MOTOR: 'sqlite', DB_SQLITE_PATH: '/x.db', DB_HOST: 'h' }).problemas.length === 1);
  check('DB_SQLITE_PATH y DB_* sin DB_MOTOR → problema', leerConfiguracionCarta({ ...base, DB_SQLITE_PATH: '/x.db' }).problemas.length === 1);
  check('DB_MOTOR=otro → problema', leerConfiguracionCarta({ ...base, DB_MOTOR: 'postgres' }).problemas.length === 1);
  check('sqlite respeta el rol y los diales', leerConfiguracionCarta({ DB_SQLITE_PATH: '/x.db', CARTA_ROL_ADMIN: 'OTRO', CARTA_RATE_FOTO: '9' }).rolAdmin === 'OTRO' && leerConfiguracionCarta({ DB_SQLITE_PATH: '/x.db', CARTA_RATE_FOTO: '9' }).limites.foto === 9);
  check('un host IP recibe un nombre TLS que no es IP', nombreTls('10.0.0.1') === 'sqlserver.gecelca.invalid' && nombreTls('db.gecelca.com.co') === 'db.gecelca.com.co');
  check('  y DB_TLS_SERVERNAME manda', nombreTls('10.0.0.1', 'sql.corp') === 'sql.corp');
}

// ───────────────────────────────────────────────────────────────── migraciones
console.log('\nMigraciones: cuatro archivos contiguos, partidos por GO, sha estable');
{
  const lista = listarMigraciones();
  check('hay 4 migraciones', lista.length === 4, String(lista.length));
  check('numeradas 1..4', lista.map((m) => m.numero).join() === '1,2,3,4');
  check('001 crea el esquema y la tabla de control', lista[0].lotes.length === 2 && /CREATE SCHEMA carta/.test(lista[0].lotes[0]));
  check('cada lote es idempotente (IF … IS NULL / IF NOT EXISTS)', lista.every((m) => m.lotes.every((l) => /IF (OBJECT_ID|SCHEMA_ID|NOT EXISTS)/.test(l))));
  check('ninguna migración toca otro esquema', lista.every((m) => !/\b(dbo|gh|auth|bitacora|dashboard)\.[a-z]/i.test(m.lotes.join('\n'))));
  const otra = listarMigraciones();
  check('el sha256 es estable entre lecturas', lista.every((m, i) => m.sha256 === otra[i].sha256));
  check('partirPorGo ignora el GO dentro de una línea', partirPorGo('SELECT 1 -- GO\nGO\nSELECT 2').length === 2);
  check('partirPorGo tolera CRLF y minúsculas', partirPorGo('A\r\ngo\r\nB').length === 2);
}

// ───────────────────────────────────────────────────────────────── validación
console.log('\nValidación: rechaza, no sanea');
{
  const bueno = {
    nombres: 'María José', apellidos: 'Núñez Ochoa', cargo: 'Jefa de Comunicaciones (E)', area: 'Vicepresidencia & Asuntos',
    correo: 'MJ.Nunez@Gecelca.com.co', telefono: '(605) 361 2000', whatsapp: '300 123 4567',
    linkedin: 'https://www.linkedin.com/in/mj', instagram: 'https://instagram.com/mj', x: 'https://twitter.com/mj',
    facebook: 'https://www.facebook.com/mj', youtube: 'https://youtu.be/abc', tiktok: 'https://www.tiktok.com/@mj',
    sitio_web: 'https://www.gecelca.com.co/',
  };
  const r = validarPerfil(bueno);
  check('el corpus bueno pasa', r.valor !== null, JSON.stringify(r.campos));
  check('  correo en minúsculas', r.valor?.correo === 'mj.nunez@gecelca.com.co');
  check('  fijo colombiano → E.164', r.valor?.telefono === '+576053612000');
  check('  celular colombiano → E.164', r.valor?.whatsapp === '+573001234567');
  check('  redes normalizadas (href)', r.valor?.linkedin === 'https://www.linkedin.com/in/mj' && r.valor?.x === 'https://twitter.com/mj');
  check('  área opcional se conserva', r.valor?.area === 'Vicepresidencia & Asuntos');
  check('  espacios repetidos colapsan', validarPerfil({ ...bueno, nombres: '  Ana   Lucía ' }).valor?.nombres === 'Ana Lucía');
  check('  sin opcionales: null', validarPerfil({ nombres: 'A', apellidos: 'B', cargo: 'C', correo: 'a@b.co' }).valor?.telefono === null);
  check('  claves desconocidas se ignoran', validarPerfil({ ...bueno, activo: 'true', id: 'x' }).valor !== null);

  for (const [t, e] of [['+573001234567', '+573001234567'], ['3001234567', '+573001234567'], ['57 300 123 4567', '+573001234567'],
    ['6053612000', '+576053612000'], ['00573001234567', '+573001234567'], ['12', null], ['abc', null], ['+0123', null]]) {
    check(`teléfono «${t}» → ${e}`, normalizarTelefono(t) === e, String(normalizarTelefono(t)));
  }

  const hostil = [
    ['nombres', 'a<b', 'caracteres_no_permitidos'],
    ['nombres', 'Ana', 'caracteres_no_permitidos'],
    ['nombres', 'x'.repeat(81), 'demasiado_largo'],
    ['nombres', '', 'obligatorio'],
    ['apellidos', ['x'], 'formato'],
    ['cargo', 'Jefa <script>', 'caracteres_no_permitidos'],
    ['correo', 'no-es-correo', 'formato'],
    ['correo', 'a@b', 'formato'],
    ['correo', 'x@' + 'a'.repeat(250) + '.co', 'demasiado_largo'],
    ['telefono', '12', 'formato'],
    ['linkedin', 'javascript:alert(1)', 'solo_https'],
    ['linkedin', 'http://linkedin.com/in/x', 'solo_https'],
    ['linkedin', 'https://linkedin.com.evil.com/x', 'dominio_no_permitido'],
    ['linkedin', 'https://evil.com/linkedin.com', 'dominio_no_permitido'],
    ['x', 'https://x.com@evil.com/', 'formato'],
    ['x', 'https://x.com/a#frag', 'formato'],
    ['youtube', 'https://vimeo.com/1', 'dominio_no_permitido'],
    ['sitio_web', 'https://1.2.3.4/', 'formato'],
    ['sitio_web', 'https://localhost/', 'formato'],
    ['sitio_web', 'http://gecelca.com.co/', 'solo_https'],
    ['sitio_web', 'https://' + 'a'.repeat(200) + '.co', 'demasiado_largo'],
  ];
  for (const [campo, valor, codigo] of hostil) {
    const rr = validarPerfil({ ...bueno, [campo]: valor });
    check(`${campo}=${JSON.stringify(valor).slice(0, 40)} → ${codigo}`, rr.valor === null && rr.campos[campo] === codigo, String(rr.campos[campo]));
  }
  check('un cuerpo que no es objeto → formato', validarPerfil('x').campos._ === 'formato' && validarPerfil([]).campos._ === 'formato');
  check('validarRed exige la lista de dominios', validarRed('https://a.b', ['c']).error === 'dominio_no_permitido' && validarRed('https://a.b', ['b']).valor === 'https://a.b/');
  check('estado: solo booleano', validarEstado({ activo: 'true' }).valor === null && validarEstado({ activo: false }).valor?.activo === false);
  check('LIMITES coincide con las columnas', LIMITES.nombres === 80 && LIMITES.cargo === 120 && LIMITES.correo === 254 && LIMITES.red === 200);
}

// ─────────────────────────────────────────────────────────────────────── vCard
console.log('\nvCard 3.0: N + FN, escapes, CRLF, plegado a 75 octetos');
{
  const p = {
    id: '11111111-2222-4333-8444-555555555555', nombres: 'María José', apellidos: 'Núñez; Ríos, Ochoa', cargo: 'Jefa\nde Comunicaciones',
    area: 'Vicepresidencia', correo: 'mj@gecelca.com.co', telefono: '+573001234567', whatsapp: '+573001234567',
    redes: { linkedin: 'https://www.linkedin.com/in/mj', instagram: null, x: null, facebook: null, youtube: null, tiktok: null, sitio_web: 'https://www.gecelca.com.co/' },
  };
  const v = generarVcard(p, 'https://cdp.gecelca.com.co/carta_presentacion/' + p.id, new Date('2026-09-02T10:00:00Z'));
  const lineas = v.split('\r\n');
  check('empieza y termina como manda', lineas[0] === 'BEGIN:VCARD' && lineas[1] === 'VERSION:3.0' && lineas.at(-2) === 'END:VCARD' && v.endsWith('\r\n'));
  check('solo CRLF (ningún LF suelto)', !/[^\r]\n/.test(v));
  check('N: apellidos;nombres escapados', lineas.includes('N:Núñez\\; Ríos\\, Ochoa;María José;;;'));
  check('FN: nombre completo', lineas.includes('FN:María José Núñez\\; Ríos\\, Ochoa'));
  check('TITLE con el salto escapado', lineas.includes('TITLE:Jefa\\nde Comunicaciones'));
  check('un solo TEL cuando whatsapp = teléfono', lineas.filter((l) => l.startsWith('TEL')).length === 1);
  check('el whatsapp va como perfil wa.me', lineas.includes('X-SOCIALPROFILE;TYPE=whatsapp:https://wa.me/573001234567'));
  // La URL con el UUID pasa de 75 octetos: se busca en el texto DESPLEGADO.
  check('la URL de la tarjeta (plegada)', v.replace(/\r\n /g, '').includes('\r\nURL:https://cdp.gecelca.com.co/carta_presentacion/' + p.id + '\r\n'));
  check('REV en UTC', lineas.includes('REV:2026-09-02T10:00:00Z'));
  check('sin PHOTO', !v.includes('PHOTO'));
  check('ninguna línea pasa de 75 octetos', lineas.every((l) => Buffer.byteLength(l) <= 75));

  const largo = generarVcard({ ...p, apellidos: 'Ñ'.repeat(90) }, 'https://x.co/y');
  const fisicas = largo.split('\r\n');
  check('un apellido de 90 ñ se pliega', fisicas.every((l) => Buffer.byteLength(l) <= 75) && fisicas.some((l) => l.startsWith(' ')));
  const desplegado = largo.replace(/\r\n /g, '');
  check('  y desplegado vuelve al valor entero', desplegado.includes('FN:María José ' + 'Ñ'.repeat(90)));
  check('plegar no parte un carácter UTF-8', plegar('é'.repeat(80)).split('\r\n').every((l) => Buffer.byteLength(l) <= 75 && !l.includes('�')));
  check('escaparVcard: barra, punto y coma, coma, salto', escaparVcard('a\\b;c,d\ne') === 'a\\\\b\\;c\\,d\\ne');
  const nombre = nombreArchivoVcard(p);
  check('nombre de archivo ASCII y UTF-8', nombre.ascii === 'Maria Jose Nunez; Rios, Ochoa.vcf' && decodeURIComponent(nombre.utf8) === 'María José Núñez; Ríos, Ochoa.vcf');
}

// ───────────────────────────────────────────────────────────────────────── foto
console.log('\nFoto: bytes que dicen la verdad, WebP ≤ 800, sha estable');
{
  const png1 = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
  const jpg300 = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#3355aa' } }).jpeg().toBuffer();
  const png2000 = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#aa5533' } }).png().toBuffer();
  const webp = await sharp({ create: { width: 250, height: 250, channels: 3, background: '#fff' } }).webp().toBuffer();

  check('magia: JPEG/PNG/WebP', tipoPorMagia(jpg300) === 'image/jpeg' && tipoPorMagia(png1) === 'image/png' && tipoPorMagia(webp) === 'image/webp');
  check('magia: GIF, SVG, PDF y RIFF sin WEBP → null',
    tipoPorMagia(Buffer.from('GIF89a' + 'x'.repeat(20))) === null &&
    tipoPorMagia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')) === null &&
    tipoPorMagia(Buffer.from('%PDF-1.4 ' + 'x'.repeat(20))) === null &&
    tipoPorMagia(Buffer.from('RIFF\0\0\0\0WAVEfmt ')) === null);

  const codigo = (p) => p.then(() => 'ok', (e) => (e instanceof FotoInvalida ? e.codigo : 'otro:' + e.message));
  check('un SVG se rechaza como tipo_no_admitido', (await codigo(procesarFoto(Buffer.from('<svg/>' + 'x'.repeat(20))))) === 'tipo_no_admitido');
  check('un PNG de 1×1 se rechaza por lado', (await codigo(procesarFoto(png1))) === 'foto_pequena');
  check('una cabecera JPEG truncada se rechaza', (await codigo(procesarFoto(jpg300.subarray(0, 40)))) === 'foto_invalida');

  const f = await procesarFoto(jpg300);
  check('300×450 → WebP con sus dimensiones', f.tipo === 'image/webp' && f.ancho === 300 && f.alto === 450 && tipoPorMagia(f.bytes) === 'image/webp');
  check('  sha256 = el de los bytes', f.sha256 === crypto.createHash('sha256').update(f.bytes).digest('hex'));
  const f2 = await procesarFoto(png2000);
  check('2000×1200 → cabe en 800', f2.ancho === 800 && f2.alto === 480);
  const metaOut = await sharp(f2.bytes).metadata();
  check('  sin EXIF ni ICC', !metaOut.exif && !metaOut.icc);

  // Bomba de píxeles: una cabecera PNG que declara 20000×20000 con casi nada detrás.
  const bomba = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 2, 0, 0, 0]), Buffer.alloc(64),
  ]);
  const cb = await codigo(procesarFoto(bomba));
  check('una cabecera de 20000×20000 se rechaza sin reservar memoria', cb === 'foto_invalida', cb);
}

// ───────────────────────────────────────────────────────────────────── guardias
console.log('\nGuardias: 401 sin sesión, 403 sin el rol, y solo con el rol en un array');
{
  const falso = (session) => {
    const res = { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let siguiente = false;
    const next = () => { siguiente = true; };
    return { req: { session }, res, next, paso: () => siguiente };
  };
  const ahora = new Date().toISOString();
  const hace13h = new Date(Date.now() - 13 * 3600 * 1000).toISOString();

  let t = falso(undefined); requiereSesion(t.req, t.res, t.next);
  check('sin sesión → 401 {authenticated:false}', !t.paso() && t.res.code === 401 && t.res.body?.authenticated === false);
  t = falso({ user: { oid: '', loginAt: ahora } }); requiereSesion(t.req, t.res, t.next);
  check('oid vacío → 401', !t.paso() && t.res.code === 401);
  t = falso({ user: { oid: 'x', loginAt: hace13h } }); requiereSesion(t.req, t.res, t.next);
  check('vida absoluta vencida → 401', !t.paso() && t.res.code === 401);
  t = falso({ user: { oid: 'x', loginAt: ahora } }); requiereSesion(t.req, t.res, t.next);
  check('sesión viva → pasa', t.paso());

  const rol = requiereRol('LOGIN_JEFA');
  t = falso({ user: { oid: 'x', roles: [] } }); rol(t.req, t.res, t.next);
  check('[] → 403 sin_rol', !t.paso() && t.res.code === 403 && t.res.body?.codigo === 'sin_rol');
  t = falso({ user: { oid: 'x', roles: 'LOGIN_JEFA' } }); rol(t.req, t.res, t.next);
  check("'LOGIN_JEFA' como cadena → 403 (afirmativo: solo array)", !t.paso() && t.res.code === 403);
  t = falso({ user: { oid: 'x', roles: ['OTRO'] } }); rol(t.req, t.res, t.next);
  check('otro rol → 403', !t.paso() && t.res.code === 403);
  t = falso({ user: { oid: 'x' } }); rol(t.req, t.res, t.next);
  check('sin roles → 403', !t.paso() && t.res.code === 403);
  t = falso({ user: { oid: 'x', roles: ['OTRO', 'LOGIN_JEFA'] } }); rol(t.req, t.res, t.next);
  check("['LOGIN_JEFA'] → pasa", t.paso());
}

// ─────────────────────────────────────────────────────────────────────────── OG
console.log('\nOpen Graph: apagado si faltan etiquetas; escapa; el resto byte-idéntico');
{
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const og = prepararOg(html);
  check('index.html trae lo necesario', og.activo, og.motivo || '');
  check('sin og:title queda apagado', !prepararOg(html.replace(/og:title/, 'og:otro')).activo);
  check('sin <title> queda apagado', !prepararOg(html.replace(/<title>[^<]*<\/title>/, '')).activo);

  const perfil = { id: '11111111-2222-4333-8444-555555555555', nombres: 'Ana "X"', apellidos: `O'Neil`, cargo: 'Jefa & CEO', area: null, foto: { etag: 'abcdef0123456789' } };
  const out = componerOg(og.plantilla, perfil, 'https://cdp.gecelca.com.co');
  check('<title> con nombre y cargo escapados', out.includes('<title>Ana &quot;X&quot; O&#39;Neil · Jefa &amp; CEO</title>'));
  check('og:image apunta a la foto con su etag corto', out.includes('content="https://cdp.gecelca.com.co/api/carta/perfiles/11111111-2222-4333-8444-555555555555/foto?v=abcdef01"'));
  check('og:url presente', out.includes('<meta property="og:url" content="https://cdp.gecelca.com.co/carta_presentacion/11111111-2222-4333-8444-555555555555" />'));
  check('sin foto cae a la imagen del hero', componerOg(og.plantilla, { ...perfil, foto: null }, 'https://o').includes('content="https://o/img/hero-matriz-energetica.webp"'));
  check('perfil nulo → null (index.html intacto)', componerOg(og.plantilla, null, 'https://o') === null);
  check('escapar cubre & < > " \'', escapar(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;');
  check('"><script> no sale crudo', !componerOg(og.plantilla, { ...perfil, nombres: '"><script>alert(1)</script>' }, 'https://o').includes('<script>alert'));
  // El resto del documento no cambia: se quitan las cinco etiquetas sustituidas y se compara.
  const pelar = (s) => s.replace(/<title>[^<]*<\/title>/, '').replace(/<meta\s+property="og:(title|description|image|url)"[\s\S]*?\/>/g, '').replace(/\s+/g, ' ');
  check('el resto del HTML es idéntico', pelar(out) === pelar(og.plantilla));
}

// ───────────────────────────────────────────────────── el directorio de Entra
console.log('\nDirectorio: la búsqueda se acota, el filtro escapa, la propuesta se normaliza');
{
  check('menos de 2 caracteres → nada', normalizarBusqueda('a') === null && normalizarBusqueda('  ') === null);
  check('61 caracteres → nada', normalizarBusqueda('a'.repeat(61)) === null);
  check('caracteres raros → nada', normalizarBusqueda('ana<b') === null && normalizarBusqueda('a$b') === null && normalizarBusqueda('a(b') === null);
  check('espacios repetidos colapsan', normalizarBusqueda('  Ana   Pérez ') === 'Ana Pérez');
  check("la comilla se duplica en el filtro OData", filtroDe("O'Neil").includes("startswith(displayName,'O''Neil')"));
  check('el filtro exige cuenta habilitada', filtroDe('x').endsWith('and accountEnabled eq true'));
  check('nombre partido: Graph manda nombres y apellidos', JSON.stringify(partirNombre({ givenName: 'Ana', surname: 'Pérez' })) === '{"nombres":"Ana","apellidos":"Pérez"}');
  check('  sin ellos, cuatro palabras → 2 + 2', JSON.stringify(partirNombre({ displayName: 'Ana Lucía Pérez Gómez' })) === '{"nombres":"Ana Lucía","apellidos":"Pérez Gómez"}');
  check('  tres palabras → 2 + 1', JSON.stringify(partirNombre({ displayName: 'Ana Pérez Gómez' })) === '{"nombres":"Ana Pérez","apellidos":"Gómez"}');
  const prop = aPropuesta({ id: 'u1', displayName: 'Ana Pérez', givenName: 'Ana', surname: 'Pérez', jobTitle: 'Jefa', department: 'Comunicaciones', mail: 'APerez@Gecelca.com.co', businessPhones: ['605 370 0000'], mobilePhone: '300 123 4567' });
  check('la propuesta normaliza correo y teléfonos a E.164', prop.correo === 'aperez@gecelca.com.co' && prop.telefono === '+576053700000' && prop.whatsapp === '+573001234567');
  const sinTel = aPropuesta({ id: 'u2', displayName: 'B C', mail: 'b@c.co', businessPhones: ['ext 123'], mobilePhone: 'no' });
  check('un teléfono que no se reconoce viaja vacío', sinTel.telefono === '' && sinTel.whatsapp === '');

  const llamadas = [];
  let respuesta = { ok: true, status: 200, json: async () => ({ value: [
    { id: 'u1', displayName: 'Zoe Vides', givenName: 'Zoe', surname: 'Vides', mail: 'z@gecelca.com.co', accountEnabled: true },
    { id: 'u2', displayName: 'Ana Vides', givenName: 'Ana', surname: 'Vides', mail: 'a@gecelca.com.co', accountEnabled: true },
    { id: 'u3', displayName: 'Deshabilitada Vides', mail: 'd@gecelca.com.co', accountEnabled: false },
    { id: 'u4', displayName: 'Sin Correo', accountEnabled: true },
  ] }) };
  const directorio = crearDirectorio({
    obtenerToken: async () => 'token-falso',
    baseUrl: 'https://graph.falso.invalid/v1.0',
    fetchImpl: async (url, init) => { llamadas.push({ url, init }); return respuesta; },
  });
  const r = await directorio.buscar('Vid');
  check('buscar devuelve solo habilitadas con correo, ordenadas por nombre', r.map((p) => p.nombre).join('|') === 'Ana Vides|Zoe Vides');
  check('  con el token en la cabecera y el filtro en la URL', llamadas[0].init.headers.Authorization === 'Bearer token-falso' && decodeURIComponent(llamadas[0].url).includes("startswith(displayName,'Vid')"));
  check('  y nunca $search', !llamadas[0].url.includes('$search'));
  check('buscar con texto inválido no llama a Graph', (await directorio.buscar('a')).length === 0 && llamadas.length === 1);
  respuesta = { ok: false, status: 403, json: async () => ({}) };
  const e = await directorio.buscar('Vid').then(() => null, (err) => err);
  check('Graph 403 → DirectorioNoDisponible(graph_403)', e instanceof DirectorioNoDisponible && e.codigo === 'graph_403');
  const sinToken = crearDirectorio({ obtenerToken: async () => { throw new Error('graph_sin_token'); }, fetchImpl: async () => respuesta });
  const e2 = await sinToken.buscar('Vid').then(() => null, (err) => err);
  check('sin token → DirectorioNoDisponible(sin_token)', e2 instanceof DirectorioNoDisponible && e2.codigo === 'sin_token');
}

// ─────────────────────────────────────────────────────────── la matriz HTTP
console.log('\nMatriz HTTP con repositorio falso y sesión inyectada por cabecera (solo en el arnés)');
{
  const ID = '11111111-2222-4333-8444-555555555555';
  const ID_SIN_FOTO = '22222222-2222-4333-8444-555555555555';
  const ID_INACTIVO = '33333333-2222-4333-8444-555555555555';
  const NADIE = '44444444-2222-4333-8444-555555555555';
  const fotoBytes = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#123456' } }).webp().toBuffer();
  const sha = crypto.createHash('sha256').update(fotoBytes).digest('hex');
  const base = (id, extra = {}) => ({
    id, nombres: 'Ana', apellidos: 'Pérez', cargo: 'Jefa', area: 'Comunicaciones', correo: `ana-${id.slice(0, 2)}@ejemplo.invalid`,
    telefono: '+573001234567', whatsapp: null,
    redes: { linkedin: null, instagram: null, x: null, facebook: null, youtube: null, tiktok: null, sitio_web: null },
    foto: id === ID ? { etag: sha } : null, ...extra,
  });
  const admin = (id, activo = true) => ({ ...base(id), activo, creado_en: '2026-09-02T00:00:00.000Z', actualizado_en: '2026-09-02T00:00:00.000Z', foto: id === ID ? { etag: sha, ancho: 300, alto: 300, bytes: fotoBytes.length } : null });
  let caida = false;
  const llamadas = [];
  const repositorio = {
    async obtenerPublico(id) { if (caida) throw new BdNoDisponible('ETIMEOUT'); return id === ID || id === ID_SIN_FOTO ? base(id) : null; },
    async leerFotoSha(id) { return id === ID ? sha : null; },
    async leerFoto(id) { return id === ID ? { tipo: 'image/webp', sha256: sha, bytes: fotoBytes.length, contenido: fotoBytes } : null; },
    async listar({ estado }) { llamadas.push(['listar', estado]); return [{ id: ID, nombre: 'Ana Pérez', cargo: 'Jefa', area: null, correo: 'a@b.co', activo: true, foto: true, actualizado_en: 'x' }]; },
    async obtenerAdmin(id) { return [ID, ID_INACTIVO].includes(id) ? { perfil: admin(id, id === ID), auditoria: [] } : null; },
    async crear(valor, actor) { llamadas.push(['crear', valor.correo, actor.oid]); if (valor.correo === 'dup@ejemplo.invalid') throw new CorreoDuplicado(); return { perfil: admin(ID), auditoria: [] }; },
    async actualizar(id, valor, actor) { llamadas.push(['actualizar', id, actor.oid]); return id === ID ? { perfil: admin(ID), auditoria: [] } : null; },
    async cambiarEstado(id, activo) { llamadas.push(['estado', id, activo]); return id === ID ? { id, activo } : null; },
    async guardarFoto(id, foto) { llamadas.push(['foto', id, foto.ancho]); return id === ID ? { etag: foto.sha256, ancho: foto.ancho, alto: foto.alto, bytes: foto.bytes.length } : null; },
    async quitarFoto(id) { llamadas.push(['quitar', id]); return id === ID ? true : null; },
  };
  const paso = (req, res, next) => next();
  const guardias = { soloRol: (rol) => [requiereSesion, requiereRol(rol)] };
  const limites = { publico: paso, admin: paso, foto: paso };
  const app = express();
  app.set('trust proxy', 'loopback');
  // La sesión la inyecta la cabecera `x-sesion-prueba` SOLO en este arnés: en el servidor real
  // la pone express-session desde la cookie. Y el CSRF equivalente al de app.js.
  app.use((req, res, next) => {
    const s = req.get('x-sesion-prueba');
    req.session = s ? JSON.parse(s) : undefined;
    next();
  });
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const sitio = req.get('sec-fetch-site');
    if (sitio === 'same-origin' || sitio === 'none') return next();
    return res.status(403).json({ error: 'Origen no permitido', codigo: 'origen_no_permitido' });
  });
  let directorioCaido = false;
  const directorio = {
    async buscar(q) {
      if (directorioCaido) throw new DirectorioNoDisponible('graph_503');
      return String(q || '').startsWith('Ste') ? [{ id: 'u1', nombre: 'Stefany Vides', nombres: 'Stefany', apellidos: 'Vides', cargo: 'Jefa', area: '', correo: 's@gecelca.com.co', telefono: '', whatsapp: '' }] : [];
    },
  };
  app.use('/api/carta', crearRutasCarta({ repositorio, guardias, limites, cfg: { rolAdmin: 'LOGIN_JEFA' }, origen: 'https://cdp.gecelca.com.co', directorio }));
  app.use((req, res) => res.status(404).json({ error: 'No encontrado', codigo: 'no_encontrado' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: 'Error interno', codigo: 'error_interno' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const puerto = server.address().port;

  const SESION_ADMIN = JSON.stringify({ user: { oid: 'oid-jefa', upn: 'jefa@gecelca.com.co', roles: ['LOGIN_JEFA'], loginAt: new Date().toISOString() } });
  const SESION_SIN_ROL = JSON.stringify({ user: { oid: 'oid-otro', upn: 'otro@gecelca.com.co', roles: [], loginAt: new Date().toISOString() } });

  function pedir(ruta, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: puerto, path: ruta, method, headers }, (res) => {
        const trozos = [];
        res.on('data', (d) => trozos.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(trozos);
          let json = null;
          try { json = JSON.parse(buf.toString('utf8')); } catch { /* no es JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, buf, json, texto: buf.toString('utf8') });
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
  const json = (obj, extra = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra }, body: JSON.stringify(obj) });
  const perfilValido = { nombres: 'Ana', apellidos: 'Pérez', cargo: 'Jefa', correo: 'ana@ejemplo.invalid' };

  console.log('  público');
  {
    const r = await pedir(`/api/carta/perfiles/${ID}`);
    check('GET perfil activo → 200 con nombre, foto.url, url', r.status === 200 && r.json.nombre === 'Ana Pérez' && r.json.foto.url === `/api/carta/perfiles/${ID}/foto` && r.json.url === `https://cdp.gecelca.com.co/carta_presentacion/${ID}`);
    check('  no-store', (r.headers['cache-control'] || '').includes('no-store'));
    check('  sin activo, sin fechas, sin auditoría', !('activo' in r.json) && !('creado_en' in r.json) && !('auditoria' in r.json));
    check('  sin cookie', r.headers['set-cookie'] === undefined);
    const m = await pedir(`/api/carta/perfiles/${ID.toUpperCase()}`);
    check('el id en mayúsculas resuelve igual', m.status === 200);
    const n = await pedir(`/api/carta/perfiles/${NADIE}`);
    check('inexistente → 404 uniforme', n.status === 404 && n.json.codigo === 'no_encontrado');
    check('  sin nombre, correo ni arroba', !/nombre|correo|@/.test(n.texto));
    const i = await pedir(`/api/carta/perfiles/${ID_INACTIVO}`);
    check('inactivo → 404 idéntico', i.status === 404 && i.texto === n.texto);
    const mal = await pedir('/api/carta/perfiles/not-a-uuid');
    check('id mal formado → 404 sin tocar el repositorio', mal.status === 404);
    const v1 = await pedir(`/api/carta/perfiles/${'1'.repeat(8)}-2222-1333-8444-555555555555`);
    check('un UUID que no es v4 → 404', v1.status === 404);
    const lista = await pedir('/api/carta/perfiles');
    check('GET /perfiles (listado público) no existe', lista.status === 404);
    const post = await pedir('/api/carta/perfiles', json(perfilValido));
    check('POST público no existe', post.status === 404);

    const f = await pedir(`/api/carta/perfiles/${ID}/foto`);
    check('foto → 200 image/webp con ETag', f.status === 200 && f.headers['content-type'] === 'image/webp' && f.headers.etag === `"${sha}"` && f.buf.equals(fotoBytes));
    check('  private, no-cache', f.headers['cache-control'] === 'private, no-cache');
    const f304 = await pedir(`/api/carta/perfiles/${ID}/foto`, { headers: { 'if-none-match': `"${sha}"` } });
    check('If-None-Match → 304 sin cuerpo', f304.status === 304 && f304.buf.length === 0);
    const f304w = await pedir(`/api/carta/perfiles/${ID}/foto`, { headers: { 'if-none-match': `W/"${sha}", "otro"` } });
    check('  también débil y en lista', f304w.status === 304);
    const sinFoto = await pedir(`/api/carta/perfiles/${ID_SIN_FOTO}/foto`);
    check('perfil sin foto → 404 JSON', sinFoto.status === 404 && sinFoto.json?.codigo === 'no_encontrado');
    const fi = await pedir(`/api/carta/perfiles/${ID_INACTIVO}/foto`);
    check('foto de inactivo → 404', fi.status === 404);

    const vc = await pedir(`/api/carta/perfiles/${ID}/vcard`);
    check('vcard → text/vcard adjunto', vc.status === 200 && vc.headers['content-type'].startsWith('text/vcard') && /^attachment; filename="Ana Perez\.vcf"; filename\*=UTF-8''Ana%20P%C3%A9rez\.vcf$/.test(vc.headers['content-disposition']));
    check('  con N y FN', vc.texto.includes('N:Pérez;Ana;;;') && vc.texto.includes('FN:Ana Pérez'));
    const vcn = await pedir(`/api/carta/perfiles/${NADIE}/vcard`, { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
    check('vcard de nadie, navegado → 404 JSON (nunca HTML)', vcn.status === 404 && vcn.headers['content-type'].includes('json'));

    caida = true;
    const c = await pedir(`/api/carta/perfiles/${ID}`);
    check('BD caída → 503 + Retry-After', c.status === 503 && c.json.codigo === 'bd_no_disponible' && c.headers['retry-after'] === '10');
    caida = false;
  }

  console.log('  admin');
  {
    const sin = await pedir('/api/carta/admin/perfiles');
    check('sin sesión → 401 {authenticated:false}', sin.status === 401 && sin.json.authenticated === false);
    const sinRol = await pedir('/api/carta/admin/perfiles', { headers: { 'x-sesion-prueba': SESION_SIN_ROL } });
    check('con sesión sin rol → 403 sin_rol', sinRol.status === 403 && sinRol.json.codigo === 'sin_rol');
    const A = { 'x-sesion-prueba': SESION_ADMIN };
    const l = await pedir('/api/carta/admin/perfiles?estado=todos', { headers: A });
    check('listar → 200 {perfiles,total}', l.status === 200 && l.json.total === 1 && llamadas.at(-1)[1] === 'todos');
    const lmal = await pedir('/api/carta/admin/perfiles?estado=otros', { headers: A });
    check('estado inválido → 400', lmal.status === 400 && lmal.json.campos.estado === 'formato');
    const d = await pedir(`/api/carta/admin/perfiles/${ID_INACTIVO}`, { headers: A });
    check('detalle admin de un inactivo → 200 con activo:false y auditoria', d.status === 200 && d.json.perfil.activo === false && Array.isArray(d.json.auditoria));
    const dn = await pedir(`/api/carta/admin/perfiles/${NADIE}`, { headers: A });
    check('detalle de nadie → 404', dn.status === 404);

    const dirSin = await pedir('/api/carta/admin/directorio?q=Ste');
    check('directorio sin sesión → 401', dirSin.status === 401);
    const dirRol = await pedir('/api/carta/admin/directorio?q=Ste', { headers: { 'x-sesion-prueba': SESION_SIN_ROL } });
    check('directorio sin rol → 403', dirRol.status === 403);
    const dir = await pedir('/api/carta/admin/directorio?q=Ste', { headers: A });
    check('directorio con rol → 200 {personas}', dir.status === 200 && dir.json.personas.length === 1 && dir.json.personas[0].correo === 's@gecelca.com.co');
    check('  no-store', (dir.headers['cache-control'] || '').includes('no-store'));
    const dirVacio = await pedir('/api/carta/admin/directorio?q=zz', { headers: A });
    check('  sin coincidencias → lista vacía', dirVacio.status === 200 && dirVacio.json.personas.length === 0);
    directorioCaido = true;
    const dirCaido = await pedir('/api/carta/admin/directorio?q=Ste', { headers: A });
    check('  Graph caído → 503 directorio_no_disponible', dirCaido.status === 503 && dirCaido.json.codigo === 'directorio_no_disponible');
    directorioCaido = false;
    const dirPost = await pedir('/api/carta/admin/directorio', json({ q: 'Ste' }, A));
    check('  POST no existe', dirPost.status === 404);

    const cx = await pedir('/api/carta/admin/perfiles', json(perfilValido, { 'x-sesion-prueba': SESION_ADMIN, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }));
    check('POST cross-site → 403 (CSRF)', cx.status === 403);
    const c401 = await pedir('/api/carta/admin/perfiles', json(perfilValido));
    check('POST same-origin sin sesión → 401', c401.status === 401);
    const c = await pedir('/api/carta/admin/perfiles', json(perfilValido, A));
    check('POST válido → 201 {perfil} con el actor de la sesión', c.status === 201 && c.json.perfil.id === ID && llamadas.at(-1)[2] === 'oid-jefa');
    const c400 = await pedir('/api/carta/admin/perfiles', json({ ...perfilValido, correo: 'x', linkedin: 'https://evil.com' }, A));
    check('POST inválido → 400 con campos', c400.status === 400 && c400.json.codigo === 'datos_invalidos' && c400.json.campos.correo === 'formato' && c400.json.campos.linkedin === 'dominio_no_permitido');
    const c409 = await pedir('/api/carta/admin/perfiles', json({ ...perfilValido, correo: 'dup@ejemplo.invalid' }, A));
    check('correo duplicado → 409', c409.status === 409 && c409.json.codigo === 'correo_duplicado' && c409.json.campos.correo === 'duplicado');
    const cjson = await pedir('/api/carta/admin/perfiles', { ...json({}, A), body: '{no es json' });
    check('JSON roto → 400 json_invalido', cjson.status === 400 && cjson.json.codigo === 'json_invalido');
    const c413 = await pedir('/api/carta/admin/perfiles', { ...json({}, A), body: JSON.stringify({ ...perfilValido, area: 'x'.repeat(20000) }) });
    check('cuerpo > 16 KB → 413', c413.status === 413 && c413.json.codigo === 'cuerpo_demasiado_grande');
    const ctipo = await pedir('/api/carta/admin/perfiles', { method: 'POST', headers: { ...A, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' }, body: 'hola' });
    check('POST sin JSON → 400 (cuerpo vacío no valida)', ctipo.status === 400);

    const put = await pedir(`/api/carta/admin/perfiles/${ID}`, { ...json(perfilValido, A), method: 'PUT' });
    check('PUT válido → 200', put.status === 200 && put.json.perfil.id === ID);
    const putn = await pedir(`/api/carta/admin/perfiles/${NADIE}`, { ...json(perfilValido, A), method: 'PUT' });
    check('PUT a nadie → 404', putn.status === 404);
    const est = await pedir(`/api/carta/admin/perfiles/${ID}/estado`, { ...json({ activo: false }, A), method: 'PUT' });
    check('PUT estado → 200 {id, activo:false}', est.status === 200 && est.json.activo === false);
    const estMal = await pedir(`/api/carta/admin/perfiles/${ID}/estado`, { ...json({ activo: 'no' }, A), method: 'PUT' });
    check('estado no booleano → 400', estMal.status === 400);

    const multipart = (campo, nombre, tipo, bytes) => {
      const b = 'gtalksfrontera' + crypto.randomBytes(6).toString('hex');
      const cab = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nombre}"\r\nContent-Type: ${tipo}\r\n\r\n`);
      const fin = Buffer.from(`\r\n--${b}--\r\n`);
      return { body: Buffer.concat([cab, bytes, fin]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
    };
    const jpg = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#224488' } }).jpeg().toBuffer();
    const mp = multipart('foto', 'a.jpg', 'image/jpeg', jpg);
    const fo = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...mp.headers }, body: mp.body });
    check('PUT foto → 200 {foto:{etag,ancho,alto,bytes,url}}', fo.status === 200 && fo.json.foto.ancho === 400 && fo.json.foto.url.endsWith('/foto') && /^[0-9a-f]{64}$/.test(fo.json.foto.etag));
    const svg = multipart('foto', 'a.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"/>'));
    const fsvg = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...svg.headers }, body: svg.body });
    check('un SVG disfrazado → 415', fsvg.status === 415 && fsvg.json.codigo === 'tipo_no_admitido');
    const chica = multipart('foto', 'a.png', 'image/png', await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } }).png().toBuffer());
    const fch = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...chica.headers }, body: chica.body });
    check('una foto de 50 px → 400 foto_pequena', fch.status === 400 && fch.json.codigo === 'foto_pequena');
    const gorda = multipart('foto', 'a.jpg', 'image/jpeg', Buffer.concat([jpg, Buffer.alloc(5 * 1024 * 1024)]));
    const fg = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...gorda.headers }, body: gorda.body });
    check('más de 5 MB → 413 foto_demasiado_grande', fg.status === 413 && fg.json.codigo === 'foto_demasiado_grande');
    const otroCampo = multipart('archivo', 'a.jpg', 'image/jpeg', jpg);
    const foc = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...otroCampo.headers }, body: otroCampo.body });
    check('otro nombre de campo → 400 formulario_invalido', foc.status === 400 && foc.json.codigo === 'formulario_invalido');
    const fsin = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...mp.headers }, body: mp.body.subarray(0, 0) });
    check('multipart vacío → 400', fsin.status === 400);
    const fn = await pedir(`/api/carta/admin/perfiles/${NADIE}/foto`, { method: 'PUT', headers: { ...A, 'sec-fetch-site': 'same-origin', ...mp.headers }, body: mp.body });
    check('foto a nadie → 404', fn.status === 404);
    const del = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'DELETE', headers: { ...A, 'sec-fetch-site': 'same-origin' } });
    check('DELETE foto → 200 {ok:true}', del.status === 200 && del.json.ok === true);
    const deln = await pedir(`/api/carta/admin/perfiles/${NADIE}/foto`, { method: 'DELETE', headers: { ...A, 'sec-fetch-site': 'same-origin' } });
    check('DELETE foto de nadie → 404', deln.status === 404);
    const delx = await pedir(`/api/carta/admin/perfiles/${ID}/foto`, { method: 'DELETE', headers: { ...A, 'sec-fetch-site': 'cross-site' } });
    check('DELETE cross-site → 403', delx.status === 403);
    const otra = await pedir('/api/carta/admin/otra-cosa', { headers: A });
    check('lo que no existe bajo /admin → 404 JSON', otra.status === 404 && otra.json.codigo === 'no_encontrado');
    const raiz = await pedir('/api/carta/', { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
    check('/api/carta/ navegado → 404 JSON, nunca HTML', raiz.status === 404 && raiz.headers['content-type'].includes('json'));
  }

  server.close();
}

console.log(fallos === 0 ? '\nCarta (servidor, puro): todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`);
process.exit(fallos === 0 ? 0 : 1);
