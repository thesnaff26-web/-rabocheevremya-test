/* Photo/PDF speed importer for the test application.
   OCR is best-effort; NEVER silently treat OCR data as a verified warning. */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
const MAX_FILE=18*1024*1024;
let ctx=null,candidates=[],reviewTab='ready';
const view=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function withTimeout(promise,ms,label){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const timer=setTimeout(()=>{if(!finished){finished=true;reject(Error(label+' не ответил за '+Math.round(ms/1000)+' секунд. Проверьте соединение или попробуйте ещё раз.'))}},ms);
  Promise.resolve(promise).then(v=>{if(!finished){finished=true;clearTimeout(timer);resolve(v)}},err=>{if(!finished){finished=true;clearTimeout(timer);reject(err)}});
 });
}
function script(src,globalName){
 if(root[globalName])return Promise.resolve(root[globalName]);
 // A failed CDN request must not leave a permanently pending script element.
 const existing=document.querySelector('script[data-import-lib="'+globalName+'"]');
 if(existing&&existing.dataset.failed==='1')existing.remove();
 return new Promise((resolve,reject)=>{
  const s=document.querySelector('script[data-import-lib="'+globalName+'"]')||document.createElement('script');
  let finished=false;
  const done=(err)=>{if(finished)return;finished=true;clearTimeout(timeout);if(err){s.dataset.failed='1';s.remove();reject(err)}else resolve(root[globalName])};
  const timeout=setTimeout(()=>done(Error('Загрузка библиотеки '+globalName+' заняла слишком много времени. Проверьте соединение и повторите попытку.')),12000);
  s.addEventListener('load',()=>root[globalName]?done(null):done(Error('Библиотека '+globalName+' не запустилась')),{once:true});
  s.addEventListener('error',()=>done(Error('Библиотека '+globalName+' недоступна. Проверьте интернет')),{once:true});
  if(!s.isConnected){s.src=src;s.async=true;s.dataset.importLib=globalName;document.head.append(s)}
 });
}
function parseMsk(value){
 const v=String(value||'').trim();
 if(!v)return '';
 const m=v.match(/^(\d{2})[.](\d{2})[.](\d{4})\s+(\d{2}):(\d{2})$/);
 if(!m)throw Error('Время МСК: ДД.ММ.ГГГГ ЧЧ:ММ');
 const [,d,mo,y,h,mi]=m;const yy=+y,mm=+mo,dd=+d;
 const t=new Date(Date.UTC(yy,mm-1,dd,+h,+mi));
 if(t.getUTCFullYear()!==yy||t.getUTCMonth()!==mm-1||t.getUTCDate()!==dd||+h>23||+mi>59)throw Error('Неверная дата или время МСК');
 return y+'-'+mo+'-'+d+'T'+h+':'+mi;
}
function rowFromLine(text){
 const s=String(text||'').replace(/[—–−]/g,'-').replace(/\s+/g,' ').trim();
 if(!s||s.startsWith('#'))return null;
 // The fully explicit form is unambiguous even when OCR contains other columns:
 // 6904/3-6903/5;40  or 6904 км ПК3 - 6903 км ПК5; 40
 let m=s.match(/(?:^|\s)(\d{4})\s*(?:км)?\s*(?:\/|[,. ]\s*пк\s*)\s*(10|[1-9])\s*-\s*(\d{4})\s*(?:км)?\s*(?:\/|[,. ]\s*пк\s*)\s*(10|[1-9])\s*[;,:\s]+\s*(\d{1,3})(?=\s*(?:км\/ч)?\s*$)/i);
 // Also allow same-kilometre shorthand 6904 км ПК3-4;40.
 if(!m){
  const short=s.match(/(?:^|\s)(\d{4})\s*(?:км)?\s*(?:\/|[,. ]\s*пк\s*)\s*(10|[1-9])\s*-\s*(10|[1-9])\s*[;,:\s]+\s*(\d{1,3})(?=\s*(?:км\/ч)?\s*$)/i);
  if(short)m=[short[0],short[1],short[2],short[1],short[3],short[4]];
 }
 if(!m)return null;
 const [km1,pk1,km2,pk2,speed]=m.slice(1).map(Number);
 if(km1<5000||km1>9000||km2<5000||km2>9000||speed<1||speed>200||(km1===km2&&pk1===pk2))return null;
 return {km1,pk1,km2,pk2,speed,category:'',begin:'',endTime:'',untilCancel:false,source:s};
}
function extract(text){
 const lines=String(text||'').split(/\r?\n/);const found=[];
 for(const line of lines){const candidate=rowFromLine(line);if(candidate)found.push(candidate)}
 if(found.length>600)throw Error('Найдено более 600 строк. Разделите документ на части, чтобы проверить их все без потерь.');
 return found;
}

/* Extract actual columns from digital railway-table PDFs.
   Never guess station-to-kilometre endpoints from a station name. */
