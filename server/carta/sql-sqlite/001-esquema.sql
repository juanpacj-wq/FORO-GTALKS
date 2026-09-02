-- 001 (SQLite): la tabla que lleva la cuenta de las migraciones.
--
-- Es el MISMO esquema que server/carta/sql/ (SQL Server), en el dialecto de SQLite, para el
-- motor embebido (`DB_MOTOR=sqlite`, node:sqlite). Un archivo por número, mismos nombres, misma
-- disciplina: cada uno se aplica una vez y queda anotado con su sha256. SQLite no tiene
-- esquemas: las tablas van con el prefijo `carta_`.
CREATE TABLE IF NOT EXISTS carta_migracion (
  numero INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  aplicada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  aplicada_por TEXT NOT NULL DEFAULT 'node'
);
