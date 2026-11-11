import http from 'node:http';
import {pathToFileURL} from 'node:url';
const worker=(await import(pathToFileURL(process.cwd()+'/dist/server/index.js'))).default;
let config='';process.stdin.setRawMode?.(true);process.stdin.setEncoding('utf8');
console.log('Ready for private preview configuration on stdin.');
const environment=await new Promise((resolve,reject)=>{
  function collect(chunk){
    config+=chunk;const end=config.indexOf('\n');
    if(end===-1)return;
    process.stdin.off('data',collect);
    try{resolve(JSON.parse(config.slice(0,end)));}catch(error){reject(error);}
  }
  process.stdin.on('data',collect);
});
const server=http.createServer(async(req,res)=>{
  try{const parts=[];for await(const part of req)parts.push(part);const headers=new Headers(req.headers);headers.set('CF-Connecting-IP','127.0.0.1');
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
    const response=await worker.fetch(request,environment,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Preview request failed.');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Preview ready: http://127.0.0.1:4173'));
process.stdin.on('data',chunk=>{if(chunk.includes('\u0003'))server.close(()=>process.exit(0));});
