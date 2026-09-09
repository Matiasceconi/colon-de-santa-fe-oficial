import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
let clock=Date.parse("2026-09-09T12:00:00Z"),allowed=true,user={id:"admin",role:"admin",full_name:"Test"},calls=[];
class Clock extends Date {constructor(...args){if(args.length)super(...args);else super(clock);}static now(){return clock;}}
const clone=v=>structuredClone(v);
const get=(r,k)=>k.split(".").reduce((v,p)=>v?.[p],r);
function matches(r,q){
 return Object.entries(q).every(([k,v])=>{
  if(k==="$or")return v.some(x=>matches(r,x));
  const a=get(r,k);
  if(v&&typeof v==="object"&&!Array.isArray(v)){
   return Object.entries(v).every(([op,b])=>{
    if(op==="$in")return Array.isArray(a)?a.some(x=>b.includes(x)):b.includes(a);
    if(op==="$lt")return a!==undefined&&a<b;
    if(op==="$exists")return (a!==undefined)===b;
    if(op==="$regex")return new RegExp(b).test(String(a||""));
    throw new Error("Unsupported query operator "+op);
   });
  }return a===v;
 });
}
let tables={},sequence=0;
function entity(name){
 tables[name]??=[];
 return {
  async filter(q={},sort="id",limit=5000,skip=0){let r=tables[name].filter(x=>matches(x,q));const desc=sort?.startsWith("-"),key=sort?.replace(/^-/,"")||"id";r.sort((a,b)=>String(a[key]||"").localeCompare(String(b[key]||""))*(desc?-1:1));return clone(r.slice(skip,skip+limit));},
  async list(sort,limit,skip){return this.filter({},sort,limit,skip);},
  async get(id){const r=tables[name].find(x=>x.id===id);if(!r)throw new Error("Not found "+name);return clone(r);},
  async create(payload){const r={...clone(payload),id:"id"+String(++sequence).padStart(6,"0"),created_date:new Clock().toISOString()};tables[name].push(r);return clone(r);},
  async update(id,patch){const r=tables[name].find(x=>x.id===id);assert(r);Object.assign(r,clone(patch));return clone(r);},
  async bulkCreate(rows){return Promise.all(rows.map(r=>this.create(r)));},
  async bulkUpdate(rows){return Promise.all(rows.map(r=>this.update(r.id,Object.fromEntries(Object.entries(r).filter(([k])=>k!=="id")))));},
  async updateMany(q,changes){let n=0;for(const r of tables[name])if(matches(r,q)){if(changes.$set)Object.assign(r,clone(changes.$set));n++;}return{success:true,updated:n};}
 };
}
const db=new Proxy({},{get:(_,k)=>entity(k)});
const base44={auth:{me:async()=>user},asServiceRole:{entities:db}};
let responder;
async function fetchMock(url,options){calls.push({url:String(url),options});return responder(new URL(url),options);}
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file);
 const source=fs.readFileSync(file,"utf8");
 const result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 const errors=result.diagnostics?.filter(x=>x.category===ts.DiagnosticCategory.Error)||[];assert.equal(errors.length,0,JSON.stringify(errors));
 const mod={exports:{}};cache.set(file,mod.exports);
 const require=(specifier)=>{
  if(specifier==="npm:@base44/sdk")return{createClientFromRequest:()=>base44};
  if(specifier.endsWith("modulePermission.ts"))return{requireModulePermission:async(_b,u)=>u&&allowed?{}:null};
  return load(path.resolve(path.dirname(file),specifier));
 };
 const context={Date:Clock,Response,Request,Headers,URL,AbortSignal,crypto:crypto.webcrypto,fetch:fetchMock,Deno:{env:{get:()=>undefined}},console};
 vm.runInNewContext("(function(require,module,exports){"+result.outputText+"\n})",context)(require,mod,mod.exports);
 cache.set(file,mod.exports);return mod.exports;
}
const model=load("base44/shared/scoutingFeedModel.ts"),transport=load("base44/shared/footballApi.ts"),handler=load("base44/functions/scouting-feed/entry.ts").default;
const response=(data,status=200,headers={})=>Response.json(data,{status,headers:{"x-ratelimit-requests-limit":"7500","x-ratelimit-requests-remaining":"7400","x-ratelimit-limit":"300","x-ratelimit-remaining":"290",...headers}});
const year=2026;
const player={id:42,name:"José Ejemplo",firstname:"José",lastname:"Ejemplo",nationality:"Uruguay",birth:{date:"2004-01-02"},height:"180 cm",weight:null,age:22};
const stat=team=>({team:{id:team,name:"Club "+team},league:{id:1,season:year},games:{position:"Defender",minutes:team===7?900:90,appearences:team===7?10:1}});
function provider(url){
 const endpoint=url.pathname;
 if(endpoint==="/status")return response({errors:[],response:{subscription:{plan:"Pro",active:true},requests:{current:100,limit_day:7500}}});
 if(endpoint==="/leagues")return response({errors:[],response:[{league:{id:1,name:"Primera",type:"League"},country:{name:"Uruguay"},seasons:[{year:2025,current:false},{year,current:true,coverage:{players:true}}]},{league:{id:2,name:"Europe"},country:{name:"Spain"},seasons:[{year,current:true}]}]});
 if(endpoint==="/teams")return response({errors:[],response:[{team:{id:7,name:"Club 7"}},{team:{id:8,name:"Club 8"}}]});
 if(endpoint==="/players"){
  const page=Number(url.searchParams.get("page"));return response({errors:[],paging:{current:page,total:2},response:[{player,statistics:[stat(page===1?7:8)]}]});
 }
 if(endpoint==="/players/squads"){const team=Number(url.searchParams.get("team"));return response({errors:[],response:[{team:{id:team},players:[{id:42,name:"J. Ejemplo",position:"Defender",age:22},{id:43,name:"Jugador sin minutos",position:"Midfielder",age:19}]}]});}
 throw new Error("Unexpected URL "+url);
}
async function reset(configured=true){
 tables={};sequence=0;calls=[];allowed=true;user={id:"admin",role:"admin",full_name:"Test"};responder=provider;
 await db.InstitutionProfile.create({active:true,official_name:"Test club"});
 if(configured)await db.FootballApiSettings.create({api_key:"TEST_ONLY_KEY",active:true,base_url:"https://v3.football.api-sports.io"});
}
async function invoke(action,payload={}){clock+=10000;const res=await handler(new Request("https://example.test",{method:"POST",body:JSON.stringify({action,...payload})}));return{status:res.status,data:await res.json()};}
async function drain(){for(let i=0;i<50;i++){const r=await invoke("step");assert.equal(r.status,200,JSON.stringify(r));if(r.data.status==="complete")return;}throw new Error("Queue did not finish");}
assert.equal(model.numeric(null),null);assert.equal(model.numeric(""),null);assert.equal(model.numeric(0),0);assert.equal(model.measured("180 cm"),180);assert.equal(model.measured(undefined),null);
assert.equal(model.selectSeason([{year:2025,current:true},{year:2026,current:false}]).year,2025);
assert.equal(model.normalize("  JOSÉ  Ejemplo "),"jose ejemplo");
await reset(false);let result=await invoke("summary");assert.equal(result.data.configured,false);result=await invoke("discover");assert.equal(result.status,412);assert.equal(calls.length,0);
await reset();allowed=false;assert.equal((await invoke("discover")).status,403);assert.equal(calls.length,0);allowed=true;user=null;assert.equal((await invoke("summary")).status,401);
await reset();assert.equal((await invoke("discover")).status,200);await drain();
assert.equal(tables.ScoutingFeedCompetition.length,1,"Only South American leagues");
assert.equal(tables.ScoutingFeedCompetition[0].status,"completed");
assert.equal(tables.ScoutingFeedPlayer.length,2,"Same player in two teams stays unique; roster-only player retained");
assert.equal(tables.ScoutingFeedPlayer.find(p=>p.provider_id===42).full_name,"José Ejemplo","Roster abbreviation must not overwrite full profile");
const stats=tables.ScoutingFeedEntry.filter(e=>e.source_kind==="season_statistics");
assert.equal(stats.length,2);assert.equal(stats.reduce((n,e)=>n+e.minutes,0),990);
const rosters=tables.ScoutingFeedEntry.filter(e=>e.source_kind==="current_roster");
assert.equal(rosters.length,4);assert(rosters.every(e=>e.season===undefined&&e.minutes===undefined));
const first=tables.ScoutingFeedPlayer.find(p=>p.provider_id===42);
result=await invoke("players",{search:"José",country:"Uruguay",competition_key:"1:2026"});assert.equal(result.data.players.length,1);
assert.equal((await invoke("promote",{player_id:first.id})).status,200);assert.equal((await invoke("promote",{player_id:first.id})).status,200);assert.equal(tables.ScoutingProspect.length,1);
await invoke("discover");await drain();assert.equal(tables.ScoutingFeedPlayer.length,2);assert.equal(tables.ScoutingFeedEntry.length,6);
assert(!JSON.stringify((await invoke("summary")).data).includes("TEST_ONLY_KEY"));
const state=tables.ScoutingFeedState[0];state.lease_token="another-runner";state.lease_until=new Date(clock+100000).toISOString();
const previous=calls.length;assert.equal((await invoke("step")).data.code,"busy");assert.equal(calls.length,previous);state.lease_token="";state.lease_until="";
state.status="running";state.quota.daily_remaining=5;state.quota.observed_at=new Date(clock).toISOString();state.reserve_daily=10;state.next_run_at="";
tables.ScoutingFeedCompetition[0].status="queued";tables.ScoutingFeedCompetition[0].phase="teams";
result=await invoke("step");assert.equal(result.data.code,"daily_quota");assert.equal(state.status,"paused_quota");assert.equal(calls.length,previous);
state.status="running";state.quota.daily_remaining=7400;state.next_run_at="";const job=tables.ScoutingFeedCompetition[0];job.phase="roster";job.is_current=false;job.pending={};job.team_index=0;
const beforeHistorical=calls.length;await invoke("step");assert.equal(calls.length,beforeHistorical,"Historical seasons never fetch current rosters");
responder=()=>response({errors:{requests:"Rate limit reached"},response:[]},200,{"x-ratelimit-requests-remaining":"0"});
await assert.rejects(()=>transport.callFootballApi({api_key:"TEST_ONLY_KEY",base_url:"https://v3.football.api-sports.io"},"/players"),e=>e.code==="quota"&&e.quota.daily_remaining===0);
responder=()=>response({errors:{plan:"Free plan cannot access this season"},response:[]});
await assert.rejects(()=>transport.callFootballApi({api_key:"TEST_ONLY_KEY",base_url:"https://v3.football.api-sports.io"},"/players"),e=>e.code==="plan");
await assert.rejects(()=>transport.callFootballApi({api_key:"TEST_ONLY_KEY",base_url:"https://example.test"},"/status"),/servidor oficial/);
responder=provider;await transport.callFootballApi({api_key:"TEST_ONLY_KEY",base_url:"https://v3.football.api-sports.io"},"/status");
assert.equal(calls.at(-1).options.headers["x-apisports-key"],"TEST_ONLY_KEY");
for(let i=0;i<60;i++)await db.ScoutingFeedPlayer.create({organization_id:tables.InstitutionProfile[0].id,feed_key:"extra"+i,provider_id:1000+i,full_name:"Test "+i,normalized_name:"test "+i});
result=await invoke("players");assert.equal(result.data.players.length,50);assert.equal(result.data.has_more,true);assert.equal((await invoke("players",{page:1})).data.players.length,12);
console.log("PASS: permissions, missing credentials, South America discovery, paginated imports, player identity, roster-only players, historical isolation, restart idempotency, promotion, daily reserve, concurrent lease, HTTP-200 errors, transport host and directory pagination.");
