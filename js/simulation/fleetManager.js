/**
 * EdgeFleet - Fleet Manager Orchestrator
 * Coordinates the 5 AMRs, main simulation loop, safety monitoring, telemetry, and emergency handling.
 */

import { AMR } from './amr.js';
import { NavigationGraph } from './navigationGraph.js';
import { TaskManager } from './taskManager.js';
import { BiddingEngine } from './biddingEngine.js';
import { BoxManager } from './boxManager.js';
import { ScenarioManager } from './scenarios.js';
import { MAPFCoordinator } from '../planning/mapf.js';
import { ConflictNegotiator } from '../planning/conflictNegotiator.js';
import { SafetySupervisor } from '../planning/safetySupervisor.js';
import { mqttBroker } from '../communication/mqttBus.js';
import { uwbSystem } from '../communication/uwbMesh.js';
import { wifiDirectManager } from '../communication/wifiDirect.js';
import { logger } from '../communication/eventLogger.js';
import { FleetMetrics } from '../analytics/fleetMetrics.js';
import { EfficiencyBenchmark } from '../analytics/benchmark.js';

export class FleetManager {
  constructor(navGraph) {
    this.graph = navGraph || new NavigationGraph();
    this.amrs = [];
    this.selectedAmrId = 'AMR-01';

    // Subsystems
    this.boxManager = new BoxManager(this.graph);
    this.mapf = new MAPFCoordinator(this.graph);
    this.conflictNegotiator = new ConflictNegotiator(this.graph, this.mapf);
    this.safety = new SafetySupervisor(this.graph);
    this.taskManager = new TaskManager(this.graph);
    this.biddingEngine = new BiddingEngine(this.graph, this.mapf);
    this.scenarios = new ScenarioManager(this.graph, this);
    this.metrics = new FleetMetrics();
    this.benchmark = new EfficiencyBenchmark();
    this.uwb = uwbSystem;
    this.wifiDirect = wifiDirectManager;

    // Cross-link references
    this.taskManager.biddingEngine = this.biddingEngine;
    this.taskManager.fleetManager = this;

    // Simulation runtime state
    this.isRunning = false; // Standby until user clicks Start Simulation
    this.simSpeed = 1.0;
    this.simTime = 0.0;
    this.telemetryTickCounter = 0;
    this.predictiveTickCounter = 0;
    this.needsImmediateFleetCoordination = true;

    // Measured Timing Metrics (for Development Performance HUD)
    this.perfMetrics = {
      simTimeMs: 0,
      predictionTimeMs: 0,
      mapfTimeMs: 0,
      dstarTimeMs: 0,
      safetyTimeMs: 0
    };

    this.initialConfig = [
      { id: 'AMR-01', startNodeId: 'HOME_01', homeNodeId: 'HOME_01', battery: 94.0, priority: 60, payloadCapacity: 350 },
      { id: 'AMR-02', startNodeId: 'HOME_02', homeNodeId: 'HOME_02', battery: 88.0, priority: 75, payloadCapacity: 500 },
      { id: 'AMR-03', startNodeId: 'HOME_03', homeNodeId: 'HOME_03', battery: 91.0, priority: 80, payloadCapacity: 300 },
      { id: 'AMR-04', startNodeId: 'HOME_04', homeNodeId: 'HOME_04', battery: 78.0, priority: 50, payloadCapacity: 450 },
      { id: 'AMR-05', startNodeId: 'HOME_05', homeNodeId: 'HOME_05', battery: 96.0, priority: 65, payloadCapacity: 400 }
    ];

    this.initFleet();
  }

  initFleet() {
    // 5 Distinct AMRs stationed in their designated Home Area parking slots
    this.amrs = this.initialConfig.map(cfg => {
      const startNode = this.graph.getNode(cfg.startNodeId);
      const amr = new AMR(cfg.id, startNode, this.graph, {
        battery: cfg.battery,
        priority: cfg.priority,
        homeNodeId: cfg.homeNodeId,
        payloadCapacity: cfg.payloadCapacity,
        mapf: this.mapf
      });
      mqttBroker.registerClient(amr.id);
      return amr;
    });

    logger.log('SYSTEM', 'FLEET_MANAGER', 'Fleet initialized: 5 AMRs parked in AMR HOME AREA, status: IDLE / AT HOME.', { count: 5 }, 'SYSTEM', 'success');
  }