function stationlessRange(raw){
 const normalized=String(raw||'').trim().replace(/[—–−]/g,'-').replace(/\s*\([^)]*\)\s*$/,'');
 // Preserve a complete numerical PK interval even if the station name follows it.
 const prefix=normalized.match(/^([0-9]{4}\s*пк\s*(?:10|[1-9])\s*-\s*(?:(?:[0-9]{4}\s*пк\s*)?(?:10|[1-9])))(?=\s|[а-яё]|$)/i);
 const s=(prefix?prefix[1]:normalized).replace(/\s+/g,'');
 const m=s.match(/^(\d{4})пк(10|[1-9])(?:-(?:(\d{4})пк)?(10|[1-9]))?$/i);
 if(!m)return null;
 const a=+m[1],pk1=+m[2],b=m[4]?(m[3]?+m[3]:a):null,pk2=m[4]?+m[4]:null;
 if(a<5000||a>9000||(b!==null&&(b<5000||b>9000)))return null;
 if(b!==null&&a===b&&pk1===pk2)return null;
 return {km1:a,pk1,km2:b??'',pk2:pk2??''};
}
function stationKey(s){
 return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/(?:станция|ст\.)/g,'')
  .replace(/[^а-яa-z0-9]/gi,'');
}
function stationVerifiedBoundary(station,route){
 // Future corridors may include explicitly surveyed stop-boundary coordinates.
 // NEVER use the approximate position of a station SVG label as a speed boundary.
 const entry=(route?.verifiedStationBoundaries||[]).find(a=>a?.verified===true&&stationKey(a.name)===stationKey(station));
 if(!entry||!Number.isInteger(entry.km)||!Number.isInteger(entry.pk)||entry.pk<1||entry.pk>10)return null;
 return {km:entry.km,pk:entry.pk};
}
function draftFromBoundary(boundary,category,speed,section,location,route){
 const known=boundary.numeric;
 const anchored=stationVerifiedBoundary(boundary.station,route);
 const first=boundary.kind==='toStation'?known:anchored;
 const last=boundary.kind==='toStation'?anchored:known;
 return {km1:first?.km??'',pk1:first?.pk??'',km2:last?.km??'',pk2:last?.pk??'',
  speed,category,begin:'',endTime:'',untilCancel:false,
  stationHint:boundary.station,
  source:section+' · '+location+' | '+({passenger:'Пас',freight:'ГР',empty:'Пор'}[category])+' '+speed+
  (anchored?' [проверенная станционная граница]':' [станционная граница требует проверки]')};
}
function stationBoundary(raw){
 const s=String(raw||'').trim().replace(/[—–−]/g,'-').replace(/\s+/g,'').replace(/\([^)]*\)$/,'');
 const m=s.match(/^(.+?)-(.+)$/);if(!m)return null;
 const numeric=x=>{const p=x.match(/^(\d{4})пк(10|[1-9])$/i);return p?{km:+p[1],pk:+p[2]}:null};
 const start=numeric(m[1]),end=numeric(m[2]);
 if(start&&!end&&stationKey(m[2]))return {kind:'toStation',station:stationKey(m[2]),numeric:start};
 if(!start&&end&&stationKey(m[1]))return {kind:'fromStation',station:stationKey(m[1]),numeric:end};
 return null;
}

