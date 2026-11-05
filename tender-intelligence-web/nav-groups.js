// Five compact sections; existing button nodes are moved, never cloned, preserving all handlers.
const groups=[
 {name:'找標案',icon:'⌕',views:['search','advanced','radar','issues']},
 {name:'市場情報',icon:'▤',views:['agencies','vendors','analytics','debarred','directory']},
 {name:'投標工作台',icon:'▣',views:['tracking','decisions','proposal','documents','team','contracts']},
 {name:'監控與通知',icon:'♧',views:['alerts']},
 {name:'我的公司與設定',icon:'⚙',views:['company','developer','guide','about','billing']}
];
function build(){
 const nav=document.querySelector('.sidebar .nav');if(!nav||nav.dataset.grouped)return;
 const nodes=new Map([...nav.querySelectorAll('[data-view]')].map(node=>[node.dataset.view,node]));
 const result=new Map(),fragment=document.createDocumentFragment();
 for(const group of groups){
  const wrap=document.createElement('details');wrap.className='ti-nav-group';wrap.dataset.group=group.name;
  const head=document.createElement('summary');head.className='ti-nav-summary';head.textContent=group.icon+'  '+group.name;
  const sub=document.createElement('div');sub.className='ti-nav-sub';
  for(const id of group.views){const node=nodes.get(id);if(!node)continue;sub.append(node);result.set(id,wrap);}
  wrap.append(head,sub);if(sub.children.length)fragment.append(wrap);
 }
 nav.replaceChildren(fragment);nav.dataset.grouped='1';
 const activate=()=>{
  const active=nav.querySelector('.nav-item.active');if(!active)return;
  const group=result.get(active.dataset.view);if(!group)return;
  group.open=true;
  nav.querySelectorAll('details').forEach(d=>d.classList.toggle('contains-active',d===group));
 };
 activate();
 document.addEventListener('ti:view-changed',e=>{const group=result.get(e.detail?.view);if(group){group.open=true;nav.querySelectorAll('details').forEach(d=>d.classList.toggle('contains-active',d===group));}});
 nav.querySelectorAll('summary').forEach(summary=>summary.addEventListener('click',()=>{
  const target=summary.parentElement;
  if(!target.open)for(const other of nav.querySelectorAll('details'))if(other!==target)other.open=false;
 }));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build,{once:true});else build();
