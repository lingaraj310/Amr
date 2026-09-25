/**
 * EdgeFleet - Wi-Fi Direct Peer-to-Peer Relay Mesh
 * Handles autonomous fallback communication when infrastructure Wi-Fi drops.
 * Elects the optimal relay AMR using UWB proximity, battery, and bridge connectivity.
 */

import { logger } from './eventLogger.js';
import { mqttBroker } from './mqttBus.js';

export class WiFiDirectManager {
  constructor() {
    this.activeLinks = new Map(); // amrId -> relayAmrId
    this.maxP2PRange = 35.0; // 35m default relay eligibility radius (Requirement 9)
  }

  /**
   * Elect the best relay peer for a disconnected AMR (Requirement 8)
   */
  evaluateRelayCandidates(sourceAmr, uwbReadings, allAmrs) {
    const candidates = [];

    for (const reading of uwbReadings) {
      if (reading.distance > this.maxP2PRange) continue;

      const peer = allAmrs.find(a => a.id === reading.peerId);
      if (!peer) continue;

      // Candidate must have active infrastructure Wi-Fi to serve as bridge
      if (!peer.wifiConnected) continue;

      // Relay Suitability Score Calculation:
      // Multi-factor arbitration: proximity (50%), battery (30%), workload (20%)
      const distScore = Math.max(0, 100 - (reading.distance / this.maxP2PRange) * 100);
      const batteryScore = peer.battery;
      const workloadScore = peer.currentTask ? 60 : 100;
      const compositeRelayScore = Number((distScore * 0.5 + batteryScore * 0.3 + workloadScore * 0.2).toFixed(1));

      candidates.push({
        amrId: peer.id,
        distance: reading.distance,
        battery: peer.battery,
        relayScore: compositeRelayScore,
        peer
      });
    }

    // Sort by highest composite relay score
    candidates.sort((a, b) => b.relayScore - a.relayScore);
    return candidates;
  }

  establishRelayLink(sourceAmr, relayAmr, distance) {
    this.activeLinks.set(sourceAmr.id, relayAmr.id);
    sourceAmr.wifiDirectActive = true;
    sourceAmr.relayAmrId = relayAmr.id;
    sourceAmr.communicationState = 'WIFI_DIRECT';

    logger.log('WIFI_DIRECT', sourceAmr.id, 
      `Wi-Fi Direct P2P link established with relay ${relayAmr.id} (UWB distance: ${distance}m <= 35m)`,
      { relayId: relayAmr.id, distance, p2pBandwidth: '54 Mbps' },
      'WIFI_DIRECT', 'warning'
    );

    // Peer AMR receives connection and acknowledges (Requirement 6 & 14)
    logger.log('WIFI_DIRECT', relayAmr.id,
      `PEER_ACK: ${relayAmr.id} accepted P2P relay connection from ${sourceAmr.id}. Current position shared.`,
      { sourceAmrId: sourceAmr.id, distance },
      'WIFI_DIRECT', 'info'
    );

    logger.log('WIFI_DIRECT', sourceAmr.id,
      `STATE_SYNC: ${sourceAmr.id} ↔ ${relayAmr.id} exchanged active trajectories, ETAs, and reservation tables.`,
      { sourceTask: sourceAmr.currentTask?.id || 'None', dest: sourceAmr.currentTask?.destNodeId || 'None' },
      'WIFI_DIRECT', 'info'
    );

    // Broadcast dead zone bridge status via relay AMR to MQTT broker
    mqttBroker.publish('fleet/events/wifi_direct_relay', {
      sourceAmr: sourceAmr.id,
      relayAmr: relayAmr.id,
      timestamp: new Date().toISOString(),
      distance_m: distance,
      status: 'BRIDGED'
    }, relayAmr.id, true);
  }

  teardownRelayLink(sourceAmr) {
    if (this.activeLinks.has(sourceAmr.id)) {
      const relayId = this.activeLinks.get(sourceAmr.id);
      this.activeLinks.delete(sourceAmr.id);
      sourceAmr.wifiDirectActive = false;
      sourceAmr.relayAmrId = null;
      if (sourceAmr.wifiConnected) {
        sourceAmr.communicationState = 'DECENTRALIZED_ONLINE';
      } else {
        sourceAmr.communicationState = 'DECENTRALIZED_OFFLINE';
      }

      logger.log('WIFI_DIRECT', sourceAmr.id, 
        `Wi-Fi Direct link to ${relayId} closed. Direct Wi-Fi restored.`,
        { previousRelay: relayId },
        'WIFI_DIRECT', 'success'
      );
    }
  }

  /**
   * Forward message from disconnected AMR through relay to MQTT
   */
  forwardTelemetry(sourceAmr, allAmrs) {
    const relayId = this.activeLinks.get(sourceAmr.id);
    if (!relayId) return false;

    const relayAmr = allAmrs.find(a => a.id === relayId);
    if (!relayAmr || !relayAmr.wifiConnected) return false;

    // Relay publishes on behalf of source
    const topic = `fleet/amr/${sourceAmr.id}/state`;
    const payload = {
      timestamp: new Date().toISOString(),
      robot_id: sourceAmr.id,
      relayed_by: relayId,
      operational_state: sourceAmr.state,
      location: {
        x: Number(sourceAmr.position.x.toFixed(2)),
        y: Number(sourceAmr.position.y.toFixed(2)),
        z: Number(sourceAmr.position.z.toFixed(2)),
        heading: Number(sourceAmr.heading.toFixed(2))
      },
      battery: {
        percent: Number(sourceAmr.battery.toFixed(1)),
        health_percent: sourceAmr.batteryHealth
      },
      task_id: sourceAmr.currentTask ? sourceAmr.currentTask.id : null,
      communication: {
        protocol: 'Wi-Fi Direct Mesh Relay',
        wifi_connected: false,
        wifi_direct_active: true,
        relay_amr: relayId
      }
    };

    mqttBroker.publish(topic, payload, relayId, true);
    return true;
  }
}

export const wifiDirectManager = new WiFiDirectManager();
