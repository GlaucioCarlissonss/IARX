/**
 * Comandos de usuário e perfil.
 *
 * O que estes testes protegem, em uma frase: **o ambiente nunca fica sem
 * administrador**. É a regra que, quando falha, não falha barulhento — o
 * locatário simplesmente descobre que ninguém consegue mais conceder acesso a
 * ninguém, e a única saída é o suporte mexer direto no banco de produção.
 *
 * A mesma regra existe como gatilho na migração 0015. As duas não são
 * redundância: esta permite a interface explicar antes de tentar, aquela torna
 * a falha impossível mesmo para quem não passa pela interface.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarBase } from '../src/dados/gerar.ts'
import {
  ativarUsuario,
  atribuirPerfil,
  convidarUsuario,
  desativarUsuario,
  revogarPerfil,
  salvarPerfil,
  usuariosComPerfil,
} from '../src/dados/comandos.ts'
import type { BaseDados } from '../src/dados/tipos.ts'

/** Base nova a cada caso: comando que escreve não pode contaminar o vizinho. */
function base(): BaseDados {
  return gerarBase()
}

const CONVITE = {
  nome: 'Fulano de Tal',
  email: 'fulano@iarx.app',
  tipo: 'INTERNO' as const,
  clienteId: null,
  perfilId: 'perf-operacao',
  filiaisIds: [],
}

/* ------------------------------------------------------------------ convite */

test('convidar cria o usuário sem senha e sem convite aceito', () => {
  const b = base()
  const r = convidarUsuario(b, CONVITE)

  assert.equal(r.ok, true)
  if (!r.ok) return

  // O administrador nunca define a senha de ninguém: senha definida por
  // terceiro é senha compartilhada. O convidado existe e não entra até aceitar.
  assert.equal(r.valor.conviteAceito, false)
  assert.equal(r.valor.ultimoAcesso, null)
  assert.equal('senha' in r.valor, false, 'o modelo de usuário não deve ter campo de senha')
})

test('e-mail duplicado é recusado apontando o campo', () => {
  const b = base()
  const existente = b.usuarios[0]!

  const r = convidarUsuario(b, { ...CONVITE, email: existente.email.toUpperCase() })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'email')
})

test('perfil de cliente não é atribuível a usuário interno, nem o contrário', () => {
  const b = base()

  // RN-L25. Um usuário de cliente com perfil interno enxergaria a operação
  // inteira da locadora — e o erro seria invisível até alguém abrir a tela.
  const r = convidarUsuario(b, { ...CONVITE, perfilId: 'perf-cliente' })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /tipo cliente/)

  const r2 = convidarUsuario(b, {
    ...CONVITE,
    email: 'outro@exemplo.test',
    tipo: 'CLIENTE',
    clienteId: b.clientes[0]!.id,
    perfilId: 'perf-operacao',
  })
  assert.equal(r2.ok, false)
})

test('usuário de cliente sem cliente vinculado é recusado', () => {
  const b = base()
  const r = convidarUsuario(b, {
    ...CONVITE,
    email: 'semcliente@exemplo.test',
    tipo: 'CLIENTE',
    clienteId: null,
    perfilId: 'perf-cliente',
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'clienteId')
})

/* --------------------------------------------- o último administrador (RN-L39) */

test('o último administrador ativo não pode ser desativado', () => {
  const b = base()
  const admin = b.usuarios.find((u) => u.perfilIds.includes('perf-admin'))!

  const r = desativarUsuario(b, admin.id, 'saiu da empresa')
  assert.equal(r.ok, false)
  if (r.ok) return

  // A recusa precisa dizer o que fazer, não só que não dá.
  assert.match(r.erro.mensagem, /último administrador/)
  assert.match(r.erro.mensagem, /outro usuário/)
  assert.equal(b.usuarios.find((u) => u.id === admin.id)!.status, 'ATIVO')
})

test('com um segundo administrador, desativar o primeiro passa', () => {
  const b = base()
  const admin = b.usuarios.find((u) => u.perfilIds.includes('perf-admin'))!
  const outro = b.usuarios.find((u) => u.id !== admin.id && u.status === 'ATIVO')!

  assert.equal(atribuirPerfil(b, outro.id, 'perf-admin').ok, true)

  const r = desativarUsuario(b, admin.id, 'saiu da empresa')
  assert.equal(r.ok, true)
  assert.equal(b.usuarios.find((u) => u.id === admin.id)!.status, 'INATIVO')
})

test('revogar o perfil do último administrador é recusado pela mesma razão', () => {
  const b = base()
  const admin = b.usuarios.find((u) => u.perfilIds.includes('perf-admin'))!

  // A porta dos fundos: em vez de desativar o usuário, tira-se o perfil dele.
  // Produz exatamente o mesmo ambiente órfão.
  assert.equal(atribuirPerfil(b, admin.id, 'perf-operacao').ok, true)
  const r = revogarPerfil(b, admin.id, 'perf-admin')

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /sem administrador/)
})

