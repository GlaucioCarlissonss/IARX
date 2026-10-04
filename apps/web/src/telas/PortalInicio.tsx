import { Link } from 'react-router-dom'
import { api } from '../dados/api'
import { HOJE, iso } from '../dados/gerar'
import { useConsulta } from '../lib/useConsulta'
import { useSessao } from '../lib/contexto'
import { competenciaLonga, data, inteiro, moeda } from '../lib/formato'
import {
  Aviso,
  Carregando,
  Cartao,
  Chip,
  ErroConsulta,
  EstadoVazio,
  Metrica,
  Skeleton,
} from '../componentes/ui/primitivos'

/**
 * O painel de quem aluga.
 *
 * A ordem da página é a do Anexo L e não é estética: **exceção primeiro**,
 * consolidado depois. Quem abre o portal abre por um motivo — um contrato
 * vencendo, uma fatura em aberto, uma franquia estourada — e um painel que
 * começa pelo total obriga a procurar o motivo embaixo dele.
 *
 * Nada aqui mostra margem, custo de manutenção ou valor de aquisição: as
 * consultas de `dados/portal.ts` não têm esses campos, e a tela não teria de
 * onde tirá-los mesmo se quisesse.
 */
export function PortalInicio() {
  const { escopo, usuario } = useSessao()
  const hoje = iso(HOJE)

  const { situacao, dado, erro, recarregar } = useConsulta(
    () =>
      escopo
        ? Promise.all([
            api.portalResumo(escopo),
            api.portalContratos(escopo),
            api.portalUnidades(escopo),
          ]).then(([resumo, contratos, unidades]) => ({ resumo, contratos, unidades }))
        : Promise.resolve(null),
    [escopo],
  )

  if (!escopo) {
    return (
      <EstadoVazio
        glifo="⛔"
        titulo="O portal responde a usuário de cliente"
        texto="Esta sessão é da operação da locadora. As telas equivalentes, sem o recorte, estão no menu principal."
      />
    )
  }

  if (situacao === 'erro') {
    return (
      <ErroConsulta
        titulo="Não foi possível carregar o seu painel"
        erro={erro}
        aoTentarNovamente={recarregar}
      />
    )
  }

  if (situacao === 'carregando' || !dado) {
    return (
      <Carregando rotulo="Carregando o seu painel">
        <div className="grade grade--metricas">
          <Skeleton linhas={4} altura="48px" />
        </div>
      </Carregando>
    )
  }

  const { resumo, contratos } = dado
  const diasAte = (iso: string) =>
    Math.round((new Date(iso).getTime() - HOJE.getTime()) / 86400000)
  const vencendo = contratos.filter(
    (c) => c.status === 'ATIVO' && c.dataFim >= hoje && diasAte(c.dataFim) <= 90,
  )
  const estourados = resumo.consumoEmAberto.excedente > 0

  return (
    <>
      <div className="pagina__cabeca">
        <div>
          <h1>{resumo.cliente.nomeFantasia}</h1>
          <p className="texto-secundario medida-leitura" style={{ marginTop: 'var(--e1)' }}>
            {/*
              Quem está na sessão. O **escopo** fica na barra, que o mostra em
              toda tela do portal — repeti-lo aqui diria duas vezes a mesma
              coisa na mesma dobra.

              E não diz quantas unidades o grupo tem: a versão anterior
              mostrava "1 de 4" para o gestor de unidade, e aquele 4 vinha de
              uma contagem que o recorte existe justamente para não entregar.
              Saber que há três unidades além da sua é informação do grupo.
            */}
            {usuario.nome}
          </p>
        </div>
      </div>

      {/*
        O recorte dito em voz alta.

        Um gestor que enxerga uma unidade precisa saber que enxerga uma — senão
        lê os números como se fossem os do grupo, e a conclusão errada não tem
        como aparecer. O recorte é da política; o aviso é só para ele não ser
        silencioso.
      */}
      {escopo.locaisIds !== null && (
        <Cartao comoRegiao titulo="Você vê as unidades a que foi vinculado">
          <p className="medida-leitura">
            Os números desta página são das suas{' '}
            {resumo.unidadesNoEscopo === 1 ? 'unidade' : `${resumo.unidadesNoEscopo} unidades`}, e não do grupo.
            Para o consolidado, fale com quem administra o acesso da sua empresa.
          </p>
        </Cartao>
      )}

      {resumo.cobrancaEmAberto.vencido > 0 && (
        <Aviso tom="atencao" titulo={`${moeda(resumo.cobrancaEmAberto.vencido)} em cobrança vencida`}>
          <p className="medida-leitura">
            De {moeda(resumo.cobrancaEmAberto.total)} em aberto. Se já houve pagamento, ele pode ainda não ter
            sido conciliado.
          </p>
        </Aviso>
      )}

      {vencendo.length > 0 && (
        <Aviso tom="atencao" titulo={`${vencendo.length} contrato(s) vencendo em até 90 dias`}>
          <ul>
            {vencendo.map((c) => (
              <li key={c.id}>
                <span className="dado">{c.numero}</span> — vence em {data(c.dataFim)} ({diasAte(c.dataFim)} dias)
              </li>
            ))}
          </ul>
        </Aviso>
      )}

      <div className="grade grade--metricas">
        <Cartao compacto>
          <Metrica
            rotulo="Equipamentos"
            valor={inteiro(resumo.parque.total)}
            contexto={`em ${resumo.unidadesNoEscopo} unidade(s)`}
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Contratos vigentes"
            valor={inteiro(resumo.contratos.ativos)}
            contexto={
              resumo.contratos.proximoVencimento
                ? `próximo vence em ${data(resumo.contratos.proximoVencimento)}`
                : 'sem vencimento próximo'
            }
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Páginas no mês em curso"
            valor={inteiro(resumo.consumoEmAberto.paginas)}
            contexto={
              resumo.consumoEmAberto.competencia
                ? `${competenciaLonga(resumo.consumoEmAberto.competencia)} · parcial`
                : 'sem medição em aberto'
            }
          />
        </Cartao>
        <Cartao compacto>
          <Metrica
            rotulo="Cobrança em aberto"
            valor={moeda(resumo.cobrancaEmAberto.total)}
            contexto={
              resumo.cobrancaEmAberto.vencido > 0
                ? `${moeda(resumo.cobrancaEmAberto.vencido)} vencidos`
                : 'nada vencido'
            }
          />
        </Cartao>
      </div>

      {/*
        RN-L33 na tela, e não só no dado: o número do mês corrente aparece com a
        data da leitura ao lado. O valor parcial não é errado; apresentá-lo como
        fechado é que seria — e o cliente planejaria caixa sobre uma medição que
        ainda vai crescer.
      */}
      {resumo.consumoEmAberto.competencia && (
        <Cartao comoRegiao titulo={`Mês em curso — ${competenciaLonga(resumo.consumoEmAberto.competencia)}`}>
          <p className="medida-leitura">
            <Chip severidade="atencao">Parcial</Chip>{' '}
            {resumo.consumoEmAberto.ultimaLeituraEm
              ? `Última leitura em ${data(resumo.consumoEmAberto.ultimaLeituraEm)}.`
              : 'Ainda sem leitura registrada nesta competência.'}{' '}
            São {inteiro(resumo.consumoEmAberto.paginas)} páginas até aqui
            {estourados
              ? `, com ${moeda(resumo.consumoEmAberto.excedente)} de excedente já apurado.`
              : ', dentro da franquia até o momento.'}{' '}
            O número fecha no fechamento da competência.
          </p>
          <p style={{ marginTop: 'var(--e3)' }}>
            <Link to="/portal/consumo">Ver consumo por equipamento e a memória de cálculo</Link>
          </p>
        </Cartao>
      )}

      <Cartao comoRegiao titulo="Parque por situação">
        <div className="linha g2 envolver">
          {Object.entries(resumo.parque.porStatus)
            .sort((a, z) => z[1] - a[1])
            .map(([status, n]) => (
              <Chip key={status} severidade={status === 'LOCADO' ? 'disponivel' : 'inativo'}>
                {status.toLowerCase().replace(/_/g, ' ')} · {inteiro(n)}
              </Chip>
            ))}
        </div>
      </Cartao>
    </>
  )
}
