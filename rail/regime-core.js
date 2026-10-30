(function(root){
 'use strict';
 const PATH=/^rail\/regimes\/[a-z0-9-]+\.(svg|pdf)$/,HASH=/^[a-f0-9]{64}$/;
 function validate(c){
  if(c?.schema!==1||!Array.isArray(c.documents)||!Array.isArray(c.routes)||!c.documents.length)throw Error('Неверный каталог режимок');
  const ids=new Set();
  for(const d of c.documents){
   if(ids.has(d.id)||!Array.isArray(d.leaves)||d.leaves.length!==d.pages)throw Error('Неверный состав документа');ids.add(d.id);
   for(const a of [d,...d.leaves])if(!PATH.test(a.file)||!HASH.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<1)throw Error('Неверный ресурс режимки');
   const pages=new Set();for(const l of d.leaves){if(!Number.isInteger(l.number)||l.number<1||l.number>d.pages||pages.has(l.number))throw Error('Ошибка номера листа');pages.add(l.number);
    if(l.kind==='profile'&&(!Number.isFinite(l.start)||!Number.isFinite(l.end)||l.end<=l.start||!Array.isArray(l.profileBox)||l.profileBox.length!==4||!l.profileBox.every(Number.isFinite)))throw Error('Ошибка границ профиля');
   }
  }
  const routes=new Set();for(const r of c.routes){if(routes.has(r.id)||!ids.has(r.document)||![1,-1].includes(r.direction)||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<=r.start)throw Error('Ошибка направления');routes.add(r.id)}
  for(const d of c.documents)for(const l of d.leaves)if(l.kind==='profile'&&!routes.has(l.route))throw Error('Направление листа отсутствует');
  return c;
 }
 function parsePosition(km,pk,metres){
  const values=[km,pk,metres];if(values.some(v=>String(v).trim()===''||!/^\d+$/.test(String(v).trim())))throw Error('Введите целые км, ПК и метры.');
  [km,pk,metres]=values.map(Number);if(!Number.isSafeInteger(km)||km<0||pk<1||pk>10||metres<0||metres>99)throw Error('ПК: 1–10, метры: 0–99.');return km*1000+(pk-1)*100+metres;
 }
 function find(c,routeId,m){
  const route=c.routes.find(r=>r.id===routeId);if(!route||!Number.isFinite(m))return {status:'missing',leaves:[]};
  const document=c.documents.find(d=>d.id===route.document),leaves=document.leaves.filter(l=>l.route===routeId&&l.start<=m&&m<l.end);
  return {status:leaves.length===1?'found':leaves.length>1?'ambiguous':'missing',route,document,leaves};
 }
 function assets(document){return [document,...document.leaves]}
 const api={validate,parsePosition,find,assets};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RegimeCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
