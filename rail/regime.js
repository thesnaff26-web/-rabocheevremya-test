(function(root){
 'use strict';
 const CACHE='rabochee-regime-documents-v1',RC=root.RegimeCore;
 async function create(onPosition){
  const $=id=>document.getElementById(id),res=await fetch('./rail/regime-catalog.json');if(!res.ok)throw Error('Каталог режимок недоступен');
  const catalog=RC.validate(await res.json());const overrides=new Map();let positionQuality=null,liveConfirmed=false,overviewOnly=false,positionMode='manual',routeId='ch-odd',chain=6906000,leaf=null,doc=null,focused=true,width=1200,blobUrl=null,loadId=0,loadAbort=null,saveAbort=null;
  const absolute=a=>new URL('./'+a.file,document.baseURI).href;
  const cacheSupported=typeof caches!=='undefined';
  if(!globalThis.crypto?.subtle)throw Error('Для проверки файлов откройте приложение по HTTPS.');
  function message(text){$('regimeStatus').textContent=text;queueMicrotask(()=>document.dispatchEvent(new Event('regimechange')))}
  const reads=new Map(),transfers=new Set();let profileQueue=null;
  function profileProgress(info){
   const el=$('driverOffline');if(el)el.textContent=info.ready===info.total?'Все профили сохранены офлайн · '+info.total+' листов.':(info.paused?'Нет сети. ':'')+'Профили офлайн: '+info.ready+' из '+info.total+' листов. '+(info.paused?'Сохранение продолжится при появлении связи.':info.failed?'Повторяем загрузку недостающих листов.':'Сохраняем автоматически; не закрывайте карту до завершения.');
  }
  function prioritizePages(pages){profileQueue?.prioritize(pages)}
  function prioritizeRoute(){
   const r=activeRoute();prioritizePages(catalog.documents.find(d=>d.id===r.document).leaves.filter(p=>p.kind==='profile').sort((a,b)=>(a.route===r.id?0:1)-(b.route===r.id?0:1)||Math.abs((a.start+a.end)/2-chain)-Math.abs((b.start+b.end)/2-chain)));
  }
  function sharedRead(page){
   if(!reads.has(page.file))reads.set(page.file,verified(page).then(bytes=>{document.dispatchEvent(new CustomEvent('regimepagesready',{detail:{file:page.file}}));return bytes}).finally(()=>reads.delete(page.file)));
   return reads.get(page.file);
  }
  async function downloadBytes(url,signal){
   if(navigator.onLine===false)throw Error('Нет сети. Лист ещё не сохранён офлайн.');
   const controller=new AbortController();transfers.add(controller);let timedOut=false;
   const cancel=()=>controller.abort();if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(()=>{timedOut=true;controller.abort()},45000);
   try{const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Файл недоступен: '+response.status);return await response.arrayBuffer()}
   catch(e){if(timedOut)throw Error('Лист не загрузился за 45 секунд. Проверьте связь или сохраните режимку офлайн.');throw e}
   finally{transfers.delete(controller);clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
  }
  async function verified(asset,signal){
   const url=absolute(asset);let cache=null,hit=null;
   try{if(cacheSupported){cache=await caches.open(CACHE);hit=await cache.match(url)}}catch(e){if(saveAbort)throw Error('Офлайн-хранилище недоступно в этом браузере.');cache=null;$('regimeOffline').textContent='Лист можно открыть с интернетом; офлайн-хранилище недоступно.';}
   if(saveAbort&&!cache)throw Error('Офлайн-хранилище недоступно в этом браузере.');
   for(let attempt=0;attempt<2;attempt++){
    if(signal?.aborted)throw new DOMException('Остановлено','AbortError');
    const bytes=hit?await hit.arrayBuffer():await downloadBytes(url,signal);if(bytes.byteLength!==asset.bytes){if(hit){await cache.delete(url);hit=null;continue}throw Error('Неполный файл. Повторите загрузку.');}
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==asset.sha256){if(hit){await cache.delete(url);hit=null;continue}throw Error('Файл не совпадает с каталогом. Показ отменён.');}
    if(!hit&&cache){try{await cache.put(url,new Response(bytes,{headers:{'Content-Type':asset.file.endsWith('.svg')?'image/svg+xml':'application/pdf','X-Regime-SHA256':hash}}))}catch(e){if(saveAbort)throw Error('Не удалось сохранить офлайн: недостаточно места или запрет хранилища.');$('regimeOffline').textContent='Лист открыт, но не сохранён офлайн.'}}
    return bytes;
   }throw Error('Повреждённый сохранённый файл.');
  }
  function activeRoute(){return catalog.routes.find(r=>r.id===routeId)}
  function activeDoc(){return catalog.documents.find(d=>d.id===activeRoute().document)}
  function fillPages(){doc=activeDoc();$('regimePages').replaceChildren();for(const p of doc.leaves){const o=document.createElement('option');o.value=p.number;const r=catalog.routes.find(r=>r.id===p.route);o.textContent=p.number+'. '+p.title+(r?' · '+(r.direction===1?'чётный':'нечётный'):'');$('regimePages').append(o)}$('regimePdf').href=absolute(doc);$('regimePdf').download=doc.file.split('/').pop();$('regimeSave').textContent='Сохранить режимку офлайн · '+Math.ceil(RC.assets(doc).reduce((n,a)=>n+a.bytes,0)/1048576)+' МБ';offlineState().catch(()=>{})}
  async function offlineState(){
   const document=activeDoc();if(!cacheSupported){$('regimeOffline').textContent='Браузер не поддерживает офлайн-хранилище.';$('regimeSave').disabled=true;return}
   const cache=await caches.open(CACHE);let count=0;const list=RC.assets(document);
   for(const a of list){const hit=await cache.match(absolute(a));if(hit?.headers.get('X-Regime-SHA256')===a.sha256)count++}
   if(document.id===activeDoc().id&&!saveAbort)$('regimeOffline').textContent=count===list.length?'Режимка целиком сохранена офлайн.':'Сохранено '+count+' из '+list.length+' файлов выбранной режимки.';
  }
  function positionText(){return overviewOnly?'Обзор участка по GPS. Км/ПК не подтверждён.':(positionMode==='gps'?'Оценка по GPS: ≈ '+RailCore.formatPicket(chain)+'. Привязка к пикету и выбранному пути не проверена.':'Выбрано вручную: '+RailCore.format(chain)+'. Показан исходный профиль выбранного пути.')}
  function inputPosition(m){const x=Math.round(m),km=Math.floor(x/1000),rest=x%1000;$('regimeKm').value=km;$('regimePk').value=Math.floor(rest/100)+1;$('regimeMetres').value=rest%100}
  function clearImage(){loadId++;loadAbort?.abort();$('regimeImage').hidden=true;$('regimeImage').removeAttribute('src');if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null}leaf=null;$('regimeFocus').disabled=true;$('regimeBack').disabled=true;$('regimeNext').disabled=true}
  async function showPage(page,notify=false){
   if(notify){overviewOnly=false;positionMode='manual';if(page.route){const matched=RC.find(catalog,page.route,(page.start+page.end)/2);if(matched.status==='ambiguous')overrides.set(page.route+':'+page.start,page.number)}}clearImage();const id=loadId;leaf=page;const localLeaf=page,localDoc=doc;
   $('regimePages').value=page.number;
   if(page.route){routeId=page.route;$('regimeRoute').value=routeId;if(!(page.start<=chain&&chain<page.end))chain=(page.start+page.end)/2;inputPosition(chain)}else focused=false;
   if(notify&&page.route)onPosition(chain);
   $('regimeHeading').textContent=(page.route?activeRoute().name:localDoc.name)+' · лист '+page.number+' / '+localDoc.pages;
   $('regimeNote').textContent=page.note||'';$('regimeFocus').disabled=page.kind!=='profile';$('regimeFocus').textContent=focused?'Показать весь лист':'Профиль крупно';$('regimeFocus').setAttribute('aria-pressed',String(focused));
   $('regimeBack').disabled=page.number<=1;$('regimeNext').disabled=page.number>=localDoc.pages;message('Открываем лист '+page.number+'…');loadAbort=new AbortController();
   try{
    const bytes=await sharedRead(page);if(id!==loadId)return;
    let svg=new TextDecoder().decode(bytes);
    if(focused&&page.profileBox){const box=page.profileBox.join(' ');svg=svg.replace(/(<svg\b[^>]*\bviewBox=")[^"]*(")/,(_,a,b)=>a+box+b).replace(/(<svg\b[^>]*\bheight=")[^"]*(")/,(_,a,b)=>a+page.profileBox[3]+b).replace(/(<svg\b[^>]*\bwidth=")[^"]*(")/,(_,a,b)=>a+page.profileBox[2]+b)}
    blobUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const image=$('regimeImage');image.style.width=width+'px';image.style.height='auto';$('regimeViewport').scrollTop=0;image.onload=()=>{if(id!==loadId)return;image.hidden=false;message(page.route?positionText():'Справочный лист из исходного документа.');const fraction=page.route?(chain-page.start)/(page.end-page.start):0;const across=page.route?(activeRoute().direction===1?fraction:1-fraction):0;$('regimeViewport').scrollLeft=Math.max(0,across*width-$('regimeViewport').clientWidth/2);$('regimeViewport').scrollTop=0;offlineState().catch(()=>{})};image.onerror=()=>{if(id===loadId){image.hidden=true;leaf=null;message('Не удалось отрисовать лист. Откройте исходный PDF.')}};image.src=blobUrl;
   }catch(e){if(id!==loadId||e.name==='AbortError')return;message('Лист не открыт: '+e.message+' Если сети нет, заранее сохраните эту режимку офлайн.');$('regimeImage').hidden=true;leaf=null}
  }
  function scrollLive(){if(!leaf?.route)return;const fraction=(chain-leaf.start)/(leaf.end-leaf.start),across=activeRoute().direction===1?fraction:1-fraction;$('regimeViewport').scrollLeft=Math.max(0,(.06+.87*across)*width-$('regimeViewport').clientWidth/2)}
  function go(m,options={}){
   positionQuality=options.quality||null;positionMode=options.live?'gps':'manual';overviewOnly=!!options.preview;liveConfirmed=!!options.live&&!overviewOnly;chain=m;inputPosition(m);let result=RC.find(catalog,routeId,m);
   if(result.status==='missing'){
    const alternate=RC.autoRoute(catalog,routeId,m);
    if(alternate){const old=activeRoute().document;routeId=alternate.id;$('regimeRoute').value=routeId;if(old!==alternate.document)fillPages();result=RC.find(catalog,routeId,m)}
   }
   prioritizeRoute();
   if(result.status==='ambiguous'){const chosen=overrides.get(routeId+':'+result.leaves[0].start),target=result.leaves.find(l=>l.number===chosen);if(target)result={...result,status:'found',leaves:[target]}}
   if(result.status==='found'&&options.live&&!overviewOnly){const p=result.leaves[0],margin=Math.max(30,options.accuracy||0);if(chain-p.start<margin||p.end-chain<margin){clearImage();message('GPS около границы листов. Профиль скрыт до уточнения позиции.');return}}
   if(result.status==='found'){const target=result.leaves[0];if(leaf?.file===target.file){if(options.live)scrollLive();if($('regimeImage').hidden){message('Открываем лист '+target.number+'…');return}message(positionText());return}focused=true;showPage(target);return}
   clearImage();$('regimeHeading').textContent=activeRoute().name;
   $('regimeNote').textContent='';
   if(result.status==='ambiguous')message('В исходнике несколько листов для этого километра: '+result.leaves.map(l=>l.number).join(', ')+'. Автоматический выбор остановлен. Выберите нужный лист вручную в списке.');
   else message('В этих двух режимках нет профиля выбранного километра. Укажите км в пределах '+activeRoute().start/1000+'–'+activeRoute().end/1000+'.');
  }
  for(const r of catalog.routes){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;$('regimeRoute').append(o)}$('regimeRoute').value=routeId;fillPages();
  $('regimeRoute').onchange=e=>{routeId=e.target.value;fillPages();const r=activeRoute(),target=r.start<=chain&&chain<r.end?chain:r.direction===1?r.start:r.end-100;go(target);onPosition(target)};
  $('regimeGo').onclick=()=>{try{const m=RC.parsePosition($('regimeKm').value,$('regimePk').value,$('regimeMetres').value);go(m);onPosition(m)}catch(e){message(e.message)}};
  for(const id of ['regimeKm','regimePk','regimeMetres'])$(id).onkeydown=e=>{if(e.key==='Enter')$('regimeGo').click()};
  $('regimePages').onchange=e=>{const p=doc.leaves.find(l=>l.number===+e.target.value);if(p)showPage(p,true)};
  $('regimeBack').onclick=()=>{if(leaf){const p=doc.leaves.find(l=>l.number===leaf.number-1);if(p)showPage(p,true)}};
  $('regimeNext').onclick=()=>{if(leaf){const p=doc.leaves.find(l=>l.number===leaf.number+1);if(p)showPage(p,true)}};
  $('regimeFocus').onclick=()=>{if(leaf?.kind==='profile'){focused=!focused;showPage(leaf)}};
  $('regimePlus').onclick=()=>{width=Math.min(3600,Math.round(width*1.35));$('regimeImage').style.width=width+'px'};
  $('regimeMinus').onclick=()=>{width=Math.max(400,Math.round(width/1.35));$('regimeImage').style.width=width+'px'};
  $('regimeFit').onclick=()=>{width=Math.max(300,$('regimeViewport').clientWidth);$('regimeImage').style.width=width+'px'};
  $('regimeSave').onclick=async()=>{
   if(saveAbort)return;if(!cacheSupported){$('regimeOffline').textContent='Офлайн-хранилище недоступно в этом браузере.';return}const selectedDoc=activeDoc(),assets=RC.assets(selectedDoc);saveAbort=new AbortController();const signal=saveAbort.signal;$('regimeSave').disabled=true;$('regimeCancel').hidden=false;
   let done=0,index=0,failed=false;try{
    const estimate=await navigator.storage?.estimate?.();const total=assets.reduce((n,a)=>n+a.bytes,0);if(estimate?.quota&&estimate.quota-estimate.usage<total)throw Error('Свободного места может не хватить для режимки. Освободите место, не удаляя данные приложения.');
    async function worker(){while(index<assets.length&&!failed&&!signal.aborted){const asset=assets[index++];try{await verified(asset,signal);done++;$('regimeOffline').textContent='Сохраняем '+selectedDoc.name+': '+done+' / '+assets.length}catch(e){failed=true;saveAbort.abort();throw e}}}
    const results=await Promise.allSettled([worker(),worker()]);const error=results.find(r=>r.status==='rejected'&&r.reason.name!=='AbortError')||results.find(r=>r.status==='rejected');if(error)throw error.reason;if(signal.aborted)throw new DOMException('Остановлено','AbortError');$('regimeOffline').textContent='Режимка '+selectedDoc.name+' целиком сохранена офлайн.';
   }catch(e){$('regimeOffline').textContent=(e.name==='AbortError'?'Сохранение остановлено.':e.message)+' Уже сохранённые листы остаются; можно продолжить позже.'}
   finally{saveAbort=null;$('regimeSave').disabled=false;$('regimeCancel').hidden=true}
  };
  $('regimeCancel').onclick=()=>saveAbort?.abort();
  const profiles=catalog.documents.flatMap(d=>d.leaves.filter(p=>p.kind==='profile'));
  if(cacheSupported&&root.RailOfflinePages){profileQueue=root.RailOfflinePages.create(profiles,async page=>{await sharedRead(page);const cache=await caches.open(CACHE),saved=await cache.match(absolute(page));if(saved?.headers.get('X-Regime-SHA256')!==page.sha256)throw Error('Лист не сохранён офлайн');},profileProgress,{online:()=>navigator.onLine!==false});prioritizeRoute()}
  window.addEventListener('offline',()=>{for(const transfer of transfers)transfer.abort();profileProgress(profileQueue?.status()||{ready:0,total:profiles.length,paused:true})});
  window.addEventListener('online',()=>{profileQueue?.resume();document.dispatchEvent(new Event('regimepagesready'))});
  window.addEventListener('pagehide',()=>{profileQueue?.stop();for(const transfer of transfers)transfer.abort();saveAbort?.abort();clearImage()});
  for(const id of ['regimeRoute','regimePages','regimeGo','regimePlus','regimeMinus','regimeFit'])$(id).disabled=false;$('regimeSave').disabled=!cacheSupported;
  function setParity(direction){
   const target=catalog.routes.find(r=>r.document===activeRoute().document&&r.direction===direction);if(!target)return;
   routeId=target.id;$('regimeRoute').value=routeId;fillPages();
   if(positionMode==='gps'&&!leaf){clearImage();message('Путь выбран. Ожидаем GPS-привязку.');return}
   go(chain,{live:positionMode==='gps',preview:overviewOnly,quality:positionQuality});
  }
  return {prioritizePages,offlineStatus:()=>profileQueue?.status(),setParity,previewLive(m){go(m,{live:true,preview:true})},readPage:async page=>new TextDecoder().decode(await sharedRead(page)),go,beginLive(){liveConfirmed=false;overviewOnly=false;positionMode='gps';clearImage();message('Ожидаем устойчивую GPS-привязку. Профиль скрыт.')},goLive:(m,accuracy,quality)=>go(m,{live:true,accuracy,quality}),suspendLive(reason){liveConfirmed=false;overviewOnly=false;if(positionMode==='gps'){clearImage();message(reason+' Профиль по GPS скрыт.')}},state:()=>({routeId,chain,page:leaf?.number,document:doc?.id,mode:positionMode,overviewOnly,quality:positionQuality,valid:!!leaf&&(positionMode!=='gps'||liveConfirmed)}),catalog};
 }
 root.RegimeViewer={create};
})(typeof globalThis!=='undefined'?globalThis:this);
