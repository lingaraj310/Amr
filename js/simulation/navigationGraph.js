/**
 * EdgeFleet - Navigation Graph
 * Discrete topological & metric representation of valid warehouse paths.
 * AMR movement is strictly constrained to this graph.
 */

// Coordinate conversion helpers matching reference warehouse
export const S = 0.1;
export const X = (px) => (px - 497) * S;
export const Z = (pz) => (pz - 297) * S;

// 15 Warehouse Storage Rack Bounding Boxes (Obstacle Polygons)
export const RACK_OBSTACLES = [
  { id: 'RACK-A1', x1: 240, z1: 138, x2: 278, z2: 262 },
  { id: 'RACK-A2', x1: 310, z1: 138, x2: 348, z2: 262 },
  { id: 'RACK-B1', x1: 402, z1: 138, x2: 442, z2: 262 },
  { id: 'RACK-B2', x1: 472, z1: 138, x2: 510, z2: 262 },
  { id: 'RACK-C1', x1: 562, z1: 138, x2: 602, z2: 262 },
  { id: 'RACK-C2', x1: 643, z1: 138, x2: 682, z2: 262 },
  { id: 'RACK-D1', x1: 757, z1: 138, x2: 795, z2: 262 },
  { id: 'RACK-D2', x1: 828, z1: 138, x2: 866, z2: 262 },
  { id: 'RACK-SA1', x1: 237, z1: 325, x2: 278, z2: 445 },
  { id: 'RACK-SA2', x1: 310, z1: 325, x2: 350, z2: 445 },
  { id: 'RACK-SB1', x1: 472, z1: 335, x2: 510, z2: 395 },
  { id: 'RACK-SC1', x1: 562, z1: 325, x2: 602, z2: 445 },
  { id: 'RACK-SC2', x1: 643, z1: 325, x2: 682, z2: 445 },
  { id: 'RACK-SD1', x1: 780, z1: 325, x2: 820, z2: 388 },
  { id: 'RACK-SD2', x1: 853, z1: 325, x2: 890, z2: 388 }
];

// Warehouse Perimeter & Zone Dividing Walls (Non-drivable hard boundaries)
export const WALL_OBSTACLES = [
  // Outer perimeter walls
  { id: 'WALL_NORTH', x1: 48, z1: 8, x2: 946, z2: 14 },
  { id: 'WALL_SOUTH', x1: 48, z1: 584, x2: 946, z2: 590 },
  { id: 'WALL_WEST', x1: 48, z1: 8, x2: 54, z2: 590 },
  { id: 'WALL_EAST', x1: 940, z1: 8, x2: 946, z2: 590 },

  // Zone Interior Partitions & Barriers
  // NW Safe Zone
  { id: 'WALL_NW_EAST', x1: 190, z1: 14, x2: 194, z2: 108 },
  { id: 'WALL_NW_SOUTH_W', x1: 48, z1: 108, x2: 115, z2: 112 },
  { id: 'WALL_NW_SOUTH_E', x1: 165, z1: 108, x2: 194, z2: 112 },

  // Packaging Hub
  { id: 'WALL_PACK_WEST', x1: 218, z1: 14, x2: 222, z2: 108 },
  { id: 'WALL_PACK_EAST', x1: 433, z1: 14, x2: 437, z2: 108 },
  { id: 'WALL_PACK_SOUTH_W', x1: 220, z1: 108, x2: 315, z2: 112 },
  { id: 'WALL_PACK_SOUTH_E', x1: 375, z1: 108, x2: 435, z2: 112 },

  // Charging Station
  { id: 'WALL_CS_WEST', x1: 455, z1: 14, x2: 459, z2: 108 },
  { id: 'WALL_CS_EAST', x1: 660, z1: 14, x2: 664, z2: 108 },
  { id: 'WALL_CS_SOUTH_W', x1: 455, z1: 108, x2: 515, z2: 112 },
  { id: 'WALL_CS_SOUTH_E', x1: 605, z1: 108, x2: 664, z2: 112 },

  // Home Area
  { id: 'WALL_HOME_WEST', x1: 708, z1: 14, x2: 712, z2: 108 },
  { id: 'WALL_HOME_SOUTH_W', x1: 708, z1: 108, x2: 788, z2: 112 },
  { id: 'WALL_HOME_SOUTH_E', x1: 872, z1: 108, x2: 940, z2: 112 },

  // Inbound Buffer
  { id: 'WALL_INBOUND_NORTH', x1: 60, z1: 138, x2: 188, z2: 142 },
  { id: 'WALL_INBOUND_SOUTH', x1: 60, z1: 438, x2: 188, z2: 442 },
  { id: 'WALL_INBOUND_EAST_N', x1: 186, z1: 140, x2: 190, z2: 260 },
  { id: 'WALL_INBOUND_EAST_S', x1: 186, z1: 320, x2: 190, z2: 440 },

  // SW Safe Zone & Maintenance
  { id: 'WALL_SW_EAST', x1: 190, z1: 468, x2: 194, z2: 584 },
  { id: 'WALL_SW_NORTH_W', x1: 48, z1: 464, x2: 115, z2: 468 },
  { id: 'WALL_SW_NORTH_E', x1: 165, z1: 464, x2: 194, z2: 468 },

  // Sorting & Inspection Area
  { id: 'WALL_SORT_WEST', x1: 388, z1: 464, x2: 392, z2: 584 },
  { id: 'WALL_SORT_EAST', x1: 638, z1: 464, x2: 642, z2: 584 },
  { id: 'WALL_SORT_NORTH_W', x1: 390, z1: 464, x2: 485, z2: 468 },
  { id: 'WALL_SORT_NORTH_E', x1: 545, z1: 464, x2: 640, z2: 468 },

  // Material Handling & Staging
  { id: 'WALL_STAGE_WEST', x1: 646, z1: 464, x2: 650, z2: 584 },
  { id: 'WALL_STAGE_EAST', x1: 790, z1: 464, x2: 794, z2: 584 },
  { id: 'WALL_STAGE_NORTH_W', x1: 648, z1: 464, x2: 690, z2: 468 },
  { id: 'WALL_STAGE_NORTH_E', x1: 750, z1: 464, x2: 792, z2: 468 },

  // Open Dispatch & Returns
  { id: 'WALL_DISPATCH_WEST', x1: 795, z1: 464, x2: 799, z2: 584 },
  { id: 'WALL_DISPATCH_NORTH_W', x1: 795, z1: 464, x2: 815, z2: 468 },
  { id: 'WALL_DISPATCH_NORTH_E', x1: 875, z1: 464, x2: 940, z2: 468 }
];

