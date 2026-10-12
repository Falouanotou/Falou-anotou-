'use strict';
const crypto=require('node:crypto');
const fields=['id','type','amount','date','merchant','description','category','createdAt','demo','source','items','receiptId','discount','surcharge'];
const text=(value,max,optional=false)=>{if(optional&&value==null)return '';if(typeof value!=='string'||value.length>max)throw Error('Campo de texto inválido.');return value.trim();};
const number=(value,min,max,optional=false)=>{if(optional&&value==null)return null;if(typeof value==='boolean'||value==null||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>=max)throw Error('Valor numérico inválido.');return Number(value);};
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const[y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);return y>=1900&&y<=2100&&date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;}
function validateEntry(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!fields.includes(k)))throw Error('Lançamento inválido ou com campos não permitidos.');
  if(!['income','expense'].includes(raw.type)||!validDate(raw.date)||raw.items!=null&&!Array.isArray(raw.items))throw Error('Tipo, data ou produtos inválidos.');
  if((raw.items||[]).length>80)throw Error('Máximo de 80 produtos por nota.');
  const items=(raw.items||[]).map(i=>{
    if(!i||typeof i!=='object'||Object.keys(i).some(k=>!['name','quantity','total','unit','unitPrice'].includes(k)))throw Error('Produto inválido.');
    const name=text(i.name,95);if(!name)throw Error('Informe o nome do produto.');
    const quantity=number(i.quantity,Number.MIN_VALUE,10000.001,true),total=number(i.total,0.01,1e9),unit=text(i.unit,10,true).toUpperCase(),unitPrice=number(i.unitPrice,0,1e9,true);
    if(unit&&!['UN','KG','L','CX','PCT','PC','FD'].includes(unit))throw Error('Unidade do produto inválida.');
    return {name,quantity,total:Math.round(total*100)/100,unit,unitPrice};
  });
  const amount=number(raw.amount,0.01,1e9),receiptId=text(raw.receiptId,44,true);
  if(receiptId&&!/^\d{44}$/.test(receiptId))throw Error('Chave de nota inválida.');
  const createdAt=raw.createdAt||raw.date+'T12:00:00.000Z';if(typeof createdAt!=='string'||createdAt.length>40||!Number.isFinite(Date.parse(createdAt)))throw Error('Data de criação inválida.');
  const data={type:raw.type,amount:Math.round(amount*100)/100,date:raw.date,merchant:text(raw.merchant,100,true),description:text(raw.description,200,true),category:text(raw.category||'Outros',60),createdAt,demo:raw.demo===true,source:raw.source==='receipt'?'receipt':'manual',items,receiptId,discount:number(raw.discount,0,1e9,true),surcharge:number(raw.surcharge,0,1e9,true)};
  const id=raw.id==null?'legacy-'+crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'):text(raw.id,120);
  if(!id||!/^[a-zA-Z0-9_.:-]+$/.test(id))throw Error('Identificador inválido.');
  return {id,...data};
}
function validateBatch(input){if(!Array.isArray(input)||input.length>10000)throw Error('Backup inválido ou com mais de 10 mil registros.');return input.map(validateEntry);}
module.exports={validDate,validateEntry,validateBatch};
