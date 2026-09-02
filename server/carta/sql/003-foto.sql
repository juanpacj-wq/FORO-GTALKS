-- 003: la foto de la tarjeta, DENTRO de la base de datos.
--
-- Una sola derivada por perfil (WebP, lado mayor ≤ 800 px, sin metadatos, orientación EXIF
-- horneada), producida por server/carta/foto.js. `sha256` es el ETag con el que el navegador
-- revalida sin volver a bajar el blob. Las fotos van en la BD y no en disco por lo que enseñó
-- la app anterior: sus uploads vivían bajo /opt y «se borraban» con cada despliegue.
IF OBJECT_ID('carta.foto') IS NULL
CREATE TABLE carta.foto (
  perfil_id UNIQUEIDENTIFIER NOT NULL
    CONSTRAINT PK_carta_foto PRIMARY KEY
    CONSTRAINT FK_carta_foto_perfil REFERENCES carta.perfil(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CONSTRAINT DF_carta_foto_tipo DEFAULT 'image/webp',
  ancho SMALLINT NOT NULL,
  alto SMALLINT NOT NULL,
  bytes INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  contenido VARBINARY(MAX) NOT NULL,
  actualizado_en DATETIME2(0) NOT NULL CONSTRAINT DF_carta_foto_act DEFAULT SYSUTCDATETIME(),
  actualizado_por NVARCHAR(64) NOT NULL,
  CONSTRAINT CK_carta_foto_tipo CHECK (tipo = 'image/webp'),
  CONSTRAINT CK_carta_foto_peso CHECK (DATALENGTH(contenido) BETWEEN 1 AND 1048576),
  CONSTRAINT CK_carta_foto_lados CHECK (ancho BETWEEN 1 AND 800 AND alto BETWEEN 1 AND 800)
);
