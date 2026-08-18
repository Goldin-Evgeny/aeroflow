# Outlet-feedback discriminator

- Run id: `2026-08-18-outlet-feedback-discriminator`
- Recorded: 2026-08-18T10:02:54.578Z
- Source: 862a762+dirty
- Configuration: tau0=0.5000005, Cs=0.1, closure=spec, grid=10x8x7
- Exposure/cadence: 3600 / 25 steps
- Result: **outlet-feedback-observed**
- Earliest separation: {"step":25,"metric":"boundaryInlet","difference":0.00041751959622615686,"threshold":5.2329397671266e-9}
- Last common sampled state: 0
- Divergence: zero-gradient=3346, pressure=none
- Material fingerprint: `7e578e583ab2b6a173253e0a24d77ded2ac902c0192f334c18b77ad893a8839f`
- Initial-state fingerprint: `f4d0eddd7d33029599aaac8012b183ea9e514b161e19d25a891c3ea75bd58c3b`
- Repeatability thresholds: 36; non-zero control differences: 0

The same-outlet controls were completed and their thresholds frozen before the A/B comparison.
Every sample retains mass, momentum, density, complete-shell boundary exchange, streamwise profiles, subgrid/strain summaries, and wavelength-band energy.
The result identifies outlet-dependent feedback only; it does not name an unmeasured internal cause or implement a repair.

Machine-readable evidence: [outlet-feedback.json](artifacts/2026-08-18-outlet-feedback-discriminator/outlet-feedback.json)
