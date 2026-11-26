import {roles,instructions,number,day,transition} from '../../lib/logic.mjs';
const E=process.env;
const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const text=(v,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Invalid text');return v.trim()};
const headers=()=>({apikey:E.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${E.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'});
async function db(path,method='GET',body){const r=await fetch(`${E.SUPABASE_URL}/rest/v1/${path}`,{method,headers:headers(),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Database request failed');return r.status===204?null:r.json()}
async function owner(req){const token=req.headers.get('authorization');if(!token?.startsWith('Bearer '))return false;const r=await fetch(`${E.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:E.SUPABASE_ANON_KEY,Authorization:token},signal:AbortSignal.timeout(8000)});if(!r.ok)return false;return (await r.json()).email?.toLowerCase()===E.OWNER_EMAIL.toLowerCase()}
async function signIn(b){if(typeof b.email!=='string'||b.email.toLowerCase()!==E.OWNER_EMAIL.toLowerCase())return respond({error:'Sign-in failed'},401);const r=await fetch(`${E.SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:E.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:b.email,password:b.password}),signal:AbortSignal.timeout(8000)});if(!r.ok)return respond({error:'Sign-in failed'},401);const d=await r.json();return respond({token:d.access_token})}
export default async function(req){try{
 if(!E.SUPABASE_URL||!E.SUPABASE_ANON_KEY||!E.SUPABASE_SERVICE_ROLE_KEY||!E.OWNER_EMAIL)return respond({error:'Server configuration missing'},503);
 if(!['GET','POST'].includes(req.method))return respond({error:'Method not allowed'},405);
 let b={};if(req.method==='POST'){const raw=await req.text();if(raw.length>25000)return respond({error:'Request too large'},413);b=JSON.parse(raw)}
 if(b.action==='login')return signIn(b);
 if(!await owner(req))return respond({error:'Unauthorized'},401);
 if(req.method==='GET'){const [jobs,ledger,metrics]=await Promise.all([db('af_os_jobs?order=created_at.desc&limit=200'),db('af_os_ledger?order=day.desc&limit=1000'),db('af_os_metrics?order=day.desc&limit=1000')]);return respond({jobs,ledger,metrics,aiReady:!!(E.OPENAI_API_KEY&&E.OPENAI_MODEL),dailyLimit:Number(E.AI_DAILY_LIMIT||3)})}
 if(b.action==='job'){if(!Object.hasOwn(roles,b.role))return respond({error:'Invalid role'},400);const row={client:text(b.client,100),role:b.role,brief:text(b.brief,8000),status:'pending'};return respond((await db('af_os_jobs','POST',row))[0],201)}
 if(b.action==='ledger'){return respond((await db('af_os_ledger','POST',{client:text(b.client,100),day:day(b.day),revenue_eur:number(b.revenue),cost_eur:number(b.cost),hours:number(b.hours),note:String(b.note||'').slice(0,1000)}))[0],201)}
 if(b.action==='metric'){return respond((await db('af_os_metrics','POST',{client:text(b.client,100),day:day(b.day),channel:text(b.channel,80),visits:number(b.visits,true,true),qualified_leads:number(b.leads,true,true),calls:number(b.calls,true,true),sales:number(b.sales,true,true),note:String(b.note||'').slice(0,1000)}))[0],201)}
 if(!/^[a-f0-9-]{36}$/i.test(b.id||''))return respond({error:'Invalid job ID'},400);
 const filter=`af_os_jobs?id=eq.${b.id}`;const job=(await db(filter))[0];if(!job)return respond({error:'Not found'},404);
 if(b.action==='approve'||b.action==='reject'){const status=transition(job.status,b.action);if(!status)return respond({error:'Not awaiting review'},409);const changed=await db(`${filter}&status=eq.review`,'PATCH',{status,updated_at:new Date().toISOString()});return changed.length?respond(changed[0]):respond({error:'Job changed'},409)}
 if(b.action==='manual'){if(job.status!=='pending')return respond({error:'Not pending'},409);const changed=await db(`${filter}&status=eq.pending`,'PATCH',{output:text(b.output,16000),status:'review',updated_at:new Date().toISOString()});return changed.length?respond(changed[0]):respond({error:'Job changed'},409)}
 if(b.action==='run'){
  if(b.confirm!==true||job.status!=='pending')return respond({error:'Explicit confirmation and pending job required'},409);
  if(!E.OPENAI_API_KEY||!E.OPENAI_MODEL)return respond({error:'AI not configured'},503);
  const claimed=await db(`${filter}&status=eq.pending`,'PATCH',{status:'running',updated_at:new Date().toISOString()});if(!claimed.length)return respond({error:'Already claimed'},409);
  let usage=null;try{const limit=Number(E.AI_DAILY_LIMIT||3);if(!Number.isInteger(limit)||limit<1||limit>30)throw Error('Invalid daily limit');if(!await db('rpc/af_os_reserve_call','POST',{p_limit:limit}))throw Error('Daily request limit reached');
   const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${E.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:E.OPENAI_MODEL,instructions:instructions(job.role),input:job.brief,max_output_tokens:1800,store:false}),signal:AbortSignal.timeout(22000)});if(!res.ok)throw Error('OpenAI request failed');const data=await res.json();usage=data.usage||null;const output=(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n');if(!output||data.status!=='completed')throw Error('Incomplete model output');return respond((await db(`${filter}&status=eq.running`,'PATCH',{status:'review',output,usage,updated_at:new Date().toISOString()}))[0]);
  }catch(e){await db(`${filter}&status=eq.running`,'PATCH',{status:'failed',error:e.message.slice(0,120),usage,updated_at:new Date().toISOString()});return respond({error:e.message},502)}
 }
 return respond({error:'Unknown action'},400)
 }catch(e){return respond({error:'Request failed; check inputs, configuration or server logs'},400)}}
