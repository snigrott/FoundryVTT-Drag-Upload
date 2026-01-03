# Drag Upload (V13 Compatible)

* This is a significant refactoring of the original module by **Cody Swendrowski** for Foundry Virtual Table Top Version 13.
* Due to significant internal Data Model compatibility changes between FoundryVTT Version 11 and later releases this module will NOT work with FoundryVTT versions prior to 12. Please use the Original Version: [FoundryVTT-Drag-Upload](https://github.com/cswendrowski/FoundryVTT-Drag-Upload)
  
## Description
Adds the ability to drag files directly from your computer or a web browser onto the Foundry VTT canvas to automatically create Tokens, Tiles, Journal Pins, and Ambient Audio.

## Features
* **Smart Layer Detection:** The module creates different documents based on your active layer:
    * **Token Layer:** Creates a new Actor and places a Token.
    * **Background/Foreground Layer:** Creates a Tile.
    * **Notes Layer:** Creates a Journal Entry and a Note pin.
* **Audio Support:** Automatically detects audio files (.mp3, .wav, .flac, etc.) and creates an Ambient Sound source.
* **Web Import:** Drag images directly from your browser to upload and place them instantly (Chromium-based browsers recommended).
* **V13 Optimized:** Uses the modern Document Data Model and `worldTransform` coordinate math for high performance and perfect placement.

## V13 Refactor Highlights
* **Zero Legacy Bloat:** Removed all compatibility code for versions 9, 10, and 11, resulting in a script half the size of the original.
* **Data Model Compliance:** Fully updated to use `prototypeToken.texture` and modern Document creation methods.
* **Stale Data Fix:** Implemented scoped variable resets to prevent "sticky" images when dragging multiple different web assets in a single session.
* **Logging:** Added structured console logging for easier troubleshooting of file uploads and coordinate mapping.

* Instant Scaling (Alt + Scroll): Hover over any token, hold Alt, and scroll to dynamically resize it in 1-grid increments.

* Smart UI Protection: Safely handles global drops. Dragging images onto character sheets or the sidebar will trigger default Foundry behavior, while dragging onto the map triggers the module.

* Chat Notifications: Automatically posts a clickable link to the chat log for every new Actor or Handout created.

* Contextual Creation: Automatically creates a Journal Handout if the Journal Notes tool is active, or an Actor Token for all other tools.

## Installation
To install this version, use the following manifest URL in your Foundry VTT Add-on Modules tab:
`https://github.com/snigrott/FoundryVTT-Drag-Upload/releases/download/latest/module.json`

## Usage Tips
* **Snap to Grid:** Assets snap to the grid by default. Hold **Shift** while dropping to bypass snapping.
* **Hidden Assets:** Hold **Alt** while dropping to create the Token or Tile as "Hidden" from players.

---
*Maintained for V13 by Brian Smith (Jan 2026)*
