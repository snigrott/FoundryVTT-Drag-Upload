/**
 * Drag Upload Engine V5.4.1
 * Features: 
 * - Fixed: Accurate drop coordinates using canvas.mousePosition
 * - Smart Compendium Matching & Auto-Import
 * - Scene / Background Map Creation
 * - Assets Path: /assets/battlemaps/ (maps) & /assets/images/[tokens|handouts|tiles]
 */

class DragUploadEngine {
    static ID = "dragupload";

    static init() {
        this.registerSettings();
        window.addEventListener("wheel", (ev) => this._onWheel(ev), { passive: false });
        window.addEventListener("dragover", (ev) => {
            if (ev.dataTransfer.types.includes("Files")) {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "copy";
            }
        }, false);
    }

    static registerSettings() {
        game.settings.register(this.ID, "fileUploadSource", {
            name: "Upload Source",
            scope: "world",
            config: true,
            type: String,
            default: "data",
            choices: { "data": "User Data", "s3": "S3 Storage" }
        });
    }

    static slugify(text) {
        return text.toString().toLowerCase().trim()
            .replace(/\s+/g, '-')           
            .replace(/[^\w\-]+/g, '')       
            .replace(/\-\-+/g, '-')         
            .replace(/^-+/, '')             
            .replace(/-+$/, '');            
    }

    static getUniqueFile(file) {
        const timestamp = Date.now();
        const parts = file.name.split('.');
        const ext = parts.pop().toLowerCase();
        const base = this.slugify(parts.join('.'));
        return new File([file], `${base}-${timestamp}.${ext}`, { type: file.type });
    }

    static _onWheel(event) {
        if (!event.altKey) return;
        const hover = canvas.tokens.hover || canvas.tiles.hover;
        if (!hover) return;
        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : -1; 
        hover.document.update({ 
            width: Math.max(1, hover.document.width + delta), 
            height: Math.max(1, hover.document.height + delta) 
        });
    }

