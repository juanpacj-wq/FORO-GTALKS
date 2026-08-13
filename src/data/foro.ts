/**
 * Fuente de verdad única del contenido del foro.
 *
 * Todo sale transcrito de las tres piezas gráficas de la raíz (el texto crudo
 * está en `design-extract/text/`). La agenda alimenta a la vez la sección de
 * agenda y los perfiles de ponente: las intervenciones de cada persona se
 * derivan recorriendo `AGENDA`, no hay una segunda lista que mantener.
 *
 * El copy institucional va literal, aunque mezcle tuteo («Prepárate»,
 * «expertos como tú») y ustedeo («Los invitamos»). Esa mezcla está en la
 * fuente. El microcopy nuevo de la interfaz sí va en es-CO con tuteo.
 */

import eventoJson from './evento.json'

/**
 * Los hechos canónicos del evento: nombre, marca, fecha, lugar y contacto.
 *
 * Viven en `evento.json` y no aquí porque tienen un segundo consumidor fuera de
 * Vite: el correo de inscripción los necesita desde `server/`, que es JS plano
 * sin compilación y no puede importar TypeScript (ver `server/correo/evento.js`).
 * Con una copia a mano en el servidor, las dos se habrían separado el día que se
 * resuelva el pendiente #1. Un archivo, dos lectores.
 *
 * ⚠ Pendiente #1: los PDF dicen «G Working», la carpeta dice «Puerta de Oro».
 */
export const EVENTO = eventoJson

// --------------------------------------------------------------------- ponentes

export interface Ponente {
  slug: string
  nombre: string
  cargo: string
  /**
   * Trayectoria, transcrita literal de «PERFIL DE LOS PONENTES.docx». Un
   * elemento por párrafo.
   *
   * ⚠ Los párrafos son los de la PÁGINA, que casi siempre son los del
   * documento pero no por definición. El primero se compone como entradilla,
   * así que una ficha que llegue en un bloque único se lee plana, sin
   * jerarquía, al lado de las demás. Cuando pasa, se parte aquí.
   *
   * Partir es composición, no copy. El corte cae SIEMPRE en un punto y seguido
   * de la fuente, donde deja de presentar a la persona y empieza a contar su
   * trayectoria, y lo único que cambia es que un espacio pasa a ser un salto
   * de párrafo: ni una letra más, ni una menos. Hoy lo necesitan tres fichas
   * Karen Henríquez, Ángel Hernández y Erick Wehdeking, esta última entera en
   * un bloque de 849 pulsaciones; las otras ocho llegan ya repartidas.
   *
   * La invariante `bio.join(' ') === los párrafos de la fuente` la comprueba
   * `scripts/bios-verificar.py`, que además falla si alguna bio se queda en un
   * párrafo y por tanto sin entradilla. Correrlo tras tocar cualquier `bio` no
   * es opcional: es lo único que distingue un corte de una errata.
   *
   * El campo sigue siendo opcional aunque hoy la tengan las once: quien no la
   * tenga no pinta la sección ni cartel de «no disponible» ni caja vacía, y
   * esa es la red que permitió publicar el sitio con diez de once. Se mantiene
   * porque el material llega por entregas y una ficha nueva puede volver a
   * llegar sin texto.
   */
  bio?: readonly string[]
}

/**
 * Los 11 ponentes, en el orden de su primera aparición en `AGENDA`.
 *
 * El orden se mantiene a mano y no se deriva: `PONENTES` es `as const` y de
 * aquí sale la unión `PonenteSlug`, que hace que un bloque de la agenda no
 * compile si cita a alguien que no existe. Esa garantía vale más que el orden
 * automático. Si se mueve un bloque de hora, hay que mover también su ponente.
 */
