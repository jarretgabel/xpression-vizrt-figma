function fallback(value, defaultValue) {
  return value === undefined || value === null ? defaultValue : value;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rgbaToHex(color) {
  const red = Math.round(fallback(color.r, 0) * 255);
  const green = Math.round(fallback(color.g, 0) * 255);
  const blue = Math.round(fallback(color.b, 0) * 255);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function alphaForColor(color, opacity) {
  return Math.max(0, Math.min(1, fallback(color.a, 1) * fallback(opacity, 1)));
}

function valueOrUndefined(value) {
  return value === undefined || value === null ? undefined : value;
}

function boxFor(node) {
  return node.absoluteBoundingBox || node.absoluteRenderBounds;
}

function unionBoxes(boxes) {
  if (!boxes || boxes.length === 0) {
    return undefined;
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function descendantBoxFor(node) {
  const ownBox = boxFor(node);
  if (ownBox) {
    return ownBox;
  }

  const childBoxes = (node.children || [])
    .filter((child) => child && child.visible !== false)
    .map((child) => descendantBoxFor(child))
    .filter(Boolean);

  return unionBoxes(childBoxes);
}

function visualBoxFor(node) {
  if (!node) {
    return undefined;
  }

  const ownBox = boxFor(node);
  const childBoxes = (node.children || [])
    .filter((child) => child && child.visible !== false)
    .map((child) => visualBoxFor(child))
    .filter(Boolean);

  return unionBoxes([ownBox, ...childBoxes].filter(Boolean));
}

function descendantImageRefsFor(node) {
  const refs = new Set();

  if (!node) {
    return refs;
  }

  const directRef = (node.fills || []).find((fill) => fill.type === 'IMAGE' && fill.imageRef)?.imageRef;
  if (directRef) {
    refs.add(directRef);
  }

  (node.children || []).forEach((child) => {
    descendantImageRefsFor(child).forEach((ref) => refs.add(ref));
  });

  return refs;
}

function boxesOverlap(first, second) {
  if (!first || !second) {
    return false;
  }

  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function containsMaskedNode(node) {
  if (!node) {
    return false;
  }

  if (/mask/i.test(node.name || '')) {
    return true;
  }

  return (node.children || []).some((child) => containsMaskedNode(child));
}

function sizeFor(node, box) {
  if (node && node.size && typeof node.size.x === 'number' && typeof node.size.y === 'number') {
    return {
      width: node.size.x,
      height: node.size.y,
    };
  }

  return {
    width: box ? box.width : 0,
    height: box ? box.height : 0,
  };
}

function absoluteOriginFor(node, box) {
  const size = sizeFor(node, box);
  return {
    x: box.x + (box.width - size.width) / 2,
    y: box.y + (box.height - size.height) / 2,
    width: size.width,
    height: size.height,
  };
}

function localOriginBoxFor(node, box) {
  const size = sizeFor(node, box);
  return {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
  };
}

function rotationTransform(node, box) {
  if (!node || !box || !node.rotation || Math.abs(node.rotation) <= 0.01) {
    return undefined;
  }

  const origin = absoluteOriginFor(node, box);
  const cx = origin.x + origin.width / 2;
  const cy = origin.y + origin.height / 2;
  return `rotate(${node.rotation} ${cx} ${cy})`;
}

function vectorTransform(node, box) {
  if (!box) {
    return undefined;
  }

  const origin = absoluteOriginFor(node, box);
  const transforms = [`translate(${origin.x} ${origin.y})`];
  if (node.rotation && Math.abs(node.rotation) > 0.01) {
    transforms.push(`rotate(${node.rotation} ${origin.width / 2} ${origin.height / 2})`);
  }
  return transforms.join(' ');
}

function textHorizontalScaleForStyle(style) {
  const postScriptName = String(style && style.fontPostScriptName || '');
  const fontStyle = String(style && style.fontStyle || '');
  if (/^BentonSans-CmBold$/i.test(postScriptName) || /^Cm Bold$/i.test(fontStyle)) {
    return 0.793;
  }
  return 1;
}

function textTransformForStyle(style, x) {
  const scaleX = textHorizontalScaleForStyle(style);
  if (Math.abs(scaleX - 1) <= 0.001) {
    return undefined;
  }
  return `translate(${x} 0) scale(${scaleX} 1) translate(${-x} 0)`;
}

function textLetterSpacingAdjustmentForStyle(style) {
  return 0;
}

function pathDataFor(segment) {
  return segment && (segment.path || segment.data);
}

function renderAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${xmlEscape(value)}"`)
    .join(' ');
}

function slugify(value, fallbackValue) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallbackValue;
}

function bindingSlug(value, fallbackValue) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallbackValue;
}

function toDataUri(asset) {
  if (!asset) {
    return undefined;
  }

  if (asset.dataUri) {
    return asset.dataUri;
  }

  if (asset.base64 && asset.mimeType) {
    return `data:${asset.mimeType};base64,${asset.base64}`;
  }

  return undefined;
}

export function preferredFontFamilyForStyle(style) {
  const postScriptName = String(style.fontPostScriptName || '');
  const fontStyle = String(style.fontStyle || '').toLowerCase();
  const baseFamily = style.fontFamily || 'Arial';
  const numericFontWeight = Number(style.fontWeight || 0);
  const normalizedPostScriptName = postScriptName.toLowerCase();
  const normalizedBaseFamily = String(baseFamily).toLowerCase();
  const isBlackWeight = numericFontWeight >= 800;
  const isBoldWeight = numericFontWeight >= 700;
  const isMediumWeight = numericFontWeight >= 500 && numericFontWeight < 700;
  const bentonVariant = `${normalizedPostScriptName} ${fontStyle} ${normalizedBaseFamily}`;
  const isCondensed = /(condensed|compressed|\bcond\b|\bcomp\b|\bcm\b|cmbold|cmbold|cmmd|cmmedium|condbk|condmd|condbold|condmedium)/i.test(bentonVariant);

  if (/^BentonSans-/i.test(postScriptName) || /benton\s*sans|bentonsans/i.test(baseFamily)) {
    if (isCondensed) {
      if (/(black|bold|cmbold|condbold)/i.test(postScriptName) || /(black|bold)/i.test(fontStyle) || isBlackWeight || isBoldWeight) {
        return 'BentonSansCondBold';
      }
      if (/(medium|cmmd|cmmedium|condmd|condmedium)/i.test(postScriptName) || /(medium)/i.test(fontStyle) || isMediumWeight) {
        return 'BentonSansCondMedium';
      }
      if (/(book|condbk)/i.test(postScriptName) || /(book)/i.test(fontStyle)) {
        return 'BentonSansCondBook';
      }
      return 'BentonSansCond';
    }

    if (/(black)/i.test(postScriptName) || /(black)/i.test(fontStyle) || isBlackWeight) {
      return 'BentonSansBlack';
    }
    if (/(bold)/i.test(postScriptName) || /(bold)/i.test(fontStyle) || isBoldWeight) {
      return 'BentonSansBold';
    }
    if (/(medium)/i.test(postScriptName) || /(medium)/i.test(fontStyle) || isMediumWeight) {
      return 'BentonSansMedium';
    }
    if (/(book)/i.test(postScriptName) || /(book)/i.test(fontStyle)) {
      return 'BentonSansBook';
    }
    if (/(light)/i.test(postScriptName) || /(light)/i.test(fontStyle)) {
      return 'BentonSansLight';
    }
    if (/(thin)/i.test(postScriptName) || /(thin)/i.test(fontStyle)) {
      return 'BentonSansThin';
    }

    if (normalizedBaseFamily.includes('black')) {
      return 'BentonSansBlack';
    }
    if (normalizedBaseFamily.includes('book')) {
      return 'BentonSansBook';
    }
    if (normalizedBaseFamily.includes('light')) {
      return 'BentonSansLight';
    }
    if (normalizedBaseFamily.includes('thin')) {
      return 'BentonSansThin';
    }
    if (normalizedPostScriptName.includes('medium') || normalizedBaseFamily.includes('medium')) {
      return 'BentonSansMedium';
    }
    return 'BentonSans';
  }

  if (/ESPNIgniteDisplaySans/i.test(postScriptName) || /ESPN Ignite Display Sans/i.test(baseFamily)) {
    return 'ESPN Ignite Display Web';
  }

  if (/ESPNIgniteText/i.test(postScriptName) || /ESPN Ignite Text/i.test(baseFamily)) {
    return 'ESPN Ignite Text Web';
  }

  return baseFamily;
}

function supportedEffectsFor(node) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && (effect.type === 'LAYER_BLUR' || effect.type === 'INNER_SHADOW' || effect.type === 'DROP_SHADOW'));
}

