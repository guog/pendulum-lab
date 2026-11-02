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

type Vector = [number, number, number, number, number]

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

export function integrate(state: State, physics: Physics, dt: number) {
  const { mass, moment, inertia } = massProperties(physics)
  function derivative([, velocity, theta, omega]: Vector): Vector {
    const sine = theta % Math.PI === 0 ? 0 : Math.sin(theta)
    const coupling = moment * Math.cos(theta)
    const determinant = mass * inertia - coupling ** 2
    const friction =
      -physics.cart_coulomb_N * Math.tanh(velocity / physics.friction_smoothing_m_s) -
      physics.cart_viscous_N_s_m * velocity
    const jointTorque = -physics.joint_viscous_Nm_s_rad * omega
    const horizontal = friction - moment * sine * omega ** 2
    const torque = jointTorque + moment * physics.gravity_m_s2 * sine
    return [
      velocity,
      (inertia * horizontal + coupling * torque) / determinant,
      omega,
      (coupling * horizontal + mass * torque) / determinant,
      -friction * velocity - jointTorque * omega,
    ]
  }
  const initial: Vector = [
    state.cart_x_m,
    state.cart_v_m_s,
    state.theta_unwrapped_rad,
    state.theta_dot_rad_s,
    0,
  ]
  const add = (base: Vector, slope: Vector, scale: number): Vector => [
    base[0] + slope[0] * scale,
    base[1] + slope[1] * scale,
    base[2] + slope[2] * scale,
    base[3] + slope[3] * scale,
    base[4] + slope[4] * scale,
  ]
  const k1 = derivative(initial)
  const k2 = derivative(add(initial, k1, dt / 2))
  const k3 = derivative(add(initial, k2, dt / 2))
  const k4 = derivative(add(initial, k3, dt))
  const result = initial.map(
    (value, i) => value + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!),
  )
  return {
    state: {
      cart_x_m: result[0]!,
      cart_v_m_s: result[1]!,
      theta_unwrapped_rad: result[2]!,
      theta_dot_rad_s: result[3]!,
    },
    dissipated_delta_J: result[4]!,
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
