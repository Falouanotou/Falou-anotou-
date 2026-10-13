'use strict';
(async()=>{
  const mode=document.querySelector('[data-auth-mode]')?.dataset.authMode;if(!mode)return;
  const $=id=>document.getElementById(id),message=(text,error=false)=>{const el=$('authMessage');el.textContent=text;el.classList.toggle('is-error',error);};
  // Install synchronously: a click during session initialization must never submit
  // the native form and discard the callback credentials from the current page.
  $('authForm')?.addEventListener('submit',event=>event.preventDefault());
  let state,busy=false;
  const api=async(route,body)=>{const headers={'X-Account-Context':state?.user?.id||''};if(body){headers['Content-Type']='application/json';headers['X-CSRF-Token']=state?.csrf||'';}const response=await fetch(route,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers,body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'Não consegui concluir. Tente novamente.');return data;};
  const execute=async(operation)=>{if(busy)return;busy=true;message('Aguarde…');const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>{b.disabled=true;});$('authForm')?.setAttribute('aria-busy','true');try{await operation();}catch(error){message(error instanceof TypeError?'A conexão falhou. Confira sua conexão e tente novamente.':error.message||'Não consegui concluir. Tente novamente.',true);}finally{busy=false;buttons.forEach(b=>{b.disabled=false;});$('authForm')?.removeAttribute('aria-busy');}};
  const navigate=data=>{if(data.redirect)location.assign(data.redirect);else if(data.url)location.assign(data.url);else message(data.message);};
  // Remove bearer confirmation hashes from the visible URL before any further navigation.
  const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1)),confirmation={tokenHash:params.get('token_hash'),type:params.get('type'),code:params.get('code'),flowId:params.get('sb_flow_id')};
  const accessToken=fragment.get('access_token')||params.get('access_token'),refreshToken=fragment.get('refresh_token')||params.get('refresh_token'),linkType=fragment.get('type')||params.get('type');
  let recoveryTokens=accessToken||refreshToken?{type:linkType,accessToken,refreshToken}:null;
  const linkError=fragment.get('error_code')||params.get('error_code')||fragment.get('error')||params.get('error');
  const recoveryCallback=mode==='confirm'||!!recoveryTokens||!!linkError;
  const recoveryFailure=()=>{message('Não foi possível validar este link. Ele pode ter expirado, já ter sido utilizado ou não corresponder a esta solicitação. Solicite um novo link de recuperação.',true);if($('authSubmit'))$('authSubmit').hidden=true;if($('recoveryRetry'))$('recoveryRetry').hidden=false;$('authForm')?.removeAttribute('aria-busy');};
  if(mode==='confirm'||recoveryTokens||linkError)history.replaceState(null,'',location.pathname);
  if(mode==='confirm'||recoveryTokens){$('authSubmit').disabled=true;message('Validando o link…');}
  try{
    state=await api('/api/auth/session');
    if(linkError)throw Error('O Supabase informou que o link não pôde ser validado. Ele pode ter expirado ou já ter sido utilizado. Solicite um novo link pelo suporte.');
    if(recoveryTokens){
      try{if(recoveryTokens.type!=='recovery')throw Error('O link não é de recuperação. Solicite um novo link pelo suporte.');navigate(await api('/api/auth/recovery-session',recoveryTokens));}
      finally{recoveryTokens=null;}
      return;
    }
    if(mode==='confirm'&&(confirmation.tokenHash||confirmation.code)){navigate(await api('/api/auth/confirm',confirmation));return;}
    if(mode==='confirm')throw Error('Este endereço não contém os dados de recuperação. Abra novamente o link completo da mensagem mais recente, uma única vez.');

    if(['login','signup'].includes(mode)&&state.user&&params.get('notice')!=='setup-required'){location.replace(state.recovery?'/nova-senha':state.needsConsent?'/aceitar-documentos':'/app');return;}
    if(['consent','reset','account'].includes(mode)&&!state.user){location.replace('/login');return;}
    if(['consent','reset'].includes(mode)&&state.user){const subtitle=document.querySelector('.auth-subtitle');subtitle.textContent+=' Conta: '+state.user.email;}
    const notice={confirmed:'E-mail confirmado. Agora entre com sua conta.','password-updated':'Senha atualizada. Entre com a nova senha.','session-expired':'Sua sessão expirou. Entre novamente.','setup-required':'Não consegui carregar sua conta. Confira a configuração do projeto e tente novamente.'}[params.get('notice')];if(notice)message(notice,['setup-required'].includes(params.get('notice')));
    if($('authConfiguration')&&(!state.config.configured||mode==='signup'&&!state.config.signupAllowed)){
      const el=$('authConfiguration');el.hidden=false;
      el.textContent=!state.config.configured?'A conexão de contas ainda não foi configurada. Login e cadastro não estão disponíveis por enquanto.':'O cadastro aguarda a revisão e publicação dos documentos.';
    }
    $('passwordToggle')?.addEventListener('click',()=>{const input=$('authPassword'),show=input.type==='password';input.type=show?'text':'password';$('passwordToggle').textContent=show?'Ocultar senha':'Mostrar senha';$('passwordToggle').setAttribute('aria-pressed',String(show));});
    $('authForm')?.addEventListener('submit',event=>{
      event.preventDefault();execute(async()=>{
        const email=$('authEmail')?.value.trim(),password=$('authPassword')?.value,confirmPassword=$('authConfirm')?.value;
        if(['signup','reset'].includes(mode)&&password!==confirmPassword)throw Error('As senhas precisam ser iguais.');
        const routes={login:['/api/auth/login',{email,password}],signup:['/api/auth/signup',{name:$('authName')?.value.trim(),email,password,confirmPassword,accepted:$('authAccepted')?.checked===true}],forgot:['/api/auth/forgot',{email}],reset:['/api/auth/reset',{password,confirmPassword}],consent:['/api/auth/accept',{accepted:$('authAccepted')?.checked===true}],confirm:['/api/auth/confirm',confirmation]};
        const [route,body]=routes[mode];navigate(await api(route,body));
      });
    });
    const logout=()=>execute(async()=>{await api('/api/auth/logout',{});if('BroadcastChannel'in window)new BroadcastChannel('falou-anotou-auth').postMessage('logout');location.replace('/login');});
    $('consentLogout')?.addEventListener('click',logout);$('accountLogout')?.addEventListener('click',logout);
    if(mode==='account'){
      const account=await api('/api/account');$('accountEmail').textContent=account.email;$('accountName').value=account.name;$('accountReadAloud').checked=account.readAloud;
      $('accountPlan').textContent='Acesso pessoal. A contratação e a liberação são realizadas diretamente com o responsável.';
      $('accountForm').addEventListener('submit',event=>{event.preventDefault();execute(async()=>navigate(await api('/api/account',{name:$('accountName').value.trim(),readAloud:$('accountReadAloud').checked})));});
      $('categoryForm').addEventListener('submit',event=>{event.preventDefault();execute(async()=>{navigate(await api('/api/account/category',{name:$('categoryName').value.trim()}));$('categoryName').value='';});});
    }
  }catch(error){if(recoveryCallback){recoveryFailure();return;}message(error.message||'Não consegui carregar a conta. Recarregue a página.',true);}
})();
