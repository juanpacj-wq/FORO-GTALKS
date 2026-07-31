# Correo de inscripción en el primer inicio de sesión

> **Estado: implementado el 2026-07-30**, con **una desviación deliberada**: la acotación del
> remitente en Exchange (§0.3) **no se aplicó**. Requiere rol de *Organization Management*, que la
> cuenta del proyecto no tiene —los cmdlets ni siquiera aparecen en su sesión de Exchange Online,
> porque ahí los permisos filtran el catálogo—, y el usuario decidió no bloquear la entrega por
> algo que solo protege un escenario de secreto filtrado en un sitio que vive un día. Queda
> registrado en `docs/SEGURIDAD.md` §Riesgos aceptados. Todo lo demás se construyó tal como está
> aquí descrito.

## Contexto

Hoy `/escarapela` es la única superficie con sesión del sitio: quien entra con su cuenta
corporativa ve su carné y su acceso queda en el registro de asistencia
(`auth/auditoria.js` → `AUDIT_LOG_PATH`). Lo que falta es **cerrar el círculo con la persona**:
que su primer inicio de sesión le llegue por correo como una confirmación de inscripción al foro,
y que los inicios siguientes **no** vuelvan a escribirle.

Este documento es el plan de esa función, de punta a punta: permisos en Entra, backend, frontend,
entorno, despliegue, verificación y la evidencia que hay que poder poner sobre la mesa si alguien
audita el envío.

**Piloto acotado:** en esta primera etapa el correo se envía **únicamente** a tres buzones —
`jcespedes@gecelca.com.co`, `llondono@gecelca.com.co` y `lrojas@gecelca.com.co`— y sale desde
`jcespedes@gecelca.com.co`. Cualquier otra cuenta que inicie sesión no recibe nada y **no** deja
rastro en el libro de inscripciones (ver §2.4: es lo que permite abrir la lista después sin dejar
a nadie fuera).

---

## Decisiones ya tomadas (no re-preguntar)

| Decisión | Elegido | Por qué |
|---|---|---|
| Permiso de Graph | **`Mail.Send` de aplicación** (client credentials), no delegado | El delegado envía *como el asistente* (aparece en su bandeja de Enviados y el remitente es él mismo): para una confirmación de inscripción es incorrecto. Además obligaría a meter el scope en el login, que hoy es mínimo a propósito |
| Acotación del permiso | **`ApplicationAccessPolicy` de Exchange Online** a un único buzón | `Mail.Send` de aplicación concede, por defecto, enviar como **cualquier** buzón del tenant. Sin la política, el alcance real de un secreto filtrado es el correo de toda la empresa |
| Registro de la app | **App Registration aparte** de la del login | Separa el radio de daño: el secreto del login no puede enviar correo y el del correo no puede iniciar sesión de nadie |
| Señal de «primer login» | **Estado propio**, indexado por `oid` | Graph no tiene señal fiable. Los sign-in logs exigen Entra ID P1, no son inmediatos y piden `AuditLog.Read.All`; marcar el objeto de usuario pide `User.ReadWrite.All`. Ambos son mucho más permiso por mucha menos garantía |
| Clave de idempotencia | **`oid`**, nunca el UPN | El `oid` es inmutable en el tenant; un correo puede cambiar (matrimonio, corrección de alias) y partiría el histórico en dos |
| Superficie HTTP nueva | **Ninguna** | No hay endpoint para disparar, reintentar ni consultar el envío. `/api/me` solo gana un campo. Un botón de «reenviar» sería un generador de correo a discreción del cliente |
| Bloqueo del login | **Ninguno** | La reserva es síncrona y en memoria; el envío ocurre después del redirect. Graph nunca está en el camino crítico de un login |

---

## Lo que NO se va a hacer (límites duros)

- **No se manda nada que autentique.** Sin enlaces mágicos, sin tokens en la URL, sin adjuntos
  ejecutables. El único enlace del correo es `PUBLIC_ORIGIN + /escarapela`, construido desde la
  variable de entorno ya validada en `server/index.js:38-48`, jamás desde una cabecera del request.
- **No se pide nada por correo.** Ni contraseña, ni «verifica tu cuenta», ni formularios. Un correo
  automático corporativo que pide datos es un simulacro de phishing involuntario.
- **No se persisten tokens.** Ni el de aplicación ni el de sesión tocan disco. El de aplicación vive
  en la caché en memoria de MSAL y muere con el proceso.
- **No se registra la dirección de destino en el libro.** Ver §2.3.
- **No se toca `server/auth/`** más allá de tres líneas en el callback de `app.js`. El flujo OIDC
  queda como está (regla de `CLAUDE.md`).

