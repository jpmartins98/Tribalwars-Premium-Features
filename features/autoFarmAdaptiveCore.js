// AutoFarm Adaptive compatibility core for TWPF 2.0.15.
// Derived from the checksum-verified v2.0.14.3 artifact. Deliberately has no
// boot, listeners, timers, network calls or UI side effects at evaluation time.
(root => {
  'use strict';

  /*
   * AutoFarm Radius v1.5.4
   *
   * Alterações 1.4.5:
   * - corrige cache de páginas quando um alvo sai da página 0;
   * - grava um estado "sending" antes do POST para reduzir duplicações após crash/timeout;
   * - falha de escrita no localStorage passa a ser fail-closed;
   * - respostas de envio inesperadas deixam o alvo em estado incerto, sem repetir de imediato;
   * - timeout de relatório considera o raio e uma velocidade conservadora das unidades do mundo;
   * - parsing de map/village.txt usa menos memória e permite revalidação HTTP em cache;
   * - parar durante uma passagem mantém o lock até o pedido em curso terminar;
   * - estatísticas de elegibilidade deixam de vazar entre aldeias.
   *
   * Alterações 1.4.6:
   * - permite escolher o modelo A, B ou C do Assistente de Saque;
   * - deixa de assumir/mostrar uma composição fixa de tropas;
   * - pode executar a partir de qualquer página do jogo (o Assistente é lido em background);
   * - usa a hora do último ataque mostrada no Assistente para reconstruir cooldowns quando possível;
   * - mantém compatibilidade com o histórico local das versões anteriores.
   *
   * Alterações 1.4.7:
   * - exige uma linha atual do Assistente e o botão do modelo selecionado antes de enviar;
   * - corrige a conversão da hora do Assistente quando servidor e browser usam fusos diferentes;
   * - não cria cooldown histórico "a partir de agora" quando a hora do ataque não é fiável;
   * - rejeita como nosso um relatório temporalmente anterior ao envio pendente;
   * - força full-rescan quando a lista de bárbaras do raio muda;
   * - respostas {success:false} deixam de ser aceites como confirmação positiva;
   * - alterações de modelo durante uma passagem interrompem novos envios dessa passagem;
   * - reforça validação do endpoint de envio e das gravações do painel;
   * - mantém busy/lease até o pedido em curso terminar mesmo após hard-stop;
   * - ignora ações de botão que não exponham um template_id de forma inequívoca.
   *
   * Alterações 1.4.8:
   * - permite o primeiro farm de bárbaras novas do raio que ainda não tenham linha no Assistente;
   * - mantém validação estrita do template A/B quando a linha já existe no Assistente;
   * - só trata uma ausência de linha como "alvo novo" quando o scan do Assistente cobriu todo o raio;
   * - mede a cobertura do scan pela distância das páginas ordenadas por distância;
   * - revalida map/village.txt no início de cada passagem automática, reduzindo a janela de mapa obsoleto;
   * - não faz uma consulta ao mapa por alvo: usa um único snapshot fresco por passagem para limitar pedidos;
   * - mostra quantos alvos elegíveis são bárbaras novas ainda sem histórico no Assistente.
   *
   * Alterações 1.4.9:
   * - deixa de inferir "alvo novo" apenas por row ausente + cobertura antiga;
   * - mantém confirmedAbsentFromAssistant apenas quando um full scan atual prova a ausência;
   * - mantém needsRediscovery para linhas que existiam e desapareceram da página em cache;
   * - se uma linha mapeada muda de página, promove a própria passagem a full scan para a redescobrir;
   * - a elegibilidade de primeiro farm usa prova por coordenada, não um boolean global herdado;
   * - regista assistantEverSeen por alvo para nunca confundir uma farm já conhecida com primeiro farm;
   * - após um primeiro envio confirmado/incerto exige uma prova de ausência mais recente antes de novo bootstrap;
   * - "cobertura" usada para provar ausência passa a ser calculada apenas com páginas realmente lidas nessa passagem.
   *
   * Alterações 1.5.0:
   * - evita percorrer várias coordenadas quando o servidor rejeita um envio;
   * - classifica respostas de falta de tropas de forma mais robusta;
   * - usa sinais do próprio Assistente/Accountmanager para parar antes do POST quando o modelo não está disponível;
   * - quando a capacidade exata do modelo está disponível no Accountmanager, limita a passagem a esse número de envios;
   * - qualquer rejeição explícita desconhecida do servidor interrompe a passagem (fail-closed) e mostra o motivo;
   * - a mensagem "A enviar" passa a "A tentar"; só depois da confirmação é mostrado "Enviado";
   * - o atraso entre tentativas passa a aplicar-se a todas as tentativas consecutivas e é configurável (500-5000 ms);
   * - mantém atraso fixo, não aleatório, para tornar o pacing previsível e não tentar imitar comportamento humano;
   * - lê a composição A/B por várias fontes: Accountmanager, HTML/DOM do Assistente e cache do mesmo template_id;
   * - tenta obter tropas frescas pelo HTML do Assistente e, se necessário, pela Praça de Reuniões em background;
   * - usa sinais conservadores de unitsAppearAvailableAB/botões apenas como fallback (máximo 1 tentativa);
   * - quando a disponibilidade continua desconhecida, NÃO usa o POST como teste: espera a próxima passagem;
   * - suporta respostas de erro em Array(1), além de error/errors/message;
   * - UI reorganizada: controlo principal, capacidade do modelo, fila visível e opções avançadas separadas.
   *
   * Alterações 1.5.1:
   * - fontes persistidas/possivelmente antigas deixam de autorizar capacidade exata por si só;
   * - composição fresca do HTML do Assistente tem prioridade sobre objetos live potencialmente antigos;
   * - divergência entre duas representações frescas da composição falha fechado;
   * - Accountmanager.current_units passa a ser apenas diagnóstico, não prova exata de disponibilidade;
   * - parsing dos contadores de tropas deixa de concatenar vários números do mesmo elemento;
   * - fallback de botão A/B pode usar a página fresca inteira, inclusive quando todos os alvos do raio são novos;
   * - cache do template_id é revalidado sempre que a passagem encontra evidência fresca;
   * - respostas success em string deixam de ser aceites sem um sinal positivo inequívoco;
   * - se o snapshot do mapa envelhecer demasiado durante um scan longo, a passagem aborta antes do POST;
   * - mantém confirmedAbsent/needsRediscovery, histórico, cooldowns, lock e hard-stop sem alteração de semântica.
   *
   * Alterações 1.5.2:
   * - separa limite duro da passagem da capacidade inicialmente provada; um fallback conservador de 1
   *   pode subir na mesma passagem apenas depois de um envio confirmado devolver current_units e a
   *   composição do modelo já ser autoritativa;
   * - evita ficar preso num ciclo sem envios quando o scan torna o mapa antigo: permite uma única
   *   revalidação adicional de map/village.txt por passagem, nunca um GET por alvo;
   * - depois dessa revalidação, filtra a fila antiga contra o novo mapa e continua apenas com ownerId=0;
   * - se o mapa voltar a envelhecer na mesma passagem após a revalidação extra, termina os envios
   *   restantes e deixa a próxima passagem começar normalmente;
   * - não altera o funcionamento em páginas normais: am_farm continua a ser lido em background.
   *
   * Alterações 1.5.3:
   * - persiste o próximo horário automático por aldeia, para que navegar/recarregar não reinicie o intervalo;
   * - mostra contador regressivo da próxima passagem, última passagem e horário absoluto agendado;
   * - adiciona consola de diagnóstico interna com logs de passagem, agendamento, mapa, scan, capacidade e envios;
   * - reorganiza a UI em controlo principal, temporizador, estado, farm/capacidade, definições e diagnóstico;
   * - melhora mensagens para distinguir passagem, agendamento, tentativa, envio confirmado e espera;
   * - mantém o intervalo como espera após o fim da passagem, mas agora o próximo run sobrevive a navegação/reload.
   *
   * Alterações 1.5.4:
   * - corrige a leitura da hora do último ataque: tenta primeiro a coluna conhecida (índice 4) e usa fallback apenas quando existe uma única célula temporal inequívoca;
   * - regista no diagnóstico a fonte temporal usada para cada cooldown observado;
   * - transforma o scheduler persistente num relógio partilhado entre abas: perder o lease já não cria uma cadência concorrente;
   * - abas secundárias sincronizam timers locais por storage events sem reescrever nextRunAt;
   * - se a aba dona desaparecer durante uma passagem, uma aba secundária recupera após libertação/expiração do lease;
   * - limpa caches runtime quando nextRunAt é cancelado por outra aba;
   * - falha ao persistir um novo agendamento automático passa a parar o AutoFarm em memória e nas definições (fail-closed);
   * - um timer nunca executa uma passagem se a aldeia ativa já não for a aldeia para a qual foi criado.
   *
   * Alterações 1.5.5:
   * - migra uma vez cooldowns já existentes quando a mesma row/relatório passa a ter hora fiável com o parser temporal corrigido;
   * - a migração não limpa histórico/pending/bootstrap e não corre sobre alvos pending;
   * - valida explicitamente hora/minuto/segundo, dia/mês/ano e rejeita datas normalizadas/inválidas;
   * - o boot respeita um lease estrangeiro em curso e não escreve nextRunAt próprio enquanto outra aba está a executar;
   * - mantém o scheduler partilhado, storage sync, fail-closed e guarda de aldeia introduzidos na 1.5.4.
   *
   * Alterações 2.0.0:
   * - adiciona modelo adaptativo persistente por bárbara: belief, certainty, stock, depth curve, hora, descanso, trend, regime, concorrência e jackpot;
   * - aprende apenas de resultados/reports reais; não usa estimativas de recursos do Assistente como ground truth;
   * - guarda previsão feita no envio para medir erro preditivo honestamente quando o report chega;
   * - prioriza alvos com FarmRating + Thompson Sampling + incerteza + coverage debt + trend/sector;
   * - nenhuma bárbara ativa desaparece do modelo: MAX_UNSEEN força reobservação quando operacionalmente possível;
   * - cooldown de clean/full passa a adaptativo quando existe observação v2; perdas/unknown/pending/incerto mantêm bloqueios de segurança;
   * - avalia a capacidade universal do template A/B atual e pode rejeitar dispatch de baixa eficiência antes do POST;
   * - dashboard v2: Strategy/Probe Efficiency, Map Mood, coverage, ratings, certainty, Farm Clock, distância e prediction accuracy;
   * - mantém timing fixo/configurado; aleatoriedade é usada apenas na exploração estatística de targets, não para imitar comportamento humano.
   *
   * Correções 2.0.1:
   * - valores ausentes deixam de ser convertidos em zero pelo modelo/analytics;
   * - reports sem informação quantitativa não treinam stock, belief, certainty nem prediction accuracy;
   * - um cooldown operacional só é substituído pelo next_due quando o report atual já foi sincronizado com o modelo;
   * - surpresas extremas persistem POSSIBLE_CHANGE, redução de certainty e recheck em no máximo 60 min;
   * - regimes podem estabilizar novamente e pendingDispatch expira sem contaminar reports futuros;
   * - falhas transitórias sem fallback informativo não consomem definitivamente o report;
   * - parsing, intervalos censurados, métricas globais e previsões congeladas usam presença numérica estrita.
   * - DispatchRating participa efetivamente na decisão final e pode bloquear um POST maduro de baixo valor;
   * - alterações de parâmetros/reset numa aba passiva deixam de concorrer com a aba que detém o lease;
   * - uma mudança de raio durante uma passagem interrompe novos envios e é aplicada pelo mapa fresco seguinte.
   *
   * Correções 2.0.2:
   * - FORCED_COVERAGE torna-se MUST_PROBE e deixa de poder ser bloqueado pelo gate económico;
   * - separa o timeout operacional da janela estatística curta centrada em expectedArrivalAt;
   * - exige report ID posterior ao baseline e timestamp próximo da chegada para atribuir uma previsão congelada;
   * - HTML lido mas sem evidência reconhecida entra em PARSE_UNRECOGNIZED/retry e não consome o report;
   * - reports externos sem timestamp mantêm timestamp=null e não treinam hora, descanso, trend, CUSUM ou janelas temporais;
   * - capacidade/DispatchRating pré-POST usam apenas composição autoritativa do template;
   * - decay diário usa o tempo realmente decorrido, sem aplicar artificialmente um mínimo de seis horas;
   * - adiciona janela histórica configurável de 3 a 7 dias (default 7) e reconstrói a evidência adaptativa apenas dentro desse horizonte;
   * - Belief, certainty, depth, stock, FAST/SLOW, perfis, regimes e métricas de precisão deixam de receber peso de observações fora da janela;
   * - o validador distribuído passa a conter os hashes esperados da v1.5.5 e funciona sem ficheiros externos.
   *
   * Correções 2.0.3:
   * - competitionSignal deixa de consultar lastKnownRemaining/lastObservationAt persistidos fora da janela histórica;
   * - o baseline de competição passa a ser a última observação EXACT com remaining dentro de recent válido;
   * - um recheck vencido de POSSIBLE_CHANGE continua due NOW até uma observação posterior não-extrema o confirmar/limpar;
   * - IDs numéricos de report têm de ser estritamente posteriores ao reportIdAtSend para receber a previsão congelada;
   * - quando o detalhe expõe composição, esta tem de coincidir com a composição enviada; divergência mantém o report como observação externa.
   *
   * Correções 2.0.4:
   * - a decisão de correlação de pendingDispatch é calculada uma única vez com ID, timestamp e composição;
   * - o cleanup só apaga pendingDispatch quando a própria observação confirma pendingMatched=true;
   * - READ_FAILED nunca consome o report, mesmo quando o resumo do Assistente permitir um fallback censurado;
   * - coordenadas realmente inéditas precisam de dois snapshots frescos consecutivos, separados por pelo menos 60 s, antes de bootstrap;
   * - snapshots transitórios do mapa ficam visíveis em logs MAPAΔ e não aumentam imediatamente o contador Novas;
   * - o último resultado de scan é persistido apenas para apresentação, mantendo Novas visível após reload sem autorizar envios;
   * - alterações do conjunto NEW/BOOTSTRAP ficam identificadas por coordenada em logs NOVAS.
   * - uma capacidade conservadora “mínimo 1” é revalidada por um GET fresco do Assistente após cada sucesso antes de parar;
   * - current_units autoritativas continuam prioritárias; prova exata não cria GETs extra e UNKNOWN continua a bloquear novos POSTs.
   *
   * UI 2.0.7:
   * - painel redesenhado de raiz em formato command deck compacto, sem remover informação da v2.0.4;
   * - navegação por Agora / Modelo / Ajustes / Logs reduz altura visual e mantém telemetria completa;
   * - countdown, capacidade, fila e ações ficam concentrados no primeiro ecrã;
   * - analytics, ranking e parâmetros adaptativos ficam num separador próprio com scroll interno;
   * - painel pode ser recolhido sem alterar scheduler, estados, cooldowns ou execução.
   *
   * Correções 2.0.8:
   * - separa BOOTSTRAP_NEW do bucket EXPLORATION no ranking adaptativo;
   * - adiciona dívida persistente por aldeia para impedir starvation quando a capacidade habitual é 1 ou 2;
   * - após duas oportunidades comprovadas sem primeiro farm, uma nova confirmada torna-se MUST_PROBE e ocupa o primeiro slot;
   * - com dívida inferior ao limiar, uma nova ocupa o segundo slot conceptual, preservando exploitation no primeiro;
   * - FORCED_COVERAGE mantém precedência normal, mas uma dívida vencida pode reservar pontualmente o primeiro slot para uma nova;
   * - a dívida só aumenta quando há capacidade de envio comprovada e zera após primeiro farm confirmado ou quando deixa de haver novas elegíveis;
   * - BOOTSTRAP_NEW normal usa o gate económico de probe; apenas a promoção por dívida ignora esse gate;
   * - mantém integralmente o command deck e todos os controlos da UI 2.0.7.
   *
   * Correções 2.0.9:
   * - impede regressão e reaprendizagem duplicada quando o Assistente devolve temporariamente um report ID antigo;
   * - mantém um ledger limitado de reports sincronizados por farm e telemetria de ingestão separada do modelo;
   * - invalida snapshots adaptativos noutras abas e atualiza métricas dependentes do tempo sem esperar pela próxima passagem;
   * - separa na UI novas prontas, primeiros envios pendentes e coordenadas ainda por confirmar no mapa;
   * - cada alteração da fila visual recebe updatedAt/revision próprios, inclusive durante a mesma passagem;
   * - o contador Novas passa a usar o snapshot persistido mais recente como fonte visual canónica;
   * - expõe backlog, retries, baselines, dados quantitativos/qualitativos e rows obsoletas na saúde do modelo;
   * - torna o controlo de pacing explícito como “Intervalo entre envios”, em segundos, preservando attemptGapMs.
   *
   * Correções 2.0.10:
   * - separa telemetria AUTO_MATCHED, EXTERNAL e UNATTRIBUTED sem impedir que reports externos reais informem o Farm Model;
   * - cria ledgers duráveis e deduplicados de envios e reports, com correlação explícita por dispatchId/reportId;
   * - limita eficiência operacional a 100% e expõe loot acima da capacidade estimada como CAPACITY_ANOMALY;
   * - aumenta o ledger de dispatches de 500 para 1000 e acrescenta resumo diário por aldeia e por conta;
   * - torna o cold-start estrito: apenas reports no instante ou depois da criação do modelo são candidatos;
   * - na migração direta da 1.5.5, só grandfathered targets com prova operacional; targets apenas descobertos precisam de 2 snapshots/60 s;
   * - reorganiza a telemetria da UI em AutoFarm, observado, externo, qualidade da medição e anomalias reconciliáveis.
   *
   * Correções 2.0.11:
   * - usa o máximo X/Y do próprio report como capacidade histórica autoritativa; composição/sobreviventes ficam como diagnóstico/fallback;
   * - adiciona scanner incremental do índice de Relatórios e reconstrói o Farm Model cronologicamente a partir do ledger canónico;
   * - aceita reports descobertos fora de ordem, mantém late matching sem reabrir pending e exclui LEGACY não verificável da correlação;
   * - amplia a curva de profundidade com capacidades realmente observadas, inclusive acima de 1000;
   * - impede definitivamente BOOTSTRAP_NEW quando existe qualquer prova operacional, report, evento ou dispatch da coordenada;
   * - distingue DUE de SENDABLE e ativa rotação contínua segura quando nenhuma farm atingiu a hora ideal;
   * - adiciona descanso mínimo antecipado, fase LEARNING, previsão à chegada e nextDueAt expresso como hora de envio;
   * - automatiza apenas templates A/B; C permanece a ação nativa especial baseada no report de espionagem;
   * - separa estratégia de telemetria: o modo Legado também indexa/lê reports, aprende, atualiza estados e mede os seus envios;
   * - reports reconhecidos encontrados fora do Assistente atualizam lastReportId, resultado e cooldown sem deixar um report externo consumir pending;
   * - melhora UI/logs com breakdown de rotação, próximo envio ideal e tabela dos últimos reports/capacidades/fontes.
   *
   * Correções 2.0.12:
   * - economia local e por aldeia usa a união deduplicada events + reportLedger, incluindo reports ledger-only;
   * - a taxa de correlação usa apenas dispatches trackable, independentemente do lifecycle MATCHED/EXPIRED;
   * - o ledger persiste ground truth bruto e o replay cronológico recalcula proxy, surpresa, concorrência e jackpot;
   * - uma página sem reports relevantes para o raio já não é confundida com o fim real do índice;
   * - harness usa relógio fixo e testa separadamente a fronteira local 23:59/00:01;
   * - validador encontra o corpo depois do fecho real dos parâmetros, incluindo options = {}.
   * - mostra Novas detetadas separadamente de Novas prontas e expõe cada etapa de confirmação.
   *
   * Correções 2.0.13:
   * - o índice histórico passa a ser global por aldeia de origem e deixa de reiniciar quando o mapa cresce;
   * - o primeiro backfill lê até seis páginas por passagem e guarda prova histórica leve por coordenada;
   * - tendências sem amostra deixam de aparecer como UNKNOWN e mostram Sem dados/A aprender n/N;
   * - pequenos excessos X/Y são reconciliados sem triângulos de alarme nas médias;
   * - tooltips próprios são desenhados fora do painel para nunca ficarem cortados pelo scroll/overflow.
   * - separa wakes de EXECUTION/OBSERVATION/REPORT/RECONCILIATION/MAINTENANCE/LEASE_RECOVERY;
   * - adiciona planner local por dependência e sources com revision/frescura, reutilizados entre reloads/abas;
   * - boot e espera estocástica não fazem rede; cada execution occurrence autoriza no máximo um POST;
   * - current_units de um POST renova CapacitySource e autoriza successors locais sem novo GET do Assistente;
   * - persiste ExecutionPlan/StochasticPlan imutáveis com fencing, failover sem novo sorteio e dueAt exato;
   * - introduz coalescing adaptativo e sete perfis temporais dentro da menor janela válida das proofs;
   * - separa random de coalescing e scheduling; produção prefere crypto e o harness injeta streams determinísticos;
   * - manual run remove apenas a espera e reutiliza todas as proofs frescas; intervalos deixam de ter tetos escondidos;
   * - Map/Assistant/Reports/Unit/Template/Capacity são atualizados apenas quando a dependência correspondente vence;
   * - DOM compatível do Assistente/report é usado antes de GET; world map completo vive apenas no runtime e persiste só subsets.
   *
   * Correções 2.0.14:
   * - separa o teto operacional persistente ExecutionRound da CapacityProof das tropas atuais;
   * - minimum-one deixa de limitar a ronda inteira e POST_CURRENT_UNITS pode autorizar successors sem Assistant GET;
   * - SERVER_NO_UNITS grava zero autoritativo com template/composição e nunca origina um POST experimental;
   * - UNKNOWN preserva o ceiling até reconciliação SENT/NOT_SENT e nunca cria blind retry;
   * - composição autoritativa passa a ser explícita no plano e programmer errors deixam de ser mascarados como telemetria;
   * - o world map tem worldRevision e clocks distintos de análise/autorização; rebuild do subset já não finge refresh;
   * - Capacity/Template/Unit tornam-se dependências explícitas e wakes sem trabalho útil deixam de formar loops curtos;
   * - Reavaliar agora mantém as guardas e o scheduling estocástico normal; não força executionDueAt=now;
   * - harness executa runPass real, fixtures de capacidade/zero/UNKNOWN e refresh de autorização do mapa.
   *
   * Hotfix 2.0.14.1:
   * - reserva margem técnica de 5 s para MAP/ASSISTANT/TEMPLATE/CAPACITY antes de criar ExecutionPlan;
   * - MAP reutilizável para envio exige authorizationFreshUntil ainda válido com margem;
   * - CAPACITY wake só continua ExecutionRound OPEN, com budget > 0 e sem pending mutation;
   * - uma ronda CLOSED/EXHAUSTED deixa de ser reaberta implicitamente como successor.
   *
   * Hotfix 2.0.14.2:
   * - CapacityProof mais recente pode substituir uma proof mais forte quando a anterior já não cobre a margem de planeamento;
   * - o planner passa a usar a CapacityProof realmente persistida, evitando divergência entre proof local e CoordinationState;
   * - falhas de criação do ExecutionPlan registam o motivo exato por source/round/janela em vez de apenas "proof expirada/incompleta";
   * - REPORT já agendado não é substituído por uma MAINTENANCE posterior no finally de runPass.
   *
   * Hotfix 2.0.14.3:
   * - ExecutionPlan deixa de persistir o decision adaptativo completo por candidato; o final gate recalcula-o localmente.
   * - falhas de quota no coordinationV2 fazem recuperação limitada apenas sobre NetworkLedger diagnóstico e repetem a escrita.
   * - erros de storage registam nome/mensagem/tamanho aproximado; ground truth, reports, settings e Farm Model nunca são apagados.
   * - PLAN_FAIL/STORAGE regista a causa exata antes da mensagem genérica existente quando a falha é persistência/ronda/janela.
   *
   * Pressupostos:
   * - As aldeias alvo são descobertas automaticamente através de map/village.txt.
   * - O raio é medido a partir da aldeia atual (distância euclidiana do Tribal Wars).
   * - Uma coordenada só é atacada se MapSource confirmar ownerId = 0
   *   (aldeia bárbara) numa proof ainda válida e protegida por revision fencing.
   * - Uma bárbara sem linha no Assistente pode receber o primeiro farm, mas apenas quando
   *   o scan do Assistente tiver cobertura suficiente para provar que ela não está apenas
   *   escondida numa página ainda não lida.
   *
   * Segurança:
   * - NÃO resolve, contorna, oculta nem automatiza CAPTCHA/Bot Protection.
   * - Ao detetar proteção anti-bot, desliga o AutoFarm (fail-closed).
   * - Depois disso, resolve manualmente e recarrega a página antes de voltar a iniciar.
   */

  const VERSION = '2.0.15';
  const COOLDOWN_PARSER_VERSION = 2;
  const MAP_PRESENCE_SCHEMA_VERSION = 1;
  const VISUAL_SCAN_SCHEMA_VERSION = 2;
  const MAP_BOOTSTRAP_CONFIRMATIONS = 2;
  const MAP_BOOTSTRAP_CONFIRM_MIN_MS = 60000;


  const DEFAULTS = Object.freeze({
    enabled: false,
    farmTemplate: 'A',            // apenas templates A/B; C é a ação especial nativa baseada em scout
    radius: 10,                 // raio automático de bárbaras (estilo Barbs Finder)
    cleanCooldownMin: 360,      // saque parcial: 6h
    fullCooldownMin: 0,         // saque cheio: sem cooldown extra
    lossCooldownMin: 720,       // perdas: 12h
    unknownCooldownMin: 30,     // relatório novo não classificado
    retrySeconds: 90,           // intervalo entre verificações
    maxSendsPerPass: 6,
    pendingTimeoutHours: 12,
    scanMaxPages: 20,
    fullRescanMin: 20,
    unmappedPendingRescanMin: 3,
    requestTimeoutSeconds: 20,
    attemptGapMs: 1500,        // piso opcional entre occurrences sucessoras; 0 é permitido
    sendGapMs: 1500,           // legado 1.4.x; usado apenas para migração de definições
    pageFetchGapMs: 150,
    mapRefreshMin: 5,          // validade da MapSource; não implica GET em cada wake
    leaseSeconds: 120,

    // Telemetria/modelo aprendem sempre de reports reais; adaptiveEnabled escolhe
    // apenas entre ranking adaptativo e rotação legada por cooldowns.
    adaptiveEnabled: true,
    adaptivePlanningCapacityMode: 'AUTO',
    adaptiveReferenceCapacity: 160,
    adaptiveHalfLifeHours: 60,
    adaptiveHistoryDays: 7,
    adaptiveMaxUnseenHours: 24,
    adaptiveRevisitFillThreshold: 0.64,
    adaptiveMinDispatchEfficiency: 0.45,
    adaptiveTopK: 5,
    adaptiveSelectionTemperature: 8,
    adaptiveReportFetchPerPass: 4,
    adaptiveEarlyRotationMinHours: 1.5,
    adaptiveMaintenanceMaxHours: 1,
    adaptiveLearningTargetObservations: 3,
    stochasticSchedulingMode: 'ADAPTIVE_SPREAD'
  });

  const RUNTIME = {
    busy: false,
    timer: null,
    templateByVillage: new Map(),
    villageMap: null,
    villageMapLoadedAt: 0,
    villageMapContextKey: '',
    villageMapDerivedFromWorldRevision: 0,
    targetsByVillage: new Map(),
    lastStatus: 'Parado',
    stopReason: '',
    hardStopReasonsByVillage: new Map(),
    activeVillageId: null,
    lastScan: null,
    lastEligibleByVillage: new Map(),
    lastBootstrapByVillage: new Map(),
    lastQueueBreakdownByVillage: new Map(),
    lastServerErrorByVillage: new Map(),
    lastCapacityByVillage: new Map(),
    lastAdaptiveExecutionByVillage: new Map(),
    farmPageSnapshotByVillage: new Map(),
    lastTroopSnapshotByVillage: new Map(),
    farmCacheByVillage: new Map(),
    unitSpeedByHost: new Map(),
    unitInfoByHost: new Map(),
    worldMapByHost: new Map(),
    adaptiveSnapshotByVillage: new Map(),
    mapBootstrapConfirmedByVillage: new Map(),
    mapBootstrapAwaitingByVillage: new Map(),
    nextRunAtByVillage: new Map(),
    lastPassStartedAtByVillage: new Map(),
    lastPassFinishedAtByVillage: new Map(),
    diagLogByVillage: new Map(),
    diagHydratedVillages: new Set(),
    networkOccurrenceByVillage: new Map(),
    networkOccurrenceSeq: 0,
    lastStorageErrorByVillage: new Map(),
    tabId: makeTabId(),
    panelVillageId: null
  };

  // ---------------------------------------------------------------------------
  // UTILITÁRIOS / CONTEXTO
  // ---------------------------------------------------------------------------

  function makeTabId() {
    try {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    } catch (_) {}

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  }

  function diagnosticStorageKey(villageId = currentVillageId()) {
    return `twaf59:diag:${location.host}:p${playerId()}:v${String(villageId || 'unknown')}`;
  }

  function diagnosticLog(villageId = currentVillageId()) {
    const key = String(villageId || '');
    if (!RUNTIME.diagHydratedVillages.has(key)) {
      RUNTIME.diagHydratedVillages.add(key);
      let restored = [];
      try {
        const raw = sessionStorage.getItem(diagnosticStorageKey(villageId));
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) restored = parsed.slice(-180);
      } catch (_) {}
      RUNTIME.diagLogByVillage.set(key, restored);
    }
    return RUNTIME.diagLogByVillage.get(key) || [];
  }

  function diagnosticText(villageId = currentVillageId()) {
    return diagnosticLog(villageId)
      .map(entry => {
        const at = new Date(Number(entry.at) || Date.now()).toLocaleTimeString('pt-PT', { hour12: false });
        const detail = entry.detail ? ` · ${entry.detail}` : '';
        return `[${at}] [${entry.kind || 'INFO'}] ${entry.message || ''}${detail}`;
      })
      .join('\n');
  }

  function addDiagnostic(kind, message, detail = '', villageId = currentVillageId()) {
    // The native TWPF controller persists diagnostics in IndexedDB. Semantic
    // model calls must not revive the standalone sessionStorage/localStorage log.
    if (root.PremiumFeaturesAutoFarmAdaptiveNativeSemanticCall === true) {
      root.PremiumFeaturesDiagnostics?.record?.({
        feature: 'autofarm-adaptive', status: String(kind || 'INFO'),
        reason: String(message || ''), detail: String(detail || ''),
        villageId: String(villageId || ''), at: Date.now()
      });
      return;
    }
    const key = String(villageId || '');
    const list = diagnosticLog(villageId);
    list.push({
      at: Date.now(),
      kind: String(kind || 'INFO').slice(0, 20),
      message: String(message || '').slice(0, 600),
      detail: String(detail || '').slice(0, 900)
    });
    if (list.length > 180) list.splice(0, list.length - 180);
    RUNTIME.diagLogByVillage.set(key, list);
    try {
      sessionStorage.setItem(diagnosticStorageKey(villageId), JSON.stringify(list));
    } catch (_) {}
  }

  function clearDiagnostic(villageId = currentVillageId()) {
    const key = String(villageId || '');
    RUNTIME.diagHydratedVillages.add(key);
    RUNTIME.diagLogByVillage.set(key, []);
    try { sessionStorage.removeItem(diagnosticStorageKey(villageId)); } catch (_) {}
  }

  function networkEndpointClass(url, method = 'GET') {
    const value = String(url || '');
    if (String(method).toUpperCase() === 'POST') return 'EXECUTION_POST';
    if (/map\/village\.txt/i.test(value)) return 'WORLD_MAP';
    if (/screen=report/i.test(value) && /[?&]view=/i.test(value)) return 'REPORT_DETAIL';
    if (/screen=report/i.test(value)) return 'REPORT_INDEX';
    if (/get_unit_info|func=get_unit_info/i.test(value)) return 'UNIT_INFO';
    if (/screen=am_farm/i.test(value)) return 'ASSISTANT';
    return 'OTHER_AUTOFARM';
  }

  function beginNetworkOccurrence(villageId, kind, reason = '') {
    const key = String(villageId || currentVillageId() || 'unknown');
    const existing = RUNTIME.networkOccurrenceByVillage.get(key);
    if (existing && !existing.finishedAt) return existing;
    const occurrence = {
      occurrenceId: `${key}:${Date.now()}:${++RUNTIME.networkOccurrenceSeq}`,
      villageId: key,
      kind: String(kind || 'LOCAL'),
      reason: String(reason || ''),
      startedAt: Date.now(),
      finishedAt: 0,
      gets: 0,
      posts: 0,
      cacheHits: 0,
      avoidedRequests: 0,
      requests: []
    };
    RUNTIME.networkOccurrenceByVillage.set(key, occurrence);
    return occurrence;
  }

  function currentNetworkOccurrence(villageId) {
    const key = String(villageId || currentVillageId() || 'unknown');
    return RUNTIME.networkOccurrenceByVillage.get(key) || beginNetworkOccurrence(key, 'UNSCOPED', 'request fora de occurrence explícita');
  }

  function persistNetworkOccurrence(occurrence) {
    if (!occurrence) return false;
    const villageId = String(occurrence.villageId || currentVillageId() || 'unknown');
    const ledger = loadJSON('networkLedgerV2', [], villageId);
    const list = Array.isArray(ledger) ? ledger : [];
    const normalized = JSON.parse(JSON.stringify(occurrence));
    const index = list.findIndex(item => String(item?.occurrenceId || '') === normalized.occurrenceId);
    if (index >= 0) list[index] = normalized;
    else list.push(normalized);
    return saveJSON('networkLedgerV2', list.slice(-240), villageId);
  }

  function recordNetworkRequest(villageId, method, url, reason = '', requiredFor = '') {
    const occurrence = currentNetworkOccurrence(villageId);
    const normalizedMethod = String(method || 'GET').toUpperCase();
    if (normalizedMethod === 'POST') occurrence.posts += 1;
    else occurrence.gets += 1;
    occurrence.requests.push({
      at: Date.now(),
      method: normalizedMethod,
      endpointClass: networkEndpointClass(url, normalizedMethod),
      reason: String(reason || occurrence.reason || ''),
      requiredFor: String(requiredFor || occurrence.kind || '')
    });
    persistNetworkOccurrence(occurrence);
    return occurrence;
  }

  function recordAvoidedRequest(villageId, source, reason = '') {
    const occurrence = currentNetworkOccurrence(villageId);
    occurrence.cacheHits += 1;
    occurrence.avoidedRequests += 1;
    occurrence.requests.push({
      at: Date.now(), method: 'NONE', endpointClass: String(source || 'LOCAL_CACHE'),
      reason: String(reason || 'proof/snapshot reutilizado'), requiredFor: occurrence.kind
    });
    persistNetworkOccurrence(occurrence);
    return occurrence;
  }

  function endNetworkOccurrence(villageId) {
    const key = String(villageId || currentVillageId() || 'unknown');
    const occurrence = RUNTIME.networkOccurrenceByVillage.get(key);
    if (!occurrence) return null;
    occurrence.finishedAt = Date.now();
    persistNetworkOccurrence(occurrence);
    RUNTIME.networkOccurrenceByVillage.delete(key);
    return occurrence;
  }

  function networkLedgerSummary(villageId = currentVillageId()) {
    const raw = loadJSON('networkLedgerV2', [], villageId);
    const entries = Array.isArray(raw) ? raw : [];
    const totals = entries.reduce((acc, item) => {
      acc.gets += Math.max(0, Number(item?.gets) || 0);
      acc.posts += Math.max(0, Number(item?.posts) || 0);
      acc.cacheHits += Math.max(0, Number(item?.cacheHits) || 0);
      acc.avoidedRequests += Math.max(0, Number(item?.avoidedRequests) || 0);
      if (String(item?.kind || '') === 'BOOT') acc.boots += 1;
      if (String(item?.kind || '') === 'MANUAL') acc.manualRuns += 1;
      return acc;
    }, { gets: 0, posts: 0, cacheHits: 0, avoidedRequests: 0, boots: 0, manualRuns: 0 });
    const last = entries.length ? entries[entries.length - 1] : null;
    return { occurrences: entries.length, ...totals, last };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function numberAtLeast(value, min, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, n);
  }

  // Number(null), Number('') e Number(false) valem zero em JavaScript. Para dados
  // observacionais isso confunde "ausente" com um zero real e contamina o modelo.
  function finiteObservedNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function adaptiveCapacityExcessQuality(capacity, loot) {
    const cap = finiteObservedNumber(capacity);
    const got = finiteObservedNumber(loot);
    if (cap === null || !(cap > 0) || got === null) {
      return { excess: 0, tolerance: 0, adjusted: false, anomaly: false };
    }
    const excess = Math.max(0, got - cap);
    // Diferenças minúsculas surgem por arredondamento/bónus ou por markup de
    // mundos diferentes. Mantemos X/Y bruto no ledger, limitamos a eficiência
    // a 100% e só elevamos erro quando o desvio excede 2% (mínimo 2 recursos).
    const tolerance = Math.max(2, cap * 0.02);
    return {
      excess,
      tolerance,
      adjusted: excess > 0 && excess <= tolerance,
      anomaly: excess > tolerance
    };
  }

  function hasObservedNumber(value) {
    return finiteObservedNumber(value) !== null;
  }

  function codedError(code, message = code) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function topWin() {
    try { return window.top || window; }
    catch (_) { return window; }
  }

  function gameData() {
    try { return topWin().game_data || window.game_data || {}; }
    catch (_) { return window.game_data || {}; }
  }

  function currentVillageId() {
    return String(gameData()?.village?.id || '');
  }


  function currentVillageCoord() {
    const village = gameData()?.village || {};

    const direct = String(village.coord || village.coords || '');
    const directMatch = direct.match(/^(\d{3})\|(\d{3})$/);
    if (directMatch) return `${directMatch[1]}|${directMatch[2]}`;

    const x = Number(village.x);
    const y = Number(village.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return `${x}|${y}`;

    return null;
  }

  function targetCoords(villageId = currentVillageId()) {
    const key = String(villageId || '');
    const live = RUNTIME.targetsByVillage.get(key);
    if (Array.isArray(live)) return live;

    const saved = loadJSON('dynamicTargets', [], villageId);
    return Array.isArray(saved) ? saved.filter(coord => /^\d{3}\|\d{3}$/.test(String(coord))) : [];
  }

  function setTargetCoords(coords, villageId = currentVillageId()) {
    const clean = [...new Set((coords || []).map(String).filter(coord => /^\d{3}\|\d{3}$/.test(coord)))];
    RUNTIME.targetsByVillage.set(String(villageId || ''), clean);
    saveJSON('dynamicTargets', clean, villageId);
    return clean;
  }

  function playerId() {
    return String(gameData()?.player?.id || 'unknown');
  }

  function isFarmPage() {
    try {
      return new URL(location.href).searchParams.get('screen') === 'am_farm';
    } catch (_) {
      return false;
    }
  }

  function assertVillageContext(villageId) {
    if (!villageId) {
      throw codedError('NO_VILLAGE_CONTEXT', 'Não foi possível identificar a aldeia atual.');
    }

    if (currentVillageId() !== String(villageId)) {
      throw codedError('VILLAGE_CHANGED', 'A aldeia ativa mudou durante a passagem.');
    }
  }

  function info(message, error = false) {
    RUNTIME.lastStatus = message;
    addDiagnostic(error ? 'ERRO' : 'INFO', message);
    renderPanel();

    const w = topWin();
    try {
      if (error && w.UI?.ErrorMessage) w.UI.ErrorMessage(message, 5000);
      else if (w.UI?.InfoMessage) w.UI.InfoMessage(message, 2500);
    } catch (_) {}

    const logger = error ? console.error : console.log;
    logger('[AutoFarmRadius]', message);
  }

  // ---------------------------------------------------------------------------
  // STORAGE / CONFIGURAÇÃO
  // ---------------------------------------------------------------------------

  function storagePrefix(villageId = currentVillageId()) {
    return `twaf59:${location.host}:p${playerId()}:v${String(villageId || 'unknown')}:`;
  }

  function storageKey(key, villageId = currentVillageId()) {
    return storagePrefix(villageId) + key;
  }

  function loadJSON(key, fallback, villageId = currentVillageId()) {
    try {
      const raw = localStorage.getItem(storageKey(key, villageId));
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn('[AutoFarmRadius] falha a ler localStorage:', key, err);
      return fallback;
    }
  }

  function saveJSON(key, value, villageId = currentVillageId()) {
    try {
      localStorage.setItem(storageKey(key, villageId), JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('[AutoFarmRadius] falha a gravar localStorage:', key, err);
      return false;
    }
  }

  function saveJSONIfChanged(key, value, villageId = currentVillageId()) {
    const villageKey = String(villageId || 'unknown');
    let serialized = '';
    try {
      const storage = storageKey(key, villageId);
      serialized = JSON.stringify(value);
      if (localStorage.getItem(storage) === serialized) {
        RUNTIME.lastStorageErrorByVillage.delete(villageKey);
        return true;
      }
      localStorage.setItem(storage, serialized);
      RUNTIME.lastStorageErrorByVillage.delete(villageKey);
      return true;
    } catch (err) {
      const detail = {
        at: Date.now(),
        key: String(key || ''),
        name: String(err?.name || 'Error'),
        message: String(err?.message || err || ''),
        serializedChars: serialized.length
      };
      RUNTIME.lastStorageErrorByVillage.set(villageKey, detail);
      console.error('[AutoFarmRadius] falha a gravar localStorage:', key, err);
      addDiagnostic(
        'STORAGE',
        'Falha ao persistir localStorage.',
        `${detail.key} · ${detail.name} · ${detail.message || 'sem mensagem'} · ~${detail.serializedChars} chars`,
        villageId
      );
      return false;
    }
  }

  function storageWriteErrorLooksLikeQuota(error) {
    const text = `${String(error?.name || '')} ${String(error?.message || '')}`;
    return /quota|QuotaExceeded|NS_ERROR_DOM_QUOTA_REACHED/i.test(text);
  }

  function trimNetworkLedgerForStoragePressure(villageId, keep = 60) {
    const limit = Math.max(0, Math.trunc(Number(keep) || 0));
    try {
      const key = storageKey('networkLedgerV2', villageId);
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length <= limit) return 0;
      const trimmed = parsed.slice(-limit);
      localStorage.setItem(key, JSON.stringify(trimmed));
      return parsed.length - trimmed.length;
    } catch (err) {
      console.warn('[AutoFarmRadius] não foi possível compactar NetworkLedger:', err);
      return 0;
    }
  }

  function removeJSON(key, villageId = currentVillageId()) {
    try {
      localStorage.removeItem(storageKey(key, villageId));
    } catch (_) {}
  }

  function accountHardStopStorageKey() {
    return `twaf59:${location.host}:p${playerId()}:accountHardStop`;
  }

  function accountHardStopState() {
    try {
      const raw = localStorage.getItem(accountHardStopStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.active === true ? parsed : null;
    } catch (_) {
      return null;
    }
  }


  function accountHardStopActive() {
    return Boolean(accountHardStopState());
  }

  function knownAccountVillageIds() {
    const prefix = `twaf59:${location.host}:p${playerId()}:v`;
    const out = new Set();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = String(localStorage.key(i) || '');
        if (!key.startsWith(prefix)) continue;
        const villageId = key.slice(prefix.length).split(':')[0];
        if (villageId) out.add(villageId);
      }
    } catch (_) {}
    const active = currentVillageId();
    if (active) out.add(String(active));
    return [...out];
  }

  function normalizeCfg(raw = {}) {
    const template = String(raw.farmTemplate || DEFAULTS.farmTemplate).toUpperCase();
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
      // C não é um terceiro template: é a ação especial do jogo baseada no report
      // de espionagem. Configurações antigas com C migram de forma fail-closed para A.
      farmTemplate: ['A', 'B'].includes(template) ? template : DEFAULTS.farmTemplate,
      radius: clampNumber(raw.radius, 1, 150, DEFAULTS.radius),
      cleanCooldownMin: clampNumber(raw.cleanCooldownMin, 1, 10080, DEFAULTS.cleanCooldownMin),
      fullCooldownMin: clampNumber(raw.fullCooldownMin, 0, 10080, DEFAULTS.fullCooldownMin),
      lossCooldownMin: clampNumber(raw.lossCooldownMin, 1, 43200, DEFAULTS.lossCooldownMin),
      unknownCooldownMin: clampNumber(raw.unknownCooldownMin, 1, 10080, DEFAULTS.unknownCooldownMin),
      // Sem teto artificial: este valor é o piso entre passagens automáticas
      // completas e começa a contar quando a passagem anterior termina.
      retrySeconds: numberAtLeast(raw.retrySeconds, 15, DEFAULTS.retrySeconds),
      maxSendsPerPass: clampNumber(raw.maxSendsPerPass, 1, 100, DEFAULTS.maxSendsPerPass),
      pendingTimeoutHours: clampNumber(raw.pendingTimeoutHours, 1, 168, DEFAULTS.pendingTimeoutHours),
      scanMaxPages: clampNumber(raw.scanMaxPages, 1, 100, DEFAULTS.scanMaxPages),
      fullRescanMin: clampNumber(raw.fullRescanMin, 1, 120, DEFAULTS.fullRescanMin),
      unmappedPendingRescanMin: clampNumber(raw.unmappedPendingRescanMin, 1, 30, DEFAULTS.unmappedPendingRescanMin),
      requestTimeoutSeconds: clampNumber(raw.requestTimeoutSeconds, 5, 60, DEFAULTS.requestTimeoutSeconds),
      // Não há teto nem piso artificial entre occurrences. A arquitetura já
      // garante uma única mutation por occurrence e limita o instante à janela
      // barata das proofs; zero continua a não permitir uma rajada num só wake.
      attemptGapMs: numberAtLeast(
        raw.attemptGapMs ?? raw.sendGapMs,
        0,
        DEFAULTS.attemptGapMs
      ),
      sendGapMs: clampNumber(raw.sendGapMs, 500, 10000, DEFAULTS.sendGapMs),
      pageFetchGapMs: clampNumber(raw.pageFetchGapMs, 0, 5000, DEFAULTS.pageFetchGapMs),
      mapRefreshMin: clampNumber(raw.mapRefreshMin, 1, 60, DEFAULTS.mapRefreshMin),
      leaseSeconds: clampNumber(raw.leaseSeconds, 30, 600, DEFAULTS.leaseSeconds),
      adaptiveEnabled: typeof raw.adaptiveEnabled === 'boolean' ? raw.adaptiveEnabled : DEFAULTS.adaptiveEnabled,
      adaptivePlanningCapacityMode: String(raw.adaptivePlanningCapacityMode || DEFAULTS.adaptivePlanningCapacityMode).toUpperCase() === 'MANUAL'
        ? 'MANUAL'
        : 'AUTO',
      adaptiveReferenceCapacity: clampNumber(raw.adaptiveReferenceCapacity, 40, 2000, DEFAULTS.adaptiveReferenceCapacity),
      adaptiveHalfLifeHours: clampNumber(raw.adaptiveHalfLifeHours, 12, 336, DEFAULTS.adaptiveHalfLifeHours),
      adaptiveHistoryDays: Math.trunc(clampNumber(raw.adaptiveHistoryDays, 3, 7, DEFAULTS.adaptiveHistoryDays)),
      adaptiveMaxUnseenHours: clampNumber(raw.adaptiveMaxUnseenHours, 6, 168, DEFAULTS.adaptiveMaxUnseenHours),
      adaptiveRevisitFillThreshold: clampNumber(raw.adaptiveRevisitFillThreshold, 0.30, 0.95, DEFAULTS.adaptiveRevisitFillThreshold),
      adaptiveMinDispatchEfficiency: clampNumber(raw.adaptiveMinDispatchEfficiency, 0.10, 0.95, DEFAULTS.adaptiveMinDispatchEfficiency),
      adaptiveTopK: clampNumber(raw.adaptiveTopK, 1, 12, DEFAULTS.adaptiveTopK),
      adaptiveSelectionTemperature: clampNumber(raw.adaptiveSelectionTemperature, 0.5, 30, DEFAULTS.adaptiveSelectionTemperature),
      adaptiveReportFetchPerPass: clampNumber(raw.adaptiveReportFetchPerPass, 1, 12, DEFAULTS.adaptiveReportFetchPerPass),
      adaptiveEarlyRotationMinHours: clampNumber(raw.adaptiveEarlyRotationMinHours, 0.5, 12, DEFAULTS.adaptiveEarlyRotationMinHours),
      adaptiveMaintenanceMaxHours: numberAtLeast(raw.adaptiveMaintenanceMaxHours, 0.25, DEFAULTS.adaptiveMaintenanceMaxHours),
      adaptiveLearningTargetObservations: Math.trunc(clampNumber(raw.adaptiveLearningTargetObservations, 1, 8, DEFAULTS.adaptiveLearningTargetObservations)),
      stochasticSchedulingMode: String(raw.stochasticSchedulingMode || DEFAULTS.stochasticSchedulingMode).toUpperCase() === 'IMMEDIATE_EFFICIENCY'
        ? 'IMMEDIATE_EFFICIENCY'
        : 'ADAPTIVE_SPREAD'
    };
  }

  function cfg(villageId = currentVillageId()) {
    return normalizeCfg({
      ...DEFAULTS,
      ...loadJSON('settings', {}, villageId)
    });
  }

  function saveCfg(value, villageId = currentVillageId()) {
    return saveJSON('settings', normalizeCfg(value), villageId);
  }

  const COORDINATION_SCHEMA_VERSION = 2;
  // Uma confirmação inequívoca de falta de tropas é uma proof curta, mas real.
  // O expiry obriga o planner a reconstruir capacidade; nunca autoriza um POST.
  const CAPACITY_ZERO_TTL_MS = 60000;
  const CAPACITY_POST_UNITS_TTL_MS = 90000;
  const CAPACITY_ASSISTANT_EXACT_TTL_MS = 120000;
  const CAPACITY_ASSISTANT_MINIMUM_TTL_MS = 45000;
  const MAP_AUTHORIZATION_MIN_TTL_MS = 30000;
  const MAP_AUTHORIZATION_MAX_TTL_MS = 120000;
  const PLAN_PROOF_MARGIN_MS = 5000;
  const COORDINATION_STATES = Object.freeze([
    'DISABLED', 'WAITING_WORK', 'WAITING_EXECUTION', 'EXECUTING',
    'UNKNOWN', 'RECONCILING', 'SOFT_PAUSED', 'HARD_STOP'
  ]);
  const SCHEDULER_WAKE_KINDS = Object.freeze([
    'EXECUTION', 'OBSERVATION', 'CAPACITY', 'REPORT', 'RECONCILIATION', 'MAINTENANCE', 'LEASE_RECOVERY'
  ]);
  const SOURCE_NAMES = Object.freeze([
    'MAP', 'ASSISTANT', 'REPORT', 'UNIT', 'TEMPLATE', 'CAPACITY', 'EXECUTION', 'MAINTENANCE'
  ]);
  const STOCHASTIC_TEMPORAL_PROFILES = Object.freeze([
    'VERY_EARLY', 'EARLY', 'EARLY_MID', 'MID', 'LATE_MID', 'LATE', 'VERY_LATE'
  ]);

  function emptyCoordinationSource(name) {
    return {
      source: String(name || 'UNKNOWN'),
      status: 'UNKNOWN',
      observedAt: 0,
      freshUntil: 0,
      invalidated: false,
      revision: 0,
      inFlight: false,
      nextRequiredAt: 0,
      reason: '',
      data: null
    };
  }

  function normalizeCoordinationSource(raw, name) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      source: String(name || x.source || 'UNKNOWN'),
      status: String(x.status || 'UNKNOWN'),
      observedAt: Math.max(0, Number(x.observedAt) || 0),
      freshUntil: Math.max(0, Number(x.freshUntil) || 0),
      invalidated: Boolean(x.invalidated),
      revision: Math.max(0, Math.trunc(Number(x.revision) || 0)),
      inFlight: Boolean(x.inFlight),
      nextRequiredAt: Math.max(0, Number(x.nextRequiredAt) || 0),
      reason: String(x.reason || ''),
      data: x.data === undefined ? null : x.data
    };
  }

  function normalizeStochasticPlan(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      cycleId: String(x.cycleId || ''),
      generation: Math.max(0, Math.trunc(Number(x.generation) || 0)),
      planRevision: Math.max(0, Math.trunc(Number(x.planRevision) || 0)),
      ownerId: String(x.ownerId || ''),
      mode: String(x.mode || 'ADAPTIVE_SPREAD'),
      randomNamespace: String(x.randomNamespace || 'scheduling'),
      coalescingRandomNamespace: String(x.coalescingRandomNamespace || x.randomNamespace || 'coalescing'),
      schedulingRandomNamespace: String(x.schedulingRandomNamespace || x.randomNamespace || 'scheduling'),
      coalesceLow: Math.max(0, Math.trunc(Number(x.coalesceLow) || 0)),
      coalesceHigh: Math.max(0, Math.trunc(Number(x.coalesceHigh) || 0)),
      targetProfile: String(x.targetProfile || ''),
      coalesceTarget: Math.max(0, Math.trunc(Number(x.coalesceTarget) || 0)),
      eligibleAt: Math.max(0, Number(x.eligibleAt) || 0),
      coalesceUntil: Math.max(0, Number(x.coalesceUntil) || 0),
      maxHoldAt: Math.max(0, Number(x.maxHoldAt) || 0),
      cheapWindowStart: Math.max(0, Number(x.cheapWindowStart) || 0),
      cheapWindowEnd: Math.max(0, Number(x.cheapWindowEnd) || 0),
      localWindowStart: Math.max(0, Number(x.localWindowStart ?? x.cheapWindowStart) || 0),
      localWindowEnd: Math.max(0, Number(x.localWindowEnd ?? x.cheapWindowEnd) || 0),
      temporalProfile: String(x.temporalProfile || ''),
      stochasticSubwindowStart: Math.max(0, Number(x.stochasticSubwindowStart) || 0),
      stochasticSubwindowEnd: Math.max(0, Number(x.stochasticSubwindowEnd) || 0),
      executionDueAt: Math.max(0, Number(x.executionDueAt) || 0),
      manualOverrideAt: Math.max(0, Number(x.manualOverrideAt) || 0),
      createdAt: Math.max(0, Number(x.createdAt) || 0)
    };
  }

  function normalizeCapacityProof(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const legacyValue = finiteObservedNumber(x.capacity);
    const value = finiteObservedNumber(x.value) ?? legacyValue;
    return {
      value: value === null ? null : Math.max(0, Math.trunc(value)),
      exact: Boolean(x.exact),
      authoritative: Boolean(x.authoritative),
      observedAt: Math.max(0, Number(x.observedAt) || 0),
      freshUntil: Math.max(0, Number(x.freshUntil) || 0),
      source: String(x.source || ''),
      templateId: String(x.templateId || ''),
      farmTemplate: ['A', 'B'].includes(String(x.farmTemplate)) ? String(x.farmTemplate) : '',
      composition: x.composition && typeof x.composition === 'object' ? x.composition : null,
      compositionAuthoritative: Boolean(x.compositionAuthoritative),
      currentUnits: x.currentUnits && typeof x.currentUnits === 'object' ? x.currentUnits : null,
      sourceVillageId: String(x.sourceVillageId || ''),
      derivedFrom: String(x.derivedFrom || '')
    };
  }

  function capacityProofFromSource(source) {
    const normalized = normalizeCoordinationSource(source, 'CAPACITY');
    const proof = normalizeCapacityProof({
      ...(normalized.data || {}),
      observedAt: normalized.data?.observedAt || normalized.observedAt,
      freshUntil: normalized.data?.freshUntil || normalized.freshUntil,
      source: normalized.data?.source || normalized.reason
    });
    return proof.value === null ? null : proof;
  }

  function capacityProofContextMatches(proof, context = {}) {
    const p = normalizeCapacityProof(proof);
    if (p.value === null) return false;
    if (context.sourceVillageId && p.sourceVillageId !== String(context.sourceVillageId)) return false;
    if (context.templateId && p.templateId !== String(context.templateId)) return false;
    if (context.farmTemplate && p.farmTemplate !== String(context.farmTemplate)) return false;
    return true;
  }

  function capacityProofUsable(proof, context = {}, now = Date.now()) {
    const p = normalizeCapacityProof(proof);
    return p.value !== null && p.observedAt > 0 && p.freshUntil >= Number(now) &&
      capacityProofContextMatches(p, context);
  }

  function capacityProofPatch(proof, reason = '') {
    const p = normalizeCapacityProof(proof);
    return {
      status: 'READY',
      observedAt: p.observedAt,
      freshUntil: p.freshUntil,
      invalidated: false,
      reason: String(reason || p.source || 'CapacityProof'),
      data: { ...p, capacity: p.value }
    };
  }

  function capacityProofStrength(proof) {
    const p = normalizeCapacityProof(proof);
    const provenance = ({
      SERVER_NO_UNITS: 50,
      POST_CURRENT_UNITS: 50,
      ASSISTANT_CURRENT_UNITS: 40,
      ASSISTANT_MINIMUM_ONE: 20,
      ASSISTANT_ZERO_SIGNAL: 20
    })[p.source] || 0;
    return provenance + (p.authoritative ? 8 : 0) + (p.exact ? 4 : 0);
  }

  function shouldReplaceCapacityProof(previousProof, candidateProof, now = Date.now()) {
    const previous = normalizeCapacityProof(previousProof);
    const candidate = normalizeCapacityProof(candidateProof);
    const at = Number(now);
    if (candidate.value === null) return false;
    if (previous.value === null) return true;
    if (!capacityProofContextMatches(previous, candidate)) return true;
    if (['SERVER_NO_UNITS', 'POST_CURRENT_UNITS'].includes(candidate.source)) return true;
    // Uma proof anterior pode ser mais forte, mas se já não cobre a margem mínima
    // necessária para criar um ExecutionPlan ela não pode bloquear uma observação
    // mais recente e operacionalmente utilizável do Assistente.
    if (previous.freshUntil < at + PLAN_PROOF_MARGIN_MS && candidate.observedAt >= previous.observedAt) return true;
    if (previous.freshUntil < at) return true;
    if (candidate.observedAt < previous.observedAt) return false;
    return capacityProofStrength(candidate) >= capacityProofStrength(previous);
  }

  function persistCapacityProof(villageId, proof, reason = '') {
    const candidate = normalizeCapacityProof(proof);
    const currentSource = coordinationState(villageId).sources.CAPACITY;
    const previous = capacityProofFromSource(currentSource);
    if (!shouldReplaceCapacityProof(previous, candidate)) return currentSource;
    return touchCoordinationSource(villageId, 'CAPACITY', capacityProofPatch(candidate, reason));
  }

  function normalizeExecutionRound(raw, fallback = {}) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const configuredLimit = Math.max(0, Math.trunc(Number(x.configuredLimit ?? fallback.configuredLimit) || 0));
    const remainingLegacy = finiteObservedNumber(x.dispatchLimitRemaining) ??
      finiteObservedNumber(fallback.dispatchLimitRemaining) ?? configuredLimit;
    return {
      executionRoundId: String(x.executionRoundId || fallback.executionRoundId || ''),
      cycleId: String(x.cycleId || fallback.cycleId || ''),
      generation: Math.max(0, Math.trunc(Number(x.generation ?? fallback.generation) || 0)),
      planRevision: Math.max(0, Math.trunc(Number(x.planRevision ?? fallback.planRevision) || 0)),
      sourceVillageId: String(x.sourceVillageId || fallback.sourceVillageId || ''),
      configuredLimit,
      dispatchLimitRemaining: Math.max(0, Math.min(configuredLimit || Number.MAX_SAFE_INTEGER, Math.trunc(remainingLegacy))),
      createdAt: Math.max(0, Number(x.createdAt || fallback.createdAt) || 0),
      status: String(x.status || fallback.status || 'OPEN'),
      reason: String(x.reason || fallback.reason || ''),
      pendingMutation: x.pendingMutation && typeof x.pendingMutation === 'object'
        ? { ...x.pendingMutation }
        : (fallback.pendingMutation && typeof fallback.pendingMutation === 'object' ? { ...fallback.pendingMutation } : null)
    };
  }

  function consumeConfirmedDispatch(round) {
    const current = normalizeExecutionRound(round);
    return normalizeExecutionRound({
      ...current,
      dispatchLimitRemaining: Math.max(0, current.dispatchLimitRemaining - 1),
      pendingMutation: null,
      status: current.dispatchLimitRemaining <= 1 ? 'EXHAUSTED' : 'OPEN',
      reason: 'mutation confirmada'
    });
  }

  function reconcileExecutionRoundOutcome(round, outcome) {
    const current = normalizeExecutionRound(round);
    const result = String(outcome || 'STILL_UNKNOWN').toUpperCase();
    if (result === 'SENT') return consumeConfirmedDispatch(current);
    if (result === 'NOT_SENT') return normalizeExecutionRound({
      ...current, pendingMutation: null, status: 'OPEN', reason: 'reconciliação confirmou NOT_SENT'
    });
    return normalizeExecutionRound({
      ...current, status: 'UNKNOWN', reason: 'mutation continua por reconciliar'
    });
  }

  function successorDispatchBudget(round, proof, remainingCandidates, context = {}, now = Date.now()) {
    const r = normalizeExecutionRound(round);
    const p = normalizeCapacityProof(proof);
    if (!capacityProofUsable(p, context, now) || !(p.value > 0)) return 0;
    return Math.max(0, Math.min(
      r.dispatchLimitRemaining,
      Math.trunc(p.value),
      Math.max(0, Math.trunc(Number(remainingCandidates) || 0))
    ));
  }

  function capacityProofAfterConfirmedPost(previousProof, serverUnits, executionPlan, responseAt = Date.now()) {
    const plan = normalizeExecutionPlan(executionPlan);
    const units = normalizeUnitCounts(serverUnits, true);
    const exactCapacity = units && plan.compositionAuthoritative && plan.composition
      ? capacityForComposition(plan.composition, units)
      : null;
    if (Number.isFinite(exactCapacity)) {
      return normalizeCapacityProof({
        value: Math.max(0, exactCapacity),
        exact: true,
        authoritative: true,
        observedAt: responseAt,
        freshUntil: responseAt + CAPACITY_POST_UNITS_TTL_MS,
        source: 'POST_CURRENT_UNITS',
        templateId: plan.templateId,
        farmTemplate: plan.farmTemplate,
        composition: plan.composition,
        compositionAuthoritative: true,
        currentUnits: units,
        sourceVillageId: plan.sourceVillageId
      });
    }
    // A mutation confirmada alterou o estado das tropas. Sem current_units
    // parseáveis não existe uma nova observação server-side e nenhuma proof
    // pré-mutation pode continuar a autorizar POSTs.
    return null;
  }

  function invalidateCapacityProofAfterMutation(villageId, executionPlan, observedAt = Date.now()) {
    const plan = normalizeExecutionPlan(executionPlan);
    return touchCoordinationSource(villageId, 'CAPACITY', {
      status: 'STALE',
      observedAt: Math.max(1, Number(observedAt) || Date.now()),
      freshUntil: 0,
      invalidated: true,
      nextRequiredAt: 0,
      reason: 'MUTATION_CONFIRMED_WITHOUT_CURRENT_UNITS',
      data: {
        value: null,
        capacity: null,
        exact: false,
        authoritative: false,
        observedAt: Math.max(1, Number(observedAt) || Date.now()),
        freshUntil: 0,
        source: 'MUTATION_BOUNDARY_INVALIDATION',
        templateId: plan.templateId,
        farmTemplate: plan.farmTemplate,
        composition: plan.composition,
        compositionAuthoritative: plan.compositionAuthoritative,
        sourceVillageId: String(villageId || plan.sourceVillageId)
      }
    });
  }

  function serverNoUnitsCapacityProof(executionPlan, villageId, observedAt = Date.now()) {
    const plan = normalizeExecutionPlan(executionPlan);
    return normalizeCapacityProof({
      value: 0,
      exact: true,
      authoritative: true,
      observedAt,
      freshUntil: observedAt + CAPACITY_ZERO_TTL_MS,
      source: 'SERVER_NO_UNITS',
      templateId: plan.templateId,
      farmTemplate: plan.farmTemplate,
      composition: plan.composition,
      compositionAuthoritative: plan.compositionAuthoritative,
      sourceVillageId: String(villageId || plan.sourceVillageId)
    });
  }

  function normalizeExecutionPlan(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      executionRoundId: String(x.executionRoundId || ''),
      cycleId: String(x.cycleId || ''),

      generation: Math.max(0, Math.trunc(Number(x.generation) || 0)),
      planRevision: Math.max(0, Math.trunc(Number(x.planRevision) || 0)),
      createdAt: Math.max(0, Number(x.createdAt) || 0),
      notBeforeAt: Math.max(0, Number(x.notBeforeAt ?? x.immutableNotBeforeAt) || 0),
      sourceVillageId: String(x.sourceVillageId || ''),
      radius: Math.max(0, Number(x.radius) || 0),
      farmTemplate: ['A', 'B'].includes(String(x.farmTemplate)) ? String(x.farmTemplate) : 'A',
      templateId: String(x.templateId || ''),
      candidates: Array.isArray(x.candidates) ? x.candidates.filter(Boolean).slice(0, 100) : [],
      dispatchLimitRemaining: Math.max(0, Math.trunc(Number(x.dispatchLimitRemaining ?? x.remainingBudget) || 0)),
      capacityProof: normalizeCapacityProof(x.capacityProof || {
        value: x.remainingBudget,
        exact: x.capacityProofExact,
        authoritative: x.capacityProofExact,
        observedAt: x.createdAt,
        freshUntil: x.createdAt,
        source: 'LEGACY_PLAN',
        templateId: x.templateId,
        farmTemplate: x.farmTemplate,
        composition: x.composition,
        compositionAuthoritative: Boolean(x.composition),
        sourceVillageId: x.sourceVillageId
      }),
      composition: x.composition && typeof x.composition === 'object' ? x.composition : null,
      compositionAuthoritative: Boolean(x.compositionAuthoritative),
      transportCapacity: finiteObservedNumber(x.transportCapacity),
      unitInfo: x.unitInfo && typeof x.unitInfo === 'object' ? x.unitInfo : null,
      storeRevision: Math.max(0, Number(x.storeRevision) || 0),
      sourceRevisions: x.sourceRevisions && typeof x.sourceRevisions === 'object' ? x.sourceRevisions : {},
      requiredSources: Array.isArray(x.requiredSources) ? x.requiredSources.map(String) : ['MAP', 'ASSISTANT', 'TEMPLATE', 'CAPACITY'],
      reason: String(x.reason || '')
    };
  }

  function normalizeCoordinationState(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sources = {};
    for (const name of SOURCE_NAMES) sources[name] = normalizeCoordinationSource(x.sources?.[name], name);
    const wakeKind = SCHEDULER_WAKE_KINDS.includes(String(x.wakeKind)) ? String(x.wakeKind) : 'MAINTENANCE';
    const state = COORDINATION_STATES.includes(String(x.state)) ? String(x.state) : 'WAITING_WORK';
    return {
      schema: COORDINATION_SCHEMA_VERSION,
      generation: Math.max(0, Math.trunc(Number(x.generation) || 0)),
      planRevision: Math.max(0, Math.trunc(Number(x.planRevision) || 0)),
      state,
      ownerId: String(x.ownerId || ''),
      nextWakeAt: Math.max(0, Number(x.nextWakeAt) || 0),
      wakeKind,
      observationFloorAt: Math.max(0, Number(x.observationFloorAt) || 0),
      executionDueAt: Math.max(0, Number(x.executionDueAt) || 0),
      maintenanceDueAt: Math.max(0, Number(x.maintenanceDueAt) || 0),
      reportDueAt: Math.max(0, Number(x.reportDueAt) || 0),
      reconcileDueAt: Math.max(0, Number(x.reconcileDueAt) || 0),
      leaseRecoveryDueAt: Math.max(0, Number(x.leaseRecoveryDueAt) || 0),
      sources,
      executionRound: x.executionRound ? normalizeExecutionRound(x.executionRound) : null,
      executionPlan: x.executionPlan ? normalizeExecutionPlan(x.executionPlan) : null,
      stochasticPlan: x.stochasticPlan ? normalizeStochasticPlan(x.stochasticPlan) : null,
      reason: String(x.reason || ''),
      updatedAt: Math.max(0, Number(x.updatedAt) || 0)
    };
  }

  function coordinationState(villageId = currentVillageId()) {
    return normalizeCoordinationState(loadJSON('coordinationV2', {}, villageId));
  }

  function saveCoordinationState(value, villageId = currentVillageId()) {
    const next = normalizeCoordinationState({ ...value, updatedAt: Date.now() });
    if (saveJSONIfChanged('coordinationV2', next, villageId)) return next;

    const villageKey = String(villageId || 'unknown');
    const firstError = RUNTIME.lastStorageErrorByVillage.get(villageKey);
    if (!storageWriteErrorLooksLikeQuota(firstError)) return null;

    // NetworkLedgerV2 é apenas telemetria. Em pressão real de quota reduzimos
    // primeiro esse histórico; nunca tocamos no Farm Model, reports, dispatches,
    // settings ou provas operacionais.
    const localRemoved = trimNetworkLedgerForStoragePressure(villageId, 60);
    if (localRemoved > 0 && saveJSONIfChanged('coordinationV2', next, villageId)) {
      addDiagnostic(
        'STORAGE',
        'coordinationV2 persistido após compactar telemetria local.',
        `NetworkLedger removeu ${localRemoved} occurrence(s); ground truth preservado`,
        villageId
      );
      return next;
    }

    let accountRemoved = trimNetworkLedgerForStoragePressure(villageId, 20);
    for (const otherVillageId of knownAccountVillageIds()) {
      if (String(otherVillageId) === villageKey) continue;
      accountRemoved += trimNetworkLedgerForStoragePressure(otherVillageId, 20);
    }
    if (accountRemoved > 0 && saveJSONIfChanged('coordinationV2', next, villageId)) {
      addDiagnostic(
        'STORAGE',
        'coordinationV2 persistido após compactar telemetria da conta.',
        `NetworkLedger removeu ${accountRemoved} occurrence(s) noutras aldeias; ground truth preservado`,
        villageId
      );
      return next;
    }

    const finalError = RUNTIME.lastStorageErrorByVillage.get(villageKey) || firstError || {};
    addDiagnostic(
      'STORAGE',
      'Quota/persistência continua insuficiente; fail-closed.',
      `${finalError.name || 'Error'} · ${finalError.message || 'sem mensagem'} · nenhum POST`,
      villageId
    );
    return null;
  }

  function touchCoordinationSource(villageId, sourceName, patch = {}) {
    const current = coordinationState(villageId);
    const name = SOURCE_NAMES.includes(String(sourceName)) ? String(sourceName) : null;
    if (!name) return null;
    const previous = current.sources[name];
    current.sources[name] = normalizeCoordinationSource({
      ...previous,
      ...patch,
      source: name,
      revision: Math.max(Number(previous.revision) + 1, Number(patch.revision) || 0)
    }, name);
    return saveCoordinationState(current, villageId);
  }

  function coordinationSourceFreshForPlanning(source, now = Date.now()) {
    const x = normalizeCoordinationSource(source, source?.source || 'UNKNOWN');
    return (
      !x.invalidated &&
      x.status === 'READY' &&
      x.observedAt > 0 &&
      x.freshUntil >= Number(now) + PLAN_PROOF_MARGIN_MS
    );
  }

  function mapAuthorizationFreshForPlanning(source, now = Date.now()) {
    return (
      coordinationSourceFreshForPlanning(source, now) &&
      Number(source?.data?.authorizationFreshUntil || 0) >=
        Number(now) + PLAN_PROOF_MARGIN_MS
    );
  }

  function coordinationSourceFresh(source, now = Date.now()) {
    const x = normalizeCoordinationSource(source, source?.source || 'UNKNOWN');
    return !x.invalidated && x.status === 'READY' && x.observedAt > 0 && x.freshUntil >= Number(now);
  }

  function createRandomSource(fixture = null, namespace = 'generic') {
    const values = Array.isArray(fixture) ? fixture.map(Number) : null;
    let index = 0;
    const nextFloat = () => {
      if (values) {
        const value = values[index++ % Math.max(1, values.length)];
        return Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(value) ? value : 0));
      }
      try {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return buf[0] / 4294967296;
      } catch (_) {
        return Math.random();
      }
    };
    return {
      namespace: String(namespace || 'generic'),
      nextFloat,
      nextInt(min, max) {
        const lo = Math.ceil(Math.min(Number(min), Number(max)));
        const hi = Math.floor(Math.max(Number(min), Number(max)));
        return lo + Math.floor(nextFloat() * Math.max(1, hi - lo + 1));
      },
      chooseWeighted(options) {
        const list = (Array.isArray(options) ? options : []).filter(option => Number(option?.weight) > 0);
        if (!list.length) return null;
        const total = list.reduce((sum, option) => sum + Number(option.weight), 0);
        let cursor = nextFloat() * total;
        for (const option of list) {
          cursor -= Number(option.weight);
          if (cursor <= 0) return option.value;
        }
        return list[list.length - 1].value;
      },
      timestampBetween(a, b) {
        const start = Math.min(Number(a) || 0, Number(b) || 0);
        const end = Math.max(Number(a) || 0, Number(b) || 0);
        return start + nextFloat() * Math.max(0, end - start);
      },
      get draws() { return index; }
    };
  }

  function stochasticCoalesceBounds(knownDispatchBudget, readyCandidateCount, configuredMaximum, mode) {
    const ready = Math.max(0, Math.trunc(Number(readyCandidateCount) || 0));
    const configured = Math.max(1, Math.trunc(Number(configuredMaximum) || 1));
    const known = finiteObservedNumber(knownDispatchBudget);
    if (!ready) return { low: 0, high: 0, knownBudget: known !== null };
    if (known === null) return { low: 1, high: Math.min(configured, ready, 3), knownBudget: false };
    const budget = Math.max(1, Math.min(configured, ready, Math.trunc(known)));
    if (mode === 'IMMEDIATE_EFFICIENCY') {
      return { low: 1, high: Math.max(1, Math.min(budget, Math.ceil(budget * 0.30))), knownBudget: true };
    }
    return {
      low: Math.max(1, Math.round(budget * 0.14)),
      high: Math.max(1, Math.min(budget, Math.ceil(budget * 0.60))),
      knownBudget: true
    };
  }

  function temporalProfileWeights(mode) {
    if (mode === 'IMMEDIATE_EFFICIENCY') {
      return [
        { value: 'VERY_EARLY', weight: 5 }, { value: 'EARLY', weight: 3 },
        { value: 'EARLY_MID', weight: 2 }, { value: 'MID', weight: 1 }
      ];
    }
    return [
      { value: 'VERY_EARLY', weight: 1 }, { value: 'EARLY', weight: 1 },
      { value: 'EARLY_MID', weight: 1 }, { value: 'MID', weight: 1 },
      { value: 'LATE_MID', weight: 1 }, { value: 'LATE', weight: 1 },
      { value: 'VERY_LATE', weight: 1 }
    ];
  }

  function temporalProfileRange(profile) {
    return ({
      VERY_EARLY: [0.00, 0.15], EARLY: [0.08, 0.30], EARLY_MID: [0.22, 0.45],
      MID: [0.38, 0.62], LATE_MID: [0.55, 0.78], LATE: [0.70, 0.92],
      VERY_LATE: [0.85, 1.00]
    })[profile] || [0.38, 0.62];
  }

  function generateStochasticPlan(input, randomSource = createRandomSource()) {
    const coalescingRandom = input?.randomSources?.coalescing || randomSource;
    const schedulingRandom = input?.randomSources?.scheduling || randomSource;
    const now = Math.max(0, Number(input?.now) || Date.now());
    const mode = String(input?.mode || 'ADAPTIVE_SPREAD') === 'IMMEDIATE_EFFICIENCY'
      ? 'IMMEDIATE_EFFICIENCY'
      : 'ADAPTIVE_SPREAD';
    const cheapStart = Math.max(now, Number(input?.earliestExecutionAt) || now);
    const rawLatest = Number(input?.latestCheapExecutionAt) || 0;
    if (rawLatest < cheapStart) {
      return normalizeStochasticPlan({
        cycleId: input?.cycleId,
        generation: input?.generation,
        planRevision: input?.planRevision,
        ownerId: input?.ownerId,
        mode,
        cheapWindowStart: cheapStart,
        cheapWindowEnd: rawLatest,
        executionDueAt: 0,
        createdAt: now
      });
    }
    const rawEnd = rawLatest;
    const technicalMargin = Math.min(1000, Math.max(0, (rawEnd - cheapStart) * 0.02));
    const cheapEnd = Math.max(cheapStart, rawEnd - technicalMargin);
    const maxHoldAt = Math.max(cheapStart, Math.min(cheapEnd, Number(input?.maxHoldAt) || cheapEnd));
    const bounds = stochasticCoalesceBounds(
      input?.knownDispatchBudget,
      input?.readyCandidateCount,
      input?.configuredMaximum,
      mode
    );
    const targetProfile = coalescingRandom.chooseWeighted(mode === 'IMMEDIATE_EFFICIENCY'
      ? [{ value: 'SMALL_TARGET', weight: 6 }, { value: 'MEDIUM_TARGET', weight: 3 }, { value: 'LARGE_TARGET', weight: 1 }]
      : [{ value: 'SMALL_TARGET', weight: 2 }, { value: 'MEDIUM_TARGET', weight: 4 }, { value: 'LARGE_TARGET', weight: 3 }]
    ) || 'SMALL_TARGET';
    const span = Math.max(0, bounds.high - bounds.low);
    const targetRanges = {
      SMALL_TARGET: [0, 0.34], MEDIUM_TARGET: [0.28, 0.72], LARGE_TARGET: [0.66, 1]
    };
    const targetBand = targetRanges[targetProfile] || [0, 1];
    const targetLow = bounds.low + Math.floor(span * targetBand[0]);
    const targetHigh = bounds.low + Math.ceil(span * targetBand[1]);
    const coalesceTarget = bounds.high > 0
      ? coalescingRandom.nextInt(Math.min(bounds.high, targetLow), Math.min(bounds.high, Math.max(targetLow, targetHigh)))
      : 0;
    const horizonFraction = mode === 'IMMEDIATE_EFFICIENCY'
      ? coalescingRandom.timestampBetween(0.01, 0.22)
      : coalescingRandom.timestampBetween(0.05, 0.85);
    const coalesceUntil = cheapStart + (maxHoldAt - cheapStart) * horizonFraction;
    const ready = Math.max(0, Math.trunc(Number(input?.readyCandidateCount) || 0));
    const eligibleAt = ready >= coalesceTarget ? cheapStart : Math.min(maxHoldAt, coalesceUntil);
    const functionalStart = Math.max(cheapStart, eligibleAt);
    // IMMEDIATE_EFFICIENCY continua estocástico. Quando a janela funcional
    // oferece pelo menos 15 s, evita degenerar sistematicamente no primeiro
    // instante; se não oferece, usa apenas o domínio realmente válido.
    const stochasticStart = mode === 'IMMEDIATE_EFFICIENCY' && cheapEnd - functionalStart >= 15000
      ? functionalStart + 15000
      : functionalStart;
    const temporalProfile = schedulingRandom.chooseWeighted(temporalProfileWeights(mode)) || 'MID';
    const profileRange = temporalProfileRange(temporalProfile);
    const width = Math.max(0, cheapEnd - stochasticStart);
    const bandStart = stochasticStart + width * profileRange[0];
    const bandEnd = stochasticStart + width * profileRange[1];
    const bandWidth = Math.max(0, bandEnd - bandStart);
    const leftInset = bandWidth * schedulingRandom.nextFloat() * 0.25;
    const rightInset = bandWidth * schedulingRandom.nextFloat() * 0.25;
    const stochasticSubwindowStart = Math.min(bandEnd, bandStart + leftInset);
    const stochasticSubwindowEnd = Math.max(stochasticSubwindowStart, bandEnd - rightInset);
    const executionDueAt = Math.min(
      cheapEnd,
      Math.max(stochasticStart, schedulingRandom.timestampBetween(stochasticSubwindowStart, stochasticSubwindowEnd))
    );
    return normalizeStochasticPlan({
      cycleId: String(input?.cycleId || ''),
      generation: input?.generation,
      planRevision: input?.planRevision,
      ownerId: input?.ownerId,
      mode,
      randomNamespace: randomSource.namespace || 'scheduling',
      coalescingRandomNamespace: coalescingRandom.namespace || 'coalescing',
      schedulingRandomNamespace: schedulingRandom.namespace || 'scheduling',
      coalesceLow: bounds.low,
      coalesceHigh: bounds.high,
      targetProfile,
      coalesceTarget,
      eligibleAt,
      coalesceUntil,
      maxHoldAt,
      cheapWindowStart: cheapStart,
      cheapWindowEnd: cheapEnd,
      localWindowStart: cheapStart,
      localWindowEnd: cheapEnd,
      temporalProfile,
      stochasticSubwindowStart,
      stochasticSubwindowEnd,
      executionDueAt,
      createdAt: now
    });
  }

  function coordinationProofStatus(coordination, requiredSources, now = Date.now()) {
    const at = Number(now);
    const names = Array.isArray(requiredSources) ? requiredSources.map(String) : [];
    const details = {};

    for (const name of names) {
      const source = coordination?.sources?.[name];
      const normalized = normalizeCoordinationSource(source, name);
      let proofEnd = Number(normalized.freshUntil || 0);

      if (name === 'MAP') {
        proofEnd = Number(source?.data?.authorizationFreshUntil || 0);
      } else if (name === 'CAPACITY') {
        proofEnd = Number(capacityProofFromSource(source)?.freshUntil || 0);
      }

      const sourceFresh = coordinationSourceFresh(source, at);
      const valid = sourceFresh && proofEnd >= at;
      details[name] = {
        valid,
        status: normalized.status,
        invalidated: normalized.invalidated,
        observedAt: normalized.observedAt,
        sourceFreshUntil: normalized.freshUntil,
        proofEnd,
        remainingMs: proofEnd - at,
        revision: normalized.revision
      };
    }

    const blocking = Object.entries(details)
      .filter(([, value]) => !value.valid)
      .map(([name]) => name);
    const validEnds = Object.values(details)
      .filter(value => value.valid)
      .map(value => Number(value.proofEnd || 0));

    return {
      valid: blocking.length === 0 && validEnds.length === names.length,
      blocking,
      proofEnd: blocking.length || !names.length ? 0 : Math.min(...validEnds),
      details
    };
  }

  function coordinationProofEnd(coordination, requiredSources, now = Date.now()) {
    return coordinationProofStatus(coordination, requiredSources, now).proofEnd;
  }

  function dependencyRequest(source, requiredFor, reason) {
    return {
      source: String(source || ''),
      requiredFor: String(requiredFor || ''),
      reason: String(reason || '')
    };
  }

  function localDependencyPlanner(coordination, wakeKind, now = Date.now()) {
    const state = normalizeCoordinationState(coordination);
    const kind = SCHEDULER_WAKE_KINDS.includes(String(wakeKind)) ? String(wakeKind) : state.wakeKind;
    if (state.state === 'HARD_STOP' || state.state === 'DISABLED') {
      return { action: 'NOTHING', required: [], requests: [], reason: state.state };
    }
    if (kind === 'EXECUTION') {

      if (!state.executionPlan || !state.stochasticPlan) {
        return { action: 'NOTHING', required: [], requests: [], reason: 'NO_EXECUTION_PLAN' };
      }
      const round = state.executionRound;
      if (
        !round ||
        round.executionRoundId !== state.executionPlan.executionRoundId ||
        !(round.dispatchLimitRemaining > 0)
      ) {
        return { action: 'NOTHING', required: [], requests: [], reason: 'EXECUTION_ROUND_EXHAUSTED_OR_MISSING' };
      }
      if (round.pendingMutation) {
        return { action: 'WAIT', required: [], requests: [], reason: 'UNKNOWN_RECONCILIATION', nextWakeAt: state.reconcileDueAt };
      }
      const context = {
        sourceVillageId: state.executionPlan.sourceVillageId,
        templateId: state.executionPlan.templateId,
        farmTemplate: state.executionPlan.farmTemplate
      };
      const capacityProof = capacityProofFromSource(state.sources.CAPACITY);
      if (capacityProofUsable(capacityProof, context, now) && capacityProof.value === 0) {
        return {
          action: 'WAIT', required: [], requests: [], reason: 'CAPACITY_EXHAUSTED',
          nextWakeAt: capacityProof.freshUntil, wakeKind: 'CAPACITY'
        };
      }
      const required = state.executionPlan.requiredSources.filter(name => {
        if (name === 'MAP') {
          return !coordinationSourceFresh(state.sources.MAP, now) ||
            Number(state.sources.MAP?.data?.authorizationFreshUntil || 0) < Number(now);
        }
        if (name === 'CAPACITY') {
          return !coordinationSourceFresh(state.sources.CAPACITY, now) ||
            !capacityProofUsable(capacityProof, context, now);
        }
        return !coordinationSourceFresh(state.sources[name], now);
      });
      if (required.length) {
        return {
          action: 'RESOLVE',
          required,
          requests: required.map(source => source === 'CAPACITY'
            ? dependencyRequest('ASSISTANT', 'CAPACITY_PROOF', 'CURRENT_UNITS_REQUIRED')
            : dependencyRequest(source, 'FINAL_POST_AUTHORIZATION', `${source}_PROOF_STALE`)),
          reason: 'EXECUTION_PROOF_STALE'
        };
      }
      if (!(capacityProof.value > 0)) {
        return {
          action: 'RESOLVE', required: ['CAPACITY'],
          requests: [dependencyRequest('ASSISTANT', 'CAPACITY_PROOF', 'POSITIVE_CAPACITY_REQUIRED')],
          reason: 'CAPACITY_PROOF_MISSING'
        };
      }
      return { action: 'EXECUTE', required: [], requests: [], reason: 'ALL_PROOFS_FRESH' };
    }
    if (kind === 'CAPACITY') {
      const proof = capacityProofFromSource(state.sources.CAPACITY);
      if (proof && proof.freshUntil >= Number(now) && proof.value === 0) {
        return {
          action: 'WAIT', required: [], requests: [], reason: 'CAPACITY_ZERO_STILL_FRESH',
          nextWakeAt: proof.freshUntil, wakeKind: 'CAPACITY'
        };
      }
      return {
        action: 'RESOLVE', required: ['CAPACITY'],
        requests: [dependencyRequest('ASSISTANT', 'CAPACITY_PROOF', 'CURRENT_UNITS_REQUIRED')],
        reason: 'CAPACITY_RECHECK_DUE'
      };
    }
    const sourceForKind = {
      REPORT: ['REPORT'],
      RECONCILIATION: ['REPORT'],
      OBSERVATION: ['MAP', 'ASSISTANT', 'REPORT'],
      MAINTENANCE: ['MAP', 'ASSISTANT', 'REPORT'],
      LEASE_RECOVERY: []
    }[kind] || [];
    const required = sourceForKind.filter(name => !coordinationSourceFresh(state.sources[name], now));
    return required.length
      ? {
          action: 'RESOLVE',
          required,
          requests: required.map(source => dependencyRequest(source, kind, `${source}_${kind}_DUE`)),
          reason: `${kind}_SOURCE_DUE`
        }
      : { action: 'NOTHING', required: [], requests: [], reason: `${kind}_SOURCES_STILL_FRESH` };
  }

  function states(villageId = currentVillageId()) {
    const value = loadJSON('targets', {}, villageId);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function saveStates(value, villageId = currentVillageId()) {
    return saveJSON('targets', value, villageId);
  }

  function cursor(villageId = currentVillageId(), targetCount = targetCoords(villageId).length) {
    const count = Math.max(0, Number(targetCount) || 0);
    if (!count) return 0;

    const n = Number(loadJSON('cursor', 0, villageId));
    return Number.isFinite(n) ? ((Math.trunc(n) % count) + count) % count : 0;
  }

  function saveCursor(value, villageId = currentVillageId(), targetCount = targetCoords(villageId).length) {
    const count = Math.max(0, Number(targetCount) || 0);
    const n = Number(value);
    const normalized = count && Number.isFinite(n)
      ? ((Math.trunc(n) % count) + count) % count
      : 0;
    return saveJSON('cursor', normalized, villageId);
  }

  function requireStored(ok, what = 'estado') {
    if (!ok) {
      throw codedError(
        'STORAGE_WRITE_FAILED',
        `Não foi possível gravar ${what} no localStorage. Execução interrompida para evitar envios duplicados.`
      );
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // LOCK ENTRE ABAS
  // ---------------------------------------------------------------------------

  function acquireLease(villageId) {
    const c = cfg(villageId);
    const now = Date.now();
    const previous = loadJSON('lease', null, villageId);

    if (
      previous?.owner &&
      previous.owner !== RUNTIME.tabId &&
      Number(previous.expiresAt) > now
    ) {
      return false;
    }

    const lease = {
      owner: RUNTIME.tabId,
      acquiredAt: now,
      expiresAt: now + c.leaseSeconds * 1000
    };

    if (!saveJSON('lease', lease, villageId)) return false;

    const check = loadJSON('lease', null, villageId);
    return check?.owner === RUNTIME.tabId;
  }

  function renewLease(villageId) {
    const existing = loadJSON('lease', null, villageId);
    if (existing?.owner !== RUNTIME.tabId) {
      throw codedError('LEASE_LOST', 'Outra aba assumiu a execução desta aldeia.');
    }

    const c = cfg(villageId);
    requireStored(saveJSON('lease', {
      ...existing,
      expiresAt: Date.now() + c.leaseSeconds * 1000
    }, villageId), 'lock entre abas');
  }

  function releaseLease(villageId) {
    const existing = loadJSON('lease', null, villageId);
    if (existing?.owner === RUNTIME.tabId) {
      removeJSON('lease', villageId);
    }
  }

  // ---------------------------------------------------------------------------
  // ANTI-BOT GUARD (FAIL-CLOSED)
  // ---------------------------------------------------------------------------

  const AntiBotGuard = (() => {
    let active = false;
    let observer = null;
    let hookTimer = null;
    let stopCallback = null;

    function hasMarkers(doc = document) {
      try {
        return Boolean(
          doc.querySelector?.('td.bot-protection-row') ||
          doc.getElementById?.('botprotection_quest') ||
          doc.querySelector?.('.captcha')
        );
      } catch (_) {
        return false;
      }
    }

    function premiumFeaturesDetected() {
      try {
        const pf = topWin().PremiumFeaturesBotProtection;
        return Boolean(pf && typeof pf.isActive === 'function' && pf.isActive());
      } catch (_) {
        return false;
      }
    }

    function stop(reason = 'Bot Protection/CAPTCHA detetado') {
      if (active) return;
      active = true;

      if (hookTimer) {
        clearInterval(hookTimer);
        hookTimer = null;
      }

      if (observer) {
        observer.disconnect();
        observer = null;
      }

      console.warn('[AutoFarmRadius]', reason);
      if (typeof stopCallback === 'function') stopCallback(reason);
    }

    function hookNativeBotProtect() {
      const w = topWin();

      try {
        if (
          w.BotProtect &&
          typeof w.BotProtect.show === 'function' &&
          !w.BotProtect.__autofarm59Hooked
        ) {
          const originalShow = w.BotProtect.show.bind(w.BotProtect);

          w.BotProtect.show = function (...args) {
            stop('BotProtect.show() foi chamado');
            return originalShow(...args);
          };

          w.BotProtect.__autofarm59Hooked = true;
          return true;
        }
      } catch (_) {}

      return false;
    }

    function watch(onStop) {
      stopCallback = onStop;

      if (premiumFeaturesDetected()) {
        stop('Premium Features já detetou Bot Protection');
        return;
      }

      if (hasMarkers()) {
        stop('Elementos de Bot Protection/CAPTCHA encontrados');
        return;
      }

      if (!hookNativeBotProtect()) {
        hookTimer = setInterval(() => {
          if (premiumFeaturesDetected()) {
            stop('Premium Features detetou Bot Protection');
            return;
          }

          if (hookNativeBotProtect()) {
            clearInterval(hookTimer);
            hookTimer = null;
          }
        }, 250);
      }

      if (document.body && window.MutationObserver) {
        observer = new MutationObserver(() => {
          if (premiumFeaturesDetected() || hasMarkers()) {
            stop('Bot Protection/CAPTCHA apareceu no DOM');
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    function assertSafe(doc = document) {
      if (premiumFeaturesDetected() || hasMarkers(doc)) {
        stop('Bot Protection/CAPTCHA detetado');
      }

      if (active) throw codedError('BOT_PROTECTION_ACTIVE');
      return true;
    }

    return {
      watch,
      stop,
      assertSafe,
      isActive: () => active,
      hasMarkers
    };
  })();

  function hardStop(reason, villageId = RUNTIME.activeVillageId || currentVillageId()) {
    const key = String(villageId || '');
    const passStillActive = Boolean(
      key &&
      RUNTIME.busy &&
      String(RUNTIME.activeVillageId || '') === key
    );

    if (villageId) {
      RUNTIME.hardStopReasonsByVillage.set(key, String(reason));
      const current = cfg(villageId);
      saveCfg({ ...current, enabled: false }, villageId);

      // Se existe um pedido/passagem em curso, o finally é responsável por libertar
      // o lease. Libertá-lo aqui abriria uma janela para outra aba assumir cedo demais.
      if (!passStillActive) releaseLease(villageId);
    }

    cancelSchedule(villageId, 'hard-stop');
    if (!passStillActive) RUNTIME.busy = false;
    RUNTIME.stopReason = reason;

    info(`PARADO: ${reason}. Resolve manualmente, recarrega a página e volta a INICIAR.`, true);
    renderPanel();
  }

  function applyAccountHardStopLocally(stopState = accountHardStopState()) {
    if (!stopState?.active) return false;
    const reason = String(stopState.reason || 'hard-stop da conta');
    for (const villageId of knownAccountVillageIds()) {
      RUNTIME.hardStopReasonsByVillage.set(String(villageId), reason);
      const current = cfg(villageId);
      saveCfg({ ...current, enabled: false }, villageId);
      const coordination = coordinationState(villageId);
      coordination.generation = Math.max(0, Number(coordination.generation) || 0) + 1;
      coordination.state = 'HARD_STOP';
      coordination.executionPlan = null;
      coordination.stochasticPlan = null;
      coordination.executionDueAt = 0;
      coordination.nextWakeAt = 0;
      coordination.reason = reason;
      saveCoordinationState(coordination, villageId);
    }
    clearLocalScheduleTimer();
    RUNTIME.stopReason = reason;
    renderPanel();
    return true;
  }

  function persistAccountHardStop(reason, source = 'AUTOFARM') {
    const previous = accountHardStopState();
    const stopState = {
      active: true,
      host: String(location.host),
      playerId: playerId(),
      reason: String(reason || 'hard-stop da conta'),
      source: String(source || 'AUTOFARM'),
      detectedAt: Number(previous?.detectedAt) || Date.now(),
      generation: Math.max(1, Number(previous?.generation || 0) + 1),
      detectingTabId: String(previous?.detectingTabId || RUNTIME.tabId)
    };
    try {
      localStorage.setItem(accountHardStopStorageKey(), JSON.stringify(stopState));
    } catch (err) {
      console.error('[AutoFarmRadius] falha a persistir account hard-stop', err);
    }
    applyAccountHardStopLocally(stopState);
    return stopState;
  }

  function clearAccountHardStopManually() {
    try { localStorage.removeItem(accountHardStopStorageKey()); } catch (_) {}
    for (const villageId of knownAccountVillageIds()) {
      RUNTIME.hardStopReasonsByVillage.delete(String(villageId));
    }
    RUNTIME.stopReason = '';
    return true;
  }

  function coordinatedHardStop(reason, villageId = RUNTIME.activeVillageId || currentVillageId()) {
    const stopState = persistAccountHardStop(reason, 'HARD_STOP_SIGNAL');
    hardStop(stopState.reason, villageId);
  }

  // ---------------------------------------------------------------------------
  // REDE
  // ---------------------------------------------------------------------------

  function textLooksLikeProtection(text) {
    return /bot protection|captcha|prote[cç][aã]o contra bots/i.test(String(text || ''));
  }

  function textLooksLikeLogin(text, responseUrl = '') {
    return (
      /name=["']login["']/i.test(String(text || '')) ||
      /screen=login/i.test(String(text || '')) ||
      /screen=login/i.test(String(responseUrl || ''))
    );

  }

  async function fetchWithTimeout(url, options, villageId) {
    AntiBotGuard.assertSafe();
    const timeoutMs = cfg(villageId).requestTimeoutSeconds * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        credentials: 'include',
        signal: controller.signal
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw codedError('REQUEST_TIMEOUT', `Pedido excedeu ${timeoutMs / 1000}s.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function assertAccountNetworkAllowed() {
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      throw codedError('ACCOUNT_HARD_STOP', 'Hard-stop da conta ativo.');
    }
  }

  function throwForStatus(res) {
    if (res.status === 401) throw codedError('LOGIN_REQUIRED', 'Sessão expirada.');
    if (res.status === 429) throw codedError('HTTP_429', 'Servidor limitou a frequência de pedidos (HTTP 429).');
    if (res.status === 403) throw codedError('HTTP_403', 'Servidor recusou o pedido (HTTP 403).');
    if (!res.ok) throw codedError(`HTTP_${res.status}`, `Falha HTTP ${res.status}.`);
  }

  async function fetchHtml(url, villageId) {
    assertAccountNetworkAllowed();
    AntiBotGuard.assertSafe();
    renewLease(villageId);
    recordNetworkRequest(villageId, 'GET', url, 'dependency planner autorizou leitura HTML', 'SOURCE_PROOF');

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }, villageId);

    const text = await res.text();

    if (textLooksLikeProtection(text)) {
      AntiBotGuard.stop('Proteção anti-bot encontrada numa resposta HTML');
      throw codedError('BOT_PROTECTION_ACTIVE');
    }

    if (textLooksLikeLogin(text, res.url)) {
      throw codedError('LOGIN_REQUIRED', 'Sessão expirada / login necessário.');
    }

    throwForStatus(res);

    const doc = new DOMParser().parseFromString(text, 'text/html');
    if (AntiBotGuard.hasMarkers(doc)) {
      AntiBotGuard.stop('Proteção anti-bot encontrada numa resposta HTML');
      throw codedError('BOT_PROTECTION_ACTIVE');
    }

    return doc;
  }

  async function fetchWorldMap(villageId) {
    assertAccountNetworkAllowed();
    AntiBotGuard.assertSafe();
    renewLease(villageId);

    recordNetworkRequest(villageId, 'GET', `${location.origin}/map/village.txt`, 'autorização MAP requerida', 'FINAL_POST_AUTHORIZATION');

    const res = await fetchWithTimeout(`${location.origin}/map/village.txt`, {
      method: 'GET',
      // Revalida no servidor, mas permite ao browser reutilizar a cópia se não mudou.
      cache: 'no-cache'
    }, villageId);

    const text = await res.text();

    if (textLooksLikeProtection(text)) {
      AntiBotGuard.stop('Proteção anti-bot encontrada ao validar o mapa');
      throw codedError('BOT_PROTECTION_ACTIVE');
    }

    if (textLooksLikeLogin(text, res.url)) {
      throw codedError('LOGIN_REQUIRED', 'Sessão expirada / login necessário.');
    }

    throwForStatus(res);
    return text;
  }


  async function getConservativeFarmUnitSpeedMinPerField(villageId) {
    const cacheKey = location.host;
    const cached = RUNTIME.unitSpeedByHost.get(cacheKey);
    if (cached && Number.isFinite(cached.value) && Date.now() - cached.at < 6 * 3600000) {
      return cached.value;
    }

    try {
      // v2.0 partilha a mesma leitura de get_unit_info usada para carry/speed,
      // evitando um segundo GET idêntico na mesma sessão.
      const units = await getFarmUnitEconomics(villageId);
      const speeds = Object.values(units || {})
        .map(info => Number(info?.speed))
        .filter(value => Number.isFinite(value) && value > 0);
      const slowest = speeds.length ? Math.max(...speeds) : 0;

      if (!Number.isFinite(slowest) || slowest <= 0) {
        throw codedError('UNIT_SPEED_UNAVAILABLE', 'Velocidades das unidades não disponíveis.');
      }

      RUNTIME.unitSpeedByHost.set(cacheKey, { value: slowest, at: Date.now() });
      return slowest;
    } catch (err) {
      if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429'].includes(err?.code)) throw err;
      if (!['UNIT_INFO_UNAVAILABLE', 'UNIT_INFO_PARSE_FAILED', 'UNIT_SPEED_UNAVAILABLE'].includes(String(err?.code || ''))) {
        throw err;
      }
      console.warn('[AutoFarmRadius] não foi possível obter velocidades das unidades; a usar timeout configurado:', err);
      return null;
    }
  }

  function effectivePendingTimeoutMs(c, unitSpeedMinPerField = null) {
    const configuredMs = c.pendingTimeoutHours * 3600000;
    if (!Number.isFinite(unitSpeedMinPerField) || unitSpeedMinPerField <= 0) return configuredMs;

    // Ida + volta até ao limite do raio, mais 60 min de margem para processamento/relatório.
    const roundTripMs = (2 * c.radius * unitSpeedMinPerField + 60) * 60000;
    return Math.max(configuredMs, roundTripMs);
  }

  // ---------------------------------------------------------------------------
  // FARM ASSISTANT / PARSING
  // ---------------------------------------------------------------------------

  function getFarmUrl(page, villageId) {
    const gd = gameData();
    const pure = String(gd?.link_base_pure || '');
    let url;

    try {
      url = pure
        ? sameOriginUrl(`${pure}am_farm`)
        : sameOriginUrl('/game.php');
    } catch (err) {
      if (err?.code === 'SEND_ENDPOINT_UNAVAILABLE') throw err;
      url = sameOriginUrl('/game.php');
    }

    url.searchParams.set('village', String(villageId));
    url.searchParams.set('screen', 'am_farm');
    url.searchParams.set('order', 'distance');
    url.searchParams.set('dir', 'asc');
    url.searchParams.set('Farm_page', String(page || 0));
    return url.toString();
  }

  function maxFarmPages(doc) {
    let maxIndex = 0;

    for (const a of doc.querySelectorAll('a[href*="Farm_page="]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/[?&]Farm_page=(\d+)/i);
      if (m) maxIndex = Math.max(maxIndex, Number(m[1]));
    }

    return maxIndex + 1;
  }

  function parseCoord(row) {
    const text = row.textContent || '';
    const m = text.match(/\b\d{3}\|\d{3}\b/);
    return m ? m[0] : null;
  }

  function assistantPageCoverageRadius(doc, sourceCoord = currentVillageCoord()) {
    const m = String(sourceCoord || '').match(/^(\d{3})\|(\d{3})$/);
    if (!m) return null;

    const sourceX = Number(m[1]);
    const sourceY = Number(m[2]);
    let maxDistance = null;

    for (const row of doc.querySelectorAll('#plunder_list tr')) {
      const coord = parseCoord(row);
      if (!coord) continue;

      const cm = coord.match(/^(\d{3})\|(\d{3})$/);
      if (!cm) continue;

      const distance = Math.hypot(Number(cm[1]) - sourceX, Number(cm[2]) - sourceY);
      if (!Number.isFinite(distance)) continue;
      maxDistance = maxDistance === null ? distance : Math.max(maxDistance, distance);
    }

    return maxDistance;
  }

  function parseReportId(row) {
    const links = [...row.querySelectorAll('a[href*="screen=report"]')];

    for (const a of links) {
      const href = a.getAttribute('href') || '';

      try {
        const u = new URL(href, location.origin);
        const id = u.searchParams.get('view') || u.searchParams.get('id');
        if (id) return String(id);
      } catch (_) {}

      const m = href.match(/[?&](?:view|id)=(\d+)/i);
      if (m) return m[1];
    }

    return null;
  }

  function parseDot(row) {
    const img = row.querySelector('img[src*="graphic/dots/"], img[src*="/dots/"]');
    const src = img?.getAttribute('src') || '';
    const m = src.match(/dots\/(green|yellow|red_blue|red_yellow|red|blue)\./i);
    return m ? m[1].toLowerCase() : 'unknown';
  }

  function parseHaul(row) {
    if (row.querySelector('img[src*="max_loot/0"]')) return 'partial';
    if (row.querySelector('img[src*="max_loot/1"]')) return 'full';
    return 'unknown';
  }

  function parseServerClock(doc) {
    const observedAt = Date.now();

    try {
      const timeText = String(doc?.querySelector?.('#serverTime')?.textContent || '').trim();
      const dateText = String(doc?.querySelector?.('#serverDate')?.textContent || '').trim();

      const tm = timeText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      const dm = dateText.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);

      if (tm && dm) {
        // "pseudoNow" usa deliberadamente o fuso local apenas como escala de calendário.
        // A diferença entre pseudoNow e o timestamp da linha é independente do fuso.
        const pseudoNow = new Date(
          Number(dm[3]),
          Number(dm[2]) - 1,
          Number(dm[1]),
          Number(tm[1]),
          Number(tm[2]),
          Number(tm[3] || 0),
          0
        ).getTime();

        if (Number.isFinite(pseudoNow)) {
          return { trusted: true, pseudoNow, observedAt };
        }
      }
    } catch (_) {}

    return { trusted: false, pseudoNow: observedAt, observedAt };
  }

  function parseAssistantAttackText(rawValue, serverClock) {
    try {
      const clock = serverClock && typeof serverClock === 'object'
        ? serverClock
        : { trusted: false, pseudoNow: Date.now(), observedAt: Date.now() };

      // Sem o relógio/data do servidor não é seguro converter "hoje/ontem" para epoch,
      // sobretudo quando o servidor e o browser estão em fusos diferentes.
      if (!clock.trusted) return null;

      const raw = String(rawValue || '').replace(/\s+/g, ' ').trim();
      if (!raw) return null;

      const tm = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!tm) return null;

      const hour = Number(tm[1]);
      const minute = Number(tm[2]);
      const second = Number(tm[3] || 0);
      if (
        !Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59 ||
        !Number.isInteger(second) || second < 0 || second > 59
      ) return null;

      const lower = raw.toLowerCase();
      const pseudoNowDate = new Date(clock.pseudoNow);

      let year = pseudoNowDate.getFullYear();
      let month = pseudoNowDate.getMonth();
      let day = pseudoNowDate.getDate();

      const isYesterday = /\b(ontem|yesterday|ayer|gestern|hier|ieri)\b/i.test(lower);
      const isToday = /\b(hoje|today|hoy|heute|aujourd'hui|oggi)\b/i.test(lower);
      const dm = raw.match(/(?:^|\s)(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/);

      // Uma hora isolada não é prova suficiente: exige hoje/ontem ou uma data explícita.
      if (!dm && !isYesterday && !isToday) return null;

      if (dm) {
        const parsedDay = Number(dm[1]);
        const parsedMonth = Number(dm[2]);
        if (
          !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31 ||
          !Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12
        ) return null;

        day = parsedDay;
        month = parsedMonth - 1;
        if (dm[3]) {
          year = Number(dm[3]);
          if (year < 100) year += 2000;
          if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
        } else if (pseudoNowDate.getMonth() === 0 && month === 11) {
          year -= 1;
        }
      } else if (isYesterday) {
        const d = new Date(clock.pseudoNow);
        d.setDate(d.getDate() - 1);
        year = d.getFullYear();
        month = d.getMonth();
        day = d.getDate();
      }

      const pseudoDate = new Date(year, month, day, hour, minute, second, 0);
      const pseudoAttackAt = pseudoDate.getTime();

      if (!Number.isFinite(pseudoAttackAt)) return null;

      // Date() normaliza silenciosamente valores impossíveis (ex.: 31/02 -> março).
      // Exige correspondência exata para manter o parser fail-closed.
      if (
        pseudoDate.getFullYear() !== year ||
        pseudoDate.getMonth() !== month ||
        pseudoDate.getDate() !== day ||
        pseudoDate.getHours() !== hour ||
        pseudoDate.getMinutes() !== minute ||
        pseudoDate.getSeconds() !== second
      ) return null;

      const ageMs = Number(clock.pseudoNow) - pseudoAttackAt;

      // Pequena tolerância para diferenças de segundos entre a resposta e o relógio observado.
      if (!Number.isFinite(ageMs) || ageMs < -5 * 60000) return null;

      return Number(clock.observedAt) - ageMs;
    } catch (_) {
      return null;
    }
  }

  function parseAssistantAttackInfo(row, serverClock) {
    try {
      const cells = [...(row?.children || [])];
      if (!cells.length) return { at: null, raw: '', source: 'unavailable', cellIndex: -1 };

      function inspect(index, source) {
        const raw = String(cells[index]?.textContent || '').replace(/\s+/g, ' ').trim();
        const at = parseAssistantAttackText(raw, serverClock);
        return at ? { at, raw, source, cellIndex: index } : null;
      }

      // Estrutura conhecida do Farm Assistant: Last Attack Time = td:eq(4).
      // Se esta célula tiver um valor temporal válido, é a fonte preferida.
      const preferred = inspect(4, 'assistant-column-4');
      if (preferred) return preferred;

      // Fallback estrutural: só aceita outra coluna quando existe EXATAMENTE uma
      // candidata inequívoca com hoje/ontem/data + hora. Nunca escolhe por aproximação.
      const candidates = [];
      for (let i = 0; i < cells.length; i++) {
        if (i === 4) continue;
        const candidate = inspect(i, `assistant-fallback-column-${i}`);
        if (candidate) candidates.push(candidate);
      }

      if (candidates.length === 1) return candidates[0];
      return {
        at: null,
        raw: '',
        source: candidates.length > 1 ? 'ambiguous' : 'unavailable',
        cellIndex: -1
      };
    } catch (_) {
      return { at: null, raw: '', source: 'unavailable', cellIndex: -1 };
    }
  }


  function parseAssistantAttackAt(row, serverClock) {
    return parseAssistantAttackInfo(row, serverClock).at;
  }

  function parseFarmButton(row, farmTemplate = 'A') {
    const letter = ['A', 'B'].includes(String(farmTemplate).toUpperCase())
      ? String(farmTemplate).toUpperCase()
      : 'A';

    const a = row.querySelector(`a.farm_icon_${letter.toLowerCase()}`);
    if (!a) return null;

    const onclick = a.getAttribute('onclick') || '';
    const targetFromData = a.dataset?.target || a.dataset?.targetId || null;
    const templateFromData = a.dataset?.templateId || a.dataset?.template || null;

    let targetId = targetFromData ? String(targetFromData) : null;
    let templateId = templateFromData ? String(templateFromData) : null;

    const sendMatch = onclick.match(
      /(?:Accountmanager\.farm\.)?sendUnits\s*\(\s*this\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i
    );

    if (sendMatch) {
      targetId ||= sendMatch[1];
      templateId ||= sendMatch[2];
    }

    const idMatch = (row.id || '').match(/village_(\d+)/);
    targetId ||= idMatch?.[1] || null;

    const usesDifferentAction = Boolean(
      onclick &&
      !sendMatch &&
      /Accountmanager\.farm\.\w+\s*\(/i.test(onclick)
    );

    // Para enviar via POST precisamos de target + template_id inequívocos.
    // Uma classe farm_icon_X, por si só, não é prova de que o onclick use sendUnits.
    const supported = Boolean(targetId && templateId && !usesDifferentAction);

    return {
      targetId,
      templateId,
      disabled: a.classList.contains('farm_icon_disabled'),
      supported,
      action: usesDifferentAction ? 'other' : (sendMatch ? 'sendUnits' : 'data')
    };
  }

  function parseFarmRows(doc, targetSet, farmTemplate = 'A') {
    const out = new Map();
    const wanted = targetSet instanceof Set ? targetSet : new Set(targetCoords());
    const serverClock = parseServerClock(doc);

    for (const row of doc.querySelectorAll('#plunder_list tr')) {
      const coord = parseCoord(row);
      if (!coord || !wanted.has(coord)) continue;

      const button = parseFarmButton(row, farmTemplate);
      const attackInfo = parseAssistantAttackInfo(row, serverClock);

      out.set(coord, {
        coord,
        targetId: button?.targetId || ((row.id || '').match(/village_(\d+)/)?.[1] || null),
        templateId: button?.supported ? (button.templateId || null) : null,
        buttonPresent: Boolean(button),
        buttonSupported: Boolean(button?.supported),
        buttonAction: button?.action || null,
        disabled: button?.disabled ?? true,
        disabledReason: button?.disabled ? 'FARM_ICON_DISABLED' : '',
        disabledSource: button?.disabled ? 'ASSISTANT_DOM_CLASS' : '',
        reportId: parseReportId(row),
        haul: parseHaul(row),
        dot: parseDot(row),
        assistantAttackAt: attackInfo.at,
        assistantAttackRaw: attackInfo.raw,
        assistantAttackTimeSource: attackInfo.source,
        assistantAttackCellIndex: attackInfo.cellIndex
      });
    }

    return out;
  }

  function currentFarmDomIsReusable(villageId) {
    if (!isFarmPage() || String(currentVillageId() || '') !== String(villageId || '')) return false;
    try {
      const url = new URL(location.href);
      const page = Number(url.searchParams.get('Farm_page') || 0);
      const order = String(url.searchParams.get('order') || '').toLowerCase();
      const dir = String(url.searchParams.get('dir') || 'asc').toLowerCase();
      return page === 0 && order === 'distance' && dir === 'asc';
    } catch (_) {
      return false;
    }
  }

  async function loadAllFarmRows(villageId, targets) {
    assertVillageContext(villageId);
    const c = cfg(villageId);
    const farmTemplate = c.farmTemplate;
    const targetList = Array.isArray(targets) ? targets : targetCoords(villageId);
    const targetSet = new Set(targetList);
    const rows = new Map();
    const cacheKey = `${villageId}:r${c.radius}`;
    const now = Date.now();
    const previousCache = RUNTIME.farmCacheByVillage.get(cacheKey) || null;
    const previousStates = states(villageId);
    const targetSignature = targetList.join(',');

    let pagesScanned = 0;
    let fullScan = !previousCache;
    let upgradedForRediscovery = false;

    // Importante: coverageRadius é SEMPRE da passagem atual. Nunca herda a cobertura
    // antiga, porque uma cobertura antiga não prova que uma row ausente agora é nova.
    let coverageRadius = 0;
    const fetchedPages = new Set();
    const seenNetworkRows = new Set();
    const observedPageByCoord = new Map();

    let pageByCoord = new Map(
      [...(previousCache?.pageByCoord || new Map()).entries()]
        .filter(([coord]) => targetSet.has(coord))
    );

    let confirmedAbsentFromAssistant = new Set(
      [...(previousCache?.confirmedAbsentFromAssistant || new Set())]
        .filter(coord => targetSet.has(coord))
    );

    let needsRediscovery = new Set(
      [...(previousCache?.needsRediscovery || new Set())]
        .filter(coord => targetSet.has(coord))
    );

    let absenceProofAt = Number(previousCache?.absenceProofAt || 0);

    if (previousCache) {
      const fullScanAge = now - Number(previousCache.fullScanAt || 0);

      if (needsRediscovery.size) {
        // Uma linha anteriormente conhecida desapareceu de uma página. Não aguardamos
        // 20 minutos: esta própria passagem vai fazer full scan para a redescobrir.
        fullScan = true;
      } else if (fullScanAge >= c.fullRescanMin * 60000) {
        fullScan = true;
      } else {
        const hasUnmappedPending = targetList.some(
          coord => previousStates[coord]?.pending && !pageByCoord.has(coord)
        );

        if (
          hasUnmappedPending &&
          fullScanAge >= c.unmappedPendingRescanMin * 60000
        ) {
          fullScan = true;
        }
      }
      // Crescer/encolher o mapa não invalida os mappings das coordenadas antigas.
      // Uma coordenada nova fica sem prova de ausência até ao próximo full rescan
      // normal; não força imediatamente a releitura de todas as páginas.
    }

    if (fullScan) {
      // Um full scan atual vai reconstruir a prova; não usa ausência/cobertura antiga.
      confirmedAbsentFromAssistant = new Set();
      absenceProofAt = 0;
    }

    // Só aproveita o DOM para enriquecer rows visíveis. Nunca é usado como prova de
    // ausência, pois a prova vem exclusivamente das páginas de rede lidas nesta passagem.
    if (isFarmPage()) {
      for (const [coord, data] of parseFarmRows(document, targetSet, farmTemplate)) {
        rows.set(coord, data);
      }
    }

    const processFetchedPage = (page, doc) => {
      const parsed = parseFarmRows(doc, targetSet, farmTemplate);
      fetchedPages.add(Number(page));
      pagesScanned++;

      const pageCoverage = assistantPageCoverageRadius(doc);
      if (Number.isFinite(pageCoverage)) {
        coverageRadius = Math.max(coverageRadius, pageCoverage);
      }

      for (const coord of parsed.keys()) {
        seenNetworkRows.add(coord);
        observedPageByCoord.set(coord, Number(page));
        rows.set(coord, parsed.get(coord));

        // Se apareceu, deixa imediatamente de poder ser tratado como ausência confirmada
        // ou como linha a redescobrir.
        confirmedAbsentFromAssistant.delete(coord);
        needsRediscovery.delete(coord);
      }

      return parsed;
    };

    // DOM-first: quando a página visível é exatamente o contexto ordenado pedido
    // pelo scanner, ela já constitui a observação da página 0 e evita um GET igual.
    const reusedDomPage0 = currentFarmDomIsReusable(villageId);
    const first = reusedDomPage0
      ? document
      : await fetchHtml(getFarmUrl(0, villageId), villageId);
    RUNTIME.farmPageSnapshotByVillage.set(String(villageId), {
      doc: first,
      at: Date.now()
    });
    const firstRows = processFetchedPage(0, first);

    const rawTotalPages = maxFarmPages(first);
    const totalPages = Math.min(rawTotalPages, Math.max(1, c.scanMaxPages));
    const truncated = rawTotalPages > Math.max(1, c.scanMaxPages);

    // Em modo cache, se uma coordenada que SABÍAMOS estar nesta página desapareceu,
    // a ausência é ambígua: pode simplesmente ter mudado de página. Marca rediscovery.
    if (!fullScan) {
      for (const [coord, oldPage] of [...pageByCoord.entries()]) {
        if (Number(oldPage) === 0 && !firstRows.has(coord)) {
          pageByCoord.delete(coord);
          needsRediscovery.add(coord);
          confirmedAbsentFromAssistant.delete(coord);
        }
      }
    }
    for (const coord of firstRows.keys()) pageByCoord.set(coord, 0);

    const cachedPages = !fullScan
      ? [...new Set(
          [...pageByCoord.values()]
            .map(Number)
            .filter(page => Number.isInteger(page) && page > 0 && page < totalPages)
        )].sort((a, b) => a - b)
      : [];

    for (const page of cachedPages) {
      AntiBotGuard.assertSafe();
      assertVillageContext(villageId);
      if (c.pageFetchGapMs) await sleep(c.pageFetchGapMs);

      const doc = await fetchHtml(getFarmUrl(page, villageId), villageId);
      const parsed = processFetchedPage(page, doc);

      for (const [coord, oldPage] of [...pageByCoord.entries()]) {
        if (Number(oldPage) === page && !parsed.has(coord)) {
          pageByCoord.delete(coord);
          needsRediscovery.add(coord);
          confirmedAbsentFromAssistant.delete(coord);
        }
      }

      for (const coord of parsed.keys()) pageByCoord.set(coord, page);
    }

    // Se o modo cache descobriu uma mudança de paginação, promove a mesma passagem
    // a full scan. Assim não fica 20 minutos num estado ambíguo.
    if (!fullScan && needsRediscovery.size) {
      fullScan = true;
      upgradedForRediscovery = true;
      confirmedAbsentFromAssistant = new Set();
      absenceProofAt = 0;
    }

    if (fullScan) {
      // No full scan, pageByCoord final deve refletir apenas páginas realmente observadas
      // nesta passagem. As páginas já lidas acima contam; faltam apenas as restantes.
      for (let page = 1; page < totalPages; page++) {
        if (fetchedPages.has(page)) continue;

        AntiBotGuard.assertSafe();
        assertVillageContext(villageId);
        if (c.pageFetchGapMs) await sleep(c.pageFetchGapMs);

        const doc = await fetchHtml(getFarmUrl(page, villageId), villageId);
        processFetchedPage(page, doc);

        // Ordenação pedida ao Assistente é distância ascendente. Se já vimos uma distância
        // >= raio, todas as linhas relevantes para este raio ficaram cobertas.
        if (Number.isFinite(coverageRadius) && coverageRadius >= c.radius) break;
      }

      const scannedAllAssistantPages =
        !truncated &&
        Array.from({ length: rawTotalPages }, (_, page) => page)
          .every(page => fetchedPages.has(page));

      const fullScanProvesRadius =
        scannedAllAssistantPages ||
        (Number.isFinite(coverageRadius) && coverageRadius >= c.radius);

      if (fullScanProvesRadius) {
        pageByCoord = new Map(observedPageByCoord);

        // A prova de "não está no Assistente" é criada SOMENTE aqui:
        // full scan atual + cobertura comprovada + coordenada não vista na rede.
        confirmedAbsentFromAssistant = new Set(
          targetList.filter(coord => !seenNetworkRows.has(coord))
        );
        needsRediscovery.clear();
        absenceProofAt = now;
      } else {
        // Se nem o full scan conseguiu provar cobertura (ex.: scanMaxPages baixo),
        // falha fechado: não há bootstrap por ausência.
        confirmedAbsentFromAssistant.clear();

        // Mantém como rediscovery qualquer alvo que antes tinha página mas não foi visto
        // nesta passagem; isso impede classificá-lo como "novo".
        for (const [coord] of pageByCoord) {
          if (!seenNetworkRows.has(coord)) needsRediscovery.add(coord);
        }

        // Usa apenas mappings efetivamente observados na passagem para não perpetuar cache.
        pageByCoord = new Map(observedPageByCoord);
      }
    }

    // Mesmo num cache scan normal, rows observadas prevalecem e removem estados ambíguos.
    for (const [coord, page] of observedPageByCoord) {
      pageByCoord.set(coord, page);
      needsRediscovery.delete(coord);
      confirmedAbsentFromAssistant.delete(coord);
    }

    const lastFullScanProvedRadius = Boolean(absenceProofAt);
    const assistantCoversRadius = lastFullScanProvedRadius && needsRediscovery.size === 0;

    RUNTIME.farmCacheByVillage.set(cacheKey, {
      pageByCoord,
      fullScanAt: fullScan ? now : Number(previousCache?.fullScanAt || now),
      totalPages,
      targetSignature,
      coverageRadius,
      assistantCoversRadius,
      confirmedAbsentFromAssistant,
      needsRediscovery,
      absenceProofAt
    });

    RUNTIME.lastScan = {
      at: Date.now(),
      found: rows.size,
      pagesScanned,
      fullScan,
      upgradedForRediscovery,
      totalPages,
      truncated,
      coverageRadius,
      assistantCoversRadius,
      confirmedAbsentCount: confirmedAbsentFromAssistant.size,
      needsRediscoveryCount: needsRediscovery.size,
      absenceProofAt,
      targetCount: targetList.length,
      domPage0Reused: reusedDomPage0,
      villageId: String(villageId)
    };

    return rows;
  }

  // ---------------------------------------------------------------------------
  // MAPA / VALIDAÇÃO DE BÁRBARAS
  // ---------------------------------------------------------------------------

  function normalizedCoordList(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map(String)
      .filter(coord => /^\d{3}\|\d{3}$/.test(coord)))]
      .sort((a, b) => a.localeCompare(b));
  }

  function legacyOperationalProofCoords(legacyCoords, rawStates) {
    const stateByCoord = rawStates && typeof rawStates === 'object' && !Array.isArray(rawStates)
      ? rawStates
      : {};
    return normalizedCoordList(legacyCoords).filter(coord => {
      const st = stateByCoord[coord];
      if (!st || typeof st !== 'object' || Array.isArray(st)) return false;
      return Boolean(
        st.assistantEverSeen ||
        st.lastReportId ||
        st.reportIdAtSend ||
        st.pending ||
        st.sending ||
        Number(st.sentAt || 0) > 0 ||
        Number(st.bootstrapAttemptedAt || 0) > 0
      );
    });
  }

  function nextMapPresenceState(
    raw,
    currentCoords,
    legacyCoords,
    now,

    contextKey,
    radius,
    minConfirmationMs = MAP_BOOTSTRAP_CONFIRM_MIN_MS,
    legacyConfirmedCoords = []
  ) {
    const at = Math.max(1, Number(now) || Date.now());
    const current = normalizedCoordList(currentCoords);
    const sameContext = Boolean(
      raw &&
      Number(raw.schema) === MAP_PRESENCE_SCHEMA_VERSION &&
      String(raw.contextKey || '') === String(contextKey || '') &&
      Array.isArray(raw.coords)
    );
    const previous = sameContext
      ? normalizedCoordList(raw.coords)
      : normalizedCoordList(legacyCoords);
    const previousSet = new Set(previous);
    const migratedConfirmedSet = new Set(normalizedCoordList(legacyConfirmedCoords));
    const currentSet = new Set(current);
    const priorEntries = sameContext && raw.entries && typeof raw.entries === 'object'
      ? raw.entries
      : {};
    const confirmedHistory = new Set(
      sameContext ? normalizedCoordList(raw.confirmedHistory) : [...migratedConfirmedSet]
    );
    const previousSnapshotAt = sameContext ? Math.max(0, Number(raw.at) || 0) : 0;
    const entries = {};
    const confirmedCoords = [];
    const awaitingCoords = [];
    const newlyConfirmedCoords = [];

    for (const coord of current) {
      const prior = priorEntries[coord] && typeof priorEntries[coord] === 'object'
        ? priorEntries[coord]
        : {};
      // dynamicTargets da 1.5.5 era apenas o último snapshot do mapa. Só uma
      // coordenada com prova operacional real pode saltar a confirmação 2x/60 s.
      const migratedKnown = !sameContext && migratedConfirmedSet.has(coord);
      const consecutivelyPresent = sameContext && previousSet.has(coord);
      const alreadyConfirmed = Boolean(prior.confirmed) || migratedKnown || confirmedHistory.has(coord);
      const firstSeenAt = alreadyConfirmed
        ? Math.max(0, Number(prior.firstSeenAt) || 0)
        : (consecutivelyPresent
            ? Math.max(1, Number(prior.firstSeenAt) || previousSnapshotAt || at)
            : at);
      const previousConsecutive = Math.max(0, Math.trunc(Number(prior.consecutive) || 0));
      const consecutive = alreadyConfirmed
        ? Math.max(MAP_BOOTSTRAP_CONFIRMATIONS, previousConsecutive)
        : (consecutivelyPresent
            ? Math.max(1, previousConsecutive) + (previousSnapshotAt > 0 && at > previousSnapshotAt ? 1 : 0)
            : 1);
      const confirmed = alreadyConfirmed || Boolean(
        consecutive >= MAP_BOOTSTRAP_CONFIRMATIONS &&
        at - firstSeenAt >= Math.max(0, Number(minConfirmationMs) || 0)
      );

      if (confirmed) {
        confirmedCoords.push(coord);
        confirmedHistory.add(coord);
      } else {
        awaitingCoords.push(coord);
        // Só as presenças ainda por confirmar precisam dos timestamps/contador.
        // Farms confirmadas ficam na lista compacta confirmedHistory.
        entries[coord] = {
          firstSeenAt,
          lastSeenAt: at,
          consecutive,
          confirmed: false
        };
      }
      if (confirmed && !alreadyConfirmed && sameContext) newlyConfirmedCoords.push(coord);
    }

    const canCompare = sameContext || previous.length > 0;
    const addedCoords = canCompare ? current.filter(coord => !previousSet.has(coord)) : [];
    const removedCoords = canCompare ? previous.filter(coord => !currentSet.has(coord)) : [];

    return {
      state: {
        schema: MAP_PRESENCE_SCHEMA_VERSION,
        contextKey: String(contextKey || ''),
        radius: Number(radius) || 0,
        at,
        coords: current,
        entries,
        confirmedHistory: normalizedCoordList([...confirmedHistory])
      },
      confirmedCoords,
      awaitingCoords,
      newlyConfirmedCoords,
      addedCoords,
      removedCoords,
      previousRadius: sameContext ? Number(raw.radius) || 0 : null
    };
  }

  function formatCoordDelta(coords, limit = 16) {
    const clean = normalizedCoordList(coords);
    if (!clean.length) return '—';
    const shown = clean.slice(0, Math.max(1, Number(limit) || 16));
    return `${shown.join(', ')}${clean.length > shown.length ? ` (+${clean.length - shown.length})` : ''}`;
  }

  function recordFreshMapPresence(map, villageId, c, previousTargets, center) {
    const key = String(villageId || '');
    const raw = loadJSON('mapPresenceV2', {}, villageId);
    const legacyConfirmed = legacyOperationalProofCoords(previousTargets, states(villageId));
    const result = nextMapPresenceState(
      raw,
      [...map.keys()],
      previousTargets,
      Date.now(),
      `${key}:${String(center || '')}`,
      c.radius,
      MAP_BOOTSTRAP_CONFIRM_MIN_MS,
      legacyConfirmed
    );

    requireStored(saveJSON('mapPresenceV2', result.state, villageId), 'confirmação de estabilidade do mapa');
    RUNTIME.mapBootstrapConfirmedByVillage.set(key, new Set(result.confirmedCoords));
    RUNTIME.mapBootstrapAwaitingByVillage.set(key, new Set(result.awaitingCoords));

    if (Number(raw?.schema) !== MAP_PRESENCE_SCHEMA_VERSION && previousTargets.length) {
      const awaitingLegacy = normalizedCoordList(previousTargets)
        .filter(coord => map.has(coord) && !legacyConfirmed.includes(coord));
      addDiagnostic(
        'MIGRAÇÃO',
        `Mapa legado: ${legacyConfirmed.length} coordenada(s) com prova operacional; ${awaitingLegacy.length} aguardam confirmação.`,
        awaitingLegacy.length
          ? `${formatCoordDelta(awaitingLegacy)} precisam de um segundo snapshot fresco após 60 s`
          : 'nenhum target legado foi confirmado apenas por existir em dynamicTargets',
        villageId
      );
    }

    const radiusChange = result.previousRadius !== null && result.previousRadius !== Number(c.radius)
      ? ` · raio ${result.previousRadius}→${c.radius}`
      : '';
    if (result.addedCoords.length) {
      addDiagnostic(
        'MAPAΔ',
        `+${result.addedCoords.length}: ${formatCoordDelta(result.addedCoords)}`,
        `entrada no snapshot${radiusChange}; coordenadas inéditas aguardam confirmação`,
        villageId
      );
    }
    if (result.removedCoords.length) {
      addDiagnostic(
        'MAPAΔ',
        `-${result.removedCoords.length}: ${formatCoordDelta(result.removedCoords)}`,
        `ausentes no snapshot fresco${radiusChange}`,
        villageId
      );
    }
    if (result.newlyConfirmedCoords.length) {
      addDiagnostic(
        'MAPAΔ',
        `${result.newlyConfirmedCoords.length} coordenada(s) estabilizada(s): ${formatCoordDelta(result.newlyConfirmedCoords)}`,
        `presentes em pelo menos ${MAP_BOOTSTRAP_CONFIRMATIONS} snapshots consecutivos durante ${Math.round(MAP_BOOTSTRAP_CONFIRM_MIN_MS / 1000)} s`,
        villageId
      );
    }

    return result;
  }

  function normalizeVisualScanSnapshot(raw, c) {
    const schema = Number(raw?.schema);
    if (!raw || ![1, VISUAL_SCAN_SCHEMA_VERSION].includes(schema)) return null;
    if (Number(raw.radius) !== Number(c?.radius)) return null;
    const legacyAt = finiteObservedNumber(raw.at);
    const scanAt = finiteObservedNumber(raw.scanAt) ?? legacyAt;
    const updatedAt = finiteObservedNumber(raw.updatedAt) ?? legacyAt;
    if (scanAt === null || !(scanAt > 0) || updatedAt === null || !(updatedAt > 0)) return null;
    const newCount = finiteObservedNumber(raw.newReadyCount) ?? finiteObservedNumber(raw.newCount);
    return {
      schema: VISUAL_SCAN_SCHEMA_VERSION,
      // `at` mantém compatibilidade com consumidores 2.0.4-2.0.8. A frescura da
      // fila visual usa updatedAt; scanAt continua a representar a leitura do Assistant.
      at: updatedAt,
      scanAt,
      updatedAt,
      revision: Math.max(0, Math.trunc(Number(raw.revision) || 0)),
      radius: Number(raw.radius),
      mapCount: finiteObservedNumber(raw.mapCount),
      assistantRows: finiteObservedNumber(raw.assistantRows),
      pagesScanned: finiteObservedNumber(raw.pagesScanned),
      scanMode: ['full', 'cache'].includes(String(raw.scanMode)) ? String(raw.scanMode) : '—',
      truncated: Boolean(raw.truncated),
      coverage: String(raw.coverage || '—'),
      rediscoveryCount: finiteObservedNumber(raw.rediscoveryCount),
      eligibleCount: finiteObservedNumber(raw.eligibleCount),
      newCount,
      newReadyCount: newCount,
      newCoords: normalizedCoordList(raw.newCoords),
      newPendingCount: finiteObservedNumber(raw.newPendingCount) ?? 0,
      newPendingCoords: normalizedCoordList(raw.newPendingCoords),
      knownMissingCount: finiteObservedNumber(raw.knownMissingCount) ?? 0,
      awaitingMapCount: finiteObservedNumber(raw.awaitingMapCount),
      newHistoryCheckCount: finiteObservedNumber(raw.newHistoryCheckCount) ?? 0,
      newHistoryCheckCoords: normalizedCoordList(raw.newHistoryCheckCoords),
      newAbsenceCheckCount: finiteObservedNumber(raw.newAbsenceCheckCount) ?? 0,
      newAbsenceCheckCoords: normalizedCoordList(raw.newAbsenceCheckCoords),
      newCandidateCount: finiteObservedNumber(raw.newCandidateCount) ?? 0,
      lastNewChangeAt: Math.max(0, Number(raw.lastNewChangeAt) || 0),
      lastNewChange: raw.lastNewChange && typeof raw.lastNewChange === 'object'
        ? {
            added: normalizedCoordList(raw.lastNewChange.added),
            removed: normalizedCoordList(raw.lastNewChange.removed),
            reasons: raw.lastNewChange.reasons && typeof raw.lastNewChange.reasons === 'object'
              ? { ...raw.lastNewChange.reasons }
              : {}
          }
        : null
    };
  }

  function visualScanSnapshot(villageId, c = cfg(villageId)) {
    return normalizeVisualScanSnapshot(loadJSON('visualScanV2', null, villageId), c);
  }

  function visualSnapshotAgeText(at, now = Date.now()) {
    const ageSeconds = Math.max(0, Math.floor((Number(now) - Number(at || 0)) / 1000));
    if (ageSeconds < 5) return 'agora';
    if (ageSeconds < 60) return `há ${ageSeconds}s`;
    const minutes = Math.floor(ageSeconds / 60);
    if (minutes < 60) return `há ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `há ${hours}h`;
  }

  function newTargetRemovalReason(coord, rows, map, statesByCoord) {
    const st = statesByCoord?.[coord] || {};
    if (st.pending || st.sending || Number(st.bootstrapAttemptedAt || 0) > 0) return 'primeiro envio iniciado/pendente';
    if (rows?.has?.(coord) || st.assistantEverSeen || st.lastReportId) return 'agora conhecida no Assistente';
    if (!map?.has?.(coord)) return 'saiu do snapshot atual do mapa';
    return 'deixou de cumprir uma guarda de elegibilidade';
  }

  function filterMapConfirmedBootstraps(eligible, confirmedCoords) {
    const confirmed = confirmedCoords instanceof Set ? confirmedCoords : new Set();
    return (Array.isArray(eligible) ? eligible : []).filter(
      item => !item?.bootstrap || confirmed.has(String(item.coord || ''))
    );
  }

  function persistVisualScanSnapshot(eligible, rows, map, scan, statesByCoord, villageId, c, candidateStats = null) {
    const newCoords = normalizedCoordList((eligible || [])
      .filter(item => item?.bootstrap)
      .map(item => item.coord));
    const previous = visualScanSnapshot(villageId, c);
    const previousSet = new Set(previous?.newCoords || []);
    const currentSet = new Set(newCoords);
    const added = previous ? newCoords.filter(coord => !previousSet.has(coord)) : [];
    const removed = previous ? [...previousSet].filter(coord => !currentSet.has(coord)) : [];
    const pendingBootstrapCoords = normalizedCoordList(Object.entries(statesByCoord || {})
      .filter(([, state]) => Boolean(
        (state?.pending || state?.sending) &&
        (state?.sendingBootstrap || Number(state?.bootstrapAttemptedAt || 0) > 0)
      ))
      .map(([coord]) => coord));
    const removalReasons = {};
    const historyCheckCoords = candidateStats
      ? normalizedCoordList(candidateStats.awaitingReportHistoryCoords)
      : normalizedCoordList(previous?.newHistoryCheckCoords);
    const absenceCheckCoords = candidateStats
      ? normalizedCoordList(candidateStats.awaitingAbsenceProofCoords)
      : normalizedCoordList(previous?.newAbsenceCheckCoords);
    const awaitingMapCoords = normalizedCoordList(
      RUNTIME.mapBootstrapAwaitingByVillage.get(String(villageId || '')) || []
    );
    const newCandidateCoords = normalizedCoordList([
      ...newCoords,
      ...historyCheckCoords,
      ...absenceCheckCoords,
      ...awaitingMapCoords
    ]);
    if (Number(previous?.newCandidateCount ?? -1) !== newCandidateCoords.length) {
      addDiagnostic(
        'NOVAS',
        `${newCandidateCoords.length} candidata(s) a nova detetada(s).`,
        `${awaitingMapCoords.length} mapa · ${absenceCheckCoords.length} ausência · ` +
          `${historyCheckCoords.length} histórico · ${newCoords.length} prontas`,
        villageId
      );
    }

    if (!previous && newCoords.length) {
      addDiagnostic(
        'NOVAS',
        `Baseline visual: ${newCoords.length} nova(s).`,
        formatCoordDelta(newCoords),
        villageId
      );
    }

    for (const coord of added.slice(0, 20)) {
      addDiagnostic('NOVAS', `+1: ${coord}`, 'ausência comprovada no Assistente e mapa estabilizado', villageId);
    }
    for (const coord of removed.slice(0, 20)) {
      const reason = newTargetRemovalReason(coord, rows, map, statesByCoord);
      removalReasons[coord] = reason;
      addDiagnostic('NOVAS', `-1: ${coord}`, reason, villageId);
    }
    if (added.length > 20 || removed.length > 20) {
      addDiagnostic(
        'NOVAS',
        'Delta truncado no diagnóstico.',
        `+${added.length} / -${removed.length}; primeiras 20 coordenadas de cada grupo registadas`,
        villageId
      );
    }

    const now = Date.now();
    const queueChanged = added.length > 0 || removed.length > 0;
    const previousUpdatedAt = Math.max(0, Number(previous?.updatedAt || previous?.at) || 0);
    const updatedAt = Math.max(now, previousUpdatedAt + 1);
    const snapshot = {
      schema: VISUAL_SCAN_SCHEMA_VERSION,
      at: updatedAt,
      scanAt: Number(scan?.at) > 0 ? Number(scan.at) : (Number(previous?.scanAt) || now),
      updatedAt,
      revision: Math.max(0, Math.trunc(Number(previous?.revision) || 0)) + 1,
      radius: Number(c.radius),
      mapCount: map?.size ?? null,
      assistantRows: rows?.size ?? null,
      pagesScanned: scan?.pagesScanned ?? null,
      scanMode: scan ? (scan.fullScan ? 'full' : 'cache') : '—',
      truncated: Boolean(scan?.truncated),
      coverage: scan ? (scan.assistantCoversRadius ? 'ausência comprovável' : 'ausência não comprovável') : '—',
      rediscoveryCount: scan?.needsRediscoveryCount ?? null,
      eligibleCount: Array.isArray(eligible) ? eligible.length : null,
      newCount: newCoords.length,
      newReadyCount: newCoords.length,
      newCoords,
      newPendingCount: pendingBootstrapCoords.length,
      newPendingCoords: pendingBootstrapCoords,
      knownMissingCount: (eligible || []).filter(item => item?.knownMissing).length,
      awaitingMapCount: awaitingMapCoords.length,
      newHistoryCheckCount: historyCheckCoords.length,
      newHistoryCheckCoords: historyCheckCoords,
      newAbsenceCheckCount: absenceCheckCoords.length,
      newAbsenceCheckCoords: absenceCheckCoords,
      newCandidateCount: newCandidateCoords.length,
      lastNewChangeAt: queueChanged ? updatedAt : Math.max(0, Number(previous?.lastNewChangeAt) || 0),
      lastNewChange: queueChanged
        ? { added, removed, reasons: removalReasons }
        : (previous?.lastNewChange || null)
    };
    if (!saveJSON('visualScanV2', snapshot, villageId)) {
      addDiagnostic('UI', 'Não foi possível persistir o snapshot visual do scan.', 'o motor operacional não foi afetado', villageId);
    }
    return snapshot;
  }

  function mapAuthorizationTtlMs(c) {
    return Math.max(
      MAP_AUTHORIZATION_MIN_TTL_MS,
      Math.min(
        MAP_AUTHORIZATION_MAX_TTL_MS,
        Math.max(15, Number(c?.retrySeconds) || DEFAULTS.retrySeconds) * 1000
      )
    );
  }

  function normalizeWorldMapSource(raw, c = DEFAULTS) {
    const x = raw && typeof raw === 'object' ? raw : {};
    const observedAt = Math.max(0, Number(x.worldObservedAt ?? x.observedAt) || 0);
    return {
      worldRevision: Math.max(0, Math.trunc(Number(x.worldRevision) || 0)),
      worldObservedAt: observedAt,
      analysisFreshUntil: Math.max(0, Number(x.analysisFreshUntil) || (observedAt + Number(c.mapRefreshMin || 5) * 60000)),
      authorizationFreshUntil: Math.max(0, Number(x.authorizationFreshUntil) || (observedAt + mapAuthorizationTtlMs(c))),
      villages: x.villages instanceof Map ? x.villages : null
    };
  }

  function mapSourceData(map, villageId, c, worldSource) {
    const source = normalizeWorldMapSource(worldSource, c);
    return {
      villageId: String(villageId),
      radius: Number(c.radius),
      targets: serializableMapTargets(map),
      worldRevision: source.worldRevision,
      worldObservedAt: source.worldObservedAt,
      analysisFreshUntil: source.analysisFreshUntil,
      authorizationFreshUntil: source.authorizationFreshUntil,
      derivedFromWorldRevision: source.worldRevision
    };
  }

  function worldMapsSemanticallyEqual(left, right) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
    for (const [id, village] of left) {
      const other = right.get(String(id));
      if (!other) return false;
      if (
        Number(village?.x) !== Number(other?.x) ||
        Number(village?.y) !== Number(other?.y) ||
        String(village?.ownerId) !== String(other?.ownerId)

      ) return false;
    }
    return true;
  }

  async function getVillageMap(villageId, options = {}) {
    const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const rebuildSubset = Boolean(opts.rebuildSubset);
    const requireFreshWorld = Boolean(opts.requireFreshWorld);
    const c = cfg(villageId);
    const now = Date.now();
    const maxAge = c.mapRefreshMin * 60000;
    const gameCoord = currentVillageCoord();
    const expectedContextKey = gameCoord ? `${villageId}:${gameCoord}:r${c.radius}` : null;

    if (
      !rebuildSubset &&
      RUNTIME.villageMap &&
      expectedContextKey &&
      RUNTIME.villageMapContextKey === expectedContextKey &&
      now - RUNTIME.villageMapLoadedAt < maxAge &&
      (!requireFreshWorld || now <= RUNTIME.villageMapLoadedAt + mapAuthorizationTtlMs(c))
    ) {
      return RUNTIME.villageMap;
    }

    const previousTargets = targetCoords(villageId);
    const worldKey = String(location.host);
    const sharedWorld = normalizeWorldMapSource(RUNTIME.worldMapByHost.get(worldKey), c);
    const persistedWorldRevision = Math.max(
      0,
      Number(coordinationState(villageId).sources.MAP?.data?.worldRevision) || 0
    );
    let world;
    let activeWorldSource;
    const sharedWorldFresh = sharedWorld.villages instanceof Map &&
      now <= (requireFreshWorld ? sharedWorld.authorizationFreshUntil : sharedWorld.analysisFreshUntil);
    if (sharedWorldFresh) {
      world = sharedWorld.villages;
      activeWorldSource = sharedWorld;
    } else {
      const text = await fetchWorldMap(villageId);
      world = new Map();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length < 5) continue;
        const id = String(parts[0]);
        const x = Number(parts[2]);
        const y = Number(parts[3]);
        const ownerId = String(parts[4]);
        if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        world.set(id, { id, x, y, ownerId });
      }
      const responseAt = Date.now();
      const semanticRevision = worldMapsSemanticallyEqual(sharedWorld.villages, world)
        ? Math.max(1, sharedWorld.worldRevision, persistedWorldRevision)
        : Math.max(sharedWorld.worldRevision, persistedWorldRevision) + 1;
      activeWorldSource = normalizeWorldMapSource({
        worldRevision: semanticRevision,
        worldObservedAt: responseAt,
        analysisFreshUntil: responseAt + maxAge,
        authorizationFreshUntil: responseAt + mapAuthorizationTtlMs(c),
        villages: world
      }, c);
      RUNTIME.worldMapByHost.set(worldKey, activeWorldSource);
    }
    let sourceX = null;
    let sourceY = null;

    const coordMatch = gameCoord?.match(/^(\d{3})\|(\d{3})$/);
    if (coordMatch) {
      sourceX = Number(coordMatch[1]);
      sourceY = Number(coordMatch[2]);
    }

    // Se game_data não fornecer coordenadas, usa o world map já parseado e partilhado.
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
      const sourceVillage = world.get(String(villageId));
      sourceX = Number(sourceVillage?.x);
      sourceY = Number(sourceVillage?.y);
    }

    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
      throw codedError('SOURCE_COORD_NOT_FOUND', 'Não foi possível determinar as coordenadas da aldeia atual.');
    }

    // O world map completo existe apenas em memória. Só o subset relevante desta
    // aldeia/raio será persistido na MapSource, evitando localStorage gigante.
    const candidates = [];
    for (const village of world.values()) {
      if (String(village.ownerId) !== '0') continue;
      const id = String(village.id);
      const x = Number(village.x);
      const y = Number(village.y);

      const distance = Math.hypot(x - sourceX, y - sourceY);
      if (distance > c.radius) continue;

      candidates.push({ id, x, y, coord: `${x}|${y}`, distance });
    }

    candidates.sort((a, b) => a.distance - b.distance || a.coord.localeCompare(b.coord));

    const map = new Map();
    for (const v of candidates) map.set(v.coord, v.id);

    const center = `${sourceX}|${sourceY}`;
    const contextKey = `${villageId}:${center}:r${c.radius}`;

    RUNTIME.villageMap = map;
    RUNTIME.villageMapLoadedAt = activeWorldSource.worldObservedAt;
    RUNTIME.villageMapContextKey = contextKey;
    RUNTIME.villageMapDerivedFromWorldRevision = activeWorldSource.worldRevision;
    recordFreshMapPresence(map, villageId, c, previousTargets, center);
    setTargetCoords([...map.keys()], villageId);

    touchCoordinationSource(villageId, 'MAP', {
      status: 'READY',
      observedAt: activeWorldSource.worldObservedAt,
      freshUntil: activeWorldSource.analysisFreshUntil,
      invalidated: false,
      reason: requireFreshWorld ? 'world map fresco para autorização' : 'world map para análise',
      data: mapSourceData(map, villageId, c, activeWorldSource)
    });

    return map;
  }

  function mapSnapshotFreshness(villageId, c) {
    const gameCoord = currentVillageCoord();
    const expectedKey = gameCoord
      ? `${villageId}:${gameCoord}:r${c.radius}`
      : '';
    const now = Date.now();
    const source = coordinationState(villageId).sources.MAP;
    const data = source?.data || {};
    const observedAt = Math.max(Number(data.worldObservedAt) || 0, Number(RUNTIME.villageMapLoadedAt) || 0);
    const ageMs = now - observedAt;
    const maxAgeMs = mapAuthorizationTtlMs(c);
    const authorizationFreshUntil = Math.max(0, Number(data.authorizationFreshUntil) || 0);
    const derivedRevision = Math.max(0, Number(data.derivedFromWorldRevision) || 0);
    const worldRevision = Math.max(0, Number(data.worldRevision) || 0);
    const runtimeContextMatches = Boolean(
      RUNTIME.villageMap && expectedKey && RUNTIME.villageMapContextKey === expectedKey
    );
    const persistedContextMatches = Boolean(
      Number(data.radius) === Number(c.radius) && Array.isArray(data.targets)
    );

    const fresh = Boolean(
      (runtimeContextMatches || persistedContextMatches) &&
      derivedRevision > 0 && derivedRevision === worldRevision &&
      authorizationFreshUntil >= now &&
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs <= maxAgeMs
    );

    return { fresh, ageMs, maxAgeMs, expectedKey, authorizationFreshUntil, worldRevision, derivedRevision };
  }

  function assertFreshMapSnapshot(villageId, c) {
    const status = mapSnapshotFreshness(villageId, c);
    if (!status.fresh) {
      throw codedError(
        'MAP_SNAPSHOT_STALE',
        'O snapshot de map/village.txt envelheceu durante esta passagem; nenhum novo POST será iniciado.'
      );
    }
    return true;
  }

  async function refreshMapForSending(villageId, c, reason = 'snapshot antigo') {
    info(`A revalidar map/village.txt antes de continuar (${reason})…`);
    const refreshed = await getVillageMap(villageId, {
      rebuildSubset: true,
      requireFreshWorld: true
    });
    AntiBotGuard.assertSafe();
    assertVillageContext(villageId);
    assertFreshMapSnapshot(villageId, c);
    return refreshed;
  }

  // ---------------------------------------------------------------------------
  // TEMPLATES A / B (C é ação nativa especial baseada em espionagem)
  // ---------------------------------------------------------------------------

  function templateCacheKey(villageId, farmTemplate) {
    return `${String(villageId)}:${String(farmTemplate || 'A').toUpperCase()}`;
  }

  function clearTemplateCacheForVillage(villageId) {
    const prefix = `${String(villageId)}:`;
    for (const key of [...RUNTIME.templateByVillage.keys()]) {
      if (String(key).startsWith(prefix)) RUNTIME.templateByVillage.delete(key);
    }
  }

  async function discoverFarmTemplate(rows, villageId, farmTemplate = 'A') {
    const letter = ['A', 'B'].includes(String(farmTemplate).toUpperCase())
      ? String(farmTemplate).toUpperCase()
      : 'A';
    const cacheKey = templateCacheKey(villageId, letter);
    const cached = RUNTIME.templateByVillage.get(cacheKey) || null;
    const ids = new Set();

    // A evidência fresca da passagem prevalece sempre sobre o cache runtime.
    for (const row of rows.values()) {
      if (row.templateId) ids.add(String(row.templateId));
    }

    if (ids.size > 1) {
      throw codedError(
        'TEMPLATE_AMBIGUOUS',
        `Foram encontrados vários IDs para o modelo ${letter}: ${[...ids].join(', ')}.`
      );
    }

    if (ids.size === 1) {
      const id = [...ids][0];
      if (cached && String(cached) !== id) {
        console.warn('[AutoFarmRadius] template_id mudou; cache atualizado', {
          modelo: letter,
          anterior: String(cached),
          atual: id
        });
      }
      RUNTIME.templateByVillage.set(cacheKey, id);
      return id;
    }

    const sawUnsupported = [...rows.values()].some(
      row => row.buttonPresent && !row.buttonSupported
    );

    // Reutiliza a página 0 que loadAllFarmRows acabou de obter nesta passagem.
    // Só faz novo GET se, por alguma razão, não existir snapshot fresco.
    const snapshot = RUNTIME.farmPageSnapshotByVillage.get(String(villageId));
    const doc = snapshot?.doc || await fetchHtml(getFarmUrl(0, villageId), villageId);
    const candidates = new Set();
    let pageHasUnsupported = false;

    for (const a of doc.querySelectorAll(`#plunder_list a.farm_icon_${letter.toLowerCase()}`)) {
      const onclick = a.getAttribute('onclick') || '';
      const fromData = a.dataset?.templateId || a.dataset?.template || null;
      const mm = onclick.match(
        /(?:Accountmanager\.farm\.)?sendUnits\s*\(\s*this\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i
      );

      if (fromData) candidates.add(String(fromData));
      if (mm) candidates.add(String(mm[2]));

      if (
        onclick &&
        !mm &&
        /Accountmanager\.farm\.\w+\s*\(/i.test(onclick)
      ) {
        pageHasUnsupported = true;
      }
    }

    if (candidates.size > 1) {
      throw codedError(
        'TEMPLATE_AMBIGUOUS',
        `A página atual expõe vários IDs para o modelo ${letter}: ${[...candidates].join(', ')}.`
      );
    }

    if (candidates.size === 1) {
      const id = [...candidates][0];
      if (cached && String(cached) !== id) {
        console.warn('[AutoFarmRadius] template_id mudou na página 0; cache atualizado', {
          modelo: letter,
          anterior: String(cached),
          atual: id
        });
      }
      RUNTIME.templateByVillage.set(cacheKey, id);
      return id;
    }

    if (sawUnsupported || pageHasUnsupported) {
      throw codedError(
        'TEMPLATE_ACTION_UNSUPPORTED',
        `O botão ${letter} usa uma ação que não expõe template_id de forma segura. Não vou enviar por aproximação.`
      );
    }

    // O cache runtime só é usado quando a passagem atual não fornece qualquer ID novo.
    // Não é persistido entre reloads e deixa de prevalecer assim que aparece evidência fresca.
    return cached ? String(cached) : null;
  }


  // ---------------------------------------------------------------------------
  // MOTOR ADAPTATIVO V2
  // ---------------------------------------------------------------------------

  const ADAPTIVE_SCHEMA_VERSION = 10;
  const ADAPTIVE_EVENT_LIMIT = 1200;
  const ADAPTIVE_DISPATCH_LIMIT = 1000;
  const ADAPTIVE_REPORT_LEDGER_LIMIT = 2400;
  const ADAPTIVE_RECENT_PER_FARM_LIMIT = 256;
  const ADAPTIVE_CAPACITY_GRID = Object.freeze([40, 80, 160, 240, 320, 500, 750, 1000, 1250, 1500, 2000, 3000]);
  const ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS = 6;
  const ADAPTIVE_REPORT_INDEX_MAX_PAGES = 100;
  const ADAPTIVE_REST_BUCKET_HOURS = Object.freeze([1, 2, 3, 4, 6, 12, 24]);
  const ADAPTIVE_REPORT_MATCH_EARLY_MS = 5 * 60000;
  const ADAPTIVE_REPORT_MATCH_LATE_MS = 15 * 60000;
  const ADAPTIVE_BOOTSTRAP_DEBT_THRESHOLD = 2;
  const ADAPTIVE_ALLOCATION_CLASSES = Object.freeze(['EXPLOIT', 'EXPLORE', 'NEW', 'TREND', 'COVERAGE']);
  const ADAPTIVE_REPORT_WORDS = Object.freeze({
    haul: /(?:saque|haul|booty|buit|beute|butin|bottino|bot[ií]n)/i,
    quantity: /(?:quantidade|quantity|amount|n[uú]mero|numero|anzahl|cantidad|quantit[aà])/i,
    losses: /(?:perdas|losses|verluste|p[eé]rdidas|pertes|perdite)/i
  });
  const REPORT_DISCOVERY_STATES = Object.freeze([
    'COMPLETE', 'NOT_AVAILABLE_CONFIRMED', 'RETRYABLE_READ_FAILURE',
    'PARSE_UNKNOWN', 'BACKLOG', 'PENDING', 'OUT_OF_SCOPE', 'DUPLICATE_CANONICAL'
  ]);

  function normalizeAdaptiveReportIndex(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const backlog = Array.isArray(x.backlog) ? x.backlog : [];
    const normalizedBacklog = [];
    const seen = new Set();
    for (const item of backlog) {
      const reportId = String(item?.reportId || '');
      const targetCoord = String(item?.targetCoord || item?.coord || '');
      if (!reportId || !/^\d{3}\|\d{3}$/.test(targetCoord) || seen.has(reportId)) continue;
      seen.add(reportId);
      normalizedBacklog.push({
        reportId,
        targetCoord,
        assistantAttackAt: finiteObservedNumber(item?.assistantAttackAt),
        discoveredAt: Math.max(0, Number(item?.discoveredAt) || 0),
        source: String(item?.source || 'report-index')
      });
    }
    const discovered = {};
    const rawDiscovered = x.discovered && typeof x.discovered === 'object' && !Array.isArray(x.discovered)
      ? x.discovered
      : {};
    for (const [rawId, rawEntry] of Object.entries(rawDiscovered)) {
      const reportId = String(rawId || rawEntry?.reportId || '');
      if (!reportId) continue;
      const state = REPORT_DISCOVERY_STATES.includes(String(rawEntry?.state))
        ? String(rawEntry.state)
        : 'PENDING';
      discovered[reportId] = {
        reportId,
        targetCoord: String(rawEntry?.targetCoord || ''),
        assistantAttackAt: finiteObservedNumber(rawEntry?.assistantAttackAt),
        discoveredAt: Math.max(0, Number(rawEntry?.discoveredAt) || 0),
        updatedAt: Math.max(0, Number(rawEntry?.updatedAt) || 0),
        state,
        canonicalReportId: rawEntry?.canonicalReportId ? String(rawEntry.canonicalReportId) : null
      };
    }
    return {
      nextPage: Math.max(0, Math.min(ADAPTIVE_REPORT_INDEX_MAX_PAGES, Math.trunc(Number(x.nextPage) || 0))),
      cycleStartedAt: Math.max(0, Number(x.cycleStartedAt) || 0),
      completedAt: Math.max(0, Number(x.completedAt) || 0),
      completedThroughTimestamp: Math.max(0, Number(x.completedThroughTimestamp) || 0),
      oldestSeenTimestamp: Math.max(0, Number(x.oldestSeenTimestamp) || 0),
      lastScanAt: Math.max(0, Number(x.lastScanAt) || 0),
      lastIndexAt: Math.max(0, Number(x.lastIndexAt ?? x.lastScanAt) || 0),
      nextIndexAt: Math.max(0, Number(x.nextIndexAt) || 0),
      lastPageCount: Math.max(0, Math.trunc(Number(x.lastPageCount) || 0)),
      rawRowsSeen: Math.max(0, Math.trunc(Number(x.rawRowsSeen) || 0)),
      relevantRowsSeen: Math.max(0, Math.trunc(Number(x.relevantRowsSeen) || 0)),
      historyDays: Math.max(0, Math.trunc(Number(x.historyDays) || 0)),
      scopeKey: String(x.scopeKey || ''),
      // Prova leve e durável de que a coordenada já apareceu no índice de
      // Relatórios. Não autoriza envio nem treina o modelo; serve apenas para
      // impedir que uma farm antiga seja rebatizada como BOOTSTRAP_NEW.
      historyCoords: normalizedCoordList(x.historyCoords),
      backlog: normalizedBacklog.slice(-ADAPTIVE_REPORT_LEDGER_LIMIT),
      discovered,
      detailsPending: Math.max(0, Math.trunc(Number(x.detailsPending) || normalizedBacklog.length))
    };
  }

  function setReportDiscoveryState(reportIndex, reportId, patch = {}) {
    const state = normalizeAdaptiveReportIndex(reportIndex);
    const id = String(reportId || '');
    if (!id) return state;
    const previous = state.discovered[id] || { reportId: id };
    const requestedState = String(patch.state || previous.state || 'PENDING');
    state.discovered[id] = {
      ...previous,
      ...patch,
      reportId: id,
      state: REPORT_DISCOVERY_STATES.includes(requestedState) ? requestedState : 'PENDING',
      updatedAt: Math.max(1, Number(patch.updatedAt) || Date.now())
    };
    state.detailsPending = Object.values(state.discovered).filter(item =>
      ['BACKLOG', 'PENDING', 'RETRYABLE_READ_FAILURE', 'PARSE_UNKNOWN'].includes(String(item?.state))

    ).length;
    return state;
  }

  function reportCompletenessSummary(reportIndex, reportLedger = []) {
    const state = normalizeAdaptiveReportIndex(reportIndex);
    const ledgerIds = new Set((reportLedger || []).map(item => String(item?.reportId || '')).filter(Boolean));
    const counts = {
      discovered: 0, complete: 0, unavailable: 0, retryable: 0,
      parseUnknown: 0, backlog: 0, outOfScope: 0, duplicate: 0, unexplainedMissing: 0
    };
    for (const item of Object.values(state.discovered)) {
      if (String(item.state) === 'OUT_OF_SCOPE') { counts.outOfScope++; continue; }
      counts.discovered++;
      if (item.state === 'NOT_AVAILABLE_CONFIRMED') counts.unavailable++;
      else if (ledgerIds.has(String(item.reportId)) || item.state === 'COMPLETE') counts.complete++;
      else if (item.state === 'RETRYABLE_READ_FAILURE') counts.retryable++;
      else if (item.state === 'PARSE_UNKNOWN') counts.parseUnknown++;
      else if (['BACKLOG', 'PENDING'].includes(item.state)) counts.backlog++;
      else if (item.state === 'DUPLICATE_CANONICAL') counts.duplicate++;
      else counts.unexplainedMissing++;
    }
    return counts;
  }

  function reportIndexWorkDue(reportIndex, now = Date.now(), activeCoords = null) {
    const state = normalizeAdaptiveReportIndex(reportIndex);
    if (activeCoords instanceof Set && Object.values(state.discovered).some(item =>
      item?.state === 'OUT_OF_SCOPE' && activeCoords.has(String(item?.targetCoord || ''))
    )) return true;
    if (state.backlog.length > 0 || state.detailsPending > 0) return true;
    if (state.completedAt > 0) return Number(state.nextIndexAt || 0) <= Number(now);
    return Number(state.nextIndexAt || 0) <= Number(now);
  }

  function adaptiveReportIndexScopeKey(map, c) {
    // O índice de ataques pertence à aldeia de origem (o namespace persistido
    // já inclui villageId), não ao snapshot momentâneo do mapa. Nas versões
    // anteriores, 60→75→81 alvos reiniciava o backfill em cada alteração e
    // podia manter todas as candidatas eternamente em “0 novas prontas”.
    return `global-attack-index-v1:${adaptiveHistoryDays(c)}`;
  }

  function prepareAdaptiveReportIndexScope(raw, map, c, now = Date.now()) {
    const state = normalizeAdaptiveReportIndex(raw);
    const requestedHistoryDays = adaptiveHistoryDays(c);
    const requestedScopeKey = adaptiveReportIndexScopeKey(map, c);
    if (state.historyDays !== requestedHistoryDays || state.scopeKey !== requestedScopeKey) {
      state.nextPage = 0;
      state.cycleStartedAt = Math.max(1, Number(now) || Date.now());
      state.completedAt = 0;
      state.historyDays = requestedHistoryDays;
      state.scopeKey = requestedScopeKey;
    }
    return state;
  }

  function normalizeBootstrapFairness(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      debt: Math.max(0, Math.min(100, Math.trunc(Number(x.debt) || 0))),
      opportunities: Math.max(0, Math.trunc(Number(x.opportunities) || 0)),
      bootstrapSent: Math.max(0, Math.trunc(Number(x.bootstrapSent) || 0)),
      lastOpportunityAt: Math.max(0, Number(x.lastOpportunityAt) || 0),
      lastBootstrapSentAt: Math.max(0, Number(x.lastBootstrapSentAt) || 0),
      eligibleCount: Math.max(0, Math.trunc(Number(x.eligibleCount) || 0)),
      lastOutcome: String(x.lastOutcome || 'NONE')
    };
  }

  function normalizeAdaptiveAllocationBudget(raw) {
    const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const confirmed = {};
    for (const name of ADAPTIVE_ALLOCATION_CLASSES) {
      confirmed[name] = Math.max(0, Math.trunc(Number(x.confirmed?.[name]) || 0));
    }
    const total = Math.max(
      Object.values(confirmed).reduce((sum, value) => sum + value, 0),
      Math.trunc(Number(x.total) || 0)
    );
    return {
      total,
      confirmed,
      lastUpdatedAt: Math.max(0, Number(x.lastUpdatedAt) || 0),
      lastClass: ADAPTIVE_ALLOCATION_CLASSES.includes(String(x.lastClass)) ? String(x.lastClass) : null
    };
  }

  function adaptiveAllocationClass(reason) {
    const value = String(reason || 'EXPLOITATION');
    if (value === 'BOOTSTRAP_NEW') return 'NEW';
    if (value === 'FORCED_COVERAGE') return 'COVERAGE';
    if (['EXPLORATION', 'LEARNING'].includes(value)) return 'EXPLORE';
    if (['TREND_CHECK', 'JACKPOT_FOLLOWUP'].includes(value)) return 'TREND';
    return 'EXPLOIT';
  }

  function adaptiveServicePressure(store, now = Date.now()) {
    const active = Object.values(store?.farms || {}).filter(farm => farm?.active !== false).length;
    const since = Number(now) - 24 * 3600000;
    const sent24h = (store?.dispatches || []).filter(dispatch =>
      Number(dispatch?.sentAt || dispatch?.at || 0) >= since &&
      String(dispatch?.status || '') !== 'LEGACY'
    ).length;
    return {
      active,
      sent24h,
      value: active / Math.max(1, sent24h)
    };
  }

  function adaptiveAllocationQuotas(store, c, now = Date.now()) {
    const active = Object.values(store?.farms || {}).filter(farm => farm?.active !== false);
    const unknownFraction = active.length
      ? active.filter(farm => Number(farm?.observations || 0) < Math.max(1, Number(c?.adaptiveLearningTargetObservations) || 3)).length / active.length
      : 0;
    const pressure = adaptiveServicePressure(store, now);
    // As percentagens adaptam-se moderadamente; exploitation continua maioritário
    // quando a população é muito superior ao throughput disponível.
    const learningLift = clampNumber(unknownFraction * 0.10, 0, 0.08, 0);
    const highPressure = clampNumber((pressure.value - 5) / 20, 0, 1, 0);
    const raw = {
      EXPLOIT: 0.68 - learningLift + 0.08 * highPressure,
      EXPLORE: 0.10 + learningLift * 0.65 - 0.03 * highPressure,
      NEW: 0.08 + learningLift * 0.35,
      TREND: 0.07,
      COVERAGE: 0.07 - 0.05 * highPressure
    };
    raw.COVERAGE = Math.max(0.02, raw.COVERAGE);
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
    return {
      quotas: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / total])),
      unknownFraction,
      servicePressure: pressure
    };
  }

  function advanceAdaptiveAllocationBudget(raw, allocationClass, at = Date.now()) {
    const next = normalizeAdaptiveAllocationBudget(raw);
    const name = ADAPTIVE_ALLOCATION_CLASSES.includes(String(allocationClass))
      ? String(allocationClass)
      : 'EXPLOIT';
    next.total += 1;
    next.confirmed[name] += 1;
    next.lastUpdatedAt = Math.max(1, Number(at) || Date.now());
    next.lastClass = name;
    // Só proporções recentes interessam. Reescala sem mudar a razão e evita
    // contadores ilimitados após meses de utilização.
    if (next.total > 10000) {
      for (const key of ADAPTIVE_ALLOCATION_CLASSES) {
        next.confirmed[key] = Math.round(next.confirmed[key] * 0.5);
      }
      next.total = Object.values(next.confirmed).reduce((sum, value) => sum + value, 0);
    }
    return next;
  }

  function adaptiveAllocationSequence(rawAvailable, rawBudget, rawQuotas, requestedCount = Infinity) {
    const available = Object.fromEntries(ADAPTIVE_ALLOCATION_CLASSES.map(name => [
      name,
      Math.max(0, Math.trunc(Number(rawAvailable?.[name]) || 0))
    ]));
    const budget = normalizeAdaptiveAllocationBudget(rawBudget);
    const quotaInput = rawQuotas?.quotas && typeof rawQuotas.quotas === 'object'
      ? rawQuotas.quotas
      : rawQuotas;
    const positiveTotal = ADAPTIVE_ALLOCATION_CLASSES.reduce(
      (sum, name) => sum + Math.max(0, Number(quotaInput?.[name]) || 0),
      0
    ) || 1;
    const quotas = Object.fromEntries(ADAPTIVE_ALLOCATION_CLASSES.map(name => [
      name,
      Math.max(0, Number(quotaInput?.[name]) || 0) / positiveTotal
    ]));
    const maximum = Math.min(
      Object.values(available).reduce((sum, value) => sum + value, 0),
      Number.isFinite(Number(requestedCount))
        ? Math.max(0, Math.trunc(Number(requestedCount)))
        : Number.MAX_SAFE_INTEGER
    );
    const planned = Object.fromEntries(ADAPTIVE_ALLOCATION_CLASSES.map(name => [name, 0]));
    const sequence = [];
    while (sequence.length < maximum) {
      const opportunity = budget.total + sequence.length + 1;
      const next = ADAPTIVE_ALLOCATION_CLASSES
        .filter(name => available[name] > planned[name])
        .map(name => ({
          name,
          debt: quotas[name] * opportunity -
            (Number(budget.confirmed[name] || 0) + planned[name])
        }))
        .sort((a, b) => b.debt - a.debt ||
          ADAPTIVE_ALLOCATION_CLASSES.indexOf(a.name) - ADAPTIVE_ALLOCATION_CLASSES.indexOf(b.name))[0];
      if (!next) break;
      planned[next.name] += 1;
      sequence.push({ name: next.name, debt: next.debt });
    }
    return sequence;
  }

  const ADAPTIVE_INGEST_COUNTER_KEYS = Object.freeze([
    'rows', 'candidates', 'processed', 'backlog', 'baselines', 'duplicates',
    'staleRows', 'synchronized', 'quantitative', 'qualitativeOnly',
    'outOfOrder', 'readFailed', 'parseUnrecognized', 'retryWaiting',
    'reportIndexRows', 'reportIndexNew', 'reportIndexPages', 'operationalSynced'
  ]);

  const ADAPTIVE_ATTRIBUTIONS = Object.freeze(['AUTO_MATCHED', 'EXTERNAL', 'UNATTRIBUTED']);
  const REPORT_DETAIL_STATES = Object.freeze([
    'COMPLETE', 'NOT_AVAILABLE_CONFIRMED', 'RETRYABLE_READ_FAILURE',
    'PARSE_UNKNOWN', 'BLOCKED_HARD_STOP'
  ]);

  function reportDetailFailureDisposition(error) {
    const code = String(error?.code || '');
    if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429', 'LEASE_LOST'].includes(code)) {
      return { state: 'BLOCKED_HARD_STOP', retryable: false, mustThrow: true };
    }
    if (['HTTP_404', 'HTTP_410'].includes(code)) {
      return { state: 'NOT_AVAILABLE_CONFIRMED', retryable: false, mustThrow: false };
    }
    return { state: 'RETRYABLE_READ_FAILURE', retryable: true, mustThrow: false };
  }
  const ADAPTIVE_AUTO_REASONS = Object.freeze([
    'EXPLOITATION', 'EXPLORATION', 'BOOTSTRAP_NEW', 'FORCED_COVERAGE',
    'TREND_CHECK', 'JACKPOT_FOLLOWUP', 'LEARNING', 'EARLY_ROTATION'
  ]);

  function adaptiveEventAttribution(raw) {
    const explicit = String(raw?.attribution || '');
    if (ADAPTIVE_ATTRIBUTIONS.includes(explicit)) return explicit;
    const reason = String(raw?.reason || '');
    if (reason === 'OBSERVED_EXTERNAL') return 'EXTERNAL';
    if (reason === 'OBSERVED_UNATTRIBUTED') return 'UNATTRIBUTED';
    // Migração v2.0.0–2.0.9: nesses esquemas, um reason de dispatch só chegava
    // ao evento depois de matchingAdaptivePending ter associado o report.
    if (ADAPTIVE_AUTO_REASONS.includes(reason)) return 'AUTO_MATCHED';
    return 'UNATTRIBUTED';
  }

  function normalizeAdaptiveEvent(raw, sourceVillageId = '') {
    const e = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const capacity = finiteObservedNumber(e.capacity);
    const loot = finiteObservedNumber(e.loot);
    const rawEfficiency = capacity !== null && capacity > 0 && loot !== null
      ? loot / capacity
      : finiteObservedNumber(e.rawEfficiency ?? e.observedReportEfficiency ?? e.efficiency);
    const observedReportEfficiency = rawEfficiency !== null ? clampNumber(rawEfficiency, 0, 1, null) : null;
    const capacityQuality = capacity !== null && capacity > 0 && loot !== null
      ? adaptiveCapacityExcessQuality(capacity, loot)
      : {
          excess: Math.max(0, finiteObservedNumber(e.capacityAnomalyAmount) || 0),
          adjusted: Boolean(e.capacityAdjusted),
          anomaly: Boolean(e.capacityAnomaly)
        };
    return {
      ...e,
      sourceVillageId: String(e.sourceVillageId || sourceVillageId || ''),
      reportId: e.reportId ? String(e.reportId) : null,
      attribution: adaptiveEventAttribution(e),
      rawEfficiency,
      observedReportEfficiency,
      efficiency: observedReportEfficiency,
      reportCapacity: finiteObservedNumber(e.reportCapacity ?? e.capacityShown),
      reconstructedCapacity: finiteObservedNumber(e.reconstructedCapacity),
      sentCapacity: finiteObservedNumber(e.sentCapacity),
      capacitySource: String(e.capacitySource || (capacity !== null ? 'LEGACY' : 'UNKNOWN')),
      capacityAnomalyAmount: capacityQuality.excess,
      capacityAdjusted: Boolean(capacityQuality.adjusted),
      capacityAnomaly: Boolean(capacityQuality.anomaly)
    };
  }

  function adaptiveDispatchId(sourceVillageId, coord, sentAt) {
    const observedSentAt = finiteObservedNumber(sentAt);
    const timestamp = observedSentAt !== null && observedSentAt > 0
      ? Math.trunc(observedSentAt)
      : 0;
    return `${String(sourceVillageId || 'unknown')}:${timestamp}:${String(coord || 'unknown')}`;
  }

  function normalizeAdaptiveDispatch(raw, sourceVillageId = '') {
    const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const sentAt = Math.max(0, Number(d.sentAt ?? d.at) || 0);
    const targetCoord = String(d.targetCoord || d.coord || '');
    const source = String(d.sourceVillageId || sourceVillageId || '');
    const reportIdMatched = d.reportIdMatched ? String(d.reportIdMatched) : null;
    let status = String(d.status || '');
    if (!['PENDING', 'MATCHED', 'LATE_MATCHED', 'EXPIRED', 'EXPIRED_MATCHABLE', 'LEGACY'].includes(status)) {
      status = reportIdMatched ? 'MATCHED' : (d.dispatchId ? 'PENDING' : 'LEGACY');
    }
    const explicitTrackable = d.trackable === false
      ? false
      : (d.trackable === true ? true : status !== 'LEGACY');
    const measurementClass = ['TRACKABLE', 'UNTRACKABLE_LEGACY'].includes(String(d.measurementClass))
      ? String(d.measurementClass)
      : (explicitTrackable ? 'TRACKABLE' : 'UNTRACKABLE_LEGACY');
    const trackable = measurementClass === 'TRACKABLE' && explicitTrackable;
    return {
      ...d,
      dispatchId: String(d.dispatchId || adaptiveDispatchId(source, targetCoord, sentAt)),
      sourceVillageId: source,
      targetCoord,
      coord: targetCoord,
      sentAt,
      at: sentAt,
      reportIdAtSend: d.reportIdAtSend ? String(d.reportIdAtSend) : null,
      reportIdMatched,
      matchedAt: Math.max(0, Number(d.matchedAt) || 0),
      expectedReportNotBeforeAt: Math.max(0, Number(d.expectedReportNotBeforeAt ?? d.attributionNotBeforeAt) || 0) || null,
      expectedReportCheckAt: Math.max(0, Number(d.expectedReportCheckAt) || 0) || null,
      loot: finiteObservedNumber(d.loot),
      observedCapacity: finiteObservedNumber(d.observedCapacity),
      // measurementClass/trackable são imutáveis para fins estatísticos. O
      // lifecycle pode mudar de PENDING para MATCHED/EXPIRED sem transformar um
      // registo legado não verificável numa amostra mensurável.
      measurementClass,
      trackable,
      status
    };
  }

  function normalizeAdaptiveReportLedgerEntry(raw, sourceVillageId = '') {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    const reportId = String(r.reportId || '');
    const source = String(r.sourceVillageId || sourceVillageId || '');
    const evidenceType = String(r.evidenceType || r.stockType || 'UNKNOWN');
    const rawReplayable =
      (evidenceType === 'EXACT' && hasObservedNumber(r.stock)) ||
      (evidenceType === 'LOWER_BOUND' && hasObservedNumber(r.stockLow)) ||
      (evidenceType === 'INTERVAL' && hasObservedNumber(r.stockHigh)) ||
      (hasObservedNumber(r.efficiency) && hasObservedNumber(r.capacity));
    const rawEvidenceVersion = Math.max(0, Math.trunc(Number(r.rawEvidenceVersion) || 0)) ||
      (Boolean(r.quantitative) && rawReplayable ? 1 : 0);
    const capacity = finiteObservedNumber(r.capacity);
    const loot = finiteObservedNumber(r.loot);
    const capacityQuality = capacity !== null && loot !== null
      ? adaptiveCapacityExcessQuality(capacity, loot)
      : {
          excess: Math.max(0, Number(r.capacityAnomalyAmount) || 0),
          adjusted: Boolean(r.capacityAdjusted),
          anomaly: Boolean(r.capacityAnomaly)
        };
    return {
      ...r,
      reportKey: String(r.reportKey || `${source}:${reportId}`),
      sourceVillageId: source,
      reportId,
      targetCoord: String(r.targetCoord || r.coord || ''),
      detailState: REPORT_DETAIL_STATES.includes(String(r.detailState)) ? String(r.detailState) : 'COMPLETE',
      observedAt: Math.max(0, Number(r.observedAt) || 0) || null,
      synchronizedAt: Math.max(0, Number(r.synchronizedAt) || 0),
      attribution: ADAPTIVE_ATTRIBUTIONS.includes(String(r.attribution))
        ? String(r.attribution)
        : adaptiveEventAttribution(r),
      quantitative: Boolean(r.quantitative),
      qualitative: Boolean(r.qualitative),
      modelUpdated: Boolean(r.modelUpdated),
      loot,
      reportCapacity: finiteObservedNumber(r.reportCapacity ?? r.capacityShown),
      reconstructedCapacity: finiteObservedNumber(r.reconstructedCapacity),
      sentCapacity: finiteObservedNumber(r.sentCapacity),
      capacity,
      capacitySource: String(r.capacitySource || (hasObservedNumber(r.reportCapacity ?? r.capacityShown) ? 'REPORT' : 'UNKNOWN')),
      remainingResources: finiteObservedNumber(r.remainingResources),
      evidenceType,
      stock: finiteObservedNumber(r.stock),
      stockLow: finiteObservedNumber(r.stockLow),
      stockHigh: finiteObservedNumber(r.stockHigh),
      stockProxy: rawEvidenceVersion >= 1 ? null : finiteObservedNumber(r.stockProxy),
      reliability: rawEvidenceVersion >= 1 ? null : finiteObservedNumber(r.reliability),
      rawEfficiency: finiteObservedNumber(r.rawEfficiency),
      observedReportEfficiency: finiteObservedNumber(r.observedReportEfficiency ?? r.efficiency),
      efficiency: finiteObservedNumber(r.observedReportEfficiency ?? r.efficiency),
      compositionSent: r.compositionSent && typeof r.compositionSent === 'object' ? r.compositionSent : null,
      compositionSurviving: r.compositionSurviving && typeof r.compositionSurviving === 'object' ? r.compositionSurviving : null,
      losses: r.losses && typeof r.losses === 'object' ? r.losses : null,
      hadLosses: Boolean(r.hadLosses),
      transportSentUnits: finiteObservedNumber(r.transportSentUnits),
      transportLostUnits: finiteObservedNumber(r.transportLostUnits),
      transportSurvivingUnits: finiteObservedNumber(r.transportSurvivingUnits),
      transportCasualtyRate: finiteObservedNumber(r.transportCasualtyRate),
      transportCapacitySent: finiteObservedNumber(r.transportCapacitySent),
      transportCapacityLost: finiteObservedNumber(r.transportCapacityLost),
      transportCapacitySurviving: finiteObservedNumber(r.transportCapacitySurviving),
      transportCapacityLossRate: finiteObservedNumber(r.transportCapacityLossRate),
      fullTransportWipe: Boolean(r.fullTransportWipe),
      lossSeverity: finiteObservedNumber(r.lossSeverity),
      lossSeveritySource: String(r.lossSeveritySource || (r.hadLosses ? 'QUALITATIVE' : 'NONE')),
      lossAnomaly: Boolean(r.lossAnomaly),
      surprise: rawEvidenceVersion >= 1 ? null : finiteObservedNumber(r.surprise),
      competitionSignal: rawEvidenceVersion >= 1 ? null : finiteObservedNumber(r.competitionSignal),
      jackpot: rawEvidenceVersion >= 1 ? false : Boolean(r.jackpot),
      capacityMismatch: Boolean(r.capacityMismatch),
      capacityMismatchAmount: finiteObservedNumber(r.capacityMismatchAmount),
      capacityAnomalyAmount: capacityQuality.excess,
      capacityAdjusted: Boolean(capacityQuality.adjusted),
      capacityAnomaly: Boolean(capacityQuality.anomaly),
      rawEvidenceVersion
    };

  }

  function normalizeAdaptiveIngestCounters(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const key of ADAPTIVE_INGEST_COUNTER_KEYS) {
      out[key] = Math.max(0, Math.trunc(Number(source[key]) || 0));
    }
    return out;
  }

  function normalizeAdaptiveIngestHealth(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      last: {
        at: Math.max(0, Number(source.last?.at) || 0),
        ...normalizeAdaptiveIngestCounters(source.last)
      },
      totals: normalizeAdaptiveIngestCounters(source.totals),
      lastDetailSuccessAt: Math.max(0, Number(source.lastDetailSuccessAt) || 0),
      lastQuantitativeAt: Math.max(0, Number(source.lastQuantitativeAt) || 0),
      lastSynchronizedAt: Math.max(0, Number(source.lastSynchronizedAt) || 0)
    };
  }

  function recordAdaptiveIngestRun(store, run) {
    const health = normalizeAdaptiveIngestHealth(store?.ingestHealth);
    const normalizedRun = normalizeAdaptiveIngestCounters(run);
    health.last = { at: Math.max(1, Number(run?.at) || Date.now()), ...normalizedRun };
    for (const key of ADAPTIVE_INGEST_COUNTER_KEYS) {
      health.totals[key] = Math.max(0, Number(health.totals[key]) || 0) + normalizedRun[key];
    }
    if (Number(run?.lastDetailSuccessAt) > 0) {
      health.lastDetailSuccessAt = Math.max(health.lastDetailSuccessAt, Number(run.lastDetailSuccessAt));
    }
    if (Number(run?.lastQuantitativeAt) > 0) {
      health.lastQuantitativeAt = Math.max(health.lastQuantitativeAt, Number(run.lastQuantitativeAt));
    }
    if (Number(run?.lastSynchronizedAt) > 0) {
      health.lastSynchronizedAt = Math.max(health.lastSynchronizedAt, Number(run.lastSynchronizedAt));
    }
    store.ingestHealth = health;
    return health;
  }

  function advanceBootstrapFairness(raw, event) {
    event = event && typeof event === 'object' ? event : {};
    const previous = normalizeBootstrapFairness(raw);
    const at = Math.max(1, Number(event.at) || Date.now());
    const eligibleCount = Math.max(0, Math.trunc(Number(event.eligibleCount) || 0));
    const bootstrapSent = Math.max(0, Math.trunc(Number(event.bootstrapSent) || 0));
    const opportunity = Boolean(event.opportunity && eligibleCount > 0);
    const next = { ...previous, eligibleCount };

    if (bootstrapSent > 0) {
      next.debt = 0;
      next.bootstrapSent += bootstrapSent;
      next.lastBootstrapSentAt = at;
      next.lastOutcome = 'BOOTSTRAP_SENT';
      return next;
    }

    if (eligibleCount <= 0) {
      next.debt = 0;
      next.lastOutcome = 'NO_BOOTSTRAP';
      return next;
    }

    if (opportunity) {
      next.debt = Math.min(100, previous.debt + 1);
      next.opportunities += 1;
      next.lastOpportunityAt = at;
      next.lastOutcome = next.debt >= ADAPTIVE_BOOTSTRAP_DEBT_THRESHOLD
        ? 'MUST_PROBE_DUE'
        : 'DEBT_INCREASED';
    } else {
      next.lastOutcome = 'WAITING_CAPACITY';
    }
    return next;
  }

  function persistBootstrapFairness(villageId, event) {
    const store = adaptiveStore(villageId);
    const previous = normalizeBootstrapFairness(store.bootstrapFairness);
    const next = advanceBootstrapFairness(previous, event);
    store.bootstrapFairness = next;
    requireStored(saveAdaptiveStore(store, villageId), 'fairness persistente das novas');
    return { previous, next };
  }

  function adaptiveStore(villageId = currentVillageId()) {
    const raw = loadJSON('adaptiveV2', {}, villageId);
    const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      schema: ADAPTIVE_SCHEMA_VERSION,
      farms: base.farms && typeof base.farms === 'object' && !Array.isArray(base.farms) ? base.farms : {},
      events: Array.isArray(base.events)
        ? base.events.slice(-ADAPTIVE_EVENT_LIMIT).map(event => normalizeAdaptiveEvent(event, villageId))
        : [],
      dispatches: Array.isArray(base.dispatches)
        ? base.dispatches.slice(-ADAPTIVE_DISPATCH_LIMIT).map(dispatch => normalizeAdaptiveDispatch(dispatch, villageId))
        : [],
      reportLedger: Array.isArray(base.reportLedger)
        ? base.reportLedger.slice(-ADAPTIVE_REPORT_LEDGER_LIMIT).map(report => normalizeAdaptiveReportLedgerEntry(report, villageId))
        : [],
      reportIndex: normalizeAdaptiveReportIndex(base.reportIndex),
      sectors: base.sectors && typeof base.sectors === 'object' && !Array.isArray(base.sectors) ? base.sectors : {},
      bootstrapFairness: normalizeBootstrapFairness(base.bootstrapFairness),
      allocationBudget: normalizeAdaptiveAllocationBudget(base.allocationBudget),
      ingestHealth: normalizeAdaptiveIngestHealth(base.ingestHealth),
      createdAt: Math.max(0, Number(base.createdAt) || 0),
      updatedAt: Math.max(0, Number(base.updatedAt) || 0),
      revision: Math.max(0, Math.trunc(Number(base.revision) || 0)),
      lastMaintenanceDay: String(base.lastMaintenanceDay || ''),
      lastMaintenanceAt: Math.max(0, Number(base.lastMaintenanceAt) || 0)
    };
  }

  function saveAdaptiveStore(store, villageId = currentVillageId()) {
    const now = Date.now();
    pruneAdaptiveHistory(store, cfg(villageId), now);
    const clean = {
      schema: ADAPTIVE_SCHEMA_VERSION,
      farms: store?.farms || {},
      events: Array.isArray(store?.events)
        ? store.events.slice(-ADAPTIVE_EVENT_LIMIT).map(event => normalizeAdaptiveEvent(event, villageId))
        : [],
      dispatches: Array.isArray(store?.dispatches)
        ? store.dispatches.slice(-ADAPTIVE_DISPATCH_LIMIT).map(dispatch => normalizeAdaptiveDispatch(dispatch, villageId))
        : [],
      reportLedger: Array.isArray(store?.reportLedger)
        ? store.reportLedger.slice(-ADAPTIVE_REPORT_LEDGER_LIMIT).map(report => normalizeAdaptiveReportLedgerEntry(report, villageId))
        : [],
      reportIndex: normalizeAdaptiveReportIndex(store?.reportIndex),
      reportCompleteness: reportCompletenessSummary(store?.reportIndex, store?.reportLedger),
      sectors: store?.sectors || {},
      bootstrapFairness: normalizeBootstrapFairness(store?.bootstrapFairness),
      allocationBudget: normalizeAdaptiveAllocationBudget(store?.allocationBudget),
      ingestHealth: normalizeAdaptiveIngestHealth(store?.ingestHealth),
      createdAt: Math.max(1, Number(store?.createdAt) || now),
      updatedAt: now,
      revision: Math.max(0, Math.trunc(Number(store?.revision) || 0)) + 1,
      lastMaintenanceDay: String(store?.lastMaintenanceDay || ''),
      lastMaintenanceAt: Math.max(0, Number(store?.lastMaintenanceAt) || 0)
    };
    const saved = saveJSON('adaptiveV2', clean, villageId);
    if (saved) {
      if (store && typeof store === 'object') Object.assign(store, clean);
      RUNTIME.adaptiveSnapshotByVillage.delete(String(villageId || ''));
    }
    return saved;
  }

  function currentDayKey(at = Date.now()) {
    const d = new Date(Number(at) || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function coordDistance(coord, sourceCoord = currentVillageCoord()) {
    const a = String(coord || '').match(/^(\d{3})\|(\d{3})$/);
    const b = String(sourceCoord || '').match(/^(\d{3})\|(\d{3})$/);
    if (!a || !b) return null;
    return Math.hypot(Number(a[1]) - Number(b[1]), Number(a[2]) - Number(b[2]));
  }

  function sectorForCoord(coord, sourceCoord = currentVillageCoord()) {
    const a = String(coord || '').match(/^(\d{3})\|(\d{3})$/);
    const b = String(sourceCoord || '').match(/^(\d{3})\|(\d{3})$/);
    if (!a || !b) return 'UNKNOWN';
    const dx = Number(a[1]) - Number(b[1]);
    const dy = Number(a[2]) - Number(b[2]);
    if (dx === 0 && dy === 0) return 'CENTER';
    const angle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
    if (angle >= 337.5 || angle < 22.5) return 'E';
    if (angle < 67.5) return 'NE';
    if (angle < 112.5) return 'N';
    if (angle < 157.5) return 'NW';
    if (angle < 202.5) return 'W';
    if (angle < 247.5) return 'SW';
    if (angle < 292.5) return 'S';
    return 'SE';
  }

  function defaultAdaptiveFarm(coord, distance = null) {
    const depth = {};
    // Jeffreys fraco e neutro: beliefGood mantém o prior de qualidade 75%, mas
    // não fingimos que P(stock>=40) e P(stock>=3000) são ambas 75%.
    for (const c of ADAPTIVE_CAPACITY_GRID) depth[String(c)] = { a: 0.5, b: 0.5 };
    return {
      coord: String(coord),
      active: true,
      mapPresenceState: 'ACTIVE',
      mapMissingSnapshots: 0,
      mapLastSeenAt: 0,
      distance: Number.isFinite(distance) ? Number(distance) : null,
      sector: sectorForCoord(coord),

      alpha: 3,
      beta: 1,
      badStreak: 0,
      beliefGood: 0.75,
      certainty: 0.03,

      observations: 0,
      effectiveSamples: 0,
      lastModelUpdateAt: 0,
      lastObservationAt: 0,
      previousObservationAt: 0,
      lastKnownStock: null,
      lastKnownRemaining: null,
      lastLossAt: 0,
      lastSeenReportId: null,
      processedReportIds: [],

      stockMean: null,
      stockVariance: 0,
      stockWeight: 0,
      fastStock: null,
      slowStock: null,
      fastFill: null,
      slowFill: null,
      trend: 0,

      depth,
      hourProfile: Array.from({ length: 24 }, () => ({ w: 0, stock: 0, fill: 0 })),
      restProfile: ADAPTIVE_REST_BUCKET_HOURS.map(maxH => ({ maxH, w: 0, stock: 0, fill: 0 })),

      positiveCusum: 0,
      negativeCusum: 0,
      regime: 'UNKNOWN',
      certaintyShock: 0,
      recheckByAt: 0,
      competitionScore: 0,
      volatilityScore: 0.5,
      lossRisk: 0,
      jackpotMemory: 0,

      coverageDebt: 1,
      visitedDay: '',
      nextDueAt: 0,
      lastOneWayTravelMs: 0,
      farmRating: 75,
      expectedStock: null,
      expectedFill: 0.75,

      pendingDispatch: null,
      reportRetry: null,
      recent: []
    };
  }

  function normalizeAdaptiveFarm(raw, coord, distance = null) {
    const d = defaultAdaptiveFarm(coord, distance);
    const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...d, ...raw } : d;
    f.coord = String(coord);
    f.active = raw?.active !== false;
    f.mapPresenceState = ['ACTIVE', 'SUSPECT_MISSING', 'CONFIRMED_INACTIVE'].includes(String(raw?.mapPresenceState))
      ? String(raw.mapPresenceState)
      : (f.active ? 'ACTIVE' : 'CONFIRMED_INACTIVE');
    f.mapMissingSnapshots = Math.max(0, Math.trunc(Number(raw?.mapMissingSnapshots) || 0));
    f.mapLastSeenAt = Math.max(0, Number(raw?.mapLastSeenAt) || 0);
    const rawDistance = finiteObservedNumber(raw?.distance);
    f.distance = rawDistance !== null ? rawDistance : (Number.isFinite(distance) ? distance : d.distance);
    f.sector = String(raw?.sector || sectorForCoord(coord));
    f.alpha = Math.max(0.01, Number(raw?.alpha) || d.alpha);
    f.beta = Math.max(0.01, Number(raw?.beta) || d.beta);
    f.badStreak = Math.max(0, Math.trunc(Number(raw?.badStreak) || 0));
    f.observations = Math.max(0, Math.trunc(Number(raw?.observations) || 0));
    f.effectiveSamples = Math.max(0, Number(raw?.effectiveSamples) || 0);
    const rawStockMean = finiteObservedNumber(raw?.stockMean);
    f.stockMean = rawStockMean !== null ? Math.max(0, rawStockMean) : d.stockMean;
    const rawStockVariance = finiteObservedNumber(raw?.stockVariance);
    f.stockVariance = Math.max(0, rawStockVariance !== null ? rawStockVariance : d.stockVariance);
    f.stockWeight = Math.max(0, Number(raw?.stockWeight) || 0);
    const rawFastStock = finiteObservedNumber(raw?.fastStock);
    const rawSlowStock = finiteObservedNumber(raw?.slowStock);
    f.fastStock = rawFastStock !== null ? Math.max(0, rawFastStock) : f.stockMean;
    f.slowStock = rawSlowStock !== null ? Math.max(0, rawSlowStock) : f.stockMean;
    const rawFastFill = finiteObservedNumber(raw?.fastFill);
    const rawSlowFill = finiteObservedNumber(raw?.slowFill);
    f.fastFill = rawFastFill !== null ? clampNumber(rawFastFill, 0, 1, 0) : null;
    f.slowFill = rawSlowFill !== null ? clampNumber(rawSlowFill, 0, 1, 0) : null;
    f.trend = Number(raw?.trend) || 0;
    f.positiveCusum = Math.max(0, Number(raw?.positiveCusum) || 0);
    f.negativeCusum = Math.min(0, Number(raw?.negativeCusum) || 0);
    f.certaintyShock = clampNumber(raw?.certaintyShock, 0, 0.85, 0);
    f.recheckByAt = Math.max(0, Number(raw?.recheckByAt) || 0);
    f.competitionScore = clampNumber(raw?.competitionScore, 0, 1, 0);
    f.volatilityScore = clampNumber(raw?.volatilityScore, 0, 2, 0.5);
    f.lossRisk = clampNumber(raw?.lossRisk, 0, 1, 0);
    f.jackpotMemory = clampNumber(raw?.jackpotMemory, 0, 3, 0);
    f.certainty = clampNumber(raw?.certainty, 0, 1, 0.03);
    f.beliefGood = clampNumber(raw?.beliefGood, 0, 1, f.alpha / (f.alpha + f.beta));
    f.farmRating = clampNumber(raw?.farmRating, 0, 100, 75);
    const rawExpectedStock = finiteObservedNumber(raw?.expectedStock);
    f.expectedStock = rawExpectedStock !== null
      ? Math.max(0, rawExpectedStock)
      : (f.stockWeight > 0 ? f.stockMean : null);
    f.expectedFill = clampNumber(raw?.expectedFill, 0, 1, 0.75);
    f.coverageDebt = Math.max(0, Number(raw?.coverageDebt) || 0);
    f.lastObservationAt = Math.max(0, Number(raw?.lastObservationAt) || 0);
    f.previousObservationAt = Math.max(0, Number(raw?.previousObservationAt) || 0);
    f.lastModelUpdateAt = Math.max(0, Number(raw?.lastModelUpdateAt) || 0);
    f.nextDueAt = Math.max(0, Number(raw?.nextDueAt) || 0);
    f.lastOneWayTravelMs = Math.max(0, Number(raw?.lastOneWayTravelMs) || 0);
    f.lastSeenReportId = raw?.lastSeenReportId ? String(raw.lastSeenReportId) : null;
    f.processedReportIds = [...new Set((Array.isArray(raw?.processedReportIds) ? raw.processedReportIds : [])
      .map(value => String(value || ''))
      .filter(Boolean))].slice(-32);
    f.lastKnownStock = finiteObservedNumber(raw?.lastKnownStock);
    f.lastKnownRemaining = finiteObservedNumber(raw?.lastKnownRemaining);
    f.lastLossAt = Math.max(0, Number(raw?.lastLossAt) || 0);
    f.pendingDispatch = raw?.pendingDispatch && typeof raw.pendingDispatch === 'object' ? raw.pendingDispatch : null;
    f.reportRetry = raw?.reportRetry && typeof raw.reportRetry === 'object' ? raw.reportRetry : null;
    f.recent = Array.isArray(raw?.recent) ? raw.recent.slice(-ADAPTIVE_RECENT_PER_FARM_LIMIT) : [];

    const depth = {};
    const rawDepthCaps = Object.keys(raw?.depth || {})
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0 && value <= 100000);
    for (const cap of [...new Set([...ADAPTIVE_CAPACITY_GRID, ...rawDepthCaps])].sort((a, b) => a - b)) {
      const x = raw?.depth?.[String(cap)] || {};
      depth[String(cap)] = {
        a: Math.max(0.01, Number(x.a) || 0.5),
        b: Math.max(0.01, Number(x.b) || 0.5)
      };
    }
    f.depth = depth;

    const hp = Array.isArray(raw?.hourProfile) ? raw.hourProfile : [];
    f.hourProfile = Array.from({ length: 24 }, (_, i) => ({
      w: Math.max(0, Number(hp[i]?.w) || 0),
      stock: Math.max(0, Number(hp[i]?.stock) || 0),
      fill: clampNumber(hp[i]?.fill, 0, 1, 0)
    }));

    const rp = Array.isArray(raw?.restProfile) ? raw.restProfile : [];
    f.restProfile = ADAPTIVE_REST_BUCKET_HOURS.map((maxH, i) => ({
      maxH,
      w: Math.max(0, Number(rp[i]?.w) || 0),
      stock: Math.max(0, Number(rp[i]?.stock) || 0),
      fill: clampNumber(rp[i]?.fill, 0, 1, 0)
    }));

    return f;
  }

  function adaptiveHistoryDays(c = DEFAULTS) {
    return Math.trunc(clampNumber(c?.adaptiveHistoryDays, 3, 7, DEFAULTS.adaptiveHistoryDays));
  }

  function adaptiveHistoryCutoff(c = DEFAULTS, now = Date.now()) {
    return Number(now) - adaptiveHistoryDays(c) * 24 * 3600000;
  }

  function adaptiveEvidenceRecordedAt(entry) {
    const observedAt = finiteObservedNumber(entry?.at);
    if (observedAt !== null && observedAt > 0) return observedAt;
    const recordedAt = finiteObservedNumber(entry?.recordedAt);
    return recordedAt !== null && recordedAt > 0 ? recordedAt : null;
  }

  function adaptiveRecentWithinWindow(farm, c = DEFAULTS, now = Date.now()) {
    const cutoff = adaptiveHistoryCutoff(c, now);
    const futureTolerance = Number(now) + 5 * 60000;
    return (Array.isArray(farm?.recent) ? farm.recent : [])
      .filter(entry => {
        const recordedAt = adaptiveEvidenceRecordedAt(entry);
        return recordedAt !== null && recordedAt >= cutoff && recordedAt <= futureTolerance;
      })
      .sort((a, b) => Number(adaptiveEvidenceRecordedAt(a)) - Number(adaptiveEvidenceRecordedAt(b)));
  }

  function adaptiveCapacityGridForFarm(farm, entries = null) {
    const evidence = Array.isArray(entries) ? entries : (Array.isArray(farm?.recent) ? farm.recent : []);
    const observed = [];
    for (const entry of evidence) {
      const values = [entry?.reportCapacity, entry?.capacity, entry?.reconstructedCapacity];
      for (const raw of values) {
        const value = finiteObservedNumber(raw);
        if (value !== null && value > 0 && value <= 100000) observed.push(Math.round(value));
      }
    }
    const existing = Object.keys(farm?.depth || {})
      .map(Number)
      .filter(value => Number.isFinite(value) && value > 0 && value <= 100000);
    const merged = [...new Set([...ADAPTIVE_CAPACITY_GRID, ...existing, ...observed])].sort((a, b) => a - b);
    // Mantém a curva limitada, preservando sempre capacidades realmente observadas
    // mais recentes e os pontos base necessários ao cold-start.
    if (merged.length <= 48) return merged;
    const required = new Set([...ADAPTIVE_CAPACITY_GRID, ...observed.slice(-24)]);
    return merged.filter(value => required.has(value)).sort((a, b) => a - b).slice(-48);
  }

  function latestAdaptiveCompetitionBaseline(farm, c = DEFAULTS, now = Date.now(), currentObservedAt = null) {
    const ceiling = finiteObservedNumber(currentObservedAt);
    let latest = null;
    for (const entry of adaptiveRecentWithinWindow(farm, c, now)) {
      const at = finiteObservedNumber(entry?.at);
      if (at === null || !(at > 0)) continue;

      if (ceiling !== null && at > ceiling) continue;
      if (String(entry?.stockType || '') !== 'EXACT') continue;

      let remaining = finiteObservedNumber(entry?.remainingResources);
      if (remaining === null) {
        const stock = finiteObservedNumber(entry?.stock);
        const loot = finiteObservedNumber(entry?.loot);
        if (stock !== null && loot !== null) remaining = Math.max(0, stock - loot);
      }
      if (remaining === null) continue;
      if (!latest || at > latest.at) {
        latest = { at, remainingResources: remaining, reportId: String(entry?.reportId || '') };
      }
    }
    return latest;
  }

  function adaptiveRecentReliability(entry) {
    const stored = finiteObservedNumber(entry?.reliability);
    if (stored !== null) return clampNumber(stored, 0, 1, 0);
    const type = String(entry?.stockType || 'UNKNOWN');
    if (type === 'EXACT') return 1;
    if (type === 'LOWER_BOUND') return 0.62;
    if (type === 'INTERVAL') return 0.25;
    if (hasObservedNumber(entry?.efficiency) && hasObservedNumber(entry?.capacity)) return 0.30;
    return 0;
  }

  function adaptiveReplayReliability(entry) {
    if (!(Number(entry?.rawEvidenceVersion || 0) >= 1)) {
      return adaptiveRecentReliability(entry);
    }
    const type = String(entry?.stockType || 'UNKNOWN');
    if (type === 'EXACT' && hasObservedNumber(entry?.stock)) return 1;
    if (type === 'LOWER_BOUND' && hasObservedNumber(entry?.stockLow)) return 0.62;
    if (type === 'INTERVAL' && hasObservedNumber(entry?.stockHigh)) return 0.25;
    if (hasObservedNumber(entry?.efficiency) && hasObservedNumber(entry?.capacity)) return 0.30;
    return 0;
  }

  function adaptiveReplayStockProxy(entry, priorMean) {
    const rawReplay = Number(entry?.rawEvidenceVersion || 0) >= 1;
    const stored = finiteObservedNumber(entry?.stockProxy);
    if (!rawReplay && stored !== null) return stored;
    const type = String(entry?.stockType || 'UNKNOWN');
    if (type === 'EXACT' && hasObservedNumber(entry?.stock)) return Number(entry.stock);
    // LOWER_BOUND/INTERVAL continuam censurados. Ensinam a curva de profundidade,
    // mas não são transformados num ponto físico por um prior ou setting atual.
    return null;
  }

  function updateWindowBelief(state, fill, weight) {
    if (!hasObservedNumber(fill) || !(weight > 0)) return;
    const value = clampNumber(fill, 0, 1, 0);
    if (value >= 0.90) {
      state.alpha += weight;
      state.badStreak = 0;
    } else if (value >= 0.65) {
      state.alpha += 0.65 * weight;
      state.beta += 0.35 * weight;
      state.badStreak = 0;
    } else if (value >= 0.30) {
      state.alpha += 0.25 * weight;
      state.beta += 0.75 * weight;
      state.badStreak += 1;
    } else {
      state.beta += (1 + 0.40 * state.badStreak) * weight;
      state.badStreak += 1;
    }
  }

  function adaptiveWindowEvidence(farm, c = DEFAULTS, now = Date.now()) {
    const entries = adaptiveRecentWithinWindow(farm, c, now);
    const capacityGrid = adaptiveCapacityGridForFarm(farm, entries);
    const halfLifeMs = Math.max(12, Number(c?.adaptiveHalfLifeHours) || DEFAULTS.adaptiveHalfLifeHours) * 3600000;
    const state = {
      entries,
      alpha: 3,
      beta: 1,
      badStreak: 0,
      effectiveSamples: 0,
      lastTimedEvidenceAt: 0,
      stockMean: null,
      stockVariance: 0,
      stockWeight: 0,
      fastStock: null,
      slowStock: null,
      fastFill: null,
      slowFill: null,
      depth: Object.fromEntries(capacityGrid.map(cap => [String(cap), { a: 0.5, b: 0.5 }])),
      hourProfile: Array.from({ length: 24 }, () => ({ w: 0, stock: 0, fill: 0 })),
      restProfile: ADAPTIVE_REST_BUCKET_HOURS.map(maxH => ({ maxH, w: 0, stock: 0, fill: 0 })),
      positiveCusum: 0,
      negativeCusum: 0,
      regime: 'UNKNOWN',
      certaintyShock: 0,
      recheckByAt: 0,
      competitionScore: 0,
      volatilityScore: 0.5,
      lossRisk: 0,
      jackpotMemory: 0,
      observations: 0,
      lastObservationAt: 0,
      previousObservationAt: 0,
      lastKnownStock: null,
      lastKnownRemaining: null,
      lastLossAt: 0
    };

    let weightedStock = 0;
    let weightedStockSq = 0;
    let previousTimedAt = 0;
    let previousExact = null;

    for (const entry of entries) {
      const recordedAt = adaptiveEvidenceRecordedAt(entry);
      if (recordedAt === null) continue;
      const ageMs = Math.max(0, Number(now) - recordedAt);
      const decay = Math.pow(0.5, ageMs / halfLifeMs);
      const reliability = adaptiveReplayReliability(entry);
      const weight = reliability * decay;
      if (!(weight > 0)) continue;

      state.effectiveSamples += weight;
      state.observations += 1;
      updateWindowBelief(state, entry?.efficiency, weight);

      const stockType = String(entry?.stockType || 'UNKNOWN');
      const stockLow = finiteObservedNumber(entry?.stockLow);
      const stockHigh = finiteObservedNumber(entry?.stockHigh);
      for (const cap of capacityGrid) {
        let success = null;
        if (stockType === 'EXACT' && hasObservedNumber(entry?.stock)) success = Number(entry.stock) >= cap;
        else if (stockType === 'LOWER_BOUND' && stockLow !== null && stockLow >= cap) success = true;
        else if (stockType === 'INTERVAL') {
          if (stockLow !== null && stockLow >= cap) success = true;
          else if (stockHigh !== null && stockHigh < cap) success = false;
        }
        if (success === true) state.depth[String(cap)].a += weight;
        else if (success === false) state.depth[String(cap)].b += weight;
      }

      const meanBefore = state.stockWeight > 0 ? weightedStock / state.stockWeight : null;
      const proxy = adaptiveReplayStockProxy(entry, meanBefore);

      const fill = hasObservedNumber(entry?.efficiency)
        ? clampNumber(entry.efficiency, 0, 1, 0.5)
        : null;

      if (proxy !== null) {
        const varianceBefore = state.stockWeight > 0
          ? Math.max(0, weightedStockSq / state.stockWeight - meanBefore * meanBefore)
          : 0;
        const predictedStock = finiteObservedNumber(entry?.predictedStock);
        const expectedBefore = predictedStock !== null ? predictedStock : meanBefore;
        const hasPriorPoint = expectedBefore !== null;
        const sigmaBefore = Math.max(30, Math.sqrt(varianceBefore), Math.max(20, expectedBefore) * 0.35);
        if (
          hasPriorPoint &&
          finiteObservedNumber(entry?.at) !== null &&
          (Number(entry?.rawEvidenceVersion || 0) >= 1 || finiteObservedNumber(entry?.surprise) === null)
        ) {
          entry.surprise = (proxy - expectedBefore) / sigmaBefore;
        }

        let competitionSignal = 0;
        const observedAtForCompetition = finiteObservedNumber(entry?.at);
        if (
          previousExact &&
          observedAtForCompetition !== null &&
          observedAtForCompetition - previousExact.at >= 30 * 60000 &&
          stockType === 'EXACT' && hasObservedNumber(entry?.stock)
        ) {
          const expectedFloor = Math.max(previousExact.remainingResources, expectedBefore ?? 0) * 0.75;
          competitionSignal = Number(entry.stock) < expectedFloor ? 1 : -1;
        }
        entry.competitionSignal = competitionSignal;

        if (Number(entry?.rawEvidenceVersion || 0) >= 1) {
          entry.jackpot = Boolean(
            hasObservedNumber(entry?.capacity) &&
            hasObservedNumber(entry?.loot) &&
            hasObservedNumber(entry?.remainingResources) &&
            Number(entry.loot) >= Number(entry.capacity) &&
            Number(entry.remainingResources) >= Number(entry.capacity)
          );
        }

        weightedStock += proxy * weight;
        weightedStockSq += proxy * proxy * weight;
        state.stockWeight += weight;
      }

      const observedAt = finiteObservedNumber(entry?.at);
      if (
        observedAt !== null && observedAt > 0 && observedAt <= Number(now) + 5 * 60000 &&
        (proxy !== null || fill !== null)
      ) {
        state.previousObservationAt = state.lastObservationAt;
        state.lastObservationAt = observedAt;
        const fastAlpha = clampNumber(0.42 * weight, 0, 1, 0);
        const slowAlpha = clampNumber(0.10 * weight, 0, 1, 0);
        if (proxy !== null) {
          // A primeira medição física inicializa FAST/SLOW; smoothing começa na segunda.
          state.fastStock = state.fastStock === null
            ? proxy
            : (1 - fastAlpha) * state.fastStock + fastAlpha * proxy;
          state.slowStock = state.slowStock === null
            ? proxy
            : (1 - slowAlpha) * state.slowStock + slowAlpha * proxy;
        }
        if (fill !== null) {
          state.fastFill = state.fastFill === null
            ? fill
            : (1 - fastAlpha) * state.fastFill + fastAlpha * fill;
          state.slowFill = state.slowFill === null
            ? fill
            : (1 - slowAlpha) * state.slowFill + slowAlpha * fill;
        }
        state.lastTimedEvidenceAt = Math.max(state.lastTimedEvidenceAt, observedAt);
        const hour = new Date(observedAt).getHours();
        for (let h = 0; h < 24; h++) {
          const dist = circularHourDistance(hour, h);
          const kernelWeight = weight * Math.exp(-(dist * dist) / (2 * 2.0 * 2.0));
          if (!(kernelWeight > 0.005)) continue;
          const cell = state.hourProfile[h];
          const nextWeight = cell.w + kernelWeight;
          if (proxy !== null) {
            cell.stock = (cell.stock * cell.w + proxy * kernelWeight) / Math.max(Number.EPSILON, nextWeight);
          }
          if (fill !== null) {
            cell.fill = (cell.fill * cell.w + fill * kernelWeight) / Math.max(Number.EPSILON, nextWeight);
          }
          cell.w = nextWeight;
        }
        if (previousTimedAt > 0 && observedAt >= previousTimedAt) {
          const restHours = (observedAt - previousTimedAt) / 3600000;
          const bucket = state.restProfile[adaptiveRestBucketIndex(restHours)];
          const nextWeight = bucket.w + weight;
          if (proxy !== null) {
            bucket.stock = (bucket.stock * bucket.w + proxy * weight) / Math.max(Number.EPSILON, nextWeight);
          }
          if (fill !== null) {
            bucket.fill = (bucket.fill * bucket.w + fill * weight) / Math.max(Number.EPSILON, nextWeight);
          }
          bucket.w = nextWeight;
        }
        previousTimedAt = observedAt;
      }

      if (stockType === 'EXACT' && observedAt !== null && hasObservedNumber(entry?.stock)) {
        const remaining = finiteObservedNumber(entry?.remainingResources);
        state.lastKnownStock = Number(entry.stock);
        state.lastKnownRemaining = remaining !== null
          ? remaining
          : Math.max(0, Number(entry.stock) - Math.max(0, Number(entry?.loot) || 0));
        previousExact = {
          at: observedAt,
          remainingResources: state.lastKnownRemaining
        };
      }

      const surprise = finiteObservedNumber(entry?.surprise);
      if (surprise !== null && observedAt !== null) {
        const weightedSurprise = surprise * decay;
        state.positiveCusum = Math.max(0, state.positiveCusum + weightedSurprise - 0.20);
        state.negativeCusum = Math.min(0, state.negativeCusum + weightedSurprise + 0.20);
        state.volatilityScore = clampNumber(
          0.80 * state.volatilityScore + 0.20 * Math.min(2, Math.abs(weightedSurprise)),
          0,
          2,
          0.5
        );
        if (Math.abs(surprise) > 2.4) {
          state.regime = 'POSSIBLE_CHANGE';
          const shockAgeMs = Math.max(0, ageMs - 60 * 60000);
          state.certaintyShock = Math.max(state.certaintyShock, 0.30 * Math.pow(0.5, shockAgeMs / (6 * 3600000)));
          state.recheckByAt = Math.max(state.recheckByAt, observedAt + 60 * 60000);
        } else {
          state.certaintyShock *= 0.55;
          state.recheckByAt = 0;
          if (state.positiveCusum > 2.2) state.regime = 'IMPROVING';
          else if (state.negativeCusum < -2.2) state.regime = 'DETERIORATING';
          else if (state.effectiveSamples >= 2.5 && state.positiveCusum < 1.1 && state.negativeCusum > -1.1) state.regime = 'STABLE';
        }
      }

      state.lossRisk = clampNumber(
        0.88 * state.lossRisk + 0.12 * observationLossSeverity(entry) * decay,
        0,
        1,
        0
      );
      if (entry?.hadLosses) {
        state.lastLossAt = Math.max(state.lastLossAt, observedAt || recordedAt);
      }
      const competitionSignal = Number(entry?.competitionSignal) || 0;
      if (competitionSignal > 0) state.competitionScore = clampNumber(state.competitionScore + 0.18 * decay, 0, 1, 0);
      else if (competitionSignal < 0) state.competitionScore *= 0.90;
      else state.competitionScore *= 0.98;
      if (entry?.jackpot) {
        state.jackpotMemory = clampNumber(
          state.jackpotMemory + 1.2 * Math.pow(0.5, ageMs / (18 * 3600000)),
          0,
          3,
          0
        );
      }
    }

    if (state.stockWeight > 0) {
      state.stockMean = weightedStock / state.stockWeight;
      state.stockVariance = Math.max(0, weightedStockSq / state.stockWeight - state.stockMean * state.stockMean);
    }
    return state;
  }

  function pruneAdaptiveHistory(store, c = DEFAULTS, now = Date.now()) {
    if (!store || typeof store !== 'object') return store;
    const cutoff = adaptiveHistoryCutoff(c, now);
    const inWindow = entry => {
      const at = adaptiveEvidenceRecordedAt(entry);
      return at !== null && at >= cutoff && at <= Number(now) + 5 * 60000;
    };
    store.events = (Array.isArray(store.events) ? store.events : [])
      .filter(inWindow)
      .slice(-ADAPTIVE_EVENT_LIMIT);
    store.dispatches = (Array.isArray(store.dispatches) ? store.dispatches : [])
      .filter(dispatch => {
        const explicitSentAt = finiteObservedNumber(dispatch?.sentAt);
        const sentAt = explicitSentAt !== null ? explicitSentAt : finiteObservedNumber(dispatch?.at);
        return (sentAt !== null && sentAt >= cutoff) || Number(dispatch?.expectedReturnAt || 0) > Number(now);
      })
      .slice(-ADAPTIVE_DISPATCH_LIMIT);
    store.reportLedger = (Array.isArray(store.reportLedger) ? store.reportLedger : [])
      .filter(report => {
        const observedAt = finiteObservedNumber(report?.observedAt);
        const synchronizedAt = finiteObservedNumber(report?.synchronizedAt);
        const at = observedAt !== null && observedAt > 0 ? observedAt : synchronizedAt;
        return at !== null && at >= cutoff && at <= Number(now) + 5 * 60000;
      })
      .slice(-ADAPTIVE_REPORT_LEDGER_LIMIT);
    for (const [coord, raw] of Object.entries(store.farms || {})) {
      const farm = normalizeAdaptiveFarm(raw, coord, raw?.distance);
      farm.recent = adaptiveRecentWithinWindow(farm, c, now).slice(-ADAPTIVE_RECENT_PER_FARM_LIMIT);
      store.farms[coord] = farm;
    }
    return store;
  }

  function ensureAdaptiveFarm(store, coord, distance = null) {
    const key = String(coord);
    const f = normalizeAdaptiveFarm(store.farms[key], key, distance);
    store.farms[key] = f;
    return f;
  }

  function syncAdaptiveFarmsWithMap(store, map, villageId, c) {
    const active = new Set();
    const source = currentVillageCoord();

    for (const coord of map.keys()) {
      active.add(String(coord));
      const distance = coordDistance(coord, source);
      const f = ensureAdaptiveFarm(store, coord, distance);
      if (f.mapPresenceState === 'CONFIRMED_INACTIVE') {
        // A coordenada reapareceu como bárbara depois de ter deixado de existir.
        // Mantém arquivo histórico, mas inicia um novo regime com confiança fortemente reduzida.
        f.regime = 'POSSIBLE_CHANGE';
        f.certainty *= 0.35;
        f.alpha = 3 + Math.max(0, f.alpha - 3) * 0.25;
        f.beta = 1 + Math.max(0, f.beta - 1) * 0.25;
        f.effectiveSamples *= 0.25;
        f.nextDueAt = Date.now();
      }
      f.active = true;
      f.mapPresenceState = 'ACTIVE';
      f.mapMissingSnapshots = 0;
      f.mapLastSeenAt = Date.now();
      f.distance = Number.isFinite(distance) ? distance : f.distance;
      f.sector = sectorForCoord(coord, source);
      if (!f.lastObservationAt && !f.nextDueAt) f.nextDueAt = Date.now();
    }

    for (const [coord, raw] of Object.entries(store.farms)) {
      if (active.has(coord)) continue;
      const f = normalizeAdaptiveFarm(raw, coord, raw?.distance);
      f.mapMissingSnapshots = Math.max(0, Number(f.mapMissingSnapshots) || 0) + 1;
      f.mapPresenceState = f.mapMissingSnapshots >= 2 ? 'CONFIRMED_INACTIVE' : 'SUSPECT_MISSING';
      f.active = false;
      store.farms[coord] = f;
    }

    adaptiveDailyMaintenance(store, villageId, c);
  }

  function adaptiveDailyMaintenance(store, villageId, c) {
    const day = currentDayKey();
    if (store.lastMaintenanceDay === day) return;


    const now = Date.now();
    const halfLifeMs = Math.max(12, Number(c.adaptiveHalfLifeHours) || 60) * 3600000;
    const previousMaintenanceAt = Math.max(0, Number(store.lastMaintenanceAt) || 0);
    // O estado é compacto, logo não temos de voltar a percorrer todo o histórico bruto.
    // Aproximamos o decay exponencial decaindo a evidência acumulada em cada manutenção.
    const elapsedMs = previousMaintenanceAt > 0
      ? Math.max(0, now - previousMaintenanceAt)
      : 24 * 3600000;
    const decay = Math.pow(0.5, elapsedMs / halfLifeMs);
    const jackpotDecay = Math.pow(0.5, elapsedMs / (18 * 3600000));

    store.lastMaintenanceDay = day;
    store.lastMaintenanceAt = now;

    for (const [coord, raw] of Object.entries(store.farms)) {
      const f = normalizeAdaptiveFarm(raw, coord, raw?.distance);

      // Regride suavemente para o prior otimista (3,1): história antiga perde força,
      // sem apagar a memória estrutural da farm.
      f.alpha = 3 + Math.max(0, f.alpha - 3) * decay;
      f.beta = 1 + Math.max(0, f.beta - 1) * decay;
      f.effectiveSamples *= decay;
      f.stockWeight *= decay;

      for (const cap of adaptiveCapacityGridForFarm(f, f.recent)) {
        const d = f.depth[String(cap)] || { a: 0.5, b: 0.5 };
        d.a = 0.5 + Math.max(0, Number(d.a || 0.5) - 0.5) * decay;
        d.b = 0.5 + Math.max(0, Number(d.b || 0.5) - 0.5) * decay;
        f.depth[String(cap)] = d;
      }

      for (const cell of f.hourProfile) cell.w *= decay;
      for (const bucket of f.restProfile) bucket.w *= decay;

      f.competitionScore *= decay;
      f.lossRisk *= decay;
      f.volatilityScore = 0.5 + (f.volatilityScore - 0.5) * decay;
      f.jackpotMemory *= jackpotDecay;
      f.certaintyShock *= Math.pow(0.5, elapsedMs / (6 * 3600000));
      f.positiveCusum *= decay;
      f.negativeCusum *= decay;
      f.lastModelUpdateAt = now;
      store.farms[coord] = f;
    }
  }

  function circularHourDistance(a, b) {
    const d = Math.abs(Number(a) - Number(b)) % 24;
    return Math.min(d, 24 - d);
  }

  function priorRestFactor(hours) {
    const h = Math.max(0, Number(hours) || 0);
    if (h < 1) return 0.18;
    if (h < 2) return 0.32;
    if (h < 3) return 0.48;
    if (h < 4) return 0.62;
    if (h < 6) return 0.78;
    if (h < 12) return 0.90;
    return 1.00;
  }

  function adaptiveRestBucketIndex(hours) {
    const h = Math.max(0, Number(hours) || 0);
    for (let i = 0; i < ADAPTIVE_REST_BUCKET_HOURS.length; i++) {
      if (h <= ADAPTIVE_REST_BUCKET_HOURS[i]) return i;
    }
    return ADAPTIVE_REST_BUCKET_HOURS.length - 1;
  }

  function normalRandom() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function gammaRandom(shape) {
    const k = Number(shape);
    if (!Number.isFinite(k) || k <= 0) return 0;
    if (k < 1) {
      const u = Math.max(Number.EPSILON, Math.random());
      return gammaRandom(k + 1) * Math.pow(u, 1 / k);
    }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x;
      let v;
      do {
        x = normalRandom();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function betaRandom(alpha, beta) {
    const x = gammaRandom(Math.max(0.01, Number(alpha) || 1));
    const y = gammaRandom(Math.max(0.01, Number(beta) || 1));
    if (!(x > 0) && !(y > 0)) return 0.5;
    return x / Math.max(Number.EPSILON, x + y);
  }

  function monotonicDepthProbabilities(f) {
    const out = [];
    let ceiling = 1;
    for (const cap of adaptiveCapacityGridForFarm(f)) {
      const d = f.depth?.[String(cap)] || { a: 0.5, b: 0.5 };
      const p = clampNumber(Number(d.a) / Math.max(0.01, Number(d.a) + Number(d.b)), 0, ceiling, 0.5);
      ceiling = p;
      out.push({ cap, p });
    }
    return out;
  }

  function probabilityStockAtLeast(f, capacity, contextScale = 1) {
    const c = Math.max(1, Number(capacity) || 1);
    const curve = monotonicDepthProbabilities(f);
    if (!curve.length) return clampNumber(f.beliefGood * contextScale, 0, 1, 0.5);
    if (c <= curve[0].cap) return clampNumber(curve[0].p * contextScale, 0, 1, curve[0].p);

    for (let i = 1; i < curve.length; i++) {
      const left = curve[i - 1];
      const right = curve[i];
      if (c <= right.cap) {
        const t = (c - left.cap) / Math.max(1, right.cap - left.cap);
        const p = left.p + (right.p - left.p) * t;
        return clampNumber(p * contextScale, 0, 1, p);
      }
    }

    const tail = curve[curve.length - 1].p;
    return clampNumber(tail * contextScale, 0, 1, tail);
  }

  function expectedLootFromDepth(f, capacity, contextScale = 1) {
    const c = Math.max(1, Number(capacity) || 1);
    const curve = monotonicDepthProbabilities(f);
    let total = 0;
    let previous = 0;

    for (const point of curve) {
      if (previous >= c) break;
      const upper = Math.min(c, point.cap);
      const width = Math.max(0, upper - previous);
      if (width > 0) total += width * clampNumber(point.p * contextScale, 0, 1, point.p);
      previous = point.cap;
    }

    if (previous < c) {
      const pTail = curve.length ? curve[curve.length - 1].p : f.beliefGood;
      total += (c - previous) * clampNumber(pTail * contextScale, 0, 1, pTail);
    }

    return clampNumber(total, 0, c, Math.min(c, f.expectedStock || c * 0.75));
  }

  function sectorSignal(store, sector, now = Date.now()) {
    const events = (store.events || []).filter(e =>
      e &&
      e.sector === sector &&
      Number(e.at) > now - 6 * 3600000 &&
      hasObservedNumber(e.surprise)
    );
    if (!events.length) return 0;
    const avg = events.reduce((s, e) => s + Number(e.surprise), 0) / events.length;
    return clampNumber(avg / 3, -0.15, 0.15, 0);
  }

  function adaptiveGlobalSignal(store, now = Date.now()) {
    const probe = (store.events || []).filter(e =>
      Number(e.at) > now - 3 * 3600000 &&
      ['BOOTSTRAP_NEW', 'EXPLORATION', 'LEARNING', 'EARLY_ROTATION', 'FORCED_COVERAGE'].includes(String(e.reason)) &&
      hasObservedNumber(e.efficiency)
    );
    if (probe.length < 3) return 0;
    const avg = probe.reduce((s, e) => s + Number(e.efficiency), 0) / probe.length;
    return clampNumber((avg - 0.6) * 0.25, -0.10, 0.10, 0);
  }

  function adaptivePlanningCapacity(c = DEFAULTS, templateContext = null) {
    const manual = Math.max(40, Number(c?.adaptiveReferenceCapacity) || DEFAULTS.adaptiveReferenceCapacity);
    if (String(c?.adaptivePlanningCapacityMode || 'AUTO') === 'AUTO') {
      const actual = finiteObservedNumber(templateContext?.capacity);
      if (actual !== null && actual > 0) return actual;
    }
    return manual;
  }

  function predictAdaptiveFarm(farm, at, store, c, capacityOverride = null) {
    const now = Number(at) || Date.now();
    const override = finiteObservedNumber(capacityOverride);
    const reference = override !== null && override > 0
      ? override
      : adaptivePlanningCapacity(c);
    const storedMean = finiteObservedNumber(farm.stockMean);
    const storedSlow = finiteObservedNumber(farm.slowStock);
    const storedFast = finiteObservedNumber(farm.fastStock);
    const physicalKnown = storedMean !== null && Number(farm.stockWeight || 0) > 0;
    const baseMean = physicalKnown ? Math.max(0, storedMean) : null;
    const longTerm = physicalKnown ? Math.max(0, storedSlow !== null ? storedSlow : baseMean) : null;
    const recent = physicalKnown ? Math.max(0, storedFast !== null ? storedFast : baseMean) : null;
    const recentWeight = 0.38 + 0.22 * (1 - farm.certainty);
    let stock = physicalKnown
      ? longTerm * (1 - recentWeight) + recent * recentWeight
      : null;

    const hour = new Date(now).getHours();
    let hourStock = 0;
    let hourWeight = 0;
    for (let h = 0; h < 24; h++) {
      const cell = farm.hourProfile?.[h];
      if (!cell || !(cell.w > 0)) continue;
      const d = circularHourDistance(hour, h);
      const kernel = Math.exp(-(d * d) / (2 * 2.25 * 2.25));
      const w = Number(cell.w) * kernel;
      hourStock += Number(cell.stock || 0) * w;
      hourWeight += w;
    }
    if (stock !== null && hourWeight > 0.5 && baseMean > 0) {
      const context = clampNumber((hourStock / hourWeight) / baseMean, 0.55, 1.55, 1);
      stock *= 0.65 + 0.35 * context;
    }

    const restHours = farm.lastObservationAt
      ? Math.max(0, (now - Number(farm.lastObservationAt)) / 3600000)
      : Number(c.adaptiveMaxUnseenHours) || 24;
    const idx = adaptiveRestBucketIndex(restHours);
    const bucket = farm.restProfile?.[idx];
    const prior = priorRestFactor(restHours);
    let restFactor = prior;
    if (bucket && bucket.w >= 1 && baseMean > 0) {
      const observedFactor = clampNumber(Number(bucket.stock || 0) / baseMean, 0.25, 1.6, prior);
      const confidence = clampNumber(bucket.w / 6, 0, 1, 0);
      restFactor = prior * (1 - confidence) + observedFactor * confidence;
    }
    if (stock !== null) stock *= restFactor;

    const trendScale = stock !== null
      ? clampNumber(Number(farm.trend || 0) / Math.max(80, baseMean), -0.20, 0.20, 0)
      : 0;
    if (stock !== null) {
      stock *= 1 + trendScale * 0.35;
      stock *= 1 + sectorSignal(store, farm.sector, now);
      stock *= 1 + adaptiveGlobalSignal(store, now);
    }

    if (stock !== null) {
      if (farm.regime === 'IMPROVING') stock *= 1.08;
      else if (farm.regime === 'DETERIORATING') stock *= 0.90;
      else if (farm.regime === 'POSSIBLE_CHANGE') stock *= 1.03;
    }

    if (stock !== null) stock = Math.max(0, stock);

    const contextScale = stock !== null && baseMean > 0
      ? clampNumber(stock / Math.max(20, baseMean), 0.35, 1.75, 1)
      : 1;
    const hasDepthEvidence = Number(farm.effectiveSamples || 0) > 0;
    const depthLoot = expectedLootFromDepth(farm, reference, contextScale);
    const priorPlanningLoot = reference * clampNumber(farm.beliefGood, 0, 1, 0.75);
    // Coerência probabilística: E[min(stock,C)] nunca pode exceder E[stock].
    const expectedLoot = stock !== null
      ? Math.min(reference, stock, depthLoot)
      : Math.min(reference, hasDepthEvidence ? depthLoot : priorPlanningLoot);
    const expectedFill = clampNumber(expectedLoot / reference, 0, 1, 0);
    const sigma = Math.max(
      30,
      Math.sqrt(Math.max(0, Number(farm.stockVariance) || 0)),
      (stock ?? reference) * (0.22 + 0.50 * (1 - farm.certainty) + 0.18 * farm.volatilityScore)
    );

    return {
      at: now,
      expectedStock: stock,
      stockKnown: physicalKnown,
      planningCapacity: reference,
      planningStock: stock ?? priorPlanningLoot,
      sigma,
      expectedLoot,
      expectedFill,
      contextScale,
      restHours
    };
  }

  function adaptiveCertainty(farm, at = Date.now(), c = DEFAULTS, windowEvidence = null) {
    const evidence = windowEvidence || adaptiveWindowEvidence(farm, c, at);
    const n = Math.max(0, Number(evidence.effectiveSamples) || 0);
    const sample = 1 - Math.exp(-n / 7);
    const ageHours = evidence.lastTimedEvidenceAt
      ? Math.max(0, (at - Number(evidence.lastTimedEvidenceAt)) / 3600000)
      : 999;
    const freshness = Math.pow(0.5, ageHours / 36);
    const hour = new Date(at).getHours();
    let contextWeight = 0;
    for (let h = 0; h < 24; h++) {
      const cell = evidence.hourProfile?.[h];
      if (!cell || !(cell.w > 0)) continue;
      const d = circularHourDistance(hour, h);
      contextWeight += Number(cell.w) * Math.exp(-(d * d) / (2 * 2.5 * 2.5));
    }
    const context = clampNumber(contextWeight / 6, 0.25, 1, 0.25);
    const stability = clampNumber(1 - Number(evidence.volatilityScore || 0) * 0.32, 0.25, 1, 0.7);
    const shockFactor = clampNumber(1 - Number(evidence.certaintyShock || 0), 0.15, 1, 1);
    return clampNumber(sample * freshness * context * stability * shockFactor, 0.03, 1, 0.03);
  }

  function adaptiveCoverageDebt(farm, now, c) {
    const maxHours = Math.max(6, Number(c.adaptiveMaxUnseenHours) || 24);
    const ageHours = farm.lastObservationAt
      ? Math.max(0, (now - Number(farm.lastObservationAt)) / 3600000)
      : maxHours;
    return Math.pow(ageHours / Math.max(1, maxHours * 0.55), 3);
  }

  function recalcAdaptiveFarm(farm, store, c, now = Date.now(), planningCapacityOverride = null) {
    const windowEvidence = adaptiveWindowEvidence(farm, c, now);
    farm.recent = windowEvidence.entries.slice(-ADAPTIVE_RECENT_PER_FARM_LIMIT);
    farm.observations = windowEvidence.observations;
    farm.lastObservationAt = windowEvidence.lastObservationAt;
    farm.previousObservationAt = windowEvidence.previousObservationAt;
    farm.lastKnownStock = windowEvidence.lastKnownStock;
    farm.lastKnownRemaining = windowEvidence.lastKnownRemaining;
    farm.lastLossAt = windowEvidence.lastLossAt;
    farm.alpha = windowEvidence.alpha;
    farm.beta = windowEvidence.beta;
    farm.badStreak = windowEvidence.badStreak;
    farm.effectiveSamples = windowEvidence.effectiveSamples;
    farm.depth = windowEvidence.depth;
    farm.stockMean = windowEvidence.stockMean;
    farm.stockVariance = windowEvidence.stockVariance;
    farm.stockWeight = windowEvidence.stockWeight;
    farm.fastStock = windowEvidence.fastStock;
    farm.slowStock = windowEvidence.slowStock;
    farm.fastFill = windowEvidence.fastFill;
    farm.slowFill = windowEvidence.slowFill;
    farm.hourProfile = windowEvidence.hourProfile;
    farm.restProfile = windowEvidence.restProfile;
    farm.positiveCusum = windowEvidence.positiveCusum;
    farm.negativeCusum = windowEvidence.negativeCusum;
    farm.regime = windowEvidence.regime;
    farm.certaintyShock = windowEvidence.certaintyShock;
    farm.recheckByAt = windowEvidence.recheckByAt;
    farm.competitionScore = windowEvidence.competitionScore;
    farm.volatilityScore = windowEvidence.volatilityScore;
    farm.lossRisk = windowEvidence.lossRisk;
    farm.jackpotMemory = windowEvidence.jackpotMemory;
    farm.beliefGood = clampNumber(farm.alpha / Math.max(0.01, farm.alpha + farm.beta), 0, 1, 0.75);
    farm.certainty = adaptiveCertainty(farm, now, c, windowEvidence);
    farm.trend = hasObservedNumber(farm.fastStock) && hasObservedNumber(farm.slowStock)
      ? Number(farm.fastStock) - Number(farm.slowStock)
      : 0;
    farm.coverageDebt = adaptiveCoverageDebt(farm, now, c);

    const pred = predictAdaptiveFarm(farm, now, store, c, planningCapacityOverride);
    farm.expectedStock = pred.expectedStock;
    farm.expectedFill = pred.expectedFill;

    // FarmRating é estrutural e não depende da carga/template que se pretende usar.
    // A economia do ataque concreto é calculada mais tarde no ExecutionScore.
    const physicalScale = Math.max(80, Number(farm.stockMean) || 80);
    const trendNorm = clampNumber(farm.trend / physicalScale, -1, 1, 0);
    const evidenceStrength = clampNumber(Number(farm.effectiveSamples || 0) / 6, 0, 1, 0);
    let rating =
      34 +
      28 * farm.beliefGood +
      14 * farm.certainty +
      8 * evidenceStrength +
      8 * Math.max(0, trendNorm) +
      6 * clampNumber(farm.jackpotMemory, 0, 1, 0) -
      8 * farm.competitionScore -
      7 * clampNumber(farm.volatilityScore, 0, 1, 0) -
      12 * farm.lossRisk;

    if (farm.regime === 'IMPROVING') rating += 5;
    if (farm.regime === 'DETERIORATING') rating -= 6;
    if (farm.regime === 'POSSIBLE_CHANGE') rating += 2;

    farm.farmRating = clampNumber(rating, 0, 100, 50);
    farm.nextDueAt = calculateAdaptiveNextDue(farm, store, c, now, planningCapacityOverride);
    farm.lastModelUpdateAt = now;
    return farm;
  }

  function adaptiveRegimePresentation(farm, c = DEFAULTS) {
    const observations = Math.max(0, Math.trunc(Number(farm?.observations) || 0));
    const effectiveSamples = Math.max(0, Number(farm?.effectiveSamples) || 0);
    const target = Math.max(1, Math.trunc(Number(c?.adaptiveLearningTargetObservations) || 3));
    if (observations === 0) {
      return {
        code: 'NO_DATA',
        label: 'Sem dados',
        arrow: '—',
        detail: `Nenhum report quantitativo desta farm dentro da janela de ${adaptiveHistoryDays(c)} dias.`

      };
    }
    if (observations < target) {
      return {
        code: 'LEARNING',
        label: `A aprender ${observations}/${target}`,
        arrow: '•',
        detail: `${observations} report(s) quantitativo(s); faltam ${target - observations} para sair da fase inicial.`
      };
    }
    if (!farm?.lastObservationAt) {
      return {
        code: 'NO_TIME',
        label: 'Dados sem hora',
        arrow: '•',
        detail: `${observations} report(s) quantitativo(s), mas sem timestamp fiável; stock e rendimento contam, perfis horários e descanso não são inventados.`
      };
    }
    const regime = String(farm?.regime || 'UNKNOWN');
    const labels = {
      STABLE: 'Estável',
      IMPROVING: 'A melhorar',
      DETERIORATING: 'A piorar',
      POSSIBLE_CHANGE: 'Mudança possível',
      UNKNOWN: 'Padrão incerto'
    };
    const trend = Number(farm?.trend || 0);
    return {
      code: regime,
      label: labels[regime] || 'Padrão incerto',
      arrow: trend > 8 ? '↑' : (trend < -8 ? '↓' : '→'),
      detail: `${observations} report(s), ${effectiveSamples.toFixed(2)} amostra(s) efetiva(s) após decay; certeza ${Math.round(Number(farm?.certainty || 0) * 100)}%.`
    };
  }

  function calculateAdaptiveNextDue(farm, store, c, now = Date.now(), planningCapacityOverride = null) {
    const maxHours = Math.max(6, Number(c.adaptiveMaxUnseenHours) || 24);
    if (!farm.lastObservationAt) return now;

    // O instante procurado abaixo é a chegada desejada. O scheduler guarda o
    // momento de envio, antecipado pelo último tempo de ida conhecido desta farm.
    const oneWayMs = Math.max(0, Number(farm.lastOneWayTravelMs) || 0);
    const dispatchAtForArrival = arrivalAt => Math.max(now, Number(arrivalAt) - oneWayMs);

    const deadline = Number(farm.lastObservationAt) + maxHours * 3600000;
    if (deadline <= now) return now;
    const recheckByAt = Math.max(0, Number(farm.recheckByAt) || 0);
    if (recheckByAt > 0 && recheckByAt <= now) return now;
    const searchDeadline = recheckByAt > 0 ? Math.min(deadline, recheckByAt) : deadline;

    const baseThreshold = clampNumber(c.adaptiveRevisitFillThreshold, 0.30, 0.95, 0.64);
    const distancePenalty = clampNumber((Number(farm.distance) || 0) / 180, 0, 0.12, 0);
    const threshold = clampNumber(baseThreshold + distancePenalty, 0.35, 0.95, baseThreshold);
    const stepMs = 30 * 60000;

    for (let t = now; t <= searchDeadline; t += stepMs) {
      const pred = predictAdaptiveFarm(farm, t, store, c, planningCapacityOverride);
      let required = threshold;
      if (farm.regime === 'IMPROVING' || farm.regime === 'POSSIBLE_CHANGE') required -= 0.08;
      if (farm.competitionScore > 0.65) required -= 0.05;
      required = clampNumber(required, 0.30, 0.95, threshold);
      if (pred.expectedFill >= required) return dispatchAtForArrival(t);
    }

    return dispatchAtForArrival(searchDeadline);
  }

  function adaptiveHardSafetyBlocked(st, farm, now, c = DEFAULTS) {
    if (st?.pending || st?.sending) return true;
    // A sincronização do report atual é anterior a qualquer substituição do cooldown
    // legado, inclusive quando o resultado é loss/unknown e o respetivo prazo expirou.
    const operationalReportId = String(st?.lastReportId || '');
    const adaptiveReportId = String(farm?.lastSeenReportId || '');
    if (operationalReportId && operationalReportId !== adaptiveReportId) {
      const relation = adaptiveReportIdRelation(adaptiveReportId, operationalReportId);
      // Bloqueia quando o estado operacional é mais recente ou a ordem não pode ser
      // provada. Se o ledger adaptativo está inequivocamente à frente, não cria um
      // deadlock só porque esse report já não tem row no Assistente.
      if (relation === null || relation < 0) return true;
    }
    const adaptiveLossAt = Math.max(0, Number(farm?.lastLossAt) || 0);
    if (adaptiveLossAt > 0 && adaptiveLossAt + Number(c.lossCooldownMin || 720) * 60000 > now) {
      return true;
    }
    const result = String(st?.lastResult || '');
    if (['loss', 'unknown', 'pending-timeout', 'send-uncertain', 'send-uncertain-recovery'].includes(result)) {
      return Number(st?.cooldownUntil || 0) > now;
    }
    if (!farm || Number(farm.observations || 0) <= 0 || !farm.lastObservationAt) {
      return Number(st?.cooldownUntil || 0) > now;
    }
    return false;
  }

  function adaptiveFarmDue(farm, now, c) {
    if (!farm) return true;
    const maxHours = Math.max(6, Number(c.adaptiveMaxUnseenHours) || 24);
    if (!farm.lastObservationAt) return true;
    if (now - Number(farm.lastObservationAt) >= maxHours * 3600000) return true;
    return Number(farm.nextDueAt || 0) <= now;
  }

  function adaptiveRotationEligibility(farm, now, c) {
    if (!farm || adaptiveFarmDue(farm, now, c)) {
      return { eligible: true, due: true, state: 'DUE', restHours: Infinity };
    }
    const lastAt = Math.max(0, Number(farm.lastObservationAt) || 0);
    const restHours = lastAt ? Math.max(0, (Number(now) - lastAt) / 3600000) : Infinity;
    const minRestHours = clampNumber(
      c?.adaptiveEarlyRotationMinHours,
      0.5,
      12,
      DEFAULTS.adaptiveEarlyRotationMinHours
    );
    const learningTarget = Math.max(1, Math.trunc(Number(c?.adaptiveLearningTargetObservations) || 3));
    const learning = Number(farm.observations || 0) < learningTarget;
    if (restHours >= minRestHours) {
      return {
        eligible: true,
        due: false,
        state: learning ? 'LEARNING' : 'EARLY_ROTATION',
        restHours
      };
    }
    return { eligible: false, due: false, state: 'MIN_REST', restHours };
  }

  function nextAdaptiveDueAt(store, now = Date.now()) {
    const times = Object.values(store?.farms || {})
      .filter(farm => farm?.active !== false)
      .map(farm => Math.max(0, Number(farm?.nextDueAt) || 0))
      .filter(at => at > Number(now));
    return times.length ? Math.min(...times) : null;
  }

  function adaptiveSuggestedWakeAt(store, c, now = Date.now()) {
    const minRestMs = clampNumber(
      c?.adaptiveEarlyRotationMinHours,
      0.5,
      12,
      DEFAULTS.adaptiveEarlyRotationMinHours
    ) * 3600000;
    const times = [];
    for (const farm of Object.values(store?.farms || {})) {
      if (farm?.active === false) continue;
      const dueAt = Math.max(0, Number(farm?.nextDueAt) || 0);
      const lastAt = Math.max(0, Number(farm?.lastObservationAt) || 0);
      if (dueAt > Number(now)) times.push(dueAt);
      if (lastAt > 0 && lastAt + minRestMs > Number(now)) times.push(lastAt + minRestMs);
    }
    return times.length ? Math.min(...times) : null;
  }

  function adaptiveReason(farm, now, c) {
    const maxHours = Math.max(6, Number(c.adaptiveMaxUnseenHours) || 24);
    const learningTarget = Math.max(1, Math.trunc(Number(c?.adaptiveLearningTargetObservations) || 3));
    if (!farm.lastObservationAt) return 'LEARNING';
    if (now - Number(farm.lastObservationAt) >= maxHours * 3600000) return 'FORCED_COVERAGE';
    if (Number(farm.observations || 0) < learningTarget) return 'LEARNING';
    if (['IMPROVING', 'DETERIORATING', 'POSSIBLE_CHANGE'].includes(String(farm.regime))) return 'TREND_CHECK';
    if (farm.certainty < 0.35) return 'EXPLORATION';
    if (farm.jackpotMemory > 0.7) return 'JACKPOT_FOLLOWUP';
    return 'EXPLOITATION';
  }

  function adaptiveDistanceContextKey(distance) {
    const d = Math.max(0, Number(distance) || 0);
    if (d < 3) return '0-3';
    if (d < 5) return '3-5';
    if (d < 7) return '5-7';
    if (d < 10) return '7-10';
    return '10+';
  }

  function buildAdaptiveTemplateContext(composition, unitInfo, explicitCapacity = null) {
    const capacity = finiteObservedNumber(explicitCapacity) ?? transportCapacityForComposition(composition, unitInfo);
    if (!composition || !unitInfo) {
      return { composition: composition || null, capacity, slowestSpeed: null, unitCount: null, authoritative: false };
    }
    let slowestSpeed = 0;
    let unitCount = 0;
    for (const [unit, rawCount] of Object.entries(composition)) {
      const count = Math.max(0, Number(rawCount) || 0);
      if (!(count > 0)) continue;
      const speed = finiteObservedNumber(unitInfo?.[unit]?.speed);
      if (speed === null || !(speed > 0)) {
        return { composition, capacity, slowestSpeed: null, unitCount, authoritative: false };
      }
      slowestSpeed = Math.max(slowestSpeed, speed);
      unitCount += count;
    }
    return {
      composition,
      capacity,
      slowestSpeed: slowestSpeed > 0 ? slowestSpeed : null,
      unitCount: unitCount > 0 ? unitCount : null,
      authoritative: capacity !== null && capacity > 0 && slowestSpeed > 0 && unitCount > 0
    };
  }

  function adaptiveContextStats(store, c, now = Date.now()) {
    const cutoff = adaptiveHistoryCutoff(c, now);
    const global = { loot: 0, capacity: 0, n: 0 };
    const hours = Array.from({ length: 24 }, () => ({ loot: 0, capacity: 0, n: 0 }));
    const distance = Object.fromEntries(['0-3', '3-5', '5-7', '7-10', '10+'].map(key => [key, { loot: 0, capacity: 0, n: 0 }]));
    const combined = {};
    for (const event of adaptiveEconomicRecordsFromStore(store, '')) {
      const at = finiteObservedNumber(event?.at);
      const loot = finiteObservedNumber(event?.loot);
      const capacity = finiteObservedNumber(event?.capacity);
      if (at === null || at < cutoff || at > Number(now) + 5 * 60000 || loot === null || capacity === null || !(capacity > 0)) continue;
      const weight = Math.pow(0.5, Math.max(0, Number(now) - at) /
        (Math.max(12, Number(c?.adaptiveHalfLifeHours) || 60) * 3600000));
      const credited = Math.min(loot, capacity) * weight;
      const capWeighted = capacity * weight;
      const hour = new Date(at).getHours();
      const d = finiteObservedNumber(event?.distance) ?? coordDistance(event?.coord || event?.targetCoord);
      const distanceKey = adaptiveDistanceContextKey(d);
      for (const cell of [global, hours[hour], distance[distanceKey]]) {
        cell.loot += credited;
        cell.capacity += capWeighted;
        cell.n += weight;
      }
      const comboKey = `${distanceKey}:${hour}`;
      const combo = combined[comboKey] || (combined[comboKey] = { loot: 0, capacity: 0, n: 0 });
      combo.loot += credited;
      combo.capacity += capWeighted;
      combo.n += weight;
    }
    return { global, hours, distance, combined };
  }

  function adaptiveResidualContextWeight(cell, global, min, max, k, compression = 0.35) {
    if (!(cell?.capacity > 0) || !(global?.capacity > 0)) return 1;
    const measured = (cell.loot / cell.capacity) / Math.max(0.05, global.loot / global.capacity);
    const confidence = Number(cell.n || 0) / (Number(cell.n || 0) + k);
    return clampNumber(1 + confidence * (measured - 1) * compression, min, max, 1);
  }

  function adaptiveArrivalHourWeight(stats, arrivalAt) {
    const date = new Date(Number(arrivalAt) || Date.now());
    const fractionalHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const smoothed = { loot: 0, capacity: 0, n: 0 };
    for (let hour = 0; hour < 24; hour++) {
      const cell = stats?.hours?.[hour];
      if (!cell || !(cell.n > 0)) continue;
      const kernel = Math.exp(-Math.pow(circularHourDistance(fractionalHour, hour), 2) / (2 * 1.35 * 1.35));
      smoothed.loot += cell.loot * kernel;
      smoothed.capacity += cell.capacity * kernel;
      smoothed.n += cell.n * kernel;
    }
    return adaptiveResidualContextWeight(smoothed, stats?.global, 0.90, 1.10, 18, 0.35);
  }

  function adaptiveExecutionEvaluation(farm, store, c, now, templateContext, contextStats) {
    const distance = finiteObservedNumber(farm?.distance);
    const oneWayHours = templateContext?.slowestSpeed && distance !== null
      ? distance * Number(templateContext.slowestSpeed) / 60
      : 0;
    const expectedArrivalAt = Number(now) + oneWayHours * 3600000;
    const capacity = finiteObservedNumber(templateContext?.capacity);
    const planningCapacity = capacity !== null && capacity > 0
      ? capacity
      : adaptivePlanningCapacity(c, templateContext);
    const prediction = predictAdaptiveFarm(farm, expectedArrivalAt, store, c, planningCapacity);
    const expectedLoot = prediction.expectedLoot;
    const expectedEfficiency = planningCapacity > 0 ? expectedLoot / planningCapacity : null;
    const fullProbability = Math.min(
      probabilityStockAtLeast(farm, planningCapacity, prediction.contextScale),
      prediction.stockKnown
        ? clampNumber(Number(prediction.expectedStock) / planningCapacity, 0, 1, 0)
        : 1
    );
    const unitHours = templateContext?.unitCount && oneWayHours > 0
      ? 2 * oneWayHours * Number(templateContext.unitCount)
      : null;
    const economicValue = Number.isFinite(unitHours) && unitHours > 0
      ? expectedLoot / unitHours
      : null;
    const distanceKey = adaptiveDistanceContextKey(distance);
    const distanceWeight = adaptiveResidualContextWeight(
      contextStats?.distance?.[distanceKey], contextStats?.global, 0.92, 1.08, 20, 0.35
    );
    const arrivalHourWeight = adaptiveArrivalHourWeight(contextStats, expectedArrivalAt);
    const arrivalHour = new Date(expectedArrivalAt).getHours();
    const combined = contextStats?.combined?.[`${distanceKey}:${arrivalHour}`];
    const combinedWeight = Number(combined?.n || 0) >= 12
      ? adaptiveResidualContextWeight(combined, contextStats?.global, 0.94, 1.06, 24, 0.25)
      : null;
    const contextWeight = combinedWeight ?? (distanceWeight * arrivalHourWeight);
    return {
      capacity: capacity !== null && capacity > 0 ? capacity : null,
      planningCapacity,
      capacityAuthoritative: Boolean(templateContext?.authoritative && capacity !== null && capacity > 0),
      expectedArrivalAt,
      prediction,
      expectedLoot,
      expectedEfficiency,
      predictedEfficiencyForCapacity: expectedEfficiency,
      fullProbability,
      unitHours,
      economicValue,
      distanceWeight,
      arrivalHourWeight,
      combinedWeight,
      contextWeight,
      contextEconomicValue: Number.isFinite(economicValue) ? economicValue * contextWeight : null
    };
  }

  function adaptivePriority(farm, store, c, now = Date.now(), predictionAt = now) {
    const arrivalPrediction = predictAdaptiveFarm(farm, Math.max(now, Number(predictionAt) || now), store, c);
    const reason = adaptiveReason(farm, now, c);
    const sampledBelief = reason === 'EXPLOITATION'
      ? farm.beliefGood
      : betaRandom(farm.alpha, farm.beta);
    const infoBonus = ['EXPLORATION', 'LEARNING'].includes(reason)
      ? 26 * (1 - farm.certainty)
      : 0;
    const coverageBonus = reason === 'FORCED_COVERAGE'
      ? 14 * Math.min(2, Math.log1p(Math.max(0, farm.coverageDebt)))
      : 0;
    const trendNorm = clampNumber(farm.trend / Math.max(80, Number(farm.stockMean) || 80), -1, 1, 0);
    const trendBonus = 12 * Math.max(0, trendNorm);
    const trendPenalty = 8 * Math.max(0, -trendNorm);
    const jackpotBonus = 6 * clampNumber(farm.jackpotMemory, 0, 1.5, 0);
    const sectorBonus = 7 * Math.max(0, sectorSignal(store, farm.sector, now));
    const reference = adaptivePlanningCapacity(c);
    const arrivalStockBonus = 14 * clampNumber(
      (arrivalPrediction.expectedStock ?? arrivalPrediction.planningStock) / reference,
      0,
      1.5,
      0
    );
    const score =
      farm.farmRating * sampledBelief +
      infoBonus +
      coverageBonus +
      trendBonus -
      trendPenalty +
      jackpotBonus +
      arrivalStockBonus +
      sectorBonus;
    return {
      score,
      sampledBelief,
      reason,
      predictionAt: arrivalPrediction.at,
      expectedStockAtArrival: arrivalPrediction.expectedStock
    };
  }

  function weightedSoftmaxPick(entries, temperature = 8) {
    if (!entries.length) return null;
    const t = Math.max(0.1, Number(temperature) || 8);
    const maxScore = Math.max(...entries.map(e => Number(e.score) || 0));
    const weights = entries.map(e => Math.exp(((Number(e.score) || 0) - maxScore) / t));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return entries[0];
    let r = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
      r -= weights[i];
      if (r <= 0) return entries[i];
    }
    return entries[entries.length - 1];
  }

  function rankAdaptiveEligible(eligible, store, villageId, c, now = Date.now(), arrivalContext = null) {
    if (!c.adaptiveEnabled || !Array.isArray(eligible) || !eligible.length) return eligible || [];

    const templateContext = arrivalContext?.templateContext || buildAdaptiveTemplateContext(
      arrivalContext?.composition,
      arrivalContext?.unitInfo,
      arrivalContext?.capacity
    );
    const contextStats = arrivalContext?.contextStats || adaptiveContextStats(store, c, now);
    const allocation = normalizeAdaptiveAllocationBudget(store?.allocationBudget);
    const policy = adaptiveAllocationQuotas(store, c, now);

    // PassSnapshot: cada farm é reconstruída e prevista uma única vez nesta ordenação.
    // Ranking, logs e decisão final reutilizam adaptiveExecution em vez de percorrer
    // novamente o ledger para cada candidato.
    const raw = eligible.map(item => {
      const farm = ensureAdaptiveFarm(store, item.coord, coordDistance(item.coord));
      recalcAdaptiveFarm(farm, store, c, now, adaptivePlanningCapacity(c, templateContext));
      const timing = item.adaptiveDue === false ? 'EARLY' : 'DUE';
      const reason = item.bootstrap
        ? 'BOOTSTRAP_NEW'
        : (item.adaptiveRotationState === 'LEARNING' ? 'LEARNING' : adaptiveReason(farm, now, c));
      const allocationClass = adaptiveAllocationClass(reason);
      const execution = adaptiveExecutionEvaluation(farm, store, c, now, templateContext, contextStats);
      return {
        ...item,
        adaptiveTiming: timing,
        adaptiveReason: reason,
        adaptiveAllocationClass: allocationClass,
        adaptiveBootstrapForced: false,
        farmRating: farm.farmRating,
        certainty: farm.certainty,
        expectedStockAtArrival: execution.prediction.expectedStock,

        predictionAt: execution.expectedArrivalAt,
        adaptiveExecution: execution
      };
    });

    const economicValues = raw
      .map(item => finiteObservedNumber(item.adaptiveExecution?.contextEconomicValue))
      .filter(value => value !== null && value >= 0);
    const economicScale = economicValues.length ? Math.max(1, ...economicValues) : 1;
    const scored = raw.map(item => {
      const farm = ensureAdaptiveFarm(store, item.coord, coordDistance(item.coord));
      const execution = item.adaptiveExecution;
      const economicNorm = hasObservedNumber(execution?.contextEconomicValue)
        ? clampNumber(Number(execution.contextEconomicValue) / economicScale, 0, 1, 0)
        : 0;
      const efficiency = clampNumber(execution?.expectedEfficiency, 0, 1, 0.5);
      const certainty = clampNumber(item.certainty, 0, 1, 0.03);
      const structural = clampNumber(item.farmRating / 100, 0, 1, 0.5);
      const information = 1 - certainty;
      const coverageUrgency = clampNumber(Math.log1p(Math.max(0, Number(farm.coverageDebt) || 0)) / Math.log(8), 0, 1.5, 0);
      let score;
      switch (item.adaptiveAllocationClass) {
        case 'EXPLORE':
          score = 38 * information + 25 * economicNorm + 18 * efficiency + 12 * structural + 7 * coverageUrgency;
          break;
        case 'NEW':
          score = 42 * information + 22 * economicNorm + 18 * efficiency + 10 * structural + 8 * coverageUrgency;
          break;
        case 'TREND':
          score = 34 * economicNorm + 22 * efficiency + 18 * certainty + 16 * structural + 10 * coverageUrgency;
          break;
        case 'COVERAGE':
          score = 40 * coverageUrgency + 24 * economicNorm + 16 * efficiency + 12 * structural + 8 * information;
          break;
        default:
          // Exploitation é determinístico e recompensa retorno + confiança. O
          // desconhecido já não recebe +25 apenas por ser desconhecido.
          score = 48 * economicNorm + 23 * efficiency + 17 * certainty + 12 * structural;
          break;
      }
      if (item.adaptiveTiming === 'EARLY') score -= 6;
      score -= 12 * clampNumber(farm.lossRisk, 0, 1, 0);
      return { ...item, adaptiveScore: score };
    });

    const topK = Math.max(1, Math.min(12, Math.trunc(Number(c.adaptiveTopK) || 5)));

    function randomizedTopK(list) {
      const remaining = [...list].sort((a, b) => Number(b.adaptiveScore) - Number(a.adaptiveScore));
      const out = [];
      while (remaining.length) {
        const window = remaining.slice(0, Math.min(topK, remaining.length));
        const weighted = window.map(x => ({ ...x, score: Number(x.adaptiveScore) || 0 }));
        const chosenCopy = weightedSoftmaxPick(weighted, c.adaptiveSelectionTemperature);
        const chosen = window.find(x =>
          x.coord === chosenCopy?.coord &&
          String(x.targetId) === String(chosenCopy?.targetId)
        ) || window[0];
        out.push(chosen);
        const idx = remaining.indexOf(chosen);
        remaining.splice(idx >= 0 ? idx : 0, 1);
      }
      return out;
    }

    const groups = {};
    for (const name of ADAPTIVE_ALLOCATION_CLASSES) {
      const list = scored.filter(item => item.adaptiveAllocationClass === name);
      groups[name] = name === 'EXPLOIT'
        ? list.sort((a, b) => Number(b.adaptiveScore) - Number(a.adaptiveScore))
        : randomizedTopK(list);
    }

    const ordered = [];
    const used = new Set();
    const selectedCounts = Object.fromEntries(ADAPTIVE_ALLOCATION_CLASSES.map(name => [name, 0]));

    function take(groupName) {
      const list = groups[groupName];
      while (list.length) {
        const x = list.shift();
        const key = `${x.coord}:${x.targetId}`;
        if (used.has(key)) continue;
        used.add(key);
        selectedCounts[groupName] += 1;
        ordered.push({
          ...x,
          adaptiveAllocationDebt: Number(policy.quotas[groupName] || 0) * (allocation.total + ordered.length + 1) -
            (Number(allocation.confirmed[groupName] || 0) + selectedCounts[groupName] - 1),
          adaptiveServicePressure: policy.servicePressure.value
        });
        return true;
      }
      return false;
    }

    const allocationSequence = adaptiveAllocationSequence(
      Object.fromEntries(ADAPTIVE_ALLOCATION_CLASSES.map(name => [name, groups[name]?.length || 0])),
      allocation,
      policy.quotas,
      scored.length
    );
    for (const planned of allocationSequence) {
      if (!take(planned.name)) break;
    }

    const result = ordered.length ? ordered : scored;
    RUNTIME.lastAdaptiveExecutionByVillage.set(String(villageId || ''), result.slice(0, 12).map(item => ({
      coord: item.coord,
      timing: item.adaptiveTiming,
      reason: item.adaptiveReason,
      allocationClass: item.adaptiveAllocationClass,
      score: item.adaptiveScore,
      farmRating: item.farmRating,
      certainty: item.certainty,
      capacity: item.adaptiveExecution?.capacity ?? item.adaptiveExecution?.planningCapacity,
      capacityAuthoritative: Boolean(item.adaptiveExecution?.capacityAuthoritative),
      expectedLoot: item.adaptiveExecution?.expectedLoot,
      expectedEfficiency: item.adaptiveExecution?.expectedEfficiency,
      fullProbability: item.adaptiveExecution?.fullProbability,
      expectedArrivalAt: item.adaptiveExecution?.expectedArrivalAt,
      unitHours: item.adaptiveExecution?.unitHours,
      contextWeight: item.adaptiveExecution?.contextWeight,
      contextEconomicValue: item.adaptiveExecution?.contextEconomicValue
    })));
    return result;
  }

  function parseGameInteger(value) {
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : null;
  }

  function extractNumberTokens(text) {
    // Recursos do TW são inteiros; aceita separadores de milhares "." ou "," mas
    // não agrega números separados apenas por espaços.
    const matches = String(text || '').match(/\d+(?:[.,]\d{3})*/g) || [];
    return matches.map(parseGameInteger).filter(Number.isFinite);
  }

  function parseReportComposition(doc) {
    const table = doc?.querySelector?.('#attack_info_att_units');
    if (!table) return null;

    const headerCells = [...(table.querySelector('tr')?.children || [])];
    const units = headerCells.map(cell => {
      const img = cell.querySelector?.('img[src*="unit_"]');
      const src = img?.getAttribute('src') || '';
      const m = src.match(/unit_([a-z_]+)/i);
      return m ? m[1].toLowerCase() : null;
    });

    if (!units.some(Boolean)) return null;

    const rows = [...table.querySelectorAll('tr')];
    let quantityRow = rows.find(row => ADAPTIVE_REPORT_WORDS.quantity.test(String(row.children?.[0]?.textContent || '')));
    if (!quantityRow && rows.length >= 2) quantityRow = rows[1];
    if (!quantityRow) return null;

    const result = {};
    const cells = [...quantityRow.children];
    for (let i = 0; i < units.length && i < cells.length; i++) {
      const unit = units[i];
      if (!unit) continue;
      const count = parseGameInteger(cells[i]?.textContent);
      if (Number.isFinite(count) && count >= 0) result[unit] = count;
    }
    return Object.keys(result).length ? result : null;
  }

  function parseReportLosses(doc) {
    const table = doc?.querySelector?.('#attack_info_att_units');
    if (!table) return null;
    const headerCells = [...(table.querySelector('tr')?.children || [])];
    const units = headerCells.map(cell => {
      const src = cell.querySelector?.('img[src*="unit_"]')?.getAttribute('src') || '';
      const m = src.match(/unit_([a-z_]+)/i);
      return m ? m[1].toLowerCase() : null;
    });
    const row = [...table.querySelectorAll('tr')].find(r => ADAPTIVE_REPORT_WORDS.losses.test(String(r.children?.[0]?.textContent || '')));
    if (!row) return null;
    const cells = [...row.children];
    const result = {};
    for (let i = 0; i < units.length && i < cells.length; i++) {
      if (!units[i]) continue;
      const count = parseGameInteger(cells[i]?.textContent);
      if (Number.isFinite(count) && count >= 0) result[units[i]] = count;
    }
    return Object.keys(result).length ? result : null;
  }

  function parseReportLoot(doc) {
    const table = doc?.querySelector?.('#attack_results');
    if (!table) return { lootTotal: null, capacityShown: null };

    let candidateRow = null;
    for (const row of table.querySelectorAll('tr')) {
      const text = String(row.textContent || '');
      const resourceIcons = row.querySelectorAll('img[src*="wood"], img[src*="stone"], img[src*="iron"]');
      if (resourceIcons.length >= 2 || ADAPTIVE_REPORT_WORDS.haul.test(text)) {
        candidateRow = row;
        if (resourceIcons.length >= 2) break;
      }
    }
    if (!candidateRow) return { lootTotal: null, capacityShown: null };

    const cells = [...candidateRow.children];
    let lootNumbers = [];
    for (const cell of cells) {
      const icons = cell.querySelectorAll?.('img[src*="wood"], img[src*="stone"], img[src*="iron"]');
      const nums = extractNumberTokens(cell.textContent);
      if (icons?.length >= 2 && nums.length >= 3) {
        lootNumbers = nums.slice(0, 3);
        break;
      }
    }
    if (!lootNumbers.length) {
      const all = extractNumberTokens(candidateRow.textContent);
      if (all.length >= 3) lootNumbers = all.slice(0, 3);
    }

    const ratioMatch = String(candidateRow.textContent || '').match(/(\d[\d\s.,]*)\s*\/\s*(\d[\d\s.,]*)/);
    const capacityShown = ratioMatch ? parseGameInteger(ratioMatch[2]) : null;
    const lootTotal = lootNumbers.length >= 3 ? lootNumbers.slice(0, 3).reduce((a, b) => a + b, 0) : null;
    return { lootTotal, capacityShown };
  }

  function parseReportRemainingResources(doc) {
    const cell = doc?.querySelector?.('#attack_spy_resources td');
    if (!cell) return null;
    const nums = extractNumberTokens(cell.textContent);
    if (nums.length < 3) return null;
    return nums.slice(0, 3).reduce((a, b) => a + b, 0);
  }

  function reportDetailUrl(reportId, villageId) {
    const u = sameOriginUrl('/game.php');
    u.searchParams.set('village', String(villageId));
    u.searchParams.set('screen', 'report');
    u.searchParams.set('view', String(reportId));
    return u.toString();
  }

  async function fetchReportDetail(reportId, villageId) {
    try {
      const url = new URL(location.href);
      if (
        url.searchParams.get('screen') === 'report' &&
        String(url.searchParams.get('view') || '') === String(reportId || '') &&
        String(currentVillageId() || '') === String(villageId || '')
      ) {
        return document;
      }
    } catch (_) {}
    return fetchHtml(reportDetailUrl(reportId, villageId), villageId);
  }

  function reportIndexUrl(page, villageId) {
    const u = sameOriginUrl('/game.php');
    u.searchParams.set('village', String(villageId));
    u.searchParams.set('screen', 'report');
    u.searchParams.set('mode', 'attack');
    if (Number(page) > 0) u.searchParams.set('page', String(Math.trunc(Number(page))));
    return u.toString();
  }

  function reportTargetCoordFromIndexRow(row, activeCoords = null) {
    const coords = [...String(row?.textContent || '').matchAll(/\b(\d{3}\|\d{3})\b/g)]
      .map(match => match[1]);
    if (!coords.length) return null;
    if (activeCoords instanceof Set) {
      const active = coords.find(coord => activeCoords.has(coord));
      if (active) return active;
    }
    const source = currentVillageCoord();
    return coords.find(coord => coord !== source) || coords[coords.length - 1] || null;
  }

  function reportIndexPageMeta(doc, currentPage = 0) {
    const rawIds = new Set();
    for (const link of doc?.querySelectorAll?.('a[href*="screen=report"][href*="view="]') || []) {
      const href = link.getAttribute?.('href') || '';
      let reportId = null;
      try {
        reportId = new URL(href, location.origin).searchParams.get('view');
      } catch (_) {
        reportId = href.match(/[?&]view=(\d+)/i)?.[1] || null;
      }
      if (reportId) rawIds.add(String(reportId));
    }
    let paginationObserved = false;
    let hasNextPage = false;
    for (const link of doc?.querySelectorAll?.('a[href*="screen=report"][href*="page="]') || []) {
      const href = link.getAttribute?.('href') || '';
      let candidate = null;
      try {
        candidate = Number(new URL(href, location.origin).searchParams.get('page'));
      } catch (_) {
        candidate = Number(href.match(/[?&]page=(\d+)/i)?.[1]);
      }
      if (!Number.isInteger(candidate) || candidate < 0) continue;
      paginationObserved = true;
      if (candidate > Number(currentPage || 0)) hasNextPage = true;
    }
    return { rawReportCount: rawIds.size, paginationObserved, hasNextPage };
  }

  function reportIndexPageReachedEnd(meta, currentPage = 0) {
    return Number(meta?.rawReportCount || 0) === 0 ||
      (Boolean(meta?.paginationObserved) && !Boolean(meta?.hasNextPage)) ||
      Number(currentPage || 0) >= ADAPTIVE_REPORT_INDEX_MAX_PAGES - 1;
  }

  function parseReportIndexEntries(doc, activeCoords = null) {
    const out = [];
    const seen = new Set();
    const serverClock = parseServerClock(doc);
    for (const link of doc?.querySelectorAll?.('a[href*="screen=report"][href*="view="]') || []) {
      const href = link.getAttribute('href') || '';
      let reportId = null;
      try {
        reportId = new URL(href, location.origin).searchParams.get('view');
      } catch (_) {
        reportId = href.match(/[?&]view=(\d+)/i)?.[1] || null;
      }
      if (!reportId || seen.has(String(reportId))) continue;
      const row = link.closest?.('tr') || link.parentElement || null;
      const targetCoord = reportTargetCoordFromIndexRow(row, activeCoords);
      if (!targetCoord || (activeCoords instanceof Set && !activeCoords.has(targetCoord))) continue;
      const assistantAttackAt = parseAssistantAttackText(String(row?.textContent || ''), serverClock);
      seen.add(String(reportId));
      out.push({
        reportId: String(reportId),
        targetCoord,
        assistantAttackAt: finiteObservedNumber(assistantAttackAt),
        source: 'report-index'
      });
    }
    const meta = reportIndexPageMeta(doc, 0);
    Object.defineProperties(out, {
      rawReportCount: { value: meta.rawReportCount, enumerable: false },
      paginationObserved: { value: meta.paginationObserved, enumerable: false },
      hasNextPage: { value: meta.hasNextPage, enumerable: false }
    });
    return out;
  }

  function parseReportDetailTimestamp(doc) {
    const clock = parseServerClock(doc);
    if (!clock.trusted) return null;
    const candidates = [];
    const selectors = [
      '#attack_info_att tr',
      '#attack_info_def tr',
      '#content_value td',
      '#content_value th'
    ];
    for (const node of doc?.querySelectorAll?.(selectors.join(',')) || []) {
      const at = parseAssistantAttackText(String(node?.textContent || ''), clock);
      if (at !== null) candidates.push(at);
    }
    const unique = [...new Set(candidates.map(value => Math.trunc(Number(value))))];
    return unique.length === 1 ? unique[0] : null;
  }

  async function scanAdaptiveReportIndex(store, map, villageId, c) {
    const now = Date.now();
    let state = prepareAdaptiveReportIndexScope(store?.reportIndex, map, c, now);
    const cutoff = adaptiveHistoryCutoff(c, now);
    const activeCoords = new Set(map?.keys?.() || []);
    const historicallyRelevantCoords = new Set([
      ...activeCoords,
      ...normalizedCoordList(state.historyCoords),
      ...Object.keys(store?.farms || {}),
      ...(store?.reportLedger || []).map(item => String(item?.targetCoord || '')),
      ...(store?.dispatches || []).map(item => String(item?.targetCoord || item?.coord || ''))
    ].filter(coord => /^\d{3}\|\d{3}$/.test(coord)));
    const ledgerIds = new Set((store?.reportLedger || []).map(item => String(item?.reportId || '')).filter(Boolean));
    const backlogIds = new Set(state.backlog.map(item => String(item.reportId)));
    const historyCoords = new Set(normalizedCoordList(state.historyCoords));
    for (const [reportId, discovered] of Object.entries(state.discovered)) {
      if (ledgerIds.has(reportId)) {
        state.discovered[reportId] = { ...discovered, state: 'COMPLETE', updatedAt: now };
      } else if (
        discovered.state === 'OUT_OF_SCOPE' &&
        activeCoords.has(String(discovered.targetCoord || ''))
      ) {
        const queued = {
          reportId,
          targetCoord: String(discovered.targetCoord),
          assistantAttackAt: finiteObservedNumber(discovered.assistantAttackAt),
          discoveredAt: Number(discovered.discoveredAt) || now,
          source: 'report-index-promoted'
        };
        state.backlog.push(queued);
        backlogIds.add(reportId);
        state.discovered[reportId] = { ...discovered, state: 'BACKLOG', updatedAt: now };
      }

    }
    if (state.completedAt > 0 && Number(state.nextIndexAt || 0) > now && state.backlog.length === 0) {
      state.detailsPending = 0;
      store.reportIndex = state;
      return {
        pagesRead: 0, rowsRead: 0, added: 0, backlog: 0,
        historyCoords: historyCoords.size, indexComplete: true
      };
    }
    if (state.completedAt > 0) {
      state.completedAt = 0;
      state.nextPage = 0;
      state.cycleStartedAt = now;
    }
    let page = state.nextPage;
    let pagesRead = 0;
    let rowsRead = 0;
    let added = 0;

    // IDs já conhecidos têm prioridade absoluta. Consultar o índice antes de
    // esvaziar este backlog apenas os redescobriria e criaria GETs sem valor.
    if (state.backlog.length > 0) {
      state.lastScanAt = now;
      state.lastIndexAt = now;
      state.lastPageCount = 0;
      state.nextIndexAt = Math.max(now + 1000, Number(state.nextIndexAt) || 0);
      state.historyCoords = normalizedCoordList([...historyCoords]);
      state.detailsPending = state.backlog.length;
      store.reportIndex = state;
      return {
        pagesRead: 0,
        rowsRead: 0,
        added: 0,
        backlog: state.backlog.length,
        historyCoords: state.historyCoords.length,
        skippedIndexForBacklog: true
      };
    }

    while (pagesRead < ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS) {
      AntiBotGuard.assertSafe();
      renewLease(villageId);
      assertVillageContext(villageId);
      const doc = await fetchHtml(reportIndexUrl(page, villageId), villageId);
      // Primeiro lê todas as coordenadas da página. Assim uma farm que entre
      // mais tarde no raio continua reconhecida como historicamente conhecida,
      // mesmo que não estivesse no mapa quando esta página foi percorrida.
      const allEntries = parseReportIndexEntries(doc, null);
      const entries = allEntries.filter(entry => historicallyRelevantCoords.has(entry.targetCoord));
      const pageMeta = reportIndexPageMeta(doc, page);
      pagesRead++;
      rowsRead += pageMeta.rawReportCount;
      state.rawRowsSeen += pageMeta.rawReportCount;
      state.relevantRowsSeen += entries.length;
      for (const entry of allEntries) historyCoords.add(entry.targetCoord);
      for (const entry of allEntries) {
        const at = finiteObservedNumber(entry.assistantAttackAt);
        if (at !== null && at < cutoff) continue;
        if (historicallyRelevantCoords.has(entry.targetCoord)) continue;
        state = setReportDiscoveryState(state, entry.reportId, {
          targetCoord: entry.targetCoord,
          assistantAttackAt: at,
          discoveredAt: now,
          state: 'OUT_OF_SCOPE'
        });
      }
      for (const entry of entries) {
        const at = finiteObservedNumber(entry.assistantAttackAt);
        if (at !== null && at < cutoff) continue;
        if (ledgerIds.has(entry.reportId)) {
          state = setReportDiscoveryState(state, entry.reportId, {
            targetCoord: entry.targetCoord, assistantAttackAt: at,
            discoveredAt: now, state: 'COMPLETE'
          });
          continue;
        }
        if (backlogIds.has(entry.reportId)) continue;
        state.backlog.push({ ...entry, discoveredAt: now });
        backlogIds.add(entry.reportId);
        state = setReportDiscoveryState(state, entry.reportId, {
          targetCoord: entry.targetCoord, assistantAttackAt: at,
          discoveredAt: now, state: 'BACKLOG'
        });
        added++;
      }

      const knownTimes = allEntries.map(item => finiteObservedNumber(item.assistantAttackAt)).filter(value => value !== null);
      if (knownTimes.length) {
        const pageOldest = Math.min(...knownTimes);
        state.oldestSeenTimestamp = state.oldestSeenTimestamp > 0
          ? Math.min(state.oldestSeenTimestamp, pageOldest)
          : pageOldest;
      }
      const reachedCutoff = knownTimes.length > 0 && Math.min(...knownTimes) < cutoff;
      const reachedEnd = reportIndexPageReachedEnd(pageMeta, page);
      if (reachedCutoff || reachedEnd) {
        state.completedAt = now;
        state.completedThroughTimestamp = reachedCutoff ? cutoff : (state.oldestSeenTimestamp || cutoff);
        state.nextPage = 0;
        state.cycleStartedAt = 0;
        state.nextIndexAt = now + 6 * 3600000;
        break;
      }
      if (!state.cycleStartedAt) state.cycleStartedAt = now;
      page++;
      state.nextPage = page;
      state.nextIndexAt = now + Math.max(15000, Number(c.retrySeconds || 90) * 1000);
    }

    state.lastScanAt = now;
    state.lastIndexAt = now;
    state.lastPageCount = rowsRead;
    state.historyCoords = normalizedCoordList([...historyCoords]);
    state.backlog = state.backlog.slice(-ADAPTIVE_REPORT_LEDGER_LIMIT);
    state.detailsPending = state.backlog.length;
    store.reportIndex = state;
    return {
      pagesRead,
      rowsRead,
      added,
      backlog: state.backlog.length,
      historyCoords: state.historyCoords.length
    };
  }

  async function getFarmUnitEconomics(villageId) {
    const key = String(location.host);
    const cached = RUNTIME.unitInfoByHost?.get(key);
    if (cached && Date.now() - Number(cached.at || 0) < 6 * 3600000) {
      const shared = coordinationState(villageId).sources.UNIT;
      if (!coordinationSourceFresh(shared)) {
        touchCoordinationSource(villageId, 'UNIT', {
          status: 'READY', observedAt: Number(cached.at) || Date.now(),
          freshUntil: (Number(cached.at) || Date.now()) + 6 * 3600000,
          invalidated: false, inFlight: false, reason: 'cache runtime partilhada', data: cached.units
        });
      }
      return cached.units;
    }

    // A tabela de carry/speed muda muito raramente. Depois de reload, reutiliza a
    // proof persistida em vez de repetir interface.php apenas para reconstruir a
    // mesma estrutura em memória.
    const persisted = coordinationState(villageId).sources.UNIT;
    if (
      coordinationSourceFresh(persisted) &&
      persisted.data &&
      typeof persisted.data === 'object' &&
      !Array.isArray(persisted.data)
    ) {
      const units = persisted.data;
      if (!RUNTIME.unitInfoByHost) RUNTIME.unitInfoByHost = new Map();
      RUNTIME.unitInfoByHost.set(key, { at: Number(persisted.observedAt) || Date.now(), units });
      return units;
    }

    AntiBotGuard.assertSafe();
    renewLease(villageId);
    assertAccountNetworkAllowed();
    recordNetworkRequest(villageId, 'GET', `${location.origin}/interface.php?func=get_unit_info`, 'economia/carry das unidades requerida', 'UNIT_PROOF');

    let res;
    let text;
    try {
      res = await fetchWithTimeout(`${location.origin}/interface.php?func=get_unit_info`, {
        method: 'GET',
        cache: 'force-cache'
      }, villageId);
      text = await res.text();
    } catch (err) {
      if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429', 'LEASE_LOST'].includes(String(err?.code || ''))) {
        throw err;
      }
      throw codedError('UNIT_INFO_UNAVAILABLE', `Não foi possível ler capacidades das unidades: ${err?.message || err}`);
    }

    if (textLooksLikeProtection(text)) {
      AntiBotGuard.stop('Proteção anti-bot encontrada ao consultar capacidades das unidades');
      throw codedError('BOT_PROTECTION_ACTIVE');
    }
    if (textLooksLikeLogin(text, res.url)) throw codedError('LOGIN_REQUIRED', 'Sessão expirada / login necessário.');
    throwForStatus(res);

    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (!xml?.documentElement || xml.querySelector?.('parsererror')) {
      throw codedError('UNIT_INFO_PARSE_FAILED', 'A resposta de capacidades das unidades não é XML válido.');
    }
    const units = {};
    for (const node of [...xml.documentElement.children]) {
      const name = String(node.tagName || '').toLowerCase();
      if (!name) continue;
      const carry = Number(node.querySelector('carry')?.textContent);
      const speed = Number(node.querySelector('speed')?.textContent);
      if (!Number.isFinite(carry) && !Number.isFinite(speed)) continue;
      units[name] = {
        carry: Number.isFinite(carry) && carry >= 0 ? carry : 0,
        speed: Number.isFinite(speed) && speed > 0 ? speed : null
      };
    }
    if (!Object.keys(units).length) {
      throw codedError('UNIT_INFO_PARSE_FAILED', 'A resposta não contém capacidades de unidades utilizáveis.');
    }
    if (!RUNTIME.unitInfoByHost) RUNTIME.unitInfoByHost = new Map();
    const observedAt = Date.now();
    RUNTIME.unitInfoByHost.set(key, { at: observedAt, units });
    touchCoordinationSource(villageId, 'UNIT', {
      status: 'READY', observedAt, freshUntil: observedAt + 6 * 3600000,
      invalidated: false, inFlight: false, reason: 'interface.php get_unit_info', data: units
    });
    return units;
  }

  async function readUnitEconomicsForTelemetry(villageId, reader = getFarmUnitEconomics) {
    try {
      return { units: await reader(villageId), degraded: false, error: null };
    } catch (err) {
      const recoverableCodes = new Set(['UNIT_INFO_UNAVAILABLE', 'UNIT_INFO_PARSE_FAILED']);
      if (!recoverableCodes.has(String(err?.code || ''))) throw err;
      return { units: null, degraded: true, error: err };
    }
  }

  function transportCapacityForComposition(composition, unitInfo) {
    if (!composition || !unitInfo) return null;
    let total = 0;
    let saw = false;
    for (const [unit, countRaw] of Object.entries(composition)) {
      const count = Number(countRaw);
      if (!(count > 0)) continue;
      const carry = Number(unitInfo?.[unit]?.carry);
      if (!Number.isFinite(carry)) return null;
      saw = true;
      total += count * carry;
    }
    return saw ? total : null;
  }

  function survivingCompositionAfterLosses(composition, losses) {
    if (!composition || typeof composition !== 'object') return null;
    const out = {};
    let saw = false;
    for (const [unit, rawCount] of Object.entries(composition)) {
      const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
      const lost = Math.max(0, Math.trunc(Number(losses?.[unit]) || 0));
      if (count > 0 || lost > 0) saw = true;
      out[unit] = Math.max(0, count - lost);
    }
    return saw ? out : null;
  }

  function transportLossMetrics(compositionSent, compositionSurviving, losses, unitInfo, qualitativeHadLosses = false) {
    const unknown = {
      transportSentUnits: null,
      transportLostUnits: null,
      transportSurvivingUnits: null,
      transportCasualtyRate: null,
      transportCapacitySent: null,
      transportCapacityLost: null,
      transportCapacitySurviving: null,
      transportCapacityLossRate: null,
      fullTransportWipe: false,
      lossSeverity: qualitativeHadLosses ? 1 : 0,
      lossSeveritySource: qualitativeHadLosses ? 'QUALITATIVE' : 'NONE',
      lossAnomaly: false
    };
    if (!compositionSent || !unitInfo || !losses || typeof losses !== 'object') return unknown;
    let sentUnits = 0;
    let lostUnits = 0;
    let survivingUnits = 0;
    let capacitySent = 0;
    let capacityLost = 0;
    let capacitySurviving = 0;
    let sawTransport = false;
    let anomaly = false;
    for (const [unit, rawSent] of Object.entries(compositionSent)) {
      const carry = finiteObservedNumber(unitInfo?.[unit]?.carry);
      if (carry === null) return unknown;
      if (!(carry > 0)) continue;
      const sent = Math.max(0, Math.trunc(Number(rawSent) || 0));
      if (!(sent > 0)) continue;
      sawTransport = true;
      const rawLost = Math.trunc(Number(losses?.[unit]) || 0);
      if (rawLost < 0 || rawLost > sent) anomaly = true;
      const lost = Math.max(0, Math.min(sent, rawLost));
      const explicitSurvivors = finiteObservedNumber(compositionSurviving?.[unit]);
      const surviving = explicitSurvivors === null
        ? sent - lost
        : Math.max(0, Math.min(sent, Math.trunc(explicitSurvivors)));
      if (explicitSurvivors !== null && surviving + lost !== sent) anomaly = true;
      sentUnits += sent;
      lostUnits += lost;
      survivingUnits += surviving;
      capacitySent += sent * carry;
      capacityLost += lost * carry;
      capacitySurviving += surviving * carry;
    }
    if (!sawTransport || !(sentUnits > 0)) return unknown;
    const casualtyRate = clampNumber(lostUnits / sentUnits, 0, 1, 0);
    const capacityLossRate = capacitySent > 0
      ? clampNumber(capacityLost / capacitySent, 0, 1, 0)
      : null;
    return {
      transportSentUnits: sentUnits,
      transportLostUnits: lostUnits,
      transportSurvivingUnits: survivingUnits,
      transportCasualtyRate: casualtyRate,
      transportCapacitySent: capacitySent,
      transportCapacityLost: capacityLost,
      transportCapacitySurviving: capacitySurviving,
      transportCapacityLossRate: capacityLossRate,
      fullTransportWipe: sentUnits > 0 && survivingUnits === 0,
      lossSeverity: casualtyRate,
      lossSeveritySource: 'QUANTITATIVE_TRANSPORT',
      lossAnomaly: anomaly
    };
  }

  function observationLossSeverity(observation) {
    const quantitative = finiteObservedNumber(observation?.lossSeverity ?? observation?.transportCasualtyRate);
    if (quantitative !== null) return clampNumber(quantitative, 0, 1, 0);
    return observation?.hadLosses ? 1 : 0;
  }

  function roundTripHoursForComposition(composition, unitInfo, distance) {
    if (!composition || !unitInfo || !hasObservedNumber(distance)) return null;
    let slowest = 0;
    let totalUnits = 0;
    for (const [unit, countRaw] of Object.entries(composition)) {
      const count = Number(countRaw);
      if (!(count > 0)) continue;
      const speed = Number(unitInfo?.[unit]?.speed);
      if (!Number.isFinite(speed) || speed <= 0) return null;
      slowest = Math.max(slowest, speed);
      totalUnits += count;
    }
    if (!(slowest > 0) || !(totalUnits > 0)) return null;
    return 2 * Number(distance) * slowest / 60;
  }

  function unitHoursForComposition(composition, unitInfo, distance) {
    const trip = roundTripHoursForComposition(composition, unitInfo, distance);
    if (!Number.isFinite(trip)) return null;
    const count = Object.values(composition || {}).reduce((s, n) => s + Math.max(0, Number(n) || 0), 0);
    return trip * count;
  }

  function adaptivePendingExpiresAt(pending, c) {
    if (!pending || typeof pending !== 'object') return 0;
    const sentAt = Math.max(0, Number(pending.sentAt) || 0);
    if (!sentAt) return 0;
    const configured = sentAt + Math.max(1, Number(c?.pendingTimeoutHours) || 12) * 3600000;
    const returnBased = hasObservedNumber(pending.expectedReturnAt)
      ? Number(pending.expectedReturnAt) + 2 * 3600000
      : 0;
    const stored = Math.max(0, Number(pending.expiresAt) || 0);
    return Math.max(configured, returnBased, stored);
  }

  function adaptiveAttributionWindow(pending) {
    const expectedArrivalAt = finiteObservedNumber(pending?.expectedArrivalAt);
    if (expectedArrivalAt === null || !(expectedArrivalAt > 0)) return null;
    const sentAt = finiteObservedNumber(pending?.sentAt);
    const notBeforeAt = finiteObservedNumber(pending?.attributionNotBeforeAt);
    const expiresAt = finiteObservedNumber(pending?.attributionExpiresAt);
    const arrivalFloor = notBeforeAt !== null
      ? notBeforeAt
      : expectedArrivalAt - ADAPTIVE_REPORT_MATCH_EARLY_MS;
    return {
      expectedArrivalAt,
      notBeforeAt: sentAt !== null && sentAt > 0
        ? Math.max(sentAt - 2 * 60000, arrivalFloor)
        : arrivalFloor,
      expiresAt: expiresAt !== null
        ? expiresAt
        : expectedArrivalAt + ADAPTIVE_REPORT_MATCH_LATE_MS
    };
  }

  function compareAdaptiveIntegerReportIds(currentReportId, baselineReportId) {
    const normalize = value => {
      const text = String(value ?? '').trim();
      if (!/^\d+$/.test(text)) return null;
      return text.replace(/^0+(?=\d)/, '');
    };
    const current = normalize(currentReportId);
    const baseline = normalize(baselineReportId);
    if (current === null || baseline === null) return null;
    if (current.length !== baseline.length) return current.length > baseline.length ? 1 : -1;
    if (current === baseline) return 0;
    return current > baseline ? 1 : -1;
  }

  function adaptiveReportIdIsNewer(currentReportId, baselineReportId) {
    const current = String(currentReportId || '');
    const baseline = String(baselineReportId || '');
    if (!current) return false;
    if (!baseline) return true;
    const currentIsInteger = /^\d+$/.test(current);
    const baselineIsInteger = /^\d+$/.test(baseline);
    if (currentIsInteger !== baselineIsInteger) return false;

    const numericOrder = compareAdaptiveIntegerReportIds(current, baseline);
    return numericOrder === null ? current !== baseline : numericOrder > 0;
  }

  function adaptiveReportIdRelation(currentReportId, baselineReportId) {
    const current = String(currentReportId || '');
    const baseline = String(baselineReportId || '');
    if (!current || !baseline) return null;
    if (current === baseline) return 0;
    const numericOrder = compareAdaptiveIntegerReportIds(current, baseline);
    return numericOrder === null ? null : numericOrder;
  }

  function adaptiveReportAlreadyProcessed(farm, reportId) {
    const id = String(reportId || '');
    return Boolean(id && Array.isArray(farm?.processedReportIds) && farm.processedReportIds.includes(id));
  }

  function rememberAdaptiveReportId(farm, reportId) {
    const id = String(reportId || '');
    if (!farm || !id) return;
    const ledger = Array.isArray(farm.processedReportIds) ? farm.processedReportIds : [];
    farm.processedReportIds = [...new Set([...ledger, id])].slice(-32);
  }

  function advanceAdaptiveSeenReportId(farm, reportId) {
    const id = String(reportId || '');
    if (!farm || !id) return;
    const previous = String(farm.lastSeenReportId || '');
    const relation = adaptiveReportIdRelation(id, previous);
    if (!previous || relation === null || relation > 0) farm.lastSeenReportId = id;
    rememberAdaptiveReportId(farm, id);
  }

  function adaptiveReportQueueDecision(farm, row, modelCreatedAt, now = Date.now()) {
    const current = String(row?.reportId || '');
    if (!current) return { action: 'SKIP', priority: 0 };
    const seen = String(farm?.lastSeenReportId || '');
    const hasPending = Boolean(farm?.pendingDispatch);
    if (
      String(farm?.reportRetry?.reportId || '') === current &&
      Number(farm?.reportRetry?.nextAt || 0) > Number(now)
    ) return { action: 'RETRY_WAITING', priority: 0 };
    if (adaptiveReportAlreadyProcessed(farm, current)) {
      return { action: 'DUPLICATE', priority: 0 };
    }
    if (!seen) {
      const reportAt = finiteObservedNumber(row?.assistantAttackAt);
      const appearedAfterModelStart = reportAt !== null &&
        reportAt >= Number(modelCreatedAt || now);
      return hasPending || appearedAfterModelStart
        ? { action: 'CANDIDATE', priority: hasPending ? 3 : 1 }
        : { action: 'BASELINE', priority: 0 };
    }
    if (seen === current) return { action: 'CURRENT', priority: 0 };
    const relation = adaptiveReportIdRelation(current, seen);
    if (relation !== null && relation < 0) return { action: 'STALE', priority: 0 };
    return { action: 'CANDIDATE', priority: hasPending ? 3 : 1 };
  }

  function adaptiveCompositionMatches(expectedComposition, observedComposition) {
    if (!expectedComposition || !observedComposition) return null;
    const positive = composition => {
      const out = {};
      for (const [unit, rawCount] of Object.entries(composition || {})) {
        const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
        if (count > 0) out[String(unit)] = count;
      }
      return out;
    };
    const expected = positive(expectedComposition);
    const observed = positive(observedComposition);
    const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
    if (!keys.size) return null;
    for (const unit of keys) {
      if (Number(expected[unit] || 0) !== Number(observed[unit] || 0)) return false;
    }
    return true;
  }

  function matchingAdaptivePending(farm, timestamp, reportId, observedComposition = null) {
    const pending = farm?.pendingDispatch;
    const at = finiteObservedNumber(timestamp);
    const currentReportId = String(reportId || '');
    if (!pending || at === null || !currentReportId) return null;

    // IDs inteiros têm de ser estritamente posteriores ao baseline observado no
    // envio. Para formatos opacos mantém-se desigualdade conservadora; em ambos os
    // casos exige ainda janela curta e, quando disponível, composição coincidente.
    const reportIdAtSend = String(pending.reportIdAtSend || '');
    if (!adaptiveReportIdIsNewer(currentReportId, reportIdAtSend)) return null;

    const window = adaptiveAttributionWindow(pending);
    if (!window || at < window.notBeforeAt || at > window.expiresAt) return null;
    const compositionMatch = adaptiveCompositionMatches(pending.composition, observedComposition);
    if (compositionMatch === false) return null;
    return pending;
  }

  function observationFromReport(doc, row, farm, unitInfo, c, store = null) {
    const parsedTimestamp = finiteObservedNumber(row?.assistantAttackAt);
    const detailTimestamp = parsedTimestamp === null ? finiteObservedNumber(parseReportDetailTimestamp(doc)) : null;
    const timestamp = parsedTimestamp !== null && parsedTimestamp > 0
      ? parsedTimestamp
      : (detailTimestamp !== null && detailTimestamp > 0 ? detailTimestamp : null);
    const parsedComposition = parseReportComposition(doc);
    const hadPendingCandidate = Boolean(farm?.pendingDispatch);
    const pending = matchingAdaptivePending(farm, timestamp, row?.reportId, parsedComposition);
    const lateDispatch = !pending && store
      ? matchingExpiredAdaptiveDispatch(store, farm?.coord, timestamp, row?.reportId, parsedComposition, c)
      : null;
    const matchedDispatch = pending || lateDispatch;
    const composition = parsedComposition || matchedDispatch?.composition || null;
    const distance = finiteObservedNumber(farm.distance);
    const parsedLoot = parseReportLoot(doc);
    const remaining = parseReportRemainingResources(doc);
    const losses = parseReportLosses(doc);
    const survivingComposition = survivingCompositionAfterLosses(composition, losses);
    const survivingCapacity = transportCapacityForComposition(survivingComposition, unitInfo);
    const compositionCapacity = transportCapacityForComposition(composition, unitInfo);
    const shownCapacity = finiteObservedNumber(parsedLoot.capacityShown);
    const pendingCapacity = finiteObservedNumber(matchedDispatch?.capacity);
    // O denominador X/Y escrito pelo servidor é ground truth para ESTE report.
    // A composição atual de A/B nunca substitui a medição histórica do jogo.
    const capacity = shownCapacity !== null
      ? shownCapacity
      : (Number.isFinite(survivingCapacity)
          ? survivingCapacity
          : (Number.isFinite(compositionCapacity) ? compositionCapacity : pendingCapacity));
    const capacitySource = shownCapacity !== null
      ? 'REPORT'
      : (Number.isFinite(survivingCapacity)
          ? 'SURVIVORS'
          : (Number.isFinite(compositionCapacity) ? 'SENT' : (pendingCapacity !== null ? 'PENDING' : 'UNKNOWN')));
    const loot = finiteObservedNumber(parsedLoot.lootTotal);
    const rawEfficiency = Number.isFinite(loot) && Number.isFinite(capacity) && capacity > 0
      ? loot / capacity
      : null;
    const efficiency = rawEfficiency !== null
      ? clampNumber(rawEfficiency, 0, 1, null)
      : (row?.haul === 'full' ? 1 : null);
    // Só é anomalia quando o próprio report parece dizer X > Y. Uma diferença entre
    // o máximo do report e a nossa reconstrução é um mismatch diagnóstico, não um
    // motivo para corrigir ou limitar o ground truth do servidor.
    const capacityQuality = adaptiveCapacityExcessQuality(shownCapacity, loot);
    const capacityAnomalyAmount = capacityQuality.excess;
    const reconstructedCapacity = Number.isFinite(survivingCapacity)
      ? survivingCapacity
      : (Number.isFinite(compositionCapacity) ? compositionCapacity : null);
    const capacityMismatchAmount = shownCapacity !== null && reconstructedCapacity !== null
      ? shownCapacity - reconstructedCapacity
      : null;

    let stockObservation = { type: 'UNKNOWN', low: null, high: null, value: null };
    if (loot !== null && remaining !== null) {
      stockObservation = { type: 'EXACT', value: loot + remaining, low: loot + remaining, high: loot + remaining };
    } else if (Number.isFinite(loot) && Number.isFinite(capacity) && capacity > 0) {
      if (loot >= capacity) {
        stockObservation = { type: 'LOWER_BOUND', low: Math.max(capacity, loot), high: null, value: null };
      } else {
        stockObservation = { type: 'INTERVAL', low: Math.max(0, loot), high: capacity, value: null };
      }
    } else if (Number.isFinite(capacity) && capacity > 0) {
      if (row?.haul === 'full') stockObservation = { type: 'LOWER_BOUND', low: capacity, high: null, value: null };
      else if (row?.haul === 'partial') stockObservation = { type: 'INTERVAL', low: 0, high: capacity, value: null };
    }

    const evidenceRecognized = Boolean(
      parsedComposition ||
      loot !== null ||
      remaining !== null ||
      shownCapacity !== null ||
      losses !== null
    );
    const hadLosses = losses
      ? Object.values(losses).some(value => Number(value) > 0)
      : classify(row).kind === 'loss';
    const lossMetrics = transportLossMetrics(
      composition,
      survivingComposition,
      losses,
      unitInfo,
      hadLosses
    );
    const unitHours = finiteObservedNumber(matchedDispatch?.unitHours) ?? unitHoursForComposition(composition, unitInfo, distance);
    const attribution = matchedDispatch
      ? 'AUTO_MATCHED'
      : (hadPendingCandidate ? 'UNATTRIBUTED' : 'EXTERNAL');
    const reason = String(matchedDispatch?.reason || (attribution === 'EXTERNAL'
      ? 'OBSERVED_EXTERNAL'
      : 'OBSERVED_UNATTRIBUTED'));
    const prediction = matchedDispatch?.prediction || null;

    return {
      timestamp,
      reportId: String(row?.reportId || ''),
      composition,
      compositionSent: composition,
      compositionSurviving: survivingComposition,
      transportCapacity: Number.isFinite(capacity) ? capacity : null,
      reportCapacity: shownCapacity,
      reconstructedCapacity,
      sentCapacity: Number.isFinite(compositionCapacity) ? compositionCapacity : pendingCapacity,
      capacitySource,
      capacityMismatch: capacityMismatchAmount !== null && Math.abs(capacityMismatchAmount) >= 1,
      capacityMismatchAmount,
      lootTotal: loot,
      rawEfficiency,
      efficiency: Number.isFinite(efficiency) ? efficiency : null,
      capacityAnomalyAmount,
      capacityAdjusted: capacityQuality.adjusted,
      capacityAnomaly: capacityQuality.anomaly,
      remainingResources: Number.isFinite(remaining) ? remaining : null,
      stockObservation,
      losses,
      hadLosses,
      ...lossMetrics,
      distance,
      unitHours: Number.isFinite(unitHours) ? unitHours : null,
      reason,
      prediction,
      dispatchId: matchedDispatch?.dispatchId || null,
      attribution,
      pendingMatched: Boolean(pending),
      lateDispatchMatched: Boolean(lateDispatch),
      evidenceRecognized,
      source: 'report-detail'
    };
  }

  function observationFromAssistantSummary(row, farm, c) {
    const parsedTimestamp = finiteObservedNumber(row?.assistantAttackAt);
    const timestamp = parsedTimestamp !== null && parsedTimestamp > 0 ? parsedTimestamp : null;
    const pending = matchingAdaptivePending(farm, timestamp, row?.reportId);
    if (!pending) return null;
    const capacity = finiteObservedNumber(pending?.capacity);
    if (capacity === null || !(capacity > 0)) return null;
    const resultKind = classify(row).kind;
    if (!['full', 'clean', 'loss'].includes(resultKind)) return null;
    let stockObservation = { type: 'UNKNOWN', low: null, high: null, value: null };
    let efficiency = null;
    if (row?.haul === 'full') {
      stockObservation = { type: 'LOWER_BOUND', low: capacity, high: null, value: null };
      efficiency = 1;
    } else if (row?.haul === 'partial') {
      // "Saque parcial" não revela quanto foi realmente transportado nem prova
      // que o stock ficou a zero. Mantém apenas a censura [0, capacidade].
      stockObservation = { type: 'INTERVAL', low: 0, high: capacity, value: null };
      efficiency = null;
    }
    return {
      timestamp,
      reportId: String(row?.reportId || ''),
      composition: pending?.composition || null,
      compositionSent: pending?.composition || null,
      compositionSurviving: null,
      transportCapacity: capacity,
      reportCapacity: null,
      reconstructedCapacity: null,
      sentCapacity: capacity,
      capacitySource: 'PENDING',
      capacityMismatch: false,
      capacityMismatchAmount: null,
      lootTotal: null,
      rawEfficiency: efficiency,
      efficiency,
      capacityAnomalyAmount: 0,
      capacityAnomaly: false,
      remainingResources: null,
      stockObservation,
      losses: null,
      hadLosses: resultKind === 'loss',
      distance: finiteObservedNumber(farm.distance),
      unitHours: finiteObservedNumber(pending?.unitHours),
      reason: String(pending?.reason || 'OBSERVED_EXTERNAL'),
      prediction: pending?.prediction || null,
      dispatchId: pending?.dispatchId || null,
      attribution: 'AUTO_MATCHED',
      pendingMatched: true,
      evidenceRecognized: true,
      source: 'assistant-summary'
    };
  }

  function adaptiveReportIngestDecision(detailReadFailed, obs, farm) {
    const evidenceRecognized = Boolean(obs?.evidenceRecognized);
    const quantitativeEvidence = Boolean(
      obs && stockProxyFromObservation(obs, farm?.stockMean).reliability > 0
    );
    if (detailReadFailed) {
      return {
        shouldUpdate: false,
        synchronized: false,
        quantitativeEvidence,
        retryReason: 'READ_FAILED'
      };
    }
    return {
      shouldUpdate: evidenceRecognized,
      synchronized: evidenceRecognized,
      quantitativeEvidence,
      retryReason: evidenceRecognized ? null : 'PARSE_UNRECOGNIZED'
    };
  }

  function adaptivePendingCleanupAllowed(obs, ingestDecision) {
    return Boolean(ingestDecision?.synchronized && obs?.pendingMatched === true);
  }

  function adaptiveReportKey(sourceVillageId, reportId) {
    return `${String(sourceVillageId || 'unknown')}:${String(reportId || 'unknown')}`;
  }

  function adaptivePendingDispatchId(pending, villageId, coord) {
    if (!pending || typeof pending !== 'object') return null;
    const id = String(pending.dispatchId || adaptiveDispatchId(villageId, coord, pending.sentAt));
    pending.dispatchId = id;
    pending.sourceVillageId = String(pending.sourceVillageId || villageId || '');
    return id;
  }

  function adaptiveDispatchForPending(store, pending, villageId, coord) {
    const id = adaptivePendingDispatchId(pending, villageId, coord);
    const list = Array.isArray(store?.dispatches) ? store.dispatches : [];
    let dispatch = id ? list.find(item => String(item?.dispatchId || '') === id) : null;
    if (!dispatch) {
      const sentAt = Number(pending?.sentAt || 0);
      dispatch = list.find(item =>
        String(item?.targetCoord || item?.coord || '') === String(coord || '') &&
        Math.abs(Number(item?.sentAt ?? item?.at) - sentAt) <= 1000
      ) || null;
    }
    return dispatch;
  }

  function linkAdaptiveDispatchToReport(store, farm, obs, villageId) {
    if (!obs?.pendingMatched && !obs?.lateDispatchMatched) return null;
    const pending = obs.pendingMatched ? farm?.pendingDispatch : null;
    const dispatch = obs.lateDispatchMatched
      ? (store?.dispatches || []).find(item => String(item?.dispatchId || '') === String(obs.dispatchId || ''))
      : adaptiveDispatchForPending(store, pending, villageId, farm?.coord);
    if (!dispatch) return null;
    dispatch.dispatchId = pending
      ? adaptivePendingDispatchId(pending, villageId, farm.coord)
      : String(dispatch.dispatchId || obs.dispatchId || '');
    dispatch.sourceVillageId = String(villageId || '');
    dispatch.targetCoord = String(farm.coord || '');
    dispatch.coord = dispatch.targetCoord;
    dispatch.status = obs.lateDispatchMatched ? 'LATE_MATCHED' : 'MATCHED';
    dispatch.reportIdMatched = String(obs.reportId || '');
    dispatch.matchedAt = Date.now();
    dispatch.loot = finiteObservedNumber(obs.lootTotal);
    dispatch.observedCapacity = finiteObservedNumber(obs.transportCapacity);
    dispatch.capacityAnomalyAmount = Math.max(0, Number(obs.capacityAnomalyAmount) || 0);
    obs.dispatchId = dispatch.dispatchId;
    obs.attribution = 'AUTO_MATCHED';
    return dispatch;
  }

  function expireAdaptiveDispatchForPending(store, farm, villageId, now = Date.now()) {
    if (!farm?.pendingDispatch) return null;
    const dispatch = adaptiveDispatchForPending(store, farm.pendingDispatch, villageId, farm.coord);
    if (!dispatch || String(dispatch.status || '') === 'MATCHED') return dispatch;
    // Registos migrados sem uma janela de atribuição verificável nunca entram no
    // denominador de correlação, mesmo quando o pending antigo expira.
    if (String(dispatch.status || '') === 'LEGACY' || dispatch.trackable === false) {
      dispatch.status = 'LEGACY';
      dispatch.trackable = false;
      dispatch.expiredAt = Math.max(1, Number(now) || Date.now());
      return dispatch;
    }
    // Deixa de bloquear operações, mas permanece correlacionável dentro da janela
    // histórica quando um report tardio cumprir ID, tempo e composição.
    dispatch.status = 'EXPIRED_MATCHABLE';
    dispatch.trackable = true;
    dispatch.expiredAt = Math.max(1, Number(now) || Date.now());
    return dispatch;
  }

  function matchingExpiredAdaptiveDispatch(store, coord, timestamp, reportId, observedComposition, c) {
    const at = finiteObservedNumber(timestamp);
    const currentReportId = String(reportId || '');
    if (at === null || !currentReportId) return null;
    const cutoff = adaptiveHistoryCutoff(c, Date.now());
    const candidates = (store?.dispatches || [])
      .map(dispatch => normalizeAdaptiveDispatch(dispatch, dispatch?.sourceVillageId || ''))
      .filter(dispatch =>
        dispatch.trackable !== false &&
        String(dispatch.status || '') === 'EXPIRED_MATCHABLE' &&
        String(dispatch.targetCoord || '') === String(coord || '') &&
        Number(dispatch.sentAt || 0) >= cutoff &&
        adaptiveReportIdIsNewer(currentReportId, dispatch.reportIdAtSend)
      )
      .filter(dispatch => {
        const expectedArrivalAt = finiteObservedNumber(dispatch.expectedArrivalAt);
        const expectedReturnAt = finiteObservedNumber(dispatch.expectedReturnAt);
        const latest = expectedReturnAt !== null
          ? expectedReturnAt + 2 * 3600000
          : Number(dispatch.sentAt || 0) + Math.max(1, Number(c?.pendingTimeoutHours) || 12) * 3600000;
        if (expectedArrivalAt !== null && at < expectedArrivalAt - ADAPTIVE_REPORT_MATCH_EARLY_MS) return false;

        if (at > latest) return false;
        return adaptiveCompositionMatches(dispatch.composition, observedComposition) !== false;
      })
      .sort((a, b) => Math.abs(at - Number(a.expectedArrivalAt || a.sentAt)) - Math.abs(at - Number(b.expectedArrivalAt || b.sentAt)));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function recordAdaptiveReportLedger(store, obs, villageId, coord, ingestDecision, observationUpdated) {
    if (!store || !obs?.reportId || !ingestDecision?.synchronized) return null;
    const reportKey = adaptiveReportKey(villageId, obs.reportId);
    const list = Array.isArray(store.reportLedger) ? store.reportLedger : (store.reportLedger = []);
    const attribution = ADAPTIVE_ATTRIBUTIONS.includes(String(obs.attribution))
      ? String(obs.attribution)
      : adaptiveEventAttribution(obs);
    const frozen = obs?.prediction && typeof obs.prediction === 'object'
      ? obs.prediction
      : null;
    const entry = normalizeAdaptiveReportLedgerEntry({
      reportKey,
      sourceVillageId: String(villageId || ''),
      reportId: String(obs.reportId),
      targetCoord: String(coord || ''),
      observedAt: finiteObservedNumber(obs.timestamp),
      synchronizedAt: Date.now(),
      attribution,
      dispatchId: obs.dispatchId ? String(obs.dispatchId) : null,
      detailSource: String(obs.source || ''),
      detailState: REPORT_DETAIL_STATES.includes(String(obs.reportDetailState))
        ? String(obs.reportDetailState)
        : 'COMPLETE',
      evidenceType: String(obs.stockObservation?.type || 'UNKNOWN'),
      rawEvidenceVersion: 1,
      quantitative: Boolean(ingestDecision.quantitativeEvidence),
      qualitative: !ingestDecision.quantitativeEvidence,
      modelUpdated: Boolean(observationUpdated),
      loot: finiteObservedNumber(obs.lootTotal),
      reportCapacity: finiteObservedNumber(obs.reportCapacity),
      reconstructedCapacity: finiteObservedNumber(obs.reconstructedCapacity),
      sentCapacity: finiteObservedNumber(obs.sentCapacity),
      capacity: finiteObservedNumber(obs.transportCapacity),
      capacitySource: String(obs.capacitySource || 'UNKNOWN'),
      remainingResources: finiteObservedNumber(obs.remainingResources),
      stock: finiteObservedNumber(obs.stockObservation?.value),
      stockLow: finiteObservedNumber(obs.stockObservation?.low),
      stockHigh: finiteObservedNumber(obs.stockObservation?.high),
      rawEfficiency: finiteObservedNumber(obs.rawEfficiency),
      efficiency: finiteObservedNumber(obs.efficiency),
      compositionSent: obs.compositionSent || obs.composition || null,
      compositionSurviving: obs.compositionSurviving || null,
      losses: obs.losses || null,
      hadLosses: Boolean(obs.hadLosses),
      transportSentUnits: finiteObservedNumber(obs.transportSentUnits),
      transportLostUnits: finiteObservedNumber(obs.transportLostUnits),
      transportSurvivingUnits: finiteObservedNumber(obs.transportSurvivingUnits),
      transportCasualtyRate: finiteObservedNumber(obs.transportCasualtyRate),
      transportCapacitySent: finiteObservedNumber(obs.transportCapacitySent),
      transportCapacityLost: finiteObservedNumber(obs.transportCapacityLost),
      transportCapacitySurviving: finiteObservedNumber(obs.transportCapacitySurviving),
      transportCapacityLossRate: finiteObservedNumber(obs.transportCapacityLossRate),
      fullTransportWipe: Boolean(obs.fullTransportWipe),
      lossSeverity: finiteObservedNumber(obs.lossSeverity),
      lossSeveritySource: String(obs.lossSeveritySource || (obs.hadLosses ? 'QUALITATIVE' : 'NONE')),
      lossAnomaly: Boolean(obs.lossAnomaly),
      reason: String(obs.reason || (attribution === 'AUTO_MATCHED' ? 'EXPLOITATION' : 'OBSERVED_EXTERNAL')),
      predictedStock: finiteObservedNumber(frozen?.expectedStock),
      predictedLoot: finiteObservedNumber(frozen?.expectedLoot),
      predictedEfficiency: finiteObservedNumber(frozen?.expectedEfficiency),
      predictedFullProbability: finiteObservedNumber(frozen?.fullProbability),
      capacityMismatch: Boolean(obs.capacityMismatch),
      capacityMismatchAmount: finiteObservedNumber(obs.capacityMismatchAmount),
      capacityAnomalyAmount: Math.max(0, Number(obs.capacityAnomalyAmount) || 0),
      capacityAdjusted: Boolean(obs.capacityAdjusted),
      capacityAnomaly: Boolean(obs.capacityAnomaly)
    }, villageId);
    const index = list.findIndex(item => String(item?.reportKey || '') === reportKey);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    if (list.length > ADAPTIVE_REPORT_LEDGER_LIMIT) {
      list.splice(0, list.length - ADAPTIVE_REPORT_LEDGER_LIMIT);
    }
    return entry;
  }

  function adaptiveEvidenceFromLedgerEntry(report) {
    const r = normalizeAdaptiveReportLedgerEntry(report, report?.sourceVillageId || '');
    const evidenceAt = finiteObservedNumber(r.observedAt);
    const recordedAt = finiteObservedNumber(r.synchronizedAt);
    const rawReplay = Number(r.rawEvidenceVersion || 0) >= 1;
    return {
      at: evidenceAt,
      recordedAt: recordedAt !== null ? recordedAt : evidenceAt,
      reportId: r.reportId,
      stockType: r.evidenceType,
      stock: r.stock,
      stockLow: r.stockLow,
      stockHigh: r.stockHigh,
      // Entradas replayable levam apenas ground truth/autoritativo para o
      // modelo. Proxy, surpresa, concorrência e jackpot são recalculados depois
      // da ordenação cronológica, nunca copiados da ordem de descoberta.
      rawEvidenceVersion: rawReplay ? 1 : 0,
      stockProxy: rawReplay ? null : r.stockProxy,
      reliability: rawReplay ? null : r.reliability,
      capacity: r.capacity,
      reportCapacity: r.reportCapacity,
      reconstructedCapacity: r.reconstructedCapacity,
      sentCapacity: r.sentCapacity,
      capacitySource: r.capacitySource,
      capacityMismatch: r.capacityMismatch,
      capacityMismatchAmount: r.capacityMismatchAmount,
      loot: r.loot,
      remainingResources: r.remainingResources,
      rawEfficiency: r.rawEfficiency,
      efficiency: r.efficiency,
      attribution: r.attribution,
      dispatchId: r.dispatchId ? String(r.dispatchId) : null,
      surprise: rawReplay ? null : finiteObservedNumber(r.surprise),
      hadLosses: Boolean(r.hadLosses),
      transportSentUnits: r.transportSentUnits,
      transportLostUnits: r.transportLostUnits,
      transportSurvivingUnits: r.transportSurvivingUnits,
      transportCasualtyRate: r.transportCasualtyRate,
      transportCapacitySent: r.transportCapacitySent,
      transportCapacityLost: r.transportCapacityLost,
      transportCapacitySurviving: r.transportCapacitySurviving,
      transportCapacityLossRate: r.transportCapacityLossRate,
      fullTransportWipe: Boolean(r.fullTransportWipe),
      lossSeverity: r.lossSeverity,
      lossSeveritySource: r.lossSeveritySource,
      lossAnomaly: Boolean(r.lossAnomaly),
      jackpot: rawReplay ? false : Boolean(r.jackpot),
      competitionSignal: rawReplay ? null : (finiteObservedNumber(r.competitionSignal) || 0),
      reason: String(r.reason || (r.attribution === 'AUTO_MATCHED' ? 'EXPLOITATION' : 'OBSERVED_EXTERNAL')),
      predictedStock: finiteObservedNumber(r.predictedStock),
      predictedLoot: finiteObservedNumber(r.predictedLoot),
      predictedEfficiency: finiteObservedNumber(r.predictedEfficiency),
      predictedFullProbability: finiteObservedNumber(r.predictedFullProbability)
    };
  }

  function migrateAdaptiveLedgerEvidence(store, villageId) {
    const list = Array.isArray(store?.reportLedger) ? store.reportLedger : (store.reportLedger = []);
    const byKey = new Map(list.map((entry, index) => [String(entry?.reportKey || ''), index]));
    for (const [coord, raw] of Object.entries(store?.farms || {})) {
      const farm = normalizeAdaptiveFarm(raw, coord, raw?.distance);
      for (const evidence of farm.recent || []) {
        const reportId = String(evidence?.reportId || '');
        if (!reportId) continue;
        const reportKey = adaptiveReportKey(villageId, reportId);
        const migrated = normalizeAdaptiveReportLedgerEntry({
          reportKey,
          sourceVillageId: String(villageId || ''),
          reportId,
          targetCoord: coord,
          observedAt: finiteObservedNumber(evidence.at),
          synchronizedAt: finiteObservedNumber(evidence.recordedAt) || Date.now(),
          attribution: adaptiveEventAttribution(evidence),
          detailSource: 'migration-recent-v210',
          evidenceType: String(evidence.stockType || 'UNKNOWN'),
          quantitative: adaptiveRecentReliability(evidence) > 0,
          qualitative: !(adaptiveRecentReliability(evidence) > 0),
          modelUpdated: true,
          loot: finiteObservedNumber(evidence.loot),
          reportCapacity: finiteObservedNumber(evidence.reportCapacity),
          reconstructedCapacity: finiteObservedNumber(evidence.reconstructedCapacity),
          sentCapacity: finiteObservedNumber(evidence.sentCapacity),
          capacity: finiteObservedNumber(evidence.capacity),
          capacitySource: String(evidence.capacitySource || 'LEGACY'),
          remainingResources: finiteObservedNumber(evidence.remainingResources),
          stock: finiteObservedNumber(evidence.stock),
          stockLow: finiteObservedNumber(evidence.stockLow),
          stockHigh: finiteObservedNumber(evidence.stockHigh),
          stockProxy: finiteObservedNumber(evidence.stockProxy),
          reliability: finiteObservedNumber(evidence.reliability),
          rawEfficiency: finiteObservedNumber(evidence.rawEfficiency),
          efficiency: finiteObservedNumber(evidence.efficiency),
          hadLosses: Boolean(evidence.hadLosses),
          surprise: finiteObservedNumber(evidence.surprise),
          competitionSignal: finiteObservedNumber(evidence.competitionSignal),
          jackpot: Boolean(evidence.jackpot),
          reason: String(evidence.reason || ''),
          predictedStock: finiteObservedNumber(evidence.predictedStock),
          predictedLoot: finiteObservedNumber(evidence.predictedLoot),
          predictedEfficiency: finiteObservedNumber(evidence.predictedEfficiency),
          predictedFullProbability: finiteObservedNumber(evidence.predictedFullProbability)
        }, villageId);
        const index = byKey.get(reportKey);
        if (index === undefined) {
          byKey.set(reportKey, list.length);
          list.push(migrated);
        } else {
          const current = normalizeAdaptiveReportLedgerEntry(list[index], villageId);
          // A entrada v2.0.10 pode conter apenas telemetria mínima. O histórico por
          // farm é usado uma vez para completar a migração sem duplicar o report.
          list[index] = normalizeAdaptiveReportLedgerEntry({ ...migrated, ...current,
            loot: current.loot ?? migrated.loot,
            reportCapacity: current.reportCapacity ?? migrated.reportCapacity,
            reconstructedCapacity: current.reconstructedCapacity ?? migrated.reconstructedCapacity,
            sentCapacity: current.sentCapacity ?? migrated.sentCapacity,
            capacity: current.capacity ?? migrated.capacity,
            capacitySource: current.capacitySource !== 'UNKNOWN' ? current.capacitySource : migrated.capacitySource,
            stock: current.stock ?? migrated.stock,
            stockLow: current.stockLow ?? migrated.stockLow,
            stockHigh: current.stockHigh ?? migrated.stockHigh,
            stockProxy: current.stockProxy ?? migrated.stockProxy,
            reliability: current.reliability ?? migrated.reliability,
            remainingResources: current.remainingResources ?? migrated.remainingResources,
            rawEfficiency: current.rawEfficiency ?? migrated.rawEfficiency,
            efficiency: current.efficiency ?? migrated.efficiency,
            surprise: current.surprise ?? migrated.surprise,
            competitionSignal: current.competitionSignal || migrated.competitionSignal,
            reason: current.reason || migrated.reason
          }, villageId);
        }
      }
      store.farms[coord] = farm;
    }
    store.reportLedger = list.slice(-ADAPTIVE_REPORT_LEDGER_LIMIT);
    return store.reportLedger;
  }

  function rebuildAdaptiveFarmsFromLedger(store, c, villageId, now = Date.now()) {
    migrateAdaptiveLedgerEvidence(store, villageId);
    const byCoord = new Map();
    for (const raw of store.reportLedger || []) {
      const report = normalizeAdaptiveReportLedgerEntry(raw, villageId);
      if (!/^\d{3}\|\d{3}$/.test(report.targetCoord) || !report.quantitative) continue;
      if (!byCoord.has(report.targetCoord)) byCoord.set(report.targetCoord, []);
      byCoord.get(report.targetCoord).push(adaptiveEvidenceFromLedgerEntry(report));
    }
    for (const [coord, raw] of Object.entries(store.farms || {})) {
      const farm = normalizeAdaptiveFarm(raw, coord, raw?.distance);
      if (byCoord.has(coord)) {
        farm.recent = byCoord.get(coord)
          .sort((a, b) => Number(adaptiveEvidenceRecordedAt(a) || 0) - Number(adaptiveEvidenceRecordedAt(b) || 0))
          .slice(-ADAPTIVE_RECENT_PER_FARM_LIMIT);
      }
      recalcAdaptiveFarm(farm, store, c, now);
      store.farms[coord] = farm;
    }
    return store;
  }

  function adaptiveIngestRetryText(reason) {
    if (reason === 'READ_FAILED') return 'não foi possível abrir o detalhe do report';
    if (reason === 'PARSE_UNRECOGNIZED') return 'a página abriu, mas o formato do report não foi reconhecido';
    return 'o report ainda não pôde ser validado';
  }

  function stockProxyFromObservation(obs, priorMean) {
    const x = obs?.stockObservation || {};
    if (x.type === 'EXACT' && hasObservedNumber(x.value)) return { value: Number(x.value), reliability: 1.0 };
    if (x.type === 'LOWER_BOUND' && hasObservedNumber(x.low)) {
      return { value: null, reliability: 0.62, censored: true };
    }
    if (x.type === 'INTERVAL' && hasObservedNumber(x.high)) {
      return { value: null, reliability: 0.25, censored: true };
    }
    if (hasObservedNumber(obs?.efficiency) && hasObservedNumber(obs?.transportCapacity)) {
      return { value: null, reliability: 0.30, censored: true };
    }
    return { value: null, reliability: 0 };
  }

  function updateDepthFromObservation(farm, obs, weight) {
    const x = obs?.stockObservation || {};
    const syntheticEntry = {
      reportCapacity: obs?.reportCapacity,
      capacity: obs?.transportCapacity,
      reconstructedCapacity: obs?.reconstructedCapacity
    };
    for (const cap of adaptiveCapacityGridForFarm(farm, [...(farm?.recent || []), syntheticEntry])) {
      const d = farm.depth[String(cap)] || { a: 0.5, b: 0.5 };
      let success = null;
      if (x.type === 'EXACT' && hasObservedNumber(x.value)) success = Number(x.value) >= cap;
      else if (x.type === 'LOWER_BOUND' && hasObservedNumber(x.low) && Number(x.low) >= cap) success = true;
      else if (x.type === 'INTERVAL') {
        if (hasObservedNumber(x.low) && Number(x.low) >= cap) success = true;
        else if (hasObservedNumber(x.high) && Number(x.high) < cap) success = false;
      }
      if (success === true) d.a += weight;
      else if (success === false) d.b += weight;
      farm.depth[String(cap)] = d;
    }
  }

  function updateAdaptiveBelief(farm, obs, weight) {
    const fill = finiteObservedNumber(obs?.efficiency);
    if (fill === null) return;
    const w = Math.max(0.1, weight);
    if (fill >= 0.90) {
      farm.alpha += 1.0 * w;
      farm.badStreak = 0;
    } else if (fill >= 0.65) {
      farm.alpha += 0.65 * w;
      farm.beta += 0.35 * w;
      farm.badStreak = 0;
    } else if (fill >= 0.30) {
      farm.alpha += 0.25 * w;
      farm.beta += 0.75 * w;
      farm.badStreak += 1;
    } else {
      farm.beta += (1 + 0.40 * farm.badStreak) * w;
      farm.badStreak += 1;
    }
  }

  function updateAdaptiveObservation(store, farm, obs, c, villageId) {
    const observedAt = finiteObservedNumber(obs?.timestamp);
    const processedAt = Date.now();
    const modelAt = observedAt !== null ? observedAt : processedAt;
    const proxy = stockProxyFromObservation(obs, farm.stockMean);

    if (!(proxy.reliability > 0)) {
      // Um report real sem números úteis pode atualizar o risco qualitativo de perdas,
      // mas não cria stock=0, amostra, certainty, CUSUM ou métricas de previsão.
      farm.lossRisk = clampNumber(
        0.88 * Number(farm.lossRisk || 0) + 0.12 * observationLossSeverity(obs),
        0,
        1,
        0
      );
      addDiagnostic(
        'ADAPTIVO',
        `${farm.coord}: report sem informação quantitativa fiável.`,
        'report sincronizado, mas stock/belief/certainty não foram treinados',
        villageId
      );
      return false;
    }

    if (proxy.censored && !hasObservedNumber(proxy.value)) {
      addDiagnostic(
        'ADAPTIVO',
        `${farm.coord}: evidência quantitativa censurada preservada.`,
        'LOWER_BOUND/INTERVAL atualiza profundidade no replay; não foi inventado um stock pontual',
        villageId
      );
      return true;
    }

    // Para ataques planeados pelo v2, a previsão feita no momento do envio fica congelada
    // e é essa que mede o erro preditivo. Nunca recalcula retrospectivamente para "acertar".
    const frozen = obs?.prediction && typeof obs.prediction === 'object' ? obs.prediction : null;
    const liveBefore = predictAdaptiveFarm(farm, modelAt, store, c);
    const before = frozen && hasObservedNumber(frozen.expectedStock)
      ? {
          expectedStock: Number(frozen.expectedStock),
          sigma: hasObservedNumber(frozen.sigma) ? Number(frozen.sigma) : liveBefore.sigma,
          expectedLoot: hasObservedNumber(frozen.expectedLoot) ? Number(frozen.expectedLoot) : liveBefore.expectedLoot,
          expectedFill: hasObservedNumber(frozen.expectedEfficiency) ? Number(frozen.expectedEfficiency) : liveBefore.expectedFill
        }
      : liveBefore;
    const weight = proxy.reliability;

    const halfLifeMs = Math.max(12, Number(c.adaptiveHalfLifeHours) || 60) * 3600000;
    if (farm.lastModelUpdateAt) {
      const elapsedSinceModelUpdate = Math.max(0, processedAt - farm.lastModelUpdateAt);
      const decay = Math.pow(0.5, elapsedSinceModelUpdate / halfLifeMs);
      farm.effectiveSamples *= decay;
      farm.jackpotMemory *= Math.pow(0.5, elapsedSinceModelUpdate / (18 * 3600000));
    }

    const previousAt = Number(farm.lastObservationAt || 0);
    // Competition só pode nascer de um baseline quantitativo que ainda pertença à
    // janela configurada. Campos persistentes lifetime nunca reintroduzem história
    // já expirada como se fosse evidência nova.
    const competitionBaseline = latestAdaptiveCompetitionBaseline(
      farm,
      c,
      processedAt,
      observedAt
    );
    const previousCompetitionAt = finiteObservedNumber(competitionBaseline?.at);
    const previousRemaining = finiteObservedNumber(competitionBaseline?.remainingResources);

    if (observedAt !== null) {
      farm.previousObservationAt = previousAt;
      farm.lastObservationAt = observedAt;
      farm.visitedDay = currentDayKey(observedAt);
    }
    farm.observations += 1;
    farm.effectiveSamples += weight;
    farm.lastModelUpdateAt = processedAt;

    updateAdaptiveBelief(farm, obs, weight);
    updateDepthFromObservation(farm, obs, weight);

    const observedFill = finiteObservedNumber(obs.efficiency);
    const fill = observedFill === null ? null : clampNumber(observedFill, 0, 1, 0.5);
    if (observedAt !== null) {
      const alphaFast = 0.42 * weight;
      const alphaSlow = 0.10 * weight;
      const previousFastStock = finiteObservedNumber(farm.fastStock) ?? proxy.value;
      const previousSlowStock = finiteObservedNumber(farm.slowStock) ?? proxy.value;
      farm.fastStock = (1 - alphaFast) * previousFastStock + alphaFast * proxy.value;
      farm.slowStock = (1 - alphaSlow) * previousSlowStock + alphaSlow * proxy.value;

      if (fill !== null) {
        const previousFastFill = finiteObservedNumber(farm.fastFill) ?? fill;
        const previousSlowFill = finiteObservedNumber(farm.slowFill) ?? fill;

        farm.fastFill = (1 - alphaFast) * previousFastFill + alphaFast * fill;
        farm.slowFill = (1 - alphaSlow) * previousSlowFill + alphaSlow * fill;
      }
    }

    const prevMean = finiteObservedNumber(farm.stockMean) ?? proxy.value;
    const prevWeight = Number(farm.stockWeight || 0);
    const newWeight = prevWeight + weight;
    const delta = proxy.value - prevMean;
    const newMean = prevMean + (weight / Math.max(weight, newWeight)) * delta;
    const oldM2 = Math.max(0, Number(farm.stockVariance || 0) * Math.max(1, prevWeight));
    const newM2 = oldM2 + weight * delta * (proxy.value - newMean);
    farm.stockMean = newMean;
    farm.stockWeight = newWeight;
    farm.stockVariance = newM2 / Math.max(1, newWeight);

    if (observedAt !== null && fill !== null) {
      const hour = new Date(observedAt).getHours();
      for (let h = 0; h < 24; h++) {
        const dist = circularHourDistance(hour, h);
        const kernel = Math.exp(-(dist * dist) / (2 * 2.0 * 2.0));
        const w = weight * kernel;
        if (!(w > 0.005)) continue;
        const cell = farm.hourProfile[h];
        const nw = cell.w + w;
        cell.stock = (cell.stock * cell.w + proxy.value * w) / Math.max(Number.EPSILON, nw);
        cell.fill = (cell.fill * cell.w + fill * w) / Math.max(Number.EPSILON, nw);
        cell.w = nw;
      }

      if (previousAt > 0) {
        const restHours = Math.max(0, (observedAt - previousAt) / 3600000);
        const idx = adaptiveRestBucketIndex(restHours);
        const cell = farm.restProfile[idx];
        const nw = cell.w + weight;
        cell.stock = (cell.stock * cell.w + proxy.value * weight) / Math.max(Number.EPSILON, nw);
        cell.fill = (cell.fill * cell.w + fill * weight) / Math.max(Number.EPSILON, nw);
        cell.w = nw;
      }
    }

    let surprise = null;
    let extremeSurprise = false;
    if (observedAt !== null && hasObservedNumber(before.expectedStock)) {
      surprise = (proxy.value - before.expectedStock) / Math.max(30, before.sigma);
      farm.positiveCusum = Math.max(0, Number(farm.positiveCusum || 0) + surprise - 0.20);
      farm.negativeCusum = Math.min(0, Number(farm.negativeCusum || 0) + surprise + 0.20);
      extremeSurprise = Math.abs(surprise) > 2.4;
      if (extremeSurprise) {
        // A surpresa extrema tem precedência sobre CUSUM: o modelo acabou de provar que
        // estava mal calibrado e deve primeiro confirmar a mudança.
        farm.regime = 'POSSIBLE_CHANGE';
        farm.certaintyShock = Math.max(Number(farm.certaintyShock || 0), 0.30);
        farm.recheckByAt = observedAt + 60 * 60000;
      } else {
        farm.certaintyShock *= 0.55;
        farm.recheckByAt = 0;
        if (farm.positiveCusum > 2.2) farm.regime = 'IMPROVING';
        else if (farm.negativeCusum < -2.2) farm.regime = 'DETERIORATING';
        else if (
          farm.observations >= 3 &&
          farm.positiveCusum < 1.1 &&
          farm.negativeCusum > -1.1
        ) farm.regime = 'STABLE';
      }

      farm.volatilityScore = clampNumber(
        0.80 * Number(farm.volatilityScore || 0.5) + 0.20 * Math.min(2, Math.abs(surprise)),
        0,
        2,
        0.5
      );
    }

    farm.lossRisk = clampNumber(
      0.88 * Number(farm.lossRisk || 0) + 0.12 * observationLossSeverity(obs),
      0,
      1,
      0
    );

    const exactStock = obs?.stockObservation?.type === 'EXACT' ? Number(obs.stockObservation.value) : null;
    if (Number.isFinite(exactStock)) farm.lastKnownStock = exactStock;
    if (hasObservedNumber(obs.remainingResources)) farm.lastKnownRemaining = Number(obs.remainingResources);
    else if (obs?.stockObservation?.type === 'EXACT') farm.lastKnownRemaining = 0;

    const jackpot = Boolean(
      hasObservedNumber(obs.transportCapacity) &&
      hasObservedNumber(obs.lootTotal) &&
      hasObservedNumber(obs.remainingResources) &&
      Number(obs.lootTotal) >= Number(obs.transportCapacity) &&
      Number(obs.remainingResources) >= Number(obs.transportCapacity)
    );
    if (jackpot) {
      farm.jackpotMemory = clampNumber(Number(farm.jackpotMemory || 0) + 1.2, 0, 3, 0);
    }

    let competitionSignal = 0;
    if (
      previousRemaining !== null &&
      Number.isFinite(exactStock) &&
      previousCompetitionAt !== null &&
      observedAt !== null &&
      observedAt - previousCompetitionAt >= 30 * 60000
    ) {
      const expectedFloor = Math.max(
        previousRemaining,
        hasObservedNumber(before.expectedStock) ? Number(before.expectedStock) : 0
      ) * 0.75;
      if (exactStock < expectedFloor) {
        competitionSignal = 1;
        farm.competitionScore = clampNumber(farm.competitionScore + 0.18, 0, 1, 0);
      } else {
        competitionSignal = -1;
        farm.competitionScore = clampNumber(farm.competitionScore * 0.90, 0, 1, 0);
      }
    } else {
      farm.competitionScore = clampNumber(farm.competitionScore * 0.98, 0, 1, 0);
    }

    const evidenceEntry = {
      at: observedAt,
      recordedAt: processedAt,
      reportId: String(obs.reportId || ''),
      stockType: String(obs.stockObservation?.type || 'UNKNOWN'),
      stock: Number.isFinite(exactStock) ? exactStock : null,
      stockLow: hasObservedNumber(obs.stockObservation?.low) ? Number(obs.stockObservation.low) : null,
      stockHigh: hasObservedNumber(obs.stockObservation?.high) ? Number(obs.stockObservation.high) : null,
      stockProxy: hasObservedNumber(proxy.value) ? Number(proxy.value) : null,
      reliability: weight,
      capacity: hasObservedNumber(obs.transportCapacity) ? Number(obs.transportCapacity) : null,
      reportCapacity: hasObservedNumber(obs.reportCapacity) ? Number(obs.reportCapacity) : null,
      reconstructedCapacity: hasObservedNumber(obs.reconstructedCapacity) ? Number(obs.reconstructedCapacity) : null,
      sentCapacity: hasObservedNumber(obs.sentCapacity) ? Number(obs.sentCapacity) : null,
      capacitySource: String(obs.capacitySource || 'UNKNOWN'),
      capacityMismatch: Boolean(obs.capacityMismatch),
      capacityMismatchAmount: hasObservedNumber(obs.capacityMismatchAmount) ? Number(obs.capacityMismatchAmount) : null,
      loot: hasObservedNumber(obs.lootTotal) ? Number(obs.lootTotal) : null,
      remainingResources: hasObservedNumber(obs.remainingResources) ? Number(obs.remainingResources) : null,
      rawEfficiency: hasObservedNumber(obs.rawEfficiency) ? Number(obs.rawEfficiency) : null,
      efficiency: hasObservedNumber(obs.efficiency) ? Number(obs.efficiency) : null,
      capacityAnomalyAmount: Math.max(0, Number(obs.capacityAnomalyAmount) || 0),
      capacityAdjusted: Boolean(obs.capacityAdjusted),
      capacityAnomaly: Boolean(obs.capacityAnomaly),
      attribution: ADAPTIVE_ATTRIBUTIONS.includes(String(obs.attribution))
        ? String(obs.attribution)
        : adaptiveEventAttribution(obs),
      dispatchId: obs.dispatchId ? String(obs.dispatchId) : null,
      surprise,
      hadLosses: Boolean(obs.hadLosses),
      transportSentUnits: finiteObservedNumber(obs.transportSentUnits),
      transportLostUnits: finiteObservedNumber(obs.transportLostUnits),
      transportSurvivingUnits: finiteObservedNumber(obs.transportSurvivingUnits),
      transportCasualtyRate: finiteObservedNumber(obs.transportCasualtyRate),
      transportCapacitySent: finiteObservedNumber(obs.transportCapacitySent),
      transportCapacityLost: finiteObservedNumber(obs.transportCapacityLost),
      transportCapacitySurviving: finiteObservedNumber(obs.transportCapacitySurviving),
      transportCapacityLossRate: finiteObservedNumber(obs.transportCapacityLossRate),
      fullTransportWipe: Boolean(obs.fullTransportWipe),
      lossSeverity: observationLossSeverity(obs),
      lossSeveritySource: String(obs.lossSeveritySource || (obs.hadLosses ? 'QUALITATIVE' : 'NONE')),
      lossAnomaly: Boolean(obs.lossAnomaly),
      jackpot,
      competitionSignal,
      reason: String(obs.reason || 'OBSERVED_EXTERNAL')
    };
    if (frozen) {
      evidenceEntry.predictedStock = hasObservedNumber(frozen.expectedStock) ? Number(frozen.expectedStock) : null;
      evidenceEntry.predictedLoot = hasObservedNumber(frozen.expectedLoot) ? Number(frozen.expectedLoot) : null;
      evidenceEntry.predictedEfficiency = hasObservedNumber(frozen.expectedEfficiency) ? Number(frozen.expectedEfficiency) : null;
      evidenceEntry.predictedFullProbability = hasObservedNumber(frozen.fullProbability) ? Number(frozen.fullProbability) : null;
    }
    const evidenceKey = String(evidenceEntry.reportId || '');
    const existingEvidenceIndex = evidenceKey
      ? farm.recent.findIndex(entry => String(entry?.reportId || '') === evidenceKey)
      : -1;
    if (existingEvidenceIndex >= 0) farm.recent[existingEvidenceIndex] = evidenceEntry;
    else farm.recent.push(evidenceEntry);
    farm.recent = farm.recent
      .sort((a, b) => Number(adaptiveEvidenceRecordedAt(a) || 0) - Number(adaptiveEvidenceRecordedAt(b) || 0))
      .slice(-ADAPTIVE_RECENT_PER_FARM_LIMIT);

    recalcAdaptiveFarm(farm, store, c, processedAt);
    if (extremeSurprise) {
      farm.nextDueAt = Math.min(Number(farm.nextDueAt || Infinity), Number(farm.recheckByAt));
    }

    const event = {
      at: observedAt,
      recordedAt: processedAt,
      sourceVillageId: String(villageId || ''),
      reportId: String(obs.reportId || ''),
      dispatchId: obs.dispatchId ? String(obs.dispatchId) : null,
      attribution: ADAPTIVE_ATTRIBUTIONS.includes(String(obs.attribution))
        ? String(obs.attribution)
        : adaptiveEventAttribution(obs),
      coord: farm.coord,
      sector: farm.sector,
      distance: Number(farm.distance) || 0,
      capacity: hasObservedNumber(obs.transportCapacity) ? Number(obs.transportCapacity) : null,
      reportCapacity: hasObservedNumber(obs.reportCapacity) ? Number(obs.reportCapacity) : null,
      reconstructedCapacity: hasObservedNumber(obs.reconstructedCapacity) ? Number(obs.reconstructedCapacity) : null,
      sentCapacity: hasObservedNumber(obs.sentCapacity) ? Number(obs.sentCapacity) : null,
      capacitySource: String(obs.capacitySource || 'UNKNOWN'),
      capacityMismatch: Boolean(obs.capacityMismatch),
      capacityMismatchAmount: hasObservedNumber(obs.capacityMismatchAmount) ? Number(obs.capacityMismatchAmount) : null,
      loot: hasObservedNumber(obs.lootTotal) ? Number(obs.lootTotal) : null,
      rawEfficiency: hasObservedNumber(obs.rawEfficiency) ? Number(obs.rawEfficiency) : null,
      efficiency: hasObservedNumber(obs.efficiency) ? Number(obs.efficiency) : null,
      capacityAnomalyAmount: Math.max(0, Number(obs.capacityAnomalyAmount) || 0),
      capacityAdjusted: Boolean(obs.capacityAdjusted),
      capacityAnomaly: Boolean(obs.capacityAnomaly),
      unitHours: hasObservedNumber(obs.unitHours) ? Number(obs.unitHours) : null,
      full: hasObservedNumber(obs.efficiency) && Number(obs.efficiency) >= 0.995,
      hadLosses: Boolean(obs.hadLosses),
      transportCasualtyRate: finiteObservedNumber(obs.transportCasualtyRate),
      transportCapacityLossRate: finiteObservedNumber(obs.transportCapacityLossRate),
      fullTransportWipe: Boolean(obs.fullTransportWipe),
      lossSeverity: observationLossSeverity(obs),
      lossSeveritySource: String(obs.lossSeveritySource || (obs.hadLosses ? 'QUALITATIVE' : 'NONE')),
      lossAnomaly: Boolean(obs.lossAnomaly),
      stock: Number.isFinite(exactStock) ? exactStock : null,
      surprise,
      reason: String(obs.reason || 'OBSERVED_EXTERNAL'),
      source: String(obs.source || ''),
      predictedStock: hasObservedNumber(frozen?.expectedStock) ? Number(frozen.expectedStock) : null,
      predictedLoot: hasObservedNumber(frozen?.expectedLoot) ? Number(frozen.expectedLoot) : null,
      predictedEfficiency: hasObservedNumber(frozen?.expectedEfficiency) ? Number(frozen.expectedEfficiency) : null,
      predictedFullProbability: hasObservedNumber(frozen?.fullProbability) ? Number(frozen.fullProbability) : null
    };
    const eventIndex = event.reportId
      ? store.events.findIndex(existing =>
          String(existing?.sourceVillageId || '') === String(villageId || '') &&
          String(existing?.reportId || '') === String(event.reportId)
        )
      : -1;
    if (eventIndex >= 0) store.events[eventIndex] = event;
    else store.events.push(event);
    if (store.events.length > ADAPTIVE_EVENT_LIMIT) {
      store.events.splice(0, store.events.length - ADAPTIVE_EVENT_LIMIT);
    }

    if (event.capacityAnomaly) {
      addDiagnostic(
        'QUALIDADE',
        `${farm.coord}: leitura X/Y inconsistente no próprio report.`,
        `saque ${Math.round(Number(event.loot) || 0)} · máximo ${Math.round(Number(event.capacity) || 0)} · ` +
          `desvio ${Math.round(event.capacityAnomalyAmount)} acima da tolerância · report ${event.reportId || '—'}`,
        villageId
      );
    }

    if (obs.capacityMismatch) {
      addDiagnostic(
        'CAPACIDADE',
        `${farm.coord}: capacidade do report difere da reconstrução.`,
        `report ${Math.round(Number(obs.reportCapacity) || 0)} · reconstruída ${Math.round(Number(obs.reconstructedCapacity) || 0)} · ` +
          `diferença ${Number(obs.capacityMismatchAmount) >= 0 ? '+' : ''}${Math.round(Number(obs.capacityMismatchAmount) || 0)} · fonte usada REPORT`,
        villageId
      );
    }

    addDiagnostic(
      'ADAPTIVO',
      `${farm.coord}: ${obs.attribution || 'UNATTRIBUTED'} · ${obs.stockObservation?.type || 'UNKNOWN'}.`,
      `capacidade ${hasObservedNumber(obs.transportCapacity) ? Math.round(Number(obs.transportCapacity)) : '—'} (${obs.capacitySource || 'UNKNOWN'}) · ` +
        `${observedAt === null ? 'tempo desconhecido; sem treino temporal · ' : ''}` +
        `rating ${farm.farmRating.toFixed(0)} · certeza ${(farm.certainty * 100).toFixed(0)}% · regime ${farm.regime}`,
      villageId
    );
    return true;
  }

  async function ingestAdaptiveReports(rows, map, villageId, c) {
    const store = adaptiveStore(villageId);
    const operationalStates = states(villageId);
    let operationalStatesChanged = false;
    const ingestNow = Date.now();
    if (!(Number(store.createdAt) > 0)) store.createdAt = ingestNow;
    syncAdaptiveFarmsWithMap(store, map, villageId, c);
    migrateAdaptiveLedgerEvidence(store, villageId);
    const ingestRun = {
      at: ingestNow,
      rows: rows?.size || 0,
      candidates: 0,
      processed: 0,
      backlog: 0,
      baselines: 0,
      duplicates: 0,
      staleRows: 0,
      synchronized: 0,
      quantitative: 0,
      qualitativeOnly: 0,
      outOfOrder: 0,
      readFailed: 0,
      parseUnrecognized: 0,
      retryWaiting: 0,
      reportIndexRows: 0,
      reportIndexNew: 0,
      reportIndexPages: 0,
      operationalSynced: 0,
      lastDetailSuccessAt: 0,
      lastQuantitativeAt: 0,
      lastSynchronizedAt: 0
    };

    try {
      const indexResult = await scanAdaptiveReportIndex(store, map, villageId, c);
      ingestRun.reportIndexRows = indexResult.rowsRead;
      ingestRun.reportIndexNew = indexResult.added;
      ingestRun.reportIndexPages = indexResult.pagesRead;
    } catch (err) {
      if (err instanceof ReferenceError || err instanceof TypeError) throw err;
      if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429', 'LEASE_LOST'].includes(err?.code)) throw err;
      addDiagnostic(
        'INGESTÃO',
        'Índice de reports temporariamente indisponível.',
        `${err?.message || err} · o Assistente continua a ser processado e o índice será retomado noutra passagem`,
        villageId
      );
    }

    let unitInfo = null;
    try {
      unitInfo = await getFarmUnitEconomics(villageId);
    } catch (err) {
      if (err instanceof ReferenceError || err instanceof TypeError) throw err;
      if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429', 'LEASE_LOST'].includes(err?.code)) throw err;
      addDiagnostic('ADAPTIVO', 'Capacidade detalhada das unidades indisponível; reports usarão fallback.', err?.message || String(err), villageId);
    }

    for (const [coord, raw] of Object.entries(store.farms || {})) {
      const farm = normalizeAdaptiveFarm(raw, coord, raw?.distance);
      const expiresAt = adaptivePendingExpiresAt(farm.pendingDispatch, c);
      if (farm.pendingDispatch && expiresAt > 0 && expiresAt < ingestNow) {
        addDiagnostic(
          'ADAPTIVO',
          `${coord}: pendingDispatch adaptativo expirado.`,
          'a previsão antiga já não será associada a reports futuros; estado operacional permanece independente',
          villageId
        );
        expireAdaptiveDispatchForPending(store, farm, villageId, ingestNow);
        farm.pendingDispatch = null;
      }
      store.farms[coord] = farm;
    }

    const candidates = [];
    const candidateReportIds = new Set();
    let reportIndexState = normalizeAdaptiveReportIndex(store.reportIndex);
    const initiallyLedgeredIds = new Set((store.reportLedger || []).map(item => String(item?.reportId || '')).filter(Boolean));
    for (const [coord, row] of rows.entries()) {
      if (!row?.reportId) continue;
      reportIndexState = setReportDiscoveryState(reportIndexState, row.reportId, {
        targetCoord: coord,
        assistantAttackAt: finiteObservedNumber(row.assistantAttackAt),
        discoveredAt: ingestNow,
        state: initiallyLedgeredIds.has(String(row.reportId)) ? 'COMPLETE' : 'PENDING'
      });
      const farm = ensureAdaptiveFarm(store, coord, coordDistance(coord));
      const seen = String(farm.lastSeenReportId || '');
      const current = String(row.reportId);
      const queueDecision = adaptiveReportQueueDecision(farm, row, store.createdAt, ingestNow);
      if (queueDecision.action === 'RETRY_WAITING') {
        ingestRun.retryWaiting++;
        continue;
      }

      if (queueDecision.action === 'DUPLICATE') {
        ingestRun.duplicates++;
        advanceAdaptiveSeenReportId(farm, current);
        store.farms[coord] = farm;
        continue;
      }

      if (queueDecision.action === 'BASELINE') {
        advanceAdaptiveSeenReportId(farm, current);
        farm.reportRetry = null;
        ingestRun.baselines++;
        store.farms[coord] = farm;
        continue;
      }

      if (queueDecision.action === 'STALE') {
        ingestRun.staleRows++;
        addDiagnostic(
          'INGESTÃO',
          `${coord}: row antiga ignorada sem regredir o baseline.`,
          `report atual ${current} < sincronizado ${seen}`,
          villageId
        );
        continue;
      }

      if (queueDecision.action === 'CANDIDATE') {
        candidates.push({ coord, row, farm, priority: queueDecision.priority, source: 'assistant' });
        candidateReportIds.add(current);
      }
    }
    store.reportIndex = reportIndexState;


    const ledgerReportIds = new Set((store.reportLedger || []).map(item => String(item?.reportId || '')).filter(Boolean));
    const cleanBacklog = [];
    for (const queued of normalizeAdaptiveReportIndex(store.reportIndex).backlog) {
      if (ledgerReportIds.has(queued.reportId)) {
        store.reportIndex = setReportDiscoveryState(store.reportIndex, queued.reportId, {
          targetCoord: queued.targetCoord,
          state: 'COMPLETE'
        });
        continue;
      }
      cleanBacklog.push(queued);
      if (candidateReportIds.has(queued.reportId) || !map.has(queued.targetCoord)) continue;
      const farm = ensureAdaptiveFarm(store, queued.targetCoord, coordDistance(queued.targetCoord));
      if (
        String(farm?.reportRetry?.reportId || '') === queued.reportId &&
        Number(farm?.reportRetry?.nextAt || 0) > ingestNow
      ) {
        ingestRun.retryWaiting++;
        continue;
      }
      const row = {
        reportId: queued.reportId,
        assistantAttackAt: queued.assistantAttackAt,
        haul: 'unknown',
        dot: 'unknown'
      };
      candidates.push({
        coord: queued.targetCoord,
        row,
        farm,
        priority: farm.pendingDispatch ? 4 : 2,
        source: 'report-index'
      });
      candidateReportIds.add(queued.reportId);
    }
    store.reportIndex = normalizeAdaptiveReportIndex({ ...store.reportIndex, backlog: cleanBacklog });

    candidates.sort((a, b) => b.priority - a.priority);
    ingestRun.candidates = candidates.length;
    const limit = Math.max(1, Math.min(12, Math.trunc(Number(c.adaptiveReportFetchPerPass) || 4)));
    let processed = 0;

    for (const item of candidates) {
      if (processed >= limit) break;
      AntiBotGuard.assertSafe();
      renewLease(villageId);
      assertVillageContext(villageId);

      let obs = null;
      let detailReadFailed = false;
      let reportDetailState = 'COMPLETE';
      try {
        const doc = await fetchReportDetail(item.row.reportId, villageId);
        ingestRun.lastDetailSuccessAt = Date.now();
        obs = observationFromReport(doc, item.row, item.farm, unitInfo, c, store);
      } catch (err) {
        if (err instanceof ReferenceError || err instanceof TypeError) throw err;
        const failure = reportDetailFailureDisposition(err);
        if (failure.mustThrow) throw err;
        const confirmedUnavailable = failure.state === 'NOT_AVAILABLE_CONFIRMED';
        addDiagnostic(
          'ADAPTIVO',
          confirmedUnavailable
            ? `${item.coord}: detalhe do report ${item.row.reportId} confirmado indisponível.`
            : `${item.coord}: não foi possível ler o detalhe do report ${item.row.reportId}.`,
          confirmedUnavailable
            ? 'NOT_AVAILABLE_CONFIRMED · não será confundido com HTML estranho'
            : `${err?.message || err} · o report não será descartado nem treinará o modelo antes de uma leitura válida`,
          villageId
        );
        detailReadFailed = failure.retryable;
        reportDetailState = failure.state;
        if (detailReadFailed) ingestRun.readFailed++;
        obs = observationFromAssistantSummary(item.row, item.farm, c);
      }

      if (obs) obs.reportDetailState = reportDetailState;
      let ingestDecision = adaptiveReportIngestDecision(detailReadFailed, obs, item.farm);
      if (reportDetailState === 'NOT_AVAILABLE_CONFIRMED') {
        ingestDecision = {
          shouldUpdate: false,
          synchronized: true,
          evidenceRecognized: false,
          quantitativeEvidence: false,
          retryReason: null,
          reportDetailState
        };
      } else if (ingestDecision.retryReason === 'PARSE_UNRECOGNIZED') {
        reportDetailState = 'PARSE_UNKNOWN';
        if (obs) obs.reportDetailState = reportDetailState;
      }
      if (ingestDecision.synchronized && (obs?.pendingMatched || obs?.lateDispatchMatched)) {
        linkAdaptiveDispatchToReport(store, item.farm, obs, villageId);
      }
      let observationUpdated = false;
      if (obs && ingestDecision.shouldUpdate) {
        observationUpdated = updateAdaptiveObservation(store, item.farm, obs, c, villageId);
        if (observationUpdated) {
          ingestRun.quantitative++;
          ingestRun.lastQuantitativeAt = Date.now();
        } else if (ingestDecision.quantitativeEvidence) {
          ingestRun.outOfOrder++;
        } else {
          ingestRun.qualitativeOnly++;
        }
      }

      if (ingestDecision.synchronized) {
        recordAdaptiveReportLedger(
          store,
          obs,
          villageId,
          item.coord,
          ingestDecision,
          observationUpdated
        );
        if (syncOperationalStateFromReportObservation(
          operationalStates,
          item.coord,
          obs,
          c,
          Date.now(),
          villageId
        )) {
          operationalStatesChanged = true;
          ingestRun.operationalSynced++;
        }
        advanceAdaptiveSeenReportId(item.farm, item.row.reportId);
        item.farm.reportRetry = null;
        ingestRun.synchronized++;
        ingestRun.lastSynchronizedAt = Date.now();
        if (adaptivePendingCleanupAllowed(obs, ingestDecision)) {
          item.farm.pendingDispatch = null;
        }
        if (item.source === 'report-index') {
          store.reportIndex.backlog = store.reportIndex.backlog.filter(
            queued => String(queued.reportId) !== String(item.row.reportId)
          );
        }
        store.reportIndex = setReportDiscoveryState(store.reportIndex, item.row.reportId, {
          targetCoord: item.coord,
          assistantAttackAt: finiteObservedNumber(item.row.assistantAttackAt),
          state: reportDetailState === 'NOT_AVAILABLE_CONFIRMED'
            ? 'NOT_AVAILABLE_CONFIRMED'
            : 'COMPLETE'
        });
      } else {
        if (ingestDecision.retryReason === 'PARSE_UNRECOGNIZED') ingestRun.parseUnrecognized++;
        const previousAttempts = String(item.farm.reportRetry?.reportId || '') === String(item.row.reportId)
          ? Math.max(0, Number(item.farm.reportRetry?.attempts) || 0)
          : 0;
        const attempts = previousAttempts + 1;
        const retryMinutes = Math.min(60, 5 * Math.pow(2, Math.min(4, attempts - 1)));
        item.farm.reportRetry = {
          reportId: String(item.row.reportId),
          attempts,
          nextAt: Date.now() + retryMinutes * 60000,
          reason: ingestDecision.retryReason,
          state: reportDetailState
        };
        store.reportIndex = setReportDiscoveryState(store.reportIndex, item.row.reportId, {
          targetCoord: item.coord,
          assistantAttackAt: finiteObservedNumber(item.row.assistantAttackAt),
          state: reportDetailState === 'PARSE_UNKNOWN'
            ? 'PARSE_UNKNOWN'
            : 'RETRYABLE_READ_FAILURE'
        });
        addDiagnostic(
          'INGESTÃO',
          `${item.coord}: report preservado para nova tentativa.`,
          `${adaptiveIngestRetryText(ingestDecision.retryReason)} · volta a tentar em ${retryMinutes} min`,
          villageId
        );
      }
      store.farms[item.coord] = item.farm;
      processed++;
      ingestRun.processed++;
    }

    ingestRun.backlog = Math.max(
      0,
      ingestRun.retryWaiting + candidates.length - ingestRun.synchronized
    );
    store.reportIndex = normalizeAdaptiveReportIndex({
      ...store.reportIndex,
      detailsPending: Math.max(0, ingestRun.backlog)
    });

    // O ledger é a verdade persistente; o estado de cada farm é reconstruído em
    // ordem cronológica. Descobrir um report antigo mais tarde produz o mesmo modelo.
    rebuildAdaptiveFarmsFromLedger(store, c, villageId, Date.now());

    recordAdaptiveIngestRun(store, ingestRun);
    if (operationalStatesChanged) {
      requireStored(saveStates(operationalStates, villageId), 'estados operacionais derivados dos reports');
    }
    requireStored(saveAdaptiveStore(store, villageId), 'modelo adaptativo v2');
    RUNTIME.adaptiveSnapshotByVillage.delete(String(villageId));
    const completeness = reportCompletenessSummary(store.reportIndex, store.reportLedger);
    addDiagnostic(
      'INGESTÃO',
      `${ingestRun.synchronized}/${ingestRun.candidates} report(s) sincronizado(s) nesta passagem.`,
      `quantitativos ${ingestRun.quantitative} · qualitativos ${ingestRun.qualitativeOnly} · ` +
        `backlog ${ingestRun.backlog} · retry ${ingestRun.readFailed + ingestRun.parseUnrecognized + ingestRun.retryWaiting} · ` +
        `índice ${ingestRun.reportIndexPages} pág./${ingestRun.reportIndexRows} rows (+${ingestRun.reportIndexNew}) · ` +
        `estados atualizados ${ingestRun.operationalSynced} · ` +
        `baseline ${ingestRun.baselines} · duplicados/antigos ${ingestRun.duplicates + ingestRun.staleRows} · ` +
        `IDs descobertos ${completeness.discovered} · inexplicados ${completeness.unexplainedMissing}`,
      villageId
    );
  }

  function recordAdaptiveDispatch(item, composition, capacity, unitInfo, decision, villageId, template) {
    const c = cfg(villageId);
    const store = adaptiveStore(villageId);
    const farm = ensureAdaptiveFarm(store, item.coord, coordDistance(item.coord));
    const sentAt = Date.now();
    const farmDistance = finiteObservedNumber(farm.distance);
    const unitHours = unitHoursForComposition(composition, unitInfo, farmDistance);
    const roundTripHours = roundTripHoursForComposition(composition, unitInfo, farmDistance);
    const expectedArrivalAt = Number.isFinite(roundTripHours) ? sentAt + roundTripHours * 1800000 : null;
    const expectedReturnAt = Number.isFinite(roundTripHours) ? sentAt + roundTripHours * 3600000 : null;
    const attributionNotBeforeAt = Number.isFinite(expectedArrivalAt)
      ? expectedArrivalAt - ADAPTIVE_REPORT_MATCH_EARLY_MS
      : null;
    const attributionExpiresAt = Number.isFinite(expectedArrivalAt)
      ? expectedArrivalAt + ADAPTIVE_REPORT_MATCH_LATE_MS
      : null;
    const expectedReportNotBeforeAt = Number.isFinite(expectedArrivalAt)
      ? Math.max(sentAt, expectedArrivalAt)
      : sentAt + 5 * 60000;
    const expectedReportCheckAt = expectedReportNotBeforeAt + 2 * 60000;
    const expiresAt = Math.max(
      sentAt + Math.max(1, Number(c.pendingTimeoutHours) || 12) * 3600000,
      Number.isFinite(expectedReturnAt) ? expectedReturnAt + 2 * 3600000 : 0
    );
    const dispatchId = adaptiveDispatchId(villageId, item.coord, sentAt);
    const reportIdAtSend = item?.currentReportId || farm.lastSeenReportId || null;
    if (Number.isFinite(roundTripHours)) farm.lastOneWayTravelMs = roundTripHours * 1800000;

    farm.pendingDispatch = {
      dispatchId,
      sourceVillageId: String(villageId || ''),
      sentAt,
      expiresAt,
      reportIdAtSend,
      template: String(template || ''),
      composition: composition || null,
      capacity: hasObservedNumber(capacity) ? Number(capacity) : null,
      unitHours: Number.isFinite(unitHours) ? unitHours : null,
      expectedArrivalAt,
      expectedReturnAt,
      attributionNotBeforeAt,
      attributionExpiresAt,
      expectedReportNotBeforeAt,
      expectedReportCheckAt,
      reason: String(decision?.reason || 'LEGACY_ROTATION'),
      prediction: decision?.prediction || null,
      farmRatingAtSend: hasObservedNumber(decision?.farmRating) ? Number(decision.farmRating) : farm.farmRating,
      certaintyAtSend: hasObservedNumber(decision?.certainty) ? Number(decision.certainty) : farm.certainty
    };
    store.farms[item.coord] = farm;
    store.dispatches.push(normalizeAdaptiveDispatch({
      dispatchId,
      sourceVillageId: String(villageId || ''),
      targetCoord: item.coord,
      at: sentAt,
      sentAt,
      coord: item.coord,
      template: String(template || ''),
      composition: composition || null,
      capacity: farm.pendingDispatch.capacity,
      expectedArrivalAt,
      expectedReturnAt,
      attributionNotBeforeAt,
      attributionExpiresAt,
      expectedReportNotBeforeAt,
      expectedReportCheckAt,
      expiresAt,
      reportIdAtSend: reportIdAtSend ? String(reportIdAtSend) : null,
      reportIdMatched: null,
      matchedAt: 0,
      loot: null,
      observedCapacity: null,
      reason: farm.pendingDispatch.reason,
      prediction: farm.pendingDispatch.prediction,
      status: 'PENDING'
    }, villageId));
    if (store.dispatches.length > ADAPTIVE_DISPATCH_LIMIT) {
      store.dispatches.splice(0, store.dispatches.length - ADAPTIVE_DISPATCH_LIMIT);
    }
    if (c.adaptiveEnabled && String(decision?.reason || '') !== 'LEGACY_ROTATION') {
      store.allocationBudget = advanceAdaptiveAllocationBudget(
        store.allocationBudget,
        decision?.allocationClass || adaptiveAllocationClass(decision?.reason),
        sentAt
      );
    }
    requireStored(saveAdaptiveStore(store, villageId), 'registo do dispatch AutoFarm');
  }

  function adaptiveDecisionForTarget(item, composition, unitInfo, villageId, c) {
    const store = adaptiveStore(villageId);
    const farm = ensureAdaptiveFarm(store, item.coord, coordDistance(item.coord));
    const now = Date.now();
    const templateContext = buildAdaptiveTemplateContext(composition, unitInfo);
    const evaluation = item?.adaptiveExecution || adaptiveExecutionEvaluation(
      farm,
      store,
      c,
      now,
      templateContext,
      adaptiveContextStats(store, c, now)
    );
    const capacity = evaluation.capacity;
    const capacityAuthoritative = Boolean(evaluation.capacityAuthoritative);
    const expectedArrivalAt = evaluation.expectedArrivalAt;
    const prediction = evaluation.prediction;
    const expectedLoot = evaluation.expectedLoot;
    const expectedEfficiency = evaluation.expectedEfficiency;
    const fullProbability = evaluation.fullProbability;
    const unitHours = evaluation.unitHours;
    const economicValue = evaluation.contextEconomicValue;
    const reason = item.adaptiveReason || adaptiveReason(farm, now, c);
    const economicNorm = capacityAuthoritative && Number.isFinite(economicValue)
      ? clampNumber(economicValue / Math.max(1, evaluation.planningCapacity), 0, 1.5, 0)
      : null;
    const dispatchRating = capacityAuthoritative
      ? clampNumber(
          62 * expectedEfficiency +
          28 * economicNorm +
          10 * (1 - farm.lossRisk),
          0,
          100,
          50
        )
      : null;

    return {
      reason,
      timing: item.adaptiveTiming || 'DUE',
      allocationClass: item.adaptiveAllocationClass || adaptiveAllocationClass(reason),
      bootstrapFairnessForced: Boolean(item.adaptiveBootstrapForced),
      farmRating: farm.farmRating,
      certainty: farm.certainty,
      priority: Number(item.adaptiveScore) || 0,
      capacity: capacityAuthoritative ? capacity : null,
      capacityAuthoritative,
      expectedLoot,
      expectedEfficiency,
      economicValue,
      baseEconomicValue: evaluation.economicValue,
      contextWeight: evaluation.contextWeight,
      distanceWeight: evaluation.distanceWeight,
      arrivalHourWeight: evaluation.arrivalHourWeight,
      dispatchRating,
      expectedArrivalAt,
      prediction: {
        at: prediction.at,
        expectedStock: prediction.expectedStock,
        stockKnown: prediction.stockKnown,
        sigma: prediction.sigma,
        expectedLoot,
        expectedEfficiency,
        predictedEfficiencyForCapacity: expectedEfficiency,
        fullProbability
      }
    };
  }

  function adaptiveDispatchGate(decision, configuredMinEfficiency, informationProbe = false) {
    // Timing EARLY e dívida de coverage nunca furam por si sós o gate económico.
    // A dívida proporcional evita starvation sem transformar nenhum bucket numa
    // autorização económica absoluta. Uma farm desconhecida continua explorável
    // pelo limiar reduzido enquanto tiver baixa certeza.
    const mustProbe = false;
    const minEfficiency = informationProbe
      ? Math.min(0.25, Number(configuredMinEfficiency) || 0.45)
      : clampNumber(configuredMinEfficiency, 0.10, 0.95, 0.45);
    const minRating = informationProbe ? 25 : Math.max(35, minEfficiency * 100);
    const mature = Number(decision?.certainty || 0) >= 0.35;
    const lowEfficiency = hasObservedNumber(decision?.expectedEfficiency) &&
      Number(decision.expectedEfficiency) < minEfficiency;
    const lowDispatchRating = hasObservedNumber(decision?.dispatchRating) &&
      Number(decision.dispatchRating) < minRating;
    return {
      // MAX_UNSEEN é uma obrigação de observação, não uma recomendação económica.
      // As guardas operacionais duras já foram verificadas antes deste gate.
      rejected: mature && (lowEfficiency || lowDispatchRating),
      bypassedForCoverage: false,
      bypassedForBootstrap: false,
      bypassedForRotation: false,
      mustProbe,
      mature,
      lowEfficiency,
      lowDispatchRating,
      minEfficiency,
      minRating
    };

  }

  function adaptiveEconomicAggregate(list) {
    const valid = (Array.isArray(list) ? list : []).filter(entry =>
      hasObservedNumber(entry?.loot) &&
      hasObservedNumber(entry?.capacity) &&
      Number(entry.capacity) > 0
    );
    const loot = valid.reduce((sum, entry) => sum + Number(entry.loot), 0);
    const capacity = valid.reduce((sum, entry) => sum + Number(entry.capacity), 0);
    const creditedLoot = valid.reduce(
      (sum, entry) => sum + Math.min(Number(entry.loot), Number(entry.capacity)),
      0
    );
    const unused = valid.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.capacity) - Number(entry.loot)),
      0
    );
    const excess = valid.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.loot) - Number(entry.capacity)),
      0
    );
    return {
      reports: valid.length,
      loot,
      capacity,
      creditedLoot,
      unused,
      excess,
      adjustments: valid.filter(entry => Boolean(entry.capacityAdjusted)).length,
      anomalies: valid.filter(entry => Boolean(entry.capacityAnomaly)).length,
      efficiency: capacity > 0 ? clampNumber(creditedLoot / capacity, 0, 1, null) : null,
      resourcesPerReport: valid.length ? loot / valid.length : null
    };
  }

  function adaptiveEconomicRecordsFromStore(store, villageId) {
    const source = String(villageId || '');
    const byKey = new Map();
    for (const raw of Array.isArray(store?.reportLedger) ? store.reportLedger : []) {
      const report = normalizeAdaptiveReportLedgerEntry(raw, source);
      const record = normalizeAdaptiveEvent({
        ...report,
        sourceVillageId: report.sourceVillageId || source,
        coord: report.targetCoord,
        at: report.observedAt,
        recordedAt: report.synchronizedAt,
        stockType: report.evidenceType,
        full: hasObservedNumber(report.efficiency) ? Number(report.efficiency) >= 0.995 : false
      }, source);
      byKey.set(report.reportKey, record);
    }
    (Array.isArray(store?.events) ? store.events : []).forEach((raw, index) => {
      const event = normalizeAdaptiveEvent(raw, source);
      const key = event.reportId
        ? adaptiveReportKey(event.sourceVillageId || source, event.reportId)
        : `${source}:legacy-event:${event.coord || 'unknown'}:${event.at || 0}:${event.recordedAt || 0}:${index}`;
      const ledger = byKey.get(key);
      byKey.set(key, ledger ? normalizeAdaptiveEvent({
        ...ledger,
        ...event,
        reportCapacity: event.reportCapacity ?? ledger.reportCapacity,
        reconstructedCapacity: event.reconstructedCapacity ?? ledger.reconstructedCapacity,
        sentCapacity: event.sentCapacity ?? ledger.sentCapacity,
        capacity: event.capacity ?? ledger.capacity,
        loot: event.loot ?? ledger.loot,
        at: event.at ?? ledger.at,
        recordedAt: event.recordedAt ?? ledger.recordedAt
      }, source) : event);
    });
    return [...byKey.values()];
  }

  function adaptiveGlobalSummary(store, villageId, c) {
    const now = Date.now();
    const today = currentDayKey(now);
    const historyDays = adaptiveHistoryDays(c);
    const historyCutoff = adaptiveHistoryCutoff(c, now);
    const activeFarms = Object.values(store.farms || {})
      .map(raw => normalizeAdaptiveFarm(raw, raw?.coord || '', raw?.distance))
      .filter(f => f.active);
    const learningTarget = Math.max(1, Math.trunc(Number(c?.adaptiveLearningTargetObservations) || 3));
    const modelLearning = {
      target: learningTarget,
      noData: activeFarms.filter(f => !(Number(f.observations) > 0)).length,
      learning: activeFarms.filter(f => Number(f.observations) > 0 && Number(f.observations) < learningTarget).length,
      established: activeFarms.filter(f => Number(f.observations) >= learningTarget).length
    };

    const historyEvents = adaptiveEconomicRecordsFromStore(store, villageId)
      .filter(e => {
      const evidenceAt = adaptiveEvidenceRecordedAt(e);
      return evidenceAt !== null && evidenceAt >= historyCutoff && evidenceAt <= now + 5 * 60000;
    });
    const timedHistoryEvents = historyEvents.filter(e => hasObservedNumber(e.at));
    const events = timedHistoryEvents.filter(e =>
      e && hasObservedNumber(e.at) && currentDayKey(Number(e.at)) === today
    );
    const valid = events.filter(e => hasObservedNumber(e.loot) && hasObservedNumber(e.capacity) && Number(e.capacity) > 0);
    const historicalValid = timedHistoryEvents.filter(e =>
      hasObservedNumber(e.loot) && hasObservedNumber(e.capacity) && Number(e.capacity) > 0
    );
    const autoEvents = events.filter(e => e.attribution === 'AUTO_MATCHED');
    const externalEvents = events.filter(e => e.attribution === 'EXTERNAL');
    const unattributedEvents = events.filter(e => e.attribution === 'UNATTRIBUTED');
    const autoValid = valid.filter(e => e.attribution === 'AUTO_MATCHED');
    const externalValid = valid.filter(e => e.attribution === 'EXTERNAL');
    const unattributedValid = valid.filter(e => e.attribution === 'UNATTRIBUTED');
    const probes = autoValid.filter(e => ['BOOTSTRAP_NEW', 'EXPLORATION', 'LEARNING', 'EARLY_ROTATION', 'FORCED_COVERAGE'].includes(String(e.reason)));
    const historicalProbes = historicalValid.filter(e =>
      e.attribution === 'AUTO_MATCHED' &&
      ['BOOTSTRAP_NEW', 'EXPLORATION', 'LEARNING', 'EARLY_ROTATION', 'FORCED_COVERAGE'].includes(String(e.reason))
    );
    const observedEconomic = adaptiveEconomicAggregate(valid);
    const autoEconomic = adaptiveEconomicAggregate(autoValid);
    const externalEconomic = adaptiveEconomicAggregate(externalValid);
    const unattributedEconomic = adaptiveEconomicAggregate(unattributedValid);
    const probeEconomic = adaptiveEconomicAggregate(probes);
    const totalLoot = observedEconomic.loot;
    const totalCapacity = observedEconomic.capacity;
    const unitHours = valid.reduce((s, e) => s + (hasObservedNumber(e.unitHours) ? Number(e.unitHours) : 0), 0);
    const fullRate = valid.length ? valid.filter(e => e.full).length / valid.length : 0;
    const avgCertainty = activeFarms.length
      ? activeFarms.reduce((s, f) => s + Number(f.certainty || 0), 0) / activeFarms.length
      : 0;

    const unusedCapacity = observedEconomic.unused;

    const windowStats = hours => {
      const cutoff = now - hours * 3600000;
      const list = historicalValid.filter(e => Number(e.at) > cutoff);
      const probeList = historicalProbes.filter(e => Number(e.at) > cutoff);
      const economic = adaptiveEconomicAggregate(list);
      const probe = adaptiveEconomicAggregate(probeList);
      const surprises = list.filter(e => hasObservedNumber(e.surprise)).map(e => Number(e.surprise));
      return {
        hours,
        commands: list.length,
        loot: economic.loot,
        capacity: economic.capacity,
        excess: economic.excess,
        adjustments: economic.adjustments,
        anomalies: economic.anomalies,
        efficiency: economic.efficiency,
        probeEfficiency: probe.efficiency,
        fullRate: list.length ? list.filter(e => e.full).length / list.length : null,
        averageSurprise: surprises.length ? surprises.reduce((a, b) => a + b, 0) / surprises.length : null
      };
    };
    const windows = {
      h1: windowStats(1),
      h3: windowStats(3),
      h6: windowStats(6),
      h24: windowStats(24)
    };

    const accuracyEvents = historicalValid.filter(e =>
      e.attribution === 'AUTO_MATCHED' && (
        hasObservedNumber(e.predictedLoot) ||
        hasObservedNumber(e.predictedStock) ||
        hasObservedNumber(e.predictedEfficiency) ||
        hasObservedNumber(e.predictedFullProbability)
      )
    );
    const lootErrors = accuracyEvents
      .filter(e => hasObservedNumber(e.predictedLoot) && hasObservedNumber(e.loot))
      .map(e => Math.abs(Number(e.loot) - Number(e.predictedLoot)));
    const stockErrors = accuracyEvents
      .filter(e => hasObservedNumber(e.predictedStock) && hasObservedNumber(e.stock))
      .map(e => Math.abs(Number(e.stock) - Number(e.predictedStock)));
    const brierTerms = accuracyEvents
      .filter(e => hasObservedNumber(e.predictedFullProbability) && hasObservedNumber(e.efficiency))
      .map(e => {
        const p = clampNumber(Number(e.predictedFullProbability), 0, 1, 0.5);
        const y = Number(e.efficiency) >= 0.995 ? 1 : 0;
        return (p - y) * (p - y);
      });
    const predictionAccuracy = {
      samples: accuracyEvents.length,
      lootSamples: lootErrors.length,
      stockSamples: stockErrors.length,
      brierSamples: brierTerms.length,
      maeLoot: lootErrors.length ? lootErrors.reduce((a, b) => a + b, 0) / lootErrors.length : null,
      maeStock: stockErrors.length ? stockErrors.reduce((a, b) => a + b, 0) / stockErrors.length : null,
      brierFull: brierTerms.length ? brierTerms.reduce((a, b) => a + b, 0) / brierTerms.length : null
    };

    const recent1hAll = historicalValid.filter(e => Number(e.at) > now - 3600000);
    const base6hAll = historicalValid.filter(e => Number(e.at) > now - 6 * 3600000);
    const recent1hProbe = historicalProbes.filter(e => Number(e.at) > now - 3600000);
    const base6hProbe = historicalProbes.filter(e => Number(e.at) > now - 6 * 3600000);
    const eff = list => adaptiveEconomicAggregate(list).efficiency;
    // Map Mood usa probes quando há amostra suficiente, reduzindo sampling bias.
    const moodRecent = recent1hProbe.length >= 2 ? recent1hProbe : recent1hAll;
    const moodBase = base6hProbe.length >= 4 ? base6hProbe : base6hAll;
    const eff1 = eff(moodRecent);
    const eff6 = eff(moodBase);
    const delta = Number.isFinite(eff1) && Number.isFinite(eff6) ? eff1 - eff6 : 0;
    let mood = 'NORMAL';
    if (delta >= 0.18) mood = 'VERY HOT';
    else if (delta >= 0.08) mood = 'HOT';
    else if (delta <= -0.18) mood = 'VERY COLD';
    else if (delta <= -0.08) mood = 'COLD';

    const maxUnseenMs = Math.max(6, Number(c.adaptiveMaxUnseenHours) || 24) * 3600000;
    let fresh = 0, due = 0, overdue = 0, unseenToday = 0;
    for (const f of activeFarms) {
      if (f.visitedDay !== today) unseenToday++;
      if (!f.lastObservationAt) {
        overdue++;
      } else if (now - f.lastObservationAt >= maxUnseenMs) {
        overdue++;
      } else if (Number(f.nextDueAt || 0) <= now + 2 * 3600000) {
        due++;
      } else {
        fresh++;
      }
    }

    const ratings = { F5: 0, F4: 0, F3: 0, F2: 0, F1F0: 0 };
    for (const f of activeFarms) {
      const r = Number(f.farmRating || 0);
      if (r >= 80) ratings.F5++;
      else if (r >= 65) ratings.F4++;
      else if (r >= 50) ratings.F3++;
      else if (r >= 35) ratings.F2++;
      else ratings.F1F0++;
    }

    const certaintyBins = { high: 0, medium: 0, low: 0 };
    for (const f of activeFarms) {
      if (f.certainty >= 0.66) certaintyBins.high++;
      else if (f.certainty >= 0.33) certaintyBins.medium++;
      else certaintyBins.low++;
    }

    const hourBins = Array.from({ length: 24 }, (_, hour) => {
      const list = historicalValid.filter(e => new Date(Number(e.at)).getHours() === hour);
      const economic = adaptiveEconomicAggregate(list);
      return {
        hour,
        efficiency: economic.efficiency,
        count: list.length,
        adjustments: economic.adjustments,
        anomalies: economic.anomalies,
        excess: economic.excess
      };
    });

    const distanceDefs = [
      { label: '0-3', min: 0, max: 3 },
      { label: '3-5', min: 3, max: 5 },
      { label: '5-7', min: 5, max: 7 },
      { label: '7-10', min: 7, max: 10 },
      { label: '10+', min: 10, max: Infinity }
    ];
    const distanceBins = distanceDefs.map(def => {
      const list = historicalValid.filter(e => Number(e.distance) >= def.min && Number(e.distance) < def.max);
      const economic = adaptiveEconomicAggregate(list);
      const hours = list.reduce((s, e) => s + (hasObservedNumber(e.unitHours) ? Number(e.unitHours) : 0), 0);
      return {
        label: def.label,
        efficiency: economic.efficiency,
        resourcesPerUnitHour: hours > 0 ? economic.loot / hours : null,
        count: list.length,
        adjustments: economic.adjustments,
        anomalies: economic.anomalies,
        excess: economic.excess
      };
    });

    const normalizedDispatches = (store.dispatches || [])
      .map(dispatch => normalizeAdaptiveDispatch(dispatch, villageId));
    const dispatchesToday = normalizedDispatches.filter(dispatch =>
      Number(dispatch.sentAt) > 0 && currentDayKey(Number(dispatch.sentAt)) === today
    );
    const trackableDispatches = dispatchesToday.filter(dispatch => dispatch.trackable !== false);
    const matchedDispatches = trackableDispatches.filter(dispatch => ['MATCHED', 'LATE_MATCHED'].includes(dispatch.status));
    const pendingDispatches = dispatchesToday.filter(dispatch => dispatch.status === 'PENDING');
    const expiredDispatches = dispatchesToday.filter(dispatch => ['EXPIRED', 'EXPIRED_MATCHABLE'].includes(dispatch.status));
    const legacyDispatches = dispatchesToday.filter(dispatch => dispatch.trackable === false);
    const inFlight = normalizedDispatches.filter(d => Number(d.expectedReturnAt) > now);
    const return30 = inFlight.filter(d => Number(d.expectedReturnAt) <= now + 30 * 60000).length;
    const return60 = inFlight.filter(d => Number(d.expectedReturnAt) > now + 30 * 60000 && Number(d.expectedReturnAt) <= now + 60 * 60000).length;

    const reportLedger = (store.reportLedger || [])
      .map(report => normalizeAdaptiveReportLedgerEntry(report, villageId));
    const reportsToday = reportLedger.filter(report =>
      Number(report.observedAt) > 0 && currentDayKey(Number(report.observedAt)) === today
    );
    const reportsWithoutTimeToday = reportLedger.filter(report =>
      !(Number(report.observedAt) > 0) &&
      Number(report.synchronizedAt) > 0 &&
      currentDayKey(Number(report.synchronizedAt)) === today
    );
    const capacityMismatchesToday = reportsToday.filter(report => report.capacityMismatch).length;
    const reportsByKey = new Map();
    events.forEach((event, index) => {
      const key = event.reportId
        ? adaptiveReportKey(event.sourceVillageId || villageId, event.reportId)
        : `${villageId}:event:${event.coord || 'unknown'}:${event.at || 0}:${index}`;
      reportsByKey.set(key, event);
    });
    for (const report of reportsToday) {
      if (!reportsByKey.has(report.reportKey)) reportsByKey.set(report.reportKey, report);
    }
    const reportRecordsToday = [...reportsByKey.values()];
    const reportIsQuantitative = report => Boolean(
      report?.quantitative === true ||
      (hasObservedNumber(report?.loot) && hasObservedNumber(report?.capacity) && Number(report.capacity) > 0)
    );
    const reportCounts = {
      total: reportRecordsToday.length,
      quantitative: reportRecordsToday.filter(reportIsQuantitative).length,
      qualitative: reportRecordsToday.filter(report => !reportIsQuantitative(report)).length,
      auto: reportRecordsToday.filter(report => report.attribution === 'AUTO_MATCHED').length,
      external: reportRecordsToday.filter(report => report.attribution === 'EXTERNAL').length,
      unattributed: reportRecordsToday.filter(report => report.attribution === 'UNATTRIBUTED').length,
      withoutTime: reportsWithoutTimeToday.length
    };
    const recentReports = [...reportLedger]
      .sort((a, b) => Number(b.observedAt || b.synchronizedAt) - Number(a.observedAt || a.synchronizedAt))
      .slice(0, 12)
      .map(report => ({
        reportId: report.reportId,
        coord: report.targetCoord,
        at: report.observedAt || report.synchronizedAt,
        attribution: report.attribution,
        loot: report.loot,
        reportCapacity: report.reportCapacity,
        reconstructedCapacity: report.reconstructedCapacity,
        capacity: report.capacity,
        capacitySource: report.capacitySource,
        efficiency: report.efficiency,
        stock: report.stock,
        stockLow: report.stockLow,
        stockHigh: report.stockHigh,
        capacityMismatch: report.capacityMismatch
      }));

    const executor = {
      sent: dispatchesToday.length,
      matched: matchedDispatches.length,
      pending: pendingDispatches.length,
      expired: expiredDispatches.length,
      legacy: legacyDispatches.length,
      trackable: trackableDispatches.length,
      correlationRate: trackableDispatches.length
        ? matchedDispatches.length / trackableDispatches.length
        : null
    };

    const top = [...activeFarms]
      .sort((a, b) => Number(b.farmRating) - Number(a.farmRating))
      .slice(0, 10)
      .map(f => ({
        coord: f.coord,
        rating: f.farmRating,
        belief: f.beliefGood,
        certainty: f.certainty,
        trend: f.trend,
        regime: f.regime,
        observations: f.observations,
        effectiveSamples: f.effectiveSamples,
        lastObservationAt: f.lastObservationAt,
        expectedStock: f.expectedStock,
        nextDueAt: f.nextDueAt
      }));

    return {
      farms: activeFarms.length,
      storeRevision: Math.max(0, Math.trunc(Number(store?.revision) || 0)),
      storeUpdatedAt: Math.max(0, Number(store?.updatedAt) || 0),
      historyDays,
      observationsHistory: historyEvents.length,
      observationsToday: events.length,
      observationsWithKnownLoot: valid.length,
      totalLoot,
      totalCapacity,
      unusedCapacity,
      excessCapacity: observedEconomic.excess,
      capacityAnomalies: observedEconomic.anomalies,
      strategyEfficiency: autoEconomic.efficiency,
      observedEfficiency: observedEconomic.efficiency,
      probeEfficiency: probeEconomic.efficiency,
      resourcesPerCommand: valid.length ? totalLoot / valid.length : null,
      resourcesPerUnitHour: unitHours > 0 ? totalLoot / unitHours : null,
      fullRate,
      avgCertainty,
      modelLearning,
      mood,
      moodDelta: delta,
      windows,
      predictionAccuracy,
      coverage: { fresh, due, overdue, unseenToday },
      ratings,
      certaintyBins,
      hourBins,
      distanceBins,
      allocation: { inFlight: inFlight.length, return30, return60 },

      telemetry: {
        auto: autoEconomic,
        external: externalEconomic,
        unattributed: unattributedEconomic,
        observed: observedEconomic,
        executor,
        reports: reportCounts,
        capacityMismatches: capacityMismatchesToday,
        retryBacklog: Math.max(0, Number(store?.ingestHealth?.last?.backlog) || 0)
      },
      reportIndex: normalizeAdaptiveReportIndex(store?.reportIndex),
      reportCompleteness: reportCompletenessSummary(store?.reportIndex, store?.reportLedger),
      network: networkLedgerSummary(villageId),
      ingestHealth: normalizeAdaptiveIngestHealth(store?.ingestHealth),
      bootstrapFairness: normalizeBootstrapFairness(store?.bootstrapFairness),
      allocationBudget: normalizeAdaptiveAllocationBudget(store?.allocationBudget),
      allocationPolicy: adaptiveAllocationQuotas(store, c, now),
      recentReports,
      top
    };
  }

  function adaptiveAccountRollupFromStores(items, now = Date.now()) {
    const today = currentDayKey(now);
    const dispatchById = new Map();
    const reportByKey = new Map();
    const economicByKey = new Map();
    const perVillage = [];

    for (const item of Array.isArray(items) ? items : []) {
      const villageId = String(item?.villageId || '');
      const store = item?.store && typeof item.store === 'object' ? item.store : {};
      const dispatches = (Array.isArray(store.dispatches) ? store.dispatches : [])
        .map(dispatch => normalizeAdaptiveDispatch(dispatch, villageId))
        .filter(dispatch => Number(dispatch.sentAt) > 0 && currentDayKey(Number(dispatch.sentAt)) === today);
      const reports = (Array.isArray(store.reportLedger) ? store.reportLedger : [])
        .map(report => normalizeAdaptiveReportLedgerEntry(report, villageId))
        .filter(report => Number(report.observedAt) > 0 && currentDayKey(Number(report.observedAt)) === today);
      const events = (Array.isArray(store.events) ? store.events : [])
        .map(event => normalizeAdaptiveEvent(event, villageId))
        .filter(event => Number(event.at) > 0 && currentDayKey(Number(event.at)) === today);
      const economicRecords = adaptiveEconomicRecordsFromStore(store, villageId)
        .filter(record => Number(record.at) > 0 && currentDayKey(Number(record.at)) === today);

      for (const dispatch of dispatches) dispatchById.set(dispatch.dispatchId, dispatch);
      for (const report of reports) reportByKey.set(report.reportKey, report);
      economicRecords.forEach((record, index) => {
        const key = record.reportId
          ? adaptiveReportKey(record.sourceVillageId || villageId, record.reportId)
          : `${villageId}:legacy-event:${record.coord || 'unknown'}:${record.at || 0}:${record.recordedAt || 0}:${index}`;
        economicByKey.set(key, record);
      });

      const villageTrackable = dispatches.filter(dispatch => dispatch.trackable !== false);
      const economic = adaptiveEconomicAggregate(economicRecords);
      perVillage.push({
        villageId,
        sent: dispatches.length,
        matched: villageTrackable.filter(dispatch => ['MATCHED', 'LATE_MATCHED'].includes(dispatch.status)).length,
        trackable: villageTrackable.length,
        reports: economicRecords.length,
        loot: economic.loot
      });
    }

    const dispatches = [...dispatchById.values()];
    const reports = [...reportByKey.values()];
    const economicRecords = [...economicByKey.values()];
    const autoReports = economicRecords.filter(report => report.attribution === 'AUTO_MATCHED');
    const externalReports = economicRecords.filter(report => report.attribution === 'EXTERNAL');
    const unattributedReports = economicRecords.filter(report => report.attribution === 'UNATTRIBUTED');
    const trackableDispatches = dispatches.filter(dispatch => dispatch.trackable !== false);
    const matched = trackableDispatches.filter(dispatch => ['MATCHED', 'LATE_MATCHED'].includes(dispatch.status)).length;
    const legacy = dispatches.filter(dispatch => dispatch.trackable === false).length;
    const trackable = trackableDispatches.length;
    return {
      villages: perVillage.filter(item => item.sent || item.reports).length,
      sent: dispatches.length,
      matched,
      pending: dispatches.filter(dispatch => dispatch.status === 'PENDING').length,
      expired: dispatches.filter(dispatch => ['EXPIRED', 'EXPIRED_MATCHABLE'].includes(dispatch.status)).length,
      legacy,
      trackable,
      correlationRate: trackable ? matched / trackable : null,
      reports: Math.max(reports.length, economicRecords.length),
      auto: adaptiveEconomicAggregate(autoReports),
      external: adaptiveEconomicAggregate(externalReports),
      unattributed: adaptiveEconomicAggregate(unattributedReports),
      observed: adaptiveEconomicAggregate(economicRecords),
      perVillage
    };
  }

  function adaptiveAccountRollup(currentId, currentStore, now = Date.now()) {
    const byVillage = new Map([[String(currentId || ''), currentStore || {}]]);
    try {
      const prefix = `twaf59:${location.host}:p${playerId()}:v`;
      const suffix = ':adaptiveV2';
      for (let i = 0; i < Number(localStorage.length || 0); i++) {
        const key = String(localStorage.key(i) || '');
        if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
        const villageId = key.slice(prefix.length, -suffix.length);
        if (!villageId || villageId === String(currentId || '')) continue;
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          byVillage.set(villageId, parsed);
        }
      }
    } catch (_) {}
    return adaptiveAccountRollupFromStores(
      [...byVillage.entries()].map(([villageId, store]) => ({ villageId, store })),
      now
    );
  }

  function adaptiveDashboardSnapshot(villageId = currentVillageId()) {
    const c = cfg(villageId);
    const now = Date.now();
    const cached = RUNTIME.adaptiveSnapshotByVillage.get(String(villageId));
    if (
      cached?.summary &&
      now - Number(cached.computedAt || 0) < 10000
    ) return cached.summary;
    const store = adaptiveStore(villageId);
    const summary = adaptiveGlobalSummary(store, villageId, c);
    summary.account = adaptiveAccountRollup(villageId, store, now);
    RUNTIME.adaptiveSnapshotByVillage.set(String(villageId), {
      revision: Number(store.revision) || 0,
      computedAt: now,
      summary
    });
    return summary;
  }

  function fmtAdaptivePercent(value) {
    return hasObservedNumber(value)
      ? `${(clampNumber(Number(value), 0, 1, 0) * 100).toFixed(0)}%`
      : '—';
  }

  function fmtAdaptiveNumber(value) {
    if (!hasObservedNumber(value)) return '—';
    return Math.round(Number(value)).toLocaleString('pt-PT');
  }

  function adaptiveNextDueText(at) {
    const t = Number(at);
    if (!(t > 0)) return 'agora';
    const delta = t - Date.now();
    if (delta <= 0) return 'agora';
    if (delta < 3600000) return `em ${Math.ceil(delta / 60000)}m`;
    return `em ${(delta / 3600000).toFixed(1)}h`;
  }

  // ---------------------------------------------------------------------------
  // RELATÓRIOS / COOLDOWNS
  // ---------------------------------------------------------------------------

  function defaultTargetState() {
    return {
      pending: false,
      sending: false,
      sendingBootstrap: false,
      sendAttemptAt: 0,
      reportIdAtSend: null,
      lastReportId: null,
      cooldownUntil: 0,
      sentAt: 0,
      assistantEverSeen: false,
      bootstrapAttemptedAt: 0,
      lastResult: 'new',
      lastReason: ''
    };
  }

  function classify(row) {
    if (!row) return { kind: 'unknown', reason: 'sem linha no Assistente' };

    // Amarelo = vitória com perdas; vermelho e combinações também são tratados
    // como perdas. O objetivo é ser conservador independentemente do template A/B.
    if (['yellow', 'red_yellow', 'red', 'red_blue'].includes(row.dot)) {
      return { kind: 'loss', reason: `relatório ${row.dot}` };
    }

    if (row.haul === 'partial') {
      return { kind: 'clean', reason: 'saque parcial' };
    }

    if (row.haul === 'full') {
      return { kind: 'full', reason: 'saque cheio' };
    }

    return { kind: 'unknown', reason: 'resultado não classificado' };
  }

  function cooldownFor(resultKind, c) {
    switch (resultKind) {
      case 'clean': return c.cleanCooldownMin * 60000;
      case 'full': return c.fullCooldownMin * 60000;
      case 'loss': return c.lossCooldownMin * 60000;
      default: return c.unknownCooldownMin * 60000;
    }
  }

  function reliableAssistantAttackAt(row, now) {
    const attackAt = Number(row?.assistantAttackAt || 0);
    return (
      Number.isFinite(attackAt) &&
      attackAt > 0 &&
      attackAt <= now + 5 * 60000
    ) ? attackAt : null;
  }

  function cooldownBaseAt(row, st, now, allowOwnSendFallback = false) {
    const attackAt = reliableAssistantAttackAt(row, now);
    if (attackAt) return attackAt;

    if (allowOwnSendFallback) {
      const sentAt = Number(st?.sentAt || st?.sendAttemptAt || 0);
      if (Number.isFinite(sentAt) && sentAt > 0 && sentAt <= now + 5 * 60000) {
        return sentAt;
      }
    }

    return null;
  }

  function applyObservedResult(st, row, result, c, now, options = {}) {
    const ownSend = Boolean(options.ownSend);
    const baseAt = cooldownBaseAt(row, st, now, ownSend);

    st.lastResult = result.kind;
    st.lastReason = result.reason;
    st.lastObservedReportAt = now;
    st.assistantAttackAt = Number(row?.assistantAttackAt || 0) || 0;
    st.assistantAttackRaw = String(row?.assistantAttackRaw || '');
    st.assistantAttackTimeSource = String(row?.assistantAttackTimeSource || 'unavailable');
    if (reliableAssistantAttackAt(row, now)) {
      st.cooldownParserVersion = COOLDOWN_PARSER_VERSION;
    }

    if (baseAt) {
      st.lastReportAt = baseAt;
      st.cooldownUntil = baseAt + cooldownFor(result.kind, c);
      st.cooldownSource = reliableAssistantAttackAt(row, now)
        ? 'assistant-time'
        : 'own-send-time';
    } else {
      // Para histórico/relatórios externos sem hora fiável, atualiza o baseline
      // mas não inventa um cooldown novo contado desde o momento da descoberta.
      st.lastReportAt = Number(st.lastReportAt || 0);
      st.cooldownSource = 'baseline-only';
    }

    if (options.villageId && options.coord) {
      const until = Number(st.cooldownUntil || 0);
      const temporal = st.cooldownSource === 'assistant-time'
        ? `${st.assistantAttackRaw || 'hora do Assistente'} → ${clockTime(baseAt)}`
        : (st.cooldownSource === 'own-send-time'
            ? `fallback envio próprio → ${clockTime(baseAt)}`
            : `sem hora fiável (${st.assistantAttackTimeSource})`);
      addDiagnostic(
        'COOLDOWN',
        `${options.coord}: ${result.kind}.`,
        `${temporal} · termina ${until > 0 ? clockTime(until) : 'sem cooldown temporal'} · fonte ${st.cooldownSource}`,
        options.villageId
      );
    }

    return st;
  }

  function operationalResultFromReportObservation(obs) {
    if (!obs || typeof obs !== 'object') return null;
    if (obs.hadLosses) {
      return { kind: 'loss', reason: 'perdas confirmadas no detalhe do report' };
    }

    const loot = finiteObservedNumber(obs.lootTotal);
    const capacity = finiteObservedNumber(obs.transportCapacity);
    if (loot !== null && capacity !== null && capacity > 0) {
      return loot >= capacity
        ? { kind: 'full', reason: 'saque cheio confirmado no detalhe do report' }
        : { kind: 'clean', reason: 'saque parcial confirmado no detalhe do report' };
    }

    if (Number(obs.efficiency) === 1 || String(obs.stockObservation?.type || '') === 'LOWER_BOUND') {
      return { kind: 'full', reason: 'saque cheio confirmado pelo report' };
    }
    return null;
  }

  function syncOperationalStateFromReportObservation(
    stateByCoord,
    coord,
    obs,
    c,
    now = Date.now(),
    villageId = currentVillageId()
  ) {
    if (!stateByCoord || !coord || !obs?.reportId) return false;
    const result = operationalResultFromReportObservation(obs);
    if (!result) return false;

    const currentReportId = String(obs.reportId || '');
    const st = { ...defaultTargetState(), ...(stateByCoord[coord] || {}) };
    const matchedOwnDispatch = Boolean(obs.pendingMatched || obs.lateDispatchMatched);

    // Um report manual/externo não pode consumir o pending operacional de um POST
    // nosso. Só uma correlação completa (ID + chegada + composição, quando existe)
    // tem autoridade para o confirmar.
    if ((st.pending || st.sending) && !matchedOwnDispatch) return false;

    const previousReportId = String(st.lastReportId || '');
    if (previousReportId) {
      if (currentReportId === previousReportId) return false;
      const relation = adaptiveReportIdRelation(currentReportId, previousReportId);
      if (relation !== null && relation < 0) return false;
      if (relation === null && !matchedOwnDispatch) return false;
    }

    if (matchedOwnDispatch) {
      st.pending = false;
      st.sending = false;
      st.sendingBootstrap = false;
      st.sendAttemptAt = 0;
      st.reportIdAtSend = null;
    } else {
      st.lastExternalReportAt = now;
    }

    st.lastReportId = currentReportId;
    st.assistantEverSeen = true;
    const reportAt = finiteObservedNumber(obs.timestamp);
    const row = {
      assistantAttackAt: reportAt !== null ? reportAt : 0,
      assistantAttackRaw: reportAt !== null ? formatDateTime(reportAt) : '',
      assistantAttackTimeSource: reportAt !== null ? 'report-detail' : 'unavailable'
    };
    applyObservedResult(st, row, result, c, now, {
      ownSend: matchedOwnDispatch,
      villageId,
      coord
    });
    stateByCoord[coord] = st;
    return true;
  }

  function reportPredatesPendingSend(row, st) {
    const attackAt = Number(row?.assistantAttackAt || 0);
    const sentAt = Number(st?.sentAt || st?.sendAttemptAt || 0);

    if (!Number.isFinite(attackAt) || attackAt <= 0) return false;
    if (!Number.isFinite(sentAt) || sentAt <= 0) return false;

    // Tolerância para arredondamentos/segundos não mostrados no Assistente.
    return attackAt < sentAt - 2 * 60000;
  }

  function applyReportUpdates(rows, now, villageId, targets, pendingTimeoutMsOverride = null) {
    const c = cfg(villageId);
    const s = states(villageId);
    const targetList = Array.isArray(targets) ? targets : targetCoords(villageId);
    let changed = false;

    for (const coord of targetList) {
      const st = { ...defaultTargetState(), ...(s[coord] || {}) };

      // Compatibilidade/memória: qualquer relatório antigo prova que esta coordenada
      // já esteve no Assistente, mesmo que venha de uma versão anterior.
      if (!st.assistantEverSeen && st.lastReportId) {
        st.assistantEverSeen = true;
        s[coord] = st;
        changed = true;
      }

      // Se a página/aba caiu depois de gravar "sending" mas antes de confirmar a resposta,
      // assume resultado incerto e espera pelo relatório em vez de repetir o ataque.
      if (st.sending && st.sendAttemptAt) {
        st.sending = false;
        st.pending = true;
        st.sentAt = st.sentAt || st.sendAttemptAt;
        if (st.sendingBootstrap) {
          st.bootstrapAttemptedAt = st.bootstrapAttemptedAt || st.sendAttemptAt;
        }
        st.sendingBootstrap = false;
        st.lastResult = 'send-uncertain-recovery';
        st.lastReason = 'envio interrompido antes da confirmação';
        s[coord] = st;
        changed = true;
      }

      const row = rows.get(coord);

      // Ver uma row, mesmo sem relatório, é suficiente para distinguir "farm conhecida"
      // de "primeiro farm". Isto persiste no localStorage entre versões/reloads.
      if (row && !st.assistantEverSeen) {
        st.assistantEverSeen = true;
        s[coord] = st;

        changed = true;
      }

      if (!row?.reportId) continue;

      // Migração 1.5.5: estados gravados por versões anteriores podem ter o MESMO
      // reportId mas um cooldown calculado sem a hora correta do Assistente. Se agora
      // temos uma hora fiável, recalcula uma vez sem apagar histórico/pending/bootstrap.
      if (
        !st.pending &&
        st.lastReportId &&
        String(row.reportId) === String(st.lastReportId) &&
        Number(st.cooldownParserVersion || 0) < COOLDOWN_PARSER_VERSION &&
        reliableAssistantAttackAt(row, now)
      ) {
        const previousUntil = Number(st.cooldownUntil || 0);
        const result = classify(row);
        applyObservedResult(st, row, result, c, now, { ownSend: false, villageId, coord });
        s[coord] = st;
        changed = true;
        addDiagnostic(
          'MIGRAÇÃO',
          `${coord}: cooldown recalculado com parser temporal v${COOLDOWN_PARSER_VERSION}.`,
          `anterior ${previousUntil > 0 ? clockTime(previousUntil) : 'sem cooldown'} · novo ${Number(st.cooldownUntil || 0) > 0 ? clockTime(st.cooldownUntil) : 'sem cooldown'}`,
          villageId
        );
        continue;
      }

      // Primeiro relatório visto: importa também o histórico temporal do Assistente.
      // Assim uma atualização/reinstalação não começa "cega" quando o Assistente já
      // mostra um ataque anterior e respetivo resultado.
      if (!st.lastReportId && !st.pending) {
        const result = classify(row);
        st.lastReportId = row.reportId;
        applyObservedResult(st, row, result, c, now, { ownSend: false, villageId, coord });
        s[coord] = st;
        changed = true;
        continue;
      }

      if (st.pending) {
        const baseline = st.reportIdAtSend || st.lastReportId || null;
        const isNew = row.reportId !== baseline && row.reportId !== st.lastReportId;

        if (!isNew) continue;

        // Se o Assistente fornece uma hora fiável e ela é anterior ao nosso envio,
        // este relatório não pode confirmar o ataque pendente. Atualiza apenas o baseline.
        if (reportPredatesPendingSend(row, st)) {
          const result = classify(row);
          st.lastReportId = row.reportId;
          st.lastExternalReportAt = now;
          applyObservedResult(st, row, result, c, now, { ownSend: false, villageId, coord });
          s[coord] = st;
          changed = true;
          continue;
        }

        const result = classify(row);
        st.pending = false;
        st.sending = false;
        st.sendingBootstrap = false;
        st.sendAttemptAt = 0;
        st.reportIdAtSend = null;
        st.lastReportId = row.reportId;
        applyObservedResult(st, row, result, c, now, { ownSend: true, villageId, coord });
        s[coord] = st;
        changed = true;
        continue;
      }

      // Relatório novo sem ataque pendente: adota o estado do Assistente como fonte
      // de histórico e calcula o cooldown pelo tempo do último ataque, quando disponível.
      if (st.lastReportId && row.reportId !== st.lastReportId) {
        const result = classify(row);
        st.lastReportId = row.reportId;
        st.lastExternalReportAt = now;
        applyObservedResult(st, row, result, c, now, { ownSend: false, villageId, coord });
        s[coord] = st;
        changed = true;
      }
    }

    const pendingTimeoutMs = Number.isFinite(pendingTimeoutMsOverride)
      ? Math.max(c.pendingTimeoutHours * 3600000, pendingTimeoutMsOverride)
      : c.pendingTimeoutHours * 3600000;

    for (const coord of targetList) {
      const st = s[coord];
      if (!st?.pending || !st.sentAt) continue;

      if (now - st.sentAt > pendingTimeoutMs) {
        st.pending = false;
        st.sending = false;
        st.sendingBootstrap = false;
        st.sendAttemptAt = 0;
        st.reportIdAtSend = null;
        st.lastResult = 'pending-timeout';
        st.lastReason = 'timeout de relatório';
        st.cooldownUntil = now + c.unknownCooldownMin * 60000;
        changed = true;
      }
    }

    if (changed) requireStored(saveStates(s, villageId), 'atualização de relatórios/cooldowns');
    return s;
  }

  // ---------------------------------------------------------------------------
  // FILA / ALVOS ELEGÍVEIS
  // ---------------------------------------------------------------------------

  function adaptiveHistoricalEvidenceForCoord(store, coord, operationalState = null) {
    const key = String(coord || '');
    const farm = store?.farms?.[key];
    const evidence = [];
    if (operationalState?.assistantEverSeen) evidence.push('assistantEverSeen');
    if (operationalState?.lastReportId) evidence.push('lastReportId');
    if (Number(operationalState?.sentAt || 0) > 0) evidence.push('envio operacional');
    if (Number(operationalState?.bootstrapAttemptedAt || 0) > 0) evidence.push('bootstrap anterior');
    if (farm && (
      Number(farm.lastObservationAt || 0) > 0 ||
      Number(farm.observations || 0) > 0 ||
      (Array.isArray(farm.recent) && farm.recent.length) ||
      farm.lastSeenReportId ||
      farm.pendingDispatch
    )) evidence.push('modelo adaptativo');
    if ((store?.dispatches || []).some(item => String(item?.targetCoord || item?.coord || '') === key)) {
      evidence.push('ledger de envios');
    }
    if ((store?.reportLedger || []).some(item => String(item?.targetCoord || item?.coord || '') === key)) {
      evidence.push('ledger de reports');
    }
    if ((store?.events || []).some(item => String(item?.coord || '') === key)) {
      evidence.push('telemetria');
    }
    if (normalizeAdaptiveReportIndex(store?.reportIndex).historyCoords.includes(key)) {
      evidence.push('índice histórico');
    }
    return { known: evidence.length > 0, evidence: [...new Set(evidence)] };
  }

  function eligibleTargets(rows, map, s, now, villageId, targets, options = {}) {
    const targetList = Array.isArray(targets) ? targets : [...map.keys()];
    if (!targetList.length) return [];

    const confirmedAbsentFromAssistant =
      options.confirmedAbsentFromAssistant instanceof Set
        ? options.confirmedAbsentFromAssistant
        : new Set();

    const needsRediscovery =
      options.needsRediscovery instanceof Set
        ? options.needsRediscovery
        : new Set();

    const absenceProofAt = Number(options.absenceProofAt || 0);
    const adaptiveCfg = cfg(villageId);
    // O histórico também é consultado em modo legado para nunca rebatizar uma farm
    // conhecida como "Nova" apenas porque a row desapareceu do Assistente.
    const adaptive = adaptiveStore(villageId);
    const stats = options.stats && typeof options.stats === 'object' ? options.stats : {};
    Object.assign(stats, {
      total: targetList.length,
      due: 0,
      early: 0,
      learning: 0,
      minRest: 0,
      pending: 0,
      safety: 0,
      cooldown: 0,
      missingMap: 0,
      rowDisabled: 0,
      unsupported: 0,
      awaitingAbsenceProof: 0,
      awaitingAbsenceProofCoords: [],
      awaitingReportHistory: 0,
      awaitingReportHistoryCoords: [],
      knownMissing: 0,
      bootstrap: 0,
      dispositions: {},
      rowDisabledReasons: {}
    });
    const disposition = (coord, state, detail = '') => {
      stats.dispositions[String(coord)] = { state: String(state), detail: String(detail || '') };
    };
    const start = cursor(villageId, targetList.length);
    const ordered = [];

    for (let offset = 0; offset < targetList.length; offset++) {
      const i = (start + offset) % targetList.length;
      const coord = targetList[i];
      const st = { ...defaultTargetState(), ...(s[coord] || {}) };

      if (st.pending || st.sending) {
        stats.pending++;
        disposition(coord, 'PENDING', st.sending ? 'sending' : 'pending');
        continue;
      }

      // CRÍTICO: só é elegível se o snapshot fresco desta passagem confirmar bárbara.
      const barbarianId = map.get(coord);
      if (!barbarianId) {
        stats.missingMap++;
        disposition(coord, 'MAP_UNCONFIRMED');
        continue;
      }

      let rotation = { eligible: true, due: true, state: 'LEGACY', restHours: Infinity };

      if (adaptiveCfg.adaptiveEnabled) {
        const farm = ensureAdaptiveFarm(adaptive, coord, coordDistance(coord));
        if (adaptiveHardSafetyBlocked(st, farm, now, adaptiveCfg)) {
          stats.safety++;
          disposition(coord, 'SAFETY_BLOCKED', String(st.lastResult || 'adaptive safety'));
          continue;
        }
        rotation = adaptiveRotationEligibility(farm, now, adaptiveCfg);
        if (!rotation.eligible) {
          stats.minRest++;
          disposition(coord, 'MIN_REST', rotation.state);
          continue;
        }
        if (rotation.due) stats.due++;
        else if (rotation.state === 'LEARNING') stats.learning++;
        else stats.early++;
      } else if ((st.cooldownUntil || 0) > now) {
        stats.cooldown++;
        disposition(coord, 'MIN_REST', 'legacy cooldown');
        continue;
      }

      const row = rows.get(coord);

      if (row) {
        // Se existe linha atual, só envia pelo caminho normal e respeita estritamente
        // o botão do modelo escolhido.
        if (!row.buttonPresent || !row.buttonSupported) {
          stats.unsupported++;
          disposition(coord, 'ROW_UNSUPPORTED', row.buttonPresent ? 'ação/template não suportado' : 'botão ausente');
          continue;
        }
        if (row.disabled) {
          stats.rowDisabled++;
          const disabledReason = String(row.disabledReason || 'BUTTON_DISABLED');
          const disabledSource = String(row.disabledSource || 'ASSISTANT_ROW');
          stats.rowDisabledReasons[coord] = { reason: disabledReason, source: disabledSource };
          disposition(coord, 'ROW_DISABLED', `${disabledSource}:${disabledReason}`);
        } else {
          disposition(coord, rotation.due ? 'ELIGIBLE_DUE' : 'ELIGIBLE_EARLY', rotation.state);
        }

        if (row.targetId && String(row.targetId) !== String(barbarianId)) {
          console.warn(
            '[AutoFarmRadius] ID divergente no Assistente; a usar map/village.txt:',
            coord,
            row.targetId,
            barbarianId
          );
        }

        ordered.push({
          index: i,
          coord,
          targetId: String(barbarianId),
          currentReportId: row.reportId || st.lastReportId || null,
          bootstrap: false,
          knownMissing: false,
          rowSendable: !row.disabled,
          adaptiveDue: Boolean(rotation.due),
          adaptiveRotationState: rotation.state,
          adaptiveRestHours: rotation.restHours
        });
        continue;
      }

      // Row ausente já NÃO significa "nova".
      // 1) Se já vimos esta farm no Assistente, nunca a convertemos em primeiro farm.
      // 2) Se uma linha antiga mudou de página, needsRediscovery bloqueia-a.
      // 3) Só fazemos bootstrap se um full scan comprovado marcou ESTA coordenada como ausente.
      if (needsRediscovery.has(coord)) {
        disposition(coord, 'AWAITING_ASSISTANT_REDISCOVERY');
        continue;
      }
      const historical = adaptiveHistoricalEvidenceForCoord(adaptive, coord, st);
      if (!confirmedAbsentFromAssistant.has(coord) || !absenceProofAt) {
        stats.awaitingAbsenceProof++;
        if (!historical.known) stats.awaitingAbsenceProofCoords.push(coord);
        disposition(coord, 'AWAITING_ABSENCE_PROOF');
        continue;
      }

      // Uma ausência atual nunca apaga história. Qualquer prova operacional,
      // report, evento ou dispatch transforma a coordenada em KNOWN_MISSING_ROW,
      // jamais novamente em BOOTSTRAP_NEW.
      if (historical.known) {
        stats.knownMissing++;
        disposition(coord, rotation.due ? 'ELIGIBLE_DUE' : 'ELIGIBLE_EARLY', 'KNOWN_MISSING_ROW');
        ordered.push({
          index: i,
          coord,
          targetId: String(barbarianId),
          currentReportId: st.lastReportId || null,
          bootstrap: false,
          knownMissing: true,
          knownEvidence: historical.evidence,
          rowSendable: true,
          adaptiveDue: Boolean(rotation.due),
          adaptiveRotationState: rotation.state,
          adaptiveRestHours: rotation.restHours
        });
        continue;
      }

      // No primeiro arranque da nova arquitetura, termina primeiro o backfill
      // incremental da janela de Relatórios. Sem isto, uma farm atacada manualmente
      // mas nunca observada pelo AutoFarm poderia ser chamada "Nova" antes de o seu
      // report histórico chegar ao ledger.
      if (!(Number(adaptive?.reportIndex?.completedAt) > 0)) {
        stats.awaitingReportHistory++;
        stats.awaitingReportHistoryCoords.push(coord);
        disposition(coord, 'AWAITING_HISTORY');
        continue;
      }

      // Se já houve um primeiro envio confirmado/incerto depois desta prova, a prova ficou
      // desatualizada. Exigimos um novo full scan antes de qualquer novo bootstrap.
      if (
        Number(st.bootstrapAttemptedAt || 0) > 0 &&
        absenceProofAt <= Number(st.bootstrapAttemptedAt)
      ) {
        disposition(coord, 'AWAITING_ABSENCE_PROOF', 'bootstrap proof anterior consumida');
        continue;
      }

      ordered.push({
        index: i,
        coord,
        targetId: String(barbarianId),
        currentReportId: null,
        bootstrap: true,
        knownMissing: false,
        rowSendable: true,
        adaptiveDue: true,
        adaptiveRotationState: 'LEARNING',
        adaptiveRestHours: Infinity
      });
      disposition(coord, 'ELIGIBLE_DUE', 'BOOTSTRAP_NEW');
      stats.bootstrap++;
    }

    return ordered;
  }


  // ---------------------------------------------------------------------------
  // ENVIO DOS TEMPLATES A / B (C é ação nativa especial e não é automatizada)
  // ---------------------------------------------------------------------------

  function sameOriginUrl(value) {
    const url = new URL(String(value), location.origin);
    if (url.origin !== location.origin) {
      throw codedError('SEND_ENDPOINT_UNAVAILABLE', 'Endpoint do Assistente fora da origem atual.');
    }
    return url;
  }

  function buildFarmSendEndpoint(villageId) {
    const w = topWin();
    const liveLink = w.Accountmanager?.send_units_link;
    if (liveLink) return sameOriginUrl(liveLink).toString();

    const gd = gameData();
    const csrf = String(gd?.csrf || w.csrf_token || '');
    const pure = String(gd?.link_base_pure || '');

    if (!csrf) {
      throw codedError(
        'SEND_ENDPOINT_UNAVAILABLE',
        'Não foi possível obter o token CSRF necessário para o Assistente de Saque.'
      );
    }

    let url;
    try {
      url = pure
        ? sameOriginUrl(`${pure}am_farm`)
        : sameOriginUrl('/game.php');
    } catch (err) {
      if (err?.code === 'SEND_ENDPOINT_UNAVAILABLE') throw err;
      url = sameOriginUrl('/game.php');
    }

    url.searchParams.set('village', String(villageId));
    url.searchParams.set('screen', 'am_farm');
    url.searchParams.set('ajaxaction', 'farm');
    url.searchParams.set('h', csrf);
    return url.toString();
  }


  async function postFarm(targetId, templateId, villageId) {
    AntiBotGuard.assertSafe();
    renewLease(villageId);
    assertVillageContext(villageId);

    const endpoint = buildFarmSendEndpoint(villageId);
    const body = new URLSearchParams({
      target: String(targetId),
      template_id: String(templateId),
      source: String(villageId)
    });

    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body
    }, villageId);

    const text = await res.text();

    if (textLooksLikeProtection(text)) {
      AntiBotGuard.stop('Proteção anti-bot encontrada na resposta do envio');
      throw codedError('BOT_PROTECTION_ACTIVE');
    }

    if (textLooksLikeLogin(text, res.url)) {
      throw codedError('LOGIN_REQUIRED', 'Sessão expirada / login necessário.');
    }

    throwForStatus(res);

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw codedError('INVALID_JSON_RESPONSE', 'O servidor devolveu uma resposta inesperada ao enviar o farm.');
    }

    return data;
  }

  function flattenServerValue(value, depth = 0) {
    if (depth > 3 || value == null) return [];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    if (Array.isArray(value)) {
      return value.flatMap(item => flattenServerValue(item, depth + 1));
    }
    if (typeof value === 'object') {
      return Object.values(value).flatMap(item => flattenServerValue(item, depth + 1));
    }
    return [];
  }

  function extractServerMessage(data) {
    if (data == null) return '';

    if (Array.isArray(data)) {
      return flattenServerValue(data)
        .map(value => String(value).trim())
        .filter(Boolean)
        .join(' | ');
    }

    if (typeof data !== 'object') return String(data);

    const fields = [
      data.error,
      data.errors,
      data.message,
      data.msg,
      data.error_message,
      data.errorMessage,
      data.reason
    ];
    return fields
      .flatMap(value => flattenServerValue(value))
      .map(value => String(value).trim())
      .filter(Boolean)
      .join(' | ');
  }

  function normalizeServerMessage(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isNoUnitsError(error) {
    const t = normalizeServerMessage(error);
    if (!t) return false;
    return (
      /not enough (?:units|troops)/.test(t) ||
      /insufficient (?:units|troops)/.test(t) ||
      /no (?:units|troops) available/.test(t) ||
      /(?:units|troops) unavailable/.test(t) ||
      /sem (?:unidades|tropas) (?:suficientes|disponiveis)/.test(t) ||
      /nao (?:ha|tem|tens|existem?) (?:unidades|tropas) (?:suficientes|disponiveis)/.test(t) ||
      /(?:unidades|tropas) insuficientes/.test(t) ||
      /(?:unidades|tropas) nao disponiveis/.test(t)
    );
  }

  function looksLikeProtection(error) {
    return /bot protection|captcha|prote[cç][aã]o contra bots|challenge/i.test(String(error || ''));
  }


  const FARM_UNIT_KEYS = Object.freeze([
    'spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher',
    'heavy', 'ram', 'catapult', 'knight', 'snob', 'militia'
  ]);

  const FARM_UNIT_LABELS = Object.freeze({
    spear: 'Lança',
    sword: 'Espada',
    axe: 'Machado',
    archer: 'Arqueiro',
    spy: 'Batedor',
    light: 'CL',
    marcher: 'Arq. montado',
    heavy: 'CP',
    ram: 'Ariete',
    catapult: 'Catapulta',
    knight: 'Paladino',
    snob: 'Nobre',
    militia: 'Milícia'
  });

  function unitLabel(unit) {
    return FARM_UNIT_LABELS[unit] || unit;
  }

  function normalizeUnitCounts(value, keepZero = true) {
    if (!value || typeof value !== 'object') return null;
    const out = {};
    let seen = 0;

    for (const unit of FARM_UNIT_KEYS) {
      const n = Number(value[unit]);
      if (!Number.isFinite(n) || n < 0) continue;
      if (keepZero || n > 0) out[unit] = Math.floor(n);
      seen++;
    }

    return seen ? out : null;
  }

  function normalizeComposition(value) {
    const raw = normalizeUnitCounts(value, false);
    if (!raw) return null;
    const out = {};
    for (const [unit, count] of Object.entries(raw)) {
      if (count > 0) out[unit] = count;
    }
    return Object.keys(out).length ? out : null;
  }

  function capacityForComposition(composition, currentUnits) {
    const comp = normalizeComposition(composition);
    const units = normalizeUnitCounts(currentUnits, true);
    if (!comp || !units) return null;

    let capacity = Infinity;
    for (const [unit, need] of Object.entries(comp)) {
      const available = Number(units[unit]);
      if (!Number.isFinite(available) || available < 0) return null;
      capacity = Math.min(capacity, Math.floor(available / need));
    }

    return Number.isFinite(capacity) ? Math.max(0, capacity) : null;
  }

  function formatComposition(composition) {
    const comp = normalizeComposition(composition);
    if (!comp) return '—';
    return Object.entries(comp)
      .map(([unit, count]) => `${count} ${unitLabel(unit)}`)
      .join(' + ');
  }

  function formatRequiredAvailability(composition, currentUnits) {
    const comp = normalizeComposition(composition);
    const units = normalizeUnitCounts(currentUnits, true);
    if (!comp || !units) return '—';

    return Object.entries(comp)
      .map(([unit, need]) => `${unitLabel(unit)} ${Number(units[unit] || 0)}/${need}`)
      .join(' · ');
  }

  function extractBalancedObject(text, openIndex) {
    if (typeof text !== 'string' || openIndex < 0 || text[openIndex] !== '{') return null;

    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i];

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(openIndex, i + 1);
      }
    }

    return null;
  }

  function parseUnitObjectLiteral(objectText, positiveOnly = false) {
    if (!objectText) return null;

    try {
      const parsed = JSON.parse(objectText);
      return positiveOnly ? normalizeComposition(parsed) : normalizeUnitCounts(parsed, true);
    } catch (_) {}

    const out = {};
    for (const unit of FARM_UNIT_KEYS) {
      const re = new RegExp(`(?:["']?${unit}["']?)\\s*:\\s*["']?(\\d+)["']?`, 'i');
      const m = objectText.match(re);
      if (!m) continue;
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 0) continue;
      if (!positiveOnly || n > 0) out[unit] = Math.floor(n);
    }

    return Object.keys(out).length ? out : null;
  }

  function scriptTexts(doc) {
    if (!doc?.querySelectorAll) return [];
    return [...doc.querySelectorAll('script')]
      .map(script => String(script.textContent || ''))
      .filter(Boolean);
  }

  function objectAfterToken(text, tokenIndex, maxLookahead = 700) {
    if (tokenIndex < 0) return null;
    const end = Math.min(text.length, tokenIndex + maxLookahead);
    const brace = text.indexOf('{', tokenIndex);
    if (brace < 0 || brace >= end) return null;
    return extractBalancedObject(text, brace);
  }

  function parseInlineCurrentUnits(doc) {
    for (const source of scriptTexts(doc)) {
      if (!/current_units/i.test(source)) continue;

      const patterns = [
        /Accountmanager\.farm\.current_units\s*=/ig,
        /["']current_units["']\s*:/ig,
        /\bcurrent_units\s*:/ig
      ];

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(source))) {
          const obj = objectAfterToken(source, m.index + m[0].length, 1500);
          const parsed = parseUnitObjectLiteral(obj, false);
          if (parsed) return parsed;
        }
      }
    }
    return null;
  }

  function parseInlineTemplateComposition(doc, templateId) {
    const id = String(templateId || '');
    if (!id) return null;

    const safeId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const source of scriptTexts(doc)) {
      if (!source.includes(id)) continue;
      if (!/template|Accountmanager\.farm/i.test(source)) continue;

      const patterns = [
        new RegExp(`["']t_${safeId}["']\\s*:`, 'ig'),
        new RegExp(`\\bt_${safeId}\\s*:`, 'ig'),
        new RegExp(`["']${safeId}["']\\s*:`, 'ig')
      ];

      for (const pattern of patterns) {
        let m;
        while ((m = pattern.exec(source))) {
          const obj = objectAfterToken(source, m.index + m[0].length, 1200);
          const parsed = parseUnitObjectLiteral(obj, true);
          if (parsed) return parsed;
        }
      }
    }

    return null;
  }

  function parseIntegerUnitCount(raw) {
    if (raw == null) return null;
    const text = String(raw).trim();
    if (!text) return null;

    // data-* costuma conter apenas o número. No textContent somos mais estritos:
    // não concatenamos "5 (100)" em 5100 nem escolhemos arbitrariamente um dos números.
    const pattern = /^\s*\d+(?:[.,\s]\d{3})*\s*$/;
    if (!pattern.test(text)) return null;

    const n = Number(text.replace(/[.,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }

  function parseUnitsEntryAll(doc) {
    if (!doc?.querySelectorAll) return null;
    const out = {};

    for (const el of doc.querySelectorAll('.units-entry-all[data-unit], [data-unit][data-all-count]')) {
      const unit = String(el.getAttribute('data-unit') || '').trim();
      if (!FARM_UNIT_KEYS.includes(unit)) continue;

      const dataCandidates = [
        el.getAttribute('data-all-count'),
        el.getAttribute('data-count')
      ];

      let count = null;
      for (const raw of dataCandidates) {
        count = parseIntegerUnitCount(raw);
        if (count !== null) break;
      }

      if (count === null) {
        count = parseIntegerUnitCount(el.textContent);
      }

      if (count !== null) out[unit] = count;
    }

    return Object.keys(out).length ? out : null;
  }

  function parseDomTemplateComposition(doc, templateId) {
    if (!doc?.querySelectorAll) return null;
    const id = String(templateId || '');
    if (!id) return null;

    const selectors = [
      `[data-template-id="${id}"]`,
      `[data-template="${id}"]`,
      `#template_${id}`,
      `#farm_template_${id}`
    ];

    for (const selector of selectors) {
      let node;
      try { node = doc.querySelector(selector); } catch (_) { node = null; }
      if (!node) continue;

      const container = node.closest?.('form, table, tbody, tr, div') || node;
      const composition = {};

      for (const input of container.querySelectorAll?.('input[name], input[data-unit]') || []) {
        const name = String(input.getAttribute('data-unit') || input.getAttribute('name') || '')
          .replace(/^.*\[([a-z_]+)\].*$/, '$1');
        if (!FARM_UNIT_KEYS.includes(name)) continue;

        const value = Number(input.value ?? input.getAttribute('value'));
        if (Number.isFinite(value) && value > 0) composition[name] = Math.floor(value);
      }

      if (Object.keys(composition).length) return composition;
    }


    return null;
  }

  function savedTemplateComposition(templateId, villageId) {
    const store = loadJSON('templateCompositions', {}, villageId);
    const entry = store && typeof store === 'object' ? store[String(templateId || '')] : null;
    if (!entry) return null;

    // Uma composição antiga pode ficar desatualizada se o jogador editar o modelo
    // mantendo o mesmo template_id. Por segurança, o fallback persistido expira.
    const at = Number(entry?.at || 0);
    if (!at || Date.now() - at > 60 * 60000) return null;

    return normalizeComposition(entry?.composition || entry);
  }

  function saveTemplateComposition(templateId, composition, villageId, source = 'unknown') {
    const comp = normalizeComposition(composition);
    if (!templateId || !comp) return false;

    const store = loadJSON('templateCompositions', {}, villageId);
    const next = store && typeof store === 'object' && !Array.isArray(store) ? { ...store } : {};
    next[String(templateId)] = {
      composition: comp,
      source: String(source || 'unknown'),
      at: Date.now()
    };
    return saveJSON('templateCompositions', next, villageId);
  }

  function liveTemplateComposition(templateId) {
    try {
      const farm = topWin().Accountmanager?.farm;
      const templates = farm?.templates;
      if (!templates) return null;

      const id = String(templateId || '');
      const template = templates[`t_${id}`] || templates[id] || null;
      return normalizeComposition(template);
    } catch (_) {
      return null;
    }
  }

  function liveCurrentUnits() {
    try {
      return normalizeUnitCounts(topWin().Accountmanager?.farm?.current_units, true);
    } catch (_) {
      return null;
    }
  }

  function getPlaceUrl(villageId) {
    const gd = gameData();
    const pure = String(gd?.link_base_pure || '');
    let url;

    try {
      url = pure
        ? sameOriginUrl(`${pure}place`)
        : sameOriginUrl('/game.php');
    } catch (_) {
      url = sameOriginUrl('/game.php');
    }

    url.searchParams.set('village', String(villageId));
    url.searchParams.set('screen', 'place');
    url.searchParams.set('mode', 'command');
    return url.toString();
  }

  async function fetchPlaceCurrentUnits(villageId) {
    try {
      const doc = await fetchHtml(getPlaceUrl(villageId), villageId);
      const units = parseUnitsEntryAll(doc);
      if (!units) return null;
      return { units, source: 'Praça de Reuniões (background)', at: Date.now() };
    } catch (err) {
      if (['BOT_PROTECTION_ACTIVE', 'LOGIN_REQUIRED', 'HTTP_403', 'HTTP_429', 'LEASE_LOST'].includes(err?.code)) {
        throw err;
      }
      console.warn('[AutoFarmRadius] não foi possível confirmar tropas pela Praça:', err);
      return null;
    }
  }

  function sameComposition(a, b) {
    const aa = normalizeComposition(a);
    const bb = normalizeComposition(b);
    if (!aa || !bb) return false;
    const keys = [...new Set([...Object.keys(aa), ...Object.keys(bb)])].sort();
    return keys.every(key => Number(aa[key] || 0) === Number(bb[key] || 0));
  }

  function templateCompositionInfo(templateId, villageId, farmDoc) {
    // O HTML foi obtido nesta passagem e por isso tem prioridade sobre objetos JS
    // que podem ter ficado inicializados numa visita antiga ao Assistente.
    const inline = parseInlineTemplateComposition(farmDoc, templateId);
    const dom = parseDomTemplateComposition(farmDoc, templateId);

    if (inline && dom && !sameComposition(inline, dom)) {
      console.warn('[AutoFarmRadius] composição divergente no HTML/DOM do Assistente', {
        templateId: String(templateId), inline, dom
      });
      return {
        composition: null,
        source: 'conflito entre HTML e DOM do Assistente',
        authoritative: false,
        conflict: true
      };
    }

    const fresh = inline || dom;
    if (fresh) {
      const source = inline && dom ? 'HTML + DOM do Assistente' : (inline ? 'HTML do Assistente' : 'DOM do Assistente');
      saveTemplateComposition(templateId, fresh, villageId, source);
      return { composition: fresh, source, authoritative: true, conflict: false };
    }

    const live = liveTemplateComposition(templateId);
    if (live) {
      const liveIsCurrentFarmPage = isFarmPage() && String(currentVillageId()) === String(villageId);
      // No próprio Assistente, o objeto live pertence ao contexto atual e é uma fonte forte.
      // Fora dele, pode ter sobrevivido de uma navegação anterior e fica apenas conservador.
      saveTemplateComposition(templateId, live, villageId, 'Accountmanager.farm.templates');
      return {
        composition: live,
        source: liveIsCurrentFarmPage
          ? 'Accountmanager.farm.templates (Assistente atual)'
          : 'Accountmanager.farm.templates (frescura não comprovada)',
        authoritative: liveIsCurrentFarmPage,
        conflict: false
      };
    }

    const saved = savedTemplateComposition(templateId, villageId);
    if (saved) {
      // Pode ter até 60 min e o jogador pode ter editado o modelo mantendo template_id.
      // Serve para diagnóstico/UI e para explicar o fallback, mas não autoriza capacidade exata.
      return {
        composition: saved,
        source: 'composição guardada do mesmo template_id (não autoritativa)',
        authoritative: false,
        conflict: false
      };
    }

    return {
      composition: null,
      source: 'composição desconhecida',
      authoritative: false,
      conflict: false
    };
  }

  async function currentUnitsInfo(villageId, farmDoc, options = {}) {
    const inline = parseInlineCurrentUnits(farmDoc);
    if (inline) {
      const result = {
        units: inline,
        source: 'HTML do Assistente',
        at: Date.now(),
        authoritative: true
      };
      RUNTIME.lastTroopSnapshotByVillage.set(String(villageId), result);
      return result;
    }

    const farmEntries = parseUnitsEntryAll(farmDoc);
    if (farmEntries) {
      const result = {
        units: farmEntries,
        source: 'Assistente (contadores de unidades)',
        at: Date.now(),
        authoritative: true
      };
      RUNTIME.lastTroopSnapshotByVillage.set(String(villageId), result);
      return result;
    }

    if (options.allowPlaceFetch !== false) {
      const place = await fetchPlaceCurrentUnits(villageId);
      if (place) {
        const result = { ...place, authoritative: true };
        RUNTIME.lastTroopSnapshotByVillage.set(String(villageId), result);
        return result;
      }
    }

    const live = options.allowLive !== false ? liveCurrentUnits() : null;
    if (live) {
      const liveIsCurrentFarmPage = isFarmPage() && String(currentVillageId()) === String(villageId);
      // No próprio Assistente é aceitável como fonte atual; noutras páginas fica apenas diagnóstico.
      const result = {
        units: live,
        source: liveIsCurrentFarmPage
          ? 'Accountmanager.current_units (Assistente atual)'
          : 'Accountmanager.current_units (diagnóstico; frescura não comprovada)',
        at: Date.now(),
        authoritative: liveIsCurrentFarmPage
      };
      RUNTIME.lastTroopSnapshotByVillage.set(String(villageId), result);
      return result;
    }

    return {
      units: null,
      source: 'tropas desconhecidas',
      at: Date.now(),
      authoritative: false
    };
  }

  function assistantButtonSignal(rows, farmDoc = null, farmTemplate = 'A', templateId = null) {
    const wantedTemplateId = templateId == null ? null : String(templateId);
    const supported = [...rows.values()].filter(
      row => row?.buttonPresent && row?.buttonSupported &&
        (!wantedTemplateId || String(row.templateId || '') === wantedTemplateId)
    );
    if (supported.length) {
      const enabledCount = supported.filter(row => !row.disabled).length;
      return {
        enabled: enabledCount > 0,
        enabledCount,
        observedCount: supported.length,
        source: 'linhas atuais do raio'
      };
    }

    // Quando todos os alvos do raio são novos, rows pode estar vazio. A página 0 fresca
    // ainda pode provar conservadoramente "zero" ou "pelo menos um" para o modelo.
    if (farmDoc?.querySelectorAll) {
      const letter = ['A', 'B'].includes(String(farmTemplate).toUpperCase())
        ? String(farmTemplate).toLowerCase()
        : 'a';
      const buttons = [...farmDoc.querySelectorAll(`#plunder_list a.farm_icon_${letter}`)]
        .filter(a => {
          if (!wantedTemplateId) return true;
          const fromData = a.dataset?.templateId || a.dataset?.template || null;
          const onclick = a.getAttribute('onclick') || '';
          const mm = onclick.match(
            /(?:Accountmanager\.farm\.)?sendUnits\s*\(\s*this\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i
          );
          const observed = fromData ? String(fromData) : (mm ? String(mm[2]) : '');
          return observed === wantedTemplateId;
        });
      if (buttons.length) {
        const enabledCount = buttons.filter(a => !a.classList.contains('farm_icon_disabled')).length;
        return {
          enabled: enabledCount > 0,
          enabledCount,
          observedCount: buttons.length,
          source: 'página 0 fresca do Assistente'
        };
      }
    }

    return null;
  }

  async function assessTemplateAvailability(rows, templateId, villageId, farmTemplate, options = {}) {
    const snapshot = RUNTIME.farmPageSnapshotByVillage.get(String(villageId));
    const farmDoc = snapshot?.doc || null;

    const templateInfo = templateCompositionInfo(templateId, villageId, farmDoc);
    let unitsInfo = {
      units: null,
      source: 'não necessário para fallback',
      at: Date.now(),
      authoritative: false
    };

    const buttonSignal = assistantButtonSignal(rows, farmDoc, farmTemplate, templateId);

    // Capacidade >1 só é "exata" quando composição E tropas vêm de fontes cuja
    // frescura foi comprovada nesta passagem. Cache persistido / objetos live não chegam.
    if (templateInfo.composition) {
      unitsInfo = await currentUnitsInfo(villageId, farmDoc, {
        allowPlaceFetch: Boolean(templateInfo.authoritative) && options.allowPlaceFetch !== false,
        allowLive: options.allowLive !== false
      });
      const exactCapacity = capacityForComposition(templateInfo.composition, unitsInfo.units);

      if (
        templateInfo.authoritative &&
        unitsInfo.authoritative &&
        Number.isFinite(exactCapacity)
      ) {
        // Se a própria página fresca disser que todos os botões estão disabled,
        // preferimos zero em vez de contrariar esse sinal com uma estimativa numérica.
        if (exactCapacity > 0 && buttonSignal && !buttonSignal.enabled) {
          return {
            known: true,
            exact: false,
            capacity: 0,
            source: `botões ${String(farmTemplate).toUpperCase()} desativados (${buttonSignal.source})`,
            templateSource: templateInfo.source,
            composition: templateInfo.composition,
            compositionAuthoritative: Boolean(templateInfo.authoritative),
            currentUnits: unitsInfo.units,
            confidence: 'zero conservador por conflito de sinais'
          };
        }

        return {
          known: true,
          exact: true,
          capacity: exactCapacity,
          source: `${unitsInfo.source}`,
          templateSource: templateInfo.source,
          composition: templateInfo.composition,
          compositionAuthoritative: Boolean(templateInfo.authoritative),
          currentUnits: unitsInfo.units,
          confidence: 'exata (fontes frescas)'
        };
      }
    }

    // Um botão ativo prova apenas capacidade mínima para 1; todos disabled provam zero.
    if (buttonSignal) {
      return {
        known: true,
        exact: false,
        capacity: buttonSignal.enabled ? 1 : 0,
        source: buttonSignal.enabled
          ? `botão ${String(farmTemplate).toUpperCase()} ativo (${buttonSignal.source}; mínimo 1)`
          : `todos os botões ${String(farmTemplate).toUpperCase()} observados estão desativados (${buttonSignal.source})`,
        templateSource: templateInfo.source,
        composition: templateInfo.composition,
        compositionAuthoritative: Boolean(templateInfo.authoritative),
        currentUnits: unitsInfo.units,
        confidence: buttonSignal.enabled ? 'mínimo 1' : 'zero'
      };
    }

    // Fallback adicional para A/B. Também só autoriza 0 ou 1.
    const hasFreshTemplateEvidence = Boolean(buttonSignal || templateInfo.authoritative);
    if (hasFreshTemplateEvidence && ['A', 'B'].includes(String(farmTemplate || '').toUpperCase())) {
      try {
        const farm = topWin().Accountmanager?.farm;
        if (farm && typeof farm.unitsAppearAvailableAB === 'function') {
          const available = Boolean(farm.unitsAppearAvailableAB(String(templateId)));
          return {
            known: true,
            exact: false,
            capacity: available ? 1 : 0,
            source: 'Accountmanager.unitsAppearAvailableAB (conservador)',
            templateSource: templateInfo.source,
            composition: templateInfo.composition,
            compositionAuthoritative: Boolean(templateInfo.authoritative),
            currentUnits: unitsInfo.units,
            confidence: available ? 'mínimo 1' : 'zero'
          };
        }
      } catch (_) {}
    }

    return {
      known: false,
      exact: false,
      capacity: null,
      source: templateInfo.conflict
        ? 'conflito na composição do modelo; envio bloqueado'
        : 'não foi possível validar disponibilidade antes do POST',
      templateSource: templateInfo.source,
      composition: templateInfo.composition,
      compositionAuthoritative: Boolean(templateInfo.authoritative),
      currentUnits: unitsInfo.units,
      confidence: 'desconhecida'
    };
  }

  function observedTemplateIdsInFarmDoc(doc, farmTemplate) {
    const ids = new Set();
    if (!doc?.querySelectorAll) return ids;
    for (const row of doc.querySelectorAll('#plunder_list tr')) {
      const button = parseFarmButton(row, farmTemplate);
      if (button?.supported && button.templateId) ids.add(String(button.templateId));
    }
    return ids;
  }

  async function revalidateCapacityAfterSuccess(
    villageId,
    c,
    targets,
    templateId,
    farmTemplate,
    expectedComposition = null
  ) {
    AntiBotGuard.assertSafe();
    renewLease(villageId);
    assertVillageContext(villageId);

    const liveCfg = cfg(villageId);
    if (
      !liveCfg.enabled ||
      liveCfg.farmTemplate !== farmTemplate ||
      Number(liveCfg.radius) !== Number(c.radius)

    ) {
      return {
        known: false,
        exact: false,
        capacity: null,
        source: 'definições alteradas durante a revalidação pós-envio',
        templateSource: 'não revalidado',
        composition: null,
        compositionAuthoritative: false,
        currentUnits: null,
        confidence: 'desconhecida'
      };
    }

    const freshDoc = await fetchHtml(getFarmUrl(0, villageId), villageId);
    AntiBotGuard.assertSafe();
    renewLease(villageId);
    assertVillageContext(villageId);
    RUNTIME.farmPageSnapshotByVillage.set(String(villageId), {
      doc: freshDoc,
      at: Date.now()
    });

    const observedTemplateIds = observedTemplateIdsInFarmDoc(freshDoc, farmTemplate);
    if (
      observedTemplateIds.size &&
      (observedTemplateIds.size !== 1 || !observedTemplateIds.has(String(templateId)))
    ) {
      return {
        known: false,
        exact: false,
        capacity: null,
        source: `o modelo ${String(farmTemplate).toUpperCase()} mudou de template_id`,
        templateSource: `esperado ${templateId}; observado ${[...observedTemplateIds].join(', ')}`,
        composition: null,
        compositionAuthoritative: false,
        currentUnits: null,
        confidence: 'conflito'
      };
    }

    const freshRows = parseFarmRows(
      freshDoc,
      new Set(Array.isArray(targets) ? targets : targetCoords(villageId)),
      farmTemplate
    );
    const freshButtonSignal = assistantButtonSignal(
      freshRows,
      freshDoc,
      farmTemplate,
      templateId
    );
    if (!freshButtonSignal) {
      return {
        known: false,
        exact: false,
        capacity: null,
        source: `o GET fresco não confirmou o botão ${String(farmTemplate).toUpperCase()} do template esperado`,
        templateSource: `template_id esperado ${templateId}`,
        composition: null,
        compositionAuthoritative: false,
        currentUnits: null,
        confidence: 'desconhecida'
      };
    }
    const refreshed = await assessTemplateAvailability(
      freshRows,
      templateId,
      villageId,
      farmTemplate,
      {
        // O GET fresco do Assistente é a única revalidação de rede deste passo.
        // Não consulta a Praça nem aceita current_units live potencialmente antigas.
        allowPlaceFetch: false,
        allowLive: false
      }
    );

    if (
      expectedComposition &&
      refreshed.compositionAuthoritative &&
      refreshed.composition &&
      !sameComposition(expectedComposition, refreshed.composition)
    ) {
      return {
        ...refreshed,
        known: false,
        exact: false,
        capacity: null,
        source: 'a composição do modelo mudou durante a passagem',
        confidence: 'conflito'
      };
    }

    return refreshed;
  }

  function capacityAfterSuccessfulResponse(
    data,
    composition,
    compositionAuthoritative,
    remainingCapacity,
    capacityProofExact
  ) {
    const serverUnits = normalizeUnitCounts(data?.current_units, true);
    const exactCapacity = serverUnits && composition && compositionAuthoritative
      ? capacityForComposition(composition, serverUnits)
      : null;
    if (Number.isFinite(exactCapacity)) {
      return {
        remainingCapacity: Math.max(0, Number(exactCapacity)),
        proofExact: true,
        authoritative: true,
        source: 'POST_CURRENT_UNITS',
        needsFreshRevalidation: false,
        resolvedFromServerUnits: true,
        serverUnits
      };
    }

    return {
      remainingCapacity: null,
      proofExact: false,
      authoritative: false,
      source: 'MUTATION_BOUNDARY_INVALIDATION',
      derivedFromExactProof: Boolean(capacityProofExact),
      needsFreshRevalidation: true,
      resolvedFromServerUnits: false,
      serverUnits
    };
  }

  function classifyFarmResponse(data) {
    const message = extractServerMessage(data);

    if (looksLikeProtection(message)) {
      return { kind: 'protection', message: message || 'resposta de proteção anti-bot' };
    }

    if (isNoUnitsError(message)) {
      return { kind: 'no-units', message: message || 'sem tropas suficientes' };
    }

    const explicitSuccessText = data && typeof data === 'object' && !Array.isArray(data)
      ? normalizeServerMessage(data.success)
      : '';
    const explicitNegative = Boolean(
      data && typeof data === 'object' && !Array.isArray(data) &&
      (
        data.success === false || data.success === 0 || data.success === '0' ||
        ['false', 'failed', 'failure', 'error', 'erro', 'rejected', 'rejeitado']
          .includes(explicitSuccessText)
      )
    );

    const explicitErrorField = Boolean(
      Array.isArray(data) ||
      (
        data && typeof data === 'object' &&
        [data.error, data.errors, data.error_message, data.errorMessage]
          .some(value => flattenServerValue(value).length > 0)
      )
    );

    if (explicitErrorField || explicitNegative) {
      return {
        kind: 'rejected',
        message: message || (explicitNegative ? 'success=false' : 'pedido rejeitado pelo servidor')
      };
    }

    if (isPositiveFarmResponse(data)) {
      return { kind: 'success', message: message || '' };
    }

    return { kind: 'unexpected', message: message || 'resposta sem confirmação inequívoca' };
  }

  function beginSendAttempt(coord, reportIdAtSend, villageId, bootstrap = false) {
    const s = states(villageId);
    const old = { ...defaultTargetState(), ...(s[coord] || {}) };

    if (old.pending || old.sending) {
      throw codedError('TARGET_ALREADY_IN_FLIGHT', `${coord} já está pendente/em envio.`);
    }

    const at = Date.now();
    s[coord] = {
      ...old,
      sending: true,
      sendingBootstrap: Boolean(bootstrap),
      sendAttemptAt: at,
      reportIdAtSend: reportIdAtSend || old.lastReportId || null,
      lastResult: 'sending',
      lastReason: bootstrap ? 'pedido de primeiro farm iniciado' : 'pedido de envio iniciado'
    };
    requireStored(saveStates(s, villageId), `estado pré-envio de ${coord}`);
    return at;
  }

  function rollbackSendAttempt(coord, villageId, reason = 'envio rejeitado') {
    const s = states(villageId);
    const old = { ...defaultTargetState(), ...(s[coord] || {}) };
    s[coord] = {
      ...old,
      sending: false,
      sendingBootstrap: false,
      sendAttemptAt: 0,
      lastResult: 'send-rejected',
      lastReason: reason
    };
    requireStored(saveStates(s, villageId), `rollback do envio de ${coord}`);
  }

  function markSendUncertain(coord, villageId, reason = 'resposta do envio incerta', bootstrap = false) {
    const s = states(villageId);
    const old = { ...defaultTargetState(), ...(s[coord] || {}) };
    const attemptAt = old.sendAttemptAt || Date.now();
    const wasBootstrap = Boolean(bootstrap || old.sendingBootstrap);

    s[coord] = {
      ...old,
      sending: false,
      sendingBootstrap: false,
      pending: true,
      sentAt: attemptAt,
      bootstrapAttemptedAt: wasBootstrap
        ? Math.max(Number(old.bootstrapAttemptedAt || 0), attemptAt)
        : Number(old.bootstrapAttemptedAt || 0),
      sendAttemptAt: 0,
      cooldownUntil: 0,
      lastResult: 'send-uncertain',
      lastReason: reason
    };
    requireStored(saveStates(s, villageId), `estado incerto do envio de ${coord}`);
  }

  function markSent(coord, reportIdAtSend, targetIndex, villageId, targetCount, farmTemplate, bootstrap = false) {
    const s = states(villageId);
    const old = { ...defaultTargetState(), ...(s[coord] || {}) };
    const sentAt = Date.now();

    s[coord] = {
      ...old,
      pending: true,
      sending: false,
      sendingBootstrap: false,
      sendAttemptAt: 0,
      reportIdAtSend: reportIdAtSend || old.reportIdAtSend || old.lastReportId || null,
      sentAt,
      bootstrapAttemptedAt: bootstrap
        ? Math.max(Number(old.bootstrapAttemptedAt || 0), sentAt)
        : Number(old.bootstrapAttemptedAt || 0),
      cooldownUntil: 0,
      lastResult: 'sent',
      lastReason: bootstrap
        ? `modelo ${String(farmTemplate || 'A').toUpperCase()} enviado - primeiro farm sem linha prévia no Assistente`
        : `modelo ${String(farmTemplate || 'A').toUpperCase()} enviado`
    };

    requireStored(saveStates(s, villageId), `estado pós-envio de ${coord}`);
    requireStored(saveCursor(targetIndex + 1, villageId, targetCount), 'cursor de rotação');
  }

  function isPositiveFarmResponse(data) {
    if (!data || typeof data !== 'object' || data.error) return false;

    const successText = typeof data.success === 'string'
      ? normalizeServerMessage(data.success)
      : '';

    // "success" explícito negativo nunca é confirmação.
    if (
      data.success === false || data.success === 0 || data.success === '0' ||
      ['false', 'failed', 'failure', 'error', 'erro', 'rejected', 'rejeitado'].includes(successText)
    ) return false;

    if (data.success === true || data.success === 1 || data.success === '1') return true;

    // O sinal mais forte usado pelo Assistente é a devolução das unidades atuais.
    if (data.current_units !== undefined && data.current_units !== null) return true;

    // Strings arbitrárias deixam de ser tratadas como sucesso. Só aceitamos tokens
    // inequívocos; mensagens localizadas desconhecidas ficam "uncertain" por segurança.
    if (['true', 'ok', 'success', 'sent', 'enviado', 'enviada'].includes(successText)) return true;

    return false;
  }

  function sendFailureIsUncertain(err) {
    const code = String(err?.code || '');
    if (['REQUEST_TIMEOUT', 'INVALID_JSON_RESPONSE', 'UNEXPECTED_SEND_RESPONSE'].includes(code)) return true;
    if (/^HTTP_5\d\d$/.test(code)) return true;
    return err instanceof TypeError;
  }

  function serializableAssistantRows(rows) {
    return [...(rows instanceof Map ? rows.entries() : [])].map(([coord, row]) => [coord, {
      coord: String(row?.coord || coord),
      targetId: row?.targetId ? String(row.targetId) : null,
      templateId: row?.templateId ? String(row.templateId) : null,
      buttonPresent: Boolean(row?.buttonPresent),
      buttonSupported: Boolean(row?.buttonSupported),
      buttonAction: row?.buttonAction ? String(row.buttonAction) : null,
      disabled: Boolean(row?.disabled),
      disabledReason: String(row?.disabledReason || ''),
      disabledSource: String(row?.disabledSource || ''),
      reportId: row?.reportId ? String(row.reportId) : null,
      haul: row?.haul ? String(row.haul) : null,
      dot: row?.dot ? String(row.dot) : null,
      assistantAttackAt: finiteObservedNumber(row?.assistantAttackAt),
      assistantAttackRaw: String(row?.assistantAttackRaw || ''),
      assistantAttackTimeSource: String(row?.assistantAttackTimeSource || 'unavailable'),
      assistantAttackCellIndex: Number.isInteger(Number(row?.assistantAttackCellIndex))
        ? Number(row.assistantAttackCellIndex)
        : -1
    }]);
  }

  function serializableMapTargets(map) {
    return [...(map instanceof Map ? map.entries() : [])]
      .map(([coord, targetId]) => [String(coord), String(targetId)])
      .filter(([coord, targetId]) => /^\d{3}\|\d{3}$/.test(coord) && targetId);
  }

  function executionCandidateFromItem(item, decision = null) {
    // ExecutionPlan é autorização operacional, não snapshot analítico. O final
    // gate recalcula o decision adaptativo; persistir prediction/economia de
    // dezenas de candidatos só aumenta coordinationV2 e pode esgotar quota.
    return {
      coord: String(item?.coord || ''),
      targetId: item?.targetId ? String(item.targetId) : '',
      index: Math.max(0, Math.trunc(Number(item?.index) || 0)),
      currentReportId: item?.currentReportId ? String(item.currentReportId) : null,
      bootstrap: Boolean(item?.bootstrap),
      adaptiveTiming: String(item?.adaptiveTiming || decision?.timing || 'DUE'),
      adaptiveReason: String(item?.adaptiveReason || decision?.reason || 'EXPLOITATION'),
      adaptiveScore: Number(item?.adaptiveScore || decision?.priority || decision?.score || 0),
      adaptiveAllocationClass: String(
        item?.adaptiveAllocationClass || item?.allocationClass || decision?.allocationClass || adaptiveAllocationClass(decision?.reason)
      )
    };
  }

  function executionCandidateStillValid(candidate, villageId, c, coordination, now = Date.now()) {
    if (!candidate?.coord || !candidate?.targetId) return { valid: false, reason: 'CANDIDATE_INCOMPLETE' };
    const liveState = states(villageId)[candidate.coord] || {};
    if (liveState.pending || liveState.sending) return { valid: false, reason: 'TARGET_IN_FLIGHT' };
    const mapPairs = coordination?.sources?.MAP?.data?.targets || [];
    const mapTargetId = new Map(mapPairs).get(candidate.coord);
    if (String(mapTargetId || '') !== String(candidate.targetId)) return { valid: false, reason: 'MAP_TARGET_CHANGED' };
    if (c.adaptiveEnabled) {
      const store = adaptiveStore(villageId);
      const farm = ensureAdaptiveFarm(store, candidate.coord, coordDistance(candidate.coord));
      if (adaptiveHardSafetyBlocked(liveState, farm, now, c)) return { valid: false, reason: 'ADAPTIVE_HARD_SAFETY' };
      if (!adaptiveRotationEligibility(farm, now, c).eligible) return { valid: false, reason: 'NO_LONGER_ROTATION_ELIGIBLE' };
    } else if (Number(liveState.cooldownUntil || 0) > now) {
      return { valid: false, reason: 'LEGACY_COOLDOWN' };
    }
    return { valid: true, reason: 'LOCAL_FINAL_GATE_OK' };
  }

  function buildExecutionPlanCandidates(eligible, composition, capacity, unitInfo, villageId, c) {
    const accepted = [];
    for (const item of eligible || []) {
      let decision = null;
      if (c.adaptiveEnabled) {
        decision = adaptiveDecisionForTarget(item, composition, unitInfo, villageId, c);
        const informationProbe = ['BOOTSTRAP_NEW', 'EXPLORATION', 'LEARNING', 'FORCED_COVERAGE', 'TREND_CHECK', 'JACKPOT_FOLLOWUP']
          .includes(String(decision?.reason));
        const gate = adaptiveDispatchGate(decision, c.adaptiveMinDispatchEfficiency, informationProbe);
        if (gate.rejected) continue;
      } else {
        decision = {
          reason: 'LEGACY_ROTATION', timing: 'DUE', allocationClass: 'EXPLOIT',
          capacity: hasObservedNumber(capacity) ? Number(capacity) : null,
          certainty: 0, farmRating: 0, prediction: null
        };
      }
      accepted.push(executionCandidateFromItem(item, decision));
    }
    return accepted;
  }

  function persistStochasticExecutionCycle(options) {
    const villageId = String(options?.villageId || currentVillageId());
    const c = options?.config || cfg(villageId);
    const now = Math.max(1, Number(options?.now) || Date.now());
    const candidates = Array.isArray(options?.candidates) ? options.candidates.filter(Boolean) : [];
    const coordination = coordinationState(villageId);
    if (!candidates.length) {
      addDiagnostic('PLANNER', 'PLAN_FAIL', 'NO_CANDIDATES', villageId);
      return null;
    }
    const requiredSources = ['MAP', 'ASSISTANT', 'TEMPLATE', 'CAPACITY'];
    const capacityProof = normalizeCapacityProof(
      options?.capacityProof || capacityProofFromSource(coordination.sources.CAPACITY)
    );
    const capacityContext = {
      sourceVillageId: villageId,

      templateId: String(options?.templateId || ''),
      farmTemplate: c.farmTemplate
    };
    const planningProofAt = now + PLAN_PROOF_MARGIN_MS;

    if (
      !capacityProofUsable(capacityProof, capacityContext, planningProofAt) ||
      !(capacityProof.value > 0)
    ) {
      addDiagnostic(
        'PLANNER',
        'PLAN_FAIL',
        `CAPACITY_UNUSABLE value=${capacityProof.value} source=${capacityProof.source || '—'} ` +
          `remain=${Math.round((Number(capacityProof.freshUntil || 0) - planningProofAt) / 1000)}s ` +
          `context=${capacityProofContextMatches(capacityProof, capacityContext) ? 'OK' : 'MISMATCH'}`,
        villageId
      );
      return null;
    }

    const proofStatus = coordinationProofStatus(
      coordination,
      requiredSources,
      planningProofAt
    );
    if (!proofStatus.valid || !(proofStatus.proofEnd > planningProofAt)) {
      addDiagnostic(
        'PLANNER',
        'PLAN_FAIL',
        `PROOF_WINDOW blocking=${proofStatus.blocking.join(',') || 'UNKNOWN'} · ` +
          Object.entries(proofStatus.details)
            .map(([name, value]) =>
              `${name}=${value.valid ? 'OK' : 'STALE'} ` +
              `remain=${Math.round(Number(value.remainingMs || 0) / 1000)}s ` +
              `status=${value.status} invalidated=${value.invalidated} rev=${value.revision}`
            )
            .join(' · '),
        villageId
      );
      return null;
    }
    const proofEnd = proofStatus.proofEnd;

    const generation = Math.max(1, Number(coordination.generation || 0) + 1);
    const planRevision = Math.max(1, Number(coordination.planRevision || 0) + 1);
    const random = options?.randomSource || createRandomSource(null, 'cycle-id');
    const randomSources = options?.randomSources || (options?.randomSource
      ? { coalescing: random, scheduling: random }
      : {
          coalescing: createRandomSource(null, 'coalescing'),
          scheduling: createRandomSource(null, 'scheduling')
        });
    const cycleId = `${villageId}:${generation}:${Math.trunc(now)}:${random.nextInt(100000, 999999)}`;

    const suppliedRound = options?.executionRound
      ? normalizeExecutionRound(options.executionRound)
      : null;
    const reusableSuppliedRound = Boolean(
      suppliedRound?.executionRoundId &&
      suppliedRound.status === 'OPEN' &&
      suppliedRound.dispatchLimitRemaining > 0 &&
      !suppliedRound.pendingMutation
    );
    const executionRound = reusableSuppliedRound
      ? normalizeExecutionRound({
          ...suppliedRound,
          cycleId,
          generation,
          planRevision,
          status: 'OPEN',
          reason: String(options?.reason || 'successor')
        })
      : normalizeExecutionRound({
          executionRoundId: `${villageId}:R:${Math.trunc(now)}:${random.nextInt(100000, 999999)}`,
          cycleId,
          generation,
          planRevision,
          sourceVillageId: villageId,
          configuredLimit: c.maxSendsPerPass,
          dispatchLimitRemaining: c.maxSendsPerPass,
          createdAt: now,
          status: 'OPEN',
          reason: String(options?.reason || 'nova observation')
        });
    if (!(executionRound.dispatchLimitRemaining > 0)) {
      addDiagnostic(
        'PLANNER',
        'PLAN_FAIL',
        `ROUND_EXHAUSTED id=${executionRound.executionRoundId || '—'} status=${executionRound.status} ` +
          `remaining=${executionRound.dispatchLimitRemaining}`,
        villageId
      );
      return null;
    }
    const budget = Math.max(0, Math.min(executionRound.dispatchLimitRemaining, capacityProof.value));
    const maximum = Math.max(1, Math.min(executionRound.dispatchLimitRemaining, candidates.length));
    const immutableNotBeforeAt = Math.max(now, Number(options?.earliestExecutionAt) || now);
    const maxHoldAt = Math.min(
      proofEnd,
      now + (c.stochasticSchedulingMode === 'IMMEDIATE_EFFICIENCY' ? 10 : 20) * 60000
    );
    const stochasticPlan = generateStochasticPlan({
      cycleId,
      generation,
      planRevision,
      ownerId: RUNTIME.tabId,
      mode: c.stochasticSchedulingMode,
      now,
      earliestExecutionAt: immutableNotBeforeAt,
      latestCheapExecutionAt: proofEnd,
      maxHoldAt,
      knownDispatchBudget: budget,
      readyCandidateCount: candidates.length,
      configuredMaximum: c.maxSendsPerPass,
      randomSources
    }, random);
    if (!(stochasticPlan.executionDueAt >= now) || stochasticPlan.executionDueAt > stochasticPlan.cheapWindowEnd) {
      addDiagnostic(
        'PLANNER',
        'PLAN_FAIL',
        `INVALID_STOCHASTIC_WINDOW due=${stochasticPlan.executionDueAt} ` +
          `start=${stochasticPlan.cheapWindowStart} end=${stochasticPlan.cheapWindowEnd} now=${now}`,
        villageId
      );
      return null;
    }
    const storeRevision = Number(adaptiveStore(villageId).revision) || 0;
    const executionPlan = normalizeExecutionPlan({
      executionRoundId: executionRound.executionRoundId,
      cycleId,
      generation,
      planRevision,
      createdAt: now,
      notBeforeAt: immutableNotBeforeAt,
      sourceVillageId: villageId,
      radius: c.radius,
      farmTemplate: c.farmTemplate,
      templateId: options?.templateId,
      candidates: candidates.slice(0, maximum),
      dispatchLimitRemaining: executionRound.dispatchLimitRemaining,
      capacityProof,
      composition: options?.composition || null,
      compositionAuthoritative: Boolean(options?.compositionAuthoritative),
      transportCapacity: options?.transportCapacity,
      unitInfo: options?.compositionAuthoritative ? (options?.unitInfo || null) : null,
      storeRevision,
      sourceRevisions: Object.fromEntries(requiredSources.map(name => [name, coordination.sources[name].revision])),
      requiredSources,
      reason: String(options?.reason || 'observation cycle')
    });
    coordination.generation = generation;
    coordination.planRevision = planRevision;
    coordination.state = 'WAITING_EXECUTION';
    coordination.ownerId = RUNTIME.tabId;
    coordination.executionDueAt = stochasticPlan.executionDueAt;
    coordination.nextWakeAt = stochasticPlan.executionDueAt;
    coordination.wakeKind = 'EXECUTION';
    coordination.executionRound = executionRound;
    coordination.executionPlan = executionPlan;
    coordination.stochasticPlan = stochasticPlan;
    coordination.reason = executionPlan.reason;
    const saved = saveCoordinationState(coordination, villageId);
    if (!saved) {
      const storageError = RUNTIME.lastStorageErrorByVillage.get(String(villageId || 'unknown')) || {};
      addDiagnostic(
        'PLANNER',
        'PLAN_FAIL',
        `PERSISTENCE_FAILED ${storageError.name || 'Error'} ` +
          `${storageError.message || 'sem mensagem'} ~${Number(storageError.serializedChars || 0)} chars`,
        villageId
      );
      return null;
    }
    addDiagnostic(
      'ESTOCÁSTICO',
      `Ciclo ${cycleId} persistido · ${stochasticPlan.targetProfile}/${stochasticPlan.temporalProfile}.`,
      `coalesce ${stochasticPlan.coalesceTarget} [${stochasticPlan.coalesceLow}–${stochasticPlan.coalesceHigh}] até ${clockTime(stochasticPlan.coalesceUntil)} · ` +
        `janela local válida ${clockTime(stochasticPlan.localWindowStart)}–${clockTime(stochasticPlan.localWindowEnd)} · ` +
        `execução ${new Date(stochasticPlan.executionDueAt).toLocaleTimeString('pt-PT', { hour12: false, fractionalSecondDigits: 3 })} · ` +
        `random ${stochasticPlan.coalescingRandomNamespace}/${stochasticPlan.schedulingRandomNamespace}`,
      villageId
    );
    const reportDeadline = Number(coordination.reportDueAt || 0);
    if (reportDeadline > now && reportDeadline < stochasticPlan.executionDueAt) {
      scheduleAt(reportDeadline, villageId, 'report esperado antes do successor; execução preservada', 'REPORT');
    } else {
      scheduleAt(stochasticPlan.executionDueAt, villageId, `ciclo estocástico ${cycleId}`, 'EXECUTION');
    }
    return { executionRound, executionPlan, stochasticPlan };
  }

  function invalidateExecutionCycle(villageId, reason, nextWakeKind = 'OBSERVATION', nextAt = Date.now()) {
    const coordination = coordinationState(villageId);
    coordination.state = 'WAITING_WORK';
    coordination.executionPlan = null;
    coordination.stochasticPlan = null;
    coordination.executionDueAt = 0;
    coordination.nextWakeAt = Math.max(Date.now(), Number(nextAt) || Date.now());
    coordination.wakeKind = nextWakeKind;
    coordination.reason = String(reason || 'plano invalidado');
    saveCoordinationState(coordination, villageId);
    return scheduleAt(coordination.nextWakeAt, villageId, coordination.reason, nextWakeKind);
  }

  async function executePlannedOccurrence(villageId = currentVillageId()) {
    if (RUNTIME.busy) return;
    villageId = String(villageId || '');
    const c = cfg(villageId);
    if (!villageId || !c.enabled || currentVillageId() !== villageId) return;
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      return;
    }
    if (RUNTIME.hardStopReasonsByVillage.has(villageId)) return;
    try { AntiBotGuard.assertSafe(); } catch (_) { return; }
    if (!acquireLease(villageId)) {
      armLeaseRecovery(villageId, 'execução planeada pertence a outra aba');
      return;
    }

    beginNetworkOccurrence(villageId, 'EXECUTION', 'execution occurrence');
    RUNTIME.busy = true;
    RUNTIME.activeVillageId = villageId;
    let wakeScheduled = false;
    let mutationStarted = false;
    try {
      const coordination = coordinationState(villageId);
      const planDecision = localDependencyPlanner(coordination, 'EXECUTION', Date.now());
      if (planDecision.action === 'WAIT') {
        const nextAt = Math.max(Date.now() + 1, Number(planDecision.nextWakeAt) || Date.now() + CAPACITY_ZERO_TTL_MS);
        addDiagnostic('PLANNER', `Execution wake adiado: ${planDecision.reason}.`, '0 GET · 0 POST', villageId);
        wakeScheduled = invalidateExecutionCycle(
          villageId,
          planDecision.reason,
          planDecision.wakeKind || 'CAPACITY',
          nextAt
        );
        return;
      }
      if (planDecision.action === 'RESOLVE') {
        addDiagnostic(
          'PLANNER',
          'Execution wake cancelado antes da rede: proof obrigatória expirou.',
          `${planDecision.required.join(' + ')} · 0 GET · 0 POST`,
          villageId
        );
        wakeScheduled = invalidateExecutionCycle(
          villageId,
          `proofs expiradas: ${planDecision.required.join(', ')}`,
          planDecision.required.includes('CAPACITY') ? 'CAPACITY' : 'OBSERVATION',
          Date.now() + 250
        );
        return;
      }
      if (planDecision.action !== 'EXECUTE') {
        addDiagnostic('PLANNER', 'Execution wake sem trabalho local válido.', `${planDecision.reason} · 0 GET · 0 POST`, villageId);
        wakeScheduled = invalidateExecutionCycle(
          villageId, planDecision.reason, 'MAINTENANCE',
          Date.now() + Math.max(15, Number(c.retrySeconds) || DEFAULTS.retrySeconds) * 1000
        );
        return;
      }
      const executionPlan = coordination.executionPlan;
      const stochasticPlan = coordination.stochasticPlan;
      let executionRound = normalizeExecutionRound(coordination.executionRound);
      if (
        !executionRound.executionRoundId ||
        executionRound.executionRoundId !== executionPlan.executionRoundId ||
        !(executionRound.dispatchLimitRemaining > 0)
      ) {
        addDiagnostic('PLANNER', 'ExecutionRound inválida ou esgotada.', '0 GET · 0 POST', villageId);
        wakeScheduled = invalidateExecutionCycle(
          villageId, 'execution round encerrada', 'MAINTENANCE',
          Date.now() + Math.max(15, Number(c.retrySeconds) || DEFAULTS.retrySeconds) * 1000
        );
        return;
      }
      if (Number(executionPlan.notBeforeAt || 0) > Date.now()) {
        wakeScheduled = scheduleAt(
          Number(executionPlan.notBeforeAt),
          villageId,
          'immutable not-before/attempt gap ainda não venceu',
          'EXECUTION'
        );
        return;
      }
      if (Number(stochasticPlan.executionDueAt) > Date.now() + 250) {
        wakeScheduled = scheduleAt(stochasticPlan.executionDueAt, villageId, 'plano persistido ainda não venceu', 'EXECUTION');
        return;
      }
      if (
        executionPlan.sourceVillageId !== villageId ||
        executionPlan.radius !== c.radius ||
        executionPlan.farmTemplate !== c.farmTemplate
      ) {
        addDiagnostic('PLANNER', 'Plano cancelado por alteração local de contexto.', '0 GET · 0 POST', villageId);
        wakeScheduled = invalidateExecutionCycle(villageId, 'settings/contexto alterados', 'OBSERVATION', Date.now() + 250);
        return;
      }

      const staleRevision = executionPlan.requiredSources.find(name =>
        Number(coordination.sources[name]?.revision || 0) !== Number(executionPlan.sourceRevisions?.[name] || 0)
      );
      if (staleRevision) {
        addDiagnostic('PLANNER', 'Plano cancelado por revision fencing.', `${staleRevision} mudou · 0 GET · 0 POST`, villageId);
        wakeScheduled = invalidateExecutionCycle(villageId, `revision ${staleRevision} mudou`, 'OBSERVATION', Date.now() + 250);
        return;
      }

      let candidate = null;
      let localReason = 'NO_CANDIDATE';
      for (const item of executionPlan.candidates) {
        const validation = executionCandidateStillValid(item, villageId, c, coordination, Date.now());
        if (validation.valid) {
          candidate = item;
          break;
        }
        localReason = validation.reason;
      }
      if (!candidate) {
        addDiagnostic('PLANNER', 'Todos os candidatos ficaram inválidos localmente.', `${localReason} · 0 GET · 0 POST`, villageId);
        wakeScheduled = invalidateExecutionCycle(
          villageId, `candidatos inválidos: ${localReason}`, 'MAINTENANCE',
          Date.now() + Math.max(15, Number(c.retrySeconds) || DEFAULTS.retrySeconds) * 1000
        );
        return;
      }

      let liveDecision = candidate.decision;
      if (c.adaptiveEnabled) {
        const decisionItem = { ...candidate, adaptiveTiming: candidate.adaptiveTiming, adaptiveReason: candidate.adaptiveReason };
        liveDecision = adaptiveDecisionForTarget(
          decisionItem,
          executionPlan.compositionAuthoritative ? executionPlan.composition : null,
          executionPlan.unitInfo,
          villageId,
          c
        );
        const informationProbe = ['BOOTSTRAP_NEW', 'EXPLORATION', 'LEARNING', 'FORCED_COVERAGE', 'TREND_CHECK', 'JACKPOT_FOLLOWUP']
          .includes(String(liveDecision?.reason));
        const gate = adaptiveDispatchGate(liveDecision, c.adaptiveMinDispatchEfficiency, informationProbe);
        if (gate.rejected) {
          addDiagnostic('PLANNER', `${candidate.coord}: gate económico mudou antes do POST.`, '0 GET · 0 POST', villageId);
          wakeScheduled = invalidateExecutionCycle(
            villageId, 'gate final rejeitou candidato', 'MAINTENANCE',
            Date.now() + Math.max(15, Number(c.retrySeconds) || DEFAULTS.retrySeconds) * 1000
          );
          return;
        }
      }

      const finalCoordination = coordinationState(villageId);
      const finalCapacityProof = capacityProofFromSource(finalCoordination.sources.CAPACITY);
      const finalCapacityContext = {
        sourceVillageId: villageId,
        templateId: executionPlan.templateId,
        farmTemplate: executionPlan.farmTemplate
      };
      if (!capacityProofUsable(finalCapacityProof, finalCapacityContext, Date.now()) || !(finalCapacityProof.value > 0)) {
        addDiagnostic('PLANNER', 'Final gate bloqueou POST por CapacityProof insuficiente.', '0 GET · 0 POST', villageId);
        wakeScheduled = invalidateExecutionCycle(
          villageId,
          finalCapacityProof?.value === 0 ? 'CAPACITY_EXHAUSTED' : 'CAPACITY_PROOF_STALE',
          'CAPACITY',
          finalCapacityProof?.freshUntil > Date.now() ? finalCapacityProof.freshUntil : Date.now() + 250
        );
        return;
      }
      if (!mapSnapshotFreshness(villageId, c).fresh) {
        addDiagnostic('PLANNER', 'Final gate bloqueou POST por autorização MAP stale.', '0 GET · 0 POST', villageId);
        wakeScheduled = invalidateExecutionCycle(villageId, 'MAP_AUTHORIZATION_STALE', 'OBSERVATION', Date.now() + 250);
        return;
      }

      AntiBotGuard.assertSafe();
      renewLease(villageId);
      assertVillageContext(villageId);
      const working = coordinationState(villageId);
      working.state = 'EXECUTING';
      working.ownerId = RUNTIME.tabId;
      working.reason = `POST único do ciclo ${executionPlan.cycleId}`;
      requireStored(Boolean(saveCoordinationState(working, villageId)), 'estado EXECUTING');

      beginSendAttempt(candidate.coord, candidate.currentReportId, villageId, candidate.bootstrap);
      mutationStarted = true;
      let data;
      try {
        assertAccountNetworkAllowed();
        recordNetworkRequest(
          villageId,
          'POST',
          buildFarmSendEndpoint(villageId),
          'mutation autorizada pelo final gate',
          'EXECUTION'
        );
        data = await postFarm(candidate.targetId, executionPlan.templateId, villageId);
      } catch (err) {
        if (sendFailureIsUncertain(err)) {
          markSendUncertain(candidate.coord, villageId, err?.message || 'mutation ambígua', candidate.bootstrap);
          const unknown = coordinationState(villageId);

          executionRound = normalizeExecutionRound({
            ...executionRound,
            status: 'UNKNOWN',
            pendingMutation: {
              cycleId: executionPlan.cycleId,
              coord: candidate.coord,
              targetId: candidate.targetId,
              startedAt: Date.now()
            },
            reason: 'mutation ambígua; ceiling ainda não consumido'
          });
          unknown.state = 'UNKNOWN';
          unknown.executionRound = executionRound;
          unknown.executionPlan = null;
          unknown.stochasticPlan = null;
          unknown.executionDueAt = 0;
          unknown.reconcileDueAt = Date.now() + 5 * 60000;
          unknown.nextWakeAt = unknown.reconcileDueAt;
          unknown.wakeKind = 'RECONCILIATION';
          unknown.reason = 'mutation ambígua; nenhuma repetição antes da reconciliação';
          requireStored(Boolean(saveCoordinationState(unknown, villageId)), 'estado UNKNOWN');
          wakeScheduled = scheduleAt(unknown.reconcileDueAt, villageId, unknown.reason, 'RECONCILIATION');
        } else {
          rollbackSendAttempt(candidate.coord, villageId, err?.message || 'pedido rejeitado');
        }
        throw err;
      }

      const verdict = classifyFarmResponse(data);
      if (verdict.kind === 'protection') {
        rollbackSendAttempt(candidate.coord, villageId, verdict.message);
        AntiBotGuard.stop('Servidor devolveu resposta de proteção anti-bot');
        return;
      }
      if (verdict.kind === 'no-units' || verdict.kind === 'rejected') {
        rollbackSendAttempt(candidate.coord, villageId, verdict.message);
        const observedAt = Date.now();
        if (verdict.kind === 'no-units') {
          const zeroProof = serverNoUnitsCapacityProof(executionPlan, villageId, observedAt);
          persistCapacityProof(villageId, zeroProof, verdict.message);
          wakeScheduled = invalidateExecutionCycle(
            villageId,
            'CAPACITY_EXHAUSTED; aguarda expiry sem POST experimental',
            'CAPACITY',
            zeroProof.freshUntil
          );
        } else {
          touchCoordinationSource(villageId, 'CAPACITY', {
            status: 'INVALID', observedAt, freshUntil: 0, invalidated: true,
            reason: verdict.message, data: null
          });
          wakeScheduled = invalidateExecutionCycle(villageId, verdict.message, 'OBSERVATION', observedAt + 250);
        }
        return;
      }
      if (verdict.kind !== 'success') {
        markSendUncertain(candidate.coord, villageId, verdict.message || 'resposta sem confirmação', candidate.bootstrap);
        const unknown = coordinationState(villageId);
        executionRound = normalizeExecutionRound({
          ...executionRound,
          status: 'UNKNOWN',
          pendingMutation: {
            cycleId: executionPlan.cycleId,
            coord: candidate.coord,
            targetId: candidate.targetId,
            startedAt: Date.now()
          },
          reason: 'resposta do POST não inequívoca; ceiling preservado'
        });
        unknown.state = 'UNKNOWN';
        unknown.executionRound = executionRound;
        unknown.executionPlan = null;
        unknown.stochasticPlan = null;
        unknown.executionDueAt = 0;
        unknown.reconcileDueAt = Date.now() + 5 * 60000;
        unknown.nextWakeAt = unknown.reconcileDueAt;
        unknown.wakeKind = 'RECONCILIATION';
        unknown.reason = 'resposta do POST não inequívoca';
        saveCoordinationState(unknown, villageId);
        wakeScheduled = scheduleAt(unknown.reconcileDueAt, villageId, unknown.reason, 'RECONCILIATION');
        return;
      }

      AntiBotGuard.assertSafe();
      const mapCount = coordination.sources.MAP?.data?.targets?.length || targetCoords(villageId).length;
      markSent(
        candidate.coord,
        candidate.currentReportId,
        candidate.index,
        villageId,
        mapCount,
        executionPlan.farmTemplate,
        candidate.bootstrap
      );
      recordAdaptiveDispatch(
        candidate,
        executionPlan.compositionAuthoritative ? executionPlan.composition : null,
        executionPlan.transportCapacity,
        executionPlan.unitInfo,
        liveDecision || { reason: 'LEGACY_ROTATION' },
        villageId,
        executionPlan.farmTemplate
      );
      RUNTIME.adaptiveSnapshotByVillage.delete(villageId);
      touchCoordinationSource(villageId, 'EXECUTION', {
        status: 'READY', observedAt: Date.now(), freshUntil: Date.now(), invalidated: false,
        reason: 'POST confirmado', data: { coord: candidate.coord, cycleId: executionPlan.cycleId }
      });
      info(candidate.bootstrap
        ? `Enviado ${executionPlan.farmTemplate} → nova bárbara ${candidate.coord}.`
        : `Enviado ${executionPlan.farmTemplate} → ${candidate.coord}.`);

      const dispatchStore = adaptiveStore(villageId);
      const confirmedDispatch = [...(dispatchStore.dispatches || [])]
        .reverse()
        .find(item => item.targetCoord === candidate.coord);
      const reportBase = Math.max(
        Date.now() + 60000,
        Number(confirmedDispatch?.expectedReportCheckAt || confirmedDispatch?.expectedArrivalAt || 0)
      );
      const confirmedReportDueAt = reportBase + createRandomSource(null, 'report-scheduling')
        .timestampBetween(60000, 5 * 60000);

      // Só uma mutation confirmada consome o teto operacional da ronda.
      executionRound = consumeConfirmedDispatch(executionRound);
      const confirmedState = coordinationState(villageId);
      confirmedState.executionRound = executionRound;
      const previousReportDueAt = Number(confirmedState.reportDueAt || 0);
      confirmedState.reportDueAt = previousReportDueAt > Date.now()
        ? Math.min(previousReportDueAt, confirmedReportDueAt)
        : confirmedReportDueAt;
      requireStored(Boolean(saveCoordinationState(confirmedState, villageId)), 'ExecutionRound após POST confirmado');

      const responseAt = Date.now();
      const serverUnits = normalizeUnitCounts(data?.current_units, true);
      const previousCapacityProof = capacityProofFromSource(coordination.sources.CAPACITY) || executionPlan.capacityProof;
      const nextCapacityProof = capacityProofAfterConfirmedPost(
        previousCapacityProof,
        serverUnits,
        executionPlan,
        responseAt
      );
      if (nextCapacityProof) {
        persistCapacityProof(villageId, nextCapacityProof, nextCapacityProof.source);
      } else {
        invalidateCapacityProofAfterMutation(villageId, executionPlan, responseAt);
      }
      if (nextCapacityProof?.source === 'POST_CURRENT_UNITS') {
        RUNTIME.lastTroopSnapshotByVillage.set(villageId, { units: serverUnits, source: 'POST_CURRENT_UNITS', at: Date.now() });
      }

      const remaining = executionPlan.candidates.filter(item => item.coord !== candidate.coord);
      const capacityContext = {
        sourceVillageId: villageId,
        templateId: executionPlan.templateId,
        farmTemplate: executionPlan.farmTemplate
      };
      const successorBudget = successorDispatchBudget(
        executionRound,
        nextCapacityProof,
        remaining.length,
        capacityContext
      );
      if (successorBudget > 0 && remaining.length) {
        const successor = persistStochasticExecutionCycle({
          villageId,
          config: c,
          candidates: remaining,
          templateId: executionPlan.templateId,
          executionRound,
          capacityProof: nextCapacityProof,
          composition: executionPlan.composition,
          compositionAuthoritative: executionPlan.compositionAuthoritative,
          transportCapacity: executionPlan.transportCapacity,
          unitInfo: executionPlan.unitInfo,
          earliestExecutionAt: Date.now() + Math.max(0, Number(c.attemptGapMs) || 0),
          reason: `successor local de ${executionPlan.cycleId}`
        });
        wakeScheduled = Boolean(successor);
        if (successor) {
          addDiagnostic(
            'REQUESTS',
            `Successor ${successor.executionPlan.cycleId} na ronda ${executionRound.executionRoundId}.`,
            `${nextCapacityProof.source} · budget ${successorBudget} · 0 GET · occurrence autoriza no máximo 1 POST`,
            villageId
          );
        }
      }

      if (
        !wakeScheduled &&
        !nextCapacityProof &&
        executionRound.dispatchLimitRemaining > 0 &&
        remaining.length > 0
      ) {
        const needsCapacity = coordinationState(villageId);
        needsCapacity.state = 'WAITING_WORK';
        needsCapacity.executionRound = executionRound;
        needsCapacity.executionPlan = null;
        needsCapacity.stochasticPlan = null;
        needsCapacity.executionDueAt = 0;
        needsCapacity.nextWakeAt = responseAt + 250;
        needsCapacity.wakeKind = 'CAPACITY';
        needsCapacity.reason = 'mutation invalidou CAPACITY; successor real requer apenas nova proof';
        saveCoordinationState(needsCapacity, villageId);
        wakeScheduled = scheduleAt(
          needsCapacity.nextWakeAt,
          villageId,
          needsCapacity.reason,
          'CAPACITY'
        );
      }

      if (!wakeScheduled) {
        const done = coordinationState(villageId);
        done.state = 'WAITING_WORK';
        done.executionPlan = null;
        done.stochasticPlan = null;
        done.executionDueAt = 0;
        done.executionRound = normalizeExecutionRound({
          ...executionRound,
          status: executionRound.dispatchLimitRemaining > 0 && remaining.length ? 'OPEN' : 'CLOSED',
          reason: remaining.length ? 'sem CapacityProof utilizável para successor' : 'sem candidatos restantes'
        });
        done.reportDueAt = confirmedReportDueAt;
        done.nextWakeAt = confirmedReportDueAt;
        done.wakeKind = 'REPORT';
        done.reason = 'janela esperada do report; sem polling frequente';
        saveCoordinationState(done, villageId);
        wakeScheduled = scheduleAt(confirmedReportDueAt, villageId, done.reason, 'REPORT');
      }
    } catch (err) {
      const code = String(err?.code || '');
      if (err instanceof ReferenceError || err instanceof TypeError) throw err;
      if (['BOT_PROTECTION_ACTIVE', 'HTTP_403', 'HTTP_429'].includes(code)) {
        if (code !== 'BOT_PROTECTION_ACTIVE') coordinatedHardStop(code, villageId);
      } else if (code === 'LOGIN_REQUIRED') {
        coordinatedHardStop('sessão expirada / login necessário', villageId);
      } else if (code !== 'UNEXPECTED_SEND_RESPONSE') {
        console.error('[AutoFarmRadius] execution occurrence', err);
        info(`Execução planeada interrompida: ${err?.message || err}`, true);
      }
    } finally {
      releaseLease(villageId);
      RUNTIME.busy = false;
      RUNTIME.activeVillageId = null;
      endNetworkOccurrence(villageId);
      renderPanel();
      if (!wakeScheduled && cfg(villageId).enabled && !RUNTIME.hardStopReasonsByVillage.has(villageId)) {
        const nextAt = Date.now() + Math.max(15, Number(c.retrySeconds) || DEFAULTS.retrySeconds) * 1000;
        invalidateExecutionCycle(
          villageId,
          mutationStarted ? 'fim de occurrence sem successor' : 'execution wake sem mutation',
          'MAINTENANCE',
          nextAt
        );
      }
    }
  }

  async function runReportOccurrence(villageId = currentVillageId(), wakeKind = 'REPORT') {
    if (RUNTIME.busy) return;
    villageId = String(villageId || '');
    const c = cfg(villageId);
    if (!villageId || !c.enabled || currentVillageId() !== villageId) return;
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      return;
    }
    if (!acquireLease(villageId)) {
      armLeaseRecovery(villageId, `${wakeKind} pertence a outra aba`);
      return;
    }
    beginNetworkOccurrence(villageId, wakeKind, 'report/reconciliation occurrence');
    RUNTIME.busy = true;
    RUNTIME.activeVillageId = villageId;
    let wakeScheduled = false;
    try {
      const coordination = coordinationState(villageId);
      const map = new Map(coordination.sources.MAP?.data?.targets || []);
      const rows = new Map(coordination.sources.ASSISTANT?.data?.rows || []);
      if (!map.size) {
        addDiagnostic('PLANNER', `${wakeKind}: sem snapshot MAP local reutilizável.`, '0 GET · adiado para OBSERVATION', villageId);
        wakeScheduled = invalidateExecutionCycle(villageId, 'MAP local indisponível para report work', 'OBSERVATION', Date.now() + 250);
        return;
      }
      AntiBotGuard.assertSafe();
      await ingestAdaptiveReports(rows, map, villageId, c);
      touchCoordinationSource(villageId, 'REPORT', {
        status: 'READY', observedAt: Date.now(),
        freshUntil: Date.now() + Math.max(5 * 60000, c.retrySeconds * 1000),
        invalidated: false, reason: wakeKind, data: { ledgerRevision: adaptiveStore(villageId).revision }
      });
      addDiagnostic('REQUESTS', `${wakeKind} concluído sem MAP/ASSISTANT refresh.`, 'apenas backlog/índice/detalhes necessários', villageId);
      if (wakeKind === 'RECONCILIATION' && coordination.executionRound?.pendingMutation) {
        const pendingMutation = coordination.executionRound.pendingMutation;
        const targetState = states(villageId)[pendingMutation.coord] || {};
        const reportProvesSent = Number(targetState.lastReportAt || 0) >= Number(pendingMutation.startedAt || 0) ||
          (!targetState.pending && !['send-uncertain', 'sending', 'pending-timeout'].includes(String(targetState.lastResult || '')));
        const outcome = reportProvesSent
          ? 'SENT'
          : (String(targetState.lastResult || '') === 'send-rejected' ? 'NOT_SENT' : 'STILL_UNKNOWN');
        const reconciled = reconcileExecutionRoundOutcome(coordination.executionRound, outcome);
        const next = coordinationState(villageId);
        next.executionRound = reconciled;
        if (outcome === 'STILL_UNKNOWN') {
          next.state = 'UNKNOWN';
          next.reconcileDueAt = Date.now() + 5 * 60000;
          next.nextWakeAt = next.reconcileDueAt;
          next.wakeKind = 'RECONCILIATION';
          next.reason = 'mutation continua UNKNOWN; sem blind retry';
          saveCoordinationState(next, villageId);
          wakeScheduled = scheduleAt(next.reconcileDueAt, villageId, next.reason, 'RECONCILIATION');
        } else {
          next.state = 'WAITING_WORK';
          next.reconcileDueAt = 0;
          next.nextWakeAt = Date.now() + 250;
          next.wakeKind = 'CAPACITY';
          next.reason = `reconciliação ${outcome}; reavaliar capacity antes de qualquer successor`;
          saveCoordinationState(next, villageId);
          wakeScheduled = scheduleAt(next.nextWakeAt, villageId, next.reason, 'CAPACITY');
        }
      }
    } catch (err) {
      if (err instanceof ReferenceError || err instanceof TypeError) throw err;
      if (['BOT_PROTECTION_ACTIVE', 'HTTP_403', 'HTTP_429', 'LOGIN_REQUIRED'].includes(String(err?.code || ''))) {
        if (err?.code !== 'BOT_PROTECTION_ACTIVE') coordinatedHardStop(err?.message || err?.code, villageId);
      } else {
        addDiagnostic('REPORT', 'Leitura específica de reports falhou; mantida para retry.', err?.message || String(err), villageId);
      }
    } finally {
      releaseLease(villageId);
      RUNTIME.busy = false;
      RUNTIME.activeVillageId = null;
      endNetworkOccurrence(villageId);
      if (!wakeScheduled && wakeKind === 'RECONCILIATION') {
        const stillUnknown = coordinationState(villageId);
        if (stillUnknown.executionRound?.pendingMutation) {
          stillUnknown.state = 'UNKNOWN';
          stillUnknown.reconcileDueAt = Date.now() + 5 * 60000;
          stillUnknown.nextWakeAt = stillUnknown.reconcileDueAt;
          stillUnknown.wakeKind = 'RECONCILIATION';
          stillUnknown.reason = 'reconciliação incompleta; sem blind retry';
          saveCoordinationState(stillUnknown, villageId);
          wakeScheduled = scheduleAt(stillUnknown.reconcileDueAt, villageId, stillUnknown.reason, 'RECONCILIATION');
        }
      }
      if (!wakeScheduled) {
        const preserved = coordinationState(villageId);
        if (
          preserved.executionPlan &&
          preserved.stochasticPlan &&
          Number(preserved.executionDueAt || preserved.stochasticPlan.executionDueAt || 0) > 0
        ) {
          const executionAt = Math.max(
            Date.now(),
            Number(preserved.executionPlan.notBeforeAt || 0),
            Number(preserved.stochasticPlan.executionDueAt || preserved.executionDueAt || 0)
          );
          wakeScheduled = scheduleAt(
            executionAt,
            villageId,
            'successor EXECUTION preservado após trabalho de reports',
            'EXECUTION'
          );
        }
      }
      if (!wakeScheduled) {
        const nextAt = nextAutomaticPassAt(Date.now(), cfg(villageId).adaptiveEnabled ? adaptiveStore(villageId) : null, cfg(villageId));
        scheduleAt(nextAt, villageId, 'manutenção após trabalho de reports', 'MAINTENANCE');
      }
      renderPanel();
    }
  }

  function dispatchScheduledWake(villageId = currentVillageId(), wakeKind = 'MAINTENANCE') {
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      return false;
    }
    const kind = SCHEDULER_WAKE_KINDS.includes(String(wakeKind)) ? String(wakeKind) : 'MAINTENANCE';
    if (kind === 'EXECUTION') return executePlannedOccurrence(villageId);
    if (kind === 'REPORT' || kind === 'RECONCILIATION') return runReportOccurrence(villageId, kind);
    const coordination = coordinationState(villageId);
    const dependencyPlan = localDependencyPlanner(coordination, kind, Date.now());
    if (dependencyPlan.action === 'WAIT') {
      const nextAt = Math.max(Date.now() + 1, Number(dependencyPlan.nextWakeAt) || 0);
      addDiagnostic('PLANNER', `${kind}: ${dependencyPlan.reason}.`, '0 GET · 0 POST', villageId);
      return scheduleAt(nextAt, villageId, dependencyPlan.reason, dependencyPlan.wakeKind || kind);
    }
    if (dependencyPlan.action === 'NOTHING') {
      const dueCandidates = SOURCE_NAMES
        .map(name => Number(coordination.sources[name]?.freshUntil || 0))
        .filter(at => at > Date.now())
        .sort((a, b) => a - b);
      const nextAt = dueCandidates[0] || Date.now() + Math.max(15, Number(cfg(villageId).retrySeconds) || 90) * 1000;
      addDiagnostic('PLANNER', `${kind}: nenhuma dependency vencida.`, '0 GET · 0 POST', villageId);
      return scheduleAt(nextAt, villageId, `${kind}: ${dependencyPlan.reason}`, kind);
    }
    addDiagnostic(

      'PLANNER',
      `${kind}: dependencies autorizadas ${dependencyPlan.required.join(' + ')}.`,
      dependencyPlan.reason,
      villageId
    );
    const requestedSources = [...new Set([
      ...dependencyPlan.required,
      ...dependencyPlan.requests.map(request => request.source)
    ])].filter(name => SOURCE_NAMES.includes(name));
    return runPass({
      requiredSources: requestedSources,
      wakeKind: kind,
      reason: dependencyPlan.reason
    });
  }

  // ---------------------------------------------------------------------------
  // LOOP
  // ---------------------------------------------------------------------------

  async function runPass(options = {}) {
    if (RUNTIME.busy) return;

    const villageId = currentVillageId();
    if (!villageId) {
      info('Não foi possível identificar a aldeia atual.', true);
      return;
    }
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      return;
    }

    const c = cfg(villageId);
    const requestedSources = Array.isArray(options?.requiredSources)
      ? options.requiredSources.filter(name => SOURCE_NAMES.includes(String(name))).map(String)
      : ['MAP', 'ASSISTANT', 'REPORT'];
    const requiredSources = new Set(requestedSources);
    const startingCoordination = coordinationState(villageId);
    const startingRound = startingCoordination.executionRound
      ? normalizeExecutionRound(startingCoordination.executionRound)
      : null;

    const continueExistingRound = Boolean(
      String(options?.wakeKind || '') === 'CAPACITY' &&
      startingRound?.executionRoundId &&
      startingRound.status === 'OPEN' &&
      startingRound.dispatchLimitRemaining > 0 &&
      !startingRound.pendingMutation
    );

    if (RUNTIME.hardStopReasonsByVillage.has(String(villageId))) {
      info(`PARADO: ${RUNTIME.hardStopReasonsByVillage.get(String(villageId)) || 'bloqueio de segurança ativo'}.`, true);
      return;
    }

    if (!c.enabled) {
      info('Parado');
      return;
    }

    try {
      AntiBotGuard.assertSafe();
    } catch (_) {
      return;
    }

    if (!acquireLease(villageId)) {
      info('Outra aba já está a executar esta aldeia. Esta aba fica passiva e segue o agendamento partilhado.');
      addDiagnostic('AGENDA', 'Lease ocupado por outra aba; sem criar novo nextRunAt.', '', villageId);
      armLeaseRecovery(villageId, 'aguardar aba proprietária');
      return;
    }

    beginNetworkOccurrence(villageId, String(options?.wakeKind || 'OBSERVATION'), String(options?.reason || 'runPass'));
    RUNTIME.busy = true;
    RUNTIME.activeVillageId = villageId;
    let retainedExecutionWake = false;
    const passStartedAt = Date.now();
    const observationCoordination = coordinationState(villageId);
    observationCoordination.state = 'WAITING_WORK';
    observationCoordination.ownerId = RUNTIME.tabId;
    observationCoordination.executionPlan = null;
    observationCoordination.stochasticPlan = null;
    observationCoordination.executionDueAt = 0;
    observationCoordination.executionRound = continueExistingRound
      ? startingRound
      : null;
    observationCoordination.reason = 'observation occurrence';
    if (!saveCoordinationState(observationCoordination, villageId)) {
      releaseLease(villageId);
      RUNTIME.busy = false;
      RUNTIME.activeVillageId = null;
      stopForSchedulerPersistence(villageId, 'Não foi possível persistir o início da observation occurrence.');
      return;
    }
    if (!updateSchedulerState(villageId, { nextRunAt: 0, nextWakeAt: 0, wakeKind: 'OBSERVATION', lastPassStartedAt: passStartedAt })) {
      releaseLease(villageId);
      RUNTIME.busy = false;
      RUNTIME.activeVillageId = null;
      stopForSchedulerPersistence(villageId, 'Não foi possível persistir o início da passagem.');
      return;
    }
    addDiagnostic('PASSAGEM', 'Passagem iniciada.', `modelo ${c.farmTemplate} · raio ${c.radius}`, villageId);
    renderPanel();

    try {
      assertVillageContext(villageId);
      info(
        `Ocorrência ${String(options?.wakeKind || 'OBSERVATION')} · modelo ${c.farmTemplate} · raio ${c.radius}. ` +
        `A resolver apenas: ${[...requiredSources].join(' + ') || 'dependências locais'}.`
      );

      // Revalida o mapa UMA vez no início de cada passagem. Assim a lista/ownerId não
      // fica até 5 minutos obsoleta, sem multiplicar pedidos com uma consulta por alvo.
      // A ordem do Map fica por distância.
      const persistedMapSource = startingCoordination.sources.MAP;
      const canReuseMap =
        !requiredSources.has('MAP') &&
        mapAuthorizationFreshForPlanning(persistedMapSource) &&
        Number(persistedMapSource?.data?.radius) === Number(c.radius) &&
        Array.isArray(persistedMapSource?.data?.targets);
      let map = canReuseMap
        ? new Map(persistedMapSource.data.targets)
        : await getVillageMap(villageId, {
            rebuildSubset: true,
            requireFreshWorld: true
          });
      const targets = [...map.keys()];
      if (!canReuseMap) {
        const previousTargets = JSON.stringify(persistedMapSource?.data?.targets || []);
        const nextTargets = JSON.stringify(serializableMapTargets(map));
        // Um conjunto diferente torna a ausência no Assistente e o histórico das
        // coordenadas novas dependências reais. Só nesse caso amplia o plano.
        if (previousTargets !== nextTargets) {
          requiredSources.add('ASSISTANT');
          requiredSources.add('REPORT');
        }
        addDiagnostic('MAPA', 'Mapa atualizado.', `${targets.length} bárbaras no raio ${c.radius}`, villageId);
      } else {
        addDiagnostic('MAPA', 'Snapshot do mapa reutilizado.', `${targets.length} bárbaras · 0 GET`, villageId);
        recordAvoidedRequest(villageId, 'MAP', 'WorldMapSource/MapSubset frescos');
      }

      if (!targets.length) {
        RUNTIME.lastEligibleByVillage.set(String(villageId), 0);
        RUNTIME.lastBootstrapByVillage.set(String(villageId), 0);
        RUNTIME.lastQueueBreakdownByVillage.set(String(villageId), {
          total: 0, dueCandidates: 0, earlyCandidates: 0, selectedCandidates: 0,
          pending: 0, safety: 0, minRest: 0, rowDisabled: 0,
          rotationMode: c.adaptiveEnabled ? 'WAITING' : 'LEGACY', nextDueAt: null
        });
        persistVisualScanSnapshot([], new Map(), map, null, states(villageId), villageId, c);
        info(`Não foram encontradas bárbaras num raio ${c.radius}.`);
        return;
      }

      // Depois procura relatórios/linhas apenas para os alvos atuais.
      const liveCoordinationAfterMap = coordinationState(villageId);
      const persistedAssistantSource = liveCoordinationAfterMap.sources.ASSISTANT;
      const canReuseAssistant =
        !requiredSources.has('ASSISTANT') &&
        coordinationSourceFreshForPlanning(persistedAssistantSource) &&
        Number(persistedAssistantSource?.data?.radius) === Number(c.radius) &&
        Array.isArray(persistedAssistantSource?.data?.rows);
      const rows = canReuseAssistant
        ? new Map(persistedAssistantSource.data.rows)
        : await loadAllFarmRows(villageId, targets);
      if (!canReuseAssistant) {
        touchCoordinationSource(villageId, 'ASSISTANT', {
          status: 'READY', observedAt: Date.now(),
          freshUntil: Date.now() + Math.min(5 * 60000, Math.max(45000, Number(c.retrySeconds) * 1000)),
          invalidated: false, inFlight: false, reason: 'Assistente lido/DOM enriquecido',
          data: { radius: c.radius, rows: serializableAssistantRows(rows) }
        });
        addDiagnostic(
          'ASSISTENTE',
          'Leitura do Assistente concluída.',
          `${rows.size} row(s) relevantes · ${RUNTIME.lastScan?.pagesScanned ?? '—'} pág.`,
          villageId
        );
      } else {
        addDiagnostic('ASSISTENTE', 'Snapshot do Assistente reutilizado.', `${rows.size} row(s) · 0 GET`, villageId);
        recordAvoidedRequest(villageId, 'ASSISTANT', 'AssistantSource fresca');
      }

      AntiBotGuard.assertSafe();
      assertVillageContext(villageId);

      const unitSpeed = await getConservativeFarmUnitSpeedMinPerField(villageId);
      const pendingTimeoutMs = effectivePendingTimeoutMs(c, unitSpeed);

      const now = Date.now();
      const s = applyReportUpdates(rows, now, villageId, targets, pendingTimeoutMs);

      // v2.0: ingestão adaptativa separada do cooldown operacional.
      // Aprende apenas com reports/resultados reais; estimativas de recursos do Assistente não entram no modelo.
      const reportSource = coordinationState(villageId).sources.REPORT;
      const reportStoreBeforeIngest = adaptiveStore(villageId);
      const reportWorkDue = reportIndexWorkDue(
        reportStoreBeforeIngest.reportIndex,
        Date.now(),
        new Set(map.keys())
      );
      const canReuseReports = !requiredSources.has('REPORT') &&
        coordinationSourceFresh(reportSource) &&
        !reportWorkDue;
      if (!canReuseReports) {
        await ingestAdaptiveReports(rows, map, villageId, c);
        touchCoordinationSource(villageId, 'REPORT', {
          status: 'READY', observedAt: Date.now(),
          freshUntil: Date.now() + Math.max(5 * 60000, Number(c.retrySeconds) * 1000),
          invalidated: false, inFlight: false, reason: 'ledger/backlog sincronizado',
          data: { ledgerRevision: adaptiveStore(villageId).revision }
        });
      } else {
        addDiagnostic('REPORTS', 'Ledger ainda fresco; ingestão reutilizada.', '0 GET de índice/detalhe', villageId);
        recordAvoidedRequest(villageId, 'REPORT', 'ReportSource fresca e índice completo/não devido');
      }
      const adaptiveForPass = c.adaptiveEnabled ? adaptiveStore(villageId) : null;

      // A leitura/telemetria acima é independente da estratégia e da disponibilidade
      // do template. Só a partir daqui o template A/B passa a ser obrigatório para
      // construir a fila de execução e autorizar POSTs.
      const farmTemplate = c.farmTemplate;

      const scanForThisVillage = RUNTIME.lastScan?.villageId === String(villageId)
        ? RUNTIME.lastScan
        : null;

      const farmCache = RUNTIME.farmCacheByVillage.get(`${villageId}:r${c.radius}`) || null;
      const confirmedAbsentFromAssistant =
        farmCache?.confirmedAbsentFromAssistant instanceof Set
          ? farmCache.confirmedAbsentFromAssistant
          : new Set();
      const needsRediscovery =
        farmCache?.needsRediscovery instanceof Set
          ? farmCache.needsRediscovery
          : new Set();
      const absenceProofAt = Number(farmCache?.absenceProofAt || 0);
      const assistantCoversRadius = Boolean(farmCache?.assistantCoversRadius);

      const queueStats = {};
      let eligible = eligibleTargets(
        rows,
        map,
        s,
        now,
        villageId,
        targets,
        {
          confirmedAbsentFromAssistant,
          needsRediscovery,
          absenceProofAt,
          stats: queueStats
        }
      );
      const mapConfirmedForBootstrap = RUNTIME.mapBootstrapConfirmedByVillage.get(String(villageId)) || new Set();
      const awaitingMapConfirmation = eligible.filter(
        item => item.bootstrap && !mapConfirmedForBootstrap.has(item.coord)
      );
      if (awaitingMapConfirmation.length) {
        const awaitingSet = RUNTIME.mapBootstrapAwaitingByVillage.get(String(villageId)) || new Set();
        eligible = filterMapConfirmedBootstraps(eligible, mapConfirmedForBootstrap);
        addDiagnostic(
          'MAPAΔ',
          `${awaitingMapConfirmation.length} bootstrap(s) retido(s): ${formatCoordDelta(awaitingMapConfirmation.map(item => item.coord))}`,
          `${awaitingSet.size} coordenada(s) aguardam o segundo snapshot fresco; nenhum POST será autorizado por um aparecimento transitório`,
          villageId
        );
      }
      const strategyCandidates = [...eligible];
      const rowSendableCandidates = eligible.filter(item => item.rowSendable !== false);
      let rotationMode = c.adaptiveEnabled ? 'DUE' : 'LEGACY';
      if (c.adaptiveEnabled) {
        const dueCandidates = rowSendableCandidates.filter(item => item.adaptiveDue || item.bootstrap);
        const earlyCandidates = rowSendableCandidates.filter(item => !item.adaptiveDue && !item.bootstrap);
        if (dueCandidates.length) {
          eligible = dueCandidates;
        } else {
          eligible = earlyCandidates;
          rotationMode = earlyCandidates.length ? 'CONTINUOUS_ROTATION' : 'WAITING';
        }
        const nextDueAt = nextAdaptiveDueAt(adaptiveForPass, now);
        const breakdown = {
          ...queueStats,
          strategyCandidates: strategyCandidates.length,
          sendableCandidates: rowSendableCandidates.length,
          selectedCandidates: eligible.length,
          dueCandidates: dueCandidates.length,
          earlyCandidates: earlyCandidates.length,
          rotationMode,
          nextDueAt
        };
        RUNTIME.lastQueueBreakdownByVillage.set(String(villageId), breakdown);
        addDiagnostic(
          'ROTAÇÃO',
          `${dueCandidates.length} due · ${earlyCandidates.length} antecipável(is) · modo ${rotationMode}.`,
          `${queueStats.pending} pending · ${queueStats.safety} segurança · ${queueStats.minRest} descanso mínimo · ` +
            `${queueStats.rowDisabled} botão ${farmTemplate} desativado · ` +
            `${queueStats.awaitingReportHistory} aguardam backfill antes de BOOTSTRAP_NEW · ` +
            `próximo ideal ${nextDueAt ? formatDateTime(nextDueAt) : '—'}`,
          villageId
        );
      } else {
        eligible = rowSendableCandidates;
        const nextLegacyCooldownAt = Object.values(s || {})
          .map(state => Math.max(0, Number(state?.cooldownUntil) || 0))
          .filter(at => at > now)
          .sort((a, b) => a - b)[0] || null;
        const breakdown = {
          ...queueStats,
          strategyCandidates: strategyCandidates.length,
          sendableCandidates: rowSendableCandidates.length,
          selectedCandidates: eligible.length,
          dueCandidates: eligible.length,
          earlyCandidates: 0,
          rotationMode: 'LEGACY',
          nextDueAt: nextLegacyCooldownAt
        };
        RUNTIME.lastQueueBreakdownByVillage.set(String(villageId), breakdown);
        addDiagnostic(
          'ROTAÇÃO',
          `${eligible.length} enviável(is) em estratégia LEGACY.`,
          `${queueStats.pending} pending · ${queueStats.cooldown} cooldown · ` +
            `${queueStats.rowDisabled} botão ${farmTemplate} desativado · ${queueStats.unsupported} botão/template indisponível · ` +
            `${queueStats.awaitingReportHistory} aguardam backfill antes de BOOTSTRAP_NEW · ` +
            `próximo cooldown ${nextLegacyCooldownAt ? formatDateTime(nextLegacyCooldownAt) : '—'}`,
          villageId
        );
      }
      if (c.adaptiveEnabled) {
        eligible = rankAdaptiveEligible(eligible, adaptiveForPass, villageId, c, now);
        const allocationPolicy = adaptiveAllocationQuotas(adaptiveForPass, c, now);
        const allocation = normalizeAdaptiveAllocationBudget(adaptiveForPass?.allocationBudget);
        addDiagnostic(
          'ALOCAÇÃO',
          `${allocation.total} envio(s) adaptativo(s) confirmados no orçamento persistente.`,
          ADAPTIVE_ALLOCATION_CLASSES.map(name =>
            `${name} ${Math.round(100 * Number(allocationPolicy.quotas[name] || 0))}%`
          ).join(' · ') +
            ` · pressão ${allocationPolicy.servicePressure.active}/${Math.max(1, allocationPolicy.servicePressure.sent24h)} ` +
            'farms/envios-24h',
          villageId
        );
      }

      RUNTIME.lastEligibleByVillage.set(String(villageId), eligible.length);
      RUNTIME.lastBootstrapByVillage.set(
        String(villageId),
        eligible.filter(item => item.bootstrap).length
      );
      persistVisualScanSnapshot(eligible, rows, map, scanForThisVillage, s, villageId, c, queueStats);
      addDiagnostic(
        'FILA',
        'Fila de alvos calculada.',
        `${eligible.length} enviáveis selecionados · ${eligible.filter(item => item.bootstrap).length} nova(s) · ${targets.length} bárbaras` +
          (c.adaptiveEnabled && eligible[0]
            ? ` · topo ${eligible[0].coord} score ${Number(eligible[0].adaptiveScore || 0).toFixed(1)} (${eligible[0].adaptiveReason || '—'})`
            : ''),
        villageId
      );

      if (!eligible.length) {
        const rediscoveryCount = Number(scanForThisVillage?.needsRediscoveryCount || 0);
        const coverageNote = rediscoveryCount
          ? ` Há ${rediscoveryCount} linha(s) a redescobrir; não serão tratadas como alvos novos.`
          : (assistantCoversRadius
              ? ''
              : ' Ainda não existe prova atual suficiente para classificar rows ausentes como novos alvos.');
        const detail = c.adaptiveEnabled
          ? ` ${queueStats.minRest} ainda em descanso mínimo; ${queueStats.pending} pending; ` +
            `${queueStats.safety} em segurança; ${queueStats.rowDisabled} com botão ${farmTemplate} desativado; ` +
            `${queueStats.awaitingReportHistoryCoords?.length || 0} candidata(s) a nova aguardam histórico; ` +
            `${queueStats.awaitingAbsenceProofCoords?.length || 0} aguardam prova de ausência; ` +
            `${RUNTIME.mapBootstrapAwaitingByVillage.get(String(villageId))?.size || 0} aguardam estabilidade do mapa.`
          : ` ${queueStats.cooldown} em cooldown legado; ${queueStats.pending} pending; ` +
            `${queueStats.rowDisabled} com botão ${farmTemplate} desativado; ${queueStats.unsupported} sem botão/template suportado; ` +
            `${queueStats.awaitingReportHistoryCoords?.length || 0} candidata(s) a nova aguardam histórico; ` +
            `${queueStats.awaitingAbsenceProofCoords?.length || 0} aguardam prova de ausência; ` +
            `${RUNTIME.mapBootstrapAwaitingByVillage.get(String(villageId))?.size || 0} aguardam estabilidade do mapa.`;
        info(`Passagem concluída: nenhum alvo enviável entre ${targets.length} bárbaras no raio ${c.radius}.${detail}${coverageNote}`);
        return;
      }

      // A UI, a leitura de reports e a classificação das novas já foram atualizadas.
      // Só a fase de envio precisa de descobrir o template A/B.
      const coordinationBeforeTemplate = coordinationState(villageId);
      const persistedTemplateSource = coordinationBeforeTemplate.sources.TEMPLATE;
      const canReuseTemplate =
        coordinationSourceFreshForPlanning(persistedTemplateSource) &&
        String(persistedTemplateSource?.data?.farmTemplate || '') === String(farmTemplate) &&
        Boolean(persistedTemplateSource?.data?.templateId);
      const templateId = canReuseTemplate
        ? String(persistedTemplateSource.data.templateId)
        : await discoverFarmTemplate(rows, villageId, farmTemplate);
      addDiagnostic('MODELO', `Modelo ${farmTemplate} identificado.`, `template_id ${templateId || 'indisponível'}`, villageId);
      if (!templateId) {
        throw codedError(
          'TEMPLATE_NOT_FOUND',

          `Mapa, novas, dados e reports foram atualizados, mas não consegui descobrir com segurança o ID do modelo ${farmTemplate}. ` +
          'Confirma que esse template A/B existe no Assistente de Saque; nenhum POST foi feito.'
        );
      }
      if (!canReuseTemplate) {
        touchCoordinationSource(villageId, 'TEMPLATE', {
          status: 'READY', observedAt: Date.now(), freshUntil: Date.now() + 30 * 60000,
          invalidated: false, reason: `template ${farmTemplate} confirmado`,
          data: { farmTemplate, templateId: String(templateId) }
        });
      } else {
        addDiagnostic('MODELO', `Proof do modelo ${farmTemplate} reutilizada.`, '0 GET', villageId);
        recordAvoidedRequest(villageId, 'TEMPLATE', 'TemplateSource fresca');
      }

      const persistedCapacitySource = coordinationState(villageId).sources.CAPACITY;
      const persistedCapacity = capacityProofFromSource(persistedCapacitySource);
      const capacityContext = {
        sourceVillageId: villageId,
        templateId: String(templateId),
        farmTemplate
      };
      const capacityPlanningNow = Date.now() + PLAN_PROOF_MARGIN_MS;

      const canReuseCapacity =
        coordinationSourceFreshForPlanning(persistedCapacitySource) &&
        capacityProofUsable(
          persistedCapacity,
          capacityContext,
          capacityPlanningNow
        );
      const availability = canReuseCapacity
        ? {
            known: true,
            exact: Boolean(persistedCapacity.exact),
            authoritative: Boolean(persistedCapacity.authoritative),
            capacity: Math.max(0, Number(persistedCapacity.value)),
            source: persistedCapacity.source || persistedCapacitySource.reason || 'CapacitySource persistida',
            templateSource: persistedTemplateSource.reason || 'TemplateSource persistida',
            composition: persistedCapacity.composition || null,
            compositionAuthoritative: Boolean(persistedCapacity.compositionAuthoritative),
            currentUnits: persistedCapacity.currentUnits || null,
            confidence: persistedCapacity.exact ? 'exata reutilizada' : 'mínimo reutilizado'
          }
        : await assessTemplateAvailability(
            rows,
            templateId,
            villageId,
            farmTemplate
          );
      if (canReuseCapacity) {
        addDiagnostic('CAPACIDADE', `Proof de capacidade ${availability.capacity} reutilizada.`, '0 GET', villageId);
        recordAvoidedRequest(villageId, 'CAPACITY', 'CapacityProof contextual fresca');
      }
      RUNTIME.lastCapacityByVillage.set(String(villageId), {
        at: Date.now(),
        known: Boolean(availability.known),
        exact: Boolean(availability.exact),
        capacity: Number.isFinite(availability.capacity) ? availability.capacity : null,
        source: availability.source || 'indeterminado',
        templateSource: availability.templateSource || 'indeterminado',
        composition: availability.composition || null,
        compositionAuthoritative: Boolean(availability.compositionAuthoritative),
        currentUnits: availability.currentUnits || null,
        confidence: availability.confidence || 'desconhecida'
      });
      addDiagnostic(
        'CAPACIDADE',
        `Modelo ${farmTemplate}: ${availability.known ? (availability.capacity ?? '—') : 'desconhecida'} farm(s).`,
        `${availability.confidence || 'desconhecida'} · ${availability.source || 'sem fonte'}`,
        villageId
      );

      if (!availability.known) {
        info(
          `Não consegui validar com segurança a disponibilidade do modelo ${farmTemplate} antes do envio. ` +
          `Nenhum POST de farm foi feito. A passagem termina sem testar envios.`,
          true
        );
        return;
      }

      if (Number(availability.capacity) <= 0) {
        let zeroCapacityProof = canReuseCapacity ? persistedCapacity : null;
        if (!canReuseCapacity) {
          const observedAt = Date.now();
          zeroCapacityProof = normalizeCapacityProof({
            value: 0,
            exact: Boolean(availability.exact),
            authoritative: Boolean(availability.authoritative),
            observedAt,
            freshUntil: observedAt + CAPACITY_ASSISTANT_MINIMUM_TTL_MS,
            source: 'ASSISTANT_ZERO_SIGNAL',
            templateId: String(templateId),
            farmTemplate,
            composition: availability.composition || null,
            compositionAuthoritative: Boolean(availability.compositionAuthoritative),
            currentUnits: availability.currentUnits || null,
            sourceVillageId: villageId
          });
          const persistedZeroSource = persistCapacityProof(
            villageId,
            zeroCapacityProof,
            availability.source || 'capacidade zero'
          );
          zeroCapacityProof = capacityProofFromSource(persistedZeroSource) || zeroCapacityProof;
        }
        const capacityRecheckAt = Math.max(Date.now() + 1, Number(zeroCapacityProof?.freshUntil) || Date.now() + CAPACITY_ZERO_TTL_MS);
        retainedExecutionWake = scheduleAt(
          capacityRecheckAt,
          villageId,
          'CAPACITY_EXHAUSTED: reavaliar quando a proof zero expirar',
          'CAPACITY'
        );
        info(
          `Sem tropas disponíveis para o modelo ${farmTemplate} (${availability.source}). ` +
          `Nenhum POST de farm foi feito. A passagem termina sem testar envios.`
        );
        return;
      }

      const remainingCapacity = Number.isFinite(availability.capacity)
        ? Math.max(0, Number(availability.capacity))
        : 0;
      const activeCompositionAuthoritative = Boolean(availability.compositionAuthoritative);
      const adaptiveComposition = activeCompositionAuthoritative
        ? (availability.composition || null)
        : null;
      let activeCapacityProof = canReuseCapacity ? persistedCapacity : null;
      let adaptiveUnitInfo = null;
      let activeTransportCapacity = null;
      if (!canReuseCapacity) {
        const observedAt = Date.now();
        activeCapacityProof = normalizeCapacityProof({
          value: remainingCapacity,
          exact: Boolean(availability.exact),
          authoritative: Boolean(availability.authoritative || (availability.exact && activeCompositionAuthoritative)),
          observedAt,
          freshUntil: observedAt + (availability.exact
            ? CAPACITY_ASSISTANT_EXACT_TTL_MS
            : CAPACITY_ASSISTANT_MINIMUM_TTL_MS),
          source: availability.exact ? 'ASSISTANT_CURRENT_UNITS' : 'ASSISTANT_MINIMUM_ONE',
          templateId: String(templateId),
          farmTemplate,
          composition: availability.composition || null,
          compositionAuthoritative: activeCompositionAuthoritative,
          currentUnits: availability.currentUnits || null,
          sourceVillageId: villageId
        });
        const persistedCapacityAfterObservation = persistCapacityProof(
          villageId,
          activeCapacityProof,
          availability.source || 'prova do Assistente'
        );
        const persistedProofAfterObservation = capacityProofFromSource(persistedCapacityAfterObservation);
        if (persistedProofAfterObservation && capacityProofUsable(
          persistedProofAfterObservation,
          capacityContext,
          Date.now() + PLAN_PROOF_MARGIN_MS
        )) {
          activeCapacityProof = persistedProofAfterObservation;
        }
      }
      // A telemetria e a correlação de reports ficam sempre ativas. O seletor
      // Adaptativa/Legada decide apenas COMO ordenar os alvos; não desliga a
      // medição dos envios nem a leitura automática dos reports.
      const unitTelemetry = await readUnitEconomicsForTelemetry(villageId);
      if (!unitTelemetry.degraded) {
        adaptiveUnitInfo = unitTelemetry.units;
        activeTransportCapacity = transportCapacityForComposition(adaptiveComposition, adaptiveUnitInfo);
        if (c.adaptiveEnabled) {
          addDiagnostic(
            'ADAPTIVO',
            `Capacidade universal do modelo ${farmTemplate}.`,
            !activeCompositionAuthoritative
              ? 'composição não autoritativa; capacidade e gate económico ficam desconhecidos'
              : Number.isFinite(activeTransportCapacity)
              ? `${activeTransportCapacity} recursos por comando · composição ${formatComposition(adaptiveComposition)}`
              : 'não foi possível calcular; ranking continua com capacidade de referência',
            villageId
          );
        }
      } else {
        const err = unitTelemetry.error;
        addDiagnostic(
          'TELEMETRIA',
          'Capacidade universal das unidades indisponível.',
          `${err?.message || String(err)} · o envio pode continuar, mas esta correlação usará menos evidência`,
          villageId
        );
      }
      if (c.adaptiveEnabled) {
        const passTemplateContext = buildAdaptiveTemplateContext(
          adaptiveComposition,
          adaptiveUnitInfo,
          activeTransportCapacity
        );
        const passContextStats = adaptiveContextStats(adaptiveForPass, c, Date.now());
        eligible = rankAdaptiveEligible(
          eligible,
          adaptiveForPass,
          villageId,
          c,
          Date.now(),
          {
            composition: adaptiveComposition,
            unitInfo: adaptiveUnitInfo,
            capacity: activeTransportCapacity,
            templateContext: passTemplateContext,
            contextStats: passContextStats
          }
        );
      }

      // Se o scan tornou o snapshot antigo, não entra num ciclo de "aborta e tenta daqui
      // a 90 s". Faz no máximo UMA revalidação extra do mapa nesta passagem e filtra
      // a fila já calculada contra o novo ownerId=0. Não existe GET por alvo.
      if (!mapSnapshotFreshness(villageId, c).fresh) {
        map = await refreshMapForSending(villageId, c, 'o scan demorou demasiado');
        eligible = eligible.filter(item => map.has(item.coord) && map.get(item.coord) === item.targetId);
        RUNTIME.lastEligibleByVillage.set(String(villageId), eligible.length);
        RUNTIME.lastBootstrapByVillage.set(
          String(villageId),
          eligible.filter(item => item.bootstrap).length
        );
        persistVisualScanSnapshot(eligible, rows, map, scanForThisVillage, s, villageId, c);
        if (!eligible.length) {
          info('Após revalidar o mapa, nenhum dos alvos anteriormente elegíveis continua válido. Passagem terminada.');
          return;
        }
        // getVillageMap(requireFreshWorld) já persistiu worldRevision, clocks de
        // análise/autorização e o subset derivado. Não os substituímos por um
        // snapshot mais pobre neste ponto.
      }

      const plannedCandidates = buildExecutionPlanCandidates(
        eligible,
        adaptiveComposition,
        activeTransportCapacity,
        adaptiveUnitInfo,
        villageId,
        c
      );
      if (!plannedCandidates.length) {
        addDiagnostic('PLANNER', 'Nenhum candidato passou o gate final local.', '0 POST; próxima observação será agendada normalmente', villageId);
        info('Passagem concluída: nenhum candidato passou o gate final de execução.');
        return;
      }
      const persistedCycle = persistStochasticExecutionCycle({
        villageId,
        config: c,
        candidates: plannedCandidates,
        templateId,
        executionRound: continueExistingRound ? startingRound : null,
        capacityProof: activeCapacityProof,
        composition: adaptiveComposition,
        compositionAuthoritative: activeCompositionAuthoritative,
        transportCapacity: activeTransportCapacity,
        unitInfo: adaptiveUnitInfo,
        earliestExecutionAt: Date.now(),
        reason: 'provas partilhadas da passagem de observação'
      });
      if (!persistedCycle) {
        addDiagnostic('PLANNER', 'Não foi possível criar uma janela local válida.', 'proof expirada/incompleta · 0 POST', villageId);
        info('As provas ficaram demasiado perto de expirar; nenhum POST foi feito. Uma nova observação será agendada.');
        return;
      }
      retainedExecutionWake = true;
      info(
        `Plano ${persistedCycle.executionPlan.cycleId} pronto: ${plannedCandidates.length} candidato(s), ` +
        `próxima execução às ${clockTime(persistedCycle.stochasticPlan.executionDueAt)} sem rede durante a espera.`
      );
      return;
    } catch (err) {
      const code = err?.code || '';
      const msg = String(err?.message || err);

      if (code === 'BOT_PROTECTION_ACTIVE' || msg.includes('BOT_PROTECTION_ACTIVE')) {
        // O guard já tratou da paragem.
      } else if (code === 'LOGIN_REQUIRED') {
        coordinatedHardStop('sessão expirada / login necessário', villageId);
      } else if (code === 'HTTP_429') {
        coordinatedHardStop('servidor limitou a frequência de pedidos (HTTP 429)', villageId);
      } else if (code === 'HTTP_403') {
        coordinatedHardStop('servidor recusou os pedidos (HTTP 403)', villageId);
      } else if (code === 'VILLAGE_CHANGED') {
        saveCfg({ ...cfg(villageId), enabled: false }, villageId);
        info('A aldeia ativa mudou; o AutoFarm da aldeia anterior foi parado.', true);
      } else if (code === 'LEASE_LOST') {
        info('Execução cedida a outra aba; esta passagem foi interrompida.', true);
      } else if (code === 'MAP_SNAPSHOT_STALE') {
        info(`${msg} A próxima passagem revalidará o mapa antes de enviar.`, true);
      } else if (code === 'STORAGE_WRITE_FAILED') {
        coordinatedHardStop(msg, villageId);
      } else if (code === 'UNEXPECTED_SEND_RESPONSE') {
        info(`${msg} O alvo ficou pendente por segurança até aparecer relatório ou ocorrer timeout.`, true);
      } else if (err instanceof ReferenceError || err instanceof TypeError) {
        throw err;
      } else {
        console.error('[AutoFarmRadius]', err);
        info(`Erro: ${msg}`, true);
      }

    } finally {
      const finishedAt = Date.now();
      const startedAt = RUNTIME.lastPassStartedAtByVillage.get(String(villageId)) || finishedAt;
      const finishPersisted = updateSchedulerState(villageId, { lastPassFinishedAt: finishedAt });
      addDiagnostic(
        'PASSAGEM',
        'Passagem terminada.',
        `duração ${fmtCountdown(finishedAt - startedAt)}`,
        villageId
      );

      releaseLease(villageId);
      RUNTIME.busy = false;
      RUNTIME.activeVillageId = null;
      endNetworkOccurrence(villageId);
      renderPanel();

      if (!finishPersisted) {
        stopForSchedulerPersistence(villageId, 'Não foi possível persistir o fim da passagem.');
        return;
      }

      if (
        currentVillageId() === villageId &&
        cfg(villageId).enabled &&
        !RUNTIME.hardStopReasonsByVillage.has(String(villageId)) &&
        !AntiBotGuard.isActive()
      ) {
        const liveCfg = cfg(villageId);
        const earliestAutomaticAt = automaticPassEarliestAt(finishedAt, liveCfg);
        const nextAt = nextAutomaticPassAt(
          finishedAt,
          liveCfg.adaptiveEnabled ? adaptiveStore(villageId) : null,
          liveCfg
        );
        // nextDueAt é informação estratégica para a UI. Nunca pode antecipar uma
        // full pass de rede para antes do intervalo mínimo escolhido pelo utilizador.
        if (retainedExecutionWake) return;
        const finalCoordination = coordinationState(villageId);
        const pendingReportAt = Number(finalCoordination.reportDueAt || 0);
        if (pendingReportAt > finishedAt && pendingReportAt < nextAt) {
          scheduleAt(
            pendingReportAt,
            villageId,
            'report previamente agendado precede a próxima maintenance',
            'REPORT'
          );
          return;
        }
        scheduleAt(
          nextAt,
          villageId,
          nextAt > earliestAutomaticAt
            ? 'próxima oportunidade adaptativa, limitada pela manutenção'
            : 'intervalo mínimo contado desde o fim da passagem',
          'MAINTENANCE'
        );
      } else {
        updateSchedulerState(villageId, { nextRunAt: 0, nextWakeAt: 0 });
        renderClock();
      }
    }
  }

  function applySchedulerRuntimeState(villageId, state) {
    const key = String(villageId || '');
    const nextRunAt = Number(state?.nextWakeAt || state?.nextRunAt || 0);
    const lastStarted = Number(state?.lastPassStartedAt || 0);
    const lastFinished = Number(state?.lastPassFinishedAt || 0);

    if (Number.isFinite(nextRunAt) && nextRunAt > 0) RUNTIME.nextRunAtByVillage.set(key, nextRunAt);
    else RUNTIME.nextRunAtByVillage.delete(key);

    if (Number.isFinite(lastStarted) && lastStarted > 0) RUNTIME.lastPassStartedAtByVillage.set(key, lastStarted);
    else RUNTIME.lastPassStartedAtByVillage.delete(key);

    if (Number.isFinite(lastFinished) && lastFinished > 0) RUNTIME.lastPassFinishedAtByVillage.set(key, lastFinished);
    else RUNTIME.lastPassFinishedAtByVillage.delete(key);
  }

  function schedulerState(villageId = currentVillageId()) {
    const raw = loadJSON('scheduler', {}, villageId) || {};
    const nextWakeAt = Number(raw.nextWakeAt || raw.nextRunAt || 0);
    const state = {
      nextRunAt: nextWakeAt,
      nextWakeAt,
      wakeKind: SCHEDULER_WAKE_KINDS.includes(String(raw.wakeKind)) ? String(raw.wakeKind) : 'MAINTENANCE',
      lastPassStartedAt: Number(raw.lastPassStartedAt || 0),
      lastPassFinishedAt: Number(raw.lastPassFinishedAt || 0)
    };
    applySchedulerRuntimeState(villageId, state);
    return state;
  }

  function updateSchedulerState(villageId, patch = {}) {
    const current = schedulerState(villageId);
    const next = { ...current, ...patch };

    if (!saveJSON('scheduler', next, villageId)) {
      addDiagnostic('ERRO', 'Não foi possível persistir o agendamento.', '', villageId);
      return null;
    }
    applySchedulerRuntimeState(villageId, next);
    return next;
  }

  function clearLocalScheduleTimer() {
    clearTimeout(RUNTIME.timer);
    RUNTIME.timer = null;
  }

  function stopForSchedulerPersistence(villageId, detail = 'Falha de persistência do scheduler.') {
    clearLocalScheduleTimer();
    const reason = `${detail} AutoFarm parado por segurança.`;
    RUNTIME.hardStopReasonsByVillage.set(String(villageId || ''), reason);
    const current = cfg(villageId);
    saveCfg({ ...current, enabled: false }, villageId);
    RUNTIME.nextRunAtByVillage.delete(String(villageId || ''));
    RUNTIME.stopReason = reason;
    addDiagnostic('ERRO', 'Scheduler entrou em fail-closed.', detail, villageId);
    info(reason, true);
    renderClock();
  }

  function cancelSchedule(villageId = currentVillageId(), reason = 'cancelado') {
    clearLocalScheduleTimer();
    const persisted = updateSchedulerState(villageId, { nextRunAt: 0, nextWakeAt: 0 });
    addDiagnostic('AGENDA', 'Agendamento automático cancelado.', reason, villageId);
    renderClock();
    return Boolean(persisted);
  }

  function foreignLease(villageId) {
    const lease = loadJSON('lease', null, villageId);
    if (
      lease?.owner &&
      lease.owner !== RUNTIME.tabId &&
      Number(lease.expiresAt) > Date.now()
    ) return lease;
    return null;
  }

  function armLocalTimerAt(timestamp, villageId = currentVillageId(), reason = 'sincronizado') {
    clearLocalScheduleTimer();

    const at = Number(timestamp || 0);
    if (!Number.isFinite(at) || at <= 0) return false;

    const delayMs = Math.max(0, at - Date.now());
    // setTimeout usa um inteiro assinado de 32 bits em vários browsers. Intervalos
    // longos são armados em fatias; o timestamp persistido continua a ser o real.
    const timerSliceMs = Math.min(delayMs, 12 * 3600000);
    RUNTIME.timer = setTimeout(() => {
      RUNTIME.timer = null;

      if (currentVillageId() !== String(villageId)) {
        addDiagnostic('AGENDA', 'Timer ignorado: a aldeia ativa mudou.', `agendado para v${villageId}`, villageId);
        return;
      }

      if (!cfg(villageId).enabled || RUNTIME.hardStopReasonsByVillage.has(String(villageId))) {
        renderClock();
        return;
      }

      // Se ainda falta tempo (fatia de um intervalo longo) ou outra aba alterou o
      // relógio persistente, volta a armar sem executar uma passagem prematura.
      const state = schedulerState(villageId);
      const now = Date.now();
      if (Number(state.nextRunAt) > now + 250) {
        armLocalTimerAt(Number(state.nextRunAt), villageId, 'agendamento partilhado atualizado');
        return;
      }

      const lease = foreignLease(villageId);
      if (lease) {
        armLeaseRecovery(villageId, 'timer expirou enquanto outra aba executa');
        return;
      }

      addDiagnostic('AGENDA', `Temporizador ${state.wakeKind || 'MAINTENANCE'} expirou.`, reason, villageId);
      renderClock();
      dispatchScheduledWake(villageId, state.wakeKind || 'MAINTENANCE');
    }, timerSliceMs);

    renderClock();
    return true;
  }

  function armLeaseRecovery(villageId = currentVillageId(), reason = 'lease ocupado') {
    clearLocalScheduleTimer();
    if (currentVillageId() !== String(villageId) || !cfg(villageId).enabled) return false;

    const state = schedulerState(villageId);
    const now = Date.now();
    if (Number(state.nextRunAt) > now + 250) {
      return armLocalTimerAt(Number(state.nextRunAt), villageId, 'seguir agendamento da aba proprietária');
    }

    const lease = foreignLease(villageId);
    if (lease) {
      const retryAt = Math.max(now + 500, Number(lease.expiresAt) + 250);
      addDiagnostic(
        'AGENDA',
        'Aba passiva: recuperação armada para o fim do lease.',
        `${clockTime(retryAt)} · ${reason}`,
        villageId
      );
      return armLocalTimerAt(retryAt, villageId, 'recuperação após lease');
    }

    // Há uma pequena janela normal entre releaseLease() e a gravação do próximo
    // nextRunAt pela aba proprietária. Dá-lhe tempo para publicar o horário; se não
    // aparecer (aba fechou/crashou), esta aba recupera a execução.
    return armLocalTimerAt(now + 1500, villageId, 'recuperação sem lease/agendamento');
  }

  function syncLocalScheduleFromStorage(villageId = currentVillageId(), reason = 'storage') {
    if (!villageId || currentVillageId() !== String(villageId)) return;

    const c = cfg(villageId);
    const state = schedulerState(villageId);
    const now = Date.now();

    if (!c.enabled || RUNTIME.hardStopReasonsByVillage.has(String(villageId))) {
      clearLocalScheduleTimer();
      renderClock();
      return;
    }

    if (RUNTIME.busy && String(RUNTIME.activeVillageId || '') === String(villageId)) {
      renderClock();
      return;
    }

    if (Number(state.nextRunAt) > now) {
      armLocalTimerAt(Number(state.nextRunAt), villageId, `sincronizado: ${reason}`);
      return;
    }

    if (foreignLease(villageId)) {
      armLeaseRecovery(villageId, `sincronizado: ${reason}`);
      return;
    }

    // nextRunAt=0 sem lease pode ser uma aba que terminou abruptamente ou a pequena
    // janela entre releaseLease e a publicação do horário seguinte.
    armLocalTimerAt(now + 1500, villageId, `recuperação: ${reason}`);
  }

  function scheduleAt(timestamp, villageId = currentVillageId(), reason = 'automático', wakeKind = 'MAINTENANCE') {
    const now = Date.now();
    const at = Math.max(now, Number(timestamp) || now);
    const delayMs = Math.max(0, at - now);
    const kind = SCHEDULER_WAKE_KINDS.includes(String(wakeKind)) ? String(wakeKind) : 'MAINTENANCE';

    const existing = schedulerState(villageId);
    if (Number(existing.nextWakeAt) === at && existing.wakeKind === kind && RUNTIME.timer) {
      return true;
    }
    if (!updateSchedulerState(villageId, { nextRunAt: at, nextWakeAt: at, wakeKind: kind })) {
      stopForSchedulerPersistence(villageId, 'Não foi possível gravar o próximo horário automático.');
      return false;
    }

    const coordination = coordinationState(villageId);
    coordination.nextWakeAt = at;
    coordination.wakeKind = kind;
    coordination.reason = String(reason || 'automático');
    if (kind === 'EXECUTION') coordination.executionDueAt = at;
    else if (kind === 'OBSERVATION') coordination.observationFloorAt = at;
    else if (kind === 'CAPACITY') coordination.sources.CAPACITY.nextRequiredAt = at;
    else if (kind === 'REPORT') coordination.reportDueAt = at;
    else if (kind === 'RECONCILIATION') coordination.reconcileDueAt = at;
    else if (kind === 'MAINTENANCE') coordination.maintenanceDueAt = at;
    else if (kind === 'LEASE_RECOVERY') coordination.leaseRecoveryDueAt = at;
    saveCoordinationState(coordination, villageId);

    addDiagnostic(
      'AGENDA',
      `Próximo wake ${kind} às ${new Date(at).toLocaleTimeString('pt-PT', { hour12: false })}.`,
      `${Math.ceil(delayMs / 1000)} s · ${reason}`,
      villageId
    );

    armLocalTimerAt(at, villageId, reason);
    return true;
  }

  function schedule(seconds, villageId = currentVillageId(), reason = 'fim da passagem') {
    const delaySeconds = Math.max(15, Number(seconds) || DEFAULTS.retrySeconds);
    return scheduleAt(Date.now() + delaySeconds * 1000, villageId, reason);
  }

  function automaticPassEarliestAt(finishedAt, c = DEFAULTS) {
    return Math.max(0, Number(finishedAt) || 0) +
      numberAtLeast(c?.retrySeconds, 15, DEFAULTS.retrySeconds) * 1000;
  }

  function nextAutomaticPassAt(finishedAt, store, c = DEFAULTS) {
    const floor = automaticPassEarliestAt(finishedAt, c);
    if (!c?.adaptiveEnabled) return floor;
    const maintenanceAt = Math.max(
      floor,
      Number(finishedAt) + numberAtLeast(
        c?.adaptiveMaintenanceMaxHours,
        0.25,
        DEFAULTS.adaptiveMaintenanceMaxHours
      ) * 3600000
    );
    const desired = adaptiveSuggestedWakeAt(store, c, finishedAt);
    if (!(desired > Number(finishedAt))) return maintenanceAt;
    return Math.max(floor, Math.min(desired, maintenanceAt));
  }

  function requestImmediatePass(villageId = currentVillageId(), reason = 'pedido manual') {
    const key = String(villageId || '');
    if (!key || currentVillageId() !== key) {
      info('Não foi possível iniciar: a aldeia ativa mudou.', true);
      return false;
    }
    beginNetworkOccurrence(key, 'MANUAL', reason);
    endNetworkOccurrence(key);
    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      info('Hard-stop da conta ativo. Resolve a proteção e usa INICIAR para recuperação manual.', true);
      return false;
    }
    if (RUNTIME.busy) {
      info(
        String(RUNTIME.activeVillageId || '') === key
          ? 'Já existe uma passagem em curso. O temporizador será reiniciado quando ela terminar.'
          : 'Outra aldeia está em execução nesta aba; aguarda o fim da passagem.',
        true
      );
      return false;
    }
    const lease = foreignLease(villageId);
    if (lease) {
      info('Outra aba está a executar esta aldeia. Mantive o agendamento partilhado.', true);
      armLeaseRecovery(villageId, reason);
      return false;
    }
    const coordination = coordinationState(villageId);
    const lastFinishedAt = Number(schedulerState(villageId).lastPassFinishedAt || 0);
    if (
      coordination.state !== 'WAITING_EXECUTION' &&
      lastFinishedAt > 0 && Date.now() - lastFinishedAt < 5000
    ) {
      const protectedAt = lastFinishedAt + 5000;
      scheduleAt(protectedAt, villageId, 'proteção de 5 s contra clique duplicado');
      info(`A passagem anterior acabou agora. Nova execução armada para ${clockTime(protectedAt)}.`, true);
      return false;
    }
    if (coordination.state === 'UNKNOWN' || coordination.executionRound?.pendingMutation) {
      info('Existe uma mutation por reconciliar. Reavaliar agora não faz blind retry.', true);
      return false;
    }
    if (
      coordination.state === 'WAITING_EXECUTION' &&
      coordination.executionPlan &&
      coordination.stochasticPlan
    ) {
      const plan = normalizeExecutionPlan(coordination.executionPlan);
      const stochastic = normalizeStochasticPlan(coordination.stochasticPlan);
      const now = Date.now();
      const manualDueAt = Math.max(now, Number(plan.notBeforeAt) || 0);
      if (stochastic.manualOverrideAt > 0 && RUNTIME.timer) {
        addDiagnostic(
          'AÇÃO',
          'Reavaliação manual idempotente: o mesmo ciclo já foi antecipado.',
          `floor ${clockTime(plan.notBeforeAt)} · 0 GET · 0 POST · 0 novo plano`,
          villageId
        );
        return true;
      }
      coordination.stochasticPlan = normalizeStochasticPlan({
        ...stochastic,
        executionDueAt: manualDueAt,
        manualOverrideAt: now
      });
      coordination.executionDueAt = manualDueAt;
      coordination.nextWakeAt = manualDueAt;
      coordination.wakeKind = 'EXECUTION';
      coordination.reason = manualDueAt > now
        ? 'manual removeu apenas a espera opcional; immutable not-before preservado'
        : 'manual removeu apenas a espera estocástica opcional';
      saveCoordinationState(coordination, villageId);
      addDiagnostic(
        'AÇÃO',
        'Plano existente antecipado sem novo sorteio.',
        `${coordination.reason} · mesmo cycleId · 0 GET · 0 POST`,
        villageId
      );
      scheduleAt(manualDueAt, villageId, coordination.reason, 'EXECUTION');
      return true;
    }
    if (!cancelSchedule(villageId, reason)) return false;
    const capacitySource = coordination.sources.CAPACITY;
    const capacityInvalidatedByMutation = Boolean(
      capacitySource?.invalidated &&
      String(capacitySource?.reason || '') === 'MUTATION_CONFIRMED_WITHOUT_CURRENT_UNITS'
    );
    const planningKind = capacityInvalidatedByMutation ? 'CAPACITY' : 'OBSERVATION';
    const dependencyPlan = localDependencyPlanner(coordination, planningKind, Date.now());
    addDiagnostic(
      'AÇÃO',
      'Utilizador pediu reavaliação imediata.',
      dependencyPlan.action === 'NOTHING'
        ? 'snapshots frescos reutilizados · 0 GET antes do plano'
        : `resolver apenas ${dependencyPlan.required.join(' + ')}`,
      villageId
    );
    const requestedSources = [...new Set([
      ...dependencyPlan.required,
      ...dependencyPlan.requests.map(request => request.source)
    ])].filter(name => SOURCE_NAMES.includes(name));
    runPass({
      requiredSources: requestedSources,
      wakeKind: planningKind,
      reason
    });
    return true;
  }

  function fmtCountdown(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function clockTime(timestamp) {
    const n = Number(timestamp || 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n).toLocaleTimeString('pt-PT', { hour12: false });
  }

  function formatDateTime(timestamp) {
    const n = Number(timestamp || 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n).toLocaleString('pt-PT', { hour12: false });
  }

  function renderClock() {
    const p = document.getElementById('twaf59-panel');
    if (!p) return;

    const villageId = currentVillageId();
    const c = cfg(villageId);
    const state = schedulerState(villageId);
    const countdown = p.querySelector('#twaf59-countdown');
    const detail = p.querySelector('#twaf59-schedule-detail');

    if (!countdown || !detail) return;

    const now = Date.now();
    if (RUNTIME.busy && String(RUNTIME.activeVillageId || '') === String(villageId)) {
      const startedAt = RUNTIME.lastPassStartedAtByVillage.get(String(villageId))
        || Number(state.lastPassStartedAt || 0)
        || now;
      countdown.textContent = `EM EXECUÇÃO · ${fmtCountdown(now - startedAt)}`;
      detail.textContent =
        `Início ${clockTime(startedAt)} · intervalo configurado ${c.retrySeconds}s · o próximo contador começa quando esta passagem terminar.`;
      return;
    }

    const nextRunAt = RUNTIME.nextRunAtByVillage.get(String(villageId))
      || Number(state.nextRunAt || 0);

    if (c.enabled && nextRunAt > now) {
      countdown.textContent = fmtCountdown(nextRunAt - now);
      detail.textContent =
        `${state.wakeKind || 'MAINTENANCE'} às ${clockTime(nextRunAt)} · intervalo mínimo ${c.retrySeconds}s · ` +
        `última observação concluída ${clockTime(state.lastPassFinishedAt)}.`;
    } else if (c.enabled) {
      countdown.textContent = 'A PREPARAR';
      detail.textContent =
        `Intervalo ${c.retrySeconds}s · última concluída ${clockTime(state.lastPassFinishedAt)}.`;
    } else {
      countdown.textContent = 'PARADO';
      detail.textContent =
        `Intervalo configurado ${c.retrySeconds}s · última concluída ${clockTime(state.lastPassFinishedAt)}.`;
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function fmt(ms) {
    if (ms <= 0) return '0m';
    const m = Math.ceil(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;

    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function stats(villageId = currentVillageId()) {
    const now = Date.now();
    const s = states(villageId);
    const targets = targetCoords(villageId);
    const c = cfg(villageId);
    const adaptive = c.adaptiveEnabled ? adaptiveStore(villageId) : null;
    let pending = 0;
    let sending = 0;
    let cooling = 0;
    let ready = 0;
    let nextCooldown = Infinity;

    for (const coord of targets) {
      const st = s[coord] || {};

      if (st.sending) {
        sending++;
      } else if (st.pending) {
        pending++;
      } else if (c.adaptiveEnabled) {
        const farm = ensureAdaptiveFarm(adaptive, coord, coordDistance(coord));
        if (adaptiveHardSafetyBlocked(st, farm, now, c)) {
          cooling++;
          if ((st.cooldownUntil || 0) > now) nextCooldown = Math.min(nextCooldown, st.cooldownUntil);
        } else if (!adaptiveFarmDue(farm, now, c)) {
          cooling++;
          if ((farm.nextDueAt || 0) > now) nextCooldown = Math.min(nextCooldown, farm.nextDueAt);
        } else {
          ready++;
        }
      } else if ((st.cooldownUntil || 0) > now) {
        cooling++;
        nextCooldown = Math.min(nextCooldown, st.cooldownUntil);
      } else {
        ready++;
      }
    }

    return {
      total: targets.length,
      pending,
      sending,
      cooling,
      ready,
      next: Number.isFinite(nextCooldown) ? fmt(nextCooldown - now) : '—'
    };
  }

  function escapeHtmlAttribute(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function installPanelTooltips(panel) {
    if (!panel || !document.body) return;
    let tooltip = document.getElementById('twaf59-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'twaf59-tooltip';
      tooltip.hidden = true;
      tooltip.setAttribute('role', 'tooltip');
      document.body.appendChild(tooltip);
    }

    // O tooltip vive fora do painel: overflow:hidden e o scroll interno já não
    // conseguem cortar a mensagem.
    for (const node of panel.querySelectorAll('[title]')) {
      const message = String(node.getAttribute('title') || '').trim();
      if (message && !node.dataset.twafTip) node.dataset.twafTip = message;
      node.removeAttribute('title');
    }

    let active = null;
    const position = (clientX, clientY, target) => {
      if (!tooltip || tooltip.hidden) return;
      const anchor = target?.getBoundingClientRect?.() || { left: 12, top: 12, right: 12, bottom: 12 };
      const x = Number.isFinite(clientX) ? clientX : anchor.left + Math.min(24, Math.max(0, anchor.right - anchor.left));
      const y = Number.isFinite(clientY) ? clientY : anchor.bottom;
      const rect = tooltip.getBoundingClientRect?.() || { width: 280, height: 70 };
      const margin = 8;
      let left = x + 12;
      let top = y + 14;
      if (left + rect.width > window.innerWidth - margin) left = Math.max(margin, x - rect.width - 12);
      if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, y - rect.height - 12);
      tooltip.style.left = `${Math.round(left)}px`;
      tooltip.style.top = `${Math.round(top)}px`;
    };
    const show = (target, event = null) => {
      const message = String(target?.dataset?.twafTip || '').trim();
      if (!message) return;
      active = target;
      tooltip.textContent = message;
      tooltip.hidden = false;
      position(event?.clientX, event?.clientY, target);
    };
    const hide = target => {
      if (target && active && target !== active) return;
      active = null;
      tooltip.hidden = true;
    };
    const find = event => event?.target?.closest?.('[data-twaf-tip]');

    panel.addEventListener('pointerover', event => {
      const target = find(event);
      if (target && panel.contains(target)) show(target, event);
    });
    panel.addEventListener('pointermove', event => {
      if (active) position(event.clientX, event.clientY, active);
    });
    panel.addEventListener('pointerout', event => {
      const target = find(event);
      if (target && !target.contains?.(event.relatedTarget)) hide(target);
    });
    panel.addEventListener('focusin', event => {
      const target = find(event);
      if (target && panel.contains(target)) show(target);
    });
    panel.addEventListener('focusout', event => {
      if (!active?.contains?.(event.relatedTarget)) hide(active);
    });
    panel.addEventListener('mouseleave', () => hide(active));
  }

  function createPanel() {
    if (!document.body || document.getElementById('twaf59-panel')) return;

    const style = document.createElement('style');
    style.textContent = `
      #twaf59-panel {
        --twaf-bg: #11161b;
        --twaf-panel: #181f26;
        --twaf-panel-2: #202933;
        --twaf-line: rgba(255,255,255,.09);
        --twaf-muted: #8f9aa6;
        --twaf-text: #edf2f6;
        --twaf-gold: #e4b95f;
        --twaf-cyan: #73d8ce;
        --twaf-red: #ef7d72;
        position: fixed;
        left: 14px;
        bottom: 14px;
        z-index: 999999;
        width: min(468px, calc(100vw - 28px));
        max-height: min(82vh, 760px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: var(--twaf-text);
        background:
          radial-gradient(circle at 92% -15%, rgba(115,216,206,.14), transparent 36%),
          radial-gradient(circle at 0% 0%, rgba(228,185,95,.11), transparent 28%),
          linear-gradient(180deg, #171e25 0%, #11161b 100%);
        border: 1px solid rgba(228,185,95,.34);
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0,0,0,.48), 0 2px 0 rgba(255,255,255,.04) inset;
        font: 12px/1.35 Arial, sans-serif;
        isolation: isolate;
      }
      #twaf59-panel * { box-sizing: border-box; }
      #twaf59-panel button,
      #twaf59-panel input,
      #twaf59-panel select { font: inherit; }
      #twaf59-panel .twaf-head {
        display: grid;
        grid-template-columns: 38px 1fr auto auto;
        align-items: center;
        gap: 9px;
        min-height: 52px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--twaf-line);
        background: rgba(5,8,11,.34);
      }
      #twaf59-panel .twaf-brandmark {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(228,185,95,.48);
        border-radius: 9px;
        background: linear-gradient(145deg, rgba(228,185,95,.18), rgba(115,216,206,.08));
        color: var(--twaf-gold);
        font-weight: 900;
        letter-spacing: -.04em;
        box-shadow: 0 0 0 1px rgba(0,0,0,.25) inset;
      }
      #twaf59-panel .twaf-title { display:block; font-size: 13px; font-weight: 800; letter-spacing: .02em; }
      #twaf59-panel .twaf-subtitle { margin-top:1px; color: var(--twaf-muted); font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
      #twaf59-panel .twaf-version { color: var(--twaf-muted); font-size: 9px; margin-left: 5px; font-weight: 600; }
      #twaf59-panel .twaf-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 64px;
        height: 24px;
        padding: 0 8px;
        border-radius: 999px;
        border: 1px solid rgba(115,216,206,.22);
        background: rgba(115,216,206,.09);
        color: #bff3ed;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: .06em;
        white-space: nowrap;
      }
      #twaf59-panel .twaf-icon-btn {
        width: 26px;
        height: 26px;
        min-height: 26px;
        padding: 0;
        border: 1px solid var(--twaf-line);
        border-radius: 7px;
        color: var(--twaf-muted);
        background: rgba(255,255,255,.035);
        cursor: pointer;
      }
      #twaf59-panel .twaf-shell { min-height: 0; display: flex; flex-direction: column; }
      #twaf59-panel .twaf-command {
        display: grid;
        grid-template-columns: 82px 68px 1fr;
        gap: 7px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid var(--twaf-line);
        background: rgba(255,255,255,.018);
      }
      #twaf59-panel label { display: block; min-width: 0; color: var(--twaf-text); }
      #twaf59-panel label > span,
      #twaf59-panel .twaf-field-label {
        display: block;
        margin: 0 0 3px;
        color: var(--twaf-muted);
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .055em;
      }
      #twaf59-panel .twaf-setting {
        padding: 7px;
        border: 1px solid rgba(255,255,255,.065);
        border-radius: 8px;
        background: rgba(255,255,255,.018);
      }
      #twaf59-panel .twaf-field-help {
        display: block;
        min-height: 25px;
        margin: 5px 1px 0;
        color: #788690;
        font-size: 8px;
        font-weight: 400;
        line-height: 1.35;
        text-transform: none;
        letter-spacing: 0;
      }
      #twaf59-panel input[type="number"],
      #twaf59-panel select {
        width: 100%;
        height: 30px;
        padding: 4px 7px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 7px;
        outline: 0;
        color: var(--twaf-text);
        background: #0f151a;
        box-shadow: 0 1px 0 rgba(255,255,255,.025) inset;
      }
      #twaf59-panel select option { background: #151c22; color: var(--twaf-text); }
      #twaf59-panel input[type="number"]:focus,
      #twaf59-panel select:focus { border-color: rgba(115,216,206,.65); box-shadow: 0 0 0 2px rgba(115,216,206,.08); }
      #twaf59-panel button { cursor:pointer; }
      #twaf59-panel .twaf-main-btn {
        align-self: end;
        height: 30px;
        min-height: 30px;
        border: 1px solid rgba(228,185,95,.52) !important;
        border-radius: 8px !important;
        color: #19140a !important;
        background: linear-gradient(180deg, #f0ca78, #d9a94e) !important;
        font-weight: 900 !important;
        letter-spacing: .055em;
        text-shadow: none !important;
      }
      #twaf59-panel .twaf-tabbar {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 4px;
        padding: 7px 8px;
        border-bottom: 1px solid var(--twaf-line);
        background: rgba(3,5,7,.28);
      }
      #twaf59-panel .twaf-tab {
        min-height: 28px;
        padding: 4px 5px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        color: var(--twaf-muted);
        font-size: 9px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .06em;
      }
      #twaf59-panel .twaf-tab:hover { color: var(--twaf-text); background: rgba(255,255,255,.035); }
      #twaf59-panel .twaf-tab.is-active {
        color: #eafdfb;
        border-color: rgba(115,216,206,.22);
        background: linear-gradient(180deg, rgba(115,216,206,.14), rgba(115,216,206,.06));
      }
      #twaf59-panel .twaf-view {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: rgba(228,185,95,.38) transparent;
      }
      #twaf59-panel .twaf-tabpane { display: none; padding: 9px 10px 11px; }
      #twaf59-panel .twaf-tabpane.is-active { display: block; }
      #twaf59-panel .twaf-statusline {
        padding: 7px 9px;
        border: 1px solid rgba(115,216,206,.16);
        border-radius: 8px;
        color: #d9e5e8;
        background: rgba(115,216,206,.055);
        font-size: 10px;
        line-height: 1.35;
      }
      #twaf59-panel .twaf-hero {
        display: grid;
        grid-template-columns: 134px 1fr;
        gap: 7px;
        margin-top: 7px;
      }
      #twaf59-panel .twaf-timer-card,
      #twaf59-panel .twaf-model-card,
      #twaf59-panel .twaf-section {
        border: 1px solid var(--twaf-line);
        border-radius: 9px;
        background: rgba(255,255,255,.032);
        box-shadow: 0 1px 0 rgba(255,255,255,.018) inset;
      }
      #twaf59-panel .twaf-timer-card { padding: 8px 9px; background: linear-gradient(145deg, rgba(228,185,95,.09), rgba(255,255,255,.025)); }
      #twaf59-panel .twaf-timer-label { color: var(--twaf-muted); font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
      #twaf59-panel .twaf-countdown { display:block; margin-top: 2px; color: var(--twaf-gold); font-size: 24px; font-weight: 900; line-height: 1; letter-spacing: -.03em; }
      #twaf59-panel .twaf-timer-detail { margin-top: 4px; color: var(--twaf-muted); font-size: 9px; line-height: 1.28; }
      #twaf59-panel .twaf-model-card { padding: 8px 9px; min-width: 0; }
      #twaf59-panel .twaf-card-title,
      #twaf59-panel .twaf-section-title {
        color: var(--twaf-muted);
        font-size: 8px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      #twaf59-panel .twaf-model-main { margin-top: 4px; font-size: 12px; font-weight: 800; color: #f4f6f7; }
      #twaf59-panel .twaf-muted { color: var(--twaf-muted); font-size: 9px; line-height: 1.35; }
      #twaf59-panel .twaf-metrics {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 5px;
        margin-top: 7px;
      }
      #twaf59-panel .twaf-metric {
        min-width: 0;
        padding: 7px 4px 6px;
        text-align: center;
        border: 1px solid var(--twaf-line);
        border-radius: 8px;
        background: rgba(255,255,255,.028);
      }
      #twaf59-panel .twaf-metric b { display:block; color:#fff; font-size:15px; line-height:1; font-weight:900; }
      #twaf59-panel .twaf-metric span { display:block; margin-top:3px; color:var(--twaf-muted); font-size:8px; text-transform:uppercase; letter-spacing:.04em; }
      #twaf59-panel .twaf-actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:7px; }
      #twaf59-panel .twaf-actions .btn,
      #twaf59-panel .twaf-log-actions .btn,
      #twaf59-panel .twaf-danger-row .btn {
        min-height: 29px;
        border: 1px solid rgba(255,255,255,.12) !important;
        border-radius: 8px !important;
        color: var(--twaf-text) !important;
        background: rgba(255,255,255,.055) !important;
        text-shadow: none !important;
        font-weight: 700 !important;
      }
      #twaf59-panel .twaf-actions .btn:hover,
      #twaf59-panel .twaf-log-actions .btn:hover { border-color: rgba(228,185,95,.38) !important; background: rgba(228,185,95,.08) !important; }
      #twaf59-panel .twaf-kpi-label {
        margin: 10px 1px 5px;
        color: var(--twaf-muted);
        font-size: 8px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .09em;
      }
      #twaf59-panel .twaf-v2-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; }
      #twaf59-panel .twaf-v2-kpi {
        min-width:0;

        padding:6px 5px;
        border:1px solid var(--twaf-line);
        border-radius:8px;
        background:rgba(255,255,255,.026);
      }
      #twaf59-panel .twaf-v2-kpi span { display:block; color:var(--twaf-muted); font-size:8px; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #twaf59-panel .twaf-v2-kpi b { display:block; margin-top:2px; color:#f6f7f8; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #twaf59-panel .twaf-v2-summary {
        margin-top:6px;
        padding:7px 8px;
        border-left:2px solid rgba(115,216,206,.55);
        border-radius:0 7px 7px 0;
        color:#aebbc4;
        background:rgba(115,216,206,.035);
        font-size:9px;
        line-height:1.42;
      }
      #twaf59-panel .twaf-guide {
        margin: 0 0 8px;
        padding: 8px 9px;
        border: 1px solid rgba(115,216,206,.14);
        border-radius: 8px;
        color: #aebbc4;
        background: rgba(115,216,206,.035);
        font-size: 9px;
        line-height: 1.45;
      }
      #twaf59-panel .twaf-data-state {
        margin: 0 0 7px;
        padding: 7px 8px;
        border: 1px solid rgba(255,255,255,.09);
        border-left: 3px solid var(--twaf-muted);
        border-radius: 7px;
        color: #c4cdd3;
        background: rgba(255,255,255,.025);
        font-size: 9px;
        line-height: 1.4;
      }
      #twaf59-panel .twaf-data-state.is-ok { border-left-color: var(--twaf-cyan); }
      #twaf59-panel .twaf-data-state.is-warn { border-left-color: var(--twaf-gold); color:#e5d2a6; }
      #twaf59-panel .twaf-data-state.is-error { border-left-color: var(--twaf-red); color:#efb0a9; }
      #twaf59-panel .twaf-section { margin-bottom:8px; padding:8px; }
      #twaf59-panel .twaf-section:last-child { margin-bottom:0; }
      #twaf59-panel .twaf-section-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:7px; }
      #twaf59-panel .twaf-section-head strong { font-size:11px; }
      #twaf59-panel .twaf-section-head span { color:var(--twaf-muted); font-size:8px; text-transform:uppercase; letter-spacing:.06em; }
      #twaf59-panel .twaf-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
      #twaf59-panel .twaf-diag { margin-top:6px; color:#b7c1c9; font-size:9px; line-height:1.4; overflow-wrap:anywhere; }
      #twaf59-panel .twaf-bars { display:grid; gap:4px; margin-top:5px; }
      #twaf59-panel .twaf-bar-row { display:grid; grid-template-columns:70px 1fr 34px; gap:6px; align-items:center; color:#aeb8c0; font-size:8px; }
      #twaf59-panel .twaf-bar-track { height:6px; overflow:hidden; border-radius:999px; background:rgba(255,255,255,.07); }
      #twaf59-panel .twaf-bar-fill { height:100%; border-radius:999px; background:linear-gradient(90deg, var(--twaf-gold), var(--twaf-cyan)); opacity:.75; }
      #twaf59-panel .twaf-ranking-wrap { margin-top:7px; overflow:auto; border:1px solid var(--twaf-line); border-radius:8px; }
      #twaf59-panel .twaf-ranking { width:100%; min-width:430px; border-collapse:collapse; font-size:8px; }
      #twaf59-panel .twaf-ranking th { position:sticky; top:0; color:#a9b4bc; background:#161d23; text-transform:uppercase; letter-spacing:.04em; }
      #twaf59-panel .twaf-ranking th,
      #twaf59-panel .twaf-ranking td { padding:5px 5px; border-bottom:1px solid rgba(255,255,255,.055); text-align:right; white-space:nowrap; }
      #twaf59-panel .twaf-ranking th:first-child,
      #twaf59-panel .twaf-ranking td:first-child { text-align:left; }
      #twaf59-panel .twaf-v2-note { margin-top:6px; color:#98a5ad; font-size:9px; line-height:1.48; }
      #twaf59-panel .twaf-log-actions { display:flex; gap:6px; margin-top:7px; }
      #twaf59-panel .twaf-console {
        height:190px;
        margin:7px 0 0;
        overflow:auto;
        white-space:pre-wrap;
        word-break:break-word;
        padding:8px;
        border:1px solid rgba(115,216,206,.12);
        border-radius:8px;
        color:#c9ddd9;
        background:#0a0f12;
        font:9px/1.4 Consolas, "Courier New", monospace;
      }
      #twaf59-panel .twaf-danger-row { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:7px; }
      #twaf59-panel .twaf-danger-row .btn { color:#f1b1aa !important; border-color:rgba(239,125,114,.20) !important; background:rgba(239,125,114,.055) !important; }
      #twaf59-panel .twaf-foot { margin-top:7px; padding:7px 8px; color:#71808a; font-size:8px; line-height:1.4; border:1px dashed rgba(255,255,255,.07); border-radius:7px; }
      #twaf59-panel.twaf-collapsed .twaf-shell { display:none; }
      #twaf59-panel.twaf-collapsed { width: min(330px, calc(100vw - 28px)); }
      #twaf59-tooltip {
        position: fixed;
        z-index: 1000002;
        max-width: min(310px, calc(100vw - 16px));
        padding: 7px 9px;
        border: 1px solid rgba(228,185,95,.55);
        border-radius: 7px;
        color: #f1f5f7;
        background: rgba(8,12,15,.97);
        box-shadow: 0 8px 24px rgba(0,0,0,.55);
        font: 10px/1.4 Arial, sans-serif;
        white-space: normal;
        pointer-events: none;
      }
      #twaf59-tooltip[hidden] { display:none !important; }
      @media (max-width: 540px) {
        #twaf59-panel { left:7px; bottom:7px; width:calc(100vw - 14px); max-height:88vh; }
        #twaf59-panel .twaf-hero { grid-template-columns:118px 1fr; }
      }
    `;
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.id = 'twaf59-panel';
    p.innerHTML = `
      <div class="twaf-head">
        <div class="twaf-brandmark">AF</div>
        <div>
          <span class="twaf-title">AutoFarm Adaptive <span class="twaf-version">v${VERSION}</span></span>
          <div class="twaf-subtitle">Command deck · templates A/B</div>
        </div>
        <span id="twaf59-state-pill" class="twaf-pill">PARADO</span>
        <button id="twaf-collapse" class="twaf-icon-btn" type="button" title="Recolher painel">−</button>
      </div>

      <div class="twaf-shell">
        <div class="twaf-command">
          <label>
            <span>Modelo</span>
            <select id="twaf-template">
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </label>
          <label>
            <span>Raio</span>
            <input id="twaf-radius" type="number" min="1" max="150" step="1">
          </label>
          <button id="twaf-toggle" class="btn twaf-main-btn"></button>
        </div>

        <div class="twaf-tabbar" role="tablist" aria-label="AutoFarm">
          <button class="twaf-tab is-active" type="button" data-tab="now">Agora</button>
          <button class="twaf-tab" type="button" data-tab="model">Modelo</button>
          <button class="twaf-tab" type="button" data-tab="settings">Ajustes</button>
          <button class="twaf-tab" type="button" data-tab="logs">Logs</button>
        </div>

        <div class="twaf-view">
          <section class="twaf-tabpane is-active" data-pane="now">
            <div id="twaf59-status" class="twaf-statusline">Pronto</div>

            <div class="twaf-hero">
              <div class="twaf-timer-card">
                <div class="twaf-timer-label">Próxima passagem</div>
                <strong id="twaf59-countdown" class="twaf-countdown">—</strong>
                <div id="twaf59-schedule-detail" class="twaf-timer-detail">A calcular agendamento…</div>
              </div>
              <div class="twaf-model-card">
                <div class="twaf-card-title">Tropas + capacidade</div>
                <div id="twaf59-modelinfo" class="twaf-model-main">A validar…</div>
                <div id="twaf59-modeldetail" class="twaf-muted"></div>
              </div>
            </div>

            <div class="twaf-metrics">
              <div class="twaf-metric" tabindex="0" data-twaf-tip="Alvos que passaram a estratégia e as guardas operacionais nesta passagem."><b id="twaf-m-ready">—</b><span>Prontas</span></div>
              <div class="twaf-metric" tabindex="0" data-twaf-tip="Ataques enviados que ainda aguardam confirmação por report."><b id="twaf-m-pending">—</b><span>Pendentes</span></div>
              <div class="twaf-metric" tabindex="0" data-twaf-tip="Farms bloqueadas temporariamente por cooldown, segurança ou próxima visita futura."><b id="twaf-m-cooling">—</b><span>Cooldown</span></div>
              <div class="twaf-metric" tabindex="0" data-twaf-tip="Coordenadas inéditas encontradas no mapa que ainda estão a ser verificadas no mapa, Assistente e histórico."><b id="twaf-m-new-candidates">—</b><span>Novas detetadas</span></div>
              <div class="twaf-metric" tabindex="0" data-twaf-tip="Bárbaras confirmadas em dois mapas, ausentes do Assistente e sem histórico anterior. Podem receber o primeiro farm quando houver tropas."><b id="twaf-m-new">—</b><span>Novas prontas</span></div>
            </div>
            <div id="twaf-new-detail" class="twaf-muted">Fila de primeiro farm ainda sem scan.</div>
            <div class="twaf-v2-note">“Nova pronta” = bárbara confirmada em dois mapas frescos (≥60 s) e ausente num scan completo do Assistente. Após o primeiro envio sai desta contagem e passa a “primeiro envio pendente” até aparecer o report.</div>
            <div id="twaf-rotation-summary" class="twaf-data-state">Rotação adaptativa ainda sem passagem.</div>

            <div class="twaf-actions">
              <button id="twaf-now" class="btn">Reavaliar agora</button>
              <button id="twaf-map" class="btn">Atualizar mapa</button>
            </div>

            <div class="twaf-kpi-label">Telemetria contínua · ativa em Adaptativa e Legada</div>
            <div class="twaf-v2-kpis">
              <div class="twaf-v2-kpi" title="Saque confirmado por reports correlacionados com envios desta versão do AutoFarm."><span>AutoFarm · saque</span><b id="twaf-v2-loot">—</b></div>
              <div class="twaf-v2-kpi" title="POSTs de farm confirmados e registados hoje pelo AutoFarm."><span>AutoFarm · envios</span><b id="twaf-v2-capacity">—</b></div>
              <div class="twaf-v2-kpi" title="Reports ligados com segurança a um envio do AutoFarm."><span>AutoFarm · reports</span><b id="twaf-v2-unused">—</b></div>
              <div class="twaf-v2-kpi" title="Reports AutoFarm correlacionados a dividir pelos envios registados hoje."><span>Correlação</span><b id="twaf-v2-commands">—</b></div>
              <div class="twaf-v2-kpi" title="Soma de todos os reports quantitativos observados: AutoFarm, externos e não atribuídos."><span>Observado · saque</span><b id="twaf-v2-strategy">—</b></div>
              <div class="twaf-v2-kpi" title="Saque de reports sem correspondência com um envio pendente do AutoFarm."><span>Externo · saque</span><b id="twaf-v2-probe">—</b></div>
              <div class="twaf-v2-kpi" title="Reports observados hoje pelo modelo; não é o total oficial da conta."><span>Reports observados</span><b id="twaf-v2-rpc">—</b></div>
              <div class="twaf-v2-kpi" title="Reports em que o máximo X/Y do jogo difere da capacidade reconstruída. O valor do report continua autoritativo."><span>Diferenças capacidade</span><b id="twaf-v2-mood">0</b></div>
            </div>
            <div id="twaf-v2-summary" class="twaf-v2-summary">Motor adaptativo a inicializar…</div>
          </section>

          <section class="twaf-tabpane" data-pane="model">
            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Como escolher os alvos</strong><span>estratégia</span></div>
              <div class="twaf-guide">A leitura automática de reports, o histórico, os estados e as estatísticas ficam sempre ativos. Esta opção decide apenas como escolher os alvos: Adaptativa usa o ranking aprendido; Legada usa os cooldowns fixos. Antes de qualquer POST continuam obrigatórias as guardas de tropas, mapa, pending e Bot Protection.</div>
              <div class="twaf-grid">
                <label class="twaf-setting"><span>Estratégia de seleção</span><select id="twaf-adaptive-enabled"><option value="true">Adaptativa (recomendado)</option><option value="false">Legada (cooldowns fixos)</option></select><small class="twaf-field-help">Só muda a seleção. Em ambos os modos o script lê reports, atualiza estados e mantém as estatísticas; no Legado o ranking é apenas informativo.</small></label>
                <label class="twaf-setting"><span>Distribuição temporal</span><select id="twaf-stochastic-mode"><option value="ADAPTIVE_SPREAD">Distribuição adaptativa (mais variabilidade)</option><option value="IMMEDIATE_EFFICIENCY">Eficiência imediata (mais cedo)</option></select><small class="twaf-field-help">Escolhe quando executar dentro da janela em que as provas continuam válidas. Nunca cria GETs durante a espera nem ultrapassa uma proof expirada.</small></label>
                <label class="twaf-setting"><span>Carga de planeamento</span><select id="twaf-adaptive-capmode"><option value="AUTO">Automática — template A/B atual</option><option value="MANUAL">Manual</option></select><small class="twaf-field-help">Decide a capacidade usada para prever a próxima visita. Nunca reinterpreta reports antigos nem altera o stock aprendido.</small></label>
                <label class="twaf-setting"><span>Carga manual / fallback</span><input id="twaf-adaptive-refcap" type="number" min="40" max="2000" step="40"><small class="twaf-field-help">Usada em modo Manual e como fallback antes de ser possível ler a composição A/B atual.</small></label>
                <label class="twaf-setting"><span>Peso reduz a metade após</span><input id="twaf-adaptive-halflife" type="number" min="12" max="336"> h<small class="twaf-field-help">Quanto menor, mais depressa os dados recentes substituem padrões antigos.</small></label>
                <label class="twaf-setting"><span>Histórico usado nos cálculos</span><input id="twaf-adaptive-history" type="number" min="3" max="7" step="1"> dias<small class="twaf-field-help">Limite duro: reports anteriores deixam de contar para previsão, certeza e precisão.</small></label>
                <label class="twaf-setting"><span>Forçar nova observação após</span><input id="twaf-adaptive-maxunseen" type="number" min="6" max="168"> h<small class="twaf-field-help">Impede uma farm conhecida de ficar esquecida. Ao vencer, torna-se uma visita obrigatória quando for seguro.</small></label>
                <label class="twaf-setting"><span>Meta para voltar à farm</span><input id="twaf-adaptive-fill" type="number" min="30" max="95"> %<small class="twaf-field-help">O modelo estima quando a carga poderá atingir esta percentagem e calcula a próxima visita.</small></label>
                <label class="twaf-setting"><span>Mínimo esperado para enviar</span><input id="twaf-adaptive-dispatch" type="number" min="10" max="95"> %<small class="twaf-field-help">Bloqueia envios maduros com pouco rendimento esperado. Não bloqueia cobertura obrigatória.</small></label>
                <label class="twaf-setting"><span>Descanso mínimo da rotação contínua</span><input id="twaf-adaptive-early-rest" type="number" min="0.5" max="12" step="0.5"> h<small class="twaf-field-help">Se nenhuma farm estiver na hora ideal, permite antecipar a melhor farm segura só depois deste descanso.</small></label>
                <label class="twaf-setting"><span>Atualização de manutenção</span><input id="twaf-adaptive-maintenance" type="number" min="0.25" step="0.25"> h<small class="twaf-field-help">Mesmo sem alvo ideal, o mapa e os reports voltam a ser lidos até este prazo. Nunca encurta o intervalo mínimo entre passagens.</small></label>
                <label class="twaf-setting"><span>Observações para sair de aprendizagem</span><input id="twaf-adaptive-learning" type="number" min="1" max="8" step="1"><small class="twaf-field-help">Até atingir este número de reports quantitativos, a farm recebe prioridade de aprendizagem/cobertura.</small></label>
                <label class="twaf-setting"><span>Detalhes de reports por passagem</span><input id="twaf-adaptive-reports" type="number" min="1" max="12"><small class="twaf-field-help">Máximo de detalhes individuais lidos automaticamente por passagem, mesmo no Legado. Não precisas de abrir Relatórios; o backlog continua nas passagens seguintes.</small></label>
              </div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Últimos reports</strong><span>capacidade do jogo</span></div>
              <div class="twaf-ranking-wrap">
                <table class="twaf-ranking">
                  <thead><tr><th>Hora</th><th>Farm</th><th>Origem</th><th>Saque</th><th>Máx.</th><th>Ef.</th><th>Stock</th><th>Fonte</th></tr></thead>
                  <tbody id="twaf-v2-reports"><tr><td colspan="8">Ainda sem reports.</td></tr></tbody>
                </table>
              </div>
              <div class="twaf-v2-note">REPORT usa diretamente o máximo X/Y do Tribal Wars. SURVIVORS e SENT são fallbacks quando esse máximo não está disponível; uma divergência nunca substitui o valor do jogo.</div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Dados e confiança</strong><span>reports reais</span></div>
              <div id="twaf-v2-data-state" class="twaf-data-state">A aguardar a primeira leitura de reports.</div>
              <div id="twaf-v2-health" class="twaf-diag"></div>
              <div id="twaf-v2-attribution" class="twaf-diag"></div>
              <div id="twaf-v2-account" class="twaf-diag"></div>
              <div id="twaf-v2-accuracy" class="twaf-diag"></div>
              <div class="twaf-kpi-label">Notas das farms (F5 melhor → F0 pior)</div>
              <div id="twaf-v2-bars" class="twaf-bars"></div>
              <div class="twaf-kpi-label">Certeza</div>
              <div id="twaf-v2-certainty" class="twaf-bars"></div>
              <div id="twaf-v2-windows" class="twaf-diag"></div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Quando rende mais</strong><span>hora + distância</span></div>
              <div class="twaf-kpi-label">Eficiência por hora do dia</div>
              <div id="twaf-v2-hour" class="twaf-bars"></div>
              <div class="twaf-v2-note">A eficiência usa o máximo X/Y escrito no próprio report e nunca ultrapassa 100%. Diferenças face à composição reconstruída aparecem apenas como diagnóstico.</div>
              <div class="twaf-kpi-label">Eficiência por distância</div>
              <div id="twaf-v2-distance" class="twaf-bars"></div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Farm Model</strong><span>qualidade estrutural · top 10</span></div>
              <div class="twaf-ranking-wrap">
                <table class="twaf-ranking">
                  <thead><tr><th>Farm</th><th>Nota</th><th>Prob. boa</th><th>Certeza</th><th>Estado</th><th>Stock est.</th><th>Próximo envio</th></tr></thead>
                  <tbody id="twaf-v2-ranking"><tr><td colspan="7">Sem modelo.</td></tr></tbody>
                </table>
              </div>
              <div class="twaf-v2-note">O Farm Model aprende stock a partir de reports reais e é independente do template. A ou B só entram no momento de calcular o potencial do próximo envio. O botão C nativo é uma ação especial baseada em espionagem e não é automatizado como template.</div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Próximos candidatos A/B</strong><span>Execution Score da última passagem</span></div>
              <div class="twaf-ranking-wrap">
                <table class="twaf-ranking">
                  <thead><tr><th>#</th><th>Farm</th><th>Timing</th><th>Motivo</th><th>Carga</th><th>E[saque]</th><th>Ef.</th><th>P(cheia)</th><th>Chegada</th><th>Contexto</th></tr></thead>
                  <tbody id="twaf-v2-execution"><tr><td colspan="10">Ainda sem passagem adaptativa com A/B validado.</td></tr></tbody>
                </table>
              </div>
              <div class="twaf-v2-note">Hora e distância ajustam moderadamente apenas o valor desta viagem (hora de chegada). Nunca alteram o stock, X/Y ou certeza aprendidos.</div>
            </div>
          </section>

          <section class="twaf-tabpane" data-pane="settings">
            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Farm + cooldowns</strong><span>fallback / segurança</span></div>
              <div class="twaf-grid">
                <label><span>Saque parcial</span><input id="twaf-clean" type="number" min="1" max="10080"> min</label>
                <label><span>Saque cheio</span><input id="twaf-full" type="number" min="0" max="10080"> min</label>
                <label><span>Com perdas</span><input id="twaf-loss" type="number" min="1" max="43200"> min</label>
              </div>
              <div class="twaf-v2-note">Em modo adaptativo, parcial/cheio funcionam como fallback enquanto não existe observação v2. Perdas, unknown, pending e estados incertos continuam a impor bloqueio de segurança.</div>
            </div>

            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Execução automática</strong><span>ritmo</span></div>
              <div class="twaf-grid">
                <label><span>Intervalo mínimo entre passagens</span><input id="twaf-retry" type="number" min="15"> s</label>
                <label><span>Máx. envios/passagem</span><input id="twaf-max" type="number" min="1" max="100"></label>
                <label><span>Intervalo entre envios</span><input id="twaf-gap" type="number" min="0" step="0.1"> s</label>
              </div>
              <div class="twaf-v2-note">O intervalo mínimo começa quando a passagem termina e o adaptativo nunca o encurta. Não existe teto artificial: 7200 s = 2 h. O intervalo entre envios não tem máximo escondido e pode ser 0; cada wake continua limitado a um único POST.</div>
            </div>

            <div class="twaf-foot">Valida modelo, tropas e alvo antes de cada envio sempre que existem dados fiáveis. Disponibilidade desconhecida não é testada com POST. Bot Protection/CAPTCHA provoca paragem automática.</div>
          </section>

          <section class="twaf-tabpane" data-pane="logs">
            <div class="twaf-section">
              <div class="twaf-section-head"><strong>Diagnóstico</strong><span>estado interno</span></div>
              <div id="twaf59-stats" class="twaf-diag"></div>
              <div id="twaf59-scan" class="twaf-diag"></div>
              <div id="twaf59-senddiag" class="twaf-diag"></div>
              <div class="twaf-log-actions">
                <button id="twaf-copy-log" class="btn">Copiar logs</button>
                <button id="twaf-clear-log" class="btn">Limpar consola</button>
              </div>
              <pre id="twaf59-console" class="twaf-console">Sem logs.</pre>
              <div class="twaf-danger-row">
                <button id="twaf-reset-adaptive" class="btn">Reset modelo v2</button>
                <button id="twaf-reset" class="btn">Reset estados</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    document.body.appendChild(p);
    installPanelTooltips(p);

    // UI v2.0.7: navegação compacta por separadores. É apenas apresentação;
    // todos os IDs operacionais continuam presentes e a lógica de farming não depende do separador ativo.
    const uiTabs = [...p.querySelectorAll('.twaf-tab')];
    const uiPanes = [...p.querySelectorAll('.twaf-tabpane')];
    const activateUiTab = name => {
      const selected = String(name || 'now');
      for (const tab of uiTabs) tab.classList.toggle('is-active', tab.dataset.tab === selected);
      for (const pane of uiPanes) pane.classList.toggle('is-active', pane.dataset.pane === selected);
      try { sessionStorage.setItem('twaf59-ui-tab', selected); } catch (_) {}
    };
    for (const tab of uiTabs) tab.addEventListener('click', () => activateUiTab(tab.dataset.tab));
    try {
      const rememberedTab = sessionStorage.getItem('twaf59-ui-tab');
      if (rememberedTab && uiTabs.some(tab => tab.dataset.tab === rememberedTab)) activateUiTab(rememberedTab);
    } catch (_) {}

    const collapseBtn = p.querySelector('#twaf-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        p.classList.toggle('twaf-collapsed');
        const collapsed = p.classList.contains('twaf-collapsed');
        collapseBtn.textContent = collapsed ? '+' : '−';
        collapseBtn.dataset.twafTip = collapsed ? 'Expandir painel' : 'Recolher painel';
      });
    }

    function loadPanelCfg(villageId = currentVillageId()) {
      const c = cfg(villageId);
      p.querySelector('#twaf-template').value = c.farmTemplate;
      p.querySelector('#twaf-radius').value = c.radius;
      p.querySelector('#twaf-clean').value = c.cleanCooldownMin;
      p.querySelector('#twaf-full').value = c.fullCooldownMin;
      p.querySelector('#twaf-loss').value = c.lossCooldownMin;
      p.querySelector('#twaf-retry').value = c.retrySeconds;
      p.querySelector('#twaf-max').value = c.maxSendsPerPass;
      p.querySelector('#twaf-gap').value = Number(c.attemptGapMs / 1000).toFixed(1);
      p.querySelector('#twaf-adaptive-enabled').value = String(Boolean(c.adaptiveEnabled));
      p.querySelector('#twaf-stochastic-mode').value = c.stochasticSchedulingMode;
      p.querySelector('#twaf-adaptive-capmode').value = c.adaptivePlanningCapacityMode;
      p.querySelector('#twaf-adaptive-refcap').value = c.adaptiveReferenceCapacity;
      p.querySelector('#twaf-adaptive-halflife').value = c.adaptiveHalfLifeHours;
      p.querySelector('#twaf-adaptive-history').value = c.adaptiveHistoryDays;
      p.querySelector('#twaf-adaptive-maxunseen').value = c.adaptiveMaxUnseenHours;
      p.querySelector('#twaf-adaptive-fill').value = Math.round(c.adaptiveRevisitFillThreshold * 100);
      p.querySelector('#twaf-adaptive-dispatch').value = Math.round(c.adaptiveMinDispatchEfficiency * 100);
      p.querySelector('#twaf-adaptive-early-rest').value = c.adaptiveEarlyRotationMinHours;
      p.querySelector('#twaf-adaptive-maintenance').value = c.adaptiveMaintenanceMaxHours;
      p.querySelector('#twaf-adaptive-learning').value = c.adaptiveLearningTargetObservations;
      p.querySelector('#twaf-adaptive-reports').value = c.adaptiveReportFetchPerPass;
      p.dataset.villageId = String(villageId || '');
      RUNTIME.panelVillageId = String(villageId || '');
    }

    function invalidateTargetDiscovery(villageId, persistSharedState = true) {
      RUNTIME.villageMap = null;
      RUNTIME.villageMapLoadedAt = 0;
      RUNTIME.villageMapContextKey = '';
      RUNTIME.targetsByVillage.delete(String(villageId));
      if (persistSharedState) {
        saveJSON('dynamicTargets', [], villageId);
        saveCursor(0, villageId, 0);
      }

      for (const key of [...RUNTIME.farmCacheByVillage.keys()]) {
        if (String(key).startsWith(`${villageId}:`)) RUNTIME.farmCacheByVillage.delete(key);
      }

      RUNTIME.lastEligibleByVillage.delete(String(villageId));
      RUNTIME.lastBootstrapByVillage.delete(String(villageId));
      RUNTIME.lastQueueBreakdownByVillage.delete(String(villageId));
      RUNTIME.lastAdaptiveExecutionByVillage.delete(String(villageId));
      RUNTIME.mapBootstrapConfirmedByVillage.delete(String(villageId));
      RUNTIME.mapBootstrapAwaitingByVillage.delete(String(villageId));
      RUNTIME.lastScan = null;
    }

    function savePanelCfg() {
      const villageId = currentVillageId();
      const old = cfg(villageId);

      const next = {
        ...old,
        farmTemplate: p.querySelector('#twaf-template').value,
        radius: p.querySelector('#twaf-radius').value,
        cleanCooldownMin: p.querySelector('#twaf-clean').value,
        fullCooldownMin: p.querySelector('#twaf-full').value,
        lossCooldownMin: p.querySelector('#twaf-loss').value,
        retrySeconds: p.querySelector('#twaf-retry').value,
        maxSendsPerPass: p.querySelector('#twaf-max').value,
        attemptGapMs: Number(p.querySelector('#twaf-gap').value) * 1000,

        adaptiveEnabled: p.querySelector('#twaf-adaptive-enabled').value === 'true',
        stochasticSchedulingMode: p.querySelector('#twaf-stochastic-mode').value,
        adaptivePlanningCapacityMode: p.querySelector('#twaf-adaptive-capmode').value,
        adaptiveReferenceCapacity: p.querySelector('#twaf-adaptive-refcap').value,
        adaptiveHalfLifeHours: p.querySelector('#twaf-adaptive-halflife').value,
        adaptiveHistoryDays: p.querySelector('#twaf-adaptive-history').value,
        adaptiveMaxUnseenHours: p.querySelector('#twaf-adaptive-maxunseen').value,
        adaptiveRevisitFillThreshold: Number(p.querySelector('#twaf-adaptive-fill').value) / 100,
        adaptiveMinDispatchEfficiency: Number(p.querySelector('#twaf-adaptive-dispatch').value) / 100,
        adaptiveEarlyRotationMinHours: p.querySelector('#twaf-adaptive-early-rest').value,
        adaptiveMaintenanceMaxHours: p.querySelector('#twaf-adaptive-maintenance').value,
        adaptiveLearningTargetObservations: p.querySelector('#twaf-adaptive-learning').value,
        adaptiveReportFetchPerPass: p.querySelector('#twaf-adaptive-reports').value
      };

      if (!saveCfg(next, villageId)) {
        info('Não foi possível gravar as definições no localStorage.', true);
        loadPanelCfg(villageId);
        return;
      }

      const normalized = cfg(villageId);
      RUNTIME.adaptiveSnapshotByVillage.delete(String(villageId));
      const activeForeignLease = foreignLease(villageId);

      const adaptiveSettingsChanged = [
        'adaptiveEnabled',
        'stochasticSchedulingMode',
        'adaptivePlanningCapacityMode',
        'adaptiveReferenceCapacity',
        'adaptiveHalfLifeHours',
        'adaptiveHistoryDays',
        'adaptiveMaxUnseenHours',
        'adaptiveRevisitFillThreshold',
        'adaptiveMinDispatchEfficiency',
        'adaptiveMaintenanceMaxHours',
        'adaptiveReportFetchPerPass'
      ].some(key => normalized[key] !== old[key]);

      if (adaptiveSettingsChanged && normalized.adaptiveEnabled) {
        if (activeForeignLease) {
          addDiagnostic(
            'ADAPTIVO',
            'Parâmetros v2 gravados; recálculo adiado porque outra aba está a executar.',
            'a próxima passagem recalculará o modelo sem concorrer com a escrita ativa',
            villageId
          );
        } else {
          const store = adaptiveStore(villageId);
          const now = Date.now();
          for (const [coord, raw] of Object.entries(store.farms || {})) {
            const farm = normalizeAdaptiveFarm(raw, coord, raw?.distance);
            if (farm.active) recalcAdaptiveFarm(farm, store, normalized, now);
            store.farms[coord] = farm;
          }
          if (!saveAdaptiveStore(store, villageId)) {
            info('As definições foram gravadas, mas não foi possível recalcular o modelo adaptativo.', true);
          } else {
            addDiagnostic('ADAPTIVO', 'Parâmetros v2 atualizados; previsões recalculadas.', '', villageId);
          }
        }
      }

      if (normalized.radius !== old.radius) {
        // Numa aba passiva limpamos apenas caches locais. A aba proprietária vê a
        // alteração no liveCfg e interrompe novos envios; o próximo mapa fresco grava
        // a nova lista/cursor sem uma escrita concorrente desta aba.
        invalidateTargetDiscovery(villageId, !activeForeignLease);
        if (activeForeignLease) {
          addDiagnostic(
            'MAPA',
            `Raio alterado para ${normalized.radius} enquanto outra aba executa.`,
            'caches locais invalidados; lista/cursor partilhados serão atualizados na próxima passagem',
            villageId
          );
        }
        info(`Raio alterado para ${normalized.radius}. A lista de bárbaras será recalculada.`);
      }

      if (normalized.farmTemplate !== old.farmTemplate) {
        clearTemplateCacheForVillage(villageId);
        info(`Modelo alterado para ${normalized.farmTemplate}.`);
      }

      if (
        normalized.enabled &&
        !RUNTIME.busy &&
        !activeForeignLease &&
        (
          normalized.radius !== old.radius ||
          normalized.farmTemplate !== old.farmTemplate ||
          normalized.stochasticSchedulingMode !== old.stochasticSchedulingMode ||
          normalized.maxSendsPerPass !== old.maxSendsPerPass ||
          normalized.adaptiveMinDispatchEfficiency !== old.adaptiveMinDispatchEfficiency
        )
      ) {
        const coordination = coordinationState(villageId);
        if (normalized.radius !== old.radius) {
          coordination.sources.MAP.invalidated = true;
          coordination.sources.ASSISTANT.invalidated = true;
        }
        if (normalized.farmTemplate !== old.farmTemplate) {
          coordination.sources.TEMPLATE.invalidated = true;
          coordination.sources.CAPACITY.invalidated = true;
        }
        saveCoordinationState(coordination, villageId);
        invalidateExecutionCycle(
          villageId,
          'definição relevante alterada; plano anterior não será reutilizado',
          'OBSERVATION',
          Date.now() + 500
        );
      }

      if (
        normalized.retrySeconds !== old.retrySeconds &&
        normalized.enabled &&
        !RUNTIME.busy
      ) {
        if (activeForeignLease) {
          addDiagnostic(
            'AGENDA',
            'Intervalo alterado enquanto outra aba executa; sem escrever nextRunAt concorrente.',
            `${old.retrySeconds}s → ${normalized.retrySeconds}s`,
            villageId
          );
          armLeaseRecovery(villageId, 'intervalo alterado em aba passiva');
        } else {
          const sched = schedulerState(villageId);
          const base = Number(sched.lastPassFinishedAt || 0) || Date.now();
          const desired = nextAutomaticPassAt(
            base,
            normalized.adaptiveEnabled ? adaptiveStore(villageId) : null,
            normalized
          );
          scheduleAt(
            desired > Date.now() ? desired : Date.now() + 500,
            villageId,
            `intervalo alterado para ${normalized.retrySeconds}s`
          );
          addDiagnostic('AGENDA', 'Intervalo alterado.', `${old.retrySeconds}s → ${normalized.retrySeconds}s`, villageId);
        }
      }

      loadPanelCfg(villageId);
      renderPanel();
    }

    loadPanelCfg();

    [
      '#twaf-template', '#twaf-radius', '#twaf-clean', '#twaf-full', '#twaf-loss',
      '#twaf-retry', '#twaf-max', '#twaf-gap', '#twaf-adaptive-enabled',
      '#twaf-stochastic-mode',
      '#twaf-adaptive-capmode', '#twaf-adaptive-refcap', '#twaf-adaptive-halflife', '#twaf-adaptive-history', '#twaf-adaptive-maxunseen',
      '#twaf-adaptive-fill', '#twaf-adaptive-dispatch', '#twaf-adaptive-early-rest',
      '#twaf-adaptive-maintenance', '#twaf-adaptive-learning', '#twaf-adaptive-reports'
    ].forEach(id => p.querySelector(id).addEventListener('change', savePanelCfg));

    p.querySelector('#twaf-toggle').addEventListener('click', () => {
      savePanelCfg();
      const villageId = currentVillageId();
      const old = cfg(villageId);
      const next = { ...old, enabled: !old.enabled };
      if (!saveCfg(next, villageId)) {
        info('Não foi possível gravar o estado INICIAR/PARAR no localStorage.', true);
        return;
      }
      RUNTIME.stopReason = '';

      if (next.enabled) {
        if (accountHardStopActive()) {
          const confirmFn = typeof topWin().confirm === 'function' ? topWin().confirm.bind(topWin()) : null;
          const confirmed = confirmFn
            ? confirmFn('Existe um hard-stop da conta. Confirma que já resolveste a proteção e queres reativar manualmente o AutoFarm?')
            : false;
          if (!confirmed || AntiBotGuard.isActive()) {
            saveCfg({ ...next, enabled: false }, villageId);
            info('Hard-stop mantido. Resolve a proteção antes de reativar manualmente.', true);
            return;
          }
          clearAccountHardStopManually();
        }
        RUNTIME.hardStopReasonsByVillage.delete(String(villageId));
        if (AntiBotGuard.isActive()) {
          saveCfg({ ...next, enabled: false }, villageId);
          info('Não é possível iniciar: Bot Protection/CAPTCHA foi detetada. Recarrega depois de resolver.', true);
          return;
        }

        const coordination = coordinationState(villageId);
        coordination.state = 'WAITING_WORK';
        coordination.reason = 'início manual';
        saveCoordinationState(coordination, villageId);

        info(`AutoFarm iniciado · modelo ${next.farmTemplate} · raio ${next.radius}. A executar agora.`);
        requestImmediatePass(villageId, 'início manual');
      } else {
        cancelSchedule(villageId, 'paragem manual');
        const coordination = coordinationState(villageId);
        coordination.state = 'DISABLED';
        coordination.executionPlan = null;
        coordination.stochasticPlan = null;
        coordination.executionDueAt = 0;
        coordination.nextWakeAt = 0;
        coordination.reason = 'paragem manual';
        saveCoordinationState(coordination, villageId);

        // Se há um POST em curso, mantém o lease até ao finally da passagem.
        // Isto evita que outra aba assuma a aldeia antes de sabermos o resultado do pedido atual.
        if (!(RUNTIME.busy && RUNTIME.activeVillageId === String(villageId))) {
          releaseLease(villageId);
        }
        info(RUNTIME.busy
          ? 'Paragem pedida; a concluir o pedido em curso. Não será agendada nova passagem.'
          : 'AutoFarm parado. Agendamento automático cancelado.');
      }

      renderPanel();
    });

    p.querySelector('#twaf-now').addEventListener('click', () => {
      savePanelCfg();
      if (!cfg().enabled) {
        info('Primeiro carrega em INICIAR.', true);
        return;
      }
      requestImmediatePass(currentVillageId(), 'Reavaliar agora');
    });

    p.querySelector('#twaf-map').addEventListener('click', async () => {
      savePanelCfg();
      const villageId = currentVillageId();
      if (RUNTIME.busy) {
        info('Aguarda o fim da passagem atual antes de atualizar as bárbaras.', true);
        return;
      }

      if (!acquireLease(villageId)) {
        info('Outra aba está a executar esta aldeia.', true);
        return;
      }

      try {
        const radius = cfg(villageId).radius;
        info(`A procurar bárbaras num raio ${radius}…`);
        const map = await getVillageMap(villageId, {
          rebuildSubset: true,
          requireFreshWorld: true
        });
        RUNTIME.farmCacheByVillage.delete(`${villageId}:r${radius}`);
        info(`Encontradas ${map.size} bárbaras num raio ${radius}.`);
      } catch (err) {
        if (err?.code === 'BOT_PROTECTION_ACTIVE') return;
        if (err?.code === 'LOGIN_REQUIRED') coordinatedHardStop('sessão expirada / login necessário', villageId);
        else info(`Erro ao atualizar bárbaras: ${err?.message || err}`, true);
      } finally {
        releaseLease(villageId);
        renderPanel();
      }
    });

    p.querySelector('#twaf-copy-log').addEventListener('click', async () => {
      const villageId = currentVillageId();
      const content = diagnosticText(villageId) || 'Sem logs.';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(content);
        } else {
          const ta = document.createElement('textarea');
          ta.value = content;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        addDiagnostic('AÇÃO', 'Logs copiados para a área de transferência.', '', villageId);
        renderPanel();
      } catch (err) {
        info(`Não foi possível copiar os logs: ${err?.message || err}`, true);
      }
    });

    p.querySelector('#twaf-clear-log').addEventListener('click', () => {
      const villageId = currentVillageId();
      clearDiagnostic(villageId);
      addDiagnostic('AÇÃO', 'Consola de diagnóstico limpa.', '', villageId);
      renderPanel();
    });

    p.querySelector('#twaf-reset-adaptive').addEventListener('click', () => {
      if (RUNTIME.busy) {
        info('Não é possível apagar o modelo adaptativo durante uma passagem ativa.', true);
        return;
      }
      const villageId = currentVillageId();
      if (foreignLease(villageId)) {
        info('Outra aba está a executar esta aldeia; o reset do modelo foi bloqueado para evitar concorrência de escrita.', true);
        return;
      }
      if (!confirm('Apagar apenas o modelo estatístico v2 desta aldeia de origem? Estados, pending e cooldowns operacionais serão mantidos.')) return;
      if (!saveJSON('adaptiveV2', {
        schema: ADAPTIVE_SCHEMA_VERSION,
        farms: {},
        events: [],
        dispatches: [],
        reportLedger: [],
        reportIndex: {},
        sectors: {},
        bootstrapFairness: {},
        allocationBudget: {},
        ingestHealth: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        revision: 1,
        lastMaintenanceDay: ''
      }, villageId)) {
        info('Não foi possível apagar o modelo adaptativo.', true);
        return;
      }
      RUNTIME.adaptiveSnapshotByVillage.delete(String(villageId));
      addDiagnostic('ADAPTIVO', 'Modelo v2 reiniciado pelo utilizador.', 'Estados operacionais preservados.', villageId);
      info('Modelo adaptativo v2 reiniciado. Estados/pending/cooldowns foram preservados.');
      renderPanel();
    });

    p.querySelector('#twaf-reset').addEventListener('click', () => {
      if (RUNTIME.busy) {
        info('Não é possível fazer reset durante uma passagem ativa.', true);
        return;
      }

      if (foreignLease(currentVillageId())) {
        info('Outra aba está a executar esta aldeia; o reset de estados foi bloqueado para evitar concorrência de escrita.', true);
        return;
      }

      const count = targetCoords(currentVillageId()).length;
      if (!confirm(`Apagar estados, cooldowns e pendentes dos ${count || 'atuais'} alvos desta aldeia de origem?`)) return;

      const villageId = currentVillageId();
      if (!saveStates({}, villageId) || !saveCursor(0, villageId, targetCoords(villageId).length)) {
        info('Não foi possível gravar o reset no localStorage.', true);
        return;
      }
      clearTemplateCacheForVillage(villageId);

      for (const key of [...RUNTIME.farmCacheByVillage.keys()]) {
        if (String(key).startsWith(`${villageId}:`)) RUNTIME.farmCacheByVillage.delete(key);
      }

      RUNTIME.lastEligibleByVillage.delete(String(villageId));
      RUNTIME.lastBootstrapByVillage.delete(String(villageId));
      RUNTIME.lastQueueBreakdownByVillage.delete(String(villageId));
      removeJSON('visualScanV2', villageId);
      info('Estados apagados.');
      renderPanel();
    });

    renderPanel();
  }

  function renderPanel() {
    const p = document.getElementById('twaf59-panel');
    if (!p) return;

    const villageId = currentVillageId();
    const c = cfg(villageId);
    renderClock();

    if (String(p.dataset.villageId || '') !== String(villageId || '')) {
      p.querySelector('#twaf-template').value = c.farmTemplate;
      p.querySelector('#twaf-radius').value = c.radius;
      p.querySelector('#twaf-clean').value = c.cleanCooldownMin;
      p.querySelector('#twaf-full').value = c.fullCooldownMin;
      p.querySelector('#twaf-loss').value = c.lossCooldownMin;
      p.querySelector('#twaf-retry').value = c.retrySeconds;
      p.querySelector('#twaf-max').value = c.maxSendsPerPass;
      p.querySelector('#twaf-gap').value = Number(c.attemptGapMs / 1000).toFixed(1);
      p.querySelector('#twaf-adaptive-enabled').value = String(Boolean(c.adaptiveEnabled));
      p.querySelector('#twaf-stochastic-mode').value = c.stochasticSchedulingMode;
      p.querySelector('#twaf-adaptive-capmode').value = c.adaptivePlanningCapacityMode;
      p.querySelector('#twaf-adaptive-refcap').value = c.adaptiveReferenceCapacity;
      p.querySelector('#twaf-adaptive-halflife').value = c.adaptiveHalfLifeHours;
      p.querySelector('#twaf-adaptive-history').value = c.adaptiveHistoryDays;
      p.querySelector('#twaf-adaptive-maxunseen').value = c.adaptiveMaxUnseenHours;
      p.querySelector('#twaf-adaptive-fill').value = Math.round(c.adaptiveRevisitFillThreshold * 100);
      p.querySelector('#twaf-adaptive-dispatch').value = Math.round(c.adaptiveMinDispatchEfficiency * 100);
      p.querySelector('#twaf-adaptive-early-rest').value = c.adaptiveEarlyRotationMinHours;
      p.querySelector('#twaf-adaptive-maintenance').value = c.adaptiveMaintenanceMaxHours;
      p.querySelector('#twaf-adaptive-learning').value = c.adaptiveLearningTargetObservations;
      p.querySelector('#twaf-adaptive-reports').value = c.adaptiveReportFetchPerPass;
      p.dataset.villageId = String(villageId || '');
      RUNTIME.panelVillageId = String(villageId || '');
    }

    const st = stats(villageId);
    const persistedVisualScan = visualScanSnapshot(villageId, c);

    const runtimeScanCandidate = RUNTIME.lastScan?.villageId === String(villageId) ? RUNTIME.lastScan : null;
    const persistedVisualIsNewer = Boolean(
      persistedVisualScan &&
      (!runtimeScanCandidate || Number(persistedVisualScan.updatedAt) > Number(runtimeScanCandidate.at || 0))
    );
    const runtimeScanForDisplay = persistedVisualIsNewer ? null : runtimeScanCandidate;
    const runtimeBootstrap = runtimeScanForDisplay
      ? RUNTIME.lastBootstrapByVillage.get(String(villageId))
      : undefined;
    // O snapshot persistido é a fonte visual canónica: também é atualizado quando
    // uma coordenada sai da fila durante a própria passagem e sincroniza entre abas.
    const visualBootstrap = persistedVisualScan?.newReadyCount ?? runtimeBootstrap ?? '—';
    const toggle = p.querySelector('#twaf-toggle');
    if (toggle) toggle.textContent = c.enabled ? 'PARAR' : 'INICIAR';

    const statePill = p.querySelector('#twaf59-state-pill');
    if (statePill) {
      if (AntiBotGuard.isActive()) statePill.textContent = 'BLOQUEADO';
      else if (RUNTIME.busy) statePill.textContent = 'A TRABALHAR';
      else if (c.enabled) statePill.textContent = 'ATIVO';
      else statePill.textContent = 'PARADO';
    }

    const status = p.querySelector('#twaf59-status');
    if (status) {
      if (AntiBotGuard.isActive()) status.textContent = 'Bot Protection/CAPTCHA detetado — AutoFarm parado.';
      else status.textContent = RUNTIME.lastStatus || (c.enabled ? 'Ativo. A aguardar a próxima passagem automática.' : 'Pronto.');
    }

    const metricValues = {
      '#twaf-m-ready': st.ready,
      '#twaf-m-pending': st.pending + st.sending,
      '#twaf-m-cooling': st.cooling,
      '#twaf-m-new-candidates': persistedVisualScan?.newCandidateCount ?? '—',
      '#twaf-m-new': visualBootstrap
    };
    for (const [selector, value] of Object.entries(metricValues)) {
      const el = p.querySelector(selector);
      if (el) el.textContent = String(value);
    }
    const newMetric = p.querySelector('#twaf-m-new');
    const newCandidatesMetric = p.querySelector('#twaf-m-new-candidates');
    if (newCandidatesMetric) {
      const tipTarget = newCandidatesMetric.closest?.('.twaf-metric') || newCandidatesMetric;
      tipTarget.dataset.twafTip = persistedVisualScan
        ? `${persistedVisualScan.newCandidateCount || 0} coordenada(s) inédita(s) detetada(s): ` +
          `${persistedVisualScan.awaitingMapCount || 0} no mapa, ${persistedVisualScan.newAbsenceCheckCount || 0} na prova de ausência, ` +
          `${persistedVisualScan.newHistoryCheckCount || 0} no histórico e ${persistedVisualScan.newReadyCount || 0} prontas.`
        : 'Ainda sem scan disponível.';
    }
    if (newMetric) {
      const tipTarget = newMetric.closest?.('.twaf-metric') || newMetric;
      tipTarget.dataset.twafTip = persistedVisualScan
        ? `${persistedVisualScan.newReadyCount ?? 0} prontas · ${persistedVisualScan.newPendingCount || 0} primeiro(s) envio(s) pendente(s) · ` +
          `${persistedVisualScan.newCandidateCount || 0} candidata(s) detetada(s) no total · ` +
          `${persistedVisualScan.newHistoryCheckCount || 0} a verificar histórico · ` +
          `${persistedVisualScan.newAbsenceCheckCount || 0} a aguardar prova do Assistente · ` +
          `${persistedVisualScan.awaitingMapCount || 0} coordenada(s) do mapa por confirmar. ` +
          `Atualizado ${visualSnapshotAgeText(persistedVisualScan.updatedAt)}; snapshot apenas visual.`
        : 'Ainda sem scan disponível.';
    }

    const capacity = RUNTIME.lastCapacityByVillage.get(String(villageId));
    const modelInfo = p.querySelector('#twaf59-modelinfo');
    const modelDetail = p.querySelector('#twaf59-modeldetail');

    if (modelInfo) {
      if (!capacity) {
        modelInfo.textContent = `Modelo ${c.farmTemplate} · ainda não validado`;
      } else if (!capacity.known) {
        modelInfo.textContent = `Modelo ${c.farmTemplate} · disponibilidade desconhecida`;
      } else {
        const qualifier = capacity.exact ? 'capacidade' : 'capacidade conservadora';
        modelInfo.textContent = `Modelo ${c.farmTemplate} · ${qualifier}: ${capacity.capacity ?? '—'} farm(s)`;
      }
    }

    if (modelDetail) {
      if (!capacity) {
        modelDetail.textContent = 'A composição e as tropas serão verificadas na próxima passagem.';
      } else {
        const compositionText = formatComposition(capacity.composition);
        const availabilityText = formatRequiredAvailability(capacity.composition, capacity.currentUnits);
        const parts = [
          `Composição: ${compositionText}`,
          availabilityText !== '—' ? `Disponível/necessário: ${availabilityText}` : null,
          `Tropas: ${capacity.source || '—'}`,
          capacity.templateSource ? `Modelo: ${capacity.templateSource}` : null
        ].filter(Boolean);
        modelDetail.textContent = parts.join(' · ');
      }
    }


    const adaptiveSummary = adaptiveDashboardSnapshot(villageId);
    const queueBreakdown = RUNTIME.lastQueueBreakdownByVillage.get(String(villageId)) || null;
    const newDetail = p.querySelector('#twaf-new-detail');
    if (newDetail) {
      const allocation = adaptiveSummary.allocationBudget || { total: 0, confirmed: {} };
      const allocationPolicy = adaptiveSummary.allocationPolicy || { quotas: {} };
      const reportIndex = adaptiveSummary.reportIndex || {};
      const change = persistedVisualScan?.lastNewChange;
      const addedCount = change?.added?.length || 0;
      const removedCount = change?.removed?.length || 0;
      const lastChange = persistedVisualScan?.lastNewChangeAt
        ? ` · última alteração ${visualSnapshotAgeText(persistedVisualScan.lastNewChangeAt)} (+${addedCount}/−${removedCount})`
        : '';
      const candidates = Number(persistedVisualScan?.newCandidateCount || 0);
      const ready = Number(persistedVisualScan?.newReadyCount || 0);
      const waitingHistory = Number(persistedVisualScan?.newHistoryCheckCount || 0);
      newDetail.className = candidates > 0 && ready === 0 ? 'twaf-data-state is-warn' : 'twaf-muted';
      newDetail.textContent = persistedVisualScan
        ? `${candidates} nova(s) detetada(s) · ${ready} pronta(s) para primeiro farm · ` +
          `${persistedVisualScan.newPendingCount || 0} primeiro(s) envio(s) pendente(s) · ` +
          `${persistedVisualScan.knownMissingCount || 0} conhecida(s) temporariamente sem row · ` +
          `${waitingHistory} candidata(s) a verificar no histórico · ` +
          `${persistedVisualScan.newAbsenceCheckCount || 0} a aguardar prova de ausência no Assistente · ` +
          `${persistedVisualScan.awaitingMapCount || 0} por confirmar no mapa · ` +
          (waitingHistory > 0 && !(Number(reportIndex.completedAt) > 0)
            ? `não estão perdidas: o índice global vai na página ${Number(reportIndex.nextPage || 0) + 1} e lê até ${ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS} páginas por passagem · `
            : '') +
          `quota NEW ${Math.round(Number(allocationPolicy.quotas?.NEW || 0) * 100)}% · ` +
          `${Number(allocation.confirmed?.NEW || 0)}/${Number(allocation.total || 0)} envios confirmados${lastChange}.`
        : 'Fila de primeiro farm ainda sem scan.';
    }
    const rotationSummary = p.querySelector('#twaf-rotation-summary');
    if (rotationSummary) {
      if (!c.adaptiveEnabled) {
        rotationSummary.className = 'twaf-data-state';
        rotationSummary.textContent = queueBreakdown
          ? `Legado: ${queueBreakdown.selectedCandidates || 0} enviáveis · ${queueBreakdown.cooldown || 0} em cooldown · ` +
            `${queueBreakdown.pending || 0} pending · ${queueBreakdown.rowDisabled || 0} sem tropas/botão ativo · ` +
            `${queueBreakdown.unsupported || 0} sem template suportado. ` +
            `Próximo cooldown: ${queueBreakdown.nextDueAt ? formatDateTime(queueBreakdown.nextDueAt) : '—'}. ` +
            'Reports, estados, modelo e estatísticas continuam a atualizar.'
          : 'Rotação legada: cooldowns fixos escolhem a fila. Reports, estados, modelo e estatísticas continuam a atualizar.';
      } else if (!queueBreakdown) {
        rotationSummary.className = 'twaf-data-state';
        rotationSummary.textContent = 'Rotação adaptativa ainda sem passagem nesta página.';
      } else {
        const continuous = queueBreakdown.rotationMode === 'CONTINUOUS_ROTATION';
        const policy = adaptiveSummary.allocationPolicy || {};
        const quotas = policy.quotas || {};
        const pressure = policy.servicePressure || {};
        rotationSummary.className = `twaf-data-state ${continuous ? 'is-warn' : 'is-ok'}`;
        rotationSummary.textContent =
          `${queueBreakdown.dueCandidates || 0} due agora · ${queueBreakdown.earlyCandidates || 0} antecipáveis · ` +
          `${queueBreakdown.minRest || 0} em descanso mínimo · ${queueBreakdown.pending || 0} pending · ` +
          `${queueBreakdown.safety || 0} bloqueadas por segurança · ${queueBreakdown.rowDisabled || 0} sem tropas/botão ativo. ` +
          `${queueBreakdown.awaitingReportHistory || 0} candidata(s) aguardam backfill e ` +
          `${queueBreakdown.awaitingAbsenceProofCoords?.length || 0} aguardam prova de ausência antes de poderem ser chamadas “Novas”. ` +
          `Modo: ${continuous ? 'rotação contínua (melhor alvo seguro antecipado)' : String(queueBreakdown.rotationMode || '—')}. ` +
          `Próximo envio ideal: ${queueBreakdown.nextDueAt ? formatDateTime(queueBreakdown.nextDueAt) : '—'}. ` +
          `Pressão de serviço ${Number(pressure.value || 0).toFixed(1)} (${pressure.active || 0} farms/${pressure.sent24h || 0} envios 24h); ` +
          `quotas E ${Math.round(Number(quotas.EXPLOIT || 0) * 100)}% · X ${Math.round(Number(quotas.EXPLORE || 0) * 100)}% · ` +
          `N ${Math.round(Number(quotas.NEW || 0) * 100)}% · T ${Math.round(Number(quotas.TREND || 0) * 100)}% · C ${Math.round(Number(quotas.COVERAGE || 0) * 100)}%.`;
      }
    }
    const v2Loot = p.querySelector('#twaf-v2-loot');
    const v2Capacity = p.querySelector('#twaf-v2-capacity');
    const v2Unused = p.querySelector('#twaf-v2-unused');
    const v2Commands = p.querySelector('#twaf-v2-commands');
    const v2Strategy = p.querySelector('#twaf-v2-strategy');
    const v2Probe = p.querySelector('#twaf-v2-probe');
    const v2Rpc = p.querySelector('#twaf-v2-rpc');
    const v2Mood = p.querySelector('#twaf-v2-mood');
    const v2Summary = p.querySelector('#twaf-v2-summary');
    const v2DataState = p.querySelector('#twaf-v2-data-state');
    const v2Health = p.querySelector('#twaf-v2-health');
    const v2Attribution = p.querySelector('#twaf-v2-attribution');
    const v2Account = p.querySelector('#twaf-v2-account');
    const v2Accuracy = p.querySelector('#twaf-v2-accuracy');
    const v2Bars = p.querySelector('#twaf-v2-bars');
    const v2Certainty = p.querySelector('#twaf-v2-certainty');
    const v2Windows = p.querySelector('#twaf-v2-windows');
    const v2Hour = p.querySelector('#twaf-v2-hour');
    const v2Distance = p.querySelector('#twaf-v2-distance');
    const v2Ranking = p.querySelector('#twaf-v2-ranking');
    const v2Execution = p.querySelector('#twaf-v2-execution');
    const v2Reports = p.querySelector('#twaf-v2-reports');

    const telemetry = adaptiveSummary.telemetry || {};
    const autoTelemetry = telemetry.auto || {};
    const observedTelemetry = telemetry.observed || {};
    const externalTelemetry = telemetry.external || {};
    const executorTelemetry = telemetry.executor || {};
    const reportTelemetry = telemetry.reports || {};
    const legacyMeasurementText = Number(executorTelemetry.legacy || 0) > 0
      ? ` ${executorTelemetry.legacy} envio(s) anterior(es) à v2.0.10 não entram no denominador da correlação.`
      : '';
    if (v2Loot) v2Loot.textContent = fmtAdaptiveNumber(autoTelemetry.loot);
    if (v2Capacity) v2Capacity.textContent = String(executorTelemetry.sent || 0);
    if (v2Unused) v2Unused.textContent = String(executorTelemetry.matched || 0);
    if (v2Commands) v2Commands.textContent = fmtAdaptivePercent(executorTelemetry.correlationRate);
    if (v2Strategy) v2Strategy.textContent = fmtAdaptiveNumber(observedTelemetry.loot);
    if (v2Probe) v2Probe.textContent = fmtAdaptiveNumber(externalTelemetry.loot);
    if (v2Rpc) v2Rpc.textContent = String(reportTelemetry.total || 0);
    if (v2Mood) v2Mood.textContent = String(telemetry.capacityMismatches || 0);

    if (v2Summary) {
      const strategyLabel = c.adaptiveEnabled
        ? 'Estratégia adaptativa ativa'
        : 'Estratégia legada ativa; telemetria e aprendizagem continuam ligadas';
      v2Summary.textContent = `${strategyLabel}. Hoje nesta aldeia: AutoFarm enviou ${executorTelemetry.sent || 0}; ` +
        `${executorTelemetry.matched || 0} já têm report correlacionado, ${executorTelemetry.pending || 0} aguardam report e ` +
        `${executorTelemetry.expired || 0} expiraram sem correlação. O modelo observou ` +
        `${fmtAdaptiveNumber(observedTelemetry.loot)} recursos em ${reportTelemetry.total || 0} report(s). ` +
        `“Observado” não é o total oficial da conta. Estado do mapa: ${String(adaptiveSummary.mood || 'NORMAL').replace('VERY ', 'MUITO ')}.` +
        legacyMeasurementText;
    }

    if (v2DataState) {
      const ingest = adaptiveSummary.ingestHealth || {};
      const last = ingest.last || {};
      const reportIndex = adaptiveSummary.reportIndex || {};
      const completeness = adaptiveSummary.reportCompleteness || {};
      const completenessText = `Reports — descobertos ${Number(completeness.discovered || 0)}; ` +
        `completos ${Number(completeness.complete || 0)}; indisponíveis ${Number(completeness.unavailable || 0)}; ` +
        `retry ${Number(completeness.retryable || 0)}; parse incerto ${Number(completeness.parseUnknown || 0)}; ` +
        `fila ${Number(completeness.backlog || 0)}; inexplicados ${Number(completeness.unexplainedMissing || 0)}. `;
      const indexText = Number(reportIndex.completedAt || 0) > 0
        ? `Índice histórico concluído; última verificação ${visualSnapshotAgeText(reportIndex.lastScanAt)}. `
        : `Índice histórico global em curso: próxima página ${Number(reportIndex.nextPage || 0) + 1}; ` +
          `lê até ${ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS} páginas por passagem e já reconheceu ` +
          `${Array.isArray(reportIndex.historyCoords) ? reportIndex.historyCoords.length : 0} coordenada(s). Não precisas de abrir Relatórios. `;
      const retryCount = Number(last.readFailed || 0) +
        Number(last.parseUnrecognized || 0) + Number(last.retryWaiting || 0);
      const totalQuantitative = Number(ingest.totals?.quantitative || 0);
      v2DataState.className = 'twaf-data-state';
      const strategyPrefix = c.adaptiveEnabled
        ? ''
        : 'Legado seleciona por cooldown; leitura, estados, modelo e estatísticas continuam ativos. ';
      if (!last.at) {
        v2DataState.textContent = strategyPrefix + completenessText + 'A aguardar a primeira passagem para iniciar o índice automático de Relatórios.';
      } else if (retryCount > 0) {
        v2DataState.classList.add('is-warn');
        v2DataState.textContent = strategyPrefix + indexText + completenessText + `A recuperar ${retryCount} report(s): não foram descartados. O script voltará a tentar automaticamente. ` +
          `${last.backlog || 0} report(s) aguardam sincronização.`;
      } else if (Number(last.backlog || 0) > 0) {
        v2DataState.classList.add('is-warn');
        v2DataState.textContent = strategyPrefix + indexText + completenessText + `Leitura parcial: ${last.backlog} report(s) continuam na fila porque o limite por passagem é ${c.adaptiveReportFetchPerPass}. ` +
          'Serão lidos nas próximas passagens.';
      } else if (totalQuantitative <= 0) {
        v2DataState.classList.add('is-warn');
        v2DataState.textContent = strategyPrefix + indexText + completenessText + `Ainda não foi sincronizado um report quantitativo dentro da janela. ` +
          `Rows do Assistente usadas como ponto de partida: ${last.baselines || 0}.`;
      } else {
        v2DataState.classList.add('is-ok');
        v2DataState.textContent = strategyPrefix + indexText + completenessText + `Dados atualizados ${visualSnapshotAgeText(last.at)}: nenhum report pendente de leitura. ` +
          `Nesta passagem entraram ${last.quantitative || 0} observação(ões) quantitativa(s), ` +
          `${last.qualitativeOnly || 0} qualitativa(s) e ${last.operationalSynced || 0} atualização(ões) de estado.`;
      }
    }

    if (v2Health) {
      const cv = adaptiveSummary.coverage || {};
      const learning = adaptiveSummary.modelLearning || {};
      const ingest = adaptiveSummary.ingestHealth || {};
      const lastIngest = ingest.last || {};
      const retryCount = Number(lastIngest.readFailed || 0) +
        Number(lastIngest.parseUnrecognized || 0) + Number(lastIngest.retryWaiting || 0);
      const network = adaptiveSummary.network || {};
      v2Health.textContent = `Cobertura das farms — ${cv.fresh || 0} ainda recentes; ${cv.due || 0} próximas da hora; ` +
          `${cv.overdue || 0} precisam de nova observação; ${cv.unseenToday || 0} ainda não observadas hoje. ` +
          `Aprendizagem por farm — ${learning.noData || 0} sem dados; ${learning.learning || 0} em aprendizagem; ` +
          `${learning.established || 0} com pelo menos ${learning.target || c.adaptiveLearningTargetObservations} reports. ` +
          `Rendimento observado: ${fmtAdaptiveNumber(adaptiveSummary.resourcesPerCommand)} recursos/report quantitativo e ` +
          `${fmtAdaptiveNumber(adaptiveSummary.resourcesPerUnitHour)} recursos por unidade·hora. ` +
          `Ataques em trânsito: ${adaptiveSummary.allocation?.inFlight || 0} (regresso ≤30m: ${adaptiveSummary.allocation?.return30 || 0}; 30–60m: ${adaptiveSummary.allocation?.return60 || 0}). ` +
          `Última leitura — candidatos ${lastIngest.candidates || 0}; sincronizados ${lastIngest.synchronized || 0}; ` +
          `fila ${lastIngest.backlog || 0}; novas tentativas ${retryCount}; rows iniciais ${lastIngest.baselines || 0}; ` +
          `estados atualizados ${lastIngest.operationalSynced || 0}; ` +
          `duplicadas/antigas ignoradas ${Number(lastIngest.duplicates || 0) + Number(lastIngest.staleRows || 0)}. ` +
          `Rede AutoFarm — GET ${Number(network.gets || 0)}; POST ${Number(network.posts || 0)}; ` +
          `cache ${Number(network.cacheHits || 0)}; pedidos evitados ${Number(network.avoidedRequests || 0)}. ` +
          `Pedidos de outros scripts: desconhecidos.`;
    }

    if (v2Attribution) {
      const observed = telemetry.observed || {};
      const auto = telemetry.auto || {};
      const external = telemetry.external || {};
      const unattributed = telemetry.unattributed || {};
      const reports = telemetry.reports || {};
      const qualityText = Number(observed.anomalies || 0) > 0
        ? ` Qualidade: ${observed.anomalies} leitura(s) X/Y com desvio relevante; eficiência limitada a 100% e detalhes mantidos para diagnóstico.`
        : Number(observed.adjustments || 0) > 0
          ? ` Qualidade: ${observed.adjustments} pequeno(s) desvio(s) X/Y reconciliado(s) automaticamente, sem alterar os valores brutos do report.`
          : ` Diferenças report/reconstrução: ${telemetry.capacityMismatches || 0}; o máximo do report prevalece.`;
      v2Attribution.textContent = `Origem dos dados hoje — reports ${reports.total || 0}: quantitativos ${reports.quantitative || 0}; ` +
          `qualitativos ${reports.qualitative || 0}; AutoFarm ${reports.auto || 0}; externos ${reports.external || 0}; ` +
          `não atribuídos ${reports.unattributed || 0}; sem hora conhecida ${reports.withoutTime || 0}; ` +
          `backlog/retry ${telemetry.retryBacklog || 0}. ` +
          `Economia observada: saque ${fmtAdaptiveNumber(observed.loot)}; capacidade ${fmtAdaptiveNumber(observed.capacity)}; ` +
          `espaço vazio ${fmtAdaptiveNumber(observed.unused)}; excesso ${fmtAdaptiveNumber(observed.excess)}. ` +
          `Eficiência AutoFarm ${fmtAdaptivePercent(auto.efficiency)}; externa ${fmtAdaptivePercent(external.efficiency)}; ` +
          `não atribuída ${fmtAdaptivePercent(unattributed.efficiency)}; total observado ${fmtAdaptivePercent(observed.efficiency)}.` + qualityText;
    }

    if (v2Account) {
      const account = adaptiveSummary.account || {};
      v2Account.textContent = `Resumo da conta neste browser — ${account.villages || 0} aldeia(s) de origem com atividade hoje; ` +
          `${account.sent || 0} envio(s) AutoFarm; ${account.matched || 0} correlacionado(s); ` +
          `${account.pending || 0} pendente(s); ${account.expired || 0} expirado(s); correlação ${fmtAdaptivePercent(account.correlationRate)}. ` +
          `Saque AutoFarm ${fmtAdaptiveNumber(account.auto?.loot)}; saque observado ${fmtAdaptiveNumber(account.observed?.loot)}. ` +
          `${Number(account.legacy || 0) ? `${account.legacy} envio(s) legado(s) não entram no denominador da correlação. ` : ''}` +
          'O valor oficial do Tribal Wars não é inferido nem misturado com estes dados.';
    }

    if (v2Accuracy) {
      const a = adaptiveSummary.predictionAccuracy || {};
      v2Accuracy.textContent = `Precisão das previsões (últimos ${adaptiveSummary.historyDays || c.adaptiveHistoryDays}d) — ${a.samples || 0} previsões guardadas no momento do envio; ` +
          `erro médio do saque ${fmtAdaptiveNumber(a.maeLoot)} (n=${a.lootSamples || 0}); ` +
          `erro médio dos recursos ${fmtAdaptiveNumber(a.maeStock)} (n=${a.stockSamples || 0}); ` +
          `erro de carga cheia ${hasObservedNumber(a.brierFull) ? Number(a.brierFull).toFixed(3) : '—'} (n=${a.brierSamples || 0}; menor é melhor).`;
    }

    if (v2Bars) {
      const ratings = adaptiveSummary.ratings || {};
      const totalRatings = Object.values(ratings).reduce((a, b) => a + Number(b || 0), 0) || 1;
      const rowsV2 = [
        ['F5', ratings.F5 || 0],
        ['F4', ratings.F4 || 0],
        ['F3', ratings.F3 || 0],
        ['F2', ratings.F2 || 0],
        ['F1/F0', ratings.F1F0 || 0]
      ];
      v2Bars.innerHTML = rowsV2.map(([label, count]) => {
        const pct = Math.round(Number(count) / totalRatings * 100);
        return `<div class="twaf-bar-row"><span>${label}</span><div class="twaf-bar-track"><div class="twaf-bar-fill" style="width:${pct}%"></div></div><b>${count}</b></div>`;
      }).join('');
    }

    if (v2Certainty) {
      const bins = adaptiveSummary.certaintyBins || {};
      const rowsC = [
        ['Alta', bins.high || 0],
        ['Média', bins.medium || 0],
        ['Baixa', bins.low || 0]
      ];
      const totalC = rowsC.reduce((sum, [, count]) => sum + Number(count || 0), 0) || 1;
      v2Certainty.innerHTML = rowsC.map(([label, count]) => {
        const pct = Math.round(Number(count) / totalC * 100);
        return `<div class="twaf-bar-row"><span>${label}</span><div class="twaf-bar-track"><div class="twaf-bar-fill" style="width:${pct}%"></div></div><b>${count}</b></div>`;
      }).join('');
    }

    if (v2Windows) {
      const w = adaptiveSummary.windows || {};
      const cell = (label, x) => `${label}: observada ${fmtAdaptivePercent(x?.efficiency)} · exploração AutoFarm ${fmtAdaptivePercent(x?.probeEfficiency)} · cargas cheias ${fmtAdaptivePercent(x?.fullRate)}${Number(x?.anomalies || 0) ? ` · ${x.anomalies} leitura(s) a rever` : ''}`;
      v2Windows.textContent = `Resultados recentes — ${cell('1h', w.h1)} | ${cell('3h', w.h3)} | ${cell('6h', w.h6)} | ${cell('24h', w.h24)}`;
    }

    if (v2Hour) {
      const bins = Array.isArray(adaptiveSummary.hourBins) ? adaptiveSummary.hourBins : [];
      const compact = bins.filter(x => x.count > 0);
      v2Hour.innerHTML = compact.length
        ? compact.map(x => {
            const pct = hasObservedNumber(x.efficiency) ? Math.min(100, Math.round(Number(x.efficiency) * 100)) : 0;
            const quality = `${x.count} report(s) nesta hora durante a janela histórica. ` +
              `${Number(x.adjustments || 0)} pequeno(s) desvio(s) reconciliado(s); ${Number(x.anomalies || 0)} leitura(s) a rever.`;
            return `<div class="twaf-bar-row" data-twaf-tip="${escapeHtmlAttribute(quality)}" tabindex="0"><span>${String(x.hour).padStart(2, '0')}h</span>` +
              `<div class="twaf-bar-track"><div class="twaf-bar-fill" style="width:${Math.min(100, pct)}%"></div></div><b>${pct}%</b></div>`;
          }).join('')
        : '<div class="twaf-muted">Ainda sem reports detalhados suficientes.</div>';
    }

    if (v2Distance) {
      const bins = Array.isArray(adaptiveSummary.distanceBins) ? adaptiveSummary.distanceBins : [];
      const compact = bins.filter(x => x.count > 0);
      v2Distance.innerHTML = compact.length
        ? compact.map(x => {
            const pct = hasObservedNumber(x.efficiency) ? Math.min(100, Math.round(Number(x.efficiency) * 100)) : 0;
            const quality = `${x.count} report(s) nesta distância durante a janela histórica. ` +
              `${Number(x.adjustments || 0)} pequeno(s) desvio(s) reconciliado(s); ${Number(x.anomalies || 0)} leitura(s) a rever.`;
            return `<div class="twaf-bar-row" data-twaf-tip="${escapeHtmlAttribute(quality)}" tabindex="0"><span>${x.label}</span>` +
              `<div class="twaf-bar-track"><div class="twaf-bar-fill" style="width:${Math.min(100, pct)}%"></div></div>` +
              `<b>${pct}%</b></div>`;
          }).join('')
        : '<div class="twaf-muted">Ainda sem reports detalhados suficientes.</div>';
    }

    if (v2Ranking) {
      const top = Array.isArray(adaptiveSummary.top) ? adaptiveSummary.top : [];
      v2Ranking.innerHTML = top.length
        ? top.map(item => {
            const state = adaptiveRegimePresentation(item, c);
            return `<tr><td>${item.coord}</td><td>${Number(item.rating || 0).toFixed(0)}</td>` +
              `<td>${fmtAdaptivePercent(item.belief)}</td><td>${fmtAdaptivePercent(item.certainty)}</td>` +
              `<td tabindex="0" data-twaf-tip="${escapeHtmlAttribute(state.detail)}">${state.arrow} ${state.label}</td><td>${fmtAdaptiveNumber(item.expectedStock)}</td>` +
              `<td>${adaptiveNextDueText(item.nextDueAt)}</td></tr>`;
          }).join('')
        : '<tr><td colspan="7">Ainda sem observações reais suficientes.</td></tr>';
    }

    if (v2Execution) {
      const candidates = RUNTIME.lastAdaptiveExecutionByVillage.get(String(villageId)) || [];
      v2Execution.innerHTML = candidates.length
        ? candidates.slice(0, 10).map((item, index) => {
            const source = item.capacityAuthoritative ? 'capacidade A/B atual' : 'fallback de planeamento';

            const detail = `Execution Score ${Number(item.score || 0).toFixed(1)} · ` +
              `unit-hours ${hasObservedNumber(item.unitHours) ? Number(item.unitHours).toFixed(2) : '—'} · ` +
              `peso de contexto ×${Number(item.contextWeight || 1).toFixed(2)} · ${source}.`;
            return `<tr tabindex="0" data-twaf-tip="${escapeHtmlAttribute(detail)}"><td>${index + 1}</td>` +
              `<td>${item.coord}</td><td>${item.timing || '—'}</td><td>${item.allocationClass || item.reason || '—'}</td>` +
              `<td>${fmtAdaptiveNumber(item.capacity)}</td><td>${fmtAdaptiveNumber(item.expectedLoot)}</td>` +
              `<td>${fmtAdaptivePercent(item.expectedEfficiency)}</td><td>${fmtAdaptivePercent(item.fullProbability)}</td>` +
              `<td>${clockTime(item.expectedArrivalAt)}</td><td>×${Number(item.contextWeight || 1).toFixed(2)}</td></tr>`;
          }).join('')
        : '<tr><td colspan="10">Ainda sem passagem adaptativa com composição A/B validada.</td></tr>';
    }

    if (v2Reports) {
      const reports = Array.isArray(adaptiveSummary.recentReports) ? adaptiveSummary.recentReports : [];
      const stockText = report => {
        if (hasObservedNumber(report.stock)) return fmtAdaptiveNumber(report.stock);
        if (hasObservedNumber(report.stockLow) && hasObservedNumber(report.stockHigh)) {
          return `${fmtAdaptiveNumber(report.stockLow)}–${fmtAdaptiveNumber(report.stockHigh)}`;
        }
        if (hasObservedNumber(report.stockLow)) return `≥${fmtAdaptiveNumber(report.stockLow)}`;
        return '—';
      };
      const attributionText = value => value === 'AUTO_MATCHED'
        ? 'AUTO'
        : (value === 'EXTERNAL' ? 'EXT' : 'N/A');
      v2Reports.innerHTML = reports.length
        ? reports.map(report => {
            const max = hasObservedNumber(report.reportCapacity)
              ? report.reportCapacity
              : report.capacity;
            const quality = report.capacityMismatch
              ? `Máximo do report ${fmtAdaptiveNumber(report.reportCapacity)}; capacidade reconstruída ${fmtAdaptiveNumber(report.reconstructedCapacity)}. O valor do jogo foi usado.`
              : `Capacidade obtida por ${report.capacitySource || 'fonte desconhecida'}.`;
            return `<tr data-twaf-tip="${escapeHtmlAttribute(quality)}" tabindex="0"><td>${clockTime(report.at)}</td><td>${report.coord || '—'}</td>` +
              `<td>${attributionText(report.attribution)}</td><td>${fmtAdaptiveNumber(report.loot)}</td>` +
              `<td>${fmtAdaptiveNumber(max)}</td><td>${fmtAdaptivePercent(report.efficiency)}</td>` +
              `<td>${stockText(report)}</td><td>${report.capacitySource || 'UNKNOWN'}</td></tr>`;
          }).join('')
        : '<tr><td colspan="8">Ainda sem reports sincronizados.</td></tr>';
    }

    const statsEl = p.querySelector('#twaf59-stats');
    if (statsEl) {
      statsEl.textContent =
        `Fila — alvos ${st.total}; prontas ${st.ready}; pendentes ${st.pending}; ` +
        `a enviar ${st.sending}; cooldown ${st.cooling}; próximo cooldown ${st.next}.`;
    }

    const scanEl = p.querySelector('#twaf59-scan');
    if (scanEl) {
      const scanForThisVillage = runtimeScanForDisplay;
      const mapCount = persistedVisualIsNewer
        ? (persistedVisualScan?.mapCount ?? '—')
        : (targetCoords(villageId).length || persistedVisualScan?.mapCount || '—');
      const found = scanForThisVillage?.found ?? persistedVisualScan?.assistantRows ?? '—';
      const pages = scanForThisVillage?.pagesScanned ?? persistedVisualScan?.pagesScanned ?? '—';
      const scanMode = scanForThisVillage
        ? (scanForThisVillage.fullScan ? 'full' : 'cache')
        : (persistedVisualScan?.scanMode || '—');
      const truncated = (scanForThisVillage?.truncated || (!scanForThisVillage && persistedVisualScan?.truncated))
        ? ', limite de páginas atingido'
        : '';
      const eligible = persistedVisualScan?.eligibleCount
        ?? RUNTIME.lastEligibleByVillage.get(String(villageId))
        ?? '—';
      const bootstrap = persistedVisualScan?.newReadyCount ?? runtimeBootstrap ?? '—';
      const bootstrapPending = persistedVisualScan?.newPendingCount ?? '—';
      const coverage = scanForThisVillage
        ? (scanForThisVillage.assistantCoversRadius ? 'ausência comprovável' : 'ausência não comprovável')
        : (persistedVisualScan?.coverage || '—');
      const rediscovery = scanForThisVillage?.needsRediscoveryCount ?? persistedVisualScan?.rediscoveryCount ?? '—';
      const awaitingMap = persistedVisualScan?.awaitingMapCount
        ?? RUNTIME.mapBootstrapAwaitingByVillage.get(String(villageId))?.size
        ?? '—';
      const newCandidates = persistedVisualScan?.newCandidateCount ?? '—';
      const historyCheck = persistedVisualScan?.newHistoryCheckCount ?? '—';
      const absenceCheck = persistedVisualScan?.newAbsenceCheckCount ?? '—';
      const visualAge = persistedVisualScan
        ? `; scan ${visualSnapshotAgeText(persistedVisualScan.scanAt)}; fila atualizada ${visualSnapshotAgeText(persistedVisualScan.updatedAt)}`
        : '';

      scanEl.textContent =
        `Assistente — ${found}/${mapCount} alvos vistos; ${pages} pág.; modo ${scanMode}${truncated}; ` +
        `cobertura ${coverage}; a redescobrir ${rediscovery}; mapa por confirmar ${awaitingMap}; ` +
        `candidatas a novas ${newCandidates} (histórico ${historyCheck}; ausência ${absenceCheck}); ` +
        `elegíveis ${eligible}; novas prontas ${bootstrap}; primeiros envios pendentes ${bootstrapPending}${visualAge}.`;
    }

    const sendDiag = p.querySelector('#twaf59-senddiag');
    if (sendDiag) {
      const lastError = RUNTIME.lastServerErrorByVillage.get(String(villageId));
      const troopSnapshot = RUNTIME.lastTroopSnapshotByVillage.get(String(villageId));
      const sched = schedulerState(villageId);
      const coordination = coordinationState(villageId);
      const stochastic = coordination.stochasticPlan;
      const parts = [
        `Estado: ${coordination.state}`,
        `Wake: ${sched.wakeKind || coordination.wakeKind}`,
        `Intervalo: ${c.retrySeconds}s`,
        `Intervalo entre envios: ${(c.attemptGapMs / 1000).toFixed(1)}s`,
        `Última passagem: ${clockTime(sched.lastPassFinishedAt)}`,
        `Próxima: ${clockTime(sched.nextWakeAt)}`,
        stochastic?.cycleId ? `Ciclo: ${stochastic.cycleId}` : null,
        stochastic?.temporalProfile ? `Perfil: ${stochastic.targetProfile}/${stochastic.temporalProfile}` : null,
        stochastic?.cheapWindowEnd ? `Proofs válidas até: ${clockTime(stochastic.cheapWindowEnd)}` : null,
        capacity ? `Validação: ${capacity.confidence || (capacity.exact ? 'exata' : 'conservadora')}` : null,
        troopSnapshot?.source ? `Última fonte de tropas: ${troopSnapshot.source}` : null,
        lastError ? `Última rejeição: ${lastError.coord} — ${lastError.message}` : 'Sem rejeição registada nesta sessão'
      ].filter(Boolean);
      sendDiag.textContent = parts.join(' · ');
    }

    const consoleEl = p.querySelector('#twaf59-console');
    if (consoleEl) {
      const content = diagnosticText(villageId);
      const nearBottom = consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 20;
      consoleEl.textContent = content || 'Sem logs nesta sessão.';
      if (nearBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  // ---------------------------------------------------------------------------
  // BOOT
  // ---------------------------------------------------------------------------

  function boot() {
    createPanel();

    const bootVillageId = currentVillageId();
    if (bootVillageId) {
      beginNetworkOccurrence(bootVillageId, 'BOOT', 'restauro local');
      endNetworkOccurrence(bootVillageId);
    }

    AntiBotGuard.watch(reason => {
      coordinatedHardStop(reason, RUNTIME.activeVillageId || currentVillageId());
    });

    if (accountHardStopActive()) {
      applyAccountHardStopLocally();
      RUNTIME.lastStatus = 'HARD_STOP da conta restaurado localmente · 0 GET · 0 POST';
      renderPanel();
      return;
    }
    if (AntiBotGuard.isActive()) return;

    const villageId = currentVillageId();
    if (villageId && !cfg(villageId).enabled) {
      RUNTIME.lastStatus = 'Pronto';
      updateSchedulerState(villageId, { nextRunAt: 0 });
    }

    if (villageId && cfg(villageId).enabled) {
      const sched = schedulerState(villageId);
      const coordination = coordinationState(villageId);
      const now = Date.now();
      const restoredCapacityProof = capacityProofFromSource(coordination.sources.CAPACITY);

      if (Number(sched.nextRunAt) > now) {
        RUNTIME.lastStatus = 'AutoFarm ativo. Agendamento anterior retomado.';
        addDiagnostic(
          'BOOT',
          'Página carregada; agendamento persistente retomado.',
          `faltam ${Math.ceil((Number(sched.nextRunAt) - now) / 1000)} s`,
          villageId
        );
        armLocalTimerAt(Number(sched.nextRunAt), villageId, 'retomado após navegação/reload');
      } else if (
        coordination.state === 'WAITING_EXECUTION' &&
        coordination.executionPlan && coordination.stochasticPlan &&
        Number(coordination.executionDueAt) > 0
      ) {
        const restoredAt = Math.max(now + 250, Number(coordination.executionDueAt));
        RUNTIME.lastStatus = 'AutoFarm ativo. Plano estocástico restaurado localmente.';
        addDiagnostic(
          'BOOT',
          `Ciclo ${coordination.stochasticPlan.cycleId} restaurado sem novo sorteio.`,
          `mesmo dueAt · 0 random draws · 0 GET · execução ${clockTime(restoredAt)}`,
          villageId
        );
        scheduleAt(restoredAt, villageId, 'restauro do ciclo persistido', 'EXECUTION');
      } else if (
        restoredCapacityProof &&
        restoredCapacityProof.value === 0 &&
        restoredCapacityProof.freshUntil > now
      ) {
        RUNTIME.lastStatus = 'AutoFarm ativo. Sem tropas segundo proof persistida.';
        addDiagnostic(
          'BOOT',
          'CapacityProof zero restaurada sem rede.',
          `fonte ${restoredCapacityProof.source} · reavaliar ${clockTime(restoredCapacityProof.freshUntil)} · 0 GET · 0 POST`,
          villageId
        );
        scheduleAt(restoredCapacityProof.freshUntil, villageId, 'CAPACITY_ZERO_EXPIRES', 'CAPACITY');
      } else if (foreignLease(villageId)) {
        RUNTIME.lastStatus = 'AutoFarm ativo. Outra aba está a executar esta aldeia.';
        addDiagnostic(
          'BOOT',
          'Página carregada durante passagem noutra aba; modo passivo.',
          'não foi criado um nextRunAt concorrente',
          villageId
        );
        armLeaseRecovery(villageId, 'boot durante passagem noutra aba');
      } else {
        RUNTIME.lastStatus = 'AutoFarm ativo. A preparar passagem inicial.';
        const recoveryAt = Number(sched.lastPassFinishedAt) > 0
          ? Math.max(
              now + 2500,
              nextAutomaticPassAt(
                Number(sched.lastPassFinishedAt),
                cfg(villageId).adaptiveEnabled ? adaptiveStore(villageId) : null,
                cfg(villageId)
              )
            )
          : now + 2500;
        addDiagnostic(
          'BOOT',
          'Página carregada sem agendamento futuro; relógio reconstruído.',
          `próxima ${clockTime(recoveryAt)}`,
          villageId
        );
        scheduleAt(recoveryAt, villageId, 'arranque/reload sem agendamento pendente');
      }
    }
  }

  // The native TWPF controller owns lifecycle, scheduling, persistence,
  // coordination, hard-stop and UI. Legacy runtime functions stay private and
  // inert; only the reviewed semantic/parsing surface is exported.
  root.PremiumFeaturesAutoFarmAdaptiveCore = Object.freeze({
    VERSION, DEFAULTS, PLAN_PROOF_MARGIN_MS,
    MAP_BOOTSTRAP_CONFIRMATIONS, MAP_BOOTSTRAP_CONFIRM_MIN_MS,
    normalizeCfg, finiteObservedNumber, hasObservedNumber, adaptiveCapacityExcessQuality,
    parseCoord, parseReportId, parseDot, parseHaul, parseServerClock,
    parseAssistantAttackText, parseAssistantAttackInfo, parseFarmButton, parseFarmRows,
    maxFarmPages, assistantPageCoverageRadius, normalizedCoordList,
    legacyOperationalProofCoords, nextMapPresenceState, filterMapConfirmedBootstraps,
    normalizeAdaptiveReportIndex, prepareAdaptiveReportIndexScope, reportCompletenessSummary,
    reportIndexWorkDue, parseReportIndexEntries, reportIndexPageMeta, reportIndexPageReachedEnd,
    parseReportComposition, parseReportLosses, parseReportLoot, parseReportRemainingResources,
    parseReportDetailTimestamp, reportDetailFailureDisposition,
    normalizeComposition, normalizeUnitCounts, capacityForComposition,
    parseInlineCurrentUnits, parseInlineTemplateComposition,
    parseUnitsEntryAll, parseDomTemplateComposition, sameComposition,
    transportCapacityForComposition, survivingCompositionAfterLosses,
    transportLossMetrics, observationLossSeverity,
    normalizeCapacityProof, capacityProofContextMatches, capacityProofUsable,
    capacityProofStrength, shouldReplaceCapacityProof, normalizeExecutionRound,
    consumeConfirmedDispatch, reconcileExecutionRoundOutcome, successorDispatchBudget,
    serverNoUnitsCapacityProof, normalizeExecutionPlan, normalizeCoordinationState,
    coordinationSourceFresh, coordinationSourceFreshForPlanning, mapAuthorizationFreshForPlanning,
    coordinationProofStatus, coordinationProofEnd, localDependencyPlanner,
    createRandomSource, stochasticCoalesceBounds, temporalProfileWeights,
    temporalProfileRange, generateStochasticPlan,
    defaultAdaptiveFarm, normalizeAdaptiveFarm, normalizeAdaptiveEvent,
    normalizeAdaptiveDispatch, normalizeAdaptiveReportLedgerEntry,
    normalizeAdaptiveAllocationBudget, adaptiveAllocationClass, adaptiveAllocationQuotas,
    adaptiveAllocationSequence, advanceAdaptiveAllocationBudget, adaptivePlanningCapacity,
    buildAdaptiveTemplateContext, adaptiveContextStats, probabilityStockAtLeast,
    expectedLootFromDepth, predictAdaptiveFarm, adaptiveCertainty, calculateAdaptiveNextDue,
    adaptiveHardSafetyBlocked, adaptiveFarmDue, adaptiveRotationEligibility,
    adaptiveSuggestedWakeAt, nextAdaptiveDueAt, adaptiveDecisionForTarget,
    adaptiveDispatchGate, rankAdaptiveEligible, recalcAdaptiveFarm, adaptiveRegimePresentation,
    updateAdaptiveObservation, updateDepthFromObservation, stockProxyFromObservation,
    adaptiveReportIdRelation, adaptiveReportQueueDecision, matchingAdaptivePending,
    observationFromReport, observationFromAssistantSummary, adaptiveReportIngestDecision,
    adaptivePendingCleanupAllowed, operationalResultFromReportObservation,
    classifyFarmResponse, isNoUnitsError, looksLikeProtection,
    isPositiveFarmResponse, sendFailureIsUncertain, sameOriginUrl,
    buildFarmSendEndpoint, extractServerMessage, adaptiveDispatchId, adaptiveReportKey,
    ADAPTIVE_SCHEMA_VERSION, ADAPTIVE_CAPACITY_GRID, ADAPTIVE_REPORT_INDEX_PAGES_PER_PASS,
    ADAPTIVE_ALLOCATION_CLASSES, REPORT_DISCOVERY_STATES, REPORT_DETAIL_STATES
  });
})(window);
