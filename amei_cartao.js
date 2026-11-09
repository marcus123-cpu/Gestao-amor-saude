// Read only. Para cada paciente marcado numa agenda, confere no Cartao de Todos se a
// matricula esta ativa - a mesma checagem que pinta o campo de verde ou vermelho na
// tela do Amei - e mostra sob qual parceiro o agendamento foi lancado.
//
// Esta passagem tambem devolve QUEM agendou cada paciente e quando. Os dois assuntos
// andam juntos de proposito: ambos saem do mesmo registro do agendamento, e ler esse
// registro uma vez so evita baixar a agenda inteira duas vezes.
async args => {
  const pedir = async path => {
    let ultimo;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        const r = await fetch(path, {credentials:'same-origin', signal:AbortSignal.timeout(45000)});
        if (r.status===401 || r.status===403) throw Error('AUTH_REQUIRED');
        const texto = await r.text();
        let corpo = null;
        try { corpo = JSON.parse(texto); } catch (e) { corpo = null; }
        return {ok:r.ok, status:r.status, corpo};
      } catch (e) {
        if (e.message === 'AUTH_REQUIRED') throw e;
        ultimo = e;
        await new Promise(r => setTimeout(r, 1500 * tentativa));
      }
    }
    throw ultimo;
  };
  const get = async path => {
    const r = await pedir(path);
    if (!r.ok || r.corpo === null) throw Error('HTTP_' + r.status);
    return r.corpo;
  };
  const iso = v => {const s=String(v||''), m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m?`${m[3]}-${m[2]}-${m[1]}`:s.slice(0,10)};
  const semAcento = v => String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

  // Pacote de oftalmo mostrado no Amei: consulta, biomicroscopia de fundo e
  // tonometria binocular. Comparamos centavos para nao errar por ponto flutuante.
  const conferirOftalmo = det => {
    const procedimentos = Array.isArray(det.agendamentosProcedimentos) ? det.agendamentosProcedimentos.map(x => ({
      descricao:String(x.descricao || (x.procedimento && x.procedimento.nome) || '').trim(),
      valor:x.valor==null || x.valor==='' ? null : Number(x.valor)
    })) : [];
    const tipo = p => {
      const nome = semAcento(p.descricao).replace(/[^a-z0-9]+/g,' ');
      if (nome.includes('biomicroscopia') && nome.includes('fundo')) return 'biomicroscopia';
      if (nome.includes('tonometria') && nome.includes('binocular')) return 'tonometria';
      if (nome.includes('consulta')) return 'consulta';
      return 'outro';
    };
    const tipos = procedimentos.map(tipo);
    const esperados = ['consulta','biomicroscopia','tonometria'];
    const faltando = esperados.filter(t => !tipos.includes(t));
    const extras = procedimentos.filter((p,i) => tipo(p)==='outro' || tipos.indexOf(tipos[i])!==i).map(p=>p.descricao||'Procedimento sem nome');
    const total = det.valorTotal==null || det.valorTotal==='' ? null : Number(det.valorTotal);
    const totalCentavos = Number.isFinite(total) ? Math.round(total*100) : null;
    const somaCentavos = procedimentos.every(p=>Number.isFinite(p.valor))
      ? procedimentos.reduce((n,p)=>n+Math.round(p.valor*100),0) : null;
    const valorIncorreto = totalCentavos!==10200 || somaCentavos!==10200;
    return {procedimentos, faltando, extras, valorTotal:Number.isFinite(total)?total:null,
      somaProcedimentos:somaCentavos===null?null:somaCentavos/100,
      valorIncorreto, alerta:faltando.length>0||extras.length>0||valorIncorreto};
  };

  // A API responde 200 com {ativo:true} quando vale, e 400 com uma mensagem quando nao.
  // A mensagem distingue quem nunca teve cartao de quem esta devendo.
  const classificar = resposta => {
    if (resposta.ok && resposta.corpo && resposta.corpo.ativo === true) {
      return {situacao:'ativo', matricula:String(resposta.corpo.matricula||''), mensagem:''};
    }
    const mensagem = String((resposta.corpo && resposta.corpo.mensagem) || '').trim();
    const m = semAcento(mensagem);
    if (m.includes('inadimplente') || m.includes('financeira inativa')) return {situacao:'devendo', matricula:'', mensagem};
    if (m.includes('nao existe')) return {situacao:'sem_cartao', matricula:'', mensagem};
    if (!mensagem) return {situacao:'nao_conferido', matricula:'', mensagem:'O Cartão de Todos não respondeu.'};
    return {situacao:'nao_conferido', matricula:'', mensagem};
  };

  try {
    const dia = String(args.date||'');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw Error('BAD_DATE');

    const q = new URLSearchParams({idClinic:'1795', idSpecialty:String(args.specialtyId),
      idProfessional:String(args.professionalId), initialDate:dia.replaceAll('-',''),
      finalDate:dia.replaceAll('-',''), initialHour:'00:00', endHour:'23:59',
      fetchPolicy:'network-only', cancelledAppointments:'false'});
    const slots = await get('/api/v1/slots/list-slots-by-professional?' + q);
    if (!Array.isArray(slots)) throw Error('SCHEMA_ERROR');
    const marcados = [], vistos = new Set();
    for (const entry of slots) {
      if (!Array.isArray(entry.hours)) throw Error('SCHEMA_ERROR');
      for (const h of entry.hours) {
        if (String(h.idProfessional)!==String(args.professionalId) || String(h.specialtyId)!==String(args.specialtyId)) throw Error('SCHEMA_ERROR');
        if (!h.patientId || !h.appointmentId) continue;
        if (iso(h.date) !== dia) throw Error('SCHEMA_ERROR');
        if (vistos.has(String(h.appointmentId))) continue;
        vistos.add(String(h.appointmentId));
        const hora = /^(\d{1,2}):(\d{2})/.exec(String(h.formatedHour||''));
        marcados.push({appointmentId:String(h.appointmentId), patientId:String(h.patientId),
          name:String(h.patient||'').trim(), statusId:Number(h.statusId),
          time: hora ? hora[1].padStart(2,'0')+':'+hora[2] : ''});
      }
    }

    const statuses = await get('/api/v1/status_appointments');
    if (!Array.isArray(statuses) || !statuses.length) throw Error('SCHEMA_ERROR');
    const rotulo = new Map(statuses.map(s => [Number(s.value), String(s.title!=null?s.title:'')]).filter(p => p[1]));

    // Dinheiro da agenda na mesma passada: cada agendamento ja e lido aqui, entao
    // somar valor e forma de pagamento nao custa nenhuma requisicao extra.
    const centavos = v => (v==null || v==='' || !Number.isFinite(Number(v))) ? null : Math.round(Number(v)*100);
    const formas = new Map();
    let previstoC = 0, recebidoC = 0, comValor = 0, semValor = 0, canceladosValor = 0;

    const linhas = [], naoConferidos = []; let cursor = 0;
    async function worker() {
      while (cursor < marcados.length) {
        const m = marcados[cursor++];
        try {
          const det = await get('/api/v1/appointments/' + encodeURIComponent(m.appointmentId));
          if (String(det.id)!==m.appointmentId || String(det.clinica)!=='1795') throw Error('SCHEMA_ERROR');
          const paciente = det.pacienteId || {};
          const cpf = String(paciente.cpf||'').replace(/\D/g,'');
          const cancelado = /cancel|desmarc/i.test(rotulo.get(Number(det.statusAgendamentoId ?? det.statusAgendamento)) || '');
          const valorC = centavos(det.valorTotal);
          if (cancelado) { canceladosValor++; }
          else if (valorC === null) { semValor++; }
          else {
            comValor++; previstoC += valorC;
            const recebimentos = (Array.isArray(det.recebimentos) ? det.recebimentos : [])
              .concat((det.agendamentosProcedimentos||[]).flatMap(p => Array.isArray(p.recebimentos) ? p.recebimentos : []));
            const pago = recebimentos.reduce((soma, r) => {const c = centavos(r.valor); return c===null ? soma : soma + c;}, 0);
            if (pago > 0) {
              recebidoC += pago;
              const forma = String(det.formaLiquidacaoAgendamento||'').trim() || 'Não informada';
              const atual = formas.get(forma) || {forma, centavos:0, pacientes:0};
              atual.centavos += pago; atual.pacientes += 1;
              formas.set(forma, atual);
            }
          }
          const parceiro = String((det.parceiroId && det.parceiroId.nome) || '').trim();
          const oftalmo = conferirOftalmo(det);
          const cartao = cpf
            ? classificar(await pedir('/api/v1/cartao-todos/matricula-ativa?matriculaoucpf=' + encodeURIComponent(cpf)))
            : {situacao:'nao_conferido', matricula:'', mensagem:'CPF não informado no Amei.'};
          // "Particular" so e reconhecido pelo nome do parceiro; qualquer outro vira o nome cru.
          const particular = semAcento(parceiro).includes('particular');
          // Quem agendou: o nome sai da PRIMEIRA linha do historico do agendamento.
          // Nao usar /api/v1/profissionais/{createdBy} para isso: ali o mesmo numero
          // pertence a outra pessoa (35548 e Marcos aqui e um medico la), e sairia nome errado.
          const historico = (det.historicos||[]).slice()
            .sort((a,b) => String(a.dataAtualizacao||'').localeCompare(String(b.dataAtualizacao||'')));
          const agendadoPor = String((historico[0] && historico[0].atualizadoPor) || '').trim();
          // createAt vem com sufixo Z mas ja esta no horario de Sao Paulo: guardar os
          // campos como estao, sem converter, senao a hora sai 3 horas atras.
          const agendadoEm = String(det.createAt||'').slice(0, 16).replace('T', ' ');
          linhas.push({appointmentId:m.appointmentId, time:m.time,
            name:[paciente.nome, paciente.sobrenome].filter(Boolean).join(' ').trim() || m.name,
            cpf, phone:String(paciente.celular||paciente.telefone||'').replace(/\D/g,''),
            statusId:m.statusId, status:rotulo.get(m.statusId)||('Status '+m.statusId),
            parceiro, particular, situacao:cartao.situacao,
            matricula:cartao.matricula, mensagem:cartao.mensagem,
            agendadoPor, agendadoPorId:String(det.createdBy==null?'':det.createdBy), agendadoEm,
            oftalmo});
        } catch (e) {
          if (e.message === 'AUTH_REQUIRED') throw e;
          naoConferidos.push({time:m.time, name:m.name, appointmentId:m.appointmentId,
            motivo:String(e.message||'ERRO').slice(0,40)});
        }
      }
    }
    await Promise.all(Array.from({length: Math.min(3, Math.max(1, marcados.length))}, worker));
    const porHora = (a,b) => (a.time||'99').localeCompare(b.time||'99') || a.name.localeCompare(b.name,'pt-BR');
    linhas.sort(porHora); naoConferidos.sort(porHora);
    const conta = s => linhas.filter(r => r.situacao === s).length;
    return {date:dia, marcados:marcados.length, conferidos:linhas.length,
      semConferencia:naoConferidos.length, naoConferidos, rows:linhas,
      resumo:{ativo:conta('ativo'), devendo:conta('devendo'), sem_cartao:conta('sem_cartao'),
              nao_conferido:conta('nao_conferido')},
      faturamento:{previsto:previstoC/100, recebido:recebidoC/100, aReceber:(previstoC-recebidoC)/100,
              agendamentos:comValor, cancelados:canceladosValor, semValor,
              naoLidos:naoConferidos.length,
              formas:[...formas.values()].map(f => ({forma:f.forma, valor:f.centavos/100, pacientes:f.pacientes}))
                                         .sort((a,b) => b.valor - a.valor)}};
  } catch (e) {
    return {error: e.message==='AUTH_REQUIRED' ? 'AUTH_REQUIRED' : String(e.message||'READ_ERROR').slice(0,50)};
  }
}
