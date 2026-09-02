# Pendientes de contenido

Todo lo que las piezas gráficas no definen y hay que confirmar con Comunicaciones antes de
publicar. Se implementa con el valor de la columna «Se implementó con» para no bloquear el
desarrollo, pero **ninguno de estos puntos está cerrado**.

| # | Pendiente | Detalle | Se implementó con |
|---|---|---|---|
| 1 | **Sede del evento** | Los tres PDF dicen «G Working», pero la carpeta del proyecto se llama «EVENTO PUERTA DE ORO». Son dos sedes distintas: hay que confirmar cuál es la real. | «G Working», por ser lo que dice la pieza gráfica |
| 2 | ~~Fotos de los ponentes~~ · **cerrado** · **11 de 11** | Ninguna pieza las trae y el `.docx` de perfiles tampoco: llegan sueltas. Comunicaciones entregó el lote de estudio completo mismo fondo, misma distancia, sujeto centrado, así que los diez retratos salen del defecto del script sin un solo encuadre a mano. La que faltaba, la de **Erick Wehdeking Arcieri**, llegó con el mismo encargo y las mismas cotas (1200×1064), así que también sale del defecto del script. | Los once retratos en `public/img/ponentes/`, cuatro derivados cada uno, declarados en `src/design/retratos.ts`. Se incorporó como el resto: la foto a `retratos-origen/erick-wehdeking-arcieri.jpg` y `scripts/build-retratos.py`, sin tocar una línea de CSS ni un `ENCUADRE`. El monograma de iniciales sigue en pie como red quien no tenga foto no aparece en el manifiesto y cae en él, y es imposible servir un 404, pero **ya no hay datos reales que lo recorran** |
| 3 | ~~Logos vectoriales~~ · **cerrado** | Todo el material gráfico se reconstruyó como SVG real desde los paths del PDF, incluidos el numeral «1» y el wordmark «G-TALKS», sacando los contornos de los glifos de las fuentes incrustadas. No hace falta pedir nada a Comunicaciones. | SVG en `public/img/` |
| 4 | **Resolución de la foto del hero** | La foto de aerogeneradores viene incrustada a **456×652 px**. Es poco para un hero en desktop: a 1440 px de ancho se verá blanda. | Tres medidas: duotono navy→celeste con grano en `PhotoFrame`; columna acotada a 28 rem para no ampliarla más de ~1,1×; y variante `@2x` generada con Lanczos + máscara de enfoque (`scripts/upscale-photos.py`), servida por `srcset` solo a pantallas de densidad 2. Ninguna **inventa detalle**: sigue haciendo falta el original a Comunicaciones |
| 5 | ~~Contenido de Escarapela~~ · **cerrado** | El usuario entregó la pieza (`Escarapela.png`, raíz del repo) y definió el modelo: el carné se llena con la sesión de Entra (`/api/me`), la foto la elige cada persona (solo en su navegador) y el dorso lleva el QR de registro de asistencia hacia la Power App de capacitaciones. Con esta entrega el sitio pasó a ser público y el login vive únicamente en `/escarapela`. | `/escarapela` completa: réplica 1:1 del PNG (`src/components/Escarapela.tsx`), línea bajo el nombre cargo→área→correo, píldora fija «ASISTENTE», volteo 3D y QR estilizado según `Diseño de Código QR.png` con `USUARIO=<usuario sin dominio>` y el `ID_CAPACITACION` de la jornada en curso (mañana/tarde, hora de Bogotá). Detalles de diseño en `docs/SISTEMA-DE-DISENO.md` §La escarapela |
| 6 | ~~Contenido de Encuestas~~ · **cerrado** | Comunicaciones entregó la entradilla, las dos encuestas y sus enlaces. La otra mitad del pendientedónde se guardan las respuestas se resuelve sola: quedan en **Microsoft Forms**, dentro del tenant de GECELCA. Este proyecto no guarda ninguna, así que sigue sin base de datos ni endpoint de escritura | `/encuestas` con las dos tarjetas y sus botones. El contenido está en `ENCUESTAS` (`src/data/foro.ts`), literal salvo el texto de los botones, que es microcopy nuevo. Que el enlace sale del sitio lo marca la flecha en diagonal del botón `--externo`: el aviso escrito que había debajo se **quitó por petición del usuario**. Al imprimir, donde estaba el botón se escribe la URL. La página **no afirma** que las respuestas sean anónimas ni que se abran solo el día del foro las dos cosas dependen de la configuración del formulario en Forms, no del sitio |
| 7 | **Año del evento** | `invitacion gtalk 2026.pdf` dice «Miércoles 5 de agosto/2026»; `2 Arte foro gtalk 2026.pdf` dice solo «Miércoles 5 de agosto». | 2026 |
| 8 | **Enlace de inscripción** | Ninguna pieza trae URL, formulario ni correo de inscripción solo el teléfono de contacto. | No se implementó ningún CTA de registro. Confirmar si debe haberlo |
| 9 | ~~Biografía de 1 ponente~~ · **cerrado** · **11 de 11** | El documento va por entregas y manda **la última**: `PERFIL DE LOS PONENTES (2).docx` trajo las diez, y **reescribió siete** respecto de la anterior (Prada, Karen, Alfredo, Carolina, Jorge, Miguel y Ángel: texto nuevo, no solo repartido distinto). La última entrega llegó **con ese mismo nombre de archivo**, añadiendo al final la ficha de **Erick Wehdeking Arcieri**, con un encabezado que no sigue el formato de las otras diez: «11. Erick Wehdeking Arcieri», numerado, en caja mixta y sin cargo. | La sección de biografía es opcional: sin texto **no se pinta nada**ni cartel de «no disponible» ni caja vacía y el perfil se lee completo con retrato, cargo e intervenciones. La de Erick va en el campo `bio` de `src/data/foro.ts` partida en tres, por dos puntos y seguidos de la fuente: llegó en un bloque único de 849 pulsaciones. El cargo se queda como estaba, «Presidente de GECELCA» el encabezado no trae ninguno y el cuerpo de la ficha lo confirma, y `scripts/bios-verificar.py` aprendió el encabezado numerado: **sin eso su biografía no abría bloque y se pegaba a la de Ángel Hernández**, que es exactamente lo que pasó al leer la entrega por primera vez |
| 10 | **Cargo de Nicolás Rincón Díaz** | El `.docx` escribe «CONSULTORÍA Y MEDIO AMBIENTA S.A.». Se asume errata de la fuente. | «Consultoría y Medio Ambiente S.A.». Confirmar el nombre legal de la empresa |

