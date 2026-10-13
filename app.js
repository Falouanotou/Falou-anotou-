/* Falou, Anotou! — dados locais, sem acesso bancário; OCR opcional do navegador. */
'use strict';
const STORAGE_KEY = 'falou-anotou-ledger-v1';
const CATEGORIES = ['Alimentação', 'Supermercado', 'Transporte', 'Saúde', 'Casa', 'Compras', 'Lazer', 'Educação', 'Contas', 'Salário', 'Outros'];
const ICONS = {'Alimentação':'◕','Supermercado':'▦','Transporte':'↗','Saúde':'✚','Casa':'⌂','Compras':'◈','Lazer':'✦','Educação':'▤','Contas':'▥','Salário':'↗','Outros':'•'};
const CATEGORY_KEYWORDS = [
  ['Supermercado', ['supermercado','mercado','mercadinho','mercearia','feira','hortifruti','atacadao','assai','carrefour']],
  ['Transporte', ['gasolina','combustivel','etanol','posto','uber','99 pop','taxi','onibus','passagem','estacionamento','pedagio','corrida de carro','moto taxi']],
  ['Saúde', ['farmacia','remedio','medicamento','consulta','dentista','hospital','exame','laboratorio','drogaria']],
  ['Casa', ['aluguel','condominio','reforma','material de construcao','moveis','sofá','geladeira','armario','pedreiro']],
  ['Educação', ['escola','colegio','faculdade','curso','livro didatico','material escolar','mensalidade escolar']],
  ['Contas', ['internet','energia','luz','agua','boleto','telefone','celular','assinatura','netflix','spotify','fatura']],
  ['Alimentação', ['almoço','almoco','janta','jantar','lanche','cafe','padaria','restaurante','pizza','hamburguer','sorvete','ifood','delivery','comida']],
  ['Lazer', ['cinema','show','festa','viagem','passeio','parque','ingresso','jogo']],
  ['Compras', ['roupa','sapato','tenis','camiseta','calca','vestido','presente','shopee','amazon','mercado livre','loja']]
];
const $ = id => document.getElementById(id);
const currency = n => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(Number(n)||0);
const shortDate = ymd => { const [y,m,d] = ymd.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}); };
const normalize = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const today = () => localYMD(new Date());
const localYMD = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const escapeHtml = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storageProblem='', originalStored='', recoveryExported=false;
let entries = [], cloudRevision=0, cloudWrite=false, cloudNeedsRefresh=false;
let recognition = null, listening = false, latestFinalSpeech = '', toastTimer = null;

function readStored(){
  try {
    originalStored=localStorage.getItem(STORAGE_KEY)||'[]';
    const data=JSON.parse(originalStored);
    if(!Array.isArray(data)||!data.every(validEntry))throw Error('Dados inválidos');
    return data.map(sanitizeEntry);
  }catch {
    storageProblem='Não foi possível ler seus registros com segurança. O original foi preservado. Exporte-o para recuperação ou importe um backup válido.';
    return [];
  }
}
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number),check=new Date(y,m-1,d);
  return y>=1900&&y<=2100&&check.getFullYear()===y&&check.getMonth()===m-1&&check.getDate()===d;
}
function validEntry(e){return !!(e&&['expense','income'].includes(e.type)&&typeof e.amount!=='boolean'&&String(e.amount).trim()!==''&&Number.isFinite(Number(e.amount))&&Number(e.amount)>0&&Number(e.amount)<1e9&&validDate(e.date)&&(!e.items||Array.isArray(e.items)&&e.items.length<=80&&e.items.every(i=>i&&typeof i.name==='string'&&i.name.trim()&&i.name.length<=95&&Number.isFinite(Number(i.total))&&Number(i.total)>0&&Number(i.total)<1e9&&(i.quantity==null||Number.isFinite(Number(i.quantity))&&Number(i.quantity)>0&&Number(i.quantity)<=10000))));}

