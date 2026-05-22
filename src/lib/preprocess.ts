import type { FontSubstitutionMap, FigmaNode, FigmaSource, PreprocessSummary } from '../types';

function applyFontSubstitutionToStyle(style: FigmaNode['style'], substitutions: FontSubstitutionMap, summary: PreprocessSummary) {
  if (!style?.fontFamily) {
    return style;
  }

  const substitution = substitutions[style.fontFamily];
  if (!substitution) {
    return style;
  }

  summary.substitutedFonts += 1;
  return {
    ...style,
    fontFamily: substitution.family,
    fontPostScriptName: substitution.postScriptName || style.fontPostScriptName,
  };
}

function applyFontSubstitutionsToOverrideTable(
  overrideTable: FigmaNode['styleOverrideTable'],
  substitutions: FontSubstitutionMap,
  summary: PreprocessSummary,
) {
  if (!overrideTable) {
    return overrideTable;
  }

  return Object.entries(overrideTable).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    if (!value || typeof value !== 'object') {
      accumulator[key] = value;
      return accumulator;
    }

    const fontFamily = typeof (value as { fontFamily?: unknown }).fontFamily === 'string'
      ? (value as { fontFamily: string }).fontFamily
      : undefined;
    if (!fontFamily || !substitutions[fontFamily]) {
      accumulator[key] = value;
      return accumulator;
    }

    const substitution = substitutions[fontFamily];
    summary.substitutedFonts += 1;
    accumulator[key] = {
      ...value,
      fontFamily: substitution.family,
      fontPostScriptName: substitution.postScriptName || (value as { fontPostScriptName?: string }).fontPostScriptName,
    };
    return accumulator;
  }, {});
}

function cloneNode(node: FigmaNode, substitutions: FontSubstitutionMap, summary: PreprocessSummary): FigmaNode | null {
  if (node.visible === false) {
    summary.removedHiddenNodes += 1;
    return null;
  }

  summary.sourceNodeCount += 1;

  const nextNode: FigmaNode = {
    ...node,
  };

  if (typeof nextNode.name === 'string') {
    const trimmed = nextNode.name.trim();
    if (trimmed !== nextNode.name) {
      summary.trimmedNames += 1;
      nextNode.name = trimmed;
    }
  }

  if (typeof nextNode.rotation === 'number' && Math.abs(nextNode.rotation) < 0.01) {
    nextNode.rotation = 0;
    summary.normalizedRotations += 1;
  }

  nextNode.style = applyFontSubstitutionToStyle(nextNode.style, substitutions, summary);
  nextNode.styleOverrideTable = applyFontSubstitutionsToOverrideTable(nextNode.styleOverrideTable, substitutions, summary);

  if (Array.isArray(nextNode.children)) {
    nextNode.children = nextNode.children
      .map((child) => cloneNode(child, substitutions, summary))
      .filter((child): child is FigmaNode => Boolean(child));
  }

  summary.outputNodeCount += 1;
  return nextNode;
}

export function preprocessFigmaSource(source: FigmaSource, substitutions: FontSubstitutionMap = {}) {
  const summary: PreprocessSummary = {
    sourceNodeCount: 0,
    outputNodeCount: 0,
    removedHiddenNodes: 0,
    trimmedNames: 0,
    normalizedRotations: 0,
    substitutedFonts: 0,
  };

  const nodes = Object.entries(source.nodes || {}).reduce<FigmaSource['nodes']>((accumulator, [nodeId, entry]) => {
    const nextDocument = cloneNode(entry.document, substitutions, summary);
    if (!nextDocument) {
      return accumulator;
    }

    accumulator ||= {};
    accumulator[nodeId] = {
      ...entry,
      document: nextDocument,
    };
    return accumulator;
  }, source.nodes ? {} : undefined);

  return {
    source: {
      ...source,
      nodes,
    },
    summary,
  };
}

export function summarizePreprocess(summary: PreprocessSummary) {
  const items = [
    `Source nodes scanned: ${summary.sourceNodeCount}`,
    `Nodes passed to converter: ${summary.outputNodeCount}`,
  ];

  if (summary.removedHiddenNodes > 0) {
    items.push(`Hidden nodes removed before conversion: ${summary.removedHiddenNodes}`);
  }
  if (summary.trimmedNames > 0) {
    items.push(`Node names normalized: ${summary.trimmedNames}`);
  }
  if (summary.normalizedRotations > 0) {
    items.push(`Near-zero rotations normalized: ${summary.normalizedRotations}`);
  }
  if (summary.substitutedFonts > 0) {
    items.push(`Font references substituted: ${summary.substitutedFonts}`);
  }

  return items;
}