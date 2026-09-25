/**
 * EdgeFleet - Multi-Agent Path Finding (MAPF) Space-Time Coordinator
 * Generates conflict-free 4D trajectories across the fleet using prioritized space-time reservations.
 * Proactively prevents vertex collisions, edge swap conflicts, and deadlocks.
 */

import { logger } from '../communication/eventLogger.js';
import { PredictiveFleetEngine } from './predictiveFleetEngine.js';

export class MAPFCoordinator {
  constructor(navGraph) {
    this.graph = navGraph;
    this.predictiveEngine = new PredictiveFleetEngine(navGraph);

    // Space-Time Reservation Table:
    // nodeReservations: Map<nodeId, Array<{ amrId, tStart, tEnd, priority }>>
    this.nodeReservations = new Map();
    // edgeReservations: Map<"u->v", Array<{ amrId, tStart, tEnd, priority }>>
    this.edgeReservations = new Map();

    this.stats = {
      plannedTrajectories: 0,
      predictedConflicts: 0,
      resolvedConflicts: 0,
      temporalWaitInserted: 0,
      rejectedTrajectories: 0
    };
  }

  clearReservationsForAmr(amrId) {
    for (const [nodeId, resList] of this.nodeReservations) {
      this.nodeReservations.set(nodeId, resList.filter(r => r.amrId !== amrId));
    }
    for (const [edgeKey, resList] of this.edgeReservations) {
      this.edgeReservations.set(edgeKey, resList.filter(r => r.amrId !== amrId));
    }
  }

  isNodeReserved(nodeId, tStart, tEnd, ignoreAmrId = null) {
    const list = this.nodeReservations.get(nodeId);
    if (!list) return false;
    const node = this.graph.getNode(nodeId);
    const capacity = node ? (node.capacity || 1) : 1;

    let overlaps = 0;
    for (const r of list) {
      if (r.amrId === ignoreAmrId) continue;
      if (!(tEnd <= r.tStart || tStart >= r.tEnd)) {
        overlaps++;
        if (overlaps >= capacity) return true;
      }
    }
    return false;
  }

  isEdgeConflict(u, v, tStart, tEnd, ignoreAmrId = null) {
    // Check opposite traversal (head-on swap conflict)
    const oppositeEdge = `${v}->${u}`;
    const oppList = this.edgeReservations.get(oppositeEdge);
    if (oppList) {
      for (const r of oppList) {
        if (r.amrId === ignoreAmrId) continue;
        if (!(tEnd <= r.tStart || tStart >= r.tEnd)) {
          return true; // Head-on collision risk!
        }
      }
    }

    // Check same edge follower capacity
    const sameEdge = `${u}->${v}`;
    const sameList = this.edgeReservations.get(sameEdge);
    if (sameList) {
      for (const r of sameList) {
        if (r.amrId === ignoreAmrId) continue;
        // Require at least 2.5s safe convoy headway
        const headwayBuffer = 2.5;
        if (Math.abs(tStart - r.tStart) < headwayBuffer) {
          return true;
        }
      }
    }

    return false;
  }

  reserveNode(nodeId, tStart, tEnd, amrId, priority) {
    if (!this.nodeReservations.has(nodeId)) {
      this.nodeReservations.set(nodeId, []);
    }
    this.nodeReservations.get(nodeId).push({ amrId, tStart, tEnd, priority });
  }

  reserveEdge(u, v, tStart, tEnd, amrId, priority) {
    const key = `${u}->${v}`;
    if (!this.edgeReservations.has(key)) {
      this.edgeReservations.set(key, []);
    }
    this.edgeReservations.get(key).push({ amrId, tStart, tEnd, priority });
  }

