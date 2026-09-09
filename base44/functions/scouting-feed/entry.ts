import { createClientFromRequest } from "npm:@base44/sdk";
import { requireModulePermission } from "../../shared/modulePermission.ts";
import { getFootballSettings, callFootballApi } from "../../shared/footballApi.ts";
import { SOUTH_AMERICA, nowISO, normalize, numeric, selectCatalog, selectSeason, profilePatch, unique } from "../../shared/scoutingFeedModel.ts";
const STATE="api-football-south-america";
const fail=(message:string,status=400,code="invalid")=>Object.assign(new Error(message),{status,code});
async function all(entity:any,query:any){const rows:any[]=[];for(let skip=0;;skip+=500){const page=await entity.filter(query,"id",500,skip);rows.push(...page);if(page.length<500)return rows;}}
async function one(entity:any,query:any){return(await entity.filter(query,"created_date",1))[0]||null;}
async function upsert(entity:any,org:string,key:string,payload:any){const old=await one(entity,{organization_id:org,feed_key:key});return old?entity.update(old.id,payload):entity.create({...payload,organization_id:org,feed_key:key});}
async function settingsFor(base44:any){const s=await getFootballSettings(base44);if(s?.api_key)return s;const key=typeof Deno!=="undefined"?(Deno.env.get("API_FOOTBALL_KEY")||Deno.env.get("API_FOOTBALL_API_KEY")||Deno.env.get("FOOTBALL_API_KEY")):null;return key?{api_key:key,base_url:"https://v3.football.api-sports.io",active:true}:null;}
async function organization(db:any){const rows=await db.InstitutionProfile.filter({active:true},"created_date",2);if(rows.length!==1)throw fail("Debe existir un único perfil institucional activo.",409);return rows[0].id;}
async function stateFor(db:any,org:string,create=false){const row=await one(db.ScoutingFeedState,{organization_id:org,feed_key:STATE});if(row||!create)return row;return db.ScoutingFeedState.create({organization_id:org,feed_key:STATE,status:"idle",lease_token:"",lease_until:"",catalog_pending:[],catalog_cursor:0,requests_made:0,reserve_daily:10,countries:SOUTH_AMERICA});}
async function claim(db:any,state:any){
 const token=crypto.randomUUID(),now=nowISO();
 await db.ScoutingFeedState.updateMany({id:state.id,$or:[{lease_until:{$lt:now}},{lease_until:{$exists:false}},{lease_token:""}]},{$set:{lease_token:token,lease_until:new Date(Date.now()+120000).toISOString()}});
 const locked=await db.ScoutingFeedState.get(state.id);
 if(locked.lease_token!==token)throw fail("Otra importación está procesando un lote. Esperá unos segundos.",409,"busy");
 return {...locked,token};
}
async function heartbeat(db:any,state:any){const live=await db.ScoutingFeedState.get(state.id);if(live.lease_token!==state.token)throw fail("Se perdió la reserva del proceso. Podés reanudar.",409,"busy");await db.ScoutingFeedState.updateMany({id:state.id,lease_token:state.token},{$set:{lease_until:new Date(Date.now()+120000).toISOString()}});}
async function saveState(db:any,state:any,patch:any){await db.ScoutingFeedState.updateMany({id:state.id,lease_token:state.token},{$set:patch});Object.assign(state,patch);}
async function requestApi(base44:any,db:any,state:any,endpoint:string,params:any={}){
 const settings=await settingsFor(base44);if(!settings)throw fail("API-Football no está configurada en esta aplicación. Guardá la clave en Conectar API.",412,"missing_key");
 if(endpoint!=="/status"&&String(state.quota?.observed_at||"").slice(0,10)!==nowISO().slice(0,10))await checkPlan(base44,db,state);
 const q=state.quota||{},sameDay=String(q.observed_at||"").slice(0,10)===nowISO().slice(0,10);
 if(endpoint!=="/status"){
  if(sameDay&&q.daily_remaining!=null&&q.daily_remaining<=state.reserve_daily)throw fail("Importación pausada: se alcanzó la reserva diaria para otras funciones del club.",429,"daily_quota");
  if(Date.parse(state.next_run_at||"")>Date.now())throw fail("Esperando la recuperación del cupo por minuto.",429,"minute_quota");
 }
 let result:any;try{result=await callFootballApi(settings,endpoint,params);}catch(e:any){if(e.quota)await saveState(db,state,{quota:{...q,...Object.fromEntries(Object.entries(e.quota).filter(([,v])=>v!==null&&v!==undefined))}});if(e.code==="quota"){const daily=/daily request limit|daily limit|requests per day|limit.*day/i.test(e.message)||(e.quota?.daily_remaining!=null&&e.quota.daily_remaining<=state.reserve_daily);e.code=daily?"daily_quota":"minute_quota";if(daily)e.message="API-Football informa que se alcanzó el límite diario. La carga quedó guardada. Cuando el proveedor restablezca el cupo, usá Continuar carga de jugadores.";}throw e;}
 const quota={...(result.quota||{}),daily_limit:result.quota?.daily_limit??q.daily_limit??null,daily_remaining:result.quota?.daily_remaining??(sameDay&&q.daily_remaining!=null?Math.max(0,q.daily_remaining-1):null)},minute=numeric(quota.minute_remaining),limit=numeric(quota.minute_limit);
 const next=new Date(Date.now()+(minute!==null&&minute<=1?65000:Math.max(2500,limit?Math.ceil(120000/limit):4000))).toISOString();
 await saveState(db,state,{quota,requests_made:Number(state.requests_made||0)+1,next_run_at:next});return result.data;
}
async function checkPlan(base44:any,db:any,state:any){
 const data=await requestApi(base44,db,state,"/status"),r=data.response||{},sub=r.subscription||{},req=r.requests||{};
 if(sub.active===false)throw fail("La suscripción de API-Football no está activa.",412,"plan");
 const limit=numeric(req.limit_day)??state.quota?.daily_limit,used=numeric(req.current);
 const quota={...state.quota,daily_limit:limit,daily_remaining:limit!=null&&used!==null?Math.max(0,limit-used):state.quota?.daily_remaining,observed_at:nowISO()};
 if(!limit||quota.daily_remaining==null)throw fail("El proveedor no informó un cupo verificable. Revisá la conexión antes de importar.",412,"quota_unknown");
 await saveState(db,state,{plan:{name:sub.plan||"Sin nombre informado",active:sub.active??null,end:sub.end||null},quota,checked_at:nowISO(),reserve_daily:limit?Math.min(100,Math.max(5,Math.ceil(limit*.1))):10});
}
function publicJob(j:any){const{pending,teams,available_seasons,...out}=j;return{...out,team_count:(teams||[]).length,available_seasons:(available_seasons||[]).map((s:any)=>Number(s.year)),pending_records:Math.max(0,(pending?.rows?.length||0)-(pending?.cursor||0))};}
async function summary(base44:any,db:any,org:string,user:any){
 const[state,jobs,settings]=await Promise.all([stateFor(db,org),all(db.ScoutingFeedCompetition,{organization_id:org}),settingsFor(base44)]);
 return{configured:!!settings?.api_key,can_import:!!await requireModulePermission(base44,user,"scouting","can_admin"),can_configure:user.role==="admin",can_create:!!await requireModulePermission(base44,user,"scouting","can_create"),countries:SOUTH_AMERICA,
 state:state?{status:state.status,plan:state.plan,quota:state.quota,checked_at:state.checked_at,requests_made:state.requests_made,reserve_daily:state.reserve_daily,last_message:state.last_message,last_error:state.last_error,next_run_at:state.next_run_at,catalog_remaining:Math.max(0,(state.catalog_pending||[]).length-(state.catalog_cursor||0)),discovered_at:state.discovered_at}:null,
 competitions:jobs.map(publicJob)};
}
async function storePlayer(db:any,org:string,p:any,job:any,detailed:boolean,team:any){
 const key=String(p.id),old=await one(db.ScoutingFeedPlayer,{organization_id:org,feed_key:key}),patch=profilePatch(p,detailed);
 if(old?.profile_observed_at&&!detailed){delete patch.full_name;delete patch.normalized_name;}
 patch.competition_keys=unique([...(old?.competition_keys||[]),job.feed_key]);patch.countries=unique([...(old?.countries||[]),job.country]);patch.team_names=unique([...(old?.team_names||[]),team?.name]);
 return old?db.ScoutingFeedPlayer.update(old.id,patch):db.ScoutingFeedPlayer.create({...patch,organization_id:org,feed_key:key});
}
async function storeStat(db:any,org:string,row:any,job:any){
 const stats=(row.statistics||[]).filter((s:any)=>Number(s.league?.id)===job.league_id&&Number(s.league?.season)===job.season);
 const p=await storePlayer(db,org,row.player,job,true,stats[0]?.team);
 for(const s of stats){
  const teamId=numeric(s.team?.id);if(teamId===null)continue;
  await upsert(db.ScoutingFeedEntry,org,"stats:"+job.feed_key+":"+teamId+":"+p.provider_id,{player_id:p.id,provider_player_id:p.provider_id,league_id:job.league_id,competition_key:job.feed_key,competition_name:job.name,country:job.country,season:job.season,team_id:teamId,team_name:s.team?.name||"",team_logo:s.team?.logo||"",position:s.games?.position||"",source_kind:"season_statistics",minutes:numeric(s.games?.minutes),appearances:numeric(s.games?.appearences??s.games?.appearances),statistics:s,observed_at:nowISO()});
 }
 if(stats.length)await db.ScoutingFeedPlayer.update(p.id,{position:p.position||stats[0].games?.position||"",team_names:unique([...(p.team_names||[]),...stats.map((x:any)=>x.team?.name)])});
}
async function storeRoster(db:any,org:string,player:any,job:any,team:any,observedAt:string){
 const p=await storePlayer(db,org,player,job,false,team);
 await upsert(db.ScoutingFeedEntry,org,"roster:"+team.id+":"+p.provider_id,{player_id:p.id,provider_player_id:p.provider_id,team_id:team.id,team_name:team.name||"",team_logo:team.logo||"",country:job.country,source_kind:"current_roster",position:player.position||"",observed_at:observedAt,statistics:{shirt_number:player.number??null}});
}
async function storeFeedBatch(db:any,org:string,job:any,pending:any,rows:any[]){
 const detailed=pending.kind==="stats",ids=unique(rows.map((r:any)=>Number(detailed?r.player?.id:r.id)));
 const existing=await db.ScoutingFeedPlayer.filter({organization_id:org,provider_id:{$in:ids}},"id",500);
 const known=new Map(existing.map((p:any)=>[p.provider_id,p])),patches=new Map<number,any>();
 const statistics=(r:any)=>(r.statistics||[]).filter((s:any)=>Number(s.league?.id)===job.league_id&&Number(s.league?.season)===job.season);
 for(const row of rows){
  const player=detailed?row.player:row,old:any=known.get(Number(player.id)),prior=patches.get(Number(player.id)),base={...old,...prior},patch=profilePatch(player,detailed),stats=detailed?statistics(row):[];
  if(base.profile_observed_at&&!detailed){delete patch.full_name;delete patch.normalized_name;}
  if(!patch.position&&stats[0]?.games?.position)patch.position=stats[0].games.position;
  patches.set(Number(player.id),{...prior,...patch,competition_keys:unique([...(base.competition_keys||[]),job.feed_key]),countries:unique([...(base.countries||[]),job.country]),team_names:unique([...(base.team_names||[]),...(detailed?stats.map((s:any)=>s.team?.name):[pending.team?.name])])});
 }
 const create:any[]=[],update:any[]=[];
 for(const [id,p] of patches){const old:any=known.get(id);if(old)update.push({id:old.id,...p});else create.push({...p,organization_id:org,feed_key:String(id)});}
 if(create.length){const created=await db.ScoutingFeedPlayer.bulkCreate(create);for(const p of created)known.set(p.provider_id,p);}
 if(update.length)await db.ScoutingFeedPlayer.bulkUpdate(update);
 const entries=new Map<string,any>();
 for(const row of rows){
  const source=detailed?row.player:row,player:any=known.get(Number(source.id));if(!player)throw fail("No se pudo guardar una ficha del lote.",502);
  if(detailed){for(const s of statistics(row)){
   const teamId=numeric(s.team?.id);if(teamId===null)continue;
   const key="stats:"+job.feed_key+":"+teamId+":"+player.provider_id;
   entries.set(key,{organization_id:org,feed_key:key,player_id:player.id,provider_player_id:player.provider_id,league_id:job.league_id,competition_key:job.feed_key,competition_name:job.name,country:job.country,season:job.season,team_id:teamId,team_name:s.team?.name||"",team_logo:s.team?.logo||"",position:s.games?.position||"",source_kind:"season_statistics",minutes:numeric(s.games?.minutes),appearances:numeric(s.games?.appearences??s.games?.appearances),statistics:s,observed_at:nowISO()});
  }}else{
   const team=pending.team,key="roster:"+team.id+":"+player.provider_id;
   entries.set(key,{organization_id:org,feed_key:key,player_id:player.id,provider_player_id:player.provider_id,team_id:team.id,team_name:team.name||"",team_logo:team.logo||"",country:job.country,source_kind:"current_roster",position:source.position||"",observed_at:pending.observed_at,statistics:{shirt_number:source.number??null}});
  }
 }
 if(entries.size){
  const old=await db.ScoutingFeedEntry.filter({organization_id:org,feed_key:{$in:[...entries.keys()]}},"id",500),byKey=new Map(old.map((e:any)=>[e.feed_key,e])),creates:any[]=[],updates:any[]=[];
  for(const [key,payload] of entries){const prior:any=byKey.get(key);if(prior)updates.push({id:prior.id,...payload});else creates.push(payload);}
  if(creates.length)await db.ScoutingFeedEntry.bulkCreate(creates);
  if(updates.length)await db.ScoutingFeedEntry.bulkUpdate(updates);
 }
}

