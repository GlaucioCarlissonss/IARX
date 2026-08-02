import { api } from '../../dados/api'
import { cnpjValido, formatarCnpj } from '../../dados/comandos'
import { useFormulario } from '../../lib/useFormulario'
import { useToast } from '../../lib/contexto'
import { Botao, Entrada, Selecao } from '../ui/primitivos'
import { Dialogo } from '../ui/Dialogo'
import { LinhaCampos, ResumoErros } from '../ui/formulario'
import type { Cliente } from '../../dados/tipos'

/**
 * Cadastro de cliente corporativo.
 *
 * O CNPJ é validado pelos dois dígitos verificadores, não pelo comprimento. Um
 * dígito trocado passa por qualquer máscara e só aparece quando a nota fiscal é
 * rejeitada pela SEFAZ — semanas depois, com a cobrança já emitida.
 *
 * A máscara é aplicada durante a digitação, mas o valor comparado é sempre o
 * numérico: cadastrar o mesmo CNPJ com e sem pontuação criaria dois clientes
 * para a mesma empresa, cada um com metade dos contratos.
 */

interface Props {
  aoFechar: () => void
  aoCriar?: (cliente: Cliente) => void
}

interface Valores extends Record<string, unknown> {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  segmento: string
  filialId: string
  contatoNome: string
  contatoEmail: string
  contatoTelefone: string
}

const ROTULOS = {
  cnpj: 'CNPJ',
  razaoSocial: 'Razão social',
  nomeFantasia: 'Nome fantasia',
  segmento: 'Segmento',
  filialId: 'Filial de atendimento',
  contatoNome: 'Nome do contato',
  contatoEmail: 'E-mail do contato',
  contatoTelefone: 'Telefone do contato',
}

const SEGMENTOS = [
  'Indústria',
  'Varejo',
  'Serviços',
  'Saúde',
  'Educação',
  'Logística',
  'Construção',
  'Setor público',
  'Tecnologia',
  'Financeiro',
]

export function FormCliente({ aoFechar, aoCriar }: Props) {
  const base = api.baseSincrona()
  const { avisar } = useToast()

  const form = useFormulario<Valores, Cliente>({
    inicial: {
      cnpj: '',
      razaoSocial: '',
      nomeFantasia: '',
      segmento: SEGMENTOS[0]!,
      filialId: base.filiais[0]?.id ?? '',
      contatoNome: '',
      contatoEmail: '',
      contatoTelefone: '',
    },
    validar: (v) => {
      const numeros = v.cnpj.replace(/\D/g, '')
      return {
        cnpj: !numeros
          ? 'Informe o CNPJ.'
          : numeros.length !== 14
            ? `CNPJ tem 14 dígitos; foram informados ${numeros.length}.`
            : !cnpjValido(numeros)
              ? 'Os dígitos verificadores não conferem — confira se algum número foi trocado.'
              : undefined,
        razaoSocial: v.razaoSocial.trim().length >= 3 ? undefined : 'Informe a razão social.',
        contatoNome: v.contatoNome.trim().length >= 3 ? undefined : 'Informe o nome do contato.',
        contatoEmail: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contatoEmail.trim())
          ? undefined
          : 'Informe um e-mail válido — é por onde a fatura é enviada.',
        contatoTelefone:
          v.contatoTelefone.replace(/\D/g, '').length >= 10
            ? undefined
            : 'Informe o telefone com DDD.',
      }
    },
    aoEnviar: (v) => api.criarCliente(v),
    aoConcluir: (c) => {
      avisar({ tom: 'ok', titulo: `${c.nomeFantasia} cadastrado`, texto: `${c.cnpj} · crédito liberado` })
      aoCriar?.(c)
      aoFechar()
    },
  })

  const numeros = form.valores.cnpj.replace(/\D/g, '')
  const cnpjOk = numeros.length === 14 && cnpjValido(numeros)

  return (
    <Dialogo
      titulo="Novo cliente"
      descricao="O cliente nasce com crédito liberado. A situação de crédito é alterada na ficha, com motivo registrado."
      aoFechar={aoFechar}
      largura="medio"
      acoes={
        <>
          <Botao onClick={aoFechar} disabled={form.enviando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => form.enviar()} disabled={form.enviando}>
            {form.enviando ? 'Cadastrando…' : 'Cadastrar cliente'}
          </Botao>
        </>
      }
    >
      <form className="pilha g4" onSubmit={form.enviar} noValidate>
        <ResumoErros erros={form.errosResumo} erroGeral={form.erroGeral} rotulos={ROTULOS} refResumo={form.refResumo} />

        <Entrada
          nome="cnpj"
          rotulo="CNPJ"
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          dica={cnpjOk ? '✓ Dígitos verificadores conferem.' : 'Validado pelos dois dígitos verificadores.'}
          value={form.valores.cnpj}
          onChange={(e) => form.definir('cnpj', formatarCnpj(e.target.value))}
          {...form.campo('cnpj')}
        />

        <LinhaCampos>
          <Entrada
            nome="razaoSocial"
            rotulo="Razão social"
            dica="Como consta no cartão CNPJ."
            value={form.valores.razaoSocial}
            onChange={(e) => form.definir('razaoSocial', e.target.value)}
            {...form.campo('razaoSocial')}
          />
          <Entrada
            nome="nomeFantasia"
            rotulo="Nome fantasia"
            dica="Como aparece nas listas. Vazio usa a razão social."
            value={form.valores.nomeFantasia}
            onChange={(e) => form.definir('nomeFantasia', e.target.value)}
            {...form.campo('nomeFantasia')}
          />
        </LinhaCampos>

        <LinhaCampos>
          <Selecao
            nome="segmento"
            rotulo="Segmento"
            opcoes={SEGMENTOS.map((s) => ({ valor: s, texto: s }))}
            value={form.valores.segmento}
            onChange={(e) => form.definir('segmento', e.target.value)}
          />
          <Selecao
            nome="filialId"
            rotulo="Filial de atendimento"
            dica="Define a região e a equipe técnica responsável."
            opcoes={base.filiais.map((f) => ({ valor: f.id, texto: `${f.codigo} — ${f.nome}` }))}
            value={form.valores.filialId}
            onChange={(e) => form.definir('filialId', e.target.value)}
          />
        </LinhaCampos>

        <fieldset className="grupo-opcoes">
          <legend>Contato principal</legend>
          <p className="campo__dica">Quem recebe fatura, aviso de manutenção e pesquisa de atendimento.</p>
          <div className="pilha g3">
            <Entrada
              nome="contatoNome"
              rotulo="Nome"
              value={form.valores.contatoNome}
              onChange={(e) => form.definir('contatoNome', e.target.value)}
              {...form.campo('contatoNome')}
            />
            <LinhaCampos>
              <Entrada
                nome="contatoEmail"
                rotulo="E-mail"
                type="email"
                inputMode="email"
                value={form.valores.contatoEmail}
                onChange={(e) => form.definir('contatoEmail', e.target.value)}
                {...form.campo('contatoEmail')}
              />
              <Entrada
                nome="contatoTelefone"
                rotulo="Telefone"
                type="tel"
                inputMode="tel"
                placeholder="(11) 90000-0000"
                value={form.valores.contatoTelefone}
                onChange={(e) => form.definir('contatoTelefone', e.target.value)}
                {...form.campo('contatoTelefone')}
              />
            </LinhaCampos>
          </div>
        </fieldset>
      </form>
    </Dialogo>
  )
}