export const PONENTES = [
  {
    slug: 'erick-wehdeking-arcieri',
    nombre: 'Erick Wehdeking Arcieri',
    cargo: 'Presidente de GECELCA',
    // Su ficha llegó al final del documento, en un bloque único y con el
    // encabezado en otro formato («11. Erick Wehdeking Arcieri», sin cargo).
    // El cargo se queda como estaba lo dicen la agenda y el propio texto, y
    // el bloque va partido en tres, como los demás.
    bio: [
      'Administrador de Empresas, especialista en Finanzas y con estudios de MBA. Cuenta con ' +
        'más de 35 años de trayectoria en el sector energético, desarrollada al interior de ' +
        'GECELCA y su antecesora CORELCA, donde inició su carrera profesional en 1989.',
      'A lo largo de su trayectoria ha desempeñado cargos como Profesional Especializado de ' +
        'Facturación, Gerente Financiero, Vicepresidente Administrativo y Financiero, ' +
        'Vicepresidente Administrativo y Primer Suplente del Presidente, adquiriendo ' +
        'experiencia en los procesos comerciales, financieros y administrativos de la ' +
        'organización.',
      'En enero de 2026 fue designado Presidente de GECELCA S.A. E.S.P., luego de una extensa ' +
        'trayectoria en la compañía, desde donde asume la dirección de la empresa en un ' +
        'contexto marcado por los retos de la transición energética y el desarrollo de nuevas ' +
        'fuentes de generación.',
    ],
  },
  {
    slug: 'jose-fernando-prada',
    nombre: 'José Fernando Prada',
    cargo: 'Especialista y consultor senior en energía',
    bio: [
      'Ingeniero Electricista de la Universidad Nacional de Colombia, especialista en ' +
        'Finanzas de la Universidad EAFIT, con maestrías en Ingeniería Eléctrica y en ' +
        'Tecnología y Políticas Energéticas del Massachusetts Institute of Technology (MIT), ' +
        'y doctor en Ingeniería y Políticas Públicas de la Universidad Carnegie Mellon.',
      'Cuenta con más de 25 años de experiencia en el sector energético, donde ha liderado ' +
        'iniciativas estratégicas relacionadas con el mercado mayorista de energía, el cargo ' +
        'por confiabilidad, la transmisión eléctrica y la transición energética. Fue director ' +
        'ejecutivo y experto comisionado de la Comisión de Regulación de Energía y Gas ' +
        '(CREG).',
      'Antes de su paso por la CREG, se desempeñó como director para Latinoamérica en KEMA ' +
        'Consulting y ha sido consultor senior e investigador para organismos multilaterales, ' +
        'gobiernos y empresas de servicios públicos, aportando al desarrollo de políticas y ' +
        'proyectos energéticos en diferentes países.',
    ],
  },
  {
    slug: 'nicolas-rincon-diaz',
    nombre: 'Nicolás Rincón Díaz',
    // El documento escribe «CONSULTORÍA Y MEDIO AMBIENTA S.A.»: es una errata de
    // la fuente, no el nombre de la empresa. Se conserva la forma correcta.
    cargo: 'Gerente de Proyectos Consultoría y Medio Ambiente S.A.',
    bio: [
      'Ingeniero Sanitario y Ambiental, Magíster en Energía y Sostenibilidad, especialista en ' +
        'Gerencia del Ambiente con más de 18 años de experiencia en viabilidad ambiental de ' +
        'proyectos energéticos e infraestructura.',
      'Ha dirigido la elaboración de estudios de impacto ambiental para proyectos complejos ' +
        'en hidrocarburos, energías renovables (solar, eólica), infraestructura eléctrica, ' +
        'obras civiles y programas sísmicos. Su expertise incluye gestión de riesgos ' +
        'ambientales, evaluación de calidad de aguas, suelos y aspectos atmosféricos, ' +
        'interventorías en seguridad industrial y salud ocupacional, y cumplimiento de ' +
        'normatividad ambiental.',
      'Ha trabajado como docente en gestión ambiental y ha asesorado en aplicación de ' +
        'tecnologías limpias y desarrollo sostenible en proyectos del sector energía.',
    ],
  },
  {
    slug: 'carlos-naranjo-merino',
    nombre: 'Carlos Naranjo Merino',
    cargo: 'Consultor senior en sostenibilidad y cambio climático',
    bio: [
      'Ingeniero Químico de la Universidad Nacional, Especialista en ingeniería ambiental de ' +
        'la UPB. Docente de posgrados en Colombia.',
      'Cuenta con experiencia de más de 20 años en diseño de estrategia de sostenibilidad y ' +
        'reportes, estrategia de cambio climático, gestión de riesgos hídricos y huellas ' +
        'ambientales como huella de carbono y huella hídrica.',
      'Dentro de su experiencia ha asesorado a empresas líderes mundiales en Sostenibilidad ' +
        'como Grupo Ecopetrol, Grupo Nutresa, Grupo Argos, Grupo Bancolombia, Grupo ISA, ' +
        'Grupo de Energía de Bogotá, Grupo Colombina y Celsia entre otros.',
      'Ha sido autor de publicaciones como el Manual de Transporte Limpio v1 y v2, Guía ' +
        'Técnica orientada al cálculo y gestión del alcance 3 en la huella de carbono ' +
        'organizacional y varias publicaciones científicas en Análisis de Ciclo de Vida.',
    ],
  },
  {
    slug: 'karen-henriquez-leal',
    nombre: 'Karen Henríquez Leal',
    cargo: 'Vicepresidenta Financiera de GECELCA',
    bio: [
      'Ingeniera Industrial de la Universidad del Norte, especialista en Finanzas y Magíster ' +
        'en Administración de Empresas de la misma institución.',
      'Cuenta con más de 19 años de trayectoria en el sector energético, con amplia ' +
        'experiencia en planeación, regulación, nuevos negocios y gestión financiera. ' +
        'Actualmente se desempeña como Vicepresidenta Financiera de GECELCA, cargo desde el ' +
        'cual lidera la estrategia financiera de la organización.',
      'Anteriormente ocupó las posiciones de Gerente Financiera y Analista de Regulación y ' +
        'Nuevos Negocios en GECELCA, así como Profesional de Planeación y Sistemas en CORELCA ' +
        'S.A. E.S.P., consolidando una sólida trayectoria en el análisis financiero, la ' +
        'regulación del sector eléctrico y la formulación de estrategias para el desarrollo ' +
        'del negocio.',
    ],
  },
  {
    slug: 'alfredo-chamat-barrios',
    nombre: 'Alfredo Chamat Barrios',
    cargo: 'Vicepresidente de gas y energía Petromil',
    bio: [
      'Administrador de Empresas, especialista en Finanzas y Executive MBA, con más de 24 ' +
        'años de experiencia en los sectores de gas natural, energía y servicios públicos, ' +
        'liderando procesos estratégicos, financieros y comerciales.',
      'Actualmente es Vicepresidente de Gas y Energías en Petromil. Anteriormente fue Gerente ' +
        'General de Calamari LNG, primer importador y comercializador de gas natural licuado ' +
        '(LNG) en Colombia, donde lideró el abastecimiento de gas para centrales térmicas con ' +
        'una capacidad cercana a los 2.000 MW de generación.',
      'A lo largo de su trayectoria ha ocupado cargos de liderazgo en compañías como Surtigas ' +
        'y ha participado como panelista en importantes foros internacionales sobre LNG y gas ' +
        'natural. Además, cuenta con formación especializada en economía y gerencia del gas, ' +
        'trading de LNG y treasury management.',
    ],
  },
  {
    slug: 'carolina-palacio-garcerant',
    nombre: 'Carolina Palacio Garcerant',
    cargo: 'Gerente de Regulación y Planeación Energética de GECELCA',
    bio: [
      'Ingeniera Electricista de la Universidad del Norte, con formación especializada en ' +
        'mercados de energía, regulación, operación de sistemas eléctricos de potencia, ' +
        'gestión del riesgo, calidad y transición energética.',
      'Cuenta con más de 20 años de experiencia en el sector energético, desarrollados en ' +
        'GECELCA, donde actualmente se desempeña como Gerente de Regulación y Planeación ' +
        'Energética, liderando procesos estratégicos relacionados con la regulación, la ' +
        'planeación y la comercialización de energía.',
      'A lo largo de su trayectoria ha ocupado diversos cargos en la organización, ' +
        'consolidando una amplia experiencia en regulación comercial, transacciones del ' +
        'mercado eléctrico y nuevos negocios. Su formación ha sido fortalecida a través de ' +
        'programas especializados impartidos por entidades como XM, ISA, ANDESCO, ICONTEC, ' +
        'Bureau Veritas, CIDET y la Universidad del Norte.',
    ],
  },
  {
    slug: 'jorge-sierra-almanza',
    nombre: 'Jorge Sierra Almanza',
    cargo: 'Gerente de Operaciones Enersinc',
    bio: [
      'Fundador y CEO de Enersinc, Ingeniero Electricista con Maestría en Regulación ' +
        'Económica de la Universidad de los Andes y estudios de maestría en Estadística y ' +
        'Nuevas Tecnologías en el Massachusetts Institute of Technology (MIT).',
      'Cuenta con más de 23 años de experiencia internacional en modelado, simulación y ' +
        'regulación de mercados eléctricos, con amplia trayectoria en pronósticos, regulación ' +
        'y optimización de recursos energéticos para el sector eléctrico en Latinoamérica.',
      'Ha liderado proyectos de consultoría e innovación tecnológica para entidades públicas ' +
        'y privadas como el Ministerio de Minas y Energía, la CREG, el Banco Mundial, ' +
        'Ecopetrol, XM, BlackRock, EY, EDF, ENGIE y AES, incorporando analítica avanzada e ' +
        'inteligencia artificial para fortalecer la toma de decisiones en el sector ' +
        'energético.',
    ],
  },
  {
    slug: 'miguel-prieto-locarno',
    nombre: 'Miguel Prieto Locarno',
    cargo: 'Gerente de Nuevos Negocios de GECELCA',
    bio: [
      'Ingeniero Industrial y Especialista en Finanzas de la Universidad del Norte. Cuenta ' +
        'con más de 10 años de experiencia en el sector energético, con énfasis en la ' +
        'estructuración, evaluación y desarrollo de proyectos de generación de energía, ' +
        'descarbonización y nuevos negocios.',
      'Actualmente es Gerente de Nuevos Negocios de GECELCA, donde lidera la identificación y ' +
        'estructuración de oportunidades de inversión, estudios de prefactibilidad y ' +
        'factibilidad, procesos de debida diligencia y el desarrollo de proyectos ' +
        'estratégicos para la transición energética.',
      'A lo largo de su trayectoria ha ocupado diversos cargos en GECELCA, consolidando ' +
        'experiencia en planeación estratégica, regulación, análisis financiero y gestión de ' +
        'riesgos. Ha participado en la estructuración y evaluación de proyectos que superan 1 ' +
        'GW de capacidad instalada, liderando procesos para impulsar el crecimiento ' +
        'sostenible del sector eléctrico.',
    ],
  },
  {
    slug: 'christian-moreno-rocha',
    nombre: 'Christian Moreno Rocha',
    cargo: 'Docente y consultor en energías renovables',
    bio: [
      'Docente e investigador con Doctorado en Energías Renovables y Sostenibilidad ' +
        'Energética. Máster en Eficiencia Energética y Energías Renovables, especialista en ' +
        'Gerencia Energética. Sólida formación en Ingeniería Eléctrica y Física Pura.',
      'Profesional con experiencia integral como docente universitario, investigador y asesor ' +
        'técnico. Actualmente investigador en el Instituto Ambiental de Estocolmo (SEI) en ' +
        'proyecto sobre aceptación social de energía eólica offshore en el Caribe colombiano. ' +
        'Docente de tiempo completo en Universidad de la Costa desde 2016, donde coordina ' +
        'programas académicos, lidera grupos de investigación y desarrolla proyectos sobre ' +
        'transición energética y optimización de recursos renovables. Autor de múltiples ' +
        'artículos de investigación en revistas académicas revisadas por pares sobre ' +
        'sostenibilidad energética.',
      'También docente de postgrado en Escuela Naval de Suboficiales, especializado en ' +
        'gestión eficiente de energía y desarrollo sostenible. Experiencia en asesoría ' +
        'técnica para implementación de proyectos energéticos sostenibles en el sector ' +
        'empresarial.',
    ],
  },
  {
    slug: 'angel-hernandez-montes',
    nombre: 'Ángel Hernández Montes',
    cargo: 'Vicepresidente de Comercialización de GECELCA',
    bio: [
      'Ingeniero Electricista de la Universidad del Norte y Magíster en Administración de ' +
        'Empresas de la misma institución.',
      'Complementó su formación con el Programa de Especialización en Servicios Públicos ' +
        'Domiciliarios de la Universidad Externado de Colombia y una amplia capacitación en ' +
        'regulación, mercados de energía, gestión del riesgo, negociación, generación ' +
        'eléctrica, liderazgo y servicios públicos, impartida por entidades como XM, ANDESCO, ' +
        'CIER, ACIEM, NATURGAS y la Universidad del Norte.',
      'Cuenta con más de 30 años de experiencia en el sector energético, desarrollando su ' +
        'trayectoria en GECELCA, donde inició como Profesional de la División de Energía y ' +
        'posteriormente ocupó los cargos de Profesional Especializado, Jefe de la División de ' +
        'Energía, Gerente de Energía y vicepresidente de Comercialización, consolidando una ' +
        'sólida trayectoria en las áreas de energía y comercialización del sector eléctrico.',
    ],
  },
] as const satisfies readonly Ponente[]