---

## Fase 0 — Lo que no es código, y bloquea

### 0.1 BLOQUEANTE: el unit de systemd niega toda salida a internet

`deploy/systemd/gtalks.service:67-68` tiene:

```ini
IPAddressAllow=localhost
IPAddressDeny=any
```

Ese par no es solo entrada: el filtro BPF de systemd aplica a **egress** también. Con él, el
proceso no puede hablar con `login.microsoftonline.com` (el canje del código de autorización) ni
con `graph.microsoft.com` (el cargo del asistente, y ahora el envío). El comentario de la línea 66
lo describe como refuerzo de la escucha en loopback, pero el efecto real es más ancho.

**Hay que corregirlo antes de nada**, porque hoy tumba el login en producción, no solo el correo:

- Quitar `IPAddressDeny=any` / `IPAddressAllow=localhost` del unit.
- La restricción de **entrada** ya la dan `listen('127.0.0.1')` (`server/index.js:15,54`), nginx
  como único interlocutor y ufw en el borde: no se pierde nada.
- Si se quiere conservar un cepo de egress, hacerlo en nftables contra los rangos de Microsoft 365,
  no aquí: esos rangos cambian y un unit desactualizado se convierte en una caída silenciosa a
  mitad de evento.
- Verificación de que quedó bien: `systemd-analyze security gtalks` y, sobre el servidor,
  `sudo -u gtalks curl -sS -o /dev/null -w '%{http_code}\n' https://graph.microsoft.com/v1.0/$metadata`.

### 0.2 App Registration del correo

Nueva app (p. ej. `G-TALKS · correo de inscripción`), en el tenant de GECELCA:

| Paso | Detalle |
|---|---|
| Permiso | API permissions → Microsoft Graph → **Application permissions** → `Mail.Send` |
| Consentimiento | «Grant admin consent» — es obligatorio, no lo puede dar el usuario |
| Credencial | Client secret con vida de 12 meses, expirando ~2 meses **después** del evento (misma regla que el secreto del login, `docs/SEGURIDAD.md` §Rotación) |
| Sin redirect URI | Es un cliente daemon: no tiene flujo interactivo. Dejarlo sin plataformas configuradas |
| Sin permisos delegados | Ni uno. Si hay alguno heredado del asistente de creación (`User.Read`), quitarlo |

### 0.3 Acotar el permiso en Exchange Online — ⚠ NO APLICADO

> **Desviación aceptada.** Esta sección se conserva porque sigue siendo lo correcto y porque es lo
> que hay que hacer si el correo se abre a todo el tenant o el sitio pasa a vivir más de una
> edición. Hoy **no está aplicado**: exige rol de *Organization Management* en Exchange (con menos
> rol, `New-ApplicationAccessPolicy`, `New-ServicePrincipal` y `New-ManagementRoleAssignment` ni
> aparecen en la sesión), y se decidió no bloquear la entrega por ello.
>
> Lo que **sí** protege mientras tanto: la lista blanca de **destinatarios** en el código
> (`INSCRIPCION_DESTINATARIOS`, con fallo cerrado y comprobada por `inscripcion-test.mjs`) y los
> secretos en `/etc/gtalks/env`. Lo que queda expuesto es el escenario «alguien lee ese archivo»:
> con el secreto en la mano podría enviar como cualquier buzón del tenant, no solo como el del
> foro.
>
> Nota sobre los cmdlets: `New-ApplicationAccessPolicy` está siendo retirado por Microsoft en favor
> de **RBAC for Applications** (`New-ServicePrincipal` + `New-ManagementScope` +
> `New-ManagementRoleAssignment -Role "Application Mail.Send" -CustomResourceScope`). Quien tenga
> el rol verá cuál de los dos existe en el tenant.

Sin esto, `Mail.Send` de aplicación = enviar como cualquiera del tenant. Con Exchange Online
PowerShell:

```powershell
# Grupo de seguridad con correo, con UN solo miembro: el buzón remitente
New-DistributionGroup -Name "GTALKS-Remitentes" -Type Security `
  -Members jcespedes@gecelca.com.co -PrimarySmtpAddress gtalks-remitentes@gecelca.com.co

New-ApplicationAccessPolicy -AppId <MAIL_CLIENT_ID> `
  -PolicyScopeGroupId gtalks-remitentes@gecelca.com.co `
  -AccessRight RestrictAccess `
  -Description "G-TALKS: la app solo puede enviar desde el buzon del foro"

# Comprobación explícita, y la captura que se le enseña al auditor:
Test-ApplicationAccessPolicy -Identity jcespedes@gecelca.com.co -AppId <MAIL_CLIENT_ID>  # Granted
Test-ApplicationAccessPolicy -Identity <cualquier-otro>@gecelca.com.co -AppId <MAIL_CLIENT_ID>  # Denied
```

