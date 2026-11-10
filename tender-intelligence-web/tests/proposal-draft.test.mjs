import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProposalDraft} from '../proposal-draft-core.mjs';

const caseInfo={id:'A.12::116-1',job_number:'116-1',
 title:'學校資訊設備維護採購',agency:'某國立學校',
 latest_notice_type:'公開招標公告',budget_amount:null,deadline_at:null,
 official_url:'https://web.pcc.gov.tw/tps/query'};
const company={company_name:'測試維護有限公司',services:'資訊系統維護',company_intro:'有提供系統維護服務'};
const ownedDoc={id:'11111111-1111-4111-8111-111111111111',filename:'規格書.pdf',
 extracted:{pages:[{source:'第 2 頁',text:'本案要求提供資訊維護人員證明。投標廠商應附履約計畫及驗收清單。'}]}};
test('W06 real references are quoted and unknown facts remain unknown',()=>{
 const output=buildProposalDraft({caseInfo,company,documents:[ownedDoc],assets:[]});
 assert.equal(output.mode,'evidence_template');
 assert.equal(output.documentCount,1);
 assert.ok(output.sourceCount>=1);
 assert.ok(output.content.includes('規格書.pdf'));
 assert.ok(output.content.includes('第 2 頁'));
 assert.equal(output.sourceRefs[0].filename,'規格書.pdf');
 assert.ok(ownedDoc.extracted.pages[0].text.includes(output.sourceRefs[0].excerpt));
 assert.ok(output.content.includes('待官方原文確認'));
 assert.ok(!output.content.includes('符合投標資格：是'));
 assert.ok(output.content.includes('送件前'));
});
test('W06 without source text is an explicit incomplete outline',()=>{
 const output=buildProposalDraft({caseInfo,company,documents:[]});
 assert.equal(output.sourceCount,0);
 assert.ok(output.content.includes('尚無可引用的招標文件原文'));
 assert.ok(output.content.includes('【待填'));
});
test('W06 does not forge company certificates',()=>{
 const output=buildProposalDraft({caseInfo,company,
   assets:[{id:'abcd',title:'ISO 證書（公司自行填寫）',expires_on:'2027-12-31'}]});
 assert.ok(output.content.includes('公司已登錄的證照與實績'));
 assert.ok(output.content.includes('是否符合該案資格仍須人工核對'));
});
test('W06 rejects unidentified cases and suspicious URLs',()=>{
 assert.throws(()=>buildProposalDraft({caseInfo:{title:'只有案名'}}));
 const output=buildProposalDraft({caseInfo:{...caseInfo,official_url:'https://web.pcc.gov.tw.evil.invalid'}}); 
 assert.ok(output.content.includes('待查核官方來源'));
 assert.ok(!output.content.includes('web.pcc.gov.tw.evil.invalid'));
});
test('W06 source excerpt count bounded and editable content capped',()=>{
 const inputDocs=Array.from({length:50},(_,i)=>({
  id:'id'+i,filename:'文件'+i+'.txt',
  extracted:{pages:Array.from({length:50},(_,j)=>({
   source:'第 '+j+' 頁',text:'資格要求與驗收資料 '+i+' '+j+'.'
  }))}
 }));
 const output=buildProposalDraft({caseInfo,documents:inputDocs});
 assert.ok(output.sourceRefs.length<=18);
 assert.ok(output.content.length<=98000);
 assert.ok(output.documentCount===50);
});
