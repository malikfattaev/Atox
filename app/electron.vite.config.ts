import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

/** Релизы лежат в репозитории из package.json; `latest` всегда указывает на последний. */
const updateFeedUrl = `${packageJson.repository.url}/releases/latest/download`

/** Ключ приложения Atox в Aptabase: публичный, он только направляет анонимную статистику. */
const usageStatsAppKey = 'A-EU-3104499833'

export default defineConfig({
  main: {
    define: {
      __UPDATE_FEED_URL__: JSON.stringify(updateFeedUrl),
      __USAGE_STATS_APP_KEY__: JSON.stringify(usageStatsAppKey)
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Команда `atox` для агентов: её запускает бинарник приложения в режиме Node.
          atox: resolve(__dirname, 'src/cli/atox.ts')
        },
        // Встроенный модуль Electron — файловые функции без поддержки asar.
        external: ['original-fs']
      }
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
