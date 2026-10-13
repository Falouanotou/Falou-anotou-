'use strict';
(()=>{
  // Installation is optional. Auth, account and financial state stay independent.
  if(!window.isSecureContext)return;
  const installed=window.matchMedia('(display-mode: standalone)');
  const isInstalled=()=>installed.matches||window.matchMedia('(display-mode: fullscreen)').matches||navigator.standalone===true;
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
      const update=()=>registration.update().catch(()=>{});
      update();window.addEventListener('online',update);
    }).catch(()=>{});
  }
  const card=document.querySelector('[data-auth-mode="login"] .auth-card');
  if(!card||isInstalled())return;
  let prompt=null,dismissed=false;
  try{dismissed=localStorage.getItem('falou-anotou-install-dismissed')==='1';}catch{/* Storage may be unavailable. */}
  const section=document.createElement('section');section.className='pwa-install';section.setAttribute('aria-label','Instalação no celular');
  section.innerHTML='<button type="button" class="pwa-install-action" id="pwaInstall" aria-expanded="false" aria-controls="pwaInstructions">Como instalar o aplicativo</button><div id="pwaInstructions" class="pwa-instructions" hidden><h3>Falou, Anotou! na tela inicial</h3><p><strong>Android · Chrome</strong></p><ol><li>Abra este endereço no Chrome.</li><li>No menu ⋮, escolha “Instalar aplicativo” ou “Adicionar à tela inicial”, quando disponível.</li><li>Confirme a instalação e abra pelo novo ícone.</li></ol><p><strong>iPhone · Safari</strong></p><ol><li>Abra este endereço no Safari.</li><li>Abra o menu Compartilhar.</li><li>Selecione “Adicionar à Tela de Início”.</li><li>Mantenha “Abrir como App” ativado, se aparecer, e confirme em “Adicionar”.</li></ol><p>Abriu pelo WhatsApp? Se a instalação não aparecer, use o menu para abrir no Safari ou Chrome. Se necessário, copie o endereço para esse navegador. As opções variam conforme o celular e a versão do navegador.</p><p>O aplicativo precisa de internet para entrar na conta e carregar ou salvar registros. Instalar não cria uma cópia offline do histórico. O navegador instalado pode pedir que você entre novamente.</p><button type="button" class="pwa-install-action" id="pwaClose">Fechar instruções</button></div><p id="pwaStatus" class="pwa-status" role="status"></p>';
  card.insertBefore(section,card.querySelector('.auth-footer'));
  const button=section.querySelector('#pwaInstall'),help=section.querySelector('#pwaInstructions'),status=section.querySelector('#pwaStatus');
  const rememberDismissal=()=>{dismissed=true;try{localStorage.setItem('falou-anotou-install-dismissed','1');}catch{/* Optional preference only. */}};
  const close=()=>{help.hidden=true;button.setAttribute('aria-expanded','false');};
  const hideInstalled=()=>{if(isInstalled())section.remove();};
  installed.addEventListener?.('change',hideInstalled);
  window.addEventListener('appinstalled',()=>{prompt=null;section.remove();});
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();if(typeof event.prompt!=='function'||isInstalled()||dismissed)return;
    prompt=event;button.textContent='Instalar Falou, Anotou!';close();
  });
  section.querySelector('#pwaClose').addEventListener('click',()=>{close();rememberDismissal();button.focus();});
  button.addEventListener('click',async()=>{
    status.textContent='';
    if(!prompt){help.hidden=!help.hidden;button.setAttribute('aria-expanded',String(!help.hidden));return;}
    const available=prompt;prompt=null;button.disabled=true;
    try{
      await available.prompt();const choice=await available.userChoice;
      if(choice.outcome==='accepted'){section.remove();return;}
      rememberDismissal();
    }catch{status.textContent='A instalação não abriu. Consulte as instruções do seu navegador.';}
    finally{button.disabled=false;button.textContent='Como instalar o aplicativo';}
  });
})();
