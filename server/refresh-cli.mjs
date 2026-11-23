import { refreshAll } from './refresh.mjs';

const t0 = Date.now();
refreshAll((m) => console.log(m))
  .then(() => { console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`); })
  .catch((e) => { console.error(e); process.exit(1); });
