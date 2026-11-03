import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  AlocarItem,
  CriarContrato,
  DistratarContrato,
  EncerrarContrato,
  EncerrarItem,
  ListarContratos,
  ListarReajustes,
  ProporReajuste,
  ReprovarContrato,
  SubstituirItem,
  SuspenderContrato,
} from '@iarx/contracts'
import { ExigePermissao, Idempotente } from '../../comum/decoradores.js'
import { validar } from '../../comum/zod.pipe.js'
import { ContratosService } from './contratos.service.js'
import { ReajustesService } from './reajustes.service.js'

/** `CTR` — Contratos e alocação de itens (Anexo D.2). */
@Controller('api/v1/contratos')
export class ContratosController {
  constructor(
    private readonly servico: ContratosService,
    private readonly reajustes: ReajustesService,
  ) {}

  @Get()
  @ExigePermissao('contrato:ler')
  listar(@Query(validar(ListarContratos)) filtro: ListarContratos) {
    return this.servico.listar(filtro)
  }

  /**
   * Cria o rascunho. Idempotente: o contrato é a origem de toda a cobrança, e
   * dois rascunhos iguais viram duas cadeias de faturamento paralelas.
   */
  @Post()
  @HttpCode(201)
  @ExigePermissao('contrato:criar')
  @Idempotente()
  criar(@Body(validar(CriarContrato)) corpo: CriarContrato) {
    return this.servico.criar(corpo)
  }