const addWarning=(job:any,message:string)=>unique([...(job.warnings||[]),message]);
async function processJob(base44:any,db:any,state:any,org:string,job:any){
 const update=async(patch:any)=>{job=await db.ScoutingFeedCompetition.update(job.id,{...patch,updated_at:nowISO()});};
 await saveState(db,state,{last_message:job.country+" · "+job.name+" · "+job.season});
 if(job.pending?.rows){
  const pending=job.pending,rows=pending.rows,start=Number(pending.cursor||0),end=Math.min(rows.length,start+20);
  await heartbeat(db,state);
  await storeFeedBatch(db,org,job,pending,rows.slice(start,end));
  pending.cursor=end;
  await update({pending:{...pending},records_processed:Number(job.records_processed||0)+(pending.kind==="stats"?end-start:0),roster_processed:Number(job.roster_processed||0)+(pending.kind==="roster"?end-start:0)});
  if(pending.cursor>=rows.length){
   if(pending.kind==="stats")await update({pending:{},page:Number(job.page||1)+1,phase:Number(job.page||1)>=Number(job.total_pages||1)?"roster":"statistics"});
   else await update({pending:{},team_index:Number(job.team_index||0)+1});
  }return;
 }
 if(job.phase==="teams"){
  const data=await requestApi(base44,db,state,"/teams",{league:job.league_id,season:job.season});
  if(!Array.isArray(data.response))throw fail("Respuesta de equipos inválida.",502,"provider");
  const teams=data.response.map((r:any)=>r.team).filter((t:any)=>Number.isInteger(t?.id));
  await update({teams,phase:"statistics",status:"running",warnings:teams.length?job.warnings||[]:addWarning(job,"La API no devolvió equipos para esta temporada.")});return;
 }
 if(job.phase==="statistics"){
  const data=await requestApi(base44,db,state,"/players",{league:job.league_id,season:job.season,page:job.page||1});
  if(!Array.isArray(data.response))throw fail("Respuesta de jugadores inválida.",502,"provider");
  const current=Number(data.paging?.current),total=Number(data.paging?.total);
  if(!Number.isInteger(total)||total<0||(data.response.length>0&&total<1)||current!==Number(job.page||1))throw fail("Paginación de jugadores inválida; el cursor se conservó.",502,"provider");
  await update({total_pages:total,pending:data.response.length?{kind:"stats",rows:data.response,cursor:0}:{},phase:data.response.length?"statistics":"roster",warnings:data.response.length?job.warnings||[]:addWarning(job,"Sin estadísticas individuales devueltas por la API.")});return;
 }
 if(job.phase==="roster"){
  // /players/squads does not accept season. Never label today's roster as historical participation.
  if(!job.is_current||Number(job.team_index||0)>=(job.teams||[]).length){
   const hasData=Number(job.records_processed||0)+Number(job.roster_processed||0)>0;
   await update({phase:"done",status:hasData?"completed":"empty",completed_at:nowISO(),warnings:job.is_current?job.warnings||[]:addWarning(job,"Temporada histórica: no se mezcló con el plantel actual.")});return;
  }
  const team=job.teams[job.team_index||0],cache=await one(db.ScoutingFeedSquad,{organization_id:org,feed_key:String(team.id)});
  let players=cache?.players,observed=cache?.observed_at;
  if(!cache||Date.now()-Date.parse(observed)>86400000){
   const data=await requestApi(base44,db,state,"/players/squads",{team:team.id});
   if(!Array.isArray(data.response))throw fail("Respuesta de plantel inválida.",502,"provider");
   players=data.response.find((r:any)=>Number(r.team?.id)===team.id)?.players||[];observed=nowISO();
   await upsert(db.ScoutingFeedSquad,org,String(team.id),{team_id:team.id,team_name:team.name,players,observed_at:observed});
  }
  await update({pending:players.length?{kind:"roster",rows:players,cursor:0,team,observed_at:observed}:{},team_index:players.length?job.team_index||0:Number(job.team_index||0)+1,warnings:players.length?job.warnings||[]:addWarning(job,"Plantel no disponible: "+team.name)});return;
 }
 throw fail("Fase de importación inválida.",409);
}
async function step(base44:any,db:any,state:any,org:string){
 const pending=state.catalog_pending||[],cursor=Number(state.catalog_cursor||0);
 if(cursor<pending.length){
  const end=Math.min(cursor+10,pending.length);
  for(let i=cursor;i<end;i++){
   await heartbeat(db,state);const row=pending[i],old=await one(db.ScoutingFeedCompetition,{organization_id:org,feed_key:row.feed_key});
   if(old)await db.ScoutingFeedCompetition.update(old.id,{...row,updated_at:nowISO()});
   else await db.ScoutingFeedCompetition.create({...row,organization_id:org,status:"queued",phase:"teams",teams:[],team_index:0,page:1,pending:{},records_processed:0,roster_processed:0,warnings:[],updated_at:nowISO()});
   await saveState(db,state,{catalog_cursor:i+1,last_message:"Registrando ligas de Sudamérica ("+(i+1)+"/"+pending.length+")"});
  }
  if(end===pending.length)await saveState(db,state,{catalog_pending:[],catalog_cursor:0});
  return;
 }
 const job=await one(db.ScoutingFeedCompetition,{organization_id:org,status:{$in:["queued","running"]}});
 if(!job){await saveState(db,state,{status:"complete",last_message:"Recorrido finalizado. Revisá las ligas sin datos o con incidencias."});return;}
 try{await processJob(base44,db,state,org,job);}catch(e:any){
  if(["minute_quota","daily_quota","credentials","missing_key","busy"].includes(e.code))throw e;
  if(e.code==="plan"&&job.phase==="statistics"){await db.ScoutingFeedCompetition.update(job.id,{phase:"roster",pending:{},warnings:addWarning(job,"Estadísticas restringidas por el plan: "+e.message),updated_at:nowISO()});return;}
  if(e.code==="plan"&&job.phase==="roster"){await db.ScoutingFeedCompetition.update(job.id,{team_index:Number(job.team_index||0)+1,warnings:addWarning(job,"Plantel restringido: "+(job.teams?.[job.team_index||0]?.name||"equipo")),updated_at:nowISO()});return;}
  await db.ScoutingFeedCompetition.update(job.id,{status:e.code==="plan"?"restricted":"error",error:e.message,updated_at:nowISO()});
  await saveState(db,state,{last_error:job.name+": "+e.message});
 }
}
async function promote(db:any,org:string,id:string,user:any){
 const p=await db.ScoutingFeedPlayer.get(id);if(p.organization_id!==org)throw fail("Jugador no encontrado.",404);
 if(p.prospect_id){const old=await db.ScoutingProspect.get(p.prospect_id);if(old?.organization_id===org)return{prospect:old};}
 const old=await one(db.ScoutingProspect,{organization_id:org,"external_ids.api_football":{$in:[String(p.provider_id),p.provider_id]}});
 if(old){await db.ScoutingFeedPlayer.update(p.id,{prospect_id:old.id});return{prospect:old};}
 const key="api-football:"+p.provider_id,existing=await one(db.ScoutingProspect,{organization_id:org,prospect_key:key});
 if(existing){await db.ScoutingFeedPlayer.update(p.id,{prospect_id:existing.id});return{prospect:existing};}
 const prospect=await db.ScoutingProspect.create({organization_id:org,prospect_key:key,full_name:p.full_name,normalized_name:p.normalized_name,first_name:p.first_name||"",last_name:p.last_name||"",...(p.birth_date?{birth_date:p.birth_date}:{}),nationality:p.nationality||"",position:p.position||"",photo_url:p.photo_url||"",dominant_leg:"unknown",source_type:"provider",source_name:"API-Football",external_ids:{api_football:String(p.provider_id)},pipeline_stage:"discovered",status:"active",availability_status:"unknown",ownership_status:"unknown",created_by_name:user.full_name||user.email,created_at:nowISO(),updated_at:nowISO()});
 await db.ScoutingFeedPlayer.update(p.id,{prospect_id:prospect.id});return{prospect};
}
export default async function(req:Request){
 let db:any,state:any;
 try{
  const base44=createClientFromRequest(req),user=await base44.auth.me();if(!user)return Response.json({error:"Iniciá sesión."},{status:401});
  const body=await req.json().catch(()=>({})),action=String(body.action||"summary"),read=["summary","players","detail"].includes(action),permission=read?"can_view":action==="promote"?"can_create":"can_admin";
  if(!["summary","players","detail","promote","check","discover","resume","pause","step","retry","queue_season"].includes(action))throw fail("Acción inválida.");
  if(!await requireModulePermission(base44,user,"scouting",permission))throw fail("No tenés permiso para esta acción de scouting.",403);
  db=base44.asServiceRole.entities;const org=await organization(db);
  if(action==="summary")return Response.json(await summary(base44,db,org,user));
  if(action==="players"){
   const query:any={organization_id:org},search=normalize(body.search).slice(0,100);
   if(search)query.normalized_name={$regex:search.replace(/[.*+?^{}$()|[\]\\]/g,"\\$&")};
   if(body.country&&SOUTH_AMERICA.includes(body.country))query.countries={$in:body.country==="French-Guiana"?["French-Guiana","French Guiana"]:[body.country]};
   if(body.competition_key)query.competition_keys={$in:[String(body.competition_key).slice(0,80)]};
   if(body.position)query.position=String(body.position).slice(0,80);
   if(body.nationality)query.nationality=String(body.nationality).slice(0,100);
   const page=Math.max(0,Math.floor(numeric(body.page)||0)),rows=await db.ScoutingFeedPlayer.filter(query,"normalized_name",51,page*50);
   return Response.json({players:rows.slice(0,50),has_more:rows.length>50,page});
  }
  if(action==="detail"){const p=await db.ScoutingFeedPlayer.get(String(body.player_id));if(p.organization_id!==org)throw fail("Jugador no encontrado.",404);return Response.json({player:p,entries:await all(db.ScoutingFeedEntry,{organization_id:org,provider_player_id:p.provider_id})});}
  state=await claim(db,await stateFor(db,org,true));
  if(action==="pause"){await saveState(db,state,{status:"paused",last_message:"Importación pausada por el usuario."});return Response.json({status:"paused"});}
  if(action==="check"){await checkPlan(base44,db,state);return Response.json({plan:state.plan,quota:state.quota});}
  if(action==="promote")return Response.json(await promote(db,org,String(body.player_id),user));
  if(action==="discover"){
   if((state.catalog_pending||[]).length)throw fail("Terminá de registrar el catálogo pendiente con Reanudar.",409);
   await checkPlan(base44,db,state);await saveState(db,state,{status:"running",last_error:"",last_message:"Plan comprobado. Descubriendo competencias.",discover_requested:true});return Response.json({status:"running",plan:state.plan});
  }
  if(action==="resume"){if(!(Date.parse(state.next_run_at||"")>Date.now())&&(!state.checked_at||Date.now()-Date.parse(state.checked_at)>900000))await checkPlan(base44,db,state);await saveState(db,state,{status:"running",last_error:""});return Response.json({status:"running"});}
  if(action==="retry"){const job=await db.ScoutingFeedCompetition.get(String(body.competition_id));if(job.organization_id!==org)throw fail("Liga no encontrada.",404);if(!["error","restricted"].includes(job.status))throw fail("Esta liga no tiene un error pendiente.");await db.ScoutingFeedCompetition.update(job.id,{status:"queued",error:"",updated_at:nowISO()});await saveState(db,state,{status:"running",last_error:""});return Response.json({status:"running"});}
  if(action==="queue_season"){
   const source=await db.ScoutingFeedCompetition.get(String(body.competition_id));if(source.organization_id!==org)throw fail("Liga no encontrada.",404);
   const selected=selectSeason(source.available_seasons||[],Number(body.season));if(!selected)throw fail("Temporada no ofrecida por la API.");
   const key=source.league_id+":"+selected.year,existing=await one(db.ScoutingFeedCompetition,{organization_id:org,feed_key:key});if(existing)return Response.json({competition:publicJob(existing)});
   const created=await db.ScoutingFeedCompetition.create({organization_id:org,feed_key:key,league_id:source.league_id,name:source.name,country:source.country,logo:source.logo,type:source.type,season:Number(selected.year),is_current:selected.current===true,start_date:selected.start,end_date:selected.end,available_seasons:source.available_seasons,coverage:selected.coverage||{},status:"queued",phase:"teams",teams:[],team_index:0,page:1,pending:{},records_processed:0,roster_processed:0,warnings:[]});return Response.json({competition:publicJob(created)});
  }
  if(state.status!=="running")return Response.json({status:state.status,message:state.last_message});
  if(Date.parse(state.next_run_at||"")>Date.now())return Response.json({status:"running",next_run_at:state.next_run_at,message:state.last_message});
  if(state.discover_requested){const data=await requestApi(base44,db,state,"/leagues");if(!Array.isArray(data.response))throw fail("Catálogo de ligas inválido.",502);const catalog=selectCatalog(data.response);await saveState(db,state,{discover_requested:false,catalog_pending:catalog,catalog_cursor:0,discovered_at:nowISO(),last_message:catalog.length+" ligas/temporadas encontradas en Sudamérica."});}
  else await step(base44,db,state,org);
  return Response.json({status:state.status,message:state.last_message,next_run_at:state.next_run_at});
 }catch(e:any){
  const code=e.code||"internal";
  if(db&&state?.token&&code!=="busy"){
   const paused=code==="daily_quota"?"paused_quota":code==="minute_quota"?"running":"error",next=code==="minute_quota"?new Date(Date.now()+65000).toISOString():state.next_run_at;
   await saveState(db,state,{status:paused,last_error:e.message,last_message:e.message,next_run_at:next}).catch(()=>{});
   if(code==="minute_quota")return Response.json({status:"running",message:e.message,next_run_at:next});
  }return Response.json({error:e.message||"Error de importación.",code},{status:e.status||500});
 }finally{if(db&&state?.token)await db.ScoutingFeedState.updateMany({id:state.id,lease_token:state.token},{$set:{lease_token:"",lease_until:""}}).catch(()=>{});}
}
