// Tender Intelligence: HF public repository -> isolated D1 staging mirror.
// Public endpoints are read-only; ingestion is exclusive to Cloudflare cron.
// Do not switch production to this API until contract parity is verified.
const HF='https://huggingface.co/datasets/hub-google/TenderIntelligence/resolve/main/';
const PHASES=[
 {set:'records',table:'ti_cases',db:'ti_cases_cache',key:'id'},
 {set:'records',table:'ti_notices',db:'ti_notices_cache',key:'id'},
 {set:'records',table:'ti_case_details',db:'ti_details_cache',key:'case_id'},
 {set:'search',table:'ti_case_search_index',db:'ti_search_fts',key:'case_id'},
 {set:'search',table:'ti_case_vendor_search',db:'ti_vendor_text_cache',key:'case_id'}
];
const FIELDS={
 ti_cases:['id','unit_id','job_number','title','agency','category','group_name','latest_notice_type','latest_notice_date','budget_amount','award_amount','deadline_at','official_url','latest_filename','first_seen_at','source_fetched_at'],
 ti_notices:['id','case_id','source_date','filename','notice_type','title','category','budget_amount','award_amount','official_url','company_ids','company_names','company_role_keys','raw_brief','fetched_at'],
 ti_case_details:['case_id','latest_notice_id','details','records_count','fetched_at'],
 ti_case_search_index:['case_id','searchable'],
 ti_case_vendor_search:['case_id','vendor_text','updated_at']
};
function json(res,code=200){
 return new Response(JSON.stringify(res),{status:code,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','cache-control':'public, max-age=15'}});
}
async function read(path){
 const r=await fetch(HF+path,{redirect:'follow'});
 if(!r.ok)throw Error('HF '+r.status+' '+path);
 return r.json();
}
async function lines(path){
 const r=await fetch(HF+path,{redirect:'follow'});
 if(!r.ok)throw Error('HF shard '+r.status+' '+path);
 const text=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
 return text.trimEnd().split('\n');
}
function sqlFor(p){
 if(p.table==='ti_case_search_index')return 'INSERT INTO ti_search_fts(case_id,searchable) VALUES(?,?)';
 const fs=FIELDS[p.table];
 const updates=fs.filter(x=>x!==p.key).map(x=>x+'=excluded.'+x).join(',');
 return 'INSERT INTO '+p.db+' ('+fs.join(',')+') VALUES ('+fs.map(()=>'?').join(',')+') ON CONFLICT('+p.key+') DO UPDATE SET '+updates;
}
// D1 trigram FTS cannot index two-character Han queries directly.
// Add a three-codepoint marker for each adjacent Han pair, so
// q工程 can be indexed and searched as a regular trigram.
function indexedText(raw){
 const source=String(raw||'');
 const c=Array.from(source);
 const pairs=[];
 const han=/^\p{Script=Han}$/u;
 for(let i=0;i+1<c.length;i++){
  if(han.test(c[i])&&han.test(c[i+1]))pairs.push('q'+c[i]+c[i+1]);
 }
 return source+' '+pairs.join(' ');
}
function value(key,v){
 if(v==null)return null;
 if(key==='searchable')return indexedText(v);
 if(['budget_amount','award_amount','latest_notice_date','source_date','records_count'].includes(key))return Number(v);
 if(typeof v==='object')return JSON.stringify(v);
 return String(v);
}
async function ingest(db){
 const states=await db.prepare('SELECT * FROM ti_import_state ORDER BY dataset').all();
 const rows=states.results||[];
 const stage=PHASES.find(p=>rows.find(s=>s.dataset===p.set&&s.status!=='complete'&&s.stage===p.table));
 if(!stage)return {finished:true};
 const st=rows.find(s=>s.dataset===stage.set);
 const manifest=await read(st.snapshot+'/manifest.json');
 const entry=manifest.tables[stage.table];
 if(!entry||!Array.isArray(entry.shards))throw Error('HF manifest missing '+stage.table);
 if(st.shard_idx>=entry.shards.length)throw Error('Invalid shard cursor');
 const shard=entry.shards[st.shard_idx];
 const raw=await lines(st.snapshot+'/'+shard.file);
 if(raw.length!==shard.rows)throw Error('HF shard row-count mismatch');
 const chunk=raw.slice(st.row_cursor,Math.min(raw.length,st.row_cursor+120)).map(x=>JSON.parse(x));
 const prepared=chunk.map(row=>{
   if(!row[stage.key])throw Error('Missing primary key for '+stage.table);
   return db.prepare(sqlFor(stage)).bind(...FIELDS[stage.table].map(k=>value(k,row[k])));
 });
 const end=st.row_cursor+chunk.length;
 const nextShard=end>=raw.length?st.shard_idx+1:st.shard_idx;
 const completedStage=nextShard===entry.shards.length;
 const next=completedStage?PHASES[PHASES.indexOf(stage)+1]:stage;
 const completedSet=!next||next.set!==stage.set;
 prepared.push(db.prepare('UPDATE ti_import_state SET stage=?, shard_idx=?, row_cursor=?, imported_rows=imported_rows+?, status=?, updated_at=CURRENT_TIMESTAMP WHERE dataset=? AND stage=? AND shard_idx=? AND row_cursor=?')
  .bind(completedSet?stage.table:next.table,completedStage?0:nextShard,end>=raw.length?0:end,chunk.length,completedSet?'complete':'importing',stage.set,stage.table,st.shard_idx,st.row_cursor));
 const results=await db.batch(prepared);
 if(!results.at(-1)?.meta?.changes)throw Error('Concurrent writer cursor mismatch');
 return {stage:stage.table,rows:chunk.length,set:stage.set,finished_set:completedSet};
}
async function search(db,u){
 const p=u.searchParams;
 const term=(p.get('q')||'').trim().slice(0,100);
 const mode=p.get('mode')||'latest';
 if((mode==='agency'||mode==='vendor'||mode==='companyId'||term.length<2) && new TextEncoder().encode(term).length>45) return json({error:'query exceeds database LIKE limit'},400);
 const allowed=['latest','title','archive','agency','vendor','companyId'];
 if(!allowed.includes(mode))return json({error:'unsupported mode'},400);
 const page=Math.max(1,Math.min(1000,parseInt(p.get('page')||'1',10)||1));
 const group=(p.get('group')||'').trim();
 const type=(p.get('type')||'').trim();
 const where=[],args=[];
 if(group&&group!=='全部'){where.push('group_name=?');args.push(group);}
 if(type&&type!=='全部'){where.push('latest_notice_type LIKE ?');args.push('%'+type+'%');}
 if(term){
  if(mode==='agency'){where.push('agency LIKE ?');args.push('%'+term+'%');}
  else if(mode==='vendor'||mode==='companyId'){
    where.push('id IN (SELECT case_id FROM ti_vendor_text_cache WHERE vendor_text LIKE ?)');
    args.push('%'+term+'%');
  }else if(term.length>=3||/^\p{Script=Han}{2}$/u.test(term)){
    where.push('id IN (SELECT case_id FROM ti_search_fts WHERE searchable MATCH ?)');
    const ftsTerm=term.length===2?'q'+term:term;
    args.push('"'+ftsTerm.replaceAll('"','')+'"');
  }else{
    where.push('(title LIKE ? OR agency LIKE ?)');args.push('%'+term+'%','%'+term+'%');
  }
 }
 const w=where.length?' WHERE '+where.join(' AND '):'';
 const sort=p.get('sort')==='budget'?'budget_amount DESC,latest_notice_date DESC':'latest_notice_date DESC';
 const data=await db.prepare('SELECT * FROM ti_cases_cache'+w+' ORDER BY '+sort+',id LIMIT 30 OFFSET ?').bind(...args,(page-1)*30).all();
 const count=await db.prepare('SELECT count(*) AS n FROM ti_cases_cache'+w).bind(...args).first();
 return json({rows:data.results||[],total:count.n,page,limit:30,source:'hf-d1-staging'});
}
export default {
 async fetch(request,env){
  if(request.method==='OPTIONS')return json({ok:true});
  if(request.method!=='GET')return json({error:'read-only'},405);
  const u=new URL(request.url);
  try{
   if(u.pathname==='/health'){
    const states=await env.TI_DB.prepare('SELECT dataset,stage,shard_idx,row_cursor,imported_rows,status,updated_at FROM ti_import_state ORDER BY dataset').all();
    const cases=await env.TI_DB.prepare('SELECT count(*) AS n FROM ti_cases_cache').first();
    return json({service:'tender-hf-d1',production_ready:false,case_count:cases.n,imports:states.results});
   }
   if(u.pathname==='/preview/search')return search(env.TI_DB,u);
   if(u.pathname==='/preview/case'){
    const id=u.searchParams.get('id')||'';
    const item=await env.TI_DB.prepare('SELECT * FROM ti_cases_cache WHERE id=?').bind(id).first();
    if(!item)return json({error:'not found'},404);
    const notices=await env.TI_DB.prepare('SELECT * FROM ti_notices_cache WHERE case_id=? ORDER BY source_date DESC LIMIT 100').bind(id).all();
    const details=await env.TI_DB.prepare('SELECT * FROM ti_details_cache WHERE case_id=?').bind(id).first();
    return json({case:item,notices:notices.results||[],details:details?JSON.parse(details.details):null});
   }
   return json({error:'not found'},404);
  }catch(e){return json({error:String(e.message||e)},503);}
 },
 async scheduled(event,env,ctx){
  ctx.waitUntil(ingest(env.TI_DB).then(x=>console.log('HF/D1 stage progress',JSON.stringify(x))).catch(e=>{console.error('HF/D1 ingest failure:',e.stack||e.message);throw e;}));
 }
};
