// AI Risk Lab · SINGLE-FILE Cloudflare Worker · Copy ALL this text into Cloudflare → Edit code.
// Existing Worker name, D1 binding DB, DASHBOARD_TOKEN and APP_ORIGIN stay unchanged.
// Cloudflare D1 stores encrypted dashboard-managed keys and alert configuration (no extra schema).

// Pure rules, intentionally isolated for offline tests. Percent values are percentage points.
const STATUS = ['unknown', 'clear', 'watch', 'serious', 'review'];
const isoDay = (s) => String(s ?? '').slice(0, 10);
function sma(data, days) {
  if (!Array.isArray(data) || data.length < days) return null;
  const sample = data.slice(-days);
  return sample.reduce((sum, entry) => sum + entry.value, 0) / days;
}
function percentChange(current, base) {
  return Number.isFinite(current) && Number.isFinite(base) && base > 0
    ? (current / base - 1) * 100 : null;
}
function latestAtLeast(data, days) {
  if (!data?.length) return null;
  const end = new Date(`${data.at(-1).date}T00:00:00Z`).getTime();
  const target = end - days * 86400e3;
  for (let i = data.length - 2; i >= 0; i--) {
    if (Date.parse(data[i].date + 'T00:00:00Z') <= target) return data[i];
  }
  return null;
}
function evaluateNasdaq(data) {
  if (!data || data.length < 200) return {status:'unknown', reason:'Fewer than 200 trading-session observations', value:null};
  const last = data.at(-1), m50=sma(data,50),m200=sma(data,200),old200=data.length >= 220 ? sma(data.slice(0,-20),200) : null;
  const dist50=percentChange(last.value,m50),dist200=percentChange(last.value,m200);
  const p5=data.length>5?percentChange(last.value,data.at(-6).value):null;
  const p20=data.length>20?percentChange(last.value,data.at(-21).value):null;
  // 200D is slow and not a complete sell signal. Serious demands confirming 50D weakness.
  let status='clear';
  if(last.value < m200 && last.value < m50 && (old200 === null || m200 < old200)) status='serious';
  else if(last.value < m50 || last.value < m200) status='watch';
  return {status, asof:last.date, value:+dist200.toFixed(2),
    reason:`${status==='serious'?'SERIOUS: The Nasdaq-100 finished BELOW both its 50-day and 200-day averages, with the long-term average falling or insufficient slope history.':status==='watch'?'MODERATE: The Nasdaq-100 is BELOW at least one of its 50-day or 200-day averages. This is weakening price momentum, not a proven crash.':'LOW for this price-trend rule: The Nasdaq-100 is ABOVE both its 50-day and 200-day averages.'} Latest index close: ${last.value.toFixed(1)}. It is ${Math.abs(dist50).toFixed(1)}% ${dist50<0?'BELOW':'ABOVE'} its 50-day average (${m50.toFixed(1)}) and ${Math.abs(dist200).toFixed(1)}% ${dist200<0?'BELOW':'ABOVE'} its 200-day average (${m200.toFixed(1)}). Over the last 5 trading sessions: ${p5?.toFixed(1)??'n/a'}%; last 20: ${p20?.toFixed(1)??'n/a'}%. Rule: below either average = Moderate; below both with falling 200-day average = Serious. This is a Nasdaq-100 INDEX proxy, not QQQM or a forecast.`,
    metrics:{index:last.value,sma50:m50,sma200:m200,pctSma50:dist50,pctSma200:dist200,change5:p5,change20:p20}};
}
function evaluateShock(data) {
  if (!data || data.length < 22) return {status:'unknown',reason:'Need 22 daily observations',value:null};
  const last=data.at(-1),p5=percentChange(last.value,data.at(-6).value),p20=percentChange(last.value,data.at(-21).value);
  // Heuristics explicitly labeled, prompt investigation not trades.
  const status = p5 <= -10 + 1e-8 || p20 <= -20 + 1e-8 ? 'serious' : p5 <= -6 + 1e-8 || p20 <= -12 + 1e-8 ? 'watch' : 'clear';
  return {status,asof:last.date,value:+p5.toFixed(2),reason:`${status==='serious'?'SERIOUS rapid-decline rule triggered.':status==='watch'?'MODERATE rapid-decline rule triggered.':'LOW for this rapid-decline rule; no loss threshold crossed.'} Nasdaq-100 changed ${p5.toFixed(2)}% over 5 trading sessions and ${p20.toFixed(2)}% over 20 sessions. Moderate if 5-day loss reaches 6% or 20-day loss reaches 12%; Serious if 5-day loss reaches 10% or 20-day loss reaches 20%. A decline itself does not predict future direction.`,metrics:{change5:p5,change20:p20}};
}
function evaluateVix(data) {
  if (!data?.length) return {status:'unknown',reason:'No published VIX observation',value:null};
  const latest=data.at(-1);
  return {status:latest.value>=35?'serious':latest.value>=25?'watch':'clear',asof:latest.date,
    value:latest.value,reason:`${latest.value>=35?'SERIOUS:':latest.value>=25?'MODERATE:':'LOW for this volatility threshold:'} Latest published VIX is ${latest.value.toFixed(2)}. This rule flags Moderate at VIX 25 or above and Serious at 35 or above. VIX reflects expected near-term S&P 500 volatility, not the probability of a crash, and can jump after prices fall.`};
}
function evaluateCredit(data) {
  if (!data?.length) return {status:'unknown',reason:'No credit spread observations',value:null};
  const last=data.at(-1),window=data.filter(x=>Date.parse(x.date)>=Date.parse(last.date)-183*86400e3);
  if(window.length < 20) return {status:'unknown',reason:'Insufficient data for 6-month spread low',value:null};
  const low=Math.min(...window.map(x=>x.value)),riseBps=Math.round((last.value-low)*100);
  return {status:riseBps>=200?'serious':riseBps>=100?'watch':'clear',asof:last.date,value:riseBps,
    reason:`${riseBps>=200?'SERIOUS: Credit spreads widened at least 200 basis points from their six-month low.':riseBps>=100?'MODERATE: Credit spreads widened at least 100 basis points from their six-month low.':'LOW for this spread-widening rule: the 100-basis-point alert threshold was not crossed.'} Latest US high-yield option-adjusted spread is ${last.value.toFixed(2)} percentage points; its six-month low was ${low.toFixed(2)} points. Difference = ${riseBps} basis points (100 basis points = 1 percentage point). Credit spreads rising can signal greater perceived default risk; this is not a market crash forecast.`,metrics:{spread:last.value,low,riseBps}};
}
function evaluateRealYield(data) {
  if (!data?.length) return {status:'unknown',reason:'Real-yield series not available',value:null};
  const last=data.at(-1);
  return {status:'review',asof:last.date,value:last.value,reason:`10-year TIPS real yield ${last.value.toFixed(2)}%; context only; no risk status can be concluded from yields alone.`};
}
function parseFred(json) {
  if (!Array.isArray(json?.observations)) throw new Error('FRED observations missing');
  return json.observations.filter(x=>x.value!=='.' && Number.isFinite(Number(x.value)))
   .map(x=>({date:x.date,value:Number(x.value)})).sort((a,b)=>a.date.localeCompare(b.date));
}
function normaliseCheckStatus(s) { return STATUS.includes(s) ? s : 'unknown'; }
function short(s,n=340){return String(s??'').slice(0,n)}

