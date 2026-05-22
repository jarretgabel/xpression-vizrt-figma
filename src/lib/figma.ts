import type { FigmaNode, FigmaSource, ImageAssets, RemoteImageSummary } from '../types';

const DEFAULT_API_BASE = import.meta.env.VITE_FIGMA_API_BASE || 'https://api.figma.com/v1';

export function baseName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export function slugFromFileName(fileName: string, fallbackValue: string) {
  const stem = baseName(fileName || fallbackValue || 'output');
  return stem.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'output';
}

export async function fileToDataUrl(file: File | Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read file data.'));
    reader.readAsDataURL(file);
  });
}

export function isLikelyFigmaExport(json: unknown): json is FigmaSource {
  return Boolean(json && typeof json === 'object' && 'nodes' in json && typeof (json as FigmaSource).nodes === 'object');
}

export function collectImageRefs(node: FigmaNode | undefined, refs = new Set<string>()) {
  if (!node) {
    return refs;
  }

  for (const fill of node.fills || []) {
    if (fill.type === 'IMAGE' && fill.imageRef) {
      refs.add(fill.imageRef);
    }
  }

  for (const child of node.children || []) {
    collectImageRefs(child, refs);
  }

  return refs;
}

export function collectImageRefsFromSource(figmaSource: FigmaSource) {
  const firstNodeKey = Object.keys(figmaSource.nodes || {})[0];
  const root = figmaSource.nodes?.[firstNodeKey]?.document;
  return Array.from(collectImageRefs(root)).sort();
}

function buildFigmaImageFillApiUrl(fileKey: string) {
  return `${DEFAULT_API_BASE}/files/${encodeURIComponent(fileKey)}/images`;
}

function buildFigmaRenderedImageApiUrl(fileKey: string, nodeIds: string) {
  const url = new URL(`${DEFAULT_API_BASE}/images/${encodeURIComponent(fileKey)}`);
  url.searchParams.set('ids', nodeIds);
  url.searchParams.set('format', 'svg');
  url.searchParams.set('svg_include_id', 'true');
  url.searchParams.set('use_absolute_bounds', 'true');
  return url.toString();
}

function detectMimeTypeFromUrl(url: string) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('.svg')) {
    return 'image/svg+xml';
  }
  if (lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerUrl.includes('.webp')) {
    return 'image/webp';
  }
  return 'image/png';
}

async function fetchImageFillMap(fileKey: string, token: string) {
  const response = await fetch(buildFigmaImageFillApiUrl(fileKey), {
    headers: {
      'X-Figma-Token': token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Figma image lookup failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json() as { meta?: { images?: Record<string, string> }; images?: Record<string, string> };
  return payload.meta?.images || payload.images || {};
}

export async function fetchFigmaRenderedSvg(params: {
  token: string;
  fileKey: string;
  nodeIds: string;
}) {
  const response = await fetch(buildFigmaRenderedImageApiUrl(params.fileKey, params.nodeIds), {
    headers: {
      'X-Figma-Token': params.token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Figma SVG render lookup failed (${response.status}): ${errorText || response.statusText}`);
  }

  const payload = await response.json() as { images?: Record<string, string | null>; err?: string };
  const renderedUrl = Object.values(payload.images || {}).find((value): value is string => Boolean(value));
  if (!renderedUrl) {
    throw new Error(payload.err || 'Figma did not return a rendered SVG URL for that node.');
  }

  const svgResponse = await fetch(renderedUrl);
  if (!svgResponse.ok) {
    throw new Error(`Fetching rendered SVG failed (${svgResponse.status}): ${svgResponse.statusText}`);
  }

  return svgResponse.text();
}

export async function buildRemoteImageAssets(figmaSource: FigmaSource, fileKey: string, token: string) {
  const imageRefs = collectImageRefsFromSource(figmaSource);
  const assets: ImageAssets = {};
  const resolvedImageRefs: string[] = [];

  if (imageRefs.length === 0) {
    return {
      assets,
      summary: {
        detectedImageRefs: [],
        resolvedImageRefs: [],
        unresolvedImageRefs: [],
      } satisfies RemoteImageSummary,
    };
  }

  const imageFillMap = await fetchImageFillMap(fileKey, token);

  for (const imageRef of imageRefs) {
    const remoteUrl = imageFillMap[imageRef];
    if (!remoteUrl) {
      continue;
    }

    const assetResponse = await fetch(remoteUrl);
    if (!assetResponse.ok) {
      continue;
    }

    const blob = await assetResponse.blob();
    const mimeType = blob.type || detectMimeTypeFromUrl(remoteUrl);
    const normalizedBlob = blob.type ? blob : blob.slice(0, blob.size, mimeType);

    assets[imageRef] = {
      dataUri: await fileToDataUrl(normalizedBlob),
      source: `Figma image fill ${imageRef}`,
    };
    resolvedImageRefs.push(imageRef);
  }

  return {
    assets,
    summary: {
      detectedImageRefs: imageRefs,
      resolvedImageRefs,
      unresolvedImageRefs: imageRefs.filter((imageRef) => !resolvedImageRefs.includes(imageRef)),
    } satisfies RemoteImageSummary,
  };
}

export function normalizeNodeIds(rawValue: string) {
  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/-/g, ':'))
    .join(',');
}

export function extractFigmaIdentifiers(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    const fileIndex = parts.findIndex((part) => part === 'file' || part === 'design');
    const fileKey = fileIndex >= 0 ? parts[fileIndex + 1] : '';
    const nodeIds = normalizeNodeIds(url.searchParams.get('node-id') || url.searchParams.get('ids') || '');

    if (!fileKey) {
      return null;
    }

    return {
      fileKey,
      nodeIds,
    };
  } catch {
    return null;
  }
}

export function buildFigmaApiUrl(fileKey: string, nodeIds: string) {
  const url = new URL(`${DEFAULT_API_BASE}/files/${encodeURIComponent(fileKey)}/nodes`);
  url.searchParams.set('ids', nodeIds);
  url.searchParams.set('geometry', 'paths');
  return url.toString();
}

export async function fetchFigmaSourceFromApi(params: {
  token: string;
  fileKey: string;
  nodeIds: string;
}) {
  const response = await fetch(buildFigmaApiUrl(params.fileKey, params.nodeIds), {
    headers: {
      'X-Figma-Token': params.token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Figma API request failed (${response.status}): ${errorText || response.statusText}`);
  }

  const json = (await response.json()) as FigmaSource;
  if (!isLikelyFigmaExport(json)) {
    throw new Error('The Figma API response did not include a nodes payload.');
  }

  return json;
}