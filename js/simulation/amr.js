/**
 * EdgeFleet - Autonomous Mobile Robot (AMR) Entity Model
 * Encapsulates full kinematics, state machine, battery dynamics, D* Lite planner, and sensors.
 */

import { DStarLitePlanner } from '../planning/dstarLite.js';
import { logger } from '../communication/eventLogger.js';

export const AMR_COLORS = {
  'AMR-01': { hex: '#38bdf8', colorNum: 0x38bdf8, name: 'Cyan Industrial', darkHex: '#0369a1' },
  'AMR-02': { hex: '#f59e0b', colorNum: 0xf59e0b, name: 'Safety Amber', darkHex: '#b45309' },
  'AMR-03': { hex: '#10b981', colorNum: 0x10b981, name: 'Emerald Fleet', darkHex: '#047857' },
  'AMR-04': { hex: '#a855f7', colorNum: 0xa855f7, name: 'Deep Violet', darkHex: '#7e22ce' },
  'AMR-05': { hex: '#f43f5e', colorNum: 0xf43f5e, name: 'Carmine Crimson', darkHex: '#be123c' }
};

export class AMR {
  constructor(id, startNode, navGraph, options = {}) {
    this.id = id;
    this.graph = navGraph;
    this.mapf = options.mapf || null;
    this.homeNodeId = options.homeNodeId || startNode.id;
    this.homeBayNodeId = this.homeNodeId;
    this.colorInfo = AMR_COLORS[id] || { hex: '#38bdf8', colorNum: 0x38bdf8, name: 'Default', darkHex: '#0369a1' };

    // Kinematics & Spatial Position
    this.currentNodeId = startNode.id;
    this.targetNodeId = startNode.id;
    this.position = { x: startNode.x, y: 0.15, z: startNode.z };
    this.velocity = 0.0;
    this.maxSpeed = options.maxSpeed || 1.4; // m/s
    this.acceleration = 0.8; // m/s^2
    this.heading = Math.PI; // Facing south/outward towards warehouse
    this.targetHeading = Math.PI;
    this.angularSpeed = 2.5; // rad/s

    // Physical vehicle dimensions & collision envelope (0.55m physical chassis radius, 0.25m safety margin)
    this.radius = options.radius || 0.55; // meters
    this.safetyMargin = options.safetyMargin || 0.25; // meters
    this.effectiveRadius = this.radius + this.safetyMargin; // 0.80m

    // Configurable Payload Capacity per AMR
    const defaultCapacities = {
      'AMR-01': 350,
      'AMR-02': 500, // Heavy Lifter
      'AMR-03': 300,
      'AMR-04': 450,
      'AMR-05': 400
    };
    this.payloadCapacity = options.payloadCapacity || defaultCapacities[id] || 350; // kg

    // 4 Independent Architectural State Dimensions (Requirement 23 & 24)
    // 1. Communication: DECENTRALIZED_ONLINE, DECENTRALIZED_PREPARE, WIFI_DIRECT, DECENTRALIZED_OFFLINE, RECONNECTING
    this.communicationState = 'DECENTRALIZED_ONLINE';
    // 2. Navigation: IDLE, MOVING, WAITING_FOR_RESERVATION, REROUTING, SAFE_HOLD
    this.navigationState = 'IDLE';
    // 3. Task: NO_TASK, ASSIGNED, EXECUTING, COMPLETED, REASSIGNING
    this.taskState = 'NO_TASK';
    // 4. Safety: SAFE, CAUTION, STOP_REQUIRED, EMERGENCY
    this.safetyState = 'SAFE';

    // Operational Unified State
    this.state = 'IDLE';
    this.previousState = 'IDLE';
    this.priority = options.priority || 50;

    // Local Mission & Route State Cache (Requirement 3)
    this.localCache = {
      cachedAt: null,
      position: { x: startNode.x, z: startNode.z },
      currentNodeId: startNode.id,
      targetNodeId: startNode.id,
      velocity: 0,
      heading: this.heading,
      task: null,
      route: [],
      trajectory: [],
      trajectoryIndex: 0,
      reservations: [],
      battery: this.battery,
      communicationState: 'DECENTRALIZED_ONLINE'
    };

    // Battery & Energy Model
    this.battery = options.battery !== undefined ? options.battery : 90.0; // %
    this.batteryHealth = 98.5; // %
    this.lowBatteryThreshold = 20.0; // %
    this.isCharging = false;
    this.energyConsumedWh = 0.0;
    this.totalDistanceM = 0.0;
    this.waitingTimeS = 0.0;
    this.idleTimeS = 0.0;
    this.replanCount = 0;
    this.conflictNegotiationCount = 0;

    // Task & Material Handling / Box Objects
    this.currentTask = null;
    this.carriedBox = null; // Physical Box reference
    this.payloadKg = 0;
    this.completedTasksCount = 0;
    this.failedTasksCount = 0;
    this.reassignedTasksCount = 0;
    this.taskHistory = [];

    // Material Handling Action State Machine
    // States: 'NONE', 'ALIGNING_PICKUP', 'LIFTING_BOX', 'TRANSPORTING', 'ALIGNING_DEST', 'LOWERING_BOX'
    this.materialHandlingState = 'NONE';
    this.handlingTimer = 0.0;
    this.liftProgress = 0.0; // 0.0 (lowered) -> 1.0 (lifted)

    // Path & Trajectory
    this.activeTrajectory = []; // Array of space-time steps
    this.trajectoryIndex = 0;
    this.activeRoute = []; // Array of node IDs
    this.dstarPlanner = new DStarLitePlanner(navGraph);

    // Return to Home Opportunity Window Timer (5s after task completion)
    this.returnHomeTimer = 0.0;

    // Communication & Connectivity
    this.wifiConnected = true;
    this.wifiDirectActive = false;
    this.relayAmrId = null;
    this.uwbReadings = [];

    // Negotiation & Wait Timers
    this.waitTimer = 0.0;
    this.waitingForAmrId = null;

    // Three.js 3D Mesh Reference
    this.mesh3d = null;
  }

