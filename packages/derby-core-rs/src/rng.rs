//! Deterministic keccak-based stream RNG (matches the TS "derive stream seed" pattern conceptually).
//!
//! We intentionally keep this RNG "random access":
//! rng(seed, car_id, stream, index) is O(1) (no need to iterate).

use tiny_keccak::{Hasher, Keccak};
use crate::types::Bytes32;

fn keccak256(input: &[u8]) -> Bytes32 {
    let mut hasher = Keccak::v256();
    hasher.update(input);
    let mut out = [0u8; 32];
    hasher.finalize(&mut out);
    out
}

/// Derive a stream seed from base seed + metadata (carId, stream, index).
pub fn derive_stream_seed(base_seed: &Bytes32, car_id: u8, stream: &str, index: u32) -> Bytes32 {
    // TS does: metaHash = keccak256(toHex(`${carId}:${stream}:${index}`))
    // then keccak256(baseSeed || metaHash).
    // We'll build the same meta string bytes here (UTF-8).
    let meta = format!("{car_id}:{stream}:{index}");
    let meta_hash = keccak256(meta.as_bytes());

    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(base_seed);
    combined[32..].copy_from_slice(&meta_hash);

    keccak256(&combined)
}

/// Deterministic u32 "random" from stream seed.
pub fn rand_u32(base_seed: &Bytes32, car_id: u8, stream: &str, index: u32) -> u32 {
    let s = derive_stream_seed(base_seed, car_id, stream, index);
    u32::from_be_bytes([s[0], s[1], s[2], s[3]])
}

/// Deterministic integer in [0, n).
pub fn rand_range(base_seed: &Bytes32, car_id: u8, stream: &str, index: u32, n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    // Bias is negligible for our use; if needed, implement rejection sampling later.
    rand_u32(base_seed, car_id, stream, index) % n
}


