import { createConfig, type ExperimentConfig, type PresetId } from './config.ts'

export const benchmarkVersion = 'physics-qv1-2'
export type BenchmarkInput = {
  id: string
  title: string
  requirement: string
  config: ExperimentConfig
}

export function physicsBenchmarkInputs(preset: PresetId): BenchmarkInput[] {
  const inputs: BenchmarkInput[] = [Math.PI, 0].map((theta, index) => {
    const config = createConfig(preset, 'equilibrium')
    config.initial_state.theta_unwrapped_rad = theta
    config.benchmark_description = `精确静止${index === 0 ? '下垂' : '倒立'}平衡，不添加初扰。`
    return {
      id: index === 0 ? 'equilibrium-down' : 'equilibrium-up',
      title: index === 0 ? '静止下垂平衡' : '精确倒立平衡',
      requirement: 'P0-PHY-01',
      config,
    }
  })
  const add = (
    id: string,
    title: string,
    requirement: string,
    change: (config: ExperimentConfig) => void,
  ) => {
    const config = createConfig(preset, 'release')
    const original = structuredClone(config.physics)
    config.benchmark_description = title + `；${benchmarkVersion}冻结的独立物理基准输入。`
    change(config)
    for (const key of Object.keys(config.physics) as (keyof typeof config.physics)[]) {
      if (config.physics[key] !== original[key]) config.preset_overrides[key] = config.physics[key]
    }
    inputs.push({ id, title, requirement, config })
  }
  add('release', '自然下落与独立参考', 'P0-PHY-01/02', () => {})
  add('rotation', '连续多圈旋转', 'P0-PHY-01', (config) => {
    config.initial_state.theta_unwrapped_rad = Math.PI
    config.initial_state.theta_dot_rad_s = 15
    config.timing.duration_s = 2
  })
  add('rotation-centered', '零水平总动量多圈旋转', 'P0-PHY-01', (config) => {
    const p = config.physics
    const moment =
      (p.rod_mass_kg * p.rod_length_m) / 2 + p.counterweight_mass_kg * p.counterweight_position_m
    config.initial_state.theta_unwrapped_rad = Math.PI
    config.initial_state.theta_dot_rad_s = 15
    config.initial_state.cart_v_m_s =
      (-15 * moment) / (p.cart_mass_kg + p.rod_mass_kg + p.counterweight_mass_kg)
    config.timing.duration_s = 2
  })
  for (const [id, title, mass, fraction] of [
    ['weight-zero', '无配重', 0, 0],
    ['weight-pivot', '配重在转轴', 0.1, 0],
    ['weight-tip', '配重在杆端', 0.3, 1],
  ] as const) {
    add(id, title, 'P0-PHY-02', (config) => {
      config.physics.counterweight_mass_kg = mass
      config.physics.counterweight_position_m = fraction * config.physics.rod_length_m
      config.initial_state.theta_unwrapped_rad = 1.2
      config.initial_state.cart_v_m_s = 0.1
      config.initial_state.theta_dot_rad_s = 0.2
      config.timing.duration_s = 1
    })
  }
  for (const [id, title] of [
    ['coulomb', '库仑平滑阻力'],
    ['cart-viscous', '滑块粘性阻力'],
  ] as const) {
    add(id, title, 'P0-PHY-02', (config) => {
      config.physics.gravity_m_s2 = 0
      config.physics.cart_coulomb_N = id === 'coulomb' ? 0.2 : 0
      config.physics.cart_viscous_N_s_m = id === 'cart-viscous' ? 0.1 : 0
      config.initial_state.cart_v_m_s = 0.2
      config.timing.duration_s = 1
    })
  }
  add('joint-viscous', '关节粘性阻力', 'P0-PHY-02', (config) => {
    config.physics.joint_viscous_Nm_s_rad = 0.002
    config.timing.duration_s = 2
  })
  add('combined-damping', '三种阻力与机械能账本', 'P0-PHY-02', (config) => {
    config.physics.cart_coulomb_N = 0.2
    config.physics.cart_viscous_N_s_m = 0.1
    config.physics.joint_viscous_Nm_s_rad = 0.002
  })
  for (const step of [0.001, 0.0005]) {
    add(
      step === 0.001 ? 'convergence-1ms' : 'convergence-0.5ms',
      `10秒步长收敛 ${step * 1000}ms`,
      'P0-PHY-03',
      (config) => {
        config.timing.physics_step_s = step
        config.timing.sample_period_s = 0.001
      },
    )
  }
  add('energy-30s', '30秒无耗散能量漂移', 'P0-PHY-04', (config) => {
    config.timing.duration_s = 30
    config.timing.sample_period_s = 0.001
  })
  add('numerical-failure', '数值异常冻结诊断', 'SRS-12/US-32', (config) => {
    config.initial_state.theta_dot_rad_s = 1e50
    config.timing.duration_s = 0.001
  })
  return inputs
}
