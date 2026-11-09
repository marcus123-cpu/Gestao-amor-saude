// Connected Amei view and read-only imported agendas.
const originalNavigate = navigate;
navigate = function(view) {
  if (view !== 'conexoes') return originalNavigate(view);
  currentView = view;
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== 'conexoes-view');
  document.querySelectorAll('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#breadcrumb').textContent = 'INTEGRAÇÕES';
  $('#page-title').textContent = 'Conexões';
  $('#page-subtitle').textContent = 'Acompanhe as agendas abertas no Amei.';
  refreshConnection();
  refreshImport();
};

agendaCard = function(r) {
  const pct = r.ocupacao;
  const periodText = r.periodos.length
    ? r.periodos.map(p => esc(p.inicio) + '–' + esc(p.fim)).join(' / ')
    : 'Agenda importada do Amei';
  const source = r.sincronizado_em ? ' · lido ' + new Date(r.sincronizado_em).toLocaleString('pt-BR') : '';
  return `<article class="agenda-card"><div class="avatar">${esc(r.profissional[0].toUpperCase())}</div><div class="agenda-info"><div class="agenda-line"><strong>${esc(r.profissional)}</strong><span class="pill ${level(pct)}">${rateLabel(r)}</span></div><div class="small-meta">${esc(r.especialidade)} · ${periodText}</div><div class="progress ${level(pct)}"><span style="width:${Math.max(0,Math.min(100,pct||0))}%"></span></div><div class="progress-label">${r.ocupados==null?'Preenchimento ainda não informado':`${r.ocupados} de ${r.total} horários preenchidos`}${r.fonte_ocupacao?' · '+esc(r.fonte_ocupacao):''}${source}</div></div></article>`;
};

renderTable = function() {
  const q = $('#search').value.toLocaleLowerCase('pt-BR');
  const st = $('#status-filter').value, mo = $('#month-filter').value;
  const rows = state.agendas.filter(r => (!q || (r.profissional+' '+r.especialidade).toLocaleLowerCase('pt-BR').includes(q)) && (!st || r.situacao === st) && (!mo || r.data.startsWith(mo)));
  $('#all-agendas').innerHTML = rows.length ? `<table><thead><tr><th>DATA</th><th>PROFISSIONAL / ESPECIALIDADE</th><th>SITUAÇÃO</th><th>OCUPAÇÃO</th><th>CONFIRMADOS</th><th>AÇÕES</th></tr></thead><tbody>${rows.map(r => {
    const imported = String(r.id).startsWith('amei:');
    const details = r.turnos_amei ? `<button data-details="${esc(r.id)}">Ver horários</button>` : '';
    const actions = imported ? `${details}<span class="source-label">Lida do Amei</span>` : `${details}<button data-edit="${r.id}">Editar</button>${r.situacao==='aberta'?`<button data-sync="${r.id}">Atualizar Amei</button>`:''}<button data-delete="${r.id}">Excluir</button>`;
    return `<tr><td><strong>${dateLabel(r.data)}</strong></td><td><strong>${esc(r.profissional)}</strong><small>${esc(r.especialidade)}${r.origem?' · '+esc(r.origem):''}</small></td><td><span class="pill ${r.situacao==='aberta'?'good':'unknown'}">${statusName[r.situacao]}</span></td><td>${r.ocupacao==null?'—':`<strong>${r.ocupacao}%</strong><small>${r.ocupados}/${r.total} · ${esc(r.fonte_ocupacao)}</small>`}</td><td>${r.confirmados??'—'}</td><td class="actions">${actions}</td></tr>`;
  }).join('')}</tbody></table>` : empty('Nenhuma agenda encontrada','Ajuste os filtros ou busque as agendas na aba Conexões.');
};

async function refreshConnection() {
  $('#amei-status').textContent = 'Verificando...';
  try {
    const data = await api('/api/amei/status');
    $('#amei-status').textContent = ({conectado:'Conectado',login_necessario:'Login necessário',fechado:'Desconectado',ocupado:'Consultando'})[data.status] || 'Indisponível';
    $('#amei-status').className = 'connection-badge ' + (data.status === 'conectado' ? 'connected' : '');
    $('#amei-message').textContent = data.message;
  } catch(e) {
    $('#amei-status').textContent = 'Indisponível';
    $('#amei-message').textContent = e.message;
  }
}

