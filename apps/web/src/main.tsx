import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Idioma do documento (WCAG 3.1.1): sem isso o leitor de tela pronuncia o
// português com fonemas de inglês.
document.documentElement.lang = 'pt-BR'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('elemento #raiz não encontrado')

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
