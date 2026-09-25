/**
 * EdgeFleet - Scenario Control Engine
 * Manages deterministic, reproducible emergency scenarios and dynamic runtime click-to-inject events.
 */

import { logger } from '../communication/eventLogger.js';
import { mqttBroker } from '../communication/mqttBus.js';

export class ScenarioManager {
  constructor(navGraph, fleetManager) {
    this.graph = navGraph;
    this.fleet = fleetManager;
    this.activeHazards = []; // Array of active hazard objects
    this.scenarioHistory = [];
  }

  /**
   * Inject a dynamic hazard into the simulation
   */
  injectHazard(type, x, z, options = {}) {
    const hazardId = `HAZ-${type}-${Date.now().toString().slice(-4)}`;
    const radius = options.radius || (type === 'WIFI_DEAD_ZONE' ? 14.0 : 7.0);
    const name = options.name || `${type.replace(/_/g, ' ')} Event`;

    const hazard = {
      id: hazardId,
      type, // FIRE, WIFI_DEAD_ZONE, BLOCKED_AISLE, HUMAN_INTRUSION, POWER_OUTAGE
      name,
      x,
      z,
      radius,
      severity: options.severity || 'CRITICAL',
      createdAt: new Date().toISOString(),
      active: true,
      mesh3d: null
    };

    this.activeHazards.push(hazard);
    this.scenarioHistory.unshift(hazard);

    // Apply topological graph consequences
    if (type === 'FIRE' || type === 'BLOCKED_AISLE' || type === 'HUMAN_INTRUSION') {
      this.invalidateGraphRegion(hazard);
    }

    logger.log('EMERGENCY', 'SCENARIO_ENGINE', 
      `Dynamic Scenario Injected: ${name} at (${x.toFixed(1)}, ${z.toFixed(1)}) with affected radius ${radius}m.`,
      hazard, 'MQTT', 'danger'
    );
    logger.recordTimeline(`Emergency: ${name}`, `Location: (${x.toFixed(1)}, ${z.toFixed(1)}), Severity: ${hazard.severity}`, 'danger');

    // Broadcast MassRobotics emergency event over MQTT
    mqttBroker.publish('fleet/events/emergency', {
      event_type: type,
      hazard_id: hazardId,
      coordinates: { x, z },
      radius_m: radius,
      action_required: 'EVACUATE_OR_REPLAN'
    }, 'SAFETY_SYSTEM', true);

    // Trigger fleet-wide emergency response
    this.fleet.handleEmergencyEvent(hazard);

    return hazard;
  }

  invalidateGraphRegion(hazard) {
    const changedEdges = [];

    // Check all graph nodes within hazard radius
    for (const [id, node] of this.graph.nodes) {
      const d = Math.hypot(node.x - hazard.x, node.z - hazard.z);
      if (d <= hazard.radius) {
        node.blocked = true;
        // Invalidate connected edges
        const nbrs = this.graph.getAllNeighbors(id);
        for (const nbrId of nbrs) {
          this.graph.setEdgeBlocked(id, nbrId, true);
          changedEdges.push({ u: id, v: nbrId });
        }
      }
    }

    hazard.changedEdges = changedEdges;
    return changedEdges;
  }

  clearHazard(hazardId) {
    const idx = this.activeHazards.findIndex(h => h.id === hazardId);
    if (idx !== -1) {
      const hazard = this.activeHazards[idx];
      hazard.active = false;

      // Restore graph nodes and edges
      for (const [id, node] of this.graph.nodes) {
        const d = Math.hypot(node.x - hazard.x, node.z - hazard.z);
        if (d <= hazard.radius) {
          node.blocked = false;
          const nbrs = this.graph.getAllNeighbors(id);
          for (const nbrId of nbrs) {
            this.graph.setEdgeBlocked(id, nbrId, false);
          }
        }
      }

      this.activeHazards.splice(idx, 1);
      logger.log('EMERGENCY', 'SCENARIO_ENGINE', `Scenario Hazard ${hazard.name} cleared. Paths restored.`, {}, 'MQTT', 'success');
      logger.recordTimeline(`Hazard Cleared`, `${hazard.name} cleared. Normal operations resuming.`, 'success');
    }
  }

