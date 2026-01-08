//! Fixed-point math (deterministic across platforms).

use core::ops::{Add, AddAssign, Div, Mul, Sub, SubAssign};

/// Fixed-point scale factor (1e6 => micro-units).
pub const SCALE: i64 = 1_000_000;

/// Signed fixed-point number: value = raw / SCALE.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
pub struct Fx(pub i64);

impl Fx {
    pub const ZERO: Fx = Fx(0);

  #[inline]
  pub const fn from_raw(raw: i64) -> Fx {
    Fx(raw)
  }

    #[inline]
    pub fn from_int(x: i64) -> Fx {
        Fx(x.saturating_mul(SCALE))
    }

    #[inline]
    pub fn from_f64_lossy(x: f64) -> Fx {
        // For early porting only. Eventually remove floats entirely from the pipeline.
        Fx((x * (SCALE as f64)).round() as i64)
    }

    #[inline]
    pub fn to_f64(self) -> f64 {
        (self.0 as f64) / (SCALE as f64)
    }

    #[inline]
    pub fn abs(self) -> Fx {
        Fx(self.0.abs())
    }

  #[inline]
  pub fn round_to_i32(self) -> i32 {
    // Round to nearest integer.
    let half = SCALE / 2;
    if self.0 >= 0 {
      ((self.0 + half) / SCALE) as i32
    } else {
      ((self.0 - half) / SCALE) as i32
    }
  }
}

impl Add for Fx {
    type Output = Fx;
    fn add(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_add(rhs.0))
    }
}

impl Sub for Fx {
    type Output = Fx;
    fn sub(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_sub(rhs.0))
    }
}

impl Mul for Fx {
    type Output = Fx;
    fn mul(self, rhs: Fx) -> Fx {
        // (a/S) * (b/S) => (a*b)/S
        let prod = (self.0 as i128) * (rhs.0 as i128);
        Fx((prod / (SCALE as i128)).clamp(i64::MIN as i128, i64::MAX as i128) as i64)
    }
}

impl Div for Fx {
    type Output = Fx;
    fn div(self, rhs: Fx) -> Fx {
        if rhs.0 == 0 {
            return Fx(0);
        }
        // (a/S) / (b/S) => (a*S)/b
        let num = (self.0 as i128) * (SCALE as i128);
        Fx((num / (rhs.0 as i128)).clamp(i64::MIN as i128, i64::MAX as i128) as i64)
    }
}

impl AddAssign for Fx {
    fn add_assign(&mut self, rhs: Fx) {
        self.0 = self.0.saturating_add(rhs.0);
    }
}

impl SubAssign for Fx {
    fn sub_assign(&mut self, rhs: Fx) {
        self.0 = self.0.saturating_sub(rhs.0);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Vec2 {
    pub x: Fx,
    pub y: Fx,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: Fx::ZERO, y: Fx::ZERO };

    #[inline]
    pub fn from_ints(x: i64, y: i64) -> Vec2 {
        Vec2 { x: Fx::from_int(x), y: Fx::from_int(y) }
    }
}


