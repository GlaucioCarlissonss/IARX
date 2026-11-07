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
import { ReajustesController } from './modulos/contratos/reajustes.controller.js'
import { ReajustesRepositorio } from './modulos/contratos/reajustes.repositorio.js'
import { ReajustesService } from './modulos/contratos/reajustes.service.js'
import { EquipamentosController } from './modulos/equipamentos/equipamentos.controller.js'
import { EquipamentosRepositorio } from './modulos/equipamentos/equipamentos.repositorio.js'
import { EquipamentosService } from './modulos/equipamentos/equipamentos.service.js'
import { MovimentacaoRepositorio } from './modulos/equipamentos/movimentacao.repositorio.js'
import { MovimentacaoService } from './modulos/equipamentos/movimentacao.service.js'
import { TransferenciasController } from './modulos/equipamentos/transferencias.controller.js'
import { AuthController } from './modulos/auth/auth.controller.js'
import { ResultadoController } from './modulos/resultado/resultado.controller.js'
import { ResultadoService } from './modulos/resultado/resultado.service.js'
import { MapaController } from './modulos/mapa/mapa.controller.js'
import { MapaService } from './modulos/mapa/mapa.service.js'
import { AnexoController } from './modulos/anexo/anexo.controller.js'
import { AnexoRepositorio } from './modulos/anexo/anexo.repositorio.js'
import { AnexoService } from './modulos/anexo/anexo.service.js'
import { EstoqueController } from './modulos/estoque/estoque.controller.js'
import { EstoqueRepositorio } from './modulos/estoque/estoque.repositorio.js'
import { EstoqueService } from './modulos/estoque/estoque.service.js'
import { AdministracaoController } from './modulos/administracao/administracao.controller.js'
import { AdministracaoService } from './modulos/administracao/administracao.service.js'
import { CadastrosController } from './modulos/cadastros/cadastros.controller.js'
import { CadastrosService } from './modulos/cadastros/cadastros.service.js'
import { ComprasController } from './modulos/estoque/compras.controller.js'
import { ComprasRepositorio } from './modulos/estoque/compras.repositorio.js'
import { ComprasService } from './modulos/estoque/compras.service.js'
import { ManutencaoController } from './modulos/manutencao/manutencao.controller.js'
import { ManutencaoRepositorio } from './modulos/manutencao/manutencao.repositorio.js'
import { ManutencaoService } from './modulos/manutencao/manutencao.service.js'
import { MedicaoController } from './modulos/medicao/medicao.controller.js'
import { MedicaoRepositorio } from './modulos/medicao/medicao.repositorio.js'
import { MedicaoService } from './modulos/medicao/medicao.service.js'
import { ComercialController } from './modulos/comercial/comercial.controller.js'
import { ComercialRepositorio } from './modulos/comercial/comercial.repositorio.js'
import { ComercialService } from './modulos/comercial/comercial.service.js'
import { CatalogoController } from './modulos/catalogo/catalogo.controller.js'
import { CatalogoRepositorio } from './modulos/catalogo/catalogo.repositorio.js'
import { CatalogoService } from './modulos/catalogo/catalogo.service.js'
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
import {
  CategoriasDespesaController,
  DespesasController,
  OrcamentosController,
} from './modulos/despesas/despesas.controller.js'
import { DespesasRepositorio } from './modulos/despesas/despesas.repositorio.js'
import { DespesasService } from './modulos/despesas/despesas.service.js'
import { PortalController } from './modulos/portal/portal.controller.js'
import { PortalRepositorio } from './modulos/portal/portal.repositorio.js'
import { PortalService } from './modulos/portal/portal.service.js'
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
    TransferenciasController,
    ContratosController,
    ReajustesController,
    NotasFiscaisController,
    FornecedoresController,
    LocaisController,
    ClientesController,
    UsuariosController,
    PerfisController,
    PermissoesController,
    AuthController,
    CatalogoController,
    ComercialController,
    MedicaoController,
    ManutencaoController,
    EstoqueController,
    ComprasController,
    AdministracaoController,
    CadastrosController,
    AnexoController,
    MapaController,
    ResultadoController,
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
    CategoriasDespesaController,
    OrcamentosController,
    DespesasController,
    PortalController,
  ],
  providers: [
    BancoService,
    EquipamentosRepositorio,
    EquipamentosService,
    MovimentacaoRepositorio,
    MovimentacaoService,
    ContratosRepositorio,
    ContratosService,
    ReajustesRepositorio,
    ReajustesService,
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
    CatalogoService,
    CatalogoRepositorio,
    ComercialService,
    ComercialRepositorio,
    MedicaoService,
    MedicaoRepositorio,
    ManutencaoService,
    ManutencaoRepositorio,
    EstoqueService,
    EstoqueRepositorio,
    ComprasService,
    ComprasRepositorio,
    AdministracaoService,
    CadastrosService,
    AnexoService,
    AnexoRepositorio,
    MapaService,
    ResultadoService,
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
    DespesasRepositorio,
    DespesasService,
    PortalRepositorio,
    PortalService,
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
