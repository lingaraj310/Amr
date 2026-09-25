/**
 * EdgeFleet - Event Logger & Central Message Bus
 * Captures, filters, and broadcasts all simulation events, telemetry, and decision traces.
 */

export class EventLogger {
  constructor() {
    this.logs = [];
    this.timeline = [];
    this.subscribers = new Set();
    this.maxLogs = 2000;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify(entry) {
    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch (err) {
        console.error('Logger subscriber error:', err);
      }
    }
  }

  log(category, sender, message, details = {}, protocol = 'SYSTEM', severity = 'info') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    const entry = {
      id: 'log_' + Math.random().toString(36).substr(2, 9),
      timestamp: timeStr,
      rawTime: now.getTime(),
      category: category.toUpperCase(), // AMR, TASK, BIDDING, MAPF, DSTAR_LITE, ROUTING, CONFLICT, BATTERY, MQTT, UWB, WIFI_DIRECT, EMERGENCY, SAFETY, SYSTEM
      sender,
      message,
      details,
      protocol: protocol.toUpperCase(),
      severity // info, success, warning, danger, purple
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.notify(entry);
    return entry;
  }

  recordTimeline(title, description, type = 'normal', amrId = null) {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const event = {
      id: 'tl_' + Math.random().toString(36).substr(2, 9),
      time: timeStr,
      rawTime: now.getTime(),
      title,
      description,
      type, // normal, warning, danger, success, info
      amrId
    };
    this.timeline.unshift(event);
    if (this.timeline.length > 500) {
      this.timeline.pop();
    }
    return event;
  }

  getLogs(filterCategory = 'ALL', searchQuery = '') {
    let filtered = this.logs;
    if (filterCategory && filterCategory !== 'ALL') {
      filtered = filtered.filter(l => l.category === filterCategory || l.protocol === filterCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l => 
        l.message.toLowerCase().includes(q) || 
        l.sender.toLowerCase().includes(q) || 
        l.protocol.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    }
    return filtered;
  }

  getTimeline() {
    return this.timeline;
  }

  clear() {
    this.logs = [];
    this.timeline = [];
  }
}

export const logger = new EventLogger();
