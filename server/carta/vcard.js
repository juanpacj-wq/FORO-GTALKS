/**
 * La vCard 3.0 de una tarjeta («Guardar contacto»). PURA.
 *
 * Lo que la app anterior hacía mal y aquí no: escapa `\` `;` `,` y los saltos de línea en TODOS
 * los valores (RFC 6350 §3.4), lleva `N:` además de `FN:` (sin `N:`, iOS no importa el
 * contacto), termina cada línea en CRLF y pliega las líneas a 75 octetos UTF-8 (§3.2), que es lo
 * que hace que un nombre largo con tildes no rompa la importación en Android.
 *
 * Sin `PHOTO`: el navegador ya tiene la foto en la tarjeta y una vCard con blob adjunto pesa
 * cientos de KB por cada «guardar». Sin `NOTE`, sin `BDAY`: solo lo que la tarjeta enseña.
 */

/** Escapa un valor de propiedad: barra, punto y coma, coma y saltos (§3.4). */
export function escaparVcard(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Pliega una línea lógica a líneas físicas de a lo sumo 75 OCTETOS, sin partir un carácter
 * UTF-8 por la mitad. Las continuaciones empiezan por un espacio (§3.2).
 */
export function plegar(linea, maximo = 75) {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= maximo) return linea;
  const partes = [];
  let inicio = 0;
  let primera = true;
  while (inicio < bytes.length) {
    const cupo = primera ? maximo : maximo - 1; // la continuación gasta un octeto en el espacio
    let fin = Math.min(inicio + cupo, bytes.length);
    // Retrocede hasta un límite de carácter: un byte de continuación UTF-8 empieza por 10xxxxxx.
    while (fin < bytes.length && fin > inicio && (bytes[fin] & 0xc0) === 0x80) fin--;
    partes.push((primera ? '' : ' ') + bytes.subarray(inicio, fin).toString('utf8'));
    inicio = fin;
    primera = false;
  }
  return partes.join('\r\n');
}

const TIPOS_RED = {
  linkedin: 'linkedin',
  instagram: 'instagram',
  x: 'twitter',
  facebook: 'facebook',
  youtube: 'youtube',
  tiktok: 'tiktok',
};

/**
 * @param perfil     el perfil público (ver repositorio.js → obtenerPublico)
 * @param urlTarjeta la URL absoluta de la tarjeta
 * @param ahora      reloj inyectable para REV:
 * @returns {string} el texto de la vCard, con CRLF
 */
export function generarVcard(perfil, urlTarjeta, ahora = new Date()) {
  const lineas = ['BEGIN:VCARD', 'VERSION:3.0'];
  const prop = (nombre, valor) => {
    if (valor === null || valor === undefined || valor === '') return;
    lineas.push(plegar(`${nombre}:${escaparVcard(valor)}`));
  };

  lineas.push(plegar(`N:${escaparVcard(perfil.apellidos)};${escaparVcard(perfil.nombres)};;;`));
  prop('FN', `${perfil.nombres} ${perfil.apellidos}`.trim());
  prop('ORG', 'GECELCA');
  prop('TITLE', perfil.cargo);
  if (perfil.area) prop('ROLE', perfil.area);
  prop('EMAIL;TYPE=INTERNET,WORK', perfil.correo);
  if (perfil.telefono) prop('TEL;TYPE=WORK,VOICE', perfil.telefono);
  if (perfil.whatsapp && perfil.whatsapp !== perfil.telefono) prop('TEL;TYPE=CELL', perfil.whatsapp);
  prop('URL', urlTarjeta);
  const redes = perfil.redes || {};
  for (const [red, tipo] of Object.entries(TIPOS_RED)) {
    if (redes[red]) prop(`X-SOCIALPROFILE;TYPE=${tipo}`, redes[red]);
  }
  if (redes.sitio_web) prop('X-SOCIALPROFILE;TYPE=website', redes.sitio_web);
  if (perfil.whatsapp) prop('X-SOCIALPROFILE;TYPE=whatsapp', `https://wa.me/${perfil.whatsapp.replace(/\D/g, '')}`);
  prop('REV', ahora.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  lineas.push('END:VCARD');
  return lineas.join('\r\n') + '\r\n';
}

/** Nombre de archivo seguro para el `Content-Disposition`: ASCII para `filename`, UTF-8 para `filename*`. */
export function nombreArchivoVcard(perfil) {
  const base = `${perfil.nombres} ${perfil.apellidos}`.trim().replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ');
  const ascii = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\u0020-\u007e]/g, '_');
  return {
    ascii: `${ascii || 'contacto'}.vcf`,
    utf8: encodeURIComponent(`${base || 'contacto'}.vcf`),
  };
}
