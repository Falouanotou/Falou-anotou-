'use strict';
// Mobile account-header browser test. Uses the actual HTTP app with fictional Auth/DB fixtures only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {configuration}=require('../server/config'),{SessionStore}=require('../server/session-store'),{AuthService}=require('../server/auth-service'),{createHandler}=require('../server');
const root=path.resolve(__dirname,'..'),port=18988,origin=`http://localhost:${port}`;
const output=process.env.HEADER_QA_OUTPUT||path.join(root,'qa/header-test');fs.mkdirSync(output,{recursive:true});
const runtime=fs.mkdtempSync(path.join(output,'runtime-'));
const user={id:'fictional-header-user',email:'conta-ficticia@example.invalid',email_confirmed_at:'2026-10-13T12:00:00Z'};
const authSession={user,access_token:'fixture-header-access',refresh_token:'fixture-header-refresh',expires_at:9999999999};
const factory=(url,key,options)=>{
  let current=JSON.parse(options.auth.storage.getItem('fa-server-auth')||'null')?.user||null;
  return {
    auth:{async signInWithPassword({email}){if(email!==user.email)return {data:null,error:{status:401}};current=user;return {data:{user,session:authSession},error:null};},async getUser(){return {data:{user:current},error:null};},async signOut(){current=null;return {error:null};}},
    from(table){const value=table==='profiles'?{display_name:'Conta Fictícia'}:table==='user_settings'?{read_aloud:false}:table==='legal_acceptances'?[{terms_version:'minuta-2026-10-12',privacy_version:'minuta-2026-10-12'}]:[];const chain={select(){return chain;},eq(){return chain;},limit(){return Promise.resolve({data:value,error:null});},single(){return Promise.resolve({data:value,error:null});},order(){return Promise.resolve({data:value,error:null});}};return chain;},
    async rpc(name){if(name==='get_my_ledger')return {data:{revision:1,entries:[{id:'fixture-header-entry',type:'expense',amount:1.23,date:'2026-10-13',merchant:'Mercado Fictício',category:'Outros',description:'Registro somente de teste',items:[],source:'manual',createdAt:'2026-10-13T12:00:00Z'}]},error:null};if(name==='has_premium_access')return {data:false,error:null};if(name==='has_account_access')return {data:true,error:null};return {data:true,error:null};}
  };
};
const config=configuration({APP_ORIGIN:origin,PORT:String(port),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',AUTH_RUNTIME_DIR:runtime},root);
const store=new SessionStore(config),handler=createHandler(config,{store,auth:new AuthService(config,store,factory)}),server=http.createServer(handler);
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'pt-BR'});
  // Exercise the same app in a standalone display-mode context without claiming a device install.
  await context.addInitScript(()=>{const match=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true,media:query,addEventListener(){},removeEventListener(){}}:match(query);});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/login');
  await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('frase-ficticia-de-teste');await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL(origin+'/app');await page.locator('body[data-account-ready="true"]').waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  const toggle=page.getByRole('button',{name:'Abrir menu da conta'}),panel=page.locator('#accountToolbar');
  assert.equal(await toggle.isVisible(),true);assert.equal(await panel.isVisible(),false,JSON.stringify(await page.evaluate(()=>({width:innerWidth,display:getComputedStyle(document.querySelector('#accountToolbar')).display,open:document.querySelector('.topbar').dataset.accountMenuOpen}))));
  for(const width of [320,360,375,390,414,430]){
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`rolagem horizontal em ${width}px`);
    const brand=await page.locator('.brand').boundingBox(),button=await page.locator('#accountMenuToggle').boundingBox();
    assert.ok(brand.x+brand.width<=button.x,`logo sobrepõe o menu em ${width}px`);
    assert.ok(button.width>=44&&button.height>=44,`área de toque abaixo de 44px em ${width}px`);
    const introTop=await page.locator('.intro').evaluate(el=>el.getBoundingClientRect().top);
    await page.locator('#accountMenuToggle').click();assert.equal(await panel.isVisible(),true);
    assert.equal(await page.locator('#accountMenuToggle').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#accountToolbar a').innerText(),'Minha conta');
    assert.ok(await page.locator('#accountToolbar #exportBtn').isVisible());assert.ok(await page.locator('#accountToolbar #accountLogout').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`menu gerou rolagem em ${width}px`);
    assert.equal(await page.locator('.intro').evaluate(el=>el.getBoundingClientRect().top),introTop,`menu deslocou a página em ${width}px`);
    await page.locator('#accountMenuToggle').click();assert.equal(await panel.isVisible(),false);
  }

  await page.setViewportSize({width:320,height:740});
  await page.addStyleTag({content:'html{font-size:150%!important}.brand{font-size:24px!important;letter-spacing:0!important}.account-toolbar a,.account-toolbar button{font-size:19px!important}'});
  await page.locator('#accountDisplay').evaluate(el=>{el.textContent='nome.de.conta.ficticia.com.um.endereco.de.email.extremamente.longo@example.invalid';});
  await page.locator('#exportBtn').evaluate(el=>{el.textContent='Exportar todos os dados financeiros da minha conta';});
  await page.locator('#accountMenuToggle').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fonte ampliada causou rolagem horizontal');
  assert.ok(await page.locator('#accountToolbar #exportBtn').evaluate(el=>el.scrollHeight>el.clientHeight||el.clientHeight>=48),'rótulo ampliado não cabe na área de toque');
  assert.ok(await page.locator('#accountToolbar #exportBtn').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'texto longo saiu do botão');
  await page.locator('#exportBtn').evaluate(el=>{el.textContent='Exportar dados ↗';});
  await page.screenshot({path:path.join(output,'cabecalho-mobile-corrigido.png'),fullPage:false});
  await page.locator('#voiceTitle').click();assert.equal(await panel.isVisible(),false,'toque fora não fechou o menu');
  await page.locator('#accountMenuToggle').click();await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false,'Escape não fechou o menu');assert.equal(await page.locator('#accountMenuToggle').evaluate(el=>el===document.activeElement),true,'foco não voltou ao botão');
  await page.keyboard.press('Enter');assert.equal(await panel.isVisible(),true,'Enter não abriu o menu');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Minha conta','Tab não alcançou Minha conta');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'exportBtn','Tab não alcançou Exportar dados');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'accountLogout','Tab não alcançou Sair');await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);

  await page.setViewportSize({width:390,height:844});
  await page.locator('#accountMenuToggle').click();
  await page.getByRole('link',{name:'Minha conta'}).click();await page.waitForURL(origin+'/conta');
  assert.equal(await page.getByRole('heading',{name:'Seu acesso e suas preferências.'}).count(),1);
  await page.getByRole('link',{name:'Voltar ao aplicativo'}).click();await page.waitForURL(origin+'/app');await page.locator('body[data-account-ready="true"]').waitFor();
  await page.locator('#accountMenuToggle').click();
  page.once('dialog',dialog=>dialog.dismiss());const downloadPromise=page.waitForEvent('download');await page.locator('#exportBtn').click();const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^falou-anotou-backup-\d{4}-\d{2}-\d{2}\.json$/);assert.equal(await panel.isVisible(),false,'menu não fechou ao exportar');
  await page.locator('#accountMenuToggle').click();await page.locator('#accountLogout').click();await page.waitForURL(url=>url.pathname==='/login');
  await page.goto(origin+'/app');await page.waitForURL(url=>url.pathname==='/login');

  await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/login');
  await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByLabel('Senha',{exact:true}).fill('frase-ficticia-de-teste');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(origin+'/app');
  assert.equal(await page.locator('#accountMenuToggle').isVisible(),false,'botão mobile apareceu no desktop');assert.equal(await page.getByRole('link',{name:'Minha conta'}).isVisible(),true,'ações desktop deixaram de aparecer');
  assert.deepEqual(errors,[]);
  console.log('PASS: larguras 320/360/375/390/414/430; fonte e rótulos ampliados; menu/fora/Escape; conta; exportação JSON; logout; desktop; modo standalone simulado; sem erros JS.');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(runtime,{recursive:true,force:true});});
