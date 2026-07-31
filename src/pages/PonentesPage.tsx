import SectionTitle from '../components/SectionTitle'
import SpeakerCard from '../components/SpeakerCard'
import { PONENTES } from '../data/foro'
import './PonentesPage.css'

export default function PonentesPage() {
  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1" apunte={`${PONENTES.length} personas`}>
          Expertos que impulsan la conversación
        </SectionTitle>

        <p className="gt-pagina__intro">
          Conoce a los líderes y expertos que harán parte del foro. Explora su trayectoria, experiencia y los espacios en los que compartirán su visión sobre los retos y oportunidades del sector energético.
        </p>

        <ul className="gt-ponentes__lista">
          {PONENTES.map((p) => (
            <SpeakerCard key={p.slug} ponente={p} resumen />
          ))}
        </ul>
      </div>
    </section>
  )
}
