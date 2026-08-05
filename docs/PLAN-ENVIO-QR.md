# Envío único del QR de asistencia a todos los invitados

> ## Estado: EJECUTADO el 2026-08-04, y cerrado el 2026-08-05 con **180 de 180**
>
> **165 de 165 enviados, cero fallos.** Corrida de 20 minutos desde `admapps365@gecelca.com.co`,
> con la pieza definitiva (`imagen correo qr.png`) y el asunto entregado por Comunicaciones.
>
> Después llegaron rezagados en tandas —hasta 169 el mismo día 4, y **11 más la mañana del 5**—,
> cada tanda en modo `lista` sobre el mismo libro, que es lo que impide que nadie reciba dos. El
> día 5 el correo tuvo que cambiar: decía «mañana» y el foro era ese día. Ver
> §El correo caducaba, y caducaba por dos sitios.
>
> | Comprobación | Resultado |
> |---|---|
> | Enviados / audiencia | **165 / 165** |
> | Fallidos · reservados huérfanos · `oid` duplicados | **0 · 0 · 0** |
> | Todos con HTTP 202 y su `client-request-id` | sí |
> | Cobertura de la audiencia congelada | los 165, sin excepción |
> | Direcciones guardadas en el libro | ninguna (minimización) |
> | Auditoría independiente de los 165 PNG | 165 códigos distintos, 0 cruzados, 0 ilegibles, 0 huérfanos, todos con la jornada de la mañana |
>
> Incidencias: **dos parones** de 85 s y 371 s durante la rasterización, sin consecuencia — ni un
> reintento de Graph, ni un 429, ni un reintento de rasterizado. La mediana entre mensajes fue de
> **5 s**; el ritmo global, 8 msg/min.
>
> **Antes de la corrida se detectó y corrigió el fallo más caro del proyecto:** `PUBLIC_ORIGIN`
> apuntaba a `localhost`. Ver más abajo. Las **ocho pruebas previas** salieron con ese enlace roto.
>
> Pruebas previas, ambas a los cuatro del grupo `TEST_CORREO_QR` y con **libro aparte**:
> la del arte provisional (`.datos/envio-qr-prueba.jsonl`) y la del definitivo
> (`envio-qr-prueba2.jsonl`). Los cuatro escanearon correctamente contra la Power App, y una
> segunda corrida sobre el mismo libro mandó cero mensajes: la idempotencia quedó verificada en
> caliente, no solo contra el Graph falso.

## Contexto

El QR de registro de asistencia existía en un solo sitio: el dorso de la escarapela digital, que
solo ve quien **inicia sesión** en `/escarapela`. Quien no entrara al sitio antes del 5 de agosto
llegaba al foro sin su código, y el registro en la Power App de capacitaciones depende de él.

El correo de inscripción (`server/correo/`) no cerraba ese hueco: sale **en el primer login**, así
que solo lo recibe quien ya entró. Faltaba el camino inverso — llegarle a la persona **antes** de
que entre, con su código ya en la mano.

Esto es un **script de una sola corrida** que le manda a los invitados del grupo
`LOGIN FOROS: 1 GTALK` un segundo correo con **su QR personalizado**, idéntico en diseño al del
dorso de su escarapela y con el `ID_CAPACITACION` de la **mañana**. Sale una vez por persona y no
vuelve a salir, se haya inscrito o no.

## Decisiones ya tomadas (no re-preguntar)

