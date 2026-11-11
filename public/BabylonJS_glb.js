// Michael Leon, Intro To WebDev - Project 5
// Multi-user version of Prof R's BabylonJS glb Loader

/*
 * APPLICATION OVERVIEW
 * ---------------------------------------------------------
 * 1. BabylonJS creates a scene, camera, and light source
 *    (same as Prof R's loader).
 * 2. The browser connects to the Node.js server with a WebSocket.
 * 3. The server tells us if we are the Host or a Spectator.
 * 4. The Host picks a model (or uploads a new .glb file) and
 *    asks the server to add it to the shared scene.
 * 5. The server sends the scene state to every browser.
 * 6. Each browser loads ITS OWN copy of each model from
 *    the public/models folder and places it where the
 *    server says.
 * 7. The camera is LOCAL: it is never sent to the server,
 *    so every user can rotate, zoom and pan on their own.
 * ---------------------------------------------------------
 */

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);

// DOM ELEMENTS
const roleElement = document.getElementById("role");
const statusElement = document.getElementById("status");
const modelCountElement = document.getElementById("modelCount");
const hostControls = document.getElementById("hostControls");
const spectatorMessage = document.getElementById("spectatorMessage");
const fileSelect = document.getElementById("fileSelect");
const loadBtn = document.getElementById("loadBtn");
const fileInput = document.getElementById("glbFileInput");
const modelSelect = document.getElementById("modelSelect");
const removeBtn = document.getElementById("removeBtn");
const clearBtn = document.getElementById("clearBtn");

let scene;                        // global
let ws;                           // WebSocket connection to the server
let role = "spectator";           // Our role, set by the server
let sceneState = { models: [] };  // Latest copy of the SHARED state from the server
let loadedModels = {};            // Our OWN copies of the models: id -> { rootMesh, center } or "loading"
const moveStep = 2;               // How far one click of a move button moves a model

const createScene = async () => {
    const scene = new BABYLON.Scene(engine); // local to function

    let yaw = toRadians(-90.0);     // look at the row of models from the front (models line up along x)
    let pitch = toRadians(80.0);    // 90 degs at horizon, 0 looking up, 120 looking 30degs down
    // https://doc.babylonjs.com/typedoc/classes/BABYLON.ArcRotateCamera
    // LOCAL camera - every user has their own. It is NEVER sent to the server.
    //                                                             distance      target
    const camera = new BABYLON.ArcRotateCamera("camera", yaw, pitch, 30, new BABYLON.Vector3(0, 0, 0), scene);
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 10;     // smaller number = faster zoom

    // Add lighting
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.9;

    return scene;
};
// End of createScene


function toRadians(degrees) {
    return degrees * Math.PI / 180.0;
}

//https://www.w3schools.com/js/js_function_iife.asp
// An Immediately Invoked Function Expression (IIFE)
// Build the scene FIRST, then connect, so the scene is ready
// before the server sends us any models.
(async () => {
    scene = await createScene();
    connectToServer();
})();

// ---------------- WEBSOCKET ----------------

function connectToServer() {
    // Use wss:// (secure) when the page was opened with https:// (tunnel links, Render),
    // otherwise the browser blocks the connection. Use plain ws:// on http://localhost.
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${wsProtocol}://${window.location.host}`); // WEBSOCKET CONNECTION

    // Receive server messages via WebSocket
    ws.onmessage = event => {
        const data = JSON.parse(event.data);

        // Role assignment
        if (data.type === "role") {
            role = data.role;
            showRole();
        }

        // Updated scene state
        if (data.type === "state") {
            sceneState = data.sceneState;
            syncScene();
            updateModelList();
        }
    }; // end of ws.onmessage

    ws.onclose = () => {
        roleElement.textContent = "Disconnected from server";
        roleElement.className = "";
    };
}

// Show or hide controls depending on our role
function showRole() {
    if (role === "host") {
        roleElement.textContent = "You are the HOST";
        roleElement.className = "host";
        hostControls.style.display = "block";
        spectatorMessage.style.display = "none";
        updateFileList();          // fill the "Add a Model" dropdown
    } else {
        roleElement.textContent = "You are a SPECTATOR";
        roleElement.className = "spectator";
        hostControls.style.display = "none";
        spectatorMessage.style.display = "block";
    }
}

// ---------------- MAKE OUR SCENE MATCH THE SERVER ----------------

function syncScene() {
    // STEP 1: Remove models we have that the server no longer has
    for (const id in loadedModels) {
        const stillThere = sceneState.models.find(m => m.id === id);
        if (!stillThere) {
            if (loadedModels[id] !== "loading") {
                loadedModels[id].rootMesh.dispose();   // remove it from our 3D scene
            }
            delete loadedModels[id];
        }
    }

    // STEP 2: Load new models and update positions of existing ones
    sceneState.models.forEach(model => {
        if (loadedModels[model.id] === undefined) {
            loadModel(model);                 // we don't have it yet, so load our own copy
        } else if (loadedModels[model.id] !== "loading") {
            setPosition(loadedModels[model.id], model.position);
        }
    });

    modelCountElement.textContent = "Models in scene: " + sceneState.models.length;
}

