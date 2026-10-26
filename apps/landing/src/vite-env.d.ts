/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_APP_URL?: string;
  readonly PUBLIC_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
