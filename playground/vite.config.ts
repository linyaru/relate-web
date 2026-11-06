import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The engine is the site's public/wasm, which the worker loads from /wasm/ at
// runtime (src/lib/engine.worker.ts), and index.html links the site's
// favicons from the site root. The site serves both in production; this
// serves them to the playground's own dev server.
const SITE_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const SITE_WASM = join(SITE_PUBLIC, 'wasm/')
const SITE_FAVICONS = new Set(['/favicon.svg', '/favicon-32.png', '/favicon-192.png'])
const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.ts': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
function serveFile(path: string, res: import('node:http').ServerResponse) {
  res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream')
  res.end(readFileSync(path))
}
function siteWasm(): Plugin {
  return {
    name: 'site-wasm',
    configureServer(server) {
      server.middlewares.use('/wasm', (req, res, next) => {
        const path = normalize(join(SITE_WASM, decodeURIComponent((req.url ?? '/').split('?')[0])))
        if (!path.startsWith(SITE_WASM) || !existsSync(path) || !statSync(path).isFile()) return next()
        serveFile(path, res)
      })
      // The dev server prefixes index.html's root links with the base
      // (/playground/favicon.svg); the build leaves them at the site root.
      const base = server.config.base
      server.middlewares.use((req, res, next) => {
        let url = (req.url ?? '').split('?')[0]
        if (url.startsWith(base)) url = `/${url.slice(base.length)}`
        if (!SITE_FAVICONS.has(url)) return next()
        serveFile(join(SITE_PUBLIC, url.slice(1)), res)
      })
    },
  }
}

export default defineConfig({
  // Published under /playground/ on the site (https://relatedb.ai/).
  // `vite dev` is unaffected because base only applies to `vite build`.
  base: '/playground/',
  plugins: [react(), siteWasm()],
  server: {
    port: 5173,
    // The cookbook's cell policy (src/lib/cookbook/cells.ts in the site) is
    // imported, not copied, so the dev server may serve it.
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../src/lib/cookbook', import.meta.url)),
      ],
    },
  },
  build: {
    sourcemap: false,
    // esbuild's minifier renames identifiers into short names that collide
    // with labeled statements used inside dagre/graphlib and
    // cypher-language-support (`t:`, `e:`, ...), producing "Undefined label"
    // at runtime. Terser is label-aware and handles it correctly.
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      mangle: true,
    },
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // React (+ scheduler / jsx runtime) into a dedicated chunk so every
          // consumer chunk resolves the same CJS-interop namespace. Splitting
          // React across chunks (or leaving it in the entry) breaks
          // `React.memo`/`useLayoutEffect` in `@neo4j-nvl/react` and other CJS
          // vendor packages because their chunk sees a different binding than
          // the one that populated `default.memo` at init time.
          if (id.includes('/react/') || id.includes('/react-dom/') ||
              id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('/@neo4j-nvl/') || id.includes('/cytoscape') ||
              id.includes('/@neo4j-bloom/dagre/') || id.includes('/graphlib/') ||
              id.includes('/workerpool/') || id.includes('/bin-pack/')) {
            return 'vendor-nvl';
          }
          if (id.includes('/@neo4j-cypher/') || id.includes('/@codemirror/') ||
              id.includes('/@lezer/') || id.includes('/codemirror/')) {
            return 'vendor-cm';
          }
          if (id.includes('/prismjs/') || id.includes('/refractor/')) return 'vendor-prism';
          return undefined;
        },
      },
    },
  },

  css: { devSourcemap: false },
  worker: { format: 'es' },
  optimizeDeps: {
    // These packages are CJS (or have deps that are) and their consumers
    // do `import X from 'x'`. Vite only emits the CJS→ESM default-export
    // shim when the package is pre-bundled by the dep optimizer, hence
    // the explicit include list.
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@neo4j-nvl/base',
      '@neo4j-nvl/react',
      '@neo4j-nvl/interaction-handlers',
      'bin-pack',
      '@neo4j-bloom/dagre',
      'graphlib',
      'cytoscape',
      'cytoscape-cose-bilkent',
      'prismjs',
      'workerpool',
      'lodash.debounce',
    ],
    // Both packages spawn workers via `new URL('./x.mjs', import.meta.url)`.
    // esbuild's dep optimizer does not emit worker files into .vite/deps, so
    // the URL 404s. Serving from real node_modules paths fixes it.
    exclude: ['@neo4j-nvl/layout-workers', '@neo4j-cypher/react-codemirror'],
  },
})
