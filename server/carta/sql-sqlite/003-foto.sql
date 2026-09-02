-- 003 (SQLite): la foto, DENTRO de la base (BLOB). Ver sql/003-foto.sql.
CREATE TABLE IF NOT EXISTS carta_foto (
  perfil_id TEXT PRIMARY KEY NOT NULL REFERENCES carta_perfil (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'image/webp' CHECK (tipo = 'image/webp'),
  ancho INTEGER NOT NULL CHECK (ancho BETWEEN 1 AND 800),
  alto INTEGER NOT NULL CHECK (alto BETWEEN 1 AND 800),
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  contenido BLOB NOT NULL CHECK (length(contenido) BETWEEN 1 AND 1048576),
  actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actualizado_por TEXT NOT NULL
);
