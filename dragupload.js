/**
 * Drag Upload (V13 - Individual Naming & Sequential Processing)
 * Version: 4.2.0
 * ID: dragupload
 */

class DragUploadEngine {
    static ID = "dragupload";

    static init() {
        this.registerSettings();
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        });
    }

    static registerSettings() {
        const sourceChoices = { "data": "User Data", "s3": "S3 Storage" };
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) sourceChoices["forgevtt"] = "The Forge";
        
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
        if (!event.altKey) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;
        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : -1; 
        hover.document.update({ 
            width: Math.max(1, hover.document.width + delta), 
            height: Math.max(1, hover.document.height + delta) 
        });
    }

    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        if (!files?.length || !canvas.ready || !game.user.isGM) return;
        if (event.target.closest(".window-app, #sidebar")) return;

        event.preventDefault();
        event.stopPropagation();

        const t = canvas.stage.worldTransform;
        const coords = {
            x: (event.clientX - t.tx) / canvas.stage.scale.x,
            y: (event.clientY - t.ty) / canvas.stage.scale.y
        };

        // We process files one-by-one, showing a dialog for EACH
        let index = 0;
        for (const file of files) {
            const fileName = file.name.replace(/\.[^/.]+$/, "");
            
            // This 'await' is the magic—it pauses the loop until you click a button
            const result = await this.requestImportDetails(file, fileName, index, files.length);
            
            if (result) {
                const offset = index * 20;
                const finalCoords = { x: coords.x + offset, y: coords.y + offset };
                await this.processSingleFile(file, finalCoords, result.type, event.shiftKey, result.name);
            }
            index++;
        }
        ui.notifications.info("All imports complete.");
    }

    static async requestImportDetails(file, defaultName, index, total) {
        return new Promise((resolve) => {
            new Dialog({
                title: `Import ${index + 1} of ${total}: ${file.name}`,
                content: `
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;"><strong>Asset Name:</strong></label>
                        <input type="text" id="drag-upload-name" value="${defaultName}" style="width: 100%; margin-bottom: 10px;" autofocus>
                    </div>
                `,
                buttons: {
                    actor: { 
                        icon: '<i class="fas fa-user"></i>', 
                        label: "Actor", 
                        callback: (html) => resolve({ type: "actor", name: html.find('#drag-upload-name').val() || defaultName }) 
                    },
                    journal: { 
                        icon: '<i class="fas fa-book-open"></i>', 
                        label: "Handout", 
                        callback: (html) => resolve({ type: "journal", name: html.find('#drag-upload-name').val() || defaultName }) 
                    },
                    tile: { 
                        icon: '<i class="fas fa-cubes"></i>', 
                        label: "Tile", 
                        callback: (html) => resolve({ type: "tile", name: html.find('#drag-upload-name').val() || defaultName }) 
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Skip",
                        callback: () => resolve(null)
                    }
                },
                default: "actor",
                close: () => resolve(null)
            }).render(true);
        });
    }

    static async processSingleFile(file, coords, type, isShift, customName) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const folderName = type === "actor" ? "Drag Upload: Actors" : "Drag Upload: Handouts";
        const folderType = type === "actor" ? "Actor" : "JournalEntry";
        
        const serverPath = `uploads/${this.ID}/${type}s`;
        await this.ensureServerDirectory(source, serverPath);

        let folderId = null;
        if (type !== "tile") {
            let folder = game.folders.find(f => f.name === folderName && f.type === folderType);
            if (!folder) folder = await Folder.create({ name: folderName, type: folderType });
            folderId = folder.id;
        }

        try {
            if (type === "actor") await this.createActor(source, serverPath, file, customName, coords, folderId, isShift);
            else if (type === "journal") await this.createHandout(source, serverPath, file, customName, coords, folderId);
            else await this.createTile(source, serverPath, file, coords);
        } catch (err) {
            console.error(`${this.ID} | Error:`, err);
        }
    }

    static async createActor(source, path, file, name, coords, folderId, isShift) {
        const upload = await FilePicker.upload(source, path, file);
        const compendiumSource = await this.findMonsterStats(name);
        
        let actorData = {
            name: name,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path,
            folder: folderId,
            prototypeToken: { name: name, texture: { src: upload.path }, displayName: 20 }
        };

        if (compendiumSource) {
            actorData = foundry.utils.mergeObject(compendiumSource.toObject(), actorData);
            delete actorData._id;
            actorData.name = name; 
            actorData.img = upload.path;
            actorData.prototypeToken.texture.src = upload.path;
        }

        const actor = await Actor.create(actorData);
        let tokenData = { name: name, actorId: actor.id, actorLink: true, texture: { src: upload.path }, x: coords.x, y: coords.y };
        if (!isShift) Object.assign(tokenData, canvas.grid.getSnappedPosition(tokenData.x, tokenData.y));
        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    static async createHandout(source, path, file, name, coords, folderId) {
        const upload = await FilePicker.upload(source, path, file);
        const journal = await JournalEntry.create({
            name: name, folder: folderId,
            pages: [{ name: name, type: "image", src: upload.path }],
            ownership: { default: 2 }
        });
        await canvas.scene.createEmbeddedDocuments('Note', [{
            entryId: journal.id, x: coords.x, y: coords.y, texture: { src: "icons/svg/book.svg" }
        }]);
    }

    static async createTile(source, path, file, coords) {
        const upload = await FilePicker.upload(source, path, file);
        const tex = await loadTexture(upload.path);
        await canvas.scene.createEmbeddedDocuments('Tile', [{
            texture: { src: upload.path },
            width: tex.width,
            height: tex.height,
            x: coords.x,
            y: coords.y
        }]);
    }

    static async findMonsterStats(name) {
        const packs = game.packs.filter(p => p.metadata.type === "Actor");
        for (let pack of packs) {
            const index = await pack.getIndex({fields: ["name"]});
            const match = index.find(e => e.name.toLowerCase() === name.toLowerCase());
            if (match) return await pack.getDocument(match._id);
        }
        return null;
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