// Load one .glb file from the public/models folder on the server
async function loadModel(model) {
    loadedModels[model.id] = "loading";   // so we don't start loading it twice
    statusElement.textContent = "Loading " + model.fileName + "...";

    try {
        // https://doc.babylonjs.com/typedoc/functions/BABYLON.ImportMeshAsync
        const result = await
            BABYLON.SceneLoader.ImportMeshAsync(
                "",               // import all meshes
                "models/",        // folder on the server (public/models)
                model.fileName,   // file name from the shared scene state
                scene);           // Destination Babylon.js scene

        const rootMesh = result.meshes[0];             // Use the first mesh as the root mesh

        // Prof R's code: scale every model to the same size
        const bounds = rootMesh.getHierarchyBoundingVectors(); // Obtain bounding box information for the model
        const size = bounds.max.subtract(bounds.min);  // Calculate the model dimensions
        const largestDimension = Math.max(size.x, size.y, size.z); // Find the largest dimension
        const scale = 5 / largestDimension;            // Calculate a scaling factor for consistent model size
        rootMesh.scaling = new BABYLON.Vector3(scale, scale, scale);

        // Prof R's code: find the model's center so we can center it on its position
        const scaledBounds = rootMesh.getHierarchyBoundingVectors();
        const scaledSize = scaledBounds.max.subtract(scaledBounds.min);
        const center = scaledBounds.min.add(scaledSize.scale(0.5));

        // The scene may have changed while we were loading (for example Clear Scene)
        const latest = sceneState.models.find(m => m.id === model.id);
        if (!latest) {
            rootMesh.dispose();
            delete loadedModels[model.id];
        } else {
            loadedModels[model.id] = { rootMesh: rootMesh, center: center };
            setPosition(loadedModels[model.id], latest.position);
        }
        statusElement.textContent = "";
    } catch (error) {                    // Handle any loading errors
        console.error("Error loading GLB file:", error);
        statusElement.textContent = "Could not load " + model.fileName;
        delete loadedModels[model.id];
    }
}

// Put a model at the SHARED position, minus its center (like Prof R's loader)
function setPosition(loaded, position) {
    loaded.rootMesh.position = new BABYLON.Vector3(
        position.x - loaded.center.x,
        position.y - loaded.center.y,
        position.z - loaded.center.z);
}

// ---------------- HOST CONTROLS ----------------

// Ask the server which .glb files are in public/models
async function updateFileList() {
    const response = await fetch("/modelList");
    const files = await response.json();

    fileSelect.innerHTML = "";
    files.forEach(fileName => {
        const option = document.createElement("option");
        option.value = fileName;
        option.textContent = fileName;
        fileSelect.appendChild(option);
    });
}

// Load Model Event Listener: add the selected file to the shared scene
loadBtn.addEventListener("click", () => {
    if (!fileSelect.value) {
        return;
    }
    ws.send(JSON.stringify({ type: "loadModel", fileName: fileSelect.value }));
});

// Handle file input change event (from Prof R's loader)
// This function executes when the Host selects a file:
// upload it to the server, then tell everyone to load it
fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    statusElement.textContent = "Uploading " + file.name + "...";

    // Send the file bytes to the server's /upload route
    const response = await fetch("/upload?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file
    });
    const result = await response.json();

    if (!response.ok) {
        statusElement.textContent = "";
        alert(result.error);
        return;
    }

    // The file is now in public/models. Ask the server to add it to the shared scene.
    ws.send(JSON.stringify({ type: "loadModel", fileName: result.fileName }));
    fileInput.value = "";      // clear the file picker
    updateFileList();          // the new file now shows in the dropdown too
});

// Fill the "Move a Model" dropdown with the models that are in the scene
function updateModelList() {
    const selected = modelSelect.value;
    modelSelect.innerHTML = "";

    sceneState.models.forEach((model, index) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = (index + 1) + ". " + model.fileName;
        modelSelect.appendChild(option);
    });

    // Keep the same model selected if it still exists
    if (sceneState.models.find(m => m.id === selected)) {
        modelSelect.value = selected;
    }
}

// Move the selected model. We only SEND the new position;
// the model really moves when the server broadcasts the new state.
function moveSelected(dx, dy, dz) {
    const model = sceneState.models.find(m => m.id === modelSelect.value);
    if (!model) {
        return;
    }
    const newPosition = {
        x: model.position.x + dx,
        y: model.position.y + dy,
        z: model.position.z + dz
    };
    ws.send(JSON.stringify({ type: "moveModel", id: model.id, position: newPosition }));
}

document.getElementById("leftBtn").addEventListener("click", () => moveSelected(-moveStep, 0, 0));
document.getElementById("rightBtn").addEventListener("click", () => moveSelected(moveStep, 0, 0));
document.getElementById("forwardBtn").addEventListener("click", () => moveSelected(0, 0, moveStep));
document.getElementById("backBtn").addEventListener("click", () => moveSelected(0, 0, -moveStep));
document.getElementById("upBtn").addEventListener("click", () => moveSelected(0, moveStep, 0));
document.getElementById("downBtn").addEventListener("click", () => moveSelected(0, -moveStep, 0));

// Remove Model Event Listener
removeBtn.addEventListener("click", () => {
    if (!modelSelect.value) {
        return;
    }
    ws.send(JSON.stringify({ type: "removeModel", id: modelSelect.value }));
});

// Clear Scene Event Listener
clearBtn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "clearScene" }));
});

// Run the engine
engine.runRenderLoop(() => {    // Start BabylonJS's continuous render loop
    if (scene) {
        scene.render();         // Render one frame of the scene
    }
});

// LOCAL DATA - window size. Each browser resizes on its own.
window.addEventListener("resize", () => {   // Execute when the browser window changes size
    engine.resize();                        // Resize the rendering engine to match the canvas
});
