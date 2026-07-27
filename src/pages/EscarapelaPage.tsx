import Placeholder from '../components/Placeholder'
import SectionTitle from '../components/SectionTitle'
import './PonentesPage.css'

/**
 * TODO(usuario): construir aquí la escarapela del asistente.
 *
 * No hace falta backend nuevo: `server/app.js` ya expone `GET /api/me`, que
 * devuelve `{ authenticated, user: { nombre_completo, upn, email, oid, roles } }`
 * a partir de la sesión de Microsoft Entra ID. Con eso se puede personalizar la
 * escarapela con el nombre de quien entró, sin pedirle nada.
 *
 * El sistema de diseño ya tiene lo que hace falta para maquetarla: `Monogram`
 * para el avatar, `PhotoFrame` para el marco de radio asimétrico y los tokens
 * de color en `src/design/tokens.css`.
 */
export default function EscarapelaPage() {
  return (
    <section className="gt-pagina gt-grano">
      <div className="gt-contenedor">
        <SectionTitle como="h1">Escarapela</SectionTitle>

        <p className="gt-pagina__intro">
          Tu escarapela para el día del foro, con tu nombre y tu cargo ya puestos. No vas a tener
          que escribir nada: los datos salen de la cuenta con la que entraste.
        </p>

        <Placeholder
          titulo="Todavía la estamos preparando"
          estado="Antes del 5 de agosto"
          pasos={[
            'Entras con tu cuenta de GECELCA. Ya lo hiciste para ver esta página.',
            'Tu nombre y tu cargo llegan desde el directorio corporativo, sin que los escribas.',
            'Descargas la escarapela lista para imprimir o la muestras desde el celular en el registro de la sede.',
          ]}
        >
          <p>
            Cuando esté lista, este espacio va a mostrarte tu escarapela y el botón para
            descargarla. Si entras antes, no perdiste el viaje: la agenda y los perfiles ya están
            completos.
          </p>
        </Placeholder>
      </div>
    </section>
  )
}
