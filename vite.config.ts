import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000'
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'vendor-react';
            if (id.includes('framer-motion')) return 'vendor-framer-motion';
            if (id.includes('tailwindcss')) return 'vendor-tailwind';
            if (id.includes('supabase')) return 'vendor-supabase';
            return 'vendor';
          }
        }
      }
    }
  }
})