La política tarda hasta ~30 minutos en propagarse: hacerlo el día antes de la primera prueba, no
el mismo día.

> **Para el evento real, cambiar el remitente a un buzón compartido** (`comunicaciones@…` o
> `gtalks@…`). Enviar desde el buzón de una persona es aceptable en el piloto y deja evidencia
> cómoda en sus Enviados, pero en producción ata la comunicación institucional a una identidad
> individual: si esa persona sale, el correo del foro se cae con ella.

### 0.4 Entregabilidad: no hay nada que hacer

El envío sale de Exchange Online con un buzón real del dominio, así que SPF, DKIM y DMARC de
`gecelca.com.co` ya están alineados. No hay que tocar DNS, no hay relay externo, no hay
credenciales SMTP. Es, de lejos, la razón operativa más fuerte para usar Graph y no un SMTP suelto.

---

## Fase 1 — El contenido del correo sale de la misma fuente que el sitio

El correo dice la fecha, el lugar y el nombre del foro. Esos datos ya viven en `EVENTO`
(`src/data/foro.ts:14-25`), que es TypeScript compilado por Vite: el servidor, que es JS plano sin
build, no puede importarlo. Copiarlos a mano en `server/` crea dos verdades que van a divergir el
día que se resuelva el pendiente #1 (el lugar: los PDF dicen «G Working», la carpeta dice
«Puerta de Oro»).

**Extraer los hechos canónicos a `src/data/evento.json`**, con dos consumidores:

- `src/data/foro.ts` lo importa (`resolveJsonModule` ya está activo en `tsconfig.json`) y sigue
  exportando `EVENTO` con su tipado; la transcripción literal del copy no se mueve de `foro.ts`.
- `server/correo/evento.js` lo lee con `fs.readFileSync` resolviendo desde `import.meta.url`.

`git archive` lo lleva al servidor y `npm prune --omit=dev` no toca `src/`, así que el archivo está
en tiempo de ejecución. Aun así, **guardia al arrancar**: si el JSON no existe o le falta un campo,
el error sale con nombre propio en vez de mandar un correo con un `undefined` dentro.

> **Corrección sobre el plan original**, decidida al implementar: esa guardia **no aborta el
> proceso**, apaga el envío y deja el sitio en pie. Abortar habría significado que vaciar la sede
> en `evento.json` —una edición de contenido que no rompe la compilación— tumbara el foro entero,
> que es público. El correo es un requisito del envío, no del sitio.

---

## Fase 2 — El libro de inscripciones (la idempotencia)

`server/correo/libro-inscripciones.js`. Es el módulo que garantiza «una vez y solo una».

### 2.1 Es estado, no un log

Va en **`/var/lib/gtalks/inscripciones.jsonl`**, no en `/var/log/gtalks/`. La distinción no es
estética: `deploy/logrotate/gtalks` usa `copytruncate`, y un truncado del libro haría que, tras el
siguiente reinicio, el proceso arrancara creyendo que nadie se ha inscrito y **volviera a escribir
a todo el mundo**. Un archivo que rota no puede ser la memoria de la idempotencia.

En el unit: `StateDirectory=gtalks` (systemd crea `/var/lib/gtalks` con el dueño correcto e implica
la ruta escribible). El comentario de `ReadWritePaths` que hoy dice «única ruta escribible» se
actualiza a dos, explicando por qué son dos.

### 2.2 Formato y API

JSONL append-only, una línea por transición:

```json
{"ts":"2026-08-05T13:02:11.418Z","oid":"3f2a…","estado":"reservado","intento":1}
{"ts":"2026-08-05T13:02:12.902Z","oid":"3f2a…","estado":"enviado","peticion":"9c1e…","http":202}
```

| Función | Contrato |
|---|---|
| `cargar()` | Al arrancar: lee el archivo línea a línea y construye un `Map<oid, {estado, ts}>` con la **última** transición de cada `oid`. Una línea corrupta se salta con un `console.warn` y no tumba el arranque |
| `estado(oid)` | Lectura del `Map`. Es lo que responde `/api/me` |
| `reservar(oid)` | **Check-and-append síncrono.** Si el `oid` ya está en el `Map`, devuelve `false` y no escribe. Si no, escribe la línea `reservado` con `fs.appendFileSync` y devuelve `true` |
| `resolver(oid, estado, meta)` | Añade la transición final (`enviado` / `fallido` / `simulado`) y actualiza el `Map` |

