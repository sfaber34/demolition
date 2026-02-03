use crate::fixed::{Fx, Vec2};
use crate::types::{
    Bytes32, Car, GamePhase, World, ARENA_HEIGHT_PX, ARENA_WALL_THICKNESS_PX, ARENA_WIDTH_PX, CAR_COLORS_RGB,
    CAR_HEIGHT_PX, CAR_MAX_HEALTH, CAR_NAMES, CAR_WIDTH_PX,
};

fn fx_from_f64_const(x: f64) -> Fx {
    // Used only for fixed literal constants we precomputed. Eventually remove all float usage from init.
    Fx::from_f64_lossy(x)
}

fn create_car(id: u8, name_id: u8, position_px: (i64, i64), rotation_rad_raw: i64) -> Car {
    // Precomputed from TS createCar() for names in CAR_NAMES (based on first char code).
    // Values:
    // - acceleration = 0.35 * accelVariation
    // - cornering = 1.0 * corneringVariation
    // - traction = 0.75 * tractionVariation
    let (accel, cornering, traction, lateral_friction_dt8) = match CAR_NAMES[name_id as usize] {
        // Note: lateral_friction_dt8 = pow((0.85 - traction*0.1), 8/16.67) precomputed.
        "Crusher" => (0.34258823529411764, 1.101764705882353, 0.6560294117647059, 0.8899946206656861),
        "Destroyer" => (0.34299999999999997, 1.1099999999999999, 0.6675, 0.8893697980412106),
        "Havoc" => (0.3446470588235294, 1.1429411764705883, 0.7133823529411765, 0.8868657359827313),
        "Rammer" => (0.3487647058823529, 0.9252941176470588, 0.6030882352941177, 0.8928722780440652),
        _ => (0.35, 1.0, 0.75, 0.89),
    };

    Car {
        id,
        name_id,
        color_rgb: CAR_COLORS_RGB[name_id as usize],
        position: Vec2::from_ints(position_px.0, position_px.1),
        velocity: Vec2::ZERO,
        rotation_rad: Fx::from_raw(rotation_rad_raw),
        angular_velocity: Fx::ZERO,
        width: Fx::from_int(CAR_WIDTH_PX),
        height: Fx::from_int(CAR_HEIGHT_PX),
        acceleration: fx_from_f64_const(accel),
        max_speed: Fx::from_int(15),
        cornering: fx_from_f64_const(cornering),
        traction: fx_from_f64_const(traction),
        lateral_friction_dt8: fx_from_f64_const(lateral_friction_dt8),
        health: CAR_MAX_HEALTH,
        max_health: CAR_MAX_HEALTH,
        damage_dealt: 0,
        is_alive: true,
        throttle: Fx::ZERO,
        steer: Fx::ZERO,
        ai_state: 0,
        last_position: Vec2::from_ints(position_px.0, position_px.1),

        tick: 0,
        evade_until_ms: 0,
        wall_avoid_until_ms: 0,
        recover_until_ms: 0,
        recover_mode: 0,
        recover_wall_normal: Vec2::ZERO,
        recover_wall_normal_valid: false,

        waypoint: Vec2::ZERO,
        waypoint_valid: false,
        next_waypoint_at_tick: 0,
        waypoint_pick_count: 0,

        last_pos_for_stuck: Vec2::ZERO,
        last_pos_for_stuck_valid: false,
        stuck_for_ms: 0,

        contact_car_id: 0,
        contact_for_ms: 0,
        contact_last_dist_raw: 0,
        contact_last_dist_valid: false,
        contact_escape_cooldown_until_ms: 0,

        auto_stance: 0,
        auto_stance_until_tick: 0,
        stance_pick_count: 0,

        target_id: 0,
    }
}

/// Deterministic initial world (mirrors TS `createInitialWorld` spawn layout).
pub fn create_initial_world() -> World {
    let margin = 80;
    let wall = ARENA_WALL_THICKNESS_PX;

    // Fixed-point radians (scale=1e6):
    // pi/4=785398, 3pi/4=2356194, -pi/4=-785398, -3pi/4=-2356194
    let spawns: [((i64, i64), i64); 4] = [
        ((wall + margin + 15, wall + margin + 15), 785_398),
        (
            (ARENA_WIDTH_PX - wall - margin - 15, wall + margin + 15),
            2_356_194,
        ),
        (
            (wall + margin + 15, ARENA_HEIGHT_PX - wall - margin - 15),
            -785_398,
        ),
        (
            (ARENA_WIDTH_PX - wall - margin - 15, ARENA_HEIGHT_PX - wall - margin - 15),
            -2_356_194,
        ),
    ];

    let cars = [
        create_car(1, 0, spawns[0].0, spawns[0].1),
        create_car(2, 1, spawns[1].0, spawns[1].1),
        create_car(3, 2, spawns[2].0, spawns[2].1),
        create_car(4, 3, spawns[3].0, spawns[3].1),
    ];

    World {
        cars,
        phase: GamePhase::Title,
        winner_id: 0,
        game_time_ms: 0,
        victory_time_ms: 0,
        run_seed: [0u8; 32] as Bytes32,
        collision_cooldowns_ms: [[0u32; 5]; 5],
        player_controlled: [false; 4],
    }
}


