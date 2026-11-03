import { actuator, zeroForces, type Forces } from './actuation.ts'

export type State = {
  cart_x_m: number
  cart_v_m_s: number
  theta_unwrapped_rad: number
  theta_dot_rad_s: number
}

export type Physics = {
  rod_length_m: number
  rod_mass_kg: number
  cart_mass_kg: number
  counterweight_mass_kg: number
  counterweight_position_m: number
  track_length_m: number
  gravity_m_s2: number
  force_max_N: number
  speed_max_m_s: number
  power_max_W: number
  safety_buffer_m: number
  cart_coulomb_N: number
  cart_viscous_N_s_m: number
  joint_viscous_Nm_s_rad: number
  friction_smoothing_m_s: number
}

type Vector = [number, number, number, number, number, number, number, number]

function turningFractions(linear: number, quadratic: number, cubic: number) {
  const scale = Math.max(Math.abs(linear), Math.abs(quadratic), Math.abs(cubic))
  if (scale === 0) return []
  const a = 3 * (cubic / scale)
  const b = 2 * (quadratic / scale)
  const c = linear / scale
  let roots: number[]
  if (a === 0) roots = b === 0 ? [] : [-c / b]
  else {
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) roots = []
    else if (discriminant === 0) roots = [-b / (2 * a)]
    else {
      const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(discriminant))
      roots = [q / a, c / q]
    }
  }
  return roots.filter((root) => root > 0 && root < 1).sort((left, right) => left - right)
}

function stepOutput(result: number[]) {
  return {
    state: {
      cart_x_m: result[0]!,
      cart_v_m_s: result[1]!,
      theta_unwrapped_rad: result[2]!,
      theta_dot_rad_s: result[3]!,
    },
    dissipated_delta_J: result[4]!,
    actuator_work_delta_J: result[5]!,
    force_external_work_delta_J: result[6]!,
    torque_external_work_delta_J: result[7]!,
  }
}

function massProperties(physics: Physics) {
  const mass = physics.cart_mass_kg + physics.rod_mass_kg + physics.counterweight_mass_kg
  const moment =
    (physics.rod_mass_kg * physics.rod_length_m) / 2 +
    physics.counterweight_mass_kg * physics.counterweight_position_m
  const inertia =
    (physics.rod_mass_kg * physics.rod_length_m ** 2) / 3 +
    physics.counterweight_mass_kg * physics.counterweight_position_m ** 2
  return { mass, moment, inertia }
}

