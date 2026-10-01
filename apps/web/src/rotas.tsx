import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './componentes/layout/AppShell'
import { useSessao } from './lib/contexto'
import { EstadoVazio } from './componentes/ui/primitivos'
import { Inicio } from './telas/Inicio'
import { Parque } from './telas/Parque'
import { Contratos } from './telas/Contratos'
import { Clientes } from './telas/Clientes'
import { Comercial } from './telas/Comercial'
import { Mapa } from './telas/Mapa'
import { NotasFiscais } from './telas/NotasFiscais'
import { Chamados } from './telas/Chamados'
import { Estoque } from './telas/Estoque'
import { Faturamento } from './telas/Faturamento'
import { Resultado } from './telas/Resultado'
import { Usuarios } from './telas/Usuarios'
import { Perfis } from './telas/Perfis'
import { Entrar } from './telas/Entrar'
import { CentrosCusto } from './telas/CentrosCusto'
import { ContasBancarias } from './telas/ContasBancarias'
import { ContasPagar } from './telas/ContasPagar'
import { ContasReceber } from './telas/ContasReceber'
import { Despesas } from './telas/Despesas'
import { LancamentosFuturos } from './telas/LancamentosFuturos'
import { FluxoCaixa } from './telas/FluxoCaixa'
import { PortalInicio } from './telas/PortalInicio'
import { PortalContratos } from './telas/PortalContratos'
import { PortalParque } from './telas/PortalParque'
import { PortalConsumo } from './telas/PortalConsumo'
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
  const { pode, perfil, escopo } = useSessao()

  /*
   * Audiência antes de permissão, e as duas são necessárias.
   *
   * O Administrador do cliente tem `contrato:ler` e `fatura:ler` — com a
   * verificação só de permissão, ele abriria **sete telas da operação**, entre
   * elas a carteira de clientes com rentabilidade e o faturamento do locador.
   * Permissão responde "pode ler contrato?"; audiência responde "contrato de
   * quem?", e é a segunda pergunta que o prefixo `/portal` separa.
   *
   * É a mesma separação do servidor: `exigirCliente()` recusa o token sem
   * `cliente_id` em `/portal`, e as rotas da operação não se disfarçam de
   * portal. Aqui vale nos dois sentidos pela mesma razão.
   */
  if (escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="Esta área é da operação da locadora"
        texto="O seu acesso é o portal do cliente. Use o menu para voltar ao seu painel, aos contratos e ao consumo."
      />
    )
  }
  if (pode(permissao)) return <>{children}</>
  return (
    <EstadoVazio
      glifo="⛔"
      titulo="Esta área não faz parte do seu perfil"
      texto={`O perfil ${perfil.nome} não tem a permissão ${permissao}. Se precisa acessar, solicite ao administrador da plataforma.`}
    />
  )
}

/**
 * A contraparte: rota do portal exige escopo de cliente.
 *
 * Sem escopo quem chama opera a locadora, e as consultas do portal responderiam
 * com o recorte de ninguém. A recusa é explícita porque o silêncio aqui seria o
 * oposto do que o prefixo promete — que nenhuma tela de cliente alcança dado do
 * locador, e nenhuma tela do locador se disfarça de portal.
 */
function DoCliente({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const { pode, perfil, escopo } = useSessao()
  if (!escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="O portal responde a usuário de cliente"
        texto="Esta sessão é da operação da locadora. As telas equivalentes, sem o recorte, estão no menu principal."
      />
    )
  }
  if (pode(permissao)) return <>{children}</>
  return (
    <EstadoVazio
      glifo="⛔"
      titulo="Esta área não faz parte do seu acesso"
      texto={`O perfil ${perfil.nome} não tem a permissão ${permissao}. Quem administra o acesso da sua empresa pode concedê-la.`}
    />
  )
}

/** O destino de quem entra: o painel da audiência de quem entrou. */
function Raiz() {
  const { escopo } = useSessao()
  return escopo ? <Navigate to="/portal" replace /> : <Inicio />
}

export function Rotas() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Raiz />} />

        {/* Portal do cliente — a segunda audiência. */}
        <Route
          path="portal"
          element={
            <DoCliente permissao="equipamento:ler">
              <PortalInicio />
            </DoCliente>
          }
        />
        <Route
          path="portal/contratos"
          element={
            <DoCliente permissao="contrato:ler">
              <PortalContratos />
            </DoCliente>
          }
        />
        <Route
          path="portal/parque"
          element={
            <DoCliente permissao="equipamento:ler">
              <PortalParque />
            </DoCliente>
          }
        />
        <Route
          path="portal/consumo"
          element={
            <DoCliente permissao="medicao:ler">
              <PortalConsumo />
            </DoCliente>
          }
        />
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
          path="comercial"
          element={
            <Protegida permissao="comercial:ler">
              <Comercial />
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
          path="centros-custo"
          element={
            <Protegida permissao="centro_custo:ler">
              <CentrosCusto />
            </Protegida>
          }
        />
        <Route
          path="contas-bancarias"
          element={
            <Protegida permissao="conta_bancaria:ler">
              <ContasBancarias />
            </Protegida>
          }
        />
        <Route
          path="contas-pagar"
          element={
            <Protegida permissao="pagar:ler">
              <ContasPagar />
            </Protegida>
          }
        />
        <Route
          path="contas-receber"
          element={
            <Protegida permissao="receber:ler">
              <ContasReceber />
            </Protegida>
          }
        />
        <Route
          path="despesas"
          element={
            <Protegida permissao="despesa:ler">
              <Despesas />
            </Protegida>
          }
        />
        <Route
          path="lancamentos-futuros"
          element={
            <Protegida permissao="financeiro:lancamento_manual">
              <LancamentosFuturos />
            </Protegida>
          }
        />
        <Route
          path="fluxo-caixa"
          element={
            <Protegida permissao="financeiro:painel_executivo">
              <FluxoCaixa />
            </Protegida>
          }
        />
        <Route
          path="usuarios"
          element={
            <Protegida permissao="usuario:gerenciar">
              <Usuarios />
            </Protegida>
          }
        />
        <Route
          path="perfis"
          element={
            <Protegida permissao="perfil:gerenciar">
              <Perfis />
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

      {/* Fora do `AppShell`: a tela de entrada não tem menu, nem seletor de
          filial, nem migalha. Pôr o shell em volta dela mostraria a navegação
          de uma sessão que acabou de ser encerrada. */}
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
