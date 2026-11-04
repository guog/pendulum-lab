import assert from 'node:assert/strict'

const csvHeader =
  'sample_index,sim_time_s,cart_x_m,cart_v_m_s,theta_unwrapped_rad,theta_wrapped_rad,theta_dot_rad_s,force_requested_N,force_actual_N,force_external_N,torque_external_Nm,control_mode,controller_phase,kinetic_energy_J,potential_energy_J,actuator_power_W,actuator_work_J,force_external_work_J,torque_external_work_J,external_work_J,dissipated_energy_J,energy_residual_J,overspeed,saturation_reasons,saturated'

// Independent acceptance oracle for the frozen Issue #4 D-02/D-03 fields.
// Deliberately does not import the application reader, writer or column list.
export function verifyRecordContract(files, experimentId, workspaceId) {
  if (workspaceId !== undefined || Object.hasOwn(files, 'workspace.json')) {
    assert.equal(typeof files['workspace.json'], 'string', 'Missing workspace.json')
    const workspace = JSON.parse(files['workspace.json'])
    assert.equal(workspace.schema_version, 1, 'workspace.json: schema_version')
    assert.equal(typeof workspaceId, 'string', 'workspace.json: expected workspace_id')
    assert.ok(workspaceId.length > 0, 'workspace.json: expected workspace_id')
    assert.equal(workspace.workspace_id, workspaceId, 'workspace.json: workspace_id')
  }
  const manifest = JSON.parse(files['manifest.json'])
  for (const path of ['config.json', 'manifest.json', manifest.result?.path ?? 'result.json'])
    assert.equal(typeof files[path], 'string', `Missing ${path}`)
  for (const [path, text] of Object.entries(files)) {
    if (path.startsWith('samples/') && path.endsWith('.csv'))
      assert.equal(text.split('\n')[0], csvHeader, `${path}: CSV header`)
    const event = path.startsWith('events/') && path.endsWith('.jsonl')
    const core = ['config.json', 'manifest.json', 'result.json', 'snapshot.json'].includes(path)
    const snapshot = /^(snapshots|results)\/.+\.json$/.test(path)
    if (!event && !core && !snapshot) continue
    const records = event ? text.trim().split('\n').filter(Boolean) : [text]
    for (const line of records) {
      const record = JSON.parse(line)
      assert.equal(record.schema_version, 1, `${path}: schema_version`)
      assert.equal(record.experiment_id, experimentId, `${path}: experiment_id`)
      if (path === 'manifest.json')
        assert.equal(record.sample_schema_version, 1, `${path}: sample_schema_version`)
    }
  }
}
