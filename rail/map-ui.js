/* Electronic map: two clear screens, one action per task. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
function init(){
 const profile=$('driverPanel'),gps=$('gpsSettings');
 if(!profile||$('mapQuickNav'))return;
 const nav=document.createElement('nav');nav.id='mapQuickNav';nav.setAttribute('aria-label','Электронная карта');
 nav.innerHTML='<div class="mapQuickTabs"><button type="button" data-view="profile" class="selected" aria-pressed="true">Профиль пути</button><button type="button" data-view="warnings" aria-pressed="false">Предупреждения <span id="mapWarningCount">0</span></button></div>';
 profile.before(nav);
 const manager=()=>$('userSpeedManager');
 let view='profile',initialized=false;
 function show(which){
  view=which;
  nav.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===which;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active))});
  profile.hidden=which!=='profile';
  if(gps)gps.hidden=which!=='profile';
  const m=manager();if(m){m.hidden=which!=='warnings';if(which==='warnings')m.open=true}
  const stations= $('nearStations')?.closest('section');if(stations)stations.hidden=which!=='profile';
  if(which==='profile')requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  if(which==='warnings'&&!m)setTimeout(()=>show('warnings'),250);
 }
 function setup(m){
  if(initialized)return;initialized=true;
  const form=$('userSpeedForm');if(!form)return;
  m.open=true;
  const actions=document.createElement('div');actions.className='mapWarningActions';
  actions.innerHTML='<button type="button" id="mapNewWarning">＋ Новое предупреждение</button>';
  $('userSpeedTabs').before(actions);
  const tools=document.createElement('details');tools.className='mapAdvanced';
  tools.innerHTML='<summary>Резервная копия и управление данными</summary>';
  for(const id of ['userSpeedExport','userSpeedImport','userResetTemp','userResetTp','userRestoreReset']){
   const e=$(id);if(!e)continue;
   const wrapper=e.closest('.row');if(wrapper&&wrapper.parentElement===m){if([...wrapper.children].every(x=>x.id===id))tools.append(wrapper);else tools.append(e)}
   else if(e.parentElement?.classList.contains('userImport'))tools.append(e.parentElement);
   else tools.append(e);
  }
  m.append(tools);
  const formTitle=$('userSpeedAddTitle');
  if(formTitle)formTitle.textContent='Данные предупреждения';
  form.hidden=true;
  const add=$('mapNewWarning');
  const openForm=()=>{form.hidden=false;form.scrollIntoView({behavior:'smooth',block:'start'})};
  add.onclick=()=>{$('userClearForm')?.click();openForm()};
  // The existing edit handler fills every field. Reveal the same form afterward.
  m.addEventListener('click',e=>{if(e.target.closest('[data-edit]'))requestAnimationFrame(openForm)});
  const cancel=document.createElement('button');cancel.type='button';cancel.id='mapCancelEditing';cancel.textContent='Отмена';cancel.className='mapCancelEditing';
  $('userClearForm')?.after(cancel);cancel.onclick=()=>{$('userClearForm')?.click();form.hidden=true};
  form.addEventListener('submit',()=>{setTimeout(()=>{const status=$('userSpeedStatus')?.textContent||'';if(!/ошиб|проверь|неверн|укажите|сначала|раньше/i.test(status)&&!form.elements.uid.value)form.hidden=true},70)});
 }
 function sync(){
  const m=manager();if(!m)return;setup(m);
  if(m.hidden!==(view!=='warnings'))m.hidden=view!=='warnings';
  const count=$('mapWarningCount');
  if(count){const n=[...m.querySelectorAll('.userSpeedCount')].reduce((a,e)=>a+(Number(e.textContent)||0),0);if(count.textContent!==String(n))count.textContent=String(n)}
 }
 nav.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>show(b.dataset.view));
 const observer=new MutationObserver(sync);observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 sync();show('profile');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();