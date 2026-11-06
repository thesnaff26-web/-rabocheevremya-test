/* Photo/PDF speed importer for the test application.
   OCR is best-effort; NEVER silently treat OCR data as a verified warning. */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
const MAX_FILE=18*1024*1024;
let ctx=null,candidates=[];
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
 const s=String(raw||'').trim().replace(/[—–−]/g,'-').replace(/\s*\([^)]*\)\s*$/,'').replace(/\s+/g,'');
 const m=s.match(/^(\d{4})пк(10|[1-9])(?:-(?:(\d{4})пк)?(10|[1-9]))?$/i);
 if(!m)return null;
 const a=+m[1],pk1=+m[2],b=m[4]?(m[3]?+m[3]:a):null,pk2=m[4]?+m[4]:null;
 if(a<5000||a>9000||(b!==null&&(b<5000||b>9000)))return null;
 if(b!==null&&a===b&&pk1===pk2)return null;
 return {km1:a,pk1,km2:b??'',pk2:pk2??''};
}
function stationKey(s){return String(s||'').toLowerCase().replace(/[^а-яёa-z0-9]/gi,'').replace(/ё/g,'е')}
function stationBoundary(raw){
 const s=String(raw||'').trim().replace(/[—–−]/g,'-').replace(/\s+/g,'').replace(/\([^)]*\)$/,'');
 const m=s.match(/^(.+?)-(.+)$/);if(!m)return null;
 const numeric=x=>{const p=x.match(/^(\d{4})пк(10|[1-9])$/i);return p?{km:+p[1],pk:+p[2]}:null};
 const start=numeric(m[1]),end=numeric(m[2]);
 if(start&&!end&&stationKey(m[2]))return {kind:'toStation',station:stationKey(m[2]),numeric:start};
 if(!start&&end&&stationKey(m[1]))return {kind:'fromStation',station:stationKey(m[1]),numeric:end};
 return null;
}
function tableFromPdfItems(items,pageHeight){
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
   if(side==='right'&&row.y<650)continue;
   const cells=row.items.filter(it=>side==='left'?it.x<205:it.x>=428);
   if(!cells.length)continue;
   const location=cells.filter(it=>side==='left'?it.x<108:it.x<527)
    .sort((a,b)=>a.x-b.x).map(it=>it.str).join(' ').trim();
   const range=stationlessRange(location),boundary=stationBoundary(location);
   if(!range&&!boundary)continue;
   const slots=side==='left'
     ?[{category:'passenger',from:109,to:134},{category:'freight',from:135,to:162},{category:'empty',from:164,to:203}]
     :[{category:'passenger',from:528,to:547},{category:'freight',from:548,to:569},{category:'empty',from:570,to:597}];
   const speeds={};
   for(const col of slots){
    const token=cells.filter(it=>it.x>=col.from&&it.x<col.to).map(it=>it.str).join('').trim();
    if(/^\d{1,3}$/.test(token)&&+token>=1&&+token<=200)speeds[col.category]=+token;
   }
   if(!Object.keys(speeds).length)continue;
   bySide[side].push({location,range,boundary,speeds});
  }
 }
 for(const sequence of Object.values(bySide)){
  for(let i=0;i<sequence.length;i++){
   const row=sequence[i];
   for(const [category,speed] of Object.entries(row.speeds)){
    let range=row.range;
    if(!range&&row.boundary?.kind==='toStation'){
     const next=sequence[i+1];
     // Join a named station boundary only when the NEXT row begins with
     // the identical station name and the SAME speed for this category.
     // If the speed changes at the station, exact PK remains unknown.
     if(next?.boundary?.kind==='fromStation' &&
         next.boundary.station===row.boundary.station &&
         next.speeds[category]===speed){
      range={km1:row.boundary.numeric.km,pk1:row.boundary.numeric.pk,
       km2:next.boundary.numeric.km,pk2:next.boundary.numeric.pk};
     }
    }else if(!range&&row.boundary?.kind==='fromStation'){
     // Paired with previous record if it had the same station and speed.
     const previous=sequence[i-1];
     if(previous?.boundary?.kind==='toStation'&&previous.boundary.station===row.boundary.station&&previous.speeds[category]===speed)continue;
    }
    if(!range){pending.push(row.location+' / '+category);continue}
    drafts.push({...range,speed,category,begin:'',endTime:'',untilCancel:false,
      source:row.location+' | '+(category==='passenger'?'Пас':category==='freight'?'ГР':'Пор')+' '+speed+
       (!row.range?' [две строки объединены по станции]':'')});
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
  if(ctx?.tab==='permanent'){tableRows.push(...tableFromPdfItems(items,p.view[3]-p.view[1]));unresolved.push(...(tableFromPdfItems.lastUnresolved||[]))}
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
   let scanned='';
   for(let i=1;i<=Math.min(doc.numPages,5);i++){
    status('Распознаю скан PDF: страница '+i+' из '+Math.min(doc.numPages,5));
    const page=await doc.getPage(i),viewport=page.getViewport({scale:1.75});
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw Error('Не удаётся подготовить PDF для распознавания');
    await page.render({canvasContext:context,viewport}).promise;
    const result=await worker.recognize(canvas);scanned+=(result.data.text||'')+'\n';
    canvas.width=0;canvas.height=0;
   }
   // Surface OCR text for verification, regardless of whether rows were found.
   if(scanned.trim())return {text:scanned,drafts:[],unresolved:[]};
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
function showDrafts(){
 const list=$('speedImportDrafts');if(!list)return;
 list.replaceChildren();
 if(!candidates.length){list.innerHTML='<p>Скорости не найдены автоматически. Для таблиц PDF используйте оригинальный цифровой файл. Можно исправить распознанный текст или добавить строку вручную.</p>';showCoverage();return}
 for(let i=0;i<candidates.length;i++){
  const a=candidates[i],card=document.createElement('div');card.className='speedImportDraft';
  card.innerHTML='<label><input type="checkbox" class="impSelected" checked> Строка '+(i+1)+' — проверить</label><div class="speedImportNumbers">'+
   [['km1','Начало км'],['pk1','ПК'],['km2','Конец км'],['pk2','ПК'],['speed','км/ч']].map(([k,label])=>'<label>'+label+'<input data-field="'+k+'" type="text" inputmode="numeric" pattern="[0-9]*" value="'+view(a[k])+'"></label>').join('')+'</div>'+
   '<label>Категория<select data-field="category"><option value="">Выберите</option><option value="all">Все</option><option value="freight">Грузовой</option><option value="passenger">Пассажирский</option><option value="empty">Порожний</option></select></label>'+
   (ctx.tab==='temporary'?'<div class="speedImportDates"><label>Начало МСК (необязательно)<input data-field="begin" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.begin)+'"></label><label>Конец МСК (необязательно)<input data-field="endTime" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.endTime)+'"></label><label><input type="checkbox" data-field="untilCancel"> До отмены</label></div>':'')+
   '<small>Источник: '+view(a.source||'Добавлено вручную')+'</small>';
  card.querySelector('[data-field="category"]').value=a.category||'';
  list.append(card);
 }
 showCoverage();
}
function handleText(){candidates=extract($('speedImportText').value);showDrafts();status('Найдено строк: '+candidates.length+'. Проверьте все значения перед сохранением.')}
function addManual(){candidates.push({km1:'',pk1:'',km2:'',pk2:'',speed:'',category:'',begin:'',endTime:'',source:'ручная корректировка'});showDrafts();status('Заполните новую строку и проверьте исходный документ.')}
function readDrafts(){
 if(!ctx.route())throw Error('Сначала выберите участок и направление');
 const route=ctx.route(),out=[];
 for(const [i,card] of [...$('speedImportDrafts').querySelectorAll('.speedImportDraft')].entries()){
  if(!card.querySelector('.impSelected').checked)continue;
  const get=k=>card.querySelector('[data-field="'+k+'"]');
  const val=k=>get(k)?.value.trim()||'';
  const km1=+val('km1'),pk1=+val('pk1'),km2=+val('km2'),pk2=+val('pk2'),speed=+val('speed');
  const hasEnd=val('km2')!==''||val('pk2')!=='';
  if(!/^\d{4}$/.test(val('km1'))||!(pk1>=1&&pk1<=10)||!Number.isInteger(pk1)||
    (hasEnd&&(!/^\d{4}$/.test(val('km2'))||!Number.isInteger(pk2)||pk2<1||pk2>10))||
    !Number.isInteger(speed)||speed<1||speed>200)throw Error('Строка '+(i+1)+': проверьте км, ПК и скорость');
  if(hasEnd&&(!val('km2')||!val('pk2')))throw Error('Строка '+(i+1)+': заполните оба поля конца');
  const start=km1*1000+(pk1-1)*100,end=hasEnd?km2*1000+(pk2-1)*100:null;
  if(end!==null&&start===end)throw Error('Строка '+(i+1)+': одинаковые начало и конец');
  if(end!==null&&(end-start)*route.direction<=0)throw Error('Строка '+(i+1)+': границы не соответствуют направлению участка');
  if(!['all','freight','passenger','empty'].includes(val('category')))throw Error('Строка '+(i+1)+': выберите категорию поезда после проверки документа');
  const begin=ctx.tab==='temporary'?parseMsk(val('begin')):'';
  const endTime=ctx.tab==='temporary'?parseMsk(val('endTime')):'';
  const untilCancel=ctx.tab==='temporary'&&!!get('untilCancel')?.checked;
  if(endTime&&!begin)throw Error('Строка '+(i+1)+': укажите начало действия');
  if(begin&&endTime&&Date.parse(endTime+':00+03:00')<Date.parse(begin+':00+03:00'))throw Error('Строка '+(i+1)+': конец раньше начала');
  out.push({type:ctx.tab,routeId:route.id,category:val('category'),start,end,speed,begin,endTime:untilCancel?'':endTime,untilCancel});
 }
 if(!out.length)throw Error('Выберите хотя бы одну проверенную строку');
 return out;
}
async function saveDrafts(){
 try{
  const rows=readDrafts();
  if(!$('speedImportConfirm').checked)throw Error('Подтвердите, что сверили все выбранные строки с документом');
  const result=ctx.save(rows);
  status('Сохранено '+result.added+' записей; дубликатов пропущено: '+result.duplicates+'.');
  $('speedImportConfirm').checked=false;
  if(result.added){$('speedImportDrafts').replaceChildren();candidates=[];showCoverage()}
 }catch(e){status(e.message,true)}
}
async function handleFile(file){
 if(!file)return;
 // Never leave drafts from a previous document available while opening another one.
 candidates=[];$('speedImportDrafts').replaceChildren();$('speedImportText').value='';$('speedImportConfirm').checked=false;
 if(file.size>MAX_FILE)return status('Максимальный размер файла — 18 МБ.',true);
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
 const isImage=file.type.startsWith('image/')||/\.(png|jpe?g|webp|heic)$/i.test(file.name||'');
 if(!isPdf&&!isImage)return status('Поддерживаются фотографии и PDF.',true);
 status('Подготавливаю '+file.name+'…');
 try{
  const result=isPdf?await pdfText(file):{text:await imageText(file),drafts:[]};
  $('speedImportText').value=result.text;
  if(result.drafts.length){candidates=result.drafts;showDrafts();status('Найдено '+candidates.length+' скоростей. '+(result.unresolved?.length?'Не разрешено границ по станциям: '+result.unresolved.length+'. Эти участки останутся пустыми до проверки. ':'')+'Сверьте все км, ПК и категории с PDF перед сохранением.');}
  else handleText();
  if(!candidates.length)status('Распознавание завершено, но строки не определились. Проверьте текст и внесите записи вручную.',true);
 }catch(e){status(e.message||'Не удалось прочитать файл',true)}
}
function setup(options){
 if($('speedImportPanel'))return;
 ctx=options;
 const form=$('userSpeedForm');if(!form)return;
 const wrapper=document.createElement('section');wrapper.id='speedImportPanel';wrapper.className='speedImportPanel';
 wrapper.innerHTML='<h3>Добавить скорости из фото или PDF</h3><p>Распознавание — черновик. Никакие значения не сохраняются без вашей проверки. Для постоянных и временных скоростей отдельно.</p>'+
 '<div class="speedImportActions"><label class="speedImportButton">Сфотографировать<input type="file" id="speedImportCamera" accept="image/*" capture="environment"></label><label class="speedImportButton">Фото / файл / PDF<input type="file" id="speedImportFile" accept="image/*,.pdf,application/pdf"></label></div>'+
 '<p class="speedImportDisclaimer">Для первого распознавания нужен интернет (библиотеки загружаются с внешних CDN). Обработка выполняется в браузере, приложение не сохраняет фото/PDF на сервере. Сканированные PDF распознаются максимум по 5 страницам. Результат нужно сверить с документом.</p>'+
 '<label>Распознанный текст (можно исправить)<textarea id="speedImportText" rows="5" placeholder="6904/3-6903/5;40&#10;6903/6-6902/1;60"></textarea></label>'+
 '<div class="speedImportActions"><button type="button" id="speedImportParse">Найти строки</button><button type="button" id="speedImportAddManual">Добавить строку</button></div>'+
 '<p id="speedImportStatus" role="status"></p><div id="speedImportDrafts"></div><div id="speedImportCoverage" class="speedImportCoverage" role="status" hidden></div>'+
 '<label class="speedImportReview"><input type="checkbox" id="speedImportConfirm"> Я сверил выбранные записи с исходным документом, включая направление, км, ПК, скорости и время МСК.</label>'+
 '<button type="button" id="speedImportSave">Сохранить проверенные записи</button>';
 form.parentNode.insertBefore(wrapper,form);
 $('speedImportCamera').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportFile').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportParse').onclick=handleText;
 $('speedImportAddManual').onclick=addManual;
 $('speedImportSave').onclick=saveDrafts;
 $('speedImportDrafts').addEventListener('input',showCoverage);
 $('speedImportDrafts').addEventListener('change',showCoverage);
}
function setTab(tab){
 if(!ctx||!['permanent','temporary'].includes(tab)){$('speedImportPanel').hidden=true;return}
 ctx.tab=tab;$('speedImportPanel').hidden=false;candidates=[];$('speedImportDrafts').replaceChildren();$('speedImportText').value='';$('speedImportConfirm').checked=false;showCoverage();status('Выберите фотографию/PDF или добавьте строку вручную.');
}
root.UserSpeedImporter={setup,setTab,extract,rowFromLine,stationlessRange,stationBoundary,tableFromPdfItems,coverageReport};
})(typeof globalThis!=='undefined'?globalThis:this);
