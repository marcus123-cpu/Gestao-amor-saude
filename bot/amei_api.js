/**
 * amei_api.js — Chamadas diretas à API da AMEI Fernandópolis.
 *
 * Executado via page.evaluate() dentro do contexto autenticado do Playwright.
 * O navegador fornece cookies/sessão automaticamente — nenhuma credencial é lida,
 * copiada, exportada ou exibida por este módulo.
 *
 * READ-ONLY: nunca cria, altera ou cancela agendamentos.
 */
async (args) => {
  const BASE = '';          // mesmo origin — relativo à página autenticada
  const CLINIC_ID = '1795'; // Fernandópolis; pode ser sobrescrito via args.idClinic

  // ─── Utilitários ────────────────────────────────────────────────────────────

  /** Faz GET com credenciais da sessão atual. Lança em caso de falha de rede. */
  async function apiFetch(path) {
    const url = BASE + path;
    let response;
    try {
      response = await fetch(url, { method: 'GET', credentials: 'same-origin',
        ...(typeof AbortSignal !== 'undefined' ? {signal:AbortSignal.timeout(Math.min(30000,Math.max(1000,args.requestTimeoutMs || 20000)))} : {}) });
    } catch (e) {
      throw { code: 'NETWORK_ERROR', message: 'Falha de rede: ' + e.message, url };
    }
    if (response.status === 401 || response.status === 403) {
      throw { code: 'AUTH_ERROR', message: 'Sessão expirada ou não autenticada. Faça login na AMEI e tente novamente.', status: response.status, url };
    }
    if (!response.ok) {
      throw { code: 'HTTP_ERROR', message: 'A API retornou HTTP ' + response.status, status: response.status, url };
    }
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw { code: 'JSON_ERROR', message: 'Resposta não é JSON válido', url };
    }
    return data;
  }

  /** Garante que value é um array não vazio com ao menos os campos requeridos. */
  function validateArray(value, requiredFields, label) {
    if (!Array.isArray(value)) {
      throw { code: 'SCHEMA_ERROR', message: label + ': resposta não é array', got: typeof value };
    }
    for (const sample of value) {
      if (!sample || typeof sample !== 'object') throw {code:'SCHEMA_ERROR',message:label + ': item inválido'};
      for (const field of requiredFields) {
        if (!(field in sample)) {
          throw { code: 'SCHEMA_ERROR', message: label + ': campo ausente: ' + field, sample: Object.keys(sample) };
        }
      }
    }
    return value;
  }

  /** Formata data JS para YYYYMMDD. */
  function toYMD(dateISO) {
    return dateISO.replace(/-/g, '');
  }

  /** Normaliza hora "8:10" → "08:10". */
  function normalizeHour(h) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return String(m[1]).padStart(2, '0') + ':' + m[2];
  }

  /** Converte "09/09/2026" → "2026-09-09". */
  function slotDateToISO(d) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d || '').trim());
    if (!m) return null;
    const date = new Date(Date.UTC(Number(m[3]), Number(m[2])-1, Number(m[1])));
    if (date.getUTCFullYear() !== Number(m[3]) || date.getUTCMonth() !== Number(m[2])-1 || date.getUTCDate() !== Number(m[1])) return null;
    return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  if (args.action === 'especialidades') {
    const data = await apiFetch('/api/v1/especialidades');
    validateArray(data, ['id', 'descricao'], 'especialidades');
    // Retorna lista de nomes (mantém compatibilidade com o menu existente)
    const list = data
      .filter(e => e.ativo !== false)
      .map(e => ({ id: e.id, nome: String(e.descricao).trim() }))
      .filter(e => e.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { ok: true, especialidades: list };
  }

  if (args.action === 'profissionais') {
    if (!args.idEspecialidade) throw { code: 'BAD_ARGS', message: 'idEspecialidade obrigatório' };
    const data = await apiFetch('/api/v1/profissionais/especialidade/' + args.idEspecialidade);
    validateArray(data, ['id', 'nome'], 'profissionais');
    const list = data
      .filter(p => p.ativo !== false)
      .map(p => ({
        id: p.id,
        nome: [p.tratamento, p.nome, p.sobrenome].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim()
      }))
      .filter(p => p.nome);
    return { ok: true, profissionais: list };
  }

  if (args.action === 'slots') {
    const required = ['idEspecialidade', 'idProfissional', 'initialDate', 'finalDate'];
    for (const f of required) {
      if (args[f] == null) throw { code: 'BAD_ARGS', message: 'Campo obrigatório ausente: ' + f };
    }
    const idClinic    = String(args.idClinic || CLINIC_ID);
    const idSpecialty = String(args.idEspecialidade);
    const idProf      = String(args.idProfissional);
    const initDate    = toYMD(String(args.initialDate));
    const finalDate   = toYMD(String(args.finalDate));

    const qs = [
      'idClinic='               + encodeURIComponent(idClinic),
      'idSpecialty='            + encodeURIComponent(idSpecialty),
      'idProfessional='         + encodeURIComponent(idProf),
      'initialDate='            + encodeURIComponent(initDate),
      'finalDate='              + encodeURIComponent(finalDate),
      'initialHour=00%3A00',
      'endHour=23%3A59',
      'fetchPolicy=network-only',
      'cancelledAppointments=false'
    ].join('&');

    const data = await apiFetch('/api/v1/slots/list-slots-by-professional?' + qs);
    validateArray(data, ['professional', 'hours'], 'slots');

    // Processar: filtrar livres, normalizar, agrupar por data
    const byDate = {};   // { "2026-09-09": { profNome, times: ["08:10", ...] } }
    const overview = {};
    const warnings = [];

    for (const entry of data) {
      const profNome = (entry.professional && entry.professional.name)
        ? String(entry.professional.name).trim()
        : null;
      const profId = (entry.professional && entry.professional.id != null)
        ? entry.professional.id
        : null;

      if (!Array.isArray(entry.hours)) throw {code:'SCHEMA_ERROR',message:'Lista de horários inválida'};
      // A resposta vazia conhecida usa professional.id=null e hours=[].
      if ((entry.hours.length || profId != null) && String(profId) !== idProf) throw {code:'SCHEMA_ERROR',message:'Profissional retornado não corresponde à consulta'};

      for (const h of entry.hours) {
        // Ignorar tudo que não seja explicitamente Livre
        if (!h || typeof h.status !== 'string' || !h.status.trim()) throw {code:'SCHEMA_ERROR',message:'Status de horário não reconhecido'};
        if (args.overview) {
          const date = slotDateToISO(h.date), time = normalizeHour(h.formatedHour);
          if (!date || !time || date < args.initialDate || date > args.finalDate || String(h.idProfessional) !== idProf || String(h.specialtyId) !== idSpecialty)
            throw {code:'SCHEMA_ERROR',message:'Agenda retornada não corresponde ao período ou profissional.'};
          const day = overview[date] ||= {date, times: new Map()};
          const free = h.status.trim().toLowerCase() === 'livre';
          // Conflicting duplicate times must never invent a vacancy.
          day.times.set(time, (day.times.get(time) ?? true) && free);
          if (Number(h.statusId) === 2 && !free) (day.pendingConfirmationTimes ||= new Set()).add(time);
          if (args.includeFitIns) {
            if ((h.status.trim().toLowerCase() === 'encaixe') !== (h.encaixe === true))
              throw {code:'SCHEMA_ERROR',message:'Encaixe sem classificação consistente na AMEI.'};
            if (h.encaixe === true) (day.fitInTimes ||= []).push(time);
          }
        }
        if (h.status.trim().toLowerCase() !== 'livre') continue;

        const iso = slotDateToISO(h.date);
        const hora = normalizeHour(h.formatedHour);

        if (!iso || !hora || iso < args.initialDate || iso > args.finalDate) throw {code:'SCHEMA_ERROR',message:'Horário livre com data ou hora inválida; disponibilidade não confirmada'};
        if (String(h.idProfessional) !== idProf || String(h.specialtyId) !== idSpecialty) throw {code:'SCHEMA_ERROR',message:'Horário livre pertence a outro profissional ou especialidade'};

        if (!byDate[iso]) {
          byDate[iso] = { date: iso, profNome: profNome || ('id:' + profId), times: [] };
        }
        if (!byDate[iso].times.includes(hora)) {
          byDate[iso].times.push(hora);
        }
      }
    }

    // A normal slot read says "Livre" after a cancellation. The alternate
    // read exposes the cancelled appointment behind that still-free slot.
    // Keep only IDs/statuses; patient details never leave the AMEI page.
    const cancellations = {};
    if (args.overview && args.detectCancellations && Object.values(overview).some(day => [...day.times.values()].some(Boolean))) {
      try {
        const cancelledData = await apiFetch('/api/v1/slots/list-slots-by-professional?' + qs.replace('cancelledAppointments=false', 'cancelledAppointments=true'));
        validateArray(cancelledData, ['professional', 'hours'], 'cancelamentos');
        for (const entry of cancelledData) {
          if (entry.hours?.length && String(entry.professional?.id) !== idProf) throw {code:'SCHEMA_ERROR',message:'Cancelamento de outro profissional'};
          for (const h of entry.hours || []) {
            if (String(h.idProfessional) !== idProf || String(h.specialtyId) !== idSpecialty) continue;
            const date = slotDateToISO(h.date), time = normalizeHour(h.formatedHour);
            if (!date || !time || !overview[date]?.times.get(time)) continue;
            const status = String(h.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
            if (status !== 'desmarcado pelo paciente' || h.hasCanceledAppointments !== true || !/^\d+$/.test(String(h.appointmentId))) continue;
            (cancellations[date] ||= []).push({time,appointmentId:String(h.appointmentId)});
          }
        }
      } catch (error) {
        if (error?.code === 'AUTH_ERROR') throw error;
        // The primary free-slot read remains usable; direct cancellation
        // evidence is unavailable for this read, so only baseline diff applies.
      }
    }

    // Ordenar horários dentro de cada data
    for (const entry of Object.values(byDate)) {
      entry.times.sort();
    }

    // Ordenar datas cronologicamente
    const days = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    return { ok: true, days, warnings, ...(args.overview ? {agendas:Object.values(overview).map(day => ({date:day.date,
      times:[...day.times].filter(([,free])=>free).map(([time])=>time).sort(),
      pendingConfirmationTimes:[...(day.pendingConfirmationTimes || [])].sort(),
      cancellations:cancellations[day.date] || [],
      total:day.times.size, vacant:[...day.times.values()].filter(Boolean).length,
      ...(args.includeFitIns ? {fitInCount:(day.fitInTimes||[]).length,
        fitInTimes:(day.fitInTimes||[]).sort()} : {}),
      ...(args.includePeriods ? {periods:['Madrugada','Manhã','Tarde','Noite'].map((period,index)=>{
        const items=[...day.times].filter(([time])=>Math.floor(Number(time.slice(0,2))/6)===index);
        return {period,total:items.length,vacant:items.filter(([,free])=>free).length,times:items.filter(([,free])=>free).map(([time])=>time).sort()};
      }).filter(p=>p.total)} : {})}))} : {}) };
  }

  if (args.action === 'agendados') {
    // Lista os pacientes MARCADOS (com nome + status) de um profissional num período.
    const required = ['idEspecialidade', 'idProfissional', 'initialDate', 'finalDate'];
    for (const f of required) {
      if (args[f] == null) throw { code: 'BAD_ARGS', message: 'Campo obrigatório ausente: ' + f };
    }
    const idClinic = String(args.idClinic || CLINIC_ID);
    const idSpecialty = String(args.idEspecialidade);
    const idProf = String(args.idProfissional);
    const initDate = toYMD(String(args.initialDate));
    const finalDate = toYMD(String(args.finalDate));
    const qs = [
      'idClinic=' + encodeURIComponent(idClinic),
      'idSpecialty=' + encodeURIComponent(idSpecialty),
      'idProfessional=' + encodeURIComponent(idProf),
      'initialDate=' + encodeURIComponent(initDate),
      'finalDate=' + encodeURIComponent(finalDate),
      'initialHour=00%3A00', 'endHour=23%3A59',
      'fetchPolicy=network-only', 'cancelledAppointments=false'
    ].join('&');
    const data = await apiFetch('/api/v1/slots/list-slots-by-professional?' + qs);
    validateArray(data, ['professional', 'hours'], 'agendados');
    const booked = [];
    for (const entry of data) {
      const profName = (entry.professional && entry.professional.name) ? String(entry.professional.name).trim() : '';
      for (const h of (entry.hours || [])) {
        const status = String(h.status || '').trim();
        if (!status || status.toLowerCase() === 'livre' || !h.patient) continue;
        if (String(h.idProfessional) !== idProf) continue;
        const date = slotDateToISO(h.date), time = normalizeHour(h.formatedHour);
        if (!date || !time) continue;
        booked.push({ date, time, patient: String(h.patient).trim(), status,
          encaixe: h.encaixe === true, professional: profName, phone: '',
          patientId: h.patientId != null ? String(h.patientId) : null,
          appointmentId: h.appointmentId != null ? String(h.appointmentId) : null });
      }
    }
    booked.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    // Filtra por status ANTES de buscar telefone, para não desperdiçar o teto em quem não será mostrado.
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const filtro = norm(args.filtro || 'todos');
    const matchStatus = (st) => {
      const n = norm(st);
      if (['faltosos', 'faltou', 'faltas', 'nao compareceu'].includes(filtro)) return n.includes('nao compareceu') || n.includes('faltou');
      if (['atendidos', 'atendido'].includes(filtro)) return n.includes('atendid') && !n.includes('nao compareceu');
      if (['agendados', 'agendado', 'marcados'].includes(filtro)) return n.includes('agendado') || n.includes('marcado') || n.includes('confirmado');
      return true;
    };
    const shown = booked.filter(b => matchStatus(b.status));
    // Telefone: busca o cadastro só de quem será mostrado (dedup, concorrência 10, teto de 80).
    if (args.includePhone !== false) {
      const ids = [...new Set(shown.map(b => b.patientId).filter(Boolean))].slice(0, 200);
      const phones = {};
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift();
          try {
            const pdata = await apiFetch('/api/v1/pacientes/' + encodeURIComponent(id));
            const d = (pdata && pdata.data) ? pdata.data : pdata;
            const raw = String(d.celular || d.telefone || d.celularAlternativo || '').trim();
            phones[id] = raw.replace(/\D/g, '');
          } catch (e) { phones[id] = ''; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(10, ids.length) }, worker));
      for (const b of booked) if (b.patientId && phones[b.patientId]) b.phone = phones[b.patientId];
    }
    // Retorno: para cada paciente mostrado, verifica se tem consulta FUTURA na mesma especialidade
    // DEPOIS da data mostrada (ou seja, "marcou retorno"). Fonte real — sem chute.
    if (args.checkReturn && shown.length) {
      let statuses = [];
      try { statuses = await apiFetch('/api/v1/status_appointments'); } catch (e) { statuses = []; }
      const statusMap = new Map(statuses.map(s => [Number(s.value), String(s.title)]));
      const statusQs = statuses.map(s => 'statusAppointmentId=' + encodeURIComponent(s.value)).join('&');
      const toISO = v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v || '').slice(0, 10); };
      // Referência = a consulta MAIS RECENTE do paciente no período. "Retornou" = tem consulta
      // DEPOIS dessa (voltou após a última vez); "não retornou" = nada marcado depois da última visita.
      const missedOf = {};
      for (const b of shown) if (b.patientId && (!missedOf[b.patientId] || b.date > missedOf[b.patientId])) missedOf[b.patientId] = b.date;
      const rids = Object.keys(missedOf).slice(0, 200);
      const windowEnd = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
      const ret = {};
      const q2 = [...rids];
      const w2 = async () => {
        while (q2.length) {
          const id = q2.shift();
          const missed = missedOf[id];
          try {
            const p = new URLSearchParams({ patientId: id, dateInit: missed.replaceAll('-', ''), dateEnd: windowEnd, page: '1', limit: '100' });
            const d = await apiFetch('/api/v1/appointments/confirm/status/all?' + p + (statusQs ? '&' + statusQs : ''));
            let has = false;
            for (const x of (d.items || [])) {
              const spec = String((x.especialidadeId && x.especialidadeId.id) || '');
              const when = toISO(x.data);
              const st = norm(statusMap.get(Number(x.statusAgendamento)) || '');
              // retorno = consulta na MESMA especialidade, DEPOIS da falta, que não foi cancelada/falta/desmarcada
              if (spec === idSpecialty && when > missed && !st.includes('cancel') && !st.includes('nao compareceu') && !st.includes('desmarcad') && !st.includes('expirado')) { has = true; break; }
            }
            ret[id] = has;
          } catch (e) { ret[id] = null; }  // null = não verificado
        }
      };
      await Promise.all(Array.from({ length: Math.min(12, rids.length) }, w2));
      for (const b of booked) if (b.patientId && b.patientId in ret) b.hasReturn = ret[b.patientId];
    }
    return { ok: true, agendados: booked };
  }

  throw { code: 'UNKNOWN_ACTION', message: 'Ação desconhecida: ' + args.action };
}
