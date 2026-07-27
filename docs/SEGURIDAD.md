# Seguridad y operación del sitio

Este documento es el manual de guardia: qué protege el sitio, qué se hace cuando algo va mal y
qué toca revisar antes de cada edición del foro.

El plan completo de auditoría (modelo de amenaza, 18 hallazgos y su remediación) está en el
archivo de plan del rediseño; aquí queda lo operativo.

---

## Qué protege el gate, y qué no

**Quién entra lo decide Entra**, no el código: la Enterprise App tiene «Asignación requerida = Sí»
y solo pasan los usuarios y grupos asignados. No hay allowlist local ni roles de negocio.

El servidor comprueba, en este orden: sesión válida → activo público del login → tipo de petición.

### La política de acceso sin sesión

Redirigir literalmente **todo** a Microsoft rompería el sitio: un 302 a `login.microsoftonline.com`
sobre un `<script>` devuelve HTML que no parsea, sobre un `fetch` da un error de CORS opaco, y
sobre un `POST` pierde el cuerpo. Lo que sí se garantiza es lo que el requisito quiere decir:

> **Ninguna navegación de una persona termina en un callejón sin salida que no sea Microsoft.**

| Petición sin sesión | Respuesta |
|---|---|
| Navegación (`Sec-Fetch-Dest: document`), incluidas `HEAD` y una URL de asset escrita a mano | **302 → Entra** |
| Subrecurso (script, hoja, imagen, fuente) | 401 |
| `fetch`/XHR y todo `/api/*` | 401 JSON |
| Métodos que no son de lectura | 401 (nunca 302: perdería el cuerpo) |
| Con marcador `?auth=<motivo>` | pantalla de login con el mensaje |

La clasificación usa `Sec-Fetch-*`, con `Accept` como respaldo para clientes que no lo mandan.
Por eso `https://sitio/img/hero.webp` pegado en la barra de direcciones **sí** va a Microsoft,
mientras que ese mismo archivo pedido por un `<img>` de una pestaña vieja recibe 401.

### El servidor de desarrollo también está gateado

`npm run dev` servía la SPA completa en `:5173` sin login, porque el gate solo existía en Express.
Un entorno de trabajo que se comporta distinto del que se publica es una trampa, y además invita a
sacar capturas o compartir el puerto sin darse cuenta de que no hay puerta.

Ahora un plugin de Vite (`vite.config.ts`) aplica la misma política en dev: intercepta las
navegaciones, consulta la sesión contra el Express y, si no hay, **delega la petición en el gate**.
Los módulos de Vite y el HMR pasan intactos. **Falla cerrado**: si el gate no está levantado,
muestra una página que dice qué comando falta en vez de servir el sitio. Un gate que se cae abierto
no es un gate.

Dos detalles que costaron un bucle infinito y merecen no repetirse:

- **Delegar, no reimplementar.** La primera versión redirigía siempre a `/auth/login?silent=1` e
  ignoraba el marcador `?auth=` con el que vuelve el callback, así que la pantalla de login nunca
  llegaba a servirse y el navegador rebotaba sin fin. Con la delegación hay UNA sola política.
- **El reenvío va con `node:http`, no con `fetch`.** undici trata `Sec-Fetch-*` como cabeceras
  prohibidas y las sobrescribe: el gate veía la petición reenviada como un subrecurso y respondía
  401 en vez de mandar al login. La misma trampa aparece al escribir pruebas: por eso
  `gate-test.mjs` tampoco usa `fetch`.

Para trabajar el diseño sin autenticación está `npm run preview`, que sirve `dist/` tal cual y es
lo que usan los scripts de verificación.

### Quién entró, y cómo salir

El menú de sesión (arriba a la derecha; en móvil, dentro del panel) muestra el nombre y el cargo
de quien está viendo el sitio, y ofrece **cambiar de cuenta** y **cerrar sesión**.

