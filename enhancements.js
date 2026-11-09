const themeToggle = $('#theme-toggle');
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.innerHTML = `<span>${dark ? '☀' : '◐'}</span> ${dark ? 'Modo claro' : 'Modo escuro'}`;
  localStorage.setItem('agenda-clara-theme', dark ? 'dark' : 'light');
}
setTheme(localStorage.getItem('agenda-clara-theme') === 'dark');
themeToggle.addEventListener('click', () => setTheme(document.documentElement.dataset.theme !== 'dark'));

// Menu lateral: fechar encolhe para uma faixa so de icones, entao nada fica inalcancavel.
const menuToggle = $('#menu-toggle');
// Guarda o nome de cada item para virar dica quando o texto some. So os nos de texto:
// o icone mora num <span> e o contador de alertas num <em>.
document.querySelectorAll('.nav').forEach(b => {
  b.title = [...b.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim();
});
function setMenu(aberto) {
  document.documentElement.dataset.menu = aberto ? 'aberto' : 'fechado';
  menuToggle.setAttribute('aria-expanded', String(aberto));
  menuToggle.innerHTML = `<span>${aberto ? '«' : '»'}</span> <em>${aberto ? 'Fechar menu' : 'Abrir menu'}</em>`;
  const rotulo = aberto ? 'Fechar menu' : 'Abrir menu';
  menuToggle.setAttribute('aria-label', rotulo);
  menuToggle.title = rotulo;
  localStorage.setItem('agenda-clara-menu', aberto ? 'aberto' : 'fechado');
}
setMenu(localStorage.getItem('agenda-clara-menu') !== 'fechado');
menuToggle.addEventListener('click', () => setMenu(document.documentElement.dataset.menu === 'fechado'));

agendaCard = function(r) {
  const imported = r.vagas != null;
  const pct = imported ? (r.total ? Math.round(r.vagas / r.total * 100) : 0) : r.ocupacao;
  const pill = imported ? `${r.vagas} ${r.vagas===1?'vaga livre':'vagas livres'}` : rateLabel(r);
  const info = imported
    ? `${r.total} horários · ${r.encaixes == null ? 'encaixes não verificados' : r.encaixes+' encaixe(s)'} · leitura ${new Date(r.sincronizado_em).toLocaleString('pt-BR')}`
    : (r.ocupados == null ? 'Preenchimento ainda não informado' : `${r.ocupados} de ${r.total} horários preenchidos manualmente`);
  const period = r.periodos.length ? r.periodos.map(p=>esc(p.inicio)+'–'+esc(p.fim)).join(' / ') : 'Agenda do Amei';
  const card = `<article class="agenda-card"><div class="avatar">${esc(r.profissional[0].toUpperCase())}</div><div class="agenda-info"><div class="agenda-line"><strong>${esc(r.profissional)}</strong><span class="pill ${imported?(r.vagas>0?'mid':'good'):level(pct)}">${esc(pill)}</span></div><div class="small-meta">${esc(r.especialidade)} · ${period}</div>${!imported&&pct!=null?`<div class="progress ${level(pct)}"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>`:''}<div class="progress-label">${esc(info)}</div>${r.id_profissional&&r.id_especialidade?'<div class="agenda-chip">Clique para ver pacientes e horários atuais →</div>':''}</div></article>`;
  return `<button class="agenda-click" type="button" data-open-agenda="${esc(r.id)}" aria-label="Ver agenda de ${esc(r.profissional)} em ${dateLabel(r.data)}">${card}</button>`;
};

function agendaPriority(r) {
  if (r.vagas != null && r.total) return r.vagas / r.total;
  if (r.ocupacao != null) return (100-r.ocupacao) / 100;
  return 0;
}
function displayStatus(r) {
  if (r.data < state.dashboard.hoje && r.situacao === 'aberta') return 'Já passou';
  if (r.data < state.dashboard.hoje && r.situacao === 'prevista') return 'Previsão vencida';
  return statusName[r.situacao];
}
let agendaPage = 0;
renderTable = function() {
  const q = $('#search').value.toLocaleLowerCase('pt-BR');
  const filter = $('#status-filter').value, month = $('#month-filter').value;
  const today = state.dashboard.hoje;
  const rows = state.agendas.filter(r => {
    if (q && !(r.profissional+' '+r.especialidade).toLocaleLowerCase('pt-BR').includes(q)) return false;
    if (month && !r.data.startsWith(month)) return false;
    // Dia escolhido no mini calendario manda em cima dos outros filtros de data.
    if (calDay) return r.data === calDay;
    if (filter === 'proximas') return r.data >= today && !['cancelada','realizada'].includes(r.situacao);
    if (filter === 'passou') return r.data < today;
    return filter === 'todas' || !filter || r.situacao === filter;
  });
  rows.sort((a,b) => {
    if (filter === 'passou') return b.data.localeCompare(a.data) || agendaPriority(b)-agendaPriority(a);
    if (filter === 'todas') {
      const ap=a.data>=today, bp=b.data>=today;
      if (ap!==bp) return ap?-1:1;
      if (!ap) return b.data.localeCompare(a.data);
    }
    return a.data.localeCompare(b.data) || agendaPriority(b)-agendaPriority(a) || a.profissional.localeCompare(b.profissional,'pt-BR');
  });
  agendaPage=Math.min(agendaPage,Math.max(0,Math.ceil(rows.length/10)-1));
  const shown = rows.slice(agendaPage*10, agendaPage*10+10);
  $('#all-agendas').innerHTML = rows.length ? `<p class="table-count">Mostrando ${agendaPage*10+1}–${agendaPage*10+shown.length} de ${rows.length} agendas neste filtro.</p><table><thead><tr><th>DATA</th><th>PROFISSIONAL / ESPECIALIDADE</th><th>SITUAÇÃO</th><th>DISPONIBILIDADE</th><th>ESTADO</th><th>CONFIRMADOS</th><th>AÇÕES</th></tr></thead><tbody>${shown.map(r => {
    const imported = String(r.id).startsWith('amei:');
    const details = r.id_profissional && r.id_especialidade ? `<button data-open-agenda="${esc(r.id)}">Abrir agenda</button>` : '';
    const actions = imported ? `${details}<span class="source-label">Amei</span>` : `${details}<button data-edit="${r.id}">Editar</button>${r.situacao==='aberta'&&r.id_profissional&&r.id_especialidade?`<button data-sync="${r.id}">Atualizar Amei</button>`:''}<button data-delete="${r.id}">Excluir</button>`;
    const availability = r.vagas != null ? `<strong>${r.vagas} ${r.vagas===1?'vaga livre':'vagas livres'}</strong><small>${r.encaixes==null?'Encaixes não verificados':r.encaixes+' encaixe(s)'} · ${r.total} horários</small>` : r.ocupacao != null ? `<strong>${r.ocupacao}% informado</strong><small>${r.ocupados}/${r.total} · manual</small>` : '—';
    const priority = r.prioridade === 'alta' ? '<span class="priority-pill alta">● Alta prioridade</span>' : r.prioridade === 'atencao' ? '<span class="priority-pill atencao">● Atenção</span>' : r.prioridade === 'normal' ? '<span class="priority-pill normal">● Em dia</span>' : '<span class="priority-pill past">—</span>';
    const clickable = r.id_profissional && r.id_especialidade ? `data-open-agenda="${esc(r.id)}" tabindex="0" aria-label="Abrir agenda de ${esc(r.profissional)}"` : '';
    return `<tr ${clickable}><td><strong>${dateLabel(r.data)}</strong>${r.data<today?'<small class="agenda-past">Data passada</small>':''}</td><td><strong>${esc(r.profissional)}</strong><small>${esc(r.especialidade)}${r.origem?' · '+esc(r.origem):''}</small></td><td><span class="pill ${r.situacao==='aberta'&&r.data>=today?'good':'unknown'}">${esc(displayStatus(r))}</span></td><td>${availability}</td><td>${priority}</td><td>${r.confirmados??'—'}</td><td class="actions">${actions}</td></tr>`;
  }).join('')}</tbody></table><div class="agenda-pagination"><button type="button" data-agenda-page="prev" ${agendaPage===0?'disabled':''}>← Anterior</button><span>Página ${agendaPage+1} de ${Math.ceil(rows.length/10)}</span><button type="button" data-agenda-page="next" ${agendaPage+1>=Math.ceil(rows.length/10)?'disabled':''}>Próxima →</button></div>` : empty('Nenhuma agenda neste filtro', filter==='proximas'?'Consulte “Já passou” ou “Todas as situações” para ver o histórico.':'Ajuste os filtros ou cadastre uma agenda.');
};
['search','status-filter','month-filter'].forEach(id => $('#'+id).addEventListener('input', ()=>{agendaPage=0;renderTable();}));
document.addEventListener('click',e=>{const p=e.target.closest('[data-agenda-page]');if(!p)return;agendaPage+=p.dataset.agendaPage==='next'?1:-1;renderTable();});

// Os cartoes de hoje e de amanha abrem a mesma janela, so muda o dia mostrado.
const DAY_VIEWS = {
  hoje:   {eyebrow:'OPERAÇÃO DO DIA',      titulo:'Agendas de hoje',   rows:()=>state.dashboard.agendas_hoje,   vazio:['Nenhuma agenda aberta hoje','Cadastre uma agenda ou atualize o mês na aba Conexões.']},
  amanha: {eyebrow:'PRÓXIMO ATENDIMENTO',  titulo:'Agendas de amanhã', rows:()=>state.dashboard.agendas_amanha, vazio:['Nenhuma agenda aberta amanhã','Confira as previsões ou atualize o mês na aba Conexões.']},
};
let dayShown = 'amanha';
function showDay(kind) {
  const view = DAY_VIEWS[kind] || DAY_VIEWS.amanha;
  dayShown = DAY_VIEWS[kind] ? kind : 'amanha';
  const rows = view.rows() || [];
  $('#day-eyebrow').textContent = view.eyebrow;
  $('#day-title').textContent = view.titulo;
  $('#day-body').innerHTML = rows.length ? `<p class="details-subtitle">${fullDate(rows[0].data)} · ${rows.length} agenda(s) abertas</p><div class="agenda-stack">${rows.map(agendaCard).join('')}</div>` : empty(view.vazio[0], view.vazio[1]);
  $('#day-dialog').showModal();
}
const showTomorrow = () => showDay('amanha');
$('#tomorrow-card').addEventListener('click', showTomorrow);
$('#tomorrow-card').addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();showTomorrow();} });
$('#today-card').addEventListener('click', () => showDay('hoje'));
$('#today-card').addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();showDay('hoje');} });
$('#close-day').addEventListener('click', () => $('#day-dialog').close());

