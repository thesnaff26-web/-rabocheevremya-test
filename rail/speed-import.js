/* Photo/PDF speed importer for the test application.
   OCR is best-effort; NEVER silently treat OCR data as a verified warning. */
(function(root){
'use strict';
const $=id=>document.getElementById(id);
const MAX_FILE=18*1024*1024;
let ctx=null,candidates=[];
const view=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function script(src,globalName){
 if(root[globalName])return Promise.resolve(root[globalName]);
 const cached=document.querySelector('script[data-import-lib="'+globalName+'"]');
 if(cached)return new Promise((resolve,reject)=>{if(root[globalName])return resolve(root[globalName]);cached.addEventListener('load',()=>resolve(root[globalName]),{once:true});cached.addEventListener('error',()=>reject(Error('Не удалось загрузить '+globalName)),{once:true})});
 return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.dataset.importLib=globalName;s.onload=()=>root[globalName]?resolve(root[globalName]):reject(Error('Библиотека '+globalName+' не запустилась'));s.onerror=()=>reject(Error('Не удалось загрузить '+globalName+'. Проверьте интернет'));document.head.append(s)});
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
 return {km1,pk1,km2,pk2,speed,category:'all',begin:'',endTime:'',untilCancel:false,source:s};
}
function extract(text){
 const lines=String(text||'').split(/\r?\n/);const found=[];
 for(const line of lines){const candidate=rowFromLine(line);if(candidate)found.push(candidate)}
 return found.slice(0,150);
}
function status(msg,error=false){const el=$('speedImportStatus');if(el){el.textContent=msg;el.style.color=error?'#fda4af':''}}
async function pdfText(file){
 const pdfjs=await script('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
 if(doc.numPages>20)throw Error('Документ содержит более 20 страниц. Разделите PDF на части.');
 let text='',pageLimit=Math.min(doc.numPages,20);
 for(let i=1;i<=pageLimit;i++){
  status('Читаю PDF: страница '+i+' из '+pageLimit);
  const p=await doc.getPage(i),tc=await p.getTextContent(),items=tc.items||[];
  let y=null;
  for(const item of items){const yy=Math.round(item.transform?.[5]||0);if(y!==null&&Math.abs(yy-y)>3)text+='\n';text+=String(item.str||'')+' ';y=yy}
  text+='\n';
 }
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
   if(scanned.trim())return scanned;
  }finally{await worker.terminate()}
 }
 if(!text.trim())throw Error('Не удалось извлечь текст из PDF. Попробуйте фотографию страницы.');
 return text;
}
async function imageText(file){
 const T=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
 const worker=await T.createWorker('rus+eng',1,{logger:m=>{if(m.status==='recognizing text')status('Распознаю фото: '+Math.round((m.progress||0)*100)+'%')}});
 try{const result=await worker.recognize(file);return result.data.text||''}finally{await worker.terminate()}
}
function showDrafts(){
 const list=$('speedImportDrafts');if(!list)return;
 list.replaceChildren();
 if(!candidates.length){list.innerHTML='<p>Пока не найдены строки в формате «6904/3-6903/5;40». Можно исправить распознанный текст или добавить строки вручную.</p>';return}
 for(let i=0;i<candidates.length;i++){
  const a=candidates[i],card=document.createElement('div');card.className='speedImportDraft';
  card.innerHTML='<label><input type="checkbox" class="impSelected" checked> Строка '+(i+1)+' — проверить</label><div class="speedImportNumbers">'+
   [['km1','Начало км'],['pk1','ПК'],['km2','Конец км'],['pk2','ПК'],['speed','км/ч']].map(([k,label])=>'<label>'+label+'<input data-field="'+k+'" type="text" inputmode="numeric" pattern="[0-9]*" value="'+view(a[k])+'"></label>').join('')+'</div>'+
   '<label>Категория<select data-field="category"><option value="all">Все</option><option value="freight">Грузовой</option><option value="passenger">Пассажирский</option><option value="empty">Порожний</option></select></label>'+
   (ctx.tab==='temporary'?'<div class="speedImportDates"><label>Начало МСК (необязательно)<input data-field="begin" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.begin)+'"></label><label>Конец МСК (необязательно)<input data-field="endTime" type="text" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value="'+view(a.endTime)+'"></label><label><input type="checkbox" data-field="untilCancel"> До отмены</label></div>':'')+
   '<small>Источник: '+view(a.source||'Добавлено вручную')+'</small>';
  card.querySelector('[data-field="category"]').value=a.category||'all';
  list.append(card);
 }
}
function handleText(){candidates=extract($('speedImportText').value);showDrafts();status('Найдено строк: '+candidates.length+'. Проверьте все значения перед сохранением.')}
function addManual(){candidates.push({km1:'',pk1:'',km2:'',pk2:'',speed:'',category:'all',begin:'',endTime:'',source:'ручная корректировка'});showDrafts();status('Заполните новую строку и проверьте исходный документ.')}
function readDrafts(){
 if(!ctx.route())throw Error('Сначала выберите участок и направление');
 const route=ctx.route(),out=[];
 for(const [i,card] of [...$('speedImportDrafts').querySelectorAll('.speedImportDraft')].entries()){
  if(!card.querySelector('.impSelected').checked)continue;
  const get=k=>card.querySelector('[data-field="'+k+'"]');
  const val=k=>get(k)?.value.trim()||'';
  const km1=+val('km1'),pk1=+val('pk1'),km2=+val('km2'),pk2=+val('pk2'),speed=+val('speed');
  if(!/^\d{4}$/.test(val('km1'))||!/^\d{4}$/.test(val('km2'))||!([pk1,pk2].every(x=>Number.isInteger(x)&&x>=1&&x<=10))||!Number.isInteger(speed)||speed<1||speed>200)throw Error('Строка '+(i+1)+': проверьте км, ПК и скорость');
  const start=km1*1000+(pk1-1)*100,end=km2*1000+(pk2-1)*100;
  if(start===end)throw Error('Строка '+(i+1)+': одинаковые начало и конец');
  if((end-start)*route.direction<=0)throw Error('Строка '+(i+1)+': границы не соответствуют направлению участка');
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
  if(result.added){$('speedImportDrafts').replaceChildren();candidates=[]}
 }catch(e){status(e.message,true)}
}
async function handleFile(file){
 if(!file)return;
 if(file.size>MAX_FILE)return status('Максимальный размер файла — 18 МБ.',true);
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
 const isImage=file.type.startsWith('image/')||/\.(png|jpe?g|webp|heic)$/i.test(file.name||'');
 if(!isPdf&&!isImage)return status('Поддерживаются фотографии и PDF.',true);
 status('Подготавливаю '+file.name+'…');
 try{
  const text=isPdf?await pdfText(file):await imageText(file);
  $('speedImportText').value=text;handleText();
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
 '<p id="speedImportStatus" role="status"></p><div id="speedImportDrafts"></div>'+
 '<label class="speedImportReview"><input type="checkbox" id="speedImportConfirm"> Я сверил выбранные записи с исходным документом, включая направление, км, ПК, скорости и время МСК.</label>'+
 '<button type="button" id="speedImportSave">Сохранить проверенные записи</button>';
 form.parentNode.insertBefore(wrapper,form);
 $('speedImportCamera').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportFile').onchange=e=>{handleFile(e.target.files[0]);e.target.value=''};
 $('speedImportParse').onclick=handleText;
 $('speedImportAddManual').onclick=addManual;
 $('speedImportSave').onclick=saveDrafts;
}
function setTab(tab){
 if(!ctx||!['permanent','temporary'].includes(tab)){$('speedImportPanel').hidden=true;return}
 ctx.tab=tab;$('speedImportPanel').hidden=false;candidates=[];$('speedImportDrafts').replaceChildren();$('speedImportText').value='';$('speedImportConfirm').checked=false;status('Выберите фотографию/PDF или добавьте строку вручную.');
}
root.UserSpeedImporter={setup,setTab,extract,rowFromLine};
})(typeof globalThis!=='undefined'?globalThis:this);
