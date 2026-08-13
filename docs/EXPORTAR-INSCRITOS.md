# Sacar de producción la lista de inscritos

Para responder «¿quiénes se han inscrito?» con un Excel. El servidor no puede pegarte nada en el
portapapeles (la sesión va por Password Manager Pro), así que el archivo viaja **por git**: se
publica en una rama aparte del repositorio y se recoge desde la estación con un `fetch`.

---

## Qué se saca, y por qué se puede publicar

El servidor no guarda «una tabla de inscritos». Guarda dos artefactos con propósitos distintos
(`docs/SEGURIDAD.md` §Registro de acceso y §Correo de inscripción):

| Archivo | Qué es | Qué lleva |
|---|---|---|
| `/var/log/gtalks/acceso.log` | Quién inició sesión y cuándo. **Rota** cada semana, 12 rotaciones | `ts`, `resultado`, `oid`, **`upn`** |
| `/var/lib/gtalks/inscripciones.jsonl` | A quién se le mandó el correo de confirmación. No rota nunca | `ts`, `oid`, estado |

La **lista** sale del registro de acceso; el libro solo dice si además salió el correo. Al revés no
sirve: en modo `lista` el libro contiene únicamente a la lista blanca, y un exporte hecho con él
parecería decir que se inscribieron tres personas.

**De los dos archivos, el único dato personal es el `upn` del registro de acceso, y ese no viaja.**
El bloque de abajo lo quita antes de publicar nada: lo que se sube son `oid` (identificadores
opacos del directorio) y fechas. Los nombres y los correos ya están en la estación, en el archivo
de audiencia que congeló `envio-qr-audiencia.mjs` leyendo el grupo de Entra, y **el cruce se hace
aquí**. Por eso publicar en el repositorio público que lo es no expone la lista de correos
corporativos de 163 personas.

Aun así, la rama se borra en cuanto el archivo está en la estación. No hay razón para dejarla.

---

## 1 · En el servidor: preparar los dos archivos

> **Nada de `sudo` línea por línea, y nada de órdenes largas.** Aprendido pegando esto en la
> consola de PMP el 2026-08-04: el primer `sudo` pidió contraseña y se tragó como intentos de
> contraseña **todo el resto del bloque pegado**, sin ejecutar ni una línea más. El síntoma es
> silencioso no hay error, solo un `/tmp/gtalks-exporte` vacío y solo se nota dos bloques
> después, cuando `cp` no encuentra nada. Por eso ahora se entra a una shell de root **una vez**,
> con su contraseña, y desde ahí ya no hay más prompts. Y por eso no hay órdenes de una línea de
> 500 caracteres: una consola web puede meterles un salto de línea al pegarlas y partirlas por la
> mitad.

Primero, la shell de root (escribe la contraseña cuando la pida; el prompt pasa a `root@…`):

```bash
sudo -s
```

Ya como root, mira que los dos directorios existan:

```bash
ls -la /var/lib/gtalks/ /var/log/gtalks/
```

Y prepara los archivos. Solo lee: no toca el libro, no lo trunca y no reinicia nada.

```bash
mkdir -p /tmp/gtalks-exporte
cp /var/lib/gtalks/inscripciones.jsonl /tmp/gtalks-exporte/inscripciones.jsonl
cd /var/log/gtalks
cat acceso.log acceso.log.[0-9] 2>/dev/null > /tmp/gtalks-exporte/crudo.jsonl
zcat acceso.log.*.gz 2>/dev/null >> /tmp/gtalks-exporte/crudo.jsonl
sed -e 's/,"upn":"[^"]*"//' -e 's/,"roles":\[[^]]*\]//' /tmp/gtalks-exporte/crudo.jsonl > /tmp/gtalks-exporte/acceso-seudonimo.jsonl
rm /tmp/gtalks-exporte/crudo.jsonl
chown uprod: /tmp/gtalks-exporte/*
```

El `sed` es lo que quita el dato personal: `upn` y `roles` fuera, `ts`/`resultado`/`oid` dentro.
Compruébalo antes de publicar nada:

```bash
wc -l /tmp/gtalks-exporte/*
head -2 /tmp/gtalks-exporte/acceso-seudonimo.jsonl
grep -c '@' /tmp/gtalks-exporte/acceso-seudonimo.jsonl
exit
```

**Ese `grep` tiene que decir `0`.** Cada línea debe verse así:

```json
{"ts":"2026-08-04T14:12:03.117Z","resultado":"ok","oid":"48680ddf-b4c0-49c5-bf85-aa5d413c36f6"}
```

Si `/var/log/gtalks/` no existe o sale vacío, `AUDIT_LOG_PATH` no está configurado en
`/etc/gtalks/env`: sigue igual con el libro, pero tenlo presente, porque entonces la lista está
acotada por `INSCRIPCION_MODO` y no es la de todo el que ha entrado.

---

## 2 · En el servidor: publicarlo en una rama

