// Implement a forward Euler method calculation
// for RLC circuit simulation.
//
// Parameters:
//   - inputPhase: phase of the input in radians
//   - lastState: previous state object { iL, vC }
//   - params: circuit parameters
//
// Return: updated state { iL, vC }
//
export function eulerStep(inputPhase, lastState, params) {
  const { dw, V0, f, R, L, C } = params;
  const { iL, vC } = lastState;

  // Supply voltage at this time
  const vS = V0 * Math.sin(inputPhase);
  // Differential equation
  const vL = vS - iL * R - vC;
  const diL = vL / L;
  const dvC = iL / C;

  // Forward Euler update
  const dt = dw / (2 * Math.PI) / f;
  return { iL: iL + diL * dt, vC: vC + dvC * dt };
}
