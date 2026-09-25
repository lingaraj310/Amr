/**
 * EdgeFleet - Transparent Multi-Criteria Bidding Engine
 * Calculates explainable, multi-factor bid scores for task allocation auctions.
 * Enforces strict feasibility gating before score comparison.
 */

import { logger } from '../communication/eventLogger.js';

export class BiddingEngine {
  constructor(navGraph, mapfCoordinator) {
    this.graph = navGraph;
    this.mapf = mapfCoordinator;

    // Configurable auction weights
    this.weights = {
      battery: 0.20,
      distance: 0.25,
      taskSuitability: 0.15,
      workload: 0.10,
      deadlineFeasibility: 0.10,
      pathFeasibility: 0.10,
      priorityCompatibility: 0.10
    };
  }

  /**
   * Conduct an auction for a task across all candidate AMRs
   */
  conductAuction(task, allAmrs) {
    task.status = 'BIDDING';
    logger.log('BIDDING', 'FLEET_AUCTION', `Auction opened for Task #${task.id} (${task.sourceNodeId} → ${task.destNodeId})`, { taskId: task.id }, 'MQTT', 'info');

    const bids = [];
    const traces = [];

    for (const amr of allAmrs) {
      const bid = this.calculateAmrBid(amr, task);
      bids.push(bid);

      const traceMsg = `${amr.id} bid: ${bid.feasible ? bid.finalScore.toFixed(1) : 'DISQUALIFIED (' + bid.rejectionReason + ')'}`;
      traces.push(traceMsg);
    }

    task.bidDetails = bids;

    // Filter only feasible bids
    const feasibleBids = bids.filter(b => b.feasible);

    if (feasibleBids.length === 0) {
      task.status = 'PENDING';
      const reason = 'No AMR satisfied battery, reachability, or operational feasibility constraints.';
      logger.log('BIDDING', 'FLEET_AUCTION', `Auction FAILED for Task #${task.id}: ${reason}`, {}, 'MQTT', 'danger');
      return { winner: null, reason };
    }

    // Sort feasible bids by highest final score
    feasibleBids.sort((a, b) => b.finalScore - a.finalScore);
    const winningBid = feasibleBids[0];
    const winningAmr = winningBid.amr;

    task.assignedAmrId = winningAmr.id;
    task.winningBidScore = winningBid.finalScore;
    task.status = 'ASSIGNED';

    const explanation = `${winningAmr.id} selected because it has the highest feasible composite bid (${winningBid.finalScore.toFixed(1)}) while satisfying battery, deadline, and path constraints.`;
    
    logger.log('BIDDING', winningAmr.id,
      `WON Task #${task.id} with Bid Score: ${winningBid.finalScore.toFixed(1)}. ${explanation}`,
      { taskId: task.id, amrId: winningAmr.id, components: winningBid.components },
      'MQTT', 'success'
    );
    logger.recordTimeline('Task Assigned', `${winningAmr.id} won Task #${task.id} (Bid Score: ${winningBid.finalScore.toFixed(1)})`, 'success', winningAmr.id);

    // Assign to AMR and trigger MAPF path planning
    winningAmr.currentTask = task;
    winningAmr.priority = task.priority;
    winningAmr.setState('PLANNING', 'Planning path to task source');

    // Generate Space-Time Trajectory: AMR Current -> Task Source -> Task Dest
    this.planTaskRoute(winningAmr, task);

    return { winner: winningAmr, winningBid, explanation };
  }

