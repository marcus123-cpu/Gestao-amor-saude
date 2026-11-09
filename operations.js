const diagnosisDialog=$('#diagnosis-dialog');
$('#close-diagnosis').onclick=()=>diagnosisDialog.close();
let diagnosisTimer=null;
function diagnosisPeople(rows, heading, emptyText, dateKey) {
  return `<section class="diagnosis-group"><h3>${heading} <span>${rows.length}</span></h3>${rows.length
    ? `<div class="diagnosis-list">${rows.map(p=>`<article><strong>${esc(p.name||'Nome não disponível')}</strong><span>${esc(formatPhone(p.phone)||'Telefone não informado')} · CPF ${esc(formatCpf(p.cpf))}</span><small>${dateKey==='lastVisit'?'Última consulta: ':'Na espera desde: '}${esc(p[dateKey]?fullDate(p[dateKey]):'—')}</small></article>`).join('')}</div>`
    : `<p class="details-subtitle">${emptyText}</p>`}</section>`;
}
async function showDiagnosis(id) {
  const row=state.agendas.find(r=>String(r.id)===String(id));if(!row)return;
  $('#diagnosis-title').textContent=`${row.profissional} · ${dateLabel(row.data)}`;
  $('#diagnosis-body').innerHTML='<p class="details-loading">Preparando diagnóstico no Amei...</p>';
  diagnosisDialog.showModal();
  clearTimeout(diagnosisTimer);
  try {await api('/api/diagnosis',{method:'POST',body:JSON.stringify({id:String(id)})});}
  catch(e){$('#diagnosis-body').textContent=e.message;return;}
  const poll=async()=>{
    if(!diagnosisDialog.open)return;
    try{
      const job=await api('/api/diagnosis?id='+encodeURIComponent(id));
      if(job.running){$('#diagnosis-body').innerHTML='<p class="details-loading">Consultando lista de espera, atendimentos anteriores e retornos. Pode levar alguns minutos...</p>';diagnosisTimer=setTimeout(poll,3500);return;}
      if(job.error){$('#diagnosis-body').textContent=job.error;return;}
      const d=job.data;if(!d){$('#diagnosis-body').textContent='Diagnóstico ainda não disponível.';return;}
      $('#diagnosis-body').innerHTML=`<p class="details-subtitle">${esc(row.especialidade)} · ${esc(fullDate(d.period.start))} a ${esc(fullDate(d.period.historicalEnd))} · retorno conferido até ${esc(fullDate(d.period.checkedThrough))}</p>
        <div class="diagnosis-summary"><div><b>${d.waiting.length}</b><span>na lista de espera</span></div><div><b>${d.returning.length}</b><span>atendidos sem retorno identificado</span></div><div><b>${d.unverified}</b><span>cadastros para conferir</span></div></div>
        ${diagnosisPeople(d.waiting,'Lista de espera','Nenhum paciente pendente encontrado para este profissional ou especialidade.','since')}
        ${diagnosisPeople(d.returning,'Atendidos nos dois meses anteriores sem retorno','Nenhum paciente encontrado neste recorte.','lastVisit')}
        <p class="details-note">${esc(d.limitation)} Pacientes sem cadastro verificável ficam fora da lista. Confira no Amei antes de contatar.</p>`;
    }catch(e){$('#diagnosis-body').textContent=e.message;}
  };poll();
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-diagnosis]');if(button)showDiagnosis(button.dataset.diagnosis);});

// Start high priority diagnoses as soon as their agendas are available.
let prefetched='';
const previousRender=render;
render=function(){previousRender();const ids=[...new Set((state.dashboard.alertas||[]).filter(a=>a.nivel==='critico').map(a=>String(a.id)))];const key=state.dashboard.hoje+'|'+ids.join(',');if(ids.length&&key!==prefetched){prefetched=key;setTimeout(()=>api('/api/diagnosis/prefetch',{method:'POST',body:JSON.stringify({ids})}).catch(()=>{}),2500);}};

