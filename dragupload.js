/**
 * Drag Upload (V13 Compatible)
 * Significant refactoring for efficiency and V13 Data Model compatibility. 
 * Will NOT work with FoundryVTT versions prior to 12.
 */

Hooks.once('init', async () => {
    const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;

    // Registers settings under the hyphenated "drag-upload" ID
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
        name: "Upload Folder Path",
        hint: "Example: drag-upload/uploaded",
        scope: "world",
        config: true,
        type: String,
        default: "drag-upload/uploaded",
        onChange: async () => { await initializeDragUpload(); }
    });
});

Hooks.once('ready', async function() {
    await initializeDragUpload();

    const board = document.getElementById("board");
    if (board) {
        new DragDrop({
            callbacks: { drop: handleDrop }
        }).bind(board);
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
    event.preventDefault();

    let file = null; // Fresh start for every drop event
    const dataTransfer = event.dataTransfer;
    const files = dataTransfer.files;

    if (files && files.length > 0) {
        file = files[0];
        console.log(`DragUpload | Processing local file: ${file.name}`);
    } 
    else {
        const rawUrl = dataTransfer.getData("text/plain") || dataTransfer.getData("text/uri-list");
        if (rawUrl) {
            const cleanUrl = rawUrl.split("?")[0];
            const filename = cleanUrl.split("/").pop() || "web-import.png";
            const extension = filename.split(".").pop().toLowerCase();

            const validExtensions = Object.keys(CONST.IMAGE_FILE_EXTENSIONS)
                .concat(Object.keys(CONST.VIDEO_FILE_EXTENSIONS))
                .concat(Object.keys(CONST.AUDIO_FILE_EXTENSIONS));

            if (validExtensions.includes(extension)) {
                file = { isExternalUrl: true, url: cleanUrl, name: filename };
                console.log(`DragUpload | Processing external URL: ${cleanUrl}`);
            }
        }
    }

    if (!file) {
        console.log("DragUpload | No valid asset identified; delegating to core.");
        return canvas._onDrop(event);
    }

    const activeLayer = canvas.activeLayer.name;
    try {
        if (activeLayer.includes("TokenLayer")) {
            await CreateActor(event, file);
        } else if (activeLayer.includes("NotesLayer")) {
            await CreateJournalPin(event, file);
        } else {
            await CreateTile(event, file, activeLayer.includes("ForegroundLayer"));
        }
    } catch (err) {
        console.error("DragUpload | Error creating document:", err);
    }
}

async function CreateTile(event, file, overhead) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const path = file.isExternalUrl ? file.url : (await FilePicker.upload(source, `${window.dragUpload.targetFolder}/tiles`, file)).path;
    const coords = convertXYtoCanvas(event);
    const tex = await loadTexture(path);
    
    const data = {
        texture: { src: path },
        width: tex.baseTexture.width,
        height: tex.baseTexture.height,
        overhead: overhead,
        x: coords.x - (tex.baseTexture.width / 2),
        y: coords.y - (tex.baseTexture.height / 2)
    };

    if (!event.shiftKey) Object.assign(data, canvas.grid.getSnappedPosition(data.x, data.y));
    return canvas.scene.createEmbeddedDocuments('Tile', [data]);
}

async function CreateActor(event, file) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    const path = file.isExternalUrl ? file.url : (await FilePicker.upload(source, `${window.dragUpload.targetFolder}/tokens`, file)).path;
    const coords = convertXYtoCanvas(event);

    const actor = await Actor.create({
        name: file.name.replace(/\.[^/.]+$/, ""),
        type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0],
        img: path,
        prototypeToken: { texture: { src: path } } // Correct V13 Data Structure
    });

    const tokenData = {
        name: actor.name,
        actorId: actor.id,
        actorLink: true,
        texture: { src: path },
        x: coords.x,
        y: coords.y
    };

    if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
    return canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
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
        icon: "icons/svg/book.svg"
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
    const targetLocation = game.settings.get("drag-upload", "fileUploadFolder");
    const folders = targetLocation.split("/").filter(x => x !== "");
    let path = "";
    for (const f of folders) {
        path += (path ? "/" : "") + f;
        await createFolderIfMissing(path);
    }
    await createFolderIfMissing(`${path}/tokens`);
    await createFolderIfMissing(`${path}/tiles`);
    await createFolderIfMissing(`${path}/journals`);
}

async function createFolderIfMissing(folderPath) {
    const source = game.settings.get("drag-upload", "fileUploadSource");
    try {
        await FilePicker.createDirectory(source, folderPath);
    } catch (e) {}
}