# Seguridad y operación del sitio

Este documento es el manual de guardia: qué protege el sitio, qué se hace cuando algo va mal y
qué toca revisar antes de cada edición del foro.

El plan completo de auditoría (modelo de amenaza, 18 hallazgos y su remediación) está en el
archivo de plan del rediseño; aquí queda lo operativo.

---

## Qué es público y qué no

**El contenido del foro es público por decisión del negocio** (fecha de la decisión: 2026-07-28).
Cualquiera con el enlace navega la agenda, los ponentes y las encuestas sin autenticarse; nada
redirige solo a Microsoft. Público no es indexable: `X-Robots-Tag: noindex, nofollow` se queda
es el evento interno de una empresa, no una página para buscadores.

**La única superficie con sesión es la identidad**: `GET /api/me`, que alimenta la escarapela de
`/escarapela`. El login nace únicamente del botón de esa página («Iniciar sesión con Microsoft» →
`/auth/login`), y **quién puede iniciar sesión lo sigue decidiendo Entra**, no el código: la
Enterprise App tiene «Asignación requerida = Sí» y solo pasan los usuarios y grupos asignados.
No hay allowlist local ni roles de negocio.

| Petición | Respuesta |
|---|---|
| Navegación y subrecursos, con o sin sesión | **200** todo HTML sale con la `Content-Security-Policy` (el fallback SPA es la única puerta del HTML; `express.static` va con `index: false` justo para eso) |
| `GET /api/me` sin sesión | 401 JSON, `no-store` |
| `GET /api/encuestas` | 200 JSON público, `no-store`, sin cookie. La URL de la encuesta de satisfacción **solo aparece cuando el reloj del servidor pasó `fecha.cierreIso`** (ver §La encuesta de satisfacción abre por reloj) |
| `GET /api/descargas` y `GET /descargas/<rol>` | 200 público: el estado y los dos ZIP de `/galeria`, pre-armados en la estación (ver §Las descargas de /galeria). Rol fuera del manifiesto → 404 JSON |
| Métodos que no son de lectura, cross-site | 403 (`csrfMiddleware`: `Sec-Fetch-Site` u `Origin` contra `PUBLIC_ORIGIN`) |
| Subrecurso inexistente | 404 JSON (el fallback SPA es solo para navegaciones) |
| Errores del callback OIDC | 302 → `/escarapela?auth=<motivo>`, que la SPA explica junto al botón |

Los errores que la SPA sabe nombrar (`src/data/escarapela.ts`): `no_acceso` (AADSTS50105, cuenta
sin asignación), `error`, `state_invalido`, `cookies_bloqueadas`, `sesion_revocada`,
`revalidacion_fallida`.

La escarapela guarda la **foto** que elige cada persona en `localStorage` de su navegador, con
clave por `oid` y re-codificada en canvas (sin EXIF): **nunca viaja al servidor** no hay
endpoint de subida. El QR del dorso apunta a la Power App de registro de asistencia con el correo
de la sesión; el sitio solo lo pinta, no guarda ni envía nada.

**El correo de inscripción** sale en el **primer** inicio de sesión de cada persona y nunca más
(`server/correo/`, ver §Correo de inscripción). No añade superficie HTTP: no hay ruta para
dispararlo, reenviarlo ni consultarlo lo comprueba `gate-test.mjs`; lo único que cambió es un
campo dentro de `/api/me`, que sigue cerrado sin sesión.

### La encuesta de satisfacción abre por reloj

Pregunta por la experiencia del foro, así que **no debe recibir respuestas antes de que el foro
termine** (miércoles 5 de agosto de 2026, 4:00 p. m. de Colombia). La defensa es de **retención,
no de interfaz**: la URL del formulario vive en `server/encuestas.js` y **no está en el bundle
público**; `GET /api/encuestas` la entrega solo cuando el reloj **del servidor** pasó
`fecha.cierreIso` de `src/data/evento.json` (con desfase `-05:00` explícito: la zona horaria del
servidor no participa, y un `cierreIso` ambiguo aborta el arranque). Antes de esa hora el botón de
`/encuestas` va deshabilitado con su aviso, y el cliente **falla cerrado**: sin confirmación del
servidor sea porque aún no es la hora, porque `preview` no tiene API o porque la respuesta vino
rota no hay enlace que habilitar. Adelantar el reloj del teléfono no fabrica nada, porque no hay
nada que fabricar.

No añade superficie de escritura: es un GET de solo lectura sin sesión ni cookie, y no existe
mutador que abra la encuesta antes de hora. `gate-test.mjs` ejercita la frontera exacta con reloj
inyectado (`estadoEncuestas` es pura), comprueba que la respuesta cerrada no filtre la URL por
ningún campo, y que `POST /api/encuestas` sea 404; `interactions-test.mjs` verifica los dos
estados del botón y el volteo automático a la hora del servidor, sin recargar.

### El servidor de desarrollo

`npm run dev` sirve el sitio público, igual que producción; el proxy de Vite lleva `/auth`, `/api`
y `/health` al Express (`npm run dev:auth`), que solo hace falta levantado para probar el login
real de `/escarapela`. `strictPort: true` evita que Vite caiga a `:5174` y el redirect URI deje de
coincidir (AADSTS50011 sin ninguna pista).

Para trabajar el diseño sin identidad está `npm run preview`, que sirve `dist/` tal cual y es lo
que usan los scripts de verificación (ahí `/api/me` no existe y la escarapela muestra la
invitación a entrar el mismo estado de un visitante anónimo).

### Quién entró, y cómo salir

El menú de sesión (arriba a la derecha; en móvil, dentro del panel) muestra el nombre y el cargo
de quien está viendo el sitio, y ofrece **cambiar de cuenta** y **cerrar sesión**.

- El **cargo** no es un claim de OIDC: se pide a Graph (`User.Read`) al iniciar sesión. Si Graph
  falla o el invitado no tiene cargo en el directorio, se muestra el correo. El login nunca depende
  de ello.
