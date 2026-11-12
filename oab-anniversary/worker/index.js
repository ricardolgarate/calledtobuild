const PUBLIC_ASSETS = /*__PUBLIC_ASSETS__*/ {};
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const CAMPAIGN='oab-third-birthday-2026';
let cachedAuth=null;
const limits=new Map();
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:HEADERS});}
function clean(value,max=100){return typeof value==='string'?value.normalize('NFKC').trim().slice(0,max):'';}
function codeKey(code){return clean(code,80).replace(/\s+/g,'').toLocaleLowerCase('en');}
function phoneKey(phone){const digits=String(phone||'').replace(/\D/g,'');return digits.length===11&&digits[0]==='1'?digits.slice(1):digits;}
function allClients(env){
  try{const rows=JSON.parse(env.OAB_REFERRAL_CODES||'[]');return Array.isArray(rows)?rows.filter(row=>typeof row.clientName==='string'&&row.clientName.trim()):[];}catch{return [];}
}
function directory(env){return allClients(env).filter(row=>row.lookupEnabled!==false&&row.referralCode);}
function nameKey(name){return clean(name,100).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
async function clientId(row){return (await hash('oab-client|'+row.clientName+'|'+(row.referralCode||''))).slice(0,24);}
function findCode(env,code){const key=codeKey(code);return directory(env).find(row=>codeKey(row.referralCode)===key);}
function originAllowed(request){return request.headers.get('Origin')===new URL(request.url).origin;}
function rateAllowed(request,bucketName='claim',maximum=20){
  const key=bucketName+'|'+(request.headers.get('CF-Connecting-IP')||'unknown');const now=Date.now();
  if(limits.size>2000)for(const [ip,bucket]of limits)if(now-bucket.start>600000)limits.delete(ip);
  const bucket=limits.get(key);
  if(!bucket||now-bucket.start>600000){if(limits.size>=2000)limits.delete(limits.keys().next().value);limits.set(key,{start:now,count:1});return true;}
  bucket.count++;return bucket.count<=maximum;
}
async function bodyOf(request){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw new Error('bad_body');
  if(Number(request.headers.get('Content-Length')||0)>4096)throw new Error('bad_body');
  const reader=request.body?.getReader();if(!reader)throw new Error('bad_body');
  const chunks=[];let length=0;
  while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>4096){await reader.cancel();throw new Error('bad_body');}chunks.push(next.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const text=new TextDecoder().decode(bytes);
  const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('bad_body');return value;
}
function config(env){try{return JSON.parse(env.OAB_CRM_CONFIG||'{}');}catch{return {};}}
async function trackerAuth(env){
  const cfg=config(env);if(!cfg.apiKey||!cfg.projectId||!cfg.uid||!cfg.refreshToken)throw new Error('tracker_not_configured');
  if(cachedAuth?.uid===cfg.uid&&cachedAuth.expires>Date.now()+60000)return {...cfg,idToken:cachedAuth.idToken};
  const response=await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:cfg.refreshToken}),signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('tracker_auth_failed');
  const data=await response.json();if(!data.id_token||data.user_id!==cfg.uid)throw new Error('tracker_auth_failed');
  cachedAuth={uid:cfg.uid,idToken:data.id_token,expires:Date.now()+Number(data.expires_in||3600)*1000};
  return {...cfg,idToken:data.id_token};
}
function field(value){
  if(value===null)return{nullValue:null};
  if(typeof value==='number')return{integerValue:String(value)};
  if(typeof value==='boolean')return{booleanValue:value};
  if(Array.isArray(value))return{arrayValue:{values:value.map(field)}};
  if(value&&typeof value==='object')return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,field(v)]))}};
  return{stringValue:String(value??'')};
}
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function safeFirstName(name){return clean(name,70)&&!/[\u0000-\u001f\u007f<>]/.test(name);}
async function createLead(env,input,referrer){
  const auth=await trackerAuth(env);const now=new Date().toISOString();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const leadId='oab_birthday_'+(await hash(CAMPAIGN+'|'+phoneKey(input.phone))).slice(0,32);
  const notes=`OAB 3rd birthday referral claim\nReferral code: ${referrer.referralCode}\nReferred by: ${referrer.clientName}\nFirst name: ${input.firstName}\nLast name: ${input.lastName}\nPhone: ${input.phone}\nRequested: free in-person consultation; $150 off a home organizing order of $1,200 or more.\nReferral reward counts completed consultations, not form claims. Schedule all 3 by December 31, 2026.\nOffer has no cash value.`;
  const lead={name:input.firstName+' '+input.lastName,firstName:input.firstName,lastName:input.lastName,phone:input.phone,email:'',source:'Referral',stage:'Not Contacted Yet',owner:'Unassigned',pain:'',spaceNeeded:'',deadline:'',decisionMaker:'Unknown',budget:'Unknown',city:'',lastTouch:today,nextFollowUpDate:today,lostReason:'',notes,referralCode:referrer.referralCode,referredBy:referrer.clientName,campaignId:CAMPAIGN,landingPageVariant:'referral-b',requestedService:'Free in-person consultation',consultationCompleted:false,consultationScheduledDate:'',closedAmount:0,stageHistory:[{stage:'Not Contacted Yet',date:today,createdAt:now}]};
  const fields=Object.fromEntries(Object.entries(lead).map(([key,value])=>[key,field(value)]));fields.createdAt={timestampValue:now};fields.updatedAt={timestampValue:now};
  const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/databases/(default)/documents/users/${encodeURIComponent(auth.uid)}/leads`;
  const response=await fetch(`${base}?documentId=${encodeURIComponent(leadId)}`,{method:'POST',headers:{'Authorization':'Bearer '+auth.idToken,'Content-Type':'application/json'},body:JSON.stringify({fields}),signal:AbortSignal.timeout(12000)});
  if(response.status===409){
    const existing=await fetch(base+'/'+leadId,{headers:{'Authorization':'Bearer '+auth.idToken},signal:AbortSignal.timeout(12000)});
    if(existing.ok)return {ok:true,leadId,duplicate:true};
    throw new Error('tracker_duplicate_unconfirmed');
  }
  if(!response.ok)throw new Error('tracker_write_failed');
  return{ok:true,leadId,duplicate:false};
}
async function api(request,env,path){
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed',message:'Please use the form to send your request.'},405);
  if(!originAllowed(request))return json({ok:false,error:'origin_not_allowed',message:'Please open the form on the OAB website.'},403);
  const isLookup=path!=='/api/referrals';
  if(!rateAllowed(request,isLookup?'lookup':'claim',isLookup?60:20))return json({ok:false,error:'rate_limited',message:'Please wait a few minutes before trying again.'},429);
  let input;try{input=await bodyOf(request);}catch{return json({ok:false,error:'invalid_body',message:'Please check your details and try again.'},400);}
  if(path==='/api/referral-clients'){
    const query=nameKey(input.query||'');
    if(query.replace(/\s/g,'').length<3)return json({ok:true,matches:[]});
    const words=query.split(/\s+/);
    const matches=allClients(env).filter(row=>{
      const parts=nameKey(row.clientName).split(/\s+/);
      return words.every(word=>parts.some(part=>part.startsWith(word)));
    }).sort((a,b)=>{
      const aStarts=nameKey(a.clientName).startsWith(query),bStarts=nameKey(b.clientName).startsWith(query);
      return Number(bStarts)-Number(aStarts)||a.clientName.localeCompare(b.clientName);
    }).slice(0,5);
    return json({ok:true,matches:await Promise.all(matches.map(async row=>({id:await clientId(row),name:row.clientName,canShare:row.lookupEnabled!==false&&Boolean(row.referralCode)})))});
  }
  if(path==='/api/referral-code'&&input.clientId){
    const selectedId=clean(input.clientId,80);
    if(!/^[a-f0-9]{24}$/.test(selectedId))return json({ok:false,error:'client_not_found',message:'Please choose your name from the list.'},400);
    let selected=null;
    for(const row of allClients(env))if(await clientId(row)===selectedId){selected=row;break;}
    if(!selected)return json({ok:false,error:'client_not_found',message:'Please choose your name from the list again.'},400);
    if(selected.lookupEnabled===false||!selected.referralCode)return json({ok:false,error:'code_not_ready',message:'Your name is here, but OAB has not added your code yet. Text OAB and we’ll help.'},409);
    return json({ok:true,clientName:selected.clientName,referralCode:selected.referralCode});
  }
  const referralCode=clean(input.referralCode,80);const referrer=findCode(env,referralCode);
  if(!referrer)return json({ok:false,error:'invalid_referral_code',field:'referralCode',message:'Please check the code from your friend’s OAB text.'},400);
  if(path==='/api/referral-code'){
    const name=clean(input.name,100);if(!name)return json({ok:false,field:'name',message:'Please add your name.'},400);
    return json({ok:true,referralCode:referrer.referralCode});
  }
  const firstName=clean(input.firstName,70),lastName=clean(input.lastName,70),phone=phoneKey(input.phone);
  if(!safeFirstName(firstName))return json({ok:false,field:'firstName',message:'Please add your first name.'},400);
  if(!safeFirstName(lastName))return json({ok:false,field:'lastName',message:'Please add your last name.'},400);
  if(!/^\d{10,15}$/.test(phone)||/[A-Za-z]/.test(String(input.phone||'')))return json({ok:false,field:'phone',message:'Please add a valid phone number.'},400);
  if(phone===phoneKey(referrer.phoneDigits))return json({ok:false,field:'referralCode',message:'This offer is for referred friends. Please use the code of the past client who sent you.'},400);
  try{return json(await createLead(env,{firstName,lastName,phone},referrer));}
  catch{return json({ok:false,error:'tracker_unavailable',message:'We could not save your request. Please try again, or text OAB at 469-476-5735. Your details are still in the form.'},503);}
}
function staticFile(path){
  const file=PUBLIC_ASSETS[path];if(!file)return new Response('Page not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  const bytes=Uint8Array.from(atob(file.base64),char=>char.charCodeAt(0));
  return new Response(bytes,{headers:{'Content-Type':file.type,'Cache-Control':file.type.startsWith('image/')?'public, max-age=86400':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
}
export default{async fetch(request,env){
  const url=new URL(request.url);const path=url.pathname;
  if(path==='/api/referrals'||path==='/api/referral-code'||path==='/api/referral-clients')return api(request,env,path);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
  if(['/referral','/referral/','/referral/index.html','/index.html'].includes(path))return Response.redirect(new URL('/'+url.search,url.origin).href,308);
  if(['/pastcustomers/','/pastcustomers/index.html'].includes(path))return Response.redirect(new URL('/pastcustomers'+url.search,url.origin).href,308);
  const normalized=path==='/'?'/referral/index.html':path==='/pastcustomers'?'/index.html':path;
  const response=staticFile(normalized);return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
}};
