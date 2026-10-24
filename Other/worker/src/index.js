import {evaluateNasdaq,evaluateShock,evaluateVix,evaluateCredit,evaluateRealYield,evaluateWeeklyRsi,parseFred,normaliseCheckStatus,short} from './rules.js';

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
async function alertEvent(env,kind,key,oldS,newS,message,sourceUrl,send=true){
 const id=await insertEvent(env,kind,key,oldS,newS,message,sourceUrl);
 if(send && id){
   try{const v=await telegram(env,message);if(v.sent)await env.DB.prepare('UPDATE events SET notified=1 WHERE id=?').bind(id).run();}
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
   await alertEvent(env,'automatic_transition',payload.key,old?.status,payload.status,message,payload.source,true);
 }
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
     await alertEvent(env,'new_filing',key,null,'review',msg,item.url,true);changed++;
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
   const url=`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
   const q=await fetchJson(url);if(!(q.c>0)||!(q.pc>0))throw Error('No usable quote (free entitlement or symbol may be unsupported)');
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
 try{await telegram(env,msg)}catch(e){console.error('check-in telegram failed',errText(e));}
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
  const mode=env.CHECKIN_MODE||'daily';
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
    await alertEvent(env,'manual_checkbox',`${scope}:${key}`,prior,current,msg,null,true);
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
      await alertEvent(env,'manual_stock_review',`stock:${sym}:${indicatorId}`,prior,nowStatus,msg,null,true);
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
 await alertEvent(env,'manual_override',`override:${check.key}`,oldStatus,newStatus,msg,check.source_url,true);
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
   if(path==='/api/ping'&&req.method==='GET')res=J({ok:true,version:'1.0',utc:utcNow(),storage:'Cloudflare D1'});
   else if(path==='/api/overview'&&req.method==='GET')res=await getOverview(env);
   else if(path==='/api/archive-page'&&req.method==='GET')res=await getArchivePage(env,u);
   else if(path==='/api/user-state'&&req.method==='GET')res=await getUserState(env);
   else if(path==='/api/override'&&req.method==='POST')res=await setOverride(req,env);
   else if(path==='/api/user-state'&&req.method==='PUT')res=await saveUserState(req,env);
   else if(path==='/api/check'&&req.method==='POST'){
     // Manual runs are throttled to prevent burning API budgets.
     const body=await req.json().catch(()=>({})); const scope=['market','sec','fundamentals'].includes(body.scope)?body.scope:'market';
     const last=await cursorGet(env,`last:manual-run:${scope}`);
     if(last&&Date.now()-Date.parse(last)<5*60*1000)res=J({error:'Manual checks limited to once every five minutes'},429);
     else{await cursorPut(env,`last:manual-run:${scope}`,utcNow());res=J({ok:true,...await runCheck(env,{includeMarkets:scope==='market',includeSec:scope==='sec',includeAnnual:scope==='fundamentals',includeQuotes:scope==='market',checkin:true})});}
   }
   else if(path==='/api/test-telegram'&&req.method==='POST')res=J({ok:true,...await telegram(env,`✅ RISK LAB — TELEGRAM CONNECTED\n\nWHY this message: You pressed Send Telegram test in your dashboard.\n\nWHAT TO EXPECT: Scheduled daily check-ins (if enabled), important automatic status changes, SEC filing notices, and your own checkbox / override changes.\n\nWHAT TO DO: Nothing. A future warning means REVIEW, not automatically buy or sell.\n\nTest time: ${utcNow()} UTC`)});
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
   ctx.waitUntil(runCheck(env,{includeMarkets:market,includeSec:filings,includeAnnual:annual,includeQuotes:quotes,checkin:true}).catch(e=>console.error('scheduled check failed',errText(e))));
 }
};