  getAmr(id) {
    return this.amrs.find(a => a.id === id);
  }

  getSelectedAmr() {
    return this.getAmr(this.selectedAmrId) || this.amrs[0];
  }

  triggerImmediateFleetCoordination() {
    this.needsImmediateFleetCoordination = true;
  }

  /**
   * Main Simulation Step Loop (Fixed Timestep 20-30Hz)
   */
  tick(dt) {
    if (!this.isRunning) return;

    const tSimStart = performance.now();
    const scaledDt = dt * this.simSpeed;
    this.simTime += scaledDt;
    this.telemetryTickCounter += scaledDt;
    this.predictiveTickCounter += scaledDt;

    const hazards = this.scenarios.activeHazards;

    // 1. Update each AMR's kinematics, state machine, and battery
    for (const amr of this.amrs) {
      amr.update(scaledDt, this.simTime, this.amrs, hazards);
    }

    // 1.5 Predictive Fleet Coordination (Event-Driven / Throttled to 10Hz)
    // Only recomputed when an event occurred or periodic 100ms interval reached
    if (this.predictiveTickCounter >= 0.1 || this.needsImmediateFleetCoordination) {
      this.predictiveTickCounter = 0;
      this.needsImmediateFleetCoordination = false;
      if (this.mapf && this.mapf.predictAndNegotiate) {
        const tPredStart = performance.now();
        this.mapf.predictAndNegotiate(this.amrs, scaledDt, this.simTime);
        this.perfMetrics.predictionTimeMs = performance.now() - tPredStart;
      }
    }

    // 2. Continuous UWB Proximity Ranging
    for (const amr of this.amrs) {
      amr.uwbReadings = this.uwb.scanProximity(amr, this.amrs);

      // If AMR lost Wi-Fi, ensure Wi-Fi Direct relay is active
      if (!amr.wifiConnected && !amr.wifiDirectActive) {
        const candidates = this.wifiDirect.evaluateRelayCandidates(amr, amr.uwbReadings, this.amrs);
        if (candidates.length > 0) {
          this.wifiDirect.establishRelayLink(amr, candidates[0].peer, candidates[0].distance);
        }
      } else if (amr.wifiConnected && amr.wifiDirectActive) {
        this.wifiDirect.teardownRelayLink(amr);
      }

      // If using relay, forward state telemetry through peer
      if (amr.wifiDirectActive) {
        this.wifiDirect.forwardTelemetry(amr, this.amrs);
      }
    }

    // 3. Architectural Zero-Collision Safety Supervisor
    const tSafetyStart = performance.now();
    this.safety.continuousRuntimeSafetyCheck(this.amrs, hazards);
    this.perfMetrics.safetyTimeMs = performance.now() - tSafetyStart;

    // 4. Periodic MQTT State Telemetry (Every 1s sim time)
    if (this.telemetryTickCounter >= 1.0) {
      this.telemetryTickCounter = 0;
      for (const amr of this.amrs) {
        if (amr.wifiConnected) {
          mqttBroker.publishAmrState(amr);
        }
      }
    }

    // 5. Compute real-time analytics
    this.metrics.calculateMetrics(this);
    this.perfMetrics.simTimeMs = performance.now() - tSimStart;
  }

  getPredictedConflicts() {
    return this.mapf && this.mapf.predictiveEngine ? this.mapf.predictiveEngine.predictedConflicts : [];
  }

  getPredictiveMetrics() {
    return this.mapf && this.mapf.predictiveEngine ? this.mapf.predictiveEngine.metrics : {};
  }

