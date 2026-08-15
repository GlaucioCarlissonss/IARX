/**
 * Tradução das recusas do visualizador de artefato.
 *
 * Estes testes existem porque a falha original era silenciosa: o botão de
 * exportar parecia funcionar e não entregava nada. Cada ramo aqui garante que
 * uma recusa vira ou uma ação alternativa ou uma frase que o usuário pode
 * agir — nunca um clique sem efeito.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { salvarPeloVisualizador } from '../src/lib/baixar.ts'

/** Dublê do namespace do runtime: registra o que recebeu e falha sob comando. */
function falso(roteiro: (string | null)[]) {
  const chamadas: { filename: string }[] = []
  let i = 0
  return {
    chamadas,
    downloads: {
      save(r: { filename: string; data: Blob | string }) {
        chamadas.push({ filename: r.filename })
        const codigo = roteiro[i++] ?? null
        if (codigo === null) return Promise.resolve({ status: 'saved' as const })
        return Promise.reject({ code: codigo, message: codigo })
      },
    },
  }
}

test('o caminho feliz devolve salvo, sem aviso', async () => {
  const { downloads, chamadas } = falso([null])
  const r = await salvarPeloVisualizador(downloads, 'dados.csv', 'a;b', 'dados.txt')

  assert.deepEqual(r, { situacao: 'salvo' })
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0]!.filename, 'dados.csv')
})

test('recusa do usuário é cancelamento silencioso, não erro', async () => {
  const { downloads } = falso(['declined'])
  const r = await salvarPeloVisualizador(downloads, 'dados.csv', 'a;b', 'dados.txt')

  // Ele sabe o que fez. Uma mensagem aqui seria a interface discutindo com o
  // usuário sobre uma decisão dele.
  assert.equal(r.situacao, 'cancelado')
  assert.equal(r.aviso, undefined)
})

test('extensão não habilitada tenta a alternativa e conta a troca', async () => {
  // `csv` está no conjunto estendido do visualizador, que pode não estar
  // ligado. Deixar a exportação morrer ali seria perder o dado por causa de
  // três letras no nome do arquivo.
  const { downloads, chamadas } = falso(['extension_not_enabled', null])
  const r = await salvarPeloVisualizador(downloads, 'mapa.csv', 'a;b', 'mapa.txt')

  assert.equal(r.situacao, 'salvo')
  assert.deepEqual(
    chamadas.map((c) => c.filename),
    ['mapa.csv', 'mapa.txt'],
  )
  assert.match(r.aviso!, /mapa\.txt/)
  // O aviso precisa dizer como usar o arquivo, não só que o nome mudou.
  assert.match(r.aviso!, /Excel/)
})

test('sem alternativa, extensão não habilitada vira mensagem acionável', async () => {
  const { downloads, chamadas } = falso(['extension_not_enabled'])
  const r = await salvarPeloVisualizador(downloads, 'contrato.docx', new Blob(['x']), undefined)

  assert.equal(r.situacao, 'falhou')
  assert.equal(chamadas.length, 1)
  assert.match(r.aviso!, /aceita/)
})

test('recusa na segunda tentativa não é reportada como sucesso', async () => {
  const { downloads } = falso(['extension_not_enabled', 'declined'])
  const r = await salvarPeloVisualizador(downloads, 'mapa.csv', 'a;b', 'mapa.txt')

  assert.equal(r.situacao, 'cancelado')
})

test('tipo fora da lista diz o que é aceito, não só o que não é', async () => {
  const { downloads } = falso(['rejected_extension'])
  const r = await salvarPeloVisualizador(downloads, 'nota.pdf', new Blob(['x']), undefined)

  assert.equal(r.situacao, 'falhou')
  // Beco sem saída é o que a interface não pode oferecer: a mensagem lista os
  // formatos aceitos e diz onde o download completo funciona.
  assert.match(r.aviso!, /png/)
  assert.match(r.aviso!, /hospedada/)
})

test('arquivo grande demais cita o limite', async () => {
  const { downloads } = falso(['too_large'])
  const r = await salvarPeloVisualizador(downloads, 'video.mp4', new Blob(['x']), undefined)

  assert.equal(r.situacao, 'falhou')
  assert.match(r.aviso!, /16 MB/)
})

test('pedido concorrente orienta a concluir o anterior', async () => {
  const { downloads } = falso(['rate_limited'])
  const r = await salvarPeloVisualizador(downloads, 'mapa.txt', 'a;b', undefined)

  assert.equal(r.situacao, 'falhou')
  assert.match(r.aviso!, /Conclua/)
})

test('código desconhecido cai na mensagem genérica, e não em undefined', async () => {
  // O contrato manda tratar código desconhecido como indisponível. Sem este
  // ramo, um código novo do runtime viraria um aviso vazio na tela.
  const { downloads } = falso(['codigo_que_ainda_nao_existe'])
  const r = await salvarPeloVisualizador(downloads, 'mapa.txt', 'a;b', undefined)

  assert.equal(r.situacao, 'falhou')
  assert.match(r.aviso!, /hospedada/)
})