- El **cargo** no es un claim de OIDC: se pide a Graph (`User.Read`) al iniciar sesión. Si Graph
  falla o el invitado no tiene cargo en el directorio, se muestra el correo. El login nunca depende
  de ello.
- **Cerrar sesión es una navegación a `/auth/logout`, no un `fetch`.** Tiene que llevar al
  front-channel logout de Microsoft para que la sesión muera también en Entra: si solo se destruyera
  la cookie local, el siguiente visitante del mismo navegador entraría solo por SSO silencioso.
- **Cambiar de cuenta** (`/auth/login?select=1`) es la salida para el ponente externo que llegó
  autenticado con su propio Microsoft y chocó con «no tienes acceso».

### El rompebucles, y qué NO debe contar

Si la cookie de sesión no se puede fijar (proxy sin `X-Forwarded-Proto`, navegador bloqueando
cookies), el gate redigiría eternamente sin decir nada. Una cookie contador propia (`gt_lt`, 5
minutos) corta al tercer intento y manda a la pantalla con `?auth=cookies_bloqueadas`, que nombra
la causa.

⚠ **Solo se cuentan los intentos automáticos (`silent=1`).** La primera versión contaba todos los
arranques de login, y como cada carga de página dispara un intento silencioso, a la tercera
recarga el botón «Iniciar sesión» **dejaba de hacer absolutamente nada** durante cinco minutos.
Un clic de una persona es intención, no un bucle: siempre arranca un login real y pone el contador
a cero. `gate-test.mjs` cubre este caso explícitamente como regresión.

Y cuando el cortacircuitos salta, **redirige** con el marcador en vez de servir el HTML en la URL
`/auth/login`: si no, el diccionario de mensajes no encuentra ningún `?auth=` y la tarjeta sale en
blanco, que es la misma sensación de «no hace nada» que se quería evitar.

---

## Verificación

```bash
npm run build
npm run start:local          # o `npm start` con el entorno puesto
node scripts/gate-test.mjs   # 37 comprobaciones: matriz del gate, CSP, cabeceras, rompebucles
```

`gate-test.mjs` usa `node:http` y **no** `fetch`: undici fuerza `Sec-Fetch-Mode: cors` y no permite
emular una navegación de navegador, que es justo lo que hay que distinguir. Con `fetch` el script
reportaría 401 en las navegaciones y el fallo estaría en la prueba, no en el servidor.

En producción, además: `curl -I` contra el dominio, contraste con securityheaders.com, `testssl.sh`
para el TLS y la consola del navegador sin violaciones de CSP en las cinco rutas.

---

## Respuesta a incidentes

**El botón de pánico es Entra, no el servidor.** En la Enterprise App, «Habilitado para que los
usuarios inicien sesión = No» corta todos los accesos al instante; la revalidación silenciosa mata
las sesiones ya abiertas en ≤20 minutos sin tocar la máquina. Es más rápido y más fiable que apagar
el servicio.

| Situación | Acción | Efecto |
|---|---|---|
| Acceso indebido de una persona | Quitar su asignación (o sacarla del grupo) | Su sesión muere en ≤20 min |
| Incidente general | Deshabilitar el inicio de sesión en la Enterprise App | Todos fuera, inmediato |
| Sospecha sobre el secreto | Rotar en el App Registration → actualizar `/etc/gtalks/env` → `systemctl restart gtalks` | Las sesiones vivas **sobreviven** (sus tokens ya están en memoria): si el incidente es robo de sesión, el reinicio es obligatorio |
| Sitio caído | `systemctl status gtalks`, `journalctl -u gtalks -n 100` | — |

**Qué vigilar en los logs:** ráfagas de `AADSTS50105` (alguien probando cuentas) y de
`state_invalido` (manipulación del callback). Ambas salen por `journalctl -u gtalks`.

**Contactos** — rellenar antes de publicar; sin nombres escritos, este manual no sirve el día que
hace falta:

- Entra ID / Enterprise App: _(nombre y contacto)_
- Servidor y nginx: _(nombre y contacto)_
- Responsable del registro de asistencia: _(nombre y contacto)_

