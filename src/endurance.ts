import type { State } from './dynamics.ts'

export function stabilityFailures(state: State): string[] {
  const angle = Math.atan2(Math.sin(state.theta_unwrapped_rad), Math.cos(state.theta_unwrapped_rad))
  return [
    ...(Math.abs(angle) > Math.PI / 60 ? ['angle'] : []),
    ...(Math.abs(state.theta_dot_rad_s) > 0.2 ? ['angular_velocity'] : []),
    ...(Math.abs(state.cart_x_m) > 0.1 ? ['position'] : []),
    ...(Math.abs(state.cart_v_m_s) > 0.1 ? ['velocity'] : []),
  ]
}

export function createEnduranceAssessment(startTick: number, stepSeconds: number) {
  let status: 'running' | 'passed' | 'failed' = 'running'
  return {
    observe(tick: number, state: State, disqualified = false) {
      if (status !== 'running') return status
      if (disqualified || stabilityFailures(state).length) status = 'failed'
      else if ((tick - startTick) * stepSeconds >= 20) status = 'passed'
      return status
    },
  }
}
