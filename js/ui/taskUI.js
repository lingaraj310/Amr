/**
 * EdgeFleet - Task Management & Auction UI
 * Handles manual task modal, CSV upload, task tables, and transparent bid details viewer.
 */

export class TaskUI {
  constructor(fleetManager) {
    this.fleet = fleetManager;
    this.taskManager = fleetManager.taskManager;
    this.biddingEngine = fleetManager.biddingEngine;

    this.initModalControls();
    this.initCSVUpload();
  }

  populateBoxSelect() {
    const boxSelect = document.getElementById('task-box-select');
    if (!boxSelect || !this.fleet.boxManager) return;

    const allBoxes = this.fleet.boxManager.boxes;

    let html = '<option value="">-- Select Physical Box from Rack Inventory --</option>';
    allBoxes.forEach(b => {
      const disabled = b.status !== 'AVAILABLE';
      const rackStr = b.rackId ? `${b.rackId} S${b.shelfLevel || 1}` : 'Storage';
      html += `<option value="${b.id}" ${disabled ? 'disabled' : ''}>${b.id} (${b.weight} kg) - ${rackStr} @ ${b.nodeId} [${b.status}]</option>`;
    });

    boxSelect.innerHTML = html;
    this.updateBoxMetaCard(null);
  }

  updateBoxMetaCard(box) {
    const card = document.getElementById('box-meta-card');
    const idEl = document.getElementById('box-meta-id');
    const rackEl = document.getElementById('box-meta-rack');
    const shelfEl = document.getElementById('box-meta-shelf');
    const pickupEl = document.getElementById('box-meta-pickup');
    const weightEl = document.getElementById('box-meta-weight');
    const statusEl = document.getElementById('box-meta-status');

    if (!card) return;

    if (!box) {
      if (idEl) idEl.textContent = '--';
      if (rackEl) rackEl.textContent = '--';
      if (shelfEl) shelfEl.textContent = '--';
      if (pickupEl) pickupEl.textContent = '--';
      if (weightEl) weightEl.textContent = '--';
      if (statusEl) {
        statusEl.textContent = 'None Selected';
        statusEl.style.color = 'var(--tx-muted)';
      }
      return;
    }

    if (idEl) idEl.textContent = box.id;
    if (rackEl) rackEl.textContent = box.rackId || 'General Storage';
    if (shelfEl) shelfEl.textContent = `Shelf ${box.shelfLevel || 1} (Slot ${box.slotIndex || 1})`;
    if (pickupEl) pickupEl.textContent = box.nodeId;
    if (weightEl) weightEl.textContent = `${box.weight} kg`;
    if (statusEl) {
      statusEl.textContent = box.status;
      statusEl.style.color = box.status === 'AVAILABLE' ? 'var(--status-success)' : 'var(--status-warning)';
    }
  }

