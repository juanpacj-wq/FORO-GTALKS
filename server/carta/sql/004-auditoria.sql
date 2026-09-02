-- 004: quién hizo qué con cada tarjeta.
--
-- Una fila por mutación, escrita en la MISMA transacción que la mutación (server/carta/
-- repositorio.js): no hay forma de cambiar un perfil sin dejar rastro. Sin FK a carta.perfil a
-- propósito, para que la fila sobreviva a cualquier cosa. `detalle` lleva QUÉ campos cambiaron,
-- nunca sus valores: la auditoría no es una segunda copia de los datos personales.
IF OBJECT_ID('carta.auditoria') IS NULL
CREATE TABLE carta.auditoria (
  id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_carta_auditoria PRIMARY KEY,
  ts DATETIME2(3) NOT NULL CONSTRAINT DF_carta_auditoria_ts DEFAULT SYSUTCDATETIME(),
  actor_oid NVARCHAR(64) NOT NULL,
  actor_upn NVARCHAR(254) NOT NULL,
  accion VARCHAR(20) NOT NULL,
  perfil_id UNIQUEIDENTIFIER NULL,
  detalle NVARCHAR(MAX) NULL,   -- JSON: {"campos":["cargo"]} o {"activo":false}; NUNCA valores
  ip VARCHAR(45) NULL,
  CONSTRAINT CK_carta_auditoria_accion CHECK (
    accion IN ('crear', 'editar', 'activar', 'desactivar', 'foto_subir', 'foto_quitar')
  )
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_carta_auditoria_perfil' AND object_id = OBJECT_ID('carta.auditoria'))
CREATE INDEX IX_carta_auditoria_perfil ON carta.auditoria(perfil_id, ts DESC);
