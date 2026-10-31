(function(root){
 'use strict';
 // Bytes are persisted and checked by the supplied reader; this queue keeps no GPS history.
 function create(pages,read,changed,options={}){
  const now=options.now||Date.now,later=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,online=options.online||(()=>true);
  const records=new Map(pages.map(page=>[page.file,{page,status:'waiting',attempts:0,retry:0}]));
  let order=[...records.keys()],active=0,timer=null,stopped=false;
  function status(){const all=[...records.values()];return {total:all.length,ready:all.filter(r=>r.status==='ready').length,active,paused:!online(),failed:all.filter(r=>r.status==='failed').length}}
  function pump(){
   if(stopped)return;if(timer!==null){cancel(timer);timer=null}changed(status());
   while(active<(options.concurrency||2)){
    const record=order.map(k=>records.get(k)).find(r=>r.status!=='ready'&&r.status!=='pending'&&(online()?r.retry<=now():!r.offlineChecked));if(!record)break;
    record.status='pending';record.offlineChecked=true;active++;
    Promise.resolve().then(()=>read(record.page)).then(()=>{record.status='ready';record.retry=0},()=>{record.status='failed';record.retry=now()+Math.min(30000,5000*2**Math.min(record.attempts++,3))}).finally(()=>{active--;if(!stopped){changed(status());pump()}});
   }
   const retries=[...records.values()].filter(r=>r.status==='failed').map(r=>r.retry);
   if(retries.length&&online())timer=later(pump,Math.max(1000,Math.min(...retries)-now()));
  }
  return {start:pump,status,prioritize(pages){const first=pages.map(p=>p.file).filter(k=>records.has(k));order=[...new Set([...first,...order])];pump()},resume(){for(const r of records.values())if(r.status==='failed')r.retry=0;pump()},stop(){stopped=true;if(timer!==null)cancel(timer)}};
 }
 const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailOfflinePages=api;
})(typeof globalThis!=='undefined'?globalThis:this);