// Weekly RSI from the latest available close in each UTC Monday-to-Sunday market week.
// It is the NASDAQ-100 index, NOT an adjusted QQQM ETF weekly RSI.
function evaluateWeeklyRsi(data) {
 if (!data?.length) return {status:'unknown',reason:'No daily index history for weekly RSI'};
 const byWeek=new Map();
 for(const x of data){
  const d=new Date(x.date+'T00:00:00Z');
  if(!Number.isFinite(+d))continue;
  const monday=new Date(+d-((d.getUTCDay()+6)%7)*86400e3).toISOString().slice(0,10);
  // Source is sorted by date; the last dated close within each week wins.
  byWeek.set(monday,x);
 }
 const bars=[...byWeek.values()];
 if(bars.length<16)return {status:'unknown',reason:'Need at least 16 weekly closing observations'};
 let gain=0,loss=0;
 for(let i=1;i<=14;i++){
  const diff=bars[i].value-bars[i-1].value;
  gain+=Math.max(0,diff);loss+=Math.max(0,-diff);
 }
 gain/=14;loss/=14;
 for(let i=15;i<bars.length;i++){
  const diff=bars[i].value-bars[i-1].value;
  gain=(gain*13+Math.max(0,diff))/14;
  loss=(loss*13+Math.max(0,-diff))/14;
 }
 const rsi=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
 const last=bars.at(-1);
 return {status:'review',value:+rsi.toFixed(2),asof:last.date,
  reason:`NASDAQ-100 14-week RSI ${rsi.toFixed(1)} from weekly index closing observations (not adjusted QQQM data). ${rsi>70?'High momentum can persist;':rsi<30?'Low momentum can persist;':'Midrange momentum;'} RSI alone does not establish bearish divergence or justify a sale. Review price/RSI peaks manually.`,
  metrics:{rsi14:rsi,weeklyBars:bars.length,indexClose:last.value}};
}


