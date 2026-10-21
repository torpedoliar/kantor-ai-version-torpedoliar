// Static previews use a separate loopback port and never share the application's origin or credentials.
const http=require('node:http'),crypto=require('node:crypto');
const TYPES={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',txt:'text/plain'};
function createPreviewService({projects}){
  const active=new Map();
  async function stop(taskId){const prior=active.get(taskId);if(prior){active.delete(taskId);await new Promise(resolve=>prior.server.close(resolve));}}
  async function open(task){
    const prior=active.get(task.id);if(prior?.revisionId===task.revisionId)return {url:prior.url};
    await stop(task.id);
    const manifest=projects.manifest(task.projectId,task.revisionId);
    if(manifest.runtime!=='static-web')throw Object.assign(Error('Preview Node service belum tersedia; gunakan petunjuk menjalankan setelah memeriksa sumber.'),{status:409,code:'PREVIEW_UNSUPPORTED'});
    const token=crypto.randomBytes(24).toString('hex');
    const server=http.createServer((req,res)=>{
      if(req.method!=='GET'){res.writeHead(405);return res.end();}
      const prefix=`/${token}/`;let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{res.writeHead(400);return res.end();}
      if(!url.pathname.startsWith(prefix)){res.writeHead(404);return res.end();}
      try{
        const file=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html',content=projects.readFile(task.projectId,task.revisionId,file);
        res.writeHead(200,{'content-type':`${TYPES[file.split('.').at(-1)]||'text/plain'}; charset=utf-8`,'x-content-type-options':'nosniff','cache-control':'no-store',
          'content-security-policy':"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"});res.end(content);
      }catch{res.writeHead(404);res.end('File tidak ditemukan.');}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url=`http://127.0.0.1:${server.address().port}/${token}/`;
    active.set(task.id,{server,url,revisionId:task.revisionId});return {url};
  }
  return {open,stop};
}
module.exports={createPreviewService};