**Por qué `reservar` es síncrono y no `async`:** el bucle de eventos de Node es de un solo hilo,
así que entre el `Map.has` y el `Map.set` no puede colarse otra ejecución. Es la única forma de que
dos pestañas iniciando sesión a la vez no reserven las dos. Un `await` en medio abriría exactamente
ese hueco. Con `O_APPEND` (que es lo que hace `appendFileSync` con `flags:'a'`), una línea de menos
de 4 KB se escribe atómicamente en Linux.

### 2.3 Qué NO se guarda: la dirección

El libro guarda `oid`, estado, marca de tiempo e identificador de la petición a Graph. **No guarda
el correo.** Minimización de datos: para no repetir un envío basta el seudónimo, y quién recibió
qué ya es reconstruible por dos vías mejores —el `message trace` de Exchange (que es el registro
autoritativo del envío) y `acceso.log`, que ya correlaciona `oid` ↔ UPN con su plazo de borrado
documentado—. Un dato personal menos que custodiar, sin perder una sola respuesta que un auditor
pueda pedir.

### 2.4 Quien no está en la lista no deja línea

Si el correo cae fuera de la lista de destinatarios, **no se escribe nada en el libro**. Es
deliberado: cuando la lista se amplíe (o se pase a `todos`), esas personas siguen contando como
«sin inscribir» y reciben su correo en su siguiente inicio de sesión. Si se anotaran como
«omitidas», abrir la lista no serviría de nada y el fallo sería silencioso.

### 2.5 El libro arranca vacío

Quien haya iniciado sesión **antes** de desplegar esta función cuenta como no inscrito y recibirá el
correo en su siguiente entrada. Es la única semántica posible sin inventarse un histórico, y hay
que dejarlo escrito: es la primera pregunta que hace alguien revisando por qué a Fulano le llegó
«tarde».

---

## Fase 3 — El transporte

`server/correo/graph-mailer.js`. Una sola responsabilidad: poner un mensaje en Graph.

```js
export function crearMailer({ obtenerToken, baseUrl = 'https://graph.microsoft.com/v1.0', fetchImpl = fetch })
// → { enviar({ remitente, para, asunto, html }) : Promise<{ ok, http, peticion }> }
```

- **Inyección de dependencias en el borde, no por entorno.** `baseUrl`, `fetchImpl` y `obtenerToken`
  se inyectan para poder probar contra un Graph falso. En producción son los valores por defecto
  del propio módulo: no hay ninguna variable de entorno que pueda reapuntar a dónde se manda el
  correo, que sería un SSRF con credenciales corporativas dentro.
- **Token de aplicación** con un `ConfidentialClientApplication` propio a nivel de módulo
  (`MAIL_TENANT_ID` / `MAIL_CLIENT_ID` / `MAIL_CLIENT_SECRET`) y
  `acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] })`. MSAL
  cachea el token (~1 h) en memoria si se reutiliza la instancia. **No** se reutiliza
  `buildClient(session)` de `auth/m365.js`: esa está particionada por sesión, y mezclarlas sería
  meter un token de aplicación en la caché de una persona.
- `POST /users/{remitente}/sendMail` con `saveToSentItems: true` (deja copia en Enviados: evidencia
  gratis) y `Content-Type: application/json`. Éxito = **202**.
- **Cabecera `client-request-id`** con un `crypto.randomUUID()` propio, que se guarda en el libro.
  Es lo que permite casar una línea del libro con una entrada del `message trace` de Exchange sin
  ambigüedad.
- **Tiempos y reintentos:** `AbortSignal.timeout(10_000)`. Un reintento único ante `429`/`503`/`504`
  respetando `Retry-After` (con tope de 30 s); ante `4xx` que no sea 429, cero reintentos —un 403
  no mejora repitiéndolo—. Después, `fallido`.
- **Cola de concurrencia 1.** Los envíos se serializan en una cola en memoria. Graph limita a ~30
  mensajes por minuto y por buzón: con tres destinatarios sobra, pero el día que la lista se abra,
  la llegada del auditorio a la misma hora no puede convertirse en una tormenta de 429.
- **Nunca se registra** el token, la cabecera `Authorization`, el cuerpo del mensaje ni el secreto.
  Del error solo salen el código HTTP y el `code` de Graph.

---

## Fase 4 — La plantilla

`server/correo/plantilla-inscripcion.js`, **función pura**: `componer({ nombre, evento, url })` →
`{ asunto, html }`. Pura porque así se puede probar el escapado y el copy sin red ni Graph.

