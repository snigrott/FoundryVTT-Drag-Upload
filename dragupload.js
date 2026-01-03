/**
 * Drag Upload (V13 Compatible)
 * Significant refactoring for efficiency and V13 Data Model compatibility. 
 * Will NOT work with FoundryVTT versions prior to 12.
 * Optimized for Speed of Play: Multi-drop, Auto-folders, and Path Verification.
 */

Hooks.once('init', async () => {
    const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;

    // 1. Where the files go on the SERVER
    game.settings.register("drag-upload", "fileUploadSource", {
        name: "Upload Source",
        scope: "world",
        config: !usingTheForge,
        type: String,
        default: usingTheForge ? "forgevtt" : "data",
        choices: { "data": "User Data", "s3": "S3 Storage" },
        onChange: async () => { await initializeDragUpload(); }
    });

    game.settings.register("drag-upload", "fileUploadFolder", {
        name: "Server Upload Path",
        hint: "Where images are stored on your server. Default: assets/drag-upload",
        scope: "world",
        config: true,
        type: String,
        default: "assets/drag-upload",
        onChange: async () => { await initializeDragUpload(); }
    });

    // 2. Where the Actors go in the SIDEBAR
    game.settings.register("drag-upload", "actorFolderName", {
        name: "Actor Sidebar Folder",
        hint: "The name of the folder in your Actor sidebar.",
        scope: "world",
        config: true,
        type: String,
        default: "Drag Uploads"
    });
});

Hooks.once('ready', async function() {
    await initializeDragUpload();

    const board = document.getElementById("board");
    if (board) {
        // We use a standard event listener for better multi-file control
        board.addEventListener("drop", handleDrop);
    }
});

async function initializeDragUpload() {
    if (game.user.isGM || game.user.hasPermission(CONST.USER_PERMISSIONS.FILES_UPLOAD)) {
        await createFoldersIfMissing();
    }
    const targetFolder = game.settings.get("drag-upload", "fileUploadFolder");
    window.dragUpload = {
        targetFolder: targetFolder.split("/").filter(x => x !== "").join("/")
    };
}

async function handleDrop(event) {
    const files = event.dataTransfer.files;
    
    // Check for Local Files (Batch)
    if (files && files.length > 0) {
        event.preventDefault();
        event.stopPropagation();

        const activeLayer = canvas.activeLayer.name;
        for (let i = 0; i < files.length; i++) {
            const offset = i * 50; // Offset prevents tokens from stacking
            ui.notifications.info(`Processing ${files[i].name}...`);
            
            if (activeLayer.includes("TokenLayer")) {
                await CreateActor(event, files[i], offset);
            } else if (activeLayer.includes("NotesLayer")) {
                await CreateJournalPin(event, files[i]);
            } else {
                await CreateTile(event, files[i], activeLayer.includes("ForegroundLayer"), offset);
            }
        }
        return;
    } 

    // Check for External URL (Single)
    const rawUrl = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text/uri-list");
    if (rawUrl) {
        const cleanUrl = rawUrl.split("?")[0];
        const filename = cleanUrl.split("/").pop() || "web-import.png";
        const file = { isExternalUrl: true, url: cleanUrl, name: filename };
        
        if (canvas.activeLayer.name.includes("TokenLayer")) {
            event.preventDefault();
            await CreateActor(event, file, 0);
        }
    }
}

async function CreateActor(event, file, offset = 0) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const sidebarName = game.settings.get("drag-upload", "actorFolderName");
    
    // Upload logic
    const path = file.isExternalUrl ? file.url : (await FilePicker.upload(source, `${window.dragUpload.targetFolder}/tokens`, file)).path;
    const coords = convertXYtoCanvas(event);

    // 1. Sidebar Folder logic
    let folder = game.folders.find(f => f.name === sidebarName && f.type === "Actor");
    if (!folder) {
        folder = await Folder.create({ name: sidebarName, type: "Actor", color: "#ff6600" });
    }

    // 2. Create Actor (V13)
    const actor = await Actor.create({
        name: file.name.replace(/\.[^/.]+$/, ""),
        type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0],
        img: path,
        folder: folder.id,
        prototypeToken: { texture: { src: path } }
    });

    // 3. Create Token
    const tokenData = {
        name: actor.name,
        actorId: actor.id,
        actorLink: true,
        texture: { src: path },
        x: coords.x + offset,
        y: coords.y + offset
    };

    if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
    return canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
}

async function CreateTile(event, file, overhead, offset = 0) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const path = file.isExternalUrl ? file.url : (await FilePicker.upload(source, `${window.dragUpload.targetFolder}/tiles`, file)).path;
    const coords = convertXYtoCanvas(event);
    const tex = await loadTexture(path);
    
    const data = {
        texture: { src: path },
        width: tex.baseTexture.width,
        height: tex.baseTexture.height,
        overhead: overhead,
        x: (coords.x + offset) - (tex.baseTexture.width / 2),
        y: (coords.y + offset) - (tex.baseTexture.height / 2)
    };

    if (!event.shiftKey) Object.assign(data, canvas.grid.getSnappedPosition(data.x, data.y));
    return canvas.scene.createEmbeddedDocuments('Tile', [data]);
}

async function CreateJournalPin(event, file) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const path = file.isExternalUrl ? file.url : (await FilePicker.upload(source, `${window.dragUpload.targetFolder}/journals`, file)).path;
    const journal = await JournalEntry.create({ name: file.name, img: path });
    const coords = convertXYtoCanvas(event);

    return canvas.scene.createEmbeddedDocuments('Note', [{
        entryId: journal.id,
        x: coords.x,
        y: coords.y,
        texture: { src: "icons/svg/book.svg" }
    }]);
}

function convertXYtoCanvas(event) {
    const t = canvas.stage.worldTransform;
    return {
        x: (event.clientX - t.tx) / canvas.stage.scale.x,
        y: (event.clientY - t.ty) / canvas.stage.scale.y
    };
}

async function createFoldersIfMissing() {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const targetLocation = game.settings.get("drag-upload", "fileUploadFolder");
    const folders = targetLocation.split("/").filter(x => x !== "");
    let path = "";
    for (const f of folders) {
        path += (path ? "/" : "") + f;
        try { await FilePicker.createDirectory(source, path); } catch (e) {}
    }
    try { await FilePicker.createDirectory(source, `${path}/tokens`); } catch (e) {}
    try { await FilePicker.createDirectory(source, `${path}/tiles`); } catch (e) {}
    try { await FilePicker.createDirectory(source, `${path}/journals`); } catch (e) {}
}
