/**
 * EdgeFleet - Physical Box & Rack Inventory Manager
 * Manages physical 3D box inventory stored ON RACK SHELVES, weights, statuses, and life-cycle events.
 * Racks are the physical obstacles; boxes are inventory items stored on shelves.
 */

import { logger } from '../communication/eventLogger.js';

// Coordinate conversion helpers matching reference warehouse
const S = 0.1;
const X = (px) => (px - 497) * S;
const Z = (pz) => (pz - 297) * S;

export class Box {
  constructor(id, options = {}) {
    this.id = id;
    this.name = options.name || `Cargo ${id}`;
    this.rackId = options.rackId || 'RACK-A1';
    this.shelfLevel = options.shelfLevel !== undefined ? options.shelfLevel : 1;
    this.slotIndex = options.slotIndex !== undefined ? options.slotIndex : 1;
    this.nodeId = options.nodeId || options.pickupNodeId || 'AISLE_A_MID';
    this.pickupNodeId = this.nodeId;
    this.weight = options.weight !== undefined ? Number(options.weight) : 150; // kg
    
    // Status: AVAILABLE, RESERVED, BEING_PICKED, IN_TRANSIT, DELIVERED, EXCEPTION
    this.status = options.status || 'AVAILABLE';
    
    this.assignedTaskId = null;
    this.carriedBy = null; // AMR ID if in transit
    this.destinationNodeId = null;
    this.exceptionReason = null;
    
    // Default initial world shelf position
    this.shelfPosition = {
      x: options.x !== undefined ? options.x : 0,
      y: options.y !== undefined ? options.y : 0.38,
      z: options.z !== undefined ? options.z : 0
    };

    // Current real-time 3D world position
    this.position = { ...this.shelfPosition };
    this.liftOffsetY = 0; // vertical lift animation offset
    
    // Reference to Three.js Group in scene
    this.mesh3d = null;
  }

  get currentNodeId() { return this.nodeId; }
  set currentNodeId(val) { this.nodeId = val; }
  get pickupLocation() { return this.nodeId; }
  get destination() { return this.destinationNodeId; }
  get assignedTask() { return this.assignedTaskId; }

  isAvailable() {
    return this.status === 'AVAILABLE';
  }

  reserve(taskId, destNodeId) {
    if (this.status !== 'EXCEPTION') {
      this.status = 'RESERVED';
      this.exceptionReason = null;
    }
    this.assignedTaskId = taskId;
    this.destinationNodeId = destNodeId;
  }

  startPicking(amrId) {
    this.status = 'BEING_PICKED';
    this.carriedBy = amrId;
  }

  attachToAmr(amrId) {
    this.status = 'IN_TRANSIT';
    this.carriedBy = amrId;
  }

  deliverAt(destNodeId, worldX, worldZ) {
    this.status = 'DELIVERED';
    this.nodeId = destNodeId;
    this.carriedBy = null;
    this.position.x = worldX;
    this.position.y = 0.08; // Placed at floor height at destination
    this.position.z = worldZ;
    this.liftOffsetY = 0;
  }

  markException(reason) {
    this.status = 'EXCEPTION';
    this.exceptionReason = reason;
    this.carriedBy = null;
  }

  release() {
    this.status = 'AVAILABLE';
    this.assignedTaskId = null;
    this.carriedBy = null;
    this.destinationNodeId = null;
    this.exceptionReason = null;
    this.position = { ...this.shelfPosition };
  }
}

export class BoxManager {
  constructor(navGraph) {
    this.graph = navGraph;
    this.boxes = [];
    this.initBoxes();
  }