  isAtHome() {
    return this.currentNodeId === this.homeNodeId && (!this.activeRoute || this.activeRoute.length === 0);
  }

  getDisplayStatus() {
    if (this.safetyState === 'EMERGENCY' || this.state === 'EMERGENCY') return 'EMERGENCY';
    if (this.state === 'LOW_BATTERY') return 'LOW_BATTERY';
    if (this.materialHandlingState === 'ALIGNING_PICKUP') return 'ALIGNING AT PICKUP';
    if (this.materialHandlingState === 'LIFTING_BOX') return `LIFTING (${this.currentTask?.boxId || 'BOX'})`;
    if (this.materialHandlingState === 'ALIGNING_DEST') return 'ALIGNING AT DEST';
    if (this.materialHandlingState === 'LOWERING_BOX') return `PLACING (${this.carriedBox?.id || 'BOX'})`;
    if (this.carriedBox && (this.navigationState === 'MOVING' || this.state === 'MOVING')) {
      if (this.communicationState === 'WIFI_DIRECT') return `TRANSPORTING (P2P Mesh)`;
      if (this.communicationState === 'DECENTRALIZED_OFFLINE') return `TRANSPORTING (Offline Auto)`;
      return `TRANSPORTING (${this.carriedBox.id})`;
    }

    if (this.navigationState === 'MOVING' || this.state === 'MOVING' || this.state === 'RETURNING_HOME' || this.state === 'SAFE_EVACUATION') {
      if (this.communicationState === 'WIFI_DIRECT') return 'MOVING (P2P Mesh)';
      if (this.communicationState === 'DECENTRALIZED_OFFLINE') return 'MOVING (Local Auto)';
      if (this.communicationState === 'DECENTRALIZED_PREPARE') return 'MOVING (Prepare)';
      if (this.communicationState === 'RECONNECTING') return 'MOVING (Reconnecting)';
      if (this.state === 'RETURNING_HOME') return 'RETURNING HOME';
      if (this.state === 'SAFE_EVACUATION') return 'EVACUATION MOVE';
      return 'MOVING';
    }

    if (this.state === 'PREEMPTIVE_HOLD') {
      return `PREEMPTIVE HOLD (${this.waitTimer > 0 ? this.waitTimer.toFixed(1) + 's' : 'Upstream'})`;
    }
    if (this.navigationState === 'WAITING_FOR_RESERVATION' || this.state === 'SCHEDULED_WAIT') {
      return `SCHEDULED WAIT (${this.waitTimer > 0 ? this.waitTimer.toFixed(1) + 's' : 'Holding'})`;
    }
    if (this.state === 'PREEMPTIVE_YIELD') {
      return `PREEMPTIVE YIELD (${this.waitTimer > 0 ? this.waitTimer.toFixed(1) + 's' : 'Upstream'})`;
    }
    if (this.state === 'SCHEDULED') return 'SCHEDULED (Departure Queued)';
    if (this.state === 'RESERVED') return 'RESERVED (Space-Time Pass)';
    if (this.state === 'PLANNING') return 'PLANNING (A* / MAPF)';
    if (this.state === 'CHARGING') return 'CHARGING';
    if (this.state === 'IDLE' && this.isAtHome()) return 'IDLE / AT HOME';
    if (this.state === 'IDLE' && this.returnHomeTimer > 0) return `IDLE (${this.returnHomeTimer.toFixed(0)}s Window)`;
    return this.state;
  }

  returnToHome() {
    if (this.currentNodeId === this.homeNodeId) return;
    if (this.currentTask || this.carriedBox) return;
    if (this.state === 'EMERGENCY' || this.state === 'LOW_BATTERY' || this.state === 'CHARGING') return;

    logger.log('AMR', this.id, `5s opportunity window elapsed. Routing back to designated Home slot (${this.homeNodeId}).`, {}, 'MQTT', 'info');
    logger.recordTimeline('Returning Home', `${this.id} returning to Home slot ${this.homeNodeId}`, 'info', this.id);

    if (this.mapf) {
      const traj = this.mapf.planTrajectory(this, this.homeNodeId, 0);
      if (traj && traj.length > 0) {
        this.setTrajectory(traj);
        this.setState('RETURNING_HOME', `Returning to Home slot ${this.homeNodeId}`);
      } else {
        logger.log('AMR', this.id, `MAPF failed to find safe return path to ${this.homeNodeId}. Will wait.`, {}, 'MQTT', 'warning');
      }
    } else {
      const returnPath = this.graph.findPath(this.currentNodeId, this.homeNodeId);
      if (returnPath && returnPath.length > 1) {
        this.activeRoute = returnPath;
        this.activeTrajectory = returnPath.map((nodeId, idx) => ({
          time: idx * 2.0,
          nodeId,
          x: this.graph.getNode(nodeId).x,
          z: this.graph.getNode(nodeId).z
        }));
        this.trajectoryIndex = 0;
        this.targetNodeId = returnPath[1] || returnPath[0];
        this.setState('RETURNING_HOME', `Returning to Home slot ${this.homeNodeId}`);
      }
    }
  }

