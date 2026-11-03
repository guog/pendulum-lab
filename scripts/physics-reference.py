"""Offline oracle: independent generalized momenta + SciPy DOP853, never imports app dynamics.

Input: JSON array of frozen benchmark inputs on stdin; output: reference fixture on stdout.
Run with scipy==1.17.0. See docs/design/t02-physics-benchmarks.md for derivation.
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


def reference(entry):
    config = entry["config"]
    p = config["physics"]
    s = config["initial_state"]
    mass = p["cart_mass_kg"] + p["rod_mass_kg"] + p["counterweight_mass_kg"]
    a = p["rod_mass_kg"] * p["rod_length_m"] / 2 + p["counterweight_mass_kg"] * p["counterweight_position_m"]
    b = p["rod_mass_kg"] * p["rod_length_m"] ** 2 / 3 + p["counterweight_mass_kg"] * p["counterweight_position_m"] ** 2

    def velocities(theta, px, pt):
        coupling = a * np.cos(theta)
        det = mass * b - coupling * coupling
        return (b * px + coupling * pt) / det, (coupling * px + mass * pt) / det

    def derivative(t, y):
        _, theta, px, pt, _ = y
        v, omega = velocities(theta, px, pt)
        force = -p["cart_coulomb_N"] * np.tanh(v / p["friction_smoothing_m_s"]) - p["cart_viscous_N_s_m"] * v
        torque = -p["joint_viscous_Nm_s_rad"] * omega
        return [v, omega, force, a * np.sin(theta) * v * omega + a * p["gravity_m_s2"] * np.sin(theta) + torque, -force * v - torque * omega]

    theta, v, omega = s["theta_unwrapped_rad"], s["cart_v_m_s"], s["theta_dot_rad_s"]
    initial = [s["cart_x_m"], theta, mass * v - a * math.cos(theta) * omega, b * omega - a * math.cos(theta) * v, 0]
    # Reference checkpoints must be actual recorded times, never app interpolation.
    period = config["timing"]["sample_period_s"]
    times = np.unique(np.round(np.linspace(0, config["timing"]["duration_s"], 41) / period) * period)
    solutions = []
    for rtol, atol, max_step in [(1e-11, 1e-13, 0.01), (1e-12, 1e-14, 0.005)]:
        sol = solve_ivp(derivative, (0, times[-1]), initial, method="DOP853", t_eval=times, rtol=rtol, atol=atol, max_step=max_step)
        if not sol.success:
            raise RuntimeError(sol.message)
        velocity, angular_velocity = velocities(sol.y[1], sol.y[2], sol.y[3])
        solutions.append(np.array([sol.y[0], velocity, sol.y[1], angular_velocity, sol.y[4]]).T)
    difference = np.max(np.abs(solutions[0] - solutions[1]), axis=0)
    if np.any(difference > 1e-8):
        raise RuntimeError(f"Reference precision cross-check failed: {difference}")
    initial_energy = mass * v * v / 2 - a * math.cos(theta) * v * omega + b * omega * omega / 2 + a * p["gravity_m_s2"] * (1 + math.cos(theta))
    return {
        "id": entry["id"], "preset": config["preset"],
        "physics": p, "initial_state": s, "duration_s": float(times[-1]),
        "mass_properties": {"total_mass_kg": mass, "first_moment_kg_m": a, "pivot_inertia_kg_m2": b, "pendulum_com_from_pivot_m": a / (p["rod_mass_kg"] + p["counterweight_mass_kg"])},
        "initial_energy_J": initial_energy,
        "precision_check_max_SI": difference.tolist(),
        "points": [{"sim_time_s": float(t), "state": row[:4].tolist(), "dissipated_energy_J": float(row[4])} for t, row in zip(times, solutions[1])],
    }


entries = json.load(sys.stdin)
# Exact equilibria have an analytic oracle; do not introduce sin(pi) roundoff via SciPy.
cases = [reference(entry) for entry in entries if not entry["id"].startswith("equilibrium") and entry["id"] != "numerical-failure"]
json.dump({
    "version": "momentum-dop853-2", "python": platform.python_version(), "scipy": scipy.__version__, "numpy": np.__version__,
    "generator_sha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
    "method": "DOP853; generalized momenta; rtol=1e-12 atol=1e-14 max_step=0.005s; checked against 1e-11/1e-13/0.01s",
    "columns": ["cart_x_m", "cart_v_m_s", "theta_unwrapped_rad", "theta_dot_rad_s"],
    "cases": cases,
}, sys.stdout, indent=2, allow_nan=False)
print()
