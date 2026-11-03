// Live smoke test for the isolated one-click demo. Never touches production customer tickets.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {DATABASE_URL,PUBLISHABLE_KEY} from '../backend.js';

const API=DATABASE_URL+'/functions/v1/ti-support';
const createDemo=async()=>{
 const sb=createClient(DATABASE_URL,PUBLISHABLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 });
 const {data,error}=await sb.auth.signInAnonymously();
 if(error)throw Error('Anonymous sign-in failed: '+error.message);
 assert.ok(data.session?.access_token,'no token returned');
 assert.equal(data.user?.is_anonymous,true,'not an anonymous account');
 return {sb,access_token:data.session.access_token,token:randomBytes(32).toString('hex'),user:data.user};
};
const call=async(demo,action,params={},expected=200)=>{
 const response=await fetch(API,{
  method:'POST',headers:{
   'content-type':'application/json',
   apikey:PUBLISHABLE_KEY,
   authorization:'Bearer '+demo.access_token
  },body:JSON.stringify({action,visitor_token:demo.token,...params}),signal:AbortSignal.timeout(30000)
 });
 const json=await response.json();
 assert.equal(response.status,expected,action+' expected '+expected+' got '+response.status+': '+JSON.stringify(json));
 return json;
};
const demos=[];
try{
 const first=await createDemo();demos.push(first);
 const boot=await call(first,'bootstrap');
 assert.equal(boot.demo_mode,true);
 assert.equal(boot.staff,true);
 assert.equal(boot.signed_in,true);
 const seeded=await call(first,'admin_list');
 assert.ok(seeded.threads.length>=2,'demo tickets did not seed');
 assert.ok(seeded.threads.every(t=>t.user_id===first.user.id),'staff accessed other users');
 const target=seeded.threads[0];
 const initial=await call(first,'admin_read',{thread_id:target.id});
 assert.equal(initial.thread.is_demo,true);
 assert.ok(initial.messages.length>0);
 const posted=await call(first,'admin_reply',{thread_id:target.id,message:'驗收測試：管理員已回覆'});
 assert.equal(posted.ok,true);
 const customer=await call(first,'read',{thread_id:target.id});
 assert.ok(customer.messages.some(m=>m.role==='staff'&&m.body.includes('驗收測試')));
 await call(first,'admin_status',{thread_id:target.id,status:'closed'});
 const form=await call(first,'form',{
  category:'system',subject:'Demo smoke test ticket',
  message:'This is an isolated integration-test report, not a real customer request.'
 },201);
 const supplement=await call(first,'customer_reply',{thread_id:form.thread_id,message:'測試使用者補充留言'});
 assert.equal(supplement.ok,true);
 const second=await createDemo();demos.push(second);
 const next=await call(second,'bootstrap');
 assert.equal(next.demo_mode,true);
 const outsider=await call(second,'admin_read',{thread_id:form.thread_id},404);
 assert.ok(outsider.error);
 const outsiderCustomer=await call(second,'read',{thread_id:form.thread_id},400);
 assert.ok(outsiderCustomer.error);
 const otherInbox=await call(second,'admin_list');
 assert.ok(otherInbox.threads.length>=2);
 assert.ok(otherInbox.threads.every(t=>t.user_id===second.user.id));
 await call(first,'demo_reset');
 const afterReset=await call(first,'admin_list');
 assert.ok(afterReset.threads.length>=2);
 console.log('PASS: one-click anonymous login, demo bootstrap, sample tickets, staff reply, customer reply, status, isolation, reset.');
}finally{
 for(const d of demos){
  try{await call(d,'demo_clear');}catch(e){console.error('Demo cleanup failed:',String(e).slice(0,140));}
  try{await d.sb.auth.signOut();}catch{}
 }
}
