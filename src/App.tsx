import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import InicioPage from './pages/InicioPage'
import PonentesPage from './pages/PonentesPage'
import PonentePerfilPage from './pages/PonentePerfilPage'
import EscarapelaPage from './pages/EscarapelaPage'
import EncuestasPage from './pages/EncuestasPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<InicioPage />} />
        <Route path="/ponentes" element={<PonentesPage />} />
        <Route path="/ponentes/:slug" element={<PonentePerfilPage />} />
        <Route path="/escarapela" element={<EscarapelaPage />} />
        <Route path="/encuestas" element={<EncuestasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
