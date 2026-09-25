/**
 * EdgeFleet - Dashboard & View Navigation Controller
 * Manages tab switching, AMR drawer inspector, top KPI bar updates, and simulation controls.
 */

export class DashboardUI {
  constructor(fleetManager, warehouse3d) {
    this.fleet = fleetManager;
    this.warehouse = warehouse3d;
    this.currentView = 'simulation';

    this.initNavigation();
    this.initSimControls();
    this.initAmrDrawer();
  }

  initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const viewId = item.dataset.view;
        this.switchView(viewId);
      });
    });
  }

  switchView(viewId) {
    this.currentView = viewId;

    // Update nav links active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewId);
    });

    // Update view panels
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${viewId}`);
    });

    // Update top bar title
    const titles = {
      overview: 'Fleet Overview & Systems Dashboard',
      simulation: '3D Warehouse Digital Twin & Trajectory Execution',
      tasks: 'Task Management & Multi-Criteria Auction Table',
      communication: 'Live Communication Console & Protocol Feed',
      fleet: 'Autonomous Mobile Robot Fleet Telemetry',
      algorithms: 'MAPF, D* Lite & Safety Supervisor Algorithm Monitor',
      safety: 'Zero-Collision Safety Verification Dashboard',
      scenarios: 'Scenario Control Center & Dynamic Event Injection',
      analytics: 'Fleet Analytics & Efficiency Comparison Benchmark'
    };

    const titleEl = document.getElementById('page-title-text');
    if (titleEl) {
      titleEl.textContent = titles[viewId] || 'EdgeFleet Simulation';
    }

    if (viewId === 'simulation') {
      this.warehouse.resize();
      this.warehouse.fitCameraToWarehouse();
    }
  }

  initSimControls() {
    // Play/Pause
    const playPauseBtn = document.getElementById('btn-play-pause');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.fleet.isRunning = !this.fleet.isRunning;
        playPauseBtn.innerHTML = this.fleet.isRunning ? '⏸ Pause' : '▶ Start Simulation';
        playPauseBtn.classList.toggle('primary', !this.fleet.isRunning);
      });
    }

    // Reset
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.fleet.reset();
        if (playPauseBtn) {
          playPauseBtn.innerHTML = '▶ Start Simulation';
          playPauseBtn.classList.add('primary');
        }
      });
    }

    // Step Simulation
    const stepBtn = document.getElementById('btn-step');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        this.fleet.isRunning = false;
        if (playPauseBtn) {
          playPauseBtn.innerHTML = '▶ Start Simulation';
          playPauseBtn.classList.add('primary');
        }
        this.fleet.tick(0.1);
      });
    }

    // Speed Selector (0.5x, 1x, 2x, 5x)
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.fleet.simSpeed = Number(btn.dataset.speed || 1.0);
      });
    });

    // 3D Camera Preset Buttons
    document.querySelectorAll('[data-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cam]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.warehouse.setView(btn.dataset.cam);
      });
    });

    // Layer Checkboxes
    document.querySelectorAll('[data-layer]').forEach(chk => {
      chk.addEventListener('change', () => {
        this.warehouse.toggleLayer(chk.dataset.layer, chk.checked);
      });
    });
  }

  initAmrDrawer() {
    const drawer = document.getElementById('amr-drawer');
    const closeBtn = document.getElementById('btn-close-drawer');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.remove('open');
      });
    }

    this.warehouse.onAmrClickCallback = (amrId) => {
      this.fleet.selectedAmrId = amrId;
      this.openAmrDrawer(amrId);
    };
  }

  openAmrDrawer(amrId) {
    const amr = this.fleet.getAmr(amrId);
    if (!amr) return;

    this.fleet.selectedAmrId = amrId;
    const drawer = document.getElementById('amr-drawer');
    drawer.classList.add('open');

    this.updateAmrDrawerContent(amr);
  }

  updateAmrDrawerContent(amr) {
    const el = (id) => document.getElementById(id);

    if (el('drawer-amr-id')) el('drawer-amr-id').textContent = amr.id;
    if (el('drawer-amr-state')) {
      const stateEl = el('drawer-amr-state');
      const statusText = amr.getDisplayStatus ? amr.getDisplayStatus() : amr.state;
      stateEl.textContent = statusText;
      stateEl.className = 'amr-state-tag ' + (amr.state === 'EMERGENCY' ? 'danger' : amr.state === 'MOVING' ? 'success' : 'info');
    }

    if (el('drawer-pos-x')) el('drawer-pos-x').textContent = amr.position.x.toFixed(2);
    if (el('drawer-pos-z')) el('drawer-pos-z').textContent = amr.position.z.toFixed(2);
    if (el('drawer-velocity')) el('drawer-velocity').textContent = `${amr.velocity.toFixed(2)} m/s`;
    if (el('drawer-heading')) el('drawer-heading').textContent = `${((amr.heading * 180 / Math.PI + 360) % 360).toFixed(0)}°`;

    if (el('drawer-battery-val')) el('drawer-battery-val').textContent = `${amr.battery.toFixed(1)}%`;
    if (el('drawer-battery-fill')) {
      const fill = el('drawer-battery-fill');
      fill.style.width = `${amr.battery}%`;
      fill.className = 'progress-bar-fill ' + (amr.battery > 50 ? 'battery-high' : amr.battery > 20 ? 'battery-mid' : 'battery-low');
    }

    if (el('drawer-distance')) el('drawer-distance').textContent = `${amr.totalDistanceM.toFixed(1)} m`;
    if (el('drawer-energy')) el('drawer-energy').textContent = `${amr.energyConsumedWh.toFixed(1)} Wh`;
    if (el('drawer-task-id')) el('drawer-task-id').textContent = amr.currentTask ? `#${amr.currentTask.id}` : 'None (Idle)';
    if (el('drawer-payload')) el('drawer-payload').textContent = `${amr.payloadKg} kg`;

    if (el('drawer-box-id')) {
      el('drawer-box-id').textContent = amr.carriedBox ? `${amr.carriedBox.id} (${amr.carriedBox.weight} kg)` : (amr.currentTask && amr.currentTask.boxId ? `Assigned: ${amr.currentTask.boxId}` : 'None');
      el('drawer-box-id').style.color = amr.carriedBox ? 'var(--accent-amber)' : 'var(--tx-secondary)';
    }

    if (el('drawer-payload-capacity')) {
      el('drawer-payload-capacity').textContent = `${amr.payloadCapacity || 350} kg`;
    }

    if (el('drawer-handling-state')) {
      el('drawer-handling-state').textContent = amr.materialHandlingState || 'NONE';
      el('drawer-handling-state').className = 'status-pill ' + (amr.materialHandlingState === 'TRANSPORTING' ? 'success' : amr.materialHandlingState.startsWith('LIFTING') || amr.materialHandlingState.startsWith('ALIGNING') ? 'warning' : 'neutral');
    }

    if (el('drawer-comm-state')) {
      el('drawer-comm-state').textContent = amr.communicationState || 'ONLINE';
      el('drawer-comm-state').style.color = amr.communicationState === 'DECENTRALIZED_ONLINE' ? 'var(--status-success)' :
        amr.communicationState === 'WIFI_DIRECT' ? 'var(--accent-sky)' :
        amr.communicationState === 'DECENTRALIZED_PREPARE' ? 'var(--status-warning)' :
        amr.communicationState === 'DECENTRALIZED_OFFLINE' ? 'var(--status-danger)' : 'var(--accent-amber)';
    }

    if (el('drawer-nav-state')) {
      el('drawer-nav-state').textContent = amr.navigationState || 'IDLE';
      el('drawer-nav-state').style.color = amr.navigationState === 'MOVING' ? 'var(--status-success)' :
        amr.navigationState === 'WAITING_FOR_RESERVATION' || amr.navigationState === 'SAFE_HOLD' ? 'var(--status-warning)' : 'var(--tx-secondary)';
    }

    if (el('drawer-task-state')) {
      el('drawer-task-state').textContent = amr.taskState || 'NO_TASK';
      el('drawer-task-state').style.color = amr.taskState === 'EXECUTING' ? 'var(--status-success)' :
        amr.taskState === 'ASSIGNED' ? 'var(--accent-sky)' : 'var(--tx-muted)';
    }

    if (el('drawer-safety-state')) {
      el('drawer-safety-state').textContent = amr.safetyState || 'SAFE';
      el('drawer-safety-state').style.color = amr.safetyState === 'SAFE' ? 'var(--status-success)' :
        amr.safetyState === 'CAUTION' ? 'var(--status-warning)' : 'var(--status-danger)';
    }

    if (el('drawer-wifi-status')) {
      el('drawer-wifi-status').textContent = amr.wifiConnected ? 'CONNECTED (Infrastructure Wi-Fi)' : 'OFFLINE (In Dead Zone)';
      el('drawer-wifi-status').style.color = amr.wifiConnected ? 'var(--status-success)' : 'var(--status-danger)';
    }

    if (el('drawer-wifidirect-status')) {
      el('drawer-wifidirect-status').textContent = amr.wifiDirectActive ? `ACTIVE (Relay: ${amr.relayAmrId})` : (amr.communicationState === 'DECENTRALIZED_OFFLINE' ? 'SEARCHING (No Peer in range)' : 'STANDBY');
      el('drawer-wifidirect-status').style.color = amr.wifiDirectActive ? 'var(--accent-sky)' : 'var(--tx-muted)';
    }

    if (el('drawer-peer-relay')) {
      el('drawer-peer-relay').textContent = amr.relayAmrId ? amr.relayAmrId : (amr.communicationState === 'DECENTRALIZED_OFFLINE' ? 'NO PEER (Local Auto)' : 'NONE');
      el('drawer-peer-relay').style.color = amr.relayAmrId ? 'var(--accent-sky)' : 'var(--tx-muted)';
    }

    if (el('drawer-active-route')) {
      el('drawer-active-route').textContent = amr.activeRoute.length > 0 ? amr.activeRoute.join(' → ') : 'None';
    }

    // Edge & Physical Geometry Validation Diagnostics
    if (amr.getEdgeValidationDebugInfo) {
      const dbg = amr.getEdgeValidationDebugInfo();
      if (el('drawer-edge-curr-node')) el('drawer-edge-curr-node').textContent = dbg.currentNode;
      if (el('drawer-edge-next-node')) el('drawer-edge-next-node').textContent = dbg.nextNode;
      if (el('drawer-edge-name')) el('drawer-edge-name').textContent = dbg.currentEdge;
      
      if (el('drawer-edge-valid')) {
        el('drawer-edge-valid').textContent = dbg.edgeValid;
        el('drawer-edge-valid').style.color = dbg.edgeValid === 'YES' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-lane-valid')) {
        el('drawer-lane-valid').textContent = dbg.laneValid;
        el('drawer-lane-valid').style.color = dbg.laneValid === 'YES' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-wall-intersect')) {
        el('drawer-wall-intersect').textContent = dbg.wallIntersection;
        el('drawer-wall-intersect').style.color = dbg.wallIntersection === 'NO' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-rack-intersect')) {
        el('drawer-rack-intersect').textContent = dbg.rackIntersection;
        el('drawer-rack-intersect').style.color = dbg.rackIntersection === 'NO' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-gate-required')) el('drawer-gate-required').textContent = dbg.gateRequired;
      if (el('drawer-gate-valid')) {
        el('drawer-gate-valid').textContent = dbg.gateValid;
        el('drawer-gate-valid').style.color = dbg.gateValid === 'YES' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-clearance-pass')) {
        el('drawer-clearance-pass').textContent = dbg.clearance;
        el('drawer-clearance-pass').style.color = dbg.clearance === 'PASS' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-exec-verdict')) {
        el('drawer-exec-verdict').textContent = dbg.execution;
        el('drawer-exec-verdict').style.color = dbg.execution === 'APPROVED' ? 'var(--status-success)' : 'var(--status-danger)';
      }
      if (el('drawer-exec-status')) {
        el('drawer-exec-status').textContent = dbg.execution;
        el('drawer-exec-status').className = 'status-pill ' + (dbg.execution === 'APPROVED' ? 'success' : 'danger');
      }
    }

    // UWB Neighbors Table
    const uwbTable = el('drawer-uwb-table-body');
    if (uwbTable) {
      if (amr.uwbReadings.length === 0) {
        uwbTable.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--tx-muted)">Scanning UWB RF range...</td></tr>';
      } else {
        uwbTable.innerHTML = amr.uwbReadings.map(r => `
          <tr>
            <td><b style="color:var(--accent-sky)">${r.peerId}</b></td>
            <td><b>${r.distance} m</b></td>
            <td>${r.signalStrengthDbm} dBm</td>
          </tr>
        `).join('');
      }
    }
  }

  /**
   * Periodic UI Refresh Tick
   */
  update() {
    const metrics = this.fleet.metrics.history[this.fleet.metrics.history.length - 1];
    if (!metrics) return;

    // Top Bar KPI Chips
    const el = (id) => document.getElementById(id);
    if (el('kpi-active-tasks')) el('kpi-active-tasks').textContent = metrics.activeTasks;
    if (el('kpi-completed-tasks')) el('kpi-completed-tasks').textContent = metrics.completedTasks;
    if (el('kpi-battery-avg')) el('kpi-battery-avg').textContent = `${metrics.avgBattery}%`;
    if (el('kpi-collisions')) el('kpi-collisions').textContent = metrics.collisionViolations;
    if (el('kpi-deadlocks')) el('kpi-deadlocks').textContent = metrics.deadlockViolations;
    if (el('kpi-active-reservations')) el('kpi-active-reservations').textContent = metrics.activeReservations;

    // 3D Overlay Quick AMR List
    const quickListEl = el('amr-quick-list-body');
    if (quickListEl) {
      quickListEl.innerHTML = this.fleet.amrs.map(amr => {
        const displayStatus = amr.getDisplayStatus ? amr.getDisplayStatus() : amr.state;
        return `
        <div class="amr-quick-item ${this.fleet.selectedAmrId === amr.id ? 'selected' : ''}" onclick="window.edgeFleetApp.dashboard.openAmrDrawer('${amr.id}')">
          <div class="amr-id-badge">
            <span class="amr-color-dot" style="background:${amr.colorInfo.hex}"></span>
            ${amr.id}
          </div>
          <span style="font-family:var(--font-mono);font-size:11px;color:${amr.battery > 20 ? 'var(--status-success)' : 'var(--status-danger)'}">${amr.battery.toFixed(0)}%</span>
          <span class="amr-state-tag" style="background:rgba(255,255,255,0.06)">${displayStatus}</span>
        </div>
      `;
      }).join('');
    }

    // If drawer is open, keep its telemetry live
    const drawer = el('amr-drawer');
    if (drawer && drawer.classList.contains('open')) {
      const selected = this.fleet.getSelectedAmr();
      if (selected) this.updateAmrDrawerContent(selected);
    }
  }
}
