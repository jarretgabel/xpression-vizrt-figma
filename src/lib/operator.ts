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

function measureTextWidth(element: Element) {
  try {
    const svgElement = element as unknown as SVGGraphicsElement;
    const box = svgElement.getBBox();
    if (box.width > 0) {
      return box.width;
    }
  } catch {
    // Fall back to the DOM box when SVG metrics are unavailable.
  }

  return element.getBoundingClientRect().width;
}

function measureTextHeight(element: Element) {
  try {
    const svgElement = element as unknown as SVGGraphicsElement;
    const box = svgElement.getBBox();
    if (box.height > 0) {
      return box.height;
    }
  } catch {
    // Fall back to the DOM box when SVG metrics are unavailable.
  }

  return element.getBoundingClientRect().height;
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
    const nextX = previousX + previousWidth + nextGap;
    setTextX(currentElement, nextX);

    const previousY = textElementY(previousElement, previousItem.y);
    const previousHeight = measureTextHeight(previousElement);
    const currentHeight = measureTextHeight(currentElement);
    const nextY = previousY + previousHeight - currentHeight + (item.flowBottomOffset ?? 0);
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

export function buildXpressionPrimitivePlan(manifest: DynamicBindingsManifest | null, values: OperatorValues, svg?: string | null) {
  if (!manifest) {
    return 'No native XPression primitives plan yet.';
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
    '// XPression native primitives/slabs plan',
    '// Alternative path: rebuild the scene natively in XPression with slabs, text objects, images, masks, and materials.',
    '// Keep using the SVG import template when you want to preserve the current SVG-based handoff.',
    '',
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

export function buildXpressionTemplate(manifest: DynamicBindingsManifest | null, values: OperatorValues, svg?: string | null) {
  if (!manifest) {
    return 'No XPression template yet.';
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
    '// XPression binding template preview',
    '// Use this as a handoff/mapping guide. Adjust to your XPression scene and Visual Logic runtime.',
    '',
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