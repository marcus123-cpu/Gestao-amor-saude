// Read only. Count appointments in the selected service month and prove authorship
// with appointment.createdBy. The endpoint is filtered by service date, so these
// numbers never claim to cover every booking CREATED in the selected month.
async args => {
  const get = async path => {
    const response = await fetch(path, {credentials:'same-origin',signal:AbortSignal.timeout(30000)});
    if (response.status===401 || response.status===403) throw Error('AUTH_REQUIRED');
    if (!response.ok) throw Error('HTTP_ERROR');
    return response.json();
  };
  try {
    const start=args.month+'-01';
    const end=new Date(Date.UTC(+args.month.slice(0,4),+args.month.slice(5,7),0)).toISOString().slice(0,10);
    const statuses=await get('/api/v1/status_appointments');
    if (!Array.isArray(statuses) || !statuses.length) throw Error('SCHEMA_ERROR');
    const query=new URLSearchParams({dateInit:start.replaceAll('-',''),dateFinish:end.replaceAll('-',''),unitId:'1795',limit:'100'});
    statuses.forEach(s=>query.append('statusAppointmentId',String(s.value)));
    const discovered=[],seen=new Set();let total=null;
    for(let page=1;page<=1000;page++) {
      query.set('page',String(page));
      const data=await get('/api/v1/appointments/confirm/status?'+query);
      if(!Array.isArray(data.items)||!Number.isInteger(data.meta?.totalItems))throw Error('SCHEMA_ERROR');
      if(total!==null&&total!==data.meta.totalItems)throw Error('CHANGED_DURING_READ');
      total=data.meta.totalItems;
      for(const item of data.items){
        const id=String(item.agendamentoId||'');
        if(!id||seen.has(id))throw Error('SCHEMA_ERROR');
        seen.add(id);discovered.push({id,listedStatus:Number(item.statusId)});
      }
      if(discovered.length===total)break;
      if(!data.items.length)throw Error('INCOMPLETE_READ');
    }
    if(discovered.length!==total)throw Error('INCOMPLETE_READ');
    const team={gabriela:'34560',marcos:'35548',thais:'68893'};
    const rows={gabriela:[],marcos:[],thais:[]};
    const clinic={total:0,attended:0,absent:0,cancelled:0,confirmed:0,marked:0,other:0,
      byProfessional:{},daily:{}};
    const category=status=>[5,60].includes(status)?'attended':[17,83].includes(status)?'absent':
      [3,8,9].includes(status)?'cancelled':status===16?'confirmed':status===2?'marked':'other';
    let cursor=0,checked=0,unverified=0,stale=0;
    const iso=value=>{const s=String(value||'');const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
    async function worker(){
      while(cursor<discovered.length){
        const item=discovered[cursor++];
        try{
          const d=await get('/api/v1/appointments/'+encodeURIComponent(item.id));
          if(String(d.id)!==item.id || String(d.clinica)!=='1795')throw Error('SCHEMA_ERROR');
          const date=iso(d.data);
          if(date<start||date>end){stale++;continue;}
          const statusId=Number(d.statusAgendamento),kind=category(statusId);
          const professional=[d.profissionalId?.nome,d.profissionalId?.sobrenome].filter(Boolean).join(' ').trim()||'Profissional não informado';
          const doctorKey=String(d.profissionalId?.id||professional);
          const doctor=clinic.byProfessional[doctorKey] ||= {name:professional,total:0,attended:0,absent:0,cancelled:0,daily:{}};
          const day=clinic.daily[date] ||= {attended:0,absent:0,cancelled:0};
          const doctorDay=doctor.daily[date] ||= {attended:0,absent:0,cancelled:0};
          clinic.total++;clinic[kind]++;doctor.total++;
          if(kind in doctor)doctor[kind]++;
          if(kind in day)day[kind]++;
          if(kind in doctorDay)doctorDay[kind]++;
          const owner=Object.keys(team).find(k=>team[k]===String(d.createdBy));
          if(owner){
            const patient=d.pacienteId||{};
            rows[owner].push({id:item.id,name:[patient.nome,patient.sobrenome].filter(Boolean).join(' ').trim(),
              cpf:String(patient.cpf||'').replace(/\D/g,''),date,statusId,
              createdAt:String(d.createAt||''),professional});
          }
          checked++;
        }catch(e){if(e.message==='AUTH_REQUIRED')throw e;unverified++;}
      }
    }
    await Promise.all(Array.from({length:4},worker));
    return {month:args.month,listed:total,checked,unverified,stale,rows,clinic,
      coverage:'Consultas com data de atendimento no mês. Criações para outros meses não são descobertas por esta API.'};
  }catch(e){return {error:e.message==='AUTH_REQUIRED'?'AUTH_REQUIRED':String(e.message||'READ_ERROR').slice(0,50)}}
}
