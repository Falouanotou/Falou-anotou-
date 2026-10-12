const assert=require('node:assert/strict');
const P=require('./receipt-parser.js');
const sample=`MERCADO CENTRAL LTDA
CNPJ: 12.345.678/0001-90
DANFE NFC-e
CODIGO DESCRICAO QTD UN VL UN VL TOTAL
001 ARROZ TIPO 1 1KG 2 UN x 5,49 10,98
002 LEITE INTEGRAL 1L 1 UN x 6,99 6,99
QTD TOTAL DE ITENS 2
VALOR TOTAL R$ 17,97
FORMA PAGAMENTO PIX 17,97
DATA DE EMISSAO: 11/10/2026 12:30`;
let result=P.parse(sample);
assert.equal(result.merchant,'MERCADO CENTRAL LTDA');
assert.equal(result.date,'2026-10-11');
assert.equal(result.amount,17.97);
assert.equal(result.items.length,2);
assert.deepEqual(result.items[0],{name:'ARROZ TIPO 1 1KG',quantity:2,total:10.98,unit:'UN',unitPrice:5.49});
assert.equal(result.items[1].total,6.99);
assert.equal(result.warnings.length,0);
assert.equal(P.money('R$ 1.234,56'),1234.56);
assert.equal(P.money('1.234,50'),1234.5);
result=P.parse('Padaria Boa Mesa\n01 PAO FRANCES 0,500 KG x 19,90 9,95\nValor a pagar R$ 9,95\nEmissão 10/10/2026');
assert.equal(result.amount,9.95);
assert.equal(result.items[0].total,9.95);
assert.equal(result.date,'2026-10-10');
result=P.parse('FARMACIA SOL\nvalor total R$ 39,90\n10/10/2026');
assert.equal(result.amount,39.90);
assert.equal(result.items.length,0);
assert.ok(result.warnings.find(x=>x.includes('Itens')));
console.log('Testes de interpretação de nota: OK');
for(const bad of ['-35','R$ -10,00','1,2,3','12abc','1.234.56',''])assert.equal(P.money(bad),null,bad);
assert.equal(P.money('1250.90'),1250.9);
assert.equal(P.money('2.500'),2500);
result=P.parse('MERCADO TESTE\n001 LEITE INTEGRAL 1L 2 UN x 7,00 14,00\n002 ARROZ 5KG 10,00\nDesconto R$ 2,00\nValor a pagar\n22,00\nEmissão: 31/02/2026');
assert.equal(result.date,null);
assert.equal(result.amount,22);
assert.equal(result.discount,2);
assert.equal(result.items[1].quantity,null);
assert.equal(result.items[1].unitPrice,null);
result=P.parse('MERCADO TESTE\n001 PAO FRANCES\n0,500 KG x 20,00 10,00\nVALOR TOTAL R$ 10,00\n11/10/2026');
assert.equal(result.items[0].quantity,.5);
assert.equal(result.items[0].unit,'KG');
assert.equal(result.items[0].unitPrice,20);
result=P.parse('MERCADO TESTE\n001 LEITE 2 UN x 7,00 12,00\nValor total R$ 12,00');
assert.equal(result.items[0].total,12);
assert.equal(result.items[0].unitPrice,7);
console.log('Casos adicionais: moeda, desconto, quantidade ausente, data inválida e itens em duas linhas: OK');
