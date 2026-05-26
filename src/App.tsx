import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { convertFigmaJsonToSvg, preferredFontFamilyForStyle } from '../lib/convert-figma-json-to-svg.mjs';
import bentonSansRegularWoffUrl from './assets/fonts/bentonsans.woff?url';
import bentonSansRegularWoff2Url from './assets/fonts/bentonsans.woff2?url';
import bentonSansRegularTtfUrl from './assets/fonts/bentonsans.ttf?url';
import bentonSansBlackTtfUrl from './assets/fonts/bentonsansblack.ttf?url';
import bentonSansBlackWoffUrl from './assets/fonts/bentonsansblack.woff?url';
import bentonSansBlackWoff2Url from './assets/fonts/bentonsansblack.woff2?url';
import bentonSansBoldTtfUrl from './assets/fonts/bentonsansbold.ttf?url';
import bentonSansBookTtfUrl from './assets/fonts/bentonsansbook.ttf?url';
import bentonSansBookWoffUrl from './assets/fonts/bentonsansbook.woff?url';
import bentonSansCondBoldTtfUrl from './assets/fonts/bentonsanscondbold.ttf?url';
import bentonSansCondBookTtfUrl from './assets/fonts/bentonsanscondbook.ttf?url';
import bentonSansCondBookWoffUrl from './assets/fonts/bentonsanscondbook.woff?url';
import bentonSansCondMediumTtfUrl from './assets/fonts/bentonsanscondmedium.ttf?url';
import bentonSansCondTtfUrl from './assets/fonts/bentonsanscond.ttf?url';
import bentonSansLightTtfUrl from './assets/fonts/bentonsanslight.ttf?url';
import bentonSansMediumTtfUrl from './assets/fonts/bentonsansmedium.ttf?url';
import bentonSansThinTtfUrl from './assets/fonts/bentonsansthin.ttf?url';
import bentonSansThinWoffUrl from './assets/fonts/bentonsansthin.woff?url';
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
import { applyBindingsToSvg, buildInitialOperatorValues, buildVizrtDataPayload, buildVizrtScenePlan, buildXpressionDataPayload, buildXpressionPrimitivePlan, buildXpressionTemplate } from './lib/operator';
import { preprocessFigmaSource, summarizePreprocess } from './lib/preprocess';
import { buildPrepChecklist, summarizeRisks, summarizeVizrtRisks } from './lib/xpression';
import type { ConverterWarnings, DynamicBindingsManifest, FigmaNode, FigmaSource, FontAuditItem, XpressionPrepItem } from './types';

const defaultToken = import.meta.env.VITE_FIGMA_TOKEN?.trim() ?? '';
const fontSubstitutions = parseFontSubstitutionEnv(import.meta.env.VITE_FONT_SUBSTITUTIONS);
const previewFallbackFontStylesheet = 'https://a.espncdn.com/combiner/c?css=pagetype/otl/tungsten/tungsten_700.css,pagetype/otl/tungsten/tungsten_600.css';
const previewIgniteStylesheet = 'https://a.espncdn.com/prod/fonts/ESPNIgnite/ignite.css';
const emptyMissingManifest = '{\n  "imageRefs": {}\n}';
const previewDocumentBase = typeof document === 'undefined' ? './' : document.baseURI;
const localFontStyleElementId = 'figma-to-xpression-local-font-faces';

function metricFamilyForPreferredFamily(family: string) {
  if (/^ESPN Ignite Display Sans$/i.test(family)) {
    return 'ESPN Ignite Display Web';
  }

  if (/^ESPN Ignite Text$/i.test(family)) {
    return 'ESPN Ignite Text Web';
  }

  return family;
}

const localFontFaceCss = `
  @font-face {
    font-family: 'BentonSans';
    src: url('${bentonSansRegularWoff2Url}') format('woff2'),
      url('${bentonSansRegularWoffUrl}') format('woff'),
      url('${bentonSansRegularTtfUrl}') format('truetype');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansMedium';
    src: url('${bentonSansMediumTtfUrl}') format('truetype');
    font-weight: 500;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansBold';
    src: url('${bentonSansBoldTtfUrl}') format('truetype');
    font-weight: 700;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansBook';
    src: url('${bentonSansBookWoffUrl}') format('woff'),
      url('${bentonSansBookTtfUrl}') format('truetype');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansLight';
    src: url('${bentonSansLightTtfUrl}') format('truetype');
    font-weight: 300;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansThin';
    src: url('${bentonSansThinWoffUrl}') format('woff'),
      url('${bentonSansThinTtfUrl}') format('truetype');
    font-weight: 200;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansBlack';
    src: url('${bentonSansBlackWoff2Url}') format('woff2'),
      url('${bentonSansBlackWoffUrl}') format('woff'),
      url('${bentonSansBlackTtfUrl}') format('truetype');
    font-weight: 900;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansCond';
    src: url('${bentonSansCondTtfUrl}') format('truetype');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansCondBook';
    src: url('${bentonSansCondBookWoffUrl}') format('woff'),
      url('${bentonSansCondBookTtfUrl}') format('truetype');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansCondMedium';
    src: url('${bentonSansCondMediumTtfUrl}') format('truetype');
    font-weight: 500;
    font-style: normal;
  }

  @font-face {
    font-family: 'BentonSansCondBold';
    src: url('${bentonSansCondBoldTtfUrl}') format('truetype');
    font-weight: 700;
    font-style: normal;
  }
`;