- **Escapado obligatorio** de `nombre` (viene del directorio, pero es un dato externo al código) en
  las cinco entidades HTML. Sin excepciones y sin plantillas que interpolen sin escapar.
- **HTML de correo, no HTML de web**: tablas, estilos en línea, ancho máximo 600 px, sin CSS
  externo, sin fuentes remotas, sin imágenes remotas (Outlook las bloquea y además dejarían un
  píxel de rastreo, que aquí no se quiere ni por accidente). Colores de marca escritos literales;
  `tokens.css` no viaja al correo.
- `lang="es-CO"`, jerarquía de encabezados real y contraste AA: las mismas reglas del sitio.
- **Copy en es-CO con tuteo.** Asunto: *«Tu inscripción al 1° Foro GECELCA G-TALKS quedó
  registrada»*. Cuerpo: saludo con el nombre, confirmación, fecha y lugar desde `evento.json`, el
  enlace a `/escarapela` y la nota de que la escarapela lleva el QR del registro de asistencia.
- **Limitación documentada:** `sendMail` de Graph acepta un único cuerpo, así que va HTML. No hay
  alternativa en texto plano; los clientes corporativos del tenant lo renderizan sin problema.

---

## Fase 5 — La política y el enganche

`server/correo/inscripcion.js`. Es la única pieza que conoce las reglas de negocio.

### 5.1 Configuración, leída una vez al arrancar

| Variable | Valores | Nota |
|---|---|---|
| `INSCRIPCION_MODO` | `off` (defecto) · `simulacro` · `lista` · `todos` | `off` = la función no existe. `simulacro` recorre todo y escribe el libro pero **no** llama a Graph |
| `INSCRIPCION_DESTINATARIOS` | CSV de correos | Solo se usa en modo `lista`. Vacío en modo `lista` ⇒ no se envía a nadie (fallo cerrado) |
| `INSCRIPCION_REMITENTE` | `jcespedes@gecelca.com.co` | Debe coincidir con el buzón de la `ApplicationAccessPolicy` |
| `INSCRIPCION_LIBRO` | `/var/lib/gtalks/inscripciones.jsonl` | |
| `MAIL_TENANT_ID` / `MAIL_CLIENT_ID` / `MAIL_CLIENT_SECRET` | | Obligatorias si el modo no es `off` ni `simulacro`; si falta alguna, el arranque **aborta** |

**Dos llaves para abrir el envío masivo, no una.** Pasar de tres personas a todo el mundo exige
cambiar `INSCRIPCION_MODO` *y* borrar la lista: ninguna errata de una sola variable puede escribirle
al tenant entero. Al arrancar, el proceso imprime una línea con el modo, el remitente y **cuántos**
destinatarios hay (nunca cuáles), igual que hacen hoy las dos líneas `[auth]` de `app.js:417-418`.

### 5.2 La decisión

```
reservarInscripcion({ oid, correo })            ← síncrono, dentro del callback
  1. modo === 'off'                    → false
  2. destinoAutorizado(correo) === null → false, y NO se escribe en el libro (§2.4)
  3. libro.reservar(oid)               → true solo la primera vez

enviarInscripcion({ oid, correo, nombre })      ← después del redirect
  1. el libro NO tiene reserva viva     → nada (dos llamadas ≠ dos correos)
  2. destinoAutorizado(correo) === null → «fallido: destino_no_autorizado», y grita en el log
  3. modo === 'simulacro'               → «simulado», sin tocar la red
  4. cola → mailer.enviar(…)            → «enviado» | «fallido» (peticion, http)
```

**Por qué la lista se comprueba dos veces.** Entre `reservar` y `enviar` hay un redirect y un
llamador externo (`server/app.js`), y el destino viaja por parámetro. Con una sola comprobación, la
garantía sería una convención entre dos funciones; con la segunda, es una propiedad del módulo que
sobrevive a que alguien edite el llamador.

**Y por qué el destino sale de la configuración.** `destinoAutorizado()` no devuelve un booleano:
devuelve **la entrada de `INSCRIPCION_DESTINATARIOS`** con la que coincidió, y es esa cadena la que
se le pasa al transporte. Así, en modo `lista`, la dirección a la que sale el correo está
literalmente escrita en el entorno del servidor: ninguna normalización, codificación ni homógrafo
puede producir una dirección distinta, porque la dirección no se construye a partir de la entrada.

La comparación se hace normalizada (`trim` + minúsculas) contra el `upn` del `id_token` ya validado
(nonce y `tid` comprobados en `auth/m365.js:132-142`): jamás contra un parámetro del request. Por
debajo, `graph-mailer.js` se niega además a enviar a cualquier cosa que no sea **una** dirección.