  /**
   * Plan a conflict-free space-time trajectory for an AMR
   * @param {Object} amr - AMR instance
   * @param {String} goalNodeId - Destination node ID
   * @param {Number} startTime - Simulation epoch time
   * @returns {Array|null} Trajectory array of { nodeId, arrivalTime, departureTime, waitTime }
   */
  planTrajectory(amr, goalNodeId, startTime = 0, startNodeOverride = null) {
    this.stats.plannedTrajectories++;
    const startNodeId = startNodeOverride || amr.currentNodeId;
    if (startNodeId === goalNodeId) {
      return [{ nodeId: startNodeId, arrivalTime: startTime, departureTime: startTime + 1.0, waitTime: 0 }];
    }

    if (!startNodeOverride) {
      this.clearReservationsForAmr(amr.id);
    }

    // Space-Time A* Search
    // State: { nodeId, time, g, f, parent, waitTime }
    const startState = {
      nodeId: startNodeId,
      time: startTime,
      g: 0,
      f: this.graph.getHeuristic(startNodeId, goalNodeId),
      parent: null,
      waitTime: 0
    };

    const openQueue = [startState];
    const visited = new Map(); // key: "nodeId_Math.round(time*2)", val: bestG
    const maxSearchSteps = 1500;
    let searchSteps = 0;

    while (openQueue.length > 0 && searchSteps < maxSearchSteps) {
      searchSteps++;
      // Pop lowest f-score
      openQueue.sort((a, b) => a.f - b.f);
      const current = openQueue.shift();

      if (current.nodeId === goalNodeId) {
        // Reconstruct trajectory
        const trajectory = [];
        let curr = current;
        while (curr) {
          trajectory.unshift({
            nodeId: curr.nodeId,
            arrivalTime: curr.time - curr.waitTime,
            departureTime: curr.time,
            waitTime: curr.waitTime
          });
          curr = curr.parent;
        }

        // Validate physical geometry for the entire trajectory
        if (!this.graph.validatePath(trajectory.map(t => t.nodeId))) {
          logger.log('MAPF', amr.id, `Trajectory contains invalid physical edge! Rejecting.`, {}, 'MAPF', 'danger');
          return null;
        }

        // Apply reservations
        for (let i = 0; i < trajectory.length; i++) {
          const step = trajectory[i];
          const nodeSafetyBuffer = 1.0;
          this.reserveNode(step.nodeId, step.arrivalTime, step.departureTime + nodeSafetyBuffer, amr.id, amr.priority);

          if (i < trajectory.length - 1) {
            const nextStep = trajectory[i + 1];
            this.reserveEdge(step.nodeId, nextStep.nodeId, step.departureTime, nextStep.arrivalTime, amr.id, amr.priority);
          }
        }

        return trajectory;
      }

      const timeKey = `${current.nodeId}_${Math.round(current.time * 2)}`;
      if (visited.has(timeKey) && visited.get(timeKey) <= current.g) {
        continue;
      }
      visited.set(timeKey, current.g);

      // Expansion 1: Move to neighboring nodes
      const neighbors = this.graph.getNeighbors(current.nodeId);
      for (const nbrId of neighbors) {
        if (!this.graph.isValidNavigationEdge(current.nodeId, nbrId)) continue;
        const edge = this.graph.getEdge(current.nodeId, nbrId);
        if (!edge || edge.blocked) continue;

        const travelTime = edge.cost / (amr.maxSpeed || 1.2);
        const arrTime = current.time + travelTime;
        const depTime = arrTime + 0.5; // Dwell/clearance time

        // Conflict check
        const nodeBlocked = this.isNodeReserved(nbrId, current.time, arrTime + 0.8, amr.id);
        const edgeBlocked = this.isEdgeConflict(current.nodeId, nbrId, current.time, arrTime, amr.id);

        if (!nodeBlocked && !edgeBlocked) {
          const gScore = current.g + edge.cost;
          const hScore = this.graph.getHeuristic(nbrId, goalNodeId);
          openQueue.push({
            nodeId: nbrId,
            time: arrTime,
            g: gScore,
            f: gScore + hScore,
            parent: current,
            waitTime: 0
          });
        } else {
          this.stats.predictedConflicts++;
        }
      }

      // Expansion 2: Safe Wait at current node (Wait action in Space-Time graph)
      const currentNode = this.graph.getNode(current.nodeId);
      if (currentNode && (currentNode.isWaitingBay || currentNode.capacity > 1 || current.nodeId === startNodeId)) {
        const waitDuration = 2.0; // 2s wait tick
        const newTime = current.time + waitDuration;
        if (!this.isNodeReserved(current.nodeId, current.time, newTime, amr.id)) {
          this.stats.temporalWaitInserted++;
          const gScore = current.g + (waitDuration * 0.4); // Mild penalty for waiting
          const hScore = this.graph.getHeuristic(current.nodeId, goalNodeId);
          openQueue.push({
            nodeId: current.nodeId,
            time: newTime,
            g: gScore,
            f: gScore + hScore,
            parent: current,
            waitTime: waitDuration
          });
        }
      }
    }

    this.stats.rejectedTrajectories++;
    logger.log('MAPF', amr.id, `MAPF failed to find conflict-free space-time trajectory to ${goalNodeId}. Upstream hold maintained.`, {}, 'MAPF', 'warning');
    return null;
  }

  getActiveReservationCount() {
    let count = 0;
    for (const list of this.nodeReservations.values()) count += list.length;
    for (const list of this.edgeReservations.values()) count += list.length;
    return count;
  }

  // ============================================================================
  // PREDICTIVE FLEET COORDINATION
  // ============================================================================
  
  predictAndNegotiate(allAmrs, dt, simTime = 0) {
    if (this.predictiveEngine) {
      this.predictiveEngine.coordinateFleet(allAmrs, simTime);
    }
  }

  scheduleFleetDepartures(allAmrs, activeTasks, simTime = 0) {
    if (this.predictiveEngine) {
      return this.predictiveEngine.scheduleFleetDepartures(allAmrs, activeTasks, simTime);
    }
    return [];
  }
}

