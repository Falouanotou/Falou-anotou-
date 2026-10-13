'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
test('Manifesto possui identidade, abertura segura e ícones PNG nos tamanhos corretos',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
 assert.equal(manifest.name,'Falou, Anotou!');assert.equal(manifest.short_name,manifest.name);
 assert.equal(manifest.id,'/login');assert.equal(manifest.start_url,'/login');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){assert.equal(icon.type,'image/png');const png=fs.readFileSync(path.join(root,icon.src));assert.equal(png.subarray(1,4).toString(),'PNG');const size=png.readUInt32BE(16);assert.equal(png.readUInt32BE(20),size);assert.equal(icon.sizes,`${size}x${size}`);}
 assert.ok(manifest.icons.some(i=>i.sizes==='192x192'&&i.purpose==='any'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'&&i.purpose==='any'));assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
 const apple=fs.readFileSync(path.join(root,'apple-touch-icon.png'));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 const deployment=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));assert.ok(deployment.headers.some(h=>h.headers.some(v=>v.key==='Cache-Control'&&v.value.includes('no-store'))));
});
test('Worker não intercepta requests nem grava cache; atualização elimina caches legados do app',async()=>{
 const handlers={},deleted=[];let claimed=false,skipped=false;
 vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{self:{addEventListener:(name,handler)=>{handlers[name]=handler;},skipWaiting:()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}},caches:{keys:async()=>['falou-anotou-old-private','unrelated'],delete:async name=>{deleted.push(name);}}});
 assert.equal(handlers.fetch,undefined);handlers.install();let work;handlers.activate({waitUntil:p=>{work=p;}});await work;
 assert.equal(skipped,true);assert.equal(claimed,true);assert.deepEqual(deleted,['falou-anotou-old-private']);
});
