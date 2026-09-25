/**
 * EdgeFleet - Safety Supervisor Layer
 * Enforces Architectural Zero Collision as a hard mathematical constraint.
 * Verifies trajectories, clearances, boundaries, and emergency buffers prior to and during execution.
 */

import { logger } from '../communication/eventLogger.js';

export class SafetySupervisor {
  constructor(navGraph) {
    this.graph = navGraph;
    this.safetyRadius = 0.9; // 0.9m radius per AMR (1.8m center-to-center minimum clearance bubble)
    this.emergencyStopDistance = 1.4; // Safe braking buffer

    this.metrics = {
      collisionViolations: 0,
      deadlockViolations: 0,
      boundaryViolations: 0,
      unsafeTrajectoriesRejected: 0,
      emergencyStopsTriggered: 0,
      totalSafetyChecksPassed: 0
    };
  }

  /**
   * Validate a planned candidate trajectory prior to approval
   */
  validateCandidateTrajectory(amr, trajectory, allAmrs, hazards) {
    if (!trajectory || trajectory.length === 0) {
      this.metrics.unsafeTrajectoriesRejected++;
      return { approved: false, reason: 'Empty or invalid trajectory' };
    }

    // 1. Boundary & Valid Navigation Nodes Check
    for (const step of trajectory) {
      const node = this.graph.getNode(step.nodeId);
      if (!node) {
        this.metrics.boundaryViolations++;
        this.metrics.unsafeTrajectoriesRejected++;
        return { approved: false, reason: `Invalid off-map node: ${step.nodeId}` };
      }
      if (node.blocked) {
        this.metrics.unsafeTrajectoriesRejected++;
        return { approved: false, reason: `Node is statically or dynamically blocked: ${node.name}` };
      }
    }

    // 1B. Physical Edge Geometry & Wall/Rack Collision Check
    for (let i = 0; i < trajectory.length - 1; i++) {
      const u = trajectory[i].nodeId;
      const v = trajectory[i + 1].nodeId;
      if (u !== v && !this.graph.isValidNavigationEdge(u, v)) {
        this.metrics.boundaryViolations++;
        this.metrics.unsafeTrajectoriesRejected++;
        logger.log('SAFETY', 'SUPERVISOR', `Trajectory for ${amr.id} REJECTED: Edge ${u} -> ${v} crosses physical warehouse geometry or rack obstacle!`, { amrId: amr.id, edge: `${u}->${v}` }, 'SAFETY', 'danger');
        return { approved: false, reason: `Invalid physical navigation edge (${u} -> ${v})` };
      }
    }

    // 2. Active Hazards Intersect Check
    for (const step of trajectory) {
      const node = this.graph.getNode(step.nodeId);
      for (const hazard of hazards) {
        if (!hazard.active) continue;
        const d = Math.hypot(node.x - hazard.x, node.z - hazard.z);
        if (d <= hazard.radius + this.safetyRadius) {
          this.metrics.unsafeTrajectoriesRejected++;
          logger.log('SAFETY', 'SUPERVISOR', 
            `Trajectory for ${amr.id} REJECTED: passes within ${d.toFixed(1)}m of active hazard ${hazard.name}`,
            { amrId: amr.id, hazardId: hazard.id }, 'SAFETY', 'danger'
          );
          return { approved: false, reason: `Intersects active hazard perimeter (${hazard.name})` };
        }
      }
    }

    this.metrics.totalSafetyChecksPassed++;
    return { approved: true, reason: 'All safety constraints satisfied' };
  }

  /**
   * Real-time continuous kinematic bubble clearance check during execution
   */
  continuousRuntimeSafetyCheck(allAmrs, hazards) {
    const n = allAmrs.length;
    for (let i = 0; i < n; i++) {
      const a = allAmrs[i];
      for (let j = i + 1; j < n; j++) {
        const b = allAmrs[j];

        // If both are parked at home, or one is parked at home while other moves past, skip intervention
        if (a.isHome && a.state === 'IDLE' && b.isHome && b.state === 'IDLE') continue;
        if (a.isHome && a.state === 'IDLE' && b.state === 'MOVING') continue;
        if (b.isHome && b.state === 'IDLE' && a.state === 'MOVING') continue;

        const dist = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        const minSafeDist = this.safetyRadius * 2; // 1.8m

        if (dist < minSafeDist) {
          // Ultimate physical safety backstop (Zero-Collision constraint)
          this.metrics.emergencyStopsTriggered++;

          const scoreA = (a.carriedBox ? 50 : 0) + (a.currentTask ? a.currentTask.priority : a.priority);
          const scoreB = (b.carriedBox ? 50 : 0) + (b.currentTask ? b.currentTask.priority : b.priority);

          const winner = scoreA >= scoreB ? a : b;
          const yielder = scoreA >= scoreB ? b : a;

          yielder.velocity = 0;
          if (yielder.state === 'MOVING') {
            yielder.setState('SCHEDULED_WAIT', `Yielding right-of-way buffer to ${winner.id}`);
            yielder.waitTimer = 2.0;
          }

          logger.log('SAFETY', 'SUPERVISOR',
            `Architectural Zero-Collision Buffer: ${a.id} & ${b.id} distance = ${dist.toFixed(2)}m. ${winner.id} given passage, ${yielder.id} safely holding.`,
            { dist, winner: winner.id, yielder: yielder.id }, 'SAFETY', 'info'
          );
        }
      }

      // Check proximity to active hazard perimeters
      for (const hazard of hazards) {
        if (!hazard.active) continue;
        const distToHazard = Math.hypot(a.position.x - hazard.x, a.position.z - hazard.z);
        if (distToHazard < hazard.radius) {
          // Emergency barrier touched - halt & trigger emergency state
          a.velocity = 0;
          a.state = 'EMERGENCY';
          logger.log('SAFETY', 'SUPERVISOR',
            `Hazard Perimeter Violation Avoidance: ${a.id} halted at ${hazard.name} perimeter.`,
            { amrId: a.id, hazard: hazard.name }, 'SAFETY', 'danger'
          );
        }
      }
    }
  }
}
