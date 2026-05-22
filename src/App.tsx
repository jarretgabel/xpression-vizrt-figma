import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { convertFigmaJsonToSvg, preferredFontFamilyForStyle } from '../lib/convert-figma-json-to-svg.mjs';
import {
  buildRemoteImageAssets,
  extractFigmaIdentifiers,
  fetchFigmaRenderedSvg,
  fetchFigmaSourceFromApi,
  normalizeNodeIds,
  slugFromFileName,
} from './lib/figma';
import { auditFonts } from './lib/audit';
import { buildDynamicBindingsManifest } from './lib/bindings';
import { parseFontSubstitutionEnv } from './lib/fonts';
import { applyBindingsToSvg, buildInitialOperatorValues, buildXpressionTemplate } from './lib/operator';
import { preprocessFigmaSource, summarizePreprocess } from './lib/preprocess';
import { buildPrepChecklist, summarizeRisks } from './lib/xpression';
import type { ConverterWarnings, DynamicBindingsManifest, FigmaNode, FigmaSource, FontAuditItem, MissingImageWarning, XpressionPrepItem } from './types';

const defaultToken = import.meta.env.VITE_FIGMA_TOKEN?.trim() ?? '';
const fontSubstitutions = parseFontSubstitutionEnv(import.meta.env.VITE_FONT_SUBSTITUTIONS);
const previewFontStylesheet = 'https://a.espncdn.com/combiner/c?css=fonts/bentonsans.css,fonts/bentonsansmedium.css,fonts/bentonsansbold.css,pagetype/otl/tungsten/tungsten_700.css,pagetype/otl/tungsten/tungsten_600.css';
const previewIgniteStylesheet = 'https://a.espncdn.com/prod/fonts/ESPNIgnite/ignite.css';

