//Michael Leon 
//Intro To WebDev - Project 5
// Multi-User BabylonJS GLB Viewer (SERVER)

/*
 * SERVER OVERVIEW
 * ---------------------------------------------------------
 * 1. Express serves everything in the public folder
 *    (HTML, CSS, JS and the .glb models in public/models).
 * 2. The first browser to connect becomes the Host.
 *    Every browser after that is a Spectator.
 * 3. The server keeps the shared scene state: a list of
 *    models with an id, a file name and a position.
 * 4. Only the Host may load, move or clear models.
 * 5. After every change the server sends the new state
 *    to every browser (broadcastState).
 * 6. The Host can upload a new .glb file over HTTP.
 * ---------------------------------------------------------
 *
 */

// SERVER SETUP
const express = require("express");    // Import the Express framework
const http = require("http");          // Import HTTP module for Express and WebSockets
const WebSocket = require("ws");       // WebSocket library for real-time communication
const fs = require("fs");              // File system module (read the models folder, save uploads)
const path = require("path");          // Helps build safe file paths

const app = express();                        // Create Express application
const server = http.createServer(app);        // Create HTTP server
const wss = new WebSocket.Server({ server }); // Create WebSocket server
app.use(express.static("public"));            // Serve everything inside the public folder

// Folder where the .glb files live (public/models)
const MODELS_FOLDER = path.join(__dirname, "public", "models");
if (!fs.existsSync(MODELS_FOLDER)) {
    fs.mkdirSync(MODELS_FOLDER, { recursive: true });
}

// Space between models (same value as Prof R's loader)
const spacing = 10;

// SCENE STATE
// The server owns the "truth". It only stores INFORMATION about each model,
// never the actual .glb file data.
let sceneState = {
    models: []      // each item: { id, fileName, position: {x, y, z} }
};

let host = null;    // The WebSocket connection of the current Host
let nextId = 1;     // Used to give every model a unique id

// SEND SCENE STATE TO EVERYONE
function broadcastState() {
    const payload = JSON.stringify({
        type: "state", sceneState
    });

    // Loop through clients call lambda expression with each client
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// TELL ONE CLIENT WHAT ITS ROLE IS
function sendRole(ws) {
    ws.send(JSON.stringify({ type: "role", role: ws.role }));
}

// PICK AN X POSITION FOR A NEW MODEL
// Same pattern as Prof R's loader: first model at 0,
// then -10, +10, -20, +20 ... so models spread out left and right.
function getXPosition(modelCount) {
    if (modelCount === 0) {
        return 0;
    }
    const step = Math.ceil(modelCount / 2);
    if (modelCount % 2 === 1) {
        return -step * spacing;
    } else {
        return step * spacing;
    }
}

// LIST THE .glb FILES IN public/models
// The Host's dropdown asks for this list with fetch("/modelList")
app.get("/modelList", (req, res) => {
    const files = fs.readdirSync(MODELS_FOLDER)
        .filter(name => name.toLowerCase().endsWith(".glb"));
    res.json(files);
});

// FILE UPLOAD ROUTE
// The Host's browser sends the raw bytes of a .glb file here.
// The file name comes in the URL, for example: /upload?name=car.glb
app.post("/upload", express.raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
    let fileName = req.query.name || "";

    // Keep only safe characters so nobody can write outside the models folder
    fileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");

    // Only allow .glb files
    if (!fileName.toLowerCase().endsWith(".glb")) {
        res.status(400).json({ error: "Only .glb files are allowed" });
        return;
    }

    // Make sure a file was actually sent
    if (!req.body || req.body.length === 0) {
        res.status(400).json({ error: "The file was empty" });
        return;
    }

    // Save the file into public/models so every client can load it
    fs.writeFileSync(path.join(MODELS_FOLDER, fileName), req.body);
    console.log("Uploaded file: " + fileName);

    res.json({ fileName: fileName });
});

// Connection Event Handler, ws is the WebSocket connection for that specific user
wss.on("connection", ws => {

    // HOST SELECTION: first client is the host, everyone else is a spectator
    if (host === null) {
        host = ws;
        ws.role = "host";
    } else {
        ws.role = "spectator";
    }
    console.log("A user connected as: " + ws.role);

    // Tell this client its role, then send the current scene
    // (so a spectator who joins late still sees every model)
    sendRole(ws);
    ws.send(JSON.stringify({ type: "state", sceneState }));

    // RECEIVE MESSAGE
    ws.on("message", message => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (error) {
            return; // ignore anything that is not valid JSON
        }

        // Only the Host is allowed to change the shared scene
        if (ws !== host) {
            return;
        }

        // LOAD A MODEL
        if (data.type === "loadModel") {
            // The file must really exist in public/models
            const fileName = path.basename(String(data.fileName || ""));
            if (!fs.existsSync(path.join(MODELS_FOLDER, fileName))) {
                return;
            }

            sceneState.models.push({
                id: "model" + nextId,
                fileName: fileName,
                position: { x: getXPosition(sceneState.models.length), y: 0, z: 0 }
            });
            nextId++;

            broadcastState();
        }

        // MOVE A MODEL
        if (data.type === "moveModel") {
            // Find the model with the matching id
            const model = sceneState.models.find(m => m.id === data.id);
            if (!model || !data.position) {
                return;
            }
            model.position.x = Number(data.position.x) || 0;
            model.position.y = Number(data.position.y) || 0;
            model.position.z = Number(data.position.z) || 0;

            broadcastState();
        }

        // REMOVE ONE MODEL
        if (data.type === "removeModel") {
            sceneState.models = sceneState.models.filter(m => m.id !== data.id);
            broadcastState();
        }

        // CLEAR THE SCENE
        if (data.type === "clearScene") {
            sceneState.models = [];
            broadcastState();
        }
    }); // end of ws.on("message", message => {

    // CLIENT DISCONNECTS
    ws.on("close", () => {
        console.log("A " + ws.role + " disconnected");

        // If the Host leaves, promote the next connected user to Host
        if (ws === host) {
            host = null;
            wss.clients.forEach(client => {
                if (host === null && client !== ws && client.readyState === WebSocket.OPEN) {
                    host = client;
                    client.role = "host";
                    sendRole(client);
                    console.log("A spectator was promoted to host");
                }
            });
        }
    });

});
// End of wss.on

// Cloud hosts like Render choose the port for us in process.env.PORT.
// On your own PC it falls back to 3000.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log("Server running at http://localhost:" + PORT); });
