import { Buffer } from "buffer";

// Browser polyfills required by the Midnight runtime stack under Vite.
// Some third-party libraries also expect a `process` global.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).process = {
  env: { NODE_ENV: import.meta.env.MODE }
};
globalThis.Buffer = Buffer;