/** Unión de los slugs reales: si un bloque cita a alguien que no existe, no compila. */
export type PonenteSlug = (typeof PONENTES)[number]['slug']

// ----------------------------------------------------------------------- agenda

interface BloqueBase {
  /** Hora de 24 h, «HH:MM». El formato a.m./p.m. de la pieza lo pone `formatoHora`. */
  inicio: string
  fin: string
  titulo: string
}

/**
 * Cuatro formas distintas de bloque, cada una con su tratamiento visual medido
 * en las piezas:
 *
 * - `logistico`  franja celeste a ancho completo, sin ponente (breaks, almuerzo)
 * - `hito`       sobre la tarjeta, título en azul, sin etiqueta de categoría
 * - `ponencia`   etiqueta «Ponencia» en itálica gris + un ponente
 * - `panel`      etiqueta «Panel» en itálica gris + moderador y panelistas
 */
export type Bloque =
  | (BloqueBase & { tipo: 'logistico' })
  | (BloqueBase & { tipo: 'hito'; ponente?: PonenteSlug })
  | (BloqueBase & { tipo: 'ponencia'; ponente: PonenteSlug })
  | (BloqueBase & { tipo: 'panel'; moderador: PonenteSlug; panelistas: PonenteSlug[] })

export const AGENDA: Bloque[] = [
  { tipo: 'hito', inicio: '08:30', fin: '09:00', titulo: 'Registro 1° Foro GECELCA' },
  {
    tipo: 'hito',
    inicio: '09:00',
    fin: '09:20',
    titulo: 'Apertura',
    ponente: 'erick-wehdeking-arcieri',
  },
  {
    tipo: 'ponencia',
    inicio: '09:20',
    fin: '10:00',
    titulo: 'Sector Energético Colombiano: Situación actual del mercado.',
    ponente: 'jose-fernando-prada',
  },
  { tipo: 'logistico', inicio: '10:00', fin: '10:20', titulo: 'Coffee Break' },
  {
    tipo: 'ponencia',
    inicio: '10:20',
    fin: '10:50',
    titulo: 'Licenciamiento ambiental en Colombia',
    ponente: 'nicolas-rincon-diaz',
  },
  {
    tipo: 'ponencia',
    inicio: '10:50',
    fin: '11:20',
    titulo: 'Carbono como estrategia',
    ponente: 'carlos-naranjo-merino',
  },
  {
    tipo: 'panel',
    inicio: '11:20',
    fin: '12:00',
    titulo: 'Seguridad Energética en Transición',
    moderador: 'karen-henriquez-leal',
    panelistas: [
      'jose-fernando-prada',
      'alfredo-chamat-barrios',
      'nicolas-rincon-diaz',
      'carolina-palacio-garcerant',
    ],
  },
  { tipo: 'logistico', inicio: '12:00', fin: '14:30', titulo: 'Almuerzo Libre' },
  {
    tipo: 'ponencia',
    inicio: '14:30',
    fin: '15:10',
    titulo: 'La tecnología como motor de Transformación Energética',
    ponente: 'jorge-sierra-almanza',
  },
  { tipo: 'logistico', inicio: '15:10', fin: '15:30', titulo: 'Coffee Break' },
  {
    tipo: 'panel',
    inicio: '15:30',
    fin: '16:10',
    titulo: 'Futuro en acción',
    moderador: 'miguel-prieto-locarno',
    panelistas: [
      'christian-moreno-rocha',
      'jorge-sierra-almanza',
      'carlos-naranjo-merino',
      'angel-hernandez-montes',
    ],
  },
  {
    tipo: 'hito',
    inicio: '16:10',
    fin: '16:30',
    titulo: 'Cierre 1° Foro GECELCA',
    ponente: 'erick-wehdeking-arcieri',
  },
]

