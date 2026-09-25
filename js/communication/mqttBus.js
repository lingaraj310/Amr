/**
 * EdgeFleet - MQTT Communication System
 * Implements MassRobotics AMR Interoperability Standard v1.0
 * Manages simulated topic publishing, subscriptions, broker QoS, and infrastructure Wi-Fi state.
 */

import { logger } from './eventLogger.js';

export class MQTTBroker {
  constructor() {
    this.topics = new Map(); // topic -> Set of callbacks
    this.retainedMessages = new Map();
    this.connectedClients = new Set();
    this.messageCount = 0;
  }

  registerClient(clientId) {
    this.connectedClients.add(clientId);
  }

  unregisterClient(clientId) {
    this.connectedClients.delete(clientId);
  }

  subscribe(topicPattern, callback) {
    if (!this.topics.has(topicPattern)) {
      this.topics.set(topicPattern, new Set());
    }
    this.topics.get(topicPattern).add(callback);
    return () => {
      const set = this.topics.get(topicPattern);
      if (set) set.delete(callback);
    };
  }

  /**
   * Publish a MassRobotics formatted message
   */
  publish(topic, payload, senderId = 'SYSTEM', isInfrastructureWifiOnline = true) {
    this.messageCount++;

    if (!isInfrastructureWifiOnline && !topic.startsWith('mesh/')) {
      // Infrastructure Wi-Fi dropped; cannot publish direct to broker without relay
      return false;
    }

    // Deliver to matching topic subscribers (supports wildcards '#' and '+')
    for (const [pattern, subscribers] of this.topics) {
      if (this.matchTopic(pattern, topic)) {
        for (const sub of subscribers) {
          try {
            sub(topic, payload, senderId);
          } catch (e) {
            console.error('MQTT Subscriber execution error:', e);
          }
        }
      }
    }

    return true;
  }

  matchTopic(pattern, topic) {
    if (pattern === '#' || pattern === topic) return true;
    const pParts = pattern.split('/');
    const tParts = topic.split('/');
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i] === '#') return true;
      if (pParts[i] !== '+' && pParts[i] !== tParts[i]) return false;
    }
    return pParts.length === tParts.length;
  }

  /**
   * Standard MassRobotics AMR Status Telemetry Publisher
   */
  publishAmrState(amr) {
    const topic = `fleet/amr/${amr.id}/state`;
    const payload = {
      timestamp: new Date().toISOString(),
      vendor: 'EdgeFleet-Robotics',
      robot_id: amr.id,
      operational_state: amr.state,
      location: {
        x: Number(amr.position.x.toFixed(2)),
        y: Number(amr.position.y.toFixed(2)),
        z: Number(amr.position.z.toFixed(2)),
        heading: Number(amr.heading.toFixed(2))
      },
      velocity: {
        linear: Number(amr.velocity.toFixed(2)),
        angular: 0.0
      },
      battery: {
        percent: Number(amr.battery.toFixed(1)),
        charging: amr.state === 'CHARGING',
        health_percent: amr.batteryHealth
      },
      task_id: amr.currentTask ? amr.currentTask.id : null,
      communication: {
        protocol: 'MassRobotics MQTT v1.0',
        wifi_connected: amr.wifiConnected,
        wifi_direct_active: amr.wifiDirectActive,
        relay_amr: amr.relayAmrId
      }
    };

    const published = this.publish(topic, payload, amr.id, amr.wifiConnected);
    return { topic, payload, published };
  }
}

export const mqttBroker = new MQTTBroker();