function layerBlurEffectsFor(node) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && effect.type === 'LAYER_BLUR');
}

function dropShadowEffectsFor(node) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && effect.type === 'DROP_SHADOW');
}

function unsupportedEffectsFor(node) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && effect.type !== 'LAYER_BLUR' && effect.type !== 'INNER_SHADOW' && effect.type !== 'DROP_SHADOW');
}

function blurStdDeviationFor(effect) {
  const radius = Math.max(0, fallback(effect && effect.radius, 0));
  return Math.round((radius / 2) * 100) / 100;
}

function innerShadowEffectsFor(node) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && effect.type === 'INNER_SHADOW');
}

function colorStringForEffect(color) {
  return rgbaToHex(color || {});
}

function opacityForEffect(color) {
  return alphaForColor(color || {}, 1);
}

function walkNodes(node, visit) {
  if (!node) {
    return;
  }

  visit(node);
  for (const child of node.children || []) {
    walkNodes(child, visit);
  }
}

function isBentonFamilyName(value) {
  return /^BentonSans(?:Cond)?(?:Bold|Medium|Book|Light|Thin|Black)?$/i.test(String(value || ''));
}

function collectTextRowAlignmentCenters(root) {
  const candidates = [];

  walkNodes(root, (node) => {
    if (!node || node.type !== 'TEXT' || node.visible === false) {
      return;
    }

    const box = boxFor(node);
    const style = node.style || {};
    const fontSize = Number(style.fontSize || 16);
    const lineHeight = Number(style.lineHeightPx || fontSize);
    const preferredFamily = preferredFontFamilyForStyle(style);
    const lineCount = String(node.characters || '').split('\n').length;
    const isSingleLine = lineCount <= 1;
    const isTightBox = box && box.height <= lineHeight * 1.18;
    const isSmallLabel = fontSize <= 36;
    const isLeftAligned = !style.textAlignHorizontal || style.textAlignHorizontal === 'LEFT';

    if (!box || !isSingleLine || !isTightBox || !isSmallLabel || !isLeftAligned || !isBentonFamilyName(preferredFamily)) {
      return;
    }

    candidates.push({
      node,
      box,
      fontSize,
      centerY: box.y + box.height / 2,
    });
  });

  candidates.sort((left, right) => {
    if (left.centerY !== right.centerY) {
      return left.centerY - right.centerY;
    }

    return left.box.x - right.box.x;
  });

  const rows = [];
  for (const candidate of candidates) {
    const matchingRow = rows.find((row) => {
      const overlap = Math.max(0, Math.min(row.bottom, candidate.box.y + candidate.box.height) - Math.max(row.top, candidate.box.y));
      const minimumOverlap = Math.max(4, Math.min(row.averageHeight, candidate.box.height) * 0.45);
      return overlap >= minimumOverlap && Math.abs(row.averageFontSize - candidate.fontSize) <= 2;
    });

    if (!matchingRow) {
      rows.push({
        items: [candidate],
        top: candidate.box.y,
        bottom: candidate.box.y + candidate.box.height,
        averageHeight: candidate.box.height,
        averageFontSize: candidate.fontSize,
      });
      continue;
    }

    matchingRow.items.push(candidate);
    matchingRow.top = Math.min(matchingRow.top, candidate.box.y);
    matchingRow.bottom = Math.max(matchingRow.bottom, candidate.box.y + candidate.box.height);
    matchingRow.averageHeight = matchingRow.items.reduce((sum, item) => sum + item.box.height, 0) / matchingRow.items.length;
    matchingRow.averageFontSize = matchingRow.items.reduce((sum, item) => sum + item.fontSize, 0) / matchingRow.items.length;
  }

  const centers = new WeakMap();
  for (const row of rows) {
    if (row.items.length < 2) {
      continue;
    }

    const sortedCenters = row.items.map((item) => item.centerY).sort((left, right) => left - right);
    const sortedBottoms = row.items.map((item) => item.box.y + item.box.height).sort((left, right) => left - right);
    const middle = Math.floor(sortedCenters.length / 2);
    const targetCenter = sortedCenters.length % 2 === 0
      ? (sortedCenters[middle - 1] + sortedCenters[middle]) / 2
      : sortedCenters[middle];
    const targetBottom = sortedBottoms.length % 2 === 0
      ? (sortedBottoms[middle - 1] + sortedBottoms[middle]) / 2
      : sortedBottoms[middle];
    const bottomSpread = sortedBottoms[sortedBottoms.length - 1] - sortedBottoms[0];

    for (const item of row.items) {
      centers.set(item.node, {
        targetCenter,
        targetBottom,
        prefersBottom: bottomSpread <= 2.5,
      });
    }
  }

  return centers;
}