const collabMonth=$('#collab-month');collabMonth.value=new Date().toLocaleDateString('en-CA').slice(0,7);
let collabData=null,collabTab='equipe',selectedCollaborator=null,collabFilter='',collabCut='todas';
const collaborators=[{key:'gabriela',name:'David',amei:'Gabriela Paulino Ramos'},{key:'marcos',name:'Marcos Paulo',amei:'Marcus Paulo Coleta Caetano'},{key:'thais',name:'Thaís Machado',amei:'Tais Carla Machado Cavalcante'}];
const attended=r=>[5,60].includes(r.statusId),cancelled=r=>[3,8,9].includes(r.statusId),absent=r=>[17,83].includes(r.statusId);
const createdInMonth=r=>{if(!r.createdAt||!/[zZ]|[+-]\d\d:\d\d$/.test(r.createdAt))return false;const time=new Date(r.createdAt);return Number.isFinite(time.getTime())&&new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(time)===collabMonth.value;};
const rowsFor=key=>collabData?.rows?.[key]||[];
function collaboratorStatus(rows){const count=rows.filter(attended).length;const now=new Date(),month=collabMonth.value;const days=new Date(+month.slice(0,4),+month.slice(5,7),0).getDate();const elapsed=month===new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(now)?now.getDate():month<new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(now)?days:0;const pace=480*elapsed/days;return count>=480?'goal-done':count>=pace?'goal-good':count>=pace*.9?'goal-near':'goal-low';}
// Rotulos em portugues claro: a tela explica o que cada numero conta, sem jargao.
const GLOSSARIO = {
  marcadas:'Agendamentos criados por esta pessoa no Amei cuja consulta acontece neste mês.',
  noMes:'Destes, os que foram criados dentro deste mês. Vem com "no mínimo" porque a busca do Amei lista por data da consulta: um agendamento criado agora para um mês futuro não aparece aqui.',
  compareceram:'Pacientes que chegaram e foram atendidos (status Atendido ou Atendido pós-consulta no Amei).',
};
// Cada bloquinho da ficha e um recorte da lista de pacientes logo abaixo.
const RECORTES={
  todas:        {rotulo:'Todas',                       teste:()=>true},
  compareceram: {rotulo:'Compareceram',                teste:r=>attended(r)},
  marcadas:     {rotulo:'Marcadas para este mês',      teste:()=>true},
  noMes:        {rotulo:'Marcadas durante este mês',   teste:r=>createdInMonth(r)},
  confirmados:  {rotulo:'Confirmados',                 teste:r=>r.statusId===16},
  cancelados:   {rotulo:'Cancelados/desmarcados',      teste:r=>cancelled(r)},
  faltas:       {rotulo:'Faltas',                      teste:r=>absent(r)},
};
function statsDe(rows){return{
  marcadas:rows.length,
  noMes:rows.filter(createdInMonth).length,
  compareceram:rows.filter(attended).length,
  confirmados:rows.filter(r=>r.statusId===16).length,
  cancelados:rows.filter(cancelled).length,
  faltas:rows.filter(absent).length,
};}
const MEDALHAS=['🥇','🥈','🥉'];
function podiumHtml(ordered){
  // Podio de esporte: 3o a esquerda, 1o no meio e maior, 2o a direita.
  const posicoes=[2,0,1].filter(i=>ordered[i]);
  return `<div class="podium">${posicoes.map(i=>{
    const p=ordered[i],rows=rowsFor(p.key),st=statsDe(rows),pct=Math.round(st.compareceram/480*100);
    return `<button type="button" data-collab="${p.key}" class="podium-spot place-${i+1} ${collaboratorStatus(rows)}" aria-label="${esc(p.name)}, ${i+1}º lugar, ${st.compareceram} comparecimentos">
      <span class="podium-medal">${MEDALHAS[i]}</span>
      <span class="podium-name">${esc(p.name)}</span>
      <span class="podium-score"><b>${st.compareceram}</b><small>/ 480</small></span>
      <span class="podium-label">comparecimentos</span>
      <span class="goal-track"><i style="width:${Math.min(100,pct)}%"></i></span>
      <span class="podium-extra">${st.marcadas} marcadas para este mês</span>
      <span class="podium-step"><b>${i+1}º</b></span>
    </button>`;}).join('')}</div>
  <p class="collab-legend">Posição pelo número de pacientes que compareceram no mês. ${esc(GLOSSARIO.compareceram)}</p>`;
}
function teamHtml(){
  return `<div class="collab-grid">${collaborators.map(p=>{
    const rows=rowsFor(p.key),st=statsDe(rows),pct=Math.round(st.compareceram/480*100);
    return `<button type="button" data-collab="${p.key}" class="collab-card ${collaboratorStatus(rows)}">
      <span class="eyebrow">${esc(p.amei)}</span>
      <h3>${esc(p.name)}</h3>
      <strong class="collab-score">${st.compareceram} <small>/ 480 comparecimentos</small></strong>
      <span class="goal-track"><i style="width:${Math.min(100,pct)}%"></i></span>
      <span class="collab-figures">
        <span title="${esc(GLOSSARIO.marcadas)}"><b>${st.marcadas}</b><small>marcadas para este mês</small></span>
        <span title="${esc(GLOSSARIO.noMes)}"><b>no mín. ${st.noMes}</b><small>marcadas durante este mês</small></span>
      </span>
      <span class="collab-open">Ver pacientes e situações →</span>
    </button>`;}).join('')}</div>
  <div class="collab-legend">
    <p><b>Marcadas para este mês:</b> ${esc(GLOSSARIO.marcadas)}</p>
    <p><b>Marcadas durante este mês:</b> ${esc(GLOSSARIO.noMes)}</p>
    <p><b>Comparecimentos:</b> ${esc(GLOSSARIO.compareceram)} É esse número que conta para a meta de 480.</p>
  </div>`;
}
// Busca de paciente: casa pelo nome ou pelo CPF, digitado com ou sem pontuacao.
// O Amei guarda o CPF so com numeros, entao "405.102.618-33" precisa achar "40510261833".
function casaPaciente(r, q){
  if(!q) return true;
  if(((r.name||'')+' '+(r.cpf||'')).toLocaleLowerCase('pt-BR').includes(q)) return true;
  const qDig=soDigitos(q);
  return qDig.length>=3 && soDigitos(r.cpf).includes(qDig);
}
function pessoaHtml(person){
  const all=rowsFor(person.key),st=statsDe(all),q=collabFilter.toLocaleLowerCase('pt-BR');
  const recorte=RECORTES[collabCut]||RECORTES.todas;
  const filtered=all.filter(recorte.teste).filter(r=>casaPaciente(r,q));
  const estado=r=>[5,60].includes(r.statusId)?'Atendido':r.statusId===16?'Confirmado':cancelled(r)?'Cancelado/desmarcado':absent(r)?'Não compareceu':'Outro estado no Amei';
  const bloco=(cut,valor,rotulo,dica)=>`<button type="button" class="collab-stat${collabCut===cut?' is-on':''}" data-collab-cut="${cut}" title="${esc(dica||'')}" aria-pressed="${collabCut===cut}"><b>${esc(valor)}</b><small>${esc(rotulo)}</small></button>`;
  return `<button type="button" class="back-button collab-back" id="collab-back" aria-label="Voltar à equipe">←</button>
  <h2>${esc(person.name)}</h2>
  <p class="details-subtitle">Usuário no Amei: ${esc(person.amei)} · meta: 480 comparecimentos</p>
  <div class="collab-stat-row">
    ${bloco('compareceram',st.compareceram,'compareceram',GLOSSARIO.compareceram)}
    ${bloco('marcadas',st.marcadas,'marcadas para este mês',GLOSSARIO.marcadas)}
    ${bloco('noMes','no mín. '+st.noMes,'marcadas durante este mês',GLOSSARIO.noMes)}
    ${bloco('confirmados',st.confirmados,'confirmados','Pacientes com status Marcado - confirmado no Amei.')}
    ${bloco('cancelados',st.cancelados,'cancelados/desmarcados','Consultas canceladas ou desmarcadas.')}
    ${bloco('faltas',st.faltas,'faltas','Pacientes que não compareceram.')}
  </div>
  <div class="collab-cut-bar">
    <span>Mostrando: <b>${esc(recorte.rotulo)}</b></span>
    ${collabCut==='todas'?'<small>Clique num bloco acima para filtrar a lista.</small>':'<button type="button" class="text-button" data-collab-cut="todas">Limpar filtro ✕</button>'}
  </div>
  <input id="collab-search" type="search" placeholder="Buscar paciente ou CPF" value="${esc(collabFilter)}">
  <p class="details-subtitle">${filtered.length} registro(s) encontrado(s)</p>
  <div class="collab-people">${filtered.length?filtered.map(r=>`<article><strong>${esc(r.name||'Nome não informado')}</strong><span>CPF ${esc(formatCpf(r.cpf))} · ${esc(fullDate(r.date))} · ${esc(r.professional||'Profissional não informado')}</span><small>${esc(estado(r))}</small></article>`).join(''):'<div class="empty">Nenhum paciente neste recorte.</div>'}</div>`;
}
function renderCollaborators(){
  const content=$('#collab-content');
  if(!collabData){content.innerHTML='<div class="empty">Consulte o Amei para mostrar os colaboradores.</div>';return;}
  const ordered=[...collaborators].sort((a,b)=>rowsFor(b.key).filter(attended).length-rowsFor(a.key).filter(attended).length||rowsFor(b.key).length-rowsFor(a.key).length);
  if(selectedCollaborator){content.innerHTML=pessoaHtml(collaborators.find(p=>p.key===selectedCollaborator));return;}
  content.innerHTML=collabTab==='ranking'?podiumHtml(ordered):teamHtml();
}
async function loadCollaborators(start=false){const month=collabMonth.value;try{if(start)await api('/api/collaborators',{method:'POST',body:JSON.stringify({month})});const job=await api('/api/collaborators?month='+encodeURIComponent(month));if(month!==collabMonth.value)return;if(job.data)collabData=job.data;renderCollaborators();$('#collab-status').textContent=job.running?'Lendo consultas e confirmando a autoria de cada agendamento no Amei. Pode levar alguns minutos...':job.error?job.error:job.data?`Leitura ${new Date(job.updatedAt).toLocaleString('pt-BR')} · ${job.data.checked} de ${job.data.listed} consultas verificadas · ${job.data.unverified} sem prova. Consultas criadas para outros meses não entram na descoberta.`:'Aguardando leitura.';if(job.running)setTimeout(()=>loadCollaborators(false),4000);}catch(e){$('#collab-status').textContent=collabData?e.message+' Mostrando a última leitura que deu certo.':e.message;}}
document.addEventListener('click',e=>{const cut=e.target.closest('[data-collab-cut]');if(cut){collabCut=cut.dataset.collabCut;renderCollaborators();return;}const p=e.target.closest('[data-collab]');if(p){selectedCollaborator=p.dataset.collab;collabFilter='';collabCut='todas';renderCollaborators();}if(e.target.closest('#collab-back')){selectedCollaborator=null;renderCollaborators();}const tab=e.target.closest('[data-collab-tab]');if(tab){collabTab=tab.dataset.collabTab;document.querySelectorAll('[data-collab-tab]').forEach(b=>b.classList.toggle('active',b===tab));selectedCollaborator=null;renderCollaborators();}if(e.target.closest('#collab-refresh'))loadCollaborators(true);});
document.addEventListener('input',e=>{if(e.target.id==='collab-search'){collabFilter=e.target.value;renderCollaborators();$('#collab-search').focus();$('#collab-search').setSelectionRange(collabFilter.length,collabFilter.length);}});
collabMonth.addEventListener('input',()=>{selectedCollaborator=null;collabData=null;loadCollaborators(true);});
const oldNavigate=navigate;navigate=function(view){oldNavigate(view);if(view==='colaboradores')loadCollaborators(true);};

// Rele o mes atual para que vagas, prioridades e agendas novas acompanhem o Amei.
// O mes seguinte tambem fica atualizado, sem depender do mes escolhido no grafico.
const automaticAttempts=new Map();
let automaticImportRunning=false, automaticImportPending=false, automaticImportChecking=false;
let automaticImportStamp=null;
async function refreshAutomaticImports(){
  if(document.visibilityState!=='visible'||automaticImportChecking)return;
  automaticImportChecking=true;
  try{
    const job=await api('/api/amei/import/status');
    const stamp=job.month+':'+(job.result?.updatedAt||'')+':'+(job.error||'');
    if(automaticImportStamp!==null&&stamp!==automaticImportStamp&&!job.running){
      await refresh();
      if(currentView==='conexoes')refreshImport();
    }
    automaticImportStamp=stamp;
    if(job.running){automaticImportRunning=true;return;}
    if(automaticImportRunning){automaticImportRunning=false;await refresh();}
    const now=new Date();
    const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'});
    const current=formatter.format(now);
    const [year,monthNumber]=current.split('-').map(Number);
    const upcoming=`${Math.floor((year*12+monthNumber)/12)}-${String((monthNumber%12)+1).padStart(2,'0')}`;
    for(const [month,interval] of [[current,10*60*1000],[upcoming,30*60*1000]]){
      const record=job.months.find(x=>x.month===month);
      const stale=!record||Date.now()-new Date(record.atualizado_em).getTime()>interval;
      if(stale&&Date.now()-(automaticAttempts.get(month)||0)>interval){
        automaticAttempts.set(month,Date.now());
        try{await api('/api/amei/import',{method:'POST',body:JSON.stringify({month})});automaticImportRunning=true;}
        catch(e){/* Outra leitura ou login pendente: tentar no próximo ciclo. */}
        break;
      }
    }
  }catch(e){/* Sem conexão: manter a última leitura e tentar novamente. */}
  finally{automaticImportChecking=false;}
}
setTimeout(refreshAutomaticImports,5000);
setInterval(refreshAutomaticImports,60*1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAutomaticImports();});
