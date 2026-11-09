// Read only. Confere, numa agenda de psiquiatria, se o procedimento cobrado bate com
// o historico do paciente no ano: a primeira vez e "Consulta Areas de Atuacao"; a
// partir da segunda, "Sessao de psiquiatria". Nada e escrito no Amei.
async args => {
  // Paciente com historico longo chega a estourar o tempo de uma chamada. Esta conferencia
  // roda em segundo plano, entao da tempo folgado e tenta de novo antes de desistir:
  // desistir cedo esconderia um erro de cobranca sem ninguem notar.
  const get = async path => {
    let ultimo;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const r = await fetch(path, {credentials:'same-origin', signal:AbortSignal.timeout(90000)});
        if (r.status===401 || r.status===403) throw Error('AUTH_REQUIRED');
        if (r.status >= 500) throw Error('HTTP_' + r.status);
        if (!r.ok) throw Error('HTTP_ERROR');
        return await r.json();
      } catch (e) {
        if (e.message === 'AUTH_REQUIRED' || e.message === 'HTTP_ERROR') throw e;
        ultimo = e;
        await new Promise(r => setTimeout(r, 1500 * tentativa));
      }
    }
    throw ultimo;
  };
  const iso = v => {const s=String(v||''), m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
  const semAcento = v => String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  // O tipo sai do nome do procedimento, nao de um id fixo: o Amei pode renumerar.
  const classificar = texto => {
    const t = semAcento(texto);
    if (t.includes('sessao')) return 'sessao';
    if (t.includes('primeira consulta')) return 'primeira';
    return 'outro';
  };
  const ATENDIDO = new Set([5, 60]);
  try {
    const dia = String(args.date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw Error('BAD_DATE');
    const inicioAno = dia.slice(0,4) + '-01-01';

    // 1) Quem esta marcado na agenda do dia.
    const q = new URLSearchParams({idClinic:'1795', idSpecialty:String(args.specialtyId),
      idProfessional:String(args.professionalId), initialDate:dia.replaceAll('-',''),
      finalDate:dia.replaceAll('-',''), initialHour:'00:00', endHour:'23:59',
      fetchPolicy:'network-only', cancelledAppointments:'false'});
    const slots = await get('/api/v1/slots/list-slots-by-professional?' + q);
    if (!Array.isArray(slots)) throw Error('SCHEMA_ERROR');
    const marcados = [];
    for (const entry of slots) {
      if (!Array.isArray(entry.hours)) throw Error('SCHEMA_ERROR');
      for (const h of entry.hours) {
        if (String(h.idProfessional)!==String(args.professionalId) || String(h.specialtyId)!==String(args.specialtyId)) throw Error('SCHEMA_ERROR');
        if (!h.patientId || !h.appointmentId) continue;
        if (iso(h.date) !== dia) throw Error('SCHEMA_ERROR');
        const hora = /^(\d{1,2}):(\d{2})/.exec(String(h.formatedHour||''));
        marcados.push({appointmentId:String(h.appointmentId), patientId:String(h.patientId),
          name:String(h.patient||'').trim(), statusId:Number(h.statusId),
          time: hora ? hora[1].padStart(2,'0')+':'+hora[2] : ''});
      }
    }

    const statuses = await get('/api/v1/status_appointments');
    if (!Array.isArray(statuses) || !statuses.length) throw Error('SCHEMA_ERROR');
    const rotulo = new Map(statuses.map(s => [Number(s.value), String(s.title!=null?s.title:'')]).filter(p => p[1]));

    // naoConferidos nunca some em silencio: um paciente pulado podia esconder erro de cobranca.
    const linhas = [], naoConferidos = []; let cursor = 0, conferidos = 0;

    // Procura, de 1 de janeiro ate a vespera, atendimento concluido na mesma especialidade.
    async function jaPassou(patientId) {
      // Pagina pequena: para alguns pacientes o Amei nao devolve 100 de uma vez dentro do tempo.
      const h = new URLSearchParams({patientId, dateInit:inicioAno.replaceAll('-',''),
        dateEnd:dia.replaceAll('-',''), limit:'25'});
      statuses.forEach(s => h.append('statusAppointmentId', String(s.value)));
      let recebidos = 0, total = null, vezes = 0, ultima = '';
      for (let page=1; page<=400; page++) {
        h.set('page', String(page));
        const d = await get('/api/v1/appointments/confirm/status/all?' + h);
        if (!Array.isArray(d.items) || !Number.isInteger(d.meta && d.meta.totalItems)) throw Error('SCHEMA_ERROR');
        if (total!==null && total!==d.meta.totalItems) throw Error('CHANGED_HISTORY');
        total = d.meta.totalItems; recebidos += d.items.length;
        for (const x of d.items) {
          const data = iso(x.data);
          if (data >= dia || !ATENDIDO.has(Number(x.statusAgendamento))) continue;
          const det = await get('/api/v1/appointments/' + encodeURIComponent(x.id));
          if (String(det.clinica)!=='1795') continue;
          if (String(det.especialidadeId && det.especialidadeId.id)!==String(args.specialtyId)) continue;
          vezes++;
          if (data > ultima) ultima = data;
        }
        if (recebidos === total) return {vezes, ultima};
        if (!d.items.length) throw Error('INCOMPLETE_HISTORY');
      }
      throw Error('INCOMPLETE_HISTORY');
    }

    async function worker() {
      while (cursor < marcados.length) {
        const m = marcados[cursor++];
        try {
          const det = await get('/api/v1/appointments/' + encodeURIComponent(m.appointmentId));
          if (String(det.id)!==m.appointmentId || String(det.clinica)!=='1795') throw Error('SCHEMA_ERROR');
          const procedimentos = (det.agendamentosProcedimentos||[]).map(x => ({
            descricao: String(x.descricao || (x.procedimento && x.procedimento.nome) || '').trim(),
            valor: Number(x.valor)}));
          const tipos = procedimentos.map(p => classificar(p.descricao));
          const tipo = tipos.includes('sessao') ? 'sessao' : tipos.includes('primeira') ? 'primeira'
                     : procedimentos.length ? 'outro' : 'sem';
          const hist = await jaPassou(m.patientId);
          const paciente = det.pacienteId || {};
          let alerta = null;
          if (tipo === 'primeira' && hist.vezes > 0) {
            alerta = {nivel:'erro', vezes:hist.vezes, ultima:hist.ultima};
          } else if (tipo === 'sessao' && hist.vezes === 0) {
            alerta = {nivel:'sem_historico'};
          } else if (tipo === 'sem') {
            alerta = {nivel:'sem_procedimento'};
          }
          linhas.push({appointmentId:m.appointmentId, time:m.time,
            name:[paciente.nome, paciente.sobrenome].filter(Boolean).join(' ').trim() || m.name,
            cpf:String(paciente.cpf||'').replace(/\D/g,''),
            phone:String(paciente.celular||paciente.telefone||'').replace(/\D/g,''),
            statusId:m.statusId, status:rotulo.get(m.statusId)||('Status '+m.statusId),
            procedimentos, tipo, atendimentosNoAno:hist.vezes, ultimoAtendimento:hist.ultima, alerta});
          conferidos++;
        } catch (e) {
          if (e.message === 'AUTH_REQUIRED') throw e;
          naoConferidos.push({time:m.time, name:m.name, appointmentId:m.appointmentId,
            motivo:String(e.message||'ERRO').slice(0,40)});
        }
      }
    }
    // Tres de cada vez: mais que isso deixa o proprio Amei lento e provoca os tempos esgotados.
    await Promise.all(Array.from({length: Math.min(3, Math.max(1, marcados.length))}, worker));
    const porHora = (a,b) => (a.time||'99').localeCompare(b.time||'99') || a.name.localeCompare(b.name,'pt-BR');
    linhas.sort(porHora); naoConferidos.sort(porHora);
    return {date:dia, desde:inicioAno, marcados:marcados.length, conferidos,
            semConferencia:naoConferidos.length, naoConferidos, rows:linhas};
  } catch (e) {
    return {error: e.message==='AUTH_REQUIRED' ? 'AUTH_REQUIRED' : String(e.message||'READ_ERROR').slice(0,50)};
  }
}