let detailOrigin = null;
let detailRequestId = 0;
let attentionState = null;
async function openAgenda(id) {
  const row = state.agendas.find(r => String(r.id) === String(id));
  if (!row) return;
  const requestId = ++detailRequestId;
  detailOrigin = $('#day-dialog').open ? 'dia:'+dayShown : currentView;
  if ($('#day-dialog').open) $('#day-dialog').close();
  $('#details-title').textContent = `${row.profissional} · ${dateLabel(row.data)}`;
  $('#details-body').innerHTML = '<div class="details-loading">Buscando o estado atual no Amei...</div>';
  $('#details-dialog').showModal();
  if (!row.id_profissional || !row.id_especialidade) {
    $('#details-body').innerHTML = `<p class="details-subtitle">${esc(row.especialidade)} · registro manual</p><p>Esta agenda ainda não tem os IDs do profissional e da especialidade no Amei. Edite o cadastro para habilitar a consulta de horários e pacientes.</p>`;
    return;
  }
  try {
    const params = new URLSearchParams({date:row.data,professionalId:row.id_profissional,specialtyId:row.id_especialidade});
    // Uma varredura de fundo pode estar com o Amei. Em vez de dar erro e parar,
    // espera a vez: quem abriu a agenda quer ver a agenda, nao um aviso.
    let detail = null;
    for (let tentativa = 1; tentativa <= 10 && detail === null; tentativa++) {
      try {
        detail = await api('/api/amei/agenda?'+params);
      } catch (erro) {
        if (!/ocupado/i.test(erro.message) || tentativa === 10) throw erro;
        if (!$('#details-dialog').open || requestId !== detailRequestId) return;
        $('#details-body').innerHTML = `<div class="details-loading">O Amei está terminando outra leitura. Tentando de novo (${tentativa}/9)...</div>`;
        await new Promise(r => setTimeout(r, 15000));
      }
    }
    if (!$('#details-dialog').open || requestId !== detailRequestId) return;
    const patients = detail.appointments;
    $('#details-body').innerHTML = `<p class="details-subtitle">${esc(row.especialidade)} · consulta atual do Amei</p>
      <div class="details-summary five"><div><b>${detail.total}</b><span>horários</span></div><div><b>${patients.length}</b><span>pacientes na agenda</span></div><div><b>${detail.freeCount}</b><span>livres</span></div><div><b>${detail.fitInCount}</b><span>encaixes marcados</span></div><div><b>${detail.blockedCount}</b><span>bloqueados</span></div></div>
      <h3 class="detail-heading">Horários livres</h3><div class="free-times">${detail.freeTimes.length ? detail.freeTimes.map(t=>`<span>${esc(t)}</span>`).join('') : '<small>Nenhum horário livre nesta leitura.</small>'}</div>
      <div id="billing-box" class="billing-box"><span class="billing-loading">Somando os valores desta agenda no Amei...</span></div>
      <div id="attention-box"></div>
      <h3 class="detail-heading" id="regular-patients-title">Pacientes na agenda</h3><div class="patient-list" id="regular-patients"></div>
      <p class="details-note">A leitura é feita ao abrir esta janela. Encaixes são agendamentos já marcados, não vagas livres. Nomes de pacientes não ficam salvos no painel.</p>`;
    attentionState={requestId,row,patients,card:null,psi:null,cardError:'',psiError:'',cardLoading:true,psiLoading:ehPsiquiatria(row)};
    renderAttention();
    conferirCartao(row, requestId);
    if (ehPsiquiatria(row)) conferirPsiquiatria(row, requestId);
  } catch(e) {
    if ($('#details-dialog').open && requestId === detailRequestId) $('#details-body').innerHTML = `<p class="details-loading">${esc(e.message)}</p>`;
  }
}

