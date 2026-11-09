// Tarefas operacionais, preparação do dia seguinte e rotinas semanais.
let workflowData = null;
let notificationTab = 'pendente';
const notificationsDialog = $('#notifications-dialog');
const weekNames = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const actionDone = {vagas:'Avisei o call center',confirmacao:'Avisei o call center',
  previsao:'Estou verificando',fixo:'Vou confirmar',retorno:'Vou avaliar',
  salas:'Estou ajustando',leitura:'Vou atualizar'};

function workflowTaskHtml(task) {
  const progress = task.status === 'em_andamento';
  return `<article class="workflow-task ${esc(task.priority)} ${task.followup?'is-followup':''}">
    <div class="workflow-task-main"><div class="workflow-task-top"><span class="workflow-task-kind">${esc({vagas:'VAGAS',confirmacao:'CONFIRMAÇÕES',previsao:'PREVISÃO',fixo:'AGENDA FIXA',retorno:'RETORNO',salas:'SALAS',leitura:'LEITURA AMEI'}[task.kind]||'AVISO')}</span><span class="workflow-task-date">${esc(fullDate(task.date))}</span></div>
      <strong>${esc(task.title)}</strong><p>${esc(task.detail)}</p>${task.followup?'<small class="workflow-followup">Continua pendente após a última ação</small>':''}</div>
    <div class="workflow-task-foot"><div class="workflow-task-actions">${task.agendaId!=null?`<button type="button" class="text-button" data-open-agenda="${esc(task.agendaId)}">Abrir agenda</button>`:''}
      ${task.status==='concluido'?'<span class="workflow-completed">Concluída</span>':`<button type="button" class="secondary" data-task-state="em_andamento" data-task-key="${esc(task.key)}" ${progress?'disabled':''}>${progress?'Em acompanhamento':esc(actionDone[task.kind]||'Em andamento')}</button><button type="button" class="primary" data-task-state="concluido" data-task-key="${esc(task.key)}">Resolvido</button>`}</div></div>
  </article>`;
}

function chosenTasks(tasks) {
  const selected=[],perKind={};
  const weekEnd = new Date(workflowData.today+'T12:00:00Z');weekEnd.setUTCDate(weekEnd.getUTCDate()+7);
  const ordered=[...tasks].sort((a,b)=>(a.date<=weekEnd.toISOString().slice(0,10)?0:1)-(b.date<=weekEnd.toISOString().slice(0,10)?0:1)||a.date.localeCompare(b.date));
  for (const task of ordered) {
    if (selected.length >= 6) break;
    if ((perKind[task.kind]||0) >= 2) continue;
    selected.push(task);perKind[task.kind]=(perKind[task.kind]||0)+1;
  }
  return selected;
}

function renderWorkflow() {
  if (!workflowData) return;
  $('#notifications-count').textContent = workflowData.urgent;
  $('#notifications-count').hidden = workflowData.urgent === 0;
  $('#notifications-bell').setAttribute('aria-label',`${workflowData.urgent} notificações para esta semana, ${workflowData.pending} pendentes no total. Abrir notificações`);
  const pending = workflowData.tasks.filter(t=>t.status==='pendente');
  $('#workflow-today').innerHTML = pending.length ? chosenTasks(pending).map(t=>workflowTaskHtml(t)).join('') :
    '<div class="empty"><b>Tudo acompanhado</b>Nenhuma ação pendente com os dados atuais.</div>';
  const next = workflowData.tomorrow, agendas = next.agendas || [];
  const remaining = next.expected==null ? null : Math.max(0,next.expected-(next.confirmed||0));
  $('#workflow-tomorrow').innerHTML = `<p class="workflow-prep-date">${esc(fullDate(next.date))}</p>
    <div class="workflow-prep-numbers"><div><b>${agendas.filter(a=>a.status==='aberta').length}</b><span>agendas abertas</span></div><div><b>${next.confirmed==null?'—':next.confirmed}</b><span>confirmados</span></div><div><b>${remaining==null?'—':remaining}</b><span>a confirmar</span></div></div>
    <div class="workflow-prep-rooms"><span>Manhã: <b>${next.rooms.disponiveis_manha} de 4 salas livres</b></span><span>Tarde: <b>${next.rooms.disponiveis_tarde} de 4 salas livres</b></span></div>
    <div class="workflow-prep-agendas">${agendas.length?agendas.map(a=>`<button type="button" data-open-agenda="${esc(a.id)}"><strong>${esc(a.professional)}</strong><small>${esc(a.specialty)} · ${a.status==='aberta'?'Aberta no Amei':'Previsão'}${a.free!=null?' · '+a.free+' vaga(s)':''}</small></button>`).join(''):'<p>Nenhuma agenda cadastrada para amanhã.</p>'}</div>
    <button type="button" class="text-button workflow-prep-open" data-open-tomorrow>Ver todas as agendas de amanhã →</button>`;
  if (notificationsDialog.open) renderNotifications();
}