| Decisión | Elegido | Por qué |
|---|---|---|
| Audiencia | Miembros del grupo de Entra `4d6d78fa-9636-4b43-aa3b-bc827839100c` | Es la lista real de invitados, ya verificada contra `CUPOS FORO.xlsx` |
| Composición | Pieza arriba por `cid:`, **debajo** un bloque propio con el QR sobre panel blanco | Dos adjuntos inline. No exige que la pieza reserve un hueco medido, así que un arte nuevo no obliga a volver a medir |
| Pieza | **Archivo propio**, `imagen correo qr.png` | Reemplazar la de inscripción cambiaría retroactivamente un correo ya enviado, y ningún arnés lo gritaría |
| Remitente | `admapps365@gecelca.com.co` | Buzón de servicio, no el de una persona |
| Jornada del QR | La de la **mañana**, fija (`fffbd1d0-…`) | El correo no puede rotar al mediodía como sí hace la escarapela |
| Dónde corre | La **estación**, no el servidor | Necesita Playwright, que el despliegue poda (`npm prune --omit=dev`) |
| Clave de idempotencia | El **`oid`** | Inmutable en el tenant; un UPN cambia y partiría el histórico en dos |

## Lo que NO se hizo (límites duros)

- **No se añadió superficie HTTP.** No hay ruta para disparar, reenviar ni consultar el envío. El
  servidor no carga ni una línea de esto.
- **El QR no va envuelto en un enlace**, y la URL de Power Apps no aparece como texto en el
  mensaje: Outlook auto-enlaza las URL sueltas y un toque sería un auto-registro de asistencia.
- **No se personaliza el nombre** en el HTML. La plantilla de inscripción ya había decidido no
  interpolarlo; hacerlo aquí reabriría una superficie de escape a cambio de nada.
- **No se tocó `graph-mailer.js`.** El transporte se reutiliza tal cual, con su cola de
  concurrencia 1, su reintento único y su guardia de una-sola-dirección.

---

## Fase 0 — Lo que no es código, y bloquea

### 0.1 RESUELTO (2026-08-03), pero con más permiso del pedido

Se pidió `GroupMember.Read.All` de aplicación — el mínimo que lee `/groups/{id}/members`. Lo
concedido fue **`GroupMember.ReadWrite.All` y `Group.ReadWrite.All`**, ambos con consentimiento de
administrador. Funciona (leer es un subconjunto de escribir) y el script **solo hace `GET`**, pero
conviene saber lo que quedó abierto: la App Registration del login —la misma que ya podía **enviar
correo como cualquier buzón**— ahora puede además **crear, modificar y eliminar grupos y
membresías de todo el tenant**.

**Recomendación: bajar los dos a `Group.Read.All` / `GroupMember.Read.All`**, o retirarlos cuando
el envío termine (`docs/SEGURIDAD.md` §Ciclo anual). No bloquea nada: el script funciona igual con
los de solo lectura.

Los permisos de aplicación de Graph son de **tenant** y no se pueden acotar a un solo grupo — ni
con RBAC de Entra, ni con unidades administrativas, ni con RSC, que es de Teams. Queda como riesgo
aceptado en `docs/SEGURIDAD.md`.

### 0.2 El buzón remitente

`admapps365@gecelca.com.co` tiene que existir y tener licencia de Exchange Online: `Mail.Send` de
aplicación no crea buzones. Las copias quedan en sus Enviados (`saveToSentItems: true`), que es la
evidencia de auditoría — y también ~200 MB de cuota, que conviene comprobar antes.

### 0.3 PENDIENTE: la pieza gráfica

`imagen correo qr.png` en la raíz, **commiteada**. Mientras no exista, `cargarPiezaQr()` cae a
`imagen correo.png` y lo anuncia en cada corrida con un `⚠ PROVISIONAL`.

**El envío a `todos` con la pieza provisional ABORTA.** Un aviso en consola se lee y se olvida, y
el error que evita no tiene vuelta atrás: 163 personas con el arte equivocado y un libro que dice
`enviado`. Las pruebas en modo `lista` sí salen con la provisional —para verificar renderizado y
escaneo, el arte da igual—, y la escotilla es `--con-pieza-provisional` para quien de verdad la
quiera.

**Adoptar el arte definitivo:**

1. Dejar el archivo como `imagen correo qr.png` en la raíz y commitearlo.
2. `node scripts/envio-qr-test.mjs` — exige que los bytes del adjunto sean los del archivo.
3. Comprobar en la cabecera de la siguiente corrida que ya **no** dice `⚠ PROVISIONAL`.

