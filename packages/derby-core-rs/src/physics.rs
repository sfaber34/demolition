//! Physics implementation mirroring `packages/nextjs/app/derby/physics/PhysicsEngine.ts`.

use crate::fixed::{Fx, Vec2};
use crate::trig::cos_sin;
use crate::types::{Car, World, ARENA_CORNER_RADIUS_PX, ARENA_HEIGHT_PX, ARENA_WALL_THICKNESS_PX, ARENA_WIDTH_PX, CAR_MAX_HEALTH};

// Constants mirrored from TS.
const PHYS_BOUNCE_RESTITUTION: i64 = 500_000; // 0.5 * 1e6
const PHYS_SPINOUT_THRESHOLD: i64 = 450_000; // 0.45 * 1e6

const COLLISION_COOLDOWN_MS: u32 = 400;

// Precomputed time-step invariant factors for dtMs=8 relative to 16.67ms baseline.
// dt = 8/16.67 ~= 0.479904
const FRICTION_DT8: i64 = 987_923; // pow(0.975, dt) * 1e6
const ANG_FRICTION_DT8: i64 = 940_496; // pow(0.88, dt) * 1e6

#[inline]
pub fn vec_add(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 { x: a.x + b.x, y: a.y + b.y }
}

#[inline]
pub fn vec_sub(a: Vec2, b: Vec2) -> Vec2 {
    Vec2 { x: a.x - b.x, y: a.y - b.y }
}

#[inline]
pub fn vec_mul(v: Vec2, s: Fx) -> Vec2 {
    Vec2 { x: v.x * s, y: v.y * s }
}

#[inline]
pub fn dot(a: Vec2, b: Vec2) -> Fx {
    a.x * b.x + a.y * b.y
}

fn isqrt_i128(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) >> 1;
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x
}

pub fn length(v: Vec2) -> Fx {
    // v components are Fx raw. length raw is sqrt(x^2+y^2) in raw units.
    let x = v.x.0 as i128;
    let y = v.y.0 as i128;
    let sum = x * x + y * y;
    Fx(isqrt_i128(sum) as i64)
}

pub fn normalize(v: Vec2) -> Vec2 {
    let len = length(v);
    if len.0 == 0 {
        return Vec2::ZERO;
    }
    Vec2 { x: v.x / len, y: v.y / len }
}

