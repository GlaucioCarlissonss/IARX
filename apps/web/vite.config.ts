import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Build em arquivo único.
 *
 * A aplicação precisa ser abrível sem servidor: o entregável é um HTML com CSS e
 * JS embutidos. Quando houver hospedagem e API real, basta remover o plugin
 * viteSingleFile para voltar ao build normal com code splitting.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
