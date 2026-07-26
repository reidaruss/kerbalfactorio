// Imported by probe.worker.js. Its only job is to make the worker a REAL module
// worker with a static import, so the test cannot pass by accident on a runtime
// that treats `{type:'module'}` as a hint.
export const ANSWER = 42;
