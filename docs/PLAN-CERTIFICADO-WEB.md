# El certificado de participación se descarga de la web, cada quien el suyo

> ## Estado: CONSTRUIDO el 2026-08-10 · ampliada a 155 el 2026-08-12 · DESPLEGADO y ampliada a 156 el 2026-08-13
>
> | Comprobación | Resultado |
> |---|---|
> | Audiencia congelada | **156 personas** (Hoja1 + 24 sin-QR; `entregaManual` vacío desde que apareció la cuenta de Howard) |
> | PDFs generados y auto-chequeados | 156 de 156 |
> | Auditoría independiente (archivo ↔ contenido ↔ fuente) | en verde; probada con sabotaje (2 PDF cruzados → rojo por 2 vías) |
> | `certificados-server-test.mjs` | 21 comprobaciones en verde (apagado, a medias, 5 manifiestos hostiles) |
> | `sesion-test.mjs` (estados de la página) | en verde; de aquí salió el fallo real de especificidad de `--suprimido` |
> | `interactions-test.mjs` · `a11y-test.mjs` | en verde con la ruta nueva |
> | `gate-test.mjs` con `CERTIFICADOS_DIR` | pendiente del ensayo local (Fase 9) |
> | Producción | pendiente: etapa de 4 → etapa completa |

## Contexto

El foro pasó (2026-08-05) y Comunicaciones entregó la pieza oficial
`Certificado de participación.png` (1755×1241, proporción √2) con dos huecos: la raya del nombre
y «C.C: ___». El registro de asistencia quedó completo ese mismo día en `ASISTENCIA FORO.xlsx`
(hoja `Hoja1`, 132 filas + 3 «ASISTIÓ, NO QR» de la planta). `/certificado` es la ruta donde cada
asistente, con la misma sesión de Entra de la escarapela, descarga su PDF personalizado.

## Decisiones ya tomadas (no re-preguntar)

| Decisión | Elegido | Por qué |
|---|---|---|
| Dónde vive | Ruta nueva `/certificado`, con entrada en el nav | Más visible y enlazable; la escarapela ya cumplió su función. Usuario, 2026-08-10 |
| El nombre pintado | MAYÚSCULAS sostenidas, orden «NOMBRES APELLIDOS», grafía del Excel reordenada con givenName/surname de Entra como testigo | Usuario, 2026-08-10. Nueve fichas con grafías divergentes van a mano, comentadas en `certificados-audiencia.mjs` |
| La cédula pintada | Con puntos de miles (1.003.239.160) | La convención colombiana; como vino la lista de la planta |
| Audiencia | Hoja1 + los 3 sin-QR = 135 → **134 descargables** (Howard sin cuenta Entra: entrega manual) | Usuario, 2026-08-10. Los 14 de «query (13)» quedan FUERA por decisión explícita  no es un olvido |
| Audiencia ampliada | `asistentes.md` (155 filas, con cédulas) sumó **21 sin-QR nuevos** → 155 descargables. Se AGREGÓ, no se reemplazó: Edgar Paternina Amaris (escaneó QR, está en Hoja1) no aparece en ese listado y se conserva | Usuario, 2026-08-12. El md traía además 9 filas con grafías divergentes de gente que ya estaba (no son personas nuevas) y la errata «KOOP» por Kopp |
| Sin asistencia registrada | Botón retenido + aviso emergente que remite a María Cristina Giraldo (mgiraldo@) | Pedido del usuario; el canal exacto del contacto es pendiente de contenido |
| La fuente | **Poppins Regular, definitiva** | 13 candidatas medidas, ninguna ES la de la pieza; Poppins clava el peso (asta 3.00 px). Riesgo aceptado en SEGURIDAD.md. Usuario, 2026-08-10 |
| Dónde se generan los PDF | En la estación, jamás en el servidor ni en el navegador | El server de producción no gana dependencias (npm ci --ignore-scripts, prune) y la CSP no se toca. El precedente es el QR |

## Lo que NO se hace (límites duros)

- **Ni reenvío por correo, ni listado, ni endpoint por parámetro**: la única ruta es
  `GET /api/certificado`, que resuelve el oid de la propia sesión y nada más.
- **Ni generación en caliente**: el servidor sirve bytes pre-verificados; no compone.
- **Ni tocar el flujo OIDC ni la CSP.**
- **Ni una cédula en git**: el repo es público; `*.xlsx` ignorado, audiencia y PDFs en `.datos/`.

## Fase 1  La audiencia se congela ✔

`scripts/certificados-audiencia.mjs` (molde: `envio-qr-audiencia` + `personas-resolver`): Hoja1
con `abrirLibro()` + los sin-QR resueltos por nombre exacto; cada persona → su **oid** (la clave
que el servidor busca); `nombrePintado` derivado con testigo o `ORDEN_A_MANO`; guardas de
conteo/unicidad/anomalías con fallo cerrado; `entregaManual` para quien no tiene cuenta.
El JSON (`.datos/certificados-audiencia-<fecha>.json`) **se revisa a mano** antes de generar y
**no se sobrescribe**.

## Fase 2  La fuente se midió, y la decisión quedó escrita ✔

`scripts/certificado-fuente.py`: tres arneses sucesivos (ancho de frase → ajuste por palabra con
tracking → subpíxel escala+tracking + IoU alineado + **asta**). Veredicto: ninguna de las 13 ES
la fuente (mejor IoU 0.608); el peso sí quedó identificado (asta 3.00 px = Regular). Decisión del
usuario: **Poppins Regular definitiva**, versionada en `fuentes-origen/` con su OFL. El script
queda negándose, como testigo del método.

