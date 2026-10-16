# Threadlab Studio

A browser-based 3D garment presentation studio for previewing uploaded front and back apparel artwork on a modeled hoodie and pants set. This public source snapshot is the **v0.20** prototype, originally developed under the name **Ghost360 Garment Studio**; the interface and package still contain that internal name.

## What it does

- Analyzes front/back source images and existing transparency before building a 3D garment preview.
- Detects duplicate or missing pants-back views and offers a conservative generated back before proceeding.
- Registers artwork as garment textures and synthesizes side textures for the 3D model.
- Presents a front-facing �45� swing, flips to a rear-facing �45� swing, then loops back to the front.
- Offers 8, 10, 12, or 15-second showcase durations and a WebM video export.
- Checks the browser/GPU renderbuffer capability before attempting a native 7680 x 4320 (8K) export instead of silently downscaling it.

## Stack

JavaScript, HTML, CSS, Three.js, and Vite. The model and rendering run locally in the browser. There is no server-side image upload in this source snapshot.

## Run locally

Requires Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the localhost URL Vite prints. On Windows, `start_windows.bat` performs the install/start steps. `npm run build` creates a production bundle in `dist/`.

## Workflow

1. Upload front and back garment images.
2. Review the analysis and resolve any missing or duplicate view.
3. Select **Continue - Generate 3D Clothing**.
4. Preview the front/back showcase and choose its duration.
5. Export a WebM video if the browser and GPU support the requested resolution.

8K recording is hardware-intensive and dependent on browser encoding support; the app reports an unsupported device rather than promising a successful export on every machine. The repository includes a `QA_CHECKLIST.md` from the v0.20 development pass, not a substitute for device-specific testing.

## Repository notes

This is source code, not the later installed Windows executable. Generated videos, private garment uploads, and bulky dependencies are not committed. The underlying apparel graphics belong to their respective owners; use your own artwork when testing.


