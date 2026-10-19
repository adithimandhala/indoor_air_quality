import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: { host: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/')
          if (modulePath.includes('/node_modules/three-stdlib/')) return 'three-controls'
          if (modulePath.includes('/node_modules/@react-three/drei/')) return 'react-three-drei'
          if (modulePath.includes('/node_modules/@react-three/fiber/')) return 'react-three-fiber'
          if (modulePath.includes('/node_modules/three/')) return 'three-core'
        },
      },
    },
  },
})
