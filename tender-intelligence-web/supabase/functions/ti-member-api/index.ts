// Authenticated, self-scoped, bounded procurement-workspace API + stateless MCP.
// No bulk public tender redistribution; no third-party raw feeds.
const DB=Deno.env.get('SUPABASE_URL')||'';
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const cors={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
 'Access-Control-Allow-Headers':'content-type,x-ti-api-key,authorization,apikey,mcp-protocol-version',
 'Access-Control-Expose-Headers':'Mcp-Session-Id',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff'
};
function json(body:unknown,status=200){return Response.json(body,{status,headers:cors});}
const hex=(bytes:Uint8Array)=>Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
const safe=(v:unknown,n=120)=>String(v??'').slice(0,n);
async function database(path:string,method='GET',body:unknown=null){
 const response=await fetch(DB+'/rest/v1/'+path,{method,
  headers:{apikey:SECRET,Authorization:'Bearer '+SECRET,'Content-Type':'application/json',Accept:'application/json'},
  body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('database HTTP '+response.status);
 return response.json();
}
async function authorized(req:Request){
 const raw=req.headers.get('x-ti-api-key')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
 if(!/^ti_[0-9a-f]{64}$/.test(raw))return null;
 const bytes=new TextEncoder().encode(raw);
 const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
 const uid=await database('rpc/ti_api_claim_key','POST',{p_hash:hash});
 return typeof uid==='string'&&/^[0-9a-f-]{36}$/i.test(uid)?uid:null;
}
function parameters(params:URLSearchParams){
 const l=Number(params.get('limit')||'20'),offset=Number(params.get('offset')||'0');
 if(!Number.isInteger(l)||l<1||l>20||!Number.isInteger(offset)||offset<0||offset>1000)
  throw Error('limit must be 1–20, offset 0–1000');
 return {l,offset};
}
async function personal(uid:string,resource:string,params:URLSearchParams){
 if(resource==='status')return {scope:'personal_workspace_only',limits:{max_page:20,max_offset:1000,
 daily_requests:300},source:'User-saved records only. This is not the nationwide PCC feed.',
 project_url:BASE,checked_at:new Date().toISOString()};
 const {l,offset}=parameters(params);
 if(resource==='saved'){
  const route='ti_saved_cases?select=case_id,title,agency,unit_id,job_number,stage,notes,internal_deadline,read_at,updated_at'
   +'&user_id=eq.'+encodeURIComponent(uid)+'&order=updated_at.desc&limit='+l+'&offset='+offset;
  const rows=await database(route);
  return {items:rows.map((r:Record<string,unknown>)=>({
    ...r,open_url:BASE+'?case_unit='+encodeURIComponent(String(r.unit_id||''))+
      '&case_no='+encodeURIComponent(String(r.job_number||''))
  })),limit:l,offset,provenance:'Own saved bid records; open each source case to verify official details'};
 }
 if(resource==='tasks'){
  const route='ti_tasks?select=id,case_id,title,due_at,done,created_at,updated_at'
   +'&user_id=eq.'+encodeURIComponent(uid)+'&order=updated_at.desc&limit='+l+'&offset='+offset;
  const rows=await database(route);
  return {items:rows,limit:l,offset,provenance:'Own user-created tasks'};
 }
 throw Error('unsupported resource');
}
const tools=[
 {name:'list_my_saved_bids',description:'Read up to 20 of my own saved procurement bids; does not return national tender feeds',
  inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20},
   offset:{type:'integer',minimum:0,maximum:1000}},additionalProperties:false}},
 {name:'list_my_tasks',description:'Read up to 20 of my own procurement to-do items',
  inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:20},
   offset:{type:'integer',minimum:0,maximum:1000}},additionalProperties:false}},
 {name:'workspace_status',description:'Describe this API scope and limits, without accessing third-party tender feeds',
  inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
async function mcp(uid:string,payload:any){
 if(!payload||payload.jsonrpc!=='2.0'||typeof payload.method!=='string')throw Error('invalid JSON-RPC 2.0 request');
 const hasId=Object.hasOwn(payload,'id');
 if(!hasId&&payload.method==='notifications/initialized')return null;
 const call=(result:unknown)=>({jsonrpc:'2.0',id:payload.id,result});
 const failure=(code:number,message:string)=>({jsonrpc:'2.0',id:payload.id,error:{code,message}});
 if(payload.method==='initialize')return call({
  protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},
  serverInfo:{name:'taiwan-procurement-personal-workspace',version:'1.0.0'},
  instructions:'Read-only access to personal saved bids and tasks. Official public tender data must be verified at the source.'
 });
 if(payload.method==='ping')return call({});
 if(payload.method==='tools/list')return call({tools});
 if(payload.method!=='tools/call')return failure(-32601,'Method not found');
 const name=safe(payload.params?.name,60),a=payload.params?.arguments||{};
 if(!tools.some(t=>t.name===name))return failure(-32602,'Unknown tool');
 const u=new URLSearchParams();
 if(a.limit!==undefined)u.set('limit',String(a.limit));
 if(a.offset!==undefined)u.set('offset',String(a.offset));
 try{
  const resource=name==='list_my_saved_bids'?'saved':name==='list_my_tasks'?'tasks':'status';
  const response=await personal(uid,resource,u);
  return call({content:[{type:'text',text:JSON.stringify(response)}],isError:false});
 }catch(e){
  return call({content:[{type:'text',text:safe((e as Error).message,200)}],isError:true});
 }
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!DB||!SECRET)return json({error:'Service not configured'},503);
 if(req.method!=='GET'&&req.method!=='POST')return json({error:'GET or POST only'},405);
 try{
  const uid=await authorized(req);
  if(!uid)return json({error:'Invalid, expired or quota-exhausted personal API key'},401);
  const url=new URL(req.url);
  if(req.method==='GET'){
   const resource=url.searchParams.get('resource')||'status';
   return json(await personal(uid,resource,url.searchParams));
  }
  if(Number(req.headers.get('content-length')||0)>12000)return json({error:'Payload too large'},413);
  const payload=await req.json();
  const result=await mcp(uid,payload);
  if(result===null)return new Response(null,{status:202,headers:cors});
  return json(result);
 }catch(e){
  const m=safe((e as Error).message,150);
  return json({error:/unsupported resource|limit must/.test(m)?m:'Personal API request failed'},/unsupported resource|limit must/.test(m)?400:502);
 }
});