  resetAmr(cfg) {
    const startNode = this.graph.getNode(cfg.startNodeId || this.homeNodeId);
    this.currentNodeId = startNode.id;
    this.targetNodeId = startNode.id;
    this.homeNodeId = cfg.homeNodeId || startNode.id;
    this.position = { x: startNode.x, y: 0.15, z: startNode.z };
    this.velocity = 0;
    this.heading = Math.PI;
    this.targetHeading = Math.PI;
    this.state = 'IDLE';
    this.previousState = 'IDLE';
    this.battery = cfg.battery !== undefined ? cfg.battery : 90.0;
    this.priority = cfg.priority !== undefined ? cfg.priority : 50;
    this.currentTask = null;
    this.carriedBox = null;
    this.payloadKg = 0;
    this.materialHandlingState = 'NONE';
    this.handlingTimer = 0.0;
    this.liftProgress = 0.0;
    this.activeTrajectory = [];
    this.activeRoute = [];
    this.trajectoryIndex = 0;
    this.returnHomeTimer = 0.0;
    this.waitTimer = 0.0;
    this.waitingForAmrId = null;
    this.wifiConnected = true;
    this.wifiDirectActive = false;
    this.relayAmrId = null;
    if (this.mesh3d) {
      this.mesh3d.position.set(this.position.x, 0, this.position.z);
      this.mesh3d.rotation.y = this.heading;
      if (this.mesh3d.userData.liftPlatform) {
        this.mesh3d.userData.liftPlatform.position.y = 0.45;
      }
    }
  }

  setState(newState, reason = '') {
    if (this.state === newState) return;
    this.previousState = this.state;
    this.state = newState;
    logger.log('AMR', this.id, `State changed to ${newState}${reason ? ' (' + reason + ')' : ''}`, { from: this.previousState, to: newState }, 'MQTT', newState === 'EMERGENCY' ? 'danger' : newState === 'LOW_BATTERY' ? 'warning' : 'info');
  }

  /**
   * Main Physics & State Tick
   */
  update(dt, simTime, allAmrs, activeHazards) {
    // 1. Connectivity Check & Decentralized State Machine (Requirement 3 & 5)
    this.checkWifiCoverage(activeHazards, allAmrs);

    // 2. Battery Dynamics Simulation
    this.updateBattery(dt);

    // 3. Material Handling Timers & State Machine
    if (this.materialHandlingState !== 'NONE' && this.materialHandlingState !== 'TRANSPORTING') {
      this.updateMaterialHandling(dt);
    }

    // 4. State-specific logic (Navigation continues independently of communication state)
    if (this.state === 'IDLE' && (!this.activeRoute || this.activeRoute.length === 0)) {
      this.idleTimeS += dt;
      this.velocity = 0;
      this.navigationState = 'IDLE';

      // Check 5-second post-task opportunity window
      if (this.returnHomeTimer > 0 && !this.currentTask && !this.carriedBox) {
        this.returnHomeTimer -= dt;
        if (this.returnHomeTimer <= 0) {
          this.returnHomeTimer = 0;
          if (this.currentNodeId !== this.homeNodeId && !this.currentTask) {
            this.returnToHome();
          }
        }
      }
    } else if (this.state === 'PREEMPTIVE_HOLD' || this.state === 'SCHEDULED_WAIT' || this.state === 'PREEMPTIVE_YIELD' || this.state === 'WAITING' || this.navigationState === 'WAITING_FOR_RESERVATION') {
      this.waitingTimeS += dt;
      this.velocity = Math.max(0, this.velocity - (this.acceleration * 2 * dt)); // Smooth decel to holding stop
      if (this.waitTimer > 0) {
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) {
          this.waitTimer = 0;
          this.waitingForAmrId = null;
          if (this.activeRoute && this.activeRoute.length > 0) {
            this.navigationState = 'MOVING';
            this.setState('MOVING', 'Space-time reservation slot opened — proceeding');
          } else {
            this.navigationState = 'IDLE';
            this.setState('IDLE', 'Scheduled wait finished');
          }
        }
      }
    } else if (this.state === 'MOVING' || this.state === 'RETURNING_HOME' || this.state === 'SAFE_EVACUATION' || this.navigationState === 'MOVING') {
      if (this.materialHandlingState === 'NONE' || this.materialHandlingState === 'TRANSPORTING') {
        this.executeMovement(dt, allAmrs);
      }
    } else if (this.state === 'CHARGING') {
      this.velocity = 0;
      this.navigationState = 'IDLE';
      // Charge at 1.5% per second sim time
      this.battery = Math.min(100.0, this.battery + (1.5 * dt));
      if (this.battery >= 98.0) {
        this.setState('IDLE', 'Battery fully charged');
        logger.recordTimeline(`AMR Charged`, `${this.id} finished charging (Battery: ${this.battery.toFixed(1)}%)`, 'success', this.id);
      }
    } else if (this.state === 'EMERGENCY' || this.safetyState === 'EMERGENCY' || this.safetyState === 'STOP_REQUIRED') {
      this.velocity = 0;
    }

