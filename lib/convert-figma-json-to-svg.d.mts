export type ImageAsset = {
  dataUri?: string;
  mimeType?: string;
  base64?: string;
  source?: string;
};

export type MissingImageWarning = {
  name: string;
  imageRef: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type IgnoredEffectWarning = {
  name: string;
  type: string;
  effects: string[];
};

export type FigmaEffect = {
  type?: string;
  visible?: boolean;
  radius?: number;
  color?: {
    r?: number;
    g?: number;
    b?: number;
    a?: number;
  };
  offset?: {
    x?: number;
    y?: number;
  };
};

export type UnsupportedNodeWarning = {
  name: string;
  type: string;
};

export type UnsupportedPaintWarning = {
  type: string;
  usage: string;
};

export type TransformWarning = {
  name: string;
  type: string;
  rotation: number | string;
};

export type StyledTextWarning = {
  name: string;
  type: string;
};

export type EmbeddedImageWarning = {
  name: string;
  imageRef: string;
  source: string;
};

export type ConverterWarnings = {
  missingImages: MissingImageWarning[];
  ignoredEffects: IgnoredEffectWarning[];
  unsupportedNodes: UnsupportedNodeWarning[];
  unsupportedPaints: UnsupportedPaintWarning[];
  transformNodes: TransformWarning[];
  styledTextRuns: StyledTextWarning[];
  embeddedImages: EmbeddedImageWarning[];
  fonts: string[];
};

export type ConvertResult = {
  svg: string;
  report: string;
  warnings: ConverterWarnings;
};

export type TextMetricSample = {
  ascentRatio: number;
  descentRatio: number;
};

export function preferredFontFamilyForStyle(style: {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontStyle?: string;
  fontWeight?: number;
}): string;

export function convertFigmaJsonToSvg(
  source: { nodes?: Record<string, { document: unknown }> },
  options: {
    sourcePath?: string;
    outputPath?: string;
    imageAssets?: Record<string, ImageAsset>;
    textMetrics?: Record<string, TextMetricSample>;
  },
): ConvertResult;