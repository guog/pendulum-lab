"""Offline forced-motion oracle, independent generalized momenta and DOP853.

Reads frozen configs on stdin; never imports application dynamics or trajectories.
Piecewise-constant external inputs are split exactly at their command times.
Requires scipy==1.17.0. See docs/design/t03-actuation.md.
"""
import hashlib
import json
import math
import pathlib
import platform
import sys

import numpy as np
import scipy
from scipy.integrate import solve_ivp


def reference(config):
    p, s = config['physics'], config['initial_state']
    total = p['cart_mass_kg'] + p['rod_mass_kg'] + p['counterweight_mass_kg']
    first = p['rod_mass_kg'] * p['rod_length_m'] / 2 + p['counterweight_mass_kg'] * p['counterweight_position_m']
    inertia = p['rod_mass_kg'] * p['rod_length_m']**2 / 3 + p['counterweight_mass_kg'] * p['counterweight_position_m']**2
    theta, v, omega = s['theta_unwrapped_rad'], s['cart_v_m_s'], s['theta_dot_rad_s']
    initial = [s['cart_x_m'], theta, total*v - first*math.cos(theta)*omega, inertia*omega - first*math.cos(theta)*v, 0, 0, 0, 0]
    duration = config['timing']['duration_s']
    times = np.linspace(0, duration, 21)
    boundaries = sorted(set([0, duration] + [c['at_s'] for c in config['input_program']]))

    def velocities(y):
        c = first * np.cos(y[1])
        d = total*inertia - c*c
        return (inertia*y[2]+c*y[3])/d, (c*y[2]+total*y[3])/d

    solutions = []
    for precision in [1e-11, 1e-12]:
        y = np.array(initial, dtype=float)
        values = [y.copy()]
        for lo, hi in zip(boundaries, boundaries[1:]):
            inputs = dict(force_requested_N=0, force_external_N=0, torque_external_Nm=0)
            for command in config['input_program']:
                if command['at_s'] <= lo:
                    inputs.update({k: val for k, val in command.items() if k != 'at_s'})

            def derivative(t, state):
                v, w = velocities(state)
                # Independent signed-power admissible interval, not app helper.
                magnitude = p['force_max_N'] if v == 0 else min(p['force_max_N'], p['power_max_W']/abs(v))
                drive = np.clip(inputs['force_requested_N'], -magnitude, magnitude)
                if abs(v) >= p['speed_max_m_s'] and drive*v > 0:
                    drive = 0
                friction = -p['cart_coulomb_N']*np.tanh(v/p['friction_smoothing_m_s']) - p['cart_viscous_N_s_m']*v
                joint = -p['joint_viscous_Nm_s_rad']*w
                return [v, w, drive+inputs['force_external_N']+friction,
                        first*np.sin(state[1])*v*w + first*p['gravity_m_s2']*np.sin(state[1]) + joint + inputs['torque_external_Nm'],
                        -friction*v-joint*w, drive*v, inputs['force_external_N']*v, inputs['torque_external_Nm']*w]

            sol = solve_ivp(derivative, (lo, hi), y, method='DOP853', rtol=precision, atol=precision/100, max_step=0.001 if precision == 1e-11 else 0.0005, dense_output=True)
            if not sol.success:
                raise RuntimeError(sol.message)
            values.extend(sol.sol(t) for t in times if lo < t <= hi)
            y = sol.y[:, -1]
        rows = []
        for value in values:
            v, w = velocities(value)
            rows.append([value[0], v, value[1], w, *value[4:]])
        solutions.append(np.array(rows))
    difference = np.max(np.abs(solutions[0]-solutions[1]), axis=0)
    if np.any(difference > 1e-9):
        raise RuntimeError(f'Oracle precision failed: {difference}')
    return dict(preset=config['preset'], id=config['benchmark'], physics=p, initial_state=s,
                input_program=config['input_program'], timing=config['timing'], precision_check_max_SI=difference.tolist(),
                points=[dict(sim_time_s=float(t), values=row.tolist()) for t, row in zip(times, solutions[1])])

configs = json.load(sys.stdin)
json.dump(dict(version='forced-momentum-dop853-1', python=platform.python_version(), scipy=scipy.__version__, numpy=np.__version__,
               generator_sha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
               columns=['cart_x_m', 'cart_v_m_s', 'theta_unwrapped_rad', 'theta_dot_rad_s', 'dissipated_energy_J', 'actuator_work_J', 'force_external_work_J', 'torque_external_work_J'],
               cases=[reference(config) for config in configs]), sys.stdout, indent=2, allow_nan=False)
print()
