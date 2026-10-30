(function(root){
 'use strict';
 const R=6371000,rad=Math.PI/180;
 function distance(a,b){return Math.hypot((b[1]-a[1])*rad*R,(b[2]-a[2])*rad*R*Math.cos((a[1]+b[1])*rad/2))}
 function validate(data){
  if(!data||data.schema!==1||!Array.isArray(data.sections)||!data.sections.length)throw Error('Неверный формат базы');
  for(const s of data.sections){
   if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start||!s.id||!Array.isArray(s.points)||s.points.length<2||!Array.isArray(s.grades)||!Array.isArray(s.stations))throw Error('Неполный участок');
   let prev=-Infinity;
   for(const p of s.points){if(p.length!==3||!p.every(Number.isFinite)||p[0]<=prev||Math.abs(p[1])>90||Math.abs(p[2])>180)throw Error('Ошибка координат пути');prev=p[0]}
   for(const e of s.grades){if(e.length!==3||!e.every(Number.isFinite)||e[1]<=e[0]||Math.abs(e[2])>100)throw Error('Ошибка профиля')}
   for(const p of s.stations)if(!Number.isFinite(p[0])||typeof p[1]!=='string')throw Error('Ошибка станции');
  }return data;
 }
 function format(m){
  m=Math.round(m);const km=Math.floor(m/1000),rest=m-km*1000;return km+' км · ПК '+(Math.floor(rest/100)+1)+' + '+String(rest%100).padStart(2,'0')+' м';
 }
 function formatPicket(m){m=Math.floor(m);const km=Math.floor(m/1000);return km+' км · ПК '+(Math.floor((m-km*1000)/100)+1)}
 function project(point,a,b){
  const cos=Math.cos(point[1]*rad),ax=(a[2]-point[2])*cos,ay=a[1]-point[1],dx=(b[2]-a[2])*cos,dy=b[1]-a[1],den=dx*dx+dy*dy;
  if(den<1e-18)return null;
  const raw=-(ax*dx+ay*dy)/den,t=Math.max(0,Math.min(1,raw));
  const p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];return {chain:p[0],distance:distance(point,p),raw};
 }
 function locate(data,lat,lon,accuracy,previous,now=Date.now()){
  if(![lat,lon,accuracy].every(Number.isFinite)||accuracy<0||accuracy>40)return {ok:false,reason:'Точность GPS недостаточна: нужно 40 м или лучше.'};
  const detailed=data.geometryMatcher?.locate(lat,lon,accuracy,previous,now);if(detailed)return detailed;
  const candidates=[];
  for(const s of data.sections)for(let i=1;i<s.points.length;i++){
   const a=s.points[i-1],b=s.points[i];
   if(b[0]-a[0]>1500||distance(a,b)>2000)continue;
   const p=project([0,lat,lon],a,b);if(!p||p.chain<s.start||p.chain>s.end)continue;
   if((i===1&&p.raw<0)||(i===s.points.length-1&&p.raw>1))continue;
   candidates.push({...p,section:s.id});
  }
  candidates.sort((a,b)=>a.distance-b.distance);const best=candidates[0];
  if(!best||best.distance>Math.min(100,accuracy+50))return {ok:false,distance:best?.distance??null,nearestChain:best?.chain??null,reason:best?'GPS в '+Math.round(best.distance)+' м от линии координатной базы. Привязка км/ПК не подтверждена.':'Рядом нет пригодных координатных отрезков базы.'};
  if(candidates.some(c=>Math.abs(c.chain-best.chain)>300&&c.distance<=best.distance+Math.max(15,accuracy)))return {ok:false,reason:'Неоднозначная привязка к пути. Показание скрыто.'};
  if(previous&&previous.time&&previous.chain&&now-previous.time<20000&&Math.abs(previous.chain-best.chain)>2500)return {ok:false,reason:'Резкий скачок GPS. Ожидаем устойчивую позицию.'};
  return {ok:true,...best,accuracy,time:now,geometrySource:'archive',chainageSource:'legacy',degraded:accuracy>25};
 }
 // Broad location is only for selecting a document/overview, never for confirming km/PK.
 function overviewLocation(data,lat,lon,accuracy){
  const detailed=data.geometryMatcher?.overview(lat,lon,accuracy);if(detailed)return detailed;
  if(![lat,lon,accuracy].every(Number.isFinite)||accuracy<0||accuracy>100)return null;
  const candidates=[];
  for(const s of data.sections)for(let i=1;i<s.points.length;i++){
   const a=s.points[i-1],b=s.points[i];if(b[0]-a[0]>1500||distance(a,b)>2000)continue;
   const p=project([0,lat,lon],a,b);if(!p||p.chain<s.start||p.chain>s.end||(i===1&&p.raw<0)||(i===s.points.length-1&&p.raw>1))continue;
   candidates.push(p);
  }
  candidates.sort((a,b)=>a.distance-b.distance);const best=candidates[0];
  if(!best||best.distance>500||candidates.some(p=>Math.abs(p.chain-best.chain)>2000&&p.distance<best.distance+100))return null;
  return {chain:best.chain,distance:best.distance};
 }
 function gradeAt(data,m){
  for(const s of data.sections){const g=s.grades.find(g=>g[0]<=m&&m<g[1]);if(g)return {grade:g[2],start:g[0],end:g[1],source:s.source}}
  return null;
 }
 function coverage(data){
  const ranges=data.sections.flatMap(s=>s.grades.map(e=>[Math.max(e[0],s.start),Math.min(e[1],s.end)])).filter(e=>e[1]>e[0]).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const r of ranges){const p=merged.at(-1);if(p&&r[0]<=p[1]+.01)p[1]=Math.max(p[1],r[1]);else merged.push(r.slice())}return merged;
 }
 const api={validate,format,formatPicket,locate,gradeAt,coverage,distance,project,overviewLocation};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
