import Placeholder from '../components/Placeholder'
import SectionTitle from '../components/SectionTitle'
import './PonentesPage.css'

/**
 * TODO(usuario): construir aquí las encuestas del foro.
 *
 * Queda por definir qué se pregunta y dónde se guardan las respuestas: hoy el
 * proyecto no tiene base de datos ni endpoint de escritura, solo el gate de
 * Entra y el servido de estáticos. Si las respuestas tienen que persistir hay
 * que añadir almacenamiento en `server/`.
 *
 * La identidad de quien responde sí está disponible sin trabajo extra, vía
 * `GET /api/me`, si se quiere evitar respuestas duplicadas.
 */
export default function EncuestasPage() {
  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1">Encuestas</SectionTitle>

        <p className="gt-pagina__intro">
          El espacio para calificar las ponencias y los paneles, y dejar lo que quieras decirle a la
          organización.
        </p>

        <Placeholder
          titulo="Se abren el día del foro"
          estado="Miércoles 5 de agosto"
          pasos={[
            'Al terminar cada bloque de la agenda se habilita su encuesta en esta página.',
            'Respondes desde el celular, sin instalar nada y sin volver a iniciar sesión.',
            'Lo que respondas se resume para la organización; no se publica con tu nombre.',
          ]}
        >
          <p>
            Las preguntas todavía las está definiendo la Vicepresidencia de Asuntos Corporativos.
            Cuando estén, aparecen aquí sin que tengas que hacer nada.
          </p>
        </Placeholder>
      </div>
    </section>
  )
}
