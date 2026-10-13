'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'public');
const checked=spawnSync(process.execPath,[path.join(__dirname,'check.js')],{stdio:'inherit'});if(checked.status!==0)process.exit(checked.status||1);
// Whitelist, never copy the server bundle, .env, credentials or sessions to public.
const files=['styles.css','auth.css','auth.js','account-api.js','app.js','finance-query.js','receipt-parser.js','receipt-ui.js','pwa.js','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','icon.svg','manifest.webmanifest','sw.js'];
fs.mkdirSync(dest,{recursive:true});
for(const name of fs.readdirSync(dest))if(!files.includes(name))throw Error('Arquivo público inesperado: '+name+'. Revise antes de publicar; build interrompido.');
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(dest,file));
console.log('Build: public/ contém somente assets. HTML privado e APIs são servidos pela Function. Nenhuma publicação realizada.');

