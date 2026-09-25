/**
 * EdgeFleet - Fleet Analytics & Benchmark Report UI
 * Renders fleet-wide performance tables and Stop-and-Wait vs EdgeFleet comparative benchmarks.
 */

export class AnalyticsUI {
  constructor(fleetManager) {
    this.fleet = fleetManager;
    this.benchmark = fleetManager.benchmark;

    const runBtn = document.getElementById('btn-run-benchmark-calc');
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        this.benchmark.runComparativeBenchmark(this.fleet);
        this.update();
      });
    }
  }

  update() {
    const el = (id) => document.getElementById(id);

    // 1. Fleet Performance Table
    const tableBody = el('analytics-fleet-table-body');
    if (tableBody) {
      tableBody.innerHTML = this.fleet.amrs.map(amr => `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="amr-color-dot" style="background:${amr.colorInfo.hex}"></span>
              <b style="color:var(--tx-bright)">${amr.id}</b>
            </div>
          </td>
          <td><b style="color:${amr.battery > 20 ? 'var(--status-success)' : 'var(--status-danger)'}">${amr.battery.toFixed(1)}%</b></td>
          <td>${amr.batteryHealth}%</td>
          <td><b style="color:var(--status-success)">${amr.completedTasksCount}</b></td>
          <td>${amr.reassignedTasksCount}</td>
          <td>${amr.totalDistanceM.toFixed(1)} m</td>
          <td>${amr.energyConsumedWh.toFixed(1)} Wh</td>
          <td>${amr.waitingTimeS.toFixed(1)} s</td>
          <td>${amr.idleTimeS.toFixed(1)} s</td>
          <td>${amr.replanCount}</td>
          <td><span class="status-pill ${amr.wifiConnected ? 'success' : 'warning'}">${amr.wifiConnected ? 'Wi-Fi MQTT' : 'Wi-Fi Direct P2P'}</span></td>
        </tr>
      `).join('');
    }

    // 2. Efficiency Benchmark Cards & Comparison
    const bench = this.benchmark.latestBenchmark || this.benchmark.runComparativeBenchmark(this.fleet);
    if (!bench) return;

    if (el('bench-stopwait-time')) el('bench-stopwait-time').textContent = `${bench.baseline.completionTimeS} s`;
    if (el('bench-stopwait-wait')) el('bench-stopwait-wait').textContent = `${bench.baseline.waitingTimeS} s`;
    if (el('bench-stopwait-dist')) el('bench-stopwait-dist').textContent = `${bench.baseline.distanceM} m`;
    if (el('bench-stopwait-energy')) el('bench-stopwait-energy').textContent = `${bench.baseline.energyWh} Wh`;
    if (el('bench-stopwait-throughput')) el('bench-stopwait-throughput').textContent = `${bench.baseline.throughputTasksHr} tasks/hr`;

    if (el('bench-edgefleet-time')) el('bench-edgefleet-time').textContent = `${bench.edgeFleet.completionTimeS} s`;
    if (el('bench-edgefleet-wait')) el('bench-edgefleet-wait').textContent = `${bench.edgeFleet.waitingTimeS} s`;
    if (el('bench-edgefleet-dist')) el('bench-edgefleet-dist').textContent = `${bench.edgeFleet.distanceM} m`;
    if (el('bench-edgefleet-energy')) el('bench-edgefleet-energy').textContent = `${bench.edgeFleet.energyWh} Wh`;
    if (el('bench-edgefleet-throughput')) el('bench-edgefleet-throughput').textContent = `${bench.edgeFleet.throughputTasksHr} tasks/hr`;

    // Percentage Improvements
    if (el('bench-imp-wait')) el('bench-imp-wait').textContent = `-${bench.improvement.waitingTimePct}%`;
    if (el('bench-imp-time')) el('bench-imp-time').textContent = `-${bench.improvement.missionTimePct}%`;
    if (el('bench-imp-energy')) el('bench-imp-energy').textContent = `-${bench.improvement.energyPct}%`;
    if (el('bench-imp-throughput')) el('bench-imp-throughput').textContent = `+${bench.improvement.throughputPct}%`;
  }
}
