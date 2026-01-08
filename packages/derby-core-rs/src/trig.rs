//! Deterministic trig (sin/cos) without runtime floats.
//!
//! Uses a polynomial approximation with range reduction.
//! This is deterministic across platforms and prover-friendly (integer-only).

use crate::fixed::{Fx, SCALE};

// Fixed-point radians constants (scale=1e6)
const PI_RAW: i64 = 3_141_593;
const TAU_RAW: i64 = 6_283_185;
const PI_OVER_2_RAW: i64 = 1_570_796;

#[inline]
fn wrap_minus_pi_pi(mut a: i64) -> i64 {
    // Wrap to [-pi, pi] in raw units.
    while a > PI_RAW {
        a = a.saturating_sub(TAU_RAW);
    }
    while a < -PI_RAW {
        a = a.saturating_add(TAU_RAW);
    }
    a
}

#[inline]
fn fx_mul_raw(a: i64, b: i64) -> i64 {
    // (a/S) * (b/S) in raw units
    (((a as i128) * (b as i128)) / (SCALE as i128)) as i64
}

#[inline]
fn sin_poly(x: i64) -> i64 {
    // x in [0, pi/2] raw.
    // sin(x) ≈ x - x^3/6 + x^5/120
    let x2 = fx_mul_raw(x, x);
    let x3 = fx_mul_raw(x2, x);
    let x5 = fx_mul_raw(x3, x2);
    // coefficients in Fx raw:
    let inv6 = 166_667i64;
    let inv120 = 8_333i64;
    let t1 = x;
    let t2 = fx_mul_raw(x3, inv6);
    let t3 = fx_mul_raw(x5, inv120);
    t1 - t2 + t3
}

#[inline]
fn cos_poly(x: i64) -> i64 {
    // x in [0, pi/2] raw.
    // cos(x) ≈ 1 - x^2/2 + x^4/24 - x^6/720
    let one = SCALE;
    let x2 = fx_mul_raw(x, x);
    let x4 = fx_mul_raw(x2, x2);
    let x6 = fx_mul_raw(x4, x2);
    let inv2 = 500_000i64;
    let inv24 = 41_667i64;
    let inv720 = 1_389i64;
    let t2 = fx_mul_raw(x2, inv2);
    let t4 = fx_mul_raw(x4, inv24);
    let t6 = fx_mul_raw(x6, inv720);
    one - t2 + t4 - t6
}

/// Return (cos, sin) for an angle in radians stored in Fx.
pub fn cos_sin(angle_rad: Fx) -> (Fx, Fx) {
    let mut a = wrap_minus_pi_pi(angle_rad.0);

    // Use symmetries to reduce to [0, pi/2]
    let mut sin_sign = 1i64;
    if a < 0 {
        sin_sign = -1;
        a = -a;
    }

    let mut cos_sign = 1i64;
    if a > PI_OVER_2_RAW {
        // Quadrant II: sin(pi - x), cos(pi - x) with negative sign
        a = PI_RAW - a;
        cos_sign = -1;
    }

    let s = sin_poly(a) * sin_sign;
    let c = cos_poly(a) * cos_sign;
    (Fx(c), Fx(s))
}


