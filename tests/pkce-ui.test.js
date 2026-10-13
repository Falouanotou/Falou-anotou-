'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','auth.js'),'utf8');
test('Falha PKCE remove estado permanente, não repete código e oferece novo pedido acessível',async()=>{
 const events=[],classes=new Set(),elements={authForm:{attributes:{},addEventListener(){},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}},authSubmit:{disabled:false,hidden:false},recoveryRetry:{hidden:true,href:'/recuperar-senha'},authMessage:{textContent:'',classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}}};
 let replaced,finishMessage;const failedMessage=new Promise(resolve=>{finishMessage=resolve;});Object.defineProperty(elements.authMessage,'textContent',{get(){return this.value||'';},set(value){this.value=value;if(value.includes('Não foi possível validar este link'))finishMessage();}});
 const document={querySelector(selector){return selector==='[data-auth-mode]'?{dataset:{authMode:'confirm'}}:null;},getElementById(id){return elements[id]||null;},querySelectorAll(selector){return selector==='button'?[elements.authSubmit]:[];}};
 const fetch=async(route,options={})=>{events.push({route,options});if(route==='/api/auth/session')return{ok:true,status:200,async json(){return{csrf:'fixture-csrf',user:null,config:{configured:true}};}};if(route==='/api/auth/confirm')return{ok:false,status:400,async json(){return{error:'Mensagem pública genérica.'};}};throw Error('Rota inesperada');};
 const location={search:'?code=fictional-one-time-code&sb_flow_id=fixture-flow',hash:'',pathname:'/auth/confirm'},history={replaceState(_a,_b,url){replaced=url;}};
 vm.runInNewContext(source,{document,URLSearchParams,location,history,fetch,Error,TypeError,console});
 await Promise.race([failedMessage,new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout da interface')),1000))]);
 assert.equal(elements.authSubmit.hidden,true);assert.equal(elements.authSubmit.disabled,true);assert.equal(elements.recoveryRetry.hidden,false);assert.equal(elements.recoveryRetry.href,'/recuperar-senha');assert.equal(elements.authForm.attributes['aria-busy'],undefined);assert.ok(classes.has('is-error'));assert.equal(replaced,'/auth/confirm');assert.deepEqual(events.map(x=>x.route),['/api/auth/session','/api/auth/confirm']);assert.equal(events.filter(x=>x.route==='/api/auth/confirm').length,1);
});
