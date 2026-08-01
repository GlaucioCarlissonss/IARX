import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

/**
 * Bootstrap da API.
 *
 * O `json({ limit })` não é detalhe: sem limite explícito, um POST de 200 MB é
 * aceito, parseado e mantido em memória antes de qualquer guarda rodar — um
 * caminho barato para derrubar o processo sem sequer estar autenticado.
 */
async function iniciar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true })

  app.use((await import('express')).json({ limit: '512kb' }))
  app.enableShutdownHooks()

  const porta = Number(process.env['PORT'] ?? 3000)
  await app.listen(porta, '0.0.0.0')
  new Logger('Bootstrap').log(`API ouvindo em :${porta}`)
}

iniciar().catch((e) => {
  // Falha de bootstrap precisa derrubar o processo com código diferente de
  // zero: se ela apenas logasse, o orquestrador consideraria a instância
  // saudável e mandaria tráfego para um processo que nunca vai responder.
  console.error('falha ao iniciar a API', e)
  process.exit(1)
})
