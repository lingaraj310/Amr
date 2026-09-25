/**
 * EdgeFleet - Fleet Analytics & KPI Tracking Engine
 * Computes live operational metrics, energy distributions, and safety statistics.
 */

export class FleetMetrics {
  constructor() {
    this.history = [];
    this.maxHistory = 120; // 2 minutes history buffer
  }

  calculateMetrics(fleetManager) {
    const amrs = fleetManager.amrs;
    const taskManager = fleetManager.taskManager;
    const boxManager = fleetManager.boxManager;
    const safety = fleetManager.safety;
    const mapf = fleetManager.mapf;

    let totalBattery = 0;
    let totalEnergyWh = 0;
    let totalDistanceM = 0;
    let totalWaitTimeS = 0;
    let totalIdleTimeS = 0;
    let activeMovingCount = 0;
    let lowBatteryCount = 0;
    let wifiConnectedCount = 0;

    amrs.forEach(a => {
      totalBattery += a.battery;
      totalEnergyWh += a.energyConsumedWh;
      totalDistanceM += a.totalDistanceM;
      totalWaitTimeS += a.waitingTimeS;
      totalIdleTimeS += a.idleTimeS;
      if (a.state === 'MOVING' || a.state === 'SAFE_EVACUATION') activeMovingCount++;
      if (a.battery <= a.lowBatteryThreshold) lowBatteryCount++;
      if (a.wifiConnected) wifiConnectedCount++;
    });

    const avgBattery = amrs.length > 0 ? totalBattery / amrs.length : 0;
    const activeTasks = taskManager.getActiveTasks().length;
    const completedTasks = taskManager.getCompletedTasks().length;
    const pendingTasks = taskManager.getPendingTasks().length;

    // Material Handling Metrics
    const boxMetrics = boxManager ? boxManager.getMetrics() : {
      totalBoxes: 0,
      available: 0,
      inTransit: 0,
      delivered: 0,
      exceptions: 0,
      totalDeliveredPayloadKg: 0,
      totalTransportedPayloadKg: 0
    };

    const snapshot = {
      timestamp: Date.now(),
      avgBattery: Number(avgBattery.toFixed(1)),
      totalEnergyWh: Number(totalEnergyWh.toFixed(1)),
      totalDistanceM: Number(totalDistanceM.toFixed(1)),
      totalWaitTimeS: Number(totalWaitTimeS.toFixed(1)),
      totalIdleTimeS: Number(totalIdleTimeS.toFixed(1)),
      activeMovingCount,
      lowBatteryCount,
      wifiConnectedCount,
      activeTasks,
      completedTasks,
      pendingTasks,
      collisionViolations: safety.metrics.collisionViolations,
      deadlockViolations: safety.metrics.deadlockViolations,
      unsafeTrajectoriesRejected: safety.metrics.unsafeTrajectoriesRejected,
      activeReservations: mapf.getActiveReservationCount(),
      predictedConflicts: mapf.stats.predictedConflicts,
      // Material handling
      boxesInTransit: boxMetrics.inTransit,
      boxesDelivered: boxMetrics.delivered,
      boxExceptions: boxMetrics.exceptions,
      totalDeliveredPayloadKg: boxMetrics.totalDeliveredPayloadKg,
      totalTransportedPayloadKg: boxMetrics.totalTransportedPayloadKg
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return snapshot;
  }
}
