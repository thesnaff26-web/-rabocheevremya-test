(function(root){
 'use strict';
 const CELL=.02,START=6895000,END=7215000;
 function grid(){
  const cells=new Map();
  function key(x,y){return x+':'+y}
  return {add(edge){const x0=Math.floor(Math.min(edge.a[1],edge.b[1])/CELL),x1=Math.floor(Math.max(edge.a[1],edge.b[1])/CELL),y0=Math.floor(Math.min(edge.a[2],edge.b[2])/CELL),y1=Math.floor(Math.max(edge.a[2],edge.b[2])/CELL);if((x1-x0+1)*(y1-y0+1)>100)throw Error('Слишком длинный отрезок геометрии');for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=key(x,y);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(edge)}},near(lat,lon){const x=Math.floor(lat/CELL),y=Math.floor(lon/CELL),out=new Set();for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const e of cells.get(key(x+dx,y+dy))||[])out.add(e);return [...out]}};
 }
 function validate(geo){
  if(geo?.type!=='FeatureCollection'||!Array.isArray(geo.features)||!geo.features.length||geo.features.length>5000)throw Error('Неверный формат подробной геометрии');
  const ids=new Set();let count=0;
  for(const f of geo.features){if(ids.has(f.id)||!f.id||f.geometry?.type!=='LineString'||f.properties?.railway!=='rail'||!Array.isArray(f.geometry.coordinates)||f.geometry.coordinates.length<2)throw Error('Неполная линия пути');ids.add(f.id);for(const p of f.geometry.coordinates){if(p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('Неверная координата геометрии');if(++count>100000)throw Error('Слишком большая геометрия')}}return geo;
 }
 function create(geo,data,core){
  validate(geo);let index,edgeCount=0;
  function refresh(current=data){
   const base=grid(),next=grid();
   for(const s of current.sections)for(let i=1;i<s.points.length;i++){const a=s.points[i-1],b=s.points[i];if(a[0]<START||b[0]>END||b[0]-a[0]>1500||core.distance(a,b)>2000)continue;base.add({a,b,section:s.id})}
   const references=new Map();
   function reference(lat,lon){const k=lat+','+lon;if(references.has(k))return references.get(k);const values=base.near(lat,lon).map(e=>({...core.project([0,lat,lon],e.a,e.b),section:e.section})).filter(e=>Number.isFinite(e.chain)&&e.chain>=START&&e.chain<=END).sort((a,b)=>a.distance-b.distance),best=values[0];const good=best&&best.distance<=750&&!values.some(v=>Math.abs(v.chain-best.chain)>300&&v.distance<=best.distance+15)?best:null;references.set(k,good);return good;}
   let n=0;
   for(const f of geo.features){const ps=f.geometry.coordinates;for(let i=1;i<ps.length;i++){const [al,at]=ps[i-1],[bl,bt]=ps[i],ra=reference(at,al),rb=reference(bt,bl);if(!ra||!rb||ra.section!==rb.section)continue;const a=[ra.chain,at,al],b=[rb.chain,bt,bl],length=core.distance(a,b),delta=Math.abs(b[0]-a[0]);if(length<.1||length>2000||delta<length*.1||delta>Math.max(200,length*2.5))continue;next.add({a,b,id:f.id+':'+i,way:f.id,section:ra.section,referenceOffset:Math.max(ra.distance,rb.distance)});n++}}
   if(!n)throw Error('Нет геометрии, связанной с архивными отметками');index=next;edgeCount=n;
  }
  function candidates(lat,lon){return index.near(lat,lon).map(e=>{const p=core.project([0,lat,lon],e.a,e.b);if(!p||p.raw<-.02||p.raw>1.02)return null;const t=Math.max(0,Math.min(1,p.raw));return {...p,section:e.section,edge:e.id,way:e.way,referenceOffset:e.referenceOffset,snapped:[e.a[1]+t*(e.b[1]-e.a[1]),e.a[2]+t*(e.b[2]-e.a[2])]}}).filter(Boolean).sort((a,b)=>a.distance-b.distance)}
  function locate(lat,lon,accuracy,previous,now=Date.now()){
   if(![lat,lon,accuracy].every(Number.isFinite)||accuracy<0||accuracy>40)return {ok:false,reason:'Недостаточная точность GPS: нужно 40 м или лучше.'};
   const values=candidates(lat,lon),nearest=values[0];if(!nearest||nearest.distance>500)return null; // Outside this dataset: retain the archive fallback.
   const reject=reason=>({ok:false,distance:nearest.distance,nearestChain:nearest.chain,geometrySource:'osm',reason});
   if(nearest.distance>Math.min(75,accuracy+20))return reject('GPS в '+Math.round(nearest.distance)+' м от подробной линии пути. Привязка не подтверждена.');
   let close=values.filter(v=>v.distance<=nearest.distance+Math.max(8,accuracy)&&v.distance<=Math.min(75,accuracy+20));
   const seconds=previous?.timestamp?(now-previous.timestamp)/1000:Infinity;
   if(seconds>0&&seconds<30){const limit=Math.max(120,seconds*55+accuracy+(previous.accuracy||0)),consistent=close.filter(v=>Math.abs(v.chain-previous.chain)<=limit);if(!consistent.length)return reject('Резкий скачок привязки. Ожидаем устойчивую позицию.');close=consistent;const expected=previous.chain+(previous.chainSpeed||0)*seconds;close.sort((a,b)=>(a.distance+Math.min(80,Math.abs(a.chain-expected)*.15))-(b.distance+Math.min(80,Math.abs(b.chain-expected)*.15)))}
   const best=close[0];if(close.some(v=>Math.abs(v.chain-best.chain)>100))return reject('Несколько вариантов километровой привязки. Км/ПК скрыт до уточнения.');
   return {...best,ok:true,accuracy,time:now,geometrySource:'osm',chainageSource:'legacy',degraded:accuracy>25};
  }
  function overview(lat,lon,accuracy){if(![lat,lon,accuracy].every(Number.isFinite)||accuracy<0||accuracy>100)return null;const values=candidates(lat,lon),best=values[0];if(!best||best.distance>500||values.some(v=>Math.abs(v.chain-best.chain)>2000&&v.distance<best.distance+100))return null;return {...best,geometrySource:'osm'};}
  refresh();return {locate,overview,refresh,stats:()=>({edges:edgeCount,start:START,end:END,chainageVerified:false})};
 }
 const api={validate,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
