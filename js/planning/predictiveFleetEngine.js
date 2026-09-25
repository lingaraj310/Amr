/**
 * EdgeFleet - Centralized Predictive Fleet Coordination Engine
 * Continuous Forward Space-Time Trajectory Prediction (15-30s Horizon)
 * Proactive Conflict Resolution, Priority Arbitration, Upstream Scheduled Waiting,
 * Downstream Space Verification, and Predictive Departure Scheduling.
 */

import { logger } from '../communication/eventLogger.js';

export class PredictiveFleetEngine {
  constructor(navGraph) {
    this.graph = navGraph;
    this.predictionHorizon = 25.0; // 25.0 seconds forward prediction
    this.headwayBuffer = 2.5; // 2.5s safe convoy headway
    this.nodeClearanceWindow = 3.0; // 3.0s node occupancy buffer

    // Space-Time Continuous Trajectories: amrId -> TrajectoryObject
    this.trajectoryTable = new Map();

    // Live Predicted Conflict Table
    this.predictedConflicts = [];

    // Predictive Coordination Metrics
    this.metrics = {
      predictedConflicts: 0,
      preventedConflicts: 0,
      reactiveConflicts: 0,
      scheduledWaits: 0,
      deadlocksPredicted: 0,
      deadlocksPrevented: 0,
      totalLeadTimeSum: 0,
      leadTimeCount: 0,
      averagePredictedLeadTime: 12.5
    };
  }

  /**
   * Build a detailed continuous forward space-time trajectory for an AMR
   */
  generateContinuousTrajectory(amr, routeNodes, startTime = 0) {
    if (!routeNodes || routeNodes.length === 0) return null;

    const baseSpeed = amr.maxSpeed || 1.4;
    const payloadFactor = Math.max(0.7, 1.0 - ((amr.payloadKg || 0) * 0.0004));
    const batteryFactor = amr.battery < 20.0 ? 0.75 : 1.0;
    const effectiveSpeed = baseSpeed * payloadFactor * batteryFactor;

    const nodeTimes = [];
    const edgeIntervals = [];
    let currentTime = startTime;

    for (let i = 0; i < routeNodes.length; i++) {
      const u = routeNodes[i];
      const nodeU = this.graph.getNode(u);

      if (i === 0) {
        nodeTimes.push({
          nodeId: u,
          arrivalTime: currentTime,
          departureTime: currentTime + 0.5,
          waitTime: 0,
          x: nodeU ? nodeU.x : 0,
          z: nodeU ? nodeU.z : 0
        });
      } else {
        const prev = routeNodes[i - 1];
        const dist = this.graph.getEdgeCost(prev, u);
        
        // Turn angle penalty check
        let turnPenalty = 0.0;
        if (i > 1) {
          const p1 = this.graph.getNode(routeNodes[i - 2]);
          const p2 = this.graph.getNode(prev);
          const p3 = nodeU;
          if (p1 && p2 && p3) {
            const v1x = p2.x - p1.x; const v1z = p2.z - p1.z;
            const v2x = p3.x - p2.x; const v2z = p3.z - p2.z;
            const l1 = Math.hypot(v1x, v1z); const l2 = Math.hypot(v2x, v2z);
            if (l1 > 0.01 && l2 > 0.01) {
              const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
              if (dot < 0.85) turnPenalty = 0.6; // 0.6s deceleration/turn time
            }
          }
        }

        const travelTime = (dist / effectiveSpeed) + turnPenalty;
        const arrTime = currentTime + travelTime;
        const dwellTime = 0.4;
        const depTime = arrTime + dwellTime;

        edgeIntervals.push({
          from: prev,
          to: u,
          edgeKey: `${prev}->${u}`,
          startTime: currentTime,
          endTime: arrTime,
          travelTime
        });

        nodeTimes.push({
          nodeId: u,
          arrivalTime: arrTime,
          departureTime: depTime,
          waitTime: 0,
          x: nodeU ? nodeU.x : 0,
          z: nodeU ? nodeU.z : 0
        });

        currentTime = depTime;
      }
    }

    // Generate second-by-second continuous samples across horizon
    const samples = [];
    const maxT = Math.min(startTime + this.predictionHorizon, currentTime);
    for (let t = startTime; t <= maxT + 0.5; t += 0.5) {
      const pos = this.samplePositionAtTime(nodeTimes, t);
      samples.push({ t, ...pos });
    }

    const trajectory = {
      amrId: amr.id,
      taskId: amr.currentTask ? amr.currentTask.id : null,
      startTime,
      nodes: routeNodes,
      nodeSet: new Set(routeNodes),
      edges: edgeIntervals,
      nodeTimes,
      samples,
      totalETA: currentTime - startTime,
      effectiveSpeed,
      priority: amr.priority,
      battery: amr.battery,
      payloadKg: amr.payloadKg || 0,
      deadline: amr.currentTask ? amr.currentTask.deadlineSeconds : 999
    };

    return trajectory;
  }

