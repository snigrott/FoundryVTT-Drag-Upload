/**
 * Drag Upload (V13 Compatible)
 * Version 3.1.4
 * Significant refactoring for efficiency and V13 Data Model compatibility. Will NOT work with FoundryVTT versions prior to 12.
 * Optimized for Speed of Play: Multi-drop, Auto-folders, and Path Verification. Sidebar Sorting, Auto-Handouts, and Staggered Placement.
*/

class DragUploadEngine {
    static ID = "drag-upload";

    static init() {
        this.registerSettings();
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
    }

    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        game.settings.register(this.ID, "journalFolderName", { name: "Journal Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Handouts" });
        const usingTheForge = typeof ForgeVTT != "undefined" && ForgeVTT.usingTheForge;
        game.settings.register(this.ID, "fileUploadSource", { name: "Upload Source", scope: "world", config: !usingTheForge, type: String, default: usingTheForge ? "forgevtt" : "data", choices: { "data": "User Data", "s3": "S3 Storage" } });
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
        if (!files || files.length === 0) return;
        if (!canvas.ready) return;

        // STOP: Check if we are dropping onto a UI element instead of the map
        const isUI = event.target.closest(".window-app, #sidebar, #controls, #navigation, #players");
        const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
        if (isUI || isInput) return; // Let Foundry handle it

        event.preventDefault();
        event.stopPropagation();

        const activeTool = ui.controls.activeControl; 
        const source = game.settings.get(this.ID, "fileUploadSource");
        const rootPath = "assets/drag-upload";

        await this.ensureServerDirectory(source, rootPath);

        for (let i = 0; i < files.length; i++) {
            const offset = i * 20; // Reduced offset for tighter grouping
            const file = files[i];
            const cleanName = file.name.replace(/\.[^/.]+$/, "");

            try {
                if (activeTool === "notes") {
                    await this.createHandout(event, file, cleanName, offset);
                } else {
                    await this.createActor(event, file, cleanName, offset);
                }
            } catch (err) {
                console.error("Drag Upload | Drop Error:", err);
            }
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
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path,
            folder: folder.id,
            prototypeToken: { 
                name: cleanName, width: 1, height: 1, 
                texture: { src: upload.path },
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.HOVER,
                bar1: { attribute: game.system.id === "dnd5e" ? "attributes.hp" : "" }
            }
        });

        const coords = this.getCoords(event, offset);
        const tokenData = {
            name: cleanName, actorId: actor.id, actorLink: true,
            texture: { src: upload.path }, x: coords.x, y: coords.y,
            width: 1, height: 1, displayName: CONST.TOKEN_DISPLAY_MODES.HOVER
        };
        
        if (!event.shiftKey) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        ChatMessage.create({ content: `<b>New Actor:</b> ${actor.link}`, speaker: { alias: "Drag Upload" } });
    }

    static async createHandout(event, file, cleanName, offset) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const sidebarName = game.settings.get(this.ID, "journalFolderName");
        const upload = await FilePicker.upload(source, "assets/drag-upload/journals", file);

        let folder = game.folders.find(f => f.name === sidebarName && f.type === "JournalEntry");
        if (!folder) folder = await Folder.create({ name: sidebarName, type: "JournalEntry", color: "#00ffcc" });

        const journal = await JournalEntry.create({
            name: cleanName, folder: folder.id,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, 
            pages: [{ name: cleanName, type: "image", src: upload.path }]
        });

        const coords = this.getCoords(event, offset);
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id, x: coords.x, y: coords.y,
            text: cleanName, texture: { src: "icons/svg/book.svg" }
        }]);

        journal.show("image", true);
        ChatMessage.create({ content: `<b>Shared Handout:</b> ${journal.link}`, speaker: { alias: "Drag Upload" } });
    }

    static getCoords(event, offset) {
        const t = canvas.stage.worldTransform;
        return {
            x: ((event.clientX - t.tx) / canvas.stage.scale.x) + offset,
            y: ((event.clientY - t.ty) / canvas.stage.scale.y) + offset
        };
    }

    static async ensureServerDirectory(source, path) {
        const parts = path.split("/");
        let currentPath = "";
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try { await FilePicker.browse(source, currentPath); } 
            catch (err) { try { await FilePicker.createDirectory(source, currentPath); } catch(e) {} }
        }
        for (const sub of ["tokens", "journals"]) {
            try { await FilePicker.createDirectory(source, `${path}/${sub}`); } catch(e) {}
        }
    }
}

Hooks.once("init", () => DragUploadEngine.init());

Hooks.on("ready", () => {
    // Listen to the window but use a capture-guard to respect default UI drops
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev));
});
