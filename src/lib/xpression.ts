import type { ConverterWarnings, FigmaNode, FigmaSource, XpressionPrepItem } from '../types';

function walk(node: FigmaNode | undefined, visit: (node: FigmaNode) => void) {
  if (!node) {
    return;
  }

  visit(node);
  for (const child of node.children || []) {
    walk(child, visit);
  }
}

function unsupportedEffectsFor(node: FigmaNode) {
  return (node.effects || []).filter((effect) => effect && effect.visible !== false && effect.type !== 'LAYER_BLUR' && effect.type !== 'INNER_SHADOW');
}

function hasSupportedLayerBlur(node: FigmaNode) {
  return (node.effects || []).some((effect) => effect && effect.visible !== false && effect.type === 'LAYER_BLUR' && (effect.radius || 0) > 0);
}

function hasSupportedInnerShadow(node: FigmaNode) {
  return (node.effects || []).some((effect) => effect && effect.visible !== false && effect.type === 'INNER_SHADOW' && ((effect.radius || 0) > 0 || (effect.color?.a || 0) > 0));
}

export function summarizeRisks(warnings: ConverterWarnings) {
  const items: string[] = [];
  if (warnings.unsupportedNodes.length > 0) {
    items.push(`${warnings.unsupportedNodes.length} unsupported node type${warnings.unsupportedNodes.length === 1 ? '' : 's'}`);
  }
  if (warnings.unsupportedPaints.length > 0) {
    items.push(`${warnings.unsupportedPaints.length} unsupported paint${warnings.unsupportedPaints.length === 1 ? '' : 's'}`);
  }
  if (warnings.transformNodes.length > 0) {
    items.push(`${warnings.transformNodes.length} transformed layer${warnings.transformNodes.length === 1 ? '' : 's'}`);
  }
  if (warnings.styledTextRuns.length > 0) {
    items.push(`${warnings.styledTextRuns.length} mixed-style text layer${warnings.styledTextRuns.length === 1 ? '' : 's'}`);
  }
  if (warnings.ignoredEffects.length > 0) {
    items.push(`${warnings.ignoredEffects.length} ignored effect stack${warnings.ignoredEffects.length === 1 ? '' : 's'}`);
  }
  if (warnings.missingImages.length > 0) {
    items.push(`${warnings.missingImages.length} missing raster asset${warnings.missingImages.length === 1 ? '' : 's'}`);
  }
  return items;
}

export function summarizeVizrtRisks(warnings: ConverterWarnings) {
  const items: string[] = [];
  if (warnings.unsupportedNodes.length > 0) {
    items.push(`${warnings.unsupportedNodes.length} unsupported node type${warnings.unsupportedNodes.length === 1 ? '' : 's'} likely need manual Viz scene reconstruction`);
  }
  if (warnings.unsupportedPaints.length > 0) {
    items.push(`${warnings.unsupportedPaints.length} unsupported paint${warnings.unsupportedPaints.length === 1 ? '' : 's'} will need native Viz material rebuilds`);
  }
  if (warnings.transformNodes.length > 0) {
    items.push(`${warnings.transformNodes.length} transformed layer${warnings.transformNodes.length === 1 ? '' : 's'} may need container or pivot cleanup in Viz Artist`);
  }
  if (warnings.styledTextRuns.length > 0) {
    items.push(`${warnings.styledTextRuns.length} mixed-style text layer${warnings.styledTextRuns.length === 1 ? '' : 's'} should be split into separate Viz text objects`);
  }
  if (warnings.ignoredEffects.length > 0) {
    items.push(`${warnings.ignoredEffects.length} effect stack${warnings.ignoredEffects.length === 1 ? '' : 's'} will need manual Viz material or scene-effect recreation`);
  }
  if (warnings.missingImages.length > 0) {
    items.push(`${warnings.missingImages.length} raster asset${warnings.missingImages.length === 1 ? '' : 's'} still need explicit Viz texture mapping`);
  }
  return items;
}

export function buildPrepChecklist(source: FigmaSource, warnings: ConverterWarnings) {
  const firstNodeKey = Object.keys(source.nodes || {})[0];
  const root = source.nodes?.[firstNodeKey]?.document;
  const prep: XpressionPrepItem[] = [];
  let hasBooleanOrVector = false;
  let hasUnsupportedEffects = false;
  let hasLayerBlur = false;
  let hasInnerShadow = false;
  let hasImages = false;

  walk(root, (node) => {
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.booleanOperation) {
      hasBooleanOrVector = true;
    }
    if (unsupportedEffectsFor(node).length > 0) {
      hasUnsupportedEffects = true;
    }
    if (hasSupportedLayerBlur(node)) {
      hasLayerBlur = true;
    }
    if (hasSupportedInnerShadow(node)) {
      hasInnerShadow = true;
    }
    if ((node.fills || []).some((fill) => fill.type === 'IMAGE')) {
      hasImages = true;
    }
  });

  if (hasBooleanOrVector || warnings.unsupportedNodes.length > 0) {
    prep.push({
      title: 'Flatten vector math',
      detail: 'Turn boolean operations, stars, polygons, and complex vectors into stable paths when the visual result must match exactly in XPression.',
    });
  }

  if (warnings.transformNodes.length > 0) {
    prep.push({
      title: 'Reduce transforms',
      detail: 'Flatten rotated groups and transformed layers so the SVG importer does less geometric reinterpretation during import.',
    });
  }

  if (warnings.styledTextRuns.length > 0 || warnings.fonts.length > 0) {
    prep.push({
      title: 'Standardize typography',
      detail: 'Split mixed-style text into separate layers, ensure the exact fonts exist in the destination workflow, or outline critical branding text before export.',
    });
  }

  if (hasUnsupportedEffects || warnings.ignoredEffects.length > 0) {
    prep.push({
      title: 'Replace visual effects',
      detail: 'Unsupported shadow and inner-shadow effects should be rebuilt in XPression or rasterized intentionally before import.',
    });
  }

  if (hasLayerBlur) {
    prep.push({
      title: 'Verify blur import',
      detail: 'Layer blur is exported as an SVG Gaussian blur filter. Preview should match Figma more closely, but confirm your XPression import path preserves SVG filters.',
    });
  }

  if (hasInnerShadow) {
    prep.push({
      title: 'Verify inner shadows',
      detail: 'Inner shadows are exported as SVG filters on rect-like shapes. Confirm your XPression import path preserves those filters or recreate them in-scene if needed.',
    });
  }

  if (hasImages) {
    prep.push({
      title: 'Map raster assets explicitly',
      detail: 'Keep PNG or SVG logo assets outside the node JSON and map each imageRef deliberately so placeholders never reach import.',
    });
  }

  if (prep.length === 0) {
    prep.push({
      title: 'Keep the node tree simple',
      detail: 'You are already within the exporter\'s supported path. The main remaining check is making sure fonts and linked raster assets match the target system.',
    });
  }

  return prep;
}