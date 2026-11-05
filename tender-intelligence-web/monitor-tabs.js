// Compact monitor workspace: keeps original forms and event handlers intact.
const tabs=[
 {id:'watch',label:'標案監控'},
 {id:'competitor',label:'競品追蹤'},
 {id:'reports',label:'自動報表'},
 {id:'delivery',label:'通知設定'}
];
function mount(){
 const root=document.getElementById('view-alerts');
 if(!root||root.dataset.monitorGrouped)return;
 const headings=[...root.children].filter(n=>n.classList.contains('section-heading'));
 const direct=[...root.children];
 const tracker=root.querySelector('.ti-tracker-module'),reports=root.querySelector('.ti-report-module');
 const notice=direct.find(n=>n.classList.contains('notice')&&n.classList.contains('warning'));
 const delivery=direct.find(n=>n.classList.contains('panel')&&n.querySelector('#saveDelivery'));
 const watchers=direct.find(n=>n.classList.contains('panel')&&n.querySelector('#watchForm'));
 const watchOutput=root.querySelector('#watchOutput'),inbox=root.querySelector('#cloudInbox');
 const inboxHeading=headings.find(n=>n.textContent.includes('資料庫自動比對'));
 const nav=document.createElement('div');nav.className='ti-monitor-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','監控功能分類');
 const area=document.createElement('div');area.className='ti-monitor-content';
 const panels=new Map();
 for(const [i,tab] of tabs.entries()){
  const b=document.createElement('button');b.type='button';b.textContent=tab.label;
  b.className='ti-monitor-tab'+(i===0?' selected':'');b.dataset.monitorTab=tab.id;
  b.setAttribute('role','tab');b.setAttribute('aria-selected',i===0?'true':'false');
  const p=document.createElement('section');p.className='ti-monitor-panel';p.id='monitor-panel-'+tab.id;p.hidden=i!==0;p.setAttribute('role','tabpanel');
  nav.append(b);area.append(p);panels.set(tab.id,p);
  b.addEventListener('click',()=>{
   for(const item of nav.children){const active=item===b;item.classList.toggle('selected',active);item.setAttribute('aria-selected',active?'true':'false');}
   for(const [id,node] of panels)node.hidden=id!==tab.id;
   const status=document.getElementById('tiMonitorTabStatus');if(status)status.textContent='已切換至'+tab.label;
  });
 }
 const move=(key,nodes)=>{const p=panels.get(key);for(const node of nodes)if(node)p.append(node);};
 move('watch',[watchers,watchOutput,inboxHeading,inbox]);
 move('competitor',[tracker]);move('reports',[reports]);
 move('delivery',[notice,delivery]);
 root.querySelector('.page-heading')?.insertAdjacentElement('afterend',nav);
 nav.insertAdjacentElement('afterend',area);
 root.dataset.monitorGrouped='1';
 const status=document.createElement('p');status.className='sr-only';status.id='tiMonitorTabStatus';status.setAttribute('role','status');area.before(status);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,0),{once:true});
else setTimeout(mount,0);
