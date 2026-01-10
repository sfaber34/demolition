This directory contains the **checked-in** wasm-bindgen output for the Rust derby engine.

It is committed so Vercel can deploy without installing Rust.

To regenerate (from repo root):

```bash
cd packages/derby-core-rs
cargo build --release --target wasm32-unknown-unknown --features wasm
wasm-bindgen \
  --target bundler \
  --out-dir ../nextjs/app/derby/engine/wasm/pkg \
  --out-name derby_core \
  target/wasm32-unknown-unknown/release/derby_core.wasm
```


