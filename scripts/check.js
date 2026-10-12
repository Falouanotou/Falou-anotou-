'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function walk(dir){for(const file of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.runtime','dist','qa','public','.netlify','.vercel'].includes(file.name))continue;const full=path.join(dir,file.name);if(file.isDirectory())walk(full);else if(/\.m?js$/.test(file.name)){const result=spawnSync(process.execPath,['--check',full],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}count++;}}}
walk(root);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('IDs HTML duplicados.');
for(const file of ['app.js','receipt-ui.js']){const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/\$\('([^']+)'\)/g))if(!ids.includes(match[1]))throw Error(`${file}: elemento ausente ${match[1]}`);}
console.log(`Verificação estática: ${count} scripts com sintaxe válida, IDs HTML únicos e referências de elementos presentes.`);

