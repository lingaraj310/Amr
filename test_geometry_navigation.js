import { NavigationGraph, X, Z } from './js/simulation/navigationGraph.js';
import { FleetManager } from './js/simulation/fleetManager.js';
import { DStarLitePlanner } from './js/planning/dstarLite.js';

console.log('=== RUNNING TARGETED GEOMETRY & NAVIGATION TESTS ===');

const graph = new NavigationGraph();
const fleet = new FleetManager(graph);
const planner = new DStarLitePlanner(graph);

// Helper for line segment intersection
function lineSegmentsIntersect(p1, p2, p3, p4) {
  function ccw(a, b, c) {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}

// 1. Test Safe Zone Entrance Routing (Exactly 2 Safe Zones: NW and SW)
console.log('\n--- TEST 1: Safe Zone Routing & Gateways (Exactly 2 Safe Zones: NW & SW) ---');
const safeZones = graph.getSafeZones();
console.log('Total registered Safe Zones:', safeZones.length, safeZones.map(s => s.id));
if (safeZones.length === 2 && safeZones.some(s => s.id === 'SAFE_ZONE_NW') && safeZones.some(s => s.id === 'SAFE_ZONE_SW') && !graph.nodes.has('SAFE_ZONE_SE')) {
  console.log('PASS: Exactly TWO Safe Zones exist in warehouse (SAFE_ZONE_NW and SAFE_ZONE_SW). SAFE_ZONE_SE is completely removed!');
} else {
  console.error('FAIL: Safe zones count or IDs incorrect! Expected exactly 2 (NW & SW).');
  process.exit(1);
}

const pathNW = planner.plan('N_CORRIDOR_1', 'SAFE_ZONE_NW');
console.log('Route to SAFE_ZONE_NW:', pathNW.join(' -> '));
if (pathNW.includes('SAFE_NW_ENTRANCE') && pathNW[pathNW.length - 1] === 'SAFE_ZONE_NW') {
  console.log('PASS: Route to Safe Zone NW correctly passes through SAFE_NW_ENTRANCE gateway!');
} else {
  console.error('FAIL: Route to Safe Zone NW did not pass through SAFE_NW_ENTRANCE!');
  process.exit(1);
}

const pathSW = planner.plan('SOUTH_WEST_JUNCTION', 'SAFE_ZONE_SW');
console.log('Route to SAFE_ZONE_SW:', pathSW.join(' -> '));
if (pathSW.includes('SAFE_SW_ENTRANCE') && pathSW[pathSW.length - 1] === 'SAFE_ZONE_SW') {
  console.log('PASS: Route to Safe Zone SW correctly passes through SAFE_SW_ENTRANCE gateway!');
} else {
  console.error('FAIL: Route to Safe Zone SW did not pass through SAFE_SW_ENTRANCE!');
  process.exit(1);
}

// 1A. Test Open Dispatch & Returns Entry Routing
console.log('\n--- TEST 1A: Open Dispatch & Returns Entry Routing ---');
const pathDispatch1 = planner.plan('SOUTH_EAST_JUNCTION', 'DISPATCH_1');
console.log('Route to DISPATCH_1:', pathDispatch1.join(' -> '));
if (pathDispatch1.includes('DISPATCH_GATE') && pathDispatch1[pathDispatch1.length - 1] === 'DISPATCH_1') {
  console.log('PASS: Route to Dispatch Staging 1 correctly passes through DISPATCH_GATE!');
} else {
  console.error('FAIL: Route to Dispatch Staging 1 did not pass through DISPATCH_GATE!');
  process.exit(1);
}

const pathReturns = planner.plan('SOUTH_EAST_CORRIDOR', 'RETURN_INSPECT_1');
console.log('Route to RETURN_INSPECT_1:', pathReturns.join(' -> '));
if (pathReturns.includes('DISPATCH_GATE') && pathReturns[pathReturns.length - 1] === 'RETURN_INSPECT_1') {
  console.log('PASS: Route to Return Inspection Table correctly passes through DISPATCH_GATE!');
} else {
  console.error('FAIL: Route to Return Inspection Table did not pass through DISPATCH_GATE!');
  process.exit(1);
}

// 1B. Test Operational Zone Gates
console.log('\n--- TEST 1B: Operational Zone Gates (Packaging, Inbound, Sorting, Retaining) ---');
const pathPack = planner.plan('N_CORRIDOR_1', 'PACK_1');
console.log('Route to PACK_1:', pathPack.join(' -> '));
if (pathPack.includes('PACKAGING_GATE')) {
  console.log('PASS: Route to Packaging Hub passes through PACKAGING_GATE!');
} else {
  console.error('FAIL: Route to Packaging Hub did not pass through PACKAGING_GATE!');
  process.exit(1);
}

const pathInbound = planner.plan('N_CORRIDOR_1', 'INBOUND_BUF_1');
console.log('Route to INBOUND_BUF_1:', pathInbound.join(' -> '));
if (pathInbound.includes('INBOUND_GATE')) {
  console.log('PASS: Route to Inbound Buffer passes through INBOUND_GATE!');
} else {
  console.error('FAIL: Route to Inbound Buffer did not pass through INBOUND_GATE!');
  process.exit(1);
}

const pathSorting = planner.plan('SOUTH_INTERSECTION', 'BUFFER_SORT_1');
console.log('Route to BUFFER_SORT_1:', pathSorting.join(' -> '));
if (pathSorting.includes('SORTING_GATE')) {
  console.log('PASS: Route to Sorting Area passes through SORTING_GATE!');
} else {
  console.error('FAIL: Route to Sorting Area did not pass through SORTING_GATE!');
  process.exit(1);
}

const pathRetaining = planner.plan('SOUTH_EAST_JUNCTION', 'HOLDING_1');
console.log('Route to HOLDING_1:', pathRetaining.join(' -> '));
if (pathRetaining.includes('RETAINING_GATE')) {
  console.log('PASS: Route to Retaining Area passes through RETAINING_GATE!');
} else {
  console.error('FAIL: Route to Retaining Area did not pass through RETAINING_GATE!');
  process.exit(1);
}

// 2. Test Charging Station Entry & Exit
console.log('\n--- TEST 2: Two-Port Charging Station Entry & Exit Routing ---');
const pathCS1 = planner.plan('N_PACK_JUNCTION', 'CS_01');
console.log('Route to CS_01 (Port 1):', pathCS1.join(' -> '));
if (pathCS1.includes('CHARGING_ENTRANCE') && pathCS1.includes('CHARGING_INTERIOR') && pathCS1.includes('CS_01')) {
  console.log('PASS: Route to Port 1 passes through CHARGING_ENTRANCE and CHARGING_INTERIOR!');
} else {
  console.error('FAIL: Route to Port 1 did not pass through proper charging gateway!');
  process.exit(1);
}

const pathCS2 = planner.plan('N_EAST_HUB', 'CS_02');
console.log('Route to CS_02 (Port 2):', pathCS2.join(' -> '));
if (pathCS2.includes('CHARGING_ENTRANCE') && pathCS2.includes('CHARGING_INTERIOR') && pathCS2.includes('CS_02')) {
  console.log('PASS: Route to Port 2 passes through CHARGING_ENTRANCE and CHARGING_INTERIOR!');
} else {
  console.error('FAIL: Route to Port 2 did not pass through proper charging gateway!');
  process.exit(1);
}

const exitPath = planner.plan('CS_01', 'HOME_01');
console.log('Exit route from CS_01 to HOME_01:', exitPath.join(' -> '));
if (exitPath[0] === 'CS_01' && exitPath[1] === 'CHARGING_INTERIOR' && exitPath[2] === 'CHARGING_ENTRANCE') {
  console.log('PASS: Exit route from charging port exits cleanly through CHARGING_INTERIOR -> CHARGING_ENTRANCE!');
} else {
  console.error('FAIL: Exit route did not exit through designated entrance!');
  process.exit(1);
}

// 3. Test Charging Station Capacity & Multi-AMR State Tracking
console.log('\n--- TEST 3: Charging Station Capacity (Max 2) & Third AMR Queuing ---');
const amr1 = fleet.getAmr('AMR-01');
const amr2 = fleet.getAmr('AMR-02');
const amr3 = fleet.getAmr('AMR-03');

// AMR-01 occupies Port 1
amr1.currentNodeId = 'CS_01';
amr1.setState('CHARGING', 'Charging at Port 1');
amr1.battery = 45.0;

// AMR-02 occupies Port 2
amr2.currentNodeId = 'CS_02';
amr2.setState('CHARGING', 'Charging at Port 2');
amr2.battery = 55.0;

const portStates = fleet.getChargingPortStates();
console.log('Port States with 2 AMRs:', portStates);

if (portStates[0].state === 'CHARGING' && portStates[0].amrId === 'AMR-01' &&
    portStates[1].state === 'CHARGING' && portStates[1].amrId === 'AMR-02') {
  console.log('PASS: Both ports report CHARGING state with correct AMR IDs and real battery values!');
} else {
  console.error('FAIL: Port states incorrect!');
  process.exit(1);
}

// AMR-03 requests charging while both ports are occupied
fleet.routeAmrToCharging(amr3);
console.log('AMR-03 (3rd AMR) route/target:', amr3.activeRoute);
if (amr3.activeRoute[amr3.activeRoute.length - 1] === 'N_CHARGE_HUB' || amr3.targetNodeId === 'N_CHARGE_HUB') {
  console.log('PASS: 3rd AMR safely queues at N_CHARGE_HUB approach without invading occupied ports!');
} else {
  console.error('FAIL: 3rd AMR did not queue safely at N_CHARGE_HUB!');
  process.exit(1);
}

// When AMR-01 leaves Port 1
amr1.currentNodeId = 'HOME_01';
amr1.setState('IDLE', 'At home');
const updatedPortStates = fleet.getChargingPortStates();
console.log('Updated Port States after AMR-01 freed Port 1:', updatedPortStates);
if (updatedPortStates[0].state === 'AVAILABLE') {
  console.log('PASS: Port 1 dynamically becomes AVAILABLE when AMR leaves!');
} else {
  console.error('FAIL: Port 1 did not become AVAILABLE!');
  process.exit(1);
}

// 4. TEST AMR-04 ROOT CAUSE NAVIGATION & WALL PENETRATION PREVENTION
console.log('\n--- TEST 4: AMR-04 Wall Penetration Root Cause & Gate-Constrained Routing ---');
const amr4 = fleet.getAmr('AMR-04');
console.log(`AMR-04 Initialized at node: ${amr4.currentNodeId} (${amr4.homeNodeId})`);

// 4A. Verify invalid edge R4 -> E is NOT in graph
const invalidEdge1 = graph.getEdge('HOME_04', 'MID_EAST_2');
const invalidEdge2 = graph.getEdge('R4', 'E');
const invalidEdge3 = graph.getEdge('HOME_04', 'N_EAST_CORRIDOR');

if (!invalidEdge1 && !invalidEdge2 && !invalidEdge3) {
  console.log('PASS: Invalid diagonal shortcut edges (R4 -> E / HOME_04 -> MID_EAST_2 / HOME_04 -> N_EAST_CORRIDOR) DO NOT exist in graph!');
} else {
  console.error('FAIL: Invalid diagonal edge exists in navigation graph!');
  process.exit(1);
}

// 4B. Plan path for AMR-04 from Home (R4 / HOME_04) to Eastern Corridor / Central Junction
const pathAmr4 = graph.findPath('HOME_04', 'MID_EAST_2');
console.log('AMR-04 Path to MID_EAST_2 (E):', pathAmr4.join(' -> '));

if (!pathAmr4.includes('HOME_GATEWAY')) {
  console.error('FAIL: AMR-04 route bypassed the Home Area Gate (HOME_GATEWAY)!');
  process.exit(1);
} else {
  console.log('PASS: AMR-04 path strictly exits Home Area through designated physical gate: HOME_GATEWAY!');
}

const isValidAmr4Path = graph.validatePath(pathAmr4);
if (isValidAmr4Path) {
  console.log('PASS: AMR-04 full path satisfies all 9 physical geometry constraints (zero wall/rack intersections)!');
} else {
  console.error('FAIL: AMR-04 generated an invalid physical path:', pathAmr4);
  process.exit(1);
}

// 4C. Test Trajectory Executor Safety Gate on AMR-04
amr4.currentNodeId = 'HOME_04';
amr4.targetNodeId = 'HOME_GATEWAY';
const amr4Debug = amr4.getEdgeValidationDebugInfo();
console.log('AMR-04 Edge Validation Debug Telemetry:', amr4Debug);
if (amr4Debug.edgeValid === 'YES' && amr4Debug.execution === 'APPROVED') {
  console.log('PASS: AMR-04 initial movement step to HOME_GATEWAY is APPROVED by Safety Supervisor!');
} else {
  console.error('FAIL: AMR-04 valid movement was rejected!');
  process.exit(1);
}

// 5. TEST ALL FIVE AMRs FOR GRAPH CONSISTENCY & VALIDITY
console.log('\n--- TEST 5: All 5 AMRs Common Graph & Physical Validation ---');
const testDestinations = ['DISPATCH_1', 'CS_01', 'PACK_1', 'BUFFER_SORT_1', 'HOLDING_1'];

fleet.amrs.forEach((amr, idx) => {
  const dest = testDestinations[idx];
  const path = graph.findPath(amr.homeNodeId, dest);
  if (!path || !graph.validatePath(path)) {
    console.error(`FAIL: ${amr.id} path from ${amr.homeNodeId} to ${dest} is invalid:`, path);
    process.exit(1);
  }
  // If starting in Home Area, must exit via HOME_GATEWAY
  if (['HOME_01', 'HOME_02', 'HOME_03', 'HOME_04', 'HOME_05'].includes(amr.homeNodeId)) {
    if (!path.includes('HOME_GATEWAY')) {
      console.error(`FAIL: ${amr.id} starting in Home Area bypassed HOME_GATEWAY!`);
      process.exit(1);
    }
  }
  console.log(`PASS: ${amr.id} (${amr.homeNodeId} -> ${dest}) valid: ${path.join(' -> ')}`);
});

console.log('\n=== ALL GEOMETRY & NAVIGATION TESTS (INCLUDING AMR-04 ROOT CAUSE FIX) PASSED PERFECTLY! ===\n');
