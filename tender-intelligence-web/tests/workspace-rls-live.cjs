// Multi-account RLS test on the deployed procurement website and live Supabase.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const BASE='https://hub-google.github.io/OpenData/tender-intelligence-web/';
const OUT='tender-intelligence-web/audits/workspace';
fs.mkdirSync(OUT,{recursive:true});
const results=[],exceptions=[];const stamp=Date.now().toString(36);
let browser,owner,member,outsider,workspaceId,inviteToken;
const short=x=>String(x?.message||x||'').replace(/\s+/g,' ').slice(0,450);
async function step(name,fn){try{const data=await fn();results.push({name,status:'PASS',data});console.log('PASS',name,JSON.stringify(data).slice(0,470));}catch(e){results.push({name,status:'FAIL',error:short(e)});console.error('FAIL',name,short(e));}}
async function login(p){
 await p.goto(BASE,{waitUntil:'domcontentloaded',timeout:45000});
 await p.locator('#accountDemoQuick').click();
 await p.waitForFunction(()=>document.querySelector('#accountButton')?.textContent?.includes('測試帳號已登入'),null,{timeout:30000});
}
async function navigate(p,view){
 const b=p.locator('[data-view="'+view+'"]').first(),g=b.locator('xpath=ancestor::details[1]');
 if(await g.count()&&(await g.getAttribute('open'))===null)await g.locator('summary').click();
 await b.click();
}
async function db(p,expression,args){
 return p.evaluate(async({expression,args})=>{
  const {getClient}=await import('./backend.js');
  const client=await getClient();
  switch(expression){
   case 'identity':return (await client.auth.getUser()).data.user.id;
   case 'visible':{
    const ids=['ti_workspaces','ti_workspace_members','ti_workspace_tasks'];
    const all=await Promise.all(ids.map(t=>client.from(t).select('workspace_id,id,title,role',{count:'exact'}).eq(t==='ti_workspaces'?'id':'workspace_id',args.id)));
    return all.map((r,i)=>({table:ids[i],count:r.data?.length,error:r.error?.message}));
   }
   case 'read':{
    const r=await client.from('ti_workspace_tasks').select('id,title').eq('workspace_id',args.id);
    return {titles:r.data?.map(x=>x.title),error:r.error?.message};
   }
   case 'write':{
    const user=(await client.auth.getUser()).data.user;
    const r=await client.from('ti_workspace_tasks').insert({workspace_id:args.id,created_by:user.id,title:args.title});
    return {error:r.error?.message,code:r.error?.code};
   }
   case 'set-role':{
    const r=await client.rpc('ti_set_workspace_member_role',{p_workspace:args.id,p_member:args.member,p_role:args.role});
    return {data:r.data,error:r.error?.message};
   }
   case 'delete':{
    const user=(await client.auth.getUser()).data.user;
    const r=await client.from('ti_workspaces').delete().eq('id',args.id).eq('owner_id',user.id);
    return {error:r.error?.message};
   }
   case 'count':{
    const r=await client.from('ti_workspace_members').select('user_id,role').eq('workspace_id',args.id);
    return {roles:r.data,error:r.error?.message};
   }
   case 'replay':{
    const r=await client.rpc('ti_accept_workspace_invite',{token:args.token});
    return {data:r.data,error:r.error?.message};
   }
   default:throw Error('unknown test query');
  }
 },{expression,args});
}
async function main(){
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 async function create(){
  const ctx=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei',viewport:{width:1280,height:900}});
  const p=await ctx.newPage();p.on('pageerror',e=>exceptions.push(short(e)));return p;
 }
 [owner,member,outsider]=await Promise.all([create(),create(),create()]);
 await step('Owner creates workspace and a shared task',async()=>{
  await login(owner);await navigate(owner,'team');
  await owner.locator('#workspaceName').fill('【自動測試-'+stamp+'】隔離工作區');
  await owner.locator('#workspaceCreateForm button[type=submit]').click();
  const loaded=await owner.waitForFunction(()=>document.querySelector('#workspaceSelect')?.value?.length===36,null,{timeout:50000}).then(()=>true).catch(()=>false);
  if(!loaded){
   await owner.locator('#workspaceRefresh').click();
   const retry=await owner.waitForFunction(()=>document.querySelector('#workspaceSelect')?.value?.length===36,null,{timeout:20000}).then(()=>true).catch(()=>false);
   if(!retry){
    const diagnostic=await owner.evaluate(async()=>{
     const {getClient}=await import('./backend.js'),db=await getClient(),
      {data,error}=await db.from('ti_workspaces').select('id,name,owner_id').limit(3);
     return {status:document.querySelector('#workspaceOutput')?.textContent?.slice(0,600),
      select:document.querySelector('#workspaceSelect')?.value,toast:document.querySelector('#toast')?.textContent,
      user:document.querySelector('#accountButton')?.textContent,rows:data,error:error?.message};
    });
    throw Error('建立後工作區列表未顯示：'+JSON.stringify(diagnostic).slice(0,650));
   }
  }
  workspaceId=await owner.locator('#workspaceSelect').inputValue();
  await owner.getByPlaceholder('例如：準備報價附件').fill('WORKSPACE-RLS-'+stamp);
  await owner.getByRole('button',{name:'建立團隊待辦'}).click({force:true,timeout:20000});
  await owner.waitForFunction(s=>document.querySelector('#workspaceOutput')?.textContent?.includes(s),'WORKSPACE-RLS-'+stamp,{timeout:35000});
  return {workspace_created:true,task_visible:true};
 });
 await step('Owner generates single-use invitation; member joins',async()=>{
  await owner.locator('#workspaceInvite').click();
  await owner.waitForFunction(()=>document.querySelector('#workspaceInviteLink')?.textContent?.includes('?invite='),null,{timeout:35000});
  const url=await owner.locator('#workspaceInviteLink').innerText();
  inviteToken=url.match(/[?&]invite=([0-9a-f]{48})/)?.[1];
  if(!inviteToken)throw Error('邀請連結未包含有效一次性憑證');
  await login(member);await navigate(member,'team');
  await member.locator('#workspaceJoinCode').fill(inviteToken);
  await member.locator('#workspaceJoinForm button[type=submit]').click();
  const joined=await member.waitForFunction(async(id)=>{
   const {getClient}=await import('./backend.js'),client=await getClient();
   const {data,error}=await client.from('ti_workspace_members').select('user_id').eq('workspace_id',id);
   const self=(await client.auth.getUser()).data.user?.id;
   return !error&&data?.some(x=>x.user_id===self);
  },workspaceId,{timeout:35000}).then(()=>true).catch(()=>false);
  if(!joined)throw Error('邀請碼未讓新帳戶完成工作區成員資料寫入');
  await member.locator('#workspaceRefresh').click();
  await member.waitForFunction(s=>document.querySelector('#workspaceOutput')?.textContent?.includes(s),'WORKSPACE-RLS-'+stamp,{timeout:30000});
  const read=await db(member,'read',{id:workspaceId});
  if(!read.titles?.some(x=>x.includes(stamp)))throw Error('加入後仍無法讀取共享任務');
  return {joined:true,task_count:read.titles.length};
 });
 await step('Uninvited third account cannot read, write, or replay invitation',async()=>{
  await login(outsider);
  const r=await db(outsider,'read',{id:workspaceId});
  const write=await db(outsider,'write',{id:workspaceId,title:'illegal-'+stamp});
  const replay=await db(outsider,'replay',{token:inviteToken});
  const role=await db(outsider,'set-role',{id:workspaceId,member:await db(outsider,'identity',{}),role:'admin'});
  if(r.error||r.titles?.length!==0||!write.error||!replay.error||!role.error)
    throw Error('RLS or one-time invite failed: '+JSON.stringify({read:r,write,replay,role}).slice(0,580));
  return {outsider_visible:0,insert_denied:true,invite_replay_denied:true,escalation_denied:true};
 });
 await step('Owner changes editor to viewer; viewer remains read-only even via Data API',async()=>{
  await owner.locator('#workspaceRefresh').click();
  await owner.locator('#workspaceOutput .ti-team-role-row select').first().waitFor({timeout:14000});
  const memberId=await db(member,'identity',{});
  await owner.locator('#workspaceOutput .ti-team-role-row select').first().selectOption('viewer');
  let roles;
  for(let i=0;i<28;i++){
   roles=await db(owner,'count',{id:workspaceId});
   if(roles.roles?.some(x=>x.user_id===memberId&&x.role==='viewer'))break;
   await owner.waitForTimeout(450);
  }
  if(!roles.roles?.some(x=>x.user_id===memberId&&x.role==='viewer'))throw Error('角色未持久化');
  const rejected=await db(member,'write',{id:workspaceId,title:'viewer-should-not-write'});
  const self=await db(member,'set-role',{id:workspaceId,member:memberId,role:'admin'});
  const visible=await db(member,'read',{id:workspaceId});
  if(!rejected.error||!self.error||visible.titles?.length!==1)throw Error('唯讀角色越權：'+JSON.stringify({rejected,self,visible}));
  await member.locator('#workspaceRefresh').click();
  await member.waitForFunction(()=>document.querySelector('#workspaceOutput')?.textContent?.includes('你的權限：viewer'),null,{timeout:12000});
  if(await member.getByRole('button',{name:'建立團隊待辦'}).count())throw Error('唯讀成員仍可看到建立任務按鈕');
  await owner.screenshot({path:path.join(OUT,'owner-role-controls.png')});
  await member.screenshot({path:path.join(OUT,'viewer-read-only.png')});
  return {viewer_can_read:true,viewer_cannot_write:true,viewer_cannot_escalate:true};
 });
 await step('Owner restores editor; editor can add a shared task',async()=>{
  const memberId=await db(member,'identity',{});
  await owner.locator('#workspaceOutput .ti-team-role-row select').first().selectOption('editor');
  let roles;
  for(let i=0;i<28;i++){
   roles=await db(member,'count',{id:workspaceId});
   if(roles.roles?.some(x=>x.user_id===memberId&&x.role==='editor'))break;
   await owner.waitForTimeout(450);
  }
  if(!roles.roles?.some(x=>x.user_id===memberId&&x.role==='editor'))throw Error('編輯者角色未還原');
  const wrote=await db(member,'write',{id:workspaceId,title:'EDITOR-CREATED-'+stamp});
  if(wrote.error)throw Error('編輯者仍無法寫入：'+wrote.error);
  return {editor_write:true};
 });
 await step('Owner removes member; access is revoked immediately',async()=>{
  owner.once('dialog',dialog=>dialog.accept());
  await owner.locator('#workspaceOutput .ti-team-role-row button').first().click();
  await owner.waitForFunction(()=>!document.querySelector('#workspaceOutput .ti-team-role-row'),null,{timeout:18000});
  const after=await db(member,'read',{id:workspaceId});
  if(after.error||after.titles?.length!==0)throw Error('成員移除後仍能看私人共享任務：'+JSON.stringify(after));
  return {member_revoke_effective:true};
 });
}
main().catch(e=>results.push({name:'Setup',status:'FAIL',error:short(e)}))
.finally(async()=>{
 if(owner&&workspaceId){
  try{const removed=await db(owner,'delete',{id:workspaceId});console.log('CLEANUP',JSON.stringify(removed));}
  catch(e){console.log('CLEANUP ERROR',short(e));}
 }
 try{await browser?.close()}catch{}
 const payload={generated_at:new Date().toISOString(),target:BASE,
  browser:'Playwright: 3 isolated anonymous signed-in accounts + real RLS',results,page_errors:exceptions};
 fs.writeFileSync(path.join(OUT,'workspace-rls-report.json'),JSON.stringify(payload,null,2));
 console.log('WORKSPACE_RLS',results.filter(r=>r.status==='PASS').length,'/',results.length,'errors',exceptions.length);
 if(results.some(r=>r.status!=='PASS')||exceptions.length)process.exitCode=1;
});