function previewAssetUrl(path: string) {
  if (typeof window === 'undefined') {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function walkFigmaNodes(node: FigmaNode | undefined, visit: (node: FigmaNode) => void) {
  if (!node) {
    return;
  }

  visit(node);
  for (const child of node.children || []) {
    walkFigmaNodes(child, visit);
  }
}

async function measureFontBaselineMetrics(source: FigmaSource) {
  if (typeof document === 'undefined') {
    return undefined;
  }

  await document.fonts.ready;

  const firstNodeKey = Object.keys(source.nodes || {})[0];
  const root = source.nodes?.[firstNodeKey]?.document;
  const families = new Set<string>();

  walkFigmaNodes(root, (node) => {
    if (node.type !== 'TEXT' || !node.style) {
      return;
    }

    families.add(preferredFontFamilyForStyle(node.style));
    for (const override of Object.values(node.styleOverrideTable || {})) {
      if (override && typeof override === 'object') {
        families.add(preferredFontFamilyForStyle({ ...node.style, ...(override as Record<string, unknown>) }));
      }
    }
  });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  const metrics: Record<string, { ascentRatio: number; descentRatio: number; capHeightRatio: number }> = {};
  for (const family of families) {
    if (!family || !document.fonts.check(`100px "${family}"`)) {
      continue;
    }

    context.font = `100px "${family}"`;
    const sample = context.measureText('HAgjpQ');
    const caps = context.measureText('H');
    if (!sample.actualBoundingBoxAscent || !sample.actualBoundingBoxDescent) {
      continue;
    }

    metrics[family] = {
      ascentRatio: sample.actualBoundingBoxAscent / 100,
      descentRatio: sample.actualBoundingBoxDescent / 100,
      capHeightRatio: (caps.actualBoundingBoxAscent || sample.actualBoundingBoxAscent) / 100,
    };
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function buildPreviewDocument(svg: string) {
  const bentonSansBookWoff = previewAssetUrl('/fonts/bentonsansbook.woff');
  const bentonSansBookTtf = previewAssetUrl('/fonts/bentonsansbook.ttf');
  const bentonSansLightTtf = previewAssetUrl('/fonts/bentonsanslight.ttf');
  const bentonSansThinWoff = previewAssetUrl('/fonts/bentonsansthin.woff');
  const bentonSansThinTtf = previewAssetUrl('/fonts/bentonsansthin.ttf');
  const bentonSansBlackWoff2 = previewAssetUrl('/fonts/bentonsansblack.woff2');
  const bentonSansBlackWoff = previewAssetUrl('/fonts/bentonsansblack.woff');
  const bentonSansBlackTtf = previewAssetUrl('/fonts/bentonsansblack.ttf');
  const bentonSansCondTtf = previewAssetUrl('/fonts/bentonsanscond.ttf');
  const bentonSansCondBookWoff = previewAssetUrl('/fonts/bentonsanscondbook.woff');
  const bentonSansCondBookTtf = previewAssetUrl('/fonts/bentonsanscondbook.ttf');
  const bentonSansCondMediumTtf = previewAssetUrl('/fonts/bentonsanscondmedium.ttf');
  const bentonSansCondBoldTtf = previewAssetUrl('/fonts/bentonsanscondbold.ttf');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${previewFontStylesheet}" />
    <link rel="stylesheet" href="${previewIgniteStylesheet}" />
    <style>
      @font-face {
        font-family: 'BentonSansBook';
         src: url('${bentonSansBookWoff}') format('woff'),
           url('${bentonSansBookTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansLight';
        src: url('${bentonSansLightTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansThin';
         src: url('${bentonSansThinWoff}') format('woff'),
           url('${bentonSansThinTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansBlack';
         src: url('${bentonSansBlackWoff2}') format('woff2'),
           url('${bentonSansBlackWoff}') format('woff'),
           url('${bentonSansBlackTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansCond';
        src: url('${bentonSansCondTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansCondBook';
         src: url('${bentonSansCondBookWoff}') format('woff'),
           url('${bentonSansCondBookTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansCondMedium';
        src: url('${bentonSansCondMediumTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      @font-face {
        font-family: 'BentonSansCondBold';
        src: url('${bentonSansCondBoldTtf}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: #f7f7f7;
      }

      body {
        min-height: 100vh;
        display: grid;
        place-items: center;
      }

      /*
       * Preview-only font aliases. ESPN's stylesheet exposes Benton/Tungsten
       * under webfont family names that do not always match the families
       * coming through from Figma, so map the common exported names here.
       */
      svg text,
      svg tspan {
        font-kerning: normal;
        font-synthesis: none;
        text-rendering: geometricPrecision;
      }

      svg text[font-family*='Benton Sans'],
      svg tspan[font-family*='Benton Sans'],
      svg text[font-family*='BentonSans'],
      svg tspan[font-family*='BentonSans'] {
        font-family: 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Medium'],
      svg tspan[font-family*='Benton Sans Medium'],
      svg text[font-family*='BentonSans Medium'],
      svg tspan[font-family*='BentonSans Medium'],
      svg text[font-family*='BentonSansMedium'],
      svg tspan[font-family*='BentonSansMedium'] {
        font-family: 'BentonSansMedium', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Bold'],
      svg tspan[font-family*='Benton Sans Bold'],
      svg text[font-family*='BentonSans Bold'],
      svg tspan[font-family*='BentonSans Bold'],
      svg text[font-family*='BentonSansBold'],
      svg tspan[font-family*='BentonSansBold'] {
        font-family: 'BentonSansBold', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Bold'],
      svg tspan[font-family*='Benton Sans Condensed Bold'],
      svg text[font-family*='BentonSans Condensed Bold'],
      svg tspan[font-family*='BentonSans Condensed Bold'],
      svg text[font-family*='BentonSansCondensedBold'],
      svg tspan[font-family*='BentonSansCondensedBold'],
      svg text[font-family*='Benton Sans Cond Bold'],
      svg tspan[font-family*='Benton Sans Cond Bold'],
      svg text[font-family*='BentonSansCondBold'],
      svg tspan[font-family*='BentonSansCondBold'],
      svg text[font-family*='Benton Sans Comp Bold'],
      svg tspan[font-family*='Benton Sans Comp Bold'],
      svg text[font-family*='Benton Sans Compressed Bold'],
      svg tspan[font-family*='Benton Sans Compressed Bold'] {
        font-family: 'BentonSansCondBold', 'BentonSansBold', 'BentonSansCond', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Medium'],
      svg tspan[font-family*='Benton Sans Condensed Medium'],
      svg text[font-family*='BentonSans Condensed Medium'],
      svg tspan[font-family*='BentonSans Condensed Medium'],
      svg text[font-family*='BentonSansCondensedMedium'],
      svg tspan[font-family*='BentonSansCondensedMedium'],
      svg text[font-family*='Benton Sans Cond Medium'],
      svg tspan[font-family*='Benton Sans Cond Medium'],
      svg text[font-family*='BentonSansCondMedium'],
      svg tspan[font-family*='BentonSansCondMedium'],
      svg text[font-family*='Benton Sans Comp Medium'],
      svg tspan[font-family*='Benton Sans Comp Medium'],
      svg text[font-family*='Benton Sans Compressed Medium'],
      svg tspan[font-family*='Benton Sans Compressed Medium'] {
        font-family: 'BentonSansCondMedium', 'BentonSansMedium', 'BentonSansCond', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Book'],
      svg tspan[font-family*='Benton Sans Condensed Book'],
      svg text[font-family*='BentonSans Condensed Book'],
      svg tspan[font-family*='BentonSans Condensed Book'],
      svg text[font-family*='BentonSansCondensedBook'],
      svg tspan[font-family*='BentonSansCondensedBook'],
      svg text[font-family*='Benton Sans Cond Book'],
      svg tspan[font-family*='Benton Sans Cond Book'],
      svg text[font-family*='BentonSansCondBook'],
      svg tspan[font-family*='BentonSansCondBook'] {
        font-family: 'BentonSansCondBook', 'BentonSansCond', 'BentonSansBook', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed'],
      svg tspan[font-family*='Benton Sans Condensed'],
      svg text[font-family*='BentonSans Condensed'],
      svg tspan[font-family*='BentonSans Condensed'],
      svg text[font-family*='BentonSansCondensed'],
      svg tspan[font-family*='BentonSansCondensed'],
      svg text[font-family*='Benton Sans Cond'],
      svg tspan[font-family*='Benton Sans Cond'],
      svg text[font-family*='BentonSansCond'],
      svg tspan[font-family*='BentonSansCond'],
      svg text[font-family*='Benton Sans Comp'],
      svg tspan[font-family*='Benton Sans Comp'],
      svg text[font-family*='Benton Sans Compressed'],
      svg tspan[font-family*='Benton Sans Compressed'] {
        font-family: 'BentonSansCond', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Book'],
      svg tspan[font-family*='Benton Sans Condensed Book'],
      svg text[font-family*='BentonSans Condensed Book'],
      svg tspan[font-family*='BentonSans Condensed Book'],
      svg text[font-family*='BentonSansCondensedBook'],
      svg tspan[font-family*='BentonSansCondensedBook'],
      svg text[font-family*='Benton Sans Cond Book'],
      svg tspan[font-family*='Benton Sans Cond Book'],
      svg text[font-family*='BentonSansCondBook'],
      svg tspan[font-family*='BentonSansCondBook'] {
        font-family: 'BentonSansCondBook', 'BentonSansCond', 'BentonSansBook', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Medium'],
      svg tspan[font-family*='Benton Sans Condensed Medium'],
      svg text[font-family*='BentonSans Condensed Medium'],
      svg tspan[font-family*='BentonSans Condensed Medium'],
      svg text[font-family*='BentonSansCondensedMedium'],
      svg tspan[font-family*='BentonSansCondensedMedium'],
      svg text[font-family*='Benton Sans Cond Medium'],
      svg tspan[font-family*='Benton Sans Cond Medium'],
      svg text[font-family*='BentonSansCondMedium'],
      svg tspan[font-family*='BentonSansCondMedium'],
      svg text[font-family*='Benton Sans Comp Medium'],
      svg tspan[font-family*='Benton Sans Comp Medium'],
      svg text[font-family*='Benton Sans Compressed Medium'],
      svg tspan[font-family*='Benton Sans Compressed Medium'] {
        font-family: 'BentonSansCondMedium', 'BentonSansMedium', 'BentonSansCond', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Condensed Bold'],
      svg tspan[font-family*='Benton Sans Condensed Bold'],
      svg text[font-family*='BentonSans Condensed Bold'],
      svg tspan[font-family*='BentonSans Condensed Bold'],
      svg text[font-family*='BentonSansCondensedBold'],
      svg tspan[font-family*='BentonSansCondensedBold'],
      svg text[font-family*='Benton Sans Cond Bold'],
      svg tspan[font-family*='Benton Sans Cond Bold'],
      svg text[font-family*='BentonSansCondBold'],
      svg tspan[font-family*='BentonSansCondBold'],
      svg text[font-family*='Benton Sans Comp Bold'],
      svg tspan[font-family*='Benton Sans Comp Bold'],
      svg text[font-family*='Benton Sans Compressed Bold'],
      svg tspan[font-family*='Benton Sans Compressed Bold'] {
        font-family: 'BentonSansCondBold', 'BentonSansBold', 'BentonSansCond', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Book'],
      svg tspan[font-family*='Benton Sans Book'],
      svg text[font-family*='BentonSans Book'],
      svg tspan[font-family*='BentonSans Book'],
      svg text[font-family*='BentonSansBook'],
      svg tspan[font-family*='BentonSansBook'] {
        font-family: 'BentonSansBook', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Light'],
      svg tspan[font-family*='Benton Sans Light'],
      svg text[font-family*='BentonSans Light'],
      svg tspan[font-family*='BentonSans Light'],
      svg text[font-family*='BentonSansLight'],
      svg tspan[font-family*='BentonSansLight'] {
        font-family: 'BentonSansLight', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Thin'],
      svg tspan[font-family*='Benton Sans Thin'],
      svg text[font-family*='BentonSans Thin'],
      svg tspan[font-family*='BentonSans Thin'],
      svg text[font-family*='BentonSansThin'],
      svg tspan[font-family*='BentonSansThin'] {
        font-family: 'BentonSansThin', 'BentonSansLight', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Benton Sans Black'],
      svg tspan[font-family*='Benton Sans Black'],
      svg text[font-family*='BentonSans Black'],
      svg tspan[font-family*='BentonSans Black'],
      svg text[font-family*='BentonSansBlack'],
      svg tspan[font-family*='BentonSansBlack'] {
        font-family: 'BentonSansBlack', 'BentonSansBold', 'BentonSans', Arial, sans-serif;
      }

      svg text[font-family*='Tungsten'],
      svg tspan[font-family*='Tungsten'],
      svg text[font-family*='HCo Tungsten'],
      svg tspan[font-family*='HCo Tungsten'],
      svg text[font-family*='HCoTungsten'],
      svg tspan[font-family*='HCoTungsten'] {
        font-family: 'HCoTungsten', Impact, sans-serif;
      }

      svg text[font-family*='ESPN Ignite Text'],
      svg tspan[font-family*='ESPN Ignite Text'],
      svg text[font-family*='Ignite Text'],
      svg tspan[font-family*='Ignite Text'],
      svg text[font-family*='ESPNIgniteText'],
      svg tspan[font-family*='ESPNIgniteText'],
      svg text[font-family*='Ignite'],
      svg tspan[font-family*='Ignite'] {
        font-family: 'ESPN Ignite Text Web', Arial, sans-serif;
      }

      svg text[font-family*='ESPN Ignite Display'],
      svg tspan[font-family*='ESPN Ignite Display'],
      svg text[font-family*='Ignite Display'],
      svg tspan[font-family*='Ignite Display'],
      svg text[font-family*='ESPN Ignite Display Condensed'],
      svg tspan[font-family*='ESPN Ignite Display Condensed'],
      svg text[font-family*='Ignite Display Condensed'],
      svg tspan[font-family*='Ignite Display Condensed'] {
        font-family: 'ESPN Ignite Display Web', 'ESPN Ignite Display Condensed Web', Impact, sans-serif;
      }

      svg {
        display: block;
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    ${svg}
  </body>
</html>`;
}

function App() {
  const previewRequestIdRef = useRef(0);
  const [figmaSourceLabel, setFigmaSourceLabel] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [status, setStatus] = useState('');
  const [currentSvg, setCurrentSvg] = useState('');
  const [currentReport, setCurrentReport] = useState('No report yet.');
  const [currentMissingManifest, setCurrentMissingManifest] = useState('');
  const [currentNormalizedJson, setCurrentNormalizedJson] = useState('');
  const [currentBindingsManifest, setCurrentBindingsManifest] = useState<DynamicBindingsManifest | null>(null);
  const [operatorValues, setOperatorValues] = useState<Record<string, string>>({});
  const [currentWarnings, setCurrentWarnings] = useState<ConverterWarnings | null>(null);
  const [fontAudit, setFontAudit] = useState<FontAuditItem[]>([]);
  const [imageRefs, setImageRefs] = useState<string[]>([]);
  const [prepChecklist, setPrepChecklist] = useState<XpressionPrepItem[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [figmaPreviewSvg, setFigmaPreviewSvg] = useState('');
  const [figmaPreviewUrl, setFigmaPreviewUrl] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFigmaPreviewVisible, setIsFigmaPreviewVisible] = useState(false);
  const [isExportsMenuOpen, setIsExportsMenuOpen] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<'controls' | 'readiness' | 'bindings' | 'fonts' | 'prep' | null>('readiness');
  const [activeOutputPanel, setActiveOutputPanel] = useState<'editor' | 'report' | 'template' | null>(null);

  const customizedSvg = useMemo(() => applyBindingsToSvg(currentSvg, currentBindingsManifest, operatorValues), [currentSvg, currentBindingsManifest, operatorValues]);
  const xpressionTemplate = useMemo(() => buildXpressionTemplate(currentBindingsManifest, operatorValues, customizedSvg), [currentBindingsManifest, operatorValues, customizedSvg]);
  const textBindingItems = useMemo(
    () => (currentBindingsManifest?.items || []).filter((item) => item.bindingType === 'text'),
    [currentBindingsManifest],
  );
  const hasPreview = Boolean(currentSvg);
  const hasMeaningfulStatus = Boolean(status) && !status.startsWith('Waiting for a Figma URL');

  useEffect(() => {
    if (!customizedSvg) {
      setPreviewUrl((existing) => {
        if (existing) {
          URL.revokeObjectURL(existing);
        }
        return null;
      });
      return;
    }

    const nextUrl = URL.createObjectURL(new Blob([buildPreviewDocument(customizedSvg)], { type: 'text/html' }));
    setPreviewUrl((existing) => {
      if (existing) {
        URL.revokeObjectURL(existing);
      }
      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [customizedSvg]);

  useEffect(() => {
    if (!figmaPreviewSvg) {
      setFigmaPreviewUrl((existing) => {
        if (existing) {
          URL.revokeObjectURL(existing);
        }
        return null;
      });
      return;
    }

    const nextUrl = URL.createObjectURL(new Blob([buildPreviewDocument(figmaPreviewSvg)], { type: 'text/html' }));
    setFigmaPreviewUrl((existing) => {
      if (existing) {
        URL.revokeObjectURL(existing);
      }
      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [figmaPreviewSvg]);

  useEffect(() => {
    if (!hasPreview && activeSidebarPanel === 'controls') {
      setActiveSidebarPanel('readiness');
    }
  }, [activeSidebarPanel, hasPreview]);

  useEffect(() => {
    if (!hasPreview) {
      setIsExportsMenuOpen(false);
    }
  }, [hasPreview]);

  async function buildPreviewFromSource(source: FigmaSource, sourceLabel: string, fileKey: string, nodeIds: string) {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setStatus('Preparing Figma JSON, resolving remote image fills, and generating SVG...');

    const { source: preparedSource, summary: preprocessSummary } = preprocessFigmaSource(source, fontSubstitutions);
    const { assets, summary: imageSummary } = await buildRemoteImageAssets(preparedSource, fileKey, defaultToken);
    const textMetrics = await measureFontBaselineMetrics(preparedSource);
    const outputBaseName = `${slugFromFileName(sourceLabel, 'figma')}-xpression`;
    const bindingsManifest = buildDynamicBindingsManifest(preparedSource, sourceLabel || 'in-browser-source');
    const result = convertFigmaJsonToSvg(preparedSource, {
      sourcePath: sourceLabel || 'in-browser-source',
      outputPath: `${outputBaseName}.svg`,
      imageAssets: assets,
      textMetrics,
    });
    const nextFontAudit = auditFonts(preparedSource, result.warnings);
    const operatorReport = [
      'Preprocess summary:',
      ...summarizePreprocess(preprocessSummary).map((line) => `- ${line}`),
      '',
      'Remote image fill summary:',
      `- Detected image refs: ${imageSummary.detectedImageRefs.length}`,
      `- Resolved via Figma API: ${imageSummary.resolvedImageRefs.length}`,
      `- Still unresolved: ${imageSummary.unresolvedImageRefs.length}`,
      '',
      'Font audit summary:',
      ...(nextFontAudit.length > 0
        ? nextFontAudit.map((font) => `- ${font.family}: ${font.usageCount} layer(s), browser=${font.availableInBrowser === null ? 'unknown' : font.availableInBrowser ? 'available' : 'missing'}, risk=${font.risk}`)
        : ['- No text layers detected']),
      '',
      'Dynamic bindings summary:',
      ...(bindingsManifest.items.length > 0
        ? bindingsManifest.items.map((item) => `- ${item.fieldKey}: ${item.bindingType} -> ${item.nodeName} (${item.svgId})${item.colorValue ? ` value=${item.colorValue}` : ''}`)
        : ['- No dynamic text or image candidates detected']),
      '',
      'Binding naming validation:',
      ...(bindingsManifest.validationIssues.length > 0
        ? bindingsManifest.validationIssues.map((issue) => `- ${issue}`)
        : ['- All detected dynamic candidates follow the naming convention']),
      '',
      result.report,
    ].join('\n');

    const nextStatus =
      imageSummary.unresolvedImageRefs.length > 0 || result.warnings.missingImages.length > 0
        ? 'Preview generated. Some remote image fills were not resolved; review the report before import.'
        : 'Preview generated. Review compatibility notes before importing into XPression.';

    setCurrentSvg(result.svg);
    setFigmaPreviewSvg('');
    setCurrentReport(operatorReport);
    setCurrentNormalizedJson(JSON.stringify(preparedSource, null, 2));
    setCurrentBindingsManifest(bindingsManifest);
    setOperatorValues(buildInitialOperatorValues(bindingsManifest));
    setCurrentWarnings(result.warnings);
    setFontAudit(nextFontAudit);
    setImageRefs(imageSummary.detectedImageRefs);
    setPrepChecklist(buildPrepChecklist(preparedSource, result.warnings));
    setCurrentMissingManifest(JSON.stringify({
      imageRefs: result.warnings.missingImages.reduce<Record<string, string>>((accumulator: Record<string, string>, image: MissingImageWarning) => {
        accumulator[image.imageRef] = `${image.imageRef}.png`;
        return accumulator;
      }, {}),
    }, null, 2));
    setStatus(nextStatus);

    void (async () => {
      try {
        const nextFigmaPreviewSvg = await Promise.race<string>([
          fetchFigmaRenderedSvg({
            token: defaultToken,
            fileKey,
            nodeIds,
          }),
          new Promise<string>((_, reject) => {
            window.setTimeout(() => reject(new Error('Timed out fetching Figma SVG reference preview.')), 12000);
          }),
        ]);

        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setFigmaPreviewSvg(nextFigmaPreviewSvg);
      } catch {
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setFigmaPreviewSvg('');
      }
    })();
  }

  async function generateFromApi() {
    if (!defaultToken) {
      setStatus('Add VITE_FIGMA_TOKEN to .env.local and restart the Vite dev server before fetching.');
      return;
    }

    const parsed = extractFigmaIdentifiers(figmaUrl);
    if (!parsed || !parsed.fileKey || !parsed.nodeIds) {
      setStatus('Paste a Figma file or node URL that includes a node id.');
      return;
    }

    try {
      setStatus('Fetching node JSON from the Figma API...');
      const normalizedIds = normalizeNodeIds(parsed.nodeIds);
      const source = await fetchFigmaSourceFromApi({
        token: defaultToken,
        fileKey: parsed.fileKey.trim(),
        nodeIds: normalizedIds,
      });
      const sourceLabel = `Figma API: ${parsed.fileKey.trim()} (${normalizedIds})`;
      setFigmaSourceLabel(sourceLabel);
      await buildPreviewFromSource(source, sourceLabel, parsed.fileKey.trim(), normalizedIds);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not fetch JSON from Figma.');
    }
  }

  function downloadText(text: string, fileName: string, mimeType: string) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(successMessage);
    } catch {
      setStatus('Could not copy to clipboard in this browser session.');
    }
  }

  const downloadBaseName = slugFromFileName(figmaSourceLabel, 'figma');
  const riskSummary = currentWarnings ? summarizeRisks(currentWarnings) : [];
  return (
    <div className="min-h-screen bg-transparent text-espn-slate">
      <main className="mx-auto flex min-h-screen max-w-full flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5">
        <section className="rounded-[18px] border border-espn-border bg-white px-4 py-3 shadow-panel">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-espn-muted">Figma to XPression</p>
            <h1 className="mt-1 text-xl font-semibold leading-tight tracking-[-0.03em] text-espn-slate sm:text-2xl">
              Live graphics prep for XPression
            </h1>
            <p className="mt-1 text-xs text-espn-muted">Load a Figma node, preview it, then adjust live fields without leaving the page.</p>
          </div>
        </section>

        <section className="rounded-[18px] border border-espn-border bg-white p-4 shadow-panel">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-espn-muted">Figma URL</span>
              <input
                value={figmaUrl}
                onChange={(event) => setFigmaUrl(event.target.value)}
                placeholder="Paste a Figma file or node URL"
                className="h-10 w-full rounded-xl border border-espn-border bg-[#f5f6f7] px-3 text-sm outline-none transition focus:border-espn-red"
              />
            </label>
            <button type="button" onClick={generateFromApi} className="h-10 rounded-xl border border-espn-border bg-[#f5f6f7] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">
              Generate Preview
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hasMeaningfulStatus ? <p className="text-xs leading-5 text-espn-muted">{status}</p> : null}
          </div>

        </section>

        <section className={`grid gap-3 ${isSidebarOpen ? 'xl:grid-cols-[minmax(0,1.7fr)_360px]' : ''}`}>
          <div className="space-y-3">
            <section className="rounded-[18px] border border-espn-border bg-white p-4 shadow-panel">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-espn-slate">Preview</h2>
                <span className="text-xs text-espn-muted">
                  {imageRefs.length > 0 ? `${imageRefs.length} image ref${imageRefs.length === 1 ? '' : 's'} detected` : 'No output yet'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen((current) => !current)}
                className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate"
              >
                {isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              </button>
            </div>

            {hasPreview ? (
              <div className="mt-3 flex flex-wrap gap-1.5 border-b border-espn-border pb-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsExportsMenuOpen((current) => !current)}
                    className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate"
                  >
                    Exports
                  </button>
                  {isExportsMenuOpen ? (
                    <div className="absolute left-0 top-full z-10 mt-1 min-w-[240px] overflow-hidden rounded-xl border border-espn-border bg-white shadow-panel">
                      <button
                        type="button"
                        onClick={() => {
                          downloadText(currentReport, `${downloadBaseName}-xpression.report.txt`, 'text/plain');
                          setIsExportsMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                      >
                        Download Report
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          downloadText(currentNormalizedJson, `${downloadBaseName}-normalized.json`, 'application/json');
                          setIsExportsMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                      >
                        Download Normalized JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          downloadText(JSON.stringify(currentBindingsManifest, null, 2), `${downloadBaseName}-xpression-bindings.json`, 'application/json');
                          setIsExportsMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                      >
                        Download Bindings Map
                      </button>
                      {currentMissingManifest && currentMissingManifest !== '{\n  "imageRefs": {}\n}' ? (
                        <button
                          type="button"
                          onClick={() => {
                            downloadText(currentMissingManifest, `${downloadBaseName}-assets-manifest.json`, 'application/json');
                            setIsExportsMenuOpen(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                        >
                          Download Missing-Ref Manifest
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          downloadText(xpressionTemplate, `${downloadBaseName}-xpression-template.txt`, 'text/plain');
                          setIsExportsMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                      >
                        Download XPression Template
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void copyText(xpressionTemplate, 'XPression template copied to clipboard.');
                          setIsExportsMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-espn-slate hover:bg-[#f5f6f7]"
                      >
                        Copy XPression Template
                      </button>
                    </div>
                  ) : null}
                </div>
                {figmaPreviewUrl ? (
                  <button
                    type="button"
                    onClick={() => setIsFigmaPreviewVisible((current) => !current)}
                    className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate"
                  >
                    {isFigmaPreviewVisible ? 'Hide Figma SVG' : 'Show Figma SVG'}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={`mt-3 grid min-h-[520px] gap-3 ${isFigmaPreviewVisible && figmaPreviewUrl ? 'xl:grid-cols-2' : ''}`}>
              {previewUrl ? (
                <div className="overflow-hidden rounded-2xl border border-espn-border bg-white">
                  <div className="border-b border-espn-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-espn-muted">Generated SVG</div>
                  <iframe title="Generated SVG preview" src={previewUrl} className="h-[472px] w-full border-0 bg-[#f7f7f7]" />
                </div>
              ) : (
                <p className="px-6 text-center text-xs leading-5 text-espn-muted">Paste a Figma URL and generate the preview.</p>
              )}
              {previewUrl && figmaPreviewUrl && isFigmaPreviewVisible ? (
                <div className="overflow-hidden rounded-2xl border border-espn-border bg-white">
                  <div className="border-b border-espn-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-espn-muted">Figma SVG</div>
                  <iframe title="Figma SVG preview" src={figmaPreviewUrl} className="h-[472px] w-full border-0 bg-[#f7f7f7]" />
                </div>
              ) : null}
            </div>
            </section>

            {hasPreview ? (
              <section className="space-y-3">
                <DisclosurePanel
                  title="Live text editor"
                  isOpen={activeOutputPanel === 'editor'}
                  onToggle={() => setActiveOutputPanel((current) => current === 'editor' ? null : 'editor')}
                >
                  {textBindingItems.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs leading-5 text-espn-muted">Edit detected text bindings here to see spacing and line-flow changes without opening the sidebar.</p>
                      {textBindingItems.map((item) => (
                        <label key={item.fieldKey} className="block rounded-2xl bg-[#F7F7F7] p-3">
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-espn-muted">{item.fieldKey}</span>
                          <span className="mt-1 block text-xs text-espn-muted">{item.nodeName}</span>
                          <textarea
                            value={operatorValues[item.fieldKey] ?? ''}
                            onChange={(event) => setOperatorValues((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                            rows={Math.max(2, String(operatorValues[item.fieldKey] ?? item.textSample ?? '').split('\n').length)}
                            placeholder="Enter live text preview value"
                            className="mt-2 w-full rounded-xl border border-espn-border bg-white px-3 py-2 text-sm outline-none transition focus:border-espn-red"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-espn-muted">No dynamic text fields were detected in this preview.</p>
                  )}
                </DisclosurePanel>
                <DisclosurePanel
                  title="Report"
                  isOpen={activeOutputPanel === 'report'}
                  onToggle={() => setActiveOutputPanel((current) => current === 'report' ? null : 'report')}
                >
                  <pre className="overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{currentReport}</pre>
                </DisclosurePanel>
                <DisclosurePanel
                  title="XPression template"
                  isOpen={activeOutputPanel === 'template'}
                  onToggle={() => setActiveOutputPanel((current) => current === 'template' ? null : 'template')}
                >
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => downloadText(xpressionTemplate, `${downloadBaseName}-xpression-template.txt`, 'text/plain')}
                      className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate"
                    >
                      Download Template
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyText(xpressionTemplate, 'XPression template copied to clipboard.')}
                      className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate"
                    >
                      Copy Template
                    </button>
                  </div>
                  <pre className="overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{xpressionTemplate}</pre>
                </DisclosurePanel>
              </section>
            ) : null}
          </div>

          {isSidebarOpen ? (
          <aside className="space-y-3">
            {hasPreview ? (
              <DisclosurePanel
                title="Operator controls"
                isOpen={activeSidebarPanel === 'controls'}
                onToggle={() => setActiveSidebarPanel((current) => current === 'controls' ? null : 'controls')}
              >
                <div className="space-y-3">
                  {currentBindingsManifest && currentBindingsManifest.items.length > 0 ? currentBindingsManifest.items.map((item) => (
                    <label key={item.fieldKey} className="block rounded-2xl bg-[#F7F7F7] p-3">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-espn-muted">{item.fieldKey}</span>
                      <span className="mt-1 block text-xs text-espn-muted">{item.bindingType} · {item.nodeName}</span>
                      {item.bindingType === 'color' && (!item.colorValue || !item.colorValue.includes('|')) ? (
                        <input
                          type="color"
                          value={(operatorValues[item.fieldKey] || item.colorValue || '#ffffff').slice(0, 7)}
                          onChange={(event) => setOperatorValues((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                          className="mt-2 h-9 w-full rounded-lg border border-espn-border bg-white"
                        />
                      ) : null}
                      <input
                        type="text"
                        value={operatorValues[item.fieldKey] ?? ''}
                        onChange={(event) => setOperatorValues((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                        placeholder={item.bindingType === 'image' ? 'Paste a replacement logo URL' : item.bindingType === 'color' ? 'Enter #RRGGBB or gradient stops' : 'Enter live text preview value'}
                        className="mt-2 w-full rounded-xl border border-espn-border bg-white px-3 py-2 text-sm outline-none transition focus:border-espn-red"
                      />
                    </label>
                  )) : <p className="text-xs text-espn-muted">No live binding fields were detected in this preview.</p>}
                </div>
              </DisclosurePanel>
            ) : null}
            <DisclosurePanel
              title="Readiness"
              isOpen={activeSidebarPanel === 'readiness'}
              onToggle={() => setActiveSidebarPanel((current) => current === 'readiness' ? null : 'readiness')}
            >
              <div className="space-y-3">
                <MetricGroup title="Compatibility risks" items={riskSummary.length > 0 ? riskSummary : ['No compatibility risks detected in the supported feature set']} />
                <MetricGroup
                  title="Binding validation"
                  items={currentBindingsManifest && currentBindingsManifest.validationIssues.length > 0
                    ? currentBindingsManifest.validationIssues
                    : ['All detected dynamic candidates follow the naming convention']}
                />
              </div>
            </DisclosurePanel>
            <DisclosurePanel
              title="Dynamic bindings"
              isOpen={activeSidebarPanel === 'bindings'}
              onToggle={() => setActiveSidebarPanel((current) => current === 'bindings' ? null : 'bindings')}
            >
              <div>
                <MetricGroup
                  title="Live fields"
                  items={currentBindingsManifest && currentBindingsManifest.items.length > 0
                    ? currentBindingsManifest.items.map((item) => `${item.fieldKey} -> ${item.bindingType}${item.bindingType === 'color' && item.colorValue ? ` (${item.colorValue})` : ''}${item.conventionStatus === 'warn' ? ' (rename)' : ''}`)
                    : ['No dynamic text or image candidates detected']}
                />
              </div>
            </DisclosurePanel>
            <DisclosurePanel
              title="Font audit"
              isOpen={activeSidebarPanel === 'fonts'}
              onToggle={() => setActiveSidebarPanel((current) => current === 'fonts' ? null : 'fonts')}
            >
              {Object.keys(fontSubstitutions).length > 0 ? (
                <p className="mt-2 text-xs leading-5 text-espn-muted">
                  {Object.keys(fontSubstitutions).length} font substitution rule{Object.keys(fontSubstitutions).length === 1 ? '' : 's'} applied during preprocessing.
                </p>
              ) : null}
              <div className="mt-3 space-y-2.5">
                {fontAudit.length > 0 ? fontAudit.map((font) => (
                  <div key={font.family} className="rounded-2xl bg-[#F7F7F7] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-espn-slate">{font.family}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${font.risk === 'warn' ? 'bg-red-100 text-espn-red' : 'bg-zinc-200 text-espn-slate'}`}>
                        {font.risk}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-espn-muted">
                      {font.usageCount} layer(s), browser {font.availableInBrowser === null ? 'availability unknown' : font.availableInBrowser ? 'font available' : 'font not detected'}
                    </p>
                    {font.postScriptNames.length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-espn-muted">PostScript: {font.postScriptNames.join(', ')}</p>
                    ) : null}
                    {font.notes.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {font.notes.map((note) => (
                          <li key={note} className="text-xs leading-5 text-espn-muted">{note}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )) : <p className="text-xs text-espn-muted">Generate a preview to audit font usage.</p>}
              </div>
            </DisclosurePanel>
            <DisclosurePanel
              title="XPression prep"
              isOpen={activeSidebarPanel === 'prep'}
              onToggle={() => setActiveSidebarPanel((current) => current === 'prep' ? null : 'prep')}
            >
              <div className="space-y-2.5">
                {prepChecklist.map((item) => (
                  <div key={item.title} className="rounded-2xl bg-[#F7F7F7] p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-espn-slate">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-espn-muted">{item.detail}</p>
                  </div>
                ))}
                {prepChecklist.length === 0 ? <p className="text-xs text-espn-muted">Generate a preview to see source normalization guidance.</p> : null}
              </div>
            </DisclosurePanel>
          </aside>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function MetricGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-[#f7f7f7] p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-espn-muted">{title}</h4>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <li key={`${title}-${index}-${item}`} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-espn-slate">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DisclosurePanel({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-espn-border bg-white shadow-panel">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <h3 className="text-sm font-semibold text-espn-slate">{title}</h3>
        <span className="text-lg leading-none text-espn-muted">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen ? <div className="border-t border-espn-border px-4 py-4">{children}</div> : null}
    </section>
  );
}

export default App;