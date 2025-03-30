import { eulerStep } from "./sim.js";

// DOM elements
const resistanceSlider = document.getElementById("resistance");
const resistanceValue = document.getElementById("resistance-value");
const inductanceSlider = document.getElementById("inductance");
const inductanceValue = document.getElementById("inductance-value");
const capacitanceSlider = document.getElementById("capacitance");
const capacitanceValue = document.getElementById("capacitance-value");
const frequencySlider = document.getElementById("frequency");
const frequencyValue = document.getElementById("frequency-value");

// Plot constants
const simFrequency = 60; // Hz
const secondsPerPeriod = 2; // s
const pointsPerPeriod = simFrequency * secondsPerPeriod;
const periodsToShow = 2;
const totalPoints = pointsPerPeriod * periodsToShow;

// Current circuit parameters
let params = {
  dw: (2 * Math.PI) / pointsPerPeriod,
  V0: 1.0,
  f: parseFloat(frequencySlider.value),
  R: parseFloat(resistanceSlider.value),
  L: parseFloat(inductanceSlider.value) / 1000, // Convert mH to H
  C: parseFloat(capacitanceSlider.value) / 1000000, // Convert µF to F
};

// Initialize simulation arrays
let inputPhaseArray = Array.from(
  { length: totalPoints },
  (_, i) => 2 * Math.PI * (i / pointsPerPeriod)
);
let voltageSeries = {
  vS: Array(totalPoints).fill(0),
  vR: Array(totalPoints).fill(0),
  vL: Array(totalPoints).fill(0),
  vC: Array(totalPoints).fill(0),
};
let simulationState = { iL: 0, vC: 0 };
let scanPosition = 0;

// Initialize Chart.js charts
let waveformChart, phasorChart, responseChart;

// Setup charts once the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  setupCharts();
  setupEventListeners();
  setInterval(updateSimulation, 1 / simFrequency);
});

function setupCharts() {
  // Waveform Chart
  const waveformCtx = document
    .getElementById("waveform-chart")
    .getContext("2d");
  waveformChart = new Chart(waveformCtx, {
    type: "line",
    data: {
      labels: inputPhaseArray,
      datasets: [
        {
          label: "Source voltage",
          data: voltageSeries.vS,
          borderColor: "black",
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: "Resistor voltage",
          data: voltageSeries.vR,
          borderColor: "blue",
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: "Inductor voltage",
          data: voltageSeries.vL,
          borderColor: "red",
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: "Capacitor voltage",
          data: voltageSeries.vC,
          borderColor: "green",
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Input phase (rad)",
          },
        },
        y: {
          title: {
            display: true,
            text: "Voltage (V)",
          },
          min: -1.5,
          max: 1.5,
        },
      },
      // plugins: {
      //   annotation: {
      //     annotations: {
      //       scanLine: {
      //         type: "line",
      //         xMin: 0,
      //         xMax: 0,
      //         borderColor: "rgba(0, 0, 0, 0.5)",
      //         borderWidth: 2,
      //         borderDash: [5, 5],
      //       },
      //     },
      //   },
      // },
    },
  });

  // Phasor chart
  const phasorCtx = document.getElementById("phasor-chart").getContext("2d");
  phasorChart = new Chart(phasorCtx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Resistor impedance",
          data: [{ x: params.R, y: 0 }],
          backgroundColor: "red",
          pointRadius: 8,
        },
        {
          label: "Inductor impedance",
          data: [{ x: 0, y: 2 * Math.PI * params.f * params.L }],
          backgroundColor: "blue",
          pointRadius: 8,
        },
        {
          label: "Capacitor impedance",
          data: [{ x: 0, y: -1 / (2 * Math.PI * params.f * params.C) }],
          backgroundColor: "green",
          pointRadius: 8,
        },
        {
          label: "Total impedance",
          data: [{ x: 0, y: 0 }],
          backgroundColor: "black",
          pointRadius: 8,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Real part (Ω)",
          },
          min: -500,
          max: 500,
        },
        y: {
          title: {
            display: true,
            text: "Imaginary part (Ω)",
          },
          min: -500,
          max: 500,
        },
      },
    },
  });

  // Frequency Response Chart
  const responseCtx = document
    .getElementById("response-chart")
    .getContext("2d");
  responseChart = new Chart(responseCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Magnitude response",
          data: [],
          borderColor: "purple",
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: "Half-power (-3dB)",
          data: [],
          borderColor: "rgba(255, 0, 0, 0.5)",
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "logarithmic",
          title: {
            display: true,
            text: "Frequency (Hz)",
          },
          min: 1,
          max: 1000,
        },
        y: {
          title: {
            display: true,
            text: "Gain",
          },
          min: 0,
          max: 1.2,
        },
      },
    },
  });

  updateFrequencyResponse();
}