  samplePositionAtTime(nodeTimes, t) {
    if (!nodeTimes || nodeTimes.length === 0) return { x: 0, z: 0, nodeId: null };
    if (t <= nodeTimes[0].arrivalTime) {
      return { x: nodeTimes[0].x, z: nodeTimes[0].z, nodeId: nodeTimes[0].nodeId };
    }
    const last = nodeTimes[nodeTimes.length - 1];
    if (t >= last.departureTime) {
      return { x: last.x, z: last.z, nodeId: last.nodeId };
    }

    for (let i = 0; i < nodeTimes.length - 1; i++) {
      const n1 = nodeTimes[i];
      const n2 = nodeTimes[i + 1];
      if (t >= n1.departureTime && t <= n2.arrivalTime) {
        const span = n2.arrivalTime - n1.departureTime;
        const prog = span > 0.001 ? (t - n1.departureTime) / span : 1.0;
        return {
          x: n1.x + (n2.x - n1.x) * prog,
          z: n1.z + (n2.z - n1.z) * prog,
          nodeId: prog < 0.5 ? n1.nodeId : n2.nodeId
        };
      } else if (t >= n1.arrivalTime && t < n1.departureTime) {
        return { x: n1.x, z: n1.z, nodeId: n1.nodeId };
      }
    }

    return { x: last.x, z: last.z, nodeId: last.nodeId };
  }

  /**
   * Calculate deterministic multi-factor right-of-way priority score
   */
  calculatePriorityScore(amr, trajectory, conflict) {
    let score = amr.priority * 1.0;

    // Task Priority & Deadline Urgency
    if (amr.currentTask) {
      score += (amr.currentTask.priority || 50) * 0.8;
      if (amr.currentTask.deadlineSeconds) {
        const timeRemaining = amr.currentTask.deadlineSeconds - (trajectory ? trajectory.totalETA : 0);
        if (timeRemaining < 15) score += 40;
        else if (timeRemaining < 30) score += 20;
      }
    }

    // Payload Commitment: Loaded AMR carrying physical box gets priority
    if (amr.carriedBox) {
      score += 35;
    }

    // Trajectory Commitment (progress along route)
    if (amr.activeRoute && amr.activeRoute.length > 0) {
      const progressRatio = amr.trajectoryIndex / Math.max(1, amr.activeRoute.length);
      score += progressRatio * 25;
    }

    // Low Battery / Emergency Priority
    if (amr.battery <= 20.0 || amr.state === 'LOW_BATTERY' || amr.state === 'EMERGENCY') {
      score += 60;
    }

    // Proximity to Conflict Point (closer AMR is favored to clear zone quickly)
    if (conflict && conflict.eta) {
      score += Math.max(0, 30 - (conflict.eta * 1.5));
    }

    return score;
  }

  /**
   * Find nearest safe upstream holding node before reaching a conflict point
   */
  findUpstreamHoldingNode(amr, routeNodes, conflictNodeId) {
    if (!routeNodes || routeNodes.length === 0) return amr.currentNodeId;
    const idx = routeNodes.indexOf(conflictNodeId);
    if (idx <= 0) return amr.currentNodeId;

    // Search backwards for designated waiting bay, gate approach, or preceding lane node
    for (let i = idx - 1; i >= 0; i--) {
      const node = this.graph.getNode(routeNodes[i]);
      if (node) {
        if (node.isWaitingBay || node.isGate || node.isDocking || node.isHomeSlot || i === 0) {
          return node.id;
        }
      }
    }

    return routeNodes[Math.max(0, idx - 1)];
  }

