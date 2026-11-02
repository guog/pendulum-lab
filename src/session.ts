import { integrate, energy, type State } from './dynamics.ts'
import { createConfig, validateConfig, type ExperimentConfig } from './config.ts'
import { buildEvidence } from './evidence.ts'
export { createConfig }
export type { ExperimentConfig, State }

export type SessionStatus = 'ready' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
export type ExperimentEvent = {
  schema_version: 1
  event_index: number
  sim_time_s: number
  event_type: string
  payload: Record<string, unknown>
}

export function createSession(input: ExperimentConfig) {
  validateConfig(input)
  const config = structuredClone(input)
  const initialEnergy = energy(config.initial_state, config.physics)
  let created_at_utc = new Date().toISOString()
  let state = structuredClone(config.initial_state)
  const samples: Sample[] = []
  const events: ExperimentEvent[] = []
  const dt = config.timing.physics_step_s
  const sampleSteps = Math.round(config.timing.sample_period_s / dt)
  const durationSteps = Math.round(config.timing.duration_s / dt)
  let dissipated = 0
  let terminalTime: number | null = null
  let tick = 0
  const time = () => terminalTime ?? tick * dt
  let status: SessionStatus = 'ready'
  let experiment_id = crypto.randomUUID()
  const event = (event_type: string, payload: Record<string, unknown> = {}) => {
    events.push({
      schema_version: 1,
      event_index: events.length,
      sim_time_s: time(),
      event_type,
      payload,
    })
  }
  const boundaryEvent = () =>
    event('boundary', {
      ...state,
      condition: 'abs(cart_x_m) >= track_length_m / 2',
      track_limit_m: config.physics.track_length_m / 2,
    })
  const sample = () => {
    if (samples.at(-1)?.sim_time_s !== time())
      samples.push({
        ...state,
        sample_index: samples.length,
        sim_time_s: time(),
        theta_wrapped_rad:
          ((((state.theta_unwrapped_rad + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
            (2 * Math.PI)) -
          Math.PI,
        force_requested_N: 0,
        force_actual_N: 0,
        force_external_N: 0,
        torque_external_Nm: 0,
        control_mode: 'free',
        controller_phase: 'none',
        ...energy(state, config.physics),
        actuator_power_W: 0,
        actuator_work_J: 0,
        force_external_work_J: 0,
        torque_external_work_J: 0,
        external_work_J: 0,
        dissipated_energy_J: dissipated,
        energy_residual_J:
          energy(state, config.physics).kinetic_energy_J +
          energy(state, config.physics).potential_energy_J -
          initialEnergy.kinetic_energy_J -
          initialEnergy.potential_energy_J +
          dissipated,
        overspeed: Math.abs(state.cart_v_m_s) > config.physics.speed_max_m_s,
      })
  }
  return {
    start() {
      if (status !== 'ready') throw new Error('请重置后开始新的实验')
      status = 'running'
      event('start')
      sample()
      if (Math.abs(state.cart_x_m) >= config.physics.track_length_m / 2) {
        status = 'stopped'
        boundaryEvent()
      }
    },
    advance(duration_s: number) {
      if (!Number.isFinite(duration_s) || duration_s < 0) throw new Error('非法推进时长')
      const steps = Math.round(duration_s / dt)
      if (!Number.isSafeInteger(steps) || Math.abs(steps * dt - duration_s) > 1e-12)
        throw new Error('推进时长必须是物理步的整数倍')
      if (status !== 'running') return
      for (let step = 0; step < steps && status === 'running'; step++) {
        const next = integrate(state, config.physics, dt)
        const nextEnergy = energy(next.state, config.physics)
        if (
          ![
            ...Object.values(next.state),
            next.dissipated_delta_J,
            nextEnergy.kinetic_energy_J,
            nextEnergy.potential_energy_J,
            dissipated + next.dissipated_delta_J,
          ].every(Number.isFinite)
        ) {
          status = 'error'
          event('numerical_error', {
            attempted_sim_time_s: time() + dt,
            reason: '非有限数值，保留最后有效状态',
          })
          sample()
          break
        }
        const limit = config.physics.track_length_m / 2
        if (Math.abs(next.state.cart_x_m) >= limit) {
          let low = 0
          let high = dt
          for (let iteration = 0; iteration < 40; iteration++) {
            const middle = (low + high) / 2
            if (Math.abs(integrate(state, config.physics, middle).state.cart_x_m) >= limit)
              high = middle
            else low = middle
          }
          const endpoint = integrate(state, config.physics, high)
          terminalTime = tick * dt + high
          state = endpoint.state
          dissipated += endpoint.dissipated_delta_J
          status = 'stopped'
          boundaryEvent()
          sample()
          break
        }
        state = next.state
        dissipated += next.dissipated_delta_J
        tick++
        if (tick % sampleSteps === 0) sample()
        if (tick >= durationSteps) {
          status = 'completed'
          event('completed', { reason: 'benchmark_duration' })
          sample()
        }
      }
    },
    pause(reason: 'manual' | 'background' = 'manual') {
      if (status !== 'running') return
      status = 'paused'
      event('pause', { reason })
    },
    resume() {
      if (status !== 'paused') throw new Error('实验未暂停')
      status = 'running'
      event('resume')
    },
    stop() {
      if (status !== 'running' && status !== 'paused') return
      status = 'stopped'
      event('stop', { reason: 'user' })
      sample()
    },
    reset() {
      state = structuredClone(config.initial_state)
      samples.length = 0
      events.length = 0
      tick = 0
      terminalTime = null
      dissipated = 0
      status = 'ready'
      experiment_id = crypto.randomUUID()
      created_at_utc = new Date().toISOString()
    },
    read() {
      return structuredClone({
        config,
        state,
        sim_time_s: time(),
        samples,
        events,
        status,
        experiment_id,
        created_at_utc,
      })
    },
    async exportEvidence() {
      if (status === 'ready' || status === 'running') throw new Error('请先暂停或结束实验再导出')
      event('export', { stage: 'requested', persistence_confirmed: false })
      return buildEvidence(this.read())
    },
  }
}

export type SessionOutput = ReturnType<ReturnType<typeof createSession>['read']>
export type Sample = State & {
  sample_index: number
  sim_time_s: number
  theta_wrapped_rad: number
  force_requested_N: number
  force_actual_N: number
  force_external_N: number
  torque_external_Nm: number
  control_mode: string
  controller_phase: string
  kinetic_energy_J: number
  potential_energy_J: number
  actuator_power_W: number
  actuator_work_J: number
  force_external_work_J: number
  torque_external_work_J: number
  external_work_J: number
  dissipated_energy_J: number
  energy_residual_J: number
  overspeed: boolean
}
