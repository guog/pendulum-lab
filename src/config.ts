import type { ActuationCaseId } from './actuator-benchmarks.ts'
import { energy, type Physics, type State } from './dynamics.ts'
import { buildIdentity, type BuildIdentity } from './build-info.ts'
import type { InputCommand } from './actuation.ts'

export type PresetId = 'simple' | 'standard'
export type BenchmarkId = 'release' | 'equilibrium' | 'swing-up' | ActuationCaseId
export type ExperimentConfig = {
  schema_version: 1
  preset: PresetId
  preset_version: string
  benchmark: BenchmarkId
  benchmark_description: string
  environment: { user_agent: string; language: string | null; logical_processors: number | null }
  execution_mode: 'memory-research'
  control_mode: 'free' | 'prescribed' | 'automatic'
  build_identity: BuildIdentity | null
  versions: {
    application: string
    build: string | null
    model: string
    controller: string
    rules: string
  }
  physics: Physics
  preset_overrides: Record<string, number>
  initial_state: State
  input_program?: InputCommand[]
  timing: {
    physics_step_s: number
    control_period_s: number
    sample_period_s: number
    duration_s: number
  }
}

const presets = {
  simple: {
    rod_length_m: 0.35,
    rod_mass_kg: 0.12,
    cart_mass_kg: 0.6,
    counterweight_mass_kg: 0.02,
    counterweight_position_m: 0.175,
    track_length_m: 3,
    force_max_N: 35,
    speed_max_m_s: 2.5,
    power_max_W: 80,
  },
  standard: {
    rod_length_m: 0.5,
    rod_mass_kg: 0.2,
    cart_mass_kg: 1,
    counterweight_mass_kg: 0.05,
    counterweight_position_m: 0.25,
    track_length_m: 2,
    force_max_N: 20,
    speed_max_m_s: 2,
    power_max_W: 40,
  },
}

export function createConfig(
  preset: PresetId,
  benchmark: 'release' | 'equilibrium' | 'swing-up',
): ExperimentConfig {
  if (
    !Object.hasOwn(presets, preset) ||
    !['release', 'equilibrium', 'swing-up'].includes(benchmark)
  )
    throw new Error('未知工况或基准')
  if (benchmark === 'swing-up' && preset !== 'simple') throw new Error('自动起摆当前仅支持简单工况')
  return {
    schema_version: 1,
    preset,
    preset_version: 'qv1-1',
    benchmark,
    benchmark_description:
      benchmark === 'swing-up'
        ? '简单工况：从精确静止下垂自动起摆，30秒内完成连续5秒稳定。'
        : benchmark === 'release'
          ? '零阻力释放：初角为+π/2rad（水平），车居中、两速度为零。显式非平衡初态，仅用于自由运动基准。'
          : '零阻力静止下垂：初角为+πrad，车居中、两速度为零，不施加隐藏扰动。',
    environment: {
      user_agent: typeof navigator === 'undefined' ? 'not-reported' : navigator.userAgent,
      language: typeof navigator === 'undefined' ? null : (navigator.language ?? null),
      logical_processors:
        typeof navigator === 'undefined' ? null : (navigator.hardwareConcurrency ?? null),
    },
    execution_mode: 'memory-research',
    control_mode: benchmark === 'swing-up' ? 'automatic' : 'free',
    build_identity: structuredClone(buildIdentity),
    versions: {
      application: '0.0.0+t03',
      build: buildIdentity?.source_sha256 ?? null,
      model: 'rigid-cartpole-rk4-4',
      controller: benchmark === 'swing-up' ? 'swing-energy-1' : 'none',
      rules: 'QV-1',
    },
    physics: {
      ...presets[preset],
      gravity_m_s2: 9.81,
      safety_buffer_m: 0.1,
      cart_coulomb_N: benchmark === 'swing-up' ? 0.2 : 0,
      cart_viscous_N_s_m: benchmark === 'swing-up' ? 0.1 : 0,
      joint_viscous_Nm_s_rad: benchmark === 'swing-up' ? 0.002 : 0,
      friction_smoothing_m_s: 0.01,
    },
    preset_overrides:
      benchmark === 'swing-up'
        ? {}
        : { cart_coulomb_N: 0, cart_viscous_N_s_m: 0, joint_viscous_Nm_s_rad: 0 },
    initial_state: {
      cart_x_m: 0,
      cart_v_m_s: 0,
      theta_unwrapped_rad: benchmark === 'release' ? Math.PI / 2 : Math.PI,
      theta_dot_rad_s: 0,
    },
    timing: {
      physics_step_s: 0.001,
      control_period_s: 0.01,
      sample_period_s: 0.01,
      duration_s: benchmark === 'swing-up' ? 30 : 10,
    },
  }
}

