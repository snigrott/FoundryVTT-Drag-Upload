/**
 * Drag Upload (Cleaned)
 * Version: 4.7.2
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
        game.settings.register(this.ID, "fileUploadSource", { name: "Upload Source", scope: "world", config: true, type: String, default: "data", choices: sourceChoices });
    }

    static _onWheel(event) {
        if (!event.altKey) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;
        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : -1; 
        hover.document.update({ width: Math.max(1, hover.document.width + delta), height: Math.max(1, hover.document.height + delta) });
    }

    static toTitleCase(str) {
        return str.toLowerCase().split(/[_\s-]+/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    static getUniqueFile(file) {
        const timestamp = Date.now();
        const parts = file.name.split('.');
        const ext = parts.pop();
        const base = parts.join('.').replace(/[^a-zA-Z0-9]/g, "_");
        const newName = `${base}_${timestamp}.${ext}`;
        return new File([file], newName, { type: file.type, lastModified: file.lastModified });
    }

    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        if (!files?.length || !canvas.ready || !game.user.isGM) return;
        if (event.target.closest(".window-app, #sidebar")) return;

        event.preventDefault();
        event.stopPropagation();

        const t = canvas.stage.worldTransform;
        const coords = { x: (event.clientX - t.tx) / canvas.stage.scale.x, y: (event.clientY - t.ty) / canvas.stage.scale.y };
        const allNames = await this.getCompendiumNames();

        let index = 0;
        for (const file of files) {
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const fileName = this.toTitleCase(rawName);
            const bestMatch = this.findBestMatch(fileName, allNames);
            const result = await this.requestImportDetails(file, fileName, bestMatch, index, files.length, allNames);
            
            if (result) {
                const offset = index * 20;
                const finalCoords = { x: coords.x + offset, y: coords.y + offset };
                await this.processSingleFile(file, finalCoords, result.type, event.shiftKey, result.name);
            }
            index++;
        }
        ui.notifications.info("All imports complete.");
    }

    static findBestMatch(input, names) {
        const target = input.toLowerCase().trim();
        if (names.includes(input)) return input;
        const fuzzy = names.find(n => n.toLowerCase() === target);
        if (fuzzy) return fuzzy;
        const partial = names.find(n => n.toLowerCase().includes(target) || target.includes(n.toLowerCase()));
        return partial || null;
    }

    static async requestImportDetails(file, defaultName, bestMatch, index, total, allNames) {
        return new Promise((resolve) => {
            const initialName = bestMatch || defaultName;
            const isMatch = !!bestMatch;
            const listId = `list-${index}-${Date.now()}`;

            const d = new Dialog({
                title: `Import ${index + 1}/${total}: ${file.name}`,
                content: `
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;"><strong>Asset Name:</strong></label>
                        <input type="text" id="drag-upload-name" value="${initialName}" list="${listId}" style="width: 100%; border: 2px solid ${isMatch ? '#2ecc71' : '#e67e22'};" autofocus>
                        <datalist id="${listId}">
                            ${allNames.map(n => `<option value="${n}">`).join('')}
                        </datalist>
                    </div>
                `,
                buttons: {
                    actor: { label: "<i class='fas fa-user'></i> Actor", callback: (html) => resolve({ type: "actor", name: html.find('#drag-upload-name').val() }) },
                    journal: { label: "<i class='fas fa-book-open'></i> Handout", callback: (html) => resolve({ type: "journal", name: html.find('#drag-upload-name').val() }) },
                    skip: { label: "<i class='fas fa-times'></i> Skip", callback: () => resolve(null) }
                },
                default: "actor"
            }, { width: 400 });
            d.render(true);
        });
    }

    static async getCompendiumNames() {
        const actorPacks = game.packs.filter(p => p.metadata.type === "Actor");
        let names = new Set();
        for (const pack of actorPacks) {
            const index = await pack.getIndex();
            index.forEach(e => names.add(e.name));
        }
        return Array.from(names).sort();
    }

    static async processSingleFile(file, coords, type, isShift, customName) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const folderName = type === "actor" ? "Drag Upload: Actors" : "Drag Upload: Handouts";
        const folderType = type === "actor" ? "Actor" : "JournalEntry";
        const serverPath = `uploads/${this.ID}/${type}s`;
        
        await this.ensureServerDirectory(source, serverPath);
        const uniqueFile = this.getUniqueFile(file);

        let folder = game.folders.find(f => f.name === folderName && f.type === folderType);
        if (!folder) folder = await Folder.create({ name: folderName, type: folderType });

        if (type === "actor") await this.createActor(source, serverPath, uniqueFile, customName, coords, folder.id, isShift);
        else if (type === "journal") await this.createHandout(source, serverPath, uniqueFile, customName, coords, folder.id);
    }

    static async createActor(source, path, file, name, coords, folderId, isShift) {
        const upload = await FilePicker.upload(source, path, file);
        const compendiumSource = await this.findMonsterStats(name);
        
        let actorData = {
            name: name,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path, 
            folder: folderId,
            prototypeToken: { name: name, texture: { src: upload.path }, displayName: 20, actorLink: false }
        };

        if (compendiumSource) {
            actorData = foundry.utils.mergeObject(compendiumSource.toObject(), actorData);
            delete actorData._id;
            actorData.name = name;
            actorData.img = upload.path;
            actorData.prototypeToken.texture.src = upload.path;
        }

        const actor = await Actor.create(actorData);
        
        // Simple token creation - let Foundry or other modules handle the naming
        let tokenData = { 
            name: name, 
            actorId: actor.id, 
            texture: { src: upload.path }, 
            x: coords.x, 
            y: coords.y 
        };

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
        await canvas.scene.createEmbeddedDocuments('Note', [{ entryId: journal.id, x: coords.x, y: coords.y, texture: { src: "icons/svg/book.svg" } }]);
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
Hooks.on("ready", () => { window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev)); });
