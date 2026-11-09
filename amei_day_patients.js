// Read only. List the patients scheduled on one day, with the status each one has
// in Amei. The list endpoint is filtered by service date; the name and CPF come
// from each appointment's own record, never guessed.
async args => {
  const get = async path => {
    const response = await fetch(path, {credentials:'same-origin',signal:AbortSignal.timeout(30000)});
    if (response.status===401 || response.status===403) throw Error('AUTH_REQUIRED');
    if (!response.ok) throw Error('HTTP_ERROR');
    return response.json();
  };
  try {
    const day = String(args.date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('BAD_DATE');
    const wanted = Array.isArray(args.statuses) && args.statuses.length ? args.statuses.map(Number) : null;
    const statuses = await get('/api/v1/status_appointments');
    if (!Array.isArray(statuses) || !statuses.length) throw Error('SCHEMA_ERROR');
    // O Amei nomeia o status em `title` (conferido em /api/v1/status_appointments).
    const label = new Map(statuses.map(s => [Number(s.value), String(s.title ?? '')]).filter(([, t]) => t));
    const query = new URLSearchParams({dateInit:day.replaceAll('-',''),dateFinish:day.replaceAll('-',''),unitId:'1795',limit:'100'});
    statuses.forEach(s => query.append('statusAppointmentId', String(s.value)));
    const discovered = [], seen = new Set(); let total = null;
    for (let page=1; page<=200; page++) {
      query.set('page', String(page));
      const data = await get('/api/v1/appointments/confirm/status?'+query);
      if (!Array.isArray(data.items) || !Number.isInteger(data.meta?.totalItems)) throw Error('SCHEMA_ERROR');
      if (total!==null && total!==data.meta.totalItems) throw Error('CHANGED_DURING_READ');
      total = data.meta.totalItems;
      for (const item of data.items) {
        const id = String(item.agendamentoId||'');
        if (!id || seen.has(id)) throw Error('SCHEMA_ERROR');
        seen.add(id); discovered.push(id);
      }
      if (discovered.length===total) break;
      if (!data.items.length) throw Error('INCOMPLETE_READ');
    }
    if (discovered.length!==total) throw Error('INCOMPLETE_READ');
    const iso = value => {const s=String(value||'');const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
    // So aceita hora num formato reconhecivel; sem isso, a linha vai sem horario
    // em vez de mostrar um campo adivinhado.
    const hora = d => {
      for (const candidate of [d.hora, d.horaInicio, d.formatedHour, d.horario]) {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(candidate||''));
        if (m) return m[1].padStart(2,'0')+':'+m[2];
      }
      return '';
    };
    const rows = []; let cursor = 0, checked = 0, unverified = 0;
    async function worker(){
      while (cursor < discovered.length) {
        const id = discovered[cursor++];
        try {
          const d = await get('/api/v1/appointments/'+encodeURIComponent(id));
          if (String(d.id)!==id || String(d.clinica)!=='1795') throw Error('SCHEMA_ERROR');
          if (iso(d.data)!==day) continue;
          const statusId = Number(d.statusAgendamento);
          checked++;
          if (wanted && !wanted.includes(statusId)) continue;
          const patient = d.pacienteId||{};
          rows.push({name:[patient.nome,patient.sobrenome].filter(Boolean).join(' ').trim(),
            cpf:String(patient.cpf||'').replace(/\D/g,''),
            phone:String(patient.celular||patient.telefone||'').replace(/\D/g,''),
            statusId, status:label.get(statusId)||'Status '+statusId, time:hora(d),
            professional:[d.profissionalId?.nome,d.profissionalId?.sobrenome].filter(Boolean).join(' ').trim()});
        } catch(e) { if (e.message==='AUTH_REQUIRED') throw e; unverified++; }
      }
    }
    await Promise.all(Array.from({length:4}, worker));
    rows.sort((a,b)=>(a.time||'99').localeCompare(b.time||'99')||a.name.localeCompare(b.name,'pt-BR'));
    return {date:day, listed:total, checked, unverified, rows};
  } catch(e) { return {error: e.message==='AUTH_REQUIRED'?'AUTH_REQUIRED':String(e.message||'READ_ERROR').slice(0,50)} }
}
