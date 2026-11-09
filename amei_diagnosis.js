// Read-only diagnosis for one doctor/specialty. Results stay in server memory.
async args => {
  const get=async path=>{const r=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});if(r.status===401||r.status===403)throw Error('AUTH_REQUIRED');if(!r.ok)throw Error('HTTP_ERROR');return r.json()};
  const iso=v=>{const s=String(v||''),m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
  const pad=d=>d.toISOString().slice(0,10);
  const start=new Date(Date.UTC(+args.month.slice(0,4),+args.month.slice(5,7)-3,1));
  const historicalEnd=new Date(Date.UTC(+args.month.slice(0,4),+args.month.slice(5,7)-1,0));
  const futureEnd=new Date(Date.UTC(+args.month.slice(0,4),+args.month.slice(5,7)+3,0));
  const first=pad(start),lastHistorical=pad(historicalEnd),last=pad(futureEnd);
  try{
    const waits=[];let waitTotal=null;
    for(let page=1;page<=100;page++){
      const d=await get(`/api/v1/lista-espera?page=${page}&limit=100`);
      if(!Array.isArray(d.items)||!Number.isInteger(d.meta?.totalItems))throw Error('SCHEMA_ERROR');
      if(waitTotal!==null&&waitTotal!==d.meta.totalItems)throw Error('CHANGED_WAITLIST');
      waitTotal=d.meta.totalItems;waits.push(...d.items);
      if(waits.length>=waitTotal)break;
      if(!d.items.length)throw Error('INCOMPLETE_WAITLIST');
    }
    if(waits.length!==waitTotal)throw Error('INCOMPLETE_WAITLIST');
    const slots=[];
    for(let cursor=new Date(start);cursor<=futureEnd;cursor.setUTCMonth(cursor.getUTCMonth()+1)){
      const month=pad(cursor).slice(0,7),end=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0));
      const q=new URLSearchParams({idClinic:'1795',idSpecialty:String(args.specialtyId),idProfessional:String(args.professionalId),initialDate:pad(cursor).replaceAll('-',''),finalDate:pad(end).replaceAll('-',''),initialHour:'00:00',endHour:'23:59',fetchPolicy:'network-only',cancelledAppointments:'false'});
      const d=await get('/api/v1/slots/list-slots-by-professional?'+q);
      if(!Array.isArray(d))throw Error('SCHEMA_ERROR');
      for(const entry of d){if(!Array.isArray(entry.hours))throw Error('SCHEMA_ERROR');for(const h of entry.hours){
        if(String(h.idProfessional)!==String(args.professionalId)||String(h.specialtyId)!==String(args.specialtyId))throw Error('SCHEMA_ERROR');
        if(!h.patientId||!h.appointmentId)continue;
        slots.push({patientId:String(h.patientId),date:iso(h.date),statusId:Number(h.statusId),name:String(h.patient||'').trim()});
      }}
    }
    const active=new Set([1,2,4,5,6,7,10,11,12,13,14,15,16,24,40,60,120,199]);
    const attended=new Map;
    for(const s of slots)if(s.date>=first&&s.date<=lastHistorical&&(s.statusId===5||s.statusId===60)){
      const prior=attended.get(s.patientId);if(!prior||s.date>prior.date)attended.set(s.patientId,s);
    }
    const hasLater=id=>slots.some(s=>s.patientId===id&&active.has(s.statusId)&&s.date>attended.get(id).date);
    const past=[...attended.values()].filter(s=>!hasLater(s.patientId));
    const scheduled=new Set(slots.filter(s=>active.has(s.statusId)&&s.date>=args.today).map(s=>s.patientId));
    let waiting=waits.filter(w=>String(w.especialidadeId?.id)===String(args.specialtyId)
      &&(!w.profissionalId?.id||String(w.profissionalId.id)===String(args.professionalId))
      &&String(w.statusId?.description||'').toLowerCase()==='pendente'
      &&!w.agendamento && w.pacienteId?.id && !scheduled.has(String(w.pacienteId.id)))
      .map(w=>({id:String(w.pacienteId.id),name:[w.pacienteId.nome,w.pacienteId.sobrenome].filter(Boolean).join(' '),
        cpf:String(w.pacienteId.cpf||'').replace(/\D/g,''),phone:String(w.pacienteId.celular||w.pacienteId.telefone||'').replace(/\D/g,''),since:iso(w.criadoEm)}));
    const returning=[];let cursor=0,unverified=0;
    const statuses=await get('/api/v1/status_appointments');
    if(!Array.isArray(statuses)||!statuses.length)throw Error('SCHEMA_ERROR');
    const checkedWaiting=[];let waitCursor=0;
    async function checkWaiting(){while(waitCursor<waiting.length){const row=waiting[waitCursor++];try{
      const q=new URLSearchParams({patientId:row.id,dateInit:args.today.replaceAll('-',''),dateEnd:last.replaceAll('-',''),limit:'100'});
      statuses.forEach(x=>q.append('statusAppointmentId',String(x.value)));
      let received=0,total=null,booked=false;
      for(let page=1;page<=100;page++){
        q.set('page',String(page));const d=await get('/api/v1/appointments/confirm/status/all?'+q);
        if(!Array.isArray(d.items)||!Number.isInteger(d.meta?.totalItems))throw Error('SCHEMA_ERROR');
        if(total!==null&&total!==d.meta.totalItems)throw Error('CHANGED_HISTORY');total=d.meta.totalItems;received+=d.items.length;
        if(d.items.some(x=>iso(x.data)>=args.today&&active.has(Number(x.statusAgendamento)))){booked=true;break;}
        if(received===total)break;if(!d.items.length)throw Error('INCOMPLETE_HISTORY');
      }
      if(!booked)checkedWaiting.push(row);
    }catch(e){if(e.message==='AUTH_REQUIRED')throw e;unverified++;}}}
    await Promise.all(Array.from({length:Math.min(4,waiting.length)},checkWaiting));waiting=checkedWaiting;
    async function returnedToDoctor(s){
      const q=new URLSearchParams({patientId:s.patientId,dateInit:s.date.replaceAll('-',''),dateEnd:last.replaceAll('-',''),limit:'100'});
      statuses.forEach(x=>q.append('statusAppointmentId',String(x.value)));
      let received=0,total=null;
      for(let page=1;page<=100;page++){
        q.set('page',String(page));const d=await get('/api/v1/appointments/confirm/status/all?'+q);
        if(!Array.isArray(d.items)||!Number.isInteger(d.meta?.totalItems))throw Error('SCHEMA_ERROR');
        if(total!==null&&total!==d.meta.totalItems)throw Error('CHANGED_HISTORY');total=d.meta.totalItems;
        received+=d.items.length;
        for(const x of d.items){
          if(iso(x.data)<=s.date||!active.has(Number(x.statusAgendamento)))continue;
          const detail=await get('/api/v1/appointments/'+encodeURIComponent(x.id));
          if(String(detail.clinica)==='1795'&&String(detail.profissionalId?.id)===String(args.professionalId))return true;
        }
        if(received===total)return false;
        if(!d.items.length)throw Error('INCOMPLETE_HISTORY');
      }
      throw Error('INCOMPLETE_HISTORY');
    }
    async function worker(){while(cursor<past.length){const s=past[cursor++];try{
      if(await returnedToDoctor(s))continue;
      const d=await get('/api/v1/pacientes/'+encodeURIComponent(s.patientId));const p=d.data||d;
      if(String(p.id)!==s.patientId)throw Error('PATIENT_MISMATCH');
      returning.push({id:s.patientId,name:[p.nome,p.sobrenome].filter(Boolean).join(' ').trim()||s.name,
        cpf:String(p.cpf||'').replace(/\D/g,''),phone:String(p.celular||p.telefone||'').replace(/\D/g,''),lastVisit:s.date});
    }catch(e){if(e.message==='AUTH_REQUIRED')throw e;unverified++;}}}
    await Promise.all(Array.from({length:4},worker));
    return {waiting,returning,unverified,checked:attended.size,period:{start:first,historicalEnd:lastHistorical,checkedThrough:last},
      limitation:'Histórico individual conferido até o fim do período indicado; retornos posteriores ainda podem existir.'};
  }catch(e){return {error:e.message==='AUTH_REQUIRED'?'AUTH_REQUIRED':String(e.message||'READ_ERROR').slice(0,50)}}
}