---

## Fase 1 — Un solo dibujo del QR, dos lectores ✔

El arte vivía dentro de `src/components/Escarapela.tsx`. Salió a **`src/data/qr-arte.ts`**, que no
toca el DOM (lo carga Node) ni el disco (lo empaqueta Vite): `svgQrAutonomo` recibe la marca «G»
por parámetro. `Escarapela.tsx` pasó a consumir `arteQr`, `codificarQr` y `cajaMarca`.

Que sean el mismo dibujo no es una convención: `qr-test.mjs` compara el `d` del navegador con el
que produce Node **carácter a carácter** (167 568 hoy) y comprueba que la tinta del carné es la
constante que viaja al correo.

**El hallazgo que costó la tarde.** El panel mide un número **entero** de módulos. Con el 5 % de
aire sobre 81 módulos salían 89.1, y a 810 px eso son **9.0909… píxeles por módulo**: cada punto
cae en una fracción de píxel distinta, el antialias los muerde desigual y **ZXing deja de leer el
código**. Medido, no supuesto: a 600, 1200, 1620 y 2400 px decodificaba, y justo a 810 no.
Redondeando el aire a media unidad el panel mide 90 módulos exactos, y `svgQrAutonomo` ajusta el
lado pedido al múltiplo más cercano en vez de obedecerlo a ciegas. El defecto es **1080 px**: 12
píxeles por módulo, y 4:1 exacto contra los 270 px con los que se muestra — Outlook usa el motor de
Word y las razones feas producen moiré.

## Fase 2 — La audiencia se congela ✔

`scripts/envio-qr-audiencia.mjs` lee el grupo **una vez** y escribe
`.datos/audiencia-<fecha>-<grupo>.json`, que **nunca se sobrescribe** (`--salida` lo cambia). El
nombre lleva el grupo además de la fecha porque un grupo de PRUEBA y el real congelados el mismo
día se pisarían. El envío usa ese archivo y no vuelve a consultar Graph: leer el directorio y
mandar correo son dos privilegios distintos, y así lo que se manda es exactamente lo que un humano
revisó.

**Corrida del 2026-08-03 contra el grupo real:** 163/163, sin `oid` ni alias repetidos, cero
anomalías, y los **163 alias salen del atributo `mail`** — ni un solo invitado B2B, ninguna
discrepancia entre el alias del `mail` y el del UPN, ningún alias con mayúsculas ni con punto, y un
único dominio (`gecelca.com.co`). El riesgo que más preocupaba en la §0.2 del diseño no se
materializó.

**Cambios en la membresía, para el registro:**

| Fecha | Cambio | Cómo |
|---|---|---|
| 2026-08-04 | **+ `csotomayor@gecelca.com.co`** (Carlos Sotomayor Ahumada) al grupo `LOGIN FOROS: 1 GTALK`. El grupo pasó de 163 a **164** | `POST /groups/{id}/members/$ref` con la App Registration del login, a petición del usuario |
| 2026-08-04 | Altas sueltas a lo largo del día hasta **169**, cada una con su envío en modo `lista` | igual |
| 2026-08-05 | **+ 11** el día del foro: `lbolano`, `jgarciapa`, `cpatino`, `mcalderony`, `abarrosv`, `choward`, `alopezh`, `dagamez`, `mmiranda`, `cahumada`, `rreyes`. El grupo pasó de 169 a **180** | `scripts/grupo-agregar.mjs`, que ya no es un `POST` a mano |

**Desde el 2026-08-05 esto no se hace a mano.** Dos scripts nuevos, porque las tres veces que se
añadió gente el riesgo fue el mismo y el `POST` suelto no lo cubría:

- **`scripts/personas-resolver.mjs`** — de NOMBRES a direcciones. Las listas llegan como
  «APELLIDOS NOMBRES» y el directorio guarda «Nombres Apellidos»; traducir eso a mano es donde se
  cuela el error. Compara conjuntos de palabras normalizadas contra las 1749 cuentas del dominio,
  exige **una sola** coincidencia exacta y, si no la hay, **no escribe el archivo de direcciones** y
  enseña los candidatos. De 14 nombres, 5 no casaron solos y los resolvió un humano mirando que el
  candidato fuera único (un solo «Yerena», una sola «Catrin», un solo «Renato» entre 14 «Reyes»).
- **`scripts/grupo-agregar.mjs`** — el alta. Resuelve **todas** las direcciones antes de escribir
  ninguna (media lista dentro es peor que ninguna), enseña nombre + `mail` + UPN + alias del QR de
  cada persona, es idempotente con quien ya está, y **verifica listando** los miembros al final —
  no con `GET /members/{oid}/$ref`, que devuelve 404 aunque la persona sí esté.

> Ojo con la comprobación: `GET /groups/{id}/members/{oid}/$ref` devuelve **404 aunque la persona
> sí esté**. La comprobación buena es listar los miembros y buscarlo ahí, que es lo que hace
> `envio-qr-audiencia.mjs`.

**`--mas-correo <dirección>`** (repetible) añade a alguien que **no** está en el grupo pero debe
recibir el correo. Se resuelve contra Graph igual que los del grupo, así que entra al archivo con
su `oid` y su nombre reales — no es una edición a mano del JSON. Si ya venía en el grupo, no se
duplica. El conteo de `--esperados` se comprueba **sobre el grupo**, no sobre el total, para que un
cambio silencioso de membresía siga gritando.

Detalles que no son obvios:

- La consulta va a `/groups/{id}/members/**microsoft.graph.user**`. Sin el casteo, `/members`
  devuelve objetos de directorio mezclados —un grupo anidado, un principal de servicio— que no
  tienen `mail` ni `userPrincipalName`, y el script produciría un `USUARIO` vacío sin enterarse.
- El `@odata.nextLink` se sigue **tal cual**: lleva un `$skiptoken` que ya codifica la proyección.
- **El alias sale de `mail || userPrincipalName`**, que es la réplica de lo que hace `/api/me`
  (`email = claims.email || upn`) y por tanto de lo que pinta la escarapela de esa persona.
- La auditoría es de fallo cerrado: conteo esperado, `oid` y alias **únicos** (dos alias iguales
  son dos QR idénticos), alias con `#EXT#`, cuentas deshabilitadas, alias con mayúsculas, y
  **discrepancias entre el alias del `mail` y el del UPN** — esa persona recibiría un código
  distinto al de su propia escarapela. Los anómalos no se envían sin revisión.

## Fase 3 — El envío ✔

`scripts/envio-qr.mjs` (CLI) + `scripts/envio-qr-nucleo.mjs` (el bucle, con las dependencias
inyectadas para poder ejercerlo con un Graph falso).

Las cinco defensas contra el cruce de códigos están en `docs/SEGURIDAD.md` §Envío único del QR. La
que más vale la pena repetir: antes de enviar, el script **decodifica con ZXing el PNG que acaba de
generar** y exige que diga la URL de esa persona; si no coincide, **aborta el proceso entero** en
vez de saltar a la siguiente. Un cruce detectado significa que el mecanismo está roto.

**Ritmo.** Graph limita a ~30 mensajes por minuto y por buzón, y el mailer serializa pero no
espacia. El script pone 3 s (`--ritmo-ms`), así que 163 personas son **unos 8-10 minutos** contando
la subida. Conviene decirlo sin adornos: «que les llegue a todos al mismo tiempo» es, en la
práctica, una ventana de diez minutos. No hay forma de que Exchange entregue 163 mensajes en el
mismo segundo, y forzarlo solo produce 429.

**`--maximo N` es obligatorio con `--confirmar`.** El libro vive en la estación y no tiene
respaldo automático: si se perdiera, el daño son N correos repetidos y no 163.

