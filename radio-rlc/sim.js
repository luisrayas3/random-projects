// This function should implement an Euler method calculation
// for the RLC circuit simulation
//
// Parameters:
//   - time: current simulation time (seconds)
//   - lastState: previous state object { iL, vC }
//   - params: { R, L, C, frequency, V0 }
//
// Return: updated state { iL, vC }
//
export function eulerStep(inputPhase, lastState, params) {
  const { dw, V0, f, R, L, C } = params;
  const { iL, vC } = lastState;

  // Supply voltage at this time
  const vS = V0 * Math.sin(inputPhase);
  // Real time-step
  const dt = dw / f;

  // TODO: Implement
  const diL = 0;
  const dvC = 0;

  // Simple Euler update
  return { iL: iL + diL * dt, vC: vC + dvC * dt };
}

const math = {
  complex: function (real, imag) {
    return { re: real, im: imag };
  },
  add: function (a, b) {
    return { re: a.re + b.re, im: a.im + b.im };
  },
  sub: function (a, b) {
    return { re: a.re - b.re, im: a.im - b.im };
  },
  mul: function (a, b) {
    return {
      re: a.re * b.re - a.im * b.im,
      im: a.re * b.im + a.im * b.re,
    };
  },
  div: function (a, b) {
    const denom = b.re * b.re + b.im * b.im;
    return {
      re: (a.re * b.re + a.im * b.im) / denom,
      im: (a.im * b.re - a.re * b.im) / denom,
    };
  },
  abs: function (a) {
    return Math.sqrt(a.re * a.re + a.im * a.im);
  },
  phase: function (a) {
    return Math.atan2(a.im, a.re);
  },
};