- **Cerrar sesión es una navegación a `/auth/logout`, no un `fetch`.** Tiene que llevar al
  front-channel logout de Microsoft para que la sesión muera también en Entra: si solo se
  destruyera la cookie local, el siguiente clic en «Iniciar sesión» del mismo navegador entraría
  sin pedir credenciales, con la cuenta anterior.
- **Cambiar de cuenta** (`/auth/login?select=1`) es la salida para el ponente externo que llegó
  autenticado con su propio Microsoft y chocó con «no tienes acceso».

### Cookies bloqueadas: la detección vive en el callback

El rompebucles de cookie (`gt_lt`) murió con el SSO silencioso: sin `prompt=none` no existe ningún
intento automático que pueda encadenarse solo, así que ya no hay bucle que romper todo login
nace de un clic.

El caso que ese mecanismo cubría de verdad«autenticó, pero la cookie no se pudo fijar» sigue
existiendo y ahora se detecta donde ocurre: en `/auth/redirect`. Si Microsoft devolvió `code` y
`state` pero la sesión no trae `authState` (la sesión pre-login no sobrevivió el viaje), la causa
es la cookie → `?auth=cookies_bloqueadas`. Si `authState` existe y **no coincide**, eso sí es
manipulación → `?auth=state_invalido`. Sin la distinción, un navegador con cookies bloqueadas
vería el mensaje que acusa a la persona equivocada.

---

## Verificación

```bash
npm run build
node scripts/inscripcion-test.mjs   # el correo de inscripción, sin red ni credenciales
npm run start:local          # o `npm start` con el entorno puesto
node scripts/gate-test.mjs   # matriz pública: 200+CSP en navegaciones, 401 /api/me, CSRF,
                             # login OIDC sin prompt=none, cabeceras, sin Set-Cookie anónimo,
                             # y la encuesta de satisfacción: URL retenida hasta el cierre
```

`inscripcion-test.mjs` no necesita servidor: levanta un **Graph falso** en loopback y se lo inyecta
al mailer (`baseUrl`/`fetchImpl` se inyectan y jamás salen del entorno una variable capaz de
reapuntar a dónde va el correo sería un SSRF con credenciales corporativas dentro). Es la prueba
que contesta «¿cómo sé que nadie recibió dos correos?».

`gate-test.mjs` usa `node:http` y **no** `fetch`: undici fuerza `Sec-Fetch-Mode: cors` y no permite
emular una navegación de navegador, que sigue haciendo falta distinguir (fallback SPA vs 404 JSON).

Con `npm run preview` corren `sesion-test.mjs` (menú y escarapela con identidad simulada),
`interactions-test.mjs` (incluye volteo y ciclo de la foto), `a11y-test.mjs` (incluye el carné
por sus dos caras) y `qr-test.mjs` (los píxeles reales del QR estilizado decodificados con
ZXing que el carné sea bonito jamás puede costar que no se lea). Con los dos servidores de
dev, `login-test.mjs` recorre el login real hasta Microsoft desde `/escarapela`.

En producción, además: `curl -I` contra el dominio, contraste con securityheaders.com, `testssl.sh`
para el TLS y la consola del navegador sin violaciones de CSP en las cinco rutas.

---

## Respuesta a incidentes

**El botón de pánico es Entra, no el servidor y su alcance es la identidad.** En la Enterprise
App, «Habilitado para que los usuarios inicien sesión = No» corta los inicios de sesión al
instante; la revalidación mata las sesiones ya abiertas en ≤20 minutos (la escarapela consulta
`/api/me` al montar). **El contenido del foro sigue en línea**: es público por diseño, y apagarlo
sí exige tocar la máquina (`systemctl stop gtalks`, o el vhost de nginx).

| Situación | Acción | Efecto |
|---|---|---|
| Acceso indebido de una persona | Quitar su asignación (o sacarla del grupo) | Su sesión muere en ≤20 min; deja de ver su escarapela |
| Incidente con la identidad | Deshabilitar el inicio de sesión en la Enterprise App | Nadie más inicia sesión; el sitio sigue arriba |
| Hay que BAJAR el contenido | `systemctl stop gtalks` (o deshabilitar el vhost) | Sitio fuera Entra no puede hacer esto |
| Sospecha sobre el secreto | Rotar en el App Registration → actualizar `/etc/gtalks/env` → `systemctl restart gtalks` | Las sesiones vivas **sobreviven** (sus tokens ya están en memoria): si el incidente es robo de sesión, el reinicio es obligatorio |
| Hay que **parar los correos**, ya | `INSCRIPCION_MODO=off` en `/etc/gtalks/env` → `systemctl restart gtalks` | Deja de salir cualquier correo. El sitio y el login siguen intactos |
| Se mandó un correo que no debía | Revisar `/var/lib/gtalks/inscripciones.jsonl` y casar el `peticion` con el `message trace` de Exchange | El `client-request-id` identifica el mensaje sin ambigüedad |
| Sitio caído | `systemctl status gtalks`, `journalctl -u gtalks -n 100` | |

**Qué vigilar en los logs:** ráfagas de `AADSTS50105` (alguien probando cuentas) y de
`state_invalido` (manipulación del callback). Ambas salen por `journalctl -u gtalks`. Y no
olvidar lo que ya no es señal: el tráfico anónimo al contenido es normal el sitio es público.

**Contactos** rellenar antes de publicar; sin nombres escritos, este manual no sirve el día que
hace falta:

- Entra ID / Enterprise App: _(nombre y contacto)_
- Servidor y nginx: _(nombre y contacto)_
- Responsable del registro de asistencia: _(nombre y contacto)_

---

## Registro de acceso

Con el sitio público, lo que se registra ya no es «todo acceso»: es **cada inicio de sesión**
es decir, quién abrió su escarapela. Es un **dato personal** y por eso va en dos flujos separados:

| Flujo | Destino | Contenido | Para qué |
|---|---|---|---|
| Operación | stdout → journald | `oid` (seudónimo), resultado | Diagnóstico. Sin correos regados por los logs del sistema |
| Asistencia | `AUDIT_LOG_PATH` → JSONL | marca de tiempo, `oid`, UPN, resultado | El registro que necesita Comunicaciones |

- Ruta recomendada: `/var/log/gtalks/acceso.log`, propietario `gtalks:gtalks`, modo `0640`.
- Rotación y borrado: `deploy/logrotate/gtalks` → **12 rotaciones semanales ≈ 90 días**.
- El aviso de privacidad vive junto al botón de `/escarapela` (heredado literal de la pantalla de
  login que se eliminó): *«Tu acceso queda registrado para el control de asistencia del foro.»*
- **Nunca** se registran tokens, ni el `code`, ni el `state`, ni el verifier PKCE.
- Si `AUDIT_LOG_PATH` se deja vacío, solo se emite el flujo seudónimo: el registro con nombre es
  una decisión explícita de despliegue, no algo que aparece por defecto.
- El **registro de asistencia del día del foro** es aparte: el QR del dorso de la escarapela lleva
  a la Power App de capacitaciones con el usuario de la sesión (sin dominio) y el ID de la jornada
  en curso (mañana/tarde, en hora de Bogotá el cálculo es `Intl`/`America/Bogota` en el
  navegador, nunca el reloj del servidor; lo prueba `qr-test.mjs` bajo una zona horaria ajena).
  Ese dato lo captura Power Apps al escanear, no este servidor.

---

## Correo de inscripción

En el **primer** inicio de sesión de cada persona sale un correo de confirmación; los siguientes no
vuelven a escribirle. Vive en `server/correo/` (cuatro módulos con una responsabilidad cada uno) y
el plan completo está en [`PLAN-CORREO-INSCRIPCION.md`](./PLAN-CORREO-INSCRIPCION.md).

**El cuerpo del correo ES la pieza oficial** (`imagen correo.png`, raíz del repo), incrustada **en
línea** como adjunto con `Content-ID` (`cid:`) y envuelta entera en un enlace a
`PUBLIC_ORIGIN + /escarapela`. No hay imágenes **remotas** Outlook las bloquea y serían un píxel
de rastreo: la pieza viaja dentro del mensaje, así que se ve sin «descargar imágenes» y no delata
cuándo se abre. La lee `cargarImagenCorreo()` **una vez al arrancar**: si falta, no es un PNG o no
cabría en los ~4 MB de `sendMail`, el envío queda desactivado desde el arranque con un aviso
ruidoso, no la mañana del foro. Bajo la imagen queda un enlace textual de respaldo al mismo
destino, y el texto alterno de la imagen cuenta lo mismo a quien no la vea.

**Permiso:** `Mail.Send` de **aplicación** (client credentials), no delegado el delegado
enviaría «como» el asistente, desde su propia bandeja. El remitente es un buzón del tenant
(`INSCRIPCION_REMITENTE`). Sale de Exchange Online, así que SPF, DKIM y DMARC de `gecelca.com.co`
ya están alineados: no hay DNS que tocar ni relay externo.

**Credenciales: hoy es la MISMA App Registration del login.** El bloque `MAIL_*` se deja vacío y el
módulo cae a `M365_*`. La razón es operativa: con el secreto duplicado en el entorno, rotarlo en un
sitio y olvidarlo en el otro rompería el correo en silencio, con el login intacto y nadie mirando.
El respaldo es **todo o nada** un `MAIL_*` suelto es un error de configuración, no una mezcla y
el arranque **declara en el log de qué app salen las credenciales**, porque que la app por la que
todo el mundo inicia sesión sea además la que manda correo es una decisión que tiene que quedar
dicha, no deducirse leyendo un `.env`. La consecuencia a tener presente: esa app pasa a ser
*privilegiada* en Entra, y deshabilitarla como botón de pánico corta también los envíos.

**Dos llaves para abrir el envío masivo, no una.** `INSCRIPCION_MODO` es `off` · `simulacro` ·
`lista` · `todos`, y `lista`/`simulacro` exigen `INSCRIPCION_DESTINATARIOS`. Pasar de unos pocos a
todo el tenant obliga a cambiar **las dos** variables `todos` con la lista puesta es un **error de
configuración**, no una lista que se ignora: ninguna errata de una sola puede escribirle a la
empresa entera. Una configuración a medias **no** enciende el envío a medias: en producción aborta
el arranque (`server/index.js`) y en desarrollo el módulo avisa y se apaga.

### Por qué el correo no puede llegarle a nadie más

La lista se comprueba en **dos** sitios y la dirección de destino sale de un **tercero**:

| Guardia | Dónde | Qué impide |
|---|---|---|
| Lista al reservar | `reservarInscripcion` | Que alguien fuera de la lista llegue siquiera a quedar anotado |
| Lista al enviar, otra vez | `enviarInscripcion` | Que un cambio futuro en `server/app.js` desvíe el destino. Sin ella, la garantía sería una **convención** entre dos funciones, no una propiedad del código |
| Reserva viva | `enviarInscripcion` | Que dos llamadas al envío se conviertan en dos correos |
| **El destino sale de la configuración** | `destinoAutorizado()` | Que la dirección se construya a partir de un dato de la sesión. En modo `lista` devuelve **la entrada de `INSCRIPCION_DESTINATARIOS`** con la que coincidió: ninguna normalización, codificación ni homógrafo puede producir una dirección distinta |
| Una sola dirección | `graph-mailer.js` | Que un `para` con coma, punto y coma, espacio o salto de línea signifique «y también a estos otros». Es guardia del **transporte**, independiente de la política |
| Formato de la lista | `leerConfiguracion` | Que separar con `;` en vez de `,` produzca una lista que no coincide con nadie y parezca configurada |

`scripts/inscripcion-test.mjs` lo ejerce contra una **población de 32 identidades hostiles**
(mayúsculas, espacios, subdominios, `+etiqueta`, invitados `#EXT#`, homógrafos cirílicos, coma y
punto y coma inyectados, `%00`, `null`) y exige que el conjunto de direcciones que recibieron algo
sea **exactamente** el de la lista. El mensaje lleva un solo destinatario y no existe `cc` ni `bcc`
en todo el código.