function speedTripleFromLine(raw,section){
 const line=String(raw||'').replace(/[–—−]/g,'-').replace(/[|;\[\]]+/g,' ').replace(/\s+/g,' ').trim();
 // A column-based speed table contains precisely three terminal speed cells.
 const triple=line.match(/(?:^|\s)(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/);
 if(!triple)return null;
 const speeds=triple.slice(1).map(Number);
 if(speeds.some(v=>v<1||v>200))return null;
 const location=line.slice(0,triple.index).trim();
 // Preserve the source row name and all three category values; never merge them.
 const numericPrefix=location.match(/^([0-9]{4}\s*пк\s*(?:10|[1-9])\s*-\s*(?:(?:[0-9]{4}\s*пк\s*)?(?:10|[1-9])))(?:\s+[^0-9].*)?$/i);
 const range=stationlessRange(numericPrefix?numericPrefix[1]:location);
 if(!range)return {location,section,speeds,unresolved:true};
 return {location,section,speeds,range};
}
function tableFromOcrText(text,section){
 const drafts=[],unresolved=[],sequence=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const data=speedTripleFromLine(line,section);
  if(!data)continue;
  sequence.push({...data,boundary:stationBoundary(data.location)});
 }
 const route=ctx?.route?.()||null;
 const categories=['passenger','freight','empty'];
 for(let i=0;i<sequence.length;i++){
  const row=sequence[i];
  for(const [j,category] of categories.entries()){
   const speed=row.speeds[j];let range=row.range;
   if(!range&&row.boundary?.kind==='toStation'){
    const next=sequence[i+1];
    if(next?.boundary?.kind==='fromStation'&&
       next.boundary.station===row.boundary.station&&next.speeds[j]===speed){
     range={km1:row.boundary.numeric.km,pk1:row.boundary.numeric.pk,
      km2:next.boundary.numeric.km,pk2:next.boundary.numeric.pk};
    }
   }else if(!range&&row.boundary?.kind==='fromStation'){
    const prev=sequence[i-1];
    if(prev?.boundary?.kind==='toStation'&&prev.boundary.station===row.boundary.station&&prev.speeds[j]===speed)continue;
   }
   if(!range&&row.boundary){
    drafts.push(draftFromBoundary(row.boundary,category,speed,section,row.location,route));continue;
   }
   if(!range){unresolved.push(section+': '+row.location+' | '+row.speeds.join('/')+' — строка не имеет распознаваемых станционных или числовых границ');continue}
   drafts.push({...range,speed,category,begin:'',endTime:'',untilCancel:false,
     source:section+' · '+row.location+' | '+['Пас','ГР','Пор'][j]+' '+speed+' [фото, проверьте]'});
  }
 }
 return {drafts,unresolved};
}
function tableFromPdfItems(items,pageHeight,pageWidth=595){
 const rows=[];
 for(const item of items||[]){
  const tr=item.transform||[],str=String(item.str||'').trim();
  if(!str||!Number.isFinite(tr[4])||!Number.isFinite(tr[5]))continue;
  const x=tr[4],y=pageHeight-tr[5];
  let row=rows.find(r=>Math.abs(r.y-y)<2.8);
  if(!row){row={y,items:[]};rows.push(row)}
  row.items.push({x,str});
 }
 const drafts=[],pending=[];
 // Maintain the order of table rows separately for each column grouping.
 const bySide={left:[],right:[]};
 for(const row of rows.sort((a,b)=>a.y-b.y)){
  for(const side of ['left','right']){
   // Station speed table may start above y=650 depending on PDF page scale.
   const cells=row.items.filter(it=>side==='left'?it.x/pageWidth<.34:it.x/pageWidth>=.66);
   if(!cells.length)continue;
   const location=cells.filter(it=>side==='left'?it.x/pageWidth<.17:it.x/pageWidth<.855)
    .sort((a,b)=>a.x-b.x).map(it=>it.str).join(' ').trim();
   const range=stationlessRange(location),boundary=stationBoundary(location);
   const slots=side==='left'
     ?[{category:'passenger',from:.17,to:.21},{category:'freight',from:.21,to:.25},{category:'empty',from:.25,to:.29}]
     :[{category:'passenger',from:.855,to:.90},{category:'freight',from:.90,to:.947},{category:'empty',from:.947,to:1.02}];
   const speeds={};
   for(const col of slots){
    const token=cells.filter(it=>it.x/pageWidth>=col.from&&it.x/pageWidth<col.to).map(it=>it.str).join('').trim();
    if(/^\d{1,3}$/.test(token)&&+token>=1&&+token<=200)speeds[col.category]=+token;
   }
   // The source table uses columns centered at x≈109, 134 and 158 on a 595px PDF.
   // Previous bounds accidentally classified the second speed as the first and lost
   // the third column. Empty-train speed must stop BEFORE the station-name cell.
   // Both three-category tables require all three clearly read speeds.
   // Do not accidentally import brake-check or other unrelated tables.
   if(Object.keys(speeds).length!==3)continue;
   if(!range&&!boundary){pending.push((side==='left'?'По перегону':'По станциям')+': '+location+' — три скорости без определённых км/ПК');continue}
   bySide[side].push({location,range,boundary,speeds,section:side==='left'?'По перегону':'По станциям'});
  }
 }
 for(const sequence of Object.values(bySide)){
  const route=ctx?.route?.()||null;
  for(let i=0;i<sequence.length;i++){
   const row=sequence[i];
   for(const [category,speed] of Object.entries(row.speeds)){
    let range=row.range;
    if(!range&&row.boundary?.kind==='toStation'){
     const next=sequence[i+1];
     // Adjacent rows with matching station + SAME category speed can
     // safely be joined without inventing a station kilometre.
     if(next?.boundary?.kind==='fromStation'&&next.boundary.station===row.boundary.station&&
        next.speeds[category]===speed){
      range={km1:row.boundary.numeric.km,pk1:row.boundary.numeric.pk,
       km2:next.boundary.numeric.km,pk2:next.boundary.numeric.pk};
     }
    }else if(!range&&row.boundary?.kind==='fromStation'){
     const previous=sequence[i-1];
     if(previous?.boundary?.kind==='toStation'&&previous.boundary.station===row.boundary.station&&previous.speeds[category]===speed)continue;
    }
    if(!range){
     // Do not discard station-boundary rows. Make editable review drafts.
     const partial=draftFromBoundary(row.boundary,category,speed,row.section,row.location,route);
     drafts.push(partial);
     continue;
    }
    drafts.push({...range,speed,category,begin:'',endTime:'',untilCancel:false,
     source:row.section+' · '+row.location+' | '+({passenger:'Пас',freight:'ГР',empty:'Пор'}[category])+' '+speed+
      (!row.range?' [соседние строки объединены по станции]':'')});
   }
  }
 }
 // This does not mean that all kilometre ranges are covered. The UI explicitly reports
 // the skipped station boundaries rather than representing them as unrestricted.
 tableFromPdfItems.lastUnresolved=pending;
 return drafts;
}
function status(msg,error=false){const el=$('speedImportStatus');if(el){el.textContent=msg;el.style.color=error?'#fda4af':''}}
async function pdfText(file){
 status('Загружаю модуль чтения PDF…');
 const pdfjs=await script('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 status('Читаю файл PDF…');
 const doc=await withTimeout(pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,16000,'Чтение PDF');
 if(doc.numPages>20)throw Error('Документ содержит более 20 страниц. Разделите PDF на части.');
 let text='',pageLimit=Math.min(doc.numPages,20),tableRows=[],unresolved=[];
 for(let i=1;i<=pageLimit;i++){
  status('Читаю PDF: страница '+i+' из '+pageLimit);
  const p=await withTimeout(doc.getPage(i),12000,'Открытие страницы PDF');
  const tc=await withTimeout(p.getTextContent(),12000,'Чтение таблицы PDF'),items=tc.items||[];
  if(ctx?.tab==='permanent'){tableRows.push(...tableFromPdfItems(items,p.view[3]-p.view[1],p.view[2]-p.view[0]));unresolved.push(...(tableFromPdfItems.lastUnresolved||[]))}
  let y=null;
  for(const item of items){const yy=Math.round(item.transform?.[5]||0);if(y!==null&&Math.abs(yy-y)>3)text+='\n';text+=String(item.str||'')+' ';y=yy}
  text+='\n';
 }
 if(tableRows.length){if(tableRows.length>600)throw Error('В PDF более 600 записей. Разделите документ на части: автоматически обрезать строки нельзя.');return {text,drafts:tableRows,unresolved}}
 if(!extract(text).length){
  // Scanned PDF pages have no embedded text. OCR a small number of pages in memory.
  const T=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
  const worker=await T.createWorker('rus+eng',1,{logger:m=>{if(m.status==='recognizing text')status('Распознаю скан PDF: '+Math.round((m.progress||0)*100)+'%')}});
  try{
   let scanned='',drafts=[],unresolved=[];
   for(let i=1;i<=Math.min(doc.numPages,5);i++){
    status('Распознаю скан PDF: страница '+i+' из '+Math.min(doc.numPages,5));
    const page=await doc.getPage(i),viewport=page.getViewport({scale:1.75});
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw Error('Не удаётся подготовить PDF для распознавания');
    await withTimeout(page.render({canvasContext:context,viewport}).promise,16000,'Отрисовка скана PDF');
    if(ctx?.tab==='permanent'){
     const result=await tableImageText(canvas,worker);
     scanned+=result.text;drafts.push(...result.drafts);unresolved.push(...result.unresolved);
    }else{
     const result=await worker.recognize(canvas);scanned+=(result.data.text||'')+'\n';
    }
    canvas.width=0;canvas.height=0;
   }
   if(drafts.length>600)throw Error('Более 600 найденных скоростей в PDF, разделите документ для проверки');
   if(scanned.trim())return {text:scanned,drafts,unresolved};
  }finally{await worker.terminate()}
 }
 if(!text.trim())throw Error('Не удалось извлечь текст из PDF. Попробуйте фотографию страницы.');
 return {text,drafts:[],unresolved:[]};
}
async function imageText(file){
 const T=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
 const worker=await T.createWorker('rus+eng',1,{logger:m=>{if(m.status==='recognizing text')status('Распознаю фото: '+Math.round((m.progress||0)*100)+'%')}});
 try{const result=await worker.recognize(file);return result.data.text||''}finally{await worker.terminate()}
}
function imageBounds(ctx,w,h){
 // Find colored table cells rather than treating large white photo margins
 // or the iPhone screenshot status bar as part of the railway table.
 const pixels=ctx.getImageData(0,0,w,h).data;
 let left=w,right=0,top=h,bottom=0,count=0;
 const step=Math.max(3,Math.round(Math.max(w,h)/550));
 for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){
  const p=(y*w+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2];
  const high=Math.max(r,g,b),low=Math.min(r,g,b);
  if(high<245&&high>105&&high-low>40&&low>40){
   left=Math.min(left,x);right=Math.max(right,x);
   top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
  }
 }
 if(count<50||bottom-top<h*.2)return {x:0,y:0,w,h};
 const coloredWidth=Math.max(1,right-left),fullLeft=Math.max(0,left-coloredWidth*.46);
 return {x:fullLeft,y:Math.max(0,top-h*.01),w:Math.min(w,Math.max(right+coloredWidth*.05,fullLeft+coloredWidth)-fullLeft),h:Math.min(h,Math.max(bottom+10,top+h*.02)-Math.max(0,top-h*.01))};
}
async function tableImageText(imageSource,worker){
 const w=imageSource.width,h=imageSource.height;
 if(!w||!h)throw Error('Не удалось определить размер фотографии');
 const base=document.createElement('canvas');
 const scale=Math.min(1,1600/Math.max(w,h));base.width=Math.max(1,Math.round(w*scale));base.height=Math.max(1,Math.round(h*scale));
 const context=base.getContext('2d',{willReadFrequently:true});
 if(!context)throw Error('Браузер не поддерживает подготовку изображения');
 context.drawImage(imageSource,0,0,base.width,base.height);
 const doc=imageBounds(context,base.width,base.height);
 const cropPlans=[
  {name:'По перегону',x:0,y:0,width:.325,height:1},
  {name:'По станциям',x:.66,y:.60,width:.34,height:.40}
 ];
 let text='',drafts=[],unresolved=[];
 for(const [i,plan] of cropPlans.entries()){
  status('Читаю таблицу «'+plan.name+'» ('+(i+1)+'/2)…');
  const cw=Math.max(1,Math.round(doc.w*plan.width)),ch=Math.max(1,Math.round(doc.h*plan.height));
  const sx=doc.x+doc.w*plan.x,sy=doc.y+doc.h*plan.y;
  const out=document.createElement('canvas');
  const grow=Math.min(4,1800/cw);
  out.width=Math.max(1,Math.round(cw*grow));out.height=Math.max(1,Math.round(ch*grow));
  out.getContext('2d').drawImage(base,sx,sy,cw,ch,0,0,out.width,out.height);
  // OCR text is reviewed; mismatching cells never become confirmed automatically.
  const data=await withTimeout(worker.recognize(out),45000,'Распознавание '+plan.name);
  const part=String(data.data?.text||'');
  text+='\n--- '+plan.name+' ---\n'+part+'\n';
  const parsed=tableFromOcrText(part,plan.name);
  drafts.push(...parsed.drafts);unresolved.push(...parsed.unresolved);
  out.width=0;out.height=0;
 }
 base.width=0;base.height=0;
 if(drafts.length>600)throw Error('Найдено более 600 скоростей. Разделите документ на части для проверки.');
 return {text,drafts,unresolved};
}
async function readSpeedPhoto(file){
 const T=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
 const worker=await T.createWorker('rus+eng',1,{logger:m=>{if(m.status==='recognizing text')status('Распознавание таблиц: '+Math.round((m.progress||0)*100)+'%')}});
 let bitmap=null;
 try{
  if(typeof createImageBitmap==='function'){try{bitmap=await createImageBitmap(file)}catch(_){/* use Image fallback for iPhone file formats */}}
  if(!bitmap){
   const u=URL.createObjectURL(file);
   try{bitmap=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Не удалось открыть фотографию'));img.src=u})}finally{URL.revokeObjectURL(u)}
  }
  return await tableImageText(bitmap,worker);
 }finally{if(bitmap?.close)bitmap.close();await worker.terminate()}
}
function coverageReport(rows,route){
 const report={};
 for(const category of ['passenger','freight','empty']){
  const applicable=rows.filter(r=>r.category===category||r.category==='all'),intervals=applicable
   .filter(r=>Number.isFinite(r.end)).map(r=>[Math.max(route.start,Math.min(r.start,r.end)),Math.min(route.end,Math.max(r.start,r.end))])
   .filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let cursor=route.start;const gaps=[];
  for(const [a,b] of intervals){if(a>cursor)gaps.push([cursor,a]);cursor=Math.max(cursor,b)}
  if(cursor<route.end)gaps.push([cursor,route.end]);
  report[category]={count:applicable.length,unknown:applicable.filter(r=>!Number.isFinite(r.end)).length,gaps};
 }
 return report;
}
function showCoverage(){
 const el=$('speedImportCoverage');if(!el)return;
 el.hidden=ctx?.tab!=='permanent';if(el.hidden)return;
 const route=ctx.route();if(!route){el.textContent='Сначала выберите маршрут.';return}
 const records=[];
 for(const card of $('speedImportDrafts').querySelectorAll('.speedImportDraft')){
  if(!card.querySelector('.impSelected')?.checked)continue;
  const get=n=>card.querySelector('[data-field="'+n+'"]')?.value.trim()||'';
  if(!/^\d{4}$/.test(get('km1'))||!get('pk1'))continue;
  const category=get('category');
  if(!['passenger','freight','empty','all'].includes(category))continue;
  const start=Number(get('km1'))*1000+(Number(get('pk1'))-1)*100;
  const end=get('km2')&&get('pk2')?Number(get('km2'))*1000+(Number(get('pk2'))-1)*100:null;
  records.push({category,start,end});
 }
 const audit=coverageReport(records,route),names={passenger:'Пассажирские',freight:'Грузовые',empty:'Порожние'};
 const point=n=>Math.floor(n/1000)+' км ПК'+(Math.floor(n%1000/100)+1);
 const lines=['Проверка покрытия выбранного участка (только строки этого импорта):'];
 for(const [category,name] of Object.entries(names)){
  const a=audit[category];
  const examples=a.gaps.slice(0,3).map(([x,y])=>point(x)+' — '+point(y)).join('; ');
  lines.push(name+': '+a.count+' записей, пробелов: '+a.gaps.length+(a.unknown?', без конечного ПК: '+a.unknown:'')+(examples?' — '+examples:''));
 }
 lines.push('Пробел не означает отсутствие ограничений. Ранее сохранённые записи не учтены. Сверьте документ перед сохранением.');
 el.textContent=lines.join('\n');
}
function draftProblems(a,route){
 const out=[];
 const hasStart=a.km1!==''&&a.km1!=null&&a.pk1!==''&&a.pk1!=null;
 const hasEnd=a.km2!==''&&a.km2!=null&&a.pk2!==''&&a.pk2!=null;
 const validStart=hasStart&&/^\d{4}$/.test(String(a.km1))&&/^(10|[1-9])$/.test(String(a.pk1));
 const validEnd=hasEnd&&/^\d{4}$/.test(String(a.km2))&&/^(10|[1-9])$/.test(String(a.pk2));
 const start=validStart?Number(a.km1)*1000+(Number(a.pk1)-1)*100:null;
 const end=validEnd?Number(a.km2)*1000+(Number(a.pk2)-1)*100:null;
 if(!route)return out;
 if(start!==null&&(start<route.start||start>=route.end))out.push('начало вне выбранного маршрута');
 if(end!==null&&(end<route.start||end>route.end))out.push('конец вне выбранного маршрута');
 if(start!==null&&end!==null&&(end-start)*route.direction<=0)out.push('границы против направления движения');
 if(!hasEnd&&!a.stationHint)out.push('отсутствует конечная граница — отображается только точка');
 return out;
}
function draftFromCard(card){
 const value=k=>card.querySelector('[data-field="'+k+'"]')?.value.trim()||'';
 return {stationHint:card.dataset.stationHint||'',km1:value('km1'),pk1:value('pk1'),km2:value('km2'),pk2:value('pk2'),speed:value('speed'),category:value('category'),
   begin:value('begin'),endTime:value('endTime'),untilCancel:!!card.querySelector('[data-field="untilCancel"]')?.checked};
}
function issuesForDraft(a,route){
 const issues=draftProblems(a,route);
 if(a.stationHint&&(!a.km1||!a.pk1||!a.km2||!a.pk2))issues.push('уточните станционную границу по официальному источнику');
 if(!/^\d{4}$/.test(a.km1)||!/^(10|[1-9])$/.test(a.pk1))issues.push('проверьте начало км/ПК');
 if((a.km2||a.pk2)&&(!/^\d{4}$/.test(a.km2)||!/^(10|[1-9])$/.test(a.pk2)))issues.push('проверьте конец км/ПК');
 if(!/^\d{1,3}$/.test(String(a.speed))||+a.speed<1||+a.speed>200)issues.push('проверьте скорость');
 if(!['all','passenger','freight','empty'].includes(a.category))issues.push('выберите категорию поезда');
 if(ctx?.tab==='temporary'){
  try{
   const from=parseMsk(a.begin),to=parseMsk(a.endTime);
   if(to&&!from)issues.push('нужно начало действия по МСК');
   if(from&&to&&Date.parse(to+':00+03:00')<Date.parse(from+':00+03:00'))issues.push('конец действия раньше начала');
  }catch(e){issues.push(e.message)}
 }
 return [...new Set(issues)];
}
function setReviewTab(next){
 if(!['ready','review'].includes(next))return;
 reviewTab=next;refreshReviewTabs();
}
function visibleReviewCards(){
 return [...$('speedImportDrafts').querySelectorAll('.speedImportDraft')]
  .filter(card=>card.dataset.reviewStatus===reviewTab);
}
function toggleCurrentReviewTab(checked){
 for(const card of visibleReviewCards()){
  const checkbox=card.querySelector('.impSelected');
  if(checkbox)checkbox.checked=checked;
 }
 refreshSelectAll();showCoverage();
}
function refreshSelectAll(){
 const all=$('speedImportSelectAll'),info=$('speedImportSelectionSummary');
 if(!all)return;
 const cards=visibleReviewCards(),selected=cards.filter(card=>card.querySelector('.impSelected')?.checked).length;
 all.disabled=!cards.length;
 all.indeterminate=selected>0&&selected<cards.length;
 all.checked=cards.length>0&&selected===cards.length;
 if(info)info.textContent='Выбрано '+selected+' из '+cards.length+' в этой вкладке';
}
function refreshReviewTabs(){
 const tabs=$('speedImportReviewTabs'),container=$('speedImportDrafts');if(!tabs||!container)return;
 let ready=0,review=0;
 for(const card of container.querySelectorAll('.speedImportDraft')){
  const issues=issuesForDraft(draftFromCard(card),ctx?.route());
  const needsReview=issues.length>0;
  card.dataset.reviewStatus=needsReview?'review':'ready';
  const warning=card.querySelector('.speedImportWarning');
  if(warning){warning.hidden=!needsReview;warning.textContent=issues.join('; ')}
  card.hidden=(needsReview?'review':'ready')!==reviewTab;
  if(needsReview)review++;else ready++;
 }
 const values={ready,review};
 for(const button of tabs.querySelectorAll('[data-review-tab]')){
  const key=button.dataset.reviewTab;
  button.classList.toggle('active',key===reviewTab);
  button.setAttribute('aria-selected',String(key===reviewTab));
  button.querySelector('.speedImportTabCount').textContent=String(values[key]);
 }
 const empty=$('speedImportReviewEmpty');
 if(empty){const total=values[reviewTab];empty.hidden=total!==0;empty.textContent=reviewTab==='review'?'Нет записей с обнаруженными ошибками.':'Нет распознанных записей без замечаний.'}
 refreshSelectAll();
}
function showDrafts(){
 const list=$('speedImportDrafts');if(!list)return;
 list.replaceChildren();
 if(!candidates.length){list.innerHTML='<p>Скорости не найдены автоматически. Для таблиц PDF используйте оригинальный цифровой файл. Можно исправить распознанный текст или добавить строку вручную.</p>';refreshReviewTabs();showCoverage();return}
 for(let i=0;i<candidates.length;i++){
  const a=candidates[i],card=document.createElement('div');card.className='speedImportDraft';
  const problems=issuesForDraft(a,ctx.route());
  card.innerHTML='<label><input type="checkbox" class="impSelected" '+(problems.length?'':'checked')+'> Строка '+(i+1)+' — проверить</label>'+(problems.length?'<p class="speedImportWarning">'+view(problems.join('; '))+'</p>':'')+'<div class="speedImportNumbers">'+
   [['km1','Начало км'],['pk1','ПК'],['km2','Конец км'],['pk2','ПК'],['speed','км/ч']].map(([k,label])=>'<label>'+label+'<input data-field="'+k+'" type="text" inputmode="numeric" pattern="[0-9]*" value="'+view(a[k])+'"></label>').join('')+'</div>'+
   '<label>Категория<select data-field="category"><option value="">Выберите</option><option value="all">Все</option><option value="freight">Грузовой</option><option value="passenger">Пассажирский</option><option value="empty">Порожний</option></select></label>'+
   (ctx.tab==='temporary'?'<div class="speedImportDates"><label>Начало МСК (необязательно)<input data-field="begin" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.begin)+'"></label><label>Конец МСК (необязательно)<input data-field="endTime" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.endTime)+'"></label><label><input type="checkbox" data-field="untilCancel"> До отмены</label></div>':'')+
   '<small>Источник: '+view(a.source||'Добавлено вручную')+'</small>';
  card.dataset.stationHint=a.stationHint||'';
  card.querySelector('[data-field="category"]').value=a.category||'';
  list.append(card);
 }
 reviewTab=[...list.querySelectorAll('.speedImportDraft')].some(card=>issuesForDraft(draftFromCard(card),ctx.route()).length)?'review':'ready';
 refreshReviewTabs();showCoverage();
}
function handleText(){candidates=extract($('speedImportText').value);showDrafts();status('Найдено строк: '+candidates.length+'. Проверьте все значения перед сохранением.')}
function addManual(){candidates.push({km1:'',pk1:'',km2:'',pk2:'',speed:'',category:'',begin:'',endTime:'',source:'ручная корректировка'});showDrafts();setReviewTab('review');status('Заполните новую строку и проверьте исходный документ.')}
function validateOneDraft(card,i,route){
 const get=k=>card.querySelector('[data-field="'+k+'"]');
 const val=k=>get(k)?.value.trim()||'';
 const km1=+val('km1'),pk1=+val('pk1'),km2=+val('km2'),pk2=+val('pk2'),speed=+val('speed');
 const hasEnd=val('km2')!==''||val('pk2')!=='';
 if(card.dataset.stationHint&&!hasEnd)throw Error('Строка '+(i+1)+': уточните станционную границу и оба поля конца');
 if(!/^\d{4}$/.test(val('km1'))||!(pk1>=1&&pk1<=10)||!Number.isInteger(pk1)||
   (hasEnd&&(!/^\d{4}$/.test(val('km2'))||!Number.isInteger(pk2)||pk2<1||pk2>10))||
   !Number.isInteger(speed)||speed<1||speed>200)throw Error('Строка '+(i+1)+': проверьте км, ПК и скорость');
 if(hasEnd&&(!val('km2')||!val('pk2')))throw Error('Строка '+(i+1)+': заполните оба поля конца');
 const start=km1*1000+(pk1-1)*100,end=hasEnd?km2*1000+(pk2-1)*100:null;
 if(end!==null&&start===end)throw Error('Строка '+(i+1)+': начало и конец совпадают');
 if(end!==null&&(end-start)*route.direction<=0)throw Error('Строка '+(i+1)+': границы против направления движения');
 if(start<route.start||start>=route.end||(end!==null&&(end<route.start||end>route.end)))throw Error('Строка '+(i+1)+': км вне выбранного участка');
 if(!['all','freight','passenger','empty'].includes(val('category')))throw Error('Строка '+(i+1)+': выберите категорию');
 const begin=ctx.tab==='temporary'?parseMsk(val('begin')):'';
 const endTime=ctx.tab==='temporary'?parseMsk(val('endTime')):'';
 const untilCancel=ctx.tab==='temporary'&&!!get('untilCancel')?.checked;
 if(endTime&&!begin)throw Error('Строка '+(i+1)+': укажите начало действия');
 if(begin&&endTime&&Date.parse(endTime+':00+03:00')<Date.parse(begin+':00+03:00'))throw Error('Строка '+(i+1)+': конец раньше начала');
 return {type:ctx.tab,routeId:route.id,category:val('category'),start,end,speed,begin,endTime:untilCancel?'':endTime,untilCancel};
}
function readDrafts(){
 if(!ctx.route())throw Error('Сначала выберите участок и направление');
 const route=ctx.route(),rows=[],accepted=[],invalid=[];
 const cards=[...$('speedImportDrafts').querySelectorAll('.speedImportDraft')];
 let selected=0;
 for(const [i,card] of cards.entries()){
  if(!card.querySelector('.impSelected')?.checked)continue;
  selected++;
  try{
   const row=validateOneDraft(card,i,route);
   rows.push(row);accepted.push(card);
  }catch(e){
   invalid.push({card,message:String(e.message||e)});
  }
 }
 return {rows,accepted,invalid,selected};
}
function clearImportDrafts(){
 candidates=[];
 const input=$('speedImportText');if(input)input.value='';
 const drafts=$('speedImportDrafts');if(drafts)drafts.replaceChildren();
 const checkbox=$('speedImportConfirm');if(checkbox)checkbox.checked=false;
 for(const id of ['speedImportFile','speedImportCamera']){const el=$(id);if(el)el.value=''}
 showUnresolved([]);refreshReviewTabs();showCoverage();
 const feedback=$('speedImportSaveFeedback');if(feedback){feedback.textContent='';feedback.hidden=true}
}
function saveFeedback(message,error=false){
 const el=$('speedImportSaveFeedback');
 if(!el)return;
 el.hidden=false;el.textContent=message;
 el.dataset.error=error?'true':'false';
 el.setAttribute('role',error?'alert':'status');
}
async function saveDrafts(){
 try{
  const {rows,accepted,invalid,selected}=readDrafts();
  if(!selected)throw Error('Сначала выберите хотя бы одну запись в любой вкладке.');
  if(!rows.length){
   const detail=invalid.slice(0,3).map(x=>x.message).join('; ');
   throw Error('Сохранено 0. Все '+invalid.length+' выбранных записей требуют исправления. '+detail);
  }
  if(!$('speedImportConfirm').checked)throw Error('Подтвердите сверку выбранных корректных записей с исходным документом.');
  // Save only valid selected rows. Records with incomplete boundaries stay as drafts.
  const result=ctx.save(rows);
  if(!result||!Number.isFinite(result.added))throw Error('Не удалось подтвердить сохранение.');
  for(const card of accepted)card.remove();
  for(const {card} of invalid){card.querySelector('.impSelected').checked=false}
  $('speedImportConfirm').checked=false;
  if(!$('speedImportDrafts').querySelector('.speedImportDraft'))clearImportDrafts();
  else{reviewTab='review';refreshReviewTabs();showCoverage()}
  const summary='Сохранено '+result.added+' записей. Дубликатов: '+(result.duplicates||0)+
   '. Пропущено из-за ошибок: '+invalid.length+'.'+
   (invalid.length?' Исправьте оставшиеся строки во вкладке «На проверку».':'');
  status(summary);saveFeedback(summary,invalid.length>0);
 }catch(e){
  const msg='Сохранение не выполнено: '+(e.message||e);
  status(msg,true);saveFeedback(msg,true);
 }
}
async function handleFile(file){
 if(!file)return;
 // Never leave drafts from a previous document available while opening another one.
 candidates=[];showUnresolved([]);$('speedImportDrafts').replaceChildren();$('speedImportText').value='';$('speedImportConfirm').checked=false;
 if(file.size>MAX_FILE)return status('Максимальный размер файла — 18 МБ.',true);
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
 const isImage=file.type.startsWith('image/')||/\.(png|jpe?g|webp|heic)$/i.test(file.name||'');
 if(!isPdf&&!isImage)return status('Поддерживаются фотографии и PDF.',true);
 status('Подготавливаю '+file.name+'…');
 try{
  const result=isPdf?await pdfText(file):ctx.tab==='permanent'?await readSpeedPhoto(file):{text:await imageText(file),drafts:[],unresolved:[]};
  $('speedImportText').value=result.text;
  if(result.drafts.length){
   candidates=result.drafts;showDrafts();
   status('Найдено '+candidates.length+' скоростей. '+(result.unresolved?.length?'Не удалось определить границы '+result.unresolved.length+' строк; см. список ниже. ':'')+'Проверьте км/ПК и категории.');
  }else handleText();
  showUnresolved(result.unresolved||[]);
  if(!candidates.length)status('Распознавание завершено, но строки не определились. Проверьте текст и внесите записи вручную.',true);
 }catch(e){status(e.message||'Не удалось прочитать файл',true)}
}
function showUnresolved(lines){
 const el=$('speedImportUnresolved');if(!el)return;
 if(!lines.length){el.hidden=true;el.textContent='';return}
 el.hidden=false;el.replaceChildren();
 const title=document.createElement('strong');title.textContent='Строки для ручной проверки: '+lines.length;el.append(title);
 const list=document.createElement('ol');
 for(const entry of lines.slice(0,150)){const item=document.createElement('li');item.textContent=entry;list.append(item)}
 el.append(list);
 if(lines.length>150){const p=document.createElement('p');p.textContent='Показаны первые 150 строк. Проверьте исходный документ.';el.append(p)}
}
function setup(options){
 if($('speedImportPanel'))return;
 ctx=options;
 const form=$('userSpeedForm');if(!form)return;
 const wrapper=document.createElement('section');wrapper.id='speedImportPanel';wrapper.className='speedImportPanel';
 wrapper.innerHTML='<h3>Добавить скорости из фото или PDF</h3><p>Распознавание — черновик. Никакие значения не сохраняются без вашей проверки. Для постоянных и временных скоростей отдельно.</p>'+
 '<div class="speedImportActions"><label class="speedImportButton">Сфотографировать<input type="file" id="speedImportCamera" accept="image/*" capture="environment"></label><label class="speedImportButton">Фото / файл / PDF<input type="file" id="speedImportFile" accept="image/*,.pdf,application/pdf"></label></div>'+
 '<p class="speedImportDisclaimer">Соседние строки с одинаковой станцией и скоростью сопоставляются автоматически. Если скорости меняются на станции, недостающие км/ПК останутся в «На проверку». Точные границы не определяются по месту подписи на SVG. Для первого распознавания нужен интернет. Фото/PDF обрабатываются в браузере, сканированные PDF — максимум по 5 страницам. Сверяйте результат с документом.</p>'+
 '<label>Распознанный текст (можно исправить)<textarea id="speedImportText" rows="5" placeholder="6904/3-6903/5;40&#10;6903/6-6902/1;60"></textarea></label>'+
 '<div class="speedImportActions"><button type="button" id="speedImportParse">Найти строки</button><button type="button" id="speedImportAddManual">Добавить строку</button><button type="button" id="speedImportClear">Очистить распознанное</button></div>'+
 '<p id="speedImportStatus" role="status"></p><div id="speedImportUnresolved" class="speedImportUnresolved" hidden></div>'+
 '<div id="speedImportReviewTabs" class="speedImportReviewTabs" role="tablist" aria-label="Результаты распознавания"><button type="button" role="tab" data-review-tab="ready" aria-selected="true">Распознаны <span class="speedImportTabCount">0</span></button><button type="button" role="tab" data-review-tab="review" aria-selected="false">На проверку <span class="speedImportTabCount">0</span></button></div>'+
 '<div class="speedImportSelectBar"><label for="speedImportSelectAll"><input type="checkbox" id="speedImportSelectAll"> Выбрать все в этой вкладке</label><span id="speedImportSelectionSummary" aria-live="polite">Выбрано 0 из 0</span></div>'+
 '<p id="speedImportReviewEmpty" class="speedImportReviewEmpty" hidden></p><div id="speedImportDrafts"></div><div id="speedImportCoverage" class="speedImportCoverage" role="status" hidden></div>'+
 '<label class="speedImportReview"><input type="checkbox" id="speedImportConfirm"> Я сверил выбранные записи с исходным документом, включая направление, км, ПК, скорости и время МСК.</label>'+
 '<button type="button" id="speedImportSave">Сохранить проверенные записи</button><p id="speedImportSaveFeedback" class="speedImportSaveFeedback" role="status" aria-live="polite" hidden></p>';
 form.parentNode.insertBefore(wrapper,form);
 $('speedImportCamera').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportFile').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportParse').onclick=handleText;
 $('speedImportAddManual').onclick=addManual;
 $('speedImportSave').onclick=saveDrafts;
 $('speedImportClear').onclick=()=>{clearImportDrafts();status('Распознанный текст и черновики очищены. Сохранённые записи не изменились.')};
 for(const button of wrapper.querySelectorAll('[data-review-tab]'))button.onclick=()=>setReviewTab(button.dataset.reviewTab);
 $('speedImportSelectAll').onchange=e=>toggleCurrentReviewTab(e.target.checked);
 const draftChange=event=>{
  const card=event.target.closest('.speedImportDraft');
  if(card){
   // An edited row changes group immediately; retain its checked state.
   // Invalid rows are still rejected by readDrafts even if manually checked.
   refreshReviewTabs();showCoverage();
  }
 };
 // Reclassify after a field is committed (blur/change), not after every digit.
 $('speedImportDrafts').addEventListener('change',draftChange);
}
function setTab(tab){
 if(!ctx||!['permanent','temporary'].includes(tab)){$('speedImportPanel').hidden=true;return}
 ctx.tab=tab;$('speedImportPanel').hidden=false;candidates=[];reviewTab='ready';showUnresolved([]);$('speedImportDrafts').replaceChildren();$('speedImportText').value='';$('speedImportConfirm').checked=false;refreshReviewTabs();showCoverage();status('Выберите фотографию/PDF или добавьте строку вручную.');
}
root.UserSpeedImporter={setup,setTab,clearImportDrafts,extract,rowFromLine,stationlessRange,stationBoundary,stationKey,stationVerifiedBoundary,tableFromPdfItems,tableFromOcrText,speedTripleFromLine,coverageReport};
})(typeof globalThis!=='undefined'?globalThis:this);
