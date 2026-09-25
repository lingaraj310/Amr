/**
 * EdgeFleet - UWB Proximity & Ranging System
 * Simulates ultra-wideband time-of-flight distance ranging between AMRs
 * Used for decentralized proximity awareness and peer discovery in degraded Wi-Fi conditions.
 */

export class UWBMeshSystem {
  constructor() {
    this.maxUWBRange = 65.0; // 65 meters effective indoor UWB LOS/NLOS range
    this.rangingNoise = 0.05; // +/- 5cm precision
  }

  /**
   * Calculate real-time pairwise distances between all active AMRs
   */
  scanProximity(targetAmr, allAmrs) {
    const readings = [];

    for (const peer of allAmrs) {
      if (peer.id === targetAmr.id) continue;

      const dx = peer.position.x - targetAmr.position.x;
      const dz = peer.position.z - targetAmr.position.z;
      const trueDistance = Math.hypot(dx, dz);

      if (trueDistance <= this.maxUWBRange) {
        // Add subtle physics noise for sensor realism
        const measuredDistance = Number((trueDistance + (Math.random() - 0.5) * this.rangingNoise).toFixed(1));
        const bearingRad = Math.atan2(dz, dx);
        const relativeAngle = Number(((bearingRad - targetAmr.heading) * (180 / Math.PI)).toFixed(1));

        readings.push({
          peerId: peer.id,
          distance: measuredDistance,
          relativeAngle: (relativeAngle + 360) % 360,
          signalStrengthDbm: Math.round(-40 - (measuredDistance * 0.7)),
          inRange: true,
          peerWifiConnected: peer.wifiConnected,
          peerBattery: peer.battery,
          peerWorkload: peer.currentTask ? 'BUSY' : 'IDLE'
        });
      }
    }

    // Sort by closest proximity
    readings.sort((a, b) => a.distance - b.distance);
    return readings;
  }
}

export const uwbSystem = new UWBMeshSystem();
