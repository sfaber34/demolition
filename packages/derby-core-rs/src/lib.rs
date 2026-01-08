mod fixed;
mod encode;
mod ai;
mod init;
mod physics;
mod rng;
mod sim;
mod trig;
mod types;

pub use fixed::{Fx, Vec2, SCALE};
pub use encode::{encode_world, state_hash};
pub use ai::ai_update;
pub use init::create_initial_world;
pub use physics::*;
pub use rng::{derive_stream_seed, rand_range, rand_u32, Bytes32};
pub use sim::{step_world, VICTORY_DELAY_MS};
pub use trig::cos_sin;
pub use types::*;

/// Convenience: compute a compact JSON snapshot for debugging/integration.
///
/// Note: For real integration, we’ll likely return a packed binary format instead of JSON.
pub fn snapshot_json(world: &World) -> String {
    serde_json::to_string(world).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(feature = "wasm")]
mod wasm_api {
    use super::*;
    use wasm_bindgen::prelude::*;

    /// A tiny WASM-friendly wrapper around `World`.
    #[wasm_bindgen]
    pub struct WorldHandle {
        world: World,
    }

    #[wasm_bindgen]
    impl WorldHandle {
        #[wasm_bindgen(constructor)]
        pub fn new() -> WorldHandle {
            WorldHandle { world: create_initial_world() }
        }

        /// Start playing (mirrors TS engine start/restart behavior).
        pub fn start(&mut self) {
            self.world.phase = GamePhase::Playing;
        }

        /// Step the world by `dt_ms` milliseconds.
        pub fn step(&mut self, dt_ms: u32) {
            step_world(&mut self.world, dt_ms);
        }

        /// Return keccak256 hash of the stable binary encoding of the world.
        pub fn state_hash_hex(&self) -> String {
            let h = state_hash(&self.world);
            let mut s = String::from("0x");
            for b in h.iter() {
                s.push_str(&format!("{:02x}", b));
            }
            s
        }

        /// Get the full world state as JSON (debug convenience).
        pub fn snapshot_json(&self) -> String {
            snapshot_json(&self.world)
        }
    }
}


