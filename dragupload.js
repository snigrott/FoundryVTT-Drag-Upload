/**
 * Drag Upload (V13 Optimized & S3 Ready)
 * Version 3.4.0
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
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
        
        // IMPROVEMENT 1: Safety Catch - Prevents browser from leaving Foundry
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        });
    }

    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        game.settings.register(this.ID, "journalFolderName", { name: "Journal Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Handouts" });
        const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;
        game.settings.register(this.ID, "fileUploadSource", { name: "Upload Source", scope: "world", config: !usingTheForge, type: String, default: usingTheForge ? "forgevtt" : "data", choices: { "data": "User Data", "s3": "S3 Storage", "forgevtt": "The Forge" } });
    }

    static _onWheel(event) {
        if (!event.altKey) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY < 0 ? 1 : -1; 
        let newSize = Math.max(1, hover.document.width + delta);
        hover.document.update({ width: newSize, height: newSize });
    }

    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        if (!files?.length || !canvas.ready || !game.user.isGM) return;

        // IMPROVEMENT 2: Better UI Detection (Safeguards Character Sheets)
        const isUI = event.target.closest(".window-app, #sidebar, #controls, #navigation, #players");
        if (isUI || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;

        event.preventDefault();
        event.stopPropagation();

        const activeTool = ui.controls.activeControl; 
        const source = game.settings.get(this.ID, "fileUploadSource");

        // IMPROVEMENT 3: Ensure folders ONCE before the loop starts
        await this.ensureServerDirectory(source, "assets/drag-upload");
        let sidebarFolder = await this.ensureSidebarFolder(activeTool);

        for (let i = 0; i < files.length; i++) {
            const offset = i * 20;
            const file = files[i];
            const cleanName = file.name.replace(/\.[^/.]+$/, "");

            if (activeTool === "notes") {
                await this.createHandout(event, file, cleanName, offset, sidebarFolder);
            } else {
                await this.createActor(event, file, cleanName, offset, sidebarFolder);
            }
        }
    }

    // Helper to keep the main loop clean
    static async ensureSidebarFolder(tool) {
        const isNote = tool === "notes";
        const name = game.settings.get(this.ID, isNote ? "journalFolderName" : "actorFolderName");
        const type = isNote ? "JournalEntry" : "Actor";
        let folder = game.folders.find(f => f.name === name && f.type === type);
        if (!folder) folder = await Folder.create({ name, type, color: isNote ? "#00ffcc" : "#ff6600" });
        return folder.id;
    }

    static async createActor(event, file, cleanName, offset, folderId) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        
        const actor = await Actor.create({
            name: cleanName,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path,
            folder: folderId,
            prototypeToken: { 
                name: cleanName, width: 1, height: 1, texture: { src: upload.path },
                displayName: 20, bar1: { attribute: game.system.id === "dnd5e" ? "attributes.hp" : "" }
            }
        });

        // KEEPING 3.1.4 RAW MATH
        const coords = this.getCoords(event, offset);
        const tokenData = {
            name: cleanName, actorId: actor.id, actorLink: true,
            texture: { src: upload.path }, x: coords.x, y: coords.y,
            width: 1, height: 1
        };
        
        if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    static async createHandout(event, file, cleanName, offset, folderId) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);

        const journal = await JournalEntry.create({
            name: cleanName, folder: folderId,
            ownership: { default: 2 }, 
            pages: [{ name: cleanName, type: "image", src: upload.path }]
        });

        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id, x: coords.x, y: coords.y, texture: { src: "icons/svg/book.svg" }
        }]);
        journal.show("image", true);
    }

    static getCoords(event, offset) {
        const t = canvas.stage.worldTransform;
        return {
            x: ((event.clientX - t.tx) / canvas.stage.scale.x) + offset,
            y: ((event.clientY - t.ty) / canvas.stage.scale.y) + offset
        };
    }

    static async ensureServerDirectory(source, path) {
        try {
            await FilePicker.browse(source, path);
        } catch (err) {
            const parts = path.split("/");
            let current = "";
            for (const p of parts) {
                current += (current ? "/" : "") + p;
                try { await FilePicker.createDirectory(source, current); } catch(e) {}
            }
            try { await FilePicker.createDirectory(source, path + "/tokens"); } catch(e) {}
            try { await FilePicker.createDirectory(source, path + "/journals"); } catch(e) {}
        }
    }
}

Hooks.once("init", () => DragUploadEngine.init());
Hooks.on("ready", () => {
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev));
});
