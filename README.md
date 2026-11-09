# Agenda Clara

Painel local para a Jéssica controlar agendas médicas previstas e abertas, disponibilidade, confirmações, alertas e produtividade. Dados de pacientes aparecem nas consultas ao vivo, diagnósticos e colaboradores; não ficam salvos no banco local.

## Instalar em outro computador Windows

Baixe o arquivo `AgendaClara-Setup-<versão>.exe` da [página de versões](https://github.com/marcus123-cpu/Gestao-amor-saude/releases/latest), execute-o e abra **Agenda Clara** pelo menu Iniciar. O instalador inclui Python, Node, o componente Playwright e o Chromium; não precisa instalar essas ferramentas na outra máquina. Faça login no Amei pela aba **Conexões** na primeira execução.

O banco, a sessão do navegador e outros dados locais ficam em `%LOCALAPPDATA%\AgendaClara\data`, separados da pasta do aplicativo. Atualizar ou reinstalar o programa preserva essa pasta. Em cada abertura, o atalho verifica a versão mais recente no GitHub, baixa o instalador e confere seu SHA-256 antes de atualizar. Sem internet, abre a versão já instalada. Para usar os dados deste computador em outro, faça uma cópia do banco `agendas.sqlite3` com o painel fechado; o login do Amei deve ser feito novamente na outra máquina.

Para publicar uma atualização, envie as alterações para a branch `main` do repositório. A ação `Publicar instalador` testa, monta e publica um novo Release automaticamente. O código versionado não inclui `data/`, `node_modules/`, sessões de navegador nem pacotes gerados. Para montar localmente: `./installer/build-release.ps1` (requer Python, Node, Inno Setup 6 e os arquivos de navegador do Playwright). O instalador e o arquivo `.sha256` saem em `release/`.

## Iniciar

Clique duas vezes em `iniciar.bat` ou, no PowerShell, nesta pasta:

```powershell
python app.py
```

Abra **http://127.0.0.1:8777**. Os registros ficam em `data/agendas.sqlite3`. Faça backup desse arquivo para preservar os dados.

## Uso

1. Cadastre a agenda como **Prevista** ao receber data, profissional, especialidade e turnos. A capacidade estimada usa a duração de cada turno dividida pelo intervalo; confira com a médica antes de abrir.
2. Quando ela abrir no Amei, mude a situação para **Aberta**. Informe manualmente total, preenchidos e confirmados para ter o painel imediatamente.
3. Na aba **Conexões**, clique em **Abrir Amei para login**. Faça login na janela oficial, volte ao painel e use **Verificar conexão**. Escolha o mês e clique em **Buscar agendas**. O painel importa as agendas abertas, mostra a ocupação e permite **Ver horários** livres por turno. Outubro e novembro de 2026 foram consultados inicialmente.
4. Se cadastrou uma agenda manualmente e souber os IDs do profissional e da especialidade no Amei, use **Atualizar Amei** na lista. Essa ação é somente leitura e atualiza total e ocupados. Confirmados continuam como contagem manual nesta versão. A leitura mostra também um número de horários pendentes, mas esse número não substitui a confirmação manual.
5. Em **Todas as agendas**, o padrão mostra hoje e as próximas datas, com as agendas mais urgentes primeiro. Use **Já passou** para o histórico; canceladas ficam no filtro próprio. No alto à direita, ao lado da lista, há um **mini calendário**: as setas trocam o mês, cada dia mostra quantas agendas tem e fica verde, amarelo ou vermelho conforme a prioridade, com legenda das cores embaixo. Clicar num dia deixa a lista só com as agendas dele e abre **Cadastrar previsão para este dia**, que já traz a data preenchida. Esse cadastro não depende de conexão com o Amei. Clique de novo no dia, ou em **Ver o mês todo**, para soltar o filtro. Em telas estreitas o calendário sobe para cima da lista.
6. Clique no cartão **Agendas de hoje** ou **Amanhã** da Visão geral, numa agenda de hoje ou numa linha de **Todas as agendas** para ver horários livres, pacientes na agenda, encaixes marcados e bloqueios. A seta à esquerda do nome volta para a lista do dia. Esses detalhes são consultados ao abrir e os nomes dos pacientes não são salvos no banco local.
7. O botão **Modo escuro** fica na barra lateral e guarda a escolha neste navegador. Logo acima dele, **Fechar menu** encolhe a barra para uma faixa só de ícones e devolve a largura para a lista; a navegação continua a um clique e o nome de cada item aparece ao passar o mouse. O mesmo botão reabre, e a escolha também fica guardada. O tema claro usa superfícies neutras e laranja nos gráficos.
8. Na **Visão geral**, o gráfico do mês mostra a evolução dos atendimentos e a previsão para os próximos dias. Passe o mouse sobre um dia para ver atendidos, previstos e confirmados. O botão **Atualizar** relê as agendas e os status no Amei. Enquanto o painel estiver aberto e visível, ele consulta automaticamente as agendas do mês atual quando a leitura tiver mais de 10 minutos e as do mês seguinte quando tiver mais de 30 minutos. Ao terminar, a lista, as vagas e os alertas são atualizados. A sessão do Amei precisa estar conectada; consultas incompletas preservam a última leitura completa.
9. Em **Todas as agendas**, o estado é **Alta prioridade** quando há ao menos 10 vagas e 45% dos horários livres (ou ao menos 8 vagas e 65% livres), **Atenção** quando há ao menos 2 vagas e 25% livres. Esses estados aparecem em vermelho e amarelo. A Visão geral antecipa alta prioridade em até 14 dias e atenção em até 7 dias, sugerindo avisar o call center. Em **Atenção**, cada alerta é um cartão para ler de relance: data em dia/mês à esquerda, nome do profissional, a especialidade num selo de cor própria (a mesma área sempre com o mesmo tom), quantas vagas livres de quantas, a data por extenso em dia/mês/ano e a ação sugerida. A cor do nível fica na barra lateral e no número de vagas, não no texto todo. Os alertas vêm do mais grave para o menos grave e, dentro do mesmo nível, do que acontece primeiro.
10. **Todas as agendas** mostra 10 registros por página, com botões de navegação. Em **Atenção**, abra um cartão para consultar a lista de espera e pessoas atendidas nos dois meses anteriores sem retorno identificado ao mesmo profissional. Os diagnósticos das agendas vermelhas começam a ser preparados ao abrir o painel.
11. **Colaboradores** mostra David (Gabriela Paulino no Amei), Marcos e Thaís, com meta individual de 480 comparecimentos e busca de pacientes/CPF. A aba **Ranking** é um pódio: terceiro à esquerda e menor, primeiro no meio e maior, segundo à direita; a posição sai do número de comparecimentos no mês. Cada cartão traz **marcadas para este mês** (agendamentos criados pela pessoa cuja consulta cai no mês) e **marcadas durante este mês** (destes, os criados dentro do mês). A legenda abaixo dos cartões explica os três números na própria tela. Dentro da ficha de cada pessoa, **todo bloco é um filtro**: clicar em *faltas* deixa na lista só quem faltou, clicar em *confirmados* só os confirmados, e assim por diante, com nome, CPF e data de cada paciente. **Limpar filtro** volta para a lista inteira. A busca por paciente aceita o **CPF com ou sem pontuação** — `405.102.618-33` e `40510261833` acham a mesma pessoa, assim como um pedaço do número. Na tela, CPF e telefone aparecem pontuados; no Amei eles são guardados só com números. A autoria é conferida pelo campo `createdBy` de cada consulta, nunca pelo último editor. “Consultas do mês” usa a data do atendimento; “≥ criadas no mês” é um mínimo comprovado, pois a API não descobre todas as consultas criadas neste mês para atendimento em outros meses.

## Controle das quatro salas

A Visão geral mostra quantos médicos atendem hoje e quantas das quatro salas estão ocupadas e disponíveis de manhã e à tarde. Em **Todas as agendas**, selecionar um dia no calendário mostra a disponibilidade dos dois períodos acima da lista. A conta reúne agendas abertas no Amei e previsões cadastradas; o mesmo profissional conta uma vez por período. Um turno que cruza o meio-dia ocupa os dois períodos. **Larissa Brandão Romanholi** usa uma sala própria e fica fora do limite das quatro salas médicas.

Ao criar ou editar uma agenda ativa, o formulário mostra a ocupação dos períodos escolhidos. Se a inclusão exigir um quinto médico no mesmo período, o salvamento é recusado e informa o dia e o turno. Uma agenda de manhã não impede outra à tarde. Agendas canceladas, adiadas e realizadas não reservam sala. Se o Amei já trouxer mais de quatro profissionais em um período, o painel mostra a ocupação real e impede que uma nova agenda aumente o excesso.

Essa contagem mora num lugar só (`workflow.room_usage`). A Visão geral, o calendário, o bloqueio ao salvar e os avisos do sino usam a mesma função, para que nenhuma tela discorde da outra. Quem tem sala própria é reconhecido pelo id do profissional e, na falta dele, pelo nome contido — o cadastro às vezes vem como *Larissa...*, às vezes como *Sra. Larissa...*.

## O que resolver hoje, o sino e as rotinas

A Visão geral abre com **O que resolver hoje**: a fila do que vence primeiro, já com responsável e botões para marcar *avisei o call center* ou *resolvido*. Ao lado, **Amanhã na clínica** mostra quem atende, quantas salas serão usadas, quantos pacientes confirmaram e quantos faltam confirmar.

O **sino**, no alto à direita, abre a mesma fila em quatro abas: pendentes, em andamento, concluídas e rotinas fixas. Uma ação marcada como em andamento **volta a aparecer como pendente no dia seguinte** se o problema continuar — foi avisado, mas a agenda ainda está vazia.

Avisos de datas anteriores não aparecem nas filas nem no histórico do sino. Os avisos do próprio dia saem às 18h, no horário de São Paulo; as agendas continuam disponíveis no histórico. O painel atualiza as listas ao passar desse horário.

No topo do sino fica o **estado do sistema**: se o Amei está conectado, há quanto tempo as agendas deste mês foram lidas e quantas vezes a sessão precisou ser religada. Serve para saber se o que está na tela é recente.

As tarefas que o painel monta:

- **Previsão não aberta** — a partir de cinco dias antes da data prevista, o painel lembra de conferir e abrir a agenda no Amei. O aviso aparece na Visão geral, em Atenção, no sino e no cartão de Previsões enquanto a agenda continuar prevista. Ele desaparece quando a agenda for marcada como aberta ou a leitura do Amei reconhecer a abertura.
- **Agenda com vagas** — horários livres nos próximos 14 dias, para avisar o call center.
- **Confirmações de amanhã** — quantos agendamentos de amanhã ainda não foram confirmados.
- **Mais médicos que salas** — quando uma abertura feita fora do painel estoura as quatro salas.
- **Rotina fixa sem agenda** — dia habitual do profissional sem agenda aberta.
- **Retorno após 20 dias** — profissional sem rotina fixa cuja última agenda passou de 20 dias e que não tem próxima data. Para ginecologia, o aviso lembra de conferir se os exames já ficaram prontos.

### Rotinas fixas

Os dias fixos saíram do histórico real das agendas (Mayara às quartas, Camila às quartas e sextas, Osmar às quintas, e assim por diante) e são **editáveis** na aba *Rotinas fixas*: dá para mudar os dias, desligar os avisos durante férias ou adicionar outro profissional.

Um cuidado importante: o aviso de rotina fixa **só sai quando a leitura do mês no Amei tem menos de 24 horas**. Com leitura velha, o painel pede para atualizar em vez de dizer que a agenda não foi aberta — ela pode já estar aberta e o painel é que estaria desatualizado. Cobrar com base em dado velho faria a Jéssica perder a confiança no sino.

## Comparação de desempenho

Em **Colaboradores → Desempenho**, escolha dois meses. O painel compara atendimentos, faltas, cancelamentos/desmarcações, agendas abertas, horários ofertados e os resultados de David, Marcos Paulo e Thaís. Também mostra os médicos cujas agendas tiveram mais faltas ou cancelamentos. Uma consulta cancelada na agenda do médico não comprova que foi ele quem cancelou.

A comparação usa um gráfico diário com os dois meses e mostra o número exato numa dica ao lado do cursor ao passar o mouse, tocar ou focar um dia. A mesma dica acompanha todas as barras de desempenho: atendimentos, faltas, cancelamentos, oferta de agendas e equipe. O gráfico da Visão geral também mostra sua dica junto ao cursor; o círculo de confirmações informa a porcentagem e a contagem. Com até três dias disponíveis, a comparação mostra barras lado a lado em vez de uma linha pouco informativa. Os números ficam escritos junto das cores. Nos primeiros três dias do mês, os cartões mostram apenas “acima”, “abaixo” ou “igual”, sem concluir que o desempenho melhorou ou piorou.

As leituras são feitas no Amei e guardadas por mês; a primeira comparação de um mês antigo pode levar alguns minutos. Se um dos meses ainda estiver em andamento, os totais dos dois são comparados até o mesmo dia do mês. A tela mostra quantos registros foram verificados e quantos não puderam ser conferidos. As diferenças ajudam a investigar a meta, mas não identificam sozinhas a causa da queda.

## Cartão de Todos em qualquer agenda

Ao abrir **qualquer** agenda, o painel confere paciente por paciente se a matrícula está ativa no Cartão de Todos. É a mesma pergunta que o Amei faz para pintar o campo *Matrícula* de verde ou vermelho na tela de agendamento (`/api/v1/cartao-todos/matricula-ativa`), feita com o CPF de cada paciente.

Cada paciente cai num de quatro estados:

- **Cartão ativo** — verde no Amei, nada a fazer.
- **Em atraso** — o Cartão de Todos responde *"Situação financeira inativa ou inadimplente"*. É o paciente devendo.
- **Sem cartão** — *"Matrícula não existe no sistema Cartão de Todos"*.
- **Não conferido** — o Cartão de Todos não respondeu ou respondeu algo que o painel não reconhece.

Em **todas as agendas**, só os pacientes com alguma alteração aparecem na área de atenção no topo. Os demais ficam na lista normal abaixo. A área reúne os avisos de cartão e, quando se aplicam, os de oftalmo e psiquiatria. Cada paciente aparece uma única vez no topo, mesmo que tenha mais de um motivo para conferir. O aviso mostra nome, CPF, telefone, motivo e **sob qual parceiro o agendamento foi lançado** (*Cartão de TODOS* ou *Particular*). Paciente sem cartão ativo lançado como Cartão de Todos pode estar pagando preço de convênio sem ter direito; lançado como Particular, vale confirmar se é mesmo o caso.

Uma falha de comunicação **nunca** vira "sem cartão": ela aparece como *não conferido*, para não acusar um paciente por causa de um erro de rede. Quem não pôde ser conferido aparece nomeado num aviso, nunca sumindo em silêncio.

## Conferência de procedimentos no oftalmo

Ao abrir uma agenda de **Oftalmologia**, o painel relê cada agendamento e confere **Consulta**, **Biomicroscopia de fundo** e **Tonometria binocular**. Se faltar algum, houver procedimento extra ou repetido, ou o `valorTotal`/soma dos procedimentos diferir de **R$ 102,00**, o paciente aparece no topo com o motivo e o valor que está no Amei. Problema no Cartão de Todos entra no **mesmo aviso** do paciente, sem duplicar o cartão. Pacientes em ordem ficam só na lista normal abaixo, e o bloquinho de status do aviso também mostra quem agendou ao passar o mouse. Quem não pôde ser conferido fica nomeado para verificação manual.

A checagem usa o mesmo detalhe de agendamento que já alimenta o Cartão de Todos. Para oftalmo ela é refeita a **cada abertura** da agenda; o painel apenas avisa a Jéssica e não altera procedimentos nem preços no Amei.

## Quem agendou cada paciente

Na lista **Pacientes na agenda**, o status de cada um é um bloquinho. Passando o mouse, aparece **quem agendou e quando**: *"Agendado por Marcus Paulo Coleta Caetano · 29/10/2026 às 10:55"*. Vale para qualquer agenda.

O nome sai da **primeira linha do histórico do agendamento**, que o Amei grava com o nome por extenso. Não use `/api/v1/profissionais/{createdBy}` para isso: aquele endereço é de médicos e usa outra numeração — o id 35548, que ali devolve um médico, é o Marcos aqui. Resolver por ele mostraria o nome errado com toda a confiança.

Agendamento criado pelo bot ou pelo portal não tem autor no histórico; esse aparece como **Sistema**. Na amostra que conferi, cerca de metade dos agendamentos é assim.

A data e a hora vêm do campo `createAt`. Ele chega com sufixo `Z`, mas o relógio já está no horário de Brasília — conferido em seis registros, comparando com o histórico, que esse sim é UTC e fica exatamente 3 horas à frente. Por isso o painel mostra o horário **como veio**, sem converter: converter atrasaria tudo em três horas.

Essa informação vem na mesma leitura do Cartão de Todos, que já abre o registro de cada agendamento. Enquanto ela não chega, o bloquinho diz que está conferindo.

## Conferência de cobrança na psiquiatria

Na psiquiatria o procedimento muda com o histórico do paciente: a **primeira vez** é *Consulta Áreas de Atuação (Primeira consulta)*, e **do retorno em diante** é *Sessão de psiquiatria individual*. Quem agenda às vezes deixa a primeira consulta quando já era sessão, e a clínica cobra menos do que devia.

Ao abrir uma agenda de psiquiatria, o painel confere isso sozinho. Para cada paciente marcado no dia ele lê o histórico **desde 1º de janeiro** e conta os atendimentos concluídos (status *Atendido* e *Atendido pós-consulta*) na mesma especialidade, na mesma clínica. Depois compara com o procedimento lançado no agendamento:

- **Primeira consulta com atendimento anterior** → erro de cobrança, em vermelho, dizendo quantas vezes o paciente já passou e quando foi a última.
- **Sessão sem nenhum atendimento anterior no ano** → marcado para conferir, porque pode estar cobrando a mais de quem é de primeira viagem.
- **Agendamento sem procedimento lançado** → marcado para conferir.

Os pacientes com alteração na cobrança aparecem na área de atenção junto dos avisos de cartão; os demais permanecem na lista normal. A conferência roda em segundo plano e leva alguns minutos por agenda; o resultado fica guardado por 15 minutos.

Se algum paciente não puder ser conferido, ele aparece **nomeado** num aviso em amarelo, para ser olhado no Amei. Isso não é detalhe: numa agenda de 13 pacientes, um tempo esgotado escondia um paciente que estava com a cobrança errada. O painel nunca omite em silêncio quem ele não conseguiu verificar.

Duas limitações honestas: a conta começa em 1º de janeiro do ano da consulta, então atendimento de anos anteriores não entra; e a comparação é por **especialidade**, não por profissional — passar com outro psiquiatra da clínica conta como retorno.

## Sessão do Amei

A sessão do Amei cai sozinha depois de alguns minutos de aba parada. A causa foi conferida ao vivo: o Amei guarda um *refresh token* e só renova o acesso quando a **página carrega**. Com a aba ociosa — ainda mais congelada pelo Chrome em segundo plano — nada dispara essa renovação, o token de acesso vence e as chamadas passam a voltar **401**. Um F5 refaz a sessão sozinho; medido na prática: **401 antes da recarga, 200 depois**.

Por isso o painel sonda a janela a cada 30 segundos (mude com `AMEI_PULSO_S`). Quando a sondagem volta travada ou com 401, ele **recarrega a página e sonda de novo** — e a sessão volta sem ninguém digitar nada. Duas travas evitam que isso atrapalhe:

- Se a aba estiver numa página de login, ele **não** recarrega, para não derrubar quem está entrando.
- Depois de 3 recargas seguidas sem sucesso ele para de insistir: aí o refresh token morreu de verdade e só a pessoa resolve, entrando de novo na janela.

Se uma varredura de fundo estiver com o Amei quando você abrir uma agenda, o painel espera a vez e tenta de novo por alguns instantes, em vez de mostrar erro. Recarregar a página do Amei não perde nada: agendas, indicadores, diagnósticos e colaboradores ficam no painel, não naquela aba. A varredura de colaboradores fica gravada em `data/agendas.sqlite3`, então reiniciar o painel traz os números de volta na hora em vez de varrer tudo outra vez. Quando uma leitura falha, a tela continua mostrando a última leitura que deu certo, avisando que é ela.

A aba **Conexões** mostra o pulso: estado atual, horário da última resposta, **maior silêncio** já observado, quantos F5 automáticos houve (e quantos religaram a sessão) e quantas sondagens aconteceram.

## Conexão Amei

A integração usa `amei_api.js` e `agenda_overview_amei.js` do bot existente, mas mantém seu próprio Playwright CLI e um perfil de Chrome em `data/amei-profile`. A sessão humana segue o princípio descrito em `COMO_FUNCIONA.md`: o código não lê senha, token ou cookie. Defina `AMEI_BOT_DIR` se a pasta do bot mudou. `npm install` instala o componente de navegador deste painel em outra máquina. O painel relê os indicadores do mês e as agendas do mês seguinte periodicamente enquanto a página estiver aberta e visível. Se o login expirar, entre novamente na janela oficial do Amei.

Nenhuma ação escreve no Amei. A lista mostra **vagas livres** e **encaixes marcados** em vez de chamar todos os horários não livres de “agenda preenchida”. Um horário bloqueado não é um paciente marcado. Os detalhes de cada agenda são lidos novamente ao clicar e podem mudar depois da leitura.

Os indicadores mensais contam **agendamentos**, e mostram também quantas pessoas diferentes eles representam. “Já atendidos” inclui somente status 5 (Atendido) e 60 (Atendido pós-consulta), inclusive hoje quando esse status já foi registrado. “Previstos” inclui status 2 (Agendado) e 16 (Marcado - confirmado) de hoje em diante; “confirmados” é o subconjunto de status 16. O cartão da Visão geral chama esse número de **pacientes que ainda vêm hoje**: quem já confirmou e ainda não foi atendido. Esse cartão é clicável e lista os pacientes com nome, CPF e telefone, para a Jéssica ligar e confirmar. A partir das 19h o cartão zera e passa a dizer quantos não compareceram, porque depois do fim do atendimento ninguém mais vem hoje. A leitura do mês é repetida **três vezes seguidas**. O painel só marca “3× igual” quando as três devolvem exatamente os mesmos totais de agendamentos e de pessoas. Se algum número mudar entre as leituras, ele diz qual mudou e mostra a leitura mais recente, em vez de escolher um valor e apresentá-lo como certo — entre uma leitura e outra um paciente pode ter sido atendido ou remarcado de verdade. Cancelados, faltosos e atendimentos em andamento não entram nesses três totais. A leitura consulta todas as especialidades e profissionais ativos da unidade. O gráfico e os totais ficam salvos apenas como números agregados, sem nomes ou IDs de pacientes.

Os diagnósticos e as listas de colaboradores ficam apenas na memória do servidor local; são revalidados após 30 minutos e reiniciar o servidor remove os dados. A lista de espera mostra pedidos pendentes e sem consulta futura encontrada no recorte até o fim do terceiro mês seguinte. A relação de retorno consulta o histórico individual e verifica o ID do profissional. Falhas de conferência são contadas separadamente e não viram oportunidade confirmada. Chamadas `/collect` observadas no Amei pertencem ao Clarity e ao Google Analytics: não atualizam agendas nem renovam o login. O painel usa uma janela do Amei por vez: enquanto uma varredura de fundo (indicadores do mês, diagnósticos ou colaboradores) está lendo, uma consulta pedida na tela espera alguns segundos e, se a fila não liberar, avisa que o Amei está ocupado em vez de deixar a página parada. Basta repetir a ação quando a varredura terminar.