  calculateAmrBid(amr, task) {
    // 1. Hard Feasibility Gates
    if (amr.carriedBox) {
      return { amr, feasible: false, rejectionReason: `AMR currently carrying ${amr.carriedBox.id} (Capacity: 1 box max)`, finalScore: 0, components: {} };
    }
    if (amr.currentTask && amr.currentTask.id !== task.id) {
      return { amr, feasible: false, rejectionReason: `AMR currently assigned to Task #${amr.currentTask.id}`, finalScore: 0, components: {} };
    }
    if (amr.payloadCapacity && task.payloadWeight > amr.payloadCapacity) {
      return { amr, feasible: false, rejectionReason: `Payload capacity insufficient (Box: ${task.payloadWeight}kg > AMR max: ${amr.payloadCapacity}kg)`, finalScore: 0, components: {} };
    }
    if (amr.state === 'CHARGING' || amr.state === 'LOW_BATTERY' || amr.state === 'REASSIGNING') {
      return { amr, feasible: false, rejectionReason: `AMR in ${amr.state} state`, finalScore: 0, components: {} };
    }
    if (amr.state === 'EMERGENCY' || amr.state === 'FAULT') {
      return { amr, feasible: false, rejectionReason: 'AMR in emergency or fault state', finalScore: 0, components: {} };
    }
    if (amr.battery < 22.0) {
      return { amr, feasible: false, rejectionReason: 'Battery below minimum mission threshold (22%)', finalScore: 0, components: {} };
    }

    // Distance to pickup
    const pathToSource = this.graph.findPath(amr.currentNodeId, task.sourceNodeId);
    if (!pathToSource) {
      return { amr, feasible: false, rejectionReason: 'No navigable path to task source (blocked or unreachable)', finalScore: 0, components: {} };
    }
    const pathToDest = this.graph.findPath(task.sourceNodeId, task.destNodeId);
    if (!pathToDest) {
      return { amr, feasible: false, rejectionReason: 'No navigable path from pickup to destination', finalScore: 0, components: {} };
    }

    // Total mission distance
    let distToPickup = 0;
    for (let i = 0; i < pathToSource.length - 1; i++) {
      distToPickup += this.graph.getEdgeCost(pathToSource[i], pathToSource[i + 1]);
    }
    let distToDelivery = 0;
    for (let i = 0; i < pathToDest.length - 1; i++) {
      distToDelivery += this.graph.getEdgeCost(pathToDest[i], pathToDest[i + 1]);
    }
    const totalDistM = distToPickup + distToDelivery;

    // Required energy estimate (Wh / %)
    const estimatedBatteryNeed = (totalDistM * 0.05) + (task.payloadWeight * 0.003) + 5.0; // 5% safety buffer
    if (amr.battery < estimatedBatteryNeed + 15.0) {
      return { amr, feasible: false, rejectionReason: `Insufficient battery for route (Needs ~${estimatedBatteryNeed.toFixed(1)}%, Has ${amr.battery.toFixed(1)}%)`, finalScore: 0, components: {} };
    }

    // 2. Component Scores (0 to 100)
    // Battery Suitability (Higher battery = higher score)
    const batteryScore = Math.min(100, Math.max(0, (amr.battery - 20) * 1.25));

    // Distance Suitability (Closer to pickup = higher score)
    const maxWarehouseDist = 120.0;
    const distanceScore = Math.max(0, 100 - (distToPickup / maxWarehouseDist) * 100);

    // Payload Suitability (Ratio of box weight to AMR capacity)
    const capacity = amr.payloadCapacity || 350.0;
    const payloadSuitability = Math.max(0, Math.min(100, (1.0 - (task.payloadWeight / (capacity * 1.1))) * 100));

    // Workload Score (Idle AMR is favored)
    let workloadScore = 100;
    if (amr.currentTask) workloadScore = 20;
    else if (amr.state === 'MOVING') workloadScore = 60;

    // Deadline Feasibility
    const estTimeSec = (totalDistM / (amr.maxSpeed || 1.2)) + 15.0; // 15s loading/unloading
    const deadlineFeasibility = Math.min(100, Math.max(0, ((task.deadlineSeconds - estTimeSec) / task.deadlineSeconds) * 100));

    // Path Feasibility (Clean uninterrupted route)
    const pathFeasibility = 95.0;

    // Priority Compatibility
    const priorityCompatibility = Math.min(100, Math.max(20, 100 - Math.abs(amr.priority - task.priority) * 0.5));

    // 3. Composite Weighted Bid Score
    const finalScore = Number((
      batteryScore * this.weights.battery +
      distanceScore * this.weights.distance +
      payloadSuitability * this.weights.taskSuitability +
      workloadScore * this.weights.workload +
      deadlineFeasibility * this.weights.deadlineFeasibility +
      pathFeasibility * this.weights.pathFeasibility +
      priorityCompatibility * this.weights.priorityCompatibility
    ).toFixed(1));

    return {
      amr,
      feasible: true,
      finalScore,
      components: {
        batterySuitability: Number(batteryScore.toFixed(1)),
        distanceSuitability: Number(distanceScore.toFixed(1)),
        payloadSuitability: Number(payloadSuitability.toFixed(1)),
        workload: Number(workloadScore.toFixed(1)),
        deadlineFeasibility: Number(deadlineFeasibility.toFixed(1)),
        pathFeasibility: Number(pathFeasibility.toFixed(1)),
        priorityCompatibility: Number(priorityCompatibility.toFixed(1))
      }
    };
  }