// Psiquiatria cobra diferente na primeira consulta (Áreas de Atuação) e no retorno (Sessão).
// O painel confere o histórico do ano de cada paciente e aponta quem está no procedimento errado.
const ehPsiquiatria = row => /psiquiatr/i.test(String(row.especialidade || ''));
const ehOftalmo = row => /oftalm/i.test(String(row.especialidade || ''));
const PSI_AVISO = {
  erro: a => `Já passou ${a.vezes}× na psiquiatria este ano (última em ${fullDate(a.ultima)}). Deveria ser Sessão, não Primeira consulta.`,
  sem_historico: () => 'Está como Sessão, mas não achei atendimento anterior na psiquiatria este ano. Confira se é mesmo retorno.',
  sem_procedimento: () => 'Agendamento sem procedimento lançado.',
};
const PSI_TIPO = {primeira:'Primeira consulta', sessao:'Sessão', outro:'Outro procedimento', sem:'Sem procedimento'};
async function conferirPsiquiatria(row, requestId) {
  const vivo = () => $('#details-dialog').open && requestId === detailRequestId && attentionState?.requestId===requestId;
  if (!vivo()) return;
  try {
    await api('/api/psiquiatria', {method:'POST', body:JSON.stringify({id:row.id})});
    for (let tentativa = 0; tentativa < 150; tentativa++) {
      const job = await api('/api/psiquiatria?id=' + encodeURIComponent(row.id));
      if (!vivo()) return;
      if (!job.running) {attentionState.psi=job;attentionState.psiLoading=false;renderAttention();return;}
      await new Promise(r => setTimeout(r, 4000));
    }
    if(vivo()){attentionState.psiError='Tempo esgotado ao conferir a psiquiatria.';attentionState.psiLoading=false;renderAttention();}
  } catch (e) {
    if(vivo()){attentionState.psiError=e.message;attentionState.psiLoading=false;renderAttention();}
  }
}
// Dinheiro da agenda: previsto (valor dos agendamentos marcados) e o que ja foi
// liquidado, separado por forma de pagamento. Os valores sao lidos do Amei.
const dinheiro = v => Number(v||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
function renderFaturamento(resumo) {
  const caixa = $('#billing-box');
  if (!caixa) return;
  const formas = resumo.formas || [];
  const detalhe = [];
  if (resumo.cancelados) detalhe.push(`${resumo.cancelados} cancelado(s) fora da conta`);
  if (resumo.semValor) detalhe.push(`${resumo.semValor} agendamento(s) sem valor lançado`);
  if (resumo.naoLidos) detalhe.push(`${resumo.naoLidos} não lido(s) no Amei`);
  caixa.innerHTML = `<div class="billing-head"><span class="eyebrow">DINHEIRO DESTA AGENDA</span>
      <small>${esc(resumo.agendamentos)} agendamento(s) com valor${detalhe.length?' · '+esc(detalhe.join(' · ')):''}</small></div>
    <div class="billing-values"><div><b>${esc(dinheiro(resumo.previsto))}</b><span>previsto</span></div>
      <div><b>${esc(dinheiro(resumo.recebido))}</b><span>já pago</span></div>
      <div><b>${esc(dinheiro(resumo.aReceber))}</b><span>a receber</span></div></div>
    ${formas.length ? `<div class="billing-forms">${formas.map(f=>`<span><b>${esc(f.forma)}</b> ${esc(dinheiro(f.valor))} · ${esc(f.pacientes)} paciente(s)</span>`).join('')}</div>`
      : '<p class="billing-note">Nenhum pagamento lançado nesta agenda até agora.</p>'}`;
}
function mostrarFaturamento(job) {
  const caixa = $('#billing-box');
  if (!caixa) return;
  const dados = job.data && job.data.faturamento;
  if (dados) return renderFaturamento(dados);
  caixa.innerHTML = `<span class="billing-loading">${esc(job.error || 'Não foi possível somar os valores desta agenda.')}</span>`;
}
$('#back-details').addEventListener('click', () => {
  ++detailRequestId;
  $('#details-dialog').close();
  if (String(detailOrigin).startsWith('dia:')) showDay(detailOrigin.slice(4));
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-edit],[data-delete],[data-sync]')) return;
  const button=e.target.closest('[data-open-agenda]');
  if(button) openAgenda(button.dataset.openAgenda);
});
document.addEventListener('keydown', e => {
  if ((e.key==='Enter' || e.key===' ') && e.target.matches('tr[data-open-agenda]')) {
    e.preventDefault(); openAgenda(e.target.dataset.openAgenda);
  }
});
refresh();

