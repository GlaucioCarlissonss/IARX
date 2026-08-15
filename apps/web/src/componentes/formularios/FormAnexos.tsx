import { useEffect, useState } from 'react'
import { api } from '../../dados/api'
import { CATEGORIAS_ANEXO, formatarBytes, LIMITE_TOTAL_BYTES, ROTULO_CATEGORIA } from '../../dados/comandos'
import { baixar } from '../../lib/baixar'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { data } from '../../lib/formato'
import { Botao, Chip, Entrada, Selecao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { CampoArquivos } from '../ui/CampoArquivos'
import { LinhaCampos, ResumoErros } from '../ui/formulario'
import { Rolagem } from '../ui/Rolagem'
import type { Anexo, CategoriaAnexo, EntidadeAnexo } from '../../dados/tipos'

/**
 * Documentos de um contrato ou cliente.
 *
 * Lista e envio no mesmo diálogo, e não em telas separadas: quem abre "anexos"
 * quase sempre quer conferir o que já existe **antes** de decidir o que enviar
 * — é assim que se evita a terceira cópia do mesmo contrato social.
 *
 * O download é sempre um salvamento, nunca navegação para o arquivo — seja pelo
 * atributo `download` no navegador comum, seja pelo salvamento mediado do
 * visualizador de artefato (ver `lib/baixar`). É o que torna seguro aceitar
 * qualquer tipo: um `.html` anexado baixa em vez de executar no contexto da
 * aplicação, e nenhum dos dois caminhos abre o conteúdo.
 */

interface Props {
  entidade: EntidadeAnexo
  entidadeId: string
  /** Nome exibido no título — número do contrato ou nome do cliente. */
  titulo: string
  aoFechar: () => void
}

interface Valores extends Record<string, unknown> {
  arquivos: File[]
  categoria: CategoriaAnexo
  descricao: string
}

export function FormAnexos({ entidade, entidadeId, titulo, aoFechar }: Props) {
  const { avisar } = useToast()
  const categorias = CATEGORIAS_ANEXO[entidade]
  const [lista, setLista] = useState<Anexo[]>(() => api.baseSincrona().anexos.filter(
    (a) => a.entidade === entidade && a.entidadeId === entidadeId,
  ))
  const [removendo, setRemovendo] = useState<Anexo | null>(null)
  const [motivoRemocao, setMotivoRemocao] = useState('')
  const [erroRemocao, setErroRemocao] = useState<string | null>(null)

  function recarregar() {
    void api.anexos(entidade, entidadeId).then(setLista)
  }

  useEffect(recarregar, [entidade, entidadeId])

  const form = useFormulario<Valores, Anexo[]>({
    inicial: { arquivos: [], categoria: categorias[0]!.valor, descricao: '' },
    validar: (v) => ({
      arquivos: v.arquivos.length === 0 ? 'Escolha ao menos um arquivo para enviar.' : undefined,
    }),
    aoEnviar: (v) =>
      api.anexarArquivos(
        entidade,
        entidadeId,
        v.arquivos.map((arquivo) => ({ arquivo, categoria: v.categoria, descricao: v.descricao })),
      ),
    aoConcluir: (criados) => {
      avisar({
        tom: 'ok',
        titulo: criados.length === 1 ? `“${criados[0]!.nome}” anexado` : `${criados.length} arquivos anexados`,
        texto: `${ROTULO_CATEGORIA[criados[0]!.categoria]} · ${titulo}`,
      })
      // O diálogo permanece aberto: anexar documentos é atividade em lote, e
      // fechar depois do primeiro obrigaria a reabrir para cada arquivo.
      form.redefinir({ categoria: form.valores.categoria })
      recarregar()
    },
  })

  async function confirmarRemocao() {
    if (!removendo) return
    const r = await api.removerAnexo(removendo.id, motivoRemocao)
    if (!r.ok) {
      setErroRemocao(r.erro.mensagem)
      return
    }
    avisar({ tom: 'atencao', titulo: `“${removendo.nome}” removido`, texto: motivoRemocao.trim() })
    setRemovendo(null)
    setMotivoRemocao('')
    setErroRemocao(null)
    recarregar()
  }

  const total = lista.reduce((s, a) => s + a.tamanhoBytes, 0)

  return (
    <Dialogo
      titulo={`Anexos · ${titulo}`}
      descricao="Qualquer tipo de arquivo. O download é sempre baixado, nunca aberto na aplicação."
      aoFechar={aoFechar}
      largura="largo"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Fechar
          </Botao>
          <Botao
            variante="primario"
            onClick={() => form.enviar()}
            disabled={form.enviando || form.valores.arquivos.length === 0}
            motivoDesabilitado="Escolha ao menos um arquivo"
          >
            {form.enviando
              ? 'Enviando…'
              : form.valores.arquivos.length > 1
                ? `Anexar ${form.valores.arquivos.length} arquivos`
                : 'Anexar arquivo'}
          </Botao>
        </>
      }
    >
      <div className="pilha g5">
        {/* ------------------------------------------------------ existentes */}
        <section aria-label="Documentos já anexados" className="pilha g3">
          <div className="linha entre base envolver g3">
            <h3>Documentos anexados</h3>
            <span className="texto-atenuado">
              {lista.length === 0
                ? 'nenhum'
                : `${lista.length} arquivo(s) · ${formatarBytes(total)} de ${formatarBytes(LIMITE_TOTAL_BYTES)}`}
            </span>
          </div>

          {lista.length === 0 ? (
            <p className="texto-secundario">
              Nenhum documento anexado ainda. Use o formulário abaixo para enviar o primeiro.
            </p>
          ) : (
            <Rolagem rotulo="Tabela de dados">
              <table>
                <caption className="so-leitor">Documentos anexados a {titulo}</caption>
                <thead>
                  <tr>
                    <th scope="col">Arquivo</th>
                    <th scope="col">Classificação</th>
                    <th scope="col" className="numerico">
                      Tamanho
                    </th>
                    <th scope="col">Enviado</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">
                        {a.nome}
                        {a.descricao && (
                          <>
                            <br />
                            <span className="texto-atenuado">{a.descricao}</span>
                          </>
                        )}
                      </th>
                      <td>
                        <Chip severidade={a.categoria === 'OUTRO' ? 'inativo' : 'uso'}>
                          {ROTULO_CATEGORIA[a.categoria]}
                        </Chip>
                      </td>
                      <td className="numerico dado">{formatarBytes(a.tamanhoBytes)}</td>
                      <td>
                        {data(a.enviadoEm)}
                        <br />
                        <span className="texto-atenuado">{a.enviadoPor}</span>
                      </td>
                      <td>
                        <div className="linha g2 envolver">
                          <BotaoBaixar anexo={a} />
                          <Botao
                            variante="sutil"
                            pequeno
                            onClick={() => {
                              setRemovendo(a)
                              setMotivoRemocao('')
                              setErroRemocao(null)
                            }}
                          >
                            Remover<span className="so-leitor"> {a.nome}</span>
                          </Botao>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Rolagem>
          )}
        </section>

        {/* ------------------------------------------------- remoção em curso */}
        {removendo && (
          <div className="aviso aviso--critico" role="alertdialog" aria-label={`Remover ${removendo.nome}`}>
            <span aria-hidden="true">⛔</span>
            <div className="crescer pilha g3">
              <p className="aviso__titulo">Remover “{removendo.nome}”?</p>
              <p>Documento de contrato removido não volta. O motivo fica na trilha de auditoria.</p>
              <Entrada
                nome="motivoRemocao"
                rotulo="Motivo da remoção"
                erro={erroRemocao ?? undefined}
                value={motivoRemocao}
                onChange={(e) => setMotivoRemocao(e.target.value)}
              />
              <div className="linha g2">
                <Botao onClick={() => setRemovendo(null)}>Cancelar</Botao>
                <Botao variante="perigo" onClick={confirmarRemocao}>
                  Remover definitivamente
                </Botao>
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- envio */}
        <section aria-label="Enviar novos documentos" className="pilha g4">
          <h3>Enviar documentos</h3>

          <ResumoErros
            erros={form.errosResumo}
            erroGeral={form.erroGeral}
            rotulos={{ arquivos: 'Arquivos' }}
            refResumo={form.refResumo}
          />

          {/* Classificação antes dos arquivos: ela vale para o lote inteiro, e
              depois da lista de selecionados ficaria abaixo da dobra do
              diálogo — o operador enviaria tudo como "Outro documento" sem
              nunca ter visto o campo. */}
          <LinhaCampos>
            <Selecao
              nome="categoria"
              rotulo="Classificação"
              dica="Aplicada a todos os arquivos deste envio."
              opcoes={categorias.map((c) => ({ valor: c.valor, texto: c.texto }))}
              value={form.valores.categoria}
              onChange={(e) => form.definir('categoria', e.target.value as CategoriaAnexo)}
            />
            <Entrada
              nome="descricao"
              rotulo="Descrição (opcional)"
              dica="Ex.: “versão assinada pelas duas partes”."
              value={form.valores.descricao}
              onChange={(e) => form.definir('descricao', e.target.value)}
            />
          </LinhaCampos>

          <CampoArquivos
            nome="arquivos"
            rotulo="Arquivos"
            arquivos={form.valores.arquivos}
            aoMudar={(a) => form.definir('arquivos', a)}
            jaExistentes={lista.map((a) => a.nome)}
            disabled={form.enviando}
            {...form.campo('arquivos')}
          />
        </section>
      </div>
    </Dialogo>
  )
}

/**
 * Baixar o anexo.
 *
 * A entrega em si vive em `lib/baixar`, que escolhe entre o caminho nativo do
 * navegador e o do visualizador de artefato — onde download iniciado pela
 * própria página simplesmente não acontece, sem erro. O que fica aqui é a parte
 * que só esta tela sabe: mostrar ao usuário o que aconteceu, ao lado do arquivo
 * que ele tentou baixar.
 *
 * Anexo aceita qualquer tipo, e o visualizador não: um PDF é recusado lá. Por
 * isso a recusa vira frase, e não um clique sem efeito.
 */
function BotaoBaixar({ anexo }: { anexo: Anexo }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const conteudo = anexo.conteudo

  if (!conteudo) {
    return (
      <Botao
        pequeno
        disabled
        motivoDesabilitado="Documento da massa de demonstração: só metadados, sem conteúdo real"
      >
        Baixar<span className="so-leitor"> {anexo.nome} — indisponível</span>
      </Botao>
    )
  }

  return (
    <div className="pilha g1">
      <Botao
        pequeno
        onClick={async () => {
          setAviso(null)
          const r = await baixar(anexo.nome, conteudo)
          // Cancelamento não vira mensagem: foi decisão do usuário.
          if (r.situacao !== 'cancelado') setAviso(r.aviso ?? null)
        }}
      >
        Baixar<span className="so-leitor"> {anexo.nome}</span>
      </Botao>
      {aviso && (
        <p className="texto-atenuado" role="status">
          {aviso}
        </p>
      )}
    </div>
  )
}