  initModalControls() {
    const modal = document.getElementById('modal-create-task');
    const openBtn = document.getElementById('btn-open-create-task');
    const closeBtn = document.getElementById('btn-close-create-task');
    const submitBtn = document.getElementById('btn-submit-create-task');
    const boxSelect = document.getElementById('task-box-select');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        this.populateBoxSelect();
        modal.classList.add('open');
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        modal.classList.remove('open');
      });
    }

    if (boxSelect) {
      boxSelect.addEventListener('change', (e) => {
        const boxId = e.target.value;
        if (!boxId) {
          this.updateBoxMetaCard(null);
          return;
        }

        const box = this.fleet.boxManager.getBox(boxId);
        if (box) {
          this.updateBoxMetaCard(box);
          // Autofill source with box location
          const srcSelect = document.getElementById('task-src-select');
          if (srcSelect && box.currentNodeId) {
            srcSelect.value = box.currentNodeId;
          }
          // Autofill payload weight
          const weightInput = document.getElementById('task-payload-input');
          if (weightInput) {
            weightInput.value = box.weight;
          }
        }
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        const selectedBoxId = document.getElementById('task-box-select') ? document.getElementById('task-box-select').value : null;
        const src = document.getElementById('task-src-select').value;
        const dst = document.getElementById('task-dst-select').value;
        const prio = Number(document.getElementById('task-priority-input').value || 50);
        const weight = Number(document.getElementById('task-payload-input').value || 120);
        const type = document.getElementById('task-type-select').value;
        const deadline = Number(document.getElementById('task-deadline-input').value || 120);

        this.taskManager.createTask(src, dst, {
          boxId: selectedBoxId || undefined,
          priority: prio,
          payloadWeight: weight,
          taskType: type,
          deadlineSeconds: deadline
        });

        modal.classList.remove('open');
        this.update();
      });
    }
  }

  initCSVUpload() {
    const csvInput = document.getElementById('csv-file-input');
    const uploadBtn = document.getElementById('btn-upload-csv');

    if (uploadBtn && csvInput) {
      uploadBtn.addEventListener('click', () => csvInput.click());
      csvInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
          const text = evt.target.result;
          this.taskManager.importCSV(text);
          this.update();
        };
        reader.readAsText(file);
      });
    }
  }

  openBidDetailsModal(taskId) {
    const task = this.taskManager.tasks.find(t => t.id === taskId);
    if (!task) return;

    const modal = document.getElementById('modal-bid-details');
    const body = document.getElementById('modal-bid-details-body');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="margin-bottom:12px;border-bottom:1px solid var(--border-subtle);padding-bottom:8px">
        <h3 style="font-size:15px;color:var(--tx-bright);margin-bottom:4px">Task #${task.id} — Auction Trace</h3>
        <p style="color:var(--tx-secondary);font-size:12px">
          Box: <b style="color:var(--accent-amber)">${task.boxId || 'Auto/Virtual'}</b> | 
          Route: <b>${task.sourceNodeId} → ${task.destNodeId}</b> | 
          Priority: <b>${task.priority}</b> | 
          Payload: <b>${task.payloadWeight} kg</b>
        </p>
      </div>
      <table class="data-table" style="margin-bottom:14px">
        <thead>
          <tr>
            <th>AMR ID</th>
            <th>Feasibility</th>
            <th>Payload Suit.</th>
            <th>Battery</th>
            <th>Distance</th>
            <th>Workload</th>
            <th>Deadline</th>
            <th>Composite Bid</th>
          </tr>
        </thead>
        <tbody>
          ${(task.bidDetails || []).map(b => `
            <tr style="${b.amr.id === task.assignedAmrId ? 'background:rgba(37,99,235,0.15);font-weight:600' : ''}">
              <td><b style="color:${b.amr.colorInfo ? b.amr.colorInfo.hex : '#fff'}">${b.amr.id}</b> ${b.amr.id === task.assignedAmrId ? '★ (Winner)' : ''}</td>
              <td><span class="status-pill ${b.feasible ? 'success' : 'danger'}">${b.feasible ? 'FEASIBLE' : b.rejectionReason}</span></td>
              <td>${b.components ? b.components.payloadSuitability : '-'}</td>
              <td>${b.components ? b.components.batterySuitability : '-'}</td>
              <td>${b.components ? b.components.distanceSuitability : '-'}</td>
              <td>${b.components ? b.components.workload : '-'}</td>
              <td>${b.components ? b.components.deadlineFeasibility : '-'}</td>
              <td><b style="font-family:var(--font-mono);font-size:13px;color:var(--accent-sky)">${b.feasible ? b.finalScore : '0.0'}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="background:rgba(0,0,0,0.3);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle)">
        <span style="font-size:11px;color:var(--tx-muted);text-transform:uppercase;font-weight:700">Winner Explanation:</span>
        <p style="margin-top:4px;color:var(--tx-primary);font-size:12.5px">${task.assignedAmrId ? `<b>${task.assignedAmrId}</b> selected with top feasible composite bid (${task.winningBidScore}). Payload capacity (max ${task.payloadWeight}kg), battery, reachability, and schedule safety verified.` : 'Auction pending or no feasible AMR candidate.'}</p>
      </div>
    `;

    modal.classList.add('open');
  }

  update() {
    const tableBody = document.getElementById('tasks-table-body');
    if (!tableBody) return;

    const tasks = this.taskManager.getTasks();
    if (tasks.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--tx-muted);padding:24px">No active tasks in system. Create a task or upload CSV batch above.</td></tr>';
      return;
    }

    tableBody.innerHTML = tasks.map(t => {
      let statusClass = 'neutral';
      if (t.status === 'COMPLETED') statusClass = 'success';
      else if (t.status === 'IN_PROGRESS' || t.status === 'ASSIGNED') statusClass = 'info';
      else if (t.status === 'BIDDING') statusClass = 'warning';
      else if (t.status === 'REASSIGNED' || t.status === 'EXCEPTION') statusClass = 'danger';

      return `
        <tr>
          <td><b style="font-family:var(--font-mono);color:var(--tx-bright)">#${t.id}</b></td>
          <td>
            ${t.boxId ? `<span class="status-pill info" style="font-size:11px"><i class="fas fa-cube" style="margin-right:4px"></i><b>${t.boxId}</b></span>` : '<span style="color:var(--tx-muted);font-size:11px">None</span>'}
          </td>
          <td>${t.sourceNodeId}</td>
          <td>${t.destNodeId}</td>
          <td><b style="font-family:var(--font-mono)">${t.priority}</b></td>
          <td>${t.payloadWeight} kg</td>
          <td><span class="status-pill ${statusClass}">${t.status}</span></td>
          <td>${t.assignedAmrId ? `<b style="color:var(--accent-sky)">${t.assignedAmrId}</b>` : '<span style="color:var(--tx-muted)">Unassigned</span>'}</td>
          <td>
            <button class="ctrl-btn" onclick="window.edgeFleetApp.taskUI.openBidDetailsModal('${t.id}')">
              ${t.winningBidScore ? `Bid: ${t.winningBidScore} 🔍` : 'View Auction'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}