### 5.3 El enganche en el callback

En `server/app.js`, justo después de `registrarAcceso({ resultado: 'ok', … })` (línea 318), donde
la identidad ya está validada y `oid` garantizado:

```js
const primeraVez = reservarInscripcion({ oid, email: upn });   // síncrono: cierra la carrera
```

y el envío se dispara **después** de que la respuesta haya salido, en el `req.session.save()` del
`regenerate` (línea 348), con `void enviarInscripcion(...)` envuelto en su propio `catch`. Reglas:

- El redirect **nunca** espera a Graph. Si Graph tarda 10 s, la persona ya está viendo su carné.
- Un fallo del correo **jamás** altera el login: mismo criterio de degradación suave que
  `obtenerPerfil` (`auth/m365.js:169-185`).
- Todo lo que sale a journald es seudónimo (`oid`), nunca el correo: la regla de `auditoria.js`.

### 5.4 `/api/me` gana un campo, y nada más

```js
res.json({ authenticated: true, user: { …, }, inscripcion: estadoInscripcion(oid) })
// estado: 'enviado' | 'pendiente' | 'fallido' | 'no_aplica'   (+ ts cuando aplica)
```

`no_aplica` cubre modo `off` y a quien está fuera de la lista: el frontend no puede distinguirlo
de «no configurado», y así debe ser. La ruta sigue siendo la única con sesión, sigue respondiendo
401 sin ella y sigue `no-store`.

---

## Fase 6 — Frontend

Poco código y muy medido: la interfaz solo refleja estado real del servidor, nunca lo supone.

| Archivo | Cambio |
|---|---|
| `src/data/sesion.ts` | La respuesta de `/api/me` gana `inscripcion?: { estado: EstadoInscripcion; ts?: string }`. `EstadoSesion` en estado `dentro` lo transporta. Opcional en el tipo: `npm run preview` sirve sin servidor y ahí no existe |
| `src/data/escarapela.ts` | `MENSAJES_INSCRIPCION: Record<EstadoInscripcion, string \| null>`, junto a `MENSAJES_AUTH`. Es el único sitio donde vive el copy |
| `src/pages/EscarapelaPage.tsx` | Bajo los controles de foto, un `<p role="status">` que pinta el mensaje cuando lo hay |
| `src/pages/EscarapelaPage.css` | `.gt-escarapela__inscripcion`, hermana de `.gt-escarapela__nota` |

Copy (es-CO, tuteo):

| Estado | Texto |
|---|---|
| `enviado` | «Te enviamos la confirmación de tu inscripción a tu correo corporativo.» |
| `fallido` | «No pudimos enviarte la confirmación por correo. Tu escarapela funciona igual; si necesitas el comprobante, escríbele a Comunicaciones.» |
| `pendiente` · `no_aplica` | *(nada)* |

**La carrera, y su única concesión:** el envío ocurre después del redirect, así que el primer
`/api/me` de la SPA puede llegar a ver `pendiente`. Se resuelve con **una sola recomprobación a los
6 s**, y solo si el estado era `pendiente` —no es un `poll`, no hay intervalo, no hay reintentos—.
Si sigue pendiente, no se pinta nada: no se anuncia un correo que quizá no salió.

Nada de esto oculta contenido a la espera de un evento (regla de `CLAUDE.md`): el carné se pinta
igual, y esta línea aparece o no aparece.

---

## Fase 7 — Entorno, systemd, rotación y despliegue

| Archivo | Cambio |
|---|---|
| `.env.example` | Bloque nuevo `─── Correo de inscripción ───` con las siete variables, comentadas al estilo del archivo. Placeholders, nunca valores reales |
| `deploy/systemd/gtalks.service` | Quitar `IPAddressAllow`/`IPAddressDeny` (§0.1). Añadir `StateDirectory=gtalks`. Reescribir el comentario de `ReadWritePaths`: ahora son dos rutas y el porqué de cada una |
| `deploy/logrotate/gtalks` | **Sin cambios, y con una advertencia explícita en la cabecera:** `/var/lib/gtalks/inscripciones.jsonl` no se rota nunca. Rotarlo reenvía correos |
| `server/index.js` | `exigirEntorno()` valida también la coherencia del bloque de correo: modo distinto de `off`/`simulacro` exige las tres `MAIL_*` y un `INSCRIPCION_REMITENTE` con arroba |
| `/etc/gtalks/env` | Las variables nuevas (0600 root:root, como el resto de secretos) |
| `docs/SEGURIDAD.md` | §Registro de acceso gana la tabla del libro; §Secretos gana la fila del secreto del correo con su fecha de expiración; §Respuesta a incidentes gana la fila «hay que parar los envíos» (`INSCRIPCION_MODO=off` + `systemctl restart`); §Riesgos aceptados gana dos filas (§10) |
| `docs/DESPLIEGUE.md` | La comprobación de salud y el ensayo mencionan el modo de inscripción |
| `CLAUDE.md` | Una viñeta en Convenciones: el correo se manda una vez, la prueba es el libro, y el libro no rota |