**Lo que el código no puede impedir**, y hay que saberlo: si uno de los buzones autorizados tiene
una regla de **reenvío automático** en Outlook, el mensaje llegará también a donde apunte esa regla.
Eso se cierra en Exchange, no aquí.

### El ensayo no contamina el envío real

En modo `simulacro` el libro lleva sufijo **`.simulacro`**, siempre, se haya fijado la ruta o no.
Sin eso, ensayar con tu propia cuenta te dejaría anotado en el libro real y, al pasar a `lista`,
**no recibirías el correo de verdad**: ya constarías como atendido. El sufijo lo hace imposible por
construcción, en vez de confiar en que alguien se acuerde de borrar un archivo.

En `simulacro` no se construye ni el cliente de MSAL: el proceso **no hace una sola petición de
red** relacionada con el correo, ni siquiera para pedir el token.

### El libro de inscripciones  es ESTADO, no un log

| Qué | Dónde | Contenido |
|---|---|---|
| Libro (idempotencia) | `INSCRIPCION_LIBRO` → `/var/lib/gtalks/inscripciones.jsonl` | `ts`, `oid`, estado, `peticion` (el `client-request-id` de Graph). **Sin la dirección de correo** |
| Operación | stdout → journald | `oid` seudónimo y el `peticion`, nunca el correo |

- **`logrotate` no lo toca jamás.** Usa `copytruncate`; si truncara el libro, tras el siguiente
  reinicio el servidor volvería a escribirle a todo el mundo. Por eso vive en `/var/lib/` y no en
  `/var/log/`, y el unit lo crea con `StateDirectory=gtalks`. Lo demuestra `inscripcion-test.mjs`.
- **No guarda la dirección** por minimización: para no repetir un envío basta el `oid`, y quién
  recibió qué ya lo responden el `message trace` de Exchange (autoritativo) y `acceso.log`, que
  correlaciona `oid` ↔ UPN con su plazo de borrado. Se archiva y se borra con el §Ciclo anual.
- **Quien queda fuera de la lista no deja línea.** Es deliberado: al ampliar la lista, esas
  personas siguen contando como no inscritas y reciben su correo en su siguiente entrada.
- **El libro arranca vacío**: quien haya iniciado sesión *antes* de desplegar esto cuenta como no
  inscrito y recibirá el correo en su siguiente entrada. Es la primera pregunta que surge al ver
  que a alguien le llegó «tarde».
- **Huérfanos**: un reinicio entre la reserva y el envío deja una línea en `reservado` que no se
  reintenta sola. Se revisan con `grep '"reservado"' /var/lib/gtalks/inscripciones.jsonl` y se
  comparan con los desenlaces.

El **aviso de privacidad** vive junto al botón de entrar, **antes** del login: *«Tu acceso queda
registrado para el control de asistencia del foro.»* Hasta el 2026-08-12 tenía una segunda frase
que anunciaba el correo de inscripción; el usuario la retiró con el envío ya apagado
(`INSCRIPCION_MODO=off`): no se anuncia un correo que no va a salir. Si el envío volviera a
encenderse, la frase tiene que volver con él  `sesion-test.mjs` vigila hoy que NO esté, así que
ese arnés se invierte a la vez.

---

## Envío único del QR de asistencia

El correo de inscripción solo llega a quien **ya entró** al sitio. Este otro cierra el hueco
contrario: le manda a **todos los invitados** se hayan inscrito o no su código QR de registro
antes del foro. Sale de `scripts/envio-qr.mjs`, **una sola vez**, y se corre a mano desde la
estación. Plan completo en [`PLAN-ENVIO-QR.md`](./PLAN-ENVIO-QR.md).

**No añade superficie HTTP.** El servidor no carga ni una línea de esto: no hay ruta para
dispararlo, reenviarlo ni consultarlo. `server/correo/plantilla-envio-qr.js` vive junto a la otra
plantilla por afinidad, pero nada de `server/app.js` la importa  y no puede: importa `uqr` y
Playwright por la vía del script, y el despliegue los poda (`npm prune --omit=dev`).

### El único fallo sin arreglo posible: el QR de otro

Si a Ana le llega el código de Beto, Ana registra la asistencia de Beto y ninguno de los dos se
entera. No hay forma de repararlo el día del evento. Cinco cosas lo impiden, y las cinco son de
construcción, no de buena fe:

| Defensa | Qué cierra |
|---|---|
| Bucle **secuencial** (`for…of` + `await`), nunca `Promise.all` | La cola de `graph-mailer` serializa el HTTP, pero no la composición del mensaje |
| Un **contexto de navegador nuevo** por persona | Reutilizar una página y mutar una variable compartida es, literalmente, el mecanismo del cruce |
| **Cero caché** de lo que depende de la persona | La pieza sí se memoiza (es la misma para todos); el QR jamás. Un `qrCache` en la plantilla serviría el primer código a los 163 |
| El par **(destinatario, alias)** sale de la MISMA cadena | En modo `lista`, tanto el `para` como el `USUARIO` del QR se derivan de la entrada de `ENVIO_QR_DESTINATARIOS`. Sin esto, la lista blanca controlaría a quién se escribe pero no qué código lleva dentro, y un cruce en las pruebas a cuatro buzones pasaría inadvertido |
| **Auto-chequeo con ZXing antes de enviar** | El script decodifica el PNG que acaba de generar y exige que diga la URL de esa persona. Si no coincide, **aborta el proceso entero**: un cruce detectado significa que el mecanismo está roto, y seguir sería apostar a que solo lo estaba en esa vuelta |

Lo ejerce `node scripts/envio-qr-test.mjs` con una población de alias parecidos a propósito
(`jcespedes`, `jcespede`, `jcespedez`), decodificando **los bytes reales del adjunto** de cada
mensaje, y saboteando el generador para comprobar que el aborto ocurre de verdad.

