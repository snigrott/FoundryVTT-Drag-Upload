/**
 * Drag Upload (V13 Compatible)
 * Significant refactoring for efficiency and V13 Data Model compatibility. 
 * Will NOT work with FoundryVTT versions prior to 12.
 * Optimized for Speed of Play: Multi-drop, Auto-folders, and Path Verification.
   Added, Sidebar Sorting, Auto-Handouts, and Staggered Placement.
 */

/**
 * Drag Upload - Robust V13 "Fred Edition"

 */

class DragUploadEngine {
    static ID = "drag-upload";

    static init() {
        // Setting for Actor Sidebar Folder
        game.settings.register(this.ID, "actorFolderName", {
            name: "Actor Sidebar Folder",
            hint: "Folder name for new Tokens in the Actor tab.",
            scope: "world",
            config: true,
            type: String,
            default: "Drag Uploads"
        });

        // Setting for Journal Sidebar Folder
        game.settings.register(this.ID, "journalFolderName", {
            name: "Journal Sidebar Folder",
            hint: "Folder name for new Handouts in the Journal tab.",
            scope: "world",
            config: true,
            type: String,
            default: "Drag Handouts"
        });

        const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;
        game.settings.register(this.ID, "fileUploadSource", {
            name: "Upload Source",
            scope: "world",
            config: !usingTheForge,
            type: String,
            default: usingTheForge ? "forgevtt" : "data",
            choices: { "data": "User Data", "s3": "S3 Storage" }
        });
    }

    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        if (!files || files.length === 0) return;

        event.preventDefault();
        event.stopPropagation();

        const activeLayer = canvas.activeLayer.name;
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";

        // Step 1: Ensure Server Directories exist
        await this.ensureServerDirectory(source, rootPath);

        // Step 2: Loop through batch files
        for (let i = 0; i < files.length; i++) {
            const offset = i * 50;
            const file = files[i];
            ui.notifications.info(`Processing ${file.name}...`);

            if (activeLayer.includes("TokenLayer")) {
                await this.createActor(event, file, offset);
            } else if (activeLayer.includes("NotesLayer")) {
                await this.createHandout(event, file, offset);
            } else {
                await this.createTile(event, file, activeLayer.includes("ForegroundLayer"), offset);
            }
        }
    }

    static async ensureServerDirectory(source, path) {
        const parts = path.split("/");
        let currentPath = "";
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try { await FilePicker.browse(source, currentPath); } 
            catch (err) { await FilePicker.createDirectory(source, currentPath); }
        }
        // Sub-directories
        for (const sub of ["tokens", "journals", "tiles"]) {
            try { await FilePicker.createDirectory(source, `${path}/${sub}`); } catch(e) {}
        }
    }

    static async createActor(event, file, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "actorFolderName");
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        
        let folder = game.folders.find(f => f.name === sidebarName && f.type === "Actor");
        if (!folder) folder = await Folder.create({ name: sidebarName, type: "Actor", color: "#ff6600" });

        const actor = await Actor.create({
            name: file.name.replace(/\.[^/.]+$/, ""),
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0],
            img: upload.path,
            folder: folder.id,
            prototypeToken: { texture: { src: upload.path } }
        });

        return this.placeToken(event, actor, upload.path, offset);
    }

    static async createHandout(event, file, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "journalFolderName");
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);

        let folder = game.folders.find(f => f.name === sidebarName && f.type === "JournalEntry");
        if (!folder) folder = await Folder.create({ name: sidebarName, type: "JournalEntry", color: "#00ffcc" });

        const journal = await JournalEntry.create({
            name: file.name.replace(/\.[^/.]+$/, ""),
            folder: folder.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, // Fred Style: Everyone sees it
            pages: [{ name: file.name, type: "image", src: upload.path }]
        });

        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id,
            x: coords.x,
            y: coords.y,
            texture: { src: "icons/svg/book.svg" }
        }]);

        journal.show("image", true); // Instantly pop-up for players
    }

    static async createTile(event, file, overhead, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const upload = await FilePicker.upload(source, "assets/drag-upload/tiles", file);
        const coords = this.getCoords(event, offset);
        const tex = await loadTexture(upload.path);

        const data = {
            texture: { src: upload.path },
            width: tex.baseTexture.width,
            height: tex.baseTexture.height,
            overhead: overhead,
            x: coords.x - (tex.baseTexture.width / 2),
            y: coords.y - (tex.baseTexture.height / 2)
        };
        if (!event.shiftKey) Object.assign(data, canvas.grid.getSnappedPosition(data.x, data.y));
        return canvas.scene.createEmbeddedDocuments('Tile', [data]);
    }

    static async placeToken(event, actor, path, offset) {
        const coords = this.getCoords(event, offset);
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

    static getCoords(event, offset) {
        const t = canvas.stage.worldTransform;
        return {
            x: ((event.clientX - t.tx) / canvas.stage.scale.x) + offset,
            y: ((event.clientY - t.ty) / canvas.stage.scale.y) + offset
        };
    }
}

Hooks.once("init", () => DragUploadEngine.init());
Hooks.on("ready", () => {
    document.getElementById("board")?.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev));
});