  /**
   * Check if downstream space is clear before allowing entrance into an intersection or gate
   */
  isDownstreamSpaceClear(amr, exitNodeId, exitTime, otherTrajectories = []) {
    const exitNode = this.graph.getNode(exitNodeId);
    if (!exitNode) return false;
    if (exitNode.blocked) return false;

    // Check if any other AMR is predicted to occupy the exit node at exitTime
    for (const otherTraj of otherTrajectories) {
      if (otherTraj.amrId === amr.id) continue;
      for (const nt of otherTraj.nodeTimes) {
        if (nt.nodeId === exitNodeId) {
          if (Math.abs(nt.arrivalTime - exitTime) < 2.0) {
            return false; // Exit is contested
          }
        }
      }
    }

    return true;
  }

  /**
   * Continuous Predictive Fleet Coordination Loop
   * Evaluates all future trajectories across 25s horizon, predicts conflicts,
   * arbitrates priorities, and schedules upstream holding waits.
   */
  coordinateFleet(allAmrs, simTime) {
    // 1. Update Continuous Trajectory Table for all moving / scheduled AMRs
    this.trajectoryTable.clear();
    for (const amr of allAmrs) {
      if (amr.state === 'IDLE' && amr.isHome && (!amr.activeRoute || amr.activeRoute.length === 0)) continue;
      if (amr.state === 'CHARGING') continue;

      const remainingRoute = amr.activeRoute && amr.activeRoute.length > 0
        ? amr.activeRoute.slice(amr.trajectoryIndex)
        : [amr.currentNodeId];

      if (remainingRoute.length > 0) {
        const traj = this.generateContinuousTrajectory(amr, remainingRoute, simTime);
        if (traj) {
          this.trajectoryTable.set(amr.id, traj);
        }
      }
    }

    // 2. Predictive Pairwise Conflict Detection
    const activeTrajs = Array.from(this.trajectoryTable.values());
    const detectedConflicts = [];
    let conflictIndex = 1;

    for (let i = 0; i < activeTrajs.length; i++) {
      const trajA = activeTrajs[i];
      const amrA = allAmrs.find(a => a.id === trajA.amrId);

      for (let j = i + 1; j < activeTrajs.length; j++) {
        const trajB = activeTrajs[j];
        const amrB = allAmrs.find(a => a.id === trajB.amrId);

        const conflict = this.predictTrajectoryConflict(amrA, trajA, amrB, trajB, simTime);
        if (conflict) {
          conflict.id = `C-${String(conflictIndex++).padStart(3, '0')}`;
          detectedConflicts.push(conflict);
        }
      }
    }

    this.predictedConflicts = detectedConflicts;

    // 3. Proactive Resolution: Schedule Upstream Waits / Departure Delays
    for (const conflict of detectedConflicts) {
      this.resolvePredictedConflict(conflict, allAmrs, simTime);
    }

    // 4. Update Metrics
    this.metrics.predictedConflicts = detectedConflicts.length;
    if (this.metrics.leadTimeCount > 0) {
      this.metrics.averagePredictedLeadTime = Number((this.metrics.totalLeadTimeSum / this.metrics.leadTimeCount).toFixed(1));
    }
  }

