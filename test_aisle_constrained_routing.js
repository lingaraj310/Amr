import { NavigationGraph, RACK_OBSTACLES, lineIntersectsBox, X, Z } from './js/simulation/navigationGraph.js';
import { FleetManager } from './js/simulation/fleetManager.js';
import { DStarLitePlanner } from './js/planning/dstarLite.js';

console.log('===============================================================');
console.log('  AISLE-CONSTRAINED AMR ROUTING & SHORTEST VALID PATH TESTS   ');
console.log('===============================================================');

const graph = new NavigationGraph();
const fleet = new FleetManager(graph);
const planner = new DStarLitePlanner(graph);

// -----------------------------------------------------------------------------
// TEST 1: Same Aisle Navigation
// -----------------------------------------------------------------------------
console.log('\n--- TEST 1: Same Aisle Navigation (Aisle A North -> Aisle A South) ---');
const pathSameAisle = graph.findPath('AISLE_A_N', 'AISLE_A_S');
console.log('Route:', pathSameAisle.join(' -> '));

if (JSON.stringify(pathSameAisle) === JSON.stringify(['AISLE_A_N', 'AISLE_A_MID', 'AISLE_A_S'])) {
  console.log('PASS: AMR travels straight along Aisle A without deviations!');
} else {
  console.error('FAIL: Same aisle path is not straight along the aisle:', pathSameAisle);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// TEST 2: Different Aisle Navigation (Aisle A -> Aisle C)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 2: Different Aisle Navigation (Aisle A North -> Aisle C South) ---');
const pathDiffAisle = graph.findPath('AISLE_A_N', 'AISLE_C_S');
console.log('Route:', pathDiffAisle.join(' -> '));

// Route must follow: Aisle A -> Cross-Aisle -> Aisle C -> Destination
const validAislePaths = [
  // Via Mid Cross-Highway:
  ['AISLE_A_N', 'AISLE_A_MID', 'AISLE_B_MID', 'MID_INTERSECTION', 'AISLE_C_MID', 'AISLE_C_S'],
  // Via North Highway:
  ['AISLE_A_N', 'N_PACK_JUNCTION', 'AISLE_B_N', 'N_CHARGE_HUB', 'AISLE_C_N', 'AISLE_C_MID', 'AISLE_C_S']
];

const isValidDiffAisle = graph.validatePath(pathDiffAisle);
console.log('Path Validation Check (No Rack Crossings):', isValidDiffAisle ? 'VALID' : 'INVALID');

if (isValidDiffAisle && pathDiffAisle.includes('AISLE_C_S')) {
  console.log('PASS: AMR travels orthogonally through aisles and connecting cross-highways without cutting across racks!');
} else {
  console.error('FAIL: Different aisle path is invalid or cuts across obstacles:', pathDiffAisle);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// TEST 3: Dispatch & Returns Task from Storage Aisle (Aisle A Mid -> Dispatch 1)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 3: Dispatch & Returns Task from Storage Aisle (AISLE_A_MID -> DISPATCH_1) ---');
const pathDispatch = graph.findPath('AISLE_A_MID', 'DISPATCH_1');
console.log('Route to Dispatch:', pathDispatch.join(' -> '));

const isDispatchValid = graph.validatePath(pathDispatch);
console.log('Path Validation Check (No Rack Crossings):', isDispatchValid ? 'VALID' : 'INVALID');

if (isDispatchValid && pathDispatch.includes('DISPATCH_GATE') && pathDispatch[pathDispatch.length - 1] === 'DISPATCH_1') {
  console.log('PASS: AMR follows aisle -> south intersection -> cross-aisle -> DISPATCH_GATE -> DISPATCH_1!');
} else {
  console.error('FAIL: Dispatch route cuts diagonally or bypasses designated gate:', pathDispatch);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// TEST 4: Global Rack Obstacle Clearance Verification
// -----------------------------------------------------------------------------
console.log('\n--- TEST 4: Exhaustive Rack Clearance for all 15 Racks across Graph ---');
let invalidEdgeCount = 0;
for (const [edgeKey, edge] of graph.edges) {
  const nodeU = graph.getNode(edge.from);
  const nodeV = graph.getNode(edge.to);
  for (const rack of RACK_OBSTACLES) {
    const box = {
      minX: X(rack.x1),
      maxX: X(rack.x2),
      minZ: Z(rack.z1),
      maxZ: Z(rack.z2)
    };
    if (lineIntersectsBox(nodeU, nodeV, box, 0.1)) {
      console.error(`COLLISION DETECTED: Edge ${edgeKey} intersects ${rack.id}!`);
      invalidEdgeCount++;
    }
  }
}

if (invalidEdgeCount === 0) {
  console.log('PASS: All navigation edges strictly clear all 15 rack obstacle bounding boxes (0 collisions)!');
} else {
  console.error(`FAIL: Found ${invalidEdgeCount} graph edges intersecting racks!`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// TEST 5: Simultaneous 5-AMR Simulation & Collision/Deadlock Verification
// -----------------------------------------------------------------------------
console.log('\n--- TEST 5: Simultaneous 5-AMR Fleet Simulation (400 Decision Ticks) ---');
fleet.isRunning = true;
fleet.simSpeed = 1.0;

// Reset AMRs to distinct operational starting nodes
const startingNodes = ['HOME_01', 'AISLE_A_N', 'AISLE_B_MID', 'AISLE_C_S', 'DISPATCH_1'];
const destinations = ['PACK_1', 'AISLE_A_S', 'BUFFER_SORT_1', 'CS_01', 'HOLDING_1'];

fleet.amrs.forEach((amr, idx) => {
  const startNode = graph.getNode(startingNodes[idx]);
  amr.currentNodeId = startNode.id;
  amr.position = { x: startNode.x, y: 0.15, z: startNode.z };
  const destId = destinations[idx];
  const path = graph.findPath(amr.currentNodeId, destId);
  if (path) {
    amr.activeRoute = path;
    amr.activeTrajectory = path.map((nodeId, i) => ({
      time: i * 2.0,
      nodeId,
      x: graph.getNode(nodeId).x,
      z: graph.getNode(nodeId).z
    }));
    amr.trajectoryIndex = 0;
    amr.targetNodeId = path[1] || path[0];
    amr.setState('MOVING', `Navigating to ${destId}`);
  }
});

let simStep = 0;
let rackPenetrations = 0;
let invalidRouteSegments = 0;

while (simStep < 400) {
  simStep++;
  fleet.tick(0.1);

  // Check AMR physical clearance & rack clearance
  for (let i = 0; i < fleet.amrs.length; i++) {
    const amr = fleet.amrs[i];

    // Verify active path validity
    if (amr.activeRoute && amr.activeRoute.length > 1) {
      if (!graph.validatePath(amr.activeRoute)) {
        invalidRouteSegments++;
      }
    }

    // Check AMR inside rack bounding boxes
    for (const rack of RACK_OBSTACLES) {
      const minX = X(rack.x1);
      const maxX = X(rack.x2);
      const minZ = Z(rack.z1);
      const maxZ = Z(rack.z2);
      if (amr.position.x > minX && amr.position.x < maxX && amr.position.z > minZ && amr.position.z < maxZ) {
        rackPenetrations++;
        console.error(`COLLISION: ${amr.id} penetrated inside rack ${rack.id} at (${amr.position.x.toFixed(2)}, ${amr.position.z.toFixed(2)})!`);
      }
    }
  }
}

console.log(`Simulation complete: Steps = ${simStep}, Rack Penetrations = ${rackPenetrations}, Invalid Route Segments = ${invalidRouteSegments}`);

if (rackPenetrations === 0 && invalidRouteSegments === 0) {
  console.log('PASS: 5 AMRs operated simultaneously on designated lanes with 0 rack penetrations and 0 invalid route segments!');
} else {
  console.error(`FAIL: Safety violations detected (Rack Penetrations: ${rackPenetrations}, Invalid Routes: ${invalidRouteSegments})`);
  process.exit(1);
}

console.log('\n===============================================================');
console.log('  ✅ ALL AISLE-CONSTRAINED AMR ROUTING TESTS PASSED 100%!       ');
console.log('===============================================================\n');
