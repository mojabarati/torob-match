/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INTENT_ENHANCER_ENABLED?: string
  readonly VITE_INTENT_ENHANCER_ENDPOINT?: string
  readonly VITE_INTENT_ENHANCER_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
