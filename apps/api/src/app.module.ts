import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { BancoService } from './banco/banco.service.js'
import { AutenticacaoGuard } from './comum/autenticacao.guard.js'
import { ContextoMiddleware } from './comum/contexto.middleware.js'
import { EnvelopeInterceptor } from './comum/envelope.interceptor.js'
import { IdempotenciaInterceptor } from './comum/idempotencia.interceptor.js'
import { PermissaoGuard } from './comum/permissao.guard.js'
import { ProblemaFilter } from './comum/problema.filter.js'
import { ContratosController } from './modulos/contratos/contratos.controller.js'
import { ContratosRepositorio } from './modulos/contratos/contratos.repositorio.js'
import { ContratosService } from './modulos/contratos/contratos.service.js'
import { EquipamentosController } from './modulos/equipamentos/equipamentos.controller.js'
import { EquipamentosRepositorio } from './modulos/equipamentos/equipamentos.repositorio.js'
import { EquipamentosService } from './modulos/equipamentos/equipamentos.service.js'
import { AuthController } from './modulos/auth/auth.controller.js'
import { AuthRepositorio } from './modulos/auth/auth.repositorio.js'
import { AuthService } from './modulos/auth/auth.service.js'
import {
  CentrosCustoController,
  ContasBancariasController,
} from './modulos/financeiro/financeiro.controller.js'
import { FinanceiroRepositorio } from './modulos/financeiro/financeiro.repositorio.js'
import { FinanceiroService } from './modulos/financeiro/financeiro.service.js'
import {
  ContasPagarController,
  DelegacoesController,
} from './modulos/contas-pagar/contas-pagar.controller.js'
import {
  CompetenciasController,
  ContasReceberController,
} from './modulos/contas-receber/contas-receber.controller.js'
import { ContasReceberRepositorio } from './modulos/contas-receber/contas-receber.repositorio.js'
import { ContasReceberService } from './modulos/contas-receber/contas-receber.service.js'
import { ContasPagarRepositorio } from './modulos/contas-pagar/contas-pagar.repositorio.js'
import { ContasPagarService } from './modulos/contas-pagar/contas-pagar.service.js'
import {
  LancamentosFuturosController,
  RecorrenciasController,
} from './modulos/lancamentos-futuros/lancamentos-futuros.controller.js'
import { LancamentosFuturosRepositorio } from './modulos/lancamentos-futuros/lancamentos-futuros.repositorio.js'
import { LancamentosFuturosService } from './modulos/lancamentos-futuros/lancamentos-futuros.service.js'
import { ConversaoWorker } from './modulos/lancamentos-futuros/conversao.worker.js'
import {
  CenariosCaixaController,
  FluxoCaixaController,
} from './modulos/fluxo-caixa/fluxo-caixa.controller.js'
import { FluxoCaixaRepositorio } from './modulos/fluxo-caixa/fluxo-caixa.repositorio.js'
import { FluxoCaixaService } from './modulos/fluxo-caixa/fluxo-caixa.service.js'
import { NotificacaoController } from './modulos/notificacao/notificacao.controller.js'
import { NotificacaoService } from './modulos/notificacao/notificacao.service.js'
import { NotificacaoWorker } from './modulos/notificacao/notificacao.worker.js'
import { ClientesController } from './modulos/clientes/clientes.controller.js'
import { ClientesRepositorio } from './modulos/clientes/clientes.repositorio.js'
import { ClientesService } from './modulos/clientes/clientes.service.js'
import {
  PerfisController,
  PermissoesController,
  UsuariosController,
} from './modulos/iam/iam.controller.js'
import { IamRepositorio } from './modulos/iam/iam.repositorio.js'
import { IamService } from './modulos/iam/iam.service.js'
import { LocaisController } from './modulos/locais/locais.controller.js'
import { LocaisRepositorio } from './modulos/locais/locais.repositorio.js'
import { LocaisService } from './modulos/locais/locais.service.js'
import {
  FornecedoresController,
  NotasFiscaisController,
} from './modulos/notas-fiscais/notas-fiscais.controller.js'
import { NotasFiscaisRepositorio } from './modulos/notas-fiscais/notas-fiscais.repositorio.js'
import { NotasFiscaisService } from './modulos/notas-fiscais/notas-fiscais.service.js'
import { SaudeController } from './modulos/saude/saude.controller.js'

/**
 * Composição da aplicação.
 *
 * Guardas e interceptors são globais, não por controlador. A razão é a mesma
 * que rege o resto do projeto: o que protege precisa valer por omissão. Guarda
 * aplicada controlador a controlador esquece o controlador novo, e o esquecimento
 * é silencioso — a rota simplesmente funciona sem autenticação.
 *
 * A ordem de registro dos interceptors importa. `Idempotencia` vem antes de
 * `Envelope`, então na volta ele enxerga a resposta **já envelopada** — é
 * exatamente esse corpo que precisa ser guardado para o replay devolver byte
 * por byte o que a primeira chamada devolveu.
 */
@Module({
  controllers: [
    SaudeController,
    EquipamentosController,
    ContratosController,
    NotasFiscaisController,
    FornecedoresController,
    LocaisController,
    ClientesController,
    UsuariosController,
    PerfisController,
    PermissoesController,
    AuthController,
    CentrosCustoController,
    ContasBancariasController,
    NotificacaoController,
    ContasPagarController,
    DelegacoesController,
    ContasReceberController,
    CompetenciasController,
    LancamentosFuturosController,
    RecorrenciasController,
    FluxoCaixaController,
    CenariosCaixaController,
  ],
  providers: [
    BancoService,
    EquipamentosRepositorio,
    EquipamentosService,
    ContratosRepositorio,
    ContratosService,
    NotasFiscaisRepositorio,
    NotasFiscaisService,
    LocaisRepositorio,
    LocaisService,
    ClientesRepositorio,
    ClientesService,
    IamRepositorio,
    IamService,
    AuthRepositorio,
    AuthService,
    FinanceiroRepositorio,
    FinanceiroService,
    NotificacaoService,
    NotificacaoWorker,
    ContasPagarRepositorio,
    ContasPagarService,
    ContasReceberRepositorio,
    ContasReceberService,
    LancamentosFuturosRepositorio,
    LancamentosFuturosService,
    ConversaoWorker,
    FluxoCaixaRepositorio,
    FluxoCaixaService,
    { provide: APP_FILTER, useClass: ProblemaFilter },
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    { provide: APP_GUARD, useClass: PermissaoGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotenciaInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextoMiddleware).forRoutes('*splat')
  }
}
