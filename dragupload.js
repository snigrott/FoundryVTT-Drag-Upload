/**
 * Drag Upload (V13 Optimized & S3 Ready)
 * Version 3.3.2
 * * FEATURES:
 * - S3, Forge, and Local Data storage compatibility.
 * - Sequential folder creation to prevent DB race conditions.
 * - Promise.all for concurrent (high-speed) multi-file uploads.
 * - One-time Alt+Scroll UI notification for GMs.
 * - Precise coordinate mapping using PIXI internals.
 */

class DragUploadEngine {
    static ID = "drag-upload";
    static hintShown = false;

    static init() {
        this.registerSettings();
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
        window.addEventListener("drop", (ev) => this.handleDrop(ev));
    }

    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        game.settings.register(this.ID, "journalFolderName", { name: "Journal Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Handouts" });
        
        const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;
        game.settings.register(this.ID, "fileUploadSource", { 
            name: "Upload Source", 
            scope: "world", 
            config: !usingTheForge, 
            type: String, 
            default: usingTheForge ? "forgevtt" : "data", 
            choices: { "data": "User Data (Local)", "s3": "S3 Cloud", "forgevtt": "The Forge" } 
        });
    }

    static _onWheel(event) {
        if (!event.altKey) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        const delta = event.deltaY < 0 ? 0.5 : -0.5; 
        let newSize = Math.max(0.5, hover.document.width + delta);
        hover.document.update({ width: newSize, height: newSize });
    }

    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        if (!files?.length || !canvas.ready || !game.user.isGM) return;

        const isUI = event.target.closest(".window-app, #sidebar, #controls, #navigation, #players");
        if (isUI || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

        event.preventDefault();
        event.stopPropagation();

        if (!this.hintShown) {
            ui.notifications.info("Drag Upload: Use ALT + Scroll to resize tokens.");
            this.hintShown = true;
        }

        const activeTool = ui.controls.activeControl; 
        await this.ensureSidebarFolders(activeTool);

        ui.notifications.info(`Processing ${files.length} uploads...`);

        const uploads = Array.from(files).map((file, i) => {
            const offset = i * 20;
            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            return activeTool === "notes" 
                ? this.createHandout(event, file, cleanName, offset)
                : this.createActor(event, file, cleanName, offset);
        });

        // Collect all created documents to post in chat
        const results = await Promise.all(uploads);
        this.postToChat(results, activeTool);
    }

    static async ensureSidebarFolders(tool) {
        const isNote = tool === "notes";
        const folderName = game.settings.get(this.ID, isNote ? "journalFolderName" : "actorFolderName");
        const type = isNote ? "JournalEntry" : "Actor";
        
        let folder = game.folders.find(f => f.name === folderName && f.type === type);
        if (!folder) {
            await Folder.create({ name: folderName, type: type, color: isNote ? "#00ffcc" : "#ff6600" });
        }
    }

    static async createActor(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "actorFolderName");
        
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        const folder = game.folders.find(f => f.name === sidebarName && f.type === "Actor");

        const actor = await Actor.create({
            name: cleanName,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path,
            folder: folder?.id,
            prototypeToken: { 
                name: cleanName, 
                texture: { src: upload.path },
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
                bar1: { attribute: game.system.id === "dnd5e" ? "attributes.hp" : "" }
            }
        });

        const coords = this.getCoords(event, offset);
        const tokenData = {
            name: cleanName, actorId: actor.id, actorLink: true,
            texture: { src: upload.path }, x: coords.x, y: coords.y,
            displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
        };
        
        if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData], {parent: canvas.scene});
        
        return actor; // Return for chat message logic
    }

    static async createHandout(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "journalFolderName");
        
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);
        const folder = game.folders.find(f => f.name === sidebarName && f.type === "JournalEntry");

        const journal = await JournalEntry.create({
            name: cleanName, 
            folder: folder?.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, 
            pages: [{ name: cleanName, type: "image", src: upload.path }]
        });

        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id, x: coords.x, y: coords.y,
            texture: { src: "icons/svg/book.svg" }
        }], {parent: canvas.scene});

        journal.show("image", true);
        return journal; // Return for chat message logic
    }

    static getCoords(event, offset) {
        const rect = canvas.app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const coords = canvas.canvasCoordinatesFromScreen({x: screenX, y: screenY});
        return { x: coords.x + offset, y: coords.y + offset };
    }

    /**
     * Creates a chat message with clickable links to all new items.
     */
    static postToChat(documents, tool) {
        const typeLabel = tool === "notes" ? "JournalEntry" : "Actor";
        const links = documents.map(doc => `@${typeLabel}[${doc.id}]{${doc.name}}`).join(", ");
        
        ChatMessage.create({
            user: game.user.id,
            whisper: [game.user.id],
            content: `<b>Drag Upload Complete</b><br>Created ${documents.length} items:<br>${links}`
        });
    }

    static async ensureServerDirectory() {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";
        const parts = rootPath.split("/");
        let currentPath = "";
        
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try { 
                await FilePicker.browse(source, currentPath); 
            } catch (err) { 
                try { await FilePicker.createDirectory(source, currentPath); } catch(e) {} 
            }
        }
        for (const sub of ["tokens", "journals"]) {
            try { await FilePicker.createDirectory(source, `${rootPath}/${sub}`); } catch(e) {}
        }
    }
}

Hooks.once("init", () => DragUploadEngine.init());
Hooks.on("ready", () => {
    if (game.user.isGM) {
        setTimeout(() => DragUploadEngine.ensureServerDirectory(), 1000);
    }
});
