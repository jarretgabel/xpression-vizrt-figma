# Figma to XPression

Convert a Figma JSON export into a single SVG asset that can be imported into Ross XPression directly, or routed through Illustrator as AI or EPS when needed.

The browser app is a Vite + React + TypeScript + Tailwind frontend rooted in `src/`, with production output emitted to `dist/`.

## Usage

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

Then open the local app, provide a Figma URL or the file key plus one or more node IDs, fetch the node JSON from Figma, and generate the SVG preview.

The app previews the generated SVG, lets you download the SVG and report, emits a starter manifest for unresolved image refs, and shows XPression prep guidance based on the source features it detects.

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
- For the cleanest XPression import path, flatten boolean/vector constructs in Figma where possible, avoid relying on blur and shadow effects, and standardize text styles because mixed text runs are flattened in this exporter.
- Fonts are still the biggest fidelity constraint. The app can now audit them and substitute families client-side, but it cannot reliably outline live text without access to the actual font files or an external shaping/rendering step.
- The converter now handles more primitives directly, including ellipses, lines, vectors, stars, polygons, and basic rotation transforms, while still flagging higher-risk geometry for review.
- The report flags unsupported node types, unsupported paints, transform-heavy layers, and text style overrides so you can fix the source design before import.