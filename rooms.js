// O servidor confirma a disponibilidade ao salvar; esta prévia usa a mesma regra.
const previousRoomRender = render;
render = function() {
  previousRoomRender();
  const rooms = state.dashboard.salas_hoje;
  if (!rooms) return;
  $('#rooms-doctors').textContent = rooms.medicos;
  for (const [period, label] of [['manha', 'morning'], ['tarde', 'afternoon']]) {
    const used = rooms[period];
    const free = rooms['disponiveis_' + period];
    $('#rooms-' + label).textContent = `${used} de ${rooms.limite}`;
    $('#rooms-' + label + '-free').textContent = free === 1 ? '1 sala disponível' : `${free} salas disponíveis`;
    $('#rooms-' + label + '-free').classList.toggle('rooms-full', free === 0);
    if (used > rooms.limite) $('#rooms-' + label + '-free').textContent = `${used - rooms.limite} acima do limite`;
  }
};
const roomForm = $('#agenda-form');
const roomStatus = $('#room-form-status');
let roomPreviewRequest = 0;
let roomPreviewTimer;

function roomFormPayload() {
  const fields = ['data', 'situacao', 'profissional', 'especialidade', 'total_manual', 'ocupados_manual', 'confirmados_manual', 'id_profissional', 'id_especialidade', 'observacoes'];
  const payload = Object.fromEntries(fields.map(key => [key, roomForm.elements[key].value]));
  payload.periodos = [...$('#periods').children].map(el => ({
    inicio: el.querySelector('.p-start').value,
    fim: el.querySelector('.p-end').value,
    intervalo: Number(el.querySelector('.p-interval').value)
  }));
  if (editing != null) payload.id = editing;
  return payload;
}

function showRoomPreview(message, full = false) {
  roomStatus.textContent = message;
  roomStatus.classList.toggle('full', full);
}

function updateRoomPreview() {
  clearTimeout(roomPreviewTimer);
  const request = ++roomPreviewRequest;
  const payload = roomFormPayload();
  if (!['aberta', 'prevista'].includes(payload.situacao)) {
    showRoomPreview('Esta situação não ocupa uma sala.');
    return;
  }
  if (!payload.data || !payload.profissional.trim() || !payload.especialidade.trim() ||
      !payload.periodos.length || payload.periodos.some(p => !p.inicio || !p.fim || !p.intervalo)) {
    showRoomPreview('Informe data, profissional, especialidade e turnos para conferir as salas.');
    return;
  }
  showRoomPreview('Conferindo salas disponíveis...');
  roomPreviewTimer = setTimeout(async () => {
    try {
      const result = await api('/api/salas/verificar', {method: 'POST', body: JSON.stringify(payload)});
      if (request !== roomPreviewRequest || !$('#agenda-dialog').open) return;
      const rooms = result.salas?.depois;
      if (!rooms) return showRoomPreview('Esta situação não ocupa uma sala.');
      const parts = [];
      if (payload.periodos.some(p => p.inicio < '12:00')) parts.push(`Manhã: ${rooms.manha}/${rooms.limite} salas ocupadas`);
      if (payload.periodos.some(p => p.fim > '12:00')) parts.push(`Tarde: ${rooms.tarde}/${rooms.limite} salas ocupadas`);
      showRoomPreview(parts.join(' · ') + '.');
    } catch (error) {
      if (request !== roomPreviewRequest || !$('#agenda-dialog').open) return;
      showRoomPreview(error.message, /salas|sala|médicos/i.test(error.message));
    }
  }, 250);
}

const previousOpenRoomForm = openForm;
openForm = function(...args) {
  previousOpenRoomForm(...args);
  updateRoomPreview();
};
roomForm.addEventListener('input', updateRoomPreview);
roomForm.addEventListener('change', updateRoomPreview);
$('#add-period').addEventListener('click', () => setTimeout(updateRoomPreview, 0));
$('#periods').addEventListener('click', e => {
  if (e.target.closest('.remove-period')) setTimeout(updateRoomPreview, 0);
});
if (state.dashboard?.agendas_hoje) render();

let agendaRoomRequest = 0;
async function renderAgendaRooms() {
  const box = $('#agenda-rooms');
  const day = typeof calDay === 'string' ? calDay : '';
  const request = ++agendaRoomRequest;
  if (!day) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<strong>Salas em ${esc(fullDate(day))}</strong><span>Conferindo a disponibilidade...</span>`;
  try {
    const rooms = await api('/api/salas?date=' + encodeURIComponent(day));
    if (request !== agendaRoomRequest) return;
    const shift = (name, used, free) => `<div class="agenda-room-shift"><small>${name}</small><b>${used}/${rooms.limite} ocupadas</b><span class="${free === 0 ? 'rooms-full' : ''}">${free === 1 ? '1 sala disponível' : `${free} salas disponíveis`}</span></div>`;
    box.innerHTML = `<div class="agenda-room-heading"><span class="eyebrow">QUATRO SALAS MÉDICAS</span><strong>${esc(fullDate(day))}</strong><small>${rooms.medicos} médico(s) neste dia · Larissa usa sala própria</small></div>`+
      shift('MANHÃ', rooms.manha, rooms.disponiveis_manha)+
      shift('TARDE', rooms.tarde, rooms.disponiveis_tarde);
  } catch (error) {
    if (request === agendaRoomRequest) box.textContent = error.message;
  }
}
const previousRoomTableRender = renderTable;
renderTable = function() { previousRoomTableRender(); renderAgendaRooms(); };