// Toda agenda tem uma unica area de atencao. Cartao, oftalmo e psiquiatria
// chegam em momentos diferentes; o mesmo agendamento aparece so uma vez.
const CARD_SIT = {
  ativo:'Cartão ativo', devendo:'Em atraso', sem_cartao:'Sem cartão', nao_conferido:'Não conferido'
};
const OFT_NOMES = {consulta:'Consulta',biomicroscopia:'Biomicroscopia de fundo',tonometria:'Tonometria binocular'};
const moeda = valor => Number.isFinite(valor) ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(valor) : 'valor não informado';

async function conferirCartao(row, requestId) {
  const vivo = () => $('#details-dialog').open && requestId===detailRequestId && attentionState?.requestId===requestId;
  if (!vivo()) return;
  try {
    await api('/api/cartao',{method:'POST',body:JSON.stringify({id:row.id})});
    for(let tentativa=0;tentativa<150;tentativa++){
      const job=await api('/api/cartao?id='+encodeURIComponent(row.id));
      if(!vivo())return;
      if(!job.running){attentionState.card=job;attentionState.cardLoading=false;renderAttention();
        mostrarFaturamento(job);return;}
      await new Promise(r=>setTimeout(r,3000));
    }
    if(vivo()){attentionState.cardError='Tempo esgotado ao conferir o Cartão de Todos.';attentionState.cardLoading=false;renderAttention();}
  }catch(e){
    if(vivo()){attentionState.cardError=e.message;attentionState.cardLoading=false;renderAttention();}
  }
}

