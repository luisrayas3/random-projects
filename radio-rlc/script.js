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

// Frequency response graph constants (log scale)
const freqPoints = 200;
const freqMin = 10000000; // Hz
const freqMax = 10000000000; // Hz
const freqScale = Math.pow(freqMax / freqMin, 1 / (freqPoints - 1));

// Sim constants
const simFrequency = 60; // Hz
const secondsPerPeriod = 10; // s
const pointsPerPeriod = simFrequency * secondsPerPeriod;
const periodsToShow = 2;
const totalPoints = pointsPerPeriod * periodsToShow;

// Current circuit parameters
let params = {
  dw: (2 * Math.PI) / pointsPerPeriod,
  V0: 1.0,
  f: parseFloat(frequencySlider.value),
  R: parseFloat(resistanceSlider.value),
  L: parseFloat(inductanceSlider.value) / 1000000000, // Convert nH to H
  C: parseFloat(capacitanceSlider.value) / 1000000000000, // Convert pF to F
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
      labels: inputPhaseArray.map(
        (phase) => Math.round((100 * phase) / (2 * Math.PI)) / 100
      ),
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
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Input phase (rad / 2π)",
          },
        },
        y: {
          title: {
            display: true,
            text: "Voltage (V)",
          },
          min: -1.5 * 10000,
          max: 1.5 * 10000,
        },
      },
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
          backgroundColor: "blue",
          pointRadius: 8,
        },
        {
          label: "Inductor impedance",
          data: [{ x: 0, y: 2 * Math.PI * params.f * params.L }],
          backgroundColor: "red",
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
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: {
            display: true,
            text: "Real part (Ω)",
          },
          min: -100,
          max: 500,
        },
        y: {
          title: {
            display: true,
            text: "Imaginary part (Ω)",
          },
          min: -5000,
          max: 5000,
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
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "logarithmic",
          title: {
            display: true,
            text: "Frequency (MHz)",
          },
          min: freqMin / 1000000,
          max: freqMax / 1000000,
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
  frequencySlider.addEventListener("input", () => {
    params.f = parseFloat(frequencySlider.value);
    frequencyValue.textContent = frequencySlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });
  resistanceSlider.addEventListener("input", () => {
    params.R = parseFloat(resistanceSlider.value);
    resistanceValue.textContent = resistanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });
  inductanceSlider.addEventListener("input", () => {
    params.L = parseFloat(inductanceSlider.value) / 1000000000; // nH to H
    inductanceValue.textContent = inductanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });
  capacitanceSlider.addEventListener("input", () => {
    params.C = parseFloat(capacitanceSlider.value) / 1000000000000; // pF to F
    capacitanceValue.textContent = capacitanceSlider.value;
    updatePhasorDiagram();
    updateFrequencyResponse();
  });
}

function updateSimulation() {
  const inputPhase = inputPhaseArray[scanPosition];
  const { V0, R } = params;

  // Run one simulation step.
  const { iL, vC } = eulerStep(inputPhase, simulationState, params);
  const vS = V0 * Math.sin(inputPhase);
  const vR = iL * R;
  const vL = vS - vR - vC;

  // Update the voltage arrays (plotted by reference).
  voltageSeries.vS[scanPosition] = vS;
  voltageSeries.vR[scanPosition] = vR;
  voltageSeries.vL[scanPosition] = vL;
  voltageSeries.vC[scanPosition] = vC;

  // TODO: Add a scan line at the current position

  waveformChart.update();

  // Prepare for next tick.
  scanPosition += 1;
  scanPosition %= totalPoints;
}

function updatePhasorDiagram() {
  const { f, R, L, C } = params;
  const omega = 2 * Math.PI * f;
  const ZR = R;
  const ZL = omega * L;
  const ZC = 1 / (omega * C);
  phasorChart.data.datasets[0].data = [{ x: ZR, y: 0 }];
  phasorChart.data.datasets[1].data = [{ x: 0, y: ZL }];
  phasorChart.data.datasets[2].data = [{ x: 0, y: -ZC }];
  phasorChart.data.datasets[3].data = [{ x: ZR, y: ZL - ZC }];
  phasorChart.update();
}

function updateFrequencyResponse() {
  const { R, L, C } = params;

  // Calculate frequency response curve
  const frequencies = [];
  const magnitudes = [];
  const halfPowerLine = [];
  for (let i = 0; i < freqPoints; i++) {
    const f = freqMin * Math.pow(freqScale, i);
    frequencies.push(f);

    // Calculate impedance at this frequency
    const omega = 2 * Math.PI * f;
    const XL = omega * L;
    const XC = 1 / (omega * C);
    const Z = Math.sqrt(R * R + (XL - XC) * (XL - XC));

    // Calculate gain (voltage across resistor / source voltage)
    magnitudes.push(params.R / Z);

    // Add half-power point (0.707 of max)
    halfPowerLine.push(0.707);
  }

  // Calculate characteristics
  const fc = 1 / (2 * Math.PI * Math.sqrt(params.L * params.C));
  const Q = (1 / params.R) * Math.sqrt(params.L / params.C);
  const bw = fc / Q;
  const halfPowerFreqLow = fc - bw / 2;
  const halfPowerFreqHigh = fc + bw / 2;

  // TODO: Show half-power bandwidth on chart
  // TODO: Show vertical line for supply frequency

  // Update response chart
  responseChart.data.labels = frequencies.map((f) => (f / 1000000).toFixed(0));
  responseChart.data.datasets[0].data = magnitudes;
  responseChart.data.datasets[1].data = halfPowerLine;
  responseChart.update();

  // Characteristics str in title
  const fcStr = (fc / 1000000).toFixed(0);
  const qStr = Q.toFixed(2);
  const bwStr = (bw / 1000000).toFixed(0);
  const characteristicsStr = `fc = ${fcStr}MHz, Q = ${qStr}, BW = ${bwStr}MHz`;
  document.getElementById("characteristics").textContent = characteristicsStr;
}
