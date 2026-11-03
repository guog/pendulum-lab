import { createConfig, type PresetId } from './config.ts'

export const actuationVersion = 'actuation-qv1-2'
export const actuationCases = {
  'near-zero': '近零速推力',
  'force-limit': '最大力限幅',
  'power-drive': '限功率驱动',
  'power-brake': '限功率制动',
  'speed-crossing': '正向跨入速度上限',
  'speed-crossing-reverse': '反向跨入速度上限',
  'pulse-endpoint': '窗口终点结束受力',
  'speed-direction': '速度上限方向约束',
  'external-overspeed': '水平外力致超速与恢复',
  'coupling-overspeed': '摆杆耦合致超速',
  'joint-torque': '关节外力矩脉冲',
  'combined-work': '三类做功与阻力账本',
  'rail-boundary': '步内触边与终止',
} as const
export type ActuationCaseId = keyof typeof actuationCases

export function createActuationConfig(preset: PresetId, id: ActuationCaseId) {
  if (!Object.hasOwn(actuationCases, id)) throw new Error('未知受力基准')
  const config = createConfig(preset, 'equilibrium')
  const original = { ...config.physics }
  config.benchmark = id
  config.control_mode = 'prescribed'
  config.benchmark_description = `${actuationCases[id]}；${actuationVersion}冻结诊断输入，非自动起摆或合格稳态快照。`
  config.versions.application = '0.0.0+t03'
  config.initial_state.theta_unwrapped_rad = Math.PI / 2
  config.physics.gravity_m_s2 = 0
  config.timing.duration_s = 0.2
  config.timing.sample_period_s = 0.001
  config.input_program = []
  switch (id) {
    case 'near-zero':
      config.initial_state.cart_v_m_s = 1e-12
      config.input_program = [{ at_s: 0, force_requested_N: 1 }]
      break
    case 'force-limit':
      config.timing.duration_s = 0.02
      config.input_program = [{ at_s: 0, force_requested_N: 2 * config.physics.force_max_N }]
      break
    case 'power-drive':
    case 'power-brake':
      config.initial_state.cart_v_m_s = 1
      config.physics.power_max_W = 5
      config.timing.duration_s = 0.05
      config.input_program = [{ at_s: 0, force_requested_N: id === 'power-drive' ? 40 : -40 }]
      break
    case 'speed-crossing':
    case 'speed-crossing-reverse': {
      const direction = id === 'speed-crossing' ? 1 : -1
      config.initial_state.cart_v_m_s = direction * (config.physics.speed_max_m_s - 0.001)
      config.timing.duration_s = 0.005
      config.input_program = [{ at_s: 0, force_requested_N: direction * 20 }]
      break
    }
    case 'pulse-endpoint':
      config.timing.duration_s = 0.1
      config.input_program = [
        { at_s: 0, force_requested_N: 1, force_external_N: 2 },
        { at_s: 0.1, force_requested_N: 0, force_external_N: 0, torque_external_Nm: 0 },
      ]
      break
    case 'speed-direction':
      config.initial_state.cart_v_m_s = config.physics.speed_max_m_s
      config.input_program = [
        { at_s: 0, force_requested_N: 10 },
        { at_s: 0.1, force_requested_N: -10 },
      ]
      break
    case 'external-overspeed':
      config.timing.duration_s = 0.21
      config.initial_state.cart_v_m_s = config.physics.speed_max_m_s - 0.01
      config.input_program = [
        { at_s: 0, force_external_N: 10 },
        { at_s: 0.1, force_external_N: -10 },
        { at_s: 0.2, force_external_N: 0 },
      ]
      break
    case 'coupling-overspeed':
      config.initial_state.cart_v_m_s = config.physics.speed_max_m_s - 0.01
      config.initial_state.theta_unwrapped_rad = -Math.PI / 2
      config.initial_state.theta_dot_rad_s = 4
      config.timing.duration_s = 0.05
      break
    case 'joint-torque':
      config.initial_state.theta_unwrapped_rad = Math.PI
      config.physics.gravity_m_s2 = 9.81
      config.input_program = [
        { at_s: 0, torque_external_Nm: 0.1 },
        { at_s: 0.1, torque_external_Nm: 0 },
      ]
      break
    case 'combined-work':
      config.initial_state.theta_unwrapped_rad = 1.2
      config.initial_state.cart_v_m_s = 0.1
      config.initial_state.theta_dot_rad_s = 0.2
      config.physics.gravity_m_s2 = 9.81
      config.physics.cart_viscous_N_s_m = 0.1
      config.physics.joint_viscous_Nm_s_rad = 0.002
      config.input_program = [
        { at_s: 0, force_requested_N: 1, force_external_N: 2, torque_external_Nm: 0.1 },
        { at_s: 0.1, force_requested_N: 0, force_external_N: 0, torque_external_Nm: 0 },
      ]
      break
    case 'rail-boundary':
      config.initial_state.cart_x_m = config.physics.track_length_m / 2 - 0.0001
      config.initial_state.cart_v_m_s = 0.2
      config.input_program = [
        { at_s: 0, force_requested_N: 1, force_external_N: 2 },
        { at_s: 0.001, torque_external_Nm: 0.1 },
      ]
      break
  }
  for (const field of Object.keys(original) as (keyof typeof original)[])
    if (config.physics[field] !== original[field])
      config.preset_overrides[field] = config.physics[field]
  return config
}
