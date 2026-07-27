# Pendientes de contenido

Todo lo que las piezas gráficas no definen y hay que confirmar con Comunicaciones antes de
publicar. Se implementa con el valor de la columna «Se implementó con» para no bloquear el
desarrollo, pero **ninguno de estos puntos está cerrado**.

| # | Pendiente | Detalle | Se implementó con |
|---|---|---|---|
| 1 | **Sede del evento** | Los tres PDF dicen «G Working», pero la carpeta del proyecto se llama «EVENTO PUERTA DE ORO». Son dos sedes distintas: hay que confirmar cuál es la real. | «G Working», por ser lo que dice la pieza gráfica |
| 2 | **Fotos de los 11 ponentes** | Ninguna pieza las trae. | Monograma de iniciales con la forma en «hoja» del sistema, no un círculo genérico: así la ausencia se lee como decisión. `Monogram.tsx` acepta una prop `foto?` para recibirlas sin refactor |
| 3 | ~~Logos vectoriales~~ · **cerrado** | Todo el material gráfico se reconstruyó como SVG real desde los paths del PDF, incluidos el numeral «1» y el wordmark «G-TALKS», sacando los contornos de los glifos de las fuentes incrustadas. No hace falta pedir nada a Comunicaciones. | SVG en `public/img/` |
| 4 | **Resolución de la foto del hero** | La foto de aerogeneradores viene incrustada a **456×652 px**. Es poco para un hero en desktop: a 1440 px de ancho se verá blanda. | Tres medidas: duotono navy→celeste con grano en `PhotoFrame`; columna acotada a 28 rem para no ampliarla más de ~1,1×; y variante `@2x` generada con Lanczos + máscara de enfoque (`scripts/upscale-photos.py`), servida por `srcset` solo a pantallas de densidad 2. Ninguna **inventa detalle**: sigue haciendo falta el original a Comunicaciones |
| 5 | **Contenido de Escarapela** | Lo define el usuario. `server/app.js` ya expone `GET /api/me` con `{ nombre_completo, upn, email, oid, roles }` desde la sesión Entra, así que se puede construir sin backend nuevo. | Estado vacío con dirección: qué va a aparecer, de dónde salen los datos y los tres pasos de la secuencia. El hueco sigue anotado en `// TODO(usuario):` |
| 6 | **Contenido de Encuestas** | Lo define el usuario. Falta además decidir dónde se guardan las respuestas: hoy no hay base de datos ni endpoint de escritura. | Estado vacío con dirección. El hueco sigue anotado en `// TODO(usuario):`. ⚠ El texto dice que las encuestas se abren el día del foro y que las respuestas no se publican con nombre: **confirmar las dos cosas con Comunicaciones** |
| 7 | **Año del evento** | `invitacion gtalk 2026.pdf` dice «Miércoles 5 de agosto/2026»; `2 Arte foro gtalk 2026.pdf` dice solo «Miércoles 5 de agosto». | 2026 |
| 8 | **Enlace de inscripción** | Ninguna pieza trae URL, formulario ni correo de inscripción — solo el teléfono de contacto. | No se implementó ningún CTA de registro. Confirmar si debe haberlo |

## Contacto que sí está en las piezas

- **Organiza**: Vicepresidencia de Asuntos Corporativos
- **Mayor información**: María Cristina Giraldo · 312 866 0424

## Nota sobre el copy

El texto institucional se transcribe **literal** de los PDF, aunque mezcle tuteo
(«Prepárate para compartir conocimiento») y ustedeo («Los invitamos a participar
activamente»). Esa mezcla está en la fuente y no se corrige.

Todo microcopy **nuevo** de la interfaz (botones, estados vacíos, mensajes de error) va en
español de Colombia con tuteo.