function renderRules() {
  const current = new Set(workflowData.rules.map(r=>r.id));
  const professionals = [...new Map(state.agendas.filter(r=>r.id_profissional && !current.has(String(r.id_profissional)))
    .map(r=>[String(r.id_profissional),r])).values()].sort((a,b)=>a.profissional.localeCompare(b.profissional,'pt-BR'));
  return `<div class="workflow-rules-intro">Estes dias vieram do histórico das agendas. Ajuste uma rotina quando o profissional mudar o dia ou estiver de férias.</div>
    <div class="workflow-rules">${workflowData.rules.map(rule=>`<article class="workflow-rule" data-rule="${esc(rule.id)}"><div><strong>${esc(rule.name)}</strong><small>${esc(rule.specialty)}</small></div><label class="workflow-rule-enabled"><input type="checkbox" data-rule-enabled ${rule.enabled?'checked':''}> Avisos ativos</label><div class="workflow-weekdays">${weekNames.map((name,i)=>`<label><input type="checkbox" value="${i}" data-rule-day ${rule.weekdays.includes(i)?'checked':''}><span>${name}</span></label>`).join('')}</div><button type="button" class="secondary" data-save-rule="${esc(rule.id)}">Salvar rotina</button></article>`).join('')}</div>
    <div class="workflow-add-rule"><h3>Adicionar profissional fixo</h3><select id="new-fixed-professional"><option value="">Escolha um profissional das agendas</option>${professionals.map(r=>`<option value="${esc(r.id_profissional)}">${esc(r.profissional)} · ${esc(r.especialidade)}</option>`).join('')}</select><div class="workflow-weekdays" id="new-fixed-weekdays">${weekNames.map((name,i)=>`<label><input type="checkbox" value="${i}"><span>${name}</span></label>`).join('')}</div><button type="button" class="primary" id="add-fixed-rule">Adicionar rotina</button></div>`;
}

function renderNotifications() {
  document.querySelectorAll('[data-notification-tab]').forEach(b=>b.classList.toggle('active',b.dataset.notificationTab===notificationTab));
  const content = $('#notifications-content');
  if (!workflowData) { content.innerHTML='<div class="details-loading">Carregando avisos...</div>'; return; }
  const pendingTab=document.querySelector('[data-notification-tab="pendente"]');
  pendingTab.textContent=`Pendentes (${workflowData.pending})`;
  if (notificationTab==='rotinas') { content.innerHTML=renderRules(); return; }
  const items = workflowData.tasks.filter(t=>t.status===notificationTab);
  if (notificationTab==='concluido') {
    items.push(...workflowData.history.map(h=>({...h,priority:'baixa',kind:'historico',status:'concluido',recheck:false})));
  }
  const weekEnd=new Date(workflowData.today+'T12:00:00Z');weekEnd.setUTCDate(weekEnd.getUTCDate()+7);
  const urgent=items.filter(t=>t.date<=weekEnd.toISOString().slice(0,10));
  const later=items.filter(t=>t.date>weekEnd.toISOString().slice(0,10));
  content.innerHTML = items.length ? `<p class="notification-intro">${items.length} aviso(s) neste grupo. As ações em andamento voltam a aparecer se o problema continuar no dia seguinte.</p><div class="workflow-list">${(notificationTab==='pendente'?urgent:items).map(t=>workflowTaskHtml(t)).join('')}</div>${notificationTab==='pendente'&&later.length?`<details class="workflow-later"><summary>Próximas semanas · ${later.length} aviso(s)</summary><div class="workflow-list">${later.map(t=>workflowTaskHtml(t)).join('')}</div></details>`:''}` :
    '<div class="empty"><b>Nada aqui por enquanto</b>Os avisos mudam conforme as agendas e as ações registradas.</div>';
}

async function loadWorkflow() {
  try { workflowData=await api('/api/workflow');renderWorkflow(); }
  catch(error) { $('#workflow-today').innerHTML=`<div class="empty">${esc(error.message)}</div>`; }
}
function openNotifications(tab='pendente') {
  notificationTab=tab;renderNotifications();
  if (!notificationsDialog.open) notificationsDialog.showModal();
  renderSystemHealth();
}
$('#notifications-bell').addEventListener('click',()=>openNotifications());
$('#workflow-all').addEventListener('click',()=>openNotifications());
$('#close-notifications').addEventListener('click',()=>notificationsDialog.close());
document.addEventListener('click',async e=>{
  if(e.target.closest('#notifications-dialog [data-open-agenda]')) notificationsDialog.close();
  const tab=e.target.closest('[data-notification-tab]');
  if(tab){notificationTab=tab.dataset.notificationTab;renderNotifications();return;}
  if(e.target.closest('[data-open-tomorrow]')){showDay('amanha');return;}
  const button=e.target.closest('[data-task-state]');
  if(button){button.disabled=true;try{const task=workflowData.tasks.find(t=>t.key===button.dataset.taskKey);await api('/api/workflow/'+encodeURIComponent(button.dataset.taskKey),{method:'PUT',body:JSON.stringify({status:button.dataset.taskState,owner:task?.owner||'Jéssica'})});await loadWorkflow();}catch(error){notify(error.message,true);button.disabled=false;}return;}
  const save=e.target.closest('[data-save-rule]');
  if(save){const card=save.closest('[data-rule]');const days=[...card.querySelectorAll('[data-rule-day]:checked')].map(x=>Number(x.value));const enabled=card.querySelector('[data-rule-enabled]').checked;
    try{await api('/api/fixed-rules/'+encodeURIComponent(save.dataset.saveRule),{method:'PUT',body:JSON.stringify({weekdays:days,enabled})});notify('Rotina atualizada.');await loadWorkflow();}catch(error){notify(error.message,true);}return;}
  if(e.target.closest('#add-fixed-rule')){const id=$('#new-fixed-professional').value;const days=[...document.querySelectorAll('#new-fixed-weekdays input:checked')].map(x=>Number(x.value));
    try{await api('/api/fixed-rules',{method:'POST',body:JSON.stringify({id,weekdays:days})});notify('Rotina adicionada.');await loadWorkflow();}catch(error){notify(error.message,true);}return;}
});
loadWorkflow();
function alertWindow(){
  const now=new Date();
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now));
  return date+(hour>=18?':encerrado':':ativo');
}
let lastAlertWindow=alertWindow();
setInterval(()=>{
  if(document.visibilityState!=='visible')return;
  const current=alertWindow();
  if(current!==lastAlertWindow){lastAlertWindow=current;refresh();}
  loadWorkflow();
},60*1000);

// Estado do sistema no sino: a Jéssica precisa saber se o que ela está vendo é
// recente. Um aviso baseado em leitura velha vale menos que o silêncio.
const SAUDE_AMEI = {
  conectado:        {classe:'ok',   texto:'Amei conectado'},
  login_necessario: {classe:'erro', texto:'Amei pedindo login'},
  ocupado:          {classe:'aviso',texto:'Amei em leitura'},
  fechado:          {classe:'erro', texto:'Janela do Amei fechada'},
};
function idadeLegivel(iso) {
  if (!iso) return 'nunca';
  const horas = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (horas < 1) return `há ${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 48) return `há ${Math.round(horas)} h`;
  return `há ${Math.round(horas / 24)} dias`;
}
async function renderSystemHealth() {
  const caixa = $('#system-health');
  if (!caixa) return;
  try {
    const [conexao, pulso, meses] = await Promise.all([
      api('/api/amei/status'), api('/api/amei/pulso'), api('/api/amei/import/status'),
    ]);
    const amei = SAUDE_AMEI[conexao.status] || {classe:'aviso', texto:'Amei indisponível'};
    const mesAtual = new Date().toLocaleDateString('en-CA').slice(0, 7);
    const lido = (meses.months || []).find(m => m.month === mesAtual);
    const horasLeitura = lido ? (Date.now() - new Date(lido.atualizado_em).getTime()) / 3600000 : Infinity;
    const leituraClasse = horasLeitura <= 24 ? 'ok' : horasLeitura <= 72 ? 'aviso' : 'erro';
    caixa.innerHTML = `
      <span class="health-item ${esc(amei.classe)}"><i></i>${esc(amei.texto)}</span>
      <span class="health-item ${esc(leituraClasse)}"><i></i>Agendas deste mês lidas ${esc(idadeLegivel(lido && lido.atualizado_em))}</span>
      <span class="health-item ${pulso.recuperacoes ? 'aviso' : 'ok'}"><i></i>Sessão religada ${pulso.recuperacoes}× hoje</span>
      ${horasLeitura > 24 ? '<small class="health-note">Avisos de rotina fixa ficam em espera até a leitura ser atualizada, para não cobrar agenda que já pode estar aberta.</small>' : ''}`;
  } catch (e) {
    caixa.innerHTML = `<span class="health-item aviso"><i></i>Não consegui ler o estado do sistema.</span>`;
  }
}
