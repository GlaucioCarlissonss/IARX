import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './componentes/layout/AppShell'
import { useSessao } from './lib/contexto'
import { EstadoVazio } from './componentes/ui/primitivos'
import { Inicio } from './telas/Inicio'
import { Parque } from './telas/Parque'
import { Contratos } from './telas/Contratos'
import { Clientes } from './telas/Clientes'
import { Mapa } from './telas/Mapa'
import { NotasFiscais } from './telas/NotasFiscais'
import { Chamados } from './telas/Chamados'
import { Estoque } from './telas/Estoque'
import { Faturamento } from './telas/Faturamento'
import { Resultado } from './telas/Resultado'
import type { Permissao } from './lib/permissoes'
import type { ReactNode } from 'react'

/**
 * Rotas da aplicação.
 *
 * Cada rota declara a permissão que exige. A verificação aqui é de experiência,
 * não de segurança — o servidor continua sendo a autoridade. O que ela evita é
 * o usuário chegar numa tela que só vai lhe mostrar erro.
 */

function Protegida({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const { pode, perfil } = useSessao()
  if (pode(permissao)) return <>{children}</>
  return (
    <EstadoVazio
      glifo="⛔"
      titulo="Esta área não faz parte do seu perfil"
      texto={`O perfil ${perfil.nome} não tem a permissão ${permissao}. Se precisa acessar, solicite ao administrador da plataforma.`}
    />
  )
}

export function Rotas() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Inicio />} />
        <Route
          path="parque"
          element={
            <Protegida permissao="equipamento:ler">
              <Parque />
            </Protegida>
          }
        />
        <Route
          path="contratos"
          element={
            <Protegida permissao="contrato:ler">
              <Contratos />
            </Protegida>
          }
        />
        <Route
          path="clientes"
          element={
            <Protegida permissao="cliente:ler">
              <Clientes />
            </Protegida>
          }
        />
        <Route
          path="mapa"
          element={
            <Protegida permissao="mapa:ler">
              <Mapa />
            </Protegida>
          }
        />
        <Route
          path="notas-fiscais"
          element={
            <Protegida permissao="nota_fiscal:ler">
              <NotasFiscais />
            </Protegida>
          }
        />
        <Route
          path="chamados"
          element={
            <Protegida permissao="os:ler">
              <Chamados />
            </Protegida>
          }
        />
        <Route
          path="estoque"
          element={
            <Protegida permissao="peca:ler">
              <Estoque />
            </Protegida>
          }
        />
        <Route
          path="faturamento"
          element={
            <Protegida permissao="fatura:ler">
              <Faturamento />
            </Protegida>
          }
        />
        <Route
          path="resultado"
          element={
            <Protegida permissao="financeiro:painel_executivo">
              <Resultado />
            </Protegida>
          }
        />
        <Route
          path="*"
          element={
            <EstadoVazio
              glifo="◍"
              titulo="Página não encontrada"
              texto="O endereço não corresponde a nenhuma tela. Use a busca global para chegar ao que procura."
            />
          }
        />
      </Route>
      <Route path="/index.html" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
