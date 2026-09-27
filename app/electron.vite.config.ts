import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

/** Релизы лежат в репозитории из package.json; `latest` всегда указывает на последний. */
const updateFeedUrl = `${packageJson.repository.url}/releases/latest/download`

export default defineConfig({
  main: {
    define: {
      __UPDATE_FEED_URL__: JSON.stringify(updateFeedUrl)
    }
  },
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
