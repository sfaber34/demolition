//! Port of `DerbyAiController.ts` into the Rust canonical sim.
//!
//! Note: we avoid atan2/angles and instead steer using dot products with the car's right vector.

use crate::fixed::{Fx, Vec2};
use crate::physics::{
    car_forward, car_rear, car_right, car_wall_distance, check_car_collision, dot, length, normalize,
    point_wall_distance_and_normal, vec_add, vec_mul, vec_sub,
};
use crate::rng::rand_u32;
use crate::types::{GamePhase, World, ARENA_HEIGHT_PX, ARENA_WALL_THICKNESS_PX, ARENA_WIDTH_PX};

const START_ORBIT_TICKS: u32 = 250;
const AUTO_STANCE_TICKS: u32 = 625;
const WAYPOINT_REPICK_TICKS: u32 = 175;

fn clamp_fx(x: Fx, min: Fx, max: Fx) -> Fx {
    Fx(x.0.clamp(min.0, max.0))
}

fn rand01(seed: &[u8; 32], car_id: u8, stream: &str, index: u32) -> Fx {
    // [0,1)
    let x = rand_u32(seed, car_id, stream, index);
    // scale to 1e6
    Fx(((x as u128) * 1_000_000u128 / (u32::MAX as u128 + 1)) as i64)
}

fn distance(a: Vec2, b: Vec2) -> Fx {
    length(vec_sub(b, a))
}

fn steer_toward_dir(right: Vec2, dir: Vec2, gain: Fx) -> Fx {
    // steer = clamp( dot(right, dir) * gain, -1, 1 )
    clamp_fx(dot(right, dir) * gain, Fx::from_int(-1), Fx::from_int(1))
}

fn nearest_enemy_index(world: &World, me_idx: usize) -> Option<usize> {
    let me = &world.cars[me_idx];
    let mut best: Option<usize> = None;
    let mut best_d = Fx(i64::MAX);
    for j in 0..4 {
        if j == me_idx {
            continue;
        }
        let other = &world.cars[j];
        if !other.is_alive {
            continue;
        }
        let d = distance(me.position, other.position);
        if d.0 < best_d.0 {
            best_d = d;
            best = Some(j);
        }
    }
    best
}

fn get_front_back_wall_contact(car: &crate::types::Car) -> ((Fx, Vec2), (Fx, Vec2)) {
    let corners = crate::physics::get_car_corners(car);
    // [0]=front-right, [1]=front-left, [2]=back-left, [3]=back-right
    let front = [corners[0], corners[1]];
    let rear = [corners[2], corners[3]];

    let mut best_front = (Fx(i64::MAX), Vec2::ZERO);
    for c in front.iter() {
        let r = point_wall_distance_and_normal(*c);
        if r.0 .0 < best_front.0 .0 {
            best_front = r;
        }
    }

    let mut best_rear = (Fx(i64::MAX), Vec2::ZERO);
    for c in rear.iter() {
        let r = point_wall_distance_and_normal(*c);
        if r.0 .0 < best_rear.0 .0 {
            best_rear = r;
        }
    }

    (best_front, best_rear)
}

fn nearest_wall_normal_for_car(car: &crate::types::Car) -> Vec2 {
    let corners = crate::physics::get_car_corners(car);
    let mut best_dist = Fx(i64::MAX);
    let mut best_norm = Vec2::ZERO;
    for c in corners.iter() {
        let (d, n) = point_wall_distance_and_normal(*c);
        if d.0 < best_dist.0 {
            best_dist = d;
            best_norm = n;
        }
    }
    best_norm
}

fn pick_wander_waypoint(world: &World, car_id: u8, pick_index: u32) -> Vec2 {
    // TS: center +/- (cos/sin)*radius with radius 120..360
    let cx = Fx::from_int(ARENA_WIDTH_PX / 2);
    let cy = Fx::from_int(ARENA_HEIGHT_PX / 2);
    let margin = Fx::from_int(ARENA_WALL_THICKNESS_PX + 80);

    let r1 = rand01(&world.run_seed, car_id, "waypoint:a", pick_index);
    let r2 = rand01(&world.run_seed, car_id, "waypoint:b", pick_index);

    // angle = r1 * TAU
    let angle = Fx::from_raw(((r1.0 as i128) * 6_283_185i128 / 1_000_000i128) as i64);
    let (c, s) = crate::trig::cos_sin(angle);

    let radius = Fx::from_int(120) + r2 * Fx::from_int(240);

    let x = clamp_fx(cx + c * radius, margin, Fx::from_int(ARENA_WIDTH_PX) - margin);
    let y = clamp_fx(cy + s * radius, margin, Fx::from_int(ARENA_HEIGHT_PX) - margin);
    Vec2 { x, y }
}

