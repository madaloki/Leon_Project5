Introduction to Web Development, Michael Leon - Project 5: Multi-User GLB Model Viewer
================================================

HOW TO RUN (Windows PowerShell or Command Prompt, inside this folder)
  1. npm.cmd install          (downloads express and ws into node_modules)
  2. node server.js
  3. Open http://localhost:3000 in a browser   -> this window is the HOST
  4. Open http://localhost:3000 in more windows/browsers -> these are SPECTATORS

DEMO
  - Host: pick a model in "Add a Model" and click Load Model
    (or use the file picker to upload a new .glb).
    Every spectator loads its own copy of the model automatically.
  - Host: pick a model in the dropdown and use the move buttons.
    The model moves in every window.
  - Everyone: rotate / zoom / pan your own camera. Other windows are not affected.
  - Close the Host window: the next spectator is promoted to Host.
  - Class models are in public/models: rover, Owl2026, windmill_stylized,
    kayaCahrAnim, HumanFigure, CommercialRefrigerator, human_cell.

FILES
  server.js            Node.js server (Express + HTTP + WebSocket), owns the shared scene state
  package.json         Project info and the libraries it needs
  public/index.html        Page layout and BabylonJS script tags (from Prof R's BabylonJS_glb.html)
  public/BabylonJS_glb.css Page styling 
  public/BabylonJS_glb.js  Prof R's loader + WebSocket messages, shared scene, host controls
  public/models/       Uploaded .glb files are saved here

SHARING IT WITH OTHER PEOPLE
  Option A - Same Wi-Fi (classroom):
    Run "ipconfig", find the IPv4 Address (e.g. 192.168.1.25).
    Guests open http://192.168.1.25:3000  (allow Node.js through Windows Firewall).
  Option B - Public link from your PC (Cloudflare Quick Tunnel, no account):
    winget install --id Cloudflare.cloudflared
    node server.js                       (window 1)
    cloudflared tunnel --url http://localhost:3000   (window 2)
    Share the https://....trycloudflare.com link. Open it yourself FIRST to be Host.
  Option C - GitHub + Render (link works even when your PC is off):
    Push this folder to a GitHub repo, then on render.com: New > Web Service,
    pick the repo, Build Command: npm install, Start Command: node server.js.
    Share the https://....onrender.com link.
