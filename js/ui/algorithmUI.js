/**
 * EdgeFleet - Algorithm Monitor & Mathematical Diagnostics UI
 * Visualizes Space-Time MAPF reservations, D* Lite path repairs, and Safety Supervisor checks.
 */

export class AlgorithmUI {
  constructor(fleetManager) {
    this.fleet = fleetManager;
    this.mapf = fleetManager.mapf;
    this.safety = fleetManager.safety;
  }

  update() {
    const el = (id) => document.getElementById(id);

    // 1. MAPF Space-Time Reservation & Predictive Metrics
    const predMetrics = this.fleet.getPredictiveMetrics ? this.fleet.getPredictiveMetrics() : {};
    const totalPredicted = (predMetrics.predictedConflicts || 0) + this.mapf.stats.predictedConflicts;
    const totalPrevented = (predMetrics.preventedConflicts || 0) + this.mapf.stats.temporalWaitInserted;

    if (el('algo-mapf-trajectories')) el('algo-mapf-trajectories').textContent = this.mapf.stats.plannedTrajectories;
    if (el('algo-mapf-conflicts')) el('algo-mapf-conflicts').textContent = totalPredicted;
    if (el('algo-mapf-waits')) el('algo-mapf-waits').textContent = predMetrics.scheduledWaits || this.mapf.stats.temporalWaitInserted;
    if (el('algo-mapf-rejected')) el('algo-mapf-rejected').textContent = this.mapf.stats.rejectedTrajectories;
    if (el('algo-mapf-reservations-count')) el('algo-mapf-reservations-count').textContent = this.mapf.getActiveReservationCount();

    // 1B. Predicted Conflict Table Rendering
    const conflictTableBody = el('predicted-conflicts-table-body');
    if (conflictTableBody) {
      const conflicts = this.fleet.getPredictedConflicts ? this.fleet.getPredictedConflicts() : [];
      if (conflicts.length === 0) {
        conflictTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--status-success);padding:14px">✓ Zero uncoordinated conflicts predicted. All active trajectories operating with safe space-time buffers.</td></tr>';
      } else {
        conflictTableBody.innerHTML = conflicts.map(c => `
          <tr>
            <td><b style="color:var(--accent-sky)">${c.id}</b></td>
            <td><span class="status-pill ${c.risk === 'CRITICAL' ? 'danger' : c.risk === 'HIGH' ? 'warning' : 'info'}">${c.type}</span></td>
            <td><b>${c.nodeName || c.nodeId || c.edgeKey}</b></td>
            <td><b style="color:var(--tx-bright)">${c.amrA.id}</b> ↔ <b style="color:var(--tx-bright)">${c.amrB.id}</b></td>
            <td>${c.etaA.toFixed(1)}s vs ${c.etaB.toFixed(1)}s</td>
            <td><b style="color:${c.timeSeparation < 1.5 ? 'var(--status-danger)' : 'var(--status-warning)'}">${c.timeSeparation.toFixed(1)}s</b></td>
            <td style="font-size:11px;color:var(--tx-secondary)">${c.resolution || 'Preemptive Upstream Scheduling'}</td>
            <td><span class="status-pill success">${c.status || 'PREVENTED BEFORE ARRIVAL'}</span></td>
          </tr>
        `).join('');
      }
    }

    // 2. D* Lite Incremental Dynamic Path Repair Stats (sum across fleet)
    let totalDstarReplans = 0;
    let totalDstarNodesUpdated = 0;
    let totalDstarNodesAffected = 0;

    this.fleet.amrs.forEach(a => {
      totalDstarReplans += a.dstarPlanner.stats.replanCount;
      totalDstarNodesUpdated += a.dstarPlanner.stats.nodesUpdated;
      totalDstarNodesAffected += a.dstarPlanner.stats.nodesAffected;
    });

    if (el('algo-dstar-replans')) el('algo-dstar-replans').textContent = totalDstarReplans;
    if (el('algo-dstar-updated-nodes')) el('algo-dstar-updated-nodes').textContent = totalDstarNodesUpdated;
    if (el('algo-dstar-affected-nodes')) el('algo-dstar-affected-nodes').textContent = totalDstarNodesAffected;

    // 3. Safety Supervisor Architectural Zero-Collision Counters
    if (el('algo-safety-passed')) el('algo-safety-passed').textContent = this.safety.metrics.totalSafetyChecksPassed;
    if (el('algo-safety-rejected')) el('algo-safety-rejected').textContent = this.safety.metrics.unsafeTrajectoriesRejected;
    if (el('algo-safety-stops')) el('algo-safety-stops').textContent = this.safety.metrics.emergencyStopsTriggered;
    if (el('algo-safety-collisions')) el('algo-safety-collisions').textContent = this.safety.metrics.collisionViolations;
    if (el('algo-safety-deadlocks')) el('algo-safety-deadlocks').textContent = this.safety.metrics.deadlockViolations;
    if (el('algo-safety-boundaries')) el('algo-safety-boundaries').textContent = this.safety.metrics.boundaryViolations;

    // 4. Space-Time Reservation Table Snapshot
    const resTableBody = el('reservations-table-body');
    if (resTableBody) {
      const rows = [];
      for (const [nodeId, list] of this.mapf.nodeReservations) {
        for (const r of list) {
          rows.push(`
            <tr>
              <td><b style="color:var(--accent-sky)">${nodeId}</b></td>
              <td><b style="color:var(--tx-bright)">${r.amrId}</b></td>
              <td>${r.tStart.toFixed(1)}s</td>
              <td>${r.tEnd.toFixed(1)}s</td>
              <td><span class="status-pill info">Priority ${r.priority}</span></td>
            </tr>
          `);
        }
      }

      if (rows.length === 0) {
        resTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--tx-muted);padding:14px">No active space-time node reservations in current horizon.</td></tr>';
      } else {
        resTableBody.innerHTML = rows.slice(0, 10).join('');
      }
    }
  }
}
