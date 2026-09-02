-- 001: el esquema `carta` y la tabla que lleva la cuenta de las migraciones.
--
-- Todo lo de la carta de presentación vive bajo su propio esquema, en una base de datos que ya
-- tiene otros (dbo, dashboard, gh, auth…): nada de aquí toca nada de allí. Cada lote va separado
-- por GO y es idempotente por `IF … IS NULL`, pero el migrador (scripts/carta-migrar.mjs) solo
-- aplica cada archivo UNA vez y anota su sha256: editar un archivo ya aplicado no lo vuelve a
-- aplicar, lo delata («escribe una 005, no edites 002»).
IF SCHEMA_ID('carta') IS NULL EXEC('CREATE SCHEMA carta AUTHORIZATION dbo');
GO
IF OBJECT_ID('carta.migracion') IS NULL
CREATE TABLE carta.migracion (
  numero INT NOT NULL CONSTRAINT PK_carta_migracion PRIMARY KEY,
  nombre NVARCHAR(120) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  aplicada_en DATETIME2(0) NOT NULL CONSTRAINT DF_carta_migracion_en DEFAULT SYSUTCDATETIME(),
  aplicada_por NVARCHAR(128) NOT NULL CONSTRAINT DF_carta_migracion_por DEFAULT ORIGINAL_LOGIN()
);
