/**
 * Drag Upload (V13 Professional - Actor Only)
 * Version 3.5.0
 * Includes: V13 Interface mapping, Disposition defaults, and Bulk Chat Summary.
 */

class DragUploadEngine {
    static ID = "drag-upload";

    static init() {
        this.registerSettings();
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        });
    }

    static registerSettings() {
        game.settings.register(this.ID, "actorFolderName", { name: "Actor Sidebar Folder", scope: "world", config: true, type: String, default: "Drag Uploads" });
        
        const sourceChoices = { "data": "User Data", "s3": "S3 Storage" };
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) sourceChoices["forgevtt"] = "The Forge";

        game.settings.register(this.ID, "fileUploadSource", { 
            name: "Upload Source", scope: "world", config: true, type: String, default: "data", choices: sourceChoices 
        });
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

        const isUI = event.target.closest(".window-app, #sidebar, #controls, #navigation, #players");
        if (isUI) return;

        event.preventDefault();
        event.stopPropagation();

        const source = game.settings.get(this.ID, "fileUploadSource");
        await this.ensureServerDirectory(source, "assets/drag-upload/tokens");
        const folderId = await this.ensureSidebarFolder();

        // V13 COORDINATE CAPTURE (Raw Math for stability)
        const t = canvas.stage.worldTransform;
        const baseCoords = {
            x: (event.clientX - t.tx) / canvas.stage.scale.x,
            y: (event.clientY - t.ty) / canvas.stage.scale.y
        };

        ui.notifications.info(`Processing ${files.length} uploads...`);
        
        let createdActors = [];

        for (let i = 0; i < files.length; i++) {
            const offset = i * 20;
            const file = files[i];
            const cleanName = file.name.replace(/\.[^/.]+$/, "");

            try {
                const actor = await this.createActor(source, baseCoords, file, cleanName, offset, folderId, event.shiftKey);
                if (actor) createdActors.push(actor);
            } catch (err) {
                console.error("Drag Upload | Error:", err);
            }
        }

        // V13 BULK CHAT SUMMARY (One message for all drops)
        if (createdActors.length > 0) {
            const links = createdActors.map(a => a.toAnchor().outerHTML).join(", ");
            ChatMessage.create({
                content: `<b>Drag Upload Complete:</b><br>${links}`,
                whisper: [game.user.id]
            });
        }
    }

    static async ensureSidebarFolder() {
        const name = game.settings.get(this.ID, "actorFolderName");
        let folder = game.folders.find(f => f.name === name && f.type === "Actor");
        if (!folder) folder = await Folder.create({ name, type: "Actor", color: "#ff6600" });
        return folder.id;
    }

    static async createActor(source, baseCoords, file, cleanName, offset, folderId, isShift) {
        const upload = await FilePicker.upload(source, "assets/drag-upload/tokens", file);
        
        const actor = await Actor.create({
            name: cleanName,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path,
            folder: folderId,
            prototypeToken: { 
                name: cleanName, texture: { src: upload.path },
                displayName: 20, 
                disposition: 0, // V13: Explicit Neutral Disposition
                bar1: { attribute: game.system.id === "dnd5e" ? "attributes.hp" : "" }
            }
        });

        const tokenData = {
            name: cleanName, actorId: actor.id, actorLink: true,
            texture: { src: upload.path }, 
            x: baseCoords.x + offset, 
            y: baseCoords.y + offset,
            disposition: 0
        };
        
        if (!isShift) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        return actor;
    }

    static async ensureServerDirectory(source, path) {
        const parts = path.split("/");
        let current = "";
        for (const p of parts) {
            current += (current ? "/" : "") + p;
            try { await FilePicker.createDirectory(source, current); } catch(e) {}
        }
    }
}

Hooks.once("init", () => DragUploadEngine.init());
Hooks.on("ready", () => {
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev));
});
