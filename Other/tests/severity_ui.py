from playwright.sync_api import sync_playwright
from pathlib import Path
h=(Path(__file__).resolve().parents[1]/'index.html').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':950})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_default_timeout(4000);page.goto('about:blank')
 page.evaluate('''() => {
 const store=(function(){let d={};return {getItem:k=>d[k]??null,setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}})();
 const session=(function(){let d={};return {getItem:k=>d[k]??null,setItem:(k,v)=>d[k]=String(v),removeItem:k=>delete d[k]}})();
 Object.defineProperty(window,'localStorage',{configurable:true,value:store});Object.defineProperty(window,'sessionStorage',{configurable:true,value:session});
 const now=new Date().toISOString().slice(0,10);
 const checks=[
 {key:'M1',scope:'market',label:'High-yield credit spread',status:'watch',automatic_status:'watch',value:120,asof:now,checked_at:new Date().toISOString(),reason:'+120 basis points from recent low',source_url:'https://fred.stlouisfed.org/series/BAMLH0A0HYM2'},
 {key:'T1',scope:'market',label:'Nasdaq trend',status:'clear',automatic_status:'clear',value:8.5,asof:now,checked_at:new Date().toISOString(),reason:'Index is above both moving averages',source_url:'https://fred.stlouisfed.org/series/NASDAQ100'},
 {key:'S2',scope:'market',label:'VIX stress',status:'serious',automatic_status:'serious',value:37,asof:now,checked_at:new Date().toISOString(),reason:'VIX above 35; rule-level stress only',source_url:'https://fred.stlouisfed.org/series/VIXCLS'},
 {key:'sec:annual:MSFT',scope:'fundamentals',label:'MSFT annual cash flow',status:'review',automatic_status:'review',value:67,asof:'2026-06-30',checked_at:new Date().toISOString(),reason:'OCF 182.9 B less PP&E 115.9 B equals 67 B, not AI specific',source_url:'https://www.sec.gov/'},
 {key:'sys:provider',scope:'system',label:'Data provider health',status:'clear',automatic_status:'clear',asof:now,checked_at:new Date().toISOString(),reason:'Sources checked.'}
 ];
 window.mockchecks=checks;
 window.fetch=async(url,opts={})=>{let path=new URL(url).pathname;const payload=path==='/api/ping'?{ok:true}:path==='/api/overview'?{checks:window.mockchecks,events:[],runs:[{finished_at:new Date().toISOString()}]}:path==='/api/user-state'?{revision:0,state:null}:path==='/api/check'?{ok:true,completed:true}:path==='/api/test-telegram'?{sent:true}:{ok:true};return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}})};
 }''')
 page.set_content(h,wait_until='domcontentloaded')
 print('A start',flush=True)
 page.locator('#topSettings').click()
 page.locator('#cfEndpoint').fill('https://worker.example.workers.dev')
 page.locator('#cfToken').fill('0123456789abcdef0123456789abcdef')
 page.locator('#cfConnect').click()
 page.locator('#cfChecks .live-check').first.wait_for(timeout=10000)
 page.locator('#navGroupAssess').evaluate('(x)=>x.open=true');page.locator('.sidebar [data-target="checklist"]').click()
 print('C open M1',flush=True);page.locator('[data-signal-card="M1"] > summary').click()
 m1=page.locator('[data-signal-card="M1"]')
 assert m1.locator('[data-kind="status"]').input_value()=='moderate',m1.inner_text()[:1000]
 assert 'Automatic result: Moderate' in m1.inner_text()
 assert '120 basis' in m1.inner_text()
 assert m1.locator('.auto-restore').count()==1
 m1.locator('[data-kind="status"]').select_option('very_serious')
 assert m1.locator('[data-kind="status"]').input_value()=='very_serious'
 assert 'Manual override' in m1.locator('.tagline').inner_text() or page.evaluate('state.signals.M1.origin')=='manual'
 # update source check, do not overwrite manual
 page.evaluate('''() => { window.mockchecks.find(x=>x.key==='M1').status='clear';window.mockchecks.find(x=>x.key==='M1').automatic_status='clear';window.mockchecks.find(x=>x.key==='M1').reason='No threshold reached on latest data'; }''')
 page.evaluate("document.getElementById('cfRefresh').click()")
 page.wait_for_timeout(500)
 assert m1.locator('[data-kind="status"]').input_value()=='very_serious'
 assert 'Restore latest automatic rating (Low)' in m1.inner_text()
 m1.locator('[data-auto-restore="M1"]').click()
 assert page.locator('[data-signal-card="M1"] [data-kind="status"]').input_value()=='low'
 assert page.evaluate('state.signals.M1.origin')=='auto'
 # V2: data only; not assessed, no restore
 print('D open V2',flush=True);page.locator('[data-signal-card="V2"] > summary').click()
 v2=page.locator('[data-signal-card="V2"]')
 assert v2.locator('[data-kind="status"]').input_value()=='unknown',v2.inner_text()[:1500]
 assert v2.locator('[data-auto-restore]').count()==0
 assert 'cannot assign a defensible severity' in v2.inner_text().lower()
 # S2 serious and T1 low; including automatic outcomes
 assert page.locator('[data-signal-card="S2"] [data-kind="status"]').input_value()=='serious'
 assert page.locator('[data-signal-card="T1"] [data-kind="status"]').input_value()=='low'
 # One-click fresh Worker recheck also replaces a manual override, no duplicate source-level editing.
 page.locator('[data-signal-card="S2"] > summary').click()
 svix=page.locator('[data-signal-card="S2"]')
 svix.locator('[data-kind="status"]').select_option('very_serious')
 page.evaluate("() => {window.mockchecks.find(x=>x.key==='S2').status='watch';window.mockchecks.find(x=>x.key==='S2').automatic_status='watch';}")
 svix.locator('[data-auto-recheck="S2"]').click()
 page.wait_for_timeout(350)
 assert page.locator('[data-signal-card="S2"] [data-kind="status"]').input_value()=='moderate'
 assert page.evaluate('state.signals.S2.origin')=='auto'
 # An old observation must not leave an automatically selected false all-clear.
 page.evaluate("() => {window.mockchecks.find(x=>x.key==='M1').asof='2020-01-01';}")
 page.evaluate("document.getElementById('cfRefresh').click()")
 page.wait_for_timeout(300)
 assert page.locator('[data-signal-card="M1"] [data-kind="status"]').input_value()=='unknown'
 # company statuses use same scale
 page.locator('#navGroupAssess').evaluate('(x)=>x.open=true');page.locator('.sidebar [data-target="stockreviews"]').click()
 print('E stock',flush=True);page.locator('#newTicker').fill('MSFT');page.locator('#addTicker').click()
 company=page.locator('#companyChecks [data-stock-id="V2"][data-stock-kind="status"]')
 company.locator('xpath=ancestor::details').evaluate('(el)=>el.open=true')
 company.select_option('moderate');assert company.input_value()=='moderate'
 page.locator('[data-ticker="MSFT"]').click()
 assert page.locator('#companyChecks [data-stock-id="V2"][data-stock-kind="status"]').input_value()=='moderate'
 print('automatic M1 low after restore, S2 serious, T1 low; V2 unrated; manual override preserved; stock rating persisted')
 print('page errors:',errors)
 page.locator('#navGroupAssess').evaluate('(x)=>x.open=true');page.locator('.sidebar [data-target="checklist"]').click()
 print('D open V2',flush=True);page.locator('[data-signal-card="V2"] > summary').click()
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'new_severity_ui.png'),full_page=False)
 assert not errors, errors
 browser.close()
