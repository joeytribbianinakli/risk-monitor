// Pure rules, intentionally isolated for offline tests. Percent values are percentage points.
export const STATUS = ['unknown', 'clear', 'watch', 'serious', 'review'];
export const isoDay = (s) => String(s ?? '').slice(0, 10);
export function sma(data, days) {
  if (!Array.isArray(data) || data.length < days) return null;
  const sample = data.slice(-days);
  return sample.reduce((sum, entry) => sum + entry.value, 0) / days;
}
export function percentChange(current, base) {
  return Number.isFinite(current) && Number.isFinite(base) && base > 0
    ? (current / base - 1) * 100 : null;
}
export function latestAtLeast(data, days) {
  if (!data?.length) return null;
  const end = new Date(`${data.at(-1).date}T00:00:00Z`).getTime();
  const target = end - days * 86400e3;
  for (let i = data.length - 2; i >= 0; i--) {
    if (Date.parse(data[i].date + 'T00:00:00Z') <= target) return data[i];
  }
  return null;
}
export function evaluateNasdaq(data) {
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
    reason:`NASDAQ-100 index ${last.value.toFixed(1)}; vs 50-session SMA ${dist50.toFixed(1)}%; vs 200-session SMA ${dist200.toFixed(1)}%; 5-session ${p5?.toFixed(1)??'n/a'}%; 20-session ${p20?.toFixed(1)??'n/a'}%. Index proxy, NOT QQQM adjusted prices.`,
    metrics:{index:last.value,sma50:m50,sma200:m200,pctSma50:dist50,pctSma200:dist200,change5:p5,change20:p20}};
}
export function evaluateShock(data) {
  if (!data || data.length < 22) return {status:'unknown',reason:'Need 22 daily observations',value:null};
  const last=data.at(-1),p5=percentChange(last.value,data.at(-6).value),p20=percentChange(last.value,data.at(-21).value);
  // Heuristics explicitly labeled, prompt investigation not trades.
  const status = p5 <= -10 + 1e-8 || p20 <= -20 + 1e-8 ? 'serious' : p5 <= -6 + 1e-8 || p20 <= -12 + 1e-8 ? 'watch' : 'clear';
  return {status,asof:last.date,value:+p5.toFixed(2),reason:`NASDAQ-100 index changes: 5 trading sessions ${p5.toFixed(2)}%; 20 trading sessions ${p20.toFixed(2)}%. Review thresholds: −6%/−12%; serious −10%/−20%.`,metrics:{change5:p5,change20:p20}};
}
export function evaluateVix(data) {
  if (!data?.length) return {status:'unknown',reason:'No published VIX observation',value:null};
  const latest=data.at(-1);
  return {status:latest.value>=35?'serious':latest.value>=25?'watch':'clear',asof:latest.date,
    value:latest.value,reason:`Cboe VIX ${latest.value.toFixed(2)}; 25/35 are stress-review thresholds, not crash forecasts.`};
}
export function evaluateCredit(data) {
  if (!data?.length) return {status:'unknown',reason:'No credit spread observations',value:null};
  const last=data.at(-1),window=data.filter(x=>Date.parse(x.date)>=Date.parse(last.date)-183*86400e3);
  if(window.length < 20) return {status:'unknown',reason:'Insufficient data for 6-month spread low',value:null};
  const low=Math.min(...window.map(x=>x.value)),riseBps=Math.round((last.value-low)*100);
  return {status:riseBps>=200?'serious':riseBps>=100?'watch':'clear',asof:last.date,value:riseBps,
    reason:`US HY OAS ${last.value.toFixed(2)} percentage points; +${riseBps} basis points from six-month low ${low.toFixed(2)}. Heuristic, not a forecast.`,metrics:{spread:last.value,low,riseBps}};
}
export function evaluateRealYield(data) {
  if (!data?.length) return {status:'unknown',reason:'Real-yield series not available',value:null};
  const last=data.at(-1);
  return {status:'review',asof:last.date,value:last.value,reason:`10-year TIPS real yield ${last.value.toFixed(2)}%; context only; no risk status can be concluded from yields alone.`};
}
export function parseFred(json) {
  if (!Array.isArray(json?.observations)) throw new Error('FRED observations missing');
  return json.observations.filter(x=>x.value!=='.' && Number.isFinite(Number(x.value)))
   .map(x=>({date:x.date,value:Number(x.value)})).sort((a,b)=>a.date.localeCompare(b.date));
}
export function normaliseCheckStatus(s) { return STATUS.includes(s) ? s : 'unknown'; }
export function short(s,n=340){return String(s??'').slice(0,n)}

// Weekly RSI from the latest available close in each UTC Monday-to-Sunday market week.
// It is the NASDAQ-100 index, NOT an adjusted QQQM ETF weekly RSI.
export function evaluateWeeklyRsi(data) {
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
