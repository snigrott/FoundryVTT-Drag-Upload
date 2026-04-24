# Drag Upload (V14 Compatible)

* This is a significant refactoring of the original module by **Cody Swendrowski** for Foundry Virtual Table Top Version 14.
* Version 5.0.0 is built to be backward compatible with **FoundryVTT Versions 12, 13, and 14**.
* For legacy support (V11 and earlier), please use the original project: [FoundryVTT-Drag-Upload](https://github.com/cswendrowski/FoundryVTT-Drag-Upload).
  
## Description
Drag image files directly from your computer or a web browser onto the Foundry VTT canvas to instantly create or update Actors and Handouts. 

## Key Features
* **Smart Actor Linking (New!):** Specifically designed to work with the **5e Statblock Importer**. If you drag an image for an Actor that already exists in your sidebar, the module updates that Actor's portrait and token art instead of creating a duplicate.
* **Fuzzy Name Matching:** Uses Foundry’s internal `slugify` logic to match filenames to Actor names (e.g., `ancient-red-dragon.jpg` will automatically suggest a match for the actor `Ancient Red Dragon`).
* **V14 Ready:** Fully updated to handle the new coordinate system and grid snapping APIs introduced in Foundry VTT Version 14.
* **Instant Scaling (Alt + Scroll):** Hover over any token, hold **Alt**, and scroll your mouse wheel to dynamically resize it in 1-grid increments without opening a sheet.
* **Web Import:** Drag images directly from your browser to upload and place them instantly (Chromium-based browsers recommended).

## Technical Highlights
* **Modern Pointer Logic:** Replaced legacy `worldTransform` math with the modern `getLocalPosition` API for pixel-perfect placement accuracy on any scene scale.
* **Unified Selection Dialog:** A clean, intuitive pop-up allows you to confirm the asset name and choose between an **Actor** (Token) or a **Journal Entry** (Handout) for every drop.
* **Data Model Compliance:** Fully updated for the modern Data Model, utilizing `prototypeToken.texture` and `.toObject()` for safe, crash-free document manipulation.
* **Smart File Management:** Automatically generates unique filenames using timestamps to prevent accidental overwriting of existing server assets.

## Installation
To install this version, use the following manifest URL in your Foundry VTT Add-on Modules tab:
`https://github.com/snigrott/FoundryVTT-Drag-Upload/releases/download/latest/module.json`

## Usage Tips
* **Snap to Grid:** Assets snap to the grid center by default. Hold **Shift** while dropping to bypass snapping and place the asset exactly where your mouse is.
* **Sidebar Organization:** If a match isn't found in your Sidebar, new Actors are created in a folder named `Drag Upload: Actors`. You can move them to your own folders; the module will still find and update them later!
* **Multiple Files:** Dragging multiple files at once will stagger them slightly on the canvas so they don't land directly on top of each other.

---
*Maintained for V14 by Brian Smith (April 2026)*
