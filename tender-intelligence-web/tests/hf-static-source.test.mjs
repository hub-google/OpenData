import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const id='ABC::11501';
const bucket=(parseInt(createHash('sha256').update(id).digest('hex').slice(0,2),16)%64).toString(16).padStart(2,'0');
const cases=[
 {id,unit_id:'ABC',job_number:'11501',title:'臺北工程採購案',agency:'臺北市政府',category:'工程類',group_name:'工程',latest_notice_type:'公開招標',latest_notice_date:20261110,budget_amount:2500000,award_amount:null,deadline_at:'2027-12-10T12:00:00Z',official_url:'https://web.pcc.gov.tw/official',latest_filename:'XYZ'},
 {id:'DEF::11502',unit_id:'DEF',job_number:'11502',title:'印表機供應案',agency:'教育局',category:'財物類',group_name:'財物',latest_notice_type:'決標公告',latest_notice_date:20261109,budget_amount:300000,award_amount:250000,deadline_at:null,official_url:null,latest_filename:'ABC'}
];
const source=new Map([
 ['ti_cases.json.gz',cases],
 ['ti_case_search_index.json.gz',[{case_id:id,searchable:'台北工程採購案'},{case_id:'DEF::11502',searchable:'印表機供應案'}]],
 ['ti_case_vendor_search.json.gz',[{case_id:id,vendor_text:'ABC 建設有限公司'},{case_id:'DEF::11502',vendor_text:'DEF文具'}]],
 ['ti_notices/'+bucket+'.json.gz',[{id:'NOTICE1',case_id:id,source_date:20261110,filename:'XYZ',notice_type:'公開招標',raw_brief:{title:'臺北工程採購案',type:'招標'},official_url:'https://web.pcc.gov.tw/official'}]],
 ['ti_case_details/'+bucket+'.json.gz',[{case_id:id,latest_notice_id:'NOTICE1',details:{location:'台北市',period:'120日'}}]],
 ['manifest.json',{files:{'ti_cases.json.gz':{records:2},'ti_notices/'+bucket+'.json.gz':{records:1}},created_at:'2026-11-17T00:00:00Z'}]
]);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{
 const p=String(url).split('/browser/v1/')[1];
 if(!p)throw new Error('non-HF URL '+url);
 let val=source.get(p);
 if(val===undefined&&/ti_(notices|case_details)\/[0-9a-f]{2}\.json\.gz$/.test(p))val=[];
 if(val===undefined)return new Response('Not Found',{status:404});
 const body=Buffer.from(JSON.stringify(val),'utf8');
 return new Response(p.endsWith('.gz')?gzipSync(body):body,{status:200});
};
const hf=await import('../hf-static-source.mjs');
test.after(()=>{globalThis.fetch=originalFetch;});
test('HF client returns full real source count and filters',async()=>{
 const r=await hf.hfCaseSearch({filters:{group:'工程',status:'招標',minBudget:1000000},scenario:'ready'});
 assert.equal(r.total_records,1);
 assert.equal(r.records[0].job_number,'11501');
 assert.equal(r.records[0].brief.title,'臺北工程採購案');
 const f=await hf.hfCaseSearch({mode:'title',query:'工程'});
 assert.equal(f.total_records,1);
 const vendor=await hf.hfCaseSearch({mode:'vendor',query:'ABC'});
 assert.equal(vendor.total_records,1);
 const no=await hf.hfCaseSearch({mode:'archive',query:'工程',filters:{group:'財物'}});
 assert.equal(no.total_records,0);
});
test('HF archived case includes exact notice and real details only',async()=>{
 const r=await hf.hfArchivedCaseDetail('ABC','11501');
 assert.equal(r.records.length,1);
 assert.equal(r.records[0].date,20261110);
 assert.equal(r.records[0].detail['採購資料:履約地點'],'台北市');
});
test('HF public status reports manifest counts',async()=>{
 const d=await hf.hfSourceStatus();
 assert.equal(d.cases,2);
 assert.equal(d.notices,1);
});