  /**
   * Get dynamic real-time states of the Two-Port AMR Charging Station
   */
  getChargingPortStates() {
    const ports = [
      { id: 'CS_01', portNumber: 1, name: 'CHARGING PORT 01' },
      { id: 'CS_02', portNumber: 2, name: 'CHARGING PORT 02' }
    ];

    return ports.map(port => {
      // Find if any AMR is currently at this port or en route to it
      const occupant = this.amrs.find(a => 
        a.currentNodeId === port.id || 
        a.targetNodeId === port.id || 
        (a.activeRoute && a.activeRoute.includes(port.id))
      );

      let state = 'AVAILABLE';
      let amrId = null;
      let battery = null;

      if (occupant) {
        amrId = occupant.id;
        battery = occupant.battery;
        if (occupant.state === 'CHARGING' || occupant.isCharging) {
          state = 'CHARGING';
        } else {
          state = 'OCCUPIED';
        }
      }

      return {
        id: port.id,
        portNumber: port.portNumber,
        name: port.name,
        state,
        amrId,
        battery
      };
    });
  }

  /**
   * Handle Low Battery Protocol: Reassign task and navigate to charging dock
   */
  reassignTaskDueToLowBattery(amr) {
    amr.setState('REASSIGNING', 'Low battery critical (< 20%)');

    if (amr.currentTask) {
      const task = amr.currentTask;
      task.status = 'REASSIGNED';
      amr.reassignedTasksCount++;
      logger.log('BATTERY', amr.id,
        `Task #${task.id} reassignment initiated due to low battery (${amr.battery.toFixed(1)}%). Transferring to eligible peer.`,
        { taskId: task.id, amrId: amr.id }, 'MQTT', 'warning'
      );

      // Detach task and re-auction to the rest of the fleet
      amr.currentTask = null;
      amr.payloadKg = 0;
      const eligibleAmrs = this.amrs.filter(a => a.id !== amr.id);
      this.biddingEngine.conductAuction(task, eligibleAmrs);
    }

    // Route low-battery AMR to closest accessible charging station
    this.routeAmrToCharging(amr);
  }

  routeAmrToCharging(amr) {
    const portStates = this.getChargingPortStates();
    const availablePorts = portStates.filter(p => p.state === 'AVAILABLE' || p.amrId === amr.id);

    if (availablePorts.length === 0) {
      // Both Port 01 and Port 02 are occupied! Queue at Charging Approach Hub
      logger.log('BATTERY', amr.id, 
        `All 2 charging ports (PORT 01 & PORT 02) are currently OCCUPIED. Routing ${amr.id} to queue at Charging Approach Hub (N_CHARGE_HUB).`,
        { capacity: 2, occupiedPorts: portStates.map(p => `${p.name}: ${p.amrId} (${p.state})`) },
        'MQTT', 'warning'
      );
      logger.recordTimeline('Charging Queue', `${amr.id} queued at N_CHARGE_HUB (Station full: 2/2)`, 'warning', amr.id);

      const traj = this.mapf.planTrajectory(amr, 'N_CHARGE_HUB', 0);
      if (traj) {
        amr.setTrajectory(traj);
        amr.setState('LOW_BATTERY', 'Queued at Charging Hub (Waiting for free port)');
      } else {
        const path = this.graph.findPath(amr.currentNodeId, 'N_CHARGE_HUB');
        if (path) {
          amr.activeRoute = path;
          amr.trajectoryIndex = 0;
          amr.setState('LOW_BATTERY', 'Queued at Charging Hub');
        }
      }
      return;
    }

    // Pick closest available port
    let bestStation = null;
    let bestDist = Infinity;

    for (const port of availablePorts) {
      const node = this.graph.getNode(port.id);
      if (node) {
        const d = this.graph.getHeuristic(amr.currentNodeId, port.id);
        if (d < bestDist) {
          bestDist = d;
          bestStation = node;
        }
      }
    }

    if (bestStation) {
      logger.log('BATTERY', amr.id, 
        `Assigned ${bestStation.name} (Port ${bestStation.portNumber || 1}). Routing via CHARGING ENTRANCE.`,
        { port: bestStation.id }, 'MQTT', 'info'
      );
      
      const traj = this.mapf.planTrajectory(amr, bestStation.id, 0);
      if (traj) {
        amr.setTrajectory(traj);
        amr.setState('LOW_BATTERY', `Traveling to ${bestStation.name} via Entrance`);
      } else {
        const path = this.graph.findPath(amr.currentNodeId, bestStation.id);
        if (path) {
          amr.activeRoute = path;
          amr.trajectoryIndex = 0;
          amr.setState('LOW_BATTERY', `Traveling to ${bestStation.name} via Entrance`);
        }
      }
    }
  }

