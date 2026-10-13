'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'dist');
const check=spawnSync(process.execPath,[path.join(__dirname,'check.js')],{stdio:'inherit'});if(check.status!==0)process.exit(check.status||1);
fs.mkdirSync(dest,{recursive:true});
const files=['index.html','styles.css','auth.css','auth.js','account-api.js','app.js','finance-query.js','receipt-parser.js','receipt-ui.js','pwa.js','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','icon.svg','manifest.webmanifest','sw.js','server.js','package.json','package-lock.json','.env.example'];
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(dest,file));
fs.cpSync(path.join(root,'server'),path.join(dest,'server'),{recursive:true});
console.log('Build em dist/. Sem .env, tokens, node_modules, registros ou sessões. Ainda exige npm ci --omit=dev e configuração antes de executar.');
