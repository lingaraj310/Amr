/**
 * EdgeFleet - D* Lite Incremental Dynamic Replanning
 * Based on Koenig & Likhachev (2002) D* Lite
 * Incrementally repairs affected paths when dynamic obstacles/hazards appear.
 */

class PriorityQueue {
  constructor() {
    this.elements = []; // Array of { node, key: [k1, k2] }
  }

  compareKeys(k1, k2) {
    if (k1[0] < k2[0] - 1e-6) return -1;
    if (k1[0] > k2[0] + 1e-6) return 1;
    if (k1[1] < k2[1] - 1e-6) return -1;
    if (k1[1] > k2[1] + 1e-6) return 1;
    return 0;
  }

  insert(node, key) {
    this.remove(node);
    this.elements.push({ node, key });
    this.elements.sort((a, b) => this.compareKeys(a.key, b.key));
  }

  remove(node) {
    const idx = this.elements.findIndex(e => e.node === node);
    if (idx !== -1) {
      this.elements.splice(idx, 1);
    }
  }

  topKey() {
    if (this.elements.length === 0) return [Infinity, Infinity];
    return this.elements[0].key;
  }

  pop() {
    return this.elements.shift();
  }

  isEmpty() {
    return this.elements.length === 0;
  }

  contains(node) {
    return this.elements.some(e => e.node === node);
  }
}

export class DStarLitePlanner {
  constructor(navGraph) {
    this.graph = navGraph;
    this.g = new Map();
    this.rhs = new Map();
    this.km = 0;
    this.sStart = null;
    this.sGoal = null;
    this.sLast = null;
    this.openQueue = new PriorityQueue();

    // Telemetry stats
    this.stats = {
      replanCount: 0,
      nodesUpdated: 0,
      nodesAffected: 0,
      lastReplanTimeMs: 0
    };
  }

  h(s1, s2) {
    return this.graph.getHeuristic(s1, s2);
  }

  calculateKey(s) {
    const gVal = this.g.get(s) ?? Infinity;
    const rhsVal = this.rhs.get(s) ?? Infinity;
    const minGRhs = Math.min(gVal, rhsVal);
    const k1 = minGRhs + this.h(this.sStart, s) + this.km;
    const k2 = minGRhs;
    return [k1, k2];
  }

  initialize(startId, goalId) {
    this.openQueue = new PriorityQueue();
    this.km = 0;
    this.g.clear();
    this.rhs.clear();
    this.sStart = startId;
    this.sGoal = goalId;
    this.sLast = startId;

    for (const nodeId of this.graph.nodes.keys()) {
      this.g.set(nodeId, Infinity);
      this.rhs.set(nodeId, Infinity);
    }

    this.rhs.set(this.sGoal, 0);
    this.openQueue.insert(this.sGoal, [this.h(this.sStart, this.sGoal), 0]);
  }

  updateVertex(u) {
    if (u !== this.sGoal) {
      let minRhs = Infinity;
      const neighbors = this.graph.getAllNeighbors(u);
      for (const sPrime of neighbors) {
        if (!this.graph.isValidNavigationEdge(u, sPrime)) continue;
        const cost = this.graph.getEdgeCost(u, sPrime);
        const gPrime = this.g.get(sPrime) ?? Infinity;
        if (cost + gPrime < minRhs) {
          minRhs = cost + gPrime;
        }
      }
      this.rhs.set(u, minRhs);
    }

    if (this.openQueue.contains(u)) {
      this.openQueue.remove(u);
    }

    const gVal = this.g.get(u) ?? Infinity;
    const rhsVal = this.rhs.get(u) ?? Infinity;
    if (Math.abs(gVal - rhsVal) > 1e-6) {
      this.openQueue.insert(u, this.calculateKey(u));
    }
  }

  computeShortestPath() {
    let iterations = 0;
    const maxIterations = 1000;

    while (
      !this.openQueue.isEmpty() &&
      (this.openQueue.compareKeys(this.openQueue.topKey(), this.calculateKey(this.sStart)) < 0 ||
       Math.abs((this.rhs.get(this.sStart) ?? Infinity) - (this.g.get(this.sStart) ?? Infinity)) > 1e-6)
    ) {
      iterations++;
      if (iterations > maxIterations) {
        console.warn('D* Lite: Exceeded max iterations');
        break;
      }

      const top = this.openQueue.pop();
      if (!top) break;
      const u = top.node;
      const kOld = top.key;
      const kNew = this.calculateKey(u);

      if (this.openQueue.compareKeys(kOld, kNew) < 0) {
        this.openQueue.insert(u, kNew);
      } else if ((this.g.get(u) ?? Infinity) > (this.rhs.get(u) ?? Infinity)) {
        this.g.set(u, this.rhs.get(u));
        const predecessors = this.graph.getAllNeighbors(u);
        for (const p of predecessors) {
          if (!this.graph.isValidNavigationEdge(p, u)) continue;
          this.updateVertex(p);
          this.stats.nodesUpdated++;
        }
      } else {
        this.g.set(u, Infinity);
        this.updateVertex(u);
        const predecessors = this.graph.getAllNeighbors(u);
        for (const p of predecessors) {
          if (!this.graph.isValidNavigationEdge(p, u)) continue;
          this.updateVertex(p);
          this.stats.nodesUpdated++;
        }
      }
    }
  }

  /**
   * Plan initial route
   */
  plan(startId, goalId) {
    const t0 = performance.now();
    this.initialize(startId, goalId);
    this.computeShortestPath();
    const path = this.extractPath();
    this.stats.lastReplanTimeMs = performance.now() - t0;
    return (path && this.graph.validatePath(path)) ? path : null;
  }

  /**
   * Dynamic repair when graph edge costs change at runtime
   */
  replan(currentPositionNodeId, changedEdges = []) {
    const t0 = performance.now();
    this.stats.replanCount++;
    this.stats.nodesAffected += changedEdges.length;

    this.sStart = currentPositionNodeId;
    this.km += this.h(this.sLast, this.sStart);
    this.sLast = this.sStart;

    for (const edge of changedEdges) {
      this.updateVertex(edge.u);
      this.updateVertex(edge.v);
    }

    this.computeShortestPath();
    const newPath = this.extractPath();
    this.stats.lastReplanTimeMs = performance.now() - t0;
    return (newPath && this.graph.validatePath(newPath)) ? newPath : null;
  }

  extractPath() {
    if (!this.sStart || !this.sGoal) return null;
    const path = [this.sStart];
    let curr = this.sStart;
    const visited = new Set([curr]);
    let steps = 0;

    while (curr !== this.sGoal && steps < 100) {
      steps++;
      let minCost = Infinity;
      let nextNode = null;

      const neighbors = this.graph.getNeighbors(curr);
      for (const nbr of neighbors) {
        if (!this.graph.isValidNavigationEdge(curr, nbr)) continue;
        const cost = this.graph.getEdgeCost(curr, nbr);
        const gVal = this.g.get(nbr) ?? Infinity;
        if (cost + gVal < minCost) {
          minCost = cost + gVal;
          nextNode = nbr;
        }
      }

      if (!nextNode || visited.has(nextNode) || minCost === Infinity) {
        return null; // Blocked or loop detected
      }

      visited.add(nextNode);
      path.push(nextNode);
      curr = nextNode;
    }

    if (curr === this.sGoal && this.graph.validatePath(path)) {
      return path;
    }
    return null;
  }
}