function ensureLocalFontFaces(documentRef: Document) {
  if (documentRef.getElementById(localFontStyleElementId)) {
    return;
  }

  const style = documentRef.createElement('style');
  style.id = localFontStyleElementId;
  style.textContent = localFontFaceCss;
  documentRef.head.appendChild(style);
}

type DeliveryTarget = 'template' | 'native' | 'vizrt' | 'vizrt-svg';
type ChecklistStatus = 'ready' | 'attention' | 'info';
type DeliveryChecklistItem = {
  title: string;
  detail: string;
  status: ChecklistStatus;
};

function fontChecklistDetail(fontAudit: FontAuditItem[], targetLabel: string) {
  const issues = fontAudit.flatMap((item) => {
    const itemIssues: string[] = [];
    if (item.family === 'Unknown') {
      itemIssues.push('some layers are missing font family metadata');
    }
    if (item.availableInBrowser === false) {
      itemIssues.push(`${item.family} is not detected in the current browser environment`);
    }
    if (item.mixedStyleLayers > 0) {
      itemIssues.push(`${item.family} has mixed-style text layers`);
    }
    if (item.postScriptNames.length === 0) {
      itemIssues.push(`${item.family} is missing a PostScript name`);
    }
    return itemIssues;
  });

  if (issues.length === 0) {
    return `No browser-side font risks were detected for the current ${targetLabel.toLowerCase()} target.`;
  }

  const summary = issues.slice(0, 3).join('; ');
  const remainder = issues.length > 3 ? `; plus ${issues.length - 3} more font issue${issues.length - 3 === 1 ? '' : 's'}` : '';
  return `${summary}${remainder}. Verify these fonts in the target system before delivery.`;
}

function readFigmaUrlFromDeepLink(search: string) {
  const searchParams = new URLSearchParams(search);
  const directValue = searchParams.get('figma') || searchParams.get('figmaUrl') || searchParams.get('url') || '';
  if (directValue.trim()) {
    return directValue.trim();
  }

  const fileKey = searchParams.get('fileKey') || searchParams.get('key') || '';
  const nodeIds = normalizeNodeIds(
    searchParams.get('node-id')
    || searchParams.get('nodeId')
    || searchParams.get('nodeIds')
    || searchParams.get('ids')
    || '',
  );

  if (!fileKey.trim() || !nodeIds) {
    return '';
  }

  const figmaUrl = new URL(`https://www.figma.com/file/${fileKey.trim()}`);
  figmaUrl.searchParams.set('node-id', nodeIds);
  return figmaUrl.toString();
}