export function validateConfig(config: ExperimentConfig) {
  if (
    config.schema_version !== 1 ||
    !['free', 'prescribed', 'automatic'].includes(config.control_mode) ||
    config.execution_mode !== 'memory-research'
  )
    throw new Error('不支持的实验格式或模式')
  if (config.benchmark === 'swing-up' && config.control_mode !== 'automatic')
    throw new Error('自动起摆必须使用自动控制')
  if (
    config.control_mode === 'automatic' &&
    (config.timing.duration_s !== 30 ||
      config.initial_state.cart_x_m !== 0 ||
      config.initial_state.cart_v_m_s !== 0 ||
      config.initial_state.theta_unwrapped_rad !== Math.PI ||
      config.initial_state.theta_dot_rad_s !== 0)
  )
    throw new Error('自动起摆初态及30秒时限必须保持冻结')
  if (
    config.control_mode === 'automatic' &&
    (config.benchmark !== 'swing-up' || config.preset !== 'simple' || config.input_program?.length)
  )
    throw new Error('自动起摆仅支持无外扰的简单工况')
  if (
    config.control_mode === 'free' &&
    Array.isArray(config.input_program) &&
    config.input_program.some((command) => command?.force_requested_N)
  )
    throw new Error('预定执行器请求必须显式使用prescribed模式')
  const ranges: Record<keyof Physics, [number, number]> = {
    rod_length_m: [0.2, 1.2],
    rod_mass_kg: [0.05, 1],
    cart_mass_kg: [0.3, 5],
    counterweight_mass_kg: [0, 0.3],
    counterweight_position_m: [0, config.physics.rod_length_m],
    track_length_m: [0.8, 5],
    gravity_m_s2: [0, 20],
    force_max_N: [2, 100],
    speed_max_m_s: [0.5, 5],
    power_max_W: [5, 250],
    safety_buffer_m: [0, config.physics.track_length_m / 2],
    cart_coulomb_N: [0, 5],
    cart_viscous_N_s_m: [0, 5],
    joint_viscous_Nm_s_rad: [0, 0.1],
    friction_smoothing_m_s: [0.000001, 1],
  }
  for (const [key, range] of Object.entries(ranges)) {
    const value = config.physics[key as keyof Physics]
    if (!Number.isFinite(value) || value < range[0]! || value > range[1]!)
      throw new Error(`非法物理参数 ${key}`)
  }
  if (config.physics.safety_buffer_m >= config.physics.track_length_m / 2)
    throw new Error('安全缓冲区必须小于半行程')
  for (const key of ['cart_x_m', 'cart_v_m_s', 'theta_unwrapped_rad', 'theta_dot_rad_s'] as const) {
    if (!Number.isFinite(config.initial_state[key])) throw new Error(`非法初始状态 ${key}`)
  }
  if (Math.abs(config.initial_state.cart_x_m) > config.physics.track_length_m / 2)
    throw new Error('初始 cart_x_m 超出导轨')
  if (!Object.values(energy(config.initial_state, config.physics)).every(Number.isFinite))
    throw new Error('初始状态的能量超出可计算范围')
  const { physics_step_s, sample_period_s, control_period_s, duration_s } = config.timing
  if (config.input_program !== undefined) {
    if (!Array.isArray(config.input_program) || config.input_program.length > 10_000)
      throw new Error('非法输入程序或超出容量')
    for (const command of config.input_program) {
      if (
        !command ||
        typeof command !== 'object' ||
        !Number.isFinite(command.at_s) ||
        command.at_s < 0 ||
        command.at_s > duration_s ||
        Math.abs(Math.round(command.at_s / physics_step_s) * physics_step_s - command.at_s) > 1e-12
      )
        throw new Error('输入时刻必须位于窗口内的物理步边界')
      const fields = Object.keys(command).filter((key) => key !== 'at_s')
      if (
        !fields.length ||
        fields.some(
          (key) =>
            !['force_requested_N', 'force_external_N', 'torque_external_Nm'].includes(key) ||
            !Number.isFinite(command[key as keyof InputCommand]),
        )
      )
        throw new Error('非法受力输入')
    }
  }
  if (![0.001, 0.0005].includes(physics_step_s)) throw new Error('不支持的物理步长')
  if (![0.001, 0.01, 0.1].includes(sample_period_s)) throw new Error('不支持的采样周期')
  if (control_period_s !== 0.01) throw new Error('当前控制周期必须为10ms')
  const steps = Math.round(duration_s / physics_step_s)
  if (
    !Number.isSafeInteger(steps) ||
    steps <= 0 ||
    Math.abs(steps * physics_step_s - duration_s) > 1e-12
  )
    throw new Error('基准时长必须是正数且为物理步的整数倍')
  const sampleSteps = Math.round(sample_period_s / physics_step_s)
  if (steps > 600_000 || Math.ceil(steps / sampleSteps) > 100_000)
    throw new Error('内存基准时长超出有界记录容量')
}
