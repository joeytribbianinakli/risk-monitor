import test from 'node:test';
import assert from 'node:assert/strict';
import {sma,percentChange,parseFred,evaluateNasdaq,evaluateShock,evaluateVix,evaluateCredit,evaluateRealYield,evaluateWeeklyRsi,latestAtLeast} from '../worker/src/rules.js';
function days(values){const d=new Date('2025-01-01T00:00:00Z');return values.map(v=>{const date=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+1);return {date,value:v};});}
test('percent change and SMA calculations',()=>{
 assert.equal(sma(days([1,2,3]),2),2.5);
 assert.ok(Math.abs(percentChange(110,100)-10)<1e-10);
 assert.equal(percentChange(0,0),null);
});
test('FRED empty missing observations are dropped, ordered',()=>{
 assert.deepEqual(parseFred({observations:[{date:'2026-01-03',value:'3.5'},{date:'2026-01-01',value:'.'},{date:'2026-01-02',value:'2'}]}),[{date:'2026-01-02',value:2},{date:'2026-01-03',value:3.5}]);
});
test('Strong trend and price under trend',()=>{
 const steady=days(Array.from({length:240},(_,i)=>100+i*.3));const a=evaluateNasdaq(steady);
 assert.equal(a.status,'clear');assert.ok(a.metrics.pctSma200>0);
 const dropped=steady.map((x,i)=>i>=228?{...x,value:80}:x);
 const b=evaluateNasdaq(dropped);assert.ok(['watch','serious'].includes(b.status));
});
test('Not enough history is unknown, never clear',()=>{
 assert.equal(evaluateNasdaq(days([100,110])).status,'unknown');
 assert.equal(evaluateShock(days([110])).status,'unknown');
});
test('Rapid selloff is detected across 5 and 20 daily observations',()=>{
 const series=days([...Array(25).fill(100),...Array(6).fill(80)]);
 const result=evaluateShock(series);assert.equal(result.status,'serious');
});
test('VIX and credit stress thresholds',()=>{
 assert.equal(evaluateVix(days([20,26])).status,'watch');
 assert.equal(evaluateVix(days([20,36])).status,'serious');
 const series=days([...Array(30).fill(3),5.1]);
 assert.equal(evaluateCredit(series).status,'serious');
 assert.equal(evaluateCredit(days(Array(30).fill(3))).status,'clear');
});
test('Real yield is context only, not bearish/bullish',()=>{
 assert.equal(evaluateRealYield(days([2.2])).status,'review');
});

test('Weekly RSI uses weekly index closes, context-only; no false automatic crash call',()=>{
 const upward=days(Array.from({length:240},(_,i)=>150+i));
 const r=evaluateWeeklyRsi(upward);
 assert.equal(r.status,'review');
 assert.equal(r.value,100);
 assert.match(r.reason,/not adjusted QQQM/);
 assert.equal(evaluateWeeklyRsi(days([100,102])).status,'unknown');
});