## Fase 3  El generador ✔

`scripts/certificados-generar.py`: A4 apaisado a proporción exacta de la pieza, fondo JPEG q85
dentro del PDF, nombre y cédula **vectoriales** con Poppins incrustada (subset). Cotas heredadas
de «C.C:» (base 4 px sobre su raya): cédula versal 31 px base y=649; nombre versal 36 px base
y=570, centrado, con guard de ancho (piso 28 px). Auto-chequeo por PDF: fuera de las bandas,
idéntico a una referencia sin textos; dentro, centrado ±2 px y ancho esperado; la tinta del texto
se detecta por **diferencia** contra la referencia (un umbral fijo confundía la torre del fondo).
La banda del nombre cubre la **cola de la Q**, que cruza la raya como en cualquier diploma.
Produce además `manifiesto.json` (oid → archivo, **sin** datos personales), la hoja de contactos
para revisar a ojo. (Hasta el 2026-08-12 emitía además `public/img/certificado-muestra.webp`, la
vista previa pública de la página; el usuario retiró la imagen y el derivado se fue con ella.)

## Fase 4  La segunda opinión ✔

`scripts/certificados-auditar.py` (molde: `envio-qr-auditar`): extrae la **capa de texto** de
cada PDF (vectorial, sin OCR) y cruza archivo ↔ contenido ↔ **audiencia congelada** + propiedades
de conjunto + sha256/oid del manifiesto. Probada con sabotaje real.

## Fase 5  El servidor ✔

`server/certificados.js` + `server/app.js`: `CERTIFICADOS_DIR` vacío = no existe; a medias =
aborta; allowlist + resolve niegan el traversal. `/api/me` gana `certificado:
'disponible'|'no_aplica'` (molde `inscripcion`); `GET /api/certificado` (con `revalidate`) sirve
solo el oid de la sesión, `no-store`, attachment; 404 con la forma del genérico. `RUTAS_SPA` +=
`/certificado`. Manual de guardia: `docs/SEGURIDAD.md` §El certificado de participación.

## Fase 6  El cliente ✔

`src/pages/CertificadoPage.tsx` + `.css`: tres estados sobre `useSesion()`; descarga por
**navegación** (cero JS de PDF); botón retenido con el patrón del gate de encuestas, y el estado
`--suprimido` para que **Escape gane a hover y foco** (WCAG 1.4.13  con la clase doblada, porque
`:focus-within` puntúa como clase). `certificado` ausente en `/api/me` = retenido, jamás
descarga. `.gt-boton--inactivo` promovido a `base.css`.

## Fase 7  Los arneses ✔

`gate-test` (401 también navegado, mutadores, hermanas inexistentes sin filtrar nada),
`certificados-server-test.mjs` (nuevo), `sesion-test` (los tres estados + el aviso entero),
`interactions-test`, `a11y-test`, `screenshot` (+ruta).

## Fase 8  La subida y el despliegue por etapas

`deploy/certificados-subir.sh` (molde: el transporte de `deploy.sh`): tar por stdin de ssh con
sha256 doble → `/var/lib/gtalks/certificados/` (`gtalks:gtalks`, 0640) + restart + salud.

1. **Ensayo local**: manifiesto de 4 (jcespedes, llondono, lrojas, mgiraldo) +
   `CERTIFICADOS_DIR` local + `npm run start:local` → `gate-test` + descarga real verificada.
2. **Producción acotada**: subir SOLO esos 4; los cuatro descargan su PDF real (mgiraldo es
   además la persona del aviso); el resto ve el botón retenido en vivo.
3. **Producción completa**: subir los 155 y anunciar.

## Orden de ejecución

```bash
node --env-file=.env scripts/certificados-audiencia.mjs          # congela; revisar el JSON A MANO
.venv-design/Scripts/python scripts/certificados-generar.py --audiencia .datos/certificados-audiencia-<fecha>.json
.venv-design/Scripts/python scripts/certificados-auditar.py .datos/certificados-audiencia-<fecha>.json
node scripts/certificados-server-test.mjs
npm run build
CERTIFICADOS_DIR=.datos/certificados npm run start:local         # y en otra terminal:
node scripts/gate-test.mjs
npm run preview                                                  # y en otra terminal:
node scripts/sesion-test.mjs && node scripts/interactions-test.mjs && node scripts/a11y-test.mjs
bash deploy/certificados-subir.sh --solo jcespedes,llondono,lrojas,mgiraldo   # etapa 2
bash deploy/certificados-subir.sh                                             # etapa 3
```

## Lo que ningún script puede decir

- **¿El canal del contacto del aviso es el correcto?** Hoy dice «María Cristina Giraldo
  (mgiraldo@gecelca.com.co)»  confirmar con ella el canal (¿correo? ¿Teams? ¿teléfono, como en
  el pie del sitio?).
- **¿La pieza es la entrega final?** Si llega otra versión del certificado, es volver a correr
  el bucle entero (medir → generar → auditar → resubir), no parchear.
- **¿Quién le entrega su certificado a Howard?** No tiene cuenta de Entra; su PDF hay que
  generarlo aparte (no está en la audiencia descargable) y hacérselo llegar a mano.
- **¿Cuándo se anuncia?** La ruta existe apenas se despliegue; el anuncio a los asistentes es de
  Comunicaciones.
- **¿Los 14 de «query (13)» quedan fuera de verdad?** La decisión fue del usuario (2026-08-10);
  si cambia, se re-congela la audiencia y se regenera  está diseñado para eso.
