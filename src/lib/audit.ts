import type { ConverterWarnings, FigmaNode, FigmaSource, FontAuditItem } from '../types';

type FontAccumulator = {
  family: string;
  postScriptNames: Set<string>;
  usageCount: number;
  mixedStyleLayers: number;
};

function walk(node: FigmaNode | undefined, visit: (node: FigmaNode) => void) {
  if (!node) {
    return;
  }

  visit(node);
  for (const child of node.children || []) {
    walk(child, visit);
  }
}

function firstRoot(source: FigmaSource) {
  const firstNodeKey = Object.keys(source.nodes || {})[0];
  return source.nodes?.[firstNodeKey]?.document;
}

function browserFontAvailable(fontFamily: string) {
  if (typeof document === 'undefined' || !('fonts' in document) || typeof document.fonts.check !== 'function') {
    return null;
  }

  try {
    return document.fonts.check(`12px "${fontFamily}"`);
  } catch {
    return null;
  }
}

export function auditFonts(source: FigmaSource, warnings: ConverterWarnings) {
  const fonts = new Map<string, FontAccumulator>();
  const mixedStyleNames = new Set(warnings.styledTextRuns.map((item) => item.name));

  walk(firstRoot(source), (node) => {
    if (node.type !== 'TEXT') {
      return;
    }

    const family = node.style?.fontFamily || 'Unknown';
    const accumulator = fonts.get(family) || {
      family,
      postScriptNames: new Set<string>(),
      usageCount: 0,
      mixedStyleLayers: 0,
    };

    accumulator.usageCount += 1;
    if (node.style?.fontPostScriptName) {
      accumulator.postScriptNames.add(node.style.fontPostScriptName);
    }
    if (node.name && mixedStyleNames.has(node.name)) {
      accumulator.mixedStyleLayers += 1;
    }

    fonts.set(family, accumulator);
  });

  return Array.from(fonts.values())
    .map<FontAuditItem>((font) => {
      const notes: string[] = [];
      const availableInBrowser = browserFontAvailable(font.family);

      if (font.family === 'Unknown') {
        notes.push('Font family was missing in the Figma payload.');
      }
      if (font.mixedStyleLayers > 0) {
        notes.push('Some text layers using this family contain mixed styles that may flatten poorly.');
      }
      if (availableInBrowser === false) {
        notes.push('This font does not appear to be available in the current browser environment.');
      }
      if (font.postScriptNames.size === 0) {
        notes.push('No PostScript name was provided for at least one use of this family.');
      }

      return {
        family: font.family,
        postScriptNames: Array.from(font.postScriptNames).sort(),
        usageCount: font.usageCount,
        mixedStyleLayers: font.mixedStyleLayers,
        availableInBrowser,
        risk: notes.length > 0 ? 'warn' : 'ok',
        notes,
      };
    })
    .sort((left, right) => {
      if (left.risk !== right.risk) {
        return left.risk === 'warn' ? -1 : 1;
      }
      return left.family.localeCompare(right.family);
    });
}