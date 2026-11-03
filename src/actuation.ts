import type { Physics } from './dynamics.ts'

export type Forces = {
  force_requested_N: number
  force_external_N: number
  torque_external_Nm: number
}
export type InputCommand = Partial<Forces> & { at_s: number }

export const zeroForces: Forces = {
  force_requested_N: 0,
  force_external_N: 0,
  torque_external_Nm: 0,
}

export function actuator(request: number, velocity: number, physics: Physics) {
  const reasons: string[] = []
  let force = request
  if (Math.abs(force) > physics.force_max_N) {
    force = Math.sign(force) * physics.force_max_N
    reasons.push('force')
  }
  if (Math.abs(velocity) >= physics.speed_max_m_s && force * velocity > 0) {
    force = 0
    reasons.push('speed_direction')
  }
  if (Math.abs(force * velocity) > physics.power_max_W) {
    force = Math.sign(force) * (physics.power_max_W / Math.abs(velocity))
    reasons.push('power')
  }
  return { force_actual_N: force, saturation_reasons: reasons }
}