// Alert Center configuration and encrypted, optional browser-managed provider credentials.
// Stored using existing D1 cursors table. DASHBOARD_TOKEN must remain a Cloudflare Worker secret.
const AC_SETTINGS_KEY='ui:alert-settings:v1';
const AC_KEYS_KEY='ui:encrypted-credentials:v1';
const AC_KEY_FIELDS=['FRED_API_KEY','FINNHUB_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','SEC_USER_AGENT','SEC_SYMBOLS'];
const AC_NAMES={automatic_transition:'Automated market warning changed',new_filing:'New SEC filing',manual_checkbox:'Market checklist rating changed',manual_stock_review:'Stock review rating changed',manual_override:'Legacy override changed',digest:'Scheduled summary',custom_rule:'My custom rule',provider_health:'Data source problem'};
const AC_DEFAULT_TEMPLATES={
 automatic_transition:'🔔 {title}\nRating: {previous} → {severity}\nWhy: {reason}\nData date: {date}\nSource: {source}\n\nReview the relevant checklist item. This does not place a trade.',
 new_filing:'📄 {title}\nDetected: {date}\nWhy: {reason}\nSource: {source}\n\nNew filing = new information, not necessarily bad news.',
 manual_checkbox:'📝 {title}\nYour selection: {previous} → {severity}\nEvidence: {reason}\n\nYour manual rating was saved. No trade is placed.',
 manual_stock_review:'📝 {ticker} stock review changed\nRating: {previous} → {severity}\nReason: {reason}\n\nOpen Stock reviews to revisit it.',
 manual_override:'✍️ {title}\nRating: {previous} → {severity}\nReason: {reason}',
 digest:'📋 Risk Lab scheduled summary\n{reason}\nChecked: {checked}\nChanged: {changed}\nErrors: {errors}\n\nThis is a recap, not necessarily a new warning.',
 custom_rule:'🎯 MY ALERT: {title}\nCurrent result: {severity}\nEarlier: {previous}\nWhy this triggered: {reason}\nDate: {date}\nSource: {source}',
 provider_health:'⚠️ {title}\n{reason}\nDate: {date}'
};
const AC_DEFAULTS=()=>({enabled:Object.fromEntries(Object.keys(AC_NAMES).map(k=>[k,true])),digestMode:'daily',templates:{...AC_DEFAULT_TEMPLATES},rules:[]});
const acSafe=(x,n=1500)=>String(x??'').slice(0,n);
const acIsPlain=o=>o&&typeof o==='object'&&!Array.isArray(o);
async function acReadDb(env,key){return (await env.DB.prepare('SELECT value FROM cursors WHERE key=?').bind(key).first())?.value??null;}
async function acWriteDb(env,key,value){await env.DB.prepare('INSERT INTO cursors(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,new Date().toISOString()).run();}
function acNormalize(input){
 const d=AC_DEFAULTS();if(!acIsPlain(input))return d;
 for(const k of Object.keys(d.enabled))if(typeof input.enabled?.[k]==='boolean')d.enabled[k]=input.enabled[k];
 if(['daily','changes','always','off'].includes(input.digestMode))d.digestMode=input.digestMode;
 for(const k of Object.keys(d.templates))if(typeof input.templates?.[k]==='string')d.templates[k]=acSafe(input.templates[k],1800);
 const validSev=['low','moderate','serious','very_serious'];
 if(Array.isArray(input.rules)){
  d.rules=input.rules.slice(0,25).filter(r=>acIsPlain(r)).map(r=>({
    id:/^[a-zA-Z0-9_-]{4,60}$/.test(r.id)?r.id:`rule_${crypto.randomUUID().slice(0,16)}`,
    name:acSafe(r.name||'My alert',90),enabled:r.enabled!==false,
    kind:r.kind==='numeric'?'numeric':'severity',
    source:['automatic','manual','both'].includes(r.source)?r.source:'automatic',
    key:r.key==='*'?'*':/^[A-Za-z0-9:._-]{1,45}$/.test(r.key||'')?r.key:'*',
    trigger:['enters_at_or_above','enters_exact','any_change'].includes(r.trigger)?r.trigger:'enters_at_or_above',
    severity:validSev.includes(r.severity)?r.severity:'serious',
    op:r.op==='<'?'<':'>=',threshold:Number.isFinite(Number(r.threshold))?Math.max(-10000,Math.min(10000,Number(r.threshold))):0,
    metric:/^[A-Za-z][A-Za-z0-9]{0,30}$/.test(r.metric||'')?r.metric:'value',
    template:acSafe(r.template||'',1200)
  }));
 }
 return d;
}
async function acGetSettings(env){const raw=await acReadDb(env,AC_SETTINGS_KEY);if(!raw)return AC_DEFAULTS();try{return acNormalize(JSON.parse(raw))}catch{return AC_DEFAULTS()}}
async function acSaveSettings(env,body){if(!acIsPlain(body))throw Error('Invalid alert configuration');const s=acNormalize(body);await acWriteDb(env,AC_SETTINGS_KEY,JSON.stringify(s));return s;}
// Derive an AES-256-GCM key from the existing high-entropy dashboard secret; random IV per update.
// Keep Dashboard Token safe. Rotating it invalidates D1-encrypted keys until re-entered.
async function acCryptoKey(env){if(!env.DASHBOARD_TOKEN||env.DASHBOARD_TOKEN.length<24)throw Error('DASHBOARD_TOKEN must be a long Cloudflare secret');const key=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ai-risk-lab-d1-credentials-v1/'+env.DASHBOARD_TOKEN));return crypto.subtle.importKey('raw',key,{name:'AES-GCM'},false,['encrypt','decrypt']);}
const acB64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const acUn64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function acEncrypt(env,plain){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await acCryptoKey(env);const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(plain))));return JSON.stringify({v:1,iv:acB64(iv),ct:acB64(cipher)});}
async function acDecrypt(env,raw){if(!raw)return {};try{const v=JSON.parse(raw);if(v.v!==1)throw Error('Unsupported version');const key=await acCryptoKey(env);const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:acUn64(v.iv)},key,acUn64(v.ct));const obj=JSON.parse(new TextDecoder().decode(clear));if(!acIsPlain(obj))throw Error('Bad credentials format');return obj;}catch{throw Error('Cannot decrypt saved API keys. If you changed DASHBOARD_TOKEN, re-enter provider keys in the dashboard.')}}
async function acGetKeys(env){return acDecrypt(env,await acReadDb(env,AC_KEYS_KEY));}
async function acUpdateKeys(env,body){
 if(!acIsPlain(body))throw Error('Invalid credentials request');const existing=body.reset===true?{}:await acGetKeys(env);
 const update=acIsPlain(body.values)?body.values:{};
 for(const k of AC_KEY_FIELDS)if(Object.prototype.hasOwnProperty.call(update,k)){
  const v=String(update[k]??'').trim();if(v.length>2000)throw Error(`${k} exceeds size limit`);
  if(v)existing[k]=v; // empty means unchanged; use remove for intentional deletion
 }
 for(const k of Array.isArray(body.remove)?body.remove:[])if(AC_KEY_FIELDS.includes(k))delete existing[k];
 await acWriteDb(env,AC_KEYS_KEY,await acEncrypt(env,existing));
 return acKeyMeta(env,existing);
}
function acKeyMeta(env,saved){return Object.fromEntries(AC_KEY_FIELDS.map(k=>[k,{stored:!!saved[k],legacy:!!env[k],canReveal:!!saved[k],label:saved[k]?'Saved securely in D1 (View/Copy available)':env[k]?'Cloudflare secret in use (cannot be revealed here)':'Not configured'}]));}
async function acEffectiveEnv(env){const [secrets,settings]=await Promise.all([acGetKeys(env),acGetSettings(env)]);return Object.assign({},env,secrets,{__acSettings:settings});}
function acApplyTemplate(template,data){
 const value={...data};
 return acSafe(String(template).replace(/\{(title|ticker|previous|severity|reason|date|source|checked|changed|errors|key|value)\}/g,(all,key)=>acSafe(value[key]??'—',850)),3900);
}
function acShouldNotify(settings,category){return settings.enabled[category]!==false;}
const acOrder={unknown:-1,review:-1,clear:0,low:0,watch:1,moderate:1,serious:2,very_serious:3};
function acSeverity(status){return ({clear:'low',watch:'moderate',review:'unknown'}[status]||status||'unknown');}
const acFriendly=status=>({unknown:'Not assessed',low:'Low',moderate:'Moderate',serious:'Serious',very_serious:'Very serious'}[acSeverity(status)]||'Not assessed');
async function acFireCustomRules(env,ob,emit){
 const s=env.__acSettings||await acGetSettings(env);if(!acShouldNotify(s,'custom_rule'))return;
 for(const r of s.rules){
  if(!r.enabled || (r.source!=='both'&&r.source!==ob.source)|| (r.key!=='*'&&r.key!==ob.key))continue;
  let triggered=false,detail='';
  if(r.kind==='numeric'){
   if(ob.source!=='automatic')continue;
   const n=r.metric==='value'?Number(ob.value):Number(ob.metrics?.[r.metric]);if(!Number.isFinite(n))continue;
   const hit=r.op==='<'?n<r.threshold:n>=r.threshold;
   const ck=`ui:rule-tripped:${r.id}:${ob.key}`,before=await acReadDb(env,ck);await acWriteDb(env,ck,hit?'1':'0');
   triggered=hit&&before!=='1';detail=`${r.metric} = ${Number(n.toFixed(3))}; trigger ${r.op} ${r.threshold}. ${ob.reason||''}`;
  } else {
   if(ob.oldStatus===ob.newStatus)continue;
   const newVal=acOrder[acSeverity(ob.newStatus)]??-1,oldVal=acOrder[acSeverity(ob.oldStatus)]??-1,t=acOrder[r.severity];
   triggered=r.trigger==='any_change'||(r.trigger==='enters_exact' ? newVal===t&&oldVal!==t:newVal>=t&&oldVal<t);
   detail=`Rule: ${r.trigger.replaceAll('_',' ')} ${r.severity.replace('_',' ')}. ${ob.reason||''}`;
  }
  if(!triggered)continue;
  const data={title:r.name,key:ob.key,ticker:ob.ticker||'',previous:acFriendly(ob.oldStatus),severity:acFriendly(ob.newStatus),date:ob.asof||new Date().toISOString().slice(0,10),reason:detail,source:ob.sourceUrl||'',value:ob.value??''};
  const msg=acApplyTemplate(r.template||s.templates.custom_rule,data);
  await emit(env,'custom_rule',`user_rule:${r.id}:${ob.key}`,ob.oldStatus||null,ob.newStatus||null,msg,ob.sourceUrl||null,true,{templateOverride:msg,title:r.name,...data});
 }
}



