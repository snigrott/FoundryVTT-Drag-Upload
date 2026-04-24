/**
 * Drag Upload (Cleaned)
 * Version: 4.8.0 (V14 Compatible)
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
            name: "Upload Source", /**
 * Drag Upload (Advanced)
 * Version: 5.0.0
 * * Features:
 * - V12/13/14 Compatibility.
 * - Auto-linking to World Actors (Sidebar) or Compendiums.
 * - Dynamic Token Scaling via Alt+Scroll.
 * - Smart Snapping.
 */

class DragUploadEngine {
    static ID = "dragupload";

    /**
     * Initialize the module listeners and settings.
     */
    static init() {
        this.registerSettings();

        // Listener for Alt+Scroll to resize tokens on the fly
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });

        // Global listener to allow file dragging over the canvas
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
        });
    }

    /**
     * Register module configuration settings.
     */
    static registerSettings() {
        const sourceChoices = { "data": "User Data", "s3": "S3 Storage" };
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) {
            sourceChoices["forgevtt"] = "The Forge";
        }

        game.settings.register(this.ID, "fileUploadSource", {
            name: "Upload Source",
            hint: "Which storage location should uploaded images be saved to?",
            scope: "world",
            config: true,
            type: String,
            default: "data",
            choices: sourceChoices
        });
    }

    /**
     * Resizes the hovered token when Alt + Mouse Wheel is used.
     */
    static _onWheel(event) {
        if (!event.altKey) return;
        const hover = canvas.tokens.hover;
        if (!hover) return;

        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : -1; 
        
        // Update both width and height to keep token square
        hover.document.update({ 
            width: Math.max(1, hover.document.width + delta), 
            height: Math.max(1, hover.document.height + delta) 
        });
    }

    /**
     * Converts "ancient-red-dragon" to "Ancient Red Dragon".
     */
    static toTitleCase(str) {
        return str.toLowerCase()
            .split(/[_\s-]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Generates a unique filename using a timestamp to avoid overwriting existing files.
     */
    static getUniqueFile(file) {
        const timestamp = Date.now();
        const parts = file.name.split('.');
        const ext = parts.pop();
        const base = parts.join('.').replace(/[^a-zA-Z0-9]/g, "_");
        const newName = `${base}_${timestamp}.${ext}`;
        return new File([file], newName, { type: file.type, lastModified: file.lastModified });
    }

    /**
     * Entry point for the drag-and-drop workflow.
     */
    static async handleDrop(event) {
        const files = event.dataTransfer.files;
        
        // Permissions and State checks
        if (!files?.length || !canvas.ready || !game.user.isGM) return;
        if (event.target.closest(".window-app, #sidebar")) return;

        event.preventDefault();
        event.stopPropagation();

        // Get canvas-space coordinates (V14 compatible)
        const coords = canvas.app.renderer.events.pointer.getLocalPosition(canvas.stage);

        // Gather names from Sidebar (World) and all Compendiums for the suggestion list
        const worldNames = game.actors.map(a => a.name);
        const compendiumNames = await this.getCompendiumNames();
        const allNames = Array.from(new Set([...worldNames, ...compendiumNames])).sort();

        let index = 0;
        for (const file of files) {
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const fileName = this.toTitleCase(rawName);
            const bestMatch = this.findBestMatch(fileName, allNames);
            
            // Ask the user: Who is this?
            const result = await this.requestImportDetails(file, fileName, bestMatch, index, files.length, allNames);
            
            if (result) {
                // Apply a small stagger for multiple files
                const offset = index * (canvas.grid.size / 5);
                const finalCoords = { x: coords.x + offset, y: coords.y + offset };
                await this.processSingleFile(file, finalCoords, result.type, event.shiftKey, result.name);
            }
            index++;
        }
        ui.notifications.info("All processing complete.");
    }

    /**
     * Fuzzy logic to find the best match for a filename in the name list.
     */
    static findBestMatch(input, names) {
        const target = input.toLowerCase().trim();
        if (names.includes(input)) return input;
        
        const fuzzy = names.find(n => n.toLowerCase() === target);
        if (fuzzy) return fuzzy;
        
        const partial = names.find(n => n.toLowerCase().includes(target) || target.includes(n.toLowerCase()));
        return partial || null;
    }

    /**
     * Renders a dialog to confirm the name and type of the drop.
     */
    static async requestImportDetails(file, defaultName, bestMatch, index, total, allNames) {
        return new Promise((resolve) => {
            const initialName = bestMatch || defaultName;
            const isMatch = !!bestMatch;
            const listId = `list-${index}-${Date.now()}`;

            const d = new Dialog({
                title: `Import ${index + 1}/${total}: ${file.name}`,
                content: `
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;"><strong>Target Asset Name:</strong></label>
                        <input type="text" id="drag-upload-name" value="${initialName}" list="${listId}" 
                               style="width: 100%; border: 2px solid ${isMatch ? '#2ecc71' : '#e67e22'};" autofocus>
                        <datalist id="${listId}">
                            ${allNames.map(n => `<option value="${n}">`).join('')}
                        </datalist>
                        <p><small>Matches sidebar actors OR compendium entries.</small></p>
                    </div>
                `,
                buttons: {
                    actor: { 
                        label: "<i class='fas fa-user'></i> Actor", 
                        callback: (html) => resolve({ type: "actor", name: html.find('#drag-upload-name').val() }) 
                    },
                    journal: { 
                        label: "<i class='fas fa-book-open'></i> Handout", 
                        callback: (html) => resolve({ type: "journal", name: html.find('#drag-upload-name').val() }) 
                    },
                    skip: { 
                        label: "<i class='fas fa-times'></i> Skip", 
                        callback: () => resolve(null) 
                    }
                },
                default: "actor"
            }, { width: 400 });
            d.render(true);
        });
    }

    /**
     * Scans all Actor compendiums and returns a list of unique names.
     */
    static async getCompendiumNames() {
        const actorPacks = game.packs.filter(p => p.metadata.type === "Actor");
        let names = new Set();
        for (const pack of actorPacks) {
            const index = await pack.getIndex();
            index.forEach(e => names.add(e.name));
        }
        return Array.from(names);
    }

    /**
     * Handles directory creation and triggers the specific creation logic.
     */
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

    /**
     * Creates or updates an Actor and places a token on the map.
     */
    static async createActor(source, path, file, name, coords, folderId, isShift) {
        const upload = await FilePicker.upload(source, path, file);
        
        // CHECK 1: Search the World Sidebar for an existing actor (e.g. from Statblock Importer)
        let actor = game.actors.find(a => a.name.toLowerCase() === name.toLowerCase());

        if (actor) {
            // LINK MODE: Update art for the existing actor
            console.log(`${this.ID} | Linking to existing actor: ${actor.name}`);
            await actor.update({
                img: upload.path,
                "prototypeToken.texture.src": upload.path
            });
        } else {
            // CREATE MODE: Build new actor from compendium or scratch
            const compendiumSource = await this.findMonsterStats(name);
            const actorType = game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0];

            let actorData = {
                name: name,
                type: actorType,
                img: upload.path, 
                folder: folderId,
                prototypeToken: { 
                    name: name, 
                    texture: { src: upload.path }, 
                    displayName: CONST.TOKEN_DISPLAY_MODES.HOVER, 
                    actorLink: false 
                }
            };

            if (compendiumSource) {
                // Merge compendium stats with our new image/name
                actorData = foundry.utils.mergeObject(compendiumSource.toObject(), actorData, {overwrite: true});
                delete actorData._id; // Prevent ID collision
                actorData.name = name;
                actorData.img = upload.path;
                actorData.prototypeToken.texture.src = upload.path;
            }

            actor = await Actor.create(actorData);
        }
        
        // Handle Token Placement
        let tokenPos = { x: coords.x, y: coords.y };
        if (!isShift) {
            // V14 Snapping logic
            const snapped = canvas.grid.getSnappedPoint({x: tokenPos.x, y: tokenPos.y}, {mode: CONST.GRID_SNAPPING_MODES.CENTER});
            tokenPos.x = snapped.x;
            tokenPos.y = snapped.y;
        }

        const tokenData = { 
            name: name, 
            actorId: actor.id, 
            texture: { src: upload.path }, 
            x: tokenPos.x, 
            y: tokenPos.y 
        };

        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    /**
     * Creates a Journal Entry and a Scene Note for Handouts.
     */
    static async createHandout(source, path, file, name, coords, folderId) {
        const upload = await FilePicker.upload(source, path, file);
        const journal = await JournalEntry.create({
            name: name, 
            folder: folderId,
            pages: [{ name: name, type: "image", src: { path: upload.path } }],
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });

        // Drop a map note linking to the handout
        await canvas.scene.createEmbeddedDocuments('Note', [{ 
            entryId: journal.id, 
            x: coords.x, 
            y: coords.y, 
            texture: { src: "icons/svg/book.svg" } 
        }]);
    }

    /**
     * Searches compendiums for an exact name match to pull stats.
     */
    static async findMonsterStats(name) {
        const targetSlug = name.slugify({strict: true});
        const packs = game.packs.filter(p => p.metadata.type === "Actor");
        for (let pack of packs) {
            const index = await pack.getIndex({fields: ["name"]});
            const match = index.find(e => e.name.slugify({strict: true}) === targetSlug);
            if (match) return await pack.getDocument(match._id);
        }
        return null;
    }

    /**
     * Recursive directory check to ensure the upload path exists on the server.
     */
    static async ensureServerDirectory(source, path) {
        const parts = path.split("/");
        let current = "";
        for (const p of parts) {
            current += (current ? "/" : "") + p;
            try { 
                await FilePicker.createDirectory(source, current); 
            } catch(e) {
                // Fail silently if directory already exists
            }
        }
    }
}

// Hook into Foundry initialization
Hooks.once("init", () => DragUploadEngine.init());

// Wait for canvas to be ready before adding the drop listener
Hooks.on("ready", () => { 
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev)); 
});
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
        
        // V14 compatibility: Token update logic remains consistent
        hover.document.update({ 
            width: Math.max(1, hover.document.width + delta), 
            height: Math.max(1, hover.document.height + delta) 
        });
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

        // V14: Standardized Canvas Coordinate Conversion
        const coords = canvas.app.renderer.events.pointer.getLocalPosition(canvas.stage);
        const allNames = await this.getCompendiumNames();

        let index = 0;
        for (const file of files) {
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const fileName = this.toTitleCase(rawName);
            const bestMatch = this.findBestMatch(fileName, allNames);
            const result = await this.requestImportDetails(file, fileName, bestMatch, index, files.length, allNames);
            
            if (result) {
                const offset = index * (canvas.grid.size / 4); // Relative offset based on grid size
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
            // V14 Requirement: Ensure index is loaded
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
        
        // V14: System-agnostic actor type resolution
        const actorType = game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.documentClass.metadata.types)[0];

        let actorData = {
            name: name,
            type: actorType,
            img: upload.path, 
            folder: folderId,
            prototypeToken: { 
                name: name, 
                texture: { src: upload.path }, 
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER, 
                actorLink: false 
            }
        };

        if (compendiumSource) {
            // V14: Use toObject() for merging to avoid Document mutation errors
            actorData = foundry.utils.mergeObject(compendiumSource.toObject(), actorData, {overwrite: true});
            delete actorData._id;
            actorData.name = name;
            actorData.img = upload.path;
            actorData.prototypeToken.texture.src = upload.path;
        }

        const actor = await Actor.create(actorData);
        
        // V14 Grid Snapping Update
        let tokenPos = { x: coords.x, y: coords.y };
        if (!isShift) {
            // In V14, snapping is handled by the grid's getSnappedPoint method
            const snapped = canvas.grid.getSnappedPoint({x: tokenPos.x, y: tokenPos.y}, {mode: CONST.GRID_SNAPPING_MODES.CENTER});
            tokenPos.x = snapped.x;
            tokenPos.y = snapped.y;
        }

        let tokenData = { 
            name: name, 
            actorId: actor.id, 
            texture: { src: upload.path }, 
            x: tokenPos.x, 
            y: tokenPos.y 
        };

        await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
    }

    static async createHandout(source, path, file, name, coords, folderId) {
        const upload = await FilePicker.upload(source, path, file);
        const journal = await JournalEntry.create({
            name: name, 
            folder: folderId,
            pages: [{ name: name, type: "image", src: { path: upload.path } }],
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });

        await canvas.scene.createEmbeddedDocuments('Note', [{ 
            entryId: journal.id, 
            x: coords.x, 
            y: coords.y, 
            texture: { src: "icons/svg/book.svg" } 
        }]);
    }

    static async findMonsterStats(name) {
        const targetSlug = name.slugify({strict: true});
        const packs = game.packs.filter(p => p.metadata.type === "Actor");
        for (let pack of packs) {
            const index = await pack.getIndex({fields: ["name"]});
            const match = index.find(e => e.name.slugify({strict: true}) === targetSlug);
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