function buildAppDeepLinkHref(currentHref: string, figmaUrl: string) {
  const nextUrl = new URL(currentHref);
  const trimmedValue = figmaUrl.trim();

  nextUrl.searchParams.delete('figmaUrl');
  nextUrl.searchParams.delete('url');
  nextUrl.searchParams.delete('fileKey');
  nextUrl.searchParams.delete('key');
  nextUrl.searchParams.delete('node-id');
  nextUrl.searchParams.delete('nodeId');
  nextUrl.searchParams.delete('nodeIds');
  nextUrl.searchParams.delete('ids');

  if (trimmedValue) {
    nextUrl.searchParams.set('figma', trimmedValue);
  } else {
    nextUrl.searchParams.delete('figma');
  }

  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

function syncFigmaUrlToDeepLink(figmaUrl: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.history.replaceState({}, '', buildAppDeepLinkHref(window.location.href, figmaUrl));
}

function buildDeliveryChecklist({
  target,
  warnings,
  fontAudit,
  bindingsManifest,
  missingManifest,
  hasPreview,
}: {
  target: DeliveryTarget;
  warnings: ConverterWarnings | null;
  fontAudit: FontAuditItem[];
  bindingsManifest: DynamicBindingsManifest | null;
  missingManifest: string;
  hasPreview: boolean;
}): DeliveryChecklistItem[] {
  const hasMissingRefs = Boolean(missingManifest) && missingManifest !== emptyMissingManifest;
  const hasFontRisk = fontAudit.some((item) => item.risk === 'warn');
  const bindingCount = bindingsManifest?.items.length ?? 0;

  if (!hasPreview || !warnings) {
    return [
      {
        title: 'Generate a preview first',
        detail: 'The checklist becomes target-aware once the source has been analyzed.',
        status: 'info',
      },
    ];
  }

  if (target === 'template') {
    return [
      {
        title: 'Verify SVG import compatibility',
        detail: warnings.ignoredEffects.length > 0 || warnings.transformNodes.length > 0
          ? 'This source has effects or transforms that may require cleanup before XPression SVG import.'
          : 'The source is within the expected SVG import path for XPression.',
        status: warnings.ignoredEffects.length > 0 || warnings.transformNodes.length > 0 ? 'attention' : 'ready',
      },
      {
        title: 'Confirm fonts in XPression',
        detail: hasFontRisk
          ? fontChecklistDetail(fontAudit, 'XPression')
          : 'No browser-side font risks were detected for the current XPression target.',
        status: hasFontRisk ? 'attention' : 'ready',
      },
      {
        title: 'Map raster assets before import',
        detail: hasMissingRefs
          ? 'Unresolved image refs still need to be mapped before the import package is considered complete.'
          : 'No unresolved image refs remain for the current source.',
        status: hasMissingRefs ? 'attention' : 'ready',
      },
      {
        title: 'Bind live fields after import',
        detail: bindingCount > 0
          ? `${bindingCount} live field${bindingCount === 1 ? '' : 's'} were detected and are included in the package bindings map and data payload.`
          : 'No live bindings were detected for this source.',
        status: bindingCount > 0 ? 'ready' : 'info',
      },
    ];
  }

  if (target === 'native') {
    return [
      {
        title: 'Rebuild with native XPression objects',
        detail: 'Use the package plan to recreate text, image, and primitive objects instead of relying on SVG import fidelity.',
        status: 'info',
      },
      {
        title: 'Confirm fonts in XPression',
        detail: hasFontRisk
          ? fontChecklistDetail(fontAudit, 'XPression')
          : 'No browser-side font risks were detected for the current XPression target.',
        status: hasFontRisk ? 'attention' : 'ready',
      },
      {
        title: 'Resolve logos and raster textures',
        detail: hasMissingRefs
          ? 'Unresolved image refs still need explicit mapping before scene build.'
          : 'No unresolved raster mappings remain for the current source.',
        status: hasMissingRefs ? 'attention' : 'ready',
      },
      {
        title: 'Recreate effects in-scene',
        detail: warnings.ignoredEffects.length > 0
          ? 'Effect stacks were detected that will need native recreation in XPression.'
          : 'No unsupported effect stacks were detected beyond the supported export path.',
        status: warnings.ignoredEffects.length > 0 ? 'attention' : 'ready',
      },
    ];
  }

  if (target === 'vizrt') {
    return [
      {
        title: 'Rebuild natively in Viz Artist',
        detail: 'Use containers, text objects, image materials, and native shape/material logic rather than imported SVG scene structure.',
        status: 'info',
      },
      {
        title: 'Resolve image and texture mappings',
        detail: hasMissingRefs
          ? 'Some raster assets still need explicit mapping into Viz textures/materials.'
          : 'No unresolved raster mappings remain for the current source.',
        status: hasMissingRefs ? 'attention' : 'ready',
      },
      {
        title: 'Split mixed-style text where needed',
        detail: warnings.styledTextRuns.length > 0
          ? 'Mixed-style text layers were detected and may need to be separated into multiple Viz text objects.'
          : 'No mixed-style text layers were detected.',
        status: warnings.styledTextRuns.length > 0 ? 'attention' : 'ready',
      },
      {
        title: 'Rebuild effects with Viz materials',
        detail: warnings.ignoredEffects.length > 0
          ? 'Unsupported effect stacks were detected and should be rebuilt with Viz materials/effects.'
          : 'No unsupported effect stacks were detected beyond the supported export path.',
        status: warnings.ignoredEffects.length > 0 ? 'attention' : 'ready',
      },
    ];
  }

  return [
    {
      title: 'Treat this as an asset export',
      detail: 'This path is meant for SVG artwork/reference delivery to Viz workflows, not a bindable scene import.',
      status: 'info',
    },
    {
      title: 'Verify asset load path in Viz workflow',
      detail: 'Confirm the exported SVG is being consumed as reference art or a static vector asset in the target pipeline.',
      status: 'info',
    },
    {
      title: 'Map external raster assets',
      detail: hasMissingRefs
        ? 'The asset manifest still contains unresolved image refs that should be mapped before delivery.'
        : 'No unresolved image refs remain for the current asset package.',
      status: hasMissingRefs ? 'attention' : 'ready',
    },
  ];
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

  ensureLocalFontFaces(document);
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

  const probeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  probeSvg.setAttribute('width', '0');
  probeSvg.setAttribute('height', '0');
  probeSvg.setAttribute('aria-hidden', 'true');
  probeSvg.style.position = 'absolute';
  probeSvg.style.left = '-10000px';
  probeSvg.style.top = '-10000px';
  probeSvg.style.overflow = 'visible';
  probeSvg.style.opacity = '0';
  probeSvg.style.pointerEvents = 'none';
  document.body.appendChild(probeSvg);

  const metrics: Record<string, { ascentRatio: number; descentRatio: number; capHeightRatio: number }> = {};
  try {
    for (const family of families) {
      const metricFamily = metricFamilyForPreferredFamily(family);
      if (!metricFamily || !document.fonts.check(`100px "${metricFamily}"`)) {
        continue;
      }

      const sampleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sampleText.setAttribute('x', '0');
      sampleText.setAttribute('y', '100');
      sampleText.setAttribute('font-family', metricFamily);
      sampleText.setAttribute('font-size', '100');
      sampleText.setAttribute('dominant-baseline', 'alphabetic');
      sampleText.textContent = 'HAgjpQ';
      probeSvg.appendChild(sampleText);

      const capText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      capText.setAttribute('x', '0');
      capText.setAttribute('y', '100');
      capText.setAttribute('font-family', metricFamily);
      capText.setAttribute('font-size', '100');
      capText.setAttribute('dominant-baseline', 'alphabetic');
      capText.textContent = 'H';
      probeSvg.appendChild(capText);

      try {
        const sampleBox = sampleText.getBBox();
        const capBox = capText.getBBox();
        const ascent = 100 - sampleBox.y;
        const descent = (sampleBox.y + sampleBox.height) - 100;
        const capHeight = 100 - capBox.y;

        if (ascent <= 0 || descent < 0) {
          continue;
        }

        metrics[family] = {
          ascentRatio: ascent / 100,
          descentRatio: descent / 100,
          capHeightRatio: (capHeight > 0 ? capHeight : ascent) / 100,
        };
      } finally {
        sampleText.remove();
        capText.remove();
      }
    }
  } finally {
    probeSvg.remove();
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function buildPreviewDocument(svg: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base href="${previewDocumentBase}" />
    <link rel="stylesheet" href="${previewFallbackFontStylesheet}" />
    <link rel="stylesheet" href="${previewIgniteStylesheet}" />
    <style>
      ${localFontFaceCss}

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
      * Preview-only font aliases. Prefer shipped local faces first, then fall
      * back to remote-only families such as Tungsten when they are not part
      * of the repo font bundle.
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
  const didApplyDeepLinkRef = useRef(false);
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

  useEffect(() => {
    ensureLocalFontFaces(document);
  }, []);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [figmaPreviewSvg, setFigmaPreviewSvg] = useState('');
  const [figmaPreviewUrl, setFigmaPreviewUrl] = useState<string | null>(null);
  const [isFigmaPreviewVisible, setIsFigmaPreviewVisible] = useState(false);
  const [activeInspectorTab, setActiveInspectorTab] = useState<'readiness' | 'bindings' | 'fonts' | 'prep'>('readiness');
  const [activeOutputPanel, setActiveOutputPanel] = useState<'editor' | 'report' | DeliveryTarget>('native');
  const [activeDeliveryTarget, setActiveDeliveryTarget] = useState<DeliveryTarget>('native');

  const customizedSvg = useMemo(() => applyBindingsToSvg(currentSvg, currentBindingsManifest, operatorValues), [currentSvg, currentBindingsManifest, operatorValues]);
  const xpressionDataPayload = useMemo(() => buildXpressionDataPayload(currentBindingsManifest, operatorValues), [currentBindingsManifest, operatorValues]);
  const vizrtDataPayload = useMemo(() => buildVizrtDataPayload(currentBindingsManifest, operatorValues), [currentBindingsManifest, operatorValues]);
  const xpressionTemplate = useMemo(() => buildXpressionTemplate(currentBindingsManifest, operatorValues, customizedSvg), [currentBindingsManifest, operatorValues, customizedSvg]);
  const xpressionPrimitivePlan = useMemo(() => buildXpressionPrimitivePlan(currentBindingsManifest, operatorValues, customizedSvg), [currentBindingsManifest, operatorValues, customizedSvg]);
  const vizrtScenePlan = useMemo(() => buildVizrtScenePlan(currentBindingsManifest, operatorValues, customizedSvg), [currentBindingsManifest, operatorValues, customizedSvg]);
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
    if (didApplyDeepLinkRef.current || typeof window === 'undefined') {
      return;
    }

    didApplyDeepLinkRef.current = true;
    const linkedFigmaUrl = readFigmaUrlFromDeepLink(window.location.search);
    if (!linkedFigmaUrl) {
      return;
    }

    setFigmaUrl(linkedFigmaUrl);

    const parsedIdentifiers = extractFigmaIdentifiers(linkedFigmaUrl);
    if (!parsedIdentifiers?.fileKey || !parsedIdentifiers.nodeIds) {
      setStatus('Loaded a shared Figma link from the URL. It still needs a node id before the preview can be generated.');
      return;
    }

    if (!defaultToken) {
      setStatus('Loaded a shared Figma link from the URL. Add VITE_FIGMA_TOKEN to fetch the preview in this environment.');
      return;
    }

    void generateFromApi(linkedFigmaUrl);
  }, []);

  useEffect(() => {
    syncFigmaUrlToDeepLink(figmaUrl);
  }, [figmaUrl]);

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
    const missingManifest = JSON.stringify({
      imageRefs: Object.fromEntries(imageSummary.unresolvedImageRefs.map((imageRef) => [imageRef, ''])),
    }, null, 2);
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
        ? nextFontAudit.map((font) => `- ${font.family}: ${font.usageCount} layer(s), browser=${font.availableInBrowser === null ? 'unknown' : font.availableInBrowser ? 'available' : 'missing'}, risk=${font.risk}${font.postScriptNames.length > 0 ? `, postScript=${font.postScriptNames.join('/')}` : ''}`)
        : ['- No font usage detected']),
      '',
      'Dynamic bindings summary:',
      ...(bindingsManifest.items.length > 0
        ? bindingsManifest.items.map((item) => `- ${item.fieldKey}: ${item.bindingType} -> ${item.nodeName} (${item.svgId})${item.bindingType === 'color' && item.colorValue ? ` value=${item.colorValue}` : ''}`)
        : ['- No dynamic bindings detected']),
      '',
      'Binding naming validation:',
      ...(bindingsManifest.validationIssues.length > 0
        ? bindingsManifest.validationIssues.map((issue) => `- ${issue}`)
        : ['- All detected dynamic candidates follow the naming convention']),
      '',
      result.report,
    ].join('\n');

    if (previewRequestIdRef.current !== requestId) {
      return;
    }

    setCurrentSvg(result.svg);
    setCurrentReport(operatorReport);
    setCurrentMissingManifest(missingManifest);
    setCurrentNormalizedJson(JSON.stringify(preparedSource, null, 2));
    setCurrentBindingsManifest(bindingsManifest);
    setOperatorValues(buildInitialOperatorValues(bindingsManifest));
    setCurrentWarnings(result.warnings);
    setFontAudit(nextFontAudit);
    setImageRefs(imageSummary.detectedImageRefs);
    setPrepChecklist(buildPrepChecklist(preparedSource, result.warnings));
    setStatus(
      imageSummary.unresolvedImageRefs.length > 0
        ? 'Preview generated. Some remote image fills were not resolved; review the report before import.'
        : 'Preview generated. Review compatibility notes before importing into XPression.',
    );

    setFigmaPreviewSvg('');
    void (async () => {
      try {
        const renderedSvg = await fetchFigmaRenderedSvg({
          token: defaultToken,
          fileKey,
          nodeIds,
        });

        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setFigmaPreviewSvg(renderedSvg);
      } catch {
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setFigmaPreviewSvg('');
      }
    })();
  }

  async function generateFromApi(inputUrl = figmaUrl) {
    if (!defaultToken) {
      setStatus('Add VITE_FIGMA_TOKEN to .env.local and restart the Vite dev server before fetching.');
      return;
    }

    const parsed = extractFigmaIdentifiers(inputUrl);
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

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadText(text: string, fileName: string, mimeType: string) {
    const blob = new Blob([text], { type: mimeType });
    downloadBlob(blob, fileName);
  }

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(successMessage);
    } catch {
      setStatus('Could not copy to clipboard in this browser session.');
    }
  }

  async function copyShareLink() {
    if (!figmaUrl.trim()) {
      setStatus('Paste a Figma URL before copying a share link.');
      return;
    }

    if (typeof window === 'undefined') {
      setStatus('Could not build a share link in this environment.');
      return;
    }

    const shareHref = new URL(buildAppDeepLinkHref(window.location.href, figmaUrl), window.location.origin).toString();
    await copyText(shareHref, 'Share link copied to clipboard.');
  }

  async function downloadDeliveryPackage(target: DeliveryTarget) {
    if (!hasPreview) {
      setStatus('Generate a preview before downloading a delivery package.');
      return;
    }

    const zip = new JSZip();
    const checklist = buildDeliveryChecklist({
      target,
      warnings: currentWarnings,
      fontAudit,
      bindingsManifest: currentBindingsManifest,
      missingManifest: currentMissingManifest,
      hasPreview,
    });
    const checklistText = checklist
      .map((item) => `[${item.status.toUpperCase()}] ${item.title}\n${item.detail}`)
      .join('\n\n');

    zip.file('report.txt', currentReport);
    zip.file('checklist.txt', checklistText);

    if (target === 'template') {
      zip.file('graphic.svg', currentSvg);
      zip.file('xpression-svg-import-template.txt', xpressionTemplate);
      zip.file('xpression-bindings.json', JSON.stringify(currentBindingsManifest, null, 2));
      zip.file('xpression-data.json', xpressionDataPayload);
      if (currentMissingManifest && currentMissingManifest !== emptyMissingManifest) {
        zip.file('assets-manifest.json', currentMissingManifest);
      }
    } else if (target === 'native') {
      zip.file('xpression-native-plan.txt', xpressionPrimitivePlan);
      zip.file('xpression-bindings.json', JSON.stringify(currentBindingsManifest, null, 2));
      zip.file('xpression-data.json', xpressionDataPayload);
      if (currentMissingManifest && currentMissingManifest !== emptyMissingManifest) {
        zip.file('assets-manifest.json', currentMissingManifest);
      }
    } else if (target === 'vizrt') {
      zip.file('vizrt-native-plan.txt', vizrtScenePlan);
      zip.file('vizrt-bindings.json', JSON.stringify(currentBindingsManifest, null, 2));
      zip.file('vizrt-data.json', vizrtDataPayload);
      if (currentMissingManifest && currentMissingManifest !== emptyMissingManifest) {
        zip.file('vizrt-assets-manifest.json', currentMissingManifest);
      }
    } else {
      zip.file('vizrt-assets.svg', customizedSvg);
      zip.file('vizrt-assets-manifest.json', currentMissingManifest || emptyMissingManifest);
    }

    setStatus(`Preparing ${deliveryTargetLabel} package...`);
    const blob = await zip.generateAsync({ type: 'blob' });
    const fileName = target === 'template'
      ? `${downloadBaseName}-xpression-svg-package.zip`
      : target === 'native'
        ? `${downloadBaseName}-xpression-native-package.zip`
        : target === 'vizrt'
          ? `${downloadBaseName}-vizrt-native-package.zip`
          : `${downloadBaseName}-vizrt-svg-assets-package.zip`;
    downloadBlob(blob, fileName);
    setStatus(`${deliveryTargetLabel} package downloaded.`);
  }

  const downloadBaseName = slugFromFileName(figmaSourceLabel, 'figma');
  const xpressionRiskSummary = currentWarnings ? summarizeRisks(currentWarnings) : [];
  const vizrtRiskSummary = currentWarnings ? summarizeVizrtRisks(currentWarnings) : [];
  const deliveryTargetLabel = activeDeliveryTarget === 'vizrt'
    ? 'Vizrt Native'
    : activeDeliveryTarget === 'vizrt-svg'
      ? 'Vizrt SVG Assets'
    : activeDeliveryTarget === 'template'
      ? 'XPression SVG Import'
      : 'XPression Native';
  const readinessRiskSummary = activeDeliveryTarget === 'vizrt' || activeDeliveryTarget === 'vizrt-svg' ? vizrtRiskSummary : xpressionRiskSummary;
  const deliveryChecklist = buildDeliveryChecklist({
    target: activeDeliveryTarget,
    warnings: currentWarnings,
    fontAudit,
    bindingsManifest: currentBindingsManifest,
    missingManifest: currentMissingManifest,
    hasPreview,
  });
  return (
    <div className="min-h-screen bg-transparent text-espn-slate">
      <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5">
        <section className="rounded-[18px] border border-espn-border bg-white px-4 py-3 shadow-panel">
          <div>
            <h1 className="mt-1 text-xl font-semibold leading-tight tracking-[-0.03em] text-espn-slate sm:text-2xl">
              Live graphics prep for XPression & Vizrt
            </h1>
            <p className="mt-1 text-xs text-espn-muted">Load a Figma node, preview it, then choose between XPression SVG import, XPression native build, Vizrt native build, or Vizrt SVG asset handoffs.</p>
          </div>
        </section>

        <section className="rounded-[18px] border border-espn-border bg-white p-4 shadow-panel">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-espn-muted">Figma URL</span>
              <input
                value={figmaUrl}
                onChange={(event) => setFigmaUrl(event.target.value)}
                placeholder="Paste a Figma file or node URL"
                className="h-10 w-full rounded-xl border border-espn-border bg-[#f5f6f7] px-3 text-sm outline-none transition focus:border-espn-red"
              />
            </label>
            <button type="button" onClick={() => {
              void generateFromApi();
            }} className="h-10 rounded-xl border border-espn-border bg-[#f5f6f7] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">
              Generate Preview
            </button>
            <button type="button" onClick={() => {
              void copyShareLink();
            }} className="h-10 rounded-xl border border-espn-border bg-[#f5f6f7] px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">
              Copy Share Link
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hasMeaningfulStatus ? <p className="text-xs leading-5 text-espn-muted">{status}</p> : null}
          </div>

        </section>

        <section className="grid gap-3">
          <div className="space-y-3">
            <section className="rounded-[18px] border border-espn-border bg-white p-4 shadow-panel">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-espn-slate">Preview</h2>
                  <span className="text-xs text-espn-muted">
                    {imageRefs.length > 0 ? `${imageRefs.length} image ref${imageRefs.length === 1 ? '' : 's'} detected` : 'No output yet'}
                  </span>
                </div>
                {hasPreview ? <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-muted">Workflow tabs below</p> : null}
              </div>

              {hasPreview ? (
                <div className="mt-3 flex flex-wrap gap-1.5 border-b border-espn-border pb-3">
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
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
                <section className="min-w-0 rounded-[18px] border border-espn-border bg-white shadow-panel">
                  <div className="border-b border-espn-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-espn-slate">Workspace</h3>
                        <p className="mt-1 text-xs leading-5 text-espn-muted">Switch between editing, reporting, XPression delivery modes, Vizrt native build, and Vizrt SVG asset export without stacking disclosures.</p>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <TabButton label="XPression Native" active={activeOutputPanel === 'native'} onClick={() => {
                          setActiveOutputPanel('native');
                          setActiveDeliveryTarget('native');
                        }} />
                        <TabButton label="XPression SVG Import" active={activeOutputPanel === 'template'} onClick={() => {
                          setActiveOutputPanel('template');
                          setActiveDeliveryTarget('template');
                        }} />
                        <TabButton label="Vizrt Native" active={activeOutputPanel === 'vizrt'} onClick={() => {
                          setActiveOutputPanel('vizrt');
                          setActiveDeliveryTarget('vizrt');
                        }} />
                        <TabButton label="Vizrt SVG Assets" active={activeOutputPanel === 'vizrt-svg'} onClick={() => {
                          setActiveOutputPanel('vizrt-svg');
                          setActiveDeliveryTarget('vizrt-svg');
                        }} />
                        <TabButton label="Live Edit" active={activeOutputPanel === 'editor'} onClick={() => setActiveOutputPanel('editor')} />
                        <TabButton label="Report" active={activeOutputPanel === 'report'} onClick={() => setActiveOutputPanel('report')} />
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 px-4 py-4">
                    {activeOutputPanel === 'editor' ? (
                      currentBindingsManifest && currentBindingsManifest.items.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-xs leading-5 text-espn-muted">Edit text, image, and color bindings here to preview live operator changes without switching to a separate controls panel.</p>
                          {currentBindingsManifest.items.map((item) => (
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
                              {item.bindingType === 'text' ? (
                                <textarea
                                  value={operatorValues[item.fieldKey] ?? ''}
                                  onChange={(event) => setOperatorValues((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                                  rows={Math.max(2, String(operatorValues[item.fieldKey] ?? item.textSample ?? '').split('\n').length)}
                                  placeholder="Enter live text preview value"
                                  className="mt-2 w-full rounded-xl border border-espn-border bg-white px-3 py-2 text-sm outline-none transition focus:border-espn-red"
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={operatorValues[item.fieldKey] ?? ''}
                                  onChange={(event) => setOperatorValues((current) => ({ ...current, [item.fieldKey]: event.target.value }))}
                                  placeholder={item.bindingType === 'image' ? 'Paste a replacement logo URL' : item.bindingType === 'color' ? 'Enter #RRGGBB or gradient stops' : 'Enter live preview value'}
                                  className="mt-2 w-full rounded-xl border border-espn-border bg-white px-3 py-2 text-sm outline-none transition focus:border-espn-red"
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      ) : <p className="text-xs text-espn-muted">No live binding fields were detected in this preview.</p>
                    ) : null}

                    {activeOutputPanel === 'report' ? (
                      <>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => downloadText(currentReport, `${downloadBaseName}-xpression.report.txt`, 'text/plain')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Download Report</button>
                        </div>
                        <pre className="max-w-full overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{currentReport}</pre>
                      </>
                    ) : null}

                    {activeOutputPanel === 'template' ? (
                      <>
                        <p className="mb-3 text-xs leading-5 text-espn-muted">Use this when you want to keep the current SVG-based XPression workflow and map fields onto an imported SVG scene.</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void downloadDeliveryPackage('template')} className="rounded-xl border border-espn-red bg-espn-red px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_rgba(194,32,38,0.22)] transition hover:bg-[#a91b20] hover:border-[#a91b20]">Download XPression SVG Package</button>
                          <button type="button" onClick={() => void copyText(xpressionTemplate, 'XPression template copied to clipboard.')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Copy Template</button>
                        </div>
                        <pre className="max-w-full overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{xpressionTemplate}</pre>
                      </>
                    ) : null}

                    {activeOutputPanel === 'native' ? (
                      <>
                        <p className="mb-3 text-xs leading-5 text-espn-muted">Use this when you want to rebuild the graphic natively in XPression with slabs, text objects, image objects, masks, and material/effect stacks.</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void downloadDeliveryPackage('native')} className="rounded-xl border border-espn-red bg-espn-red px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_rgba(194,32,38,0.22)] transition hover:bg-[#a91b20] hover:border-[#a91b20]">Download XPression Native Package</button>
                          <button type="button" onClick={() => void copyText(xpressionPrimitivePlan, 'XPression native primitives plan copied to clipboard.')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Copy XPression Plan</button>
                        </div>
                        <pre className="max-w-full overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{xpressionPrimitivePlan}</pre>
                      </>
                    ) : null}

                    {activeOutputPanel === 'vizrt' ? (
                      <>
                        <p className="mb-3 text-xs leading-5 text-espn-muted">Use this when you want to rebuild the graphic natively in Viz Artist with containers, text objects, image materials, shapes, and effect stacks instead of importing SVG.</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void downloadDeliveryPackage('vizrt')} className="rounded-xl border border-espn-red bg-espn-red px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_rgba(194,32,38,0.22)] transition hover:bg-[#a91b20] hover:border-[#a91b20]">Download Vizrt Native Package</button>
                          <button type="button" onClick={() => void copyText(vizrtScenePlan, 'Vizrt native build plan copied to clipboard.')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Copy Vizrt Plan</button>
                        </div>
                        <pre className="max-w-full overflow-auto rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{vizrtScenePlan}</pre>
                      </>
                    ) : null}

                    {activeOutputPanel === 'vizrt-svg' ? (
                      <>
                        <p className="mb-3 text-xs leading-5 text-espn-muted">Use this when Viz needs SVG artwork as reference or static vector assets. This is not the same as the XPression SVG import workflow and should be treated as an asset export, not a bindable scene handoff.</p>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void downloadDeliveryPackage('vizrt-svg')} className="rounded-xl border border-espn-red bg-espn-red px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_rgba(194,32,38,0.22)] transition hover:bg-[#a91b20] hover:border-[#a91b20]">Download Vizrt SVG Asset Package</button>
                        </div>
                        <pre className="min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-[#141414] p-4 text-[11px] leading-5 text-espn-offwhite">{customizedSvg || 'No Vizrt SVG asset export yet.'}</pre>
                      </>
                    ) : null}
                  </div>
                </section>

                <section className="min-w-0 rounded-[18px] border border-espn-border bg-white shadow-panel xl:sticky xl:top-3 xl:flex xl:h-[calc(100vh-1.5rem)] xl:flex-col xl:overflow-hidden">
                  <div className="border-b border-espn-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-espn-slate">Inspector</h3>
                        <p className="mt-1 text-xs leading-5 text-espn-muted">Operational controls are shared across outputs. Readiness is currently showing guidance for {deliveryTargetLabel}.</p>
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        <TabButton label="Readiness" active={activeInspectorTab === 'readiness'} onClick={() => setActiveInspectorTab('readiness')} />
                        <TabButton label="Bindings" active={activeInspectorTab === 'bindings'} onClick={() => setActiveInspectorTab('bindings')} />
                        <TabButton label="Fonts" active={activeInspectorTab === 'fonts'} onClick={() => setActiveInspectorTab('fonts')} />
                        <TabButton label="Prep" active={activeInspectorTab === 'prep'} onClick={() => setActiveInspectorTab('prep')} />
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 px-4 py-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-2">
                    {activeInspectorTab === 'readiness' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl bg-[#f7f7f7] p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-espn-muted">Current target</p>
                          <p className="mt-2 text-xs leading-5 text-espn-slate">{deliveryTargetLabel}</p>
                          <p className="mt-1 text-xs leading-5 text-espn-muted">
                            Shared tabs like Bindings, Fonts, and Prep stay tied to the source graphic. This Readiness view adapts to the selected delivery path.
                          </p>
                        </div>
                        <DeliveryChecklistCard title={`${deliveryTargetLabel} checklist`} items={deliveryChecklist} />
                        <MetricGroup title={`${deliveryTargetLabel} risks`} items={readinessRiskSummary.length > 0 ? readinessRiskSummary : [`No ${deliveryTargetLabel.toLowerCase()} compatibility risks detected in the supported feature set`]} />
                        <MetricGroup
                          title="Binding validation"
                          items={currentBindingsManifest && currentBindingsManifest.validationIssues.length > 0
                            ? currentBindingsManifest.validationIssues
                            : ['All detected dynamic candidates follow the naming convention']}
                        />
                      </div>
                    ) : null}

                    {activeInspectorTab === 'bindings' ? (
                      <div className="space-y-3">
                        <MetricGroup
                          title="Live fields"
                          items={currentBindingsManifest && currentBindingsManifest.items.length > 0
                            ? currentBindingsManifest.items.map((item) => `${item.fieldKey} -> ${item.bindingType}${item.bindingType === 'color' && item.colorValue ? ` (${item.colorValue})` : ''}${item.conventionStatus === 'warn' ? ' (rename)' : ''}`)
                            : ['No dynamic text or image candidates detected']}
                        />
                      </div>
                    ) : null}

                    {activeInspectorTab === 'fonts' ? (
                      <>
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
                      </>
                    ) : null}

                    {activeInspectorTab === 'prep' ? (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => downloadText(currentNormalizedJson, `${downloadBaseName}-normalized.json`, 'application/json')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Download Normalized JSON</button>
                          {currentMissingManifest && currentMissingManifest !== '{\n  "imageRefs": {}\n}' ? (
                            <button type="button" onClick={() => downloadText(currentMissingManifest, `${downloadBaseName}-assets-manifest.json`, 'application/json')} className="rounded-xl border border-espn-border bg-[#f5f6f7] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-espn-slate">Download Missing-Ref Manifest</button>
                          ) : null}
                        </div>
                        {prepChecklist.map((item) => (
                          <div key={item.title} className="rounded-2xl bg-[#F7F7F7] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-espn-slate">{item.title}</p>
                            <p className="mt-1 text-xs leading-5 text-espn-muted">{item.detail}</p>
                          </div>
                        ))}
                        {prepChecklist.length === 0 ? <p className="text-xs text-espn-muted">Generate a preview to see source normalization guidance.</p> : null}
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricGroup({ title, items }: { title: string; items: string[] }) {
  const shouldScroll = items.length > 8;
  return (
    <div className="rounded-2xl bg-[#f7f7f7] p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-espn-muted">{title}</h4>
      <ul className={`mt-2 flex flex-wrap gap-1.5 ${shouldScroll ? 'max-h-32 overflow-y-auto pr-1' : ''}`}>
        {items.map((item, index) => (
          <li key={`${title}-${index}-${item}`} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-espn-slate">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeliveryChecklistCard({ title, items }: { title: string; items: DeliveryChecklistItem[] }) {
  return (
    <div className="rounded-2xl bg-[#f7f7f7] p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-espn-muted">{title}</h4>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={`${item.title}-${item.status}`} className="rounded-2xl bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-espn-slate">{item.title}</p>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${item.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : item.status === 'attention' ? 'bg-red-100 text-espn-red' : 'bg-zinc-200 text-espn-slate'}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-espn-muted">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${active ? 'border-espn-slate bg-espn-slate text-white' : 'border-espn-border bg-[#f5f6f7] text-espn-slate'}`}
    >
      {label}
    </button>
  );
}

export default App;