Ya de vuelta como `uprod`, no como root: el clon y el `push` no necesitan privilegios.

```bash
FECHA=$(date +%F)
cd /tmp && rm -rf gtalks-datos
git clone --depth 1 https://github.com/juanpacj-wq/FORO-GTALKS.git gtalks-datos
cd gtalks-datos
git checkout -b "exporte/inscritos-$FECHA"
mkdir -p exportes && cp /tmp/gtalks-exporte/*.jsonl exportes/
git status --short
git -c user.name="G-TALKS prod" -c user.email="gtalks@gecelca.com.co" add exportes
git -c user.name="G-TALKS prod" -c user.email="gtalks@gecelca.com.co" \
    commit -m "Exporte de inscritos $FECHA (seudónimo: oid y fechas, sin nombres ni correos)"
git show --stat HEAD
```

Ese `git status --short` es la reja de este bloque: si no lista los dos `.jsonl`, el paso 1 no
dejó nada y el `commit` te dirá «nothing to commit» en vez de fallar.

El `push` necesita un token, porque el repositorio se clona sin credenciales pero no se escribe sin
ellas. Genera uno **de un solo uso** en GitHub → *Settings* → *Developer settings* → *Fine-grained
tokens*: solo el repositorio `FORO-GTALKS`, permiso **Contents: Read and write**, caducidad 7 días.

```bash
read -rsp "Token de GitHub (no se ve, no queda en el historial): " GH; echo
git push "https://x-access-token:$GH@github.com/juanpacj-wq/FORO-GTALKS.git" HEAD
unset GH
```

El `read -rs` es lo que mantiene el token fuera de `~/.bash_history` y de la lista de procesos.
**No se ve nada mientras lo pegas: es normal.** Pega y dale Enter; si le das Enter en vacío, el
`push` sale con «Authentication failed» y basta con repetir las dos líneas.

Revócalo en GitHub en cuanto termines: es más rápido que confiar en la caducidad. Y si en algún
momento acaba escrito en claro un chat, un correo, un pantallazo, revócalo **ya**: un token con
`Contents: write` escribe en el repositorio del foro.

---

## 3 · En la estación: recogerlo y armar el Excel

```bash
git fetch origin "exporte/inscritos-<FECHA>"
mkdir -p .datos
git show FETCH_HEAD:exportes/acceso-seudonimo.jsonl      > .datos/acceso-seudonimo.jsonl
git show FETCH_HEAD:exportes/inscripciones-<FECHA>.jsonl > .datos/inscripciones-prod.jsonl

node scripts/inscritos-exportar.mjs \
  --acceso .datos/acceso-seudonimo.jsonl \
  --libro  .datos/inscripciones-prod.jsonl \
  --salida .datos/inscritos-<FECHA>.json

node scripts/inscritos-excel.mjs --audiencia .datos/audiencia-<FECHA>-<grupo>.json
```

Sale `.datos/inscritos-gtalks-<FECHA>.xlsx` con tres hojas **Inscritos**, **Sin ingresar** y, si
hubo, **Intentos rechazados** y su `.csv` de respaldo. `.datos/` está en `.gitignore`: los nombres
y correos se quedan en la estación.

Hazlo con **Git Bash**, no con PowerShell: el `>` de PowerShell 5.1 escribe BOM y se lo pega a la
primera línea del JSONL. (Los scripts lo toleran, pero no hay por qué provocarlo.)

---

## 4 · Limpieza

```bash
# En la estación, cuando el Excel ya esté hecho:
git push origin --delete "exporte/inscritos-<FECHA>"

# En el servidor:
rm -rf /tmp/gtalks-datos /tmp/gtalks-exporte
```

Y revoca el token en GitHub.

---

## Detalles que no son obvios

- **El `oid` es la clave, no el correo.** Un UPN cambia (corrección de alias, matrimonio) y
  partiría el histórico de una persona en dos. Todo el cruce va por `oid`, igual que el libro.
- **Quien entró y no está en la audiencia congelada sale marcado, no desaparece.** La hoja lo dice
  con «En el grupo: No». Sería alguien asignado a mano en la Enterprise App, o alguien añadido al
  grupo después de congelar la audiencia. Volver a congelarla lo resuelve.
- **Las horas son de Bogotá.** El registro guarda UTC; el listado convierte a `America/Bogota` y
  escribe `AAAA-MM-DD HH:MM` como texto, que ordena igual que una fecha y no depende de la
  configuración regional de quien abra el archivo.
- **Un exporte no es un censo cerrado.** Repetirlo el día siguiente da más gente; los archivos
  llevan la fecha en el nombre a propósito, y el orden de salida es estable para que dos exportes
  se puedan diffear.
- **Nada de esto añade superficie HTTP.** No hay ni debe haber una ruta que sirva el registro de
  asistencia: sería la peor puerta que se le puede poner a este servidor (`docs/SEGURIDAD.md`).