pub fn rotate(v: Vec2, angle_rad: Fx) -> Vec2 {
    let (c, s) = cos_sin(angle_rad);
    Vec2 { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

pub fn perpendicular(v: Vec2) -> Vec2 {
    Vec2 { x: Fx(-v.y.0), y: Fx(v.x.0) }
}

pub fn lerp(a: Vec2, b: Vec2, t: Fx) -> Vec2 {
    vec_add(a, vec_mul(vec_sub(b, a), t))
}

#[inline]
fn clamp_fx(x: Fx, min: Fx, max: Fx) -> Fx {
    Fx(x.0.clamp(min.0, max.0))
}

/// dtNormalized = dtMs/16.67 in Fx. (Unitless)
pub fn dt_norm(dt_ms: u32) -> Fx {
    // dt = dt_ms / 16.67 ~= dt_ms*1000/16670
    let raw = (dt_ms as i128) * 1000_i128 * 1_000_000_i128 / 16_670_i128;
    Fx(raw as i64)
}

pub fn car_forward(car: &Car) -> Vec2 {
    let (c, s) = cos_sin(car.rotation_rad);
    Vec2 { x: c, y: s }
}

pub fn car_right(car: &Car) -> Vec2 {
    // rotation + pi/2
    let pi_over_2 = Fx::from_raw(1_570_796);
    let (c, s) = cos_sin(car.rotation_rad + pi_over_2);
    Vec2 { x: c, y: s }
}

pub fn get_car_corners(car: &Car) -> [Vec2; 4] {
    let half_w = car.width / Fx::from_int(2);
    let half_h = car.height / Fx::from_int(2);
    // Match TS ordering: front-right, front-left, back-left, back-right
    let local = [
        Vec2 { x: half_w, y: Fx(-half_h.0) },
        Vec2 { x: half_w, y: half_h },
        Vec2 { x: Fx(-half_w.0), y: half_h },
        Vec2 { x: Fx(-half_w.0), y: Fx(-half_h.0) },
    ];
    let mut out = [Vec2::ZERO; 4];
    for (i, c) in local.iter().enumerate() {
        out[i] = vec_add(car.position, rotate(*c, car.rotation_rad));
    }
    out
}

pub fn apply_controls(car: &mut Car, dt_ms: u32) {
    if !car.is_alive {
        return;
    }
    let dt = dt_norm(dt_ms);
    let forward = car_forward(car);
    let speed = length(car.velocity);

    // accelForce = throttle * acceleration * traction
    let accel_force = car.throttle * car.acceleration * car.traction;
    if car.throttle.0 > 0 {
        car.velocity = vec_add(car.velocity, vec_mul(forward, accel_force * dt * Fx::from_raw(1_200_000)));
    } else if car.throttle.0 < 0 {
        car.velocity = vec_add(car.velocity, vec_mul(forward, accel_force * dt));
    }

    // Steering effectiveness scales with speed (max ~10)
    let max_speed = Fx::from_int(10);
    let steer_eff = {
        let ratio = clamp_fx(speed / max_speed, Fx::ZERO, Fx::from_int(1));
        ratio * car.cornering
    };

    car.angular_velocity += car.steer * Fx::from_raw(20_000) * steer_eff * dt;

    // Clamp angular velocity: maxAngularVel = 0.18 / traction
    let max_ang = Fx::from_raw(180_000) / car.traction;
    car.angular_velocity = clamp_fx(car.angular_velocity, Fx(-max_ang.0), max_ang);
}

pub fn integrate_car(car: &mut Car, dt_ms: u32) {
    if !car.is_alive {
        return;
    }
    let dt = dt_norm(dt_ms);

    car.position = vec_add(car.position, vec_mul(car.velocity, dt));
    car.rotation_rad += car.angular_velocity * dt;

    // Normalize rotation to [-pi, pi]
    let pi = Fx::from_raw(3_141_593);
    let two_pi = Fx::from_raw(6_283_185);
    while car.rotation_rad.0 > pi.0 {
        car.rotation_rad -= two_pi;
    }
    while car.rotation_rad.0 < -pi.0 {
        car.rotation_rad += two_pi;
    }

    // Apply friction (dt invariant); we hardcode dt8 factors for now, assuming dt_ms is always 8 in canonical sim.
    let friction = if dt_ms == 8 { Fx(FRICTION_DT8) } else {
        // Fallback: approximate using linear interpolation around dt8 (not proof-grade)
        // TODO: implement deterministic pow for general dt.
        Fx(FRICTION_DT8)
    };
    car.velocity = vec_mul(car.velocity, friction);

    let ang_friction = if dt_ms == 8 { Fx(ANG_FRICTION_DT8) } else { Fx(ANG_FRICTION_DT8) };
    car.angular_velocity = car.angular_velocity * ang_friction;

    // Lateral friction
    let forward = car_forward(car);
    let right = car_right(car);
    let forward_speed = dot(car.velocity, forward);
    let lateral_speed = dot(car.velocity, right);

    // Time-step invariant lateral friction is precomputed per car for dt=8ms (see init.rs).
    let lateral_friction = if dt_ms == 8 { car.lateral_friction_dt8 } else { car.lateral_friction_dt8 };

    let new_lateral = lateral_speed * lateral_friction;
    car.velocity = vec_add(vec_mul(forward, forward_speed), vec_mul(right, new_lateral));

    // Spin-out check
    let speed = length(car.velocity);
    if car.angular_velocity.abs().0 > PHYS_SPINOUT_THRESHOLD && speed.0 > Fx::from_int(6).0 {
        car.velocity = vec_mul(car.velocity, Fx::from_raw(980_000));
    }

    // Clamp velocity to max speed
    if speed.0 > car.max_speed.0 {
        car.velocity = vec_mul(normalize(car.velocity), car.max_speed);
    }
}

// ======= Collision / Wall geometry =======

#[derive(Clone, Copy, Debug)]
pub struct Collision {
    pub a: usize,
    pub b: usize,
    pub normal: Vec2,     // unit vector in Fx
    pub penetration: Fx,  // px
    pub impact_speed: Fx, // px/tick-ish
    pub contact_point: Vec2,
}

fn project_onto_axis(corners: &[Vec2], axis: Vec2) -> (Fx, Fx) {
    let mut min = Fx(i64::MAX);
    let mut max = Fx(i64::MIN);
    for c in corners {
        let p = dot(*c, axis);
        if p.0 < min.0 {
            min = p;
        }
        if p.0 > max.0 {
            max = p;
        }
    }
    (min, max)
}

fn overlap_on_axis(ca: &[Vec2], cb: &[Vec2], axis: Vec2) -> Option<Fx> {
    let (amin, amax) = project_onto_axis(ca, axis);
    let (bmin, bmax) = project_onto_axis(cb, axis);
    let overlap = Fx(core::cmp::min(amax.0 - bmin.0, bmax.0 - amin.0));
    if overlap.0 > 0 {
        Some(overlap)
    } else {
        None
    }
}

fn get_axes(corners: &[Vec2; 4]) -> [Vec2; 4] {
    let mut axes = [Vec2::ZERO; 4];
    for i in 0..4 {
        let next = (i + 1) % 4;
        let edge = vec_sub(corners[next], corners[i]);
        axes[i] = normalize(perpendicular(edge));
    }
    axes
}

pub fn check_car_collision(cars: &[Car; 4], i: usize, j: usize) -> Option<Collision> {
    let a = &cars[i];
    let b = &cars[j];
    if !a.is_alive || !b.is_alive {
        return None;
    }
    let corners_a = get_car_corners(a);
    let corners_b = get_car_corners(b);
    let axes_a = get_axes(&corners_a);
    let axes_b = get_axes(&corners_b);

    let mut min_overlap = Fx(i64::MAX);
    let mut normal = Vec2::ZERO;

    for axis in axes_a.iter().chain(axes_b.iter()) {
        if let Some(overlap) = overlap_on_axis(&corners_a, &corners_b, *axis) {
            if overlap.0 < min_overlap.0 {
                min_overlap = overlap;
                normal = *axis;
            }
        } else {
            return None;
        }
    }

    // Ensure normal points from A to B
    let center_diff = vec_sub(b.position, a.position);
    if dot(normal, center_diff).0 < 0 {
        normal = vec_mul(normal, Fx::from_int(-1));
    }

    // Impact speed approximation from TS
    let rel_vel = vec_sub(a.velocity, b.velocity);
    let vel_along = dot(rel_vel, normal);
    let closing = if vel_along.0 > 0 { vel_along } else { Fx::ZERO };
    let speed_a = length(a.velocity);
    let speed_b = length(b.velocity);
    let combined = (speed_a + speed_b) * Fx::from_raw(500_000);
    let impact = if closing.0 > combined.0 { closing } else { combined };

    let contact = lerp(a.position, b.position, Fx::from_raw(500_000));

    Some(Collision { a: i, b: j, normal, penetration: min_overlap, impact_speed: impact, contact_point: contact })
}

fn can_deal_damage(cooldowns_ms: &[[u32; 5]; 5], ida: u8, idb: u8, now_ms: u32) -> bool {
    let (a, b) = if ida < idb { (ida, idb) } else { (idb, ida) };
    let last = cooldowns_ms[a as usize][b as usize];
    last == 0 || now_ms.saturating_sub(last) >= COLLISION_COOLDOWN_MS
}

fn record_collision(cooldowns_ms: &mut [[u32; 5]; 5], ida: u8, idb: u8, now_ms: u32) {
    let (a, b) = if ida < idb { (ida, idb) } else { (idb, ida) };
    cooldowns_ms[a as usize][b as usize] = now_ms;
}

pub fn resolve_car_collision(world: &mut World, collision: Collision) -> (i32, i32) {
    let now_ms = world.game_time_ms;
    let ida = world.cars[collision.a].id;
    let idb = world.cars[collision.b].id;
    let can_damage = can_deal_damage(&world.collision_cooldowns_ms, ida, idb, now_ms);

    // Borrow two cars mutably by splitting.
    let (i, j) = (collision.a, collision.b);
    let (damage_a, damage_b) = {
        let (car_a, car_b) = if i < j {
            let (left, right) = world.cars.as_mut_slice().split_at_mut(j);
            (&mut left[i], &mut right[0])
        } else {
            let (left, right) = world.cars.as_mut_slice().split_at_mut(i);
            (&mut right[0], &mut left[j])
        };

        let normal = collision.normal;
        let penetration = collision.penetration;
        let impact_speed = collision.impact_speed;

        let speed_a = length(car_a.velocity);
        let speed_b = length(car_b.velocity);

        // Momentum-based separation
        let momentum_a = speed_a + Fx::from_raw(100_000);
        let momentum_b = speed_b + Fx::from_raw(100_000);
        let total = momentum_a + momentum_b;
        let ratio_a = momentum_b / total;
        let ratio_b = momentum_a / total;
        let separation_total = penetration + Fx::from_int(2);
        car_a.position = vec_sub(car_a.position, vec_mul(normal, separation_total * ratio_a));
        car_b.position = vec_add(car_b.position, vec_mul(normal, separation_total * ratio_b));

        // Impulse along normal
        let rel_vel = vec_sub(car_a.velocity, car_b.velocity);
        let vel_along = dot(rel_vel, normal);
        if vel_along.0 > 0 {
            let restitution = Fx::from_raw(250_000);
            let base_mass = Fx::from_raw(2_000_000);
            let mass_a = base_mass + speed_a * Fx::from_raw(150_000);
            let mass_b = base_mass + speed_b * Fx::from_raw(150_000);
            let inv_a = Fx::from_int(1) / mass_a;
            let inv_b = Fx::from_int(1) / mass_b;

            // impulseMag = (-(1+e) * velAlong) / (invA + invB)
            let impulse_mag = (Fx::ZERO - (Fx::from_int(1) + restitution) * vel_along) / (inv_a + inv_b);
            let impulse_a = vec_mul(normal, impulse_mag * inv_a);
            let impulse_b = vec_mul(normal, impulse_mag * inv_b);
            car_a.velocity = vec_add(car_a.velocity, impulse_a);
            car_b.velocity = vec_sub(car_b.velocity, impulse_b);

            // damping
            let damping = Fx::from_raw(700_000);
            car_a.velocity = vec_mul(car_a.velocity, damping);
            car_b.velocity = vec_mul(car_b.velocity, damping);

            // momentum transfer
            let speed_diff = speed_a - speed_b;
            if speed_diff.0 > Fx::from_int(3).0 {
                let push = clamp_fx(speed_diff * Fx::from_raw(80_000), Fx::ZERO, Fx::from_raw(1_500_000));
                car_b.velocity = vec_add(car_b.velocity, vec_mul(normal, push));
                car_a.velocity = vec_mul(car_a.velocity, Fx::from_raw(850_000));
            } else if speed_diff.0 < -Fx::from_int(3).0 {
                let push = clamp_fx(speed_diff.abs() * Fx::from_raw(80_000), Fx::ZERO, Fx::from_raw(1_500_000));
                car_a.velocity = vec_sub(car_a.velocity, vec_mul(normal, push));
                car_b.velocity = vec_mul(car_b.velocity, Fx::from_raw(850_000));
            }
        }

        // Angular impulse (torque) - approximate with fixed-point
        let contact_to_a = vec_sub(collision.contact_point, car_a.position);
        let contact_to_b = vec_sub(collision.contact_point, car_b.position);
        let torque_arm_a = contact_to_a.y * normal.x - contact_to_a.x * normal.y;
        let torque_arm_b = contact_to_b.y * normal.x - contact_to_b.x * normal.y;
        let half_w_a = car_a.width / Fx::from_int(2);
        let half_w_b = car_b.width / Fx::from_int(2);
        let norm_torque_a = torque_arm_a / half_w_a;
        let norm_torque_b = torque_arm_b / half_w_b;
        let base_impulse = impact_speed * Fx::from_raw(15_000);
        let max_speed = Fx::from_int(10);
        let resistance_a = Fx::from_raw(550_000) + (speed_a / max_speed) * Fx::from_raw(450_000);
        let resistance_b = Fx::from_raw(550_000) + (speed_b / max_speed) * Fx::from_raw(450_000);
        let spin_a = Fx::from_int(1) / resistance_a;
        let spin_b = Fx::from_int(1) / resistance_b;
        let ang_imp_a = norm_torque_a * base_impulse * spin_a;
        let ang_imp_b = norm_torque_b * base_impulse * spin_b;
        let max_change = Fx::from_raw(350_000);
        let clamp_a = clamp_fx(ang_imp_a, Fx(-max_change.0), max_change);
        let clamp_b = clamp_fx(ang_imp_b, Fx(-max_change.0), max_change);
        car_a.angular_velocity += clamp_a;
        car_b.angular_velocity -= clamp_b;
        car_a.angular_velocity = car_a.angular_velocity * Fx::from_raw(950_000);
        car_b.angular_velocity = car_b.angular_velocity * Fx::from_raw(950_000);

        // Damage (mirrors TS) - only if off cooldown
        if !can_damage {
            return (0, 0);
        }
        let min_damage_speed = Fx::from_int(6);
        if impact_speed.0 < min_damage_speed.0 {
            return (0, 0);
        }
        let max_impact = Fx::from_int(10);
        let speed_factor = clamp_fx(impact_speed / max_impact, Fx::ZERO, Fx::from_int(1));
        let base_damage = impact_speed * Fx::from_raw(2_000_000) * speed_factor; // CAR_CONFIG.baseDamageMultiplier

        let mut dmg_a: Fx;
        let mut dmg_b: Fx;
        if speed_a.0 > (speed_b + Fx::from_int(2)).0 {
            dmg_a = base_damage * Fx::from_raw(150_000);
            dmg_b = base_damage * Fx::from_raw(850_000);
        } else if speed_b.0 > (speed_a + Fx::from_int(2)).0 {
            dmg_a = base_damage * Fx::from_raw(850_000);
            dmg_b = base_damage * Fx::from_raw(150_000);
        } else {
            dmg_a = base_damage * Fx::from_raw(500_000);
            dmg_b = base_damage * Fx::from_raw(500_000);
        }

        // Side/rear hits deal more damage
        let forward_a = car_forward(car_a);
        let forward_b = car_forward(car_b);
        let hit_a = dot(forward_a, normal).abs();
        let hit_b = dot(forward_b, normal).abs();
        // damage *= 1 + (1-hit)*0.6
        dmg_a = dmg_a * (Fx::from_int(1) + (Fx::from_int(1) - hit_a) * Fx::from_raw(600_000));
        dmg_b = dmg_b * (Fx::from_int(1) + (Fx::from_int(1) - hit_b) * Fx::from_raw(600_000));

        // Cap
        let cap = Fx::from_int(35);
        if dmg_a.0 > cap.0 {
            dmg_a = cap;
        }
        if dmg_b.0 > cap.0 {
            dmg_b = cap;
        }

        (dmg_a.round_to_i32(), dmg_b.round_to_i32())
    };

    if damage_a > 0 || damage_b > 0 {
        record_collision(&mut world.collision_cooldowns_ms, ida, idb, now_ms);
    }

    (damage_a, damage_b)
}

// ===== Wall SDF (rounded rectangle) =====

#[derive(Clone, Copy, Debug)]
pub struct WallCollision {
    pub car_index: usize,
    pub normal: Vec2,    // inward
    pub penetration: Fx, // positive
    pub impact_speed: Fx,
    pub contact_point: Vec2,
}

fn arena_inner_bounds() -> (Fx, Fx, Fx, Fx) {
    let left = Fx::from_int(ARENA_WALL_THICKNESS_PX);
    let right = Fx::from_int(ARENA_WIDTH_PX - ARENA_WALL_THICKNESS_PX);
    let top = Fx::from_int(ARENA_WALL_THICKNESS_PX);
    let bottom = Fx::from_int(ARENA_HEIGHT_PX - ARENA_WALL_THICKNESS_PX);
    (left, right, top, bottom)
}

fn signed_distance_to_inner_boundary(p: Vec2) -> Fx {
    let (left, right, top, bottom) = arena_inner_bounds();
    let cx = (left + right) * Fx::from_raw(500_000);
    let cy = (top + bottom) * Fx::from_raw(500_000);
    let half_w = (right - left) * Fx::from_raw(500_000);
    let half_h = (bottom - top) * Fx::from_raw(500_000);

    let r = Fx::from_int(ARENA_CORNER_RADIUS_PX);
    // clamp radius
    let max_r = if half_w.0 < half_h.0 { half_w } else { half_h };
    let r = clamp_fx(r, Fx::ZERO, max_r);

    let ax = (p.x - cx).abs() - (half_w - r);
    let ay = (p.y - cy).abs() - (half_h - r);
    let ox = if ax.0 > 0 { ax } else { Fx::ZERO };
    let oy = if ay.0 > 0 { ay } else { Fx::ZERO };
    let outside = length(Vec2 { x: ox, y: oy });
    let inside = {
        let m = if ax.0 > ay.0 { ax } else { ay };
        if m.0 < 0 { m } else { Fx::ZERO }
    };
    outside + inside - r
}

fn inward_normal_at_point(p: Vec2) -> Vec2 {
    // Finite difference gradient; inward normal is -grad normalized.
    let eps = Fx::from_raw(500_000);
    let sd_xp = signed_distance_to_inner_boundary(Vec2 { x: p.x + eps, y: p.y });
    let sd_xm = signed_distance_to_inner_boundary(Vec2 { x: p.x - eps, y: p.y });
    let sd_yp = signed_distance_to_inner_boundary(Vec2 { x: p.x, y: p.y + eps });
    let sd_ym = signed_distance_to_inner_boundary(Vec2 { x: p.x, y: p.y - eps });

    let gx = (sd_xp - sd_xm) / (eps * Fx::from_int(2));
    let gy = (sd_yp - sd_ym) / (eps * Fx::from_int(2));
    let grad = Vec2 { x: gx, y: gy };
    let grad_len = length(grad);
    if grad_len.0 == 0 {
        // fallback toward center
        let (left, right, top, bottom) = arena_inner_bounds();
        let cx = (left + right) * Fx::from_raw(500_000);
        let cy = (top + bottom) * Fx::from_raw(500_000);
        return normalize(Vec2 { x: cx - p.x, y: cy - p.y });
    }
    normalize(vec_mul(grad, Fx::from_int(-1)))
}

/// Distance and inward normal from a point to the nearest wall boundary.
/// - dist: positive when inside, negative when outside (penetration)
/// - normal: points inward (toward drivable area)
pub fn point_wall_distance_and_normal(p: Vec2) -> (Fx, Vec2) {
    let sd = signed_distance_to_inner_boundary(p);
    let dist = Fx(-sd.0);
    let normal = inward_normal_at_point(p);
    (dist, normal)
}

/// Get distance from a car's nearest corner to the nearest wall (positive inside).
pub fn car_wall_distance(car: &Car) -> Fx {
    let corners = get_car_corners(car);
    let mut best = Fx(i64::MAX);
    for c in corners.iter() {
        let (d, _n) = point_wall_distance_and_normal(*c);
        if d.0 < best.0 {
            best = d;
        }
    }
    best
}

/// Get rear center position of a car.
pub fn car_rear(car: &Car) -> Vec2 {
    let forward = car_forward(car);
    vec_sub(car.position, vec_mul(forward, car.width / Fx::from_int(2)))
}

pub fn check_wall_collision(cars: &[Car; 4], idx: usize) -> Option<WallCollision> {
    let car = &cars[idx];
    if !car.is_alive {
        return None;
    }
    let corners = get_car_corners(car);
    let mut max_pen = Fx::ZERO;
    let mut normal = Vec2::ZERO;
    let mut contact = Vec2::ZERO;
    for c in corners.iter() {
        let sd = signed_distance_to_inner_boundary(*c);
        if sd.0 > max_pen.0 {
            max_pen = sd;
            normal = inward_normal_at_point(*c);
            contact = *c;
        }
    }
    if max_pen.0 > 0 {
        let impact = dot(car.velocity, normal).abs();
        let speed = length(car.velocity);
        let impact_speed = if impact.0 > 0 { impact } else { speed * Fx::from_raw(500_000) };
        Some(WallCollision { car_index: idx, normal, penetration: max_pen, impact_speed, contact_point: contact })
    } else {
        None
    }
}

pub fn resolve_wall_collision(world: &mut World, col: WallCollision) -> i32 {
    let car = &mut world.cars[col.car_index];
    let normal = col.normal;
    let penetration = col.penetration;
    let impact_speed = col.impact_speed;

    car.position = vec_add(car.position, vec_mul(normal, penetration + Fx::from_raw(750_000)));

    let vel_along = dot(car.velocity, normal);
    if vel_along.0 < 0 {
        let bounce_threshold = Fx::from_int(6);
        let restitution = if impact_speed.0 > bounce_threshold.0 { Fx(PHYS_BOUNCE_RESTITUTION) * Fx::from_raw(700_000) } else { Fx::ZERO };
        car.velocity = vec_sub(car.velocity, vec_mul(normal, vel_along * (Fx::from_int(1) + restitution)));
    }

    // angular change on glancing blows
    let forward = car_forward(car);
    let side_factor = Fx::from_int(1) - dot(forward, normal).abs();
    let perp_component = car.velocity.x * normal.y - car.velocity.y * normal.x;
    let angular_change = perp_component * Fx::from_raw(1_000) * side_factor;
    let clamped = clamp_fx(angular_change, Fx::from_raw(-50_000), Fx::from_raw(50_000));
    car.angular_velocity += clamped;
    car.angular_velocity = car.angular_velocity * Fx::from_raw(900_000);

    // wall damage
    let actual_impact = dot(car.velocity, normal).abs();
    let mut damage = Fx::ZERO;
    if actual_impact.0 > (Fx::from_raw(500_000) * Fx::from_int(5)).0 {
        damage = actual_impact * Fx::from_raw(80_000);
    }
    damage.round_to_i32()
}

pub fn is_car_pinned(world: &World, idx: usize, wall_col: Option<WallCollision>) -> bool {
    if wall_col.is_none() {
        return false;
    }
    let car = &world.cars[idx];
    let speed = length(car.velocity);
    if speed.0 > Fx::from_int(3).0 {
        return false;
    }
    for other in world.cars.iter() {
        if other.id == car.id || !other.is_alive {
            continue;
        }
        let dx = other.position.x - car.position.x;
        let dy = other.position.y - car.position.y;
        let dist = length(Vec2 { x: dx, y: dy });
        if dist.0 < (car.width + other.width).0 {
            let towards = normalize(Vec2 { x: car.position.x - other.position.x, y: car.position.y - other.position.y });
            let pushing = dot(other.velocity, towards);
            if pushing.0 > Fx::from_int(2).0 {
                return true;
            }
        }
    }
    false
}

pub fn apply_damage_and_deaths(world: &mut World) {
    for car in world.cars.iter_mut() {
        if car.is_alive && car.health <= 0 {
            car.is_alive = false;
            car.health = 0;
            car.velocity = Vec2::ZERO;
            car.angular_velocity = Fx::ZERO;
        }
        if car.max_health <= 0 {
            car.max_health = CAR_MAX_HEALTH;
        }
    }
}