export function integrate(state: State, physics: Physics, dt: number, forces: Forces = zeroForces) {
  const { mass, moment, inertia } = massProperties(physics)
  function derivative([, velocity, theta, omega]: Vector, speedBlocked: boolean): Vector {
    const sine = theta % Math.PI === 0 ? 0 : Math.sin(theta)
    const coupling = moment * Math.cos(theta)
    const determinant = mass * inertia - coupling ** 2
    const friction =
      -physics.cart_coulomb_N * Math.tanh(velocity / physics.friction_smoothing_m_s) -
      physics.cart_viscous_N_s_m * velocity
    const jointTorque = -physics.joint_viscous_Nm_s_rad * omega
    const actual = actuator(
      forces.force_requested_N,
      velocity,
      physics,
      speedBlocked,
    ).force_actual_N
    const horizontal = actual + forces.force_external_N + friction - moment * sine * omega ** 2
    const torque = forces.torque_external_Nm + jointTorque + moment * physics.gravity_m_s2 * sine
    return [
      velocity,
      (inertia * horizontal + coupling * torque) / determinant,
      omega,
      (coupling * horizontal + mass * torque) / determinant,
      -friction * velocity - jointTorque * omega,
      actual * velocity,
      forces.force_external_N * velocity,
      forces.torque_external_Nm * omega,
    ]
  }
  const initial: Vector = [
    state.cart_x_m,
    state.cart_v_m_s,
    state.theta_unwrapped_rad,
    state.theta_dot_rad_s,
    0,
    0,
    0,
    0,
  ]
  const add = (base: Vector, slope: Vector, scale: number): Vector => [
    base[0] + slope[0] * scale,
    base[1] + slope[1] * scale,
    base[2] + slope[2] * scale,
    base[3] + slope[3] * scale,
    base[4] + slope[4] * scale,
    base[5] + slope[5] * scale,
    base[6] + slope[6] * scale,
    base[7] + slope[7] * scale,
  ]
  // Each segment uses a smooth side of the speed switch. Never mix on/off
  // derivatives in one RK4 quadrature or project the resulting velocity.
  function segment(base: Vector, duration: number, speedBlocked: boolean) {
    const k1 = derivative(base, speedBlocked)
    const k2 = derivative(add(base, k1, duration / 2), speedBlocked)
    const k3 = derivative(add(base, k2, duration / 2), speedBlocked)
    const k4 = derivative(add(base, k3, duration), speedBlocked)
    const result = base.map(
      (value, i) => value + (duration / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!),
    ) as Vector
    // RK4 cubic continuous extension, shared by state and all work integrals.
    const coefficients = base.map(
      (_, i) =>
        [
          k1[i]!,
          -1.5 * k1[i]! + k2[i]! + k3[i]! - 0.5 * k4[i]!,
          (2 / 3) * (k1[i]! - k2[i]! - k3[i]! + k4[i]!),
        ] as const,
    )
    const at = (fraction: number): Vector =>
      fraction === 1
        ? result
        : (base.map((value, i) => {
            const [linear, quadratic, cubic] = coefficients[i]!
            return (
              value + duration * fraction * (linear + fraction * (quadratic + fraction * cubic))
            )
          }) as Vector)
    function crossing(
      coordinate: 0 | 1,
      reached: (value: number) => boolean,
      until: number,
      inside: boolean,
    ) {
      const [linear, quadratic, cubic] = coefficients[coordinate]!
      const divisions = [
        ...turningFractions(linear, quadratic, cubic).filter((fraction) => fraction < until),
        until,
      ]
      let low = 0
      for (const end of divisions) {
        if (reached(at(end)[coordinate])) {
          let high = end
          for (let iteration = 0; iteration < (inside ? 52 : 40); iteration++) {
            const middle = (low + high) / 2
            if (reached(at(middle)[coordinate])) high = middle
            else low = middle
          }
          // Speed uses the inside root bracket to avoid roundoff-only overspeed.
          // Both brackets describe the same root to machine precision; no state is clipped.
          const fraction = inside ? low : high
          return { fraction, values: at(fraction), bracketEnd: end }
        }
        low = end
      }
      return undefined
    }
    return { result, crossing }
  }
  const direction = Math.sign(forces.force_requested_N)
  const blocked = actuator(
    forces.force_requested_N,
    state.cart_v_m_s,
    physics,
  ).saturation_reasons.includes('speed_direction')
  let first = segment(initial, dt, blocked)
  const speedHit =
    direction !== 0 && !blocked
      ? first.crossing(1, (velocity) => direction * velocity >= physics.speed_max_m_s, 1, true)
      : undefined
  let switchTime = dt
  let second: ReturnType<typeof segment> | undefined
  if (speedHit) {
    let low = 0
    let high = dt * speedHit.bracketEnd
    const reached = (duration: number) =>
      direction * segment(initial, duration, false).result[1] >= physics.speed_max_m_s
    // Refine with complete smooth RK4 steps, not interpolation from a trial that
    // may already have crossed the power-limit corner beyond the speed limit.
    if (reached(high)) {
      for (let iteration = 0; iteration < 52; iteration++) {
        const middle = (low + high) / 2
        if (reached(middle)) high = middle
        else low = middle
      }
      switchTime = low
      first = segment(initial, switchTime, false)
      // Suppress same-direction drive until the next physical step. External
      // force and coupling are integrated normally; velocity is never clipped.
      second = segment(first.result, dt - switchTime, true)
    }
  }
  return {
    ...stepOutput(second?.result ?? first.result),
    firstBoundary(limit_m: number) {
      const before = first.crossing(0, (position) => Math.abs(position) >= limit_m, 1, false)
      if (before) return { duration_s: switchTime * before.fraction, ...stepOutput(before.values) }
      const after = second?.crossing(0, (position) => Math.abs(position) >= limit_m, 1, false)
      if (after)
        return {
          duration_s: switchTime + (dt - switchTime) * after.fraction,
          ...stepOutput(after.values),
        }
      return undefined
    },
  }
}

export function energy(state: State, physics: Physics) {
  const { mass, moment, inertia } = massProperties(physics)
  const v = state.cart_v_m_s
  const omega = state.theta_dot_rad_s
  const cosine = Math.cos(state.theta_unwrapped_rad)
  return {
    kinetic_energy_J:
      0.5 * mass * v * v - moment * cosine * v * omega + 0.5 * inertia * omega * omega,
    potential_energy_J: moment * physics.gravity_m_s2 * (1 + cosine),
  }
}
