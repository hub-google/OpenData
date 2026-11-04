// Live, read-only readiness and unauthorized-request regression.
// Never sends a payment, customer message, or a dispatch instruction.
import assert from 'node:assert/strict';
const origin='https://unapiwajmgqqtdkixaab.supabase.co/functions/v1';
const timeout=15000;
async function read(path,init={}){
 const response=await fetch(origin+path,{...init,signal:AbortSignal.timeout(timeout)});
 const body=await response.text();
 return {response,body};
}
const status=await read('/ti-service-status');
assert.equal(status.response.status,200,'Public service-readiness endpoint failed: '+status.body.slice(0,180));
const flags=JSON.parse(status.body);
for(const name of ['ai_ready','email_ready','line_login_ready','line_push_ready'])
 assert.equal(typeof flags[name],'boolean',name+' must report a boolean, not fake success');
console.log('PASS service readiness: '+JSON.stringify({
 ai:flags.ai_ready,email:flags.email_ready,line_login:flags.line_login_ready,line_push:flags.line_push_ready
}));
const plans=await read('/ti-billing?mode=plans');
assert.equal(plans.response.status,200,'Billing plans endpoint failed: '+plans.body.slice(0,160));
const billing=JSON.parse(plans.body);
assert.equal(typeof billing.ready,'boolean','Billing must tell customers if checkout is ready');
console.log('PASS billing readiness '+JSON.stringify({
 ready:billing.ready,supports_recurring:billing.supports_recurring
}));
for(const slug of ['ti-ingest','ti-notify']){
 const result=await read('/'+slug,{
  method:'POST',headers:{'content-type':'application/json'},body:'{}'
 });
 assert.equal(result.response.status,401,slug+' accepted an unauthenticated task: '+result.body.slice(0,150));
 console.log('PASS '+slug+' rejects unauthorized dispatch');
}
const rss=await read('/ti-rss');
assert.equal(rss.response.status,200,'Public real-announcement RSS failed: '+rss.body.slice(0,250));
assert.ok(rss.body.includes('<rss')&&rss.body.includes('<item>'),'RSS did not return live indexed notices');
console.log('PASS RSS returns source-backed items');
console.log('ALL TENDER SERVICE HEALTH AND ACCESS-CONTROL CHECKS PASSED');
