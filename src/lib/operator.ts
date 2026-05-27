import type { DynamicBindingsManifest, DynamicBindingItem } from '../types';

export type OperatorValues = Record<string, string>;

type SvgBindingMetadata = {
  tagName: string;
  fill: string | null;
  stroke: string | null;
  hasInnerShadow: boolean;
  hasLayerBlur: boolean;
};

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ? trimmed : null;
}

function colorParts(value: string) {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length === 9) {
    return {
      color: normalized.slice(0, 7),
      opacity: parseInt(normalized.slice(7, 9), 16) / 255,
    };
  }

  return {
    color: normalized,
    opacity: undefined,
  };
}

function parseGradientValue(value: string) {
  return value
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [offset, color] = entry.split(':');
      return {
        offset: offset?.trim() || '0%',
        color: color?.trim() || '#ffffff',
      };
    });
}

function applyTextCase(value: string, textCase?: string) {
  if (!textCase) {
    return value;
  }

  if (textCase === 'UPPER') {
    return value.toUpperCase();
  }

  if (textCase === 'LOWER') {
    return value.toLowerCase();
  }

  if (textCase === 'TITLE') {
    return value.replace(/\b(\p{L})(\p{L}*)/gu, (_, first, rest) => `${String(first).toUpperCase()}${String(rest).toLowerCase()}`);
  }

  return value;
}

export function buildInitialOperatorValues(manifest: DynamicBindingsManifest): OperatorValues {
  return manifest.items.reduce<OperatorValues>((accumulator, item) => {
    if (item.bindingType === 'text') {
      accumulator[item.fieldKey] = applyTextCase(item.textSample || '', item.textCase);
      return accumulator;
    }
    if (item.bindingType === 'color') {
      accumulator[item.fieldKey] = item.colorValue || '';
      return accumulator;
    }
    accumulator[item.fieldKey] = '';
    return accumulator;
  }, {});
}

function directTspanChildren(element: Element) {
  return Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'tspan');
}

function applyTextValue(element: Element, value: string, textCase?: string) {
  const documentRef = element.ownerDocument;
  const x = element.getAttribute('x') || '0';
  const existingTspan = element.querySelector('tspan');
  const existingDy = existingTspan?.getAttribute('dy');
  const lineHeight = existingDy && existingDy !== '0' ? existingDy : '1.2em';
  const lines = applyTextCase(value, textCase).split('\n');

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  lines.forEach((line, index) => {
    const span = documentRef.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    span.setAttribute('x', x);
    span.setAttribute('dy', index === 0 ? '0' : lineHeight);
    span.textContent = line;
    element.appendChild(span);
  });
}

function setTextX(element: Element, nextX: number) {
  const xValue = String(nextX);
  element.setAttribute('x', xValue);
  for (const span of directTspanChildren(element)) {
    span.setAttribute('x', xValue);
  }
}

function setTextY(element: Element, nextY: number) {
  element.setAttribute('y', String(nextY));
}

function textElementX(element: Element, fallbackX?: number) {
  const value = Number(element.getAttribute('x'));
  if (!Number.isNaN(value)) {
    return value;
  }
  return fallbackX ?? 0;
}

function textElementY(element: Element, fallbackY?: number) {
  const value = Number(element.getAttribute('y'));
  if (!Number.isNaN(value)) {
    return value;
  }
  return fallbackY ?? 0;
}