export function convertFigmaJsonToSvg(source, options) {
  const config = options || {};
  const imageAssets = config.imageAssets || {};
  const firstNodeKey = Object.keys(source.nodes || {})[0];
  const root = source.nodes && source.nodes[firstNodeKey] ? source.nodes[firstNodeKey].document : undefined;

  if (!root) {
    throw new Error('Could not find a root Figma document node in the JSON export.');
  }

  const warnings = {
    missingImages: [],
    ignoredEffects: [],
    unsupportedNodes: [],
    unsupportedPaints: [],
    transformNodes: [],
    styledTextRuns: [],
    fonts: new Set(),
    embeddedImages: [],
  };

  let definitionCount = 0;
  let elementCount = 0;
  const bindingCounts = new Map();
  const definitions = [];
  const textRowAlignmentCenters = collectTextRowAlignmentCenters(root);

  function nextId(prefix) {
    definitionCount += 1;
    return `${prefix}-${definitionCount}`;
  }

  function elementIdentity(node, prefix) {
    elementCount += 1;
    const base = slugify(node && node.name ? node.name : prefix, prefix);
    return {
      id: `xp-${base}-${elementCount}`,
      'data-layer-name': node && node.name ? node.name : prefix,
      'data-figma-type': node && node.type ? node.type : prefix,
    };
  }

  function imageRefFor(node) {
    return (node.fills || []).find((fill) => fill.type === 'IMAGE' && fill.imageRef)?.imageRef;
  }

  function isSupportedGradientPaintType(type) {
    return type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL' || type === 'GRADIENT_DIAMOND';
  }

  function visibleSolidOrGradientFill(node) {
    return (node.fills || []).find((fill) => fill.visible !== false && (fill.type === 'SOLID' || isSupportedGradientPaintType(fill.type)));
  }

  function visibleSolidOrGradientFills(node) {
    return (node.fills || []).filter((fill) => fill.visible !== false && (fill.type === 'SOLID' || isSupportedGradientPaintType(fill.type)));
  }

  function paintableSolidOrGradientFills(node) {
    return visibleSolidOrGradientFills(node).slice().reverse();
  }

  function preferredVisibleFill(node) {
    return visibleSolidOrGradientFill(node) || (node.fills || []).find((fill) => fill.visible !== false);
  }

  function bindingTypeForNode(node) {
    if (!node) {
      return null;
    }
    if (node.type === 'TEXT') {
      return 'text';
    }
    if (imageRefFor(node)) {
      return 'image';
    }
    if (visibleSolidOrGradientFill(node)) {
      return 'color';
    }
    return null;
  }

  function bindingIdentity(node) {
    const bindingType = bindingTypeForNode(node);
    if (!bindingType) {
      return {};
    }

    const baseKey = bindingSlug(node && node.name ? node.name : `${bindingType}_field`, `${bindingType}_field`);
    const nextCount = (bindingCounts.get(baseKey) || 0) + 1;
    bindingCounts.set(baseKey, nextCount);
    const fieldKey = nextCount === 1 ? baseKey : `${baseKey}_${nextCount}`;
    return {
      id: `xp-${fieldKey}`,
      'data-binding-key': fieldKey,
      'data-binding-type': bindingType,
    };
  }

  function renderableChildrenFor(node) {
    return node.children || [];
  }

  function gradientIdFor(fill, box) {
    const id = nextId('gradient');
    const handles = fill.gradientHandlePositions || [];
    const start = handles[0] || { x: 0, y: 0.5 };
    const end = handles[1] || { x: 1, y: 0.5 };
    const axisX = box.width * (end.x - start.x);
    const axisY = box.height * (end.y - start.y);
    const fallbackCross = {
      x: start.x - (end.y - start.y),
      y: start.y + (end.x - start.x),
    };
    const cross = handles[2] || fallbackCross;
    const crossX = box.width * (cross.x - start.x);
    const crossY = box.height * (cross.y - start.y);
    const centerX = box.x + box.width * start.x;
    const centerY = box.y + box.height * start.y;
    const stops = (fill.gradientStops || []).map((stop) => {
      const stopColor = stop.color || {};
      return `<stop offset="${stop.position * 100}%" stop-color="${rgbaToHex(stopColor)}" stop-opacity="${alphaForColor(stopColor)}" />`;
    }).join('');

    const gradient = fill.type === 'GRADIENT_RADIAL' || fill.type === 'GRADIENT_DIAMOND'
      ? (() => {
        return `
    <radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${axisX} ${axisY} ${crossX} ${crossY} ${centerX} ${centerY})">
      ${stops}
    </radialGradient>`;
      })()
      : `
    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(${axisX} ${axisY} ${crossX} ${crossY} ${centerX} ${centerY})">
      ${stops}
    </linearGradient>`;
    definitions.push(gradient);
    return id;
  }

  function fillAttributes(fill, box) {
    if (!fill || fill.visible === false) {
      return { fill: 'none' };
    }

    if (fill.type === 'SOLID') {
      const fillOpacity = alphaForColor(fill.color || {}, fallback(fill.opacity, 1));
      return {
        fill: rgbaToHex(fill.color || {}),
        'fill-opacity': valueOrUndefined(fillOpacity === 1 ? undefined : fillOpacity),
      };
    }

    if (isSupportedGradientPaintType(fill.type) && box) {
      const gradientId = gradientIdFor(fill, box);
      return {
        fill: `url(#${gradientId})`,
        'fill-opacity': valueOrUndefined(fill.opacity === undefined || fill.opacity === 1 ? undefined : fill.opacity),
      };
    }

    warnings.unsupportedPaints.push({ type: fill.type, usage: 'fill' });

    return { fill: 'none' };
  }

  function strokeAttributes(node, box) {
    const stroke = (node.strokes || []).find((item) => item.visible !== false);
    if (!stroke) {
      return {};
    }

    const weight = fallback(node.strokeWeight, 1);
    if (stroke.type === 'SOLID') {
      const strokeOpacity = alphaForColor(stroke.color || {}, fallback(stroke.opacity, 1));
      return {
        stroke: rgbaToHex(stroke.color || {}),
        'stroke-opacity': valueOrUndefined(strokeOpacity === 1 ? undefined : strokeOpacity),
        'stroke-width': weight,
      };
    }

    if (isSupportedGradientPaintType(stroke.type) && box) {
      const gradientId = gradientIdFor(stroke, box);
      return {
        stroke: `url(#${gradientId})`,
        'stroke-width': weight,
      };
    }

    warnings.unsupportedPaints.push({ type: stroke.type, usage: 'stroke' });

    return { 'stroke-width': weight };
  }

  function clipIdFor(node, box) {
    const origin = absoluteOriginFor(node, box);
    const id = nextId('clip');
    definitions.push(`<clipPath id="${id}"><rect x="${origin.x}" y="${origin.y}" width="${origin.width}" height="${origin.height}" rx="0" ry="0"/></clipPath>`);
    return id;
  }

  function effectAttributes(node, box, options = {}) {
    if (!box) {
      return {};
    }

    const includeInnerShadow = options.includeInnerShadow !== false;
    const layerBlur = layerBlurEffectsFor(node)[0];
    const dropShadows = dropShadowEffectsFor(node);
    const innerShadows = includeInnerShadow ? innerShadowEffectsFor(node) : [];
    if (!layerBlur && dropShadows.length === 0 && innerShadows.length === 0) {
      return {};
    }

    const layerBlurStdDeviation = blurStdDeviationFor(layerBlur);
    const effectMargins = [0];
    if (layerBlur && layerBlurStdDeviation > 0) {
      effectMargins.push(Math.max(layerBlurStdDeviation * 4, 8));
    }
    dropShadows.forEach((effect) => {
      const stdDeviation = blurStdDeviationFor(effect);
      const dx = Math.abs(fallback(effect.offset && effect.offset.x, 0));
      const dy = Math.abs(fallback(effect.offset && effect.offset.y, 0));
      effectMargins.push(Math.max(dx, dy) + Math.max(stdDeviation * 4, 8));
    });
    innerShadows.forEach((effect) => {
      const stdDeviation = blurStdDeviationFor(effect);
      effectMargins.push(Math.max(stdDeviation * 2, 4));
    });
    const filterMargin = Math.max(...effectMargins);

    const id = nextId('effects');
    const primitives = [];
    let graphicResult = 'SourceGraphic';
    let alphaResult = 'SourceAlpha';

    if (layerBlur && layerBlurStdDeviation > 0) {
      const blurredGraphic = `layerBlurGraphic-${id}`;
      const blurredAlpha = `layerBlurAlpha-${id}`;
      primitives.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${layerBlurStdDeviation}" result="${blurredGraphic}" />`);
      primitives.push(`<feGaussianBlur in="SourceAlpha" stdDeviation="${layerBlurStdDeviation}" result="${blurredAlpha}" />`);
      graphicResult = blurredGraphic;
      alphaResult = blurredAlpha;
    }

    let shadowResult;
    dropShadows.forEach((effect, index) => {
      const dx = Math.round(fallback(effect.offset && effect.offset.x, 0) * 100) / 100;
      const dy = Math.round(fallback(effect.offset && effect.offset.y, 0) * 100) / 100;
      const stdDeviation = blurStdDeviationFor(effect);
      const color = colorStringForEffect(effect.color);
      const opacity = Math.round(opacityForEffect(effect.color) * 1000) / 1000;
      const offsetResult = `dropShadowOffset-${index}-${id}`;
      const blurResult = `dropShadowBlur-${index}-${id}`;
      const floodResult = `dropShadowFlood-${index}-${id}`;
      const paintResult = `dropShadowPaint-${index}-${id}`;
      const mergedResult = `dropShadowMerged-${index}-${id}`;
      primitives.push(`<feOffset in="${alphaResult}" dx="${dx}" dy="${dy}" result="${offsetResult}" />`);
      primitives.push(`<feGaussianBlur in="${offsetResult}" stdDeviation="${stdDeviation}" result="${blurResult}" />`);
      primitives.push(`<feFlood flood-color="${color}" flood-opacity="${opacity}" result="${floodResult}" />`);
      primitives.push(`<feComposite in="${floodResult}" in2="${blurResult}" operator="in" result="${paintResult}" />`);
      if (shadowResult) {
        primitives.push(`<feBlend mode="normal" in="${paintResult}" in2="${shadowResult}" result="${mergedResult}" />`);
      }
      shadowResult = shadowResult ? mergedResult : paintResult;
    });

    let composedGraphic = graphicResult;
    if (shadowResult) {
      const withShadowResult = `shadowedGraphic-${id}`;
      primitives.push(`<feBlend mode="normal" in="${graphicResult}" in2="${shadowResult}" result="${withShadowResult}" />`);
      composedGraphic = withShadowResult;
    }

    innerShadows.forEach((effect, index) => {
      const dx = Math.round(fallback(effect.offset && effect.offset.x, 0) * 100) / 100;
      const dy = Math.round(fallback(effect.offset && effect.offset.y, 0) * 100) / 100;
      const stdDeviation = blurStdDeviationFor(effect);
      const red = Math.round(fallback(effect.color && effect.color.r, 0) * 1000000) / 1000000;
      const green = Math.round(fallback(effect.color && effect.color.g, 0) * 1000000) / 1000000;
      const blue = Math.round(fallback(effect.color && effect.color.b, 0) * 1000000) / 1000000;
      const opacity = opacityForEffect(effect.color);
      const hardAlpha = `hardAlpha-${index}-${id}`;
      const offsetResult = `innerShadowOffset-${index}-${id}`;
      const blurResult = `innerShadowBlur-${index}-${id}`;
      const compositeResult = `innerShadowComposite-${index}-${id}`;
      const colorResult = `innerShadowColor-${index}-${id}`;
      const resultName = `innerShadowResult-${index}-${id}`;
      primitives.push(`<feColorMatrix in="${alphaResult}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="${hardAlpha}" />`);
      primitives.push(`<feOffset in="${hardAlpha}" dx="${dx}" dy="${dy}" result="${offsetResult}" />`);
      primitives.push(`<feGaussianBlur in="${offsetResult}" stdDeviation="${stdDeviation}" result="${blurResult}" />`);
      primitives.push(`<feComposite in="${blurResult}" in2="${hardAlpha}" operator="arithmetic" k2="-1" k3="1" result="${compositeResult}" />`);
      primitives.push(`<feColorMatrix in="${compositeResult}" type="matrix" values="0 0 0 0 ${red} 0 0 0 0 ${green} 0 0 0 0 ${blue} 0 0 0 ${opacity} 0" result="${colorResult}" />`);
      primitives.push(`<feBlend mode="normal" in="${colorResult}" in2="${composedGraphic}" result="${resultName}" />`);
      composedGraphic = resultName;
    });

    definitions.push(`
    <filter id="${id}" filterUnits="userSpaceOnUse" x="${box.x - filterMargin}" y="${box.y - filterMargin}" width="${box.width + filterMargin * 2}" height="${box.height + filterMargin * 2}" color-interpolation-filters="sRGB">
      ${primitives.join('\n      ')}
    </filter>`);

    return {
      filter: `url(#${id})`,
      'data-effect-layer-blur': layerBlur && layerBlurStdDeviation > 0 ? String(fallback(layerBlur.radius, 0)) : undefined,
      'data-effect-drop-shadow': dropShadows.length > 0 ? dropShadows.map((effect) => {
        const dx = Math.round(fallback(effect.offset && effect.offset.x, 0) * 100) / 100;
        const dy = Math.round(fallback(effect.offset && effect.offset.y, 0) * 100) / 100;
        const radius = Math.round(fallback(effect.radius, 0) * 100) / 100;
        const color = colorStringForEffect(effect.color);
        const opacity = Math.round(opacityForEffect(effect.color) * 1000) / 1000;
        return `${dx},${dy},${radius},${color},${opacity}`;
      }).join(';') : undefined,
      'data-effect-inner-shadow': innerShadows.length > 0 ? innerShadows.map((effect) => {
        const dx = Math.round(fallback(effect.offset && effect.offset.x, 0) * 100) / 100;
        const dy = Math.round(fallback(effect.offset && effect.offset.y, 0) * 100) / 100;
        const radius = Math.round(fallback(effect.radius, 0) * 100) / 100;
        const color = colorStringForEffect(effect.color);
        const opacity = Math.round(opacityForEffect(effect.color) * 1000) / 1000;
        return `${dx},${dy},${radius},${color},${opacity}`;
      }).join(';') : undefined,
    };
  }

  function rectGeometry(node, box) {
    const origin = absoluteOriginFor(node, box);
    const radius = fallback(node.cornerRadius, 0);
    return {
      x: origin.x,
      y: origin.y,
      width: origin.width,
      height: origin.height,
      rx: radius || undefined,
      ry: radius || undefined,
    };
  }

  function windingRuleFor(geometry) {
    return geometry && geometry.windingRule === 'EVENODD' ? 'evenodd' : undefined;
  }

  function visibleStrokeFor(node) {
    return (node.strokes || []).find((item) => item.visible !== false);
  }

  function nonUniformCornerRadii(node) {
    const radii = Array.isArray(node.rectangleCornerRadii)
      ? node.rectangleCornerRadii.map((value) => Number(value || 0))
      : [];

    if (radii.length !== 4) {
      return false;
    }

    return radii.some((value, index) => Math.abs(value - radii[0]) > 0.001 && index > 0);
  }

  function shouldUseGeometryShape(node) {
    const strokeAlign = String(node && node.strokeAlign || '').toUpperCase();
    return nonUniformCornerRadii(node)
      || (strokeAlign === 'OUTSIDE' && Array.isArray(node.strokeGeometry) && node.strokeGeometry.length > 0);
  }

  function renderGeometryPathSegments(segments, attributes, identity, binding) {
    return segments
      .map((segment) => pathDataFor(segment))
      .filter(Boolean)
      .map((path, index) => `<path ${renderAttributes({
        ...(index === 0 ? identity : {}),
        ...(index === 0 ? binding : {}),
        d: path,
        ...attributes,
        'fill-rule': windingRuleFor(segments[index]),
      })} />`)
      .join('');
  }

  function renderGeometryShape(node, box, fill, parentOpacity, prefix, options = {}) {
    const fillSegments = Array.isArray(node.fillGeometry) ? node.fillGeometry : [];
    const strokeSegments = Array.isArray(node.strokeGeometry) ? node.strokeGeometry : [];
    const stroke = visibleStrokeFor(node);
    const paintBox = localOriginBoxFor(node, box);
    const fillPaints = paintableSolidOrGradientFills(node)
      .map((paint) => fillAttributes(paint, paintBox))
      .filter((paint) => paint.fill && paint.fill !== 'none');
    const fallbackFillPaint = fillAttributes(fill, paintBox);
    const strokePaint = stroke ? fillAttributes(stroke, paintBox) : { fill: 'none' };
    const activeFillPaints = fillPaints.length > 0 ? fillPaints : (fallbackFillPaint.fill && fallbackFillPaint.fill !== 'none' ? [fallbackFillPaint] : []);
    const hasFill = fillSegments.length > 0 && activeFillPaints.length > 0;
    const hasStroke = strokeSegments.length > 0 && strokePaint.fill && strokePaint.fill !== 'none';
    const includeInnerShadow = options.includeInnerShadow !== false;

    if (!hasFill && !hasStroke) {
      return '';
    }

    const binding = bindingIdentity(node);
    const groupAttributes = {
      ...elementIdentity(node, prefix),
      ...effectAttributes(node, box, { includeInnerShadow }),
      opacity: valueOrUndefined(fallback(node.opacity, 1) * parentOpacity === 1 ? undefined : fallback(node.opacity, 1) * parentOpacity),
      transform: vectorTransform(node, box),
    };

    const fillMarkup = hasFill
      ? activeFillPaints.map((paint, index) => renderGeometryPathSegments(fillSegments, paint, {}, index === 0 ? binding : {})).join('')
      : '';
    const strokeMarkup = hasStroke
      ? renderGeometryPathSegments(strokeSegments, strokePaint, {}, hasFill ? {} : binding)
      : '';

    return `<g ${renderAttributes(groupAttributes)}>${fillMarkup}${strokeMarkup}</g>`;
  }

  function renderImage(node, box, parentOpacity) {
    const imageFill = (node.fills || []).find((fill) => fill.type === 'IMAGE');
    const imageRef = imageFill && imageFill.imageRef ? imageFill.imageRef : 'missing-image-ref';
    const asset = imageAssets[imageRef];
    const dataUri = toDataUri(asset);

    if (!dataUri) {
      warnings.missingImages.push({ name: node.name, imageRef, x: box.x, y: box.y, width: box.width, height: box.height });
      const label = `${node.name} (${imageRef.slice(0, 8)})`;
      return `
    <g ${renderAttributes({ opacity: parentOpacity === 1 ? undefined : parentOpacity })}>
      <rect ${renderAttributes({ x: box.x, y: box.y, width: box.width, height: box.height, fill: '#f2f2f2', 'fill-opacity': 0.25, stroke: '#ffffff', 'stroke-opacity': 0.45, 'stroke-width': 1 })} />
      <line ${renderAttributes({ x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y + box.height, stroke: '#ffffff', 'stroke-opacity': 0.35, 'stroke-width': 1 })} />
      <line ${renderAttributes({ x1: box.x + box.width, y1: box.y, x2: box.x, y2: box.y + box.height, stroke: '#ffffff', 'stroke-opacity': 0.35, 'stroke-width': 1 })} />
      <text ${renderAttributes({ x: box.x + box.width / 2, y: box.y + box.height / 2, fill: '#ffffff', 'font-size': Math.max(10, Math.min(16, box.height / 7)), 'font-family': 'Arial, sans-serif', 'text-anchor': 'middle', 'dominant-baseline': 'middle', opacity: 0.8 })}>${xmlEscape(label)}</text>
    </g>`;
    }

    warnings.embeddedImages.push({ name: node.name, imageRef, source: asset.source || 'provided-asset' });

    return `<image ${renderAttributes({ ...elementIdentity(node, 'image'), ...bindingIdentity(node), ...effectAttributes(node, box, { includeInnerShadow: false }), x: box.x, y: box.y, width: box.width, height: box.height, href: dataUri, opacity: valueOrUndefined(parentOpacity === 1 ? undefined : parentOpacity), preserveAspectRatio: 'xMidYMid slice' })} />`;
  }

  function renderRectLike(node, parentOpacity) {
    const box = boxFor(node);
    if (!box) {
      return '';
    }

    const fill = preferredVisibleFill(node);
    if (fill && fill.type === 'IMAGE') {
      return renderImage(node, box, fallback(node.opacity, 1) * parentOpacity);
    }

    if (shouldUseGeometryShape(node)) {
      return renderGeometryShape(node, box, fill, parentOpacity, 'rect');
    }

    const layeredFills = paintableSolidOrGradientFills(node);
    if (layeredFills.length > 1) {
      const nodeOpacity = fallback(node.opacity, 1) * parentOpacity;
      const geometry = rectGeometry(node, box);
      const fillMarkup = layeredFills
        .map((paint, index) => `<rect ${renderAttributes({
          ...(index === 0 ? bindingIdentity(node) : {}),
          ...geometry,
          ...fillAttributes(paint, box),
        })} />`)
        .join('');
      const strokeMarkup = visibleStrokeFor(node)
        ? `<rect ${renderAttributes({ ...geometry, fill: 'none', ...strokeAttributes(node, box) })} />`
        : '';

      return `<g ${renderAttributes({
        ...elementIdentity(node, 'rect'),
        ...effectAttributes(node, box),
        opacity: valueOrUndefined(nodeOpacity === 1 ? undefined : nodeOpacity),
        transform: rotationTransform(node, box),
      })}>${fillMarkup}${strokeMarkup}</g>`;
    }

    const nodeOpacity = fallback(node.opacity, 1) * parentOpacity;
    const attributes = {
      ...elementIdentity(node, 'rect'),
      ...bindingIdentity(node),
      ...effectAttributes(node, box),
      ...rectGeometry(node, box),
      ...fillAttributes(fill, box),
      ...strokeAttributes(node, box),
      opacity: valueOrUndefined(nodeOpacity === 1 ? undefined : nodeOpacity),
      transform: rotationTransform(node, box),
    };
    return `<rect ${renderAttributes(attributes)} />`;
  }

  function renderEllipse(node, parentOpacity) {
    const box = boxFor(node);
    if (!box) {
      return '';
    }

    const origin = absoluteOriginFor(node, box);
    const fill = preferredVisibleFill(node);
    const layeredFills = paintableSolidOrGradientFills(node);
    if (layeredFills.length > 1) {
      const ellipseGeometry = {
        cx: origin.x + origin.width / 2,
        cy: origin.y + origin.height / 2,
        rx: origin.width / 2,
        ry: origin.height / 2,
      };
      const opacity = fallback(node.opacity, 1) * parentOpacity;
      const fillMarkup = layeredFills
        .map((paint, index) => `<ellipse ${renderAttributes({
          ...(index === 0 ? bindingIdentity(node) : {}),
          ...ellipseGeometry,
          ...fillAttributes(paint, box),
        })} />`)
        .join('');
      const stroke = visibleStrokeFor(node);
      const strokeMarkup = stroke
        ? `<ellipse ${renderAttributes({ ...ellipseGeometry, fill: 'none', ...strokeAttributes(node, box) })} />`
        : '';

      return `<g ${renderAttributes({
        ...elementIdentity(node, 'ellipse'),
        ...effectAttributes(node, box),
        opacity: valueOrUndefined(opacity === 1 ? undefined : opacity),
        transform: rotationTransform(node, box),
      })}>${fillMarkup}${strokeMarkup}</g>`;
    }

    const attributes = {
      ...elementIdentity(node, 'ellipse'),
      ...bindingIdentity(node),
      ...effectAttributes(node, box),
      cx: origin.x + origin.width / 2,
      cy: origin.y + origin.height / 2,
      rx: origin.width / 2,
      ry: origin.height / 2,
      ...fillAttributes(fill, box),
      ...strokeAttributes(node, box),
      opacity: valueOrUndefined(fallback(node.opacity, 1) * parentOpacity === 1 ? undefined : fallback(node.opacity, 1) * parentOpacity),
      transform: rotationTransform(node, box),
    };
    return `<ellipse ${renderAttributes(attributes)} />`;
  }

  function renderLine(node, parentOpacity) {
    const box = boxFor(node);
    if (!box) {
      return '';
    }

    const origin = absoluteOriginFor(node, box);
    return `<line ${renderAttributes({
      ...elementIdentity(node, 'line'),
      ...bindingIdentity(node),
      ...effectAttributes(node, box, { includeInnerShadow: false }),
      x1: origin.x,
      y1: origin.y + origin.height / 2,
      x2: origin.x + origin.width,
      y2: origin.y + origin.height / 2,
      ...strokeAttributes(node, box),
      opacity: valueOrUndefined(fallback(node.opacity, 1) * parentOpacity === 1 ? undefined : fallback(node.opacity, 1) * parentOpacity),
      transform: rotationTransform(node, box),
    })} />`;
  }

  function renderVector(node, parentOpacity) {
    const box = boxFor(node);
    if (!box) {
      return '';
    }

    const fillSegments = node.fillGeometry || node.vectorPaths || [];
    const strokeSegments = node.strokeGeometry || [];
    const fill = preferredVisibleFill(node);
    const paintBox = localOriginBoxFor(node, box);
    const fillPaints = paintableSolidOrGradientFills(node)
      .map((paint) => fillAttributes(paint, paintBox))
      .filter((paint) => paint.fill && paint.fill !== 'none');
    const fallbackFillPaint = fillAttributes(fill, paintBox);
    const activeFillPaints = fillPaints.length > 0 ? fillPaints : (fallbackFillPaint.fill && fallbackFillPaint.fill !== 'none' ? [fallbackFillPaint] : []);
    const strokePaint = strokeAttributes(node, paintBox);
    const opacity = fallback(node.opacity, 1) * parentOpacity;
    const transform = vectorTransform(node, box);

    const fillPaths = activeFillPaints
      .map((paint) => fillSegments
        .map((segment) => pathDataFor(segment))
        .filter(Boolean)
        .map((pathData) => `<path ${renderAttributes({ d: pathData, ...paint, opacity: valueOrUndefined(opacity === 1 ? undefined : opacity) })} />`)
        .join(''))
      .join('');

    const strokePaths = strokeSegments
      .map((segment) => pathDataFor(segment))
      .filter(Boolean)
      .map((pathData) => `<path ${renderAttributes({ d: pathData, fill: 'none', ...strokePaint, opacity: valueOrUndefined(opacity === 1 ? undefined : opacity) })} />`)
      .join('');

    if (!fillPaths && !strokePaths) {
      warnings.unsupportedNodes.push({ name: node.name, type: node.type });
      return '';
    }

    return `<g ${renderAttributes({ ...elementIdentity(node, 'vector'), ...bindingIdentity(node), ...effectAttributes(node, box), transform })}>${fillPaths}${strokePaths}</g>`;
  }

  function textAnchorFor(style) {
    if (style.textAlignHorizontal === 'CENTER') {
      return 'middle';
    }
    if (style.textAlignHorizontal === 'RIGHT') {
      return 'end';
    }
    return 'start';
  }

  function textXFor(style, box) {
    if (style.textAlignHorizontal === 'CENTER') {
      return box.x + box.width / 2;
    }
    if (style.textAlignHorizontal === 'RIGHT') {
      return box.x + box.width;
    }
    return box.x;
  }

  function textStyleAttributes(style, paint) {
    const preferredFamily = preferredFontFamilyForStyle(style);
    const usesNamedBentonFamily = /^BentonSans(?:Cond)?(?:Book|Light|Thin|Medium|Bold|Black)?$/i.test(preferredFamily);
    const weight = usesNamedBentonFamily ? undefined : (style.fontWeight || undefined);
    const fontStyle = usesNamedBentonFamily ? undefined : (/italic/i.test(style.fontStyle || '') ? 'italic' : undefined);
    const letterSpacingValue = Number(style.letterSpacing || 0) + textLetterSpacingAdjustmentForStyle(style);
    const letterSpacing = letterSpacingValue || undefined;

    return {
      fill: paint.fill,
      'fill-opacity': paint['fill-opacity'],
      'font-family': `${preferredFamily}, Arial, sans-serif`,
      'font-size': style.fontSize || 16,
      'font-weight': weight,
      'font-style': fontStyle,
      'letter-spacing': valueOrUndefined(letterSpacing === 0 ? undefined : letterSpacing),
    };
  }

  function textBaselineOffset(style, node, box) {
    const fontSize = Number(style.fontSize || 16);
    const lineHeight = Number(style.lineHeightPx || fontSize);
    const leading = Math.max(0, lineHeight - fontSize);
    const preferredFamily = preferredFontFamilyForStyle(style);
    const measuredMetrics = config.textMetrics && config.textMetrics[preferredFamily];
    const characters = String(node && node.characters || '');
    const lineCount = characters.split('\n').length;
    const boxHeight = Number(box && box.height || lineHeight);
    const isSingleLine = lineCount <= 1;
    const isTightBox = boxHeight <= lineHeight * 1.18;
    const isSmallLabel = fontSize <= 32;
    const isCompactLabel = fontSize <= 36;
    const isBentonFamily = isBentonFamilyName(preferredFamily);
    const isNumericToken = /^\d+$/.test(characters.trim());
    const leadingTrim = String(style.leadingTrim || '').toUpperCase();
    let calibration = 0;

    if (/^BentonSansCondBold$/i.test(preferredFamily)) {
      calibration = -0.1;
    } else if (/^BentonSansCond(?:Medium|Book)?$/i.test(preferredFamily)) {
      calibration = -0.075;
    } else if (/^BentonSans(?:Bold|Medium|Book|Light|Thin|Black)?$/i.test(preferredFamily)) {
      calibration = -0.045;
    }

    if (isSingleLine && isTightBox && isSmallLabel) {
      if (/^BentonSansCondBold$/i.test(preferredFamily)) {
        calibration -= 0.035;
      } else if (/^BentonSansCond(?:Medium|Book)?$/i.test(preferredFamily)) {
        calibration -= 0.025;
      } else if (/^BentonSans(?:Bold|Medium|Book|Light|Thin|Black)?$/i.test(preferredFamily)) {
        calibration -= 0.02;
      }
    }

    if (isSingleLine && isNumericToken && isCompactLabel && /^ESPN Ignite Display Web$/i.test(preferredFamily)) {
      calibration -= 0.1;
    }

    if (isSingleLine && isTightBox && isBentonFamily) {
      if (leadingTrim === 'CAP_HEIGHT' && isCompactLabel) {
        let capHeightRatio = Number.isFinite(measuredMetrics && measuredMetrics.capHeightRatio)
          ? measuredMetrics.capHeightRatio
          : 0.74;
        if (/^BentonSans(?:Bold|Black)$/i.test(preferredFamily)) {
          capHeightRatio = Math.max(capHeightRatio, 0.72);
        }
        return fontSize * capHeightRatio;
      }

      const ascentRatio = Number.isFinite(measuredMetrics && measuredMetrics.ascentRatio)
        ? measuredMetrics.ascentRatio
        : 0.78;
      const descentRatio = Number.isFinite(measuredMetrics && measuredMetrics.descentRatio)
        ? measuredMetrics.descentRatio
        : 0.22;
      const ascent = fontSize * Math.max(0, ascentRatio + calibration);
      const descent = fontSize * Math.max(0, descentRatio);
      const rowAlignment = textRowAlignmentCenters.get(node);

      if (rowAlignment && isCompactLabel) {
        if (rowAlignment.prefersBottom && Number.isFinite(rowAlignment.targetBottom)) {
          return rowAlignment.targetBottom - box.y - descent;
        }

        if (Number.isFinite(rowAlignment.targetCenter)) {
          return (rowAlignment.targetCenter - box.y) + (ascent - descent) / 2;
        }
      }

      return (boxHeight + ascent - descent) / 2;
    }

    if (measuredMetrics && Number.isFinite(measuredMetrics.ascentRatio)) {
      return fontSize * Math.max(0, measuredMetrics.ascentRatio + calibration) + leading * 0.5;
    }

    // Figma text boxes behave closer to an alphabetic baseline with ascent
    // than SVG's text-before-edge alignment. Use a stable ascent heuristic and
    // split extra leading above/below the line to better match Figma badges.
    return fontSize * Math.max(0, 0.78 + calibration) + leading * 0.5;
  }

  function applyTextCase(text, textCase) {
    if (!textCase || text == null) {
      return text;
    }

    if (textCase === 'UPPER') {
      return String(text).toUpperCase();
    }

    if (textCase === 'LOWER') {
      return String(text).toLowerCase();
    }

    if (textCase === 'TITLE') {
      return String(text).replace(/\b(\p{L})(\p{L}*)/gu, (_, first, rest) => `${first.toUpperCase()}${rest.toLowerCase()}`);
    }

    return text;
  }

  function lineStartIndexes(characters) {
    const starts = [0];
    for (let index = 0; index < characters.length; index += 1) {
      if (characters[index] === '\n') {
        starts.push(index + 1);
      }
    }
    return starts;
  }

  function runGroupsForText(node, baseStyle) {
    const characters = String(node.characters || '');
    const lines = characters.split('\n');
    const overrides = node.characterStyleOverrides || [];
    const overrideTable = node.styleOverrideTable || {};
    const starts = lineStartIndexes(characters);

    return lines.map((line, lineIndex) => {
      const groups = [];
      let current = null;
      const lineStart = starts[lineIndex] || 0;

      for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
        const globalIndex = lineStart + charIndex;
        const overrideKey = String(overrides[globalIndex] || 0);
        const overrideStyle = overrideKey !== '0' ? (overrideTable[overrideKey] || {}) : {};
        const runStyle = { ...baseStyle, ...overrideStyle };
        const signature = JSON.stringify({
          fontFamily: runStyle.fontFamily,
          fontPostScriptName: runStyle.fontPostScriptName,
          fontStyle: runStyle.fontStyle,
          fontWeight: runStyle.fontWeight,
          fontSize: runStyle.fontSize,
          letterSpacing: runStyle.letterSpacing,
          textCase: runStyle.textCase,
        });

        if (!current || current.signature !== signature) {
          current = {
            signature,
            style: runStyle,
            text: '',
          };
          groups.push(current);
        }

        current.text += line[charIndex];
      }

      if (groups.length === 0) {
        groups.push({
          signature: 'empty',
          style: baseStyle,
          text: '',
        });
      }

      return groups;
    });
  }

  function renderText(node, parentOpacity) {
    const box = boxFor(node);
    const style = node.style || {};
    if (!box) {
      return '';
    }

    warnings.fonts.add(style.fontFamily || 'Unknown');
    if ((node.characterStyleOverrides || []).some((value) => value !== 0) || Object.keys(node.styleOverrideTable || {}).length > 0) {
      warnings.styledTextRuns.push({ name: node.name, type: node.type });
    }

    const fill = preferredVisibleFill(node);
    const paint = fillAttributes(fill, box);
    const lineHeight = style.lineHeightPx || style.fontSize || 16;
    const baselineOffset = textBaselineOffset(style, node, box);
    const x = textXFor(style, box);
    const y = box.y + baselineOffset;
    const anchor = textAnchorFor(style);
    const opacity = fallback(node.opacity, 1) * parentOpacity;
    const runGroups = runGroupsForText(node, style);
    const textAttributes = {
      ...elementIdentity(node, 'text'),
      ...bindingIdentity(node),
      ...effectAttributes(node, box, { includeInnerShadow: false }),
      x,
      y,
      ...textStyleAttributes(style, paint),
      'text-anchor': anchor,
      'dominant-baseline': 'alphabetic',
      'xml:space': 'preserve',
      opacity: valueOrUndefined(opacity === 1 ? undefined : opacity),
      transform: textTransformForStyle(style, x),
    };

    const spans = runGroups
      .map((groups, lineIndex) => groups
        .map((group, groupIndex) => `<tspan ${renderAttributes({
          ...(groupIndex === 0 ? { x, dy: lineIndex === 0 ? 0 : lineHeight } : {}),
          ...textStyleAttributes(group.style, paint),
        })}>${xmlEscape(applyTextCase(group.text, group.style.textCase || style.textCase))}</tspan>`)
        .join(''))
      .join('');

    return `<text ${renderAttributes(textAttributes)}>${spans}</text>`;
  }

  function renderVisibleFrame(node, parentOpacity) {
    const box = boxFor(node);
    if (!box) {
      return '';
    }

    const visibleFill = preferredVisibleFill(node);
    const layeredFills = paintableSolidOrGradientFills(node);
    if (!visibleFill) {
      return '';
    }

    if (shouldUseGeometryShape(node)) {
      return renderGeometryShape(node, box, visibleFill, parentOpacity, 'frame-fill', { includeInnerShadow: false });
    }

    if (layeredFills.length > 1) {
      const opacity = fallback(node.opacity, 1) * parentOpacity;
      const geometry = rectGeometry(node, box);
      const fillMarkup = layeredFills
        .map((paint, index) => `<rect ${renderAttributes({
          ...(index === 0 ? bindingIdentity(node) : {}),
          ...geometry,
          ...fillAttributes(paint, box),
        })} />`)
        .join('');
      const strokeMarkup = visibleStrokeFor(node)
        ? `<rect ${renderAttributes({ ...geometry, fill: 'none', ...strokeAttributes(node, box) })} />`
        : '';

      return `<g ${renderAttributes({
        ...elementIdentity(node, 'frame-fill'),
        ...effectAttributes(node, box, { includeInnerShadow: false }),
        opacity: valueOrUndefined(opacity === 1 ? undefined : opacity),
      })}>${fillMarkup}${strokeMarkup}</g>`;
    }

    const opacity = fallback(node.opacity, 1) * parentOpacity;
    return `<rect ${renderAttributes({ ...elementIdentity(node, 'frame-fill'), ...bindingIdentity(node), ...effectAttributes(node, box, { includeInnerShadow: false }), ...rectGeometry(node, box), ...fillAttributes(visibleFill, box), ...strokeAttributes(node, box), opacity: valueOrUndefined(opacity === 1 ? undefined : opacity) })} />`;
  }

  function renderNode(node, parentOpacity) {
    const effectiveOpacity = fallback(parentOpacity, 1);
    if (node.visible === false) {
      return '';
    }

    if (node.rotation && Math.abs(node.rotation) > 0.01) {
      warnings.transformNodes.push({ name: node.name, type: node.type, rotation: node.rotation });
    }

    if (Array.isArray(node.relativeTransform)) {
      const matrix = node.relativeTransform.flat();
      const hasNonIdentityTransform = matrix.some((value, index) => {
        const expected = index === 0 || index === 4 ? 1 : 0;
        return Math.abs(value - expected) > 0.0001;
      });
      if (hasNonIdentityTransform) {
        warnings.transformNodes.push({ name: node.name, type: node.type, rotation: node.rotation || 'matrix' });
      }
    }

    if ((node.effects || []).length > 0) {
      const unsupportedEffects = unsupportedEffectsFor(node);
      if (unsupportedEffects.length > 0) {
        warnings.ignoredEffects.push({ name: node.name, type: node.type, effects: unsupportedEffects.map((effect) => effect.type) });
      }
    }

    if (node.type === 'TEXT') {
      return renderText(node, effectiveOpacity);
    }

    if (node.type === 'RECTANGLE') {
      return renderRectLike(node, effectiveOpacity);
    }

    if (node.type === 'ELLIPSE') {
      return renderEllipse(node, effectiveOpacity);
    }

    if (node.type === 'LINE') {
      return renderLine(node, effectiveOpacity);
    }

    if (node.type === 'VECTOR' || node.type === 'STAR' || node.type === 'POLYGON' || node.type === 'BOOLEAN_OPERATION') {
      return renderVector(node, effectiveOpacity);
    }

    if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'INSTANCE' || node.type === 'CANVAS') {
      const box = boxFor(node);
      const ownOpacity = fallback(node.opacity, 1) * effectiveOpacity;
      const visibleFill = preferredVisibleFill(node);
      const shouldAttachFrameInnerShadowToGroup = node.type === 'FRAME' && box && visibleFill;
      const open = [];
      const close = [];
      const groupAttributes = {
        ...elementIdentity(node, 'group'),
        ...effectAttributes(node, visualBoxFor(node) || box, { includeInnerShadow: shouldAttachFrameInnerShadowToGroup }),
      };

      if (node.clipsContent && box) {
        const clipId = clipIdFor(node, box);
        open.push(`<g ${renderAttributes(groupAttributes)}>`);
        open.push(`<g ${renderAttributes({ 'clip-path': `url(#${clipId})` })}>`);
        close.unshift('</g>');
        close.unshift('</g>');
      }

      const background = renderVisibleFrame(node, effectiveOpacity);
      const children = renderableChildrenFor(node).map((child) => renderNode(child, ownOpacity)).join('');
      if (open.length === 0) {
        return `<g ${renderAttributes(groupAttributes)}>${background}${children}</g>`;
      }
      return `${open.join('')}${background}${children}${close.join('')}`;
    }

    warnings.unsupportedNodes.push({ name: node.name, type: node.type });

    return '';
  }

  const rootBox = descendantBoxFor(root);
  if (!rootBox) {
    throw new Error('The root node does not include bounds.');
  }

  const content = renderNode(root, 1);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${rootBox.width}" height="${rootBox.height}" viewBox="${rootBox.x} ${rootBox.y} ${rootBox.width} ${rootBox.height}" role="img" aria-label="${xmlEscape(root.name)}">
  <title>${xmlEscape(root.name)}</title>
  <desc>Generated from a Figma JSON export for import into XPression-compatible workflows.</desc>
  <defs>${definitions.join('')}</defs>
  ${content}
</svg>
`;

  return {
    svg,
    report: [
      `Source: ${config.sourcePath || 'in-memory-input'}`,
      `Output: ${config.outputPath || 'in-memory-output'}`,
      '',
      'Fonts referenced:',
      ...Array.from(warnings.fonts).sort().map((font) => `- ${font}`),
      '',
      'Embedded images:',
      ...(warnings.embeddedImages.length > 0
        ? warnings.embeddedImages.map((image) => `- ${image.name} (${image.imageRef}) via ${image.source}`)
        : ['- None']),
      '',
      'Missing embedded images:',
      ...(warnings.missingImages.length > 0
        ? warnings.missingImages.map((image) => `- ${image.name} (${image.imageRef}) at ${image.x},${image.y} ${image.width}x${image.height}`)
        : ['- None']),
      '',
      'Ignored effects:',
      ...(warnings.ignoredEffects.length > 0
        ? warnings.ignoredEffects.map((effect) => `- ${effect.name} [${effect.type}] -> ${effect.effects.join(', ')}`)
        : ['- None']),
      '',
      'Unsupported node types skipped:',
      ...(warnings.unsupportedNodes.length > 0
        ? warnings.unsupportedNodes.map((node) => `- ${node.name} [${node.type}]`)
        : ['- None']),
      '',
      'Unsupported paints flattened or dropped:',
      ...(warnings.unsupportedPaints.length > 0
        ? warnings.unsupportedPaints.map((paint) => `- ${paint.usage}: ${paint.type}`)
        : ['- None']),
      '',
      'Transform risks:',
      ...(warnings.transformNodes.length > 0
        ? warnings.transformNodes.map((node) => `- ${node.name} [${node.type}] rotation=${node.rotation}`)
        : ['- None']),
      '',
      'Text style override risks:',
      ...(warnings.styledTextRuns.length > 0
        ? warnings.styledTextRuns.map((node) => `- ${node.name} [${node.type}] has multiple text styles and is exported as styled tspans; verify the import in XPression.`)
        : ['- None']),
      '',
      'Import note:',
      '- If XPression does not accept SVG directly in your version, open the SVG in Illustrator and save as AI or EPS before import.',
      '- Layer blur is translated into SVG Gaussian blur filters. Verify your XPression import path preserves SVG filters; if it does not, rasterize blur-backed elements intentionally before import.',
      '- For the most predictable import, flatten unsupported visual effects in Figma, outline or standardize fonts, and keep raster assets external until you can map each imageRef explicitly.',
    ].join('\n'),
    warnings: {
      missingImages: warnings.missingImages,
      ignoredEffects: warnings.ignoredEffects,
      unsupportedNodes: warnings.unsupportedNodes,
      unsupportedPaints: warnings.unsupportedPaints,
      transformNodes: warnings.transformNodes,
      styledTextRuns: warnings.styledTextRuns,
      embeddedImages: warnings.embeddedImages,
      fonts: Array.from(warnings.fonts).sort(),
    },
  };
}