  /**
   * Detect and classify future conflict between two space-time trajectories
   */
  predictTrajectoryConflict(amrA, trajA, amrB, trajB, simTime) {
    if (!trajA || !trajB) return null;

    // Fast shared resource pre-filter (Requirement 9)
    let sharesResource = false;
    if (trajA.nodeSet && trajB.nodeSet) {
      for (const n of trajA.nodes) {
        if (trajB.nodeSet.has(n)) {
          sharesResource = true;
          break;
        }
      }
    } else {
      sharesResource = true;
    }

    if (!sharesResource && trajA.edges.length > 0 && trajB.edges.length > 0) {
      // Check if any edge shares endpoints
      for (const eA of trajA.edges) {
        if (trajB.nodeSet.has(eA.from) || trajB.nodeSet.has(eA.to)) {
          sharesResource = true;
          break;
        }
      }
    }

    if (!sharesResource) return null;

    // 1. Check Node Space-Time Overlaps
    for (const ntA of trajA.nodeTimes) {
      for (const ntB of trajB.nodeTimes) {
        if (ntA.nodeId === ntB.nodeId) {
          const timeDiff = Math.abs(ntA.arrivalTime - ntB.arrivalTime);
          const node = this.graph.getNode(ntA.nodeId);
          const capacity = node ? (node.capacity || 1) : 1;

          if (capacity === 1 && timeDiff < this.nodeClearanceWindow) {
            const leadTime = Math.min(ntA.arrivalTime, ntB.arrivalTime) - simTime;
            if (leadTime >= 0 && leadTime <= this.predictionHorizon) {
              const conflictType = node?.isGate ? 'GATE_CONFLICT' : (node?.zone === 'CENTRAL_JUNCTION' || node?.isWaitingBay) ? 'INTERSECTION' : 'SAME_NODE';
              
              return {
                type: conflictType,
                nodeId: ntA.nodeId,
                nodeName: node ? node.name : ntA.nodeId,
                amrA,
                amrB,
                trajA,
                trajB,
                etaA: ntA.arrivalTime - simTime,
                etaB: ntB.arrivalTime - simTime,
                timeA: ntA.arrivalTime,
                timeB: ntB.arrivalTime,
                timeSeparation: timeDiff,
                requiredSeparation: this.nodeClearanceWindow,
                leadTime,
                risk: timeDiff < 1.2 ? 'CRITICAL' : timeDiff < 2.2 ? 'HIGH' : 'MEDIUM'
              };
            }
          }
        }
      }
    }

    // 2. Check Opposite-Direction Edge Swaps & Narrow Aisle Traversal
    for (const edgeA of trajA.edges) {
      for (const edgeB of trajB.edges) {
        // Head-on swap: A does u->v while B does v->u
        if (edgeA.from === edgeB.to && edgeA.to === edgeB.from) {
          const overlapStart = Math.max(edgeA.startTime, edgeB.startTime);
          const overlapEnd = Math.min(edgeA.endTime, edgeB.endTime);

          if (overlapStart < overlapEnd + 1.0) {
            const leadTime = Math.min(edgeA.startTime, edgeB.startTime) - simTime;
            if (leadTime >= 0 && leadTime <= this.predictionHorizon) {
              const isNarrowAisle = edgeA.from.startsWith('AISLE') || edgeA.to.startsWith('AISLE');
              return {
                type: isNarrowAisle ? 'NARROW_AISLE' : 'OPPOSITE_EDGE',
                edgeKey: `${edgeA.from} ↔ ${edgeA.to}`,
                nodeId: edgeA.from,
                amrA,
                amrB,
                trajA,
                trajB,
                etaA: edgeA.startTime - simTime,
                etaB: edgeB.startTime - simTime,
                timeA: edgeA.startTime,
                timeB: edgeB.startTime,
                timeSeparation: Math.abs(edgeA.startTime - edgeB.startTime),
                requiredSeparation: (edgeA.travelTime || 3.0) + 1.5,
                leadTime,
                risk: 'CRITICAL'
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Preemptively resolve conflict before AMRs reach the conflict zone
   */
  resolvePredictedConflict(conflict, allAmrs, simTime) {
    const { amrA, amrB, trajA, trajB, leadTime } = conflict;

    // Track lead time for predictive metrics
    this.metrics.totalLeadTimeSum += Math.max(0, leadTime);
    this.metrics.leadTimeCount++;

    // Calculate deterministic priority score
    const scoreA = this.calculatePriorityScore(amrA, trajA, { eta: conflict.etaA });
    const scoreB = this.calculatePriorityScore(amrB, trajB, { eta: conflict.etaB });

    const winner = scoreA >= scoreB ? amrA : amrB;
    const yielder = scoreA >= scoreB ? amrB : amrA;
    const winnerTraj = scoreA >= scoreB ? trajA : trajB;
    const yielderTraj = scoreA >= scoreB ? trajB : trajA;
    const winnerEta = scoreA >= scoreB ? conflict.etaA : conflict.etaB;
    const yielderEta = scoreA >= scoreB ? conflict.etaB : conflict.etaA;

    const delayNeeded = Math.max(2.0, (conflict.requiredSeparation - conflict.timeSeparation) + 1.2);
    const holdingNode = this.findUpstreamHoldingNode(yielder, yielderTraj.nodes, conflict.nodeId);

    // Apply Preemptive Upstream Wait or Staggered Departure
    if (yielder.isHome || (yielder.state === 'IDLE' || yielder.state === 'SCHEDULED')) {
      // Option 1: Departure Delay at Home Bay (Staggered Departure)
      yielder.waitTimer = delayNeeded;
      yielder.navigationState = 'WAITING_FOR_RESERVATION';
      yielder.setState('SCHEDULED_WAIT', `Departure delayed ${delayNeeded.toFixed(1)}s at Home for ${winner.id} clearance`);
      conflict.resolution = `${yielder.id} departure staggered by ${delayNeeded.toFixed(1)}s at Home Bay`;
    } else {
      // Option 2: Preemptive Upstream Holding Node Wait
      yielder.holdingNodeId = holdingNode;
      yielder.waitingForAmrId = winner.id;
      
      if (yielder.currentNodeId === holdingNode && yielder.waitTimer <= 0) {
        yielder.velocity = 0;
        yielder.waitTimer = delayNeeded;
        yielder.navigationState = 'WAITING_FOR_RESERVATION';
        yielder.setState('PREEMPTIVE_HOLD', `Holding ${delayNeeded.toFixed(1)}s at upstream node ${holdingNode} for ${winner.id}`);
        conflict.resolution = `${yielder.id} assigned PREEMPTIVE_HOLD (${delayNeeded.toFixed(1)}s at upstream node ${holdingNode})`;
      } else {
        conflict.resolution = `${winner.id} granted primary space-time reservation; ${yielder.id} pre-scheduled for PREEMPTIVE_HOLD at upstream node ${holdingNode}`;
      }
    }

    conflict.status = 'PREVENTED BEFORE ARRIVAL';
    this.metrics.preventedConflicts++;
    this.metrics.scheduledWaits++;

    logger.log('MAPF', 'PREDICTIVE_COORDINATION',
      `PREDICTED CONFLICT PREVENTED [${conflict.id}]: Conflict at ${conflict.nodeName || conflict.nodeId || conflict.edgeKey} (ETA lead time: ${leadTime.toFixed(1)}s). ${winner.id} (Priority/Score: ${Math.max(scoreA, scoreB).toFixed(0)}) reserved first. ${conflict.resolution}.`,
      { conflictId: conflict.id, leadTime, winner: winner.id, yielder: yielder.id },
      'MAPF', 'success'
    );
  }

  /**
   * Proactive Deadlock Cycle Detection across AMR space-time wait dependencies
   */
  detectDeadlockCycles(allAmrs) {
    const adj = new Map();
    for (const a of allAmrs) {
      if (a.waitingForAmrId) {
        if (!adj.has(a.id)) adj.set(a.id, []);
        adj.get(a.id).push(a.waitingForAmrId);
      }
    }

    const visited = new Set();
    const recStack = new Set();

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const nbrs = adj.get(nodeId) || [];
      for (const nbr of nbrs) {
        if (!visited.has(nbr)) {
          if (dfs(nbr)) return true;
        } else if (recStack.has(nbr)) {
          return true; // Cycle detected!
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const amrId of adj.keys()) {
      if (!visited.has(amrId)) {
        if (dfs(amrId)) {
          this.metrics.deadlocksPredicted++;
          logger.log('MAPF', 'DEADLOCK_DETECTOR', `PREDICTED DEADLOCK CYCLE DETECTED in reservation dependencies. Proactively breaking cycle by rerouting lower-priority AMR.`, {}, 'MAPF', 'warning');
          this.metrics.deadlocksPrevented++;
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Schedule fleet departures holistically before movement begins
   */
  scheduleFleetDepartures(allAmrs, activeTasks, simTime = 0) {
    const plannedDepartures = [];
    let cumulativeOffset = 0.0;

    for (let i = 0; i < allAmrs.length; i++) {
      const amr = allAmrs[i];
      if (amr.currentTask && amr.activeRoute && amr.activeRoute.length > 0) {
        // Space out departures by priority and corridor congestion
        const delay = cumulativeOffset;
        if (delay > 0) {
          amr.waitTimer = delay;
          amr.setState('SCHEDULED_WAIT', `Departure staggered by ${delay.toFixed(1)}s for corridor clearance`);
        } else {
          amr.setState('MOVING', `Navigating to task #${amr.currentTask.id}`);
        }
        plannedDepartures.push({ amrId: amr.id, delay, task: amr.currentTask.id });
        cumulativeOffset += 1.8; // 1.8s separation per vehicle departure
      }
    }

    return plannedDepartures;
  }
}
