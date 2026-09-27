import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    define: {
      __APP_NAME__: JSON.stringify(packageJson.build.productName),
      __APP_VERSION__: JSON.stringify(packageJson.version)
    },
    plugins: [react()]
  }
})
