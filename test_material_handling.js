// Comprehensive End-to-end verification of Rack Inventory + Real Box Pickup System
import { FleetManager } from './js/simulation/fleetManager.js';

async function run() {
  console.log('Initializing FleetManager for Rack Inventory & Material Handling verification...');
  const fleet = new FleetManager();

  // 1. Initial State & Rack Inventory Checks
  console.log('\n--- TEST 1: Initial AMR & Rack Inventory State ---');
  console.log(`AMRs initialized: ${fleet.amrs.length}`);
  fleet.amrs.forEach(a => {
    console.log(`AMR ${a.id}: state=${a.state}, isHome=${a.isHome}, pos=(${a.position.x}, ${a.position.z}), payloadCap=${a.payloadCapacity}kg`);
    if (!a.isHome || a.state !== 'IDLE') {
      throw new Error(`AMR ${a.id} is not properly in HOME initial state`);
    }
  });

  console.log(`Rack Boxes initialized: ${fleet.boxManager.boxes.length}`);
  fleet.boxManager.boxes.forEach(b => {
    console.log(`Box ${b.id}: Rack=${b.rackId}, Shelf=${b.shelfLevel}, Slot=${b.slotIndex}, Weight=${b.weight}kg, PickupNode=${b.nodeId}, Status=${b.status}`);
    if (b.status !== 'AVAILABLE') {
      throw new Error(`Box ${b.id} is not AVAILABLE`);
    }
    if (!b.rackId || !b.shelfPosition) {
      throw new Error(`Box ${b.id} is missing rack or shelf position`);
    }
  });

  // 2. Specific Box Selection: BOX-A2-07 (250 kg @ RACK-A2, Shelf 2)
  console.log('\n--- TEST 2: Task Creation with Specific Rack Box (BOX-A2-07) ---');
  const boxA207 = fleet.boxManager.getBox('BOX-A2-07');
  if (!boxA207) {
    throw new Error('BOX-A2-07 not found in rack inventory');
  }
  console.log(`Found BOX-A2-07: Rack=${boxA207.rackId}, Shelf=${boxA207.shelfLevel}, Weight=${boxA207.weight}kg, PickupNode=${boxA207.nodeId}`);

  const task1 = fleet.taskManager.createTask(boxA207.nodeId, 'PACK_1', {
    boxId: 'BOX-A2-07',
    priority: 85,
    payloadWeight: boxA207.weight,
    deadlineSeconds: 120
  });
  fleet.biddingEngine.conductAuction(task1, fleet.amrs);

  console.log(`Created Task ${task1.id}: Box=${task1.boxId}, Pickup=${task1.sourceNodeId}, Dst=${task1.destNodeId}, Weight=${task1.payloadWeight}kg`);
  console.log(`BOX-A2-07 status after reservation: ${boxA207.status}, AssignedTask=${boxA207.assignedTask}`);
  if (boxA207.status !== 'RESERVED') {
    throw new Error(`BOX-A2-07 should be RESERVED, got ${boxA207.status}`);
  }

  // 3. AMR Bidding & Winner Selection
  console.log('\n--- TEST 3: AMR Bidding & Payload Suitability ---');
  console.log(`Assigned AMR: ${task1.assignedAmrId}, Winning Score: ${task1.winningBidScore}`);
  const assignedAmr = fleet.getAmr(task1.assignedAmrId);
  console.log(`Assigned AMR ${assignedAmr.id}: Capacity=${assignedAmr.payloadCapacity}kg, CarriedBox=${assignedAmr.carriedBox}`);
  if (!task1.assignedAmrId) {
    throw new Error('Task was not assigned to any AMR');
  }
  if (assignedAmr.payloadCapacity < task1.payloadWeight) {
    throw new Error(`AMR ${assignedAmr.id} capacity (${assignedAmr.payloadCapacity}) is less than box weight (${task1.payloadWeight})`);
  }

  // 4. Full Physical Pickup Sequence (Aisle Navigation -> Align to Rack -> Lift -> Attach)
  console.log('\n--- TEST 4: Physical Rack Pickup & Transport to Destination ---');
  fleet.isRunning = true;
  let steps = 0;
  let pickedUp = false;
  let delivered = false;

  while (steps < 2000 && !delivered) {
    fleet.tick(0.2);
    steps++;

    if (assignedAmr.materialHandlingState === 'LIFTING_BOX' || assignedAmr.materialHandlingState === 'TRANSPORTING') {
      if (!pickedUp) {
        console.log(`[Step ${steps}] AMR ${assignedAmr.id} picked BOX-A2-07 from ${boxA207.rackId} shelf! Box Status=${boxA207.status}, CarriedBy=${boxA207.carriedBy}`);
        pickedUp = true;
      }
    }

    if (task1.status === 'COMPLETED') {
      console.log(`[Step ${steps}] Task 1 COMPLETED! BOX-A2-07 Status=${boxA207.status}, Delivered At=${boxA207.currentNodeId}`);
      delivered = true;
      break;
    }
  }

  if (!pickedUp) {
    throw new Error('AMR failed to pick up the box from the rack shelf');
  }
  if (!delivered) {
    throw new Error('AMR failed to deliver the box to destination within time limit');
  }

  if (boxA207.status !== 'DELIVERED') {
    throw new Error(`BOX-A2-07 status should be DELIVERED, got ${boxA207.status}`);
  }

  // 5. Post-Delivery 5-Second Window & Return Home
  console.log('\n--- TEST 5: 5-Second Opportunity Window & Return Home ---');
  console.log(`AMR returnHomeTimer: ${assignedAmr.returnHomeTimer.toFixed(1)}s, state: ${assignedAmr.state}`);
  for (let i = 0; i < 60; i++) {
    fleet.tick(0.2);
  }
  console.log(`After window expired: AMR state=${assignedAmr.state}, targetNodeId=${assignedAmr.targetNodeId}`);

  for (let i = 0; i < 500; i++) {
    if (assignedAmr.isHome && assignedAmr.state === 'IDLE') break;
    fleet.tick(0.2);
  }
  console.log(`AMR final state after return home: state=${assignedAmr.state}, isHome=${assignedAmr.isHome}, pos=(${assignedAmr.position.x.toFixed(2)}, ${assignedAmr.position.z.toFixed(2)})`);
  if (!assignedAmr.isHome) {
    throw new Error(`AMR ${assignedAmr.id} did not return home after 5s window`);
  }

  // 6. Heavy Payload Gating Test (Box BOX-C2-02 450kg > AMR-03 300kg Capacity)
  console.log('\n--- TEST 6: Heavy Box Gating (BOX-C2-02: 450kg) ---');
  const heavyBox = fleet.boxManager.getBox('BOX-C2-02');
  const taskHeavy = fleet.taskManager.createTask(heavyBox.nodeId, 'HOLDING_1', {
    boxId: 'BOX-C2-02',
    priority: 90,
    payloadWeight: 450
  });
  fleet.biddingEngine.conductAuction(taskHeavy, fleet.amrs);

  console.log(`Created Heavy Task ${taskHeavy.id} (450kg). Assigned AMR: ${taskHeavy.assignedAmrId}`);
  const heavyWinner = fleet.getAmr(taskHeavy.assignedAmrId);
  console.log(`Winner for heavy task: ${heavyWinner.id} with capacity ${heavyWinner.payloadCapacity}kg`);
  const amr03Bid = taskHeavy.bidDetails.find(b => b.amr.id === 'AMR-03');
  console.log(`AMR-03 (300kg) bid result: feasible=${amr03Bid.feasible}, reason=${amr03Bid.rejectionReason}`);
  if (amr03Bid.feasible) {
    throw new Error('AMR-03 (300kg) should be INELIGIBLE for 450kg box');
  }

  // Run heavy task to completion
  for (let i = 0; i < 600; i++) {
    if (taskHeavy.status === 'COMPLETED') break;
    fleet.tick(0.2);
  }
  console.log(`Heavy Task status: ${taskHeavy.status}, BOX-C2-02 status: ${heavyBox.status}`);

  // 7. Box Pickup Exception Test
  console.log('\n--- TEST 7: Box Pickup Exception Test ---');
  const boxExTarget = fleet.boxManager.getBox('BOX-A1-01');
  // Intentionally mark box in EXCEPTION
  boxExTarget.status = 'EXCEPTION';

  const taskEx = fleet.taskManager.createTask(boxExTarget.nodeId, 'PACK_2', {
    boxId: 'BOX-A1-01',
    payloadWeight: 100
  });
  fleet.biddingEngine.conductAuction(taskEx, fleet.amrs);
  const amrEx = fleet.getAmr(taskEx.assignedAmrId);
  console.log(`Task ${taskEx.id} assigned to ${amrEx.id} for missing Box-A1-01. Simulating approach...`);

  for (let i = 0; i < 1500; i++) {
    fleet.tick(0.2);
    if (i % 100 === 0) {
      console.log(`[Exception Step ${i}] ${amrEx.id}: state=${amrEx.state}, currNode=${amrEx.currentNodeId}, targetNode=${amrEx.targetNodeId}, pos=(${amrEx.position.x.toFixed(1)}, ${amrEx.position.z.toFixed(1)}), taskStatus=${taskEx.status}`);
    }
    if (taskEx.status === 'EXCEPTION') break;
  }

  console.log(`Task ${taskEx.id} status: ${taskEx.status}`);
  if (taskEx.status !== 'EXCEPTION') {
    throw new Error(`Task should have transitioned to EXCEPTION, got ${taskEx.status}`);
  }

  console.log('\n=============================================================');
  console.log('✅ ALL RACK INVENTORY & MATERIAL HANDLING TESTS PASSED 100%!');
  console.log('=============================================================\n');
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
