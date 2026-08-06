import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        target: 'es2020',
        // Mermaid and html2pdf are loaded on demand (see their modules), so the
        // only thing worth pinning into its own chunk is Monaco — it is always
        // needed, and splitting it lets the browser cache it across builds.
        rollupOptions: {
            output: {
                manualChunks: {
                    monaco: ['monaco-editor/esm/vs/editor/editor.api'],
                    highlight: ['highlight.js/lib/core']
                }
            }
        },
        chunkSizeWarningLimit: 2600
    },
    worker: {
        format: 'es'
    }
});
