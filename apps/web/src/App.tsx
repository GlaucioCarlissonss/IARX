import { HashRouter } from 'react-router-dom'
import { ProvedorSessao, ProvedorToast } from './lib/contexto'
import { Rotas } from './rotas'
import './estilos/global.css'

/**
 * Raiz da aplicação.
 *
 * HashRouter em vez de BrowserRouter: o build é um arquivo único, servido sem
 * servidor que reescreva rotas. Com API real e hospedagem própria, trocar para
 * BrowserRouter é uma linha.
 */
export function App() {
  return (
    <HashRouter>
      <ProvedorSessao>
        <ProvedorToast>
          <Rotas />
        </ProvedorToast>
      </ProvedorSessao>
    </HashRouter>
  )
}
