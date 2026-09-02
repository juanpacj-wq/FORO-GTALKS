-- 002: el perfil de una carta de presentación.
--
-- `id` es el identificador PÚBLICO (va en la URL y en el QR impreso): UNIQUEIDENTIFIER
-- generado en Node con crypto.randomUUID(), no enumerable. La clave clúster es `orden`
-- (IDENTITY): un NEWID() como clave clúster fragmenta el índice en cada inserción.
--
-- No hay borrado: `activo = 0` retira la tarjeta (un QR impreso apunta a un id, y ese id no
-- puede desaparecer ni reasignarse). Los CHECK son la última línea: la validación real vive en
-- server/carta/validacion.js, que rechaza en vez de sanear; esto solo impide que un dato que
-- se cuele por otro camino quede guardado en una forma que la tarjeta no sabría pintar.
IF OBJECT_ID('carta.perfil') IS NULL
CREATE TABLE carta.perfil (
  id UNIQUEIDENTIFIER NOT NULL
    CONSTRAINT DF_carta_perfil_id DEFAULT NEWID()
    CONSTRAINT PK_carta_perfil PRIMARY KEY NONCLUSTERED,
  orden INT IDENTITY(1,1) NOT NULL,
  nombres NVARCHAR(80) NOT NULL,
  apellidos NVARCHAR(80) NOT NULL,
  cargo NVARCHAR(120) NOT NULL,
  area NVARCHAR(120) NULL,
  correo NVARCHAR(254) NOT NULL,
  telefono VARCHAR(20) NULL,   -- E.164
  whatsapp VARCHAR(20) NULL,   -- E.164
  linkedin NVARCHAR(200) NULL,
  instagram NVARCHAR(200) NULL,
  x NVARCHAR(200) NULL,
  facebook NVARCHAR(200) NULL,
  youtube NVARCHAR(200) NULL,
  tiktok NVARCHAR(200) NULL,
  sitio_web NVARCHAR(200) NULL,
  activo BIT NOT NULL CONSTRAINT DF_carta_perfil_activo DEFAULT 1,
  creado_en DATETIME2(0) NOT NULL CONSTRAINT DF_carta_perfil_creado DEFAULT SYSUTCDATETIME(),
  creado_por NVARCHAR(64) NOT NULL,        -- oid de la sesión que lo creó
  actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_carta_perfil_act DEFAULT SYSUTCDATETIME(),
  actualizado_por NVARCHAR(64) NOT NULL,
  CONSTRAINT CK_carta_perfil_nombres CHECK (LEN(LTRIM(RTRIM(nombres))) > 0),
  CONSTRAINT CK_carta_perfil_apellidos CHECK (LEN(LTRIM(RTRIM(apellidos))) > 0),
  CONSTRAINT CK_carta_perfil_cargo CHECK (LEN(LTRIM(RTRIM(cargo))) > 0),
  CONSTRAINT CK_carta_perfil_correo CHECK (
    correo LIKE '%_@_%.__%' AND correo = LOWER(correo) COLLATE Latin1_General_CS_AS
  ),
  CONSTRAINT CK_carta_perfil_telefono CHECK (telefono IS NULL OR telefono LIKE '+[1-9]%'),
  CONSTRAINT CK_carta_perfil_whatsapp CHECK (whatsapp IS NULL OR whatsapp LIKE '+[1-9]%'),
  CONSTRAINT CK_carta_perfil_sitio CHECK (sitio_web IS NULL OR sitio_web LIKE 'https://%')
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IXC_carta_perfil_orden' AND object_id = OBJECT_ID('carta.perfil'))
CREATE UNIQUE CLUSTERED INDEX IXC_carta_perfil_orden ON carta.perfil(orden);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_carta_perfil_correo' AND object_id = OBJECT_ID('carta.perfil'))
CREATE UNIQUE INDEX UX_carta_perfil_correo ON carta.perfil(correo);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_carta_perfil_activo' AND object_id = OBJECT_ID('carta.perfil'))
CREATE INDEX IX_carta_perfil_activo ON carta.perfil(activo) INCLUDE (apellidos, nombres, cargo);
