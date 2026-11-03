import { defineConfig } from 'vite'
import { buildIdentityPlugin } from './scripts/build-identity.ts'

export default defineConfig({
  plugins: [buildIdentityPlugin()],
  worker: { plugins: () => [buildIdentityPlugin(false)] },
  server: { host: 'localhost', port: 5173, strictPort: true },
  preview: { host: 'localhost', port: 4173, strictPort: true },
  build: { target: 'es2023' },
})
