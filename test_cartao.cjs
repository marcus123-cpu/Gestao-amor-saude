// Testa a classificacao do Cartao de Todos com o codigo que vai pro ar, extraido
// de amei_cartao.js. As respostas abaixo sao as que o Amei devolveu de verdade.
const fs = require('fs');
const assert = require('assert');

const fonte = fs.readFileSync('amei_cartao.js', 'utf8');
const pegar = (regex, nome) => {
  const m = fonte.match(regex);
  if (!m) throw new Error('nao achei ' + nome);
  return m[0];
};
const codigo = [
  pegar(/^\s*const semAcento = .*$/m, 'semAcento'),
  pegar(/^\s*const classificar = resposta => \{[\s\S]*?\n  \};/m, 'classificar'),
].join('\n');
const classificar = new Function(codigo + '\nreturn classificar;')();

// Verde: 200 com ativo true.
const ativo = classificar({ok:true, status:200, corpo:{ativo:true, matricula:'SP493021247'}});
assert.strictEqual(ativo.situacao, 'ativo');
assert.strictEqual(ativo.matricula, 'SP493021247');

// Vermelho por inadimplencia - resposta real do Amei.
const devendo = classificar({ok:false, status:400, corpo:{codigo:400, flagDeError:true,
  mensagem:'Situação financeira inativa ou inadimplente no sistema Cartão de Todos'}});
assert.strictEqual(devendo.situacao, 'devendo');
assert.ok(devendo.mensagem.includes('inadimplente'));

// Vermelho por nao ter cartao - resposta real do Amei.
const semCartao = classificar({ok:false, status:400, corpo:{codigo:404, flagDeError:true,
  mensagem:'Matrícula não existe no sistema Cartão de Todos.'}});
assert.strictEqual(semCartao.situacao, 'sem_cartao');

// Falha de comunicacao nao pode virar "sem cartao": seria acusar o paciente a toa.
for (const caso of [
  {ok:false, status:500, corpo:null},
  {ok:false, status:400, corpo:{mensagem:'CDT ERR_BAD_REQUEST: (Bad Request)'}},
  {ok:true, status:200, corpo:{ativo:false}},
]) {
  const r = classificar(caso);
  assert.notStrictEqual(r.situacao, 'sem_cartao', 'erro de comunicacao virou sem_cartao: ' + JSON.stringify(caso));
  assert.notStrictEqual(r.situacao, 'ativo', 'resposta sem ativo:true nao pode passar como ativa');
}

// ativo diferente de true nunca conta como cartao valido.
for (const valor of ['true', 1, null, undefined, 'sim']) {
  assert.notStrictEqual(classificar({ok:true, status:200, corpo:{ativo:valor}}).situacao, 'ativo',
    'ativo=' + String(valor) + ' nao pode passar como ativo');
}

// A leitura ignora acento e caixa na mensagem.
assert.strictEqual(classificar({ok:false, status:400, corpo:{mensagem:'MATRICULA NAO EXISTE no sistema'}}).situacao, 'sem_cartao');
assert.strictEqual(classificar({ok:false, status:400, corpo:{mensagem:'situacao FINANCEIRA INATIVA'}}).situacao, 'devendo');

console.log('Classificacao do Cartao de Todos: OK');