function horizontalScaleForElement(element: Element) {
  const transform = element.getAttribute('transform') || '';
  const match = transform.match(/scale\(\s*([0-9.+-eE]+)/);
  if (!match) {
    return 1;
  }

  const scale = Number(match[1]);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function measureTextWidth(element: Element) {
  try {
    const svgElement = element as unknown as SVGGraphicsElement;
    const box = svgElement.getBBox();
    if (box.width > 0) {
      return box.width * horizontalScaleForElement(element);
    }
  } catch {
    // Fall back to the DOM box when SVG metrics are unavailable.
  }

  return element.getBoundingClientRect().width;
}

function measureSpaceWidth(referenceElement: Element) {
  const documentRef = referenceElement.ownerDocument;
  const svgRoot = referenceElement.closest('svg');
  if (!documentRef || !svgRoot) {
    return 4;
  }

  const probe = documentRef.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.textContent = ' ';
  const computedStyle = getComputedStyle(referenceElement as Element);
  probe.setAttribute('font-family', computedStyle.fontFamily);
  probe.setAttribute('font-size', computedStyle.fontSize);
  probe.setAttribute('font-weight', computedStyle.fontWeight);
  probe.setAttribute('letter-spacing', computedStyle.letterSpacing);
  probe.setAttribute('opacity', '0');
  probe.setAttribute('x', '-10000');
  probe.setAttribute('y', '-10000');
  svgRoot.appendChild(probe);

  let width = 4;
  try {
    width = Math.max(1, measureTextWidth(probe));
  } finally {
    probe.remove();
  }

  return width;
}

function applyTextFlowLayout(svgRoot: Element, manifest: DynamicBindingsManifest) {
  const itemsByKey = new Map(manifest.items.map((item) => [item.fieldKey, item]));

  for (const item of manifest.items) {
    if (item.bindingType !== 'text' || !item.flowAfterFieldKey) {
      continue;
    }

    const previousItem = itemsByKey.get(item.flowAfterFieldKey);
    if (!previousItem) {
      continue;
    }

    const previousElement = svgRoot.querySelector(`[data-binding-key="${item.flowAfterFieldKey}"]`);
    const currentElement = svgRoot.querySelector(`[data-binding-key="${item.fieldKey}"]`);
    if (!previousElement || !currentElement) {
      continue;
    }

    const previousX = textElementX(previousElement, previousItem.x);
    const previousWidth = measureTextWidth(previousElement);
    const measuredSpaceWidth = measureSpaceWidth(previousElement);
    const nextGap = item.flowKind === 'attached'
      ? Math.max(1, item.flowGap ?? measuredSpaceWidth * 0.4)
      : Math.max(1, item.flowGap ?? measuredSpaceWidth);
    const previousOriginalX = textElementX(previousElement, previousItem.x);
    const currentOriginalX = textElementX(currentElement, item.x);
    const previousHasTransform = Boolean(previousElement.getAttribute('transform'));
    const currentHasTransform = Boolean(currentElement.getAttribute('transform'));
    const nextX = previousHasTransform || currentHasTransform
      ? previousX + (currentOriginalX - previousOriginalX)
      : previousX + previousWidth + nextGap;
    setTextX(currentElement, nextX);

    const previousY = textElementY(previousElement, previousItem.y);
    const previousOriginalY = textElementY(previousElement, previousItem.y);
    const currentOriginalY = textElementY(currentElement, item.y);
    const baselineDelta = currentOriginalY - previousOriginalY;
    const nextY = previousY + baselineDelta;
    setTextY(currentElement, nextY);
  }
}

function applyImageValue(element: Element, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  element.setAttribute('href', trimmed);
  element.setAttributeNS('http://www.w3.org/1999/xlink', 'href', trimmed);
}

function applySolidColor(element: Element, attributeName: 'fill' | 'stroke', value: string) {
  const parts = colorParts(value);
  if (!parts) {
    return;
  }

  element.setAttribute(attributeName, parts.color);
  if (parts.opacity === undefined) {
    element.removeAttribute(`${attributeName}-opacity`);
    return;
  }
  element.setAttribute(`${attributeName}-opacity`, String(parts.opacity));
}

function applyGradientColor(documentRef: XMLDocument, gradientId: string, value: string) {
  const gradient = documentRef.querySelector(`#${CSS.escape(gradientId)}`);
  if (!gradient) {
    return;
  }

  const stops = Array.from(gradient.querySelectorAll('stop'));
  const entries = value.includes('|') ? parseGradientValue(value) : stops.map((stop) => ({
    offset: stop.getAttribute('offset') || '0%',
    color: value,
  }));

  stops.forEach((stop, index) => {
    const entry = entries[Math.min(index, entries.length - 1)];
    const parts = colorParts(entry.color);
    if (!parts) {
      return;
    }
    stop.setAttribute('offset', entry.offset);
    stop.setAttribute('stop-color', parts.color);
    if (parts.opacity === undefined) {
      stop.removeAttribute('stop-opacity');
      return;
    }
    stop.setAttribute('stop-opacity', String(parts.opacity));
  });
}

function applyColorValue(documentRef: XMLDocument, element: Element, value: string) {
  const fill = element.getAttribute('fill');
  const stroke = element.getAttribute('stroke');
  const candidate = fill && fill !== 'none' ? { name: 'fill' as const, value: fill } : stroke && stroke !== 'none' ? { name: 'stroke' as const, value: stroke } : null;
  if (!candidate) {
    return;
  }

  if (candidate.value.startsWith('url(#') && candidate.value.endsWith(')')) {
    const gradientId = candidate.value.slice(5, -1);
    applyGradientColor(documentRef, gradientId, value);
    return;
  }

  applySolidColor(element, candidate.name, value);
}

export function applyBindingsToSvg(svg: string, manifest: DynamicBindingsManifest | null, values: OperatorValues) {
  if (!svg || !manifest) {
    return svg;
  }

  const parser = new DOMParser();
  const documentRef = parser.parseFromString(svg, 'image/svg+xml');

  manifest.items.forEach((item) => {
    const nextValue = values[item.fieldKey];
    if (nextValue === undefined || nextValue === '') {
      return;
    }

    const element = documentRef.querySelector(`[data-binding-key="${item.fieldKey}"]`);
    if (!element) {
      return;
    }

    if (item.bindingType === 'text') {
      applyTextValue(element, nextValue, item.textCase);
      return;
    }
    if (item.bindingType === 'image') {
      applyImageValue(element, nextValue);
      return;
    }
    applyColorValue(documentRef, element, nextValue);
  });

  if (typeof document !== 'undefined') {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';

    const svgRoot = document.importNode(documentRef.documentElement, true);
    host.appendChild(svgRoot);
    document.body.appendChild(host);
    applyTextFlowLayout(svgRoot, manifest);
    const serialized = new XMLSerializer().serializeToString(svgRoot);
    host.remove();
    return serialized;
  }

  return new XMLSerializer().serializeToString(documentRef);
}

function templateLine(item: DynamicBindingItem, value: string) {
  if (item.bindingType === 'text') {
    return `SetText("${item.svgId}", banner.${item.fieldKey}); // ${value || item.textSample || ''}`;
  }
  if (item.bindingType === 'image') {
    return `SetImage("${item.svgId}", banner.${item.fieldKey}); // ${value || item.imageRef || ''}`;
  }
  return `SetColor("${item.svgId}", banner.${item.fieldKey}); // ${value || item.colorValue || ''}`;
}

function flowTemplateLine(item: DynamicBindingItem, manifest: DynamicBindingsManifest) {
  if (item.bindingType !== 'text' || !item.flowAfterFieldKey) {
    return null;
  }

  const previousItem = manifest.items.find((candidate) => candidate.fieldKey === item.flowAfterFieldKey);
  if (!previousItem) {
    return null;
  }

  const gapMode = item.flowKind === 'attached' ? 'space*0.4' : 'space';
  const baselineOffset = item.flowBottomOffset ?? 0;
  return `SetTextAfter("${item.svgId}", "${previousItem.svgId}", ${gapMode}); SetBaselineOffset("${item.svgId}", ${baselineOffset}); // keep ${item.fieldKey} attached after ${previousItem.fieldKey}`;
}

function blurTemplateLines(svg: string | null) {
  if (!svg) {
    return [];
  }

  const parser = new DOMParser();
  const documentRef = parser.parseFromString(svg, 'image/svg+xml');
  return Array.from(documentRef.querySelectorAll('[data-effect-layer-blur]'))
    .map((element) => {
      const svgId = element.getAttribute('id');
      const radius = element.getAttribute('data-effect-layer-blur');
      if (!svgId || !radius) {
        return null;
      }
      return `SetGaussianBlur("${svgId}", ${radius}); // preserve Figma layer blur`;
    })
    .filter((line): line is string => Boolean(line));
}

function innerShadowTemplateLines(svg: string | null) {
  if (!svg) {
    return [];
  }

  const parser = new DOMParser();
  const documentRef = parser.parseFromString(svg, 'image/svg+xml');
  return Array.from(documentRef.querySelectorAll('[data-effect-inner-shadow]'))
    .flatMap((element) => {
      const svgId = element.getAttribute('id');
      const payload = element.getAttribute('data-effect-inner-shadow');
      if (!svgId || !payload) {
        return [];
      }

      return payload.split(';').filter(Boolean).map((entry) => {
        const [dx, dy, radius, color, opacity] = entry.split(',');
        return `SetInnerShadow("${svgId}", ${dx}, ${dy}, ${radius}, "${color}", ${opacity}); // preserve Figma inner shadow`;
      });
    });
}

function bindingMetadataByFieldKey(manifest: DynamicBindingsManifest, svg: string | null) {
  if (!svg) {
    return new Map<string, SvgBindingMetadata>();
  }

  const parser = new DOMParser();
  const documentRef = parser.parseFromString(svg, 'image/svg+xml');
  const metadata = new Map<string, SvgBindingMetadata>();

  manifest.items.forEach((item) => {
    const element = documentRef.querySelector(`[data-binding-key="${item.fieldKey}"]`);
    if (!element) {
      return;
    }

    metadata.set(item.fieldKey, {
      tagName: element.tagName.toLowerCase(),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
      hasInnerShadow: element.hasAttribute('data-effect-inner-shadow') || Boolean(element.closest('[data-effect-inner-shadow]')),
      hasLayerBlur: element.hasAttribute('data-effect-layer-blur') || Boolean(element.closest('[data-effect-layer-blur]')),
    });
  });

  return metadata;
}

function formatBounds(item: DynamicBindingItem) {
  const x = Number(item.x ?? 0).toFixed(2);
  const y = Number(item.y ?? 0).toFixed(2);
  const width = Number(item.width ?? 0).toFixed(2);
  const height = Number(item.height ?? 0).toFixed(2);
  return `{ x: ${x}, y: ${y}, width: ${width}, height: ${height} }`;
}

function quotedOrNull(value: string | undefined | null) {
  return value ? JSON.stringify(value) : 'null';
}

function primitiveObjectLine(item: DynamicBindingItem, value: string, metadata?: SvgBindingMetadata) {
  if (item.bindingType === 'text') {
    return [
      `EnsureTextObject(${JSON.stringify(item.fieldKey)}, ${formatBounds(item)}, {`,
      `  sourceId: ${JSON.stringify(item.svgId)},`,
      `  sourceNode: ${JSON.stringify(item.nodeName)},`,
      `  fontFamily: ${quotedOrNull(item.fontFamily)},`,
      `  postScriptName: ${quotedOrNull(item.fontPostScriptName)},`,
      `  textCase: ${quotedOrNull(item.textCase)},`,
      `  align: ${quotedOrNull(item.textAlignHorizontal)},`,
      `  sample: ${JSON.stringify(value || item.textSample || '')},`,
      `});`,
      `BindText(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
    ].join('\n');
  }

  if (item.bindingType === 'image') {
    return [
      `EnsureImageObject(${JSON.stringify(item.fieldKey)}, ${formatBounds(item)}, {`,
      `  sourceId: ${JSON.stringify(item.svgId)},`,
      `  sourceNode: ${JSON.stringify(item.nodeName)},`,
      `  sample: ${JSON.stringify(value || item.imageRef || '')},`,
      `});`,
      `BindImage(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
    ].join('\n');
  }

  const primitiveKind = metadata?.fill?.startsWith('url(#') ? 'slab' : metadata?.tagName === 'path' ? 'path-primitive' : 'rectangle';
  return [
    `EnsurePrimitiveObject(${JSON.stringify(item.fieldKey)}, ${JSON.stringify(primitiveKind)}, ${formatBounds(item)}, {`,
    `  sourceId: ${JSON.stringify(item.svgId)},`,
    `  sourceNode: ${JSON.stringify(item.nodeName)},`,
    `  fill: ${quotedOrNull(metadata?.fill || item.colorValue || null)},`,
    `  stroke: ${quotedOrNull(metadata?.stroke)},`,
    `});`,
    `BindFill(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
  ].join('\n');
}

function vizrtObjectLine(item: DynamicBindingItem, value: string, metadata?: SvgBindingMetadata) {
  if (item.bindingType === 'text') {
    return [
      `EnsureVizText(${JSON.stringify(item.fieldKey)}, ${formatBounds(item)}, {`,
      `  sourceId: ${JSON.stringify(item.svgId)},`,
      `  sourceNode: ${JSON.stringify(item.nodeName)},`,
      `  fontFamily: ${quotedOrNull(item.fontFamily)},`,
      `  postScriptName: ${quotedOrNull(item.fontPostScriptName)},`,
      `  textCase: ${quotedOrNull(item.textCase)},`,
      `  align: ${quotedOrNull(item.textAlignHorizontal)},`,
      `  sample: ${JSON.stringify(value || item.textSample || '')},`,
      `});`,
      `BindVizText(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
    ].join('\n');
  }

  if (item.bindingType === 'image') {
    return [
      `EnsureVizImage(${JSON.stringify(item.fieldKey)}, ${formatBounds(item)}, {`,
      `  sourceId: ${JSON.stringify(item.svgId)},`,
      `  sourceNode: ${JSON.stringify(item.nodeName)},`,
      `  sample: ${JSON.stringify(value || item.imageRef || '')},`,
      `});`,
      `BindVizTexture(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
    ].join('\n');
  }

  const primitiveKind = metadata?.fill?.startsWith('url(#') ? 'gradient-panel' : metadata?.tagName === 'path' ? 'path-shape' : 'rectangle';
  return [
    `EnsureVizShape(${JSON.stringify(item.fieldKey)}, ${JSON.stringify(primitiveKind)}, ${formatBounds(item)}, {`,
    `  sourceId: ${JSON.stringify(item.svgId)},`,
    `  sourceNode: ${JSON.stringify(item.nodeName)},`,
    `  fill: ${quotedOrNull(metadata?.fill || item.colorValue || null)},`,
    `  stroke: ${quotedOrNull(metadata?.stroke)},`,
    `});`,
    `BindVizMaterialColor(${JSON.stringify(item.fieldKey)}, banner.${item.fieldKey});`,
  ].join('\n');
}

export function buildXpressionPrimitivePlan(manifest: DynamicBindingsManifest | null, values: OperatorValues, svg?: string | null) {
  if (!manifest) {
    return 'No native XPression build guide yet.';
  }

  const dataLines = manifest.items.map((item) => `  ${item.fieldKey}: ${JSON.stringify(values[item.fieldKey] ?? '')},`);
  const metadataByFieldKey = bindingMetadataByFieldKey(manifest, svg || null);
  const primitiveLines = manifest.items.flatMap((item) => {
    const lines = [primitiveObjectLine(item, values[item.fieldKey] ?? '', metadataByFieldKey.get(item.fieldKey))];
    const flowLine = flowTemplateLine(item, manifest);
    if (flowLine && item.bindingType === 'text') {
      lines.push(`// Native scene flow: ${flowLine}`);
    }
    return lines;
  });

  const effectNotes = manifest.items.flatMap((item) => {
    const metadata = metadataByFieldKey.get(item.fieldKey);
    if (!metadata) {
      return [];
    }

    const notes = [];
    if (metadata.hasInnerShadow) {
      notes.push(`ApplyNativeInnerShadow(${JSON.stringify(item.fieldKey)}); // recreate Figma inner shadow with XPression material/effect stack`);
    }
    if (metadata.hasLayerBlur) {
      notes.push(`ApplyNativeBlur(${JSON.stringify(item.fieldKey)}); // use native blur/glow instead of SVG filter import`);
    }
    return notes;
  });

  return [
    '// XPression native build guide',
    '// Step-by-step implementation notes plus a generated object outline for rebuilding this graphic in XPression.',
    '// Keep using the SVG import template when you want to preserve the current SVG-based handoff.',
    '',
    '// Implementation workflow',
    '// 1. Unzip the package and open xpression-native-guide.txt, xpression-bindings.json, xpression-data.json, checklist.txt, and report.txt together.',
    '// 2. Read checklist.txt and report.txt first so you know which fonts, effects, transforms, or raster assets still need manual handling.',
    '// 3. Open or create the destination XPression project, then create the Banner scene and Root group shown below.',
    '// 4. Review xpression-bindings.json and xpression-data.json to confirm the live field keys, sample values, and naming you want in the scene.',
    '',
    '// Scene build order',
    '// 5. Create slabs/primitives for panel shapes first, using the generated outline below as the source for names, dimensions, fills, and stacking order.',
    '// 6. Create text objects and image/logo objects next, matching the source bounds, font metadata, and object names from the outline.',
    '// 7. If an assets-manifest.json file is present in the zip, use it to relink logos or raster textures before continuing.',
    '// 8. Apply any relative flow notes after the base objects exist so labels and values stay attached when live data changes.',
    '',
    '// Binding and logic',
    '// 9. Wire text, image, and color fields to scene logic, Visual Logic, or your preferred control layer using the Bind* calls as mapping guidance, not literal runnable code.',
    '// 10. Load xpression-data.json as sample data and confirm that every mapped field updates the intended object.',
    '',
    '// Effects and final pass',
    '// 11. Recreate inner shadows, blur, gradients, and other noted effects natively inside XPression instead of expecting SVG filter parity.',
    '// 12. Verify fonts and raster assets on the target system, compare the rebuilt scene against Figma, and sign off only after the checklist items are cleared.',
    '',
    '// Generated object outline',
    'const banner = {',
    ...dataLines,
    '};',
    '',
    '// Scene scaffolding',
    'CreateScene("Banner");',
    'CreateGroup("Root");',
    '',
    ...primitiveLines,
    ...(effectNotes.length > 0 ? ['', '// Native effect recreation', ...effectNotes] : []),
    '',
    '// Recommended XPression-native build notes',
    '// - Use slabs/rectangles for panel fills and gradient carriers.',
    '// - Use native text objects for editable copy and line flow.',
    '// - Use image objects or material slots for logos/photos.',
    '// - Recreate glows, inner shadows, and blur with native materials/effects rather than imported SVG filters.',
  ].join('\n');
}

export function buildXpressionDataPayload(manifest: DynamicBindingsManifest | null, values: OperatorValues) {
  if (!manifest) {
    return '{\n  "banner": {}\n}';
  }

  const banner = Object.fromEntries(manifest.items.map((item) => [item.fieldKey, values[item.fieldKey] ?? '']));
  return JSON.stringify({ banner }, null, 2);
}

export function buildVizrtScenePlan(manifest: DynamicBindingsManifest | null, values: OperatorValues, svg?: string | null) {
  if (!manifest) {
    return 'No Vizrt native build guide yet.';
  }

  const dataLines = manifest.items.map((item) => `  ${item.fieldKey}: ${JSON.stringify(values[item.fieldKey] ?? '')},`);
  const metadataByFieldKey = bindingMetadataByFieldKey(manifest, svg || null);
  const sceneLines = manifest.items.flatMap((item) => {
    const lines = [vizrtObjectLine(item, values[item.fieldKey] ?? '', metadataByFieldKey.get(item.fieldKey))];
    const flowLine = flowTemplateLine(item, manifest);
    if (flowLine && item.bindingType === 'text') {
      lines.push(`// Vizrt relative text flow: ${flowLine}`);
    }
    return lines;
  });

  const effectNotes = manifest.items.flatMap((item) => {
    const metadata = metadataByFieldKey.get(item.fieldKey);
    if (!metadata) {
      return [];
    }

    const notes = [];
    if (metadata.hasInnerShadow) {
      notes.push(`ApproximateVizInnerShadow(${JSON.stringify(item.fieldKey)}); // rebuild with layered geometry/materials in Viz Artist`);
    }
    if (metadata.hasLayerBlur) {
      notes.push(`ApplyVizGlowOrBlur(${JSON.stringify(item.fieldKey)}); // use Viz native blur/glow/material effects instead of SVG filters`);
    }
    return notes;
  });

  return [
    '// Vizrt native build guide',
    '// Step-by-step implementation notes plus a generated scene outline for rebuilding this graphic in Viz Artist.',
    '// Keep using the XPression tabs when your target is XPression; this guide is a separate Viz-native handoff.',
    '',
    '// Implementation workflow',
    '// 1. Unzip the package and open vizrt-native-guide.txt, vizrt-bindings.json, vizrt-data.json, checklist.txt, and report.txt together.',
    '// 2. Read checklist.txt and report.txt first so you know which fonts, textures, effects, or unsupported details still need manual handling in Viz.',
    '// 3. Open or create the Viz Artist scene, then create the Banner scene and Root container shown below.',
    '// 4. Review vizrt-bindings.json and vizrt-data.json to confirm the live field keys, sample values, and control-layer naming you want to drive.',
    '',
    '// Scene build order',
    '// 5. Build the panel/background shapes first, using the generated outline below for names, bounds, stacking order, and role.',
    '// 6. Add text objects, images, and material-driven elements next, matching the metadata and sample values in the outline.',
    '// 7. If a vizrt-assets-manifest.json file is present in the zip, use it to resolve referenced textures or external assets before wiring control logic.',
    '// 8. Apply any relative text flow notes after the base objects exist so dependent labels stay aligned when data changes.',
    '',
    '// Binding and logic',
    '// 9. Use the BindViz* calls as a guide for how each field should map into DataPool, Trio, script logic, or your preferred control layer.',
    '// 10. Load vizrt-data.json as sample data and confirm that every field updates the intended container, text object, or material slot.',
    '',
    '// Effects and final pass',
    '// 11. Recreate gradients, blur, glow, and inner-shadow looks with Viz materials/effects instead of relying on imported SVG filter behavior.',
    '// 12. Verify fonts, textures, scene timing, and control-layer behavior in Viz before handoff to control-room workflows.',
    '',
    '// Generated scene outline',
    'const banner = {',
    ...dataLines,
    '};',
    '',
    '// Scene scaffolding',
    'CreateVizScene("Banner");',
    'CreateContainer("Root");',
    '',
    ...sceneLines,
    ...(effectNotes.length > 0 ? ['', '// Viz-native effect recreation', ...effectNotes] : []),
    '',
    '// Recommended Vizrt-native build notes',
    '// - Use containers and shape geometry for panel structure and masks.',
    '// - Use text objects and script/container logic for editable copy and relative flow.',
    '// - Use image materials or texture slots for logos and photography.',
    '// - Drive the banner object from Trio, DataPool, MOS, or your control layer of choice.',
    '// - Rebuild gradients, blur, glow, and inner-shadow looks with Viz Artist materials/effects.',
  ].join('\n');
}

export function buildVizrtDataPayload(manifest: DynamicBindingsManifest | null, values: OperatorValues) {
  if (!manifest) {
    return '{\n  "scene": "Banner",\n  "banner": {}\n}';
  }

  const banner = Object.fromEntries(manifest.items.map((item) => [item.fieldKey, values[item.fieldKey] ?? '']));
  return JSON.stringify({ scene: 'Banner', banner }, null, 2);
}

export function buildXpressionTemplate(manifest: DynamicBindingsManifest | null, values: OperatorValues, svg?: string | null) {
  if (!manifest) {
    return 'No XPression SVG import guide yet.';
  }

  const dataLines = manifest.items.map((item) => `  ${item.fieldKey}: ${JSON.stringify(values[item.fieldKey] ?? '')},`);
  const scriptLines = manifest.items.flatMap((item) => {
    const lines = [templateLine(item, values[item.fieldKey] ?? '')];
    const flowLine = flowTemplateLine(item, manifest);
    if (flowLine) {
      lines.push(flowLine);
    }
    return lines;
  });
  const effectLines = blurTemplateLines(svg || null);
  const innerShadowLines = innerShadowTemplateLines(svg || null);

  return [
    '// XPression SVG import guide',
    '// Step-by-step import notes plus a generated binding template outline for the SVG workflow.',
    '',
    '// Setup',
    '// 1. Import graphic.svg into XPression, or use Illustrator/EPS conversion first if your XPression version needs that step.',
    '// 2. Review xpression-bindings.json and xpression-data.json to confirm the live fields and sample values you want to map.',
    '',
    '// Binding order',
    '// 3. Bind the imported SVG elements to your scene fields using the generated template lines below as a mapping guide.',
    '// 4. Apply any relative text flow notes after the base mappings exist so labels and values stay attached when data changes.',
    '',
    '// Effects and validation',
    '// 5. Recreate or verify blur and inner-shadow behavior in XPression if your SVG import path does not preserve those filters faithfully.',
    '// 6. Verify fonts, raster assets, and final alignment against the Figma reference before delivery.',
    '',
    '// Generated binding template outline',
    'const banner = {',
    ...dataLines,
    '};',
    '',
    ...innerShadowLines,
    ...(innerShadowLines.length > 0 ? [''] : []),
    ...effectLines,
    ...(effectLines.length > 0 ? [''] : []),
    ...scriptLines,
  ].join('\n');
}