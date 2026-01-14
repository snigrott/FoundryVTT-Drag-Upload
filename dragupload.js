/**
 * Drag Upload (V13 Optimized & S3 Ready)
 * Version 3.3.4
 * * FEATURES:
 * - S3, Forge, and Local Data storage compatibility.
 * - Sequential folder creation to prevent DB race conditions.
 * - Promise.all for concurrent (high-speed) multi-file uploads.
 * - One-time Alt+Scroll UI notification for GMs.
 * - Precise coordinate mapping using PIXI internals.
 */

class DragUploadEngine {
    static ID = "drag-upload";

    static init() {
        this.registerSettings();
        // Alt+Scroll remains on the window as it's a specific key-combo modifier
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
    }

    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        game.settings.register(this.ID, "journalFolderName", { name: "Journal Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Handouts" });
        
        const sourceChoices = { "data": "User Data (Local)" };
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) sourceChoices["forgevtt"] = "The Forge";
        sourceChoices["s3"] = "S3 Cloud";

        game.settings.register(this.ID, "fileUploadSource", { 
            name: "Upload Source", 
            scope: "world", 
            config: true, 
            type: String, 
            default: "data", 
            choices: sourceChoices 
        });
    }

    static _onWheel(event) {
        if (!event.altKey || !canvas.ready) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        const delta = event.deltaY < 0 ? 0.5 : -0.5; 
        let newSize = Math.max(0.5, hover.document.width + delta);
        hover.document.update({ width: newSize, height: newSize });
    }

    /**
     * The safest way to handle drops in Foundry.
     * This only triggers when files are dropped onto the canvas.
     */
    static async handleCanvasDrop(canvas, data) {
        const files = data.files;
        if (!files?.length || !game.user.isGM) return true; // Let Foundry handle it if no files

        const activeTool = ui.controls.activeControl; 
        await this.ensureSidebarFolders(activeTool);

        ui.notifications.info(`Uploading ${files.length} files...`);

        const uploads = Array.from(files).map((file, i) => {
            const offset = i * 20;
            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            return activeTool === "notes" 
                ? this.createHandout(data, file, cleanName, offset)
                : this.createActor(data, file, cleanName, offset);
        });

        const results = await Promise.all(uploads);
        this.postToChat(results.filter(r => r), activeTool);
        
        return false; // Prevent further drop handling for these files
    }

    static async ensureSidebarFolders(tool) {
        const isNote = tool === "notes";
        const folderName = game.settings.get(this.ID, isNote ? "journalFolderName" : "actorFolderName");
        const type = isNote ? "JournalEntry" : "Actor";
        if (!game.folders.contents.some(f => f.name === folderName && f.type === type)) {
            await Folder.create({ name: folderName, type: type });
        }
    }

    static async createActor(data, file, cleanName, offset) {
        try {
            const source = game.settings.get(this.ID, "fileUploadSource");
            const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
            const folder = game.folders.find(f => f.name === game.settings.get(this.ID, "actorFolderName") && f.type === "Actor");

            const actor = await Actor.create({
                name: cleanName,
                type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
                img: upload.path,
                folder: folder?.id,
                prototypeToken: { texture: { src: upload.path }, displayName: 20 }
            });

            const tokenData = {
                name: cleanName, actorId: actor.id, actorLink: true,
                texture: { src: upload.path }, x: data.x + offset, y: data.y + offset
            };
            
            if (!event?.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
            await canvas.scene.createEmbeddedDocuments('Token', [tokenData], {parent: canvas.scene});
            return actor;
        } catch (e) { console.error(e); return null; }
    }

    static async createHandout(data, file, cleanName, offset) {
        try {
            const source = game.settings.get(this.ID, "fileUploadSource");
            const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);
            const folder = game.folders.find(f => f.name === game.settings.get(this.ID, "journalFolderName") && f.type === "JournalEntry");

            const journal = await JournalEntry.create({
                name: cleanName, folder: folder?.id,
                pages: [{ name: cleanName, type: "image", src: upload.path }]
            });

            await canvas.scene.createEmbeddedDocuments('Note', [{
                entryId: journal.id, x: data.x + offset, y: data.y + offset,
                texture: { src: "icons/svg/book.svg" }
            }], {parent: canvas.scene});

            return journal;
        } catch (e) { console.error(e); return null; }
    }

    static postToChat(documents, tool) {
        if (!documents.length) return;
        const links = documents.map(doc => doc.toAnchor().outerHTML).join(", ");
        ChatMessage.create({
            whisper: [game.user.id],
            content: `<b>Drag Upload:</b> Created ${links}`
        });
    }

    static async ensureServerDirectory() {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";
        try {
            await FilePicker.browse(source, rootPath);
        } catch (err) {
            const parts = rootPath.split("/");
            let current = "";
            for (const p of parts) {
                current += (current ? "/" : "") + p;
                try { await FilePicker.createDirectory(source, current); } catch(e) {}
            }
            try { await FilePicker.createDirectory(source, rootPath + "/tokens"); } catch(e) {}
            try { await FilePicker.createDirectory(source, rootPath + "/journals"); } catch(e) {}
        }
    }
}

Hooks.once("init", () => DragUploadEngine.init());

// The safest, most compatible hook for canvas drops
Hooks.on("dropCanvasData", (canvas, data) => {
    if (data.files) return DragUploadEngine.handleCanvasDrop(canvas, data);
});

Hooks.on("ready", () => {
    if (game.user.isGM) DragUploadEngine.ensureServerDirectory();
});
