import { actuationCases } from './actuator-benchmarks.ts'
import actuationReference from './actuation-reference.json' with { type: 'json' }
import { assessActuation } from './actuation-assessment.ts'
import type { SessionOutput, Sample } from './session.ts'

export type EvidenceBundle = {
  schema_version: 1
  kind: 'pendulum-research-bundle'
  experiment_id: string
  prepared_at_utc: string
  files: Record<string, string>
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildEvidence(output: SessionOutput): Promise<EvidenceBundle> {
  const { experiment_id } = output
  const stringify = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const columns: (keyof Sample)[] = [
    'sample_index',
    'sim_time_s',
    'cart_x_m',
    'cart_v_m_s',
    'theta_unwrapped_rad',
    'theta_wrapped_rad',
    'theta_dot_rad_s',
    'force_requested_N',
    'force_actual_N',
    'force_external_N',
    'torque_external_Nm',
    'control_mode',
    'controller_phase',
    'kinetic_energy_J',
    'potential_energy_J',
    'actuator_power_W',
    'actuator_work_J',
    'force_external_work_J',
    'torque_external_work_J',
    'external_work_J',
    'dissipated_energy_J',
    'energy_residual_J',
    'overspeed',
    'saturation_reasons',
    'saturated',
  ]
  const configDigest = await sha256(stringify(output.config))
  const files: Record<string, string> = {
    'config.json': stringify({
      ...output.config,
      experiment_id,
      created_at_utc: output.created_at_utc,
    }),
    'samples/chunk-000001.csv':
      [
        columns.join(','),
        ...output.samples.map((sample) =>
          columns
            .map((key) =>
              Array.isArray(sample[key]) ? sample[key].join('|') : String(sample[key]),
            )
            .join(','),
        ),
      ].join('\n') + '\n',
    'events/part-000001.jsonl':
      output.events
        .map((event) =>
          JSON.stringify({
            ...event,
            experiment_id,
            model_version: output.config.versions.model,
          }),
        )
        .join('\n') + '\n',
    ...(Object.hasOwn(actuationCases, output.config.benchmark)
      ? { 'reference.json': stringify(actuationReference) }
      : {}),
    ...(output.first_stable.snapshot
      ? {
          'snapshot.json': stringify({
            schema_version: 1,
            experiment_id,
            config_sha256: configDigest,
            config_digest_encoding: 'UTF-8 JSON.stringify(config, null, 2) plus newline',
            ...output.first_stable.snapshot,
          }),
        }
      : {}),
    ...(output.controller ? { 'controller.json': stringify(output.controller) } : {}),
    'result.json': stringify({
      schema_version: 1,
      experiment_id,
      status: output.status,
      execution_mode: 'memory-research',
      formal_acceptance: 'not_eligible',
      actuation_assessment: assessActuation(output),
      qualification_reasons: output.qualification_reasons,
      condition_intervals: output.condition_intervals,
      first_stable: output.controller ? output.first_stable : 'not_executed',
      endurance: 'not_executed',
      horizontal_disturbance: 'not_executed',
      torque_disturbance: 'not_executed',
      sim_time_s: output.sim_time_s,
      last_state: output.state,
      sample_count: output.samples.length,
      rules_version: output.config.versions.rules,
      limitation: '内存记录需用户显式导出，不承诺崩溃恢复或正式控制验收。',
    }),
  }
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, content]) => ({
      path,
      byte_length: new TextEncoder().encode(content).byteLength,
      sha256: await sha256(content),
    })),
  )
  files['manifest.json'] = stringify({
    schema_version: 1,
    sample_schema_version: 1,
    experiment_id,
    revision: 1,
    execution_mode: 'memory-research',
    sealed: false,
    files: entries,
    sample_count: output.samples.length,
    first_sample_index: output.samples[0]?.sample_index,
    last_sample_index: output.samples.at(-1)?.sample_index,
    last_recorded_sim_time_s: output.samples.at(-1)?.sim_time_s,
    limitation: '研究导出包清单，不代表工作区分块提交或断电耐久性已经验证。',
  })
  return {
    schema_version: 1,
    kind: 'pendulum-research-bundle',
    experiment_id,
    prepared_at_utc: new Date().toISOString(),
    files,
  }
}