## El material llega por entregas, y manda la última

Ni las fotos ni los perfiles llegaron de una vez, y las entregas **no son acumulativas**: la
tercera del documento reescribió siete biografías, y el lote de retratos de estudio sustituyó a
las fotos sueltas que habían llegado antes. Dos consecuencias que ya costaron una vez cada una:

- **El texto se re-transcribe entero desde la última entrega**, no se parchea la diferencia.
  `scripts/bios-verificar.py --regenerar` adopta la entrega nueva y deja una copia del texto en
  `scripts/perfiles-fuente.txt`, que es contra lo que se comprueba a diario. Adoptar es un acto
  explícito justamente para que una entrega vieja que quede suelta en la carpeta no se cuele.
- **Los ajustes a mano se revisan cuando cambia el material.** Una de las fotos sueltas era
  apaisada y descentrada, y llevaba un `ENCUADRE` propio en `build-retratos.py`. Ese override
  habría descuadrado su retrato de estudio: se quitó con la foto que lo justificaba.

La cuarta entrega, la que cerró la lista, añadió dos avisos más:

- **Puede llegar con el mismo nombre de archivo.** No se llamó «(3)»: reemplazó a `PERFIL DE LOS
  PONENTES (2).docx` en el sitio. Lo único que delata que hay texto nuevo es que el arnés compara
  el `.docx` del disco con `scripts/perfiles-fuente.txt` y avisa de que «no dice lo mismo». Ese
  aviso es la señal, no el nombre del archivo.
- **El encabezado de una ficha nueva puede no seguir el formato.** La de Erick llegó como «11.
  Erick Wehdeking Arcieri» numerada, en caja mixta y sin cargo, y el lector solo reconocía
  «NOMBRE EN MAYÚSCULAS – Cargo». Consecuencia: su biografía no abría bloque y se **pegaba a la de
  la persona anterior**, que pasó a medir 1785 pulsaciones sin que nada fallara. Se vio al comparar
  la entrega con la referencia, ficha a ficha, antes de adoptarla; `bios-verificar.py` reconoce
  ahora las dos formas. Adoptar una entrega sin leer ese diff es cómo se cuela una biografía dentro
  de otra.

De paso quedó resuelto lo que era un pendiente: la foto de **Carlos Naranjo Merino** había
llegado como foto de sala con dos personas sentadas y sin decir cuál era él, así que se dejó sin
procesar antes que arriesgar la cara equivocada. El lote de estudio trae su retrato.

## Contacto que sí está en las piezas

- **Organiza**: Vicepresidencia de Asuntos Corporativos
- **Mayor información**: María Cristina Giraldo · 312 866 0424

## Nota sobre el copy

El texto institucional se transcribe **literal** de los PDF y del `.docx` de perfiles, aunque
mezcle tuteo («Prepárate para compartir conocimiento») y ustedeo («Los invitamos a participar
activamente»). Esa mezcla está en la fuente y no se corrige.

Lo mismo vale para las biografías: van tal cual las redactó Comunicaciones, con su puntuación y
sus mayúsculas. Sobre el documento se corrigen **dos cargos** y **una errata**, y nada más:

- **Cargos.** El de Karen Henríquez Leal se mantiene en «Vicepresidenta Financiera». El
  encabezado de la última entrega la nombra en masculino («Vicepresidente Financiero»), pero el
  **cuerpo de esa misma ficha** dice «Actualmente se desempeña como Vicepresidenta Financiera»:
  manda el cuerpo. El de Carolina Palacio Garcerant recupera el «de GECELCA» que llevan los demás
  cargos internos.
