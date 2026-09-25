/**
 * EdgeFleet - Conflict Negotiator
 * Arbitrates shared space, narrow aisle encounters, and intersections.
 * Implements priority-based, deadline-urgency, and safe pull-over negotiation.
 */

import { logger } from '../communication/eventLogger.js';

export class ConflictNegotiator {
  constructor(navGraph, mapfCoordinator) {
    this.graph = navGraph;
    this.mapf = mapfCoordinator;
    this.negotiationLogs = [];
  }

  /**
   * Evaluate encounter between two AMRs heading toward the same corridor or intersection
   */
  negotiateEncounter(amrA, amrB, locationNodeId) {
    const node = this.graph.getNode(locationNodeId);
    const locName = node ? node.name : locationNodeId;

    // Calculate urgency scores: Priority (0-100) + Deadline Urgency (0-50) + Battery factor
    const scoreA = (amrA.priority * 1.0) + (amrA.deadlineUrgency || 0) + (amrA.battery < 25 ? 40 : 0);
    const scoreB = (amrB.priority * 1.0) + (amrB.deadlineUrgency || 0) + (amrB.battery < 25 ? 40 : 0);

    const winner = scoreA >= scoreB ? amrA : amrB;
    const yielder = scoreA >= scoreB ? amrB : amrA;

    const record = {
      timestamp: new Date().toISOString(),
      location: locName,
      winnerId: winner.id,
      winnerScore: Math.max(scoreA, scoreB),
      yielderId: yielder.id,
      yielderScore: Math.min(scoreA, scoreB),
      strategy: 'SAFE_HOLD_AND_YIELD'
    };
    this.negotiationLogs.unshift(record);

    logger.log('CONFLICT', 'NEGOTIATOR',
      `Conflict predicted at ${locName}. Priority arbitration: ${winner.id} (Score: ${record.winnerScore.toFixed(0)}) > ${yielder.id} (Score: ${record.yielderScore.toFixed(0)}). ${winner.id} proceeds. ${yielder.id} yielding.`,
      record, 'MQTT', 'warning'
    );

    // Command yielder to hold at safe holding node or slow down
    yielder.state = 'NEGOTIATING';
    yielder.waitingForAmrId = winner.id;
    yielder.waitTimer = 3.5; // Yield for 3.5s sim time

    return { winner, yielder };
  }
}
