use crate::physics::{
    apply_controls, apply_damage_and_deaths, check_car_collision, check_wall_collision, integrate_car, is_car_pinned,
    resolve_car_collision, resolve_wall_collision,
};
use crate::types::{GamePhase, World};
use crate::ai::ai_update;

pub const VICTORY_DELAY_MS: u32 = 3000;

/// Step the world by dt_ms. Mutates the world in place.
///
/// This currently ports the **phase/timer** structure from TS `stepWorldSim`.
/// Physics/collisions/AI will be added incrementally.
pub fn step_world(world: &mut World, dt_ms: u32) {
    match world.phase {
        GamePhase::Victory => {
            world.game_time_ms = world.game_time_ms.saturating_add(dt_ms);
            if world.game_time_ms.saturating_sub(world.victory_time_ms) >= VICTORY_DELAY_MS {
                world.phase = GamePhase::GameOver;
            }
            return;
        }
        GamePhase::Playing => {
            world.game_time_ms = world.game_time_ms.saturating_add(dt_ms);
        }
        _ => {
            return;
        }
    }

    // Phase 1: Apply inputs and integrate physics
    // AI/controller update (TODO: replace with full TS parity AI).
    ai_update(world);

    for car in world.cars.iter_mut() {
        if !car.is_alive {
            continue;
        }
        car.last_position = car.position;
        apply_controls(car, dt_ms);
        integrate_car(car, dt_ms);
    }

    // Phase 2: Resolve car-car collisions
    for i in 0..4 {
        for j in (i + 1)..4 {
            if let Some(col) = check_car_collision(&world.cars, i, j) {
                let (dmg_a, dmg_b) = resolve_car_collision(world, col);
                if dmg_a > 0 || dmg_b > 0 {
                    // We need to re-borrow cars to apply health and damage dealt.
                    // resolve_car_collision already updated positions/velocities and returns damages.
                    let (a, b) = (i, j);
                    let (car_a, car_b) = {
                        let (left, right) = world.cars.as_mut_slice().split_at_mut(b);
                        (&mut left[a], &mut right[0])
                    };
                    car_a.health -= dmg_a;
                    car_b.health -= dmg_b;
                    car_b.damage_dealt += dmg_a;
                    car_a.damage_dealt += dmg_b;
                }
            }
        }
    }

    // Phase 3: Resolve wall collisions
    for idx in 0..4 {
        if !world.cars[idx].is_alive {
            continue;
        }
        let wall_col = check_wall_collision(&world.cars, idx);
        if let Some(col) = wall_col {
            let mut damage = resolve_wall_collision(world, col);
            if is_car_pinned(world, idx, wall_col) {
                // pinnedDamageMultiplier = 2.5 (integer math, rounded)
                damage = ((damage * 25) + 5) / 10;
            }
            if damage > 0 {
                world.cars[idx].health -= damage;
            }
        }
    }

    // Phase 4: Check for car deaths
    apply_damage_and_deaths(world);

    // Phase 5: Victory condition
    let mut alive = 0u8;
    let mut last_alive_id = 0u8;
    for car in world.cars.iter() {
        if car.is_alive {
            alive += 1;
            last_alive_id = car.id;
        }
    }
    if alive <= 1 && matches!(world.phase, GamePhase::Playing) {
        world.phase = GamePhase::Victory;
        world.winner_id = if alive == 1 { last_alive_id } else { 0 };
        world.victory_time_ms = world.game_time_ms;
    }
}