### El correo es una credencial portátil

El QR registra la asistencia de esa persona **sin pedir autenticación**. Hasta ahora vivía detrás
del login, en su escarapela; desde este envío vive también en una bandeja de entrada y en la
carpeta Enviados del remitente. Consecuencias asumidas:

- Quien tenga acceso al buzón de `ENVIO_QR_REMITENTE` puede registrar a los 163. Es el mismo
  buzón, y por eso conviene que sea uno de servicio y no el de una persona.
- Una regla de reenvío automático en Outlook manda el código a donde diga la regla. El código no
  puede impedirlo; se cierra en Exchange.
- Por eso el QR **no va envuelto en un enlace** y la URL de Power Apps **no aparece como texto**
  en el mensaje: Outlook auto-enlaza cualquier URL suelta, y un toque desde el sofá sería un
  auto-registro. El copy lo dice: *«Es personal e intransferible: no lo reenvíes ni lo compartas.»*

### El origen público no se hereda del `.env`

El correo enlaza a `PUBLIC_ORIGIN + /escarapela`, y el `.env` de la estación dice
`http://localhost:5173`  correcto para desarrollar, catastrófico para un envío masivo. `envio-qr.mjs`
**aborta** si `--confirmar` va con un origen que no sea `https://`; se le pasa en la línea de
comando, que tiene precedencia sobre `--env-file`. El dominio es `cdp.gecelca.com.co`.

### La audiencia se congela, y el libro es la memoria

- `scripts/envio-qr-audiencia.mjs` lee el grupo **una vez** y escribe
  `.datos/audiencia-<fecha>.json`, que **no se sobrescribe**. El envío usa ese archivo y **no
  vuelve a consultar Graph**: leer el directorio y mandar correo son dos privilegios distintos, y
  así lo que se manda es exactamente lo que un humano revisó.
- El script audita antes de nada: conteo esperado, `oid` y alias únicos, alias de invitado B2B
  (`#EXT#`), cuentas deshabilitadas, y **discrepancias entre el alias del `mail` y el del UPN** 
  esa persona recibiría un QR distinto al de su propia escarapela. Los anómalos no se envían.
- El libro es `.datos/envio-qr.jsonl`, con ruta **absoluta contra la raíz del repo**: correr el
  script desde otra carpeta abriría un libro vacío y todo el mundo recibiría un segundo correo.
  Guarda `oid`, estado, `ts` y `peticion`; **nunca la dirección**.
- **Respaldarlo al terminar.** Vive en la estación y `.datos/` está en `.gitignore`. El registro
  autoritativo de a quién le llegó sigue siendo el *message trace* de Exchange y la carpeta
  Enviados; el libro solo evita repetir.
- Reanudación: `enviado` no se repite jamás; un `fallido` se reintenta con `--reintentar`; un
  `fallido` **por timeout** y un `reservado` huérfano son estados **desconocidos** (el mensaje pudo
  haberse entregado) y exigen `--forzar`.

---

## El certificado de participación se descarga, y solo el propio

Tras el foro, cada asistente descarga su certificado en PDF desde `/certificado`, autenticándose
con la misma sesión de Entra de la escarapela. El modelo de amenaza es el heredero directo del
del envío del QR: **que Ana descargue el certificado de Beto**  un documento con el nombre y la
cédula de otra persona. Y hay una segunda amenaza propia: que la ruta nueva se convierta en **la
«peor puerta»** contra la que advierte `docs/EXPORTAR-INSCRITOS.md` (una que sirva el registro de
asistencia). No lo es, y no por convención sino por construcción: la ruta **no admite parámetros**.

El servidor **no compone** ningún certificado: los PDF se generan en la estación
(`scripts/certificados-generar.py`), se verifican dos veces y se suben pre-hechos a
`/var/lib/gtalks/certificados/` (fuera de `/opt/gtalks`: sobreviven a los despliegues, como el
libro). `GET /api/certificado` solo entrega bytes que ya existían.

| Guardia | Dónde | Qué impide |
|---|---|---|
| La audiencia se congela en un archivo revisable, con oid/alias/cédula únicos y fallo cerrado | `scripts/certificados-audiencia.mjs` | Que una ambigüedad del directorio o un nombre mal partido lleguen a un diploma sin que un humano los vea |
| Auto-chequeo por PDF: reabrir, rasterizar, y restar contra una referencia sin textos; centrado ±2 px y ancho esperado | `scripts/certificados-generar.py` | Un texto fuera de su sitio, un nombre que desborde su raya, cualquier cambio fuera de las dos bandas |
| Segunda opinión por otra vía: la capa de texto de CADA pdf contra el archivo que lo nombra y contra la audiencia congelada, no contra el manifiesto del mismo lote | `scripts/certificados-auditar.py` | El cruce A-con-datos-de-B, que el auto-chequeo no puede ver porque compararía B contra B. Probado con sabotaje |
| El manifiesto lleva `oid → archivo` y nada más | `certificados-generar.py` → `server/certificados.js` | Que el servidor conozca nombres o cédulas que no necesita (minimización, como el libro sin direcciones) |
| `CERTIFICADOS_DIR` vacío = la función no existe; a medias = el arranque ABORTA; allowlist del nombre de archivo + `resolve` dentro del directorio | `server/certificados.js` (`iniciarCertificados`) | Encender a medias, y el traversal por manifiesto  negado por construcción y fijado por `certificados-server-test.mjs` |
| La ruta resuelve SOLO el oid de la sesión; sin parámetros, sin listado, sin hermanas | `server/app.js` (`GET /api/certificado`) + `gate-test.mjs` | Pedir el certificado de otro o enumerar: no existe URL que lo nombre |
| `revalidate` también en la descarga | `server/app.js` | Que una sesión revocada en Entra siga descargando un documento con datos personales |
| La interfaz solo anuncia lo que el servidor confirma: solo el literal `disponible` pinta descarga | `src/data/sesion.ts` + `sesion-test.mjs` | Prometer un certificado que quizá no existe (campo ausente, server viejo, persona sin asistencia) |