// ------------------------------------------------------------------------ copys

/** Un párrafo es una lista de fragmentos; `fuerte` es lo que va en negrita en la pieza. */
export type Fragmento = string | { fuerte: string }
export type Parrafo = Fragmento[]

/** `invitacion gtalk 2026.pdf` el copy neutro. */
export const BIENVENIDA: Parrafo[] = [
  [
    'Un espacio que reúne a líderes, expertos y actores clave del sector energético para ' +
      'conversar sobre los desafíos, oportunidades y tendencias que están definiendo la ' +
      'transformación energética.',
  ],
  [
    'Prepárate para compartir conocimiento, intercambiar experiencias y construir juntos una ' +
      'visión sostenible, innovadora y competitiva para el futuro.',
  ],
]

/** Combinación de `invitación expertos.pdf` y `2 Arte foro gtalk 2026.pdf`. */
export const SOBRE_EL_FORO: Parrafo[] = [
  [
    'En GECELCA creemos que las grandes transformaciones comienzan cuando el conocimiento se ' +
      'comparte. Por eso, reuniremos a expertos, que desde su experiencia y visión, han ' +
      'contribuido al desarrollo del sector energético.',
  ],
  
  [
    'Más que un foro, este encuentro representa una oportunidad para fortalecer nuestra ' +
      'comprensión del entorno, alinear a toda la empresa con la evolución del sector y aportar ' +
      'insumos clave para nuestro ejercicio de ',
    { fuerte: 'Planeación Estratégica 2027-2031' },
    '.',
  ],
]

