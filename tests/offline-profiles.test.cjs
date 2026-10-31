'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Q=require('../rail/offline-pages.js');
const flush=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let n=0;n<300;n++){if(check())return;await flush()}throw Error('Timed out')}
async function queueChecks(){
 const pages=Array.from({length:131},(_,i)=>({file:'page-'+i})),saved=new Set(),calls=[];let connected=false,max=0,inflight=0;
 const load=async p=>{calls.push(p.file);if(saved.has(p.file))return;if(!connected)throw Error('offline');inflight++;max=Math.max(max,inflight);await flush();saved.add(p.file);inflight--};
 saved.add('page-0');const q=Q.create(pages,load,()=>{},{online:()=>connected});q.prioritize([pages[90]]);
 await until(()=>q.status().active===0);assert.equal(q.status().ready,1);assert.equal(calls[0],'page-90');assert.equal(saved.size,1);
 connected=true;q.resume();await until(()=>q.status().ready===131);assert(max<=2);assert.equal(saved.size,131);q.stop();
 const before=calls.length;q.resume();await flush();assert.equal(calls.length,before,'Disposed queue must not restart');
 connected=false;const restarted=Q.create(pages,load,()=>{},{online:()=>connected});restarted.start();await until(()=>restarted.status().ready===131);assert.equal(restarted.status().failed,0);restarted.stop();
 let time=0,timer,attempts=0;const retry=Q.create([pages[0]],async()=>{if(++attempts===1)throw Error('connection lost')},()=>{},{now:()=>time,setTimeout:fn=>{timer=fn;return 1},clearTimeout:()=>{}});retry.start();await until(()=>retry.status().failed===1);assert.equal(retry.status().ready,0);time=5000;timer();await until(()=>retry.status().ready===1);retry.stop();
}
async function integrationChecks(){
 const bodies=new Map(),make=(file,extra={})=>{const b=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'+file+'</svg>');bodies.set(file,b);return {file,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),...extra}};
 const pages=Array.from({length:4},(_,i)=>make('rail/regimes/test-'+i+'.svg',{number:i+1,kind:'profile',route:'ch-odd',start:7100000+i*10000,end:7110000+i*10000,profileBox:[0,0,800,500],width:800,height:500}));
 const catalog={schema:1,documents:[make('rail/regimes/test.pdf',{id:'test',name:'Test',pages:4,leaves:pages})],routes:[{id:'ch-odd',name:'Test odd',document:'test',direction:-1,start:7100000,end:7140000}]};
 class El{constructor(){this.style={};this.hidden=false;this.value='';this.children=[];this.disabled=false}append(x){this.children.push(x)}replaceChildren(){this.children=[]}setAttribute(){}removeAttribute(){}set src(v){this._src=v;queueMicrotask(()=>this.onload?.())}get src(){return this._src}}
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new El());return els.get(id)},events=new EventTarget(),win=new EventTarget(),store=new Map();let connected=false,fetches=0,blockOne=true;
 const cache={match:async k=>store.get(k)?.clone(),put:async(k,r)=>{store.set(k,r.clone())},delete:async k=>store.delete(k)};
 const navigator={onLine:false,storage:{estimate:async()=>({quota:1e9,usage:0})}};
 const ctx={document:{baseURI:'https://test/track-profile.html',getElementById:get,createElement:()=>new El(),dispatchEvent:e=>events.dispatchEvent(e)},window:win,navigator,caches:{open:async()=>cache},RegimeCore:require('../rail/regime-core.js'),RailCore:require('../rail/core.js'),RailOfflinePages:Q,URL:class extends URL{static createObjectURL(){return 'blob:test'}static revokeObjectURL(){}},Blob,Response,TextDecoder,DOMException,AbortController,crypto:crypto.webcrypto,Event,CustomEvent:class extends Event{constructor(name,o){super(name);this.detail=o?.detail}},queueMicrotask,setTimeout,clearTimeout,
 fetch:async url=>{if(String(url).includes('regime-catalog'))return new Response(JSON.stringify(catalog));fetches++;if(!connected||blockOne&&url.endsWith('test-2.svg'))throw Error('connection lost');return new Response(bodies.get(new URL(url).pathname.slice(1)))} };
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../rail/regime.js'),'utf8'),ctx);
 const viewer=await ctx.RegimeViewer.create(()=>{});await until(()=>viewer.offlineStatus().active===0);assert.equal(fetches,0,'Offline startup must only inspect saved bytes');
 connected=true;navigator.onLine=true;win.dispatchEvent(new Event('online'));await until(()=>viewer.offlineStatus().ready===3&&viewer.offlineStatus().active===0);assert(!get('driverOffline').textContent.startsWith('Все профили'));
 blockOne=false;win.dispatchEvent(new Event('online'));await until(()=>viewer.offlineStatus().ready===4);assert.match(get('driverOffline').textContent,/Все профили сохранены офлайн/);
 connected=false;navigator.onLine=false;win.dispatchEvent(new Event('offline'));const before=fetches;
 for(const p of pages)assert.match(await viewer.readPage(p),/svg/);assert.equal(fetches,before);assert.equal(store.size,4,'Only profiles are downloaded automatically, not PDF');
 // Reopening with no network must confirm the entire persisted profile collection.
 const second=await ctx.RegimeViewer.create(()=>{});await until(()=>second.offlineStatus().ready===4);assert.equal(fetches,before);
 // Corrupt data is rejected offline and recovered when the connection returns.
 store.set('https://test/'+pages[0].file,new Response('damaged'));await assert.rejects(viewer.readPage(pages[0]));connected=true;navigator.onLine=true;await viewer.readPage(pages[0]);assert.match(await store.get('https://test/'+pages[0].file).text(),/svg/);
 win.dispatchEvent(new Event('pagehide'));
}
async function tileChecks(){
 const ctx={document:{getElementById(){}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../rail/driver-profile.js'),'utf8'),ctx);
 let online=false,calls=0;const store=ctx.DriverProfile.createPageStore(async p=>{calls++;if(!online)throw Error('offline');return p.file},()=>{}),p={file:'missing.svg'};
 await store.request(p);assert.equal(store.status(p),'failed');online=true;store.retryFailed(p.file);assert.equal(await store.request(p),'missing.svg');assert.equal(store.status(p),'ready');await store.request(p);assert.equal(calls,2);
}
(async()=>{await queueChecks();await integrationChecks();await tileChecks();console.log('PASS: 131-page queue, bounded concurrency, priority, network recovery/backoff, persisted offline restart, checksum rejection/recovery, complete-cache status, failed visible-tile retry')})().catch(e=>{console.error(e);process.exitCode=1});
