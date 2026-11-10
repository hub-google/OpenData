// Reproducible, validated basic search links. Never expose private user data.
const modes=new Set(['latest','title','archive','agency','vendor','companyId']);
const scenarios=new Set(['all','open','soon','small','failed','amended','awarded']);
const groups=new Set(['全部','工程','財物','勞務','未分類']);
const statusKinds=new Set(['全部','招標','決標','更正','無法決標','公開閱覽','公開徵求','財物標售']);
const sorts=new Set(['date','budget','title']);
const allow=(value,set,fallback)=>set.has(value)?value:fallback;
export function readBasicSearchUrl(search){
 const p=new URLSearchParams(String(search||''));
 if(!['mode','q','page','scenario','status','group','min','sort'].some(key=>p.has(key)))return null;
 const num=Number(p.get('page')),rawMin=p.get('min')||'';
 return {
  mode:allow(p.get('mode'),modes,'latest'),
  query:String(p.get('q')||'').slice(0,120),
  page:Number.isInteger(num)&&num>=1&&num<=10000?num:1,
  scenario:allow(p.get('scenario'),scenarios,'all'),
  status:allow(p.get('status'),statusKinds,'全部'),
  group:allow(p.get('group'),groups,'全部'),
  min:/^\d{1,13}$/.test(rawMin)?rawMin:'',
  sort:allow(p.get('sort'),sorts,'date')
 };
}
export function writeBasicSearchUrl(href,state){
 const url=new URL(href),p=url.searchParams,view=p.get('view');
 if(view&&view!=='search')return null;
 if(p.has('case_unit')||p.has('case_no'))return null;
 const s=state||{};
 const set=(key,value,defaultValue)=>{if(value==null||value===''||value===defaultValue)p.delete(key);else p.set(key,String(value));};
 set('mode',allow(s.mode,modes,'latest'),'latest');
 set('q',String(s.query||'').slice(0,120),'');
 const page=Number(s.page);
 set('page',Number.isInteger(page)&&page>1&&page<=10000?page:1,1);
 set('scenario',allow(s.scenario,scenarios,'all'),'all');
 set('status',allow(s.status,statusKinds,'全部'),'全部');
 set('group',allow(s.group,groups,'全部'),'全部');
 const min=String(s.min??'');
 set('min',/^\d{1,13}$/.test(min)?min:'','');
 set('sort',allow(s.sort,sorts,'date'),'date');
 return url.pathname+url.search+url.hash;
}
