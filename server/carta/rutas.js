/**
 * La superficie HTTP de la carta de presentación, montada en `/api/carta`.
 *
 * Pública (sin sesión, sin cookie):
 *   GET /perfiles/:id            la tarjeta (solo activos; 404 uniforme para lo demás)
 *   GET /perfiles/:id/foto       image/webp con ETag = sha256; If-None-Match → 304 sin leer el blob
 *   GET /perfiles/:id/vcard      text/vcard como adjunto
 *   nada más: no hay listado público ni mutadores públicos.
 *
 * Admin (soloRol(cfg.rolAdmin): revalidar → sesión → rol):
 *   GET    /admin/perfiles?estado=activos|inactivos|todos
 *   GET    /admin/perfiles/:id
 *   POST   /admin/perfiles                 JSON → 201
 *   PUT    /admin/perfiles/:id             JSON, reemplazo completo
 *   PUT    /admin/perfiles/:id/estado      {activo: boolean}
 *   PUT    /admin/perfiles/:id/foto        multipart `foto`
 *   DELETE /admin/perfiles/:id/foto
 *
 * Transversal: JSON `no-store`; ids validados con regex ANTES de tocar la BD; los cuerpos JSON
 * se parsean SOLO aquí (app.js no monta ningún parser) y con tope de 16 KB; multer solo en la
 * foto, en memoria, 5 MB y un único archivo. El CSRF global de app.js ya cubre POST/PUT/DELETE.
 * El mapa de errores propio va antes del genérico: 413, 400, 415, 409, 503 con Retry-After.
 *
 * Se construye por inyección (`crearRutasCarta({repositorio, guardias, limites, cfg})`) para
 * que scripts/carta-server-test.mjs la levante con un repositorio falso y una sesión simulada.
 */
import express from 'express';
import multer from 'multer';

import { BdNoDisponible } from './bd.js';
import { CorreoDuplicado } from './repositorio.js';
import { esUuid, validarEstado, validarPerfil } from './validacion.js';
import { FotoInvalida, PESO_MAXIMO_SUBIDA, procesarFoto } from './foto.js';
import { generarVcard, nombreArchivoVcard } from './vcard.js';

const noEncontrado = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({ error: 'No encontrado', codigo: 'no_encontrado' });
};

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Comprueba el `:id` contra el regex de UUID v4 antes de que nadie lo mire. */
function conId(req, res, next) {
  const id = String(req.params.id || '').toLowerCase();
  if (!esUuid(id)) return noEncontrado(res);
  req.perfilId = id;
  next();
}

function actorDe(req) {
  const u = req.session?.user || {};
  return { oid: String(u.oid || ''), upn: String(u.upn || u.email || ''), ip: req.ip || null };
}