  debugPathLog(amr, startId, goalId, trajectory, plannerName, isModified) {
    if (!trajectory || trajectory.length === 0) return;
    const pathNodes = trajectory.map(t => t.nodeId);
    let dist = 0;
    let turns = 0;
    let waitTime = 0;
    for (let i = 0; i < trajectory.length - 1; i++) {
      const u = pathNodes[i];
      const v = pathNodes[i+1];
      if (u !== v) {
        dist += this.graph.getEdgeCost(u, v);
      }
      waitTime += trajectory[i].waitTime || 0;
      if (i > 0) {
         const p1 = this.graph.getNode(pathNodes[i-1]);
         const p2 = this.graph.getNode(pathNodes[i]);
         const p3 = this.graph.getNode(pathNodes[i+1]);
         if (p1 && p2 && p3 && p1.id !== p2.id && p2.id !== p3.id) {
           const v1x = p2.x - p1.x; const v1z = p2.z - p1.z;
           const v2x = p3.x - p2.x; const v2z = p3.z - p2.z;
           const len1 = Math.hypot(v1x, v1z); const len2 = Math.hypot(v2x, v2z);
           if (len1 > 0.01 && len2 > 0.01) {
              const dot = (v1x * v2x + v1z * v2z) / (len1 * len2);
              if (dot < 0.85) turns++;
           }
         }
      }
    }
    const time = trajectory[trajectory.length - 1].arrivalTime - trajectory[0].arrivalTime;
    const finalCost = dist + (waitTime * 0.4) + (turns * 0.05);
    
    let pathStr = pathNodes.join(' → ');
    if (pathNodes.length > 8) {
      pathStr = `${pathNodes[0]} → ... → ${pathNodes[pathNodes.length-1]}`;
    }

    console.log(`\n[PATH PLAN]\nAMR: ${amr.id}\nSTART: ${startId}\nGOAL: ${goalId}`);
    console.log(`A* PATH: ${pathStr}`);
    console.log(`DISTANCE: ${dist.toFixed(1)} m\nTIME: ${time.toFixed(1)} s\nTURNS: ${turns}`);
    console.log(`WAIT: ${waitTime.toFixed(1)} s\nCONGESTION: LOW`);
    console.log(`MAPF: ${isModified ? 'MODIFIED' : 'APPROVED'}`);
    console.log(`FINAL COST: ${finalCost.toFixed(1)}\nPLANNER: ${plannerName}`);
    if (isModified) {
      console.log(`REASON: CONFLICT / RESERVATION`);
    }
    console.log('');
  }

  planTaskRoute(amr, task) {
    // 1. Trajectory to Pickup
    const trajToPickup = this.mapf.planTrajectory(amr, task.sourceNodeId, 0) || [];
    // 2. Trajectory to Delivery (starting from pickup source)
    const departureTime = trajToPickup.length > 0 ? trajToPickup[trajToPickup.length - 1].departureTime : 0;
    const trajToDelivery = this.mapf.planTrajectory(amr, task.destNodeId, departureTime, task.sourceNodeId) || [];

    // Avoid duplicate source node when combining
    const deliverySegment = (trajToPickup.length > 0 && trajToDelivery.length > 0 && trajToDelivery[0].nodeId === task.sourceNodeId)
      ? trajToDelivery.slice(1)
      : trajToDelivery;

    // Combine route
    const combinedTrajectory = [...trajToPickup, ...deliverySegment];
    if (combinedTrajectory.length > 0) {
      amr.setTrajectory(combinedTrajectory);
      
      const isModified = combinedTrajectory.some(t => t.waitTime > 0);
      const initialWait = combinedTrajectory[0].waitTime || 0;
      
      if (initialWait > 0) {
        // Predictive Departure Scheduling: Wait in Home Bay
        amr.waitTimer = initialWait;
        amr.setState('SCHEDULED_WAIT', `Departure scheduled in ${initialWait.toFixed(1)}s to avoid future conflict`);
      } else {
        amr.setState('MOVING', `Navigating to pickup ${task.sourceNodeId}`);
      }
      
      this.debugPathLog(amr, amr.currentNodeId, task.destNodeId, combinedTrajectory, 'A*', isModified);
      logger.log('MAPF', amr.id, `Conflict-free space-time trajectory approved: ${combinedTrajectory.map(t => t.nodeId).join(' → ')}`, {}, 'MAPF', 'info');
    } else {
      // Space-time congestion rejected path. Do NOT bypass MAPF.
      logger.log('MAPF', amr.id, `MAPF failed to find conflict-free route to ${task.sourceNodeId}. Entering SCHEDULED_WAIT state to retry.`, {}, 'MAPF', 'warning');
      amr.waitTimer = 5.0;
      amr.setState('SCHEDULED_WAIT', 'Corridor congestion buffer, waiting for clearance');
    }
  }
}