  /**
   * Handle Dynamic Emergency (e.g. Fire): D* Lite replanning + Safe-Zone Evacuation
   */
  handleEmergencyEvent(hazard) {
    logger.log('EMERGENCY', 'FLEET_MANAGER', `Emergency Protocol Activated for ${hazard.name}. Evaluating fleet safety.`, {}, 'EMERGENCY', 'danger');

    for (const amr of this.amrs) {
      // If AMR trajectory intersects hazard or is in affected zone
      const distToHazard = Math.hypot(amr.position.x - hazard.x, amr.position.z - hazard.z);
      const isAffected = distToHazard <= (hazard.radius + 10.0) || amr.activeRoute.some(nodeId => {
        const n = this.graph.getNode(nodeId);
        return n && Math.hypot(n.x - hazard.x, n.z - hazard.z) <= hazard.radius;
      });

      if (isAffected) {
        logger.log('DSTAR_LITE', amr.id, `Hazard obstructs active route. Initiating D* Lite local path repair.`, {}, 'DSTAR_LITE', 'warning');
        
        // Dynamic D* Lite repair
        const repairedPath = amr.dstarPlanner.replan(amr.currentNodeId, hazard.changedEdges || []);
        
        if (repairedPath && repairedPath.length > 1) {
          amr.activeRoute = repairedPath;
          amr.replanCount++;
          logger.log('DSTAR_LITE', amr.id, `D* Lite successfully repaired route avoiding hazard: ${repairedPath.join(' → ')}`, {}, 'DSTAR_LITE', 'success');
        } else {
          // If no safe route to destination exists, evacuate to closest distributed safe zone
          this.evacuateAmrToSafeZone(amr, hazard);
        }
      }
    }
  }

  evacuateAmrToSafeZone(amr, hazard) {
    const safeZones = this.graph.getSafeZones();
    let bestZone = null;
    let bestDist = Infinity;

    for (const sz of safeZones) {
      // Ensure safe zone itself is far from hazard
      const distToHazard = Math.hypot(sz.x - hazard.x, sz.z - hazard.z);
      if (distToHazard > hazard.radius + 15.0) {
        const path = this.graph.findPath(amr.currentNodeId, sz.id);
        if (path) {
          const d = this.graph.getHeuristic(amr.currentNodeId, sz.id);
          if (d < bestDist) {
            bestDist = d;
            bestZone = sz;
          }
        }
      }
    }

    if (bestZone) {
      amr.setState('SAFE_EVACUATION', `Evacuating to Safe Zone ${bestZone.name}`);
      const evacPath = this.graph.findPath(amr.currentNodeId, bestZone.id);
      amr.activeRoute = evacPath || [bestZone.id];
      amr.trajectoryIndex = 0;
      logger.log('SAFETY', amr.id, `Evacuation route assigned: ${bestZone.name}`, {}, 'SAFETY', 'warning');
      logger.recordTimeline('Evacuation Order', `${amr.id} evacuating to ${bestZone.name}`, 'warning', amr.id);
    }
  }

  reset() {
    this.scenarios.clearAllHazards();
    this.boxManager.reset();
    this.taskManager.tasks = [];
    this.taskManager.taskCounter = 1;
    this.mapf.nodeReservations.clear();
    this.mapf.edgeReservations.clear();
    this.isRunning = false;

    // Reset each AMR directly to keep 3D mesh instances intact
    this.initialConfig.forEach(cfg => {
      const amr = this.getAmr(cfg.id);
      if (amr) {
        amr.resetAmr(cfg);
      }
    });

    logger.recordTimeline('Simulation Reset', 'All fleet parameters, box inventory, and AMRs restored to AMR HOME AREA (IDLE / AT HOME)', 'info');
    logger.log('SYSTEM', 'FLEET_MANAGER', 'Simulation Reset: 5 AMRs restored to HOME_01..HOME_05. Boxes reset. Tasks cleared.', {}, 'SYSTEM', 'info');
  }
}
