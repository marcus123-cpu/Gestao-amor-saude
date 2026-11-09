async (api, args) => {
  const agendas = [], warnings = [], work = [];
  const key=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^dra?\.?\s+/,'').replace(/\s+/g,' ').trim();
  const {especialidades} = await api({action:'especialidades'});
  let index = 0, fatal = null;
  async function worker() {
    while (index < especialidades.length && !fatal) {
      const specialty = especialidades[index++];
      try {
        const {profissionais} = await api({action:'profissionais',idEspecialidade:specialty.id});
        for (const professional of profissionais) {
          if(key(specialty.nome)==='clinica medica'&&key(professional.nome)!==key(args.clinicMedicalProfessional))continue;
          work.push({specialty,professional});
        }
      } catch (error) {
        if (error.code === 'AUTH_ERROR') {fatal=error;return;}
        warnings.push({specialty:specialty.nome,message:'Não foi possível consultar os profissionais na AMEI.'});
      }
    }
  }
  await Promise.all(Array.from({length:4},worker));
  if (fatal) throw fatal;
  index=0;
  async function slotsWorker(){
    while(index<work.length&&!fatal){
      const {specialty,professional}=work[index++];
          try {
            const result = await api({action:'slots',overview:true,detectCancellations:true,idEspecialidade:specialty.id,
              idProfissional:professional.id,...args});
            for (const day of result.agendas) agendas.push({...day,source:'AMEI',verified:true,
              professional:professional.nome,specialty:specialty.nome,
              professionalId:professional.id,specialtyId:specialty.id,
              occupied:day.total-day.vacant,occupancy:day.total ? (day.total-day.vacant)/day.total*100 : null});
          } catch (error) {
            if (error.code === 'AUTH_ERROR') {fatal=error;return;}
            warnings.push({professional:professional.nome,specialty:specialty.nome,message:'Não foi possível verificar esta agenda na AMEI.'});
          }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,work.length)},slotsWorker));
  if (fatal) throw fatal;
  agendas.sort((a,b)=>a.date.localeCompare(b.date)||a.specialty.localeCompare(b.specialty)||a.professional.localeCompare(b.professional));
  return {agendas,warnings,status:warnings.length?'PARTIAL':'SUCCESS'};
}
