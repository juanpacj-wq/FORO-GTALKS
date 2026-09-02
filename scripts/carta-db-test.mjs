// Verificación del repositorio de la carta CONTRA LA BASE DE DATOS DE DESARROLLO (PortalG3_dev).
// Sale con código 1 si algo falla. Limpia lo que crea, pase lo que pase.
//
//   node --env-file=.env scripts/carta-db-test.mjs
//
// Se niega a correr si DB_NAME no termina en `_dev`: crea y borra filas, y eso no se ensaya en
// producción. Los perfiles de prueba llevan `creado_por = 'carta-db-test'` y correos
// `@ejemplo.invalid`, y el `finally` los borra por ese marcador (perfil, foto por cascada, y
// las filas de auditoría de esos ids).
import crypto from 'node:crypto';
import sharp from 'sharp';

import { leerConfiguracionCarta } from '../server/carta/config.js';
import { BdNoDisponible, crearBd, sql } from '../server/carta/bd.js';
import { estadoMigraciones } from '../server/carta/migraciones.js';
import { CorreoDuplicado, crearRepositorio } from '../server/carta/repositorio.js';
import { procesarFoto } from '../server/carta/foto.js';

let fallos = 0;
function check(nombre, ok, detalle = '') {
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` ${detalle}` : ''}`);
  if (!ok) fallos++;
}

const cfg = leerConfiguracionCarta();
if (!cfg.activa) {
  console.error('Faltan las DB_* en el entorno.');
  process.exit(2);
}
if (!/_dev$/i.test(cfg.bd.nombre)) {
  console.error(`DB_NAME=${cfg.bd.nombre} no termina en _dev: este arnés crea y borra filas y no corre ahí.`);
  process.exit(2);
}

const ACTOR = { oid: 'carta-db-test', upn: 'carta-db-test@ejemplo.invalid', ip: '127.0.0.1' };
const sufijo = crypto.randomBytes(3).toString('hex');
const bd = crearBd(cfg.bd);
const repo = crearRepositorio(bd);
const creados = [];

try {
  console.log(`\n${cfg.bd.nombre}: migraciones y CRUD real\n`);
  const pool = await bd.conectar();
  const m = await estadoMigraciones(pool);
  check('las migraciones están al día', m.estado === 'al_dia', m.estado);
  check('el estado de la BD es ok', bd.estado() === 'ok');

  const base = (n) => ({
    nombres: `Prueba ${n}`, apellidos: 'Carta Ñandú', cargo: 'Cargo de prueba', area: n === 1 ? 'Área de prueba' : null,
    correo: `carta-db-test-${sufijo}-${n}@ejemplo.invalid`, telefono: '+573001234567', whatsapp: n === 1 ? '+573009876543' : null,
    linkedin: 'https://www.linkedin.com/in/prueba', instagram: null, x: null, facebook: null, youtube: null, tiktok: null,
    sitio_web: n === 1 ? 'https://www.gecelca.com.co/' : null,
  });

  console.log('\nCrear');
  const c1 = await repo.crear(base(1), ACTOR);
  creados.push(c1.perfil.id);
  check('crear devuelve el perfil admin con id v4 en minúsculas', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(c1.perfil.id));
  check('  activo por defecto, sin foto', c1.perfil.activo === true && c1.perfil.foto === null);
  check('  con los campos y las redes', c1.perfil.area === 'Área de prueba' && c1.perfil.redes.linkedin === 'https://www.linkedin.com/in/prueba' && c1.perfil.redes.sitio_web === 'https://www.gecelca.com.co/');
  check('  las fechas van en ISO', /^\d{4}-\d{2}-\d{2}T/.test(c1.perfil.creado_en));
  const c2 = await repo.crear(base(2), ACTOR);
  creados.push(c2.perfil.id);
  check('un segundo perfil', c2.perfil.id !== c1.perfil.id);
  let dup = null;
  try { await repo.crear(base(1), ACTOR); } catch (e) { dup = e; }
  check('el correo repetido lanza CorreoDuplicado', dup instanceof CorreoDuplicado);

  console.log('\nLeer');
  const pub = await repo.obtenerPublico(c1.perfil.id);
  check('el público devuelve el activo', pub?.id === c1.perfil.id && pub.nombres === 'Prueba 1');
  check('  sin activo, sin fechas', !('activo' in pub) && !('creado_en' in pub));
  check('  foto null', pub.foto === null);
  const pubMayus = await repo.obtenerPublico(c1.perfil.id.toUpperCase());
  check('  el id en mayúsculas resuelve y sale en minúsculas', pubMayus?.id === c1.perfil.id);
  const lista = await repo.listar({ estado: 'activos' });
  check('listar activos incluye los dos', creados.every((id) => lista.some((p) => p.id === id)));
  check('  con nombre compuesto y foto:false', lista.find((p) => p.id === c1.perfil.id)?.nombre === 'Prueba 1 Carta Ñandú' && lista.find((p) => p.id === c1.perfil.id)?.foto === false);
  const nadie = await repo.obtenerPublico(crypto.randomUUID());
  check('un id inexistente → null', nadie === null);

  console.log('\nFoto');
  const jpg = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const foto = await procesarFoto(jpg);
  const g = await repo.guardarFoto(c1.perfil.id, foto, ACTOR);
  check('guardarFoto devuelve la ficha', g.etag === foto.sha256 && g.ancho === 600 && g.alto === 800 && g.bytes === foto.bytes.length);
  check('leerFotoSha da el sha', (await repo.leerFotoSha(c1.perfil.id)) === foto.sha256);
  const leida = await repo.leerFoto(c1.perfil.id);
  check('leerFoto devuelve los MISMOS bytes', leida?.contenido?.equals(foto.bytes) && leida.tipo === 'image/webp');
  check('el público ahora anuncia la foto', (await repo.obtenerPublico(c1.perfil.id)).foto?.etag === foto.sha256);
  const foto2 = await procesarFoto(await sharp({ create: { width: 400, height: 400, channels: 3, background: '#996633' } }).jpeg().toBuffer());
  const g2 = await repo.guardarFoto(c1.perfil.id, foto2, ACTOR);
  check('reemplazar la foto cambia el sha', g2.etag === foto2.sha256 && g2.etag !== g.etag);
  check('guardarFoto a nadie → null', (await repo.guardarFoto(crypto.randomUUID(), foto, ACTOR)) === null);

  console.log('\nActualizar y desactivar');
  const act = await repo.actualizar(c1.perfil.id, { ...base(1), cargo: 'Cargo editado', area: null }, ACTOR);
  check('actualizar devuelve lo nuevo', act.perfil.cargo === 'Cargo editado' && act.perfil.area === null);
  check('  y conserva la foto', act.perfil.foto?.etag === foto2.sha256);
  let dup2 = null;
  try { await repo.actualizar(c2.perfil.id, base(1), ACTOR); } catch (e) { dup2 = e; }
  check('actualizar al correo de otro → CorreoDuplicado', dup2 instanceof CorreoDuplicado);
  check('actualizar a nadie → null', (await repo.actualizar(crypto.randomUUID(), base(1), ACTOR)) === null);
  const off = await repo.cambiarEstado(c1.perfil.id, false, ACTOR);
  check('desactivar → {id, activo:false}', off.id === c1.perfil.id && off.activo === false);
  check('  el público ya no lo ve', (await repo.obtenerPublico(c1.perfil.id)) === null);
  check('  ni su foto', (await repo.leerFotoSha(c1.perfil.id)) === null && (await repo.leerFoto(c1.perfil.id)) === null);
  check('  el admin sí', (await repo.obtenerAdmin(c1.perfil.id)).perfil.activo === false);
  check('  listar inactivos lo incluye', (await repo.listar({ estado: 'inactivos' })).some((p) => p.id === c1.perfil.id));
  check('  listar activos no', !(await repo.listar({ estado: 'activos' })).some((p) => p.id === c1.perfil.id));
  const on = await repo.cambiarEstado(c1.perfil.id, true, ACTOR);
  check('reactivar', on.activo === true && (await repo.obtenerPublico(c1.perfil.id)) !== null);

  console.log('\nAuditoría');
  const det = await repo.obtenerAdmin(c1.perfil.id);
  const acciones = det.auditoria.map((a) => a.accion);
  // crear, foto_subir ×2, editar, desactivar, activar = 6. Los dos intentos de correo duplicado
  // NO cuentan: su transacción se deshizo entera, con la fila de auditoría dentro.
  check('hay una fila por mutación (6), y ninguna de las transacciones deshechas', det.auditoria.length === 6, JSON.stringify(acciones));
  check('  en orden inverso', acciones.join() === 'activar,desactivar,editar,foto_subir,foto_subir,crear', JSON.stringify(acciones));
  check('  con el actor', det.auditoria.every((a) => a.actor === ACTOR.upn));
  check('  el detalle de editar dice los campos, no los valores', JSON.stringify(det.auditoria.find((a) => a.accion === 'editar').detalle) === '{"campos":["cargo","area"]}');
  check('  ningún detalle contiene un valor', !det.auditoria.some((a) => JSON.stringify(a.detalle || '').includes('Cargo editado')));
  const filas = await bd.consulta((q) => q.input('id', sql.UniqueIdentifier, c1.perfil.id).query('SELECT ip, actor_oid FROM carta.auditoria WHERE perfil_id = @id'));
  check('  la IP y el oid quedan en la tabla', filas.recordset.every((f) => f.ip === '127.0.0.1' && f.actor_oid === 'carta-db-test'));

  console.log('\nQuitar foto');
  check('quitarFoto → true', (await repo.quitarFoto(c1.perfil.id, ACTOR)) === true);
  check('  y otra vez → false', (await repo.quitarFoto(c1.perfil.id, ACTOR)) === false);
  check('  a nadie → null', (await repo.quitarFoto(crypto.randomUUID(), ACTOR)) === null);
  check('  el público sin foto', (await repo.obtenerPublico(c1.perfil.id)).foto === null);

  console.log('\nBD inalcanzable');
  const rota = crearBd({ ...cfg.bd, puerto: 1, host: '127.0.0.1' });
  const repoRoto = crearRepositorio(rota);
  let e1 = null;
  const t0 = Date.now();
  try { await repoRoto.obtenerPublico(c1.perfil.id); } catch (e) { e1 = e; }
  check('con el puerto cerrado lanza BdNoDisponible', e1 instanceof BdNoDisponible, e1?.message);
  let e2 = null;
  const t1 = Date.now();
  try { await repoRoto.obtenerPublico(c1.perfil.id); } catch (e) { e2 = e; }
  check('  y la segunda vez el cortacircuitos responde en el acto', e2 instanceof BdNoDisponible && Date.now() - t1 < 200, `${Date.now() - t1} ms (la primera tardó ${t1 - t0} ms)`);
  check('  estado no_disponible', rota.estado() === 'no_disponible');
  await rota.cerrar();
} catch (err) {
  console.error('\nERROR inesperado:', err);
  fallos++;
} finally {
  // Limpieza: por el marcador del actor, y también por si algo quedó de una corrida anterior.
  try {
    const r = await bd.consulta((q) =>
      q.input('actor', sql.NVarChar(64), ACTOR.oid).query(
        'DELETE FROM carta.auditoria WHERE actor_oid = @actor; ' +
        'DELETE FROM carta.perfil WHERE creado_por = @actor; ' +
        'SELECT COUNT(*) AS n FROM carta.perfil WHERE creado_por = @actor',
      ),
    );
    const quedan = r.recordsets.at(-1)[0].n;
    check('limpieza: no queda ningún perfil de prueba', quedan === 0, String(quedan));
  } catch (err) {
    console.error('limpieza fallida:', err.message);
    fallos++;
  }
  await bd.cerrar();
}

console.log(fallos === 0 ? '\nCarta (BD de desarrollo): todo en orden.\n' : `\n${fallos} verificación(es) fallaron.\n`);
process.exit(fallos === 0 ? 0 : 1);
