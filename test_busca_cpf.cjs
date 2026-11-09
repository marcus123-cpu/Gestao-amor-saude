// Testa a busca de paciente e a formatacao de CPF/telefone usando o codigo que vai pro ar,
// extraido direto de app.js e operations.js.
const fs = require('fs');
const assert = require('assert');

const pegar = (arquivo, regex, nome) => {
  const m = fs.readFileSync(arquivo, 'utf8').match(regex);
  if (!m) throw new Error('nao achei ' + nome + ' em ' + arquivo);
  return m[0];
};

const codigo = [
  pegar('app.js', /^const soDigitos = .*$/m, 'soDigitos'),
  pegar('app.js', /^const formatCpf = .*$/m, 'formatCpf'),
  pegar('app.js', /^const formatPhone = .*$/m, 'formatPhone'),
  pegar('operations.js', /^function casaPaciente\(r, q\)\{[\s\S]*?\n\}/m, 'casaPaciente'),
].join('\n');
const { soDigitos, formatCpf, formatPhone, casaPaciente } =
  new Function(codigo + '\nreturn {soDigitos, formatCpf, formatPhone, casaPaciente};')();

const paciente = {name: 'MARIA JULIA DILL DA COSTA', cpf: '40510261833'};
const busca = q => casaPaciente(paciente, q.toLocaleLowerCase('pt-BR'));

// O jeito que a Jessica digita, direto do Amei
assert.ok(busca('405.102.618-33'), 'CPF pontuado tem de achar');
assert.ok(busca('40510261833'), 'CPF so numeros tem de achar');
assert.ok(busca('405.102'), 'CPF parcial pontuado tem de achar');
assert.ok(busca('405102'), 'CPF parcial tem de achar');
assert.ok(busca('618-33'), 'final do CPF tem de achar');
assert.ok(busca('maria julia'), 'nome tem de achar');
assert.ok(busca(''), 'busca vazia mostra todo mundo');

// Nao pode achar quem nao e
assert.ok(!busca('999.999.999-99'), 'CPF de outra pessoa nao pode achar');
assert.ok(!busca('joao'), 'outro nome nao pode achar');
assert.ok(!casaPaciente({name: 'Fulano', cpf: ''}, '405'), 'paciente sem CPF nao casa por numero');

// Formatacao na tela
assert.strictEqual(formatCpf('40510261833'), '405.102.618-33');
assert.strictEqual(formatCpf(''), 'não informado');
assert.strictEqual(formatCpf('123'), '123', 'CPF fora do padrao aparece como veio');
assert.strictEqual(formatPhone('17996026332'), '(17) 99602-6332');
assert.strictEqual(formatPhone('1733334444'), '(17) 3333-4444');
assert.strictEqual(formatPhone(''), '');

console.log('Busca por CPF e formatacao: OK');

// fullDate nao pode devolver "Invalid Date" quando a API manda algo fora do padrao.
const fullDate = new Function(pegar('app.js', /^const fullDate = .*$/m, 'fullDate') + '\nreturn fullDate;')();
assert.strictEqual(fullDate('2026-11-05'), '05/11/2026');
assert.strictEqual(fullDate(''), '');
assert.strictEqual(fullDate(null), '');
assert.strictEqual(fullDate('05/11/2026'), '05/11/2026', 'data ja pontuada passa direto');
console.log('Datas em dia/mes/ano: OK');
