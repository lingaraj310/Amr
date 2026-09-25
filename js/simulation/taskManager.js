/**
 * EdgeFleet - Task Manager
 * Manages task lifecycles, manual task injection, CSV batch uploads, and fleet allocation cycles.
 */

import { logger } from '../communication/eventLogger.js';

export class TaskManager {
  constructor(navGraph) {
    this.graph = navGraph;
    this.tasks = []; // Array of Task objects
    this.taskCounter = 1;
    this.biddingEngine = null; // Injected on init
    this.fleetManager = null; // Injected on init
  }

  createTask(sourceNodeId, destNodeId, options = {}) {
    const taskId = options.id || `TSK-${String(this.taskCounter++).padStart(3, '0')}`;
    const priority = options.priority !== undefined ? Number(options.priority) : 50; // 0-100
    const taskType = options.taskType || 'Box Transport';
    const deadlineSeconds = options.deadlineSeconds || 120; // 2 minutes default

    let box = null;
    let payloadWeight = options.payloadWeight !== undefined ? Number(options.payloadWeight) : 150;

    // Check if a specific box was selected
    if (options.boxId && this.fleetManager && this.fleetManager.boxManager) {
      box = this.fleetManager.boxManager.getBox(options.boxId);
      if (box) {
        payloadWeight = box.weight;
        sourceNodeId = box.nodeId || sourceNodeId;
      }
    } else if (this.fleetManager && this.fleetManager.boxManager) {
      // Auto-assign available box at source if not specified
      box = this.fleetManager.boxManager.getAvailableBoxes().find(b => b.nodeId === sourceNodeId) || this.fleetManager.boxManager.getAvailableBoxes()[0];
      if (box) {
        payloadWeight = box.weight;
        sourceNodeId = box.nodeId;
      }
    }

    const task = {
      id: taskId,
      boxId: box ? box.id : (options.boxId || null),
      box: box || null,
      sourceNodeId,
      destNodeId,
      priority,
      payloadWeight,
      taskType,
      deadlineSeconds,
      createdAt: new Date().toISOString(),
      status: 'PENDING', // PENDING, BIDDING, ASSIGNED, IN_PROGRESS, COMPLETED, REASSIGNED, EXCEPTION, CANCELLED
      assignedAmrId: null,
      winningBidScore: null,
      bidDetails: [],
      decisionTrace: [],
      completedAt: null
    };

    if (box) {
      box.reserve(task.id, destNodeId);
      logger.log('TASK', 'OPERATOR', `BOX_SELECTED: ${box.id} (${box.weight}kg) assigned to Task #${taskId} at ${sourceNodeId}.`, { taskId, boxId: box.id }, 'MQTT', 'info');
      logger.recordTimeline('Box Selected', `${box.id} (${box.weight}kg) assigned to Task #${taskId}`, 'info');
    }

    this.tasks.unshift(task);

    logger.log('TASK', 'OPERATOR',
      `TASK_CREATED: New Task #${taskId} created: [Box: ${task.boxId || 'N/A'}] ${sourceNodeId} → ${destNodeId} (Priority: ${priority}, Payload: ${payloadWeight}kg)`,
      { taskId, boxId: task.boxId, source: sourceNodeId, dest: destNodeId, priority, payloadWeight },
      'MQTT', 'info'
    );
    logger.recordTimeline('Task Created', `Task #${taskId} (${task.boxId || 'N/A'}: ${sourceNodeId} → ${destNodeId}, Priority: ${priority})`, 'info');

    // Trigger allocation cycle
    if (this.biddingEngine && this.fleetManager) {
      setTimeout(() => this.biddingEngine.conductAuction(task, this.fleetManager.amrs), 100);
    }

    return task;
  }

  /**
   * Parse CSV content and batch create tasks
   */
  importCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length <= 1) return { success: false, count: 0, error: 'Empty or invalid CSV' };

    let createdCount = 0;
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',').map(c => c.trim());
      if (row.length < 2 || !row[0]) continue;

      const taskData = {};
      header.forEach((h, idx) => {
        taskData[h] = row[idx];
      });

      const src = taskData['source'] || taskData['sourcenodeid'] || 'DOCK_IN_1';
      const dst = taskData['destination'] || taskData['destnodeid'] || 'BUFFER_SORT_1';
      const prio = taskData['priority'] ? Number(taskData['priority']) : 50;
      const weight = taskData['payload'] || taskData['payloadweight'] ? Number(taskData['payload'] || taskData['payloadweight']) : 120;
      const type = taskData['type'] || taskData['tasktype'] || 'Pallet Transport';
      const deadline = taskData['deadline'] ? Number(taskData['deadline']) : 180;

      this.createTask(src, dst, {
        priority: prio,
        payloadWeight: weight,
        taskType: type,
        deadlineSeconds: deadline
      });
      createdCount++;
    }

    logger.log('TASK', 'OPERATOR', `Imported ${createdCount} tasks from CSV file batch.`, { count: createdCount }, 'SYSTEM', 'success');
    return { success: true, count: createdCount };
  }

  getTasks() {
    return this.tasks;
  }

  getPendingTasks() {
    return this.tasks.filter(t => t.status === 'PENDING');
  }

  getActiveTasks() {
    return this.tasks.filter(t => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' || t.status === 'BIDDING');
  }

  getCompletedTasks() {
    return this.tasks.filter(t => t.status === 'COMPLETED');
  }
}
