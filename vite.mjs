// Builds or serves the UI with Vite's JS API (no vite.config file, so no esbuild config bundling).
//   node vite.mjs            -> dist/ for the Node server (npm start)
//   node vite.mjs --static   -> dist/ as a serverless static site (GitHub Pages): copies data/jobs.json + sources.json in
//   node vite.mjs --dev      -> dev server on :5173 proxying /api to :4317
import fs from 'node:fs';
import path from 'node:path';
import { build, createServer } from 'vite';
import react from '@vitejs/plugin-react';

const isStatic = process.argv.includes('--static');
if (isStatic) process.env.VITE_STATIC = '1';

// preserveSymlinks avoids realpath() calls into parent folders (needed in sandboxed shells; harmless elsewhere)
const common = { configFile: false, root: process.cwd(), base: './', plugins: [react()], resolve: { preserveSymlinks: true } };

if (process.argv.includes('--dev')) {
  const server = await createServer({
    ...common,
    base: '/',
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4317' } },
  });
  await server.listen();
  server.printUrls();
} else {
  await build({ ...common, build: { outDir: 'dist', sourcemap: false, emptyOutDir: true } });
  if (isStatic) {
    const { MANUAL_SOURCES, COMPANY_SOURCES } = await import('./server/sources.mjs');
    const { TECH_NAMES, ROLE_LABEL } = await import('./server/enrich.mjs');
    const snap = JSON.parse(fs.readFileSync(path.join('data', 'jobs.json'), 'utf8'));
    snap.meta = { ...snap.meta, refreshing: false, lastError: null, refreshHours: 6, techCatalog: TECH_NAMES, roleLabels: ROLE_LABEL };
    fs.writeFileSync(path.join('dist', 'jobs.json'), JSON.stringify(snap));
    fs.writeFileSync(path.join('dist', 'sources.json'), JSON.stringify({ manual: MANUAL_SOURCES, boards: COMPANY_SOURCES.map(([kind, slug, name]) => ({ kind, slug, name })) }));
    fs.writeFileSync(path.join('dist', '.nojekyll'), '');
    console.log(`static site: ${snap.jobs.length} jobs written to dist/jobs.json`);
  }
}