---

## Fase 8 — Verificación

Un script nuevo y tres ampliaciones, siguiendo la costumbre de la casa: cada pieza trae su arnés.

### 8.1 `scripts/inscripcion-test.mjs` (nuevo, sin red)

Levanta un **Graph falso** con `node:http` y lo inyecta en `crearMailer`. Cubre:

| Caso | Qué prueba |
|---|---|
| Dos entradas del mismo `oid` | Un solo `sendMail`. **Es la prueba de la idempotencia** |
| `oid` fuera de la lista | Cero llamadas y **cero líneas** en el libro (§2.4) |
| Reinicio: recargar el libro desde disco | Tras `cargar()`, el `oid` ya inscrito no vuelve a enviar |
| Libro truncado a cero | Vuelve a enviar — documenta el porqué de no rotarlo |
| `429` con `Retry-After` | Un reintento, luego `enviado` |
| `500` persistente | `fallido`, sin bucle, y el login intacto |
| Nombre con `<script>` | Sale escapado en el HTML |
| Modo `simulacro` | Escribe `simulado` y no llama a Graph ni una vez |
| Diez entradas simultáneas de diez `oid` | La cola serializa: nunca dos peticiones en vuelo |

### 8.2 Ampliaciones

- **`scripts/gate-test.mjs`**: que la función **no** añadió superficie. `/api/me` sigue 401 sin
  sesión; `POST`/`PATCH` siguen 403; no responde ninguna ruta `/api/inscripcion*` (404); el HTML
  sigue saliendo con su CSP.
- **`scripts/sesion-test.mjs`**: los tres estados de la línea, simulando `/api/me` con
  `inscripcion.estado` en `enviado`, `fallido` y `no_aplica`.
- **`scripts/a11y-test.mjs`**: contraste y `role="status"` de la línea nueva.

### 8.3 Antes de dar por buena la puesta en marcha

```bash
npm run build && node scripts/inscripcion-test.mjs
npm run start:local && node scripts/gate-test.mjs
bash deploy/ensayo-local.sh --completo     # que el server arranque podado con el bloque nuevo
```

Y en el servidor: `Test-ApplicationAccessPolicy` en ambos sentidos, y el `message trace` de Exchange
casando el `client-request-id` con la línea del libro.

---

## Fase 9 — Puesta en marcha, en cuatro escalones

Ninguno se salta, y entre uno y otro se mira el libro y el `message trace`.

1. **Local, `INSCRIPCION_MODO=simulacro`** con los tres destinatarios. Login real con
   `npm run dev:auth` + `npm run dev`. Se verifica que el libro **del ensayo**
   (`.datos/inscripciones.jsonl.simulacro`) se escribe, que el segundo login no añade línea y que
   la interfaz no promete nada. **No sale ni una petición de red**: en `simulacro` ni siquiera se
   construye el cliente de MSAL. El libro real se queda vacío, así que este paso no te deja
   marcado para el siguiente.
2. **Local, `lista` con UN solo correo** (`jcespedes@gecelca.com.co`). Es el primer envío real y
   es donde se descubre si `Mail.Send` quedó bien consentido. Aquí se lee el correo de verdad: en
   Outlook, en el móvil y en modo oscuro. Ojo: en local, `PUBLIC_ORIGIN` es `http://localhost:5173`,
   así que el enlace del correo apuntará ahí — es lo esperado, y se corrige solo en el servidor.
3. **Local, `lista` con los tres.** Cada persona entra una vez; se comprueba que recibe uno y solo
   uno, y que el segundo login no manda nada.
4. **Servidor**, con `PUBLIC_ORIGIN` real.
5. **Ampliar la lista** (o pasar a `todos` cambiando las dos llaves de §5.1) cuando Comunicaciones
   lo apruebe por escrito, y con el remitente ya movido al buzón compartido.

---

## Blindaje de auditoría

La pregunta que llega, y el archivo que la contesta.