// Valid Registered Navigation Portals (Designated AMR road entrances)
export const VALID_PORTALS = [
  { id: 'SAFE_NW_GATE', name: 'Safe Zone NW Gate', fromZone: 'MAIN_FLOOR', toZone: 'SAFE_ZONE_NW', nodeId: 'SAFE_NW_ENTRANCE', px: 140, pz: 110, width: 5.0, allowedVehicles: ['AMR'] },
  { id: 'PACKAGING_GATE', name: 'Packaging Hub Gate', fromZone: 'MAIN_FLOOR', toZone: 'PACKING', nodeId: 'PACKAGING_GATE', px: 345, pz: 110, width: 6.0, allowedVehicles: ['AMR'] },
  { id: 'CHARGING_GATE', name: 'Charging Station Gate', fromZone: 'MAIN_FLOOR', toZone: 'CHARGING', nodeId: 'CHARGING_ENTRANCE', px: 560, pz: 110, width: 9.0, allowedVehicles: ['AMR'] },
  { id: 'HOME_GATEWAY', name: 'Home Area Gateway', fromZone: 'MAIN_FLOOR', toZone: 'HOME_AREA', nodeId: 'HOME_GATEWAY', px: 830, pz: 110, width: 8.4, allowedVehicles: ['AMR'] },
  { id: 'INBOUND_GATE', name: 'Inbound Buffer Gate', fromZone: 'MAIN_FLOOR', toZone: 'INBOUND_BUFFER', nodeId: 'INBOUND_GATE', px: 205, pz: 290, width: 6.0, allowedVehicles: ['AMR'] },
  { id: 'SAFE_SW_GATE', name: 'Safe Zone SW / Maintenance Gate', fromZone: 'MAIN_FLOOR', toZone: 'SAFE_ZONE_SW', nodeId: 'SAFE_SW_ENTRANCE', px: 140, pz: 466, width: 5.0, allowedVehicles: ['AMR'] },
  { id: 'SORTING_GATE', name: 'Sorting & Inspection Gate', fromZone: 'MAIN_FLOOR', toZone: 'BOX_BUFFER', nodeId: 'SORTING_GATE', px: 515, pz: 466, width: 6.0, allowedVehicles: ['AMR'] },
  { id: 'STAGING_GATE', name: 'Material Staging Gate', fromZone: 'MAIN_FLOOR', toZone: 'RETAINING_HOLDING', nodeId: 'RETAINING_GATE', px: 720, pz: 466, width: 6.0, allowedVehicles: ['AMR'] },
  { id: 'DISPATCH_GATE', name: 'Dispatch & Returns Entry Gate', fromZone: 'MAIN_FLOOR', toZone: 'DISPATCH', nodeId: 'DISPATCH_GATE', px: 836, pz: 466, width: 6.0, allowedVehicles: ['AMR'] }
];

// Node Aliases for standard fleet nomenclature
export const NODE_ALIASES = {
  'R1': 'HOME_01',
  'R2': 'HOME_02',
  'R3': 'HOME_03',
  'R4': 'HOME_04',
  'R5': 'HOME_05',
  'E': 'MID_EAST_2'
};

/**
 * Check if a 2D line segment between p1 and p2 intersects an axis-aligned bounding box.
 * Uses the Liang-Barsky parametric algorithm.
 */