/** La caja destacada sobre tinte celeste de `2 Arte foro gtalk 2026.pdf`. */
export const LLAMADO: Parrafo = [
  { fuerte: 'Los invitamos a participar activamente' },
  ' enriqueciendo la ' +
    'conversación y fortaleciendo nuestra visión institucional frente a los retos del futuro.',
]

/** Titular de `invitación expertos.pdf`. */
export const TITULAR_EXPERTOS = '¡Queremos que hagas parte de esta conversación!'

// -------------------------------------------------------------------- encuestas

export interface Encuesta {
  /** Identificador estable. También compone el `id` de la nota de destino. */
  id: string
  titulo: string
  descripcion: string
  /**
   * Texto del botón. Es lo único de aquí que NO es copy institucional: es
   * microcopy nuevo, así que va en es-CO con tuteo.
   *
   * Los tres son distintos a propósito y EMPIEZAN distinto: dos enlaces con el
   * mismo texto en la misma página son indistinguibles para quien navega
   * saltando de enlace en enlace, que es como los recorre un lector de
   * pantalla, oyendo el principio de cada uno.
   */
  accion: string
  /**
   * Formulario de destino. Sale del sitio: se abre en una pestaña nueva.
   *
   * Es opcional porque no toda encuesta lo trae de fábrica: la de satisfacción
   * abre por reloj cuando el evento cierra y su URL la RETIENE el servidor
   * (`server/encuestas.js`) hasta esa hora, para que no viaje en el bundle
   * público ni dependa del reloj de quien mira. Sin `url` aquí, el botón se
   * pinta deshabilitado con su aviso y `useEncuestaSatisfaccion` pregunta por
   * `/api/encuestas`, que es quien decide.
   */
  url?: string
  /**
   * La tarjeta ya no recoge respuestas: las ANUNCIA. `/encuestas` la pinta
   * como la lámina destacada de la página celeste, a todo lo ancho y sin
   * ordinal, porque consultar resultados no es responder una encuesta y no
   * es una de las que la entradilla invita a diligenciar.
   */
  resultados?: true
}

