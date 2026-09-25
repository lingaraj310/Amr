/**
 * EdgeFleet - Live Communication Console UI
 * Renders real-time protocol streams (MQTT, UWB, Wi-Fi Direct, MAPF, D* Lite, Safety, Battery)
 * with instant filtering and search.
 */

import { logger } from '../communication/eventLogger.js';

export class CommConsoleUI {
  constructor() {
    this.currentFilter = 'ALL';
    this.searchQuery = '';
    this.autoScroll = true;

    this.initControls();
    this.initLiveSubscription();
  }

  initControls() {
    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.dataset.filter || 'ALL';
        this.renderLogs();
      });
    });

    // Search input
    const searchInput = document.getElementById('comm-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.renderLogs();
      });
    }

    // Clear logs button
    const clearBtn = document.getElementById('btn-clear-logs');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        logger.clear();
        this.renderLogs();
      });
    }
  }

  initLiveSubscription() {
    logger.subscribe(() => {
      this.renderLogs();
    });
  }

  renderLogs() {
    const outputEl = document.getElementById('comm-terminal-output');
    if (!outputEl) return;

    const allMatchingLogs = logger.getLogs(this.currentFilter, this.searchQuery);
    // Limit to max 100 visible messages (Requirement 24)
    const logs = allMatchingLogs.slice(0, 100);

    if (logs.length === 0) {
      outputEl.innerHTML = '<div style="color:var(--tx-muted);padding:14px;text-align:center">No communication logs matching current filter.</div>';
      return;
    }

    outputEl.innerHTML = logs.map(l => {
      let protoClass = 'proto-mqtt';
      if (l.protocol === 'UWB') protoClass = 'proto-uwb';
      else if (l.protocol === 'WIFI_DIRECT') protoClass = 'proto-wifip2p';
      else if (l.protocol === 'MAPF') protoClass = 'proto-mapf';
      else if (l.protocol === 'DSTAR_LITE') protoClass = 'proto-dstarlite';
      else if (l.protocol === 'EMERGENCY') protoClass = 'proto-emergency';
      else if (l.protocol === 'SAFETY') protoClass = 'proto-safety';

      return `
        <div class="comm-log-line">
          <span class="comm-time">${l.timestamp}</span>
          <span class="comm-proto ${protoClass}">${l.protocol}</span>
          <span class="comm-sender">${l.sender}</span>
          <span class="comm-msg">${l.message}</span>
        </div>
      `;
    }).join('');

    if (this.autoScroll) {
      outputEl.scrollTop = outputEl.scrollHeight;
    }
  }
}
