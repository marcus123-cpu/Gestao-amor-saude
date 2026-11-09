async (args) => {
  const {jobs, month, today} = args;
  const monthStart = month + '-01';
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const toISO = value => {
    const text = String(value || '');
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    return br ? `${br[3]}-${br[2]}-${br[1]}` : text.slice(0, 10);
  };
  let work = [...jobs];
  if (args.discoverAll) {
    try {
      const getJson = async path => {
        const response = await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
        if (!response.ok) throw Error('CATALOG_ERROR');
        const data = await response.json();
        if (!Array.isArray(data)) throw Error('CATALOG_ERROR');
        return data;
      };
      const specialties = (await getJson('/api/v1/especialidades')).filter(s=>s.ativo!==false);
      if (specialties.some(s=>s.id==null)) throw Error('CATALOG_ERROR');
      let specialtyCursor = 0;
      const discovered = [];
      async function catalogWorker() {
        while (specialtyCursor < specialties.length) {
          const specialty = specialties[specialtyCursor++];
          const professionals = await getJson('/api/v1/profissionais/especialidade/'+encodeURIComponent(specialty.id));
          for (const p of professionals) {
            if (p.ativo===false) continue;
            if (p.id==null) throw Error('CATALOG_ERROR');
            discovered.push({specialtyId:String(specialty.id),professionalId:String(p.id)});
          }
        }
      }
      await Promise.all(Array.from({length:Math.min(4,specialties.length)},catalogWorker));
      work = [...new Map([...work,...discovered].map(j=>[j.specialtyId+'|'+j.professionalId,j])).values()];
    } catch (e) { return {error:'CATALOG_ERROR'}; }
  }
  let cursor = 0;
  let failure = null;
  const appointments = new Map();
  async function worker() {
    while (cursor < work.length && !failure) {
      const job = work[cursor++];
      const params = new URLSearchParams({
        idClinic: '1795', idSpecialty: String(job.specialtyId),
        idProfessional: String(job.professionalId),
        initialDate: monthStart.replaceAll('-', ''), finalDate: monthEnd.replaceAll('-', ''),
        initialHour: '00:00', endHour: '23:59',
        fetchPolicy: 'network-only', cancelledAppointments: 'false'
      });
      try {
        const response = await fetch('/api/v1/slots/list-slots-by-professional?' + params,
          {credentials: 'same-origin', signal: AbortSignal.timeout(30000)});
        if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'AUTH_ERROR' : 'HTTP_ERROR');
        const data = await response.json();
        if (!Array.isArray(data)) throw Error('SCHEMA_ERROR');
        for (const entry of data) {
          if (!Array.isArray(entry.hours)) throw Error('SCHEMA_ERROR');
          for (const h of entry.hours) {
            if (String(h.idProfessional) !== String(job.professionalId) || String(h.specialtyId) !== String(job.specialtyId)) throw Error('SCHEMA_ERROR');
            const date = toISO(h.date);
            if (date < monthStart || date > monthEnd) throw Error('SCHEMA_ERROR');
            if (!h.patient) continue;
            if (h.patientId == null || h.appointmentId == null || h.statusId == null) throw Error('SCHEMA_ERROR');
            const row = {date, patientId: String(h.patientId), statusId: Number(h.statusId)};
            if (!Number.isInteger(row.statusId)) throw Error('SCHEMA_ERROR');
            const key = String(h.appointmentId);
            const existing = appointments.get(key);
            if (existing && (existing.date !== row.date || existing.patientId !== row.patientId || existing.statusId !== row.statusId)) throw Error('SCHEMA_ERROR');
            appointments.set(key, row);
          }
        }
      } catch (error) {
        failure = error.message === 'AUTH_ERROR' ? 'AUTH_ERROR' : error.message === 'SCHEMA_ERROR' ? 'SCHEMA_ERROR' : 'NETWORK_ERROR';
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, work.length)}, worker));
  if (failure) return {error: failure};
  const days = Number(monthEnd.slice(8));
  const daily = Array.from({length: days}, (_, i) => ({date: month + '-' + String(i + 1).padStart(2, '0'), attended: 0, expected: 0, confirmed: 0}));
  const unique = {attended: new Set(), expected: new Set(), confirmed: new Set()};
  const totals = {attended: 0, expected: 0, confirmed: 0};
  let other = 0;
  for (const row of appointments.values()) {
    const day = daily[Number(row.date.slice(8)) - 1];
    if (row.date <= today && (row.statusId === 5 || row.statusId === 60)) {
      day.attended++; totals.attended++; unique.attended.add(row.patientId);
    } else if (row.date >= today && (row.statusId === 2 || row.statusId === 16)) {
      day.expected++; totals.expected++; unique.expected.add(row.patientId);
      if (row.statusId === 16) {day.confirmed++; totals.confirmed++; unique.confirmed.add(row.patientId);}
    } else other++;
  }
  return {daily, appointments: totals,
    patients: {attended: unique.attended.size, expected: unique.expected.size, confirmed: unique.confirmed.size},
    other, professionals: work.length};
}
