//! Minimal deterministic AI scaffold.
//!
//! TODO: Port the full `DerbyAiController.ts` behavior. For now this keeps the Rust sim runnable end-to-end.

use crate::fixed::{Fx, Vec2};
use crate::physics::{car_forward, car_right, dot, length, normalize, vec_sub};
use crate::types::{GamePhase, World};

fn clamp_fx(x: Fx, min: Fx, max: Fx) -> Fx {
    Fx(x.0.clamp(min.0, max.0))
}

/// Update per-car inputs (throttle/steer) for one tick.
pub fn ai_update(world: &mut World) {
    if !matches!(world.phase, GamePhase::Playing) {
        return;
    }

    // Naive policy: chase nearest alive opponent.
    for i in 0..4 {
        if !world.cars[i].is_alive {
            continue;
        }

        let my_pos = world.cars[i].position;
        let mut best_j: Option<usize> = None;
        let mut best_d = Fx(i64::MAX);

        for j in 0..4 {
            if i == j || !world.cars[j].is_alive {
                continue;
            }
            let d = length(Vec2 {
                x: world.cars[j].position.x - my_pos.x,
                y: world.cars[j].position.y - my_pos.y,
            });
            if d.0 < best_d.0 {
                best_d = d;
                best_j = Some(j);
            }
        }

        if let Some(j) = best_j {
            let to = normalize(vec_sub(world.cars[j].position, world.cars[i].position));
            let fwd = car_forward(&world.cars[i]);
            let right = car_right(&world.cars[i]);

            // steer ~ right dot target dir (positive => target is to the right)
            let steer = clamp_fx(dot(right, to) * Fx::from_raw(1_600_000), Fx::from_int(-1), Fx::from_int(1));

            // throttle: always forward; could modulate by alignment
            let align = dot(fwd, to);
            let throttle = if align.0 > 0 { Fx::from_int(1) } else { Fx::from_raw(300_000) };

            world.cars[i].steer = steer;
            world.cars[i].throttle = throttle;
        } else {
            world.cars[i].steer = Fx::ZERO;
            world.cars[i].throttle = Fx::ZERO;
        }
    }
}