### El `PUBLIC_ORIGIN` de la estación es una trampa, y casi se cae en ella

El `.env` de desarrollo tiene `PUBLIC_ORIGIN=http://localhost:5173`, que es **lo correcto** ahí: el
arranque valida ese valor contra `M365_REDIRECT_URI` y sin él no se puede probar el login local.
Pero el correo enlaza a `PUBLIC_ORIGIN + /escarapela`, así que un envío masivo lanzado con el
`.env` a secas le manda a 165 personas un «Abre tu escarapela digital» que apunta **al portátil de
quien lo envió**.

No lo delata nada: ni el asunto, ni la pieza, ni el QR —que no depende del origen—. Solo se
descubre cuando alguien toca el enlace. Se detectó el **2026-08-04**, minutos antes de la corrida
real, y **las ocho pruebas anteriores salieron con enlaces a `localhost`**.

Ahora `envio-qr.mjs` **aborta** si `--confirmar` va con un origen que no sea `https://`. La forma
de dárselo es en la línea de comando, que tiene precedencia sobre `--env-file` (comprobado) y no
obliga a tocar un archivo del que depende el login local:

```bash
PUBLIC_ORIGIN=https://cdp.gecelca.com.co node --env-file=.env scripts/envio-qr.mjs …
```

> **El dominio es `cdp.gecelca.com.co`**, confirmado por el usuario y comprobado en vivo: responde
> 200 con su CSP en `/` y `/escarapela`, y 401 en `/api/me`. `deploy/deploy.env` todavía dice
> `gtalks.gecelca.com.co`, que **ni siquiera resuelve** — ese valor está obsoleto y engaña.
>
> Ojo al comprobarlo con `curl`: `/` devuelve **404** si no se mandan las cabeceras `Sec-Fetch-*`.
> No es un fallo, es el diseño (`server/app.js` distingue navegación de subrecurso). Hay que
> emular una navegación, como hace `gate-test.mjs`.

### El correo caducaba, y caducaba por dos sitios

Se compuso para salir la **víspera**. El asunto decía `TE ESPERAMOS MAÑANA…` y el titular de la
pieza, «¡Mañana tenemos una importante cita!». Correcto el 4; el 5, para los once que entraron al
grupo esa misma mañana, los citaba para el día siguiente cuando el foro era ese.

Lo que no es obvio: **son dos sitios y hay que cambiar los dos**. Corregir solo el asunto deja el
mensaje contradiciéndose consigo mismo —en la bandeja «HOY», y al abrirlo «¡Mañana…» en letra de
36 px—, y corregir solo la pieza deja la mentira en lo único que se lee sin abrir. Por eso:

- El asunto vive en `server/correo/plantilla-envio-qr.js`.
- El titular de la pieza lo reescribe **`scripts/pieza-correo-hoy.py`**, que no es un retoque a
  mano: entra la pieza original y sale la variante, reproducible. Solo sintetiza «Hoy» —el «¡» y
  el «tenemos» son los píxeles originales, recortados y desplazados—, la fuente no se adivina
  sino que se ajusta minimizando la diferencia de píxeles contra la palabra «Mañana» (Urbanist
  36 px peso 700; astas de 4.57 px contra 4.55 del original), y el hueco entre palabras sale de
  componer «Hoy tenemos» en la misma fuente en vez de copiar los 12 px que había tras la «a». El
  script comprueba las cotas del original antes de tocar nada y aborta si el arte cambió.
- **`envio-qr-test.mjs` ata las dos puntas**: comprueba que el día del asunto y el de la pieza
  sean el mismo. Con «HOY» en el asunto y la pieza de la víspera dentro, se pone rojo.

Y una tercera cosa que sí importa: **la pieza vieja NO se sobrescribe**. `imagen correo qr.png`
son los bytes que recibieron las 169 del día 4; la variante va a `imagen correo qr hoy.png`. Si se
reemplazara, el repositorio afirmaría que aquellas 169 recibieron algo que no recibieron, y ningún
arnés lo gritaría —los tests comparan el adjunto contra el ARCHIVO, no contra los bytes
históricos—. Es la misma razón por la que este correo nunca compartió pieza con el de inscripción.

