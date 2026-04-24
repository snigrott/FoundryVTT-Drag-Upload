/**
 * Drag Upload Engine V5.3.0
 * Features: 
 * - Web Standard Slugification (Hyphens for Debian/Web compatibility)
 * - V14 Canvas Event Interception (Fixed missing prompt)
 * - Robust Sidebar-to-File Linking for Statblock Importer
 * - Alt+Scroll Token Resizing
 */

class DragUploadEngine {
    static ID = "dragupload";

    /**
     * Initialize listeners and force browser to allow drops on the canvas.
     */
    static init() {
        this.registerSettings();
        
        // Listener for Alt+Scroll to resize tokens
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });

        // V14 FIX: Intercept dragover so the browser knows the canvas is a valid drop target
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "copy";
            }
        }, false);
    }

    static registerSettings() {
        const sourceChoices = { "data": "User Data", "s3": "S3 Storage" };
        if (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge) {
            sourceChoices["forgevtt"] = "The Forge";
        }

        game.settings.register(this.ID, "fileUploadSource", {
            name: "Upload Source",
            hint: "Storage location for your Debian server.",
            scope: "world",
            config: true,
            type: String,
            default: "data",
            choices: sourceChoices
        });
    }

    /**
     * Web Standard Slugification: Converts "Ancient Red Dragon" to "ancient-red-dragon"
     */
    static slugify(text) {
        return text.toString().toLowerCase().trim()
            .replace(/\s+/g, '-')           // Spaces to -
            .replace(/[^\w\-]+/g, '')       // Remove non-word chars
            .replace(/\-\-+/g, '-')         // Collapse multiple -
            .replace(/^-+/, '')             // Trim start
            .replace(/-+$/, '');            // Trim end
    }

    /**
     * Generates a unique, web-safe filename for your Debian filesystem.
     */
    static getUniqueFile(file) {
        const timestamp = Date.now();
        const parts = file.name.split('.');
        const ext = parts.pop().toLowerCase();
        const base = this.slugify(parts.join('.'));
        const newName = `${base}-${timestamp}.${ext}`;
        return new File([file], newName, { type: file.type, lastModified: file.lastModified });
    }

    /**
     * Logic to find existing actors in the World Sidebar or Compendiums.
     */
    static findBestMatch(input, names) {
        const targetSlug = this.slugify(input);
        // 1. Try exact slug match
        let match = names.find(n => this.slugify(n) === targetSlug);
        // 2. Try partial slug match
        if (!match) {
            match = names.find(n => {
                const nSlug = this.slugify(n);
                return nSlug.includes(targetSlug) || targetSlug.includes(nSlug);
            });
        }
        return match || null;
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

    /**
     * Main event handler for drops.
     */
    static async handleDrop(event) {
        if (!canvas.ready || !game.user.isGM) return;
        
        const files = event.dataTransfer.files;
        if (!files?.length) return;

        // V14 FIX: Stop event propagation to ensure our dialog triggers
        event.preventDefault();
        event.stopPropagation();

        // Get V14 Canvas coordinates
        const coords = canvas.app.renderer.events.pointer.getLocalPosition(canvas.stage);

        // Gather all names for the Autocomplete/Suggestion list
        const worldNames = game.actors.map(a => a.name);
        const compendiumNames = await this.getCompendiumNames();
        const allNames = Array.from(new Set([...worldNames, ...compendiumNames])).sort();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const bestMatch = this.findBestMatch(rawName, allNames);
            
            // Trigger the Dialog (Wait for user input)
            const result = await this.requestImportDetails(file, rawName, bestMatch, i, files.length, allNames);
            
            if (result) {
                const offset = i * (canvas.grid.size / 5);
                const finalCoords = { x: coords.x + offset, y: coords.y + offset };
                await this.processSingleFile(file, finalCoords, result.type, event.shiftKey, result.name);
            }
        }
    }

    static async requestImportDetails(file, defaultName, bestMatch, index, total, allNames) {
        return new Promise((resolve) => {
            const initialName = bestMatch || defaultName;
            const listId = `list-${Date.now()}`;
            new Dialog({
                title: `Drag Upload ${index + 1}/${total}`,
                content: `
                    <div style="margin-bottom: 10px;">
                        <label><strong>Target Name:</strong></label>
                        <input type="text" id="name-input" value="${initialName}" list="${listId}" 
                               style="width: 100%; border: 2px solid ${bestMatch ? '#2ecc71' : '#e67e22'}">
                        <datalist id="${listId}">${allNames.map(n => `<option value="${n}">`).join('')}</datalist>
                    </div>`,
                buttons: {
                    actor: { label: "Actor", callback: (html) => resolve({ type: "actor", name: html.find('#name-input').val() }) },
                    journal: { label: "Handout", callback: (html) => resolve({ type: "journal", name: html.find('#name-input').val() }) },
                    skip: { label: "Skip", callback: () => resolve(null) }
                },
                default: "actor",
                close: () => resolve(null)
            }).render(true);
        });
    }

    static async processSingleFile(file, coords, type, isShift, customName) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        const serverPath = `uploads/${this.ID}/${type}s`;
        
        await this.ensureServerDirectory(source, serverPath);
        const uniqueFile = this.getUniqueFile(file);
        const upload = await FilePicker.upload(source, serverPath, uniqueFile);
        
        if (type === "actor") {
            await this.createOrLinkActor(upload.path, customName, coords, isShift);
        } else {
            await this.createHandout(upload.path, customName, coords);
        }
    }

    static async createOrLinkActor(path, name, coords, isShift) {
        // Priority 1: Find actor in Sidebar (Statblock Importer results)
        let actor = game.actors.find(a => a.name.toLowerCase() === name.toLowerCase());

        if (actor) {
            // Link image to existing actor data
            await actor.update({ img: path, "prototypeToken.texture.src": path });
        } else {
            // Create new if not found
            const actorType = game.system.id === "dnd5e" ? "npc" : "character";
            actor = await Actor.create({
                name: name,
                type: actorType,
                img: path,
                prototypeToken: { name: name, texture: { src: path }, actorLink: false }
            });
        }

        let tokenPos = { x: coords.x, y: coords.y };
        if (!isShift) {
            const snapped = canvas.grid.getSnappedPoint({x: tokenPos.x, y: tokenPos.y}, {mode: CONST.GRID_SNAPPING_MODES.CENTER});
            tokenPos.x = snapped.x;
            tokenPos.y = snapped.y;
        }

        await canvas.scene.createEmbeddedDocuments('Token', [{
            name: name,
            actorId: actor.id,
            texture: { src: path },
            x: tokenPos.x,
            y: tokenPos.y
        }]);
    }

    static async createHandout(path, name, coords) {
        const journal = await JournalEntry.create({
            name: name,
            pages: [{ name: name, type: "image", src: { path: path } }],
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
        await canvas.scene.createEmbeddedDocuments('Note', [{ 
            entryId: journal.id, x: coords.x, y: coords.y, texture: { src: "icons/svg/book.svg" } 
        }]);
    }

    static async getCompendiumNames() {
        const packs = game.packs.filter(p => p.metadata.type === "Actor");
        let names = new Set();
        for (const p of packs) {
            const index = await p.getIndex();
            index.forEach(e => names.add(e.name));
        }
        return Array.from(names);
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

// V14 Capture Hook: Use 'true' for capture phase to beat Foundry's internal listeners
Hooks.on("ready", () => {
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev), true);
});
