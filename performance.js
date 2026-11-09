// Comparação mensal da clínica. Os resumos vêm do Amei e não incluem nomes de pacientes.
const perfJobs = new Map();
const perfTimers = new Map();
const perfToday = () => state.dashboard?.hoje || new Date().toLocaleDateString('en-CA');
let perfMonthB = perfToday().slice(0, 7);
let perfMonthA = (() => { const d = new Date(perfMonthB + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const perfLabel = month => new Intl.DateTimeFormat('pt-BR', {month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
const perfNumber = n => new Intl.NumberFormat('pt-BR').format(n || 0);
const perfSigned = n => `${n > 0 ? '+' : ''}${perfNumber(n)}`;
const perfPct = (n, d) => d ? Math.round(n / d * 100) : 0;

// Uma dica única segue o cursor em todas as visualizações de desempenho.
const graphCursorTip = document.createElement('div');
graphCursorTip.className = 'graph-cursor-tip';
graphCursorTip.hidden = true;
document.body.append(graphCursorTip);
function showGraphTip(target, x, y) {
  const source = target.closest?.('[data-graph-tip-title]');
  if (!source) { graphCursorTip.hidden = true; return; }
  graphCursorTip.innerHTML = `<strong>${esc(source.dataset.graphTipTitle)}</strong><b>${esc(source.dataset.graphTipValue || '')}</b>${source.dataset.graphTipDetail ? `<span>${esc(source.dataset.graphTipDetail)}</span>` : ''}`;
  graphCursorTip.hidden = false;
  const box = graphCursorTip.getBoundingClientRect(), gap = 14;
  const left = x + gap + box.width > innerWidth - 8 ? x - box.width - gap : x + gap;
  const top = y + gap + box.height > innerHeight - 8 ? y - box.height - gap : y + gap;
  graphCursorTip.style.left = Math.max(8, left) + 'px';
  graphCursorTip.style.top = Math.max(8, top) + 'px';
}
document.addEventListener('pointerover', e => {
  if (e.target.closest?.('[data-graph-tip-title]')) showGraphTip(e.target, e.clientX, e.clientY);
});
document.addEventListener('pointermove', e => {
  if (e.target.closest?.('[data-graph-tip-title]')) showGraphTip(e.target, e.clientX, e.clientY);
});
document.addEventListener('pointerout', e => {
  if (!e.relatedTarget?.closest?.('[data-graph-tip-title]')) graphCursorTip.hidden = true;
});
document.addEventListener('focusin', e => {
  const source = e.target.closest?.('[data-graph-tip-title]');
  if (source) { const box = source.getBoundingClientRect(); showGraphTip(source, box.left + box.width/2, box.top + box.height/2); }
});
document.addEventListener('focusout', e => {
  if (e.target.closest?.('[data-graph-tip-title]')) graphCursorTip.hidden = true;
});

function perfMetric(data, cutoff) {
  const sum = (daily, key) => Object.entries(daily || {}).filter(([day]) => !cutoff || Number(day.slice(8, 10)) <= cutoff)
    .reduce((total, [, value]) => total + (Number(value[key]) || 0), 0);
  const clinic = data.clinic || {}, schedules = data.schedules || {};
  const scheduleDays = Object.entries(schedules.daily || {}).filter(([day]) => !cutoff || Number(day.slice(8,10)) <= cutoff);
  const professionals = new Set(scheduleDays.flatMap(([,value]) => value.professionals || []));
  const team = Object.fromEntries(Object.entries(data.team || {}).map(([key, member]) => [key, {
    name:member.name, marked:sum(member.daily,'marked'), attended:sum(member.daily,'attended'),
    absent:sum(member.daily,'absent'), cancelled:sum(member.daily,'cancelled')
  }]));
  const doctors = Object.fromEntries(Object.entries(clinic.byProfessional || {}).map(([key, doctor]) => [key, {
    name:doctor.name, absent:sum(doctor.daily,'absent'), cancelled:sum(doctor.daily,'cancelled')
  }]));
  return {attended:sum(clinic.daily,'attended'), absent:sum(clinic.daily,'absent'),
    cancelled:sum(clinic.daily,'cancelled'), agendas:sum(schedules.daily,'agendas'),
    slots:sum(schedules.daily,'slots'), days:scheduleDays.length, professionals:professionals.size, team, doctors};
}

function perfBar(label, a, b, unit='') {
  const max = Math.max(a, b, 1), width = value => Math.max(value ? 3 : 0, Math.round(value / max * 100));
  return `<div class="perf-row"><div class="perf-row-head"><strong>${esc(label)}</strong><span>${esc(perfSigned(b-a))}${unit} · ${esc(perfLabel(perfMonthA))} → ${esc(perfLabel(perfMonthB))}</span></div>
    <div class="perf-track" data-graph-tip-title="${esc(label)} · ${esc(perfLabel(perfMonthA))}" data-graph-tip-value="${esc(perfNumber(a))}${unit}" data-graph-tip-detail="Primeiro mês"><span class="perf-a" style="width:${width(a)}%"></span><b>${esc(perfNumber(a))}${unit}</b></div>
    <div class="perf-track" data-graph-tip-title="${esc(label)} · ${esc(perfLabel(perfMonthB))}" data-graph-tip-value="${esc(perfNumber(b))}${unit}" data-graph-tip-detail="Segundo mês"><span class="perf-b" style="width:${width(b)}%"></span><b>${esc(perfNumber(b))}${unit}</b></div></div>`;
}

function perfDailyChart(first, second, cutoff) {
  const daysA = new Date(Number(perfMonthA.slice(0,4)), Number(perfMonthA.slice(5,7)), 0).getDate();
  const daysB = new Date(Number(perfMonthB.slice(0,4)), Number(perfMonthB.slice(5,7)), 0).getDate();
  const days = cutoff ? Math.min(cutoff, daysA, daysB) : Math.min(daysA, daysB);
  const daily = (data, month) => Array.from({length:days}, (_,i) => Number(data.clinic?.daily?.[`${month}-${String(i+1).padStart(2,'0')}`]?.attended || 0));
  const a = daily(first, perfMonthA), b = daily(second, perfMonthB);
  if (days <= 3) {
    const max = Math.max(1,...a,...b);
    return `<section class="perf-chart-card" aria-labelledby="perf-chart-title"><div class="perf-chart-head"><div><span class="eyebrow">ATENDIMENTOS POR DIA</span><h3 id="perf-chart-title">Compare os dias lado a lado</h3><p>As barras mostram os pacientes atendidos em cada mês.</p></div><div class="perf-chart-legend"><span><i class="perf-key-a"></i>${esc(perfLabel(perfMonthA))}</span><span><i class="perf-key-b"></i>${esc(perfLabel(perfMonthB))}</span></div></div><div class="perf-short-days">${a.map((value,i)=>`<div class="perf-short-day"><strong>Dia ${i+1}</strong><div data-graph-tip-title="Dia ${i+1} · ${esc(perfLabel(perfMonthA))}" data-graph-tip-value="${perfNumber(value)} atendimentos"><span>${esc(perfLabel(perfMonthA))}</span><i><b class="perf-a" style="width:${Math.round(value/max*100)}%"></b></i><strong>${perfNumber(value)}</strong></div><div data-graph-tip-title="Dia ${i+1} · ${esc(perfLabel(perfMonthB))}" data-graph-tip-value="${perfNumber(b[i])} atendimentos"><span>${esc(perfLabel(perfMonthB))}</span><i><b class="perf-b" style="width:${Math.round(b[i]/max*100)}%"></b></i><strong>${perfNumber(b[i])}</strong></div></div>`).join('')}</div></section>`;
  }
  const max = Math.max(1,...a,...b), left=46, right=752, top=30, bottom=205;
  const x = i => days===1 ? (left+right)/2 : left+(right-left)*i/(days-1);
  const y = value => bottom-(value/max)*(bottom-top);
  const path = values => values.map((value,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
  const ticks = [...new Set([0,Math.round((days-1)/4),Math.round((days-1)/2),Math.round((days-1)*3/4),days-1])];
  const grid = [0,.25,.5,.75,1].map(r=>{
    const yy=bottom-r*(bottom-top);
    return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" class="perf-grid-line"/><text x="${left-10}" y="${yy+4}" text-anchor="end" class="perf-axis-label">${Math.round(max*r)}</text>`;
  }).join('');
  const points = (values, cls) => values.map((value,i)=>`<circle cx="${x(i)}" cy="${y(value)}" r="${days===1?7:3.5}" class="perf-point ${cls}"/>`).join('');
  const hits = Array.from({length:days}, (_,i)=>`<rect x="${days===1?x(i)-22:x(i)-(right-left)/(days-1)/2}" y="${top}" width="${days===1?44:(right-left)/(days-1)}" height="${bottom-top}" class="perf-day-hit" data-perf-day="${i+1}" data-graph-tip-title="Dia ${i+1}" data-graph-tip-value="${esc(perfLabel(perfMonthA))}: ${perfNumber(a[i])} atendimentos" data-graph-tip-detail="${esc(perfLabel(perfMonthB))}: ${perfNumber(b[i])} atendimentos" tabindex="0" role="button" aria-label="Dia ${i+1}: ${esc(perfLabel(perfMonthA))} ${a[i]} atendimentos; ${esc(perfLabel(perfMonthB))} ${b[i]} atendimentos"/>`).join('');
  return `<section class="perf-chart-card" aria-labelledby="perf-chart-title"><div class="perf-chart-head"><div><span class="eyebrow">ATENDIMENTOS POR DIA</span><h3 id="perf-chart-title">Quando a clínica recebeu mais pacientes?</h3><p>Compare a altura das linhas. Passe o mouse ou toque num dia para ver o número exato.${daysA!==daysB&&!cutoff?` O gráfico vai até o dia ${days}, presente nos dois meses.`:''}</p></div><div class="perf-chart-legend"><span><i class="perf-key-a"></i>${esc(perfLabel(perfMonthA))}</span><span><i class="perf-key-b"></i>${esc(perfLabel(perfMonthB))}</span></div></div>
    <div class="perf-svg-wrap"><svg class="perf-svg" viewBox="0 0 800 240" role="img" aria-label="Atendimentos por dia em ${esc(perfLabel(perfMonthA))} e ${esc(perfLabel(perfMonthB))}">${grid}<path d="${path(a)}" class="perf-line-a"/><path d="${path(b)}" class="perf-line-b"/>${points(a,'perf-point-a')}${points(b,'perf-point-b')}${ticks.map(i=>`<text x="${x(i)}" y="230" text-anchor="middle" class="perf-axis-label">dia ${i+1}</text>`).join('')}${hits}</svg></div></section>`;
}

function perfOutcomeCard(title, icon, a, b, worseWhenHigher, cutoff) {
  const max=Math.max(a,b,1), width=n=>Math.round(n/max*100);
  const difference=b-a, worse=worseWhenHigher?difference>0:difference<0, better=worseWhenHigher?difference<0:difference>0;
  const early=cutoff && cutoff<4;
  const state=early?(difference>0?'Acima':difference<0?'Abaixo':'Igual'):worse?'Piorou':better?'Melhorou':'Estável';
  return `<article class="perf-outcome ${early?'is-steady':worse?'is-worse':better?'is-better':'is-steady'}"><div class="perf-outcome-top"><span class="perf-outcome-icon">${icon}</span><span class="perf-outcome-state">${state}</span></div><h3>${esc(title)}</h3><strong class="perf-outcome-main">${perfNumber(b)} <small>${esc(perfSigned(difference))} em relação ao primeiro mês</small></strong><div class="perf-outcome-bars"><div data-graph-tip-title="${esc(title)} · ${esc(perfLabel(perfMonthA))}" data-graph-tip-value="${perfNumber(a)}"><span>${esc(perfLabel(perfMonthA))}</span><i><b class="perf-a" style="width:${width(a)}%"></b></i><strong>${perfNumber(a)}</strong></div><div data-graph-tip-title="${esc(title)} · ${esc(perfLabel(perfMonthB))}" data-graph-tip-value="${perfNumber(b)}"><span>${esc(perfLabel(perfMonthB))}</span><i><b class="perf-b" style="width:${width(b)}%"></b></i><strong>${perfNumber(b)}</strong></div></div></article>`;
}

function perfInsights(a, b, cutoff) {
  if (cutoff && cutoff < 4) return `<div class="perf-insights"><h3>Leitura deste recorte</h3><p>Há só ${cutoff} dia(s) do mês atual na comparação. As barras mostram os números, mas ainda é cedo para concluir por que a meta subiu ou caiu.</p><small>Continue acompanhando conforme os atendimentos do mês forem concluídos.</small></div>`;
  const notes = [];
  const diff = b.attended - a.attended;
  if (diff < 0) notes.push(`Foram ${perfNumber(-diff)} atendimentos a menos no segundo mês${cutoff ? ` até o dia ${cutoff}` : ''}.`);
  else if (diff > 0) notes.push(`Foram ${perfNumber(diff)} atendimentos a mais no segundo mês${cutoff ? ` até o dia ${cutoff}` : ''}.`);
  else notes.push('Os dois períodos tiveram o mesmo número de atendimentos.');
  if (b.agendas < a.agendas || b.slots < a.slots)
    notes.push(`A oferta também caiu: ${perfNumber(a.agendas)} → ${perfNumber(b.agendas)} agendas e ${perfNumber(a.slots)} → ${perfNumber(b.slots)} horários.`);
  if (b.absent > a.absent) notes.push(`As faltas subiram ${perfNumber(b.absent-a.absent)} registros; vale acompanhar confirmações e lembretes.`);
  if (b.cancelled > a.cancelled) notes.push(`Houve ${perfNumber(b.cancelled-a.cancelled)} cancelamentos/desmarcações a mais; confira as agendas afetadas.`);
  const teamDrop = Object.keys(a.team).map(key => ({name:b.team[key]?.name || a.team[key].name,
    change:(b.team[key]?.attended || 0)-(a.team[key]?.attended || 0)})).filter(x => x.change < 0).sort((x,y) => x.change-y.change);
  if (teamDrop.length) notes.push(`Entre os colaboradores acompanhados, ${teamDrop.map(x=>`${x.name}: ${perfSigned(x.change)}`).join(' · ')} comparecimentos vinculados às suas marcações.`);
  if (notes.length === 1) notes.push('Oferta, faltas e cancelamentos não apontaram uma diferença relevante neste recorte.');
  return `<div class="perf-insights"><h3>O que os números mostram</h3>${notes.map(n=>`<p>${esc(n)}</p>`).join('')}<small>Essas diferenças ajudam a investigar o resultado; não provam a causa de uma queda.</small></div>`;
}

function perfDoctorRows(a, b, kind) {
  const keys = new Set([...Object.keys(a.doctors), ...Object.keys(b.doctors)]);
  return [...keys].map(key => ({name:b.doctors[key]?.name || a.doctors[key]?.name || 'Profissional',
    before:a.doctors[key]?.[kind] || 0, after:b.doctors[key]?.[kind] || 0}))
    .filter(x => x.before || x.after).sort((x,y) => y.after-x.after || y.before-x.before).slice(0, 6);
}

function perfComparison(first, second) {
  const current = perfToday().slice(0, 7);
  const cutoff = (perfMonthA === current || perfMonthB === current) ? Number(perfToday().slice(8,10)) : null;
  const a = perfMetric(first, cutoff), b = perfMetric(second, cutoff);
  const rows = [
    ['Pacientes atendidos', a.attended, b.attended],
    ['Faltas', a.absent, b.absent],
    ['Cancelados ou desmarcados', a.cancelled, b.cancelled],
    ['Agendas abertas no Amei', a.agendas, b.agendas],
    ['Horários ofertados', a.slots, b.slots],
    ['Dias com agenda', a.days, b.days],
    ['Profissionais com agenda', a.professionals, b.professionals]
  ];
  const rates = [
    ['Taxa de faltas entre atendidos e ausentes', perfPct(a.absent,a.attended+a.absent), perfPct(b.absent,b.attended+b.absent)],
    ['Taxa de cancelamentos entre desfechos', perfPct(a.cancelled,a.attended+a.absent+a.cancelled), perfPct(b.cancelled,b.attended+b.absent+b.cancelled)]
  ];
  const people = Object.keys(a.team).map(key => ({name:b.team[key]?.name || a.team[key].name,
    before:a.team[key], after:b.team[key]}));
  const doctorTable = (kind, title) => {
    const items = perfDoctorRows(a,b,kind);
    return `<section class="perf-card"><h3>${esc(title)}</h3>${items.length ? `<table class="perf-table"><thead><tr><th>PROFISSIONAL</th><th>${esc(perfLabel(perfMonthA))}</th><th>${esc(perfLabel(perfMonthB))}</th><th>VARIAÇÃO</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.before}</td><td>${x.after}</td><td>${esc(perfSigned(x.after-x.before))}</td></tr>`).join('')}</tbody></table>` : '<p>Nenhum registro neste recorte.</p>'}</section>`;
  };
  return `<div class="perf-result">
    ${cutoff ? `<div class="perf-caution">Comparação até o dia ${cutoff} em ambos os meses, porque um dos meses ainda está em andamento. Os números do mês atual podem mudar.</div>` : ''}
    ${perfDailyChart(first, second, cutoff)}
    <div class="perf-outcomes">${perfOutcomeCard('Pacientes atendidos','✓',a.attended,b.attended,false,cutoff)}${perfOutcomeCard('Faltas','!',a.absent,b.absent,true,cutoff)}${perfOutcomeCard('Cancelamentos','×',a.cancelled,b.cancelled,true,cutoff)}</div>
    <div class="perf-columns"><section class="perf-card"><h3>Movimento da clínica</h3><div class="perf-bars">${rows.map(([name,x,y])=>perfBar(name,x,y)).join('')}${rates.map(([name,x,y])=>perfBar(name,x,y,'%')).join('')}</div></section>
    ${perfInsights(a,b,cutoff)}</div>
    <section class="perf-card"><h3>Equipe e meta de 480 comparecimentos por pessoa</h3><div class="perf-team">${people.map(p=>`<article><h4>${esc(p.name)}</h4><div class="perf-person-bars"><span data-graph-tip-title="${esc(p.name)} · ${esc(perfLabel(perfMonthA))}" data-graph-tip-value="${perfNumber(p.before.attended)} comparecimentos"><i class="perf-a" style="width:${Math.round(p.before.attended/Math.max(p.before.attended,p.after.attended,1)*100)}%"></i><b>${perfNumber(p.before.attended)}</b></span><span data-graph-tip-title="${esc(p.name)} · ${esc(perfLabel(perfMonthB))}" data-graph-tip-value="${perfNumber(p.after.attended)} comparecimentos"><i class="perf-b" style="width:${Math.round(p.after.attended/Math.max(p.before.attended,p.after.attended,1)*100)}%"></i><b>${perfNumber(p.after.attended)}</b></span></div><div><span>${esc(perfLabel(perfMonthA))}</span><b>${perfNumber(p.before.attended)} / 480</b><small>${perfNumber(p.before.marked)} marcados · ${perfNumber(p.before.absent)} faltas</small></div><div><span>${esc(perfLabel(perfMonthB))}</span><b>${perfNumber(p.after.attended)} / 480</b><small>${perfNumber(p.after.marked)} marcados · ${perfNumber(p.after.absent)} faltas</small></div><strong class="${p.after.attended < p.before.attended && (!cutoff || cutoff>=4) ? 'perf-down' : ''}">${esc(perfSigned(p.after.attended-p.before.attended))} comparecimentos</strong></article>`).join('')}</div><p class="perf-note">A equipe mostra consultas vinculadas aos usuários acompanhados no Amei; não representa sozinha todos os agendamentos da clínica.</p></section>
    <div class="perf-columns">${doctorTable('cancelled','Cancelamentos nas agendas dos médicos')}${doctorTable('absent','Faltas por agenda médica')}</div>
    <p class="perf-note">Cancelamento na agenda de um médico não identifica quem desmarcou. Leituras verificadas: ${perfNumber(first.coverage.checked)}/${perfNumber(first.coverage.listed)} em ${esc(perfLabel(perfMonthA))} e ${perfNumber(second.coverage.checked)}/${perfNumber(second.coverage.listed)} em ${esc(perfLabel(perfMonthB))}. Sem verificação: ${perfNumber(first.coverage.unverified)} e ${perfNumber(second.coverage.unverified)}. Avisos na leitura das agendas: ${perfNumber(first.schedules.warnings)} e ${perfNumber(second.schedules.warnings)}.</p>
  </div>`;
}

function renderPerformance() {
  const content = $('#collab-content');
  const status = month => {
    const job = perfJobs.get(month);
    return job?.running ? (job.phase || 'Lendo o Amei...') : job?.error ? job.error : job?.data ? `Leitura ${new Date(job.data.updatedAt).toLocaleString('pt-BR')}` : 'Aguardando leitura';
  };
  content.innerHTML = `<div class="perf-picker"><div><span class="eyebrow">COMPARAR MESES</span><h2>Desempenho da clínica</h2><p>Veja comparecimentos, faltas, cancelamentos, equipe e oferta de agendas.</p></div><label>Primeiro mês<input id="perf-month-a" type="month" max="${esc(perfToday().slice(0,7))}" value="${esc(perfMonthA)}"></label><label>Segundo mês<input id="perf-month-b" type="month" max="${esc(perfToday().slice(0,7))}" value="${esc(perfMonthB)}"></label><button type="button" class="secondary" id="perf-retry">↻ Atualizar</button></div>
    <div class="perf-read-status"><span>${esc(perfLabel(perfMonthA))}: ${esc(status(perfMonthA))}</span><span>${esc(perfLabel(perfMonthB))}: ${esc(status(perfMonthB))}</span></div>
    ${perfJobs.get(perfMonthA)?.data && perfJobs.get(perfMonthB)?.data ? perfComparison(perfJobs.get(perfMonthA).data, perfJobs.get(perfMonthB).data) : '<div class="empty">A comparação aparece quando as leituras dos dois meses terminarem. A primeira busca pode levar alguns minutos.</div>'}`;
  $('#collab-status').hidden = true;
  collabMonth.hidden = true;
}

const priorPerfRender = renderCollaborators;
renderCollaborators = function() {
  if (collabTab === 'desempenho') return renderPerformance();
  $('#collab-status').hidden = false;
  collabMonth.hidden = false;
  priorPerfRender();
};

async function loadPerformanceMonth(month) {
  clearTimeout(perfTimers.get(month));
  try {
    const job = await api('/api/desempenho', {method:'POST', body:JSON.stringify({month})});
    perfJobs.set(month, job); if (collabTab === 'desempenho') renderPerformance();
    if (job.running) pollPerformanceMonth(month);
  } catch (error) {
    perfJobs.set(month, {running:false, error:error.message, data:null});
    if (collabTab === 'desempenho') renderPerformance();
  }
}
async function pollPerformanceMonth(month) {
  clearTimeout(perfTimers.get(month));
  perfTimers.set(month, setTimeout(async () => {
    try {
      const job = await api('/api/desempenho?month=' + encodeURIComponent(month));
      perfJobs.set(month, job);
      if (collabTab === 'desempenho') renderPerformance();
      if (job.running) pollPerformanceMonth(month);
    } catch (error) {
      perfJobs.set(month, {running:false, error:error.message, data:null});
      if (collabTab === 'desempenho') renderPerformance();
    }
  }, 4000));
}
function loadPerformance() { for (const month of new Set([perfMonthA, perfMonthB])) loadPerformanceMonth(month); }
document.addEventListener('click', e => {
  if (e.target.closest('[data-collab-tab="desempenho"]')) loadPerformance();
  if (e.target.closest('#perf-retry')) loadPerformance();
});
document.addEventListener('change', e => {
  if (e.target.id === 'perf-month-a' || e.target.id === 'perf-month-b') {
    if (e.target.id === 'perf-month-a') perfMonthA = e.target.value;
    else perfMonthB = e.target.value;
    renderPerformance();
    if (e.target.value) loadPerformanceMonth(e.target.value);
  }
});