async function refreshImport() {
  try {
    const job = await api('/api/amei/import/status');
    $('#amei-import').disabled = job.running;
    const message = $('#amei-import-message');
    if (job.running) {
      message.textContent = `Buscando agendas de ${job.month}. Aguarde; a consulta pode levar alguns minutos.`;
      clearTimeout(refreshImport.timer);
      refreshImport.timer = setTimeout(refreshImport, 3000);
    } else {
      clearTimeout(refreshImport.timer);
      if (job.error) message.textContent = job.error;
      else if (job.result) message.textContent = `${job.result.count} agendas encontradas. ${job.result.warnings ? job.result.warnings+' consultas tiveram aviso; confira o resultado.' : 'Leitura concluída.'}`;
      else message.textContent = 'Selecione um mês e busque as agendas abertas.';
      await refresh();
    }
    $('#amei-import-history').innerHTML = job.months.length
      ? '<b>Meses consultados</b>' + job.months.map(m => `<div class="import-history-row"><span>${esc(m.month)}</span><span>${new Date(m.atualizado_em).toLocaleString('pt-BR')}${m.avisos?' · '+m.avisos+' avisos':''}</span></div>`).join('')
      : '';
  } catch(e) { $('#amei-import-message').textContent = e.message; }
}

$('#amei-month').value = new Date().toLocaleDateString('en-CA').slice(0,7);
$('#amei-open').addEventListener('click', async () => {
  const button = $('#amei-open'); button.disabled = true; button.textContent = 'Abrindo...';
  try { await api('/api/amei/open',{method:'POST'}); $('#amei-message').textContent = 'Janela do Amei aberta. Faça login nela e volte para verificar a conexão.'; }
  catch(e) { $('#amei-message').textContent = e.message; }
  finally { button.disabled = false; button.textContent = 'Abrir Amei para login'; }
});
$('#amei-check').addEventListener('click', refreshConnection);
$('#amei-import').addEventListener('click', async () => {
  const month = $('#amei-month').value;
  if (!month) { $('#amei-import-message').textContent = 'Escolha um mês.'; return; }
  try { await api('/api/amei/import',{method:'POST',body:JSON.stringify({month})}); refreshImport(); }
  catch(e) { $('#amei-import-message').textContent = e.message; }
});

$('#close-details').onclick = () => $('#details-dialog').close();

// Pulso da sessao do Amei: mostra se a aba esta acordada e quanto tempo ela ja ficou muda.
const PULSO_ROTULO = {
  ativo:        ['Acordada', 'O Amei respondeu na última sondagem.'],
  login:        ['Precisa de login', 'O F5 automático não recuperou a sessão. Entre de novo na janela do Amei.'],
  travado:      ['Travou', 'A página parou de responder. O painel deu um F5 e vai sondar de novo.'],
  sem_resposta: ['Sem resposta', 'A janela do Amei não respondeu. Confira se ela continua aberta.'],
  sem_janela:   ['Janela fechada', 'Abra o Amei para o painel poder consultar.'],
  ocupado:      ['Em leitura', 'Uma consulta está rodando agora e já mantém a aba acordada.'],
};
const duracao = s => !s ? '—' : s < 60 ? s + 's' : Math.floor(s/60) + 'min ' + (s%60) + 's';
const hora = v => v ? new Date(v).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : '—';
async function atualizarPulso() {
  try {
    const p = await api('/api/amei/pulso');
    const [rotulo, texto] = PULSO_ROTULO[p.estado] || ['Aguardando', 'A primeira sondagem ainda não aconteceu.'];
    $('#pulse-state').textContent = rotulo;
    $('#pulse-state').className = 'pulse-tag ' + (p.estado === 'ativo' ? 'ok' : p.estado === 'ocupado' ? 'busy' : 'warn');
    $('#pulse-copy').textContent = `${texto} O painel sonda a cada ${p.intervalo_s}s.` +
      (p.queda_atual_s ? ` Sem responder há ${duracao(p.queda_atual_s)}.` : '');
    $('#pulse-last').textContent = hora(p.ultimo_ok);
    $('#pulse-worst').textContent = p.maior_queda_s ? duracao(p.maior_queda_s) : 'nunca caiu';
    $('#pulse-reloads').textContent = p.recuperacoes ? `${p.recargas} (${p.recuperacoes} religaram)` : p.recargas;
    $('#pulse-count').textContent = p.sondagens;
  } catch (e) { $('#pulse-state').textContent = '—'; }
}
atualizarPulso();
setInterval(() => { if (!document.hidden) atualizarPulso(); }, 15000);