    static async handleDrop(event) {
        if (!canvas.ready || !game.user.isGM) return;
        const files = event.dataTransfer.files;
        if (!files?.length) return;

        event.preventDefault();
        event.stopPropagation();

        const coords = canvas.mousePosition;

        const worldNames = game.actors.map(a => a.name);
        const compendiumNames = await this.getCompendiumNames();
        const allNames = Array.from(new Set([...worldNames, ...compendiumNames])).sort();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const rawName = file.name.replace(/\.[^/.]+$/, "");
            const bestMatch = this.findBestMatch(rawName, allNames);
            
            const result = await this.requestImportDetails(file, rawName, bestMatch, i, files.length, allNames);
            
            if (result) {
                const offset = i * (canvas.grid.size / 5);
                const finalCoords = { x: coords.x + offset, y: coords.y + offset };
                await this.processSingleFile(file, finalCoords, result.type, event.shiftKey, result.name);
            }
        }
    }

    static findBestMatch(input, names) {
        const targetSlug = this.slugify(input);
        return names.find(n => this.slugify(n) === targetSlug) || null;
    }

    static async requestImportDetails(file, defaultName, bestMatch, index, total, allNames) {
        return new Promise((resolve) => {
            const initialName = bestMatch || defaultName;
            new Dialog({
                title: `Drag Upload ${index + 1}/${total}`,
                content: `
                    <div style="margin-bottom: 10px;">
                        <p>File: <strong>${file.name}</strong></p>
                        <label><strong>Target Name:</strong></label>
                        <input type="text" id="name-input" value="${initialName}" list="actor-list" style="width: 100%; border: 2px solid ${bestMatch ? '#2ecc71' : '#ccc'}">
                        <datalist id="actor-list">${allNames.map(n => `<option value="${n}">`).join('')}</datalist>
                    </div>`,
                buttons: {
                    actor: { label: "Actor", callback: (html) => resolve({ type: "actor", name: html.find('#name-input').val() }) },
                    tile: { label: "Tile", callback: (html) => resolve({ type: "tile", name: html.find('#name-input').val() }) },
                    journal: { label: "Handout", callback: (html) => resolve({ type: "journal", name: html.find('#name-input').val() }) },
                    scene: { label: "New Map / Scene", callback: (html) => resolve({ type: "scene", name: html.find('#name-input').val() }) }
                },
                default: "actor",
                close: () => resolve(null)
            }).render(true);
        });
    }

    static async processSingleFile(file, coords, type, isShift, customName) {
        const source = game.settings.get(this.ID, "fileUploadSource");
        
        // Custom path routing: maps go to assets/battlemaps, others stay in assets/images/
        let serverPath = "assets/images/tokens";
        if (type === "scene") {
            serverPath = "assets/battlemaps";
        } else if (type === "journal") {
            serverPath = "assets/images/handouts";
        } else if (type === "tile") {
            serverPath = "assets/images/tiles";
        }
        
        await this.ensureServerDirectory(source, serverPath);
        const upload = await FilePicker.upload(source, serverPath, this.getUniqueFile(file));
        
        if (type === "actor") await this.createOrLinkActor(upload.path, customName, coords, isShift);
        else if (type === "tile") await this.createTile(upload.path, coords);
        else if (type === "journal") await this.createHandout(upload.path, customName, coords);
        else if (type === "scene") await this.createScene(upload.path, customName);
    }

    static async createScene(path, name) {
        const img = new Image();
        img.src = path;
        
        try {
            await img.decode();
        } catch (e) {
            console.warn("DragUploadEngine | Could not pre-decode image dimensions, using fallbacks.", e);
        }

        const width = img.naturalWidth || 4000;
        const height = img.naturalHeight || 3000;

        const scene = await Scene.create({
            name: name,
            background: { src: path },
            width: width,
            height: height,
            grid: { type: 1, size: 100 },
            padding: 0.25
        });

        new Dialog({
            title: "Scene Created",
            content: `<p>Created Scene <strong>${name}</strong> in <code>assets/battlemaps/</code> (${width}x${height}px). View it now?</p>`,
            buttons: {
                view: { label: "View Scene", callback: () => scene.view() },
                activate: { label: "Activate Scene", callback: () => scene.activate() },
                close: { label: "Stay Here", callback: () => {} }
            },
            default: "view"
        }).render(true);
    }

    static async createTile(path, coords) {
        await canvas.scene.createEmbeddedDocuments('Tile', [{
            texture: { src: path }, 
            width: canvas.grid.size, 
            height: canvas.grid.size, 
            x: coords.x - (canvas.grid.size / 2), 
            y: coords.y - (canvas.grid.size / 2)
        }]);
    }

    static async createOrLinkActor(path, name, coords, isShift) {
        let actor = game.actors.find(a => a.name.toLowerCase() === name.toLowerCase());

        if (!actor) {
            for (let pack of game.packs.filter(p => p.metadata.type === "Actor")) {
                const index = await pack.getIndex();
                const entry = index.find(e => e.name.toLowerCase() === name.toLowerCase());
                if (entry) {
                    actor = await game.actors.importFromCompendium(pack, entry._id);
                    break;
                }
            }
        }

        if (actor) {
            await actor.update({ img: path, "prototypeToken.texture.src": path });
        } else {
            actor = await Actor.create({
                name: name, type: "npc", img: path, prototypeToken: { name: name, texture: { src: path } }
            });
        }

        let tokenPos = { x: coords.x, y: coords.y };
        if (!isShift) {
            const snapped = canvas.grid.getSnappedPoint({x: tokenPos.x, y: tokenPos.y}, {mode: CONST.GRID_SNAPPING_MODES.CENTER});
            tokenPos.x = snapped.x; tokenPos.y = snapped.y;
        }

        await canvas.scene.createEmbeddedDocuments('Token', [{
            name: name, 
            actorId: actor.id, 
            texture: { src: path }, 
            x: tokenPos.x - (canvas.grid.size / 2), 
            y: tokenPos.y - (canvas.grid.size / 2)
        }]);
    }

    static async createHandout(path, name, coords) {
        const journal = await JournalEntry.create({
            name: name, pages: [{ name: name, type: "image", src: { path: path } }], ownership: { default: 3 }
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
Hooks.on("ready", () => {
    window.addEventListener("drop", (ev) => DragUploadEngine.handleDrop(ev), true);
});
