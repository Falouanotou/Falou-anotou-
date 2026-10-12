/* Consultas determinísticas: usam somente lançamentos e itens confirmados. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FinanceQuery=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const ymd=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const cash=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
  const cents=n=>Math.round(Number(n)*100);
  const months=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  function period(raw,now=new Date()){
    const t=norm(raw),y=now.getFullYear(),m=now.getMonth();
    const month=(yy,mm)=>({start:ymd(new Date(yy,mm,1)),end:ymd(new Date(yy,mm+1,0))});
    let range={start:null,end:null,label:'em todo o histórico',matched:false};
    const recent=t.match(/\bultimos?\s+(\d+|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(meses|mes|dias|dia)\b/);
    if(recent){const words={um:1,dois:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12};const n=Number(recent[1])||words[recent[1]];
      if(n>0&&n<=365){const start=new Date(now);if(recent[2].startsWith('mes')){start.setDate(1);start.setMonth(m-n+1);}else start.setDate(start.getDate()-n+1);
        return {start:ymd(start),end:ymd(now),label:`nos últimos ${n} ${recent[2].startsWith('mes')?'meses (incluindo o mês atual)':'dias'}`,matched:true};}
    }
    if(/\b(hoje|ontem|anteontem)\b/.test(t)){const d=new Date(now);const name=t.match(/\b(anteontem|ontem|hoje)\b/)[1];d.setDate(d.getDate()-({anteontem:2,ontem:1,hoje:0}[name]));return {start:ymd(d),end:ymd(d),label:name,matched:true};}
    if(/\b(esta semana|essa semana|semana passada)\b/.test(t)){const d=new Date(now);d.setDate(d.getDate()-(d.getDay()+6)%7-(/semana passada/.test(t)?7:0));const start=ymd(d);d.setDate(d.getDate()+6);return {start,end:/semana passada/.test(t)?ymd(d):ymd(now),label:/semana passada/.test(t)?'na semana passada':'nesta semana',matched:true};}
    if(/\b(mes passado|ultimo mes)\b/.test(t))return {...month(y,m-1),label:'no mês passado',matched:true};
    if(/\b(este mes|esse mes|neste mes|nesse mes|mes atual|do mes)\b/.test(t))return {...month(y,m),label:'neste mês',matched:true};
    if(/\b(ano passado|ultimo ano)\b/.test(t))return {start:`${y-1}-01-01`,end:`${y-1}-12-31`,label:'no ano passado',matched:true};
    if(/\b(este ano|esse ano|neste ano)\b/.test(t))return {start:`${y}-01-01`,end:`${y}-12-31`,label:'neste ano',matched:true};
    for(let i=0;i<12;i++)if(new RegExp('\\b'+months[i]+'\\b').test(t)){const yy=Number(t.match(/\b(20\d{2})\b/)?.[1]||y);return {...month(yy,i),label:`em ${months[i]} de ${yy}`,matched:true};}
    return range;
  }
  function subject(raw){return norm(raw)
    .replace(/\bultimos?\s+(\d+|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(?:meses|mes|dias|dia)\b/g,' ')
    .replace(/\b(?:este|esse|neste|nesse|esta|essa|nesta|nessa|do)\s+(?:mes|ano|semana)\b|\b(?:mes|ano|semana)\s+passad[oa]\b|\bultimo\s+(?:mes|ano)\b/g,' ')
    .replace(new RegExp('\\b(?:'+months.join('|')+'|20\\d{2}|hoje|ontem|anteontem)\\b','g'),' ')
    .replace(/\b(?:quanto|quantos|quanta|qual|quais|onde|quando|foi|que|eu|ja|gastei|gasto|gastos|paguei|pago|comprei|compro|compras|recebi|ganhei|receitas|receita|despesas|despesa|dinheiro|valor|total|em|ate|agora|de|do|da|uma|um|o|a|me|minha|meu|minhas|meus|os|as|mes|saldo|sobrou|restou|balanco|mostra|mostre|mostrar|liste|listar|busca|buscar|procura|pesquisar|pesquisa|saber|loja|produto|produtos|maior|menor|ultimo|ultima|ultimos|ultimas|registros|lancamentos|historico|com|na|no|nas|nos|pela|pelo|mais|barato|barata|caro|cara|frequencia|frequentes|frequentemente)\b/g,' ').replace(/\s+/g,' ').trim();}
  function matches(text,s){const h=norm(text),parts=norm(s).split(' ').filter(Boolean);return parts.every(p=>h.split(' ').includes(p));}
  function value(e,s){
    if(!s)return {value:cents(e.amount),product:false};
    if(matches(`${e.merchant} ${e.category}`,s))return {value:cents(e.amount),product:false};
    const items=(e.items||[]).filter(i=>matches(i.name,s));
    if(items.length)return {value:items.reduce((a,i)=>a+cents(i.total),0),product:true};
    // Receipts without matching items cannot supply a product total from their description.
    if(e.source!=='receipt'&&matches(e.description,s))return {value:cents(e.amount),product:false};
    return null;
  }
  function answer(raw,entries,now=new Date()){
    const t=norm(raw),s=subject(raw),p=period(raw,now);
    const within=e=>!p.start||(e.date>=p.start&&e.date<=p.end);
    const expenses=entries.filter(e=>e.type==='expense'&&within(e)&&!e.demo);
    if(/\b(aument|diminui|variacao|compar|relacao)\w*/.test(t)){
      const current=period('este mês',now),previous=period('mês passado',now);
      const rows=range=>entries.filter(e=>e.type==='expense'&&!e.demo&&e.date>=range.start&&e.date<=range.end);
      const a=rows(current),b=rows(previous);
      if(!a.length||!b.length)return {message:'Não há despesas registradas nos dois meses para comparar.',detail:'A ausência de registros não comprova gasto zero.'};
      const sum=rows=>rows.reduce((v,e)=>v+cents(e.amount),0),av=sum(a),bv=sum(b),diff=av-bv;
      return {message:diff===0?'As despesas registradas ficaram iguais às do mês passado.':`Suas despesas registradas ${diff>0?'aumentaram':'diminuíram'} ${cash(Math.abs(diff)/100)} (${(Math.abs(diff)/bv*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%).`,detail:`Mês atual: ${cash(av/100)}. Mês passado: ${cash(bv/100)}. Compara o mês atual ainda em andamento com o mês passado inteiro; não é uma previsão.`};
    }
    if(/\bfrequencia|\bfrequentes|\bfrequentemente/.test(t)){
      const groups=new Map();let notes=0;
      for(const e of expenses){const seen=new Set();for(const i of e.items||[]){const key=norm(i.name);if(!key||seen.has(key)||s&&!matches(i.name,s))continue;seen.add(key);const group=groups.get(key)||{name:i.name,count:0};group.count++;groups.set(key,group);}if(seen.size)notes++;}
      const top=[...groups.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,5);
      return top.length?{message:`Produtos mais frequentes ${p.label}:`,detail:top.map(i=>`${i.name}: em ${i.count} compra(s)`).join('\n')+`\nFrequência por compra, baseada em ${notes} nota(s) com itens. Não inclui produtos omitidos pelo OCR.`}:{message:'Não há produtos registrados para calcular a frequência.',detail:'Salve ou corrija os itens das notas fiscais primeiro.'};
    }
    if(/\bmais barat[oa]\b|\bmenor preco\b/.test(t)){
      if(!s)return {message:'Qual produto você quer comparar?',detail:'Exemplo: “Onde comprei o arroz mais barato?”'};
      const groups=new Map();
      for(const e of expenses)for(const i of e.items||[]){if(!matches(i.name,s)||!(i.quantity>0)||!i.unit)continue;const key=norm(i.name)+'|'+norm(i.unit),g=groups.get(key)||[];g.push({entry:e,item:i,price:cents(i.total)/i.quantity});groups.set(key,g);}
      const comparable=[...groups.values()].filter(g=>new Set(g.map(x=>x.entry.id)).size>=2);
      if(!comparable.length)return {message:`Não há dados comparáveis suficientes sobre “${s}”.`,detail:'São necessárias duas compras com o mesmo nome de produto, quantidade e unidade informadas. Embalagens ou produtos diferentes não são comparados.'};
      return {message:`Menor preço registrado de “${s}” ${p.label}:`,detail:comparable.map(g=>{const x=g.sort((a,b)=>a.price-b.price)[0];return `${x.item.name}: ${cash(x.price/100)}/${x.item.unit} · ${x.entry.merchant||'loja não informada'} · ${x.entry.date}`;}).join('\n')+'\nComparação do total do item por quantidade, antes de descontos gerais da nota. Produtos com nomes diferentes permanecem separados.'};
    }
    const wantsIncome=/\b(recebi|receita|receitas|ganhei|entrou|ganhos)\b/.test(t),balance=/\b(saldo|sobrou|restou|balanco)\b/.test(t);
    const largest=/\b(maior|mais caro|mais alta)\b/.test(t),list=/\b(liste|lista|mostrar|mostra|mostre|historico|registros|lancamentos)\b/.test(t)||/\bultimos\s+(?:gastos|compras)\b/.test(t);
    // Totals without a period use current month; extrema and product/store queries use full history.
    const active=!p.matched&&!s&&!largest&&!list?period('este mês',now):p;
    const rows=entries.filter(e=>(balance||e.type===(wantsIncome?'income':'expense'))&&(!active.start||e.date>=active.start&&e.date<=active.end)).map(e=>({e,v:value(e,s)})).filter(x=>x.v);
    const suffix=s?` com “${s}”`:'';
    if(!rows.length)return {message:`Não encontrei ${wantsIncome?'receitas':'lançamentos'}${suffix} ${active.label}.`,detail:'A resposta considera somente os registros disponíveis; itens ausentes não são estimados.'};
    const product=rows.some(x=>x.v.product),demo=rows.some(x=>x.e.demo),note=product?' Itens somados pelos valores registrados, antes de descontos gerais; não somei o total da compra.':'';
    if(list){const latest=[...rows].sort((a,b)=>b.e.date.localeCompare(a.e.date)||b.e.createdAt.localeCompare(a.e.createdAt)).slice(0,5);return {message:`Encontrei ${rows.length} lançamento(s)${suffix} ${active.label}.`,detail:latest.map(({e,v})=>`${e.date} · ${e.merchant||e.category}: ${cash(v.value/100)} (${e.type==='income'?'receita':'despesa'})`).join('\n')+note};}
    if(largest){const biggest=rows.reduce((a,b)=>a.v.value>=b.v.value?a:b);return {message:`Seu maior ${wantsIncome?'recebimento':'gasto'}${suffix} ${active.label} foi de ${cash(biggest.v.value/100)}.`,detail:`${biggest.e.merchant||biggest.e.category} · ${biggest.e.date}\n${biggest.e.description}${note}${demo?' Inclui dados de exemplo.':''}`};}
    const income=rows.filter(x=>x.e.type==='income').reduce((a,x)=>a+x.v.value,0),out=rows.filter(x=>x.e.type==='expense').reduce((a,x)=>a+x.v.value,0);
    return {message:balance?`O saldo registrado ${active.label} é ${cash((income-out)/100)}.`:`Você ${wantsIncome?'recebeu':'gastou'} ${cash((wantsIncome?income:out)/100)}${suffix} ${active.label}.`,detail:`Baseado em ${rows.length} lançamento(s).${note}${balance?' Esse valor não é saldo bancário.':''}${demo?' Inclui dados de exemplo.':''}`};
  }
  return {period,subject,matches,value,answer};
});
