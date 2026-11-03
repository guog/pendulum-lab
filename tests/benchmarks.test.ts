import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhysicsBenchmarks } from '../src/benchmarks.ts'

test('冻结基准通过同一实验会话保持两个精确平衡点，输出完整输入及独立误差', async () => {
  const suite = createPhysicsBenchmarks('simple')
  assert.ok(suite.read().cases.every((item) => item.status === 'not_executed'))
  suite.start()
  while (suite.read().status === 'running') suite.advance()
  const output = suite.read()
  for (const id of ['equilibrium-down', 'equilibrium-up']) {
    const item = output.cases.find((entry) => entry.id === id)!
    assert.equal(item.status, 'passed')
    assert.equal(item.metrics.find((metric) => metric.name === '最大状态偏差')?.actual, 0)
    assert.equal(item.config.versions.controller, 'none')
    assert.equal(item.config.timing.duration_s, 10)
  }
  const bundle = await suite.exportEvidence()
  assert.equal(bundle.kind, 'pendulum-physics-benchmarks')
})

test('10秒逐点收敛及30秒逐物理步能量漂移使用冻结容差，数值失败保留原输入和最后有效状态', async () => {
  for (const preset of ['simple', 'standard'] as const) {
    const suite = createPhysicsBenchmarks(preset)
    suite.start()
    while (suite.read().status === 'running') suite.advance()
    const output = suite.read()
    for (const id of ['convergence-1ms', 'convergence-0.5ms', 'energy-30s']) {
      const item = output.cases.find((entry) => entry.id === id)
      assert.ok(item, `缺少${id}`)
      assert.equal(item.status, 'passed', JSON.stringify(item))
    }
    const energy = output.cases.find((entry) => entry.id === 'energy-30s')!
    assert.equal(energy.config.timing.sample_period_s, 0.001)
    assert.equal(energy.config.timing.duration_s, 30)
    assert.equal(energy.metrics.find((metric) => metric.name === '最大相对能量漂移')?.limit, 0.001)
    const failed = output.cases.find((entry) => entry.id === 'numerical-failure')!
    assert.equal(failed.status, 'invalid')
    assert.equal(failed.config.initial_state.theta_dot_rad_s, 1e50)
    const bundle = await suite.exportEvidence()
    const result = JSON.parse(bundle.files['experiments/numerical-failure/result.json']!)
    assert.equal(result.status, 'error')
    assert.deepEqual(result.last_state, failed.config.initial_state)
    assert.equal(result.sim_time_s, 0)
    assert.match(
      bundle.files['experiments/numerical-failure/events/part-000001.jsonl']!,
      /numerical_error/,
    )
    assert.ok(
      !bundle.files['experiments/numerical-failure/samples/chunk-000001.csv']!.match(
        /NaN|Infinity/,
      ),
    )
  }
})

test('三种已批准阻力分别及共同耗散，保存tanh平滑与能量账本', () => {
  const suite = createPhysicsBenchmarks('simple')
  suite.start()
  while (suite.read().status === 'running') suite.advance()
  for (const id of ['coulomb', 'cart-viscous', 'joint-viscous', 'combined-damping']) {
    const item = suite.read().cases.find((entry) => entry.id === id)
    assert.ok(item, `缺少${id}`)
    assert.equal(item.status, 'passed', JSON.stringify(item))
    assert.ok(item.metrics.some((metric) => metric.name === '耗散账本残差'))
    assert.equal(item.config.physics.friction_smoothing_m_s, 0.01)
    assert.ok(item.ledger)
    assert.ok(item.ledger.dissipated_energy_J > 0)
    assert.ok(
      Math.abs(
        item.ledger.mechanical_energy_J +
          item.ledger.dissipated_energy_J -
          item.ledger.initial_energy_J,
      ) < 1e-7,
    )
    assert.equal(item.ledger.actuator_work_J, 0)
    assert.equal(item.ledger.force_external_work_J, 0)
    assert.equal(item.ledger.torque_external_work_J, 0)
    if (id === 'coulomb' || id === 'cart-viscous')
      assert.ok(Math.abs(item.ledger.initial_energy_J - 0.0148) < 1e-12)
  }
})

test('自然运动、多圈及配重基准用独立动量参考核对四状态和全部质量的能量', async () => {
  const suite = createPhysicsBenchmarks('standard')
  suite.start()
  while (suite.read().status === 'running') suite.advance()
  for (const id of ['release', 'rotation-centered', 'weight-zero', 'weight-pivot', 'weight-tip']) {
    const item = suite.read().cases.find((entry) => entry.id === id)
    assert.ok(item, `缺少${id}`)
    assert.equal(item.status, 'passed', JSON.stringify(item))
    assert.ok(item.metrics.some((metric) => metric.name === '独立参考角差'))
    assert.ok(item.metrics.some((metric) => metric.name === '初始机械能误差'))
  }
  assert.equal(suite.read().cases.find((entry) => entry.id === 'rotation')?.status, 'invalid')
})
