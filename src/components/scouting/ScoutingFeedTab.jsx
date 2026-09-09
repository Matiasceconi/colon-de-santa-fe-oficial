import React, { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Database, Globe2, Search, RefreshCw, Play, Pause, Loader2, KeyRound, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
const control="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 disabled:opacity-40";
const labels={queued:"Pendiente",running:"En curso",completed:"Recorrido completo",empty:"Sin jugadores",restricted:"Restricción del plan",error:"Revisar",paused:"Pausada",paused_quota:"Reserva diaria alcanzada",complete:"Recorrido finalizado",idle:"Sin iniciar"};
const positions={Goalkeeper:"Arquero",Defender:"Defensor",Midfielder:"Mediocampista",Attacker:"Delantero"};
const countries={Argentina:"Argentina",Bolivia:"Bolivia",Brazil:"Brasil",Chile:"Chile",Colombia:"Colombia",Ecuador:"Ecuador",Paraguay:"Paraguay",Peru:"Perú",Uruguay:"Uruguay",Venezuela:"Venezuela",Guyana:"Guyana",Suriname:"Surinam","French-Guiana":"Guayana Francesa","French Guiana":"Guayana Francesa"};
const date=v=>v?new Date(v).toLocaleString("es-AR"):"Sin fecha";
async function api(action,payload={}){
 try{const r=await base44.functions.invoke("scouting-feed",{action,...payload});const data=r.data;if(data?.error)throw Object.assign(new Error(data.error),{code:data.code});return data;}
 catch(e){throw Object.assign(new Error(e?.response?.data?.error||e.message||"No se pudo completar la operación."),{code:e?.response?.data?.code||e.code});}
}
function age(p){if(!p.birth_date)return p.reported_age!=null?p.reported_age+"*":"—";const b=new Date(p.birth_date+"T12:00:00"),t=new Date();let a=t.getFullYear()-b.getFullYear();if(t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate()))a--;return Number.isFinite(a)?a:"—";}
export default function ScoutingFeedTab({onSelectProspect,onChanged}){
 const [summary,setSummary]=useState(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[loading,setLoading]=useState(true);
 const [view,setView]=useState("players"),[search,setSearch]=useState(""),[country,setCountry]=useState(""),[competition,setCompetition]=useState(""),[position,setPosition]=useState(""),[page,setPage]=useState(0),[directory,setDirectory]=useState({players:[],has_more:false}),[refresh,setRefresh]=useState(0),[detail,setDetail]=useState(null);
 const [connect,setConnect]=useState(false),[key,setKey]=useState(""),[server,setServer]=useState("https://v3.football.api-sports.io");
 const generation=useRef(0),worker=useRef(false);
 const load=useCallback(async()=>{const s=await api("summary");setSummary(s);return s;},[]);
 useEffect(()=>{let alive=true;load().then(s=>{if(alive&&s.can_import&&s.configured&&s.state?.status==="running")setRunning(true);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[load]);
 useEffect(()=>{
  const current=++generation.current;let alive=true;setLoading(true);
  const timer=setTimeout(async()=>{try{const d=await api("players",{search,country,competition_key:competition,position,page});if(alive&&current===generation.current)setDirectory(d);}catch(e){if(alive)setError(e.message);}finally{if(alive&&current===generation.current)setLoading(false);}},250);
  return()=>{alive=false;clearTimeout(timer);};
 },[search,country,competition,position,page,refresh]);
 useEffect(()=>{
  if(!running)return;let cancelled=false,timer,round=0;
  async function tick(){
   if(cancelled)return;
   if(worker.current){timer=setTimeout(tick,1500);return;}
   worker.current=true;
   try{
    const result=await api("step");if(cancelled)return;
    setNotice(result.message||"Procesando el siguiente lote.");
    if(++round%3===0||result.status!=="running"){await load();setRefresh(n=>n+1);}
    if(result.status!=="running"){setRunning(false);return;}
    const wait=Math.max(1000,Math.min(65000,Date.parse(result.next_run_at||"")-Date.now()||1000));
    timer=setTimeout(tick,wait);
   }catch(e){
    if(cancelled)return;
    if(e.code==="busy"){timer=setTimeout(tick,3000);return;}
    setError(e.message);setRunning(false);await load().catch(()=>{});
   }finally{worker.current=false;}
  }
  tick();return()=>{cancelled=true;clearTimeout(timer);};
 },[running,load]);
 async function action(name,payload={},start=false){
  setBusy(true);setError("");try{const r=await api(name,payload);await load();setRefresh(n=>n+1);if(start)setRunning(true);return r;}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function saveKey(e){
  e.preventDefault();setBusy(true);setError("");
  try{await base44.functions.invoke("footballApi",{action:"saveSettings",api_key:key.trim(),base_url:server});setKey("");await api("check");await load();setConnect(false);setNotice("Conexión comprobada. Podés descubrir e importar las ligas.");}
  catch(e){setError(e?.response?.data?.error||e.message);}finally{setBusy(false);}
 }
 async function openPlayer(p){setBusy(true);setError("");try{setDetail(await api("detail",{player_id:p.id}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function addProspect(){
  const r=await action("promote",{player_id:detail.player.id});if(r?.prospect){setDetail(null);onChanged?.();onSelectProspect?.(r.prospect.id);}
 }
 const jobs=summary?.competitions||[],filteredJobs=jobs.filter(j=>!country||j.country===country),state=summary?.state,q=state?.quota||{},finished=jobs.filter(j=>["completed","empty","restricted","error"].includes(j.status)).length;
 const change=(setter,value)=>{setter(value);setPage(0);};
 return <section className="space-y-4">
  <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5 sm:p-6">
   <div className="flex flex-wrap justify-between gap-4">
    <div><div className="flex items-center gap-2 text-amber-300 text-xs font-semibold uppercase tracking-widest"><Globe2 size={15}/> Catálogo de jugadores</div><h2 className="text-xl sm:text-2xl font-bold text-white mt-2">Base sudamericana</h2><p className="text-sm text-zinc-400 mt-2 max-w-2xl">Explorá los jugadores disponibles por país, competencia y temporada. Elegí después a quién incorporar al seguimiento del club.</p></div>
    <div className="flex flex-wrap items-start gap-2">
     {summary?.can_configure&&<button className={control} disabled={running||busy} onClick={()=>setConnect(!connect)}><KeyRound size={14} className="inline mr-2"/>{summary.configured?"Conexión":"Conectar API"}</button>}
     {summary?.can_import&&summary.configured&&<>
      <button className={control} disabled={busy||running} onClick={()=>action("check")}><RefreshCw size={14} className="inline mr-2"/>Verificar plan</button>
      {running?<button className={control} onClick={()=>{setRunning(false);setNotice("Pausada en esta pestaña. El lote en curso termina y queda guardado.");}}><Pause size={14} className="inline mr-2"/>Pausar aquí</button>:<button className={control+" bg-white !text-zinc-950 font-semibold"} disabled={busy} onClick={()=>action(jobs.length||state?.catalog_remaining||state?.discovered_at?"resume":"discover",{},true)}><Play size={14} className="inline mr-2"/>{jobs.length||state?.discovered_at?"Continuar carga de jugadores":"Cargar jugadores de Sudamérica"}</button>}
     </>}
    </div>
   </div>
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
    <Metric label="Ligas / temporadas" value={jobs.length}/><Metric label="Recorridas" value={finished+" / "+jobs.length}/>
    <Metric label="Plan comprobado" value={state?.plan?.name||"Pendiente"}/><Metric label="Consultas disponibles hoy" value={q.daily_remaining??"Sin verificar"}/>
   </div>
   <p className="text-xs text-zinc-500 mt-3">La importación avanza mientras esta pestaña está abierta. Si la cerrás, la carga pendiente se retoma automáticamente al volver a abrir esta sección. Reserva diaria: {state?.reserve_daily??"según plan"} consultas.</p>
  </div>
  {!summary?.configured&&summary&&<div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-4 text-sm text-amber-200 flex gap-3"><KeyRound size={20} className="shrink-0"/><div><strong>Falta conectar API-Football en esta aplicación.</strong><p className="mt-1">Todavía no se descargaron jugadores. {summary.can_configure?"Usá Conectar API para guardar tu clave y comprobar el plan.":"Un administrador debe configurar la conexión."}</p></div></div>}
  {connect&&summary?.can_configure&&<form onSubmit={saveKey} className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 space-y-3"><h3 className="text-white font-semibold">Conexión de API-Football</h3><p className="text-xs text-zinc-400">Usá la clave del plan que ya contrataste. Se envía al servidor y no se muestra en el catálogo.</p><div className="flex flex-wrap gap-2"><select aria-label="Proveedor de la suscripción" className={control} value={server} onChange={e=>setServer(e.target.value)}><option value="https://v3.football.api-sports.io">API-Sports / API-Football directo</option><option value="https://api-football-v1.p.rapidapi.com/v3">Suscripción por RapidAPI</option></select><input aria-label="Clave de API-Football" className={control+" flex-1 min-w-48"} type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Clave API" required/><button className={control} disabled={busy||!key.trim()}>Guardar y comprobar</button></div></form>}
  {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
  {(notice||state?.last_message)&&<div role="status" className="flex items-center gap-2 text-sm text-zinc-300">{running?<Loader2 size={16} className="animate-spin"/>:<CheckCircle2 size={16}/>}<span>{notice||state.last_message}</span><span className="text-xs text-zinc-500">{running?"En esta pestaña":state?.status==="running"?"Listo para reanudar":labels[state?.status]||""}</span></div>}
  <div className="flex justify-between flex-wrap gap-3"><div className="flex rounded-lg border border-zinc-800 p-1">{[["players","Jugadores"],["coverage","Ligas y copas ("+jobs.length+")"]].map(([v,label])=><button key={v} className={"px-4 py-2 rounded text-sm "+(view===v?"bg-zinc-800 text-white":"text-zinc-400")} onClick={()=>setView(v)}>{label}</button>)}</div><button className={control} disabled={busy} onClick={()=>{load().catch(e=>setError(e.message));setRefresh(n=>n+1);}}>Actualizar vista</button></div>
  <div className="flex gap-2 flex-wrap">
   <select aria-label="País de competencia" className={control} value={country} onChange={e=>{change(setCountry,e.target.value);setCompetition("");}}><option value="">Todos los países de competencia</option>{Object.entries(countries).filter(([k])=>k!=="French Guiana").map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   {view==="players"&&<>
    <select aria-label="Competencia y temporada" className={control+" max-w-full sm:max-w-80"} value={competition} onChange={e=>change(setCompetition,e.target.value)}><option value="">Todas las ligas / temporadas</option>{filteredJobs.map(j=><option key={j.id} value={j.feed_key}>{j.name} · {j.season}</option>)}</select>
    <select aria-label="Posición general" className={control} value={position} onChange={e=>change(setPosition,e.target.value)}><option value="">Todas las posiciones</option>{Object.entries(positions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
    <label className="relative flex-1 min-w-48"><Search size={14} className="absolute left-3 top-3 text-zinc-500"/><input aria-label="Buscar jugador" className={control+" pl-9 w-full"} placeholder="Buscar jugador..." value={search} onChange={e=>change(setSearch,e.target.value)}/></label>
   </>}
  </div>
  {view==="players"?<>
   <p className="text-xs text-zinc-500">País de competencia y nacionalidad son datos distintos. Las posiciones son las informadas por el proveedor; “defensor” no confirma lateralidad. Los clubes listados son asociaciones registradas, no una confirmación de contrato vigente.</p>
   <div className="rounded-xl border border-zinc-800 overflow-x-auto"><table className="w-full text-sm min-w-[760px]"><thead className="bg-zinc-950 text-zinc-400 text-xs"><tr>{["Jugador","Posición","Nacionalidad","Edad","Clubes registrados","Última captura"].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody className="bg-zinc-900/50">{directory.players.map(p=><tr key={p.id} className="border-t border-zinc-800"><td className="p-3"><button className="flex items-center gap-3 text-left text-white hover:underline" disabled={busy} onClick={()=>openPlayer(p)}><Avatar player={p}/><span>{p.full_name}{p.prospect_id&&<span className="block text-xs text-amber-300">En seguimiento</span>}</span></button></td><td className="p-3 text-zinc-300">{positions[p.position]||p.position||"Sin dato"}</td><td className="p-3 text-zinc-300">{p.nationality||"Sin dato"}</td><td className="p-3 text-zinc-300">{age(p)}</td><td className="p-3 text-zinc-400 max-w-64">{(p.team_names||[]).join(" · ")||"Sin dato"}</td><td className="p-3 text-zinc-500 text-xs">{date(p.observed_at)}</td></tr>)}{!directory.players.length&&<tr><td colSpan={6} className="p-12 text-center text-zinc-400"><Database className="mx-auto mb-3 text-zinc-600" size={30}/>{loading?"Consultando catálogo...":jobs.length?(running?"Cargando jugadores. Los primeros resultados aparecerán aquí automáticamente.":finished===0&&!search&&!country&&!competition&&!position?"Las ligas ya están listas. Usá Continuar carga de jugadores para descargar los planteles.":"No hay jugadores importados que coincidan con estos filtros."):"El catálogo todavía está vacío. Conectá la API e iniciá la importación."}</td></tr>}</tbody></table></div>
   <div className="flex justify-between items-center text-xs text-zinc-400"><span>{loading?"Actualizando...":"Página "+(page+1)+" · "+directory.players.length+" jugadores"} · * Edad informada por el proveedor</span><div className="flex gap-2"><button aria-label="Página anterior" className={control} disabled={!page||loading} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/></button><button aria-label="Página siguiente" className={control} disabled={!directory.has_more||loading} onClick={()=>setPage(p=>p+1)}><ChevronRight size={16}/></button></div></div>
  </>:<div className="space-y-3">
   <div className="flex justify-between gap-3 flex-wrap text-xs text-zinc-400"><p>Se propone la temporada actual o la última publicada de cada competencia. Podés agregar otra temporada si tu plan permite consultarla.</p>{summary?.can_import&&summary.configured&&<button disabled={running||busy} className={control} onClick={()=>action("discover",{},true)}>Redescubrir ligas</button>}</div>
   {filteredJobs.map(j=><LeagueRow key={j.id} job={j} disabled={busy||running} canImport={summary?.can_import} onRetry={()=>action("retry",{competition_id:j.id},true)} onSeason={season=>action("queue_season",{competition_id:j.id,season})}/>)}
   {!filteredJobs.length&&<p className="p-8 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-500">Las competencias aparecerán después de consultar tu API.</p>}
  </div>}
  <Dialog open={!!detail} onOpenChange={v=>{if(!v)setDetail(null);}}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-white"><DialogHeader><DialogTitle>{detail?.player?.full_name||"Jugador"}</DialogTitle><DialogDescription>Ficha del proveedor y registros separados por competencia. Los datos faltantes se conservan como “sin dato”.</DialogDescription></DialogHeader>{detail&&<>
   <div className="flex items-center gap-4"><Avatar player={detail.player}/><div><p>{detail.player.nationality||"Nacionalidad sin dato"} · {positions[detail.player.position]||detail.player.position||"Posición sin dato"}</p><p className="text-xs text-zinc-500">API-Football #{detail.player.provider_id} · Captura: {date(detail.player.observed_at)}</p></div></div>
   <div className="grid grid-cols-3 gap-2"><Metric label="Nacimiento" value={detail.player.birth_date||"Sin dato"}/><Metric label="Altura" value={detail.player.height_cm!=null?detail.player.height_cm+" cm":"Sin dato"}/><Metric label="Peso informado" value={detail.player.weight_kg!=null?detail.player.weight_kg+" kg":"Sin dato"}/></div>
   <div className="overflow-x-auto"><table className="w-full text-xs min-w-[650px]"><thead className="text-zinc-500"><tr>{["Club","Contexto","Temporada","Minutos","Partidos","Captura"].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{detail.entries.map(e=><tr key={e.id} className="border-t border-zinc-800"><td className="p-2">{e.team_name}</td><td className="p-2">{e.source_kind==="current_roster"?"Plantel actual informado":e.competition_name}</td><td className="p-2">{e.source_kind==="current_roster"?"No aplica":e.season}</td><td className="p-2">{e.minutes??"Sin dato"}</td><td className="p-2">{e.appearances??"Sin dato"}</td><td className="p-2 text-zinc-500">{date(e.observed_at)}</td></tr>)}</tbody></table></div>
   {summary?.can_create&&<button disabled={busy||running} className={control} onClick={addProspect}><UserPlus size={15} className="inline mr-2"/>{detail.player.prospect_id?"Abrir seguimiento":"Incorporar a prospectos"}</button>}
  </>}</DialogContent></Dialog>
 </section>;
}
function Metric({label,value}){return <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3"><p className="text-[11px] text-zinc-500">{label}</p><p className="font-semibold text-zinc-100 mt-1 truncate">{value}</p></div>;}
function Avatar({player}){const[broken,setBroken]=useState(false);return player.photo_url&&!broken?<img src={player.photo_url} onError={()=>setBroken(true)} alt="" className="w-10 h-10 rounded-full object-cover bg-zinc-800" loading="lazy" referrerPolicy="no-referrer"/>:<span className="w-10 h-10 shrink-0 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">{(player.full_name||"?").slice(0,2).toUpperCase()}</span>;}
function LeagueRow({job:j,canImport,disabled,onRetry,onSeason}){
 const[season,setSeason]=useState(String(j.season)),issues=j.error||(j.warnings||[]).length>0;
 return <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold text-white">{j.name} <span className="font-normal text-zinc-500">· {j.season}</span></h3><p className="text-xs text-zinc-500 mt-1">{countries[j.country]||j.country} · {j.type==="Cup"?"Copa":"Liga"} · {j.is_current?"Temporada actual":"Temporada histórica"}</p></div><span className={"text-xs rounded-full border px-3 py-1 h-fit "+(issues?"text-amber-300 border-amber-500/30":"text-zinc-300 border-zinc-700")}>{labels[j.status]||j.status}{issues?" · con observaciones":""}</span></div><div className="flex gap-5 text-xs text-zinc-400 mt-3 flex-wrap"><span>{j.team_count} equipos</span><span>{j.records_processed||0} registros de temporada</span><span>{j.roster_processed||0} registros de plantel</span>{j.total_pages>0&&<span>Páginas procesadas: {Math.min((j.page||1)-1,j.total_pages)} / {j.total_pages}</span>}</div><details className="mt-3 text-xs text-zinc-400"><summary className="cursor-pointer">Cobertura, observaciones y temporadas</summary><div className="mt-3 space-y-2"><p>Jugadores según catálogo del proveedor: {j.coverage?.players===true?"Sí":j.coverage?.players===false?"No anunciados":"Sin información"}. La importación comprueba la respuesta real.</p>{j.error&&<p className="text-red-300">{j.error}</p>}{(j.warnings||[]).map(w=><p key={w} className="text-amber-200"><AlertTriangle size={12} className="inline mr-1"/>{w}</p>)}{canImport&&<div className="flex gap-2 flex-wrap">{["error","restricted"].includes(j.status)&&<button className={control} disabled={disabled} onClick={onRetry}>Reintentar liga</button>}<select aria-label={"Temporada de "+j.name} className={control} value={season} onChange={e=>setSeason(e.target.value)}>{(j.available_seasons||[j.season]).slice().sort((a,b)=>b-a).map(y=><option key={y} value={y}>{y}</option>)}</select><button className={control} disabled={disabled||Number(season)===j.season} onClick={()=>onSeason(Number(season))}>Agregar temporada</button></div>}</div></details></div>;
}
