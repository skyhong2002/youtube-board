import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

// Separate rollback service: no application imports, DB, credentials or request logs.
const body=JSON.stringify({error:{code:'ACCOUNT_MAINTENANCE',message:'Account services are temporarily unavailable.'}})+'\n';
const headers=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store',
 'Retry-After':'300',
 'X-Robots-Tag':'noindex',
 'Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff',
 'Strict-Transport-Security':'max-age=31536000',
 'Connection':'close',
});
const probes=new Set(['/up','/healthz','/runtime/ready']);
export function createMaintenanceServer(){
 const server=createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:1000},(request,response)=>{
  // Only exact query-free local health paths bypass maintenance. Every other
  // request gets the same generic response, regardless of method/path/query.
  const healthy=['GET','HEAD'].includes(request.method)&&probes.has(request.url);
  const payload=healthy?JSON.stringify({status:'ready',service:'youtube-board-account-maintenance'})+'\n':body;
  response.writeHead(healthy?200:503,{...headers,'Content-Length':Buffer.byteLength(payload)});
  response.end(request.method==='HEAD'?undefined:payload);
 });
 server.maxHeadersCount=32;
 // Never allow CONNECT tunnels or WebSocket upgrades through the rollback route.
 const rejectUpgrade=(_request,socket)=>{
  socket.end('HTTP/1.1 503 Service Unavailable\r\n'+Object.entries({...headers,'Content-Length':Buffer.byteLength(body)}).map(([key,value])=>`${key}: ${value}\r\n`).join('')+'\r\n'+body);
 };
 server.on('connect',rejectUpgrade);
 server.on('upgrade',rejectUpgrade);
 return server;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const raw=process.env.PORT??'8000';
 if(!/^\d{1,5}$/.test(raw)||Number(raw)<1024||Number(raw)>65535)throw new Error('Invalid maintenance port');
 const server=createMaintenanceServer();
 let stopping=false;
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  if(stopping)return;stopping=true;
  const deadline=setTimeout(()=>process.exit(1),5000).unref();
  server.close(()=>{clearTimeout(deadline);process.exit(0);});
 });
 server.listen(Number(raw),'0.0.0.0');
}
