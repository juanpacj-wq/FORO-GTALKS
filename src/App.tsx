import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import InicioPage from './pages/InicioPage'
import PonentesPage from './pages/PonentesPage'
import PonentePerfilPage from './pages/PonentePerfilPage'
import EscarapelaPage from './pages/EscarapelaPage'
import EncuestasPage from './pages/EncuestasPage'
import CertificadoPage from './pages/CertificadoPage'
import GaleriaPage from './pages/GaleriaPage'
import CartaPresentacionPage from './pages/CartaPresentacionPage'
import CdpAdminPage from './pages/CdpAdminPage'

export default function App() {
  return (
    <Routes>
      {/* La carta de presentación pública va FUERA del chasis del foro: sin header, sin footer
          y sin navegación a otras secciones. Solo la carta, como en la app anterior. */}
      <Route path="/carta_presentacion/:id" element={<CartaPresentacionPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<InicioPage />} />
        <Route path="/ponentes" element={<PonentesPage />} />
        <Route path="/ponentes/:slug" element={<PonentePerfilPage />} />
        <Route path="/escarapela" element={<EscarapelaPage />} />
        <Route path="/encuestas" element={<EncuestasPage />} />
        <Route path="/certificado" element={<CertificadoPage />} />
        <Route path="/galeria" element={<GaleriaPage />} />
        {/* La carta de presentación digital: la tarjeta pública (llega por QR o enlace) y su
            panel. Van ANTES del comodín: la tarjeta pinta su propio «no disponible» en su
            URL, no redirige a la home. */}
        <Route path="/cdpadmin" element={<CdpAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
