(function(root){
 'use strict';
 const KEY='rail-local-gps-anchors-v1';
 function makeAnchor(data,chain,position,core,now=Date.now()){
  const c=position?.coords;
  if(!Number.isFinite(chain)||!c||!Number.isFinite(position.timestamp)||now-position.timestamp>10000||position.timestamp-now>2000)throw Error('Нужны свежие координаты GPS. Включите следование.');
  if(!Number.isFinite(c.accuracy)||c.accuracy<0||c.accuracy>10)throw Error('Для сохранения точки нужна точность телефона 10 м или лучше.');
  if(!Number.isFinite(c.speed)||c.speed<0||c.speed>.5)throw Error('Сохраняйте привязку только на остановке: дождитесь скорости 0 км/ч.');
  const hint=core.overviewLocation(data,c.latitude,c.longitude,c.accuracy);
  if(!hint||Math.abs(hint.chain-chain)>500)throw Error('Указанный км/ПК слишком далеко от GPS. Проверьте введённое место.');
  const section=data.sections.find(s=>s.start<=chain&&chain<s.end&&s.points[0][0]<=chain&&chain<=s.points.at(-1)[0]);
  if(!section)throw Error('В базе нет этого километра.');
  return {section:section.id,chain,lat:c.latitude,lon:c.longitude,accuracy:c.accuracy};
 }
 function apply(data,anchors,core){
  const copy={...data,sections:data.sections.map(s=>({...s,points:s.points.map(p=>p.slice())}))};
  for(const a of anchors){
   if(!a||![a.chain,a.lat,a.lon,a.accuracy].every(Number.isFinite)||a.accuracy<0||a.accuracy>10||Math.abs(a.lat)>90||Math.abs(a.lon)>180)continue;
   const s=copy.sections.find(s=>s.id===a.section&&s.start<=a.chain&&a.chain<s.end);if(!s)continue;
   const hint=core.overviewLocation(data,a.lat,a.lon,a.accuracy);if(!hint||Math.abs(hint.chain-a.chain)>500)continue;
   const i=s.points.findIndex(p=>p[0]>=a.chain);if(i<0||i===0&&s.points[0][0]!==a.chain)continue;
   if(s.points[i][0]===a.chain)s.points[i]=[a.chain,a.lat,a.lon];else s.points.splice(i,0,[a.chain,a.lat,a.lon]);
  }
  return core.validate(copy);
 }
 const api={KEY,makeAnchor,apply};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailCalibration=api;
})(typeof globalThis!=='undefined'?globalThis:this);
