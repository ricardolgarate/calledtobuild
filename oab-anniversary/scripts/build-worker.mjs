import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const files=['index.html','styles.css','app.js','referral/index.html','referral/referral.js','referral/referral.css','assets/logo.webp','assets/project-0.jpg','assets/project-2.jpg','assets/project-9.jpg','assets/project-10.jpg'];
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.webp':'image/webp'};
const assets={};
for(const file of files){const data=await fs.readFile(path.join(root,'web',file));assets['/'+file]={type:mime[path.extname(file)],base64:data.toString('base64')};}
const source=(await fs.readFile('worker/index.js','utf8')).replace('/*__PUBLIC_ASSETS__*/ {}',JSON.stringify(assets));
const manifest=JSON.parse(await fs.readFile('.openai/hosting.json','utf8'));if(manifest.static)throw new Error('Worker must not retain static deployment');
await fs.rm('dist',{recursive:true,force:true});await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/.openai',{recursive:true});
await fs.writeFile('dist/server/index.js',source);await fs.writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));
console.log(`Built public pages and form server (${files.length} public files; no private data embedded).`);
