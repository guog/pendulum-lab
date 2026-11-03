import { createController, controllerDefinition } from './controller.ts'
import { actuator, zeroForces, type Forces } from './actuation.ts'
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
  const controller = config.control_mode === 'automatic' ? createController(config.physics) : null
  const controlSteps = Math.round(config.timing.control_period_s / config.timing.physics_step_s)
  const initialEnergy = energy(config.initial_state, config.physics)
  let created_at_utc = new Date().toISOString()
  let state = structuredClone(config.initial_state)
  const samples: Sample[] = []
  const events: ExperimentEvent[] = []
  const dt = config.timing.physics_step_s
  const sampleSteps = Math.round(config.timing.sample_period_s / dt)
  const durationSteps = Math.round(config.timing.duration_s / dt)
  let dissipated = 0
  let actuatorWork = 0
  let forceWork = 0
  let torqueWork = 0
  let forces: Forces = { ...zeroForces }
  let stableStart: number | null = null
  let previousFailures = new Set<string>()
  type StableSnapshot = {
    sim_time_s: number
    stable_since_s: number
    config: ExperimentConfig
    controller_definition: typeof controllerDefinition
    state: State
    controller: ReturnType<NonNullable<typeof controller>['read']>
    forces: Forces
    physics_tick: number
    control_phase_steps: number
    sample_phase_steps: number
    energy: {
      initial: ReturnType<typeof energy>
      actuator_work_J: number
      external_force_work_J: number
      external_torque_work_J: number
      dissipated_J: number
    }
  }
  let physicalStableSince: number | null = null
  let physicalFirstStable: number | null = null
  let physicallyStable = false
  let stableSnapshot: StableSnapshot | null = null
  let exportConfirmed = false
  let maxControlMs = 0
  let stabilityStatus: 'not_executed' | 'pending' | 'passed' | 'failed' = controller
    ? 'pending'
    : 'not_executed'

  const program = (config.input_program ?? [])
    .flatMap((command, index) =>
      (Object.keys(zeroForces) as (keyof Forces)[]).flatMap((field) =>
        command[field] === undefined
          ? []
          : [{ tick: Math.round(command.at_s / dt), field, value: command[field]!, index }],
      ),
    )
    .sort(
      (a, b) =>
        a.tick - b.tick ||
        (a.field === 'force_requested_N' ? 2 : a.value === 0 ? 0 : 1) -
          (b.field === 'force_requested_N' ? 2 : b.value === 0 ? 0 : 1) ||
        a.index - b.index,
    )
  let commandIndex = 0
  const standard = controller ? createConfig('simple', 'swing-up') : null
  const nonstandard =
    standard !== null &&
    (Object.keys(standard.physics).some(
      (key) =>
        config.physics[key as keyof typeof standard.physics] !==
        standard.physics[key as keyof typeof standard.physics],
    ) ||
      config.preset_version !== standard.preset_version ||
      config.versions.model !== standard.versions.model ||
      config.versions.controller !== standard.versions.controller ||
      config.versions.rules !== standard.versions.rules ||
      Object.keys(config.preset_overrides).length !== 0)
  const qualificationReasons = new Set<string>(nonstandard ? ['nonstandard_config'] : [])
  type Interval = {
    condition: string
    start_time_s: number
    end_time_s: number | null
    duration_s: number
    active_at_end: boolean
    causes: string[]
  }
  const intervals: Interval[] = []
  const active = new Map<string, Interval>()
  const finishCondition = (condition: string, terminal = false) => {
    const interval = active.get(condition)
    if (!interval) return
    interval.end_time_s = time()
    interval.duration_s = time() - interval.start_time_s
    interval.active_at_end = terminal
    active.delete(condition)
    event(`${condition}_end`, {
      ...interval,
      ...state,
      reason: terminal ? 'experiment_ended' : 'condition_cleared',
    })
  }
  const observe = (previousForces = forces) => {
    const saturation = actuator(
      forces.force_requested_N,
      state.cart_v_m_s,
      config.physics,
    ).saturation_reasons
    const conditions = new Set(saturation.map((reason) => `limit_${reason}`))
    if (
      Math.abs(state.cart_x_m) >=
      config.physics.track_length_m / 2 - config.physics.safety_buffer_m
    )
      conditions.add('safety_buffer')
    if (Math.abs(state.cart_v_m_s) > config.physics.speed_max_m_s) {
      conditions.add('overspeed')
      qualificationReasons.add('overspeed')
    }
    for (const condition of active.keys())
      if (!conditions.has(condition)) finishCondition(condition)
    for (const condition of conditions) {
      if (active.has(condition)) continue
      const causes =
        condition !== 'overspeed'
          ? [condition]
          : [
              ...(tick === 0 && terminalTime === null ? ['initial_state'] : []),
              ...(previousForces.force_external_N !== 0 ? ['horizontal_external'] : []),
              ...(previousForces.torque_external_Nm !== 0 ? ['joint_external'] : []),
              ...(state.theta_dot_rad_s !== 0 ? ['coupling'] : []),
              ...(previousForces.force_requested_N !== 0 ? ['actuator_or_step_crossing'] : []),
            ]
      const interval: Interval = {
        condition,
        start_time_s: time(),
        end_time_s: null,
        duration_s: 0,
        active_at_end: false,
        causes,
      }
      intervals.push(interval)
      active.set(condition, interval)
      event(`${condition}_start`, {
        ...state,
        ...forces,
        causes,
        speed_limit_m_s: config.physics.speed_max_m_s,
      })
    }
  }
  const finishConditions = () => {
    for (const condition of active.keys()) finishCondition(condition, true)
  }
  const applyInputs = () => {
    while (program[commandIndex]?.tick === tick) {
      const command = program[commandIndex++]!
      forces[command.field] = command.value
      event('input', {
        command_index: command.index,
        scheduled_time_s: command.tick * dt,
        field: command.field,
        value: command.value,
      })
    }
  }
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
  const boundaryEvent = () => {
    qualificationReasons.add('boundary')
    finishConditions()
    event('boundary', {
      ...state,
      condition: 'abs(cart_x_m) >= track_length_m / 2',
      track_limit_m: config.physics.track_length_m / 2,
    })
  }
  const updateController = () => {
    if (!controller) return
    const started = performance.now()
    try {
      const request = controller.update(state, time())
      const elapsed = performance.now() - started
      maxControlMs = Math.max(maxControlMs, elapsed)
      if (!Number.isFinite(request) || elapsed > controllerDefinition.budget_ms)
        throw new Error('控制器输出无效或超过单次预算')
      forces.force_requested_N = request
    } catch (error) {
      status = 'error'
      qualificationReasons.add('controller_error')
      event('controller_error', {
        ...state,
        message: error instanceof Error ? error.message : String(error),
        max_control_ms: maxControlMs,
      })
    }
  }
  const checkStability = () => {
    if (!controller || stabilityStatus !== 'pending') return
    const angle = Math.atan2(
      Math.sin(state.theta_unwrapped_rad),
      Math.cos(state.theta_unwrapped_rad),
    )
    const failures = [
      ...(Math.abs(angle) > Math.PI / 60 ? ['angle'] : []),
      ...(Math.abs(state.theta_dot_rad_s) > 0.2 ? ['angular_velocity'] : []),
      ...(Math.abs(state.cart_x_m) > 0.1 ? ['position'] : []),
      ...(Math.abs(state.cart_v_m_s) > 0.1 ? ['velocity'] : []),
    ]
    const enteredFailures = failures.filter((failure) => !previousFailures.has(failure))
    if (enteredFailures.length)
      event('stability_violation', {
        ...state,
        failed_thresholds: failures,
        entered_thresholds: enteredFailures,
      })
    previousFailures = new Set(failures)
    if (failures.length) {
      if (stableStart !== null) event('stability_reset', { ...state, failed_thresholds: failures })
      stableStart = null
      return
    }
    if (stableStart === null) {
      stableStart = tick
      event('stability_enter', { ...state })
    }
    if ((tick - stableStart) * dt >= 5 && !physicallyStable) {
      physicallyStable = true
      physicalStableSince = stableStart * dt
      physicalFirstStable = time()
      if (qualificationReasons.size > 0)
        event('physical_stability_observed', {
          ...state,
          stable_since_s: stableStart * dt,
          qualification_reasons: [...qualificationReasons],
        })
    }
    if (physicallyStable && qualificationReasons.size === 0) {
      exportConfirmed = false
      stableSnapshot = structuredClone({
        sim_time_s: time(),
        stable_since_s: stableStart * dt,
        config,
        controller_definition: controllerDefinition,
        state,
        controller: controller.read(),
        forces,
        physics_tick: tick,
        control_phase_steps: tick % controlSteps,
        sample_phase_steps: tick % sampleSteps,
        energy: {
          initial: initialEnergy,
          actuator_work_J: actuatorWork,
          external_force_work_J: forceWork,
          external_torque_work_J: torqueWork,
          dissipated_J: dissipated,
        },
      })
      stabilityStatus = 'passed'
      event('first_stable', { state, snapshot: stableSnapshot })
      status = 'completed'
      finishConditions()
    }
  }
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
        ...forces,
        ...actuator(forces.force_requested_N, state.cart_v_m_s, config.physics),
        saturated:
          actuator(forces.force_requested_N, state.cart_v_m_s, config.physics).saturation_reasons
            .length > 0,
        control_mode: config.control_mode,
        controller_phase: controller?.read().phase ?? 'none',
        ...energy(state, config.physics),
        actuator_power_W:
          actuator(forces.force_requested_N, state.cart_v_m_s, config.physics).force_actual_N *
          state.cart_v_m_s,
        actuator_work_J: actuatorWork,
        force_external_work_J: forceWork,
        torque_external_work_J: torqueWork,
        external_work_J: forceWork + torqueWork,
        dissipated_energy_J: dissipated,
        energy_residual_J:
          energy(state, config.physics).kinetic_energy_J +
          energy(state, config.physics).potential_energy_J -
          initialEnergy.kinetic_energy_J -
          initialEnergy.potential_energy_J +
          dissipated -
          actuatorWork -
          forceWork -
          torqueWork,
        overspeed: Math.abs(state.cart_v_m_s) > config.physics.speed_max_m_s,
      })
  }
  return {
    start() {
      if (status !== 'ready') throw new Error('请重置后开始新的实验')
      status = 'running'
      event('start')
      if (Math.abs(state.cart_x_m) >= config.physics.track_length_m / 2) {
        status = 'stopped'
        observe()
        boundaryEvent()
      } else {
        applyInputs()
        updateController()
        observe()
        if (qualificationReasons.has('controller_error')) finishConditions()
        else checkStability()
      }
      sample()
    },
    advance(duration_s: number) {
      if (!Number.isFinite(duration_s) || duration_s < 0) throw new Error('非法推进时长')
      const steps = Math.round(duration_s / dt)
      if (!Number.isSafeInteger(steps) || Math.abs(steps * dt - duration_s) > 1e-12)
        throw new Error('推进时长必须是物理步的整数倍')
      if (status !== 'running') return
      for (let step = 0; step < steps && status === 'running'; step++) {
        const next = integrate(state, config.physics, dt, forces)
        const nextEnergy = energy(next.state, config.physics)
        if (
          ![
            ...Object.values(next.state),
            next.dissipated_delta_J,
            actuatorWork + next.actuator_work_delta_J,
            forceWork + next.force_external_work_delta_J,
            torqueWork + next.torque_external_work_delta_J,
            nextEnergy.kinetic_energy_J,
            nextEnergy.potential_energy_J,
            dissipated + next.dissipated_delta_J,
          ].every(Number.isFinite)
        ) {
          status = 'error'
          qualificationReasons.add('numerical_error')
          finishConditions()
          event('numerical_error', {
            attempted_sim_time_s: time() + dt,
            reason: '非有限数值，保留最后有效状态',
          })
          sample()
          break
        }
        const endpoint = next.firstBoundary(config.physics.track_length_m / 2)
        if (endpoint) {
          terminalTime = tick * dt + endpoint.duration_s
          state = endpoint.state
          dissipated += endpoint.dissipated_delta_J
          actuatorWork += endpoint.actuator_work_delta_J
          forceWork += endpoint.force_external_work_delta_J
          torqueWork += endpoint.torque_external_work_delta_J
          status = 'stopped'
          observe()
          boundaryEvent()
          sample()
          break
        }
        state = next.state
        dissipated += next.dissipated_delta_J
        actuatorWork += next.actuator_work_delta_J
        forceWork += next.force_external_work_delta_J
        torqueWork += next.torque_external_work_delta_J
        tick++
        const previousForces = { ...forces }
        applyInputs()
        if (controller && tick % controlSteps === 0) updateController()
        observe(previousForces)
        if (qualificationReasons.has('controller_error')) {
          finishConditions()
          sample()
          break
        }
        checkStability()
        if (stableSnapshot !== null) {
          sample()
          break
        }
        if (tick >= durationSteps) {
          status = 'completed'
          if (controller && stabilityStatus === 'pending') stabilityStatus = 'failed'
          finishConditions()
          event('completed', { reason: 'benchmark_duration' })
          sample()
        } else if (tick % sampleSteps === 0) sample()
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
      finishConditions()
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
      actuatorWork = forceWork = torqueWork = 0
      forces = { ...zeroForces }
      commandIndex = 0
      controller?.reset()
      qualificationReasons.clear()
      if (nonstandard) qualificationReasons.add('nonstandard_config')
      intervals.length = 0
      active.clear()
      status = 'ready'
      stableStart = null
      previousFailures.clear()
      maxControlMs = 0
      stableSnapshot = null
      physicallyStable = false
      physicalStableSince = physicalFirstStable = null
      exportConfirmed = false
      stabilityStatus = controller ? 'pending' : 'not_executed'
      experiment_id = crypto.randomUUID()
      created_at_utc = new Date().toISOString()
    },
    read() {
      return structuredClone({
        config,
        first_stable: {
          status: !controller
            ? 'not_executed'
            : stabilityStatus === 'passed'
              ? exportConfirmed
                ? 'passed'
                : 'blocked'
              : status === 'stopped' && !qualificationReasons.has('boundary')
                ? 'invalid'
                : stabilityStatus === 'failed' ||
                    status === 'error' ||
                    qualificationReasons.has('boundary')
                  ? nonstandard
                    ? 'invalid'
                    : 'failed'
                  : status === 'ready'
                    ? 'not_executed'
                    : 'blocked',
          reason:
            status === 'stopped' && !qualificationReasons.has('boundary')
              ? 'user_stopped'
              : stabilityStatus === 'passed' && !exportConfirmed
                ? 'pending_export'
                : nonstandard
                  ? 'nonstandard_config'
                  : null,
          physical_stable_since_s: physicalStableSince,
          physical_first_stable_s: physicalFirstStable,
          physical_status: physicallyStable ? 'passed' : stabilityStatus,
          snapshot: stableSnapshot,
          stable_since_s: physicalStableSince ?? (stableStart === null ? null : stableStart * dt),
          disturbance_eligibility: stableSnapshot
            ? exportConfirmed
              ? 'eligible'
              : 'blocked_pending_export'
            : 'blocked',
        },
        controller: controller
          ? {
              definition: controllerDefinition,
              state: controller.read(),
              diagnostics: {
                max_update_ms: maxControlMs,
                budget_ms: controllerDefinition.budget_ms,
              },
            }
          : null,
        state,
        sim_time_s: time(),
        samples,
        events,
        status,
        experiment_id,
        created_at_utc,
        qualification_reasons: [...qualificationReasons],
        condition_intervals: intervals.map((interval) => ({
          ...interval,
          duration_s: (interval.end_time_s ?? time()) - interval.start_time_s,
        })),
      })
    },
    confirmExport(id: string, eventCount: number) {
      if (
        id !== experiment_id ||
        eventCount !== events.length ||
        events.at(-1)?.event_type !== 'export' ||
        status === 'running'
      )
        throw new Error('证据已过期或不属于当前实验')
      exportConfirmed = true
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
  saturation_reasons: string[]
  saturated: boolean
  overspeed: boolean
}
