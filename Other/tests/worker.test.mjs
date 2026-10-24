import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/src/index.js';

function d1(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../worker/migrations/0001_initial.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../worker/migrations/0002_overrides.sql',import.meta.url),'utf8'));
 return {
  sqlite,
  prepare(sql){
   const query=sqlite.prepare(sql);
   let vals=[];
   return {
    bind(...args){vals=args;return this},
    async first(){return query.get(...vals)||null},
    async all(){return {results:query.all(...vals)}},
    async run(){const res=query.run(...vals);return {meta:{changes:res.changes,last_row_id:Number(res.lastInsertRowid)}}}
   }
  }
 }
}
const origin='https://demo.github.io';
function request(path,{method='GET',token='0123456789abcdef0123456789abcdef',body}={}){
 return new Request('https://worker.example'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
}
async function api(env,path,opts){const res=await worker.fetch(request(path,opts),env);return {status:res.status,body:await res.json()}}
function freshEnv(){
 const db=d1();
 const env={DB:db,DASHBOARD_TOKEN:'0123456789abcdef0123456789abcdef',APP_ORIGIN:origin};
 db.sqlite.prepare('INSERT INTO checks(key,scope,label,status,value,asof,checked_at,reason,source_url,metrics_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('T1','market','Nasdaq index SMA','serious',-8,'2026-10-22','2026-10-23T10:00:00Z',
  'Nasdaq 8% below 200-session SMA; this is a heuristic, not an instruction to sell.',
  'https://fred.stlouisfed.org/series/NASDAQ100','{}');
 return env;
}
test('Worker requires bearer authentication',async()=>{
 const env=freshEnv();const r=await api(env,'/api/overview',{token:'WRONG'});
 assert.equal(r.status,401);
});
test('automated reasons preserved when manual override applied, changed, and removed',async()=>{
 const env=freshEnv();let v=await api(env,'/api/overview');
 assert.equal(v.body.checks[0].status,'serious');
 assert.equal(v.body.checks[0].effective_status,'serious');
 assert.match(v.body.checks[0].reason,/200-session/);
 let r=await api(env,'/api/override',{method:'POST',body:{key:'T1',status:'clear',note:'I reviewed the longer time horizon and business fundamentals'}});
 assert.equal(r.status,200);assert.equal(r.body.effective_status,'clear');
 v=await api(env,'/api/overview');assert.equal(v.body.checks[0].automatic_status,'serious');
 assert.equal(v.body.checks[0].override_status,'clear');assert.equal(v.body.checks[0].effective_status,'clear');
 assert.match(v.body.checks[0].override_note,/longer time horizon/);
 assert.match(v.body.checks[0].reason,/8% below/);
 assert.equal(v.body.events.length,1);assert.equal(v.body.events[0].kind,'manual_override');
 assert.match(v.body.events[0].message,/Original data note/);
 r=await api(env,'/api/override',{method:'POST',body:{key:'T1',status:'automatic',note:'No longer applying a manual override'}});
 assert.equal(r.status,200);
 v=await api(env,'/api/overview');assert.equal(v.body.checks[0].effective_status,'serious');
 assert.equal(v.body.checks[0].override_status,null);
 assert.equal(v.body.events.length,2);
});
test('override must have a reason and may only reference actual source checks',async()=>{
 const env=freshEnv();
 let r=await api(env,'/api/override',{method:'POST',body:{key:'T1',status:'clear',note:'fine'}});
 assert.equal(r.status,400);
 r=await api(env,'/api/override',{method:'POST',body:{key:'X99',status:'clear',note:'Some explanation'}});
 assert.equal(r.status,404);
 r=await api(env,'/api/override',{method:'POST',body:{key:'T1',status:'danger',note:'Some explanation'}});
 assert.equal(r.status,400);
});
test('source check remains unchanged even after user overrides it',async()=>{
 const env=freshEnv();
 await api(env,'/api/override',{method:'POST',body:{key:'T1',status:'clear',note:'Review done with independent evidence'}});
 // Simulate a fresh automatic source result; source status changes but user decision stays distinct.
 env.DB.sqlite.prepare('UPDATE checks SET status=?,reason=? WHERE key=?').run('watch','Now closer to the average','T1');
 const r=await api(env,'/api/overview');
 const x=r.body.checks[0];assert.equal(x.automatic_status,'watch');assert.equal(x.effective_status,'clear');assert.match(x.reason,/closer/);
});
test('per-ticker stock reviews persist in existing D1 user_state and checkbox changes create audit events',async()=>{
 const env=freshEnv();
 const empty={fields:{stockReviews:{NVDA:{createdAt:'2026-10-24',review:{F1:{status:'unknown',note:''}},summary:'',thesis:'AI chip supplier'}}},signals:{},alerts:{},journal:[]};
 let r=await api(env,'/api/user-state',{method:'PUT',body:{revision:0,state:empty}});
 assert.equal(r.status,200);let found=await api(env,'/api/user-state');
 assert.equal(found.body.state.fields.stockReviews.NVDA.thesis,'AI chip supplier');
 const changed=structuredClone(empty);changed.fields.stockReviews.NVDA.review.F1={status:'watch',note:'Consensus EPS outlook lower over 8 weeks'};
 r=await api(env,'/api/user-state',{method:'PUT',body:{revision:1,state:changed}});
 assert.equal(r.status,200);found=await api(env,'/api/user-state');
 assert.equal(found.body.state.fields.stockReviews.NVDA.review.F1.status,'watch');
 const history=await api(env,'/api/overview');
 assert.equal(history.body.events[0].kind,'manual_stock_review');
 assert.match(history.body.events[0].message,/NVDA/);
 assert.match(history.body.events[0].message,/Consensus EPS/);
});
