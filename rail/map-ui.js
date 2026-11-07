/* Mobile electronic-map controls. Does not alter route or warning data. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function ready(){
 const panel=$('driverPanel');if(!panel||$('mapQuickNav'))return;
 const nav=document.createElement('nav');
 nav.id='mapQuickNav';nav.setAttribute('aria-label','Разделы электронной карты');
 nav.innerHTML='<div class="mapQuickTabs" role="group" aria-label="Режим просмотра"><button type="button" data-view="profile" class="selected" aria-pressed="true">⌁ <span>Профиль</span></button><button type="button" data-view="warnings" aria-pressed="false">⚠ <span>Предупреждения</span><b id="mapWarningCount" aria-label="Количество записей">0</b></button><button type="button" data-view="gps" aria-pressed="false">◎ <span>GPS</span></button></div><div class="mapQuickActions" id="mapQuickActions"><button type="button" id="mapAddWarning" class="mapQuickPrimary">＋ Добавить предупреждение</button><button type="button" id="mapOpenList">Список</button></div>';
 panel.parentNode.insertBefore(nav,panel);
 const manager=()=> $('userSpeedManager');
 const views={profile:panel,gps:$('gpsSettings')};
 let current='profile';
 function show(view){
  current=view;
  for(const b of nav.querySelectorAll('[data-view]')){const on=b.dataset.view===view;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on))}
  panel.hidden=view!=='profile';
  $('gpsSettings').hidden=view!=='gps';
  const m=manager();if(m){m.hidden=view!=='warnings';if(view==='warnings')m.open=true}
  $('mapQuickActions').hidden=view!=='profile';
  if(view==='profile')window.dispatchEvent(new Event('resize'));
  if(view==='warnings'&&!m)window.setTimeout(()=>show('warnings'),250);
 }
 nav.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
 $('mapAddWarning').onclick=()=>{show('warnings');const m=manager();if(m){m.open=true;const f=$('userSpeedForm');if(f){$('userClearForm')?.click();f.scrollIntoView({behavior:'smooth',block:'start'});f.querySelector('[name="speed"]')?.focus({preventScroll:true})}}};
 $('mapOpenList').onclick=()=>{show('warnings');$('userSpeedTabs')?.scrollIntoView({behavior:'smooth',block:'start'})};
 const sync=()=>{const m=manager();if(!m)return;if(m.dataset.mapQuickReady!=='1'){m.dataset.mapQuickReady='1';m.hidden=current!=='warnings';m.open=current==='warnings';const form=$('userSpeedForm');if(form){const top=document.createElement('div');top.className='mapFormIntro';top.innerHTML='<span>НОВАЯ ЗАПИСЬ</span><p>Заполните данные предупреждения и сохраните его для выбранного направления.</p>';form.prepend(top)}}
 const c=$('mapWarningCount');if(c){const counts=[...m.querySelectorAll('.userSpeedCount')].map(x=>Number(x.textContent)||0);c.textContent=String(counts.reduce((a,b)=>a+b,0));}
 };
 new MutationObserver(sync).observe(document.body,{childList:true,subtree:true,characterData:true});sync();
 show('profile');
 const selected=localStorage.getItem('theme')||localStorage.getItem('app-theme')||localStorage.getItem('rv-theme')||'';
 if(/^(light|dark)$/.test(selected))document.documentElement.dataset.mapTheme=selected;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();