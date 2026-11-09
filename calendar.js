// Mini calendario de "Todas as agendas": escolher o mes pelas setas, clicar num dia
// para ver quem atende nele e abrir o cadastro de uma previsao para aquele dia.
var calMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
var calDay = '';  // var para o filtro da tabela poder ler mesmo antes deste arquivo rodar

const calKey = (ano, mes) => `${ano}-${String(mes + 1).padStart(2, '0')}`;
function calShift(step) {
  const ano = +calMonth.slice(0, 4), mes = +calMonth.slice(5, 7) - 1 + step;
  calMonth = calKey(ano + Math.floor(mes / 12), ((mes % 12) + 12) % 12);
  if (calDay && !calDay.startsWith(calMonth)) calDay = '';
  renderCalendar(); renderTable();
}

// Quantas agendas abertas cada dia do mes tem, para colorir o calendario.
function calCounts() {
  const mapa = new Map();
  for (const r of state.agendas) {
    if (!r.data.startsWith(calMonth) || r.situacao === 'cancelada') continue;
    const atual = mapa.get(r.data) || {total: 0, alta: 0, atencao: 0};
    atual.total++;
    if (r.prioridade === 'alta') atual.alta++;
    else if (r.prioridade === 'atencao') atual.atencao++;
    mapa.set(r.data, atual);
  }
  return mapa;
}

function renderCalendar() {
  const grid = $('#cal-grid');
  if (!grid) return;
  const ano = +calMonth.slice(0, 4), mes = +calMonth.slice(5, 7) - 1;
  const nomeMes = new Intl.DateTimeFormat('pt-BR', {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(ano, mes, 1)));
  $('#cal-label').textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1) + ' / ' + ano;
  const dias = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const primeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay();
  const contagem = calCounts(), hoje = state.dashboard.hoje;
  const celulas = [];
  // Dias do mes vizinho entram apagados so para fechar a grade.
  const antes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  for (let i = primeiro; i > 0; i--) celulas.push(`<span class="cal-out">${antes - i + 1}</span>`);
  for (let d = 1; d <= dias; d++) {
    const iso = `${calMonth}-${String(d).padStart(2, '0')}`;
    const c = contagem.get(iso);
    const classes = ['cal-day'];
    if (iso === hoje) classes.push('is-today');
    if (iso === calDay) classes.push('is-on');
    if (c) classes.push(c.alta ? 'has-alta' : c.atencao ? 'has-atencao' : 'has-agenda');
    const rotulo = c ? `${d} de ${calMonth.slice(5)} · ${c.total} agenda(s)` : `${d} de ${calMonth.slice(5)} · sem agenda`;
    celulas.push(`<button type="button" class="${classes.join(' ')}" data-cal-day="${iso}" aria-label="${rotulo}" aria-pressed="${iso === calDay}"><b>${d}</b>${c ? `<i>${c.total}</i>` : ''}</button>`);
  }
  for (let d = 1; celulas.length % 7; d++) celulas.push(`<span class="cal-out">${d}</span>`);
  grid.innerHTML = celulas.join('');
  const box = $('#cal-day');
  if (!calDay) {
    box.innerHTML = '<small>Clique num dia para ver só as agendas dele.</small>';
    return;
  }
  const doDia = state.agendas.filter(r => r.data === calDay && r.situacao !== 'cancelada');
  box.innerHTML = `<div class="cal-day-head"><strong>${fullDate(calDay)}</strong>
    <span>${doDia.length} agenda(s)</span>
    <button type="button" class="secondary" id="cal-new">＋ Cadastrar previsão para este dia</button>
    <button type="button" class="text-button" id="cal-clear">Ver o mês todo ✕</button></div>`;
}

document.addEventListener('click', e => {
  const dia = e.target.closest('[data-cal-day]');
  if (dia) {
    calDay = calDay === dia.dataset.calDay ? '' : dia.dataset.calDay;
    agendaPage = 0; renderCalendar(); renderTable(); return;
  }
  if (e.target.closest('#cal-prev')) return calShift(-1);
  if (e.target.closest('#cal-next')) return calShift(1);
  if (e.target.closest('#cal-clear')) { calDay = ''; agendaPage = 0; renderCalendar(); renderTable(); return; }
  if (e.target.closest('#cal-new')) {
    // Previsao ja nasce no dia escolhido; nao depende de conexao com o Amei.
    openForm(null, true);
    $('#agenda-form').elements.data.value = calDay;
    return;
  }
});

const calBaseRender = render;
render = function () { calBaseRender(); renderCalendar(); };
