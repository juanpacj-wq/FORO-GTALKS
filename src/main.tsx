import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'

// El orden importa: las fuentes y los tokens tienen que existir antes de que
// base.css los use.
import './design/fonts.css'
import './design/tokens.css'
import './design/base.css'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
