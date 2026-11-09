const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('amei_collaborators.js', 'utf8');
const statuses = [{value:5}, {value:17}, {value:3}];
const details = {
  '1': {id:1, clinica:1795, data:'03/06/2026', statusAgendamento:5, createdBy:34560,
    profissionalId:{id:42,nome:'Dra.',sobrenome:'Exemplo'}, pacienteId:{nome:'A'}},
  '2': {id:2, clinica:1795, data:'03/06/2026', statusAgendamento:17, createdBy:68893,
    profissionalId:{id:42,nome:'Dra.',sobrenome:'Exemplo'}, pacienteId:{nome:'B'}},
  '3': {id:3, clinica:1795, data:'03/06/2026', statusAgendamento:3, createdBy:999,
    profissionalId:{id:42,nome:'Dra.',sobrenome:'Exemplo'}, pacienteId:{nome:'C'}}
};
const context = {Date, URLSearchParams, AbortSignal, fetch:async url => {
  const path = String(url);
  const data = path.includes('status_appointments') ? statuses
    : path.includes('/confirm/status') ? {items:Object.keys(details).map(id=>({agendamentoId:id,statusId:details[id].statusAgendamento})),meta:{totalItems:3}}
    : details[path.split('/').at(-1)];
  return {ok:true,status:200,json:async()=>data};
}};
(async () => {
  const scan = vm.runInNewContext('(' + source + ')', context);
  const result = await scan({month:'2026-06'});
  assert.equal(result.checked, 3);
  assert.equal(result.clinic.attended, 1);
  assert.equal(result.clinic.absent, 1);
  assert.equal(result.clinic.cancelled, 1);
  assert.equal(result.clinic.byProfessional['42'].cancelled, 1);
  assert.equal(result.rows.gabriela.length, 1);
  assert.equal(result.rows.thais.length, 1);
  process.stdout.write('Resumo mensal da clínica: OK\n');
})().catch(error => {process.stderr.write(String(error));process.exitCode=1});
