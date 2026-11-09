const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('amei_cartao.js','utf8');
const base = [
  {descricao:'Consulta Áreas de Atuação',valor:40},
  {descricao:'Biomicroscopia de fundo',valor:30},
  {descricao:'Tonometria - binocular de contato',valor:32},
];
async function run(procedimentos, valorTotal) {
  const response = data => ({ok:true,status:200,text:async()=>JSON.stringify(data)});
  const fetch = async path => {
    if(path.startsWith('/api/v1/slots/')) return response([{hours:[{idProfessional:5563,specialtyId:661,
      patientId:1,appointmentId:2,date:'11/11/2026',formatedHour:'08:00',patient:'Paciente de teste',statusId:2}]}]);
    if(path==='/api/v1/status_appointments') return response([{value:2,title:'Agendado'}]);
    if(path==='/api/v1/appointments/2') return response({id:2,clinica:1795,pacienteId:{id:1,nome:'Paciente',sobrenome:'de teste',cpf:'12345678901'},
      parceiroId:{nome:'Cartão de TODOS'},agendamentosProcedimentos:procedimentos,valorTotal});
    if(path.startsWith('/api/v1/cartao-todos/')) return response({ativo:true,matricula:'SP123'});
    throw Error('Unexpected path '+path);
  };
  const fn = vm.runInNewContext('('+source+')',{fetch,URLSearchParams,AbortSignal,setTimeout,Promise,Number,String,Map,Set,Array,Math,Error});
  const result = await fn({date:'2026-11-11',specialtyId:'661',professionalId:'5563'});
  assert.ifError(result.error);
  assert.strictEqual(result.rows.length,1);
  return result.rows[0].oftalmo;
}
(async()=>{
  let audit=await run(base,102);
  assert.strictEqual(audit.alerta,false);
  assert.strictEqual(audit.faltando.length,0);
  audit=await run(base.slice(0,2),70);
  assert.deepStrictEqual(Array.from(audit.faltando),['tonometria']);
  assert.strictEqual(audit.alerta,true);
  audit=await run(base,620);
  assert.strictEqual(audit.valorIncorreto,true);
  audit=await run([...base,{descricao:'Exame extra',valor:0}],102);
  assert.strictEqual(audit.extras.length,1);
  audit=await run(base,null);
  assert.strictEqual(audit.valorTotal,null);
  assert.strictEqual(audit.valorIncorreto,true);
  console.log('Conferência de oftalmo: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