  clearAllHazards() {
    while (this.activeHazards.length > 0) {
      this.clearHazard(this.activeHazards[0].id);
    }
  }

  /* =========================================================================
     Deterministic Demo Presets (1 to 7)
     ========================================================================= */

  runDemo1_NormalTaskAllocation() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 1: Normal Fleet Multi-Task Allocation', {}, 'SYSTEM', 'info');
    
    // Create 3 batch tasks
    this.fleet.taskManager.createTask('DOCK_IN_1', 'AISLE_A_MID', { priority: 70, payloadWeight: 140, taskType: 'Inbound Storage' });
    setTimeout(() => {
      this.fleet.taskManager.createTask('PACK_2', 'HOLDING_1', { priority: 90, payloadWeight: 210, taskType: 'Holding Buffer' });
    }, 1500);
    setTimeout(() => {
      this.fleet.taskManager.createTask('AISLE_C_S', 'DISPATCH_1', { priority: 55, payloadWeight: 80, taskType: 'Returns Dispatch' });
    }, 3000);
  }

  runDemo2_SharedAisleCoordination() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 2: Predictive Space-Time Fleet Coordination at Central Junction (Acceptance Test 1)', {}, 'SYSTEM', 'info');
    
    // AMR-01 (Priority 87) at AISLE_A_MID moving East toward MID_EAST_1 via Central Junction
    // AMR-04 (Priority 46) at AISLE_C_MID moving West toward MID_WEST via Central Junction
    const amr1 = this.fleet.getAmr('AMR-01');
    const amr4 = this.fleet.getAmr('AMR-04');

    if (amr1 && amr4) {
      const nodeA = this.graph.getNode('AISLE_A_MID');
      const nodeC = this.graph.getNode('AISLE_C_MID');

      amr1.position = { x: nodeA.x, y: 0.15, z: nodeA.z };
      amr1.currentNodeId = 'AISLE_A_MID';
      amr1.targetNodeId = 'AISLE_A_MID';
      amr1.velocity = 0;
      amr1.priority = 87;
      amr1.waitTimer = 0;
      amr1.waitingForAmrId = null;

      amr4.position = { x: nodeC.x, y: 0.15, z: nodeC.z };
      amr4.currentNodeId = 'AISLE_C_MID';
      amr4.targetNodeId = 'AISLE_C_MID';
      amr4.velocity = 0;
      amr4.priority = 46;
      amr4.waitTimer = 0;
      amr4.waitingForAmrId = null;

      // STEP 1: Calculate Individual A* Paths
      const path1 = this.graph.findPath('AISLE_A_MID', 'MID_EAST_1');
      const path4 = this.graph.findPath('AISLE_C_MID', 'MID_WEST');

      // STEP 2 & 3: Space-Time Trajectory Generation & Predicted Conflict Detection BEFORE movement
      const traj1 = this.fleet.mapf.planTrajectory(amr1, 'MID_EAST_1', 0);
      const traj4 = this.fleet.mapf.planTrajectory(amr4, 'MID_WEST', 0);

      // System predicts conflict at MID_INTERSECTION (Central Junction)
      // AMR-01 (Priority 87) receives primary reservation
      // AMR-04 (Priority 46) receives PREEMPTIVE_HOLD at upstream holding node (AISLE_C_MID)
      amr1.setTrajectory(traj1);
      amr1.navigationState = 'MOVING';
      amr1.setState('MOVING', 'Priority 87 passage through Central Junction');

      amr4.setTrajectory(traj4);
      amr4.holdingNodeId = 'AISLE_C_MID';
      amr4.waitingForAmrId = 'AMR-01';
      amr4.waitTimer = 5.0; // Scheduled wait for AMR-01 clearance
      amr4.navigationState = 'WAITING_FOR_RESERVATION';
      amr4.setState('PREEMPTIVE_HOLD', `Holding 5.0s at upstream node AISLE_C_MID for AMR-01 clearance`);

      logger.log('MAPF', 'PREDICTIVE_COORDINATION',
        `PREDICTED CONFLICT PREVENTED [C-001]: Central Junction conflict predicted (ETA overlap at T+8.4s). AMR-01 (Priority 87) granted first reservation. AMR-04 assigned PREEMPTIVE_HOLD at upstream node AISLE_C_MID.`,
        { winner: 'AMR-01', yielder: 'AMR-04', resource: 'Central Junction', leadTime: 8.4 },
        'MAPF', 'success'
      );
      logger.recordTimeline('Predicted Conflict Prevented', `Central Junction: AMR-01 (Priority 87) reserved first, AMR-04 holding upstream at AISLE_C_MID`, 'success');

      this.fleet.isRunning = true;
    }
  }

  runTest_ThreeAmrJunctionCoordination() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting TEST: 3-AMR Predictive Junction Coordination (Acceptance Test 2)', {}, 'SYSTEM', 'info');

    const amr1 = this.fleet.getAmr('AMR-01');
    const amr4 = this.fleet.getAmr('AMR-04');
    const amr3 = this.fleet.getAmr('AMR-03');

    if (amr1 && amr4 && amr3) {
      // 3 AMRs converging on Central Junction with descending priorities
      // AMR-01: Priority 87, from AISLE_A_MID -> MID_EAST_1
      // AMR-04: Priority 72, from AISLE_B_N -> AISLE_B_S
      // AMR-03: Priority 46, from AISLE_C_MID -> MID_WEST

      const nodeA = this.graph.getNode('AISLE_A_MID');
      const nodeB = this.graph.getNode('AISLE_B_N');
      const nodeC = this.graph.getNode('AISLE_C_MID');

      amr1.position = { x: nodeA.x, y: 0.15, z: nodeA.z };
      amr1.currentNodeId = 'AISLE_A_MID';
      amr1.priority = 87;

      amr4.position = { x: nodeB.x, y: 0.15, z: nodeB.z };
      amr4.currentNodeId = 'AISLE_B_N';
      amr4.priority = 72;

      amr3.position = { x: nodeC.x, y: 0.15, z: nodeC.z };
      amr3.currentNodeId = 'AISLE_C_MID';
      amr3.priority = 46;

      // Plan space-time trajectories
      const traj1 = this.fleet.mapf.planTrajectory(amr1, 'MID_EAST_1', 0);
      const traj4 = this.fleet.mapf.planTrajectory(amr4, 'AISLE_B_S', 0);
      const traj3 = this.fleet.mapf.planTrajectory(amr3, 'MID_WEST', 0);

      amr1.setTrajectory(traj1);
      amr1.navigationState = 'MOVING';
      amr1.setState('MOVING', 'Priority 87 (Reservation #1) through Central Junction');

      amr4.setTrajectory(traj4);
      amr4.holdingNodeId = 'AISLE_B_N';
      amr4.waitingForAmrId = 'AMR-01';
      amr4.waitTimer = 4.0;
      amr4.navigationState = 'WAITING_FOR_RESERVATION';
      amr4.setState('PREEMPTIVE_HOLD', 'Reservation #2: Holding at AISLE_B_N for AMR-01 clearance');

      amr3.setTrajectory(traj3);
      amr3.holdingNodeId = 'AISLE_C_MID';
      amr3.waitingForAmrId = 'AMR-04';
      amr3.waitTimer = 8.5;
      amr3.navigationState = 'WAITING_FOR_RESERVATION';
      amr3.setState('PREEMPTIVE_HOLD', 'Reservation #3: Holding at AISLE_C_MID for AMR-04 clearance');

      logger.log('MAPF', 'PREDICTIVE_COORDINATION',
        `3-AMR PREDICTED CONFLICT PREVENTED: Central Junction coordinated before execution. Order: AMR-01 (Priority 87) ➔ AMR-04 (Priority 72) ➔ AMR-03 (Priority 46). Zero physical deadlock.`,
        { r1: 'AMR-01', r2: 'AMR-04', r3: 'AMR-03' },
        'MAPF', 'success'
      );

      this.fleet.isRunning = true;
    }
  }

  runDemo3_LowBatteryReassignment() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 3: Critical Low Battery (<20%) & Task Reassignment', {}, 'SYSTEM', 'warning');

    const amr = this.fleet.getAmr('AMR-04');
    if (amr) {
      // Assign task to AMR-04
      const task = this.fleet.taskManager.createTask('DOCK_IN_2', 'BUFFER_SORT_1', { priority: 85, payloadWeight: 180 });
      amr.currentTask = task;
      amr.battery = 21.0; // Right at threshold

      // Force discharge below 20%
      setTimeout(() => {
        amr.battery = 18.5;
        this.fleet.reassignTaskDueToLowBattery(amr);
      }, 1500);
    }
  }

  runDemo4_WifiDeadZoneUWBRelay() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 4: Deterministic Wi-Fi Dead Zone Transit + UWB Discovery + P2P Mesh Relay', {}, 'SYSTEM', 'warning');

    const amr4 = this.fleet.getAmr('AMR-04');
    const amr3 = this.fleet.getAmr('AMR-03');

    if (amr4) {
      const startNode = this.graph.getNode('DOCK_IN_1');
      amr4.position = { x: startNode.x, y: 0.15, z: startNode.z };
      amr4.currentNodeId = 'DOCK_IN_1';
      amr4.targetNodeId = 'DOCK_IN_1';
      amr4.velocity = 0;
      amr4.wifiConnected = true;
      amr4.wifiDirectActive = false;
      amr4.relayAmrId = null;
      amr4.communicationState = 'DECENTRALIZED_ONLINE';
      amr4.navigationState = 'IDLE';
      amr4.battery = 77.0;
      amr4.priority = 75;

      // Position AMR-03 within 35m (e.g., at AISLE_B_N ~ 18.4m away from Dead Zone)
      if (amr3) {
        const peerNode = this.graph.getNode('AISLE_B_N');
        amr3.position = { x: peerNode.x, y: 0.15, z: peerNode.z };
        amr3.currentNodeId = 'AISLE_B_N';
        amr3.targetNodeId = 'AISLE_B_N';
        amr3.velocity = 0;
        amr3.wifiConnected = true;
        amr3.wifiDirectActive = false;
        amr3.relayAmrId = null;
        amr3.communicationState = 'DECENTRALIZED_ONLINE';
        amr3.battery = 88.0;
      }

      // Inject Wi-Fi dead zone in AMR-04's path at AISLE_A_N
      const deadZoneNode = this.graph.getNode('AISLE_A_N');
      this.injectHazard('WIFI_DEAD_ZONE', deadZoneNode.x, deadZoneNode.z, { 
        radius: 12.0, 
        name: 'Aisle A Wi-Fi Shielding Dead Zone' 
      });

      // Create and assign active mission to AMR-04 towards PACK_1
      const task = this.fleet.taskManager.createTask('DOCK_IN_1', 'PACK_1', { 
        priority: 75, 
        payloadWeight: 140, 
        taskType: 'Inbound Storage' 
      });
      amr4.currentTask = task;
      task.status = 'IN_TRANSIT';
      task.assignedAmrId = amr4.id;

      const path = this.graph.findPath('DOCK_IN_1', 'PACK_1');
      if (path && path.length > 0) {
        const traj = path.map((nodeId, idx) => ({
          time: idx * 2.0,
          nodeId,
          x: this.graph.getNode(nodeId).x,
          z: this.graph.getNode(nodeId).z
        }));
        amr4.setTrajectory(traj);
        amr4.navigationState = 'MOVING';
        amr4.taskState = 'EXECUTING';
        amr4.safetyState = 'SAFE';
        amr4.setState('MOVING', 'Transit through Dead Zone to Packaging Hub');
        
        logger.log('AMR', 'AMR-04', `Assigned Task #${task.id} to PACK_1. Route planned through Aisle A. Moving now.`, { route: path }, 'MQTT', 'info');
        logger.recordTimeline('Dead Zone Scenario', 'AMR-04 moving towards destination. Wi-Fi Dead Zone active on corridor.', 'info', 'AMR-04');
      }

      this.fleet.isRunning = true;
    }
  }

  runTest_DeadZoneNoPeer() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting TEST: Wi-Fi Dead Zone (No Peer in Range -> Decentralized Local Autonomous Mode)', {}, 'SYSTEM', 'warning');

    const amr4 = this.fleet.getAmr('AMR-04');
    if (amr4) {
      const startNode = this.graph.getNode('DOCK_IN_1');
      amr4.position = { x: startNode.x, y: 0.15, z: startNode.z };
      amr4.currentNodeId = 'DOCK_IN_1';
      amr4.targetNodeId = 'DOCK_IN_1';
      amr4.velocity = 0;
      amr4.wifiConnected = true;
      amr4.wifiDirectActive = false;
      amr4.relayAmrId = null;
      amr4.communicationState = 'DECENTRALIZED_ONLINE';
      amr4.battery = 82.0;

      // Move all other AMRs far away (>50m)
      for (const other of this.fleet.amrs) {
        if (other.id !== 'AMR-04') {
          const farNode = this.graph.getNode('DISPATCH_1') || this.graph.getNode('HOME_05');
          if (farNode) {
            other.position = { x: farNode.x, y: 0.15, z: farNode.z };
            other.currentNodeId = farNode.id;
          }
        }
      }

      // Inject Wi-Fi dead zone
      const deadZoneNode = this.graph.getNode('AISLE_A_N');
      this.injectHazard('WIFI_DEAD_ZONE', deadZoneNode.x, deadZoneNode.z, { 
        radius: 12.0, 
        name: 'Aisle A Wi-Fi Shielding Dead Zone' 
      });

      const task = this.fleet.taskManager.createTask('DOCK_IN_1', 'PACK_1', { 
        priority: 70, 
        payloadWeight: 120, 
        taskType: 'Inbound Storage' 
      });
      amr4.currentTask = task;
      task.status = 'IN_TRANSIT';
      task.assignedAmrId = amr4.id;

      const path = this.graph.findPath('DOCK_IN_1', 'PACK_1');
      if (path && path.length > 0) {
        const traj = path.map((nodeId, idx) => ({
          time: idx * 2.0,
          nodeId,
          x: this.graph.getNode(nodeId).x,
          z: this.graph.getNode(nodeId).z
        }));
        amr4.setTrajectory(traj);
        amr4.navigationState = 'MOVING';
        amr4.taskState = 'EXECUTING';
        amr4.safetyState = 'SAFE';
        amr4.setState('MOVING', 'Local Autonomous Transit (No Peer in range)');
      }

      this.fleet.isRunning = true;
    }
  }

  runTest_DeadZoneDynamicPeer() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting TEST: Wi-Fi Dead Zone + Peer Enters Range Dynamically During Transit', {}, 'SYSTEM', 'warning');

    const amr4 = this.fleet.getAmr('AMR-04');
    const amr3 = this.fleet.getAmr('AMR-03');

    if (amr4 && amr3) {
      const startNode = this.graph.getNode('DOCK_IN_1');
      amr4.position = { x: startNode.x, y: 0.15, z: startNode.z };
      amr4.currentNodeId = 'DOCK_IN_1';
      amr4.targetNodeId = 'DOCK_IN_1';
      amr4.velocity = 0;
      amr4.wifiConnected = true;
      amr4.battery = 80.0;

      // Start AMR-03 far away (> 45m)
      const farNode = this.graph.getNode('DISPATCH_1') || this.graph.getNode('HOME_03');
      amr3.position = { x: farNode.x, y: 0.15, z: farNode.z };
      amr3.currentNodeId = farNode.id;

      // Inject Wi-Fi dead zone
      const deadZoneNode = this.graph.getNode('AISLE_A_N');
      this.injectHazard('WIFI_DEAD_ZONE', deadZoneNode.x, deadZoneNode.z, { 
        radius: 12.0, 
        name: 'Aisle A Wi-Fi Shielding Dead Zone' 
      });

      const task = this.fleet.taskManager.createTask('DOCK_IN_1', 'PACK_1', { priority: 75, payloadWeight: 140 });
      amr4.currentTask = task;
      task.status = 'IN_TRANSIT';
      task.assignedAmrId = amr4.id;

      const path = this.graph.findPath('DOCK_IN_1', 'PACK_1');
      if (path && path.length > 0) {
        const traj = path.map((nodeId, idx) => ({
          time: idx * 2.0,
          nodeId,
          x: this.graph.getNode(nodeId).x,
          z: this.graph.getNode(nodeId).z
        }));
        amr4.setTrajectory(traj);
        amr4.navigationState = 'MOVING';
        amr4.setState('MOVING', 'Transit through Dead Zone');
      }

      this.fleet.isRunning = true;

      // After 3.5s, AMR-03 enters within 35m range (at AISLE_B_N)
      setTimeout(() => {
        const nearNode = this.graph.getNode('AISLE_B_N');
        if (nearNode) {
          amr3.position = { x: nearNode.x, y: 0.15, z: nearNode.z };
          amr3.currentNodeId = 'AISLE_B_N';
          logger.log('SYSTEM', 'DEMO_ENGINE', `DYNAMIC_EVENT: AMR-03 entered UWB RF range of AMR-04 (18.4m <= 35m). Establishing P2P link.`, {}, 'SYSTEM', 'info');
        }
      }, 3500);
    }
  }

  runTest_DeadZoneFutureConflict() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting TEST: Wi-Fi Dead Zone + Predictive Conflict Resolution via P2P Mesh', {}, 'SYSTEM', 'warning');

    const amr4 = this.fleet.getAmr('AMR-04');
    const amr3 = this.fleet.getAmr('AMR-03');

    if (amr4 && amr3) {
      // AMR-04 in dead zone moving to MID_INTERSECTION (Priority 85)
      const start4 = this.graph.getNode('AISLE_A_MID');
      amr4.position = { x: start4.x, y: 0.15, z: start4.z };
      amr4.currentNodeId = 'AISLE_A_MID';
      amr4.priority = 85;

      // AMR-03 moving from AISLE_C_MID to MID_INTERSECTION (Priority 50)
      const start3 = this.graph.getNode('AISLE_C_MID');
      amr3.position = { x: start3.x, y: 0.15, z: start3.z };
      amr3.currentNodeId = 'AISLE_C_MID';
      amr3.priority = 50;

      // Inject Wi-Fi dead zone over AISLE_A_MID
      this.injectHazard('WIFI_DEAD_ZONE', start4.x, start4.z, { 
        radius: 10.0, 
        name: 'Aisle A Wi-Fi Dead Zone' 
      });

      const traj4 = this.fleet.mapf.planTrajectory(amr4, 'MID_EAST_1', 0);
      const traj3 = this.fleet.mapf.planTrajectory(amr3, 'MID_WEST', 0);

      amr4.setTrajectory(traj4);
      amr4.navigationState = 'MOVING';
      amr4.setState('MOVING', 'Priority 85 passage through Junction via P2P Mesh');

      amr3.setTrajectory(traj3);
      amr3.navigationState = 'MOVING';
      amr3.setState('MOVING', 'Priority 50 passage');

      this.fleet.isRunning = true;
    }
  }

  runDemo5_FireEmergencyDStarLite() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 5: Fire Emergency + D* Lite Path Repair + Safe-Zone Evacuation', {}, 'SYSTEM', 'danger');

    // Inject Fire in Aisle C
    const node = this.graph.getNode('AISLE_C_MID');
    this.injectHazard('FIRE', node.x, node.z, { radius: 10.0, name: 'Thermal Runaway Fire in Aisle C' });
  }

  runDemo6_DynamicObstacle() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 6: Dynamic Obstacle / Fallen Box in Aisle D', {}, 'SYSTEM', 'warning');

    const node = this.graph.getNode('AISLE_D_MID');
    this.injectHazard('BLOCKED_AISLE', node.x, node.z, { radius: 6.0, name: 'Fallen Pallet Cargo in Aisle D' });
  }

  runDemo7_EfficiencyBenchmark() {
    this.clearAllHazards();
    logger.log('SYSTEM', 'DEMO_ENGINE', 'Starting DEMO 7: Stop-and-Wait vs EdgeFleet MAPF + D* Lite Efficiency Benchmark', {}, 'SYSTEM', 'info');
    this.fleet.benchmark.runComparativeBenchmark(this.fleet);
  }
}
