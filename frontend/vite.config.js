import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts')) return 'charts';
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom') || id.includes('/scheduler/'))
            return 'react';
          if (id.includes('@supabase')) return 'data';
          if (id.includes('radix-ui') || id.includes('lucide-react') || id.includes('sonner') || id.includes('next-themes') || id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge'))
            return 'ui';
          return undefined;
        },
      },
    },
  },
})