export function crearRutasCarta({ repositorio, guardias, limites, cfg, origen, procesar = procesarFoto }) {
  const router = express.Router();
  const urlDe = (id) => `${origen}/carta_presentacion/${id}`;
  const fotoDe = (perfil) =>
    perfil.foto ? { ...perfil.foto, url: `/api/carta/perfiles/${perfil.id}/foto` } : null;

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ── Público ─────────────────────────────────────────────────────────────
  const publico = express.Router();
  publico.use(limites.publico);

  publico.get('/perfiles/:id', conId, asyncH(async (req, res) => {
    const p = await repositorio.obtenerPublico(req.perfilId);
    if (!p) return noEncontrado(res);
    res.json({ ...p, nombre: `${p.nombres} ${p.apellidos}`, foto: fotoDe(p), url: urlDe(p.id) });
  }));

  publico.get('/perfiles/:id/foto', conId, asyncH(async (req, res) => {
    const sha = await repositorio.leerFotoSha(req.perfilId);
    if (!sha) return noEncontrado(res);
    const etag = `"${sha}"`;
    res.setHeader('ETag', etag);
    // `private, no-cache`: el navegador la guarda y REVALIDA cada vez (el 304 es barato), y
    // ninguna caché compartida se queda con la foto de una tarjeta que luego se retire.
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const pedido = String(req.get('if-none-match') || '');
    if (pedido.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) {
      return res.status(304).end();
    }
    const foto = await repositorio.leerFoto(req.perfilId);
    if (!foto) return noEncontrado(res);
    res.setHeader('Content-Type', foto.tipo);
    res.setHeader('Content-Length', String(foto.contenido.length));
    res.setHeader('Content-Disposition', 'inline; filename="foto.webp"');
    res.end(foto.contenido);
  }));

  publico.get('/perfiles/:id/vcard', conId, asyncH(async (req, res) => {
    const p = await repositorio.obtenerPublico(req.perfilId);
    if (!p) return noEncontrado(res);
    const nombre = nombreArchivoVcard(p);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre.ascii}"; filename*=UTF-8''${nombre.utf8}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(generarVcard(p, urlDe(p.id)));
  }));

  router.use(publico);

  // ── Admin ────────────────────────────────────────────────────────────────
  const admin = express.Router();
  admin.use(...guardias.soloRol(cfg.rolAdmin));
  admin.use(limites.admin);
  const json = express.json({ limit: '16kb', strict: true, type: 'application/json' });
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PESO_MAXIMO_SUBIDA, files: 1, fields: 0, parts: 2 },
    fileFilter: (req, file, cb) => {
      if (file.fieldname !== 'foto') return cb(Object.assign(new Error('campo'), { code: 'LIMIT_UNEXPECTED_FILE' }));
      cb(null, true);
    },
  });

  admin.get('/perfiles', asyncH(async (req, res) => {
    const estado = String(req.query.estado || 'activos');
    if (!['activos', 'inactivos', 'todos'].includes(estado)) {
      return res.status(400).json({ error: 'Datos inválidos', codigo: 'datos_invalidos', campos: { estado: 'formato' } });
    }
    const perfiles = await repositorio.listar({ estado });
    res.json({ perfiles, total: perfiles.length });
  }));

  admin.get('/perfiles/:id', conId, asyncH(async (req, res) => {
    const r = await repositorio.obtenerAdmin(req.perfilId);
    if (!r) return noEncontrado(res);
    res.json({ perfil: { ...r.perfil, foto: fotoDe(r.perfil), url: urlDe(r.perfil.id) }, auditoria: r.auditoria });
  }));

  admin.post('/perfiles', json, asyncH(async (req, res) => {
    const { valor, campos } = validarPerfil(req.body);
    if (!valor) return res.status(400).json({ error: 'Datos inválidos', codigo: 'datos_invalidos', campos });
    const r = await repositorio.crear(valor, actorDe(req));
    res.status(201).json({ perfil: { ...r.perfil, foto: fotoDe(r.perfil), url: urlDe(r.perfil.id) } });
  }));

  admin.put('/perfiles/:id', conId, json, asyncH(async (req, res) => {
    const { valor, campos } = validarPerfil(req.body);
    if (!valor) return res.status(400).json({ error: 'Datos inválidos', codigo: 'datos_invalidos', campos });
    const r = await repositorio.actualizar(req.perfilId, valor, actorDe(req));
    if (!r) return noEncontrado(res);
    res.json({ perfil: { ...r.perfil, foto: fotoDe(r.perfil), url: urlDe(r.perfil.id) } });
  }));

  admin.put('/perfiles/:id/estado', conId, json, asyncH(async (req, res) => {
    const { valor, campos } = validarEstado(req.body);
    if (!valor) return res.status(400).json({ error: 'Datos inválidos', codigo: 'datos_invalidos', campos });
    const r = await repositorio.cambiarEstado(req.perfilId, valor.activo, actorDe(req));
    if (!r) return noEncontrado(res);
    res.json(r);
  }));

  // busboy lanza errores PLANOS (no MulterError) ante un multipart truncado o mal formado
  // («Unexpected end of form», «Malformed part header»): sin esto llegarían al 500 genérico,
  // y un cliente que corta la subida a medias no es un error del servidor.
  const recibirFoto = (req, res, next) =>
    subida.single('foto')(req, res, (err) => {
      if (err && !(err instanceof multer.MulterError) && err.code !== 'LIMIT_UNEXPECTED_FILE') {
        return next(Object.assign(new Error('multipart mal formado'), { code: 'FORMULARIO_INVALIDO' }));
      }
      next(err);
    });

  admin.put('/perfiles/:id/foto', conId, limites.foto, recibirFoto, asyncH(async (req, res) => {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Datos inválidos', codigo: 'formulario_invalido', campos: { foto: 'obligatorio' } });
    }
    const foto = await procesar(req.file.buffer);
    const r = await repositorio.guardarFoto(req.perfilId, foto, actorDe(req));
    if (!r) return noEncontrado(res);
    res.json({ foto: { ...r, url: `/api/carta/perfiles/${req.perfilId}/foto` } });
  }));

  admin.delete('/perfiles/:id/foto', conId, asyncH(async (req, res) => {
    const r = await repositorio.quitarFoto(req.perfilId, actorDe(req));
    if (r === null) return noEncontrado(res);
    res.json({ ok: true });
  }));

  router.use('/admin', admin);

  // Lo que no casó con nada de arriba: 404 uniforme. Y NUNCA `next()` hacia el fallback SPA.
  router.use((req, res) => noEncontrado(res));

  // ── Mapa de errores propio ───────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (res.headersSent) return;
    if (err instanceof BdNoDisponible) {
      res.setHeader('Retry-After', '10');
      return res.status(503).json({ error: 'Servicio no disponible', codigo: 'bd_no_disponible' });
    }
    if (err instanceof CorreoDuplicado) {
      return res.status(409).json({ error: 'Correo duplicado', codigo: 'correo_duplicado', campos: { correo: 'duplicado' } });
    }
    if (err instanceof FotoInvalida) {
      if (err.codigo === 'tipo_no_admitido') return res.status(415).json({ error: 'Tipo no admitido', codigo: 'tipo_no_admitido' });
      return res.status(400).json({ error: 'Foto inválida', codigo: err.codigo, campos: { foto: err.codigo } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Cuerpo demasiado grande', codigo: 'cuerpo_demasiado_grande' });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.verify.failed' || err.type === 'charset.unsupported') {
      return res.status(400).json({ error: 'JSON inválido', codigo: 'json_invalido' });
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Foto demasiado grande', codigo: 'foto_demasiado_grande' });
      return res.status(400).json({ error: 'Formulario inválido', codigo: 'formulario_invalido' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'FORMULARIO_INVALIDO') {
      return res.status(400).json({ error: 'Formulario inválido', codigo: 'formulario_invalido' });
    }
    next(err); // lo demás, al error-handler genérico de app.js (500 sin internals)
  });

  return router;
}