Notas que no son obvias:

- **`no_aplica` no distingue** «apagado», «sin certificado» y «oid desconocido», a propósito: la
  respuesta del 404 tiene la misma forma que el 404 genérico.
- **El repo es público y las cédulas jamás lo tocan**: `*.xlsx` está en `.gitignore` desde la
  Fase 0 de esta función, la audiencia congelada vive en `.datos/` (ignorado) y el despliegue
  empaqueta con `git archive`. La subida de los PDF va por `deploy/certificados-subir.sh` (tar
  por stdin de ssh + sha256), nunca por git.
- **Cargar el manifiesto exige reiniciar el servicio** tras cada subida: el mapa vive en memoria.
- **`entregaManual` está hoy vacío, y conviene saber por qué existe.** Ahí vivió «HOWARD DIAZ
  GRANADOS CATRIN» del 10 al 13 de agosto, dado por «sin cuenta en Entra». Sí la tenía
  (`choward@`, «Catrin Howard Diazgranados») y hasta estaba en el grupo del foro: lo que no
  existía era ese nombre, porque el listado partió en dos un apellido que el directorio guarda
  junto. **Un «cero coincidencias» del resolvedor no prueba que alguien no tenga cuenta, solo que
  no la tiene con esa grafía**; antes de mandar a nadie a entrega manual hay que buscarlo por un
  apellido suelto. La audiencia pasó de 155 a 156.

---

## Las descargas de /galeria: público, pero con la doctrina del certificado

`/galeria` entrega dos ZIP, uno por sección desde el 2026-08-13 («Descarga las presentaciones de
tus ponentes» abre la página; «Descargar imágenes» va tras el abanico): las fotografías
originales de la jornada (~1.3 GB) y las presentaciones de los ponentes. Es **contenido público**: las mismas
fotos que la página ya enseña y el material que se proyectó ante la audiencia. No hay sesión, y
no debe haberla. Lo que se conserva del patrón del certificado es lo que lo hace seguro:

- **El servidor no compone nada.** `scripts/descargas-empaquetar.py` arma los ZIP en la estación
  (deduplicando por SHA-256: el lote de fotos trae la misma toma con hasta tres nombres),
  `deploy/descargas-subir.sh` los sube por ssh con checksum en las dos puntas **nunca por git**:
  1.3 GB en un repo público, y `server/descargas.js` solo aprende el manifiesto al arrancar.
- **Sin parámetros libres.** `GET /descargas/:rol` resuelve únicamente contra los dos roles del
  manifiesto validados al arranque (allowlist de nombre + `resolve` dentro del directorio, las
  mismas dos vallas de los certificados); cualquier otra cosa cae al 404 genérico. No hay
  listados ni rutas construidas con entrada del cliente.
- **`DESCARGAS_DIR` vacío = la función no existe; a medias = el arranque ABORTA** (manifiesto
  ilegible, ZIP ausente o con un tamaño distinto del prometido). Cargar una subida nueva exige
  **reiniciar** el servicio.
- **La interfaz solo anuncia lo que el servidor confirma**: `GET /api/descargas` (público,
  `no-store`, sin cookie) publica bytes y conteo por rol, y sin esa confirmación los botones
  quedan retenidos con su aviso  la página nunca ofrece un enlace que va a dar 404. El peso que
  se enseña junto a cada botón es el del manifiesto, no un copy.
- **Una ruta de ENTREGA no es una ruta de la SPA, y hay que sacarla del fallback en las DOS
  puntas.** Un clic en `<a download>` viaja con `Sec-Fetch-Mode: navigate` y `Sec-Fetch-Dest:
  document`: para el servidor es indistinguible de escribir la URL en la barra. Mientras
  `/descargas/:rol` delegó su caso «no existe» en `next()`, el fallback SPA lo recogía y
  contestaba `index.html` con **200**; el navegador, sin `Content-Disposition` y con `text/html`,
  lo guardaba con el nombre del rol y la extensión del tipo: **`imagenes.htm`**. Un archivo que no
  abre nada y que no se parece a un error por ningún lado. Hoy la ruta responde 404 ella misma y
  además `/descargas/` está fuera de `esNavegacion()` junto a `/api/`, así que ni un servidor que
  no tenga esta ruta puede devolver HTML ahí. La segunda punta es el entorno de desarrollo:
  `vite.config.ts` proxia `/descargas/` igual que `/api`, porque si no `npm run dev` confirma los
  paquetes por el proxy (botones activos, pesos reales) y luego atiende la descarga con su propio
  fallback. Que la mitad de la función vaya por el proxy y la otra mitad no es lo que hace que
  este fallo no parezca un fallo.

Lo verifica `gate-test.mjs` (coherencia anuncio↔entrega, adjunto con `Content-Disposition`,
reanudación por rangos, `POST` → 404, y el 404 de lo inexistente comprobado **navegando**, que es
como llega el clic: pedirlo «a secas», sin `accept`, esquiva el fallback y por ahí el fallo no se
ve) e `interactions-test.mjs` (los dos estados de los botones).

---

## Secretos

Viven en `/etc/gtalks/env`, **fuera del directorio de la app**, con permisos `0600 root:root`:
systemd lo lee como PID 1 antes de bajar privilegios, así que el usuario del servicio nunca
necesita abrirlo. Además, un `git pull` no puede pisarlos.

`npm start` ya no usa `--env-file`. Para desarrollo local existe `npm run start:local`, que sí lee
el `.env` del repo.

### Rotación

- **Secreto de cliente: vida de 12 meses, creado para que expire ~2 meses DESPUÉS del evento.**
  Así nunca vence a mitad de foro y la renovación cae en la preparación de la edición siguiente.
- **Rotación sin caída**: Entra admite dos secretos vivos a la vez. Crear el nuevo → escribirlo en
  `/etc/gtalks/env` → `systemctl restart gtalks` → verificar un login → borrar el viejo en Entra.
