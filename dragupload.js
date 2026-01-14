/**
 * Drag Upload (V13 Optimized & S3 Ready)
 * Version 3.3.0
 * * FEATURES:
 * - S3, Forge, and Local Data storage compatibility.
 * - Sequential folder creation to prevent DB race conditions.
 * - Promise.all for concurrent (high-speed) multi-file uploads.
 * - One-time Alt+Scroll UI notification for GMs.
 * - Precise coordinate mapping using PIXI internals.
 */

class DragUploadEngine {
    static ID = "drag-upload";
    static hintShown = false; // Prevents the Alt+Scroll tip from spamming the user

    /**
     * Called during the 'init' hook.
     * Sets up the wheel listener for resizing and registers game settings.
     */
    static init() {
        this.registerSettings();
        // Listener for the Alt+Scroll resize feature.
        // { passive: false } allows us to prevent the default browser scroll.
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
    }

    /**
     * Defines the configuration options in the Module Settings menu.
     */
    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        game.settings.register(this.ID, "journalFolderName", { name: "Journal Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Handouts" });
        
        // Detect environment: The Forge uses a specific storage adapter 'forgevtt'
        const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;
        
        game.settings.register(this.ID, "fileUploadSource", { 
            name: "Upload Source", 
            hint: "Select where files are stored. S3 requires a valid S3 configuration in your Foundry setup.",
            scope: "world", 
            config: !usingTheForge, // Hide this if on The Forge to prevent misconfiguration
            type: String, 
            default: usingTheForge ? "forgevtt" : "data", 
            choices: { 
                "data": "User Data (Local)", 
                "s3": "S3 Cloud Storage",
                "forgevtt": "The Forge Asset Library" 
            } 
        });
    }

    /**
     * Handles Alt + Mousewheel to resize tokens currently hovered by the mouse.
     */
    static _onWheel(event) {
        if (!event.altKey) return; // Only trigger if Alt is held
        const hover = canvas.tokens.hover;
        if (!hover) return;
        
        event.preventDefault(); // Stop the page from scrolling
        event.stopPropagation();
        
        const delta = event.deltaY < 0 ? 0.5 : -0.5; // Increment by half-grid units
        let newSize = Math.max(0.5, hover.document.width + delta);
        
        // Update both width and height to keep the token square
        hover.document.update({ width: newSize, height: newSize });
    }

    /**
     * The main event handler for file drops onto the canvas.
     */
    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        // Safety: Only proceed if there are files, the canvas is loaded, and the user is a GM.
        if (!files?.length || !canvas.ready || !game.user.isGM) return;

        // UI Guard: Do not trigger if dropping onto sheets, the sidebar, or input boxes.
        const isUI = event.target.closest(".window-app, #sidebar, #controls, #navigation, #players");
        if (isUI || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

        event.preventDefault();
        event.stopPropagation();

        // Show the one-time hint for Alt+Scroll resizing
        if (!this.hintShown) {
            ui.notifications.info("Drag Upload: Use ALT + Scroll to resize placed tokens.");
            this.hintShown = true;
        }

        const activeTool = ui.controls.activeControl; 
        
        // Ensure Sidebar folders exist sequentially before parallel uploads start.
        // This prevents multiple 'create folder' requests from hitting the DB at once.
        await this.ensureSidebarFolders(activeTool);

        ui.notifications.info(`Uploading ${files.length} items...`);

        // CONCURRENCY: Create an array of Promises so all files upload at the same time.
        const uploads = Array.from(files).map((file, i) => {
            const offset = i * 20; // Stagger placement so items aren't perfectly on top of each other
            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            return activeTool === "notes" 
                ? this.createHandout(event, file, cleanName, offset)
                : this.createActor(event, file, cleanName, offset);
        });

        try {
            await Promise.all(uploads);
            ui.notifications.info("All files placed successfully.");
        } catch (err) {
            ui.notifications.error("An error occurred during upload. See console for details.");
            console.error("Drag Upload | ", err);
        }
    }

    /**
     * Checks if the designated sidebar folders exist; creates them if not.
     */
    static async ensureSidebarFolders(tool) {
        const isNote = tool === "notes";
        const folderName = game.settings.get(this.ID, isNote ? "journalFolderName" : "actorFolderName");
        const type = isNote ? "JournalEntry" : "Actor";
        
        let folder = game.folders.find(f => f.name === folderName && f.type === type);
        if (!folder) {
            await Folder.create({ name: folderName, type: type, color: isNote ? "#00ffcc" : "#ff6600" });
        }
    }

    /**
     * Handles uploading the file and creating the Actor and Token documents.
     */
    static async createActor(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "actorFolderName");
        
        // 1. Upload to server/S3
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        const folder = game.folders.find(f => f.name === sidebarName && f.type === "Actor");

        // 2. Create the Sidebar Actor
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

        // 3. Place Token on Scene
        const coords = this.getCoords(event, offset);
        const tokenData = {
            name: cleanName, actorId: actor.id, actorLink: true,
            texture: { src: upload.path }, x: coords.x, y: coords.y,
            displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
        };
        
        // Snap to grid unless Shift is held
        if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    /**
     * Handles uploading the file and creating the Journal and Map Note documents.
     */
    static async createHandout(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "journalFolderName");
        
        // 1. Upload to server/S3
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);
        const folder = game.folders.find(f => f.name === sidebarName && f.type === "JournalEntry");

        // 2. Create the Journal Entry
        const journal = await JournalEntry.create({
            name: cleanName, 
            folder: folder?.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, 
            pages: [{ name: cleanName, type: "image", src: upload.path }]
        });

        // 3. Place Note on Scene
        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id, x: coords.x, y: coords.y,
            texture: { src: "icons/svg/book.svg" }
        }]);

        // Auto-show image to all players
        journal.show("image", true);
    }

    /**
     * Translates screen coordinates (pixels) to Canvas coordinates (world units).
     */
    static getCoords(event, offset) {
        const point = new PIXI.Point(event.clientX, event.clientY);
        const local = canvas.app.stage.mapPointToParent(point);
        return { x: local.x + offset, y: local.y + offset };
    }

    /**
     * Creates the nested directory structure on the server or S3 bucket.
     */
    static async ensureServerDirectory() {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";
        const parts = rootPath.split("/");
        let currentPath = "";
        
        // S3 logic requires bucket prefixing, but FilePicker handles it via currentPath concatenation
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

// Startup Initialization
Hooks.once("init", () => DragUploadEngine.init());

Hooks.on("ready", () => {
    if (game.user.isGM) {
        // We wait 1 second to ensure S3/Forge external adapters are authenticated and ready
        setTimeout(() => DragUploadEngine.ensureServerDirectory(), 1000);
    }
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev));
});
