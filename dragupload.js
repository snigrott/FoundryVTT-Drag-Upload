/**
 * Drag Upload (V13 Compatible)
 * Version 3.0.4
 * Significant refactoring for efficiency and V13 Data Model compatibility. Will NOT work with FoundryVTT versions prior to 12.
 * Optimized for Speed of Play: Multi-drop, Auto-folders, and Path Verification. Sidebar Sorting, Auto-Handouts, and Staggered Placement.
 */

class DragUploadEngine {
    static ID = "drag-upload";

    static init() {
        game.settings.register(this.ID, "actorFolderName", {
            name: "Actor Sidebar Folder",
            hint: "Folder name for new Tokens in the Actor tab.",
            scope: "world",
            config: true,
            type: String,
            default: "Drag Uploads"
        });

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

        const activeTool = ui.controls.activeControl; 
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";

        await this.ensureServerDirectory(source, rootPath);

        for (let i = 0; i < files.length; i++) {
            const offset = i * 50;
            const file = files[i];
            
            // CLEAN FILENAME: Strip extension for cleaner UI
            const cleanName = file.name.replace(/\.[^/.]+$/, "");

            if (activeTool === "notes") {
                await this.createHandout(event, file, cleanName, offset);
            } else if (activeTool === "token") {
                await this.createActor(event, file, cleanName, offset);
            } else {
                await this.createTile(event, file, activeTool === "foreground", offset);
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
        for (const sub of ["tokens", "journals", "tiles"]) {
            try { await FilePicker.createDirectory(source, `${path}/${sub}`); } catch(e) {}
        }
    }

    static async createActor(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "actorFolderName");
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        
        let folder = game.folders.find(f => f.name === sidebarName && f.type === "Actor");
        if (!folder) folder = await Folder.create({ name: sidebarName, type: "Actor", color: "#ff6600" });

        const actor = await Actor.create({
            name: cleanName,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0],
            img: upload.path,
            folder: folder.id,
            prototypeToken: { 
                name: cleanName,
                texture: { src: upload.path },
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER // Shows name to GM/Players on hover
            }
        });

        const coords = this.getCoords(event, offset);
        const tokenData = {
            name: cleanName,
            actorId: actor.id,
            actorLink: true,
            texture: { src: upload.path },
            x: coords.x,
            y: coords.y,
            displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
        };
        if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        return canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    static async createHandout(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "journalFolderName");
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);

        let folder = game.folders.find(f => f.name === sidebarName && f.type === "JournalEntry");
        if (!folder) folder = await Folder.create({ name: sidebarName, type: "JournalEntry", color: "#00ffcc" });

        const journal = await JournalEntry.create({
            name: cleanName,
            folder: folder.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, 
            pages: [{ name: cleanName, type: "image", src: upload.path }]
        });

        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id,
            x: coords.x,
            y: coords.y,
            text: cleanName, // Sets the label on the map pin
            texture: { src: "icons/svg/book.svg" }
        }]);

        journal.show("image", true);
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
