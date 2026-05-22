# Figma to XPression

Translate Figma node JSON into broadcast-graphics handoff outputs.

The project still supports the original XPression SVG import workflow, but the browser app now also helps you prepare native rebuild paths for Ross XPression and Vizrt, plus SVG asset exports for Viz workflows.

The browser app is a Vite + React + TypeScript + Tailwind frontend rooted in `src/`, with production output emitted to `dist/`.

## CLI Usage

```bash
./convert.sh /absolute/path/to/input.json /absolute/path/to/output.svg
```

Or run the Node entrypoint directly:

```bash
node scripts/figma-json-to-svg.mjs /absolute/path/to/input.json /absolute/path/to/output.svg
```

With missing image refs resolved from an asset manifest or a folder of files named after the Figma `imageRef` values:

```bash
node scripts/figma-json-to-svg.mjs ./example.json ./example.svg --manifest ./assets-manifest.json
node scripts/figma-json-to-svg.mjs ./example.json ./example.svg --assets-dir ./assets
```

The converter also writes a sidecar report next to the SVG with:

- fonts referenced in the Figma export
- image assets that were successfully embedded from a manifest or asset folder
- image assets that were referenced by `imageRef` but not embedded in the JSON
- effects that were not reproduced exactly in the SVG output

## Browser App

Install dependencies:

```bash
nvm use
npm install
```

The frontend toolchain expects Node 18+ and includes a local `.nvmrc` pinned to Node 20.20.1.

Run the local browser app with:

```bash
npm run dev
```

Build the production app into `dist/` with:

```bash
npm run build
```

Then open the local app, provide a Figma URL or the file key plus one or more node IDs, fetch the node JSON from Figma, and generate the preview.

The app now has four delivery paths:

- `XPression SVG Import`: generates the current SVG-import handoff template for Ross XPression
- `XPression Native`: generates a native primitives/slabs rebuild plan for XPression
- `Vizrt Native`: generates a native Viz Artist scene rebuild plan
- `Vizrt SVG Assets`: exports SVG artwork and an asset manifest for Viz reference or static asset workflows

The app also includes:

- live editing of detected text, image, and color bindings
- side-by-side generated preview and optional Figma-rendered SVG reference
- font auditing and binding inspection
- target-aware readiness guidance for the currently selected delivery path
- normalized JSON and missing-image manifest downloads for prep/debugging

Important: only `XPression SVG Import` should be treated as an SVG import workflow. The Vizrt paths are intentionally separated into native rebuild and asset-export modes so the UI does not imply XPression-style SVG import parity where it does not exist.

## Delivery Paths

### XPression SVG Import

Use this when your target workflow is still an imported SVG inside Ross XPression. The app generates:

- an XPression SVG import template
- a bindings map
- a data payload

### XPression Native

Use this when you want to rebuild the scene natively in XPression with text objects, image objects, slabs/primitives, and effect reconstruction notes instead of importing SVG directly.

### Vizrt Native

Use this when you want to rebuild the scene in Viz Artist with containers, text objects, image materials, shapes, and native effect/material logic.

### Vizrt SVG Assets

Use this when Viz needs SVG artwork as reference or as a static asset export. This is not presented as a bindable scene handoff.

## Inspector

The inspector is shared analysis for the current source graphic, with one important distinction:

- `Readiness` changes based on the selected delivery target
- `Bindings`, `Fonts`, and `Prep` stay tied to the source analysis itself

This means you can switch between XPression and Vizrt paths while keeping the same source-level diagnostics available.

## Environment

Set the Figma token in a Vite env file:

```bash
cp .env.example .env.local
```

Then set:

```bash
VITE_FIGMA_TOKEN=your_figma_pat_here
VITE_FIGMA_API_BASE=https://api.figma.com/v1
VITE_FONT_SUBSTITUTIONS={"Gotham":"Arial","Helvetica Neue":{"family":"Arial","postScriptName":"ArialMT"}}
```

Important: this is still a frontend-only app. Any `VITE_` token is embedded into the client build and should only be used for local development or tightly controlled internal deployments.

## Direct Figma API

The app fetches node JSON directly from the Figma REST API using `VITE_FIGMA_TOKEN`. The frontend parses standard Figma URLs to extract the file key and `node-id`, then requests the `files/:key/nodes` endpoint with `geometry=paths` so vector geometry is available for conversion.

Before conversion, the app now runs a preprocessing pass that:

- removes hidden nodes from the in-memory payload
- trims node names and normalizes near-zero rotations
- optionally substitutes font families from `VITE_FONT_SUBSTITUTIONS`
- asks Figma for remote image-fill URLs and embeds the resolved assets automatically

That prep happens in code before the converter runs; it does not require additional UI steps.

## Notes

- The JSON export must contain at least one root node under `nodes`.
- Raster images are not embedded directly in standard Figma node JSON exports, so this app resolves image fills through Figma's image endpoint before conversion when possible.
- If your XPression version does not import SVG directly, open the SVG in Illustrator and save it as AI or EPS first.
- For the cleanest XPression SVG import path, flatten boolean/vector constructs in Figma where possible, avoid relying on blur and shadow effects, and standardize text styles because mixed text runs are flattened in this exporter.
- Fonts are still the biggest fidelity constraint. The app can now audit them and substitute families client-side, but it cannot reliably outline live text without access to the actual font files or an external shaping/rendering step.
- The converter now handles more primitives directly, including ellipses, lines, vectors, stars, polygons, and basic rotation transforms, while still flagging higher-risk geometry for review.
- The report flags unsupported node types, unsupported paints, transform-heavy layers, and text style overrides so you can fix the source design before handoff.
- Vizrt-native and Vizrt-SVG outputs are best treated as build/reference guidance, not as a promise of XPression-style direct scene import.