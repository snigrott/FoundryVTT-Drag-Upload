/**
 * Drag Upload (V13 - Production Master)
 * Version: 4.5.0
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
            const fileName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
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
                        <p id="match-info" style="font-size: 0.85em; margin-top: 5px; color: ${isMatch ? '#2ecc71' : '#e67e22'};">
                            ${isMatch ? `✓ Found match: ${bestMatch}` : `⚠ No exact match found.`}
                        </p>
                    </div>
                `,
                buttons: {
                    actor: { label: "Actor", callback: (html) => resolve({ type: "actor", name: html.find('#drag-upload-name').val() }) },
                    journal: { label: "Handout", callback: (html) => resolve({ type: "journal", name: html.find('#drag-upload-name').val() }) },
                    skip: { label: "Skip", callback: () => resolve(null) }
                },
                default: "actor",
                render: (html) => {
                    const input = html.find('#drag-upload-name');
                    const info = html.find('#match-info');
                    input.on('input', () => {
                        const val = input.val();
                        const match = allNames.find(n => n === val);
                        if (match) {
                            input.css("border-color", "#2ecc71");
                            info.text(`✓ Found match: ${match}`).css("color", "#2ecc71");
                        } else {
                            input.css("border-color", "#e67e22");
                            info.text("⚠ Custom name (Basic Actor)").css("color", "#e67e22");
                        }
                    });
                }
            });
            d.render(true);
        });
    }

    static async getCompendiumNames() {
        const actorPacks = game.packs.filter(p => p.metadata.type === "Actor");
        let names = new Set();
        await Promise.all(actorPacks.map(async (pack) => {
            const index = await pack.getIndex();
            index.forEach(e => names.add(e.name));
        }));
        return Array.from(names).sort();
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

        if (type === "actor") await this.createActor(source, serverPath, file, customName, coords, folderId, isShift);
        else if (type === "journal") await this.createHandout(source, serverPath, file, customName, coords, folderId);
        else await this.createTile(source, serverPath, file, coords);
    }

    static async createActor(source, path, file, name, coords, folderId, isShift) {
        const upload = await FilePicker.upload(source, path, file);
        const compendiumSource = await this.findMonsterStats(name);
        
        let actorData = {
            name: name,
            type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0],
            img: upload.path, folder: folderId,
            prototypeToken: { name: name, texture: { src: upload.path }, displayName: 20, actorLink: false }
        };

        if (compendiumSource) {
            actorData = foundry.utils.mergeObject(compendiumSource.toObject(), actorData);
            delete actorData._id;
            actorData.name = name;
            actorData.img = upload.path;
            actorData.prototypeToken.name = name;
            actorData.prototypeToken.texture.src = upload.path;
            actorData.prototypeToken.actorLink = false;
        }

        const actor = await Actor.create(actorData);
        
        let finalTokenName = name;
        const existingTokens = canvas.scene.tokens.filter(t => t.name.startsWith(name));
        if (existingTokens.length > 0) finalTokenName = `${name} ${existingTokens.length + 1}`;

        let tokenData = { 
            name: finalTokenName, actorId: actor.id, actorLink: false, 
            texture: { src: upload.path }, x: coords.x, y: coords.y, displayName: 20 
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

    static async createTile(source, path, file, coords) {
        const upload = await FilePicker.upload(source, path, file);
        const tex = await loadTexture(upload.path);
        await canvas.scene.createEmbeddedDocuments('Tile', [{ texture: { src: upload.path }, width: tex.width, height: tex.height, x: coords.x, y: coords.y }]);
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
