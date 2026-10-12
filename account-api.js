'use strict';
window.AccountAPI=(()=>{
  let state=null,account=null,checking=null;
  function clear(){document.body.dataset.accountReady='false';document.dispatchEvent(new Event('fa:private-clear'));}
  function expired(){clear();location.replace('/login?notice=session-expired');}
  async function call(route,body){
    const headers={'X-Account-Context':state?.user?.id||''};if(body){headers['Content-Type']='application/json';headers['X-CSRF-Token']=state?.csrf||'';}
    const response=await fetch(route,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
    let data;try{data=await response.json();}catch{throw Error('O servidor não respondeu como esperado. Tente novamente.');}
    if(!response.ok){if(response.status===401)expired();const error=Error(data.error||'Não consegui concluir a solicitação.');error.status=response.status;throw error;}return data;
  }
  async function ensure(){
    if(checking)return checking;
    checking=(async()=>{const previous=state?.user?.id,next=await call('/api/auth/session');if(!next.user||next.needsConsent||next.recovery){clear();location.replace(!next.user?'/login':next.recovery?'/nova-senha':'/aceitar-documentos');throw Error('Autenticação necessária.');}if(previous&&previous!==next.user.id){clear();location.reload();throw Error('A conta mudou em outra guia.');}state=next;return state;})().finally(()=>{checking=null;});return checking;
  }
  async function initialize(){await ensure();account=await call('/api/account');return {user:state.user,account,ledger:await call('/api/ledger')};}
  async function changes(payload){return call('/api/ledger/changes',payload);}
  async function logout(){await call('/api/auth/logout',{});clear();if('BroadcastChannel'in window)new BroadcastChannel('falou-anotou-auth').postMessage('logout');location.replace('/login');}
  if('BroadcastChannel'in window){const channel=new BroadcastChannel('falou-anotou-auth');channel.onmessage=event=>{if(event.data==='logout')expired();};}
  window.addEventListener('pageshow',event=>{if(event.persisted){clear();location.reload();}});
  window.addEventListener('focus',()=>{if(state)ensure().catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)document.body.dataset.accountReady='false';else if(state){ensure().then(()=>{document.body.dataset.accountReady='true';}).catch(()=>{});}});
  setInterval(()=>{if(state&&!document.hidden)ensure().catch(()=>{});},45000);
  return {initialize,call,changes,ensure,logout,get user(){return state?.user;},get settings(){return account;}};
})();
