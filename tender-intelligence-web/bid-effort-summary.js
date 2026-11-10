// W08 exact personal preparation costs. Values are never extrapolated.
const e=(tag,text='',cls='')=>{const node=document.createElement(tag);node.textContent=String(text);if(cls)node.className=cls;return node;};
const money=n=>'NT$'+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
const hours=n=>Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2})+' 小時';
export async function renderBidEffortSummary(root,client,userId,isCurrent){
 if(!root)return;
 if(!client||!userId){root.textContent='登入後可查看自己的備標工時及現金支出。';return;}
 root.textContent='正在計算你實際記錄的備標成本…';
 try{
  const {data,error}=await client.rpc('ti_bid_effort_summary');
  if(error)throw error;
  if(!root.isConnected||isCurrent()!==userId)return;
  const result=Array.isArray(data)?data[0]:data;
  if(!result)throw Error('資料庫未回傳備標成本統計');
  const heading=e('h3','備標成本與工作量');
  const metrics=e('div','','ti-performance-grid');
  for(const [label,value,detail] of [
   ['備標工作紀錄',Number(result.entry_count||0)+' 筆','本人手動登錄'],
   ['備標工時',hours(result.total_hours),'僅計已填寫的工時'],
   ['實際現金支出',money(result.cash_expense),'不包含人力估值'],
   ['已估價人力成本',money(result.estimated_labor),
     Number(result.hours_without_rate||0)>0?'另有 '+hours(result.hours_without_rate)+' 未估價':'僅計有填時薪的紀錄']
  ]){
   const card=e('div','','ti-performance-metric');
   card.append(e('span',label,'minor'),e('strong',value),e('small',detail,'minor'));
   metrics.append(card);
  }
  root.replaceChildren(heading,metrics,e('p','這裡不推斷政府標案是否得標，也不將未填工時單價視為零成本。','minor'));
 }catch(error){
  if(root.isConnected&&isCurrent()===userId)
   root.textContent='私人備標成本統計讀取失敗：'+String(error?.message||error).slice(0,180);
 }
}