    // 5. Update 3D mesh position and smooth rotation
    if (this.mesh3d) {
      this.mesh3d.position.x = this.position.x;
      this.mesh3d.position.z = this.position.z;
      
      // Smoothly interpolate rotation heading
      const diff = this.targetHeading - this.mesh3d.rotation.y;
      const wrappedDiff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.mesh3d.rotation.y += wrappedDiff * Math.min(1, this.angularSpeed * dt);
      this.heading = this.mesh3d.rotation.y;

      // Animate Lift Platform
      if (this.mesh3d.userData.liftPlatform) {
        const targetLiftY = 0.45 + (this.liftProgress * 0.30); // 0.45m -> 0.75m
        this.mesh3d.userData.liftPlatform.position.y = targetLiftY;
      }
    }
  }

  updateMaterialHandling(dt) {
    switch (this.materialHandlingState) {
      case 'ALIGNING_PICKUP':
        this.velocity = 0;
        this.handlingTimer -= dt;
        // Orient AMR towards the rack shelf
        if (this.currentTask?.box?.shelfPosition) {
          const dx = this.currentTask.box.shelfPosition.x - this.position.x;
          const dz = this.currentTask.box.shelfPosition.z - this.position.z;
          this.targetHeading = Math.atan2(dx, dz);
        }
        if (this.handlingTimer <= 0) {
          this.materialHandlingState = 'LIFTING_BOX';
          this.handlingTimer = 1.0;
          const boxName = this.currentTask?.boxId || 'Box';
          logger.log('TASK', this.id, `LIFT_STARTED: Lifting platform engaging for ${boxName}.`, {}, 'MQTT', 'info');
          logger.recordTimeline('Lift Started', `${this.id} lifting ${boxName}`, 'info', this.id);
          if (this.currentTask?.box) {
            this.currentTask.box.startPicking(this.id);
          }
        }
        break;

      case 'LIFTING_BOX':
        this.velocity = 0;
        this.handlingTimer -= dt;
        this.liftProgress = Math.min(1.0, Math.max(0.0, 1.0 - (this.handlingTimer / 1.0)));
        if (this.handlingTimer <= 0) {
          this.liftProgress = 1.0;
          this.materialHandlingState = 'TRANSPORTING';
          const box = this.currentTask?.box;
          if (box) {
            box.attachToAmr(this.id);
            this.carriedBox = box;
            this.payloadKg = box.weight;
          } else {
            this.payloadKg = this.currentTask ? this.currentTask.payloadWeight : 150;
          }

          logger.log('TASK', this.id, `BOX_PICKED: ${box ? box.id : 'Box'} (${this.payloadKg}kg) removed from ${box ? box.rackId : 'rack'} shelf. Slot is now empty.`, { boxId: box ? box.id : 'N/A', payload: this.payloadKg }, 'MQTT', 'success');
          logger.log('TASK', this.id, `BOX_ATTACHED: ${box ? box.id : 'Box'} attached to ${this.id}. Status: IN_TRANSIT.`, {}, 'MQTT', 'info');
          logger.recordTimeline('Box Picked', `${this.id} picked ${box ? box.id : 'Box'} (${this.payloadKg}kg)`, 'success', this.id);
          
          logger.log('TASK', this.id, `TRANSPORT_STARTED: Beginning transport to destination ${this.currentTask.destNodeId}.`, {}, 'MQTT', 'info');
          this.setState('MOVING', `Transporting ${box ? box.id : 'Box'} to ${this.currentTask.destNodeId}`);
        }
        break;

      case 'ALIGNING_DEST':
        this.velocity = 0;
        this.handlingTimer -= dt;
        if (this.handlingTimer <= 0) {
          this.materialHandlingState = 'LOWERING_BOX';
          this.handlingTimer = 1.0;
          const boxName = this.carriedBox ? this.carriedBox.id : 'Box';
          logger.log('TASK', this.id, `DROP_STARTED: Lowering lift mechanism at ${this.currentNodeId}.`, {}, 'MQTT', 'info');
          logger.recordTimeline('Placement Started', `${this.id} lowering ${boxName} at ${this.currentNodeId}`, 'info', this.id);
        }
        break;

      case 'LOWERING_BOX':
        this.velocity = 0;
        this.handlingTimer -= dt;
        this.liftProgress = Math.max(0.0, Math.min(1.0, this.handlingTimer / 1.0));
        if (this.handlingTimer <= 0) {
          this.liftProgress = 0.0;
          this.materialHandlingState = 'NONE';
          
          const deliveredBox = this.carriedBox;
          if (deliveredBox) {
            deliveredBox.deliverAt(this.currentNodeId, this.position.x, this.position.z);
            this.carriedBox = null;
          }
          this.payloadKg = 0;
          this.completedTasksCount++;

          if (this.currentTask) {
            this.currentTask.status = 'COMPLETED';
            this.currentTask.completedAt = new Date().toISOString();
            this.taskHistory.push(this.currentTask);
            
            logger.log('TASK', this.id, `BOX_DELIVERED: ${deliveredBox ? deliveredBox.id : 'Box'} placed at ${this.currentNodeId}.`, { taskId: this.currentTask.id, boxId: deliveredBox ? deliveredBox.id : 'N/A' }, 'MQTT', 'success');
            logger.log('TASK', this.id, `TASK_COMPLETED: Task #${this.currentTask.id} COMPLETED.`, { taskId: this.currentTask.id }, 'MQTT', 'success');
            logger.recordTimeline('Box Delivered', `${this.id} delivered ${deliveredBox ? deliveredBox.id : 'Box'} at ${this.currentNodeId}`, 'success', this.id);
            logger.recordTimeline('Task Completed', `${this.id} completed Task #${this.currentTask.id}`, 'success', this.id);
          }

          this.currentTask = null;
          this.setState('IDLE', 'Task finished — 5s opportunity window');
          this.returnHomeTimer = 5.0; // 5-second window
        }
        break;
    }
  }

  updateBattery(dt) {
    if (this.state === 'CHARGING') return;

    // Real-time discharge calculus
    const baseIdleDrain = 0.003 * dt;
    const motionDrain = (this.velocity * 0.02) * dt;
    const payloadDrain = (this.payloadKg * 0.00015) * dt;
    const totalDrain = baseIdleDrain + motionDrain + payloadDrain;

    this.battery = Math.max(0.0, this.battery - totalDrain);
    this.energyConsumedWh += (totalDrain * 4.8);

    // Check Low Battery Trigger (< 20%)
    if (this.battery <= this.lowBatteryThreshold && this.state !== 'LOW_BATTERY' && this.state !== 'CHARGING' && this.state !== 'REASSIGNING') {
      this.setState('LOW_BATTERY', 'Battery dropped below 20%');
      logger.log('BATTERY', this.id, `CRITICAL: Battery at ${this.battery.toFixed(1)}% (< 20% threshold). Requesting task reassignment & charging dock.`, { battery: this.battery }, 'BATTERY', 'danger');
      logger.recordTimeline('Low Battery Alert', `${this.id} battery at ${this.battery.toFixed(1)}%. Initiating charging protocol.`, 'warning', this.id);
    }
  }

  cacheLocalState() {
    this.localCache = {
      cachedAt: new Date().toISOString(),
      position: { ...this.position },
      currentNodeId: this.currentNodeId,
      targetNodeId: this.targetNodeId,
      velocity: this.velocity,
      heading: this.heading,
      task: this.currentTask ? { ...this.currentTask } : null,
      route: [...this.activeRoute],
      trajectory: [...this.activeTrajectory],
      trajectoryIndex: this.trajectoryIndex,
      reservations: this.mapf ? [...this.mapf.nodeReservations.entries()] : [],
      battery: this.battery,
      communicationState: this.communicationState
    };
  }

  enterDecentralizedPrepare(hazard) {
    if (this.communicationState === 'DECENTRALIZED_PREPARE') return;
    this.communicationState = 'DECENTRALIZED_PREPARE';
    this.cacheLocalState();

    logger.log('UWB', this.id, `DECENTRALIZED_PREPARE: ${this.id} detected Wi-Fi degradation approaching ${hazard.name}. Caching local mission state.`, {}, 'UWB', 'warning');
    logger.recordTimeline('Wi-Fi Degrading', `${this.id} entered DECENTRALIZED_PREPARE. Caching local mission state.`, 'warning', this.id);
  }

  enterDecentralizedOffline(hazard, allAmrs = []) {
    this.wifiConnected = false;
    this.cacheLocalState();

    // Preserve active task & route (Requirement 11 & 12)
    if (this.activeRoute && this.activeRoute.length > 0 && this.trajectoryIndex < this.activeRoute.length) {
      this.navigationState = 'MOVING';
      if (this.state !== 'RETURNING_HOME' && this.state !== 'SAFE_EVACUATION') {
        this.state = 'MOVING';
      }
    }

    // Try finding nearby peer via UWB within 35m (Requirement 8 & 9)
    let relayCandidate = null;
    if (allAmrs && allAmrs.length > 0) {
      const peersInRange = allAmrs.filter(p => p.id !== this.id && p.wifiConnected);
      let bestDist = Infinity;
      for (const p of peersInRange) {
        const d = Math.hypot(this.position.x - p.position.x, this.position.z - p.position.z);
        if (d <= 35.0 && d < bestDist) {
          bestDist = d;
          relayCandidate = { peer: p, distance: d };
        }
      }
    }

    if (relayCandidate) {
      this.communicationState = 'WIFI_DIRECT';
      this.wifiDirectActive = true;
      this.relayAmrId = relayCandidate.peer.id;

      const deadZoneMsg = {
        amrId: this.id,
        event: 'WIFI_DEAD_ZONE_ENTERED',
        position: { x: Number(this.position.x.toFixed(2)), z: Number(this.position.z.toFixed(2)) },
        node: this.currentNodeId,
        taskId: this.currentTask ? this.currentTask.id : 'None',
        destination: this.currentTask ? this.currentTask.destNodeId : (this.activeRoute[this.activeRoute.length - 1] || 'None'),
        currentRoute: this.activeRoute,
        battery: Math.round(this.battery),
        timestamp: new Date().toISOString(),
        communicationMode: 'WIFI_DIRECT'
      };

      logger.log('UWB', this.id, `${this.id} detected infrastructure connectivity loss in Wi-Fi dead zone.`, {}, 'UWB', 'warning');
      logger.log('WIFI_DIRECT', this.id, `PEER_DISCOVERY: ${this.id} discovered peer ${relayCandidate.peer.id} via UWB (${relayCandidate.distance.toFixed(1)}m <= 35m).`, {}, 'WIFI_DIRECT', 'warning');
      logger.log('WIFI_DIRECT', this.id, `RELAY_ESTABLISHED: ${this.id} ↔ ${relayCandidate.peer.id} link established. P2P mesh active.`, {}, 'WIFI_DIRECT', 'success');
      logger.log('MQTT', this.id, `WIFI_DEAD_ZONE_ENTERED broadcast to peer ${relayCandidate.peer.id}: Continuing task #${deadZoneMsg.taskId} to ${deadZoneMsg.destination}.`, deadZoneMsg, 'MQTT', 'info');
      logger.log('AMR', this.id, `CONTINUING_TASK_IN_DECENTRALIZED_MODE: Navigation ACTIVE on cached route.`, {}, 'MQTT', 'success');
      logger.recordTimeline('Wi-Fi Dead Zone', `${this.id} entered dead zone. Continuing task via Wi-Fi Direct peer ${relayCandidate.peer.id}.`, 'warning', this.id);
    } else {
      this.communicationState = 'DECENTRALIZED_OFFLINE';
      this.wifiDirectActive = false;
      this.relayAmrId = null;

      logger.log('UWB', this.id, `${this.id} detected infrastructure connectivity loss in Wi-Fi dead zone.`, {}, 'UWB', 'warning');
      logger.log('WIFI_DIRECT', this.id, `NO_RELAY_AVAILABLE: No peer within 35m threshold. UWB search active.`, {}, 'WIFI_DIRECT', 'warning');
      logger.log('SYSTEM', this.id, `DECENTRALIZED_OFFLINE: ${this.id} executing local autonomous continuation.`, {}, 'SYSTEM', 'info');
      logger.log('AMR', this.id, `CONTINUING_TASK_IN_DECENTRALIZED_MODE: Navigation ACTIVE on cached route.`, {}, 'MQTT', 'success');
      logger.recordTimeline('Decentralized Offline', `${this.id} continuing task in full autonomous mode.`, 'info', this.id);
    }
  }

  exitDecentralizedDeadZone() {
    this.communicationState = 'RECONNECTING';
    this.wifiConnected = true;
    this.wifiDirectActive = false;
    this.relayAmrId = null;

    logger.log('MQTT', this.id, `RECONNECTING: ${this.id} exited Wi-Fi dead zone. Reconnecting to infrastructure.`, {}, 'MQTT', 'success');
    logger.log('MQTT', this.id, `STATE_SYNCHRONIZED: Reconciled task #${this.currentTask?.id || 'None'}, trajectory, and reservations with central broker.`, {}, 'MQTT', 'success');
    
    this.communicationState = 'DECENTRALIZED_ONLINE';
    logger.log('SYSTEM', this.id, `DECENTRALIZED_ONLINE: Infrastructure connectivity fully restored.`, {}, 'SYSTEM', 'success');
    logger.recordTimeline('Wi-Fi Restored', `${this.id} exited dead zone. Infrastructure Wi-Fi active.`, 'success', this.id);
  }

  checkWifiCoverage(activeHazards, allAmrs = []) {
    let inDeadZone = false;
    let deadZoneHazard = null;
    let inPrepareZone = false;
    let prepareHazard = null;

    for (const h of activeHazards) {
      if (h.type === 'WIFI_DEAD_ZONE' && h.active) {
        const d = Math.hypot(this.position.x - h.x, this.position.z - h.z);
        if (d <= h.radius) {
          inDeadZone = true;
          deadZoneHazard = h;
          break;
        } else if (d <= h.radius + 4.0) {
          inPrepareZone = true;
          prepareHazard = h;
        }
      }
    }

    if (inDeadZone) {
      if (this.wifiConnected) {
        this.enterDecentralizedOffline(deadZoneHazard, allAmrs);
      }
    } else {
      if (!this.wifiConnected) {
        this.exitDecentralizedDeadZone();
      } else if (inPrepareZone && this.communicationState === 'DECENTRALIZED_ONLINE') {
        this.enterDecentralizedPrepare(prepareHazard);
      } else if (!inPrepareZone && this.communicationState === 'DECENTRALIZED_PREPARE') {
        this.communicationState = 'DECENTRALIZED_ONLINE';
      }
    }
  }

  setTrajectory(trajectory) {
    if (!trajectory || trajectory.length === 0) return;
    const route = trajectory.map(t => t.nodeId);
    if (!this.graph.validatePath(route)) {
      logger.log('SAFETY', this.id, `Attempted to set physically invalid trajectory! Rejected.`, { route }, 'SAFETY', 'danger');
      return;
    }
    this.activeTrajectory = trajectory;
    this.activeRoute = route;
    this.trajectoryIndex = 0;
    this.targetNodeId = trajectory[0].nodeId;
  }

  replanCurrentGoal() {
    this.velocity = 0;
    this.replanCount++;
    const goalNodeId = this.currentTask ? (this.carriedBox ? this.currentTask.destNodeId : this.currentTask.sourceNodeId) : (this.state === 'RETURNING_HOME' ? this.homeNodeId : (this.activeRoute[this.activeRoute.length - 1] || this.homeNodeId));

    if (!goalNodeId || goalNodeId === this.currentNodeId) {
      this.activeRoute = [];
      this.activeTrajectory = [];
      this.setState('IDLE', 'Replan complete (already at goal)');
      return;
    }

    logger.log('MAPF', this.id, `Dynamic replan triggered for goal ${goalNodeId} from ${this.currentNodeId}.`, {}, 'MAPF', 'warning');

    if (this.mapf) {
      const traj = this.mapf.planTrajectory(this, goalNodeId, 0);
      if (traj && traj.length > 0) {
        this.setTrajectory(traj);
        this.setState(this.state === 'RETURNING_HOME' ? 'RETURNING_HOME' : 'MOVING', 'Replanned valid physical route');
        return;
      }
    }

    // Fallback: A* / Dijkstra on validated physical graph
    const validPath = this.graph.findPath(this.currentNodeId, goalNodeId);
    if (validPath && validPath.length > 1) {
      this.activeRoute = validPath;
      this.activeTrajectory = validPath.map((nodeId, idx) => ({
        time: idx * 2.0,
        nodeId,
        x: this.graph.getNode(nodeId).x,
        z: this.graph.getNode(nodeId).z
      }));
      this.trajectoryIndex = 0;
      this.targetNodeId = validPath[1] || validPath[0];
      this.setState(this.state === 'RETURNING_HOME' ? 'RETURNING_HOME' : 'MOVING', 'Replanned valid physical route');
    } else {
      this.activeRoute = [];
      this.activeTrajectory = [];
      this.setState('WAITING', 'Replan failed to find valid physical path — waiting safely');
      logger.log('SAFETY', this.id, `Safe halt: No valid physical corridor to ${goalNodeId}. Waiting for clearance.`, {}, 'SAFETY', 'warning');
    }
  }

  getEdgeValidationDebugInfo() {
    const currentNode = this.graph.getNode(this.currentNodeId);
    const nextNode = this.graph.getNode(this.targetNodeId);
    const edgeKey = currentNode && nextNode ? `${currentNode.id} -> ${nextNode.id}` : 'None';
    const isSameNode = this.currentNodeId === this.targetNodeId;

    if (isSameNode || !nextNode) {
      return {
        amrId: this.id,
        currentNode: this.currentNodeId,
        nextNode: this.targetNodeId || 'None',
        currentEdge: 'Stationary',
        edgeValid: 'YES',
        laneValid: 'YES',
        wallIntersection: 'NO',
        rackIntersection: 'NO',
        gateRequired: 'NO',
        gateValid: 'YES',
        clearance: 'PASS',
        execution: 'APPROVED'
      };
    }

    const isValid = this.graph.isValidNavigationEdge(this.currentNodeId, this.targetNodeId);
    return {
      amrId: this.id,
      currentNode: this.currentNodeId,
      nextNode: this.targetNodeId,
      currentEdge: edgeKey,
      edgeValid: isValid ? 'YES' : 'NO',
      laneValid: isValid ? 'YES' : 'NO',
      wallIntersection: isValid ? 'NO' : 'YES',
      rackIntersection: isValid ? 'NO' : 'YES',
      gateRequired: (currentNode.zone !== nextNode.zone) ? 'YES' : 'NO',
      gateValid: (currentNode.isGate || nextNode.isGate || currentNode.zone === nextNode.zone) ? 'YES' : 'NO',
      clearance: isValid ? 'PASS' : 'FAIL',
      execution: isValid ? 'APPROVED' : 'REJECTED'
    };
  }

  executeMovement(dt, allAmrs = []) {
    if (!this.activeRoute || this.activeRoute.length === 0) {
      if (this.state === 'MOVING') {
        this.setState('IDLE', 'Route complete');
      }
      return;
    }

    const nextNodeId = this.activeRoute[this.trajectoryIndex];
    const targetNode = this.graph.getNode(nextNodeId);
    if (!targetNode) {
      this.replanCurrentGoal();
      return;
    }

    // CRITICAL REQUIREMENT 11 & 13: STRICT EDGE VALIDATION BEFORE EVERY MOVEMENT
    if (this.currentNodeId !== nextNodeId && !this.graph.isValidNavigationEdge(this.currentNodeId, nextNodeId)) {
      this.velocity = 0;
      logger.log('SAFETY', this.id, `PATH_EXECUTION_REJECTED: Edge ${this.currentNodeId} -> ${nextNodeId} is invalid. Reason: INVALID_PHYSICAL_EDGE. Stopping safely and triggering replan.`, { from: this.currentNodeId, to: nextNodeId }, 'SAFETY', 'danger');
      logger.recordTimeline('Edge Rejected', `${this.id} halted: Invalid physical edge ${this.currentNodeId} -> ${nextNodeId}. Replanning.`, 'danger', this.id);
      this.replanCurrentGoal();
      return;
    }

    const dx = targetNode.x - this.position.x;
    const dz = targetNode.z - this.position.z;
    const distToTarget = Math.hypot(dx, dz);

    // Compute heading strictly towards next waypoint node (never direct target steering)
    if (distToTarget > 0.05) {
      this.targetHeading = Math.atan2(dx, dz);
    }

    // Waypoint reached condition
    if (distToTarget <= 0.18) {
      this.position.x = targetNode.x;
      this.position.z = targetNode.z;
      this.currentNodeId = targetNode.id;

      // CHECK MAPF SCHEDULED WAIT
      const currentTrajNode = this.activeTrajectory[this.trajectoryIndex];
      if (currentTrajNode && currentTrajNode.waitTime > 0) {
        this.waitTimer = currentTrajNode.waitTime;
        currentTrajNode.waitTime = 0; // Clear to prevent infinite wait loop
        this.setState('WAITING', `MAPF scheduled wait for ${this.waitTimer.toFixed(1)}s`);
        return;
      }

      // Check intermediate pickup at task source node
      if (this.currentTask && this.currentNodeId === this.currentTask.sourceNodeId && !this.carriedBox && this.materialHandlingState === 'NONE') {
        const box = this.currentTask.box;
        
        // Requirement 20/21: Check for Box Pickup Exception (box not present / exception / unavailable)
        const isBoxMissingOrUnavailable = !box || box.status === 'EXCEPTION' || box.nodeId !== this.currentNodeId;
        
        if (isBoxMissingOrUnavailable) {
          const reason = !box ? 'Box object missing' : box.status === 'EXCEPTION' ? 'Box in exception state' : `Selected box not present at pickup location (${box.nodeId} != ${this.currentNodeId})`;
          logger.log('EMERGENCY', this.id, `BOX_PICKUP_EXCEPTION: Selected box ${box ? box.id : 'N/A'} unavailable at pickup ${this.currentNodeId}! Reason: ${reason}`, { taskId: this.currentTask.id, boxId: box ? box.id : 'N/A', reason }, 'MQTT', 'danger');
          logger.recordTimeline('Pickup Exception', `Box ${box ? box.id : 'N/A'} unavailable for Task #${this.currentTask.id}: ${reason}`, 'danger', this.id);
          
          if (box) {
            box.status = 'EXCEPTION';
            box.exceptionReason = reason;
          }
          
          const failedTask = this.currentTask;
          failedTask.status = 'EXCEPTION';
          this.currentTask = null;
          this.activeRoute = [];
          this.activeTrajectory = [];
          this.setState('IDLE', 'Box pickup exception occurred');
          this.returnHomeTimer = 5.0;
          return;
        }

        // Start real Material-Handling Alignment & Lift Sequence
        this.velocity = 0;
        this.materialHandlingState = 'ALIGNING_PICKUP';
        this.handlingTimer = 0.8;
        logger.log('TASK', this.id, `ARRIVED_PICKUP: Arrived at ${this.currentNodeId}. Slowing down and aligning with ${box ? box.id : 'Box'}.`, {}, 'MQTT', 'info');
        logger.log('TASK', this.id, `BOX_ALIGNMENT: Aligning AMR platform with ${box ? box.id : 'Box'}.`, {}, 'MQTT', 'info');
        logger.recordTimeline('Arrived Pickup', `${this.id} arrived at pickup ${this.currentNodeId}`, 'info', this.id);
        return;
      }

      this.trajectoryIndex++;
      if (this.trajectoryIndex >= this.activeRoute.length) {
        // Destination reached!
        this.velocity = 0;
        this.activeRoute = [];
        this.activeTrajectory = [];
        this.onDestinationReached();
      } else {
        this.targetNodeId = this.activeRoute[this.trajectoryIndex];
      }
      return;
    }

    // Accelerate / Move
    this.velocity = Math.min(this.maxSpeed, this.velocity + this.acceleration * dt);
    const moveStep = this.velocity * dt;
    const stepRatio = Math.min(1.0, moveStep / distToTarget);

    const stepX = dx * stepRatio;
    const stepZ = dz * stepRatio;

    const nextX = this.position.x + stepX;
    const nextZ = this.position.z + stepZ;

    // Dynamic vehicle-to-vehicle collision avoidance
    if (allAmrs && Array.isArray(allAmrs)) {
      for (const other of allAmrs) {
        if (other.id === this.id) continue;
        if (other.isHome && other.state === 'IDLE' && this.isHome) continue;
        const d = Math.hypot(nextX - other.position.x, nextZ - other.position.z);
        const minDist = this.radius + (other.radius || 0.55);
        if (d < minDist) {
          // Obstacle detected ahead on lane - stop and yield
          this.velocity = 0;
          return;
        }
      }
    }

    this.position.x = nextX;
    this.position.z = nextZ;
    this.totalDistanceM += Math.hypot(stepX, stepZ);
  }

  onDestinationReached() {
    if (this.state === 'SAFE_EVACUATION') {
      this.setState('IDLE', 'Reached safe zone');
      logger.log('SAFETY', this.id, `Safely positioned in Evacuation Safe Zone ${this.currentNodeId}`, {}, 'SAFETY', 'success');
      logger.recordTimeline('Safe Evacuation Complete', `${this.id} reached safe zone ${this.currentNodeId}`, 'success', this.id);
      return;
    }

    if (this.state === 'LOW_BATTERY' || this.isCharging) {
      const node = this.graph.getNode(this.currentNodeId);
      if (node && node.isChargingStation) {
        this.setState('CHARGING', 'Connected to charging dock');
        logger.log('BATTERY', this.id, `Docked at charging point ${this.currentNodeId}. Fast charging active.`, {}, 'BATTERY', 'success');
      }
      return;
    }

    if (this.currentTask && this.carriedBox && this.currentNodeId === this.currentTask.destNodeId) {
      // Arrived at delivery destination! Start placement sequence
      this.velocity = 0;
      this.materialHandlingState = 'ALIGNING_DEST';
      this.handlingTimer = 0.8;
      logger.log('TASK', this.id, `ARRIVED_DESTINATION: Arrived at delivery drop zone ${this.currentNodeId}. Aligning to place ${this.carriedBox.id}.`, {}, 'MQTT', 'info');
      logger.recordTimeline('Arrived Destination', `${this.id} arrived at destination ${this.currentNodeId}`, 'info', this.id);
      return;
    }

    if (!this.currentTask) {
      if (this.currentNodeId === this.homeNodeId) {
        this.setState('IDLE', 'Docked at Home slot');
        this.targetHeading = Math.PI; // Face south
        logger.log('AMR', this.id, `${this.id} safely parked in Home slot (${this.homeNodeId}). Status: IDLE / AT HOME.`, {}, 'MQTT', 'info');
        logger.recordTimeline('At Home Slot', `${this.id} docked in Home slot ${this.homeNodeId}`, 'success', this.id);
      } else {
        this.setState('IDLE', 'Mission complete');
      }
    }
  }

  get isHome() {
    return this.currentNodeId === this.homeNodeId;
  }
}
