import SectionTitle from '../components/SectionTitle'
import SpeakerCard from '../components/SpeakerCard'
import { PONENTES } from '../data/foro'
import './PonentesPage.css'

export default function PonentesPage() {
  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1" apunte={`${PONENTES.length} personas`}>
          Ponentes
        </SectionTitle>

        <p className="gt-pagina__intro">
          Quienes intervienen en el foro, en el orden en que aparecen en la agenda. Entra a cada
          perfil para ver en qué bloques participa y con qué papel.
        </p>

        <ul className="gt-ponentes__lista">
          {PONENTES.map((p) => (
            <SpeakerCard key={p.slug} ponente={p} />
          ))}
        </ul>
      </div>
    </section>
  )
}