| Pregunta | Evidencia |
|---|---|
| ¿Con qué permiso mandan correo? | `Mail.Send` de aplicación, con consentimiento de administrador registrado en Entra |
| ¿Pueden suplantar a cualquier empleado? | No: `Test-ApplicationAccessPolicy` devuelve `Denied` para todo buzón que no sea el del foro |
| ¿El sitio puede iniciar sesión con esas credenciales? | No: es otra App Registration, sin permisos delegados y sin redirect URI |
| ¿Cómo sé que nadie recibió dos correos? | El libro es append-only y la reserva es una comprobación atómica; lo prueba `inscripcion-test.mjs`, y el `message trace` de Exchange lo confirma desde fuera |
| ¿Quién recibió cuál correo? | `message trace` de Exchange (autoritativo) + `acceso.log` para el `oid` ↔ UPN. La app no duplica esos datos personales |
| ¿Se puede disparar un envío desde fuera? | No hay endpoint. `gate-test.mjs` verifica que no existe |
| ¿Dónde están los secretos? | `/etc/gtalks/env`, 0600 root:root, leído por systemd como PID 1. No en el repo, no en el árbol de la app |
| ¿Se registran tokens o direcciones? | No. La regla ya existente de `auditoria.js` se extiende al módulo nuevo, y el libro guarda seudónimos |
| ¿Cuánto tiempo se conserva el dato? | El libro vive lo que la edición y se archiva y borra en el paso 5 del §Ciclo anual de `docs/SEGURIDAD.md` |
| ¿Se avisó a la persona? | Sí, junto al botón de entrar en `/escarapela`, antes de iniciar sesión (§siguiente) |
| ¿Cómo se para todo, ya? | `INSCRIPCION_MODO=off` + `systemctl restart gtalks`. Y el botón grande sigue siendo Entra |

**Aviso de privacidad.** La línea que hoy dice *«Tu acceso queda registrado para el control de
asistencia del foro.»* (`EscarapelaPage.tsx:167-169`) pasa a decir también que la primera vez se
envía una confirmación al correo corporativo. Se avisa **antes** del login, no después: es el orden
que exige un tratamiento de datos que se anuncia, y es una línea de copy, no una función.

---

## Riesgos aceptados

| Riesgo | Por qué se acepta | Revisión |
|---|---|---|
| **Un reinicio entre `reservar` y `enviar` deja un `reservado` huérfano**: esa persona no recibe correo y no se reintenta sola | La alternativa (reintento automático al arrancar) puede duplicar envíos, que es el fallo que esta función existe para evitar. El huérfano es visible: `grep '"reservado"' inscripciones.jsonl` y comparar con los resueltos | Antes del evento, revisar el libro una vez al día |
| **El libro es un archivo, no una base de datos** | Coherente con el resto del proyecto: sin BD, sesiones en memoria, un solo proceso. Un `Map` en un proceso único es la garantía correcta a esta escala | Si algún día hay más de un proceso, el `Map` deja de bastar |
| **Correo solo en HTML** | `sendMail` de Graph acepta un cuerpo único. El tenant es Exchange Online: no hay clientes de texto plano en juego | |
| **`saveToSentItems: true` llena los Enviados del remitente** | Es evidencia, y en el piloto son tres correos. Con buzón compartido deja de afectar a una persona | Al mover el remitente |
| **Quien ya inició sesión antes del despliegue recibe el correo «tarde»** | No hay histórico que reconstruir sin inventarlo (§2.5) | |

---

## Pendientes con terceros

| # | Qué | Estado |
|---|---|---|
| 1 | **Consentimiento de administrador** para `Mail.Send` de aplicación | ✅ hecho (app `ec13cb64-3a24-4bdf-80d3-0a3cc008cc23`) |
| 2 | **Acotar el remitente en Exchange** (§0.3) | ⚠ **no aplicado** riesgo aceptado, ver la nota de arriba |
| 3 | **Corregir el unit** (§0.1) | ✅ hecho en el repo. Falta que llegue al servidor, que aún no existe |
| 4 | **`MAIL_TENANT_ID` / `MAIL_CLIENT_ID` / `MAIL_CLIENT_SECRET`** en `.env` y en `/etc/gtalks/env` | pendiente: sin ellas el módulo se queda en `off` |
| 5 | **Buzón compartido** para el remitente definitivo, antes del evento real | pendiente. Hoy sale del buzón de una persona |
| 6 | **El lugar del evento** (pendiente #1 de `docs/PENDIENTES-DE-CONTENIDO.md`) | pendiente. El correo lo cita desde `src/data/evento.json`, la misma fuente que el sitio: cuando se resuelva ahí, el correo se corrige solo |
