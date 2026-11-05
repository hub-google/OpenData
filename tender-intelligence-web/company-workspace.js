// Private company capability library — owner-only Supabase RLS.
import {getClient} from './backend.js';
const $=id=>document.getElementById(id);
const E=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e};
let db=null,user=null,busy=false;
const message=(v)=>{if($('tiCompanyStatus'))$('tiCompanyStatus').textContent=v};
async function login(){
 db=await getClient();const {data,error}=await db.auth.getUser();
 if(error||!data?.user){user=null;message('請先登入或使用測試帳號，才能保存私人公司資料。');return false;}
 user=data.user;return true;
}
async function reload(){
 if(!$('tiCompanyAssets'))return;
 if(!(await login())){ $('tiCompanyAssets').replaceChildren();return;}
 const [{data:profile,error:a},{data:assets,error:b}]=await Promise.all([
  db.from('ti_company_profiles').select('company_name,tax_id,services,company_intro').eq('user_id',user.id).maybeSingle(),
  db.from('ti_company_assets').select('id,asset_type,title,issuer,reference_number,issued_on,expires_on,details,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100)
 ]);
 if(a||b){message('讀取私人資料失敗：'+(a||b).message);return;}
 $('tiCompanyName').value=profile?.company_name||'';
 $('tiCompanyTaxId').value=profile?.tax_id||'';
 $('tiCompanyServices').value=profile?.services||'';
 $('tiCompanyIntro').value=profile?.company_intro||'';
 const out=$('tiCompanyAssets');out.replaceChildren();
 if(!assets?.length)out.append(E('div','尚未建立公司證照、實績或型錄。','empty'));
 for(const a of assets||[]){
  const card=E('div','','ti-asset-row'),top=E('div','','ti-asset-top'),body=E('div','','ti-asset-details');
  top.append(E('strong',a.title),E('span',({certificate:'證照',project:'履約實績',catalogue:'商品型錄',reference:'過往標書',service:'產品／服務'})[a.asset_type]||a.asset_type,'case-tag'));
  const chunks=[a.issuer&&'核發／客戶：'+a.issuer,a.reference_number&&'編號：'+a.reference_number,
   a.expires_on&&'到期：'+a.expires_on,a.details&&'說明：'+a.details];
  body.textContent=chunks.filter(Boolean).join(' · ')||'尚未補充證明來源';
  const remove=E('button','刪除','ghost-btn');remove.type='button';
  remove.addEventListener('click',async()=>{
   if(!window.confirm('刪除此筆私人公司資料？'))return;
   remove.disabled=true;const {error}=await db.from('ti_company_assets').delete().eq('user_id',user.id).eq('id',a.id);
   if(error){message('刪除失敗：'+error.message);remove.disabled=false;return;}await reload();
  });
  card.append(top,body,remove);out.append(card);
 }
 message('已載入自己的公司資料與 '+(assets?.length||0)+' 筆能力紀錄。這些資料由本人填寫，未經官方查證。');
}
async function saveProfile(e){
 e.preventDefault();if(busy||!(await login()))return;
 const tax=$('tiCompanyTaxId').value.trim(),name=$('tiCompanyName').value.trim();
 if(tax&&!/^\d{8}$/.test(tax)){message('統編須為 8 位數字，或留空。');return;}
 const button=$('tiCompanySave');busy=true;button.disabled=true;
 try{
  const row={user_id:user.id,company_name:name.slice(0,150),tax_id:tax||null,
   services:$('tiCompanyServices').value.trim().slice(0,4000),company_intro:$('tiCompanyIntro').value.trim().slice(0,5000),updated_at:new Date().toISOString()};
  const {error}=await db.from('ti_company_profiles').upsert(row,{onConflict:'user_id'});
  if(error)throw error;message('已儲存私人公司資料。');
 }catch(e){message('儲存失敗：'+e.message)}finally{busy=false;button.disabled=false;}
}
async function saveAsset(e){
 e.preventDefault();if(busy||!(await login()))return;
 const type=$('tiAssetType').value,title=$('tiAssetTitle').value.trim();
 if(!title){message('請填寫資料名稱。');return;}
 const button=$('tiAssetSave');busy=true;button.disabled=true;
 try{
  const payload={user_id:user.id,asset_type:type,title:title.slice(0,250),
   issuer:$('tiAssetIssuer').value.trim().slice(0,200),reference_number:$('tiAssetNumber').value.trim().slice(0,150),
   issued_on:$('tiAssetIssued').value||null,expires_on:$('tiAssetExpires').value||null,
   details:$('tiAssetDetails').value.trim().slice(0,5000)};
  if(payload.issued_on&&payload.expires_on&&payload.issued_on>payload.expires_on)throw Error('核發日期不能晚於到期日期');
  const {error}=await db.from('ti_company_assets').insert(payload);if(error)throw error;
  $('tiAssetForm').reset();await reload();
 }catch(e){message('新增資料失敗：'+e.message)}finally{busy=false;button.disabled=false;}
}
function init(){
 if(!$('tiCompanyForm'))return;
 $('tiCompanyForm').addEventListener('submit',saveProfile);
 $('tiAssetForm').addEventListener('submit',saveAsset);
 $('tiCompanyRefresh').addEventListener('click',()=>void reload());
 $('tiCompanyToRadar').addEventListener('click',()=>{
  const s=$('tiCompanyServices').value.trim();
  if(!s){message('先填寫公司的服務項目。');return;}
  $('profileKeywords').value=s.slice(0,500);
  const target=document.querySelector('[data-view="radar"]');if(target)target.click();
  message('已將服務項目填入商機雷達；請在雷達頁儲存條件。');
 });
 document.addEventListener('ti:view-changed',e=>{if(e.detail?.view==='company')void reload();});
 getClient().then(client=>client.auth.onAuthStateChange(()=>{if(!$('view-company').hidden)void reload();})).catch(()=>{});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