---

## Registro de acceso

Es un **dato personal** y por eso va en dos flujos separados:

| Flujo | Destino | Contenido | Para qué |
|---|---|---|---|
| Operación | stdout → journald | `oid` (seudónimo), resultado | Diagnóstico. Sin correos regados por los logs del sistema |
| Asistencia | `AUDIT_LOG_PATH` → JSONL | marca de tiempo, `oid`, UPN, resultado | El registro que necesita Comunicaciones |

- Ruta recomendada: `/var/log/gtalks/acceso.log`, propietario `gtalks:gtalks`, modo `0640`.
- Rotación y borrado: `deploy/logrotate/gtalks` → **12 rotaciones semanales ≈ 90 días**.
- El aviso de privacidad está a la vista en la pantalla de login: *«Tu acceso queda registrado para
  el control de asistencia del foro.»*
- **Nunca** se registran tokens, ni el `code`, ni el `state`, ni el verifier PKCE.
- Si `AUDIT_LOG_PATH` se deja vacío, solo se emite el flujo seudónimo: el registro con nombre es
  una decisión explícita de despliegue, no algo que aparece por defecto.

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
- El fallo realista de un sitio anual no es que roben el secreto: es que **expire y nadie se entere**.
  Anotar aquí la fecha de expiración y poner recordatorio de calendario.

> Secreto vigente creado el: ______  ·  Expira el: ______  ·  Responsable: ______

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
- Los invitados llegan con UPN de la forma `usuario_dominio.com#EXT#@gecelca…`. Cuando se construya
  la escarapela hay que mostrar `name` y nunca esa forma mutilada.

---

## Ciclo anual

**Al cerrar cada edición:**

1. Vaciar el grupo de acceso y quitar la asignación en la Enterprise App.
2. Borrar los objetos de usuario invitado creados solo para el evento.
3. `systemctl disable --now gtalks` — entre ediciones el servicio no corre. Es el control honesto,
   más que cualquier duración de sesión.
4. Rotar `SESSION_SECRET`.
5. Exportar la membresía del grupo y archivarla: es el registro auditable de quién pudo entrar.

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
| **Aviso `GHSA-qwww-vcr4-c8h2` en react-router 7.12–8.2** (alta) | Afecta al **modo RSC con actions**. Este sitio usa el modo declarativo puro: `BrowserRouter` + `<Routes>`, sin `createBrowserRouter`, sin `loader`/`action`, sin RSC y sin servidor de React — verificado por búsqueda en `src/`. La ruta vulnerable no existe aquí. **No hay versión corregida publicada en la rama 7.x.** | Cada edición: comprobar si salió un 7.x parcheado |
| **Sesiones en memoria**: un reinicio las cierra | El SSO silencioso las recupera con cero clics. Persistirlas significaría escribir **refresh tokens de Entra en disco** en una máquina expuesta a internet | Si algún día hay más de un proceso |
| **`img-src data:`** en la CSP | Lo exige el grano SVG del sistema de diseño. Las imágenes no ejecutan | — |
| **Rate limit por IP** no detiene a un atacante decidido | Con NAT corporativo toda la sede comparte IP: un límite que tolere 300 entradas legítimas no puede ser estricto. Es un cortacircuitos contra bucles, no una política de seguridad. La defensa real es fail2ban en el borde | Ajustar con los rangos de egress cuando IT los entregue |

---

## Pendientes con terceros

Dos cosas que **no dependen del código** y bloquean partes del despliegue:

1. **¿El tenant tiene Entra ID P1?** Sin esa licencia no se puede asignar un **grupo** a la
   Enterprise App y hay que asignar usuario por usuario, lo que cambia el procedimiento de
   invitaciones.
2. **Rangos de salida a internet de GECELCA y de la sede del evento.** Sin ellos, fail2ban puede
   terminar baneando a la empresa entera. Hacen falta antes de activar el jail.
