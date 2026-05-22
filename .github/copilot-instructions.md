# Figma fidelity instructions

- Treat visual mismatches with Figma as system-level translation problems, not per-artwork cleanup.
- Do not manually move, nudge, resize, or otherwise tweak individual items in the app just to make one design match.
- Do not add one-off exceptions keyed to a specific layer, node, graph, label, or asset in order to align a single file.
- Fix fidelity issues by improving shared rendering, conversion, typography, spacing, transform, scaling, alignment, or preprocessing logic so the behavior generalizes across Figma files.
- When a mismatch appears isolated, identify the missing generalized rule behind it and implement that rule at the shared-system level.
- Optimize for the closest possible match to Figma as a whole across arbitrary incoming files, even when that means rejecting a quick per-item visual tweak.