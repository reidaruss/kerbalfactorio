// An ES-module worker, which is the shape DW-4 / vite `worker.format: 'es'`
// actually ships. A classic worker is not a substitute here: module workers are
// the ones an opaque origin refuses.
import { ANSWER } from './probe.worker.dep.js';

self.postMessage({ ok: true, answer: ANSWER });
