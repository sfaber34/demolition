//! Stable binary encoding + state hash (keccak256) for proofs/checkpoints.

use crate::rng::Bytes32;
use crate::types::{GamePhase, World};
use tiny_keccak::{Hasher, Keccak};

fn keccak256(input: &[u8]) -> Bytes32 {
    let mut h = Keccak::v256();
    h.update(input);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    out
}

/// Stable encoding (big-endian, versioned).
///
/// **Do not change** without bumping VERSION.
pub fn encode_world(world: &World) -> Vec<u8> {
    const VERSION: u8 = 1;
    let mut b = Vec::with_capacity(1 + 1 + 1 + 4 + 4 + 4 * 64);
    b.push(VERSION);
    b.push(match world.phase {
        GamePhase::Title => 0,
        GamePhase::Playing => 1,
        GamePhase::Victory => 2,
        GamePhase::GameOver => 3,
    });
    b.push(world.winner_id);
    b.extend_from_slice(&world.game_time_ms.to_be_bytes());
    b.extend_from_slice(&world.victory_time_ms.to_be_bytes());

    for car in world.cars.iter() {
        b.push(car.id);
        b.push(car.name_id);
        b.extend_from_slice(&car.color_rgb.to_be_bytes());
        b.push(if car.is_alive { 1 } else { 0 });
        b.extend_from_slice(&car.health.to_be_bytes());
        b.extend_from_slice(&car.max_health.to_be_bytes());
        b.extend_from_slice(&car.damage_dealt.to_be_bytes());

        // Fx raw values are i64
        for fx in [
            car.position.x.0,
            car.position.y.0,
            car.velocity.x.0,
            car.velocity.y.0,
            car.rotation_rad.0,
            car.angular_velocity.0,
            car.throttle.0,
            car.steer.0,
            car.acceleration.0,
            car.max_speed.0,
            car.cornering.0,
            car.traction.0,
            car.lateral_friction_dt8.0,
            car.width.0,
            car.height.0,
            car.last_position.x.0,
            car.last_position.y.0,
        ] {
            b.extend_from_slice(&fx.to_be_bytes());
        }
        b.push(car.ai_state);
    }

    // Collision cooldown matrix (5x5 u32)
    for row in world.collision_cooldowns_ms.iter() {
        for v in row.iter() {
            b.extend_from_slice(&v.to_be_bytes());
        }
    }

    b
}

pub fn state_hash(world: &World) -> Bytes32 {
    keccak256(&encode_world(world))
}


