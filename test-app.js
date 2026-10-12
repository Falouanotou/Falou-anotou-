'use strict';
// Regression tests for existing finance/OCR UI functions. Account transport is a fixture here,
// not a login mechanism. The application has no simulated authentication mode.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const P=require('./receipt-parser'),Q=require('./finance-query'),{validateEntry}=require('./server/ledger-schema');
function harness(initial=[]){
  const nodes=new Map(),original=JSON.stringify(initial);let remote=initial.map(validateEntry),revision=0,fail=false,writes=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{},hidden:true,checked:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},focus(){},replaceChildren(){},events:{},addEventListener(name,fn){this.events[name]=fn;}});return nodes.get(id);};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[new Date(2026,9,11,12).getTime()]));}static now(){return new Date(2026,9,11,12).getTime();}}
  let context;
  const transport={async changes(body){writes++;assert.ok(!('user_id'in body));if(fail)throw Error('Falha de transporte de teste');assert.equal(body.revision,revision);const next=remote.filter(e=>!body.removeIds.includes(e.id));let added=0,skipped=0;for(const raw of body.additions){const e=validateEntry(raw),old=next.find(x=>x.id===e.id);if(old){if(JSON.stringify(old)!==JSON.stringify(e))throw Error('Conflito');skipped++;}else{next.push(e);added++;}}remote=next;revision++;return {entries:remote,revision,added,skipped};},get user(){return {id:'fixture-user',email:'fictional@example.invalid'};}};
  context=vm.createContext({Date:Clock,console,crypto:require('node:crypto').webcrypto,ReceiptParser:P,FinanceQuery:Q,AccountAPI:transport,Intl,URL,Blob,setTimeout:()=>1,clearTimeout(){},location:{protocol:'https:',hostname:'fixture.invalid'},navigator:{},document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:()=>original,setItem(){throw Error('Não deve escrever dados locais');}},window:{isSecureContext:true,ReceiptParser:P,matchMedia:()=>({matches:false}),addEventListener(){},confirm:()=>true}});
  const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');vm.runInContext(source.slice(0,source.indexOf("$('readAloud').checked=false;")),context);
  const run=s=>vm.runInContext(s,context);run('entries='+JSON.stringify(remote)+';cloudRevision=0');run('renderAll()');
  return {run,node,context,get remote(){return remote;},get writes(){return writes;},setFail:value=>{fail=value;}};
}
(async()=>{
 const old={id:'legacy',type:'expense',amount:35,date:'2026-10-10',merchant:'Padaria',category:'Alimentação'};let h=harness([old]);
 for(const[text,amount]of [['Gastei 35 reais na padaria.',35],['Paguei 180 reais no supermercado ontem.',180],['Recebi 2.500 reais de salário.',2500],['Paguei R$ 1.250,90 na farmácia',1250.9],['Gastei trinta e cinco reais no mercado',35]])assert.equal(h.run(`parseCommand(${JSON.stringify(text)}).entry.amount`),amount);
 assert.equal(h.run(`parseCommand('Paguei 180 reais no supermercado ontem.').entry.date`),'2026-10-10');assert.equal(h.run(`parseCommand('Paguei 35 reais no dia 31/02/2026').entry.date`),'');assert.equal(h.run(`parseCommand('Gastei -35 reais na padaria').kind`),'invalid');
 h.setFail(true);assert.equal(await h.run(`addRecord({type:'income',amount:10,date:'2026-10-11'})`),false);assert.equal(h.run('entries.length'),1);assert.equal(h.remote.length,1);assert.equal(h.run('cloudNeedsRefresh'),true);
 h.node('reviewAmount').value='10';h.node('reviewDate').value='2026-10-11';h.node('reviewType').value='income';h.node('reviewDialog').open=true;await h.node('reviewForm').events.submit({preventDefault(){}});assert.equal(h.node('reviewDialog').open,true);
 h=harness([old]);assert.equal(await h.run(`addRecord({type:'income',amount:2500,date:'2026-10-11',category:'Salário'})`),true);assert.equal(h.remote.length,2);assert.equal(h.remote[0].id,'legacy');
 vm.runInContext(fs.readFileSync(path.join(__dirname,'receipt-ui.js'),'utf8'),h.context);h.node('receiptManualBtn').events.click();assert.equal(h.node('receiptDate').value,'');
 h.node('receiptRawText').value='MERCADO TESTE\n001 LEITE 2 UN x 7,00 14,00\n002 ARROZ 8,00\nDESCONTO R$ 2,00\nVALOR A PAGAR R$ 20,00\n11/10/2026';h.node('receiptReparseBtn').events.click();assert.equal(h.node('receiptAmount').value,'20.00');assert.ok(h.node('receiptUnitPrices').textContent.includes('7,00'));await h.node('receiptForm').events.submit({preventDefault(){}});assert.equal(h.remote.length,3);assert.equal(h.remote[2].items[1].quantity,null);assert.equal(h.remote[2].amount,20);
 h.run('renderAll()');assert.ok(h.node('expenseValue').textContent.includes('55,00'));assert.ok(Q.answer('Quanto gastei com leite nos últimos três meses?',h.remote,new Date(2026,9,11)).message.includes('14,00'));
 assert.ok(Q.answer('Onde comprei o arroz mais barato?',h.remote,new Date(2026,9,11)).message.includes('suficientes'));assert.equal(Q.period('últimos três meses',new Date(2026,0,11)).start,'2025-11-01');
 h.context.downloads=[];h.run('downloadFile=(name,content,mime)=>downloads.push({name,content,mime});exportBackup();exportCSV()');assert.equal(JSON.parse(h.context.downloads[0].content).entries.length,3);assert.equal(h.context.downloads[1].content.split('\r\n').length,4);
 const backup=JSON.stringify({entries:h.remote});await h.run(`importBackup({size:100,text:async()=>${JSON.stringify(backup)}})`);assert.equal(h.remote.length,3);
 console.log('OK: regressões financeiras, revisão/OCR, async confirmado pelo servidor, falha sem fechamento, backup/importação e consulta. Transporte de conta é fixture de teste; autenticação real não foi simulada na aplicação.');
})().catch(error=>{console.error(error);process.exitCode=1;});