function sanitizeEntry(e){
  const items=(e.items||[]).map(i=>({name:String(i.name).trim(),quantity:i.quantity==null?null:Number(i.quantity),total:Math.round(Number(i.total)*100)/100,unit:String(i.unit||'').slice(0,10),unitPrice:i.unitPrice!=null&&Number.isFinite(Number(i.unitPrice))&&Number(i.unitPrice)>=0?Number(i.unitPrice):null}));
  return {...e,id:String(e.id||crypto.randomUUID()),type:e.type,amount:Math.round(Number(e.amount)*100)/100,date:e.date,merchant:String(e.merchant||'').slice(0,100),description:String(e.description||'').slice(0,200),category:typeof e.category==='string'&&e.category.length<=60?e.category:'Outros',createdAt:String(e.createdAt||new Date().toISOString()),demo:!!e.demo,source:e.source==='receipt'?'receipt':'manual',items,receiptId:String(e.receiptId||'').slice(0,44),discount:e.discount!=null?ReceiptParser.money(e.discount):null,surcharge:e.surcharge!=null?ReceiptParser.money(e.surcharge):null};
}
async function commit(next){
  if(cloudNeedsRefresh){showToast('Recarregue e confira o histórico antes de tentar salvar novamente.');return false;}
  if(cloudWrite){showToast('Aguarde a gravação atual terminar.');return false;}
  cloudWrite=true;
  try {
    const old=new Map(entries.map(e=>[e.id,e])),ids=new Set(next.map(e=>e.id));
    const additions=next.filter(e=>!old.has(e.id)),removeIds=entries.filter(e=>!ids.has(e.id)).map(e=>e.id);
    if(next.some(e=>old.has(e.id)&&JSON.stringify(e)!==JSON.stringify(old.get(e.id))))throw Error('Alteração de registro não permitida neste fluxo. Revise ou importe um backup válido.');
    const result=await AccountAPI.changes({revision:cloudRevision,additions,removeIds});
    entries=result.entries.map(sanitizeEntry);cloudRevision=result.revision;return true;
  }catch(error){cloudNeedsRefresh=true;showToast(error.message||'Não confirmei a gravação. Recarregue e confira o histórico antes de tentar novamente.');return false;}
  finally{cloudWrite=false;}
}
function showToast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3300);}
function dateFromPhrase(raw){
  const text=normalize(raw),d=new Date();
  if(/\banteontem\b/.test(text))d.setDate(d.getDate()-2);else if(/\bontem\b/.test(text))d.setDate(d.getDate()-1);
  const match=raw.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if(match){let year=match[3]?Number(match[3]):d.getFullYear();if(year<100)year+=2000;const date=`${year}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;return validDate(date)?date:'';}
  if(/\b(mes passado|semana passada|ano passado|no dia|em setembro|em outubro|amanha)\b/.test(text))return '';
  return localYMD(d);
}
function parseBRNumber(s){return ReceiptParser.money(s);}
const UNITS={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,duzentas:200,trezentos:300,trezentas:300,quatrocentos:400,quatrocentas:400,quinhentos:500,quinhentas:500,seiscentos:600,seiscentas:600,setecentos:700,setecentas:700,oitocentos:800,oitocentas:800,novecentos:900,novecentas:900};
function wordsToNumber(raw){const words=normalize(raw).replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean);let total=0,group=0,seen=false;
  for(const word of words){if(word==='e')continue;if(word==='mil'){seen=true;total+=(group||1)*1000;group=0;continue;}if(Object.prototype.hasOwnProperty.call(UNITS,word)){seen=true;group+=UNITS[word];}else return null;}
  return seen?total+group:null;
}
function extractAmount(raw){
  if(/(?:R\$\s*)?-\s*\d/.test(raw))return null;
  const t=normalize(raw), num='(\\d+(?:[.,]\\d+)*)';
  const patterns=[new RegExp('(?:r\\$)\\s*'+num,'i'),new RegExp('(?:\\bpor\\s+)'+num+'\\b','i'),new RegExp('\\b'+num+'\\s*(?:reais?|conto(?:s)?)\\b','i'),new RegExp('\\b(?:gastei|paguei|recebi|ganhei|custou|entrou|depositei|vendi|comprei|faturei)\\s+(?:mais\\s+de\\s+)?'+num+'\\b','i')];
  for(const rx of patterns){const m=t.match(rx);if(m){let amount=parseBRNumber(m[1]);
    const rest=t.slice((m.index||0)+m[0].length);
    const centsMatch=rest.match(/^(?:\s+reais?)?\s+e\s+([a-z\d\s]+?)\s+centavos?\b/);
    if(centsMatch){const centsText=centsMatch[1].trim();const cents=/^\d+$/.test(centsText)?Number(centsText):wordsToNumber(centsText);if(cents!==null&&Number.isFinite(cents)&&cents>=0&&cents<=99)amount+=cents/100;}
    if(amount!==null&&Number.isFinite(amount)&&amount>0&&amount<1e9)return Math.round(amount*100)/100;}}
  const reais=t.match(/([a-z\s]+)\s+reais?(?:\s+e\s+([a-z\s]+?)\s+centavos?)?/);
  if(reais){const numberWords=(reais[1]||'').split(/\b(?:gastei|paguei|recebi|ganhei|comprei|faturei|entrou|por|de|em|na|no|com|do|da|uns|mais|menos)\b/).pop();const whole=wordsToNumber(numberWords);const cents=reais[2]?wordsToNumber(reais[2]):0;if(whole!==null&&cents!==null&&cents>=0&&cents<100)return whole+cents/100;}
  return null;
}
function guessCategory(raw, type){if(type==='income'){return /salario|salário|pagamento do trabalho|pagamento da empresa/i.test(raw)?'Salário':'Outros';}
  const text=normalize(raw);for(const [category,words] of CATEGORY_KEYWORDS){if(words.some(word=>text.includes(normalize(word))))return category;}return 'Outros';}
function extractMerchant(raw){
  const text=String(raw).trim();
  const m=text.match(/\b(?:na|no|nos|nas|pela|pelo|ao|em|da|do)\s+([\p{L}\d][\p{L}\d\s\-&'.]{0,70})/iu);
  if(!m)return '';
  let value=m[1].replace(/\s+(?:hoje|ontem|anteontem|agora|pela manh[aã]|a tarde|a noite|por|pagando|que|em dinheiro|com pix|no pix|no cart[aã]o|esse m[eê]s|este m[eê]s|m[eê]s passado|no dia)\b.*$/i,'').trim();
  if(/^(pix|cart[aã]o|cr[eé]dito|d[eé]bito|dinheiro|janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/i.test(value))return '';
  return value.slice(0,100);
}
function looksLikeQuestion(raw){const t=normalize(raw);return /\?|^(quanto|quantos|quanta|qual|quais|mostra|mostrar|me mostra|me diga|me conta|liste|listar|resumo|total|quanto foi|onde|quando|em qual|busca|buscar|procura|procure|pesquisa|pesquisar|quanto que|quanto e|quero saber)\b/.test(t)||(/\b(gastei|gastos|despesas|receitas|saldo)\b/.test(t)&&/\b(mes|semana|ano)\b/.test(t)&&extractAmount(raw)===null);}
function parseCommand(raw){const text=String(raw||'').trim();if(!text)return {kind:'invalid',message:'Conte uma despesa, receita ou faça uma pergunta.'};
  if(looksLikeQuestion(text))return {kind:'query',raw:text};
  if((text.match(/\b(gastei|paguei|recebi|ganhei|comprei|vendi)\b/gi)||[]).length>1)return {kind:'invalid',message:'Registre uma operação por vez para conferir cada valor.'};
  if((text.match(/(?:R\$\s*\d+(?:[.,]\d+)*|\b\d+(?:[.,]\d+)*\s+reais?\b)/gi)||[]).length>1)return {kind:'invalid',message:'Identifiquei mais de um valor. Informe o total pago em uma frase por vez.'};
  const amount=extractAmount(text);
  if(amount===null)return {kind:'invalid',message:'Não consegui identificar o valor. Tente “gastei 35 reais no mercado” ou informe o valor manualmente.'};
  const income=/\b(recebi|ganhei|caiu na conta|sal[aá]rio|pagamento recebido|me pagaram|depositaram|faturei|vendi|entrou dinheiro|entrada de)\b/i.test(text);
  const type=income?'income':'expense';
  return {kind:'record',entry:{type,amount,date:dateFromPhrase(text),merchant:extractMerchant(text),description:text,category:guessCategory(text,type)}};
}
function processCommand(text){const parsed=parseCommand(text);if(parsed.kind==='invalid'){showToast(parsed.message);return;}$('commandInput').value='';if(parsed.kind==='record'){openReview(parsed.entry);return;}answerQuery(parsed.raw);}
function openReview(entry){$('reviewType').value=entry.type;$('reviewAmount').value=entry.amount.toFixed(2);$('reviewDate').value=entry.date;$('reviewMerchant').value=entry.merchant;$('reviewDescription').value=entry.description;$('reviewCategory').value=entry.category;$('reviewDialog').showModal();}
function duplicateRecord(e){return entries.find(x=>e.receiptId&&x.receiptId===e.receiptId)||entries.find(x=>x.type===e.type&&x.date===e.date&&Math.round(x.amount*100)===Math.round(e.amount*100)&&normalize(x.merchant)===normalize(e.merchant));}
async function addRecord(e){
  if(!validEntry(e)){showToast('Confira valor, data e produtos antes de salvar.');return false;}
  const duplicate=duplicateRecord(e);
  if(duplicate){
    if(e.receiptId&&duplicate.receiptId===e.receiptId){showToast('Esta nota fiscal já está registrada. Nenhuma compra foi adicionada.');return false;}
    if(!window.confirm('Já existe um lançamento com a mesma data, loja e valor. É outra compra? Confirme apenas se forem compras diferentes.'))return false;
  }
  if(await commit([...entries,sanitizeEntry({...e,id:crypto.randomUUID(),createdAt:new Date().toISOString()})])){renderAll();showToast('Lançamento salvo. Você pode consultá-lo por voz.');return true;}return false;
}
const MONTHS=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function resolvePeriod(raw){return FinanceQuery.period(raw);}
function extractQuerySubject(raw){return FinanceQuery.subject(raw);}
function matchesSearchText(hay,subject){return FinanceQuery.matches(hay,subject);}
function matchesSubject(entry, subject){
  return !subject || matchesSearchText(`${entry.merchant} ${entry.description} ${entry.category}`,subject) || (entry.items||[]).some(i=>matchesSearchText(i.name,subject));
}
// Ao perguntar por um produto da nota, somar apenas esse produto, nao toda a compra.
function amountMatchingSubject(entry,subject){return (FinanceQuery.value(entry,subject)?.value||0)/100;}
function answerQuery(raw){
  const {message,detail}=FinanceQuery.answer(raw,entries);
  $('answerText').textContent=message;$('answerDetails').textContent=detail;$('answerDetails').style.whiteSpace='pre-line';$('answerCard').hidden=false;
  $('answerCard').scrollIntoView({block:'nearest',behavior:motionBehavior()});
  if($('readAloud').checked&&'speechSynthesis' in window){window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(message);utterance.lang='pt-BR';window.speechSynthesis.speak(utterance);}
}
function motionBehavior(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
function historyItems(e){
  if(!e.items?.length)return '';
  return `<details><summary>${e.items.length} produto(s) · ver detalhes</summary><ul>${e.items.map(i=>`<li>${escapeHtml(i.name)} · ${i.quantity==null?'quantidade não informada':escapeHtml(i.quantity+' '+(i.unit||''))} · total ${currency(i.total)}${i.unitPrice!=null?' · preço unitário lido '+currency(i.unitPrice):''}</li>`).join('')}</ul>${e.discount!=null?'Desconto geral: '+currency(e.discount)+'. ':''}${e.surcharge!=null?'Acréscimo geral: '+currency(e.surcharge)+'. ':''}</details>`;
}

function renderAll(){const now=new Date(),prefix=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-`;const monthly=entries.filter(e=>e.date.startsWith(prefix));
  const income=monthly.filter(e=>e.type==='income').reduce((sum,e)=>sum+Math.round(e.amount*100)/100,0);const expense=monthly.filter(e=>e.type==='expense').reduce((sum,e)=>sum+Math.round(e.amount*100)/100,0);
  $('monthName').textContent=now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});$('balanceValue').textContent=currency(income-expense);$('incomeValue').textContent=currency(income);$('expenseValue').textContent=currency(expense);
  const categories=new Map();for(const e of monthly.filter(e=>e.type==='expense'))categories.set(e.category,(categories.get(e.category)||0)+e.amount);
  const sorted=[...categories.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
  $('categoryBars').innerHTML=sorted.length?sorted.map(([name,val])=>`<div class="cat-row"><div class="cat-top"><span>${escapeHtml(name)}</span><strong>${currency(val)}</strong></div><div class="cat-track"><div class="cat-fill" style="width:${Math.min(100,val/(sorted[0][1]||1)*100).toFixed(1)}%"></div></div></div>`).join(''):'<p class="muted-empty">Ainda não há despesas registradas neste mês.</p>';
  const max=Math.max(income,expense,1);$('incomeBar').style.width=(income/max*100)+'%';$('expenseBar').style.width=(expense/max*100)+'%';$('monthChart').setAttribute('aria-label',`Receitas ${currency(income)}, despesas ${currency(expense)}. Mesma escala, somente total dos lançamentos.`);
  renderHistory();$('demoBtn').textContent=entries.some(e=>e.demo)?'Remover dados de exemplo':'Inserir dados de exemplo';
}
function renderHistory(){const search=normalize($('searchInput').value);const list=[...entries].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)).filter(e=>!search||normalize(`${e.merchant} ${e.description} ${e.category} ${(e.items||[]).map(i=>i.name).join(' ')} ${e.amount.toFixed(2).replace('.',',')} ${e.type==='income'?'receita':'despesa'}`).includes(search));
  $('recordCount').textContent=`${list.length} registro${list.length===1?'':'s'}`;
  $('historyList').innerHTML=list.length?list.map(e=>`<div class="entry"><span class="entry-icon" aria-hidden="true">${ICONS[e.category]||'•'}</span><div class="entry-info"><strong>${escapeHtml(e.merchant||e.category)}${e.demo?' <span style="font-size:10px;color:#829586">(exemplo)</span>':''}${e.source==='receipt'?' <span style="font-size:10px;color:#4b8866">(nota fiscal)</span>':''}</strong><small>${escapeHtml(e.category)} · ${shortDate(e.date)} · ${escapeHtml(e.description)}</small>${historyItems(e)}</div><strong class="entry-value ${e.type==='expense'?'out':''}">${e.type==='income'?'+':'−'} ${currency(e.amount)}</strong><button type="button" class="del-entry" data-id="${escapeHtml(e.id)}" aria-label="Excluir lançamento">×</button></div>`).join(''):`<div class="empty-history"><strong>${search?'Nenhum resultado encontrado':'Tudo começa com uma frase.'}</strong>${search?'Tente pesquisar outro termo.':'Experimente dizer: “Paguei 22 reais no almoço”.'}</div>`;
}
function downloadFile(name,content,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportBackup(){downloadFile(`falou-anotou-backup-${today()}.json`,JSON.stringify({app:'Falou, Anotou!',version:3,exportedAt:new Date().toISOString(),entries},null,2),'application/json;charset=utf-8');showToast('Backup JSON exportado. Guarde-o em um local seguro.');}
function exportCSV(){const fields=['date','type','amount','merchant','category','description','source','items'];const rows=[['data','tipo','valor_reais','local','categoria','descricao','origem','itens_da_nota'].join(';')];for(const e of entries){rows.push(fields.map(field=>{let s=field==='type'?(e.type==='income'?'receita':'despesa'):field==='amount'?e.amount.toFixed(2).replace('.',','):field==='items'?(e.items||[]).map(i=>i.name+' x '+(i.quantity??'?')+(i.unit?' '+i.unit:'')+' = '+currency(i.total)).join(' | '):String(e[field]||'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';'));}downloadFile(`falou-anotou-lancamentos-${today()}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8');}
async function importBackup(file){
  if(!file)return;
  try {
    if(file.size>16*1024*1024)throw Error('Backup maior que 16 MB.');
    const data=JSON.parse(await file.text()),imported=Array.isArray(data)?data:data.entries;
    if(!Array.isArray(imported)||imported.length>10000||!imported.every(validEntry))throw Error('Backup inválido. Nenhum registro foi alterado.');
    if(!window.confirm(`Importar ${imported.length} lançamento(s) para a conta ${AccountAPI.user.email}? O histórico existente será preservado; conflitos serão recusados.`))return;
    await importToAccount(imported);
  }catch(error){showToast(error instanceof SyntaxError?'Escolha um JSON válido.':error.message);}finally{$('importFile').value='';}
}
async function importToAccount(imported){
  if(cloudNeedsRefresh)throw Error('Recarregue e confira o histórico antes de importar novamente.');
  if(cloudWrite)throw Error('Aguarde a gravação atual terminar.');
  const similar=imported.filter(e=>entries.some(x=>x.id!==e.id&&x.type===e.type&&x.date===e.date&&Math.round(x.amount*100)===Math.round(Number(e.amount)*100)&&normalize(x.merchant)===normalize(e.merchant)));
  if(similar.length&&!window.confirm(`Há ${similar.length} lançamento(s) parecido(s) com compras existentes. IDs/chaves iguais não serão duplicados. Confirma que os demais são compras distintas?`))throw Error('Importação cancelada; as cópias foram preservadas.');
  cloudWrite=true;
  try{const result=await AccountAPI.changes({revision:cloudRevision,additions:imported,removeIds:[]});entries=result.entries.map(sanitizeEntry);cloudRevision=result.revision;renderAll();showToast(`${result.added} registro(s) importado(s); ${result.skipped} já existente(s). O original local foi preservado.`);return result;}catch(error){cloudNeedsRefresh=true;throw error;}finally{cloudWrite=false;}
}
async function toggleDemo(){if(entries.some(e=>e.demo)){if(!window.confirm('Remover somente os lançamentos fictícios de demonstração?'))return;if(await commit(entries.filter(e=>!e.demo))){renderAll();showToast('Dados fictícios removidos.');}return;}
  const demo=[{type:'expense',amount:48.9,merchant:'Mercado do Bairro',category:'Supermercado',description:'Comprei frutas e produtos no mercado',date:today()},{type:'expense',amount:32.5,merchant:'Restaurante Central',category:'Alimentação',description:'Gastei 32,50 no almoço',date:today()},{type:'expense',amount:79.9,merchant:'Farmácia Sempre Bem',category:'Saúde',description:'Paguei 79,90 na farmácia',date:today()},{type:'income',amount:1200,merchant:'Trabalho',category:'Salário',description:'Recebi pagamento de trabalho',date:today()}];
  if(await commit([...entries,...demo.map(e=>sanitizeEntry({...e,id:crypto.randomUUID(),createdAt:new Date().toISOString(),demo:true}))])){renderAll();showToast('Dados fictícios adicionados e marcados como exemplo.');}
}
// O reconhecimento de voz da Web Speech API pode depender do serviço remoto do navegador.
// O ditado do Windows (Win+H) oferece uma alternativa sem depender da Web Speech API.
function setVoiceHelp(title, message, expanded=true){
  $('voiceHelpTitle').textContent=title;
  $('voiceHelpText').textContent=message;
  $('voiceHelp').hidden=!expanded;
  $('voiceHelpToggle').setAttribute('aria-expanded',String(expanded));
}
function focusWindowsDictation(){
  $('commandInput').focus();
  setVoiceHelp('Ditado do sistema', 'Com o cursor no campo de texto, pressione Windows + H e fale a frase. O texto aparecerá no campo. Ao terminar, pressione Enter ou clique na seta verde. Em outros sistemas, você pode usar o ditado do teclado.');
  showToast('Campo selecionado. Use o ditado do teclado ou Windows + H.');
}
$('dictationBtn').addEventListener('click',focusWindowsDictation);
$('voiceHelpDictation').addEventListener('click',focusWindowsDictation);
$('voiceHelpToggle').addEventListener('click',()=>{
  const open=$('voiceHelp').hidden;
  setVoiceHelp('Como usar sua voz no computador','No Chrome ou Edge, permita o microfone para este site e execute o aplicativo em HTTPS ou http://localhost. Se o serviço de voz falhar, clique em “Preparar ditado do Windows” e pressione Windows + H. Esse atalho é do sistema operacional, não do site.',open);
});
$('voiceHelpClose').addEventListener('click',()=>{
  $('voiceHelp').hidden=true;
  $('voiceHelpToggle').setAttribute('aria-expanded','false');
});
function setupSpeech(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  let starting=false,failed=false,interimText='';
  const fallback=message=>{
    setVoiceHelp('Continue pelo campo de texto',message+' Você pode digitar ou usar o microfone do teclado do celular. No Windows, selecione o campo e pressione Windows + H.');
    $('commandInput').focus();
  };
  if(!Recognition||!window.isSecureContext){
    $('speechSupport').textContent=!window.isSecureContext?'Microfone precisa de HTTPS ou localhost':'Voz do navegador indisponível';
    $('micBtn').addEventListener('click',()=>fallback($('speechSupport').textContent+'.'));
    return;
  }
  try {recognition=new Recognition();}catch {fallback('Não consegui preparar o reconhecimento neste navegador.');return;}
  recognition.lang='pt-BR';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
  $('speechSupport').textContent='Toque no microfone para falar';
  recognition.onstart=()=>{
    starting=false;listening=true;
    $('micBtn').classList.add('listening');$('micBtn').setAttribute('aria-label','Parar reconhecimento de voz');
    $('voiceTitle').textContent='Estou ouvindo…';$('voiceHint').textContent='Fale uma frase. Toque novamente para encerrar.';
  };
  recognition.onresult=event=>{
    latestFinalSpeech='';interimText='';
    for(let i=0;i<event.results.length;i++){const text=event.results[i][0].transcript;if(event.results[i].isFinal)latestFinalSpeech+=text+' ';else interimText+=text+' ';}
    $('transcript').textContent=(latestFinalSpeech+interimText).trim();
  };
  recognition.onerror=event=>{
    failed=true;
    const messages={network:'O serviço de voz do Chrome/Edge não respondeu. Isso pode ocorrer mesmo com internet.',
      'not-allowed':'O acesso ao microfone foi bloqueado. Confira a permissão deste site no navegador.',
      'service-not-allowed':'O navegador bloqueou o serviço de voz.',
      'audio-capture':'Não consegui acessar o microfone. Confira o dispositivo selecionado.',
      'no-speech':'Não detectei sua fala. Tente novamente em um ambiente silencioso.',
      'language-not-supported':'O serviço não disponibilizou português do Brasil.',aborted:'A escuta foi interrompida.'};
    $('speechSupport').textContent='Voz indisponível · digite ou use o ditado do teclado';
    fallback(messages[event.error]||'Não consegui concluir a transcrição.');
  };
  recognition.onend=()=>{
    starting=false;listening=false;$('micBtn').classList.remove('listening');$('micBtn').setAttribute('aria-label','Começar reconhecimento de voz');
    $('voiceTitle').textContent='Toque e me conte';$('voiceHint').textContent='O que você comprou ou quer saber?';
    const spoken=latestFinalSpeech.trim(),partial=interimText.trim();latestFinalSpeech='';interimText='';
    if(failed){if(spoken||partial)$('commandInput').value=[spoken,partial].filter(Boolean).join(' ');return;}
    if(spoken){$('speechSupport').textContent='Frase reconhecida · confira antes de salvar';$('voiceHelp').hidden=true;$('voiceHelpToggle').setAttribute('aria-expanded','false');processCommand(spoken);}
    else if(partial){$('commandInput').value=partial;fallback('A frase ficou incompleta. Revise o texto e toque na seta.');}
  };
  $('micBtn').addEventListener('click',()=>{
    if(starting)return;
    try {if(listening){recognition.stop();return;}failed=false;latestFinalSpeech='';interimText='';$('transcript').textContent='';starting=true;recognition.start();}
    catch {starting=false;failed=true;fallback('Não consegui iniciar a escuta. Confira a permissão do microfone.');}
  });
  window.addEventListener('pagehide',()=>{failed=true;if(listening||starting)recognition.abort();});
}
$('commandForm').addEventListener('submit',event=>{event.preventDefault();processCommand($('commandInput').value);});
for(const btn of document.querySelectorAll('.example'))btn.addEventListener('click',()=>processCommand(btn.dataset.command));
$('reviewForm').addEventListener('submit',async event=>{event.preventDefault();const amount=Number($('reviewAmount').value);const date=$('reviewDate').value;if(!Number.isFinite(amount)||amount<=0||amount>=1e9||!validDate(date)){showToast('Confira o valor e a data.');return;}
  if(await addRecord({type:$('reviewType').value,amount,date,merchant:$('reviewMerchant').value.trim(),category:$('reviewCategory').value,description:$('reviewDescription').value.trim()}))$('reviewDialog').close();});
$('cancelReview').addEventListener('click',()=>$('reviewDialog').close());$('backReview').addEventListener('click',()=>$('reviewDialog').close());
$('closeAnswer').addEventListener('click',()=>{$('answerCard').hidden=true;if('speechSynthesis' in window)window.speechSynthesis.cancel();});
$('searchInput').addEventListener('input',renderHistory);
$('historyList').addEventListener('click',async event=>{const b=event.target.closest('[data-id]');if(!b)return;const item=entries.find(e=>e.id===b.dataset.id);if(item&&window.confirm(`Excluir o lançamento de ${currency(item.amount)} (${item.merchant||item.category})?`)){if(await commit(entries.filter(e=>e.id!==item.id))){renderAll();showToast('Lançamento excluído.');}}});
$('exportBtn').addEventListener('click',()=>{if(window.confirm('Exportar também uma planilha CSV após o backup JSON?')){exportBackup();exportCSV();}else exportBackup();});
$('importBtn').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',event=>importBackup(event.target.files[0]));
$('demoBtn').addEventListener('click',toggleDemo);
$('readAloud').checked=false;
const accountMenuToggle=$('accountMenuToggle'),accountToolbar=$('accountToolbar'),accountMenuTopbar=accountMenuToggle.closest('.topbar');
function setAccountMenuOpen(open){accountMenuTopbar.dataset.accountMenuOpen=String(open);accountMenuToggle.setAttribute('aria-expanded',String(open));accountMenuToggle.setAttribute('aria-label',open?'Fechar menu da conta':'Abrir menu da conta');}
accountMenuToggle.addEventListener('click',()=>setAccountMenuOpen(accountMenuTopbar.dataset.accountMenuOpen!=='true'));
document.addEventListener('click',event=>{if(accountMenuTopbar.dataset.accountMenuOpen==='true'&&!accountMenuTopbar.contains(event.target))setAccountMenuOpen(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&accountMenuTopbar.dataset.accountMenuOpen==='true'){setAccountMenuOpen(false);accountMenuToggle.focus();}});
accountToolbar.addEventListener('click',event=>{if(event.target.closest('a,button'))setAccountMenuOpen(false);});
let legacyReceipt=null;
function legacyRaw(){try{return localStorage.getItem(STORAGE_KEY);}catch{return null;}}
function showLegacy(){const raw=legacyRaw();$('legacyMigration').hidden=!raw||raw==='[]';}
$('legacyExportBtn').addEventListener('click',()=>{const raw=legacyRaw();if(raw)downloadFile('falou-anotou-original-local.json',raw,'application/json');});
$('legacyImportBtn').addEventListener('click',async()=>{
  const raw=legacyRaw();
  try {const data=JSON.parse(raw);if(!Array.isArray(data)||!data.every(validEntry))throw Error('A cópia antiga contém campos inválidos. Exporte o original e corrija uma cópia antes de importar.');
    if(!window.confirm(`Estes registros são seus? Importar ${data.length} lançamento(s) deste aparelho para ${AccountAPI.user.email}? Nada será apagado localmente.`))return;
    await importToAccount(data);legacyReceipt={raw,userId:AccountAPI.user.id};$('legacyRemoveBtn').hidden=false;
  }catch(error){showToast(error.message);}
});
$('legacyRemoveBtn').addEventListener('click',()=>{
  if(!legacyReceipt||legacyReceipt.userId!==AccountAPI.user.id||legacyRaw()!==legacyReceipt.raw){showToast('A cópia local mudou. Importe e confirme novamente antes de removê-la.');return;}
  if(!window.confirm('A importação foi confirmada pelo servidor. Você guardou seu backup? Remover somente a cópia antiga deste navegador?'))return;
  try{localStorage.removeItem(STORAGE_KEY);legacyReceipt=null;showLegacy();showToast('Somente a cópia antiga local foi removida.');}catch{showToast('Não consegui remover a cópia local.');}
});
$('accountLogout').addEventListener('click',()=>AccountAPI.logout().catch(error=>showToast(error.message)));
$('readAloud').addEventListener('change',async()=>{try{await AccountAPI.call('/api/account',{readAloud:$('readAloud').checked});}catch(error){$('readAloud').checked=!$('readAloud').checked;showToast(error.message);}});
document.addEventListener('fa:private-clear',()=>{
  entries=[];cloudRevision=0;legacyReceipt=null;$('historyList').replaceChildren();$('answerCard').hidden=true;$('answerText').textContent='';$('commandInput').value='';$('searchInput').value='';$('transcript').textContent='';
  if($('reviewDialog').open)$('reviewDialog').close();
  if(recognition){try{recognition.abort();}catch{}}
  if('speechSynthesis'in window)window.speechSynthesis.cancel();
});
(async()=>{
  try{
    const result=await AccountAPI.initialize();entries=result.ledger.entries.map(sanitizeEntry);cloudRevision=result.ledger.revision;
    for(const category of result.account.categories)if(!CATEGORIES.includes(category))CATEGORIES.push(category);
    for(const id of ['reviewCategory','receiptCategory'])$(id).innerHTML=CATEGORIES.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    $('readAloud').checked=result.account.readAloud;$('accountDisplay').textContent=result.account.name||result.user.email;
    for(const id of ['termsAccountLink','privacyAccountLink'])$(id).href=id==='termsAccountLink'?result.account.legal.termsPath:result.account.legal.privacyPath;
    renderAll();setupSpeech();showLegacy();document.body.dataset.accountReady='true';
  }catch{document.body.dataset.accountReady='false';location.replace('/login?notice=setup-required');}
})();
