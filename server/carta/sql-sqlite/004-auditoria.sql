-- 004 (SQLite): quién hizo qué. Sin FK a propósito: la fila sobrevive a todo. Ver sql/004.
CREATE TABLE IF NOT EXISTS carta_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  accion TEXT NOT NULL CHECK (accion IN ('crear', 'editar', 'activar', 'desactivar', 'foto_subir', 'foto_quitar')),
  perfil_id TEXT NULL,
  detalle TEXT NULL,
  ip TEXT NULL
);
CREATE INDEX IF NOT EXISTS ix_carta_auditoria_perfil ON carta_auditoria (perfil_id, ts DESC);