- **`SESSION_SECRET`: rotar en cada edición.** Invalida todas las sesiones, que es exactamente lo
  que se quiere entre un foro y el siguiente.
- **El correo de inscripción NO añade un secreto que rotar**: usa el del login (`M365_CLIENT_SECRET`),
  porque hoy es la misma App Registration y el bloque `MAIL_*` se deja vacío. Rotar el secreto del
  login rota también el del correo, en un solo `systemctl restart`. Si algún día se separa la app,
  aparece una **segunda** fecha de expiración que vigilar, y esa es la razón real para no separarlas
  a la ligera: el fallo típico de un sitio anual es un secreto que vence sin que nadie se entere.
- El fallo realista de un sitio anual no es que roben el secreto: es que **expire y nadie se entere**.
  Anotar aquí la fecha de expiración y poner recordatorio de calendario.

> Secreto vigente creado el: ______  ·  Expira el: ______  ·  Responsable: ______
> _(es también el del correo de inscripción: app `ec13cb64-3a24-4bdf-80d3-0a3cc008cc23`)_

---

## Invitados externos (B2B)

Los ponentes que no son de GECELCA entran como invitados del tenant.

- **Restricción de dominios**: en External Identities, lista blanca con los dominios de las
  empresas ponentes. Cierra la invitación accidental a cualquier dirección.
- **El gate ya funciona con invitados sin tocar nada**: la autoridad es de tenant único, así que
  Entra emite el token desde el tenant de GECELCA y la validación de `tid` pasa igual.
- ⚠ **Nunca cambiar la autoridad a `common` para «que entren los externos».** Es el error clásico:
  rompe la comprobación de `tid` y abre la aplicación a cualquier tenant de Microsoft del mundo.
  `M365_TENANT_ID` se queda fijado, sin excepción.
- **Invitar con ≥2 semanas de antelación** y pedir a cada ponente externo un login de prueba: el
  registro de MFA contra GECELCA es el paso que más falla, y descubrirlo el día del foro no tiene
  arreglo rápido.
- Si algún invitado usa cuenta personal (Gmail/Outlook), hay que **habilitar el código de un solo
  uso por correo** en External Identities; si no está, el login falla con un error opaco.
- Los invitados llegan con UPN de la forma `usuario_dominio.com#EXT#@gecelca…`. La escarapela y el
  menú de sesión muestran `nombre_completo` (Graph `displayName` → claim `name` → UPN limpio de
  `#EXT#`), nunca esa forma mutilada resuelto en el callback (`server/app.js`).

---

## Ciclo anual

**Al cerrar cada edición:**

1. Vaciar el grupo de acceso y quitar la asignación en la Enterprise App.
2. Borrar los objetos de usuario invitado creados solo para el evento.
3. `systemctl disable --now gtalks` entre ediciones el servicio no corre. Es el control honesto,
   más que cualquier duración de sesión.
4. Rotar `SESSION_SECRET`.
5. Exportar la membresía del grupo y archivarla: es el registro auditable de quién pudo entrar.
   `.datos/audiencia-<fecha>.json` **ya es** ese artefacto si se corrió el envío del QR.
6. **Retirar `GroupMember.Read.All`** de la App Registration si se concedió para el envío del QR.
7. Borrar `.datos/envio-qr*.jsonl`, `.datos/audiencia-*.json` y `.datos/qr/*.png`: son 163 alias
   corporativos y 163 credenciales de asistencia en el disco de una estación.
8. Borrar `.datos/certificados/` y `.datos/certificados-audiencia-*.json` de la estación, y
   `/var/lib/gtalks/certificados/` del servidor (con `CERTIFICADOS_DIR=` vaciado antes del
   restart): son 155 nombres con cédula en disco, y pasado el ciclo ya nadie los descarga.
   `asistentes.md` (raíz, ignorado por git) también se borra: es el listado con las 155 cédulas.

**Al abrir la siguiente:**

1. Revisar expiración del secreto de cliente y rotarlo si toca.
2. `npm ci` (no `npm install`: el lockfile es el pin) y `npm audit`.
3. Actualizar Node a la LTS vigente.
4. Volver a correr `gate-test.mjs`, `a11y-test.mjs` e `interactions-test.mjs`.
5. Subir `AUTH_RATE_LIMIT` el día del evento y bajarlo después.

---

## Riesgos aceptados

