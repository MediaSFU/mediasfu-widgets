import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative assets keep the iframe app portable across CDN and local Lab paths.
  base: './',
  define: {
    'process.env': {},
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          mediasfu: ['mediasfu-reactjs'],
        },
      },
    },
  },
  server: {
    port: 3002,
    cors: true,
    headers: {
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
    },
  },
  preview: {
    port: 3002,
  },
});
