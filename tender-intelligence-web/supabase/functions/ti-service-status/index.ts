// Public readiness flags only; never disclose secret values or user information.
Deno.serve(req=>{
 const c={"Access-Control-Allow-Origin":"https://hub-google.github.io","Cache-Control":"no-store"};
 if(req.method!=="GET")return Response.json({error:"GET only"},{status:405,headers:c});
 return Response.json({
  ai_ready:Boolean(Deno.env.get("OPENAI_API_KEY")),
  email_ready:Boolean(Deno.env.get("RESEND_API_KEY"))&&Boolean(Deno.env.get("TI_EMAIL_FROM")),
  line_login_ready:Boolean(Deno.env.get("TI_LINE_LOGIN_CHANNEL_ID"))&&Boolean(Deno.env.get("TI_LINE_LOGIN_CHANNEL_SECRET")),
  line_push_ready:Boolean(Deno.env.get("TI_LINE_CHANNEL_ACCESS_TOKEN")),
  note:"Only configuration presence. Does not prove delivery, provider permissions, or billing."
 },{headers:c});
});