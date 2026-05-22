import type { DynamicBindingItem, DynamicBindingsManifest, FigmaNode, FigmaSource } from '../types';

const TEXT_PREFIXES = ['text', 'data', 'name', 'title', 'subtitle', 'stat', 'score', 'rank', 'record'];
const IMAGE_PREFIXES = ['logo', 'image', 'headshot', 'photo', 'icon', 'bug'];
const COLOR_PREFIXES = ['color', 'accent', 'bg', 'panel', 'stripe', 'bar', 'tint'];

type BindingCandidateType = 'text' | 'image' | 'color';

type BindingCandidate = {
  node: FigmaNode;
  bindingType: BindingCandidateType;
  textSample?: string;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function firstRoot(source: FigmaSource) {
  const firstNodeKey = Object.keys(source.nodes || {})[0];
  return source.nodes?.[firstNodeKey]?.document;
}

function walk(node: FigmaNode | undefined, visit: (node: FigmaNode) => void) {
  if (!node) {
    return;
  }

  visit(node);
  for (const child of node.children || []) {
    walk(child, visit);
  }
}

function slugify(value: string, fallbackValue: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallbackValue;
}

function imageRefFor(node: FigmaNode) {
  return (node.fills || []).find((fill) => fill.type === 'IMAGE' && fill.imageRef)?.imageRef;
}

function nodeBox(node: FigmaNode) {
  return node.absoluteBoundingBox || node.absoluteRenderBounds;
}

function isSupportedGradientPaintType(type?: string) {
  return type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL' || type === 'GRADIENT_DIAMOND';
}

function visibleSolidOrGradientPaint(node: FigmaNode) {
  return (node.fills || []).find((fill) => {
    if (fill.visible === false) {
      return false;
    }
    return fill.type === 'SOLID' || isSupportedGradientPaintType(fill.type);
  });
}

function rgbaToHex(color: { r?: number; g?: number; b?: number }, opacity?: number) {
  const red = Math.round((color.r ?? 0) * 255).toString(16).padStart(2, '0');
  const green = Math.round((color.g ?? 0) * 255).toString(16).padStart(2, '0');
  const blue = Math.round((color.b ?? 0) * 255).toString(16).padStart(2, '0');
  const alpha = opacity === undefined ? '' : Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `#${red}${green}${blue}${alpha}`;
}

function colorValueFor(node: FigmaNode) {
  const paint = visibleSolidOrGradientPaint(node);
  if (!paint) {
    return undefined;
  }

  if (paint.type === 'SOLID' && paint.color) {
    return rgbaToHex(paint.color, paint.opacity ?? paint.color.a);
  }

  if (isSupportedGradientPaintType(paint.type) && paint.gradientStops) {
    return paint.gradientStops
      .map((stop) => `${Math.round(stop.position * 100)}%:${rgbaToHex(stop.color || {}, stop.color?.a)}`)
      .join('|');
  }

  return undefined;
}

function isVisibleNode(node: FigmaNode) {
  return node.visible !== false && (node.opacity ?? 1) > 0;
}

function normalizedTextSample(node: FigmaNode) {
  return applyTextCase(String(node.characters || ''), node.style?.textCase).replace(/\s+/g, ' ').trim();
}

function alphaCharacters(value: string) {
  return (value.match(/[A-Za-z]/g) || []).length;
}

function numericCharacters(value: string) {
  return (value.match(/[0-9]/g) || []).length;
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function horizontalOverlapRatio(leftBox: NonNullable<BindingCandidate['box']>, rightBox: NonNullable<BindingCandidate['box']>) {
  const overlap = Math.max(0, Math.min(leftBox.x + leftBox.width, rightBox.x + rightBox.width) - Math.max(leftBox.x, rightBox.x));
  return overlap / Math.max(1, Math.min(leftBox.width, rightBox.width));
}

function verticalGap(leftBox: NonNullable<BindingCandidate['box']>, rightBox: NonNullable<BindingCandidate['box']>) {
  if (leftBox.y <= rightBox.y) {
    return Math.max(0, rightBox.y - (leftBox.y + leftBox.height));
  }
  return Math.max(0, leftBox.y - (rightBox.y + rightBox.height));
}

function centerDistance(leftBox: NonNullable<BindingCandidate['box']>, rightBox: NonNullable<BindingCandidate['box']>) {
  const leftCenterX = leftBox.x + leftBox.width / 2;
  const leftCenterY = leftBox.y + leftBox.height / 2;
  const rightCenterX = rightBox.x + rightBox.width / 2;
  const rightCenterY = rightBox.y + rightBox.height / 2;
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
}

function isLikelyClockText(value: string) {
  return /^\d{1,2}:\d{2}(?:\s?(?:AM|PM|ET|CT|MT|PT))?$/i.test(value);
}

function isLikelyNumericValue(value: string) {
  return /^#?\d{1,3}(?:[.-]\d+)?$/.test(value);
}

function isLikelyAbbreviation(value: string) {
  return /^[A-Z]{2,5}$/.test(value) || /^[A-Z]{1,4}\/[A-Z]{1,4}$/.test(value);
}

function isLikelyNameLikeText(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4 || value.length > 32) {
    return false;
  }

  return words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}

function isLikelyShortLabel(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!value || value.length > 24 || words.length > 4) {
    return false;
  }

  if (/[!?]/.test(value)) {
    return false;
  }

  return words.every((word) => /^[A-Za-z0-9#.'&/-]+$/.test(word));
}

function isSentenceLike(value: string) {
  return value.length > 40 || wordCount(value) > 6 || /[.!?]/.test(value);
}

function prominenceScore(candidate: BindingCandidate) {
  const box = candidate.box;
  const fontSize = candidate.node.style?.fontSize || 0;
  const area = box ? box.width * box.height : 0;
  const text = candidate.textSample || '';
  return fontSize * 8 + Math.sqrt(area) + alphaCharacters(text) * 2 - numericCharacters(text);
}

function tokenKind(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'other' as const;
  }
  if (/^[0-9#.-]+$/.test(trimmed)) {
    return 'value' as const;
  }
  if (/^[A-Z0-9#.-]+$/i.test(trimmed) && /[A-Z]/i.test(trimmed)) {
    return 'label' as const;
  }
  return 'other' as const;
}

function likelyFlowPair(previous: BindingCandidate, current: BindingCandidate) {
  if (!previous.box || !current.box) {
    return false;
  }

  const previousTop = previous.box.y;
  const previousBottom = previousTop + previous.box.height;
  const currentTop = current.box.y;
  const currentBottom = currentTop + current.box.height;
  const verticalOverlap = Math.max(0, Math.min(previousBottom, currentBottom) - Math.max(previousTop, currentTop));
  const minimumOverlap = Math.max(4, Math.min(previous.box.height, current.box.height) * 0.35);
  const horizontalGap = current.box.x - (previous.box.x + previous.box.width);
  const previousKind = tokenKind(previous.textSample || '');
  const currentKind = tokenKind(current.textSample || '');

  if (verticalOverlap < minimumOverlap || horizontalGap < 0 || horizontalGap > 120) {
    return false;
  }

  return (previousKind === 'label' && currentKind === 'value')
    || (previousKind === 'value' && currentKind === 'label')
    || (previousKind === 'label' && currentKind === 'label');
}

function likelyPrimaryTextCandidate(candidate: BindingCandidate) {
  const text = candidate.textSample || '';
  if (!candidate.box || !text || isSentenceLike(text)) {
    return false;
  }

  return alphaCharacters(text) > 0 && (isLikelyNameLikeText(text) || (isLikelyShortLabel(text) && !isLikelyAbbreviation(text) && !isLikelyClockText(text)));
}

function selectDynamicTextNodes(candidates: BindingCandidate[]) {
  const textCandidates = candidates
    .filter((candidate) => candidate.bindingType === 'text' && candidate.textSample && candidate.box)
    .sort((left, right) => {
      if ((left.box?.y || 0) !== (right.box?.y || 0)) {
        return (left.box?.y || 0) - (right.box?.y || 0);
      }
      return (left.box?.x || 0) - (right.box?.x || 0);
    });

  const selected = new Set<FigmaNode>();

  for (let index = 1; index < textCandidates.length; index += 1) {
    const previous = textCandidates[index - 1];
    const current = textCandidates[index];
    if (likelyFlowPair(previous, current)) {
      selected.add(previous.node);
      selected.add(current.node);
    }
  }

  const primary = textCandidates
    .filter((candidate) => likelyPrimaryTextCandidate(candidate))
    .sort((left, right) => prominenceScore(right) - prominenceScore(left))[0];

  if (primary?.box) {
    selected.add(primary.node);

    const relatedText = textCandidates
      .filter((candidate) => candidate.node !== primary.node && candidate.box)
      .filter((candidate) => {
        const candidateBox = candidate.box!;
        const overlap = horizontalOverlapRatio(primary.box!, candidateBox);
        const gap = verticalGap(primary.box!, candidateBox);
        const distance = centerDistance(primary.box!, candidateBox);
        return (overlap >= 0.15 && gap <= Math.max(80, primary.box!.height * 3.5))
          || distance <= Math.max(primary.box!.width * 1.4, 220);
      })
      .filter((candidate) => {
        const text = candidate.textSample || '';
        return !isSentenceLike(text)
          && (isLikelyClockText(text)
            || isLikelyNumericValue(text)
            || isLikelyAbbreviation(text)
            || isLikelyNameLikeText(text)
            || isLikelyShortLabel(text));
      })
      .sort((left, right) => centerDistance(primary.box!, left.box!) - centerDistance(primary.box!, right.box!))
      .slice(0, 8);

    for (const candidate of relatedText) {
      selected.add(candidate.node);
    }
  }

  for (const candidate of textCandidates) {
    const text = candidate.textSample || '';
    const prefix = prefixForName(candidate.node.name || '');
    if (expectedPrefixesFor('text').includes(prefix)
      || isLikelyClockText(text)
      || isLikelyNumericValue(text)
      || isLikelyAbbreviation(text)) {
      selected.add(candidate.node);
    }
  }

  return selected;
}

function isNeutralColor(color: { r?: number; g?: number; b?: number }) {
  const red = color.r ?? 0;
  const green = color.g ?? 0;
  const blue = color.b ?? 0;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const nearBlack = max <= 0.12;
  const nearWhite = min >= 0.9;
  const nearGray = delta <= 0.05;
  return nearBlack || nearWhite || nearGray;
}

function hasDynamicColorPaint(node: FigmaNode) {
  return (node.fills || []).some((fill) => {
    if (fill.visible === false) {
      return false;
    }

    if (fill.type === 'SOLID' && fill.color) {
      return !isNeutralColor(fill.color);
    }

    if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops?.length) {
      return fill.gradientStops.some((stop) => stop.color && !isNeutralColor(stop.color));
    }

    return false;
  });
}

function applyTextCase(text: string, textCase?: string) {
  if (!textCase) {
    return text;
  }

  if (textCase === 'UPPER') {
    return text.toUpperCase();
  }

  if (textCase === 'LOWER') {
    return text.toLowerCase();
  }

  if (textCase === 'TITLE') {
    return text.replace(/\b(\p{L})(\p{L}*)/gu, (_, first, rest) => `${String(first).toUpperCase()}${String(rest).toLowerCase()}`);
  }

  return text;
}

function expectedPrefixesFor(bindingType: 'text' | 'image' | 'color') {
  if (bindingType === 'text') {
    return TEXT_PREFIXES;
  }
  if (bindingType === 'image') {
    return IMAGE_PREFIXES;
  }
  return COLOR_PREFIXES;
}

function prefixForName(value: string) {
  const normalized = slugify(value, '');
  return normalized.includes('_') ? normalized.split('_')[0] : normalized;
}

function fieldRoleFor(name: string, bindingType: 'text' | 'image' | 'color') {
  const prefix = prefixForName(name);
  const allowed = expectedPrefixesFor(bindingType);
  return allowed.includes(prefix) ? prefix : bindingType;
}

function validateConvention(node: FigmaNode, bindingType: 'text' | 'image' | 'color') {
  const originalName = node.name || `${bindingType}_field`;
  const normalizedName = slugify(originalName, `${bindingType}_field`);
  const expectedPrefixes = expectedPrefixesFor(bindingType);
  const isValid = expectedPrefixes.some((prefix) => normalizedName.startsWith(`${prefix}_`));
  const notes: string[] = [];
  const suggestedName = `${expectedPrefixes[0]}_field`;

  if (!isValid) {
    notes.push(`Rename this layer to follow a live-data prefix such as ${suggestedName}.`);
  }
  if (bindingType === 'text' && !String(node.characters || '').trim()) {
    notes.push('Text binding candidate is empty; confirm this is intended for live content.');
  }
  if (bindingType === 'color' && !visibleSolidOrGradientPaint(node)) {
    notes.push('Color binding candidate does not have a visible solid or linear gradient fill.');
  }

  return {
    conventionStatus: isValid ? ('valid' as const) : ('warn' as const),
    suggestedName: isValid ? undefined : suggestedName,
    notes,
    fieldRole: fieldRoleFor(originalName, bindingType),
  };
}

function bindingTypeFor(node: FigmaNode): 'text' | 'image' | 'color' | null {
  if (!isVisibleNode(node)) {
    return null;
  }
  if (node.type === 'TEXT') {
    return 'text';
  }
  if (imageRefFor(node)) {
    return 'image';
  }
  if (visibleSolidOrGradientPaint(node)) {
    return 'color';
  }
  return null;
}

function addTextFlowRelationships(items: DynamicBindingItem[]) {
  const textItems = items
    .filter((item) => item.bindingType === 'text'
      && typeof item.x === 'number'
      && typeof item.y === 'number'
      && typeof item.width === 'number'
      && typeof item.height === 'number'
      && (!item.textAlignHorizontal || item.textAlignHorizontal === 'LEFT'))
    .sort((left, right) => {
      if ((left.y || 0) !== (right.y || 0)) {
        return (left.y || 0) - (right.y || 0);
      }
      return (left.x || 0) - (right.x || 0);
    });

  const tokenKind = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'other' as const;
    }
    if (/^[0-9#.-]+$/.test(trimmed)) {
      return 'value' as const;
    }
    if (/^[A-Z0-9#.-]+$/i.test(trimmed) && /[A-Z]/i.test(trimmed)) {
      return 'label' as const;
    }
    return 'other' as const;
  };

  for (let index = 1; index < textItems.length; index += 1) {
    const previous = textItems[index - 1];
    const current = textItems[index];
    const previousTop = previous.y || 0;
    const previousBottom = previousTop + (previous.height || 0);
    const currentTop = current.y || 0;
    const currentBottom = currentTop + (current.height || 0);
    const verticalOverlap = Math.max(0, Math.min(previousBottom, currentBottom) - Math.max(previousTop, currentTop));
    const minimumOverlap = Math.max(4, Math.min(previous.height || 0, current.height || 0) * 0.35);
    const horizontalGap = (current.x || 0) - ((previous.x || 0) + (previous.width || 0));
    const previousText = (previous.textSample || '').trim();
    const currentText = (current.textSample || '').trim();
    const previousKind = tokenKind(previousText);
    const currentKind = tokenKind(currentText);

    if (verticalOverlap < minimumOverlap || horizontalGap < 0 || horizontalGap > 120) {
      continue;
    }

    let nextGap: number | null = null;

    if (previousKind === 'label' && currentKind === 'value') {
      nextGap = Math.max(1, Math.min(horizontalGap, Math.min(previous.height || 0, current.height || 0) * 0.12));
    } else if (previousKind === 'value' && currentKind === 'label') {
      nextGap = horizontalGap;
    } else if (previousKind === 'label' && currentKind === 'label') {
      nextGap = horizontalGap;
    }

    if (nextGap == null) {
      continue;
    }

    current.flowAfterFieldKey = previous.fieldKey;
    current.flowGap = Math.round(nextGap * 100) / 100;
    current.flowKind = previousKind === 'label' && currentKind === 'value' ? 'attached' : 'separated';
    current.flowBottomOffset = Math.round((((current.y || 0) + (current.height || 0)) - ((previous.y || 0) + (previous.height || 0))) * 100) / 100;
  }
}

export function buildDynamicBindingsManifest(source: FigmaSource, sourceLabel: string): DynamicBindingsManifest {
  const root = firstRoot(source);
  const counts = new Map<string, number>();
  const suggestedCounts = new Map<string, number>();
  const items: DynamicBindingItem[] = [];
  const validationIssues: string[] = [];
  const candidates: BindingCandidate[] = [];

  walk(root, (node) => {
    const bindingType = bindingTypeFor(node);
    if (!bindingType) {
      return;
    }

    candidates.push({
      node,
      bindingType,
      textSample: bindingType === 'text' ? normalizedTextSample(node) : undefined,
      box: nodeBox(node),
    });
  });

  const selectedTextNodes = selectDynamicTextNodes(candidates);

  for (const candidate of candidates) {
    const { node, bindingType } = candidate;

    if (bindingType === 'text' && !selectedTextNodes.has(node)) {
      continue;
    }

    if (bindingType === 'color' && !hasDynamicColorPaint(node)) {
      continue;
    }

    const baseKey = slugify(node.name || `${bindingType}_field`, `${bindingType}_field`);
    const nextCount = (counts.get(baseKey) || 0) + 1;
    counts.set(baseKey, nextCount);
    const fieldKey = nextCount === 1 ? baseKey : `${baseKey}_${nextCount}`;
    const convention = validateConvention(node, bindingType);
    const suggestedPrefix = expectedPrefixesFor(bindingType)[0];
    const suggestedCount = (suggestedCounts.get(suggestedPrefix) || 0) + 1;
    suggestedCounts.set(suggestedPrefix, suggestedCount);
    const genericSuggestedName = convention.conventionStatus === 'warn'
      ? `${suggestedPrefix}_field${suggestedCount === 1 ? '' : `_${suggestedCount}`}`
      : undefined;

    const box = node.absoluteBoundingBox || node.absoluteRenderBounds;
    const item: DynamicBindingItem = {
      fieldKey,
      bindingType,
      fieldRole: convention.fieldRole,
      nodeName: node.name || fieldKey,
      svgId: `xp-${fieldKey}`,
      figmaType: node.type || 'UNKNOWN',
      conventionStatus: convention.conventionStatus,
      suggestedName: genericSuggestedName,
      notes: convention.notes,
      textSample: bindingType === 'text' ? applyTextCase(String(node.characters || ''), node.style?.textCase) : undefined,
      imageRef: bindingType === 'image' ? imageRefFor(node) : undefined,
      paintType: bindingType === 'color' ? visibleSolidOrGradientPaint(node)?.type : undefined,
      colorValue: bindingType === 'color' ? colorValueFor(node) : undefined,
      fontFamily: node.style?.fontFamily,
      fontPostScriptName: node.style?.fontPostScriptName,
      textCase: node.style?.textCase,
      textAlignHorizontal: node.style?.textAlignHorizontal,
      x: box?.x,
      y: box?.y,
      width: box?.width,
      height: box?.height,
    };

    if (item.conventionStatus === 'warn' && item.suggestedName) {
      validationIssues.push(`${item.nodeName} should be renamed to a live-data prefix, for example ${item.suggestedName}.`);
    }

    items.push(item);
  }

  addTextFlowRelationships(items);

  return {
    source: sourceLabel,
    generatedAt: new Date().toISOString(),
    validationIssues,
    items,
  };
}