// A dica do status mostra quem criou o agendamento, tanto no aviso como na lista normal.
function marcarAutoria(rows) {
  const porId=new Map(rows.map(r=>[String(r.appointmentId),r]));
  for(const chip of document.querySelectorAll('#details-body .status-chip[data-apt]')){
    const r=porId.get(chip.dataset.apt);
    if(!r){chip.title='Não consegui conferir quem agendou.';chip.classList.add('sem-autor');continue;}
    const quem=r.agendadoPor||'Sistema';
    const quando=r.agendadoEm?` · ${fullDate(r.agendadoEm.slice(0,10))} às ${r.agendadoEm.slice(11,16)}`:'';
    chip.title=`Agendado por ${quem}${quando}`;
    chip.classList.toggle('por-sistema',!r.agendadoPor);
    chip.classList.remove('sem-autor');
  }
}

function renderAttention(){
  const st=attentionState;
  if(!st || st.requestId!==detailRequestId || !$('#details-dialog').open)return;
  const box=$('#attention-box'),normal=$('#regular-patients'),normalTitle=$('#regular-patients-title');
  if(!box || !normal)return;
  const card=st.card?.error?null:st.card?.data;
  const psi=st.psi?.error?null:st.psi?.data;
  const byId=new Map();
  const entry=(id,source)=>{
    id=String(id||'');if(!id)return null;
    if(!byId.has(id))byId.set(id,{id,source,card:null,psi:null,messages:[],level:'aviso'});
    const item=byId.get(id);if(source && (!item.source || source.name))item.source=source;return item;
  };
  const issue=(item,message,level='erro')=>{if(!item)return;item.messages.push(message);if(level==='erro')item.level='erro';};
  for(const r of card?.rows||[]){
    const item=entry(r.appointmentId,r);if(!item)continue;item.card=r;
    if(r.situacao!=='ativo')issue(item,`Cartão de Todos: ${CARD_SIT[r.situacao]||'Não conferido'}${r.mensagem?' — '+r.mensagem:''}.`,r.situacao==='nao_conferido'?'aviso':'erro');
    if(ehOftalmo(st.row)){
      const a=r.oftalmo;
      if(!a)issue(item,'Procedimentos e valor não conferidos.','aviso');
      else{
        if(a.faltando?.length)issue(item,`Faltando: ${a.faltando.map(t=>OFT_NOMES[t]||t).join(', ')}.`);
        if(a.extras?.length)issue(item,`Procedimento extra ou repetido: ${a.extras.join(', ')}.`);
        if(a.valorIncorreto)issue(item,`Valor diferente de R$ 102,00. Total no Amei: ${moeda(a.valorTotal)}; soma dos procedimentos: ${moeda(a.somaProcedimentos)}.`);
      }
    }
  }
  for(const r of card?.naoConferidos||[])issue(entry(r.appointmentId,r),`Não consegui conferir cartão${ehOftalmo(st.row)?', procedimentos e valor':''}. Confira no Amei.`, 'aviso');
  for(const r of psi?.rows||[]){
    const item=entry(r.appointmentId,r);if(!item)continue;item.psi=r;
    if(r.alerta)issue(item,PSI_AVISO[r.alerta.nivel]?.(r.alerta)||'Confira a cobrança de psiquiatria.',r.alerta.nivel==='erro'?'erro':'aviso');
  }
  for(const r of psi?.naoConferidos||[])issue(entry(r.appointmentId,r),'Não consegui conferir o histórico de psiquiatria. Confira no Amei.','aviso');
  const alerts=[...byId.values()].filter(x=>x.messages.length).sort((a,b)=>(a.source?.time||'99').localeCompare(b.source?.time||'99'));
  const alertIds=new Set(alerts.map(x=>x.id));
  const rest=st.patients.filter(p=>!alertIds.has(String(p.appointmentId||'')));
  normalTitle.textContent=alerts.length?'Demais pacientes na agenda':'Pacientes na agenda';
  normal.innerHTML=rest.length?rest.map(p=>`<div class="patient-row"><span>${esc(p.time)}</span><strong>${esc(p.patient)}</strong><span class="status-chip" data-apt="${esc(p.appointmentId||'')}" title="Conferindo quem agendou...">${esc(p.status)}${p.fitIn&&!/encaixe/i.test(p.status||'')?' · Encaixe':''}</span></div>`).join('')
    :`<p class="details-note">${st.patients.length?'Todos os pacientes desta agenda estão nos avisos acima.':'Nenhum paciente marcado nesta agenda.'}</p>`;
  const line=x=>{
    const r=x.card||x.psi||x.source||{},a=x.card?.oftalmo;
    const extra=ehOftalmo(st.row)&&a?.procedimentos?.length?a.procedimentos.map(p=>`${p.descricao||'Sem nome'} (${moeda(p.valor)})`).join(' · ')
      :x.psi?.procedimentos?.length?`${PSI_TIPO[x.psi.tipo]||x.psi.tipo}: ${x.psi.procedimentos.map(p=>`${p.descricao} (${moeda(p.valor)})`).join(' · ')}`:'';
    const status=r.status||st.patients.find(p=>String(p.appointmentId)===x.id)?.status||'Agendamento';
    return `<div class="oft-row ${x.level}"><span class="psi-time">${esc(r.time||'--:--')}</span><span class="psi-main"><strong>${esc(r.name||'Nome não informado')}</strong><small>CPF ${esc(formatCpf(r.cpf||''))}${r.phone?' · '+esc(formatPhone(r.phone)):''}${x.card?.parceiro?' · '+esc(x.card.parceiro):''}</small>${extra?`<span class="oft-procedures">${esc(extra)}</span>`:''}<em>${x.messages.map(m=>esc(m)).join('<br>')}</em></span><span class="oft-total">${a?`<b>${esc(moeda(a.valorTotal))}</b>`:''}<span class="status-chip" data-apt="${esc(x.id)}" title="Conferindo quem agendou...">${esc(status)}</span></span></div>`;
  };
  const loading=st.cardLoading||st.psiLoading;
  const errors=[st.cardError||st.card?.error,st.psiError||st.psi?.error].filter(Boolean);
  box.innerHTML='<h3 class="detail-heading">Pacientes que precisam de atenção</h3>'+
    (loading?'<p class="details-loading">Conferindo os agendamentos no Amei...</p>':'')+
    (alerts.length?`<p class="card-flag">${alerts.length} paciente(s) para conferir. Quem está em ordem fica na lista abaixo.</p><div class="oft-list">${alerts.map(line).join('')}</div>`:!loading&&!errors.length?'<p class="details-note">Nenhuma alteração encontrada nesta agenda.</p>':'')+
    errors.map(e=>`<p class="psi-pending">Uma conferência não foi concluída: ${esc(e)}. Confira no Amei.</p>`).join('');
  if(card)marcarAutoria(card.rows);
  else if(!st.cardLoading)marcarAutoria([]);
}
