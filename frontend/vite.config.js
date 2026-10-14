import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Build stamp: Vercel injects VERCEL_GIT_COMMIT_SHA at build time, so the
  // running UI can show exactly which commit it was built from. Local builds
  // show the git HEAD (or 'dev' when git is unavailable).
  define: {
    __APP_COMMIT__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'
    ),
  },
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