/**
 * Las tres tarjetas de `/encuestas`. Ya no son simétricas: el panel pasó y la
 * de preguntas para panelistas dejó de recoger preguntas ahora ANUNCIA las
 * respuestas (`resultados`); las otras dos siguen siendo encuestas por
 * responder.
 *
 * **Dónde quedan las respuestas**: en Microsoft Forms, dentro del tenant de
 * GECELCA. Este proyecto no guarda ninguna, así que sigue sin necesitar base de
 * datos ni endpoint de escritura que era la otra mitad del pendiente #6.
 *
 * El título y la descripción van literales, como el resto del copy
 * institucional (salvo la tarjeta de resultados, cuyo copy es nuevo).
 *
 * **El orden importa y no es alfabético**: la de resultados abre la página
 * porque es la noticia, y la de satisfacción va SIEMPRE la última porque es la
 * única que abre por reloj y `interactions-test.mjs` la localiza por posición.
 * Mover o insertar una obliga a ajustar ese arnés no es opcional.
 */
export const ENCUESTAS: readonly Encuesta[] = [
  {
    id: 'preguntas-panelistas',
    titulo: 'Preguntas pendientes para panelistas',
    // El panel ya pasó y sus preguntas ya tienen respuesta: la tarjeta cambió
    // de papel (2026-08-12) y entrega las respuestas en vez de recogerlas.
    // Microcopy nuevo (es-CO), pedido literal del usuario.
    descripcion: 'Consulta las respuestas entregadas por los panelistas a las preguntas que quedaron pendientes durante su intervención',
    // «Ver» y no «Compartir…»: empieza distinto que los otros dos controles
    // (ver `accion` en la interfaz).
    accion: 'Ver respuestas',
    // Sin `url` a propósito: las respuestas ya no viven en un Forms sino en la
    // pieza «RTAS PREGUNTAS PENDIENTES PANELISTAS.pdf» (raíz), que la tarjeta
    // enseña en su visor y entrega en PDF (2026-08-13, pedido del usuario).
    // Los derivados los escribe scripts/build-respuestas.py en
    // src/design/respuestas.ts; adoptar una entrega nueva es reemplazar la
    // pieza y volver a correrlo.
    resultados: true,
  },
  {
    id: 'oportunidades-y-amenazas',
    titulo: 'Oportunidades y amenazas',
    descripcion:
      'Comparte tu visión sobre las principales oportunidades y desafíos que identificas para GECELCA en el contexto actual del sector energético.',
    accion: 'Compartir mi perspectiva',
    url: 'https://forms.cloud.microsoft/r/xxc8PGp3Ly',
  },
  {
    id: 'satisfaccion',
    titulo: 'Encuesta de satisfacción',
    descripcion:
      'Cuéntanos cómo fue tu experiencia durante el foro y ayúdanos a seguir fortaleciendo este espacio de conversación.',
    accion: 'Compartir mi experiencia',
    // Sin `url` a propósito: pregunta por la experiencia del foro, así que no
    // recibe respuestas antes de que el foro termine. El enlace lo entrega
    // `/api/encuestas` pasado el cierre (`fecha.cierreIso` de evento.json);
    // hasta entonces el botón va deshabilitado con ENCUESTA_SATISFACCION_AVISO.
  },
]

/**
 * El aviso del botón deshabilitado de la encuesta de satisfacción. Microcopy
 * nuevo (es-CO); también es lo que se imprime en papel mientras no haya URL.
 */
export const ENCUESTA_SATISFACCION_AVISO =
  'Se habilitará esta encuesta cuando finalice el evento.'

/** Entradilla de `/encuestas`, transcrita literal. Anuncia la lista de abajo. */
export const ENCUESTAS_INTRO =
  'Tu opinión es clave para seguir fortaleciendo GECELCA. Participa en las siguientes encuestas y comparte tu perspectiva sobre los temas abordados durante el foro y tu experiencia en este espacio.'