const FRED_SERIES={NASDAQ100:'https://fred.stlouisfed.org/series/NASDAQ100',VIXCLS:'https://fred.stlouisfed.org/series/VIXCLS',BAMLH0A0HYM2:'https://fred.stlouisfed.org/series/BAMLH0A0HYM2',DFII10:'https://fred.stlouisfed.org/series/DFII10'};
const COMPANIES={MSFT:'0000789019',AMZN:'0001018724',GOOGL:'0001652044',META:'0001326801',NVDA:'0001045810',AVGO:'0001730168',ORCL:'0001341439',CRWV:'0001769628'};
const ALLOWED_FORMS=new Set(['8-K','8-K/A','10-Q','10-Q/A','10-K','10-K/A','6-K','20-F','20-F/A']);
const utcNow=()=>new Date().toISOString();
// Persistent checklist severity is distinct from machine rule status (clear/watch/serious).
const severityOf=s=>({clear:'low',watch:'moderate',review:'unknown'}[s]||(['unknown','low','moderate','serious','very_serious'].includes(s)?s:'unknown'));
const severityName=s=>({unknown:'Not assessed',low:'Low',moderate:'Moderate',serious:'Serious',very_serious:'Very serious'}[severityOf(s)]||'Not assessed');
const J=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const errText=e=>short(e instanceof Error?e.message:String(e),300);
const urlOf=(req)=>new URL(req.url);
function cors(req,env){
 const o=req.headers.get('Origin');
 // Never allow arbitrary origins to access private data. The browser's Origin must exactly match configured GH Pages.
 return o && o===env.APP_ORIGIN ? {'Access-Control-Allow-Origin':o,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'}:{};
}
function allowedOrigin(req,env){const o=req.headers.get('Origin');return !o || o===env.APP_ORIGIN;}
async function authorised(req,env){
 const got=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
 const secret=env.DASHBOARD_TOKEN||'';
 if(!got||!secret||got.length!==secret.length)return false;
 let acc=0;for(let i=0;i<secret.length;i++)acc |= got.charCodeAt(i)^secret.charCodeAt(i);
 return acc===0;
}
async function telegram(env,message){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return {sent:false,why:'Telegram not configured'};
 const res=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:short(message,3900),disable_web_page_preview:true}),signal:AbortSignal.timeout(11000)});
 let body={};try{body=await res.json()}catch{}
 if(!res.ok||body.ok!==true)throw new Error(`Telegram HTTP ${res.status}: ${short(body.description||'unknown',160)}`);
 return {sent:true};
}
async function cursorGet(env,key){const rec=await env.DB.prepare('SELECT value FROM cursors WHERE key=?').bind(key).first();return rec?.value??null;}
async function cursorPut(env,key,value){await env.DB.prepare('INSERT INTO cursors(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,String(value),utcNow()).run();}
async function insertEvent(env,kind,key,oldStatus,newStatus,message,sourceUrl){
 const res=await env.DB.prepare('INSERT INTO events(created_at,kind,key,old_status,new_status,message,source_url,notified) VALUES(?,?,?,?,?,?,?,0)')
  .bind(utcNow(),kind,key,oldStatus??null,newStatus??null,short(message,1800),sourceUrl||null).run();
 return res.meta?.last_row_id??null;
}
async function alertEvent(env,kind,key,oldS,newS,message,sourceUrl,send=true,meta={}){
 const settings=env.__acSettings||await acGetSettings(env);
 const title=meta.title||meta.label||key;
 const context={title,previous:acFriendly(oldS),severity:acFriendly(newS),reason:meta.reason||message,date:meta.date||utcNow().slice(0,10),source:sourceUrl||'',ticker:meta.ticker||'',key,value:meta.value??'',checked:meta.checked??'',changed:meta.changed??'',errors:meta.errors??''};
 // Existing evidence/audit text is retained in D1. Notification template affects Telegram only.
 const id=await insertEvent(env,kind,key,oldS,newS,message,sourceUrl);
 if(send && id && acShouldNotify(settings,kind)){
   const chosen=meta.templateOverride||acApplyTemplate(settings.templates[kind]||'{reason}',context);
   try{const v=await telegram(env,chosen);if(v.sent)await env.DB.prepare('UPDATE events SET notified=1 WHERE id=?').bind(id).run();}
   catch(e){console.error('Telegram delivery failed',errText(e));}
 }
 return id;
}
async function recordCheck(env,check){
 const t=utcNow();const old=await env.DB.prepare('SELECT status FROM checks WHERE key=?').bind(check.key).first();
 const payload={...check,status:normaliseCheckStatus(check.status)};
 await env.DB.prepare(`INSERT INTO checks(key,scope,label,status,value,asof,checked_at,reason,source_url,metrics_json)
 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
 scope=excluded.scope,label=excluded.label,status=excluded.status,value=excluded.value,asof=excluded.asof,checked_at=excluded.checked_at,
 reason=excluded.reason,source_url=excluded.source_url,metrics_json=excluded.metrics_json`)
 .bind(payload.key,payload.scope||'automatic',payload.label,payload.status,Number.isFinite(payload.value)?payload.value:null,payload.asof||null,t,short(payload.reason,1800),payload.source||null,JSON.stringify(payload.metrics||{})).run();
 const isChange=!!old && old.status!==payload.status;
 const bootRisk=!old && ['watch','serious'].includes(payload.status);
 if(isChange || bootRisk){
   const label=payload.status==='clear'?'✅ LOW SEVERITY · THIS RULE':payload.status==='serious'?'🔴 SERIOUS · THIS RULE':payload.status==='watch'?'🟠 MODERATE · THIS RULE':'ℹ️ INFO / RULE RESET';
   const message=`${label}\n\nWhat changed: ${payload.label}\nPrevious: ${old?.status||'first observation'}\nNow: ${payload.status}\n\nWHY you received this:\nThe Worker checked its data feed and this specific rule changed status.\n\nWHAT THE DATA SHOWED:\n${short(payload.reason,750)}\n\nWHAT TO DO:\nOpen Risk Lab → Automated results. Verify the source, compare with other evidence, and decide whether to investigate. This is NOT a buy/sell order and it does not rate the whole AI market.\n\nObservation date: ${payload.asof||'not provided'}\nSource: ${payload.source||'not available'}`;
   await alertEvent(env,'automatic_transition',payload.key,old?.status,payload.status,message,payload.source,true,{title:payload.label,reason:payload.reason,date:payload.asof,value:payload.value,key:payload.key});
 }
 if(isChange||bootRisk||Number.isFinite(payload.value))await acFireCustomRules(env,{source:'automatic',key:payload.key,label:payload.label,oldStatus:old?.status||'unknown',newStatus:payload.status,value:payload.value,metrics:payload.metrics,asof:payload.asof,reason:payload.reason,sourceUrl:payload.source},alertEvent);
 return isChange||bootRisk;
}
async function fetchJson(url,extra={}){
 const res=await fetch(url,{headers:{Accept:'application/json',...extra},signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
 return res.json();
}
async function fetchFred(id,key,from){
 if(!key)throw new Error('FRED_API_KEY not configured');
 const u=new URL('https://api.stlouisfed.org/fred/series/observations');
 u.searchParams.set('series_id',id);u.searchParams.set('api_key',key);u.searchParams.set('file_type','json');
 u.searchParams.set('observation_start',from);u.searchParams.set('sort_order','asc');
 return parseFred(await fetchJson(u.toString()));
}
const dateBack=(days)=>new Date(Date.now()-days*86400e3).toISOString().slice(0,10);
async function checkMarkets(env){
 const errors=[];let checked=0,changed=0;const seriesCache=new Map();
 // Freshness is deliberately a separate system-health concern; never convert a failed fetch into an all-clear.
 for(const [series,label,callback,lookback] of [
  ['NASDAQ100','NASDAQ-100 trend (index proxy)',evaluateNasdaq,510],
  ['NASDAQ100','NASDAQ-100 rapid selloff (index proxy)',evaluateShock,510],
  ['NASDAQ100','Nasdaq-100 weekly RSI (context only)',evaluateWeeklyRsi,510],
  ['VIXCLS','VIX stress',evaluateVix,80],
  ['BAMLH0A0HYM2','High-yield credit spread widening',evaluateCredit,225],
  ['DFII10','10-year real yield (context)',evaluateRealYield,80],
 ]){
   try{
     // Memoize within one run so NASDAQ100 is fetched only once.
     if(!seriesCache.has(series))seriesCache.set(series,await fetchFred(series,env.FRED_API_KEY,dateBack(lookback)));
     const list=seriesCache.get(series);
     const result=callback(list);
     const key=series==='NASDAQ100'?(callback===evaluateNasdaq?'T1':callback===evaluateShock?'A3':'S1'):
       series==='VIXCLS'?'S2':series==='BAMLH0A0HYM2'?'M1':'M2';
     const age=result.asof?(Date.now()-Date.parse(result.asof+'T00:00:00Z'))/86400e3:999;
     if(age>6){errors.push(`${series} source data ${Math.floor(age)} calendar days old; previous status retained`);continue;}
     changed+=Number(await recordCheck(env,{...result,key,scope:'market',label,source:FRED_SERIES[series]}));checked++;
   } catch(e){errors.push(`${series}: ${errText(e)}`);}
 }
 return {checked,changed,errors};
}
function filingLink(cik,acc){return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replaceAll('-','')}/${acc}-index.htm`;}
async function checkFilings(env){
 let checked=0,changed=0;const errors=[];
 if(!env.SEC_USER_AGENT||env.SEC_USER_AGENT.includes('YOUR-CONTACT'))return {checked,changed,errors:['SEC_USER_AGENT requires a genuine application name and contact email']};
 const watch=(env.SEC_SYMBOLS||'MSFT,AMZN,GOOGL,META,NVDA,AVGO').split(',').map(x=>x.trim().toUpperCase()).filter(x=>COMPANIES[x]).slice(0,10);
 // Free-tier D1 and Worker invocations have small query/subrequest budgets;
 // rotate 4 issuers per poll, covering 8 issuers in approximately 8 hours.
 const n=Math.min(4,watch.length),rotation=Number(await cursorGet(env,'filings:rotation')||0);
 const requested=Array.from({length:n},(_,i)=>watch[(rotation+i)%watch.length]);
 for(const sym of requested){
  const cik=COMPANIES[sym];
  try{
   const d=await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`,{'User-Agent':env.SEC_USER_AGENT});
   const recent=d?.filings?.recent;
   if(!Array.isArray(recent?.accessionNumber))throw Error('SEC submissions shape missing');
   const latest=recent.accessionNumber[0];const ck=`sec:${sym}:lastseen`,old=await cursorGet(env,ck);
   const entries=[];
   const limit=Math.min(recent.accessionNumber.length,90);
   if(old){
    const found=recent.accessionNumber.slice(0,limit).includes(old);
    if(!found) {errors.push(`SEC ${sym}: previous filing cursor fell outside last ${limit} records; skipped gap and re-baselined`);} 
    for(let i=0;found&&i<limit;i++){
     const acc=recent.accessionNumber[i];if(acc===old)break;
     const form=recent.form?.[i];if(ALLOWED_FORMS.has(form)){
       entries.push({form,acc,date:recent.filingDate?.[i],url:filingLink(cik,acc)});
     }
    }
   }
   if(latest)await cursorPut(env,ck,latest);
   checked++;
   // First run is a baseline, not a flood of alerts for old filings.
   for(const item of entries.reverse()){
     const key=`sec:${sym}:${item.acc}`;
     const already=await cursorGet(env,key);if(already)continue;
     await cursorPut(env,key,'notified');
     const msg=`📄 COMPANY UPDATE DETECTED\n\nCompany: ${sym}\nDocument: SEC ${item.form}\nFiled: ${item.date||'date unavailable'}\n\nWHY this message: A new public filing was found. This is informational—NOT a negative or positive stock rating.\n\nWHAT TO DO: Open the filing, read what changed, then update your ${sym} Stock review if it affects your investment thesis.\n\nSource: ${item.url}`;
     await alertEvent(env,'new_filing',key,null,'review',msg,item.url,true,{title:`${sym}: new SEC ${item.form}`,reason:`A new SEC ${item.form} filing was detected. It is not a risk rating.`,ticker:sym,date:item.date});changed++;
   }
   await recordCheck(env,{key:`sec:feed:${sym}`,scope:'filings',label:`${sym} SEC filing feed`,status:'review',asof:utcNow().slice(0,10),reason:`Latest SEC filing feed checked. ${entries.length} newly observed relevant forms. Filing significance requires reading the primary document.`,source:`https://www.sec.gov/edgar/browse/?CIK=${Number(cik)}`});
  }catch(e){errors.push(`SEC ${sym}: ${errText(e)}`);}
 }
 await cursorPut(env,'filings:rotation',String((rotation+n)%Math.max(watch.length,1)));
 return {checked,changed,errors};
}
function annualFact(json,tag){
 const vals=json?.facts?.['us-gaap']?.[tag]?.units?.USD;
 if(!Array.isArray(vals))return null;
 const valid=vals.filter(x=>x.form==='10-K'&&x.fp==='FY'&&x.fy&&x.start&&x.end&&Number.isFinite(x.val)
   &&(Date.parse(x.end)-Date.parse(x.start))/86400e3 >= 300);
 valid.sort((a,b)=>b.end.localeCompare(a.end)||b.filed.localeCompare(a.filed));return valid[0]||null;
}
async function checkAnnualFacts(env){
 let checked=0,changed=0;const errors=[];
 // These are total company cash flows, NOT AI-specific capex, and are NEVER auto-rated red/green.
 if(!env.SEC_USER_AGENT || env.SEC_USER_AGENT.includes('YOUR-CONTACT'))return {checked,changed,errors:['SEC_USER_AGENT requires a genuine application name and contact email']};
 const names=['MSFT','AMZN','GOOGL','META'];
 const rotation=Number(await cursorGet(env,'annual:rotation')||0);
 const sym=names[rotation % names.length];
 for(const symSingle of [sym]){
  // Each weekly run scans ONE issuer's annual XBRL facts to limit 10ms free-tier Worker CPU pressure.

  try{
   const sym=symSingle;const cik=COMPANIES[sym];const d=await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,{'User-Agent':env.SEC_USER_AGENT});
   const op=annualFact(d,'NetCashProvidedByUsedInOperatingActivities');
   const pp=annualFact(d,'PaymentsToAcquirePropertyPlantAndEquipment');
   if(!op||!pp)throw Error('Comparable annual US-GAAP operating cash flow or PP&E payments unavailable');
   if(op.end!==pp.end||op.start!==pp.start)throw Error('Cash-flow periods differ; omitted rather than mixing years');
   const fcf=op.val-pp.val;
   await recordCheck(env,{key:`sec:annual:${sym}`,scope:'fundamentals',label:`${sym} annual cash flow (not AI-specific)`,
    status:'review',asof:op.end,value:+(fcf/1e9).toFixed(3),
    reason:`FY ending ${op.end}: operating cash flow $${(op.val/1e9).toFixed(1)}B minus PP&E cash purchases $${(pp.val/1e9).toFixed(1)}B = illustrative cash after PP&E $${(fcf/1e9).toFixed(1)}B. Whole company; not AI spending; annual 10-K; compare policies before conclusions.`,
    source:`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,metrics:{fiscalEnd:op.end,operatingCashFlow:op.val,capexPPandE:pp.val,fcfAfterPPE:fcf}});
   checked++;
  }catch(e){errors.push(`SEC annual ${symSingle}: ${errText(e)}`)}
 }
 await cursorPut(env,'annual:rotation',String(rotation+1));
 return {checked,changed,errors};
}
async function checkFinnhub(env){
 let checked=0,changed=0;const errors=[];if(!env.FINNHUB_API_KEY)return {checked,changed,errors:[]};
 for(const sym of ['QQQM','SMH','QQQ','NVDA','MSFT']){
  try{
   // Finnhub supports X-Finnhub-Token; don't put this secret in the URL/query string.
   const url=`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}`;
   const q=await fetchJson(url,{'X-Finnhub-Token':env.FINNHUB_API_KEY});if(!(q.c>0)||!(q.pc>0))throw Error('No usable quote (free entitlement or symbol may be unsupported)');
   const delta=(q.c/q.pc-1)*100;
   const asof=q.t?new Date(q.t*1000).toISOString().slice(0,10):null;
   const age=asof?(Date.now()-Date.parse(asof+'T00:00:00Z'))/86400e3:999;
   if(age>6){errors.push(`Finnhub ${sym}: quote stale (${asof})`);continue;}
   // Informational only: large single-session moves may simply reflect volatility.
   const st=Math.abs(delta)>=8?'watch':'review';
   changed+=Number(await recordCheck(env,{key:`quote:${sym}`,scope:'quote',label:`${sym} latest Finnhub quote`,status:st,asof,
    value:+delta.toFixed(2),reason:`Reported quote $${q.c.toFixed(2)} vs previous close $${q.pc.toFixed(2)}: ${delta.toFixed(2)}%. Quote timing, entitlement and adjustments vary. Watch at absolute 8% as an investigation prompt.`,source:'https://finnhub.io/docs/api/quote',metrics:{current:q.c,previous:q.pc,changePct:delta,unix:q.t}}));checked++;
  }catch(e){errors.push(`Finnhub ${sym}: ${errText(e)}`)}
 }
 return {checked,changed,errors};
}
async function sendCheckin(env,summary,mode){
 const settings=env.__acSettings||await acGetSettings(env);
 if(!acShouldNotify(settings,'digest'))return;
 if(mode==='off')return;
 if(mode==='changes' && summary.changed===0)return;
 if(mode==='daily'){
  const day=utcNow().slice(0,10);
  if(await cursorGet(env,`digest:${day}`))return;
  await cursorPut(env,`digest:${day}`,'1');
 }
 const checks=(await env.DB.prepare(`SELECT label,status,asof,reason FROM checks WHERE scope IN ('market','quote','system') ORDER BY CASE status WHEN 'serious' THEN 0 WHEN 'watch' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,label LIMIT 30`).all()).results||[];
 const flags=checks.filter(x=>['watch','serious'].includes(x.status));
 const digestFlags=flags.slice(0,4).map(x=>`• ${x.label} — ${x.status==='serious'?'SERIOUS':'MODERATE'} (data ${x.asof||'undated'})\n  ${short(x.reason,170)}`);
 const readable=flags.length?`Items needing review (${flags.length} among fetched checks):\n${digestFlags.join('\n')}`:'No Watch/Serious flags in the fetched summary. This does NOT prove the whole market is safe.';
 const msg=`📋 RISK LAB — ${mode==='daily'?'DAILY CHECK-IN':'CHECK SUMMARY'}\n\nWHY this message: ${mode==='daily'?'Your scheduled daily summary is enabled. This is not necessarily a new warning.':'Your Worker completed a check with status changes.'}\n\nWHAT WAS CHECKED:\n• ${summary.checked} data checks completed\n• ${summary.changed} status changes detected\n• ${summary.errors.length} provider problems\n\n${readable}\n${summary.errors.length?'\nData access problems: '+summary.errors.slice(0,2).map(x=>short(x,130)).join('; '):''}\n\nHOW TO USE THIS: Open Risk Lab → Automated results to see dated evidence. "No warning" only applies to rules checked successfully. The system does not trade for you.\n\nRun time: ${utcNow()} UTC (observation dates may be earlier).`;
 try{await telegram(env,acApplyTemplate(settings.templates.digest,{title:'Scheduled summary',reason:msg,checked:summary.checked,changed:summary.changed,errors:summary.errors.length,date:utcNow().slice(0,10)}))}catch(e){console.error('check-in telegram failed',errText(e));}
}
async function runCheck(env,{includeMarkets=true,includeSec=false,includeAnnual=false,includeQuotes=true,checkin=true}={}){
 if(!env.DB)throw Error('D1 binding is required');
 if(includeMarkets && !env.FRED_API_KEY)throw Error('FRED_API_KEY is required for market checks');
 const start=utcNow();let checked=0,changed=0;const errors=[];
 const jobs=[...(includeMarkets?[checkMarkets(env)]:[]),...(includeSec?[checkFilings(env)]:[]),...(includeAnnual?[checkAnnualFacts(env)]:[]),...(includeQuotes?[checkFinnhub(env)]:[])];
 const results=await Promise.allSettled(jobs);
 for(const result of results){
  if(result.status==='fulfilled'){checked+=result.value.checked;changed+=result.value.changed;errors.push(...result.value.errors)}
  else errors.push(errText(result.reason));
 }
 await env.DB.prepare('INSERT INTO run_log(ran_at,finished_at,checked,changed,errors) VALUES(?,?,?,?,?)')
 .bind(start,utcNow(),checked,changed,JSON.stringify(errors)).run();
 // No automatic pruning: retain the full history until the user explicitly deletes it.
 // Free D1 capacity is finite (500 MB per database), so export periodic SQL backups.
 // Surface provider failures; do not clear real market flags because a provider is down.
 if(errors.length){await recordCheck(env,{key:'sys:provider',scope:'system',label:'Data provider health',status:'watch',asof:utcNow().slice(0,10),reason:`${errors.length} source checks failed or stale: ${errors.slice(0,4).join('; ')}`,source:null})}
 else{await recordCheck(env,{key:'sys:provider',scope:'system',label:'Data provider health',status:'clear',asof:utcNow().slice(0,10),reason:'All configured checks completed without reported provider errors.'})}
 const summary={ranAt:start,finishedAt:utcNow(),checked,changed,errors};
 if(checkin){
  const mode=(env.__acSettings||await acGetSettings(env)).digestMode;
  // Daily digest is sent with the market batch (typically after daily FRED publications),
  // not at the first hourly quote poll shortly after UTC midnight.
  if(mode!=='daily'||includeMarkets)await sendCheckin(env,summary,mode);
 }
 return summary;
}
function validateState(body){
 if(!body||typeof body!=='object'||!body.state||typeof body.state!=='object')throw Error('Missing state');
 const s=body.state;
 if(!s.fields||typeof s.fields!=='object'||Array.isArray(s.fields)||!s.signals||typeof s.signals!=='object'||Array.isArray(s.signals)||!s.alerts||typeof s.alerts!=='object'||Array.isArray(s.alerts)||!Array.isArray(s.journal))throw Error('Invalid state structure');
 if(s.journal.length>1500||Object.keys(s.signals).length>60||Object.keys(s.alerts).length>35)throw Error('State exceeds safety limit');
 return {fields:s.fields,signals:s.signals,alerts:s.alerts,journal:s.journal};
}
async function saveUserState(req,env){
 const raw=await req.text();if(raw.length>480000)return J({error:'State too large (480 KB limit)'},413);
 let input;try{input=JSON.parse(raw)}catch{return J({error:'Invalid JSON'},400)}
 let state;try{state=validateState(input)}catch(e){return J({error:errText(e)},400)}
 const revision=input.revision;if(!Number.isInteger(revision)||revision<0)return J({error:'revision must be nonnegative integer'},400);
 const old=await env.DB.prepare('SELECT json,revision FROM user_state WHERE id=1').first();
 const previous=old?JSON.parse(old.json):{signals:{},alerts:{}};
 if((old?.revision||0)!==revision)return J({error:'Cloud version changed; refresh cloud state to avoid overwriting another device',currentRevision:old?.revision||0},409);
 const now=utcNow();const next=revision+1;
 let result;
 if(old){
  result=await env.DB.prepare('UPDATE user_state SET json=?,revision=?,updated_at=? WHERE id=1 AND revision=?')
    .bind(JSON.stringify(state),next,now,revision).run();
 }else{
  result=await env.DB.prepare('INSERT OR IGNORE INTO user_state(id,json,revision,updated_at) VALUES(1,?,?,?)')
    .bind(JSON.stringify(state),next,now).run();
 }
 if(!result.meta?.changes)return J({error:'Concurrent update; load cloud version and retry'},409);
 // Sync manual checkbox changes; no alert on initial import, avoids 22 false events.
 if(old){
  for(const [scope,field,valid] of [['checklist','signals',['unknown','clear','watch','serious','low','moderate','very_serious']],['urgent','alerts',['unknown','clear','investigating','confirmed']]]){
   const keys=new Set([...Object.keys(state[field]),...Object.keys(previous[field]||{})]);
   for(const key of keys){
    if(!/^[A-Z]\d{1,2}$/.test(key))continue;
    const before=previous[field]?.[key]||{},after=state[field]?.[key]||{};
    const prior=before.status||'unknown',current=after.status||'unknown';
    if(!valid.includes(current))continue;
    // Old clear/watch checklist statuses are semantically identical to Low/Moderate.
    if((scope==='checklist'?severityOf(prior)===severityOf(current):prior===current))continue;
    // New machine observations already have separate source-change events; do not mislabel these as manual checkbox edits.
    if(scope==='checklist'&&after.origin==='auto'&&before.origin!=='manual')continue;
    const word=scope==='checklist'?severityName(current):current;
    const note=short(after.evidence||after.note||'No evidence note supplied.',480);
    const autoRestore=scope==='checklist'&&after.origin==='auto';
    const msg=`📝 ${autoRestore?'AUTOMATIC RATING RESTORED':'YOU UPDATED A RISK REVIEW'}

Item: ${scope==='checklist'?'Market checklist':'Urgent event'} ${key}
Previous: ${scope==='checklist'?severityName(prior):prior}
New: ${word}

WHY notified: ${autoRestore?'You pressed “Use latest automatic assessment” in your checklist.':'You changed the saved assessment yourself.'}

WHAT IT MEANS: ${scope==='checklist'?'This severity describes only this indicator, not the probability of an AI-market crash.':'This is an urgent-event review, not an automatic sell order.'}

Your evidence: ${note}

NEXT: Review affected holdings if the new information is material. No trade is placed.`;
    await alertEvent(env,'manual_checkbox',`${scope}:${key}`,prior,current,msg,null,true,{title:`${scope==='checklist'?'Market checklist':'Urgent event'} ${key}`,reason:note,date:now.slice(0,10)});
    if(scope==='checklist')await acFireCustomRules(env,{source:'manual',key,oldStatus:prior,newStatus:current,reason:note,asof:now.slice(0,10)},alertEvent);
   }
  }
  // Stock-specific review statuses are stored under fields.stockReviews, so old D1 schema remains compatible.
  const stockNow=state.fields?.stockReviews||{};
  const stockBefore=previous.fields?.stockReviews||{};
  for(const [sym,reviewData] of Object.entries(stockNow)){
    if(!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(sym)||!reviewData||typeof reviewData!=='object')continue;
    for(const [indicatorId,entry] of Object.entries(reviewData.review||{})){
      if(!/^[A-Z][0-9]{1,2}$/.test(indicatorId))continue;
      const prior=stockBefore?.[sym]?.review?.[indicatorId]?.status||'unknown';
      const nowStatus=entry?.status||'unknown';
      if(severityOf(prior)===severityOf(nowStatus)||!['unknown','clear','watch','serious','low','moderate','very_serious'].includes(nowStatus))continue;
      const msg=`📝 YOU UPDATED A STOCK RISK REVIEW

Stock: ${sym}
Indicator: ${indicatorId}
Previous: ${severityName(prior)}
New: ${severityName(nowStatus)}

WHY notified: You changed your severity rating for this stock. SEC cash-flow data or new filings do not automatically mean low risk.

Your evidence: ${short(entry?.note||'No note provided.',480)}

NEXT: Review ${sym} in Risk Lab → Stock reviews if this changes your thesis. The rating and ticker are saved to D1.`;
      await alertEvent(env,'manual_stock_review',`stock:${sym}:${indicatorId}`,prior,nowStatus,msg,null,true,{title:`${sym} ${indicatorId} review`,ticker:sym,reason:short(entry?.note||'No note provided',480),date:now.slice(0,10)});
      await acFireCustomRules(env,{source:'manual',key:`stock:${sym}:${indicatorId}`,ticker:sym,oldStatus:prior,newStatus:nowStatus,reason:entry?.note||'',asof:now.slice(0,10)},alertEvent);
    }
  }
 }
 return J({ok:true,revision:next,updatedAt:now});
}
// Overrides never modify checks.status. Thus new source data can still generate alerts,
// and deleting an override instantly reveals the current automatic assessment.
async function setOverride(req,env){
 let data;try{data=await req.json()}catch{return J({error:'Invalid JSON'},400)}
 if(!data||typeof data.key!=='string'||!/^[A-Za-z0-9:_-]{1,50}$/.test(data.key))return J({error:'Invalid check key'},400);
 const check=await env.DB.prepare('SELECT key,label,status,reason,asof,source_url FROM checks WHERE key=?').bind(data.key).first();
 if(!check)return J({error:'Unknown source check. Run source checks first.'},404);
 const old=await env.DB.prepare('SELECT status,note FROM overrides WHERE key=?').bind(data.key).first();
 const clear=data.status===null || data.status==='automatic';
 if(!clear && !['clear','watch','serious','review'].includes(data.status))return J({error:'Override must be clear, watch, serious, review, or automatic'},400);
 const note=String(data.note||'').trim();
 if(!clear && (note.length<8||note.length>1200))return J({error:'Please enter an override reason (8–1200 characters)'},400);
 if(clear){
   if(!old)return J({ok:true,unchanged:true,effective_status:check.status,automatic_status:check.status});
   await env.DB.prepare('DELETE FROM overrides WHERE key=?').bind(check.key).run();
 }else{
   if(old?.status===data.status && old?.note===note)return J({ok:true,unchanged:true,effective_status:data.status,automatic_status:check.status});
   await env.DB.prepare(`INSERT INTO overrides(key,status,note,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at`)
   .bind(check.key,data.status,note,utcNow()).run();
 }
 const newStatus=clear?check.status:data.status;
 const oldStatus=old?.status||check.status;
 const msg=clear?
   `↩️ YOUR OVERRIDE WAS REMOVED\n\nCheck: ${check.label}\nYour prior setting: ${old?.status}\nVisible machine result again: ${check.status}\n\nWHY notified: You removed your manual override. This does not mean the market itself changed.\n\nOriginal data: ${short(check.reason,450)}\nObservation: ${check.asof||'unknown'}`:
   `✍️ YOU OVERRULED A MACHINE CHECK\n\nCheck: ${check.label}\nMachine said: ${check.status}\nYou chose: ${newStatus}\n\nWHY notified: You saved a personal interpretation. Future machine alerts continue normally.\n\nYour reason: ${short(note,550)}\nOriginal data note: ${short(check.reason,420)}\nObservation date: ${check.asof||'unknown'}\n\nWHAT TO DO: Nothing unless you want to reconsider the override in Automated results.`;
 await alertEvent(env,'manual_override',`override:${check.key}`,oldStatus,newStatus,msg,check.source_url,true,{title:`${check.label}: source override`,reason:clear?'Override removed':note,date:utcNow().slice(0,10)});
 return J({ok:true,effective_status:newStatus,automatic_status:check.status,override_status:clear?null:newStatus});
}
async function getUserState(env){const r=await env.DB.prepare('SELECT json,revision,updated_at FROM user_state WHERE id=1').first();return J({revision:r?.revision||0,updatedAt:r?.updated_at||null,state:r?JSON.parse(r.json):null});}
async function getArchivePage(env,u){
 const kind=u.searchParams.get('kind');
 if(!['events','run_log'].includes(kind))return J({error:'kind must be events or run_log'},400);
 const raw=u.searchParams.get('before');
 const before=raw&&/^\d+$/.test(raw)?Number(raw):Number.MAX_SAFE_INTEGER;
 if(!Number.isSafeInteger(before)||before<1)return J({error:'Invalid before cursor'},400);
 // Pagination allows a complete export with fixed bounded query sizes. Never archive secrets.
 const items=(await env.DB.prepare(`SELECT * FROM ${kind} WHERE id < ? ORDER BY id DESC LIMIT 200`).bind(before).all()).results||[];
 const next=items.length===200?items.at(-1).id:null;
 return J({kind,items,next});
}
async function getOverview(env){
 const checks=(await env.DB.prepare(`SELECT c.*, o.status AS override_status, o.note AS override_note, o.updated_at AS override_at
   FROM checks c LEFT JOIN overrides o ON o.key=c.key ORDER BY c.scope,c.key`).all()).results||[];
 const events=(await env.DB.prepare('SELECT id,created_at,kind,key,old_status,new_status,message,source_url,notified FROM events ORDER BY id DESC LIMIT 100').all()).results||[];
 const runs=(await env.DB.prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT 10').all()).results||[];
 // Delete none from UI, and distinguish provider failures/stale values from clean signals.
 return J({checks:checks.map(({metrics_json,...r})=>({
  ...r, automatic_status:r.status, effective_status:r.override_status||r.status,
  assessment_origin:r.override_status?'manual override':'automated source',
  metrics:JSON.parse(metrics_json||'{}')
 })),events,runs,serverTime:utcNow()});
}
export default {
 async fetch(req,env){
  const originHeaders=cors(req,env);
  if(!allowedOrigin(req,env))return J({error:'Origin not allowed; configure APP_ORIGIN for your GitHub Pages site'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:originHeaders});
  try{
   if(!await authorised(req,env))return J({error:'Unauthorized. Enter your private DASHBOARD_TOKEN.'},401,originHeaders);
   const u=urlOf(req),path=u.pathname;
   let res;
   // Existing D1 cursors table stores settings + encrypted provider keys. No migrations.
   if(path==='/api/alert-settings'&&req.method==='GET')res=J({settings:await acGetSettings(env),categories:AC_NAMES});
   else if(path==='/api/alert-settings'&&req.method==='PUT')res=J({ok:true,settings:await acSaveSettings(env,await req.json())});
   else if(path==='/api/credentials'&&req.method==='GET')res=J({fields:acKeyMeta(env,await acGetKeys(env)),dashboardToken:'Cloudflare secret, intentionally never revealable by Worker API'});
   else if(path==='/api/credentials'&&req.method==='PUT')res=J({ok:true,fields:await acUpdateKeys(env,await req.json())});
   else if(path==='/api/credentials/reveal'&&req.method==='POST'){
     const input=await req.json().catch(()=>({}));
     if(input.confirm!==true)res=J({error:'Confirm that you want to reveal keys in this browser session'},400);
     else res=J({values:await acGetKeys(env)});
   }
   else if(path==='/api/ping'&&req.method==='GET')res=J({ok:true,version:'1.0',utc:utcNow(),storage:'Cloudflare D1'});
   else if(path==='/api/overview'&&req.method==='GET')res=await getOverview(env);
   else if(path==='/api/archive-page'&&req.method==='GET')res=await getArchivePage(env,u);
   else if(path==='/api/user-state'&&req.method==='GET')res=await getUserState(env);
   else if(path==='/api/override'&&req.method==='POST')res=await setOverride(req,await acEffectiveEnv(env));
   else if(path==='/api/user-state'&&req.method==='PUT')res=await saveUserState(req,await acEffectiveEnv(env));
   else if(path==='/api/check'&&req.method==='POST'){
     // Manual runs are throttled to prevent burning API budgets.
     const body=await req.json().catch(()=>({})); const scope=['market','sec','fundamentals'].includes(body.scope)?body.scope:'market';
     const last=await cursorGet(env,`last:manual-run:${scope}`);
     if(last&&Date.now()-Date.parse(last)<5*60*1000)res=J({error:'Manual checks limited to once every five minutes'},429);
     else{await cursorPut(env,`last:manual-run:${scope}`,utcNow());res=J({ok:true,...await runCheck(await acEffectiveEnv(env),{includeMarkets:scope==='market',includeSec:scope==='sec',includeAnnual:scope==='fundamentals',includeQuotes:scope==='market',checkin:true})});}
   }
   else if(path==='/api/test-telegram'&&req.method==='POST')res=J({ok:true,...await telegram(await acEffectiveEnv(env),`✅ RISK LAB — TELEGRAM CONNECTED\n\nWHY this message: You pressed Send Telegram test in your dashboard.\n\nWHAT TO EXPECT: Scheduled daily check-ins (if enabled), important automatic status changes, SEC filing notices, and your own checkbox / override changes.\n\nWHAT TO DO: Nothing. A future warning means REVIEW, not automatically buy or sell.\n\nTest time: ${utcNow()} UTC`)});
   else res=J({error:'Not found'},404);
   return new Response(res.body,{status:res.status,headers:{...Object.fromEntries(res.headers.entries()),...originHeaders}});
  }catch(e){console.error(errText(e));return J({error:errText(e)},500,originHeaders)}
 },
 async scheduled(controller,env,ctx){
   const cron=String(controller.cron||'');
   const hour=new Date(controller.scheduledTime||Date.now()).getUTCHours();
   const market=cron.startsWith('25 12 ');
   const annual=cron.startsWith('40 12 ');
   const filings=cron.startsWith('15 ') && hour%4===0;
   const quotes=cron.startsWith('15 ');
   ctx.waitUntil(acEffectiveEnv(env).then(configured=>runCheck(configured,{includeMarkets:market,includeSec:filings,includeAnnual:annual,includeQuotes:quotes,checkin:true})).catch(e=>console.error('scheduled check failed',errText(e))));
 }
};
