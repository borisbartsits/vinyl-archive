import re, json, os, base64

with open("vinyl-catalog.jsx", encoding="utf-8") as f:
    jsx = f.read()

m = re.search(r'const SEED = (\[.*?\]);', jsx, re.DOTALL)
seed_js = m.group(1)
seed_data = json.loads(seed_js)
seed_stripped = [{k:v for k,v in r.items() if k not in ('thumb','thumbFront','thumbBack')} for r in seed_data]

code = jsx
code = code.replace(seed_js, json.dumps(seed_stripped, ensure_ascii=False))
code = re.sub(r'^import.*from.*;\n', '', code, flags=re.MULTILINE)
code = code.replace("export default function VinylCatalog()", "function VinylCatalog()")
code = code.replace(
    'const API    = "https://api.anthropic.com/v1/messages";',
    'const IN_CLAUDE = (window.self !== window.top);\nconst API = IN_CLAUDE ? "https://api.anthropic.com/v1/messages" : "https://dawn-rain-4579.n969dyjcn2.workers.dev";',
)
globals_header = """const { useState, useEffect, useRef } = React;
const XLSX = window.XLSX;
window.storage = {
  set: async (k,v) => { try{localStorage.setItem(k,v);}catch{} return {key:k,value:v}; },
  get: async (k) => { const v=localStorage.getItem(k); return v?{key:k,value:v}:null; },
  delete: async (k) => { localStorage.removeItem(k); return {key:k,deleted:true}; },
  list: async (prefix) => { const keys=Object.keys(localStorage).filter(k=>!prefix||k.startsWith(prefix)); return {keys}; }
};
"""
code = globals_header + code
code += "\n\nconst _r=ReactDOM.createRoot(document.getElementById('root'));\n_r.render(React.createElement(VinylCatalog));\n"
code_escaped = code.replace("</script>", "<\\/script>")

icon_svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-96 -96 192 192"><rect x="-96" y="-96" width="192" height="192" rx="40" fill="#0D1B2A"/><circle cx="0" cy="0" r="88" fill="none" stroke="#C8A96E" stroke-width="2" opacity="0.35"/><circle cx="0" cy="0" r="74" fill="none" stroke="#C8A96E" stroke-width="1.8" opacity="0.5"/><circle cx="0" cy="0" r="60" fill="none" stroke="#C8A96E" stroke-width="1.5" opacity="0.65"/><circle cx="0" cy="0" r="47" fill="none" stroke="#C8A96E" stroke-width="1.2" opacity="0.75"/><circle cx="0" cy="0" r="36" fill="#112234" stroke="#C8A96E" stroke-width="2"/><path d="M -25 -4 C -17 -13, -8 -13, 0 -4 C 8 5, 17 5, 25 -4" fill="none" stroke="#2E6B8A" stroke-width="2.5" stroke-linecap="round"/><path d="M -25 5 C -17 -4, -8 -4, 0 5 C 8 14, 17 14, 25 5" fill="none" stroke="#2E6B8A" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/><path d="M -88 0 C -58 18, -29 27, 0 23 C 29 19, 58 8, 88 0" fill="none" stroke="#2E6B8A" stroke-width="2.5" opacity="0.75" stroke-linecap="round"/><circle cx="0" cy="0" r="5" fill="#C8A96E"/><circle cx="0" cy="0" r="2.5" fill="#0D1B2A"/></svg>'

index_html = '''<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <title>vinyldarksea — цифровой каталог</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,600&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet"/>
  <link rel="manifest" href="manifest.json"/>
  <meta name="theme-color" content="#0D1B2A"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-title" content="vinyldarksea"/>
  <link rel="apple-touch-icon" href="icon.svg"/>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0D1B2A}#root{min-height:100vh}#splash{position:fixed;inset:0;background:#0D1B2A;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999}.sp-vinyl{animation:sp-spin 2s linear infinite}@keyframes sp-spin{to{transform:rotate(360deg)}}#errmsg{position:fixed;inset:0;background:#0D1B2A;display:none;color:#e08080;font:12px monospace;padding:20px;overflow:auto;white-space:pre-wrap;z-index:9999}</style>
</head>
<body>
  <div id="splash">
    <svg class="sp-vinyl" width="56" height="56" viewBox="-90 -90 180 180" style="margin-bottom:16px">
      <circle cx="0" cy="0" r="85" fill="none" stroke="#C8A96E" stroke-width="2" opacity="0.25"/>
      <circle cx="0" cy="0" r="68" fill="none" stroke="#C8A96E" stroke-width="1.5" opacity="0.4"/>
      <circle cx="0" cy="0" r="52" fill="none" stroke="#C8A96E" stroke-width="1.5" opacity="0.55"/>
      <circle cx="0" cy="0" r="30" fill="#112234" stroke="#C8A96E" stroke-width="1.5"/>
      <path d="M -20 -3 C -13 -10, -6 -10, 0 -3 C 6 4, 13 4, 20 -3" fill="none" stroke="#2E6B8A" stroke-width="2" stroke-linecap="round"/>
      <path d="M -88 0 C -58 16, -29 24, 0 20 C 29 16, 58 6, 88 0" fill="none" stroke="#2E6B8A" stroke-width="2" opacity="0.6" stroke-linecap="round"/>
      <circle cx="0" cy="0" r="4" fill="#C8A96E"/>
      <circle cx="0" cy="0" r="2" fill="#0D1B2A"/>
    </svg>
    <div style="color:#C8A96E;font:17px 'Playfair Display',Georgia,serif;letter-spacing:0.04em;font-style:italic">vinyldarksea</div>
    <div style="color:#7A9AAD;font:11px 'DM Mono',monospace;margin-top:5px;letter-spacing:0.1em">цифровой каталог</div>
  </div>
  <div id="errmsg"></div>
  <div id="root"></div>
  <script>window.onerror=function(m,s,l,c,e){document.getElementById("splash").style.display="none";var d=document.getElementById("errmsg");d.style.display="block";d.textContent="ERROR: "+m+"\\nLine: "+l+"\\n\\n"+(e?e.stack:"")};</script>
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.23.2/babel.min.js"></script>
  <script type="text/babel">
''' + code_escaped + '''
  </script>
  <script>document.getElementById("splash").style.display="none";if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js");</script>
</body>
</html>'''

with open("index.html", "w", encoding="utf-8") as f:
    f.write(index_html)
with open("icon.svg", "w") as f:
    f.write(icon_svg)
print(f"Built: {len(index_html)//1024}KB")
