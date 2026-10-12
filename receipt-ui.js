/* Foto da nota: leitura local de imagem com Tesseract, revisao e armazenamento opcional. */
'use strict';
(()=>{
  const fileCamera=$('receiptCameraFile'),fileUpload=$('receiptUploadFile'),status=$('receiptStatus');
  let currentReceiptId='',imageUrl='',ocrWorker=null,processing=false,attempt=0,cancelReject=null,parsedItems=[],manualMode=false;
  const maximumFileSize=16*1024*1024;
  const vendorScript='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractLoading=null;
  const bounded=(promise,ms,message)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));};
  const renderStatus=(message,error=false,busy=false)=>{
    status.textContent=message;
    status.classList.toggle('is-error',error);
    status.classList.toggle('is-working',busy);
  };
  function progress(pct){$('receiptProgress').setAttribute('aria-valuenow',String(Math.round(pct)));$('receiptProgress').hidden=false;$('receiptProgressFill').style.width=Math.min(100,Math.max(0,pct))+'%';}
  function loadOCR(){
    if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
    if(tesseractLoading)return tesseractLoading;
    let script;
    tesseractLoading=bounded(new Promise((resolve,reject)=>{
      script=document.createElement('script');script.src=vendorScript;script.async=true;
      script.onload=()=>window.Tesseract?.createWorker?resolve(window.Tesseract):reject(new Error('Biblioteca OCR inválida'));
      script.onerror=()=>reject(new Error('Biblioteca de leitura indisponível. Verifique sua internet.'));
      document.head.appendChild(script);
    }),25000,'A biblioteca OCR demorou demais para carregar. Tente novamente ou preencha manualmente.').catch(e=>{script?.remove();tesseractLoading=null;throw e;});
    return tesseractLoading;
  }
  async function getWorker(id){
    const OCR=await loadOCR();
    if(id!==attempt)throw Error('Leitura cancelada.');
    const worker=await OCR.createWorker('por',1,{
      workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      logger:m=>{if(id!==attempt)return;if(m.status==='recognizing text'){const pct=35+Math.round((m.progress||0)*65);progress(pct);renderStatus(`Lendo texto da nota… ${pct}%`,false,true);}},
      errorHandler:error=>{if(id===attempt&&cancelReject)cancelReject(Error(String(error)));}
    });
    if(id!==attempt){await worker.terminate();throw Error('Leitura cancelada.');}
    ocrWorker=worker;
    await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'});
    return worker;
  }
  function releaseImage(){if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl='';$('receiptImage').removeAttribute('src');$('receiptPreview').hidden=true;}
  function busy(value){processing=value;for(const id of ['receiptCameraBtn','receiptQuickCameraBtn','receiptUploadBtn','receiptManualBtn','receiptReparseBtn'])$(id).disabled=value;$('receiptStopBtn').hidden=!value;}
  function stopReading(){
    attempt++;if(cancelReject)cancelReject(Error('Leitura cancelada.'));cancelReject=null;
    if(ocrWorker){ocrWorker.terminate().catch(()=>{});ocrWorker=null;}
    busy(false);$('receiptProgress').hidden=true;fileCamera.value=fileUpload.value='';releaseImage();renderStatus('Leitura cancelada. Você pode selecionar outra foto ou preencher manualmente.');
  }
  $('receiptStopBtn').addEventListener('click',stopReading);
  function reconcile(){
    try {const items=readItems(),sum=items.reduce((v,i)=>v+Math.round(i.total*100),0)/100,amount=ReceiptParser.money($('receiptAmount').value),discount=ReceiptParser.money($('receiptDiscount').value),surcharge=ReceiptParser.money($('receiptSurcharge').value);
      $('receiptUnitPrices').textContent=items.filter(i=>i.unitPrice!=null).map(i=>`${i.name}: preço unitário lido ${currency(i.unitPrice)}${i.unit?'/'+i.unit:''}.`).join(' ');
      if(amount===null){$('receiptReconciliation').textContent='Informe o total pago para conferir os valores.';return;}
      const delta=Math.round((amount-(sum-(discount||0)+(surcharge||0)))*100)/100;
      $('receiptReconciliation').textContent=`Soma dos itens: ${currency(sum)}. Total pago: ${currency(amount)}.`+(items.length?` Diferença após desconto/acréscimo informado: ${currency(delta)}.`:' Nenhum item reconhecido; o total da compra será registrado uma única vez.');
    }catch(error){$('receiptUnitPrices').textContent='';$('receiptReconciliation').textContent=error.message;}
  }
  function captureText(text){
    const parsed=window.ReceiptParser.parse(text);
    parsedItems=parsed.items;
    $('receiptMerchant').value=parsed.merchant;
    $('receiptDate').value=parsed.date||'';
    $('receiptAmount').value=parsed.amount===null?'':parsed.amount.toFixed(2);
    $('receiptDiscount').value=parsed.discount===null?'':parsed.discount.toFixed(2);$('receiptSurcharge').value=parsed.surcharge===null?'':parsed.surcharge.toFixed(2);
    $('receiptCategory').value=guessCategory(parsed.merchant+' '+parsed.items.map(i=>i.name).join(' '),'expense');
    $('receiptItems').value=parsed.items.map(i=>`${i.name} | ${i.quantity??''} | ${i.total.toFixed(2).replace('.',',')}${i.unit?' | '+i.unit:''}`).join('\n');
    $('receiptRawText').value=text;
    $('receiptWarnings').textContent=parsed.warnings.length?'Confira os dados: '+parsed.warnings.join('\n'):'Identifiquei os campos abaixo. Confira os valores antes de salvar.';
    currentReceiptId=parsed.noteId;
    $('receiptForm').hidden=false;
    $('receiptProgress').hidden=true;
    $('receiptForm').scrollIntoView({block:'nearest',behavior:motionBehavior()});
    reconcile();return parsed;
  }
  function manually(){
    if(processing)return;manualMode=true;releaseImage();captureText('');
    $('receiptWarnings').textContent='Preencha os dados da compra. Os produtos são opcionais, mas ajudam nas consultas por item.';
    renderStatus('Cadastro manual iniciado. A foto não é necessária.');
  }
  async function imageToCanvas(file){
    let bitmap=null,img=null,objectUrl=null;
    try{
      if('createImageBitmap' in window){try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{/* fallback */}}
      if(!bitmap){
        objectUrl=URL.createObjectURL(file);
        img=new Image();img.src=objectUrl;
        await img.decode();
      }
      const w=bitmap?bitmap.width:img.naturalWidth,h=bitmap?bitmap.height:img.naturalHeight;
      if(!w||!h)throw Error('Não foi possível abrir esta imagem. Use JPG ou PNG.');
      const scale=Math.min(2,1700/w,6000/h,Math.sqrt(9e6/(w*h)));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Sem suporte a imagem neste navegador.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap||img,0,0,canvas.width,canvas.height);
      return canvas;
    }finally{
      if(bitmap)bitmap.close();if(objectUrl)URL.revokeObjectURL(objectUrl);
    }
  }
  async function readImage(file){
    if(!file||processing)return;
    if(file.size>maximumFileSize){renderStatus('A imagem é muito grande. Escolha um arquivo de até 16 MB.',true);fileCamera.value=fileUpload.value='';return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){renderStatus('Escolha JPG, PNG ou WebP. Para HEIC, converta a foto no aparelho.',true);fileCamera.value=fileUpload.value='';return;}
    const id=++attempt;manualMode=false;busy(true);$('receiptForm').hidden=true;progress(7);releaseImage();
    imageUrl=URL.createObjectURL(file);$('receiptImage').src=imageUrl;$('receiptFilename').textContent=file.name||'Foto da nota fiscal';$('receiptPreview').hidden=false;
    const cancelled=new Promise((_,reject)=>{cancelReject=reject;});
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A leitura levou mais de 120 segundos. Tente uma foto menor ou preencha manualmente.')),120000);});
    try {
      renderStatus('Preparando imagem e leitura em português…',false,true);
      const job=async()=>{const canvas=await imageToCanvas(file);if(id!==attempt)throw Error('Leitura cancelada.');progress(20);const worker=await getWorker(id);progress(35);return worker.recognize(canvas,{}, {text:true});};
      const result=await Promise.race([job(),cancelled,timeout]);
      if(id!==attempt)return;
      const recognized=result?.data?.text||'';
      if(!recognized.trim())throw Error('Não encontrei texto legível na foto.');
      const parsed=captureText(recognized),confidence=Number(result?.data?.confidence);
      const low=Number.isFinite(confidence)&&confidence<55;
      renderStatus(`Foto analisada. ${parsed.items.length} produto(s) identificados.${low?' A leitura teve baixa nitidez: confira todos os campos.':''}`);
      if(low)$('receiptWarnings').textContent+='\nO OCR pode estar impreciso. Nenhum dado foi salvo automaticamente.';
    }catch(error){
      if(id!==attempt)return;
      captureText('');manualMode=true;
      renderStatus('Não consegui concluir a leitura. Preencha os campos ou tente outra foto. '+(error?.message||''),true);
    }finally{
      clearTimeout(timer);
      if(id===attempt){attempt++;cancelReject=null;const worker=ocrWorker;ocrWorker=null;if(worker)worker.terminate().catch(()=>{});busy(false);$('receiptProgress').hidden=true;fileCamera.value=fileUpload.value='';}
    }
  }
  function readItems(){
    const raw=$('receiptItems').value.trim();if(!raw)return [];
    const items=[];
    for(const [index,line] of raw.split(/\r?\n/).entries()){
      if(!line.trim())continue;
      const parts=line.split('|').map(x=>x.trim());
      if(parts.length<3||parts.length>4)throw new Error(`Produto da linha ${index+1}: use Nome | quantidade | total | unidade (opcional).`);
      const [name,q,t,rawUnit='']=parts;const unit=rawUnit.toUpperCase();if(unit&&!['UN','KG','L','CX','PCT','PC','FD'].includes(unit))throw Error(`Unidade da linha ${index+1}: use UN, KG, L, CX, PCT, PC ou FD.`);
      const quantity=q===''?null:Number(q.replace(',','.'));
      const total=window.ReceiptParser.money(t);
      if(!name||name.length>95||quantity!==null&&(!Number.isFinite(quantity)||quantity<=0||quantity>10000)||total===null||total<=0)throw new Error(`Confira quantidade e valor do produto na linha ${index+1}.`);
      if(items.length>=80)throw new Error('Limite de 80 produtos por nota.');
      const old=parsedItems[index];items.push({name,quantity,total,unit,unitPrice:old&&old.name===name&&old.quantity===quantity&&old.total===total?old.unitPrice:null});
    }
    return items;
  }
  $('receiptCameraBtn').addEventListener('click',()=>fileCamera.click());
  $('receiptQuickCameraBtn').addEventListener('click',()=>fileCamera.click());
  $('receiptUploadBtn').addEventListener('click',()=>fileUpload.click());
  $('receiptManualBtn').addEventListener('click',manually);
  fileCamera.addEventListener('change',()=>readImage(fileCamera.files[0]));
  fileUpload.addEventListener('change',()=>readImage(fileUpload.files[0]));
  $('receiptCancelBtn').addEventListener('click',()=>{
    $('receiptForm').hidden=true;$('receiptPreview').hidden=true;
    releaseImage();currentReceiptId='';
    renderStatus('Leitura cancelada. Nenhum lançamento foi registrado.');
  });
  $('receiptReparseBtn').addEventListener('click',()=>{
    const parsed=captureText($('receiptRawText').value);
    renderStatus(`Texto reinterpretado. ${parsed.items.length} produto(s) detectados.`);
  });
  $('receiptForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const amount=Number($('receiptAmount').value),date=$('receiptDate').value;
    if(!Number.isFinite(amount)||amount<=0||amount>=1e9||!validDate(date)){renderStatus('Confira o valor total e a data.',true);return;}
    let items;
    try{items=readItems();}catch(err){renderStatus(err.message,true);$('receiptItems').focus();return;}
    const merchant=$('receiptMerchant').value.trim();
    const discount=ReceiptParser.money($('receiptDiscount').value),surcharge=ReceiptParser.money($('receiptSurcharge').value);
    const sum=Math.round(items.reduce((total,i)=>total+i.total,0)*100)/100;
    if(discount!==null&&discount>sum&&items.length){renderStatus('O desconto geral é maior que a soma dos itens. Confira os valores.',true);return;}
    const expected=sum-(discount||0)+(surcharge||0);
    if(items.length&&Math.abs(expected-amount)>.011&&!window.confirm(`Itens, desconto e acréscimo resultam em ${currency(expected)}, mas o total pago é ${currency(amount)}. Há valores ou itens ausentes? Salvar mantendo essa diferença?`))return;
    const entry={type:'expense',amount,date,merchant,category:$('receiptCategory').value,description:manualMode?'Compra com produtos informados manualmente':'Compra registrada por foto de nota fiscal',items,discount,surcharge,source:'receipt',receiptId:currentReceiptId};
    // addRecord utiliza o mesmo armazenamento, renderizacao, busca e backup do aplicativo.
    if(!await addRecord(entry)){renderStatus('Compra não registrada. Confira a mensagem exibida; seus dados anteriores foram mantidos.',true);return;}
    $('receiptForm').hidden=true;$('receiptPreview').hidden=true;
    releaseImage();currentReceiptId='';
    renderStatus(`Compra de ${currency(amount)} registrada. Você já pode consultá-la por voz ou pela busca.`);
    $('historico').scrollIntoView({block:'start',behavior:motionBehavior()});
  });
  for(const id of ['receiptItems','receiptAmount','receiptDiscount','receiptSurcharge'])$(id).addEventListener('input',reconcile);
  window.addEventListener('pagehide',()=>{if(processing)stopReading();else releaseImage();});
  document.addEventListener('fa:private-clear',()=>{if(processing)stopReading();else releaseImage();$('receiptForm').hidden=true;for(const id of ['receiptMerchant','receiptDate','receiptAmount','receiptDiscount','receiptSurcharge','receiptItems','receiptRawText'])$(id).value='';currentReceiptId='';parsedItems=[];});
  $('receiptCategory').innerHTML=CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
})();