  @Get(':id')
  @ExigePermissao('contrato:ler')
  porId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.porId(id)
  }

  @Get(':id/itens')
  @ExigePermissao('contrato:ler')
  itens(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.itens(id)
  }

  /**
   * Alocação de equipamento. Idempotente por exigência: criar item de contrato
   * duas vezes por causa de um timeout de rede vira cobrança duplicada no
   * fechamento (RN-029).
   */
  @Post(':id/itens')
  @HttpCode(201)
  @ExigePermissao('contrato:item_alocar')
  @Idempotente()
  alocar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(AlocarItem)) corpo: AlocarItem,
  ) {
    return this.servico.alocarItem(id, corpo)
  }

  /* ------------------------------------------- ciclo de vida (Anexo B.2) */

  /*
   * Uma rota por transição, e não um `PATCH status`.
   *
   * O Anexo C separa `contrato:aprovar` de `contrato:ativar` de
   * `contrato:encerrar`, e essa separação só significa alguma coisa se forem
   * rotas diferentes: com um `PATCH` genérico, quem pudesse mudar o status
   * levaria o contrato de rascunho a ativo sozinho — sem aprovação de gestor e
   * sem assinatura.
   *
   * Todas respondem 200: o contrato já existe e já tem URL. A ação muda o
   * estado dele, não cria recurso.
   *
   * Nenhuma confere o estado de partida. A máquina é gatilho no banco, e
   * conferir aqui criaria um segundo lugar para a mesma regra — com o segundo
   * valendo só para quem passa por esta API, e ainda perdendo a corrida com
   * duas requisições simultâneas.
   */

  @Post(':id/submeter')
  @HttpCode(200)
  @ExigePermissao('contrato:editar')
  submeter(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.mudarStatus(id, 'EM_APROVACAO', null)
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @ExigePermissao('contrato:aprovar')
  aprovar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.mudarStatus(id, 'AGUARDANDO_ASSINATURA', null)
  }

  /** Reprovação devolve para ajuste, com o motivo registrado. */
  @Post(':id/reprovar')
  @HttpCode(200)
  @ExigePermissao('contrato:aprovar')
  reprovar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(ReprovarContrato)) corpo: ReprovarContrato,
  ) {
    return this.servico.mudarStatus(id, 'RASCUNHO', corpo.motivo)
  }

  /** Ativação reserva os itens planejados — efeito do gatilho, não daqui. */
  @Post(':id/ativar')
  @HttpCode(200)
  @ExigePermissao('contrato:ativar')
  ativar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.mudarStatus(id, 'ATIVO', null)
  }

  @Post(':id/suspender')
  @HttpCode(200)
  @ExigePermissao('contrato:suspender')
  suspender(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(SuspenderContrato)) corpo: SuspenderContrato,
  ) {
    return this.servico.mudarStatus(id, 'SUSPENSO', corpo.motivo)
  }

  @Post(':id/retomar')
  @HttpCode(200)
  @ExigePermissao('contrato:retomar')
  retomar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.mudarStatus(id, 'ATIVO', null)
  }

  @Post(':id/renovar')
  @HttpCode(200)
  @ExigePermissao('contrato:renovar')
  renovar(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.servico.mudarStatus(id, 'EM_RENOVACAO', null)
  }

  /**
   * Encerramento.
   *
   * O gatilho recusa se houver item em campo, e essa recusa é a mais
   * importante do módulo: encerrar com equipamento instalado tira o ativo do
   * parque alocável e deixa a máquina no cliente — ninguém a cobra, ninguém a
   * busca, e ela continua existindo.
   */
  @Post(':id/encerrar')
  @HttpCode(200)
  @ExigePermissao('contrato:encerrar')
  encerrar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EncerrarContrato)) corpo: EncerrarContrato,
  ) {
    return this.servico.mudarStatus(id, 'ENCERRADO', corpo.motivo)
  }

  /** Distrato é rescisão antes do prazo mínimo, e calcula multa (F-CTR-13). */
  @Post(':id/distratar')
  @HttpCode(200)
  @ExigePermissao('contrato:distratar')
  distratar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(DistratarContrato)) corpo: DistratarContrato,
  ) {
    return this.servico.mudarStatus(id, 'DISTRATADO', corpo.motivo)
  }

  /**
   * Cancelamento — só antes de qualquer entrega.
   *
   * Cancelar é "este contrato nunca existiu na prática". Com item entregue a
   * saída é distrato ou encerramento, e a diferença importa porque uma calcula
   * multa e a outra não. O gatilho é quem recusa.
   */
  @Post(':id/cancelar')
  @HttpCode(200)
  @ExigePermissao('contrato:cancelar')
  cancelar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(EncerrarContrato)) corpo: EncerrarContrato,
  ) {
    return this.servico.mudarStatus(id, 'CANCELADO', corpo.motivo)
  }

  /* ----------------------------------------------------- ações de item --- */

  /**
   * Encerra a cobrança de um item sem mexer no resto do contrato — a devolução
   * de uma máquina num parque de quarenta.
   */
  @Post(':id/itens/:itemId/encerrar')
  @HttpCode(200)
  @ExigePermissao('contrato:item_encerrar')
  encerrarItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body(validar(EncerrarItem)) corpo: EncerrarItem,
  ) {
    return this.reajustes.encerrarItem(id, itemId, corpo)
  }

  /**
   * Troca o ativo do item: encerra o atual como SUBSTITUIDO e cria o sucessor
   * com a mesma precificação, vinculado ao antecessor.
   */
  @Post(':id/itens/:itemId/substituir')
  @HttpCode(200)
  @ExigePermissao('contrato:item_substituir')
  @Idempotente()
  substituirItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
    @Body(validar(SubstituirItem)) corpo: SubstituirItem,
  ) {
    return this.reajustes.substituirItem(id, itemId, corpo)
  }

  /* ---------------------------------------------------------- reajuste --- */

  @Get(':id/reajustes')
  @ExigePermissao('contrato:ler')
  reajustesDoContrato(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(validar(ListarReajustes)) filtro: ListarReajustes,
  ) {
    return this.reajustes.listar({ ...filtro, contrato_id: id })
  }

  /**
   * Propõe o reajuste da competência de aniversário.
   *
   * Mesma permissão da aprovação porque o Anexo C traz uma só —
   * `contrato:reajuste_aprovar`. A separação que RN-008 exige é entre **propor
   * e aplicar**, e ela está nas rotas e na máquina do banco: proposta não vira
   * cobrança sem passar por `aprovar`.
   */
  @Post(':id/reajustes')
  @HttpCode(201)
  @ExigePermissao('contrato:reajuste_aprovar')
  @Idempotente()
  proporReajuste(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(validar(ProporReajuste)) corpo: ProporReajuste,
  ) {
    return this.reajustes.propor(id, corpo)
  }
}