/// Update per-car inputs (throttle/steer) for one tick. Canonical behavior.
/// Skips cars marked as player-controlled in `world.player_controlled`.
pub fn ai_update(world: &mut World, dt_ms: u32) {
    if !matches!(world.phase, GamePhase::Playing) {
        return;
    }

    let now_ms = world.game_time_ms;

    for i in 0..4 {
        // Skip player-controlled cars
        if world.player_controlled[i] {
            continue;
        }
        if !world.cars[i].is_alive {
            continue;
        }

        // Snapshot some values (avoid borrow issues).
        let car_id = world.cars[i].id;
        let me_pos = world.cars[i].position;
        let me_vel = world.cars[i].velocity;
        let me_speed = length(me_vel);
        let me_forward = car_forward(&world.cars[i]);
        let me_right = car_right(&world.cars[i]);
        let me_wall_dist = car_wall_distance(&world.cars[i]);
        let (front_contact, rear_contact) = get_front_back_wall_contact(&world.cars[i]);

        // Tick counter
        world.cars[i].tick = world.cars[i].tick.saturating_add(1);
        let tick = world.cars[i].tick;

        // --- Controller-side stuck detection ---
        if world.cars[i].last_pos_for_stuck_valid {
            let moved = distance(world.cars[i].last_pos_for_stuck, me_pos);
            if moved.0 < Fx::from_raw(600_000).0 {
                world.cars[i].stuck_for_ms = world.cars[i].stuck_for_ms.saturating_add(dt_ms);
            } else {
                world.cars[i].stuck_for_ms = 0;
            }
        }
        world.cars[i].last_pos_for_stuck = me_pos;
        world.cars[i].last_pos_for_stuck_valid = true;

        // --- Car-to-car pinned detection (simplified port of TS logic) ---
        // Find best contact candidate.
        let mut best_contact_j: Option<usize> = None;
        let mut best_contact_dist = Fx(i64::MAX);
        let mut best_contact_norm = Vec2::ZERO;
        let mut best_is_overlap = false;
        let mut best_overlap_pen = Fx::ZERO;

        for j in 0..4 {
            if i == j {
                continue;
            }
            if !world.cars[j].is_alive {
                continue;
            }

            let other_pos = world.cars[j].position;
            let to_other_raw = vec_sub(other_pos, me_pos);
            let dist = length(to_other_raw);
            let to_other = if dist.0 > Fx::from_raw(100).0 { vec_mul(to_other_raw, Fx::from_int(1) / dist) } else { Vec2 { x: Fx::from_int(1), y: Fx::ZERO } };

            let contact_dist = (world.cars[i].width + world.cars[j].width) * Fx::from_raw(500_000) + Fx::from_int(8);
            let col = check_car_collision(&world.cars, i, j);
            let is_overlap = col.is_some();
            let is_near = dist.0 <= contact_dist.0;
            if !is_overlap && !is_near {
                continue;
            }

            if let Some(c) = col {
                if c.penetration.0 > best_overlap_pen.0 {
                    best_overlap_pen = c.penetration;
                    best_contact_j = Some(j);
                    best_contact_dist = dist;
                    best_contact_norm = c.normal;
                    best_is_overlap = true;
                }
            } else if !best_is_overlap && dist.0 < best_contact_dist.0 {
                best_contact_j = Some(j);
                best_contact_dist = dist;
                best_contact_norm = to_other;
            }
        }

        if let Some(j) = best_contact_j {
            let other_id = world.cars[j].id;
            if world.cars[i].contact_car_id == other_id {
                world.cars[i].contact_for_ms = world.cars[i].contact_for_ms.saturating_add(dt_ms);
            } else {
                world.cars[i].contact_car_id = other_id;
                world.cars[i].contact_for_ms = 0;
                world.cars[i].contact_last_dist_valid = false;
            }

            let other_forward = car_forward(&world.cars[j]);
            let to_other = normalize(vec_sub(world.cars[j].position, me_pos));
            let to_me = vec_mul(to_other, Fx::from_int(-1));

            let facing_each_other =
                dot(me_forward, to_other).0 > Fx::from_raw(550_000).0 && dot(other_forward, to_me).0 > Fx::from_raw(550_000).0;
            let i_am_pushing = world.cars[i].throttle.0 > Fx::from_raw(650_000).0 && dot(me_forward, to_other).0 > Fx::from_raw(500_000).0;
            let rel_speed = length(vec_sub(me_vel, world.cars[j].velocity));
            let low_rel_motion = rel_speed.0 < Fx::from_raw(2_200_000).0 && me_speed.0 < Fx::from_raw(3_800_000).0;

            let dist_delta = if world.cars[i].contact_last_dist_valid {
                Fx(best_contact_dist.0 - world.cars[i].contact_last_dist_raw)
            } else {
                Fx::ZERO
            };
            world.cars[i].contact_last_dist_raw = best_contact_dist.0;
            world.cars[i].contact_last_dist_valid = true;
            let not_separating = dist_delta.0 < Fx::from_raw(150_000).0;
            let pinned_by_contact = i_am_pushing && not_separating;

            if world.cars[i].contact_for_ms >= 500
                && now_ms >= world.cars[i].contact_escape_cooldown_until_ms
                && (facing_each_other || pinned_by_contact)
                && low_rel_motion
            {
                let away = normalize(vec_mul(best_contact_norm, Fx::from_int(-1)));
                world.cars[i].recover_mode = 1; // front
                world.cars[i].recover_wall_normal = away;
                world.cars[i].recover_wall_normal_valid = true;
                world.cars[i].recover_until_ms = world.cars[i].recover_until_ms.max(now_ms + 650);
                world.cars[i].wall_avoid_until_ms = world.cars[i].wall_avoid_until_ms.max(now_ms + 350);
                world.cars[i].contact_escape_cooldown_until_ms = now_ms + 1400;
                world.cars[i].contact_for_ms = 0;
            }
        } else {
            world.cars[i].contact_car_id = 0;
            world.cars[i].contact_for_ms = 0;
            world.cars[i].contact_last_dist_valid = false;
        }

        // --- Auto stance selection (orbit vs strike) ---
        let auto_stance = if tick < START_ORBIT_TICKS {
            world.cars[i].auto_stance = 0;
            world.cars[i].auto_stance_until_tick = START_ORBIT_TICKS;
            0
        } else {
            if tick >= world.cars[i].auto_stance_until_tick {
                let r = rand01(&world.run_seed, car_id, "autoStance", world.cars[i].stance_pick_count);
                world.cars[i].auto_stance = if r.0 < Fx::from_raw(500_000).0 { 0 } else { 1 };
                world.cars[i].stance_pick_count = world.cars[i].stance_pick_count.saturating_add(1);
                world.cars[i].auto_stance_until_tick = tick + AUTO_STANCE_TICKS;
            }
            world.cars[i].auto_stance
        };

        // --- Global safety: wall avoidance commit ---
        if me_wall_dist.0 < Fx::from_int(50).0 {
            world.cars[i].wall_avoid_until_ms = world.cars[i].wall_avoid_until_ms.max(now_ms + 250);
        }

        // --- Wall head-on detection ---
        if me_wall_dist.0 < Fx::from_int(22).0 {
            let low_speed = me_speed.0 < Fx::from_raw(2_400_000).0;
            if (front_contact.0 .0 < Fx::from_int(14).0 || rear_contact.0 .0 < Fx::from_int(14).0)
                && (low_speed || world.cars[i].stuck_for_ms > 160)
            {
                let rear_is_closer = rear_contact.0 .0 + Fx::from_raw(250_000).0 < front_contact.0 .0;
                world.cars[i].recover_mode = if rear_is_closer { 2 } else { 1 };
                world.cars[i].recover_wall_normal = if rear_is_closer { rear_contact.1 } else { front_contact.1 };
                world.cars[i].recover_wall_normal_valid = true;
                world.cars[i].recover_until_ms = world.cars[i].recover_until_ms.max(now_ms + 520);
                world.cars[i].wall_avoid_until_ms = world.cars[i].wall_avoid_until_ms.max(now_ms + 520);
            }
        }

        if me_wall_dist.0 < Fx::from_int(3).0 && me_speed.0 < Fx::from_int(4).0 {
            let rear_is_closer = rear_contact.0 .0 + Fx::from_raw(250_000).0 < front_contact.0 .0;
            world.cars[i].recover_mode = if rear_is_closer { 2 } else { 1 };
            world.cars[i].recover_wall_normal = if rear_is_closer { rear_contact.1 } else { front_contact.1 };
            world.cars[i].recover_wall_normal_valid = true;
            world.cars[i].recover_until_ms = world.cars[i].recover_until_ms.max(now_ms + 420);
            world.cars[i].wall_avoid_until_ms = world.cars[i].wall_avoid_until_ms.max(now_ms + 420);
        }

        let is_stuck_near_wall = world.cars[i].stuck_for_ms > 500 && me_wall_dist.0 < Fx::from_int(35).0;
        if is_stuck_near_wall {
            let rear_is_closer = rear_contact.0 .0 + Fx::from_raw(250_000).0 < front_contact.0 .0;
            world.cars[i].recover_mode = if rear_is_closer { 2 } else { 1 };
            world.cars[i].recover_wall_normal = if rear_is_closer { rear_contact.1 } else { front_contact.1 };
            world.cars[i].recover_wall_normal_valid = true;
            world.cars[i].recover_until_ms = world.cars[i].recover_until_ms.max(now_ms + 450);
            world.cars[i].wall_avoid_until_ms = world.cars[i].wall_avoid_until_ms.max(now_ms + 450);
        }

        if world.cars[i].recover_until_ms <= now_ms {
            world.cars[i].recover_mode = 0;
            world.cars[i].recover_wall_normal_valid = false;
        }

        // --- Threat detection (simple port) ---
        let mut threat_j: Option<usize> = None;
        let mut best_score = Fx::ZERO;
        for j in 0..4 {
            if i == j || !world.cars[j].is_alive {
                continue;
            }
            let d = distance(me_pos, world.cars[j].position);
            if d.0 > Fx::from_int(260).0 {
                continue;
            }
            if length(world.cars[j].velocity).0 < (me_speed + Fx::from_raw(1_200_000)).0 {
                continue;
            }
            // moving toward me
            let to_me_dir = normalize(vec_sub(me_pos, world.cars[j].position));
            let vel_dir = normalize(world.cars[j].velocity);
            if dot(vel_dir, to_me_dir).0 <= Fx::from_raw(500_000).0 {
                continue;
            }
            let score = Fx::from_int(260) - d + (length(world.cars[j].velocity) - me_speed) * Fx::from_int(20);
            if score.0 > best_score.0 {
                best_score = score;
                threat_j = Some(j);
            }
        }
        if threat_j.is_some() {
            world.cars[i].evade_until_ms = world.cars[i].evade_until_ms.max(now_ms + 260);
        }

        // Input
        let (mut throttle, mut steer);

        // 1) Recovery
        if world.cars[i].recover_until_ms > now_ms {
            let wall_norm = if world.cars[i].recover_wall_normal_valid {
                world.cars[i].recover_wall_normal
            } else {
                nearest_wall_normal_for_car(&world.cars[i])
            };
            let escape_target = vec_add(me_pos, vec_mul(wall_norm, Fx::from_int(240)));
            let escape_dir = normalize(vec_sub(escape_target, me_pos));
            steer = steer_toward_dir(me_right, escape_dir, Fx::from_raw(2_200_000));
            throttle = if world.cars[i].recover_mode == 2 {
                Fx::from_raw(1_250_000)
            } else {
                let reverse_phase = world.cars[i].recover_until_ms.saturating_sub(now_ms) > 220;
                if reverse_phase { Fx::from_int(-1) } else { Fx::from_raw(1_200_000) }
            };
        } else if world.cars[i].wall_avoid_until_ms > now_ms {
            // 2) Wall avoidance
            let center = Vec2 { x: Fx::from_int(ARENA_WIDTH_PX / 2), y: Fx::from_int(ARENA_HEIGHT_PX / 2) };
            let dir = normalize(vec_sub(center, me_pos));
            throttle = if me_speed.0 > Fx::from_int(7).0 { Fx::from_raw(350_000) } else { Fx::from_raw(800_000) };
            steer = steer_toward_dir(me_right, dir, Fx::from_raw(1_800_000));
        } else if world.cars[i].evade_until_ms > now_ms {
            // 3) Evade threats
            if let Some(j) = threat_j {
                let to_threat = normalize(vec_sub(world.cars[j].position, me_pos));
                let threat_on_right = dot(me_right, to_threat).0 > 0;
                let dodge_dir = if threat_on_right { Fx::from_int(-1) } else { Fx::from_int(1) };
                let dodge_point = vec_add(
                    me_pos,
                    vec_add(vec_mul(me_right, dodge_dir * Fx::from_int(160)), vec_mul(me_forward, Fx::from_int(90))),
                );
                let dir = normalize(vec_sub(dodge_point, me_pos));
                throttle = Fx::from_raw(1_150_000);
                steer = steer_toward_dir(me_right, dir, Fx::from_raw(1_900_000));
            } else {
                throttle = Fx::from_int(1);
                steer = Fx::from_raw(200_000);
            }
        } else {
            // 4) Attack or wander
            let target = nearest_enemy_index(world, i);
            let should_strike = auto_stance == 1 && target.is_some();
            if should_strike {
                let j = target.unwrap();
                world.cars[i].target_id = world.cars[j].id;
                let enemy_rear = car_rear(&world.cars[j]);
                let lead = vec_mul(world.cars[j].velocity, Fx::from_int(10));
                let aim = vec_add(enemy_rear, lead);
                let dir = normalize(vec_sub(aim, me_pos));
                let alignment = dot(me_forward, dir); // [-1..1]
                let dist = distance(me_pos, world.cars[j].position);

                // Approx TS throttle strategy based on angle magnitude using alignment thresholds.
                // cos(1.0)=0.5403, cos(0.5)=0.8776
                let base = if alignment.0 < Fx::from_raw(540_300).0 {
                    Fx::from_raw(500_000)
                } else if alignment.0 < Fx::from_raw(877_583).0 {
                    Fx::from_raw(900_000)
                } else {
                    Fx::from_raw(1_250_000)
                };
                throttle = if me_wall_dist.0 < Fx::from_int(60).0 && me_speed.0 > Fx::from_int(7).0 {
                    // min(base, 0.85)
                    if base.0 > Fx::from_raw(850_000).0 { Fx::from_raw(850_000) } else { base }
                } else {
                    base
                };
                let gain = if dist.0 < Fx::from_int(140).0 { Fx::from_raw(2_200_000) } else { Fx::from_raw(1_700_000) };
                steer = steer_toward_dir(me_right, dir, gain);
            } else {
                // Wander/orbit
                let needs_new_wp = !world.cars[i].waypoint_valid
                    || tick >= world.cars[i].next_waypoint_at_tick
                    || (world.cars[i].waypoint_valid && distance(me_pos, world.cars[i].waypoint).0 < Fx::from_int(65).0);

                if needs_new_wp {
                    let wp = pick_wander_waypoint(world, car_id, world.cars[i].waypoint_pick_count);
                    world.cars[i].waypoint = wp;
                    world.cars[i].waypoint_valid = true;
                    world.cars[i].waypoint_pick_count = world.cars[i].waypoint_pick_count.saturating_add(1);
                    world.cars[i].next_waypoint_at_tick = tick + WAYPOINT_REPICK_TICKS;
                }

                let wp = if world.cars[i].waypoint_valid {
                    world.cars[i].waypoint
                } else {
                    Vec2 { x: Fx::from_int(ARENA_WIDTH_PX / 2), y: Fx::from_int(ARENA_HEIGHT_PX / 2) }
                };
                let dir = normalize(vec_sub(wp, me_pos));
                throttle = if me_wall_dist.0 < Fx::from_int(70).0 && me_speed.0 > Fx::from_int(7).0 {
                    Fx::from_raw(450_000)
                } else {
                    Fx::from_raw(1_050_000)
                };
                steer = steer_toward_dir(me_right, dir, Fx::from_raw(1_500_000));
                world.cars[i].target_id = 0;
            }
        }

        // Clamp input (TS clampInput)
        world.cars[i].throttle = clamp_fx(throttle, Fx::from_int(-1), Fx::from_raw(1_500_000));
        world.cars[i].steer = clamp_fx(steer, Fx::from_int(-1), Fx::from_int(1));
        // reported ai state (orbiting/striking)
        world.cars[i].ai_state = if auto_stance == 1 { 1 } else { 0 };
    }
}


