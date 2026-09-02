-- 002 (SQLite): el perfil de una carta. Ver sql/002-perfil.sql para el porqué de cada columna.
-- `id` es el UUID v4 en minúsculas generado en Node; `rowid` hace de orden de inserción.
CREATE TABLE IF NOT EXISTS carta_perfil (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  nombres TEXT NOT NULL CHECK (length(trim(nombres)) > 0),
  apellidos TEXT NOT NULL CHECK (length(trim(apellidos)) > 0),
  cargo TEXT NOT NULL CHECK (length(trim(cargo)) > 0),
  area TEXT NULL,
  correo TEXT NOT NULL UNIQUE CHECK (correo LIKE '%_@_%.__%' AND correo = lower(correo)),
  telefono TEXT NULL CHECK (telefono IS NULL OR telefono GLOB '+[1-9]*'),
  whatsapp TEXT NULL CHECK (whatsapp IS NULL OR whatsapp GLOB '+[1-9]*'),
  linkedin TEXT NULL,
  instagram TEXT NULL,
  x TEXT NULL,
  facebook TEXT NULL,
  youtube TEXT NULL,
  tiktok TEXT NULL,
  sitio_web TEXT NULL CHECK (sitio_web IS NULL OR sitio_web LIKE 'https://%'),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  creado_por TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_por TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_carta_perfil_activo ON carta_perfil (activo, apellidos, nombres);
