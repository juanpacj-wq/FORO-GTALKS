import { useState } from 'react'
import { Link } from 'react-router-dom'
import AgendaTimeline from '../components/AgendaTimeline'
import ArcDivider from '../components/ArcDivider'
import LineaDelDia from '../components/LineaDelDia'
import Icono from '../components/Icono'
import Parrafos from '../components/Parrafos'
import PhotoFrame from '../components/PhotoFrame'
import SectionTitle from '../components/SectionTitle'
import SpeakerCard from '../components/SpeakerCard'
import {
  AGENDA,
  BIENVENIDA,
  EVENTO,
  LLAMADO,
  PONENTES,
  SOBRE_EL_FORO,
  formatoHora,
} from '../data/foro'
import './InicioPage.css'

/** «8:30 a.m. – 4:30 p.m.», sacado de la agenda y no escrito a mano. */
function jornada() {
  const abre = formatoHora(AGENDA[0].inicio)
  const cierra = formatoHora(AGENDA[AGENDA.length - 1].fin)
  return `${abre.hora} ${abre.meridiano} – ${cierra.hora} ${cierra.meridiano}`
}

const FICHA = [
  { rotulo: 'Fecha', valor: EVENTO.fecha.texto },
  { rotulo: 'Sede', valor: EVENTO.lugar },
  { rotulo: 'Jornada', valor: jornada() },
]

export default function InicioPage() {
  /* La línea del día y el programa son dos vistas del mismo dato: señalar un
     bloque en cualquiera de las dos lo marca en la otra. El estado vive aquí
     porque es lo único que comparten. */
  const [bloqueActivo, setBloqueActivo] = useState<string | null>(null)

  return (
    <>
      {/* ---------------------------------------------------------- bienvenida */}
      <section id="bienvenida" className="gt-hero gt-grano">
        <div className="gt-hero__grid">
          <div className="gt-hero__texto">
            <h1 className="gt-hero__titulo">
              <Icono
                nombre="numeral-uno"
                className="gt-hero__numeral"
                alto="2.85em"
                titulo="1°"
              />
              <span className="gt-hero__palabras">
                <span className="gt-hero__linea">Foro:</span>
                <span className="gt-hero__linea">Energía</span>
                <span className="gt-hero__linea gt-hero__acento">en Acción</span>
              </span>
            </h1>

            <p className="gt-hero__bajada">{EVENTO.bajada}</p>

            <p className="gt-hero__intro">{BIENVENIDA[0][0] as string}</p>

            <dl className="gt-ficha">
              {FICHA.map(({ rotulo, valor }) => (
                <div className="gt-ficha__item" key={rotulo}>
                  <dt className="gt-dato gt-ficha__rotulo">{rotulo}</dt>
                  <dd className="gt-ficha__valor">{valor}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="gt-hero__media">
            <PhotoFrame
              className="gt-hero__foto gt-marco--paralaje"
              src="/img/hero-aerogeneradores.webp"
              srcSet="/img/hero-aerogeneradores.webp 1x, /img/hero-aerogeneradores@2x.webp 2x"
              alt="Parque de aerogeneradores sobre una planta de paneles solares, con un operario revisando una tableta."
              variante="izq"
              ratio="4 / 5"
              prioridad
            />
            <span className="gt-hero__sello" aria-hidden="true">
              <Icono nombre="icono-burbujas" alto="1.9rem" />
              <Icono nombre="wordmark-g-talks" alto="0.75rem" />
            </span>
          </div>
        </div>

        <ArcDivider
          className="gt-hero__arco"
          color="var(--gt-celeste)"
          alto="clamp(2.5rem, 7vw, 5.5rem)"
        />
      </section>

      {/* ---------------------------------------------------------- manifiesto */}
      <section className="gt-manifiesto">
        <div className="gt-contenedor gt-manifiesto__grid">
          <p className="gt-manifiesto__texto">
            {BIENVENIDA[1].map((f) => (typeof f === 'string' ? f : f.fuerte)).join('')}
          </p>

          {/* La marca cierra la frase en el extremo opuesto, tono sobre tono:
              es lo que compone la banda en vez de dejarla a medio llenar. */}
          <span className="gt-manifiesto__marca" aria-hidden="true">
            <Icono nombre="icono-burbujas" alto="2.4rem" />
            <Icono nombre="wordmark-g-talks" alto="1.05rem" />
          </span>
        </div>
        <ArcDivider color="var(--gt-blanco)" alto="clamp(2.5rem, 7vw, 5.5rem)" />
      </section>

      {/* ------------------------------------------------------- sobre el foro */}
      <section id="sobre-el-foro" className="gt-lamina gt-sobre">
        <div className="gt-contenedor">
          <SectionTitle>Sobre el foro</SectionTitle>

          <div className="gt-sobre__grid">
            <div className="gt-sobre__texto">
              <Parrafos contenido={SOBRE_EL_FORO} className="gt-sobre__parrafo" />

              <aside className="gt-llamado">
                <p className="gt-llamado__texto">
                  {LLAMADO.map((f, i) =>
                    typeof f === 'string' ? f : <strong key={i}>{f.fuerte}</strong>,
                  )}
                </p>
              </aside>
            </div>

            <div className="gt-sobre__media">
              {/* Sin paralaje: esta foto es sticky y el progreso de su vista
                  se congela mientras está fijada. */}
              <PhotoFrame
                className="gt-sobre__foto"
                src="/img/torre-transmision.webp"
                srcSet="/img/torre-transmision.webp 1x, /img/torre-transmision@2x.webp 2x"
                alt="Torre de transmisión eléctrica recortada contra el cielo al atardecer."
                variante="der"
                ratio="3 / 4"
                contorno="var(--gt-celeste)"
              />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- agenda */}
      <section id="agenda" className="gt-agenda-seccion gt-grano">
        <div className="gt-contenedor">
          <SectionTitle apunte={jornada()}>Agenda Académica</SectionTitle>
          <LineaDelDia activo={bloqueActivo} onActivo={setBloqueActivo} />
          <div className="gt-agenda__envoltorio gt-lamina">
            {/* Cabecera de la lámina: la convierte en un documento —el programa
                impreso del día— y no en una lista suelta sobre un rectángulo. */}
            <div className="gt-agenda__cabecera">
              <p className="gt-dato">Programa</p>
              <p className="gt-agenda__cabecera-dato">
                {EVENTO.fecha.texto} · {EVENTO.lugar}
              </p>
            </div>
            <AgendaTimeline activo={bloqueActivo} onActivo={setBloqueActivo} />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- cita */}
      <section className="gt-cita">
        <img
          className="gt-cita__foto"
          src="/img/fichas-conversacion.webp"
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
        <p className="gt-cita__texto">{EVENTO.tagline}</p>
      </section>

      {/* ------------------------------------------------------------ ponentes */}
      <section className="gt-roster gt-grano">
        <div className="gt-contenedor">
          <SectionTitle apunte={`${PONENTES.length} personas`}>Quiénes hablan</SectionTitle>

          <ul className="gt-roster__lista">
            {PONENTES.map((p) => (
              <SpeakerCard key={p.slug} ponente={p} como="h3" />
            ))}
          </ul>

          <Link className="gt-boton" to="/ponentes" viewTransition>
            Ver los perfiles y sus intervenciones
          </Link>
        </div>
      </section>
    </>
  )
}
