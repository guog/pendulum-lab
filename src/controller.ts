import type { State, Physics } from './dynamics.ts'

// Frozen candidate; startup is an explicit, deterministic 100 ms pulse.
export const controllerDefinition = {
  version: 'swing-energy-1',
  algorithm: 'energy pump with linear balance',
  startup_N: 1,
  startup_s: 0.1,
  energy_gain: 20,
  position_gain: 1.5,
  velocity_gain: 2,
  balance_gains: [3, 4, 40, 5],
  enter_angle_rad: 0.5,
  exit_angle_rad: 0.7,
  enter_speed_rad_s: 2,
  budget_ms: 10,
} as const
export type ControllerState = { phase: 'swing' | 'balance'; updates: number; request: number }
export function createController(physics: Physics, saved?: ControllerState) {
  if (
    saved &&
    (!['swing', 'balance'].includes(saved.phase) ||
      !Number.isSafeInteger(saved.updates) ||
      saved.updates < 0 ||
      !Number.isFinite(saved.request))
  )
    throw new Error('非法控制器状态')
  let phase: 'swing' | 'balance' = saved?.phase ?? 'swing'
  let updates = saved?.updates ?? 0
  let request = saved?.request ?? 0
  return {
    update(state: State, time: number) {
      const angle = Math.atan2(
        Math.sin(state.theta_unwrapped_rad),
        Math.cos(state.theta_unwrapped_rad),
      )
      if (
        phase === 'swing' &&
        Math.abs(angle) < controllerDefinition.enter_angle_rad &&
        Math.abs(state.theta_dot_rad_s) < controllerDefinition.enter_speed_rad_s
      )
        phase = 'balance'
      else if (phase === 'balance' && Math.abs(angle) > controllerDefinition.exit_angle_rad)
        phase = 'swing'
      const moment =
        (physics.rod_mass_kg * physics.rod_length_m) / 2 +
        physics.counterweight_mass_kg * physics.counterweight_position_m
      const inertia =
        (physics.rod_mass_kg * physics.rod_length_m ** 2) / 3 +
        physics.counterweight_mass_kg * physics.counterweight_position_m ** 2
      const deficit =
        moment * physics.gravity_m_s2 * (1 - Math.cos(angle)) -
        (inertia * state.theta_dot_rad_s ** 2) / 2
      const [kx, kv, kt, kw] = controllerDefinition.balance_gains
      request =
        time < controllerDefinition.startup_s
          ? controllerDefinition.startup_N
          : phase === 'balance'
            ? kx * state.cart_x_m + kv * state.cart_v_m_s - kt * angle - kw * state.theta_dot_rad_s
            : controllerDefinition.energy_gain * deficit * state.theta_dot_rad_s * Math.cos(angle) -
              controllerDefinition.position_gain * state.cart_x_m -
              controllerDefinition.velocity_gain * state.cart_v_m_s
      updates++
      return request
    },
    read() {
      return { phase, updates, request }
    },
    reset() {
      phase = 'swing'
      updates = 0
      request = 0
    },
  }
}
