import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate,dateLabel,safeNumber,normalize,dedupe,mergeCaseAmounts,filtered,groupOf,stateOf,
  fieldsOf,summaryOf,amountRatio,ratioStats,scoreCase,csvEscape,safeOfficial,keyOf
} from '../core.mjs';

const base={unit_id:'A.15.2',job_number:'115157G',unit_name:'交通部中央氣象署',date:20261103,filename:'TIQ-1-71148889',
  budget_amount:null,award_amount:null,brief:{type:'公開招標公告',title:'氣象資訊設備採購',category:'財物類452-計算機及其零附件'}};
test('ROC deadline parses as Taiwan time',()=>{
  assert.equal(parseDate('115/09/10 17:00').toISOString(),'2026-09-10T09:00:00.000Z');
  assert.equal(parseDate('20261103').toISOString(),'2026-11-02T16:00:00.000Z');
  assert.equal(parseDate('115/02/30'),null);
  assert.equal(parseDate(null),null);
  assert.notEqual(dateLabel('115/09/10 17:00'),'未公開');
});
test('unknown budget is not zero',()=>{
  assert.equal(safeNumber(null),null);
  assert.equal(safeNumber(''),null);
  assert.equal(safeNumber('15,172,290元'),15172290);
  assert.equal(safeNumber('未公開'),null);
});
test('normalizes real OpenFun response shape',()=>{
  const r=normalize(base);
  assert.equal(r.title,'氣象資訊設備採購');
  assert.equal(r.group,'財物');
  assert.equal(r.status,'招標');
  assert.equal(r.budget,null);
  assert.equal(r.id,'A.15.2::115157G');
  assert.equal(keyOf(r),r.id);
  assert.equal(groupOf(base),'財物');
  assert.equal(stateOf({...base,brief:{type:'決標公告'}}),'決標');
});
test('separates actual source solicitation, preview and sale types',()=>{
  const make=type=>({...base,brief:{...base.brief,type}});
  assert.equal(stateOf(make('公開取得報價單或企劃書公告')),'招標');
  assert.equal(stateOf(make('公開徵求廠商提供參考資料公告')),'公開徵求');
  assert.equal(stateOf(make('招標文件公開閱覽公告資料公告')),'公開閱覽');
  assert.equal(stateOf(make('財物變賣公告')),'財物標售');
  assert.equal(stateOf(make('無法決標公告')),'無法決標');
});
test('fills missing listbydate budget only from exactly matching ingested case',()=>{
  const rows=[base,{...base,job_number:'unmatched'},{...base,job_number:'has-original',budget_amount:300}];
  const amounts=new Map([[keyOf(base),{budget_amount:1250000,award_amount:800000}],
    [base.unit_id+'::has-original',{budget_amount:900000}]]);
  const merged=mergeCaseAmounts(rows,amounts);
  assert.equal(merged[0].budget_amount,1250000);
  assert.equal(merged[0].award_amount,800000);
  assert.equal(merged[1].budget_amount,null);
  assert.equal(merged[2].budget_amount,300);
  assert.equal(mergeCaseAmounts(rows,new Map())[0].budget_amount,null);
});
test('deduplicates same case version while retaining latest announcement',()=>{
  const old={...base,date:20261031,filename:'TIQ-1-123'};
  const latest={...base,filename:'TIQ-1-71150000',brief:{...base.brief,type:'更正公告'}};
  const rows=dedupe([old,base,latest]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].filename,'TIQ-1-71150000');
});
test('filters known budget but not unknown as zero',()=>{
  const rows=[normalize(base),normalize({...base,job_number:'other',budget_amount:4000000})];
  assert.equal(filtered(rows,{minBudget:'3000000'}).length,1);
  assert.equal(filtered(rows,{group:'工程'}).length,0);
  assert.equal(filtered(rows,{status:'招標'}).length,2);
});
test('extracts official detail fields without fabricated links',()=>{
  const detail={
    url:'https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pkPmsMain=abc',
    '領投開標:截止投標':'115/11/20 17:00',
    '其他:履約地點':'臺北市',
    '採購資料:預算金額':'2,500,000元'
  };
  const d=fieldsOf(detail);
  assert.equal(d.deadline,'115/11/20 17:00');
  assert.equal(d.location,'臺北市');
  assert.equal(d.budget,'2,500,000元');
  assert.ok(d.url.startsWith('https://web.pcc.gov.tw/'));
  assert.equal(fieldsOf({url:'https://evil.example/'}).url,'');
});
test('selects tender notice for deadline; newest award notice for state',()=>{
  const announcement={...base,date:20261022,detail:{'領投開標:截止投標':'115/10/29 17:00'}};
  const award={...base,date:20261103,brief:{...base.brief,type:'決標公告'},detail:{url:'https://web.pcc.gov.tw/tps/sample'}};
  const s=summaryOf([announcement,award]);
  assert.equal(s.status,'決標');
  assert.equal(s.tenderNotice.date,20261022);
  assert.equal(s.deadlineRaw,'115/10/29 17:00');
  assert.equal(s.completed,true);
  assert.equal(s.isOpen,false);
});
test('ratio statistics use actual positive budget only',()=>{
  const rows=[{award_amount:800,budget_amount:1000},{award_amount:900,budget_amount:1000},{award_amount:null,budget_amount:1000},{award_amount:500,budget_amount:0}];
  const stats=ratioStats(rows);
  assert.equal(stats.count,2);
  assert.ok(Math.abs(stats.median-0.85)<1e-9);
  assert.equal(amountRatio(rows[3]),null);
});
test('matching rejects excluded keywords and known out-of-range amounts',()=>{
  const row=normalize({...base,budget_amount:200000});
  assert.equal(scoreCase(row,{keywords:'資訊',excludes:'設備'}).qualifies,false);
  assert.equal(scoreCase(row,{keywords:'資訊',min:300000}).qualifies,false);
  assert.equal(scoreCase(row,{keywords:'資訊',min:100000,max:300000}).qualifies,true);
});
test('CSV formula content protected and URL hostname restricted',()=>{
  assert.equal(csvEscape('=1+1'),'"\'=1+1"');
  assert.ok(safeOfficial('https://web.pcc.gov.tw/tps/example'));
  assert.equal(safeOfficial('https://web.pcc.gov.tw.evil.net/'),'');
  assert.equal(safeOfficial('javascript:alert(1)'),'');
});
