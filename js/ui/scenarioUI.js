/**
 * EdgeFleet - Scenario Control Center & Click-to-Inject UI
 * Manages demo launches, active hazard list, event timeline playback, and 3D floor injection context menu.
 */

import { logger } from '../communication/eventLogger.js';

export class ScenarioUI {
  constructor(fleetManager, warehouse3d) {
    this.fleet = fleetManager;
    this.scenarios = fleetManager.scenarios;
    this.warehouse = warehouse3d;
    this.pendingClickCoords = null;

    this.initDemoButtons();
    this.initContextMenu();
  }

  initDemoButtons() {
    // Presets 1 to 7 and Wi-Fi Dead Zone Suite
    const binds = {
      'btn-demo-1': () => this.scenarios.runDemo1_NormalTaskAllocation(),
      'btn-demo-2': () => this.scenarios.runDemo2_SharedAisleCoordination(),
      'btn-demo-3amr-junction': () => this.scenarios.runTest_ThreeAmrJunctionCoordination(),
      'btn-demo-3': () => this.scenarios.runDemo3_LowBatteryReassignment(),
      'btn-demo-4': () => this.scenarios.runDemo4_WifiDeadZoneUWBRelay(),
      'btn-demo-deadzone-no-peer': () => this.scenarios.runTest_DeadZoneNoPeer(),
      'btn-demo-deadzone-dynamic': () => this.scenarios.runTest_DeadZoneDynamicPeer(),
      'btn-demo-deadzone-conflict': () => this.scenarios.runTest_DeadZoneFutureConflict(),
      'btn-demo-5': () => this.scenarios.runDemo5_FireEmergencyDStarLite(),
      'btn-demo-6': () => this.scenarios.runDemo6_DynamicObstacle(),
      'btn-demo-7': () => this.scenarios.runDemo7_EfficiencyBenchmark()
    };

    for (const [id, fn] of Object.entries(binds)) {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', fn);
    }

    const clearAllBtn = document.getElementById('btn-clear-all-hazards');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this.scenarios.clearAllHazards());
    }
  }

  initContextMenu() {
    const menu = document.getElementById('inject-context-menu');

    this.warehouse.onFloorClickCallback = (hitData) => {
      this.pendingClickCoords = { x: hitData.worldX, z: hitData.worldZ };
      if (menu) {
        menu.style.display = 'block';
        menu.style.left = `${Math.min(window.innerWidth - 220, hitData.screenX)}px`;
        menu.style.top = `${Math.min(window.innerHeight - 200, hitData.screenY)}px`;
      }
    };

    // Close menu on outside click
    document.addEventListener('pointerdown', (e) => {
      if (menu && !menu.contains(e.target) && e.target !== this.warehouse.canvas) {
        menu.style.display = 'none';
      }
    });

    // Menu item clicks
    document.querySelectorAll('.inject-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.inject;
        if (this.pendingClickCoords && type) {
          this.scenarios.injectHazard(type, this.pendingClickCoords.x, this.pendingClickCoords.z);
        }
        if (menu) menu.style.display = 'none';
      });
    });
  }

  update() {
    // 1. Update Active Hazards Table
    const tableBody = document.getElementById('hazards-table-body');
    if (tableBody) {
      const hazards = this.scenarios.activeHazards;
      if (hazards.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--tx-muted);padding:14px">No active hazards. Warehouse environment is normal.</td></tr>';
      } else {
        tableBody.innerHTML = hazards.map(h => `
          <tr>
            <td><b style="color:var(--status-danger)">${h.name}</b></td>
            <td><span class="status-pill danger">${h.type}</span></td>
            <td>(${h.x.toFixed(1)}, ${h.z.toFixed(1)})</td>
            <td>${h.radius} m</td>
            <td><span class="status-pill warning">${h.severity}</span></td>
            <td>
              <button class="ctrl-btn" onclick="window.edgeFleetApp.scenarioUI.clearHazard('${h.id}')">
                Clear ✕
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // 2. Update Live Event Timeline
    const timelineEl = document.getElementById('scenario-timeline-track');
    if (timelineEl) {
      const timeline = logger.getTimeline();
      timelineEl.innerHTML = timeline.slice(0, 15).map(evt => `
        <div class="timeline-event-item">
          <div class="timeline-event-dot" style="${evt.type === 'danger' ? 'background:var(--status-danger)' : evt.type === 'warning' ? 'background:var(--status-warning)' : 'background:var(--accent-sky)'}"></div>
          <span class="timeline-event-time">${evt.time}</span>
          <div class="timeline-event-text">
            <b>${evt.title}</b> — <span style="color:var(--tx-secondary)">${evt.description}</span>
          </div>
        </div>
      `).join('');
    }
  }

  clearHazard(id) {
    this.scenarios.clearHazard(id);
    this.update();
  }
}