## Fase 4 — Los arneses ✔

- `node scripts/envio-qr-test.mjs` — Graph falso en loopback, libros en temporales, sin red ni
  credenciales. La prueba estrella decodifica **los bytes reales del adjunto** de cada mensaje
  sobre una población de alias parecidos a propósito, y hay dos pruebas que **sabotean** el
  generador para comprobar que el aborto ocurre de verdad. Más: idempotencia, reanudación, la
  ligadura del par (destinatario, alias) contra 20 identidades hostiles, sin `cc`/`bcc`, dos
  adjuntos con `cid` distintos, el QR sin enlace, la URL de Power Apps ausente del HTML, la guardia
  de peso del mensaje entero, el asunto literal y el detector de voseo.

  Dos bloques que separan las dos catástrofes opuestas: un **QR cruzado aborta** la corrida entera
  (el mecanismo está roto), pero un **Graph que devuelve 500** solo anota `fallido` y sigue con los
  demás —lo contrario dejaría a dos tercios del auditorio sin correo por un hipo de red—, y un
  **429 se reintenta** conservando el `client-request-id`.

- `node scripts/envio-qr-auditar.mjs <audiencia>` — **segunda opinión** sobre los PNG que dejó un
  ensayo. No genera nada: los lee del disco y cruza el **nombre del archivo** contra el **contenido
  decodificado**, y ambos contra la audiencia. La distinción con el auto-chequeo del envío no es
  cosmética: aquel compara el PNG contra la URL que acaba de construir *en la misma vuelta*, así
  que un bucle cruzado seguiría cuadrando consigo mismo. Este además ve lo que solo se aprecia en
  conjunto: que no haya dos personas con el mismo código, ni códigos huérfanos, ni faltantes.
- `node scripts/qr-test.mjs` — sigue verde, y gana el check del `d` y el de la tinta.
- `node scripts/inscripcion-test.mjs` — cubre el extracto de `html-correo.js`.

---

## Orden de ejecución

1. **Fase 0.1**: pedir el consentimiento de `GroupMember.Read.All`. Es lo único que bloquea.
2. `node --env-file=.env scripts/envio-qr-audiencia.mjs` — y **leer el informe de anomalías**.
3. Ensayo: `node --env-file=.env scripts/envio-qr.mjs --audiencia .datos/audiencia-<fecha>.json`.
   Genera y verifica los 163 QR sin enviar nada. Abrir `.datos/qr/` y mirar unos cuantos al azar:
   que el alias del archivo sea el de esa persona.
4. Prueba real a los cuatro buzones. **Ojo: `jcespedes` y `llondono` NO están en el grupo real**
   (se comprobó el 2026-08-03; sí están `lrojas` y `smunevar`), y el envío se niega a escribirle a
   quien no aparezca en la audiencia congelada. Por eso la prueba va contra un **grupo de prueba**
   propio con los cuatro dentro:

   ```bash
   node --env-file=.env scripts/envio-qr-audiencia.mjs --grupo <id-del-grupo-de-prueba> --esperados 4
   ENVIO_QR_MODO=lista \
   ENVIO_QR_DESTINATARIOS=jcespedes@gecelca.com.co,lrojas@gecelca.com.co,llondono@gecelca.com.co,smunevar@gecelca.com.co \
   ENVIO_QR_REMITENTE=admapps365@gecelca.com.co \
   node --env-file=.env scripts/envio-qr.mjs --audiencia .datos/audiencia-<fecha>-<grupo>.json --confirmar --maximo 4
   ```

   Abrirlos en **Outlook de escritorio y en el móvil**, y **escanear los cuatro con la cámara de un
   teléfono** contra la Power App.

   > El libro de esa prueba es el **real**, no un simulacro: a esas cuatro personas el correo ya
   > les salió de verdad, así que la corrida final no debe volver a escribirles. Si el grupo de
   > prueba y el real usan libros distintos (por `ENVIO_QR_LIBRO`), `lrojas` y `smunevar`
   > recibirían el correo **dos veces**.