function setupEventListeners() {
  // Update displayed values and circuit parameters when sliders change
  resistanceSlider.addEventListener("input", () => {
    params.R = parseFloat(resistanceSlider.value);
    resistanceValue.textContent = resistanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });

  inductanceSlider.addEventListener("input", () => {
    params.L = parseFloat(inductanceSlider.value) / 1000; // mH to H
    inductanceValue.textContent = inductanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });

  capacitanceSlider.addEventListener("input", () => {
    params.C = parseFloat(capacitanceSlider.value) / 1000000; // µF to F
    capacitanceValue.textContent = capacitanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });

  frequencySlider.addEventListener("input", () => {
    params.f = parseFloat(frequencySlider.value);
    frequencyValue.textContent = frequencySlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });
}

function updateSimulation() {
  const inputPhase = inputPhaseArray[scanPosition];

  // Use the user-defined Euler step function to update the simulation state
  simulationState = eulerStep(inputPhase, simulationState, params);

  // Calculate voltages based on simulation state
  const vS = params.V0 * Math.sin(inputPhase);
  const vC = simulationState.vC;
  const vR = simulationState.iL * params.R;
  const vL = vS - vR - vC;

  // Update the voltage arrays
  voltageSeries.vS[scanPosition] = vS;
  voltageSeries.vR[scanPosition] = vR;
  voltageSeries.vL[scanPosition] = vL;
  voltageSeries.vC[scanPosition] = vC;

  // Update the waveform chart
  // TODO: Needed?
  waveformChart.data.datasets[0].data = voltageSeries.vS;
  waveformChart.data.datasets[1].data = voltageSeries.vR;
  waveformChart.data.datasets[2].data = voltageSeries.vL;
  waveformChart.data.datasets[3].data = voltageSeries.vC;

  // Add a scan line at the current position
  if (
    waveformChart.options.plugins &&
    waveformChart.options.plugins.annotation &&
    false
  ) {
    waveformChart.options.plugins.annotation.annotations = {
      scanLine: {
        type: "line",
        xMin: inputPhase,
        xMax: inputPhase,
        borderColor: "rgba(0, 0, 0, 0.5)",
        borderWidth: 2,
        borderDash: [5, 5],
      },
    };
  }

  waveformChart.update();

  // Prepare for next tick.
  scanPosition += 1;
  scanPosition %= totalPoints;
}

function updatePhasorDiagram() {
  const twoPiF = 2 * Math.PI * params.f;
  const ZR = params.R;
  const ZL = twoPiF * params.L;
  const ZC = 1 / (twoPiF * params.C);
  phasorChart.data.datasets[0].data = [{ x: ZR, y: 0 }];
  phasorChart.data.datasets[1].data = [{ x: 0, y: ZL }];
  phasorChart.data.datasets[2].data = [{ x: 0, y: -ZC }];
  phasorChart.data.datasets[3].data = [{ x: ZR, y: ZL - ZC }];
  phasorChart.update();
}

function updateFrequencyResponse() {
  // Generate frequency points (logarithmic scale)
  const freqPoints = 200;
  const freqMin = 1;
  const freqMax = 1000;
  const freqScale = Math.pow(freqMax / freqMin, 1 / (freqPoints - 1));

  const frequencies = [];
  const magnitudes = [];
  const halfPowerLine = [];

  // Calculate resonant frequency
  const resonantFreq = 1 / (2 * Math.PI * Math.sqrt(params.L * params.C));

  // Calculate Q factor
  const Q = (1 / params.R) * Math.sqrt(params.L / params.C);

  // Calculate bandwidth
  const bandwidth = resonantFreq / Q;

  // Calculate frequency response curve
  for (let i = 0; i < freqPoints; i++) {
    const f = freqMin * Math.pow(freqScale, i);
    frequencies.push(f);

    // Calculate impedance at this frequency
    const XL = 2 * Math.PI * f * params.L;
    const XC = 1 / (2 * Math.PI * f * params.C);
    const Z = Math.sqrt(params.R * params.R + (XL - XC) * (XL - XC));

    // Calculate gain (voltage across resistor / source voltage)
    magnitudes.push(params.R / Z);

    // Add half-power point (0.707 of max)
    halfPowerLine.push(0.707);
  }

  // Update response chart
  responseChart.data.labels = frequencies;
  responseChart.data.datasets[0].data = magnitudes;
  responseChart.data.datasets[1].data = halfPowerLine;

  // Mark the bandwidth on the chart
  const halfPowerFreqLow = resonantFreq - bandwidth / 2;
  const halfPowerFreqHigh = resonantFreq + bandwidth / 2;

  // Update chart
  responseChart.update();
}
