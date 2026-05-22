/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIGMA_TOKEN?: string;
  readonly VITE_FIGMA_API_BASE?: string;
  readonly VITE_FONT_SUBSTITUTIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}