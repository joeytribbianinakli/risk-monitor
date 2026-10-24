from playwright.sync_api import sync_playwright
from pathlib import Path
h=Path('/mnt/data/AI_Risk_Lab_ClearUX/index.html').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1360,'height':920});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank')
 page.evaluate('''() => {
 const mk=()=>{let d={};return {getItem:k=>d[k]??null,setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}};
 Object.defineProperty(window,'localStorage',{configurable:true,value:mk()});Object.defineProperty(window,'sessionStorage',{configurable:true,value:mk()});
 const checks=[{key:'M1',scope:'market',label:'High-yield credit spread widening',status:'watch',automatic_status:'watch',value:120,asof:'2026-10-24',checked_at:'2026-10-24T18:00:00Z',reason:'US HY OAS 4.80 percentage points; +120 basis points from six-month low 3.60. Heuristic, not a forecast.',source_url:'https://fred.stlouisfed.org/series/BAMLH0A0HYM2'},
 {key:'T1',scope:'market',label:'NASDAQ-100 trend',status:'clear',automatic_status:'clear',value:9.7,asof:'2026-10-23',checked_at:'2026-10-24T18:00:00Z',reason:'NASDAQ-100 index is above the 50- and 200-session SMA.',source_url:'https://fred.stlouisfed.org/series/NASDAQ100'},
 {key:'sec:feed:NVDA',scope:'filings',label:'NVDA SEC filing feed',status:'review',automatic_status:'review',value:null,asof:'2026-10-24',checked_at:'2026-10-24T18:00:00Z',reason:'Latest SEC filing feed checked. No material inference made.',source_url:'https://www.sec.gov/edgar/search/'},
 {key:'sys:provider',scope:'system',label:'Data provider health',status:'clear',automatic_status:'clear',value:null,asof:'2026-10-24',checked_at:'2026-10-24T18:00:00Z',reason:'All configured checks completed without errors.',source_url:null}];
 window.fetch=async(url,opts={})=>{
 let path=new URL(url).pathname;const obj=path==='/api/ping'?{ok:true,storage:'Cloudflare D1'}:path==='/api/overview'?{checks,events:[],runs:[{finished_at:'2026-10-24T18:00:00Z'}]}:path==='/api/user-state'?{revision:0,state:null}:path==='/api/override'?{ok:true}:path==='/api/test-telegram'?{sent:true}:{error:'no mock'};
 return new Response(JSON.stringify(obj),{status:200,headers:{'Content-Type':'application/json'}})
 };
 }''')
 page.set_content(h,wait_until='domcontentloaded')
 page.locator('#topSettings').click()
 page.locator('#cfEndpoint').fill('https://risk-monitor.example.workers.dev')
 page.locator('#cfToken').fill('0123456789abcdef0123456789abcdef')
 page.locator('#cfConnect').click()
 page.locator('#cfChecks article.live-check').first.wait_for()
 print('auto cards',page.locator('#cfChecks article.live-check').count())
 print('status',page.locator('#cfStatus').inner_text())
 print('card',page.locator('#cfChecks article.live-check').first.inner_text()[:280])
 print('M1 value',page.locator('#cfChecks article.live-check').first.locator('.value').inner_text())
 assert 'basis points' in page.locator('#cfChecks article.live-check').first.locator('.value').inner_text()
 page.screenshot(path='/mnt/data/AI_Risk_Lab_ClearUX/auto_results.png',full_page=False)
 page.locator('#navGroupAssess summary').click()
 page.locator('.sidebar [data-target="checklist"]').click()
 assert page.locator('#signalList .signal-data').count()>0
 print('guided attached readings',page.locator('#signalList .signal-data').count())
 page.locator('.sidebar [data-target="stockreviews"]').click()
 page.locator('#newTicker').fill('NVDA');page.locator('#addTicker').click()
 print('stock automatic info',page.locator('#stockReviewBody .signal-data').count())
 print('errors',errors)
 b.close()