  initBoxes() {
    // Definitive Rack Inventory definitions:
    // Positions correspond to exact physical rack shelf bays in 3D space across all 15 racks (North and South)
    const initialBoxConfigs = [
      // === NORTH BLOCK RACKS (Aisles A, B, C, D) ===
      // RACK A1 (West of Aisle A, North Block)
      { id: 'BOX-A1-01', name: 'Standard Carton A1-1', rackId: 'RACK-A1', shelfLevel: 1, slotIndex: 1, px: 259, pz: 165, y: 0.38, nodeId: 'AISLE_A_N', weight: 100 },
      { id: 'BOX-A1-02', name: 'Precision Assembly A1-2', rackId: 'RACK-A1', shelfLevel: 1, slotIndex: 2, px: 259, pz: 235, y: 0.38, nodeId: 'AISLE_A_N', weight: 150 },
      { id: 'BOX-A1-03', name: 'Industrial Motors A1-3', rackId: 'RACK-A1', shelfLevel: 2, slotIndex: 1, px: 259, pz: 165, y: 1.28, nodeId: 'AISLE_A_MID', weight: 220 },
      { id: 'BOX-A1-04', name: 'Alloy Components A1-4', rackId: 'RACK-A1', shelfLevel: 2, slotIndex: 2, px: 259, pz: 235, y: 1.28, nodeId: 'AISLE_A_MID', weight: 320 },

      // RACK A2 (East of Aisle A, North Block)
      { id: 'BOX-A2-01', name: 'Electronic Sensors A2-1', rackId: 'RACK-A2', shelfLevel: 1, slotIndex: 1, px: 329, pz: 165, y: 0.38, nodeId: 'AISLE_A_N', weight: 120 },
      { id: 'BOX-A2-02', name: 'Fiber Optics Kit A2-2', rackId: 'RACK-A2', shelfLevel: 1, slotIndex: 2, px: 329, pz: 235, y: 0.38, nodeId: 'AISLE_A_N', weight: 180 },
      { id: 'BOX-A2-03', name: 'Power Supply Unit A2-3', rackId: 'RACK-A2', shelfLevel: 2, slotIndex: 1, px: 329, pz: 165, y: 1.28, nodeId: 'AISLE_A_MID', weight: 200 },
      { id: 'BOX-A2-07', name: 'High-Torque Actuators A2-7', rackId: 'RACK-A2', shelfLevel: 2, slotIndex: 2, px: 329, pz: 235, y: 1.28, nodeId: 'AISLE_A_MID', weight: 250 },

      // RACK B1 (West of Aisle B, North Block)
      { id: 'BOX-B1-01', name: 'Bearing Kits B1-1', rackId: 'RACK-B1', shelfLevel: 1, slotIndex: 1, px: 422, pz: 165, y: 0.38, nodeId: 'AISLE_B_N', weight: 160 },
      { id: 'BOX-B1-02', name: 'Robotic Grippers B1-2', rackId: 'RACK-B1', shelfLevel: 1, slotIndex: 2, px: 422, pz: 235, y: 0.38, nodeId: 'AISLE_B_N', weight: 280 },
      { id: 'BOX-B1-03', name: 'Pneumatic Valves B1-3', rackId: 'RACK-B1', shelfLevel: 2, slotIndex: 1, px: 422, pz: 165, y: 1.28, nodeId: 'AISLE_B_MID', weight: 150 },
      { id: 'BOX-B1-04', name: 'Pressure Regulators B1-4', rackId: 'RACK-B1', shelfLevel: 2, slotIndex: 2, px: 422, pz: 235, y: 1.28, nodeId: 'AISLE_B_MID', weight: 190 },

      // RACK B2 (East of Aisle B, North Block)
      { id: 'BOX-B2-01', name: 'Thermal Heatsinks B2-1', rackId: 'RACK-B2', shelfLevel: 1, slotIndex: 1, px: 491, pz: 165, y: 0.38, nodeId: 'AISLE_B_N', weight: 210 },
      { id: 'BOX-B2-02', name: 'Hydraulic Cylinders B2-2', rackId: 'RACK-B2', shelfLevel: 2, slotIndex: 1, px: 491, pz: 235, y: 1.28, nodeId: 'AISLE_B_MID', weight: 350 },
      { id: 'BOX-B2-03', name: 'Pump Assemblies B2-3', rackId: 'RACK-B2', shelfLevel: 1, slotIndex: 2, px: 491, pz: 200, y: 0.38, nodeId: 'AISLE_B_N', weight: 175 },

      // RACK C1 (West of Aisle C, North Block)
      { id: 'BOX-C1-01', name: 'Microcontroller Units C1-1', rackId: 'RACK-C1', shelfLevel: 1, slotIndex: 1, px: 582, pz: 165, y: 0.38, nodeId: 'AISLE_C_N', weight: 140 },
      { id: 'BOX-C1-02', name: 'Transformer Cores C1-2', rackId: 'RACK-C1', shelfLevel: 2, slotIndex: 1, px: 582, pz: 235, y: 1.28, nodeId: 'AISLE_C_MID', weight: 300 },
      { id: 'BOX-C1-03', name: 'PLC Controllers C1-3', rackId: 'RACK-C1', shelfLevel: 1, slotIndex: 2, px: 582, pz: 200, y: 0.38, nodeId: 'AISLE_C_N', weight: 160 },

      // RACK C2 (East of Aisle C, North Block)
      { id: 'BOX-C2-01', name: 'Servo Controllers C2-1', rackId: 'RACK-C2', shelfLevel: 1, slotIndex: 1, px: 662, pz: 165, y: 0.38, nodeId: 'AISLE_C_N', weight: 175 },
      { id: 'BOX-C2-02', name: 'Heavy Engine Block C2-2', rackId: 'RACK-C2', shelfLevel: 2, slotIndex: 1, px: 662, pz: 235, y: 1.28, nodeId: 'AISLE_C_MID', weight: 450 },
      { id: 'BOX-C2-03', name: 'Drive Shafts C2-3', rackId: 'RACK-C2', shelfLevel: 1, slotIndex: 2, px: 662, pz: 200, y: 0.38, nodeId: 'AISLE_C_N', weight: 220 },

      // RACK D1 (West of Aisle D, North Block)
      { id: 'BOX-D1-01', name: 'Optical Scanners D1-1', rackId: 'RACK-D1', shelfLevel: 1, slotIndex: 1, px: 776, pz: 165, y: 0.38, nodeId: 'AISLE_D_N', weight: 110 },
      { id: 'BOX-D1-02', name: 'Capacitor Banks D1-2', rackId: 'RACK-D1', shelfLevel: 2, slotIndex: 1, px: 776, pz: 235, y: 1.28, nodeId: 'AISLE_D_MID', weight: 240 },
      { id: 'BOX-D1-03', name: 'Relay Modules D1-3', rackId: 'RACK-D1', shelfLevel: 1, slotIndex: 2, px: 776, pz: 200, y: 0.38, nodeId: 'AISLE_D_N', weight: 130 },

      // RACK D2 (East of Aisle D, North Block)
      { id: 'BOX-D2-01', name: 'Inverter Modules D2-1', rackId: 'RACK-D2', shelfLevel: 1, slotIndex: 1, px: 847, pz: 165, y: 0.38, nodeId: 'AISLE_D_N', weight: 190 },
      { id: 'BOX-D2-02', name: 'Battery Cells Pallet D2-2', rackId: 'RACK-D2', shelfLevel: 2, slotIndex: 1, px: 847, pz: 235, y: 1.28, nodeId: 'AISLE_D_MID', weight: 320 },
      { id: 'BOX-D2-03', name: 'Cooling Fans D2-3', rackId: 'RACK-D2', shelfLevel: 1, slotIndex: 2, px: 847, pz: 200, y: 0.38, nodeId: 'AISLE_D_N', weight: 95 },

      // === SOUTH BLOCK RACKS (Bottom Half Racks) ===
      // RACK SA1 (West of Aisle A South)
      { id: 'BOX-SA1-01', name: 'Fastener Packs SA1-1', rackId: 'RACK-SA1', shelfLevel: 1, slotIndex: 1, px: 257, pz: 355, y: 0.38, nodeId: 'AISLE_A_MID', weight: 110 },
      { id: 'BOX-SA1-02', name: 'Structural Angles SA1-2', rackId: 'RACK-SA1', shelfLevel: 2, slotIndex: 1, px: 257, pz: 355, y: 1.28, nodeId: 'AISLE_A_MID', weight: 260 },
      { id: 'BOX-SA1-03', name: 'Gasket Sets SA1-3', rackId: 'RACK-SA1', shelfLevel: 1, slotIndex: 2, px: 257, pz: 415, y: 0.38, nodeId: 'AISLE_A_S', weight: 90 },
      { id: 'BOX-SA1-04', name: 'Heavy Flanges SA1-4', rackId: 'RACK-SA1', shelfLevel: 2, slotIndex: 2, px: 257, pz: 415, y: 1.28, nodeId: 'AISLE_A_S', weight: 340 },

      // RACK SA2 (East of Aisle A South)
      { id: 'BOX-SA2-01', name: 'Linear Bearings SA2-1', rackId: 'RACK-SA2', shelfLevel: 1, slotIndex: 1, px: 330, pz: 355, y: 0.38, nodeId: 'AISLE_A_MID', weight: 130 },
      { id: 'BOX-SA2-02', name: 'Pneumatic Tubing SA2-2', rackId: 'RACK-SA2', shelfLevel: 1, slotIndex: 2, px: 330, pz: 415, y: 0.38, nodeId: 'AISLE_A_S', weight: 85 },
      { id: 'BOX-SA2-03', name: 'Servo Drives SA2-3', rackId: 'RACK-SA2', shelfLevel: 2, slotIndex: 1, px: 330, pz: 385, y: 1.28, nodeId: 'AISLE_A_S', weight: 210 },

      // RACK SB1 (East of Aisle B South)
      { id: 'BOX-SB1-01', name: 'Control Panels SB1-1', rackId: 'RACK-SB1', shelfLevel: 1, slotIndex: 1, px: 491, pz: 355, y: 0.38, nodeId: 'AISLE_B_MID', weight: 175 },
      { id: 'BOX-SB1-02', name: 'HMI Displays SB1-2', rackId: 'RACK-SB1', shelfLevel: 2, slotIndex: 1, px: 491, pz: 375, y: 1.28, nodeId: 'AISLE_B_S', weight: 140 },

      // RACK SC1 (West of Aisle C South)
      { id: 'BOX-SC1-01', name: 'Conveyor Rollers SC1-1', rackId: 'RACK-SC1', shelfLevel: 1, slotIndex: 1, px: 582, pz: 355, y: 0.38, nodeId: 'AISLE_C_MID', weight: 200 },
      { id: 'BOX-SC1-02', name: 'VFD Modules SC1-2', rackId: 'RACK-SC1', shelfLevel: 2, slotIndex: 1, px: 582, pz: 355, y: 1.28, nodeId: 'AISLE_C_MID', weight: 280 },
      { id: 'BOX-SC1-03', name: 'Drive Belts SC1-3', rackId: 'RACK-SC1', shelfLevel: 1, slotIndex: 2, px: 582, pz: 415, y: 0.38, nodeId: 'AISLE_C_S', weight: 95 },

      // RACK SC2 (East of Aisle C South)
      { id: 'BOX-SC2-01', name: 'Circuit Breakers SC2-1', rackId: 'RACK-SC2', shelfLevel: 1, slotIndex: 1, px: 662, pz: 355, y: 0.38, nodeId: 'AISLE_C_MID', weight: 160 },
      { id: 'BOX-SC2-02', name: 'Transformer Units SC2-2', rackId: 'RACK-SC2', shelfLevel: 2, slotIndex: 1, px: 662, pz: 415, y: 1.28, nodeId: 'AISLE_C_S', weight: 380 },

      // RACK SD1 (West of Aisle D South)
      { id: 'BOX-SD1-01', name: 'Limit Switches SD1-1', rackId: 'RACK-SD1', shelfLevel: 1, slotIndex: 1, px: 800, pz: 355, y: 0.38, nodeId: 'AISLE_D_MID', weight: 75 },
      { id: 'BOX-SD1-02', name: 'Signal Isolators SD1-2', rackId: 'RACK-SD1', shelfLevel: 2, slotIndex: 1, px: 800, pz: 365, y: 1.28, nodeId: 'AISLE_D_S', weight: 120 },

      // RACK SD2 (East of Aisle D South)
      { id: 'BOX-SD2-01', name: 'Encoder Discs SD2-1', rackId: 'RACK-SD2', shelfLevel: 1, slotIndex: 1, px: 871, pz: 355, y: 0.38, nodeId: 'AISLE_D_MID', weight: 65 },
      { id: 'BOX-SD2-02', name: 'Power Busbars SD2-2', rackId: 'RACK-SD2', shelfLevel: 2, slotIndex: 1, px: 871, pz: 365, y: 1.28, nodeId: 'AISLE_D_S', weight: 290 }
    ];

    this.boxes = initialBoxConfigs.map(cfg => {
      const worldX = X(cfg.px);
      const worldZ = Z(cfg.pz);
      const box = new Box(cfg.id, {
        name: cfg.name,
        rackId: cfg.rackId,
        shelfLevel: cfg.shelfLevel,
        slotIndex: cfg.slotIndex,
        nodeId: cfg.nodeId,
        pickupNodeId: cfg.nodeId,
        weight: cfg.weight,
        x: worldX,
        y: cfg.y,
        z: worldZ,
        status: 'AVAILABLE'
      });
      return box;
    });

    logger.log('MATERIAL_HANDLING', 'BOX_MANAGER', `Initialized ${this.boxes.length} physical box inventory items on warehouse rack shelves.`, { count: this.boxes.length }, 'SYSTEM', 'info');
  }

