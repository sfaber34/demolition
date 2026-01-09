//! Stable binary encoding + state hash (keccak256) for proofs/checkpoints.

use crate::types::{Bytes32, GamePhase, World};
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
    b.extend_from_slice(&world.run_seed);

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
        b.push(car.target_id);
        b.extend_from_slice(&car.tick.to_be_bytes());
        b.extend_from_slice(&car.evade_until_ms.to_be_bytes());
        b.extend_from_slice(&car.wall_avoid_until_ms.to_be_bytes());
        b.extend_from_slice(&car.recover_until_ms.to_be_bytes());
        b.push(car.recover_mode);
        b.push(if car.recover_wall_normal_valid { 1 } else { 0 });
        b.extend_from_slice(&car.recover_wall_normal.x.0.to_be_bytes());
        b.extend_from_slice(&car.recover_wall_normal.y.0.to_be_bytes());
        b.push(if car.waypoint_valid { 1 } else { 0 });
        b.extend_from_slice(&car.waypoint.x.0.to_be_bytes());
        b.extend_from_slice(&car.waypoint.y.0.to_be_bytes());
        b.extend_from_slice(&car.next_waypoint_at_tick.to_be_bytes());
        b.extend_from_slice(&car.waypoint_pick_count.to_be_bytes());
        b.push(if car.last_pos_for_stuck_valid { 1 } else { 0 });
        b.extend_from_slice(&car.last_pos_for_stuck.x.0.to_be_bytes());
        b.extend_from_slice(&car.last_pos_for_stuck.y.0.to_be_bytes());
        b.extend_from_slice(&car.stuck_for_ms.to_be_bytes());
        b.push(car.contact_car_id);
        b.extend_from_slice(&car.contact_for_ms.to_be_bytes());
        b.push(if car.contact_last_dist_valid { 1 } else { 0 });
        b.extend_from_slice(&car.contact_last_dist_raw.to_be_bytes());
        b.extend_from_slice(&car.contact_escape_cooldown_until_ms.to_be_bytes());
        b.push(car.auto_stance);
        b.extend_from_slice(&car.auto_stance_until_tick.to_be_bytes());
        b.extend_from_slice(&car.stance_pick_count.to_be_bytes());
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


