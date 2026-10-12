'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base='http://localhost:18985',output=process.env.QA_OUTPUT||path.join(root,'qa');
fs.mkdirSync(output,{recursive:true});
// Explicitly empty Supabase configuration: these tests must NEVER accept a fake login.
const child=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,NODE_ENV:'development',PORT:'18985',APP_ORIGIN:base,SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:'',AUTH_RUNTIME_DIR:path.join(output,'runtime')},stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser;
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Servidor de teste não iniciou.')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error('Servidor encerrou: '+code));});});
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
  for(const[name,viewport]of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
    const context=await browser.newContext({viewport,isMobile:name==='mobile',hasTouch:name==='mobile',locale:'pt-BR'}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.waitForURL(base+'/login');await page.locator('#authConfiguration').waitFor({state:'visible'});
    assert.equal(await page.locator('#historyList').count(),0);assert.equal(await page.getByRole('button',{name:'Entrar',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Continuar com Google',exact:true}).count(),1);
    await page.screenshot({path:path.join(output,`login-${name}.png`),fullPage:true});
    await page.getByRole('link',{name:'Criar minha conta',exact:true}).click();await page.getByLabel('Como podemos chamar você?').fill('Pessoa fictícia');await page.getByLabel('E-mail',{exact:true}).fill('fictional@example.invalid');await page.getByLabel('Senha',{exact:true}).fill('frase-ficticia-de-teste');await page.getByLabel('Confirme a senha',{exact:true}).fill('outra-frase-ficticia');await page.locator('#authAccepted').check();await page.getByRole('button',{name:'Criar minha conta',exact:true}).click();await page.locator('#authMessage').filter({hasText:'As senhas precisam ser iguais'}).waitFor();
    await page.getByLabel('Confirme a senha',{exact:true}).fill('frase-ficticia-de-teste');await page.getByRole('button',{name:'Criar minha conta',exact:true}).click();await page.locator('#authMessage').filter({hasText:'ainda precisa ser configurada'}).waitFor();assert.equal(await page.locator('#historyList').count(),0);await page.screenshot({path:path.join(output,`cadastro-${name}.png`),fullPage:true});
    await page.goto(base+'/termos-de-uso');assert.equal(await page.getByRole('heading',{name:'Termos de Uso',exact:true}).count(),1);assert.ok((await page.locator('body').innerText()).includes('MINUTA'));await page.screenshot({path:path.join(output,`termos-${name}.png`),fullPage:true});
    await page.goto(base+'/politica-de-privacidade');assert.equal(await page.getByRole('heading',{name:'Política de Privacidade',exact:true}).count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,`privacidade-${name}.png`),fullPage:true});
    await page.goto(base+'/app');await page.waitForURL(base+'/login');assert.equal(await page.locator('#historyList').count(),0);
    await page.getByLabel('E-mail',{exact:true}).fill('fictional@example.invalid');await page.getByLabel('Senha',{exact:true}).fill('frase-ficticia-de-teste');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#authMessage').filter({hasText:'Nenhuma conta ou login foi simulado'}).waitFor();
    await page.getByRole('button',{name:'Continuar com Google',exact:true}).click();await page.locator('#authMessage').filter({hasText:'ainda precisa ser configurada'}).waitFor();
    await page.getByRole('link',{name:'Esqueci minha senha',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill('fictional@example.invalid');await page.getByRole('button',{name:'Enviar link de recuperação',exact:true}).click();await page.locator('#authMessage').filter({hasText:'ainda precisa ser configurada'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(errors.length,0,errors.join('\n'));
    console.log(`OK ${name}: login inicial, cadastro/validação, links jurídicos públicos, privado bloqueado e nenhum login simulado. ${viewport.width}x${viewport.height}, sem erro JS/transbordamento.`);await context.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();child.kill();});
