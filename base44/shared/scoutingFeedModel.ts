// Pure normalization and coverage rules shared with the importer's tests.
export const SOUTH_AMERICA = ["Argentina","Bolivia","Brazil","Chile","Colombia","Ecuador","Paraguay","Peru","Uruguay","Venezuela","Guyana","Suriname","French-Guiana","French Guiana"];
export const nowISO = () => new Date().toISOString();
export const normalize = (v: any) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
export function numeric(v: any) { if(v === null || v === undefined || v === "") return null; const n=Number(v); return Number.isFinite(n)?n:null; }
export function measured(v: any) { if(typeof v === "number")return numeric(v); const m=String(v??"").match(/^(\d+(?:\.\d+)?)\s*(?:cm|kg)?$/i); return m?Number(m[1]):null; }
export const unique = (values: any[]) => [...new Set(values.filter(v=>v!==null&&v!==undefined&&v!==""))];
export function selectSeason(seasons: any[], requested?: number) {
  const rows=seasons.filter(s=>Number.isInteger(Number(s.year)));
  if(requested)return rows.find(s=>Number(s.year)===requested)||null;
  return [...rows].filter(s=>Number(s.year)<=new Date().getUTCFullYear()).sort((a,b)=>Number(b.current===true)-Number(a.current===true)||b.year-a.year)[0]||null;
}
export function selectCatalog(rows: any[]) {
 return rows.filter(r=>SOUTH_AMERICA.includes(r.country?.name)).map(r=>{
  const season=selectSeason(r.seasons||[]); if(!season)return null;
  return {feed_key:`${r.league.id}:${season.year}`,league_id:r.league.id,name:r.league.name,country:r.country.name,logo:r.league.logo||"",type:r.league.type||"",season:Number(season.year),is_current:season.current===true,start_date:season.start||"",end_date:season.end||"",available_seasons:r.seasons||[],coverage:season.coverage||{}};
 }).filter(Boolean).sort((a:any,b:any)=>a.country.localeCompare(b.country)||a.name.localeCompare(b.name));
}
export function profilePatch(player: any, detailed: boolean) {
 if(!Number.isInteger(Number(player?.id))||Number(player.id)<=0||!String(player.name||"").trim())throw new Error("Jugador de API-Football sin ID o nombre");
 const out:any={provider_id:Number(player.id),full_name:String(player.name).trim(),normalized_name:normalize(player.name),observed_at:nowISO()};
 for(const [field,value] of Object.entries({photo_url:player.photo,position:player.position,reported_age:numeric(player.age)}))if(value!==null&&value!==undefined&&value!=="")out[field]=value;
 if(player.age!=null)out.age_observed_at=nowISO();
 if(detailed){out.profile_observed_at=nowISO();for(const [field,value] of Object.entries({first_name:player.firstname,last_name:player.lastname,birth_date:player.birth?.date,nationality:player.nationality,height_cm:measured(player.height),weight_kg:measured(player.weight)}))if(value!==null&&value!==undefined&&value!=="")out[field]=value;}
 return out;
}
export function classifyProviderError(status: number, errors: any) {
 const text=JSON.stringify(errors||{}).toLowerCase();
 if(status===401||status===403||/token|api.?key|authentication/.test(text))return "credentials";
 if(status===429||/rate.?limit|too many|requests limit/.test(text))return "quota";
 if(/plan|subscription|season.*access|access.*season/.test(text))return "plan";
 return status>=500?"transient":"provider";
}
export function safeQuota(headers: Headers) {
 const read=(key:string)=>numeric(headers.get(key));
 return {daily_limit:read("x-ratelimit-requests-limit"),daily_remaining:read("x-ratelimit-requests-remaining"),minute_limit:read("x-ratelimit-limit"),minute_remaining:read("x-ratelimit-remaining"),observed_at:nowISO()};
}