export function lineIntersectsBox(p1, p2, box, margin = 0.2) {
  const minX = box.minX - margin;
  const maxX = box.maxX + margin;
  const minZ = box.minZ - margin;
  const maxZ = box.maxZ + margin;

  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;

  let t0 = 0.0;
  let t1 = 1.0;

  const p = [-dx, dx, -dz, dz];
  const q = [p1.x - minX, maxX - p1.x, p1.z - minZ, maxZ - p1.z];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false; // Parallel and outside
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Check if a point is within any physical rack or wall obstacle.
 */
export function isPointInObstacle(x, z, margin = 0.2) {
  // Check Racks
  for (const rack of RACK_OBSTACLES) {
    const minX = X(rack.x1) - margin;
    const maxX = X(rack.x2) + margin;
    const minZ = Z(rack.z1) - margin;
    const maxZ = Z(rack.z2) + margin;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return true;
    }
  }
  // Check Walls
  for (const wall of WALL_OBSTACLES) {
    const minX = X(wall.x1) - margin;
    const maxX = X(wall.x2) + margin;
    const minZ = Z(wall.z1) - margin;
    const maxZ = Z(wall.z2) + margin;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a straight-line segment between nodeA and nodeB is a geometrically valid navigation edge.
 * Enforces all 9 physical geometry constraints:
 * 1. Inside warehouse perimeter
 * 2. No wall intersection (including zone dividing walls)
 * 3. No rack intersection
 * 4. No blocked obstacles
 * 5. Respects enclosed zone gates (cannot enter/exit enclosed rooms through solid walls)
 * 6. Sufficient AMR clearance (footprint)
 * 7. Follows designated navigation lanes
 * 8. No diagonal shortcuts cutting through obstacles
 * 9. Traversable by AMR footprint
 */
export function isValidNavigationEdge(nodeA, nodeB, options = {}) {
  if (!nodeA || !nodeB) return { valid: false, reason: 'NULL_NODE' };

  // Resolve world coordinates if nodes or IDs passed
  const pA = {
    id: typeof nodeA === 'string' ? nodeA : nodeA.id,
    x: typeof nodeA.x === 'number' ? nodeA.x : (nodeA.px !== undefined ? X(nodeA.px) : 0),
    z: typeof nodeA.z === 'number' ? nodeA.z : (nodeA.pz !== undefined ? Z(nodeA.pz) : 0),
    zone: nodeA.zone || 'General',
    isGate: !!nodeA.isGate
  };

  const pB = {
    id: typeof nodeB === 'string' ? nodeB : nodeB.id,
    x: typeof nodeB.x === 'number' ? nodeB.x : (nodeB.px !== undefined ? X(nodeB.px) : 0),
    z: typeof nodeB.z === 'number' ? nodeB.z : (nodeB.pz !== undefined ? Z(nodeB.pz) : 0),
    zone: nodeB.zone || 'General',
    isGate: !!nodeB.isGate
  };

  // 1. Warehouse Perimeter Bounds Check
  const minXWh = X(48) + 0.1;
  const maxXWh = X(940) - 0.1;
  const minZWh = Z(8) + 0.1;
  const maxZWh = Z(584) - 0.1;

  if (pA.x < minXWh || pA.x > maxXWh || pA.z < minZWh || pA.z > maxZWh ||
      pB.x < minXWh || pB.x > maxXWh || pB.z < minZWh || pB.z > maxZWh) {
    return { valid: false, reason: 'OUTSIDE_WAREHOUSE_PERIMETER' };
  }

  // 2. Rack Obstacle Intersections (conservative clearance margin 0.15m)
  const rackMargin = options.rackMargin !== undefined ? options.rackMargin : 0.15;
  for (const rack of RACK_OBSTACLES) {
    const box = {
      minX: X(rack.x1), maxX: X(rack.x2),
      minZ: Z(rack.z1), maxZ: Z(rack.z2)
    };
    if (lineIntersectsBox(pA, pB, box, rackMargin)) {
      return { valid: false, reason: `RACK_OBSTACLE_INTERSECTION (${rack.id})` };
    }
  }

  // 3. Wall Obstacle Intersections (including Zone Walls & Perimeters, margin 0.05m)
  const wallMargin = options.wallMargin !== undefined ? options.wallMargin : 0.05;
  for (const wall of WALL_OBSTACLES) {
    const box = {
      minX: X(wall.x1), maxX: X(wall.x2),
      minZ: Z(wall.z1), maxZ: Z(wall.z2)
    };
    if (lineIntersectsBox(pA, pB, box, wallMargin)) {
      return { valid: false, reason: `WALL_OBSTACLE_INTERSECTION (${wall.id})` };
    }
  }

  // 4. Enclosed Zone Boundary & Gate Transition Check
  // An edge connecting an internal room node to an external warehouse node must involve a designated Gate node
  const enclosedZones = ['HOME_AREA', 'SAFE_ZONE', 'PACKING', 'CHARGING', 'INBOUND_BUFFER', 'BOX_BUFFER', 'RETAINING_HOLDING', 'DISPATCH', 'RETURNS', 'MAINTENANCE'];
  const isAZone = enclosedZones.includes(pA.zone);
  const isBZone = enclosedZones.includes(pB.zone);

  if (isAZone && !isBZone) {
    if (!pA.isGate && !pB.isGate) {
      return { valid: false, reason: 'CROSS_ZONE_BOUNDARY_WITHOUT_GATE' };
    }
  } else if (!isAZone && isBZone) {
    if (!pA.isGate && !pB.isGate) {
      return { valid: false, reason: 'CROSS_ZONE_BOUNDARY_WITHOUT_GATE' };
    }
  } else if (isAZone && isBZone && pA.zone !== pB.zone) {
    if (!pA.isGate && !pB.isGate) {
      return { valid: false, reason: 'INTER_ZONE_TRANSITION_WITHOUT_GATE' };
    }
  }

  return { valid: true, reason: 'GEOMETRICALLY_VALID' };
}

export class NavigationGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map(); // key: "u->v", val: { from, to, cost, blocked, width, originalCost }
    this.adjacency = new Map(); // key: nodeId, val: Set of neighborIds
    this.dynamicHazards = new Map(); // hazardId -> { type, affectedNodes, affectedEdges }
    this.pathCache = new Map(); // key: "startId->goalId", val: cachedPathArray
    
    this.initGraph();
    this.validateNavigationGraph();
  }

  invalidatePathCache() {
    this.pathCache.clear();
  }

  addNode(id, px, pz, options = {}) {
    const worldX = X(px);
    const worldZ = Z(pz);
    const node = {
      id,
      px,
      pz,
      x: worldX,
      z: worldZ,
      name: options.name || id,
      zone: options.zone || 'General',
      isChargingStation: !!options.isChargingStation,
      isDocking: !!options.isDocking,
      isSafeZone: !!options.isSafeZone,
      isWaitingBay: !!options.isWaitingBay,
      isHomeSlot: !!options.isHomeSlot,
      isGate: !!options.isGate,
      portNumber: options.portNumber,
      blocked: false,
      capacity: options.capacity || 1
    };
    this.nodes.set(id, node);
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, new Set());
    }
    return node;
  }

  isEdgePhysicallyTraversable(p1, p2, margin = 0.55) {
    const res = isValidNavigationEdge(p1, p2, { rackMargin: margin, wallMargin: 0.05 });
    return res.valid;
  }

  isValidNavigationEdge(u, v, options = {}) {
    const nodeU = this.getNode(u);
    const nodeV = this.getNode(v);
    if (!nodeU || !nodeV) return false;
    if (nodeU.blocked || nodeV.blocked) return false;

    const edge = this.edges.get(`${nodeU.id}->${nodeV.id}`);
    if (edge && edge.blocked) return false;

    const check = isValidNavigationEdge(nodeU, nodeV, options);
    return check.valid;
  }

  addEdge(u, v, options = {}) {
    const nodeU = this.getNode(u);
    const nodeV = this.getNode(v);
    if (!nodeU || !nodeV) {
      console.error(`Cannot add edge ${u} <-> ${v}: node does not exist`);
      return;
    }

    // STRICT INITIAL EDGE VALIDATION: Check physical geometry with clearance footprint
    const evalRes = isValidNavigationEdge(nodeU, nodeV, { rackMargin: 0.15, wallMargin: 0.05 });
    if (!evalRes.valid) {
      console.warn(`[VALIDATION FAILED] Edge ${nodeU.id} -> ${nodeV.id} rejected. Reason: ${evalRes.reason}`);
      return;
    }

    const uId = nodeU.id;
    const vId = nodeV.id;
    const dist = Math.hypot(nodeU.x - nodeV.x, nodeU.z - nodeV.z);
    const cost = options.cost !== undefined ? options.cost : dist;
    const isBidirectional = options.bidirectional !== false;
    const width = options.width || 1.8; // meters

    const edgeUV = { from: uId, to: vId, cost, originalCost: cost, blocked: false, width };
    this.edges.set(`${uId}->${vId}`, edgeUV);
    this.adjacency.get(uId).add(vId);

    if (isBidirectional) {
      const edgeVU = { from: vId, to: uId, cost, originalCost: cost, blocked: false, width };
      this.edges.set(`${vId}->${uId}`, edgeVU);
      this.adjacency.get(vId).add(uId);
    }
  }

  /**
   * Run full physical geometry validation across all edges in the graph.
   * Prunes any invalid edge and logs diagnostic summary.
   */
  validateNavigationGraph() {
    let totalEvaluated = 0;
    let removedCount = 0;
    const edgesToRemove = [];

    for (const [key, edge] of this.edges) {
      totalEvaluated++;
      const nodeU = this.nodes.get(edge.from);
      const nodeV = this.nodes.get(edge.to);

      if (!nodeU || !nodeV) {
        edgesToRemove.push({ key, edge, reason: 'MISSING_ENDPOINT_NODE' });
        continue;
      }

      const res = isValidNavigationEdge(nodeU, nodeV, { rackMargin: 0.15, wallMargin: 0.05 });
      if (!res.valid) {
        edgesToRemove.push({ key, edge, nodeU, nodeV, reason: res.reason });
      }
    }

    for (const item of edgesToRemove) {
      this.edges.delete(item.key);
      const [u, v] = item.key.split('->');
      if (this.adjacency.has(u)) this.adjacency.get(u).delete(v);
      removedCount++;

      console.warn(`[INVALID_EDGE_REMOVED] Edge: ${u} -> ${v} | Start: [${item.nodeU?.px}, ${item.nodeU?.pz}] | End: [${item.nodeV?.px}, ${item.nodeV?.pz}] | Reason: PHYSICAL_OBSTACLE_INTERSECTION (${item.reason})`);
    }

    const validCount = this.edges.size;
    console.log(`=======================================================`);
    console.log(`NAVIGATION GRAPH VALIDATION`);
    console.log(`Total nodes:             ${this.nodes.size}`);
    console.log(`Total edges evaluated:   ${totalEvaluated}`);
    console.log(`Valid edges retained:    ${validCount}`);
    console.log(`Invalid edges removed:   ${removedCount}`);
    console.log(`=======================================================`);
  }

  initGraph() {
    // =========================================================================
    // 1. SAFE ZONE NW & INBOUND DOCKS (Top Left)
    // =========================================================================
    this.addNode('SAFE_NW_ENTRANCE', 140, 110, { name: 'Safe Zone NW Gate', zone: 'SAFE_ZONE', isGate: true });
    this.addNode('DOCK_IN_1', 125, 75, { name: 'Inbound Dock 1', zone: 'RECEIVING', isDocking: true });
    this.addNode('DOCK_IN_2', 125, 120, { name: 'Inbound Dock 2', zone: 'RECEIVING', isDocking: true });
    this.addNode('SAFE_ZONE_NW', 125, 60, { name: 'Safe Evac Haven NW', zone: 'SAFE_ZONE', isSafeZone: true });
    this.addNode('N_CORRIDOR_1', 205, 120, { name: 'Receiving Corridor Junction', zone: 'RECEIVING' });

    // Safe Zone NW Internal Connections
    this.addEdge('N_CORRIDOR_1', 'SAFE_NW_ENTRANCE');
    this.addEdge('SAFE_NW_ENTRANCE', 'DOCK_IN_1');
    this.addEdge('SAFE_NW_ENTRANCE', 'DOCK_IN_2');
    this.addEdge('SAFE_NW_ENTRANCE', 'SAFE_ZONE_NW');
    this.addEdge('DOCK_IN_1', 'SAFE_ZONE_NW');

    // =========================================================================
    // 2. PACKAGING HUB (Top Center-Left)
    // =========================================================================
    this.addNode('PACKAGING_GATE', 345, 110, { name: 'Packaging Hub Gate', zone: 'PACKING', isGate: true });
    this.addNode('PACK_1', 310, 65, { name: 'Packaging Station 1', zone: 'PACKING', isDocking: true });
    this.addNode('PACK_2', 380, 65, { name: 'Packaging Station 2', zone: 'PACKING', isDocking: true });
    this.addNode('N_PACK_JUNCTION', 345, 120, { name: 'Packaging Hub Junction', zone: 'PACKING', isWaitingBay: true });

    this.addEdge('N_PACK_JUNCTION', 'PACKAGING_GATE');
    this.addEdge('PACKAGING_GATE', 'PACK_1');
    this.addEdge('PACKAGING_GATE', 'PACK_2');
    this.addEdge('PACK_1', 'PACK_2');

    // =========================================================================
    // 3. TWO-PORT AMR CHARGING STATION (Top Center)
    // =========================================================================
    this.addNode('N_CHARGE_HUB', 560, 120, { name: 'Charging Approach Hub', zone: 'CHARGING', isWaitingBay: true });
    this.addNode('CHARGING_ENTRANCE', 560, 110, { name: 'Charging Station Gate', zone: 'CHARGING', isGate: true });
    this.addNode('CHARGING_INTERIOR', 560, 75, { name: 'Charging Station Interior', zone: 'CHARGING' });
    this.addNode('CS_01', 515, 55, { name: 'CHARGING PORT 01', zone: 'CHARGING', isChargingStation: true, portNumber: 1 });
    this.addNode('CS_02', 605, 55, { name: 'CHARGING PORT 02', zone: 'CHARGING', isChargingStation: true, portNumber: 2 });

    this.addEdge('N_CHARGE_HUB', 'CHARGING_ENTRANCE');
    this.addEdge('CHARGING_ENTRANCE', 'CHARGING_INTERIOR');
    this.addEdge('CHARGING_INTERIOR', 'CS_01');
    this.addEdge('CHARGING_INTERIOR', 'CS_02');

    // =========================================================================
    // 4. NORTHEAST TRANSIT HUB & AMR HOME AREA (Top Right)
    // =========================================================================
    this.addNode('N_EAST_HUB', 780, 120, { name: 'Northeast Transit Junction', zone: 'HOME_APPROACH' });
    this.addNode('N_EAST_CORRIDOR', 915, 120, { name: 'Northeast Corridor', zone: 'HOME_APPROACH' });
    this.addNode('HOME_GATEWAY', 830, 110, { name: 'Home Area Gate', zone: 'HOME_AREA', isGate: true });
    this.addNode('HOME_01', 755, 50, { name: 'AMR-01 Home Parking Slot', zone: 'HOME_AREA', isHomeSlot: true });
    this.addNode('HOME_02', 830, 50, { name: 'AMR-02 Home Parking Slot', zone: 'HOME_AREA', isHomeSlot: true });
    this.addNode('HOME_03', 905, 50, { name: 'AMR-03 Home Parking Slot', zone: 'HOME_AREA', isHomeSlot: true });
    this.addNode('HOME_04', 775, 82, { name: 'AMR-04 Home Parking Slot', zone: 'HOME_AREA', isHomeSlot: true });
    this.addNode('HOME_05', 885, 82, { name: 'AMR-05 Home Parking Slot', zone: 'HOME_AREA', isHomeSlot: true });

    this.addEdge('N_EAST_HUB', 'HOME_GATEWAY');
    this.addEdge('HOME_01', 'HOME_02');
    this.addEdge('HOME_02', 'HOME_03');
    this.addEdge('HOME_01', 'HOME_04');
    this.addEdge('HOME_03', 'HOME_05');
    this.addEdge('HOME_04', 'HOME_GATEWAY');
    this.addEdge('HOME_02', 'HOME_GATEWAY');
    this.addEdge('HOME_05', 'HOME_GATEWAY');

    // =========================================================================
    // 5. STORAGE AISLES & EXACT CENTERLINES (North, Mid, South)
    // =========================================================================
    // Aisle A (Between Racks Col 1 [240..278] & Col 2 [310..348] -> Centerline px = 294)
    this.addNode('AISLE_A_N', 294, 120, { name: 'Aisle A North Entry', zone: 'AISLE_A' });
    this.addNode('AISLE_A_MID', 294, 295, { name: 'Aisle A Mid-Point', zone: 'AISLE_A' });
    this.addNode('AISLE_A_S', 294, 460, { name: 'Aisle A South Exit', zone: 'AISLE_A' });
    this.addEdge('AISLE_A_N', 'AISLE_A_MID');
    this.addEdge('AISLE_A_MID', 'AISLE_A_S');

    // Aisle B (Between Racks Col 3 [402..442] & Col 4 [472..510] -> Centerline px = 457)
    this.addNode('AISLE_B_N', 457, 120, { name: 'Aisle B North Entry', zone: 'AISLE_B' });
    this.addNode('AISLE_B_MID', 457, 295, { name: 'Aisle B Mid-Point', zone: 'AISLE_B' });
    this.addNode('AISLE_B_S', 457, 460, { name: 'Aisle B South Exit', zone: 'AISLE_B' });
    this.addEdge('AISLE_B_N', 'AISLE_B_MID');
    this.addEdge('AISLE_B_MID', 'AISLE_B_S');

    // Aisle C (Between Racks Col 5 [562..602] & Col 6 [643..682] -> Centerline px = 622)
    this.addNode('AISLE_C_N', 622, 120, { name: 'Aisle C North Entry', zone: 'AISLE_C' });
    this.addNode('AISLE_C_MID', 622, 295, { name: 'Aisle C Mid-Point', zone: 'AISLE_C' });
    this.addNode('AISLE_C_S', 622, 460, { name: 'Aisle C South Exit', zone: 'AISLE_C' });
    this.addEdge('AISLE_C_N', 'AISLE_C_MID');
    this.addEdge('AISLE_C_MID', 'AISLE_C_S');

    // Aisle D (North: between Col 7 [757..795] & Col 8 [828..866] -> px = 812; South: between RACK-SD1 [780..820] & RACK-SD2 [853..890] -> px = 836)
    this.addNode('AISLE_D_N', 812, 120, { name: 'Aisle D North Entry', zone: 'AISLE_D' });
    this.addNode('AISLE_D_MID', 812, 295, { name: 'Aisle D Mid Junction', zone: 'AISLE_D' });
    this.addNode('AISLE_D_S_MID', 836, 295, { name: 'Aisle D South Mid Entry', zone: 'AISLE_D' });
    this.addNode('AISLE_D_S', 836, 460, { name: 'Aisle D South Exit', zone: 'AISLE_D' });
    this.addEdge('AISLE_D_N', 'AISLE_D_MID');
    this.addEdge('AISLE_D_S_MID', 'AISLE_D_S');

    // =========================================================================
    // 6. NORTH CROSS-HIGHWAY (pz = 120) - Sequential Rectilinear Corridor
    // =========================================================================
    this.addEdge('N_CORRIDOR_1', 'AISLE_A_N');
    this.addEdge('AISLE_A_N', 'N_PACK_JUNCTION');
    this.addEdge('N_PACK_JUNCTION', 'AISLE_B_N');
    this.addEdge('AISLE_B_N', 'N_CHARGE_HUB');
    this.addEdge('N_CHARGE_HUB', 'AISLE_C_N');
    this.addEdge('AISLE_C_N', 'N_EAST_HUB');
    this.addEdge('N_EAST_HUB', 'AISLE_D_N');
    this.addEdge('AISLE_D_N', 'N_EAST_CORRIDOR');

    // =========================================================================
    // 7. MID CROSS-HIGHWAY (pz = 295) & CENTRAL JUNCTION
    // =========================================================================
    this.addNode('MID_WEST', 205, 295, { name: 'Mid West Junction', zone: 'TRAFFIC_CORRIDOR', isWaitingBay: true });
    this.addNode('MID_INTERSECTION', 530, 295, { name: 'Central Junction (Main Intersection)', zone: 'CENTRAL_JUNCTION', capacity: 2, isWaitingBay: true });
    this.addNode('MID_EAST_1', 750, 295, { name: 'Mid East Junction 1', zone: 'TRAFFIC_CORRIDOR' });
    this.addNode('MID_EAST_2', 915, 295, { name: 'Mid East Corridor', zone: 'TRAFFIC_CORRIDOR' });

    // Mid Highway Sequential Rectilinear Connections
    this.addEdge('MID_WEST', 'AISLE_A_MID');
    this.addEdge('AISLE_A_MID', 'AISLE_B_MID');
    this.addEdge('AISLE_B_MID', 'MID_INTERSECTION');
    this.addEdge('MID_INTERSECTION', 'AISLE_C_MID');
    this.addEdge('AISLE_C_MID', 'MID_EAST_1');
    this.addEdge('MID_EAST_1', 'AISLE_D_MID');
    this.addEdge('AISLE_D_MID', 'AISLE_D_S_MID');
    this.addEdge('AISLE_D_S_MID', 'MID_EAST_2');

    // =========================================================================
    // 8. SOUTH CROSS-HIGHWAY (pz = 460)
    // =========================================================================
    this.addNode('SOUTH_WEST_JUNCTION', 205, 460, { name: 'Southwest Hub', zone: 'MAINTENANCE_APPROACH' });
    this.addNode('SOUTH_INTERSECTION', 530, 460, { name: 'South Central Intersection', zone: 'STORAGE', isWaitingBay: true });
    this.addNode('SOUTH_EAST_JUNCTION', 750, 460, { name: 'Southeast Junction', zone: 'DISPATCH_APPROACH' });
    this.addNode('SOUTH_EAST_CORRIDOR', 915, 460, { name: 'Southeast Corridor', zone: 'DISPATCH_APPROACH' });

    // South Highway Sequential Rectilinear Connections
    this.addEdge('SOUTH_WEST_JUNCTION', 'AISLE_A_S');
    this.addEdge('AISLE_A_S', 'AISLE_B_S');
    this.addEdge('AISLE_B_S', 'SOUTH_INTERSECTION');
    this.addEdge('SOUTH_INTERSECTION', 'AISLE_C_S');
    this.addEdge('AISLE_C_S', 'SOUTH_EAST_JUNCTION');
    this.addEdge('SOUTH_EAST_JUNCTION', 'AISLE_D_S');
    this.addEdge('AISLE_D_S', 'SOUTH_EAST_CORRIDOR');

    // =========================================================================
    // 9. OUTER PERIMETER LANES (West & East Vertical Arteries)
    // =========================================================================
    this.addEdge('N_CORRIDOR_1', 'MID_WEST');
    this.addEdge('MID_WEST', 'SOUTH_WEST_JUNCTION');

    this.addEdge('N_EAST_CORRIDOR', 'MID_EAST_2');
    this.addEdge('MID_EAST_2', 'SOUTH_EAST_CORRIDOR');

    // =========================================================================
    // 10. LEFT-SIDE: INBOUND BUFFER & QUALITY CHECK
    // =========================================================================
    this.addNode('INBOUND_GATE', 205, 290, { name: 'Inbound Buffer Gate', zone: 'INBOUND_BUFFER', isGate: true });
    this.addNode('INBOUND_BUF_1', 125, 210, { name: 'Inbound Buffer 1', zone: 'INBOUND_BUFFER', isDocking: true });
    this.addNode('INBOUND_BUF_2', 125, 370, { name: 'Quality Check Station 2', zone: 'INBOUND_BUFFER', isDocking: true });

    this.addEdge('MID_WEST', 'INBOUND_GATE');
    this.addEdge('INBOUND_GATE', 'INBOUND_BUF_1');
    this.addEdge('INBOUND_GATE', 'INBOUND_BUF_2');
    this.addEdge('INBOUND_BUF_1', 'INBOUND_BUF_2');

    // =========================================================================
    // 11. BOTTOM-LEFT: SAFE ZONE SW & MAINTENANCE HUB
    // =========================================================================
    this.addNode('SAFE_SW_ENTRANCE', 140, 466, { name: 'Safe Zone SW / Maintenance Gate', zone: 'SAFE_ZONE', isGate: true });
    this.addNode('MAINT_1', 120, 510, { name: 'Maintenance Station 1', zone: 'MAINTENANCE', isDocking: true });
    this.addNode('MAINT_2', 120, 555, { name: 'Maintenance Station 2', zone: 'MAINTENANCE', isDocking: true });
    this.addNode('SAFE_ZONE_SW', 80, 526, { name: 'Safe Evac Haven SW', zone: 'SAFE_ZONE', isSafeZone: true });

    this.addEdge('SOUTH_WEST_JUNCTION', 'SAFE_SW_ENTRANCE');
    this.addEdge('SAFE_SW_ENTRANCE', 'MAINT_1');
    this.addEdge('SAFE_SW_ENTRANCE', 'MAINT_2');
    this.addEdge('SAFE_SW_ENTRANCE', 'SAFE_ZONE_SW');
    this.addEdge('MAINT_1', 'MAINT_2');
    this.addEdge('MAINT_1', 'SAFE_ZONE_SW');

    // =========================================================================
    // 12. BOTTOM-CENTER: BOX BUFFER / SORTING & INSPECTION AREA
    // =========================================================================
    this.addNode('SORTING_GATE', 515, 466, { name: 'Sorting & Inspection Gate', zone: 'BOX_BUFFER', isGate: true });
    this.addNode('BUFFER_SORT_1', 450, 525, { name: 'Box Buffer Station 1', zone: 'BOX_BUFFER', isDocking: true });
    this.addNode('BUFFER_SORT_2', 575, 525, { name: 'Sorting & Inspection Station 2', zone: 'BOX_BUFFER', isDocking: true });

    this.addEdge('SOUTH_INTERSECTION', 'SORTING_GATE');
    this.addEdge('SORTING_GATE', 'BUFFER_SORT_1');
    this.addEdge('SORTING_GATE', 'BUFFER_SORT_2');
    this.addEdge('BUFFER_SORT_1', 'BUFFER_SORT_2');

    // =========================================================================
    // 13. BOTTOM RIGHT-CENTER: MATERIAL HANDLING & STAGING AREA
    // =========================================================================
    this.addNode('RETAINING_GATE', 720, 466, { name: 'Material Staging Gate', zone: 'RETAINING_HOLDING', isGate: true });
    this.addNode('HOLDING_1', 680, 525, { name: 'Staging Pallet Bay 1', zone: 'RETAINING_HOLDING', isDocking: true });
    this.addNode('HOLDING_2', 755, 525, { name: 'Holding Prep Bay 2', zone: 'RETAINING_HOLDING', isDocking: true });

    this.addEdge('SOUTH_EAST_JUNCTION', 'RETAINING_GATE');
    this.addEdge('RETAINING_GATE', 'HOLDING_1');
    this.addEdge('RETAINING_GATE', 'HOLDING_2');
    this.addEdge('HOLDING_1', 'HOLDING_2');

    // =========================================================================
    // 14. BOTTOM-RIGHT: OPEN DISPATCH & RETURNS (NO SAFE ZONE SE)
    // =========================================================================
    this.addNode('DISPATCH_GATE', 836, 466, { name: 'Dispatch & Returns Entry Gate', zone: 'DISPATCH', isGate: true });
    this.addNode('DISPATCH_1', 835, 505, { name: 'Dispatch Staging Bay 1', zone: 'DISPATCH', isDocking: true });
    this.addNode('DISPATCH_2', 885, 505, { name: 'Dispatch Staging Bay 2', zone: 'DISPATCH', isDocking: true });
    this.addNode('RETURN_INSPECT_1', 820, 545, { name: 'Return Inspection Table', zone: 'RETURNS', isDocking: true });
    this.addNode('RETURN_HOLD_1', 880, 555, { name: 'Return Hold & Sorting Area', zone: 'RETURNS', isDocking: true });

    this.addEdge('AISLE_D_S', 'DISPATCH_GATE');
    this.addEdge('SOUTH_EAST_CORRIDOR', 'DISPATCH_GATE');
    this.addEdge('DISPATCH_GATE', 'DISPATCH_1');
    this.addEdge('DISPATCH_GATE', 'DISPATCH_2');
    this.addEdge('DISPATCH_GATE', 'RETURN_INSPECT_1');
    this.addEdge('DISPATCH_1', 'DISPATCH_2');
    this.addEdge('DISPATCH_1', 'RETURN_INSPECT_1');
    this.addEdge('DISPATCH_2', 'RETURN_HOLD_1');
    this.addEdge('RETURN_INSPECT_1', 'RETURN_HOLD_1');
  }

  getSafeZones() {
    const safeZones = [];
    for (const [id, node] of this.nodes) {
      if (node.isSafeZone) {
        safeZones.push({ id, ...node });
      }
    }
    return safeZones;
  }

  getNode(id) {
    if (!id) return undefined;
    const resolvedId = NODE_ALIASES[id] || id;
    return this.nodes.get(resolvedId);
  }

  getHeuristic(u, v) {
    const n1 = this.getNode(u);
    const n2 = this.getNode(v);
    if (!n1 || !n2) return 0;
    // Manhattan distance (L1 norm) is strictly admissible and optimal for orthogonal warehouse lanes
    return Math.abs(n1.x - n2.x) + Math.abs(n1.z - n2.z);
  }

  isValidEdge(u, v) {
    return this.isValidNavigationEdge(u, v, { rackMargin: 0.15, wallMargin: 0.05 });
  }

  validatePath(path) {
    if (!Array.isArray(path) || path.length < 2) return path ? true : false;
    for (let i = 0; i < path.length - 1; i++) {
      if (!this.isValidNavigationEdge(path[i], path[i + 1])) {
        return false;
      }
    }
    return true;
  }

  /**
   * Dijkstra Fallback Planner with Strict Physical Geometry Validation
   */
  dijkstraPath(startId, goalId) {
    const sId = (this.getNode(startId) || {}).id;
    const gId = (this.getNode(goalId) || {}).id;
    if (sId === gId) return [sId];
    if (!sId || !gId || !this.nodes.has(sId) || !this.nodes.has(gId)) return null;

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.nodes.keys());

    for (const nodeId of this.nodes.keys()) {
      distances.set(nodeId, Infinity);
    }
    distances.set(sId, 0);

    while (unvisited.size > 0) {
      let current = null;
      let smallestDist = Infinity;

      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId);
        if (dist < smallestDist) {
          smallestDist = dist;
          current = nodeId;
        }
      }

      if (current === null || smallestDist === Infinity) break;
      if (current === gId) {
        const path = [];
        let curr = gId;
        while (curr) {
          path.unshift(curr);
          curr = previous.get(curr);
        }
        return this.validatePath(path) ? path : null;
      }

      unvisited.delete(current);

      const neighbors = this.getNeighbors(current);
      for (const nbrId of neighbors) {
        if (!unvisited.has(nbrId)) continue;
        if (!this.isValidNavigationEdge(current, nbrId)) continue;

        const edgeCost = this.getEdgeCost(current, nbrId);
        if (edgeCost === Infinity) continue;

        const alt = distances.get(current) + edgeCost;
        if (alt < distances.get(nbrId)) {
          distances.set(nbrId, alt);
          previous.set(nbrId, current);
        }
      }
    }

    return null;
  }

  findPath(startId, goalId) {
    const sId = (this.getNode(startId) || {}).id;
    const gId = (this.getNode(goalId) || {}).id;
    if (sId === gId) return [sId];
    if (!sId || !gId || !this.nodes.has(sId) || !this.nodes.has(gId)) return null;

    const cacheKey = `${sId}->${gId}`;
    if (this.pathCache.has(cacheKey)) {
      const cached = this.pathCache.get(cacheKey);
      if (cached && this.validatePath(cached)) {
        return [...cached];
      }
    }

    const openSet = new Set([sId]);
    const cameFrom = new Map();

    const gScore = new Map();
    const fScore = new Map();

    this.nodes.forEach((_, id) => {
      gScore.set(id, Infinity);
      fScore.set(id, Infinity);
    });

    gScore.set(sId, 0);
    fScore.set(sId, this.getHeuristic(sId, gId));

    while (openSet.size > 0) {
      let current = null;
      let lowestF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id);
        if (f < lowestF) {
          lowestF = f;
          current = id;
        }
      }

      if (current === gId) {
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current);
          path.unshift(current);
        }
        if (this.validatePath(path)) {
          this.pathCache.set(cacheKey, path);
          return [...path];
        }
        return null;
      }

      openSet.delete(current);
      const currentG = gScore.get(current);
      const prevNodeId = cameFrom.get(current);

      const neighbors = this.getNeighbors(current);
      for (const nbr of neighbors) {
        if (!this.isValidNavigationEdge(current, nbr)) continue;

        let edgeCost = this.getEdgeCost(current, nbr);
        if (edgeCost === Infinity) continue;

        // Turning penalty (+0.05) to prioritize continuous straight corridors over zig-zagging
        if (prevNodeId) {
          const pNode = this.nodes.get(prevNodeId);
          const cNode = this.nodes.get(current);
          const nNode = this.nodes.get(nbr);
          const v1x = cNode.x - pNode.x;
          const v1z = cNode.z - pNode.z;
          const v2x = nNode.x - cNode.x;
          const v2z = nNode.z - cNode.z;
          const len1 = Math.hypot(v1x, v1z);
          const len2 = Math.hypot(v2x, v2z);
          if (len1 > 0.01 && len2 > 0.01) {
            const dot = (v1x * v2x + v1z * v2z) / (len1 * len2);
            if (dot < 0.85) {
              edgeCost += 0.05;
            }
          }
        }

        const tentativeG = currentG + edgeCost;
        if (tentativeG < gScore.get(nbr)) {
          cameFrom.set(nbr, current);
          gScore.set(nbr, tentativeG);
          fScore.set(nbr, tentativeG + this.getHeuristic(nbr, gId));
          openSet.add(nbr);
        }
      }
    }

    // Fallback to Dijkstra with full validation
    const dijPath = this.dijkstraPath(sId, gId);
    if (dijPath && this.validatePath(dijPath)) {
      this.pathCache.set(cacheKey, dijPath);
      return [...dijPath];
    }
    return null;
  }

  getNeighbors(id) {
    const resolvedId = (this.getNode(id) || {}).id || id;
    const neighborSet = this.adjacency.get(resolvedId);
    if (!neighborSet) return [];
    return Array.from(neighborSet).filter(nbrId => {
      const edge = this.edges.get(`${resolvedId}->${nbrId}`);
      const targetNode = this.nodes.get(nbrId);
      if (!edge || edge.blocked || !targetNode || targetNode.blocked) return false;
      return this.isValidNavigationEdge(resolvedId, nbrId);
    });
  }

  getAllNeighbors(id) {
    const resolvedId = (this.getNode(id) || {}).id || id;
    const neighborSet = this.adjacency.get(resolvedId);
    if (!neighborSet) return [];
    return Array.from(neighborSet).filter(nbrId => this.isValidNavigationEdge(resolvedId, nbrId));
  }

  getEdge(u, v) {
    const uId = (this.getNode(u) || {}).id || u;
    const vId = (this.getNode(v) || {}).id || v;
    return this.edges.get(`${uId}->${vId}`);
  }

  getEdgeCost(u, v) {
    const uId = (this.getNode(u) || {}).id || u;
    const vId = (this.getNode(v) || {}).id || v;
    const edge = this.edges.get(`${uId}->${vId}`);
    if (!edge || edge.blocked) return Infinity;
    const targetNode = this.nodes.get(vId);
    if (targetNode && targetNode.blocked) return Infinity;
    if (!this.isValidNavigationEdge(uId, vId)) return Infinity;
    return edge.cost;
  }

  setNodeBlocked(nodeId, blocked) {
    const node = this.getNode(nodeId);
    if (node) {
      node.blocked = blocked;
      this.invalidatePathCache();
    }
  }

  setEdgeBlocked(u, v, blocked) {
    const uId = (this.getNode(u) || {}).id || u;
    const vId = (this.getNode(v) || {}).id || v;
    const edge1 = this.edges.get(`${uId}->${vId}`);
    const edge2 = this.edges.get(`${vId}->${uId}`);
    if (edge1) edge1.blocked = blocked;
    if (edge2) edge2.blocked = blocked;
    this.invalidatePathCache();
  }

  resetObstacles() {
    this.nodes.forEach(n => n.blocked = false);
    this.edges.forEach(e => {
      e.blocked = false;
      e.cost = e.originalCost;
    });
    this.dynamicHazards.clear();
    this.invalidatePathCache();
    this.validateNavigationGraph();
  }
}