| Riesgo | Por qué se acepta | Revisión |
|---|---|---|
| **El contenido del foro es público** | Decisión del negocio (2026-07-28): la carta de presentación del evento debe poder abrirse sin fricción. Lo sensiblela identidad y el registro de asistencia sigue detrás de la sesión (`/api/me`) y de Entra. `noindex` se mantiene | Cada edición: confirmar que sigue siendo la intención |
| **Aviso `GHSA-qwww-vcr4-c8h2` en react-router 7.12–8.2** (alta) | Afecta al **modo RSC con actions**. Este sitio usa el modo declarativo puro: `BrowserRouter` + `<Routes>`, sin `createBrowserRouter`, sin `loader`/`action`, sin RSC y sin servidor de React verificado por búsqueda en `src/`. La ruta vulnerable no existe aquí. **No hay versión corregida publicada en la rama 7.x.** | Cada edición: comprobar si salió un 7.x parcheado |
| **Sesiones en memoria**: un reinicio las cierra | El costo es un clic: el sitio sigue arriba y, como Entra conserva la sesión del navegador, el botón de `/escarapela` reentra sin pedir credenciales. Persistirlas significaría escribir **refresh tokens de Entra en disco** en una máquina expuesta a internet | Si algún día hay más de un proceso |
| **`img-src data:`** en la CSP | Lo exigen el grano SVG del sistema de diseño y la foto local de la escarapela (dataURL de localStorage). Las imágenes no ejecutan | |
| **La foto del carné queda en localStorage** tras cerrar sesión | La eligió la propia persona, nunca viaja al servidor, y la clave por `oid` garantiza que otra cuenta del mismo equipo jamás la ve pintada. Borrarla en el logout exigiría interceptar una navegación que debe seguir siendo navegación (front-channel) | Si aparece un caso real de equipo compartido |
| **El remitente NO está acotado en Exchange** | `Mail.Send` de aplicación permite, por defecto, enviar como **cualquier** buzón del tenant; el control que lo cierra es una `ApplicationAccessPolicy` (o RBAC for Applications) de Exchange Online, y **no se aplicó**: exige rol de *Organization Management*, que la cuenta del proyecto no tiene, y el sitio vive un solo día. Lo que sí queda es la lista blanca de **destinatarios** en el código (`INSCRIPCION_DESTINATARIOS`, fallo cerrado) y el secreto en `/etc/gtalks/env`. Decisión del usuario, 2026-07-30 | Si el correo se abre a todo el tenant, o si el sitio pasa a vivir más de una edición, aplicarla |
| **Un reinicio entre la reserva y el envío deja un `reservado` huérfano**: esa persona no recibe correo y no se reintenta sola | La alternativa reintentar al arrancar puede **duplicar** envíos, que es justo el fallo que el módulo existe para evitar. El huérfano es visible con un `grep` sobre el libro | Revisar el libro una vez al día en la semana del foro |
| **El aviso de privacidad promete el correo a todo el que entra**, y durante el piloto solo lo reciben los de la lista | Es una divulgación previa a un tratamiento de datos: sobre-informar es la dirección segura, informar de menos es la arriesgada. La interfaz, en cambio, **solo anuncia lo que el servidor confirma** | Deja de ser discrepancia en cuanto el modo pase a `todos` |
| **La URL de la encuesta de satisfacción circuló en bundles anteriores** al gate por reloj | Quien la haya guardado de un despliegue previo puede abrir el formulario antes del cierre; el servidor solo puede retener lo que sirve HOY. El cierre de fondo está en Forms: la encuesta puede llevar además su propia **fecha de inicio** («Aceptar respuestas desde»), configurada por Comunicaciones en el tenant defensa en profundidad fuera de este repo | Antes del evento: pedir a Comunicaciones esa fecha de inicio en Forms |
| **La app del login tiene `Group.ReadWrite.All` y `GroupMember.ReadWrite.All`** (concedidos el 2026-08-03) | Se pidió la variante de **lectura** (`GroupMember.Read.All`), que es la mínima para `/groups/{id}/members`; se concedieron las de **escritura**. El script solo hace `GET`, así que funciona igual  pero la misma App Registration que ya podía **enviar correo como cualquier buzón** y por la que **todo el mundo inicia sesión** puede ahora **crear, modificar y eliminar grupos y membresías de todo el tenant**. Los permisos de aplicación de Graph son de tenant y no se pueden acotar a un grupo: ni RBAC de Entra, ni unidades administrativas, ni RSC (que es de Teams) | **Bajarlos a `Group.Read.All` / `GroupMember.Read.All`** no rompe nada y **retirarlos cuando termine el envío**. Si el envío se repite cada edición, moverlos a una App Registration propia |
| **El QR viaja por correo, y registra asistencia sin autenticar** | El código es el mismo que ya estaba en la escarapela; lo que cambia es que ahora vive también en una bandeja de entrada y en Enviados del remitente. Un reenvío permite que otra persona marque esa asistencia. Se acepta porque el control de asistencia de un foro de un día no justifica un segundo factor, y porque el correo lo dice explícitamente | Si alguna edición necesita asistencia fehaciente, el QR tiene que llevar un token de un solo uso, no el alias |
| **El libro del envío vive en la estación**, sin respaldo automático y fuera de git | Es un archivo de 163 líneas sin direcciones de correo. La mitigación real es `--maximo N` obligatorio con `--confirmar`: un libro perdido cuesta N correos repetidos, no 163. Y el registro autoritativo es el *message trace* de Exchange, no el libro | Copiarlo a un sitio sincronizado tras cada corrida |
| **Rate limit por IP** no detiene a un atacante decidido | Con NAT corporativo toda la sede comparte IP: un límite que tolere 300 entradas legítimas no puede ser estricto. Es un cortacircuitos contra bucles, no una política de seguridad. La defensa real es fail2ban en el borde. (Con el sitio público el pico del login ya no es «todo el auditorio a la misma hora»: solo pasa por `/auth/*` quien abre su escarapela) | Ajustar con los rangos de egress cuando IT los entregue |
| **El nombre y la cédula del certificado van en Poppins Regular, que NO es la fuente exacta de la pieza** | Se midieron 13 candidatas con tres arneses (`scripts/certificado-fuente.py`); ninguna ES la de la pieza (mejor IoU alineado 0.608). Poppins Regular clava el peso (asta 3.00 px, la misma) y es la más cercana en forma; al cuerpo del diploma la diferencia no se percibe sin comparar glifo a glifo. Decisión del usuario, 2026-08-10 | Si Comunicaciones entrega la fuente original: añadirla a CANDIDATAS, correr el arnés, regenerar y resubir |
| **`GET /api/certificado` es la primera ruta HTTP que sirve un dato del registro de asistencia** | La «peor puerta» de EXPORTAR-INSCRITOS era una que sirviera EL registro; esta sirve UN archivo estático, solo al dueño del oid de la sesión, sin parámetros ni enumeración posibles, con `revalidate` y `no-store`. El dato que entrega ya pertenece a quien lo pide | Cada edición: si la función no se repite, vaciar `CERTIFICADOS_DIR` y la ruta responde 404 para todo el mundo |

---

## Pendientes con terceros

Dos cosas que **no dependen del código** y bloquean partes del despliegue:

1. **¿El tenant tiene Entra ID P1?** Sin esa licencia no se puede asignar un **grupo** a la
   Enterprise App y hay que asignar usuario por usuario, lo que cambia el procedimiento de
   invitaciones.
2. **Rangos de salida a internet de GECELCA y de la sede del evento.** Sin ellos, fail2ban puede
   terminar baneando a la empresa entera. Hacen falta antes de activar el jail.
