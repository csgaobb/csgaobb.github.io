/// <reference types="vite/client" />

declare module "virtual:sqlite3-wasm" {
  const wasmBinary: Uint8Array;
  export default wasmBinary;
}