/**
 * Entradilla de `/galeria`. Microcopy nuevo (es-CO). Las fotos y sus horas NO
 * viven aquí: las escribe `scripts/build-galeria.py` en `src/design/galeria.ts`,
 * en el orden real de la jornada.
 */
export const GALERIA_INTRO =
  'Así se vivió la primera edición del foro. Recorre el abanico en el orden en que transcurrió la jornada del registro de la mañana al cierre de la tarde o abre cualquier fotografía a pantalla completa desde la rejilla.'

/**
 * La sección «Descargar contenido» de /galeria. El texto es microcopy nuevo
 * (es-CO); los pesos y conteos que acompañan a cada botón NO viven aquí: los
 * anuncia el servidor desde el manifiesto del empaquetador
 * (`GET /api/descargas`), y sin esa confirmación los botones quedan retenidos
 * con DESCARGAS_AVISO.
 */
export const DESCARGAS_INTRO =
  'Llévate el foro contigo: las fotografías originales de la jornada y las presentaciones que compartieron los ponentes, cada una en un solo archivo comprimido.'

export const DESCARGAS_AVISO = 'Este paquete estará disponible muy pronto.'

// ---------------------------------------------------------------------- helpers

// La clave se declara `string` a propósito: `PONENTES` es `as const`, así que
// el Map inferiría la unión de slugs literales y no aceptaría el slug que llega
// de la URL, que es un string cualquiera. Ese es justo el caso a resolver aquí.
const POR_SLUG: Map<string, Ponente> = new Map(PONENTES.map((p) => [p.slug, p as Ponente]))

export function ponentePorSlug(slug: string): Ponente | undefined {
  return POR_SLUG.get(slug)
}

/** Iniciales para el monograma: primera letra del nombre y del primer apellido. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase()
}

/** «08:30» → { hora: '8:30', meridiano: 'a.m.' }, como el chip de dos líneas de la pieza. */
export function formatoHora(hhmm: string): { hora: string; meridiano: 'a.m.' | 'p.m.' } {
  const [h, m] = hhmm.split(':').map(Number)
  const meridiano = h >= 12 ? 'p.m.' : 'a.m.'
  const hora12 = h % 12 === 0 ? 12 : h % 12
  return { hora: `${hora12}:${String(m).padStart(2, '0')}`, meridiano }
}

/** «08:30» → 510. Minutos desde medianoche, para medir duraciones. */
export function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Ancla del bloque dentro del programa. La usan la línea del día, la agenda
 *  y los perfiles, así que vive con los datos y no en un componente. */
export function anclaDe(bloque: Bloque): string {
  return `bloque-${bloque.inicio.replace(':', '')}`
}

/**
 * Identidad del retrato de una persona entre una página y la siguiente: es lo
 * que hace que la caja pequeña del listado se convierta en el retrato grande
 * del perfil en vez de aparecer de la nada.
 *
 * Vive aquí por el mismo motivo que `anclaDe`: la componen dos componentes
 * distintos y tienen que coincidir carácter a carácter.
 *
 * ⚠ Un `view-transition-name` debe ser ÚNICO en el documento. Si dos elementos
 * visibles lo comparten, el navegador descarta la transición entera. Por eso
 * la agendadonde la misma persona puede salir dos veces no lo declara: en
 * la home solo lo lleva la fila del listado, que sale una vez por persona.
 */
export function transicionRetrato(slug: string): string {
  return `retrato-${slug}`
}

/** Los extremos de la jornada, derivados de la agenda y no escritos a mano. */
export const JORNADA = {
  abre: minutos(AGENDA[0].inicio),
  cierra: minutos(AGENDA[AGENDA.length - 1].fin),
  get total() {
    return this.cierra - this.abre
  },
}

/** Un descanso de esta duración o más parte el día en dos; por debajo, no. */
const CORTE_MINIMO = 60

/**
 * La jornada partida en mañana y tarde: «8:30 a.m. – 12:00 p.m.» y «2:30 p.m.
 * – 4:30 p.m.». Decir solo los extremos («8:30 a.m. – 4:30 p.m.») anunciaba
 * ocho horas seguidas y se comía las dos y media de almuerzo libre.
 *
 * Sale de la agenda y no está escrita a mano, igual que `JORNADA`: el corte es
 * el bloque logístico más largo del día hoy «Almuerzo Libre», 2 h 30, frente a
 * los 20 min de los dos coffee breaks, así que si el programa se reordena o el
 * almuerzo se mueve, los dos tramos se mueven con él.
 *
 * Si algún día no hubiera un descanso largo, queda un solo tramo: la jornada
 * entera. Es el resultado correcto, no un caso a evitar.
 */
