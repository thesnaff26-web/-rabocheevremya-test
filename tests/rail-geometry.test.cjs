'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../rail/core.js'),G=require('../rail/geometry.js'),GPS=require('../rail/gps.js'),A=require('../rail/calibration.js');
const base={schema:1,sections:[{id:'synthetic',start:6900000,end:6902000,points:[[6900000,50,120],[6901000,50,120.014],[6902000,50,120.028]],grades:[],stations:[]}]};
const feature=(id,coordinates)=>({id,type:'Feature',properties:{railway:'rail',usage:'main'},geometry:{type:'LineString',coordinates}});
const geo={type:'FeatureCollection',features:[feature('test',[[120,50],[120.007,50.0018],[120.014,50]])]};
const data=structuredClone(base),p={timestamp:100000,coords:{latitude:50.0018,longitude:120.007,accuracy:5,speed:10}};
assert.equal(C.locate(data,p.coords.latitude,p.coords.longitude,5).ok,false,'Curve is over 100m from the sparse chord');
data.geometryMatcher=G.create(geo,data,C);
const fix=C.locate(data,p.coords.latitude,p.coords.longitude,5);assert(fix.ok);assert(fix.distance<.01);assert(Math.abs(fix.chain-6900500)<1);assert.equal(fix.geometrySource,'osm');assert.equal(fix.chainageSource,'legacy');assert.equal(data.geometryMatcher.stats().chainageVerified,false);
const gate=GPS.gate(data,C);let result;
for(let i=0;i<3;i++)result=gate.accept({...p,timestamp:100000+i*1000,coords:{...p.coords,accuracy:32}},100000+i*1000);
assert(result.ok);assert(result.degraded);assert.equal(result.speed,10);
assert.equal(gate.accept({...p,timestamp:103000,coords:{...p.coords,accuracy:41}},103000).ok,false);
assert.equal(gate.accept({...p,timestamp:104000,coords:{...p.coords,accuracy:5,longitude:120.014,latitude:50}},104000).ok,false,'A sudden chainage jump must be rejected');
assert(C.overviewLocation(data,p.coords.latitude,p.coords.longitude,80),'Lower accuracy can select a section');
assert.equal(C.locate(data,50.05,120.007,5).ok,false,'Off-track point must not snap arbitrarily');
const fallback=C.locate(data,50,120.025,5);assert(fallback.ok);assert.equal(fallback.geometrySource,'archive','Uncovered region keeps explicit archive fallback');
const staticPosition={...p,coords:{...p.coords,speed:0}},anchor=A.makeAnchor(base,6900400,staticPosition,C,100000),updated=A.apply(base,[anchor],C);data.sections=updated.sections;data.geometryMatcher.refresh(data);
assert(Math.abs(C.locate(data,p.coords.latitude,p.coords.longitude,5).chain-6900400)<1,'Device-local anchor must be reflected in the detailed matcher');
data.sections=structuredClone(base.sections);data.geometryMatcher.refresh(data);assert(Math.abs(C.locate(data,p.coords.latitude,p.coords.longitude,5).chain-6900500)<1);
assert.throws(()=>G.create({type:'FeatureCollection',features:[]},base,C));assert.throws(()=>G.create({...geo,features:[feature('bad',[[NaN,50],[120,50]])]},base,C));
const actual=JSON.parse(fs.readFileSync(path.join(__dirname,'../rail/route-geometry.geojson'))),legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'../rail/corridor.json')));
console.time('Actual geometry indexing');const matcher=G.create(actual,legacy,C);console.timeEnd('Actual geometry indexing');assert(matcher.stats().edges>9000);for(const section of legacy.sections)assert(matcher.stats().sections[section.id]>100,'Detailed geometry must exist in each archived section');
// Sample a public geometry vertex rather than storing a user's GPS history.
const way=actual.features.find(f=>f.properties.usage==='main'&&!f.properties.service&&f.geometry.coordinates.some(([lon,lat])=>lon>121.98&&lon<122&&lat>53.98&&lat<54));const [lon,lat]=way.geometry.coordinates.find(([lon,lat])=>lon>121.98&&lon<122&&lat>53.98&&lat<54);const observed=matcher.locate(lat,lon,5);assert(observed?.ok);assert(observed.distance<1);
// Coverage is no longer limited to Mogocha–Urusha: each archived section is eligible.
for(const [chain,lat,lon] of [[5639000,51.8,107.6],[6700000,53.5,119],[8536000,48.4,135.1]]){
 const section={id:'range-'+chain,start:chain,end:chain+1000,points:[[chain,lat,lon],[chain+1000,lat,lon+.01]],grades:[],stations:[]};
 const wide=G.create({type:'FeatureCollection',features:[feature('range',[[lon,lat],[lon+.01,lat]])]},{sections:[section]},C);
 assert(wide.locate(lat,lon+.005,5)?.ok,'All corridor ranges must be eligible');
}
console.log('PASS detailed curves, 32m GPS with degraded flag, 41m rejection, jump rejection, section overview, off-track rejection, archive fallback, local calibration refresh, real-data integrity');
