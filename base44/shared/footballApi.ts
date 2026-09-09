import { classifyProviderError, safeQuota } from "./scoutingFeedModel.ts";
export async function getFootballSettings(base44) {
 const rows=await base44.asServiceRole.entities.FootballApiSettings.list();
 return rows.find(s=>s.active!==false)||null;
}
export async function callFootballApi(settings,endpoint,params={}) {
 const base=String(settings?.base_url||"https://v3.football.api-sports.io").replace(/\/$/,"");
 const rapid=base==="https://api-football-v1.p.rapidapi.com/v3";
 if(base!=="https://v3.football.api-sports.io"&&!rapid)throw Object.assign(new Error("Seleccioná el servidor oficial de API-Football o RapidAPI."),{status:400,code:"configuration"});
 if(!settings?.api_key)throw Object.assign(new Error("Falta la clave de API-Football."),{status:412,code:"missing_key"});
 const url=new URL(base+endpoint);Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")url.searchParams.set(k,String(v));});
 const headers=rapid?{"x-rapidapi-key":settings.api_key,"x-rapidapi-host":"api-football-v1.p.rapidapi.com"}:{"x-apisports-key":settings.api_key};
 const res=await fetch(url.toString(),{headers,signal:AbortSignal.timeout(25000)}),quota=safeQuota(res.headers);
 let json;try{json=await res.json();}catch{throw Object.assign(new Error("API-Football devolvió una respuesta no válida."),{status:502,code:"transient",quota});}
 if(!res.ok||(json?.errors&&Object.keys(json.errors).length)){
  const safe=JSON.stringify(json?.errors||json?.message||("HTTP "+res.status)).split(String(settings.api_key)).join("[oculta]").slice(0,500);
  const code=classifyProviderError(res.status,json?.errors||json?.message);
  throw Object.assign(new Error("API-Football: "+safe),{status:code==="quota"?429:code==="credentials"?412:502,code,quota});
 }
 return{data:json,quota,rateLimitRemaining:quota.daily_remaining};
}
