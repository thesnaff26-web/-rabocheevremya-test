(function(root){
 'use strict';
 function gate(data,core){
  let anchor=null,count=0,lastStamp=0;
  return {reset(){anchor=null;count=0;lastStamp=0},accept(position,now=Date.now()){
   const reject=(reason,details={})=>{count=0;return {...details,ok:false,reason}};
   const stamp=position?.timestamp,c=position?.coords;
   if(!Number.isFinite(stamp)||now-stamp>10000||stamp-now>2000)return reject('Геопозиция устарела. Ожидаем новый сигнал.');
   if(stamp<=lastStamp)return reject('Ожидаем новое измерение GPS.');if(lastStamp&&stamp-lastStamp>10000){count=0;anchor=null}lastStamp=stamp;
   if(!c||!Number.isFinite(c.accuracy)||c.accuracy>25||c.accuracy<0)return reject('Недостаточная точность GPS: нужно 25 м или лучше.');
   const fix=core.locate(data,c.latitude,c.longitude,c.accuracy);
   if(!fix.ok)return reject(fix.reason,fix);
   if(anchor&&stamp-anchor.timestamp<30000){const seconds=(stamp-anchor.timestamp)/1000,limit=Math.max(120,seconds*55+anchor.accuracy+c.accuracy);if(Math.abs(fix.chain-anchor.chain)>limit)return reject('Резкий скачок привязки. Показание скрыто.');}
   anchor={...fix,timestamp:stamp};count++;
   if(count<3)return {ok:false,reason:'Проверяем устойчивость GPS: '+count+' / 3.'};
   return {...fix,ok:true,timestamp:stamp,speed:Number.isFinite(c.speed)&&c.speed>=0?c.speed:null};
  }};
 }
 function create(data,callbacks,env=root){
  const filter=gate(data,env.RailCore);let watch=null,timer=null,lastValid=0,active=false,session=0;
  function stop(reason='GPS остановлен.'){session++;active=false;if(watch!==null){env.navigator.geolocation.clearWatch(watch);watch=null}if(timer!==null)env.clearInterval(timer);timer=null;filter.reset();lastValid=0;callbacks.lost(reason);callbacks.state(false)}
  function start(){
   if(!env.navigator.geolocation){callbacks.lost('Браузер не поддерживает GPS.');return}
   stop('Ожидаем GPS…');active=true;callbacks.state(true);const token=++session;
   timer=env.setInterval(()=>{if(active&&lastValid&&Date.now()-lastValid>10000){lastValid=0;filter.reset();callbacks.lost('Сигнал GPS устарел. Текущий км/ПК и профиль скрыты.')}},1000);
   try{watch=env.navigator.geolocation.watchPosition(position=>{
    if(!active||token!==session)return;callbacks.measure?.(position);const fix=filter.accept(position);if(!fix.ok){lastValid=0;callbacks.lost(fix.reason,fix);return}lastValid=fix.timestamp;callbacks.fix(fix);
   },error=>{if(active&&token===session)stop(error.code===1?'Разрешите геопозицию для сайта в настройках телефона.':'Не удалось получить GPS. Включите следование повторно.')},{enableHighAccuracy:true,maximumAge:0,timeout:20000})}
   catch(e){stop('GPS недоступен: '+e.message)}
  }
  return {start,stop,isActive:()=>active};
 }
 const api={gate,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailGPS=api;
})(typeof globalThis!=='undefined'?globalThis:this);