  getBoxes() {
    return this.boxes;
  }

  getAvailableBoxes() {
    return this.boxes.filter(b => b.isAvailable());
  }

  getBox(id) {
    return this.boxes.find(b => b.id === id);
  }

  getBoxAtNode(nodeId) {
    return this.boxes.find(b => b.nodeId === nodeId && b.status !== 'IN_TRANSIT');
  }

  reserveBoxForTask(boxId, taskId, destNodeId) {
    const box = this.getBox(boxId);
    if (!box) {
      return { success: false, reason: `Box ${boxId} not found in inventory.` };
    }
    if (!box.isAvailable()) {
      return { success: false, reason: `Box ${boxId} is currently ${box.status}.` };
    }
    box.reserve(taskId, destNodeId);
    logger.log('TASK', 'BOX_MANAGER', `Box ${box.id} (${box.weight}kg, ${box.rackId} Shelf ${box.shelfLevel}) reserved for Task #${taskId}`, { boxId: box.id, taskId, weight: box.weight }, 'MQTT', 'info');
    return { success: true, box };
  }

  getMetrics() {
    let available = 0;
    let reserved = 0;
    let inTransit = 0;
    let delivered = 0;
    let exceptions = 0;
    let totalDeliveredPayloadKg = 0;
    let totalTransportedPayloadKg = 0;

    this.boxes.forEach(b => {
      if (b.status === 'AVAILABLE') available++;
      else if (b.status === 'RESERVED') reserved++;
      else if (b.status === 'IN_TRANSIT' || b.status === 'BEING_PICKED') {
        inTransit++;
        totalTransportedPayloadKg += b.weight;
      } else if (b.status === 'DELIVERED') {
        delivered++;
        totalDeliveredPayloadKg += b.weight;
      } else if (b.status === 'EXCEPTION') {
        exceptions++;
      }
    });

    return {
      totalBoxes: this.boxes.length,
      available,
      reserved,
      inTransit,
      delivered,
      exceptions,
      totalDeliveredPayloadKg,
      totalTransportedPayloadKg
    };
  }

  reset() {
    this.boxes.forEach(b => {
      b.release();
    });
    this.initBoxes();
  }
}