test('desativar preserva o registro, nunca apaga', () => {
  const b = base()
  const antes = b.usuarios.length
  const alvo = b.usuarios.find((u) => u.status === 'ATIVO' && !u.perfilIds.includes('perf-admin'))!

  assert.equal(desativarUsuario(b, alvo.id, 'afastamento prolongado').ok, true)

  // RN-L30: a trilha de auditoria referencia o autor. Apagar a conta deixaria
  // o histórico apontando para ninguém.
  assert.equal(b.usuarios.length, antes)
  assert.equal(b.usuarios.find((u) => u.id === alvo.id)!.status, 'INATIVO')
})

test('desativação exige motivo com substância', () => {
  const b = base()
  const alvo = b.usuarios.find((u) => u.status === 'ATIVO' && !u.perfilIds.includes('perf-admin'))!

  const r = desativarUsuario(b, alvo.id, 'x')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'motivo')
})

test('reativar devolve o acesso', () => {
  const b = base()
  const inativo = b.usuarios.find((u) => u.status === 'INATIVO')!

  assert.equal(ativarUsuario(b, inativo.id).ok, true)
  assert.equal(b.usuarios.find((u) => u.id === inativo.id)!.status, 'ATIVO')
})

/* -------------------------------------------------------- perfis e revogação */

test('usuário não fica sem nenhum perfil', () => {
  const b = base()
  const alvo = b.usuarios.find((u) => u.perfilIds.length === 1 && !u.perfilIds.includes('perf-admin'))!

  const r = revogarPerfil(b, alvo.id, alvo.perfilIds[0]!)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /ao menos um perfil/)
})

test('perfil de sistema não é editável', () => {
  const b = base()

  // Alterá-lo mudaria o acesso de todo mundo que o tem, inclusive de quem nunca
  // foi consultado. Quem precisa de variação duplica.
  const r = salvarPerfil(b, 'perf-admin', {
    nome: 'Administrador da Plataforma',
    descricao: 'tentativa de edição',
    tipo: 'INTERNO',
    permissoes: ['contrato:ler'],
  })

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.erro.mensagem, /Duplique/)
})

test('perfil derivado é editável', () => {
  const b = base()
  const r = salvarPerfil(b, 'perf-suporte', {
    nome: 'Supervisor de Suporte',
    descricao: 'ajustado',
    tipo: 'INTERNO',
    permissoes: ['os:ler', 'os:executar', 'contrato:ler'],
  })

  assert.equal(r.ok, true)
  if (!r.ok) return
  // Ordenado: salvar duas vezes sem mudar nada não pode produzir diff.
  assert.deepEqual(r.valor.permissoes, ['contrato:ler', 'os:executar', 'os:ler'])
})

test('perfil sem nenhuma permissão é recusado', () => {
  const b = base()

  // Um perfil vazio dá acesso a nada e parece configuração válida — o usuário
  // atribuído a ele entraria e não veria tela nenhuma, sem explicação.
  const r = salvarPerfil(b, null, { nome: 'Vazio', descricao: '', tipo: 'INTERNO', permissoes: [] })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'permissoes')
})

test('nome de perfil duplicado é recusado', () => {
  const b = base()
  const r = salvarPerfil(b, null, {
    nome: 'administrador da plataforma',
    descricao: '',
    tipo: 'INTERNO',
    permissoes: ['contrato:ler'],
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.erro.campo, 'nome')
})

test('a contagem de uso do perfil só considera usuário ativo', () => {
  const b = base()
  const antes = usuariosComPerfil(b, 'perf-operacao')
  const alvo = b.usuarios.find(
    (u) => u.perfilIds.includes('perf-operacao') && u.status === 'ATIVO',
  )!

  assert.equal(desativarUsuario(b, alvo.id, 'afastamento prolongado').ok, true)
  assert.equal(usuariosComPerfil(b, 'perf-operacao'), antes - 1)
})

/* ------------------------------------------------------------- a massa base */

test('a massa tem os estados que a tela precisa saber exibir', () => {
  const b = base()

  // Uma base só de contas felizes esconde os dois estados que mais confundem
  // quem administra: quem está inativo e quem nunca aceitou o convite.
  assert.ok(b.usuarios.some((u) => u.status === 'INATIVO'), 'nenhum usuário inativo na massa')
  assert.ok(b.usuarios.some((u) => !u.conviteAceito), 'nenhum convite pendente na massa')
  assert.ok(b.usuarios.some((u) => u.tipo === 'CLIENTE'), 'nenhum usuário de cliente na massa')
  assert.ok(b.perfis.some((p) => !p.isSistema), 'nenhum perfil editável na massa')
})

test('nenhum usuário da massa tem e-mail repetido', () => {
  const b = base()
  const emails = b.usuarios.map((u) => u.email.toLowerCase())
  assert.equal(new Set(emails).size, emails.length)
})
