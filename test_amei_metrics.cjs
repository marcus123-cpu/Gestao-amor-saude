const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('amei_metrics.js', 'utf8');
const hours = [
  {date:'29/10/2026', idProfessional:'1', specialtyId:'2', patient:'A',patientId:'a',appointmentId:'10',statusId:5},
  {date:'30/10/2026', idProfessional:'1', specialtyId:'2', patient:'A',patientId:'a',appointmentId:'11',statusId:60},
  {date:'30/10/2026', idProfessional:'1', specialtyId:'2', patient:'B',patientId:'b',appointmentId:'12',statusId:2},
  {date:'31/10/2026', idProfessional:'1', specialtyId:'2', patient:'C',patientId:'c',appointmentId:'13',statusId:16,encaixe:true},
  {date:'31/10/2026', idProfessional:'1', specialtyId:'2', patient:'D',patientId:'d',appointmentId:'14',statusId:3}
];
const context = {
  Date, URLSearchParams, AbortSignal,
  fetch: async () => ({ok:true,json:async()=>[{hours}]}),
};
(async()=>{
  const scan=vm.runInNewContext('('+source+')',context);
  const result=await scan({month:'2026-10',today:'2026-10-30',discoverAll:false,jobs:[{professionalId:'1',specialtyId:'2'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(result.appointments)),{attended:2,expected:2,confirmed:1});
  assert.deepEqual(JSON.parse(JSON.stringify(result.patients)),{attended:1,expected:2,confirmed:1});
  assert.equal(result.daily[29].attended,1);
  assert.equal(result.daily[29].expected,1);
  assert.equal(result.daily[30].confirmed,1);
  assert.equal(result.other,1);
  const discovery=vm.runInNewContext('('+source+')',{
    Date,URLSearchParams,AbortSignal,
    fetch:async url=>({ok:true,json:async()=>String(url).includes('/especialidades')?[{id:'2'}]:String(url).includes('/profissionais/')?[{id:'1'}]:[{hours}]})
  });
  const discovered=await discovery({month:'2026-10',today:'2026-10-30',discoverAll:true,jobs:[]});
  assert.equal(discovered.professionals,1);
  assert.equal(discovered.appointments.attended,2);
  process.stdout.write('Monthly Amei status aggregation: OK\n');
})().catch(e=>{process.stderr.write(String(e));process.exitCode=1});