- **Errata.** La biografía de Carlos Naranjo Merino cierra un párrafo sin punto final. Va
  corregida y queda **declarada** en `scripts/bios-verificar.py`, que la imprime cada vez que
  corre: es una excepción visible, no una diferencia que se acabe ignorando. El script avisa
  además si una corrección **deja de hacer falta**, porque una entrega puede arreglar la errata
  por su cuenta y una corrección muerta es ruido: pasó con «Universidad de los andes», que estuvo
  declarada hasta que Comunicaciones lo escribió bien.

### Los párrafos de una biografía son los de la página

El primer párrafo de cada biografía se compone como **entradilla** (más grande y más claro), así
que una ficha que llegue en un bloque único se lee plana al lado de las demás. Cuando pasa, se
parte. Hoy lo necesitan tres: **Karen Henríquez** y **Ángel Hernández**, cuyo primer párrafo mete
la formación y la trayectoria juntas, y **Erick Wehdeking**, que llegó entera en un solo bloque de
849 pulsaciones; las otras ocho llegan ya repartidas.

Partir es composición, no copy: el corte cae siempre en un punto y seguido de la fuente donde
deja de presentar a la persona y empieza a contar su trayectoria, y lo único que cambia es que un
espacio pasa a ser un salto de párrafo.

Que no se pierda ni se «arregle» una letra por el camino no se confía a la vista, y que la
entradilla esté en **todas** tampoco:

- `scripts/bios-verificar.py` comprueba que `bio.join(' ')` siga siendo exactamente el texto de
  la fuente, y falla si alguna biografía se queda en un solo párrafoo sea, sin entradilla.
- `scripts/interactions-test.mjs` abre los once perfiles en el navegador y comprueba, sobre el
  tamaño realmente calculado, que el primer párrafo destaque sobre el segundo. Es la comprobación
  que impide que la discrepancia vuelva sin que nadie se entere.

### El contacto del aviso del certificado

El botón retenido de `/certificado` (quien entra sin asistencia registrada) remite hoy a
**María Cristina Giraldo (mgiraldo@gecelca.com.co)**  el nombre coincide con el contacto del pie
del sitio, pero el **canal** está por confirmar con ella: ¿correo, Teams, o el teléfono del pie?
El texto vive en `AVISO_SIN_ASISTENCIA` de `src/pages/CertificadoPage.tsx`.

### ~~El certificado de Howard es de entrega manual~~ RESUELTO el 2026-08-13

Sí tenía cuenta: `choward@gecelca.com.co`, «Catrin Howard Diazgranados», y encima ya estaba en el
grupo del foro. Lo que no existía era el NOMBRE con el que se le buscó: el listado de asistencia
partió en dos («HOWARD DIAZ GRANADOS CATRIN») un apellido que el directorio guarda junto
(«Diazgranados»), y el resolvedor exige coincidencia exacta de palabras.

La lección, que vale para la próxima lista: **un «cero coincidencias» no prueba que alguien no
tenga cuenta, solo que no la tiene con esa grafía.** Antes de mandar a nadie a entrega manual hay
que buscarlo por un apellido suelto. Corregido en `SIN_QR` y en el listado de planta con el mismo
patrón que ya se había usado para KOOP/KOPP; la audiencia pasó de 155 a **156** y `entregaManual`
quedó vacío.

### La carta de presentación digital: lo que quedó fuera de alcance (2026-09-02)

El módulo `carta` (`/carta_presentacion/<uuid>` y `/cdpadmin`) se entregó completo; estas tres
cosas no dependen del código y quedan anotadas para no perderlas:

1. **Importar los perfiles de la app anterior.** El respaldo del retiro del 2026-07-31 está en el
   servidor (`/var/backups/comunicaciones-datos-2026-07-31.tgz`: la SQLite y los uploads). Hoy
   cada tarjeta se crea a mano desde el panel; un importador tendría que pasar cada foto por el
   mismo `procesarFoto` y cada campo por la misma validación, y decidir qué hacer con los
   perfiles que no la pasen.
2. **Una cuenta de base de datos acotada al esquema `carta`.** La que hay es `db_owner` de
   `PortalG3`, compartida con los otros portales. Pedirla a quien administre el SQL Server:
   `ALTER, SELECT, INSERT, UPDATE, DELETE ON SCHEMA::carta`. El cambio en el sitio es solo
   `DB_USER`/`DB_PASSWORD`.
3. **La CA del SQL Server**, para poner `DB_TRUST_CERT=false` (riesgo aceptado en
   `docs/SEGURIDAD.md`). Como el host es una IP, habrá que dar además el nombre del certificado
   en `DB_TLS_SERVERNAME`.

Todo microcopy **nuevo** de la interfaz (botones, estados vacíos, mensajes de error) va en
español de Colombia con tuteo.
