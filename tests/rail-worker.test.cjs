'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function install(mode){
 const handlers={},saved=new Map(),cachesByName=new Map();let activated=false,bodyRead=false;
 const oldPages=new Map([['saved-page','source-pdf']]);cachesByName.set('rabochee-regime-documents-v1',oldPages);
 const cache={match:async p=>saved.get(p),put:async(p,r)=>saved.set(p,r)};
 const context={Request:class{constructor(input,options){this.url=String(input);this.signal=options.signal}},AbortController,URL,Promise,
  setTimeout:(fn,ms)=>setTimeout(fn,ms>=15000?5:100),clearTimeout,
  fetch:async request=>{const geometry=request.url.endsWith('.geojson');if(geometry&&mode==='network-error')throw Error('offline');return {ok:true,type:'basic',clone(){return {arrayBuffer:()=>{bodyRead=true;if(mode==='slow-body'&&geometry)return new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})});return Promise.resolve(new ArrayBuffer(0))}}}}},
  caches:{open:async name=>{if(!cachesByName.has(name))cachesByName.set(name,saved);return cache},keys:async()=>[...cachesByName.keys()]},
  self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{activated=true}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../service-worker.js'),'utf8'),context);
 let completion;handlers.install({waitUntil:p=>completion=p});let failed=false;try{await completion}catch(e){failed=true}
 assert.equal(cachesByName.get('rabochee-regime-documents-v1'),oldPages,'Source page cache must remain untouched');
 return {activated,bodyRead,failed,saved};
}
(async()=>{const good=await install('ok');assert(good.activated);assert(good.bodyRead);assert(good.saved.has('./rail/route-geometry.geojson'));assert(good.saved.has('./rail/geometry.js'));for(const mode of ['network-error','slow-body']){const bad=await install(mode);assert(bad.failed);assert.equal(bad.activated,false,'Incomplete geometry cache must keep previous worker')}console.log('PASS complete offline geometry cache; failed download or slow body blocks activation; saved regime cache untouched')})().catch(e=>{console.error(e);process.exitCode=1});