5. Adoptar la pieza definitiva cuando llegue y re-correr el arnés.
6. La corrida real: `ENVIO_QR_MODO=todos` con la lista **vacía**, `--confirmar --maximo 163`.
   Cuadrar el conteo con la carpeta Enviados de `admapps365` y **respaldar el libro**.

---

## ¿El QR que reciban hoy sirve el día 5?

La pregunta operativa: de nada vale que funcione en las pruebas si la gente recibe el correo hoy y
lo usa dentro de tres meses. La respuesta se parte en dos, y solo una mitad depende de este repo.

**De este lado: el código no caduca, y no depende de cuándo se genere.** Verificado, no supuesto:

- Lo que el QR codifica es una URL con **cinco parámetros fijos** (`tenantId`,
  `skipMobileRedirect`, `ID_CAPACITACION`, `USUARIO`, `TIPO_CAPTURA`). **No hay token, ni firma, ni
  marca de tiempo, ni nada que expire.** El arnés lo fija: la URL va escrita a mano como
  especificación, se exige que los parámetros sean **exactamente** esos cinco, y se comprueba que
  ninguno case con `exp|token|sig|time|stamp|nonce|valid`.
- La jornada está **congelada** en `INSTANTE_MANANA`, una constante. Generando el mismo QR con el
  reloj del sistema puesto en **marzo de 2027 y por la tarde**, el PNG sale **idéntico byte a
  byte** al de hoy (76 046 bytes). El arnés lo repite en cada corrida falseando `Date`.
- Un QR es papel: los píxeles codifican una cadena. Mientras la cadena no cambie, el código dice lo
  mismo dentro de diez años.

**Del otro lado — lo que sí puede dejar de funcionar, y no lo controla este repo:**

| Qué | Por qué importa |
|---|---|
| Que la capacitación `fffbd1d0-…` siga **aceptando registros** | Si se cierra o se borra después del foro, el QR sigue siendo legible pero no registra nada |
| Que la app siga publicada en el **mismo entorno y con el mismo ID** | La ruta `/play/e/<entorno>/a/<app>` está en el código del QR. Republicarla en otro entorno rompe todos los códigos ya enviados |
| Que el **alias de la persona** no cambie | Un cambio de `mail` (matrimonio, corrección de alias) deja su QR apuntando al alias viejo |
| Que la persona pueda **iniciar sesión en Power Apps** | El QR abre la app; la autenticación la pone Microsoft |

**Y una asimetría deliberada que hay que tener presente el día 5:** el correo lleva **siempre** el
ID de la **mañana**; la escarapela sí rota al de la tarde al mediodía. Quien escanee el código del
correo por la tarde quedará registrado en la jornada de la mañana. Si eso importa, el camino es
decírselo a la gente en el copy o pedirles que usen la escarapela después del almuerzo — no
cambiar el QR del correo, que no puede rotar.

---

## Lo que ningún script puede decir

**Que la Power App acepte el registro.** Antes de la corrida real hay que escanear con un teléfono
uno de los cuatro QR de prueba y comprobar que la asistencia queda anotada, y a nombre de la
persona correcta. Dos preguntas que conviene resolver con quien administra esa app:

- ¿El `USUARIO` que espera es el alias del UPN, el del `mail`, o el `samAccountName`? ¿Distingue
  mayúsculas? El arnés garantiza que el QR del correo dice **lo mismo** que el de la escarapela,
  pero no que ese valor sea el que la app quiere.
- ¿Qué pasa si alguien escanea el código de la mañana por la tarde? El correo lleva **solo** el de
  la mañana; la escarapela sí rota al mediodía. Esa asimetría es deliberada y hay que asumirla o
  decirla en el copy.
