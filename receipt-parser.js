/* Parser conservador de cupons/notas fiscais brasileiras. Nao envia dados. */
(function(root, factory) {
  const API=factory();
  if(typeof module==='object' && module.exports)module.exports=API;
  root.ReceiptParser=API;
})(typeof globalThis!=='undefined'?globalThis:this, function(){
  'use strict';
  const clean = s=>String(s||'').replace(/\s+/g,' ').trim();
  const norm = s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function money(raw){
    if(raw==null||String(raw).trim()==='')return null;
    const t=String(raw).trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
    if(!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(t)&&!/^\d+\.\d{1,2}$/.test(t))return null;
    const value=Number(t.includes(',')?t.replace(/\./g,'').replace(',','.'): /^\d{1,3}(\.\d{3})+$/.test(t)?t.replace(/\./g,''):t);
    return Number.isFinite(value)&&value>=0&&value<1e9?Math.round(value*100)/100:null;
  }
function getPrices(text){
    const matches=String(text).match(/(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})\b/g)||[];
    return matches.map(money).filter(n=>n!==null);
  }
  function toISO(day,month,year){
    let y=Number(year);if(y<100)y+=2000;
    const d=new Date(y,Number(month)-1,Number(day));
    if(d.getFullYear()!==y||d.getMonth()!==Number(month)-1||d.getDate()!==Number(day))return null;
    return [y,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
  }
  const HEADER=/\b(?:DANFE|NFC-E|NFCE|CNPJ|CPF|CHAVE\s+DE\s+ACESSO|PROTOCOLO|CONSUMIDOR|TRIBUT|SEFAZ|DOCUMENTO\s+AUXILIAR|NUMERO\s+DA\s+NOTA|CONSULTE|QR\s*CODE|CODIGO\s+DESCRICAO|DESCRICAO\s+QTD|VL\s*UNIT|VALOR\s+TOTAL|VALOR\s+A\s+PAGAR|FORMA\s+DE\s+PAGAMENTO|SUBTOTAL|DESCONTO|ACRESCIMO|TROCO|TOTAL\s+DE\s+ITENS|QTD\s*TOTAL|PAGAMENTO|CARTAO|PIX|DINHEIRO|OPERADOR|CAIXA|DATA\s+DE\s+EMISSAO|EMISSAO|DATA\s+HORA)\b/i;
  function parseMerchant(lines){
    const candidates=lines.slice(0,12).map(clean).filter(Boolean).filter(s=>!HEADER.test(norm(s))&&!/^(?:\d|[\W_])/.test(s)&&s.length>=4&&s.length<=96&&!/^(?:ENDERECO|RUA|AVENIDA|BAIRRO|CEP|TEL\b|AV\b)/i.test(norm(s)));
    return (candidates.find(s=>/\b(supermercado|mercado|farmacia|drogaria|padaria|restaurante|atacado|loja|comercio|ltda|eireli)\b/i.test(norm(s)))||candidates[0]||'').slice(0,100);
  }
  function parseItems(lines){
    const items=[];
    const normalizeName=s=>clean(s).replace(/^\d{1,5}\s+/, '').replace(/\s*\(cod\.?[^)]*\)\s*/ig,'').replace(/\s*[-|:]\s*$/,'').slice(0,95);
    const isCandidate=s=>s.length>=5 && /[a-zA-ZÀ-ÿ]{3}/.test(s) && !HEADER.test(norm(s)) && !/https?:|www\.|\b(?:fiscal|total|pagto|nfce|tributos|vl\s*un|subtotal|valor\s+pago|valor\s+recebido|desconto|juros|troco)\b/i.test(norm(s));
    for(let i=0;i<lines.length;i++){
      const line=clean(lines[i]);if(!line)continue;
      if(/^(?:valor\s+(?:total|a\s+pagar)|total\b|subtotal\b|forma\s+(?:de\s+)?pagamento|qtd\s+total)/i.test(norm(line)))break;
      let name='',qty=null,total=null,unitPrice=null,unit='';
      // Formato: 001 ARROZ TIPO 1 1KG  2 UN x 5,49 10,98
      const full=line.match(/^(?:(?:\d{1,6}|\d{8,14})\s+)?(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s*(?:UN|UND|UNID|KG|LT|L|CX|PC|PCT|FD)?\s*[xX×]?\s*(?:R\$\s*)?(\d+[.,]\d{2})\s+(?:R\$\s*)?(\d+[.,]\d{2})\s*$/i);
      if(full && isCandidate(full[1])){
        name=normalizeName(full[1]);qty=Number(full[2].replace(',','.'));total=money(full[4]);
        unitPrice=money(full[3]);unit=(line.match(/\s\d+(?:[.,]\d{1,3})?\s*(UN|UND|UNID|KG|LT|L|CX|PC|PCT|FD)\s*[xX×]?\s*(?:R\$\s*)?\d+[.,]\d{2}\s+(?:R\$\s*)?\d+[.,]\d{2}\s*$/i)?.[1]||'').toUpperCase();
        // Discarta cabeçalhos/dados incompatíveis
        if(!Number.isFinite(qty)||qty<=0||qty>1e4||!Number.isFinite(unitPrice)||total>qty*unitPrice+Math.max(.12,total*.075))continue;
      }else{
        // 001 LEITE INTEGRAL 1L  2 x 6,99 13,98 (alternativo simples)
        const adjacent=lines[i+1]?clean(lines[i+1]):'';
        const tail=adjacent.match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:UN|UND|UNID|KG|CX|PC|LT|L|PCT)?\s*[xX×]?\s*(?:R\$\s*)?(\d+[.,]\d{2})\s+(?:R\$\s*)?(\d+[.,]\d{2})$/i);
        if(isCandidate(line)&&!getPrices(line).length&&tail){
          const tentative=Number(tail[1].replace(',','.')),price=money(tail[2]),sub=money(tail[3]);
          if(tentative>0&&tentative<1e4&&sub<=tentative*price+Math.max(.12,sub*.075)){
            name=normalizeName(line);qty=tentative;total=sub;unitPrice=price;unit=(adjacent.match(/\b(UN|UND|UNID|KG|CX|PC|LT|L|PCT)\b/i)?.[1]||'').toUpperCase();i++;
          }
        }
        if(!name){
          // Uma linha com um preço e nome; só aceita quando a linha começa por código numérico
          const single=line.match(/^\s*(\d{1,6})\s+(.+?)\s+(?:R\$\s*)?(\d+[.,]\d{2})\s*$/);
          if(single&&isCandidate(single[2])){name=normalizeName(single[2]);qty=null;total=money(single[3]);}
        }
      }
      if(name&&total!==null&&total>0&&items.length<80)items.push({name,quantity:qty===null?null:Math.round(qty*1000)/1000,total,unit:({UND:'UN',UNID:'UN',LT:'L'}[unit]||unit),unitPrice});
    }
    return items;
  }
  function parse(text){
    const raw=String(text||'');
    const lines=raw.replace(/\r/g,'').split('\n').map(clean).filter(Boolean);
    const merchant=parseMerchant(lines);
    let date=null, amount=null, noteId='';
    const tagged=raw.match(/(?:emiss[aã]o|emitid[ao]\s*em|data(?:\s*e\s*hora)?)\s*[:\-]?\s*(\d{2})[\/-](\d{2})[\/-](\d{2,4})/i);
    const any=raw.match(/\b(\d{2})[\/-](\d{2})[\/-](\d{2,4})\b/);
    const dm=tagged||any;if(dm)date=toISO(dm[1],dm[2],dm[3]);
    const key=raw.match(/\b(?:\d[\s-]*){44}\b/);if(key)noteId=key[0].replace(/\D/g,'').slice(0,44);
    const totals=[];let discount=null,surcharge=null;
    lines.forEach((line,i)=>{
      const n=norm(line);let v=getPrices(line).at(-1);
      if(v===undefined&&/^(?:valor\s+(?:total|a\s+pagar)|total\s*(?:geral|da\s+nota|a\s+pagar)?|desconto|acrescimo)\s*[:R$]*$/i.test(n)&&lines[i+1]&&/^(?:R\$\s*)?[\d.,]+$/.test(lines[i+1]))v=getPrices(lines[i+1]).at(-1);
      if(/^(?:valor\s+(?:de\s+)?)?descontos?\b/.test(n)&&v!==undefined)discount=v;
      if(/^(?:valor\s+(?:de\s+)?)?acrescimos?\b/.test(n)&&v!==undefined)surcharge=v;
      if(v===undefined||v<=0)return;
      let score=0;
      if(/\bvalor\s+a\s+pagar\b|\btotal\s+a\s+pagar\b/.test(n))score=120;
      else if(/\bvalor\s+total\b|\btotal\s+da\s+nota\b|\btotal\s+geral\b|\btotal\s+r\$\b/.test(n))score=105;
      else if(/^total\s*(?:r\$|[:=]|\s)/.test(n))score=90;
      else if(/\btotal\b/.test(n) && !/itens|quantidade|tributos|desconto|economia|produtos/.test(n))score=70;
      if(score && !/troco|cartao|pix|credito|debito|dinheiro|recebido|desconto|acrescimo|subtotal/.test(n))totals.push({value:v,score,index:i});
    });
    totals.sort((a,b)=>b.score-a.score||b.index-a.index);
    if(totals.length)amount=totals[0].value;
    const items=parseItems(lines);
    const itemsSum=Math.round(items.reduce((sum,x)=>sum+x.total,0)*100)/100;
    const warnings=[];
    if(!merchant)warnings.push('Não foi possível identificar a loja.');
    if(!date)warnings.push('Data não identificada; confira antes de salvar.');
    if(amount===null)warnings.push('Total não identificado; informe o valor da nota.');
    if(!items.length)warnings.push('Itens não identificados com segurança; você pode acrescentá-los manualmente.');
    if(amount!==null&&items.length&&Math.abs(itemsSum-(discount||0)+(surcharge||0)-amount)>.011)warnings.push('Itens, descontos e acréscimos identificados não correspondem ao total; confira os valores e produtos não reconhecidos.');
    return {merchant,date,amount,items,noteId,discount,surcharge,itemsSum,warnings,raw};
  }
  return {parse,money};
});
