use crate::fixed::{Fx, Vec2};

/// 32-byte seed used to drive deterministic AI randomness.
pub type Bytes32 = [u8; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GamePhase {
    Title,
    Playing,
    Victory,
    GameOver,
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct Car {
    pub id: u8, // 1..=4

  // Display metadata (kept minimal/canonical in core)
  pub name_id: u8,  // 0..=3 (indexes CAR_NAMES)
  pub color_rgb: u32,

    pub position: Vec2,
    pub velocity: Vec2,
    pub rotation_rad: Fx,
    pub angular_velocity: Fx,

    pub width: Fx,
    pub height: Fx,

  // Stats (immutable during sim)
  pub acceleration: Fx,
  pub max_speed: Fx,
  pub cornering: Fx,
  pub traction: Fx,
  /// Precomputed lateral friction factor for dtMs=8 (time-step invariant).
  pub lateral_friction_dt8: Fx,

    pub health: i32,
    pub max_health: i32,
    pub damage_dealt: i32,
    pub is_alive: bool,

    // Input: throttle [-1..1.5], steer [-1..1]
    pub throttle: Fx,
    pub steer: Fx,

    // AI state (kept minimal for now)
    pub ai_state: u8,

  // For stuck detection / parity with TS structures
  pub last_position: Vec2,

  // === AI memory (canonical, deterministic) ===
  pub tick: u32,
  pub evade_until_ms: u32,
  pub wall_avoid_until_ms: u32,
  pub recover_until_ms: u32,
  /// 0 none, 1 front, 2 rear
  pub recover_mode: u8,
  pub recover_wall_normal: Vec2,
  pub recover_wall_normal_valid: bool,

  pub waypoint: Vec2,
  pub waypoint_valid: bool,
  pub next_waypoint_at_tick: u32,
  pub waypoint_pick_count: u32,

  pub last_pos_for_stuck: Vec2,
  pub last_pos_for_stuck_valid: bool,
  pub stuck_for_ms: u32,

  pub contact_car_id: u8,
  pub contact_for_ms: u32,
  pub contact_last_dist_raw: i64,
  pub contact_last_dist_valid: bool,
  pub contact_escape_cooldown_until_ms: u32,

  /// 0 orbiting, 1 striking
  pub auto_stance: u8,
  pub auto_stance_until_tick: u32,
  pub stance_pick_count: u32,

  pub target_id: u8,
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub struct World {
    pub cars: [Car; 4],
    pub phase: GamePhase,
    pub winner_id: u8, // 0 => none
    pub game_time_ms: u32,
    pub victory_time_ms: u32,
  pub run_seed: Bytes32,

  /// Collision cooldowns, keyed by [a][b] (car ids 1..=4). Stored as last-collision time (ms).
  pub collision_cooldowns_ms: [[u32; 5]; 5],

  /// Flags indicating which cars are player-controlled (skip AI for these).
  /// Index 0..3 corresponds to car indices.
  #[serde(default)]
  pub player_controlled: [bool; 4],
}

// Config values (mirrors TS; will be moved/expanded as port progresses).
pub const ARENA_WIDTH_PX: i64 = 900;
pub const ARENA_HEIGHT_PX: i64 = 600;
pub const ARENA_WALL_THICKNESS_PX: i64 = 30;
pub const ARENA_CORNER_RADIUS_PX: i64 = 75;

pub const CAR_WIDTH_PX: i64 = 50;
pub const CAR_HEIGHT_PX: i64 = 28;
pub const CAR_MAX_HEALTH: i32 = 100;

// Placeholder: map car id -> (name, color). Keep in UI; core can expose ids only.
pub const CAR_NAMES: [&str; 4] = ["Crusher", "Destroyer", "Havoc", "Rammer"];

// In TS colors are hex strings; in core we can expose canonical RGB packed.
pub const CAR_COLORS_RGB: [u32; 4] = [0xE74C3C, 0x3498DB, 0x2ECC71, 0xF1C40F];


