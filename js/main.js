/**
 * EdgeFleet - Master Application Entry Point
 * High-performance decoupled architecture:
 * 1. 60 FPS Visual Render Loop (AMR lerp, camera, Three.js render)
 * 2. 25 Hz Fixed-Timestep Simulation Tick (physics, state machine, reservations, safety checks)
 * 3. Event-Driven & Throttled Predictive Fleet Planning (10 Hz)
 * 4. Real-time development performance profiling HUD (FPS, Frame Time, Render Time, Sim Time, Prediction Time, Draw Calls, Triangles)
 */

import { NavigationGraph } from './simulation/navigationGraph.js';
import { FleetManager } from './simulation/fleetManager.js';
import { Warehouse3DView } from './simulation/warehouse.js';
import { DashboardUI } from './ui/dashboard.js';
import { TaskUI } from './ui/taskUI.js';
import { CommConsoleUI } from './ui/commConsoleUI.js';
import { ScenarioUI } from './ui/scenarioUI.js';
import { AlgorithmUI } from './ui/algorithmUI.js';
import { AnalyticsUI } from './ui/analyticsUI.js';

class EdgeFleetApplication {
  constructor() {
    this.navGraph = new NavigationGraph();
    this.fleetManager = new FleetManager(this.navGraph);

    const canvas = document.getElementById('canvas3d');
    this.warehouse3d = new Warehouse3DView(canvas, this.navGraph, this.fleetManager);

    // Initialize UI subsystems
    this.dashboard = new DashboardUI(this.fleetManager, this.warehouse3d);
    this.taskUI = new TaskUI(this.fleetManager);
    this.commConsole = new CommConsoleUI();
    this.scenarioUI = new ScenarioUI(this.fleetManager, this.warehouse3d);
    this.algorithmUI = new AlgorithmUI(this.fleetManager);
    this.analyticsUI = new AnalyticsUI(this.fleetManager);

    this.lastTime = performance.now();
    this.uiUpdateCounter = 0;
    this.frameCount = 0;

    // Fixed Timestep Simulation Accumulator (Requirement 4 & 37)
    this.simAccumulator = 0.0;
    this.SIM_TICK_RATE = 25; // 25 Hz simulation updates
    this.FIXED_SIM_DT = 1.0 / this.SIM_TICK_RATE;

    // Real-time Performance Profiling State (Requirement 39)
    this.fpsRollingCount = 0;
    this.fpsLastSampleTime = performance.now();
    this.currentFPS = 60;
    this.lastFrameTimeMs = 16.6;
    this.lastRenderTimeMs = 4.0;
    this.cachedMeshCount = 0;

    // Count static scene meshes once
    this.countSceneMeshes();

    // Start Simulation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  countSceneMeshes() {
    let count = 0;
    this.warehouse3d.scene.traverse((obj) => {
      if (obj.isMesh) count++;
    });
    this.cachedMeshCount = count;
  }

  animate(currentTime) {
    requestAnimationFrame(this.animate);
    this.frameCount++;
    this.fpsRollingCount++;

    const tFrameStart = performance.now();
    const dt = Math.min(0.08, (currentTime - this.lastTime) / 1000);
    this.lastTime = currentTime;

    // Calculate rolling FPS
    if (currentTime - this.fpsLastSampleTime >= 1000) {
      this.currentFPS = Math.round((this.fpsRollingCount * 1000) / (currentTime - this.fpsLastSampleTime));
      this.fpsRollingCount = 0;
      this.fpsLastSampleTime = currentTime;
    }

    // 1. Fixed Timestep Simulation Tick (25 Hz Accumulator)
    if (this.fleetManager.isRunning) {
      this.simAccumulator += dt;
      let maxTicks = 3; // Prevent spiral of death on long lag spikes
      while (this.simAccumulator >= this.FIXED_SIM_DT && maxTicks > 0) {
        this.fleetManager.tick(this.FIXED_SIM_DT);
        this.simAccumulator -= this.FIXED_SIM_DT;
        maxTicks--;
      }
    }

    // 2. 60 FPS Visual Render Loop
    const tRenderStart = performance.now();
    this.warehouse3d.render(currentTime / 1000, dt);
    this.lastRenderTimeMs = performance.now() - tRenderStart;

    this.lastFrameTimeMs = performance.now() - tFrameStart;

    // 3. Periodic UI Updates & Real-Time Performance Monitor HUD (5Hz)
    this.uiUpdateCounter += dt;
    if (this.uiUpdateCounter >= 0.2) {
      this.uiUpdateCounter = 0;
      this.dashboard.update();
      this.taskUI.update();
      this.scenarioUI.update();
      this.algorithmUI.update();
      this.analyticsUI.update();
      this.updateDiagnosticsHUD();
    }
  }

  updateDiagnosticsHUD() {
    const el = (id) => document.getElementById(id);
    if (!el('hud-three-fps')) return;

    // Actual measured data (Requirement 39)
    const fpsEl = el('hud-three-fps');
    if (fpsEl) {
      fpsEl.textContent = `${this.currentFPS} FPS`;
      fpsEl.className = 'hud-val ' + (this.currentFPS >= 50 ? 'ok' : this.currentFPS >= 35 ? 'warn' : 'danger');
    }

    if (el('hud-frame-time')) {
      el('hud-frame-time').textContent = `${this.lastFrameTimeMs.toFixed(1)} ms`;
    }
    if (el('hud-render-time')) {
      el('hud-render-time').textContent = `${this.lastRenderTimeMs.toFixed(1)} ms`;
    }
    if (el('hud-sim-time')) {
      const simMs = this.fleetManager.perfMetrics?.simTimeMs || 0;
      el('hud-sim-time').textContent = `${simMs.toFixed(1)} ms`;
    }
    if (el('hud-pred-time')) {
      const predMs = this.fleetManager.perfMetrics?.predictionTimeMs || 0;
      el('hud-pred-time').textContent = `${predMs.toFixed(1)} ms`;
    }

    // Three.js renderer draw calls & triangles info
    const renderInfo = this.warehouse3d.renderer?.info?.render;
    if (renderInfo) {
      if (el('hud-draw-calls')) el('hud-draw-calls').textContent = `${renderInfo.calls}`;
      if (el('hud-triangles')) {
        const triCount = renderInfo.triangles;
        el('hud-triangles').textContent = triCount > 1000 ? `${(triCount / 1000).toFixed(1)}k` : `${triCount}`;
      }
    }

    if (el('hud-scene-objects')) {
      el('hud-scene-objects').textContent = `${this.cachedMeshCount} meshes`;
    }

    const amrActiveCount = this.fleetManager.amrs.length;
    if (el('hud-amr-count')) {
      el('hud-amr-count').textContent = `${amrActiveCount}/5 Operational`;
    }

    const nodeCount = this.navGraph.nodes.size;
    const edgeCount = this.navGraph.edges.size;
    if (el('hud-graph-stats')) {
      el('hud-graph-stats').textContent = `${nodeCount} nodes | ${edgeCount} edges`;
    }
  }
}

// Bootstrap on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.edgeFleetApp = new EdgeFleetApplication();
  console.log('[EdgeFleet] Industrial 3D AMR Fleet Simulation & Dashboard Initialized with High-Performance Architecture.');
});
