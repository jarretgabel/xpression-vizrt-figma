export type ImageAsset = {
  dataUri?: string;
  mimeType?: string;
  base64?: string;
  source?: string;
};

export type ImageAssets = Record<string, ImageAsset>;

export type FigmaPaint = {
  type?: string;
  visible?: boolean;
  imageRef?: string;
  color?: {
    r?: number;
    g?: number;
    b?: number;
    a?: number;
  };
  opacity?: number;
  gradientStops?: Array<{
    position: number;
    color?: {
      r?: number;
      g?: number;
      b?: number;
      a?: number;
    };
  }>;
};

export type FigmaNode = {
  name?: string;
  type?: string;
  characters?: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  booleanOperation?: string;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  absoluteRenderBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string;
    fontStyle?: string;
    fontWeight?: number;
    textCase?: string;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
    textAlignHorizontal?: string;
  };
  fills?: FigmaPaint[];
  children?: FigmaNode[];
  effects?: Array<{
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
  }>;
  vectorPaths?: Array<{ path?: string; data?: string }>;
  fillGeometry?: Array<{ path?: string; data?: string }>;
  strokeGeometry?: Array<{ path?: string; data?: string }>;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, unknown>;
};

export type FigmaSource = {
  name?: string;
  nodes?: Record<string, { document: FigmaNode }>;
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

export type XpressionPrepItem = {
  title: string;
  detail: string;
};

export type FontSubstitution = {
  family: string;
  postScriptName?: string;
};

export type FontSubstitutionMap = Record<string, FontSubstitution>;

export type PreprocessSummary = {
  sourceNodeCount: number;
  outputNodeCount: number;
  removedHiddenNodes: number;
  trimmedNames: number;
  normalizedRotations: number;
  substitutedFonts: number;
};

export type RemoteImageSummary = {
  detectedImageRefs: string[];
  resolvedImageRefs: string[];
  unresolvedImageRefs: string[];
};

export type FontAuditItem = {
  family: string;
  postScriptNames: string[];
  usageCount: number;
  mixedStyleLayers: number;
  availableInBrowser: boolean | null;
  risk: 'ok' | 'warn';
  notes: string[];
};

export type DynamicBindingItem = {
  fieldKey: string;
  bindingType: 'text' | 'image' | 'color';
  fieldRole: string;
  nodeName: string;
  svgId: string;
  figmaType: string;
  conventionStatus: 'valid' | 'warn';
  suggestedName?: string;
  notes: string[];
  textSample?: string;
  imageRef?: string;
  paintType?: string;
  colorValue?: string;
  fontFamily?: string;
  fontPostScriptName?: string;
  textCase?: string;
  textAlignHorizontal?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  flowAfterFieldKey?: string;
  flowGap?: number;
  flowKind?: 'attached' | 'separated';
  flowBottomOffset?: number;
};

export type DynamicBindingsManifest = {
  source: string;
  generatedAt: string;
  validationIssues: string[];
  items: DynamicBindingItem[];
};