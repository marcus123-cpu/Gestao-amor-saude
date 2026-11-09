// Hora em que o atendimento encerra: a partir dela o painel para de dizer que ainda vem gente hoje.
const FIM_DO_DIA = 19;
let latestMetrics = null;
function applyDailyMetrics() {
  const data=latestMetrics?.data;
  const today=state.dashboard.hoje;
  if (!data || !today || latestMetrics.month!==today.slice(0,7)) return;
  const current=data.daily.find(day=>day.date===today);
  if (current) {
    // Depois que o atendimento do dia encerra, ninguem mais "ainda vem hoje".
    const encerrado = new Date().getHours() >= FIM_DO_DIA;
    $('#m-confirmed').textContent = encerrado ? 0 : current.confirmed;
    $('#m-confirmed-note').textContent = encerrado
      ? `Dia encerrado · ${current.confirmed} não compareceram até agora`
      : 'Clique para ver quem é e ligar';
  }
  const next=new Date(today+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);
  const tomorrow=data.daily.find(day=>day.date===next.toISOString().slice(0,10));
  if (tomorrow) $('#m-tomorrow-note').textContent=`${tomorrow.confirmed} confirmados · ${tomorrow.expected-tomorrow.confirmed} aguardam`;
}
const baseRender = render;
render = function() {
  baseRender();
  const upcoming = state.agendas.filter(r => r.data > state.dashboard.hoje && ['prevista','aberta'].includes(r.situacao)).slice(0,6);
  [...$('#upcoming-list').querySelectorAll('.upcoming-card')].forEach((card, index) => {
    const row = upcoming[index];
    if (!row) return;
    card.dataset.openAgenda = String(row.id);
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Ver agenda de ${row.profissional} em ${dateLabel(row.data)}`);
  });
  const month = $('#chart-month').value;
  if (month) $('#insight-agendas').textContent = state.agendas.filter(r => r.data.startsWith(month) && r.situacao==='aberta').length;
  applyDailyMetrics();
};
document.addEventListener('keydown', e => {
  if ((e.key==='Enter' || e.key===' ') && e.target.matches('.upcoming-card[data-open-agenda]')) {
    e.preventDefault(); openAgenda(e.target.dataset.openAgenda);
  }
});

const chartMonth = $('#chart-month');
chartMonth.value = new Date().toLocaleDateString('en-CA').slice(0,7);
const autoAttempted = new Map();
let metricsPoll = null;
let activeMetricsMonth = chartMonth.value;

// O mes e lido tres vezes; a tela diz se as tres bateram.
const NOME_TOTAL = {attended:'já atendidos', expected:'previstos para vir', confirmed:'previstos confirmados'};
function renderConferencia(c) {
  const badge = $('#insight-check'), note = $('#insight-check-note');
  if (!badge) return;
  if (!c) { badge.textContent='—'; badge.className=''; note.textContent=''; return; }
  if (c.conferido) {
    badge.textContent = `${c.leituras}× igual`;
    badge.className = 'check-ok';
    note.textContent = `O mês foi lido ${c.leituras} vezes seguidas e os três totais bateram em todas. Números fechados.`;
    return;
  }
  const quais = c.mudou.map(k => NOME_TOTAL[k] || k).join(' e ');
  badge.textContent = 'mudou no meio';
  badge.className = 'check-warn';
  note.textContent = `Entre as ${c.leituras} leituras, ${quais} mudou — provavelmente alguém foi atendido ou remarcado durante a conferência. O painel mostra a leitura mais recente: ${c.valores.map(v=>v.attended).join(' → ')} atendidos.`;
}

function renderMetrics(snapshot) {
  latestMetrics = snapshot;
  const data = snapshot.data;
  if (!data) {
    ['attended','expected','confirmed'].forEach(key => $('#insight-'+key).textContent = '—');
    $('#patient-chart').innerHTML = '<div class="empty">Os dados deste mês ainda não foram consultados.</div>';
    $('#confirmation-percent').textContent = '—';
    for (const key of ['graphTipTitle','graphTipValue','graphTipDetail']) delete $('#confirmation-ring').dataset[key];
    renderConferencia(null);
    return;
  }
  for (const key of ['attended','expected','confirmed']) {
    $('#insight-'+key).textContent = data.appointments[key].toLocaleString('pt-BR');
    $('#insight-'+key+'-note').textContent = `${data.patients[key].toLocaleString('pt-BR')} pessoas diferentes`;
  }
  const percentage = data.appointments.expected ? Math.round(data.appointments.confirmed/data.appointments.expected*100) : 0;
  $('#confirmation-percent').textContent = data.appointments.expected ? percentage+'%' : '—';
  $('#confirmation-ring').dataset.graphTipTitle = 'Pacientes previstos confirmados';
  $('#confirmation-ring').dataset.graphTipValue = data.appointments.expected ? `${percentage}%` : 'Sem pacientes previstos';
  $('#confirmation-ring').dataset.graphTipDetail = `${data.appointments.confirmed.toLocaleString('pt-BR')} confirmados de ${data.appointments.expected.toLocaleString('pt-BR')} previstos`;
  $('#confirmation-ring').style.background = `conic-gradient(#ed9d39 ${percentage}%, ${document.documentElement.dataset.theme==='dark'?'#414344':'#ececea'} ${percentage}%)`;
  $('#insight-read-at').textContent = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  $('#insight-agendas').textContent = state.agendas.filter(r => r.data.startsWith(snapshot.month) && r.situacao==='aberta').length;
  renderConferencia(data.conferencia);
  drawChart(data.daily);
  applyDailyMetrics();
}

function drawChart(daily) {
  if (!daily.length) { $('#patient-chart').innerHTML = '<div class="empty">Sem agendas neste mês.</div>'; return; }
  const width=760, height=226, left=36, right=10, top=12, bottom=28;
  const plotW=width-left-right, plotH=height-top-bottom, n=daily.length;
  const today=state.dashboard.hoje;
  let attendedTotal=0;
  const actual=daily.map(day => { attendedTotal+=day.attended; return day.date<=today ? attendedTotal : null; });
  let projected=0;
  const forecast=daily.map((day,i) => {
    if (day.date<today) return null;
    if (day.date===today) projected=actual[i]||0;
    projected+=day.expected;
    return projected;
  });
  const max=Math.max(1,...actual.filter(v=>v!=null),...forecast.filter(v=>v!=null));
  const x=i=>left+(n===1?plotW/2:i*plotW/(n-1));
  const y=v=>top+plotH-(v/max)*plotH;
  const path=points=>points.length?'M'+points.map(([i,v])=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L'):'';
  const actualPoints=actual.flatMap((v,i)=>v==null?[]:[[i,v]]);
  const forecastPoints=forecast.flatMap((v,i)=>v==null?[]:[[i,v]]);
  const actualPath=path(actualPoints), forecastPath=path(forecastPoints);
  const actualArea=actualPoints.length?`${actualPath} L${x(actualPoints.at(-1)[0])},${y(0)} L${x(actualPoints[0][0])},${y(0)} Z`:'';
  const ticks=[0,.25,.5,.75,1].map(r=>`<line class="chart-grid-line" x1="${left}" x2="${width-right}" y1="${y(max*r)}" y2="${y(max*r)}"/><text class="chart-axis-label" x="${left-8}" y="${y(max*r)+4}" text-anchor="end">${Math.round(max*r)}</text>`).join('');
  const labels=[0,4,9,14,19,24,n-1].filter((v,i,a)=>v<n&&a.indexOf(v)===i).map(i=>`<text class="chart-axis-label" x="${x(i)}" y="${height-4}" text-anchor="middle">${i+1}</text>`).join('');
  const hits=daily.map((day,i)=>`<rect class="chart-hit" data-chart-day="${i}" x="${x(i)-plotW/n/2}" y="${top}" width="${plotW/n+2}" height="${plotH}" tabindex="0" role="button" aria-label="${i+1} de ${chartMonth.value}: ${day.attended} atendidos, ${day.expected} previstos, ${day.confirmed} confirmados"/>`).join('');
  $('#patient-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução de atendimentos e previsão no mês"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ed9d39" stop-opacity=".43"/><stop offset="100%" stop-color="#ed9d39" stop-opacity=".02"/></linearGradient></defs>${ticks}${labels}${actualArea?`<path d="${actualArea}" fill="url(#chart-fill)"/>`:''}${actualPath?`<path class="chart-actual" d="${actualPath}"/>`:''}${forecastPath?`<path class="chart-projected" d="${forecastPath}"/>`:''}<line class="chart-hover-line" id="chart-hover-line" y1="${top}" y2="${top+plotH}" visibility="hidden"/><circle class="chart-point" id="chart-hover-point" r="5" visibility="hidden"/>${hits}</svg>`;
  const tooltip=$('#chart-tooltip');
  const show=(index,event) => {
    const day=daily[index];
    const value=actual[index]??forecast[index]??0;
    const px=x(index), py=y(value);
    $('#chart-hover-line').setAttribute('x1',px);$('#chart-hover-line').setAttribute('x2',px);$('#chart-hover-line').setAttribute('visibility','visible');
    $('#chart-hover-point').setAttribute('cx',px);$('#chart-hover-point').setAttribute('cy',py);$('#chart-hover-point').setAttribute('visibility','visible');
    tooltip.innerHTML=`<strong>${dateLabel(day.date)}</strong><span>${day.attended} atendido(s)</span><span>${day.expected} previsto(s)</span><span>${day.confirmed} confirmado(s)</span>`;
    tooltip.hidden=false;
    const hit=event?.currentTarget?.getBoundingClientRect();
    const cx=event?.type==='focus' ? (hit?.left||0)+(hit?.width||0)/2 : event?.clientX;
    const cy=event?.type==='focus' ? (hit?.top||0)+(hit?.height||0)/2 : event?.clientY;
    const box=tooltip.getBoundingClientRect(), gap=14;
    tooltip.style.left=Math.max(8,Math.min(innerWidth-box.width-8,cx+gap+box.width>innerWidth-8?cx-box.width-gap:cx+gap))+'px';
    tooltip.style.top=Math.max(8,Math.min(innerHeight-box.height-8,cy+gap+box.height>innerHeight-8?cy-box.height-gap:cy+gap))+'px';
  };
  $('#patient-chart').querySelectorAll('[data-chart-day]').forEach(hit=>{
    const index=Number(hit.dataset.chartDay);
    hit.addEventListener('mouseenter',e=>show(index,e));
    hit.addEventListener('mousemove',e=>show(index,e));
    hit.addEventListener('focus',e=>show(index,e));
    hit.addEventListener('mouseleave',()=>{tooltip.hidden=true;$('#chart-hover-line').setAttribute('visibility','hidden');$('#chart-hover-point').setAttribute('visibility','hidden');});
    hit.addEventListener('blur',()=>{tooltip.hidden=true;$('#chart-hover-line').setAttribute('visibility','hidden');$('#chart-hover-point').setAttribute('visibility','hidden');});
  });
}

async function loadMetrics(auto=true) {
  const month=chartMonth.value;
  activeMetricsMonth=month;
  clearTimeout(metricsPoll);
  try {
    const snapshot=await api('/api/amei/metrics?month='+encodeURIComponent(month));
    if (month!==activeMetricsMonth) return;
    renderMetrics(snapshot);
    const job=snapshot.job;
    $('#chart-refresh').disabled=job.running;
    if (job.running) {
      $('#chart-status').textContent=job.phase==='agendas'?'Atualizando agendas do mês no Amei...':'Contando atendimentos e confirmações no Amei...';
      metricsPoll=setTimeout(()=>loadMetrics(false),2500);
    } else if (job.error) {
      $('#chart-status').textContent=job.error+' Os números anteriores permanecem visíveis.';
    } else {
      $('#chart-status').textContent=snapshot.updatedAt?`Atualizado em ${new Date(snapshot.updatedAt).toLocaleString('pt-BR')} · ${snapshot.data?.professionals??0} profissionais consultados`:'Aguardando a primeira leitura do Amei.';
      const stale=!snapshot.updatedAt || Date.now()-new Date(snapshot.updatedAt).getTime()>30*60*1000;
      if (auto && stale && Date.now()-(autoAttempted.get(month)||0)>30*60*1000) {autoAttempted.set(month,Date.now());await startMetrics();}
    }
  } catch(e) {$('#chart-status').textContent=e.message;$('#chart-refresh').disabled=false;}
}
async function startMetrics() {
  const month=chartMonth.value;
  try {
    $('#chart-refresh').disabled=true;
    await api('/api/amei/metrics',{method:'POST',body:JSON.stringify({month})});
    $('#chart-status').textContent='Iniciando leitura do Amei...';
    metricsPoll=setTimeout(()=>loadMetrics(false),1500);
  } catch(e) {$('#chart-status').textContent=e.message;$('#chart-refresh').disabled=false;}
}
chartMonth.addEventListener('input',()=>loadMetrics(true));
$('#chart-refresh').addEventListener('click',startMetrics);
themeToggle.addEventListener('click',()=>{const snapshot=$('#confirmation-percent').textContent;const pct=Number.parseInt(snapshot);if(Number.isFinite(pct))$('#confirmation-ring').style.background=`conic-gradient(#00aec3 ${pct}%, ${document.documentElement.dataset.theme==='dark'?'#414344':'#ececea'} ${pct}%)`;});
(async () => { if (!state.dashboard.hoje) await refresh(); await loadMetrics(true); })();
setInterval(async()=>{if(document.visibilityState!=='visible')return;await refresh();await loadMetrics(true);},5*60*1000);

// Lista de pacientes confirmados do dia: a Jessica precisa do nome e do CPF para ligar.
let patientsRequest = 0;
async function showTodayPatients() {
  const dia = state.dashboard.hoje;
  const id = ++patientsRequest;
  $('#patients-title').textContent = 'Confirmados para ' + fullDate(dia);
  $('#patients-body').innerHTML = '<div class="details-loading">Lendo os pacientes confirmados no Amei...</div>';
  $('#patients-dialog').showModal();
  try {
    const data = await api('/api/amei/dia?tipo=confirmados&date=' + encodeURIComponent(dia));
    if (id !== patientsRequest || !$('#patients-dialog').open) return;
    const linhas = data.rows.map(p => `<article>
      <strong>${esc(p.name || 'Nome não informado')}</strong>
      <span>CPF ${esc(formatCpf(p.cpf))}${p.phone ? ' · ' + esc(formatPhone(p.phone)) : ''} · ${esc(p.professional || 'Profissional não informado')}</span>
      <small>${p.time ? esc(p.time) + ' · ' : ''}${esc(p.status)}</small></article>`).join('');
    $('#patients-body').innerHTML = `<p class="details-subtitle">${data.rows.length} paciente(s) confirmado(s) · ${data.checked} consulta(s) do dia conferidas${data.unverified ? ' · ' + data.unverified + ' sem conferência' : ''}</p>
      <div class="collab-people">${linhas || '<div class="empty">Nenhum paciente confirmado para hoje.</div>'}</div>
      <p class="details-note">Leitura feita agora no Amei. Os nomes e CPFs não ficam salvos no painel.</p>`;
  } catch (e) {
    if (id === patientsRequest && $('#patients-dialog').open) $('#patients-body').innerHTML = `<p class="details-loading">${esc(e.message)}</p>`;
  }
}
$('#confirmed-card').addEventListener('click', showTodayPatients);
$('#confirmed-card').addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); showTodayPatients(); } });
$('#close-patients').addEventListener('click', () => { ++patientsRequest; $('#patients-dialog').close(); });