export const TRAMOS: { inicio: string; fin: string }[] = (() => {
  const entero = { inicio: AGENDA[0].inicio, fin: AGENDA[AGENDA.length - 1].fin }
  const dura = (b: Bloque) => minutos(b.fin) - minutos(b.inicio)

  const corte = AGENDA.filter((b) => b.tipo === 'logistico' && dura(b) >= CORTE_MINIMO).sort(
    (a, b) => dura(b) - dura(a),
  )[0]

  return corte
    ? [
        { inicio: entero.inicio, fin: corte.inicio },
        { inicio: corte.fin, fin: entero.fin },
      ]
    : [entero]
})()

/** Papel de una persona dentro de un bloque concreto. */
export type Intervencion = {
  bloque: Bloque
  papel: 'ponente' | 'moderador' | 'panelista' | 'a cargo'
}

/**
 * Cómo se nombra cada papel en la interfaz. Vive aquí, pegado al tipo, porque
 * `Record<Intervencion['papel'], string>` obliga a actualizarlo si el día de
 * mañana aparece un papel nuevo: cuando estaba suelto en la página de perfil,
 * un papel sin etiqueta salía crudo por un `?? papel` de respaldo.
 *
 * Las cuatro etiquetas son neutras a propósito. «Modera»el verbo, que además
 * es el rótulo que ya usa la agenda evita tener que deducir el género de la
 * persona a partir de su nombre para elegir entre «moderador» y «moderadora».
 */
export const ETIQUETA_PAPEL: Record<Intervencion['papel'], string> = {
  ponente: 'Ponente',
  moderador: 'Modera',
  panelista: 'Panelista',
  'a cargo': 'A cargo',
}

/**
 * Recorre la agenda y devuelve todo lo que hace una persona.
 * Es la única forma de saberlo: no existe una lista de intervenciones aparte.
 */
export function intervencionesDe(slug: string): Intervencion[] {
  const out: Intervencion[] = []
  for (const bloque of AGENDA) {
    switch (bloque.tipo) {
      case 'ponencia':
        if (bloque.ponente === slug) out.push({ bloque, papel: 'ponente' })
        break
      case 'hito':
        if (bloque.ponente === slug) out.push({ bloque, papel: 'a cargo' })
        break
      case 'panel':
        if (bloque.moderador === slug) out.push({ bloque, papel: 'moderador' })
        else if ((bloque.panelistas as readonly string[]).includes(slug)) {
          out.push({ bloque, papel: 'panelista' })
        }
        break
    }
  }
  return out
}

/**
 * Quienes no llevan línea de resumen en el índice de ponentes.
 *
 * La presidencia abre y cierra: eso es protocolo, no programa, y «A cargo 9:00
 * a.m. y 4:10 p.m.» lo listaba como si fuera una intervención más. Sin la línea
 * quedan el nombre y el cargo, que es lo que dice de qué va.
 *
 * Va por slug y no por papel a propósito. Filtrar «a cargo» sería hoy lo mismo
 * solo Erick tiene hitos con ponente pero mañana escondería sin avisar a
 * quien herede el papel. La excepción es exactamente la que se pidió, y el
 * `satisfies` la ata a un slug que exista: una errata no compila.
 */
const SIN_RESUMEN = ['erick-wehdeking-arcieri'] as const satisfies readonly PonenteSlug[]

/**
 * Una línea con lo que hace una persona y a qué hora: «Ponente 9:20 a.m. ·
 * Panelista 11:20 a.m.». Es lo que convierte el índice de ponentes en un
 * índice del programa y no en un directorio de nombres.
 *
 * Los papeles repetidos se agrupan en vez de repetirse: quien abre y cierra la
 * jornada sale como «A cargo 9:00 a.m. y 4:10 p.m.», no dos veces «A cargo».
 *
 * Devuelve `''` para quien esté en `SIN_RESUMEN` y también para quien no
 * aparezca en la agenda, así que quien la pinte tiene que contar con la cadena
 * vacía y no envolverla a ciegas en su etiqueta.
 *
 * Vive aquí y no en el componente porque se compone de tres piezas que ya
 * están en este archivo, y porque así no hay una segunda forma de decir lo
 * mismo esperando a divergir.
 */
export function resumenDe(slug: string): string {
  if ((SIN_RESUMEN as readonly string[]).includes(slug)) return ''

  const grupos = new Map<Intervencion['papel'], string[]>()

  for (const { bloque, papel } of intervencionesDe(slug)) {
    const { hora, meridiano } = formatoHora(bloque.inicio)
    const horas = grupos.get(papel)
    if (horas) horas.push(`${hora} ${meridiano}`)
    else grupos.set(papel, [`${hora} ${meridiano}`])
  }

  return [...grupos]
    .map(([papel, horas]) => {
      const ultima = horas[horas.length - 1]
      const lista = horas.length > 1 ? `${horas.slice(0, -1).join(', ')} y ${ultima}` : ultima
      return `${ETIQUETA_PAPEL[papel]} ${lista}`
    })
    .join(' · ')
}
