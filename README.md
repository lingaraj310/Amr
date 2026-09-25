# EdgeFleet — Intelligent 3D AMR Fleet Simulation & Dashboard

**EdgeFleet** is a professional browser-based 3D Autonomous Mobile Robot (AMR) warehouse fleet simulation and fleet-management dashboard. Every decision is computed mathematically by genuine Multi-Agent Path Finding (MAPF), dynamic D* Lite replanning, multi-criteria auction bidding, dual MQTT & UWB/Wi-Fi Direct communications, and an architectural zero-collision Safety Supervisor.

---

## 🏗️ System Architecture

```
                                 OPERATOR TASKS / CSV BATCH
                                              ↓
                                 TRANSPARENT AUCTION ENGINE
                     (Battery, Distance, Payload, Workload, Deadline, Path)
                                              ↓
                                    ┌───────────────────┐
                                    │       MAPF        │
                                    │  Fleet Planning   │
                                    │ Space-Time Tubes  │
                                    └─────────┬─────────┘
                                              ↓
                                  Conflict-Free Trajectory
                                              ↓
                                      SAFETY SUPERVISOR
                               (Zero-Collision Clearance Check)
                                              ↓
                                        AMR EXECUTION
                                              ↓
                                  Dynamic Environment Change
                                 (Fire, Dead Zone, Blockage)
                                              ↓
                                    ┌───────────────────┐
                                    │      D* LITE      │
                                    │  Local Replanning │
                                    └─────────┬─────────┘
                                              ↓
                                   Repaired Safe Trajectory
```

---

## 🚀 Key Modules & Capabilities

1. **Autonomous Fleet (5 Distinct AMRs)**:
   - `AMR-01` (Cyan), `AMR-02` (Amber), `AMR-03` (Emerald), `AMR-04` (Violet), `AMR-05` (Crimson).
   - Real kinematic movement, status LED halo ring, cargo pallet pickup/delivery attachments, lidar pucks.
   - Comprehensive state machine (`IDLE`, `BIDDING`, `TASK_ASSIGNED`, `PLANNING`, `MOVING`, `TASK_EXECUTION`, `WAITING`, `NEGOTIATING`, `REPLANNING`, `TASK_COMPLETED`, `LOW_BATTERY`, `REASSIGNING`, `CHARGING`, `EMERGENCY`, `SAFE_EVACUATION`, `WIFI_DEAD_ZONE`, `WIFI_DIRECT_RELAY`, `FAULT`, `STOPPED`).

2. **Transparent Multi-Criteria Bidding Engine**:
   - Scores: Battery Suitability (20%), Distance to Pickup (25%), Payload Capability (15%), Workload (10%), Deadline Feasibility (10%), Path Feasibility (10%), Priority Compatibility (10%).
   - Feasibility gates prevent assigning tasks to undercharged, unreachable, or incapable robots.
   - Full explainability trace visible in the Task details modal.

3. **Fleet-Level MAPF (Multi-Agent Path Finding)**:
   - Space-time reservation table preventing vertex conflicts and head-on swap conflicts.
   - Dynamic temporal coordination and safe waiting actions.

4. **Dynamic D* Lite Replanning**:
   - Implements Koenig & Likhachev incremental shortest path repair on graph cost changes.
   - Incrementally updates $rhs$-values and key comparisons when hazards or blocked aisles appear.

5. **Dual Communication Stack**:
   - **Normal Wi-Fi**: MassRobotics AMR Interoperability Standard over simulated MQTT (`fleet/amr/{id}/state`, `fleet/events/...`).
   - **Degraded / Wi-Fi Dead Zone**: UWB proximity ranging (pairwise distances) + Wi-Fi Direct peer-to-peer relay mesh election and forwarding.

6. **Architectural Zero Collision**:
   - Hard mathematical constraints: 1.8m center-to-center minimum clearance bubble, boundary buffers, and dynamic emergency stopping before physical overlap.

7. **Real Calculated Efficiency Benchmark**:
   - Real-time mathematical comparison: Traditional Stop-and-Wait vs. EdgeFleet MAPF + D* Lite (Total mission time, fleet waiting time, distance, energy, and throughput).

---

## 🎮 Evaluator Demonstration Presets

| Demo | Title | What it Demonstrates |
| :--- | :--- | :--- |
| **Demo 1** | **Multi-Task Allocation Auction** | Multi-task creation, transparent bidding scores, MAPF space-time coordination. |
| **Demo 2** | **Shared Aisle Priority Negotiation** | Head-on encounter in Aisle B: Priority score arbitration, safe yield, zero collision. |
| **Demo 3** | **Low Battery (<20%) & Task Reassignment** | AMR battery drains under load, triggers remaining leg auction, safely navigates to charging station CS-02. |
| **Demo 4** | **Wi-Fi Dead Zone + UWB P2P Relay** | AMR enters dead zone, drops Wi-Fi, UWB ranges peers, elects best bridge AMR, establishes Wi-Fi Direct. |
| **Demo 5** | **Fire Emergency + D* Lite Evacuation** | Thermal runaway injected in Aisle C, dynamic D* Lite route repair, diversion to distributed Safe Zones. |
| **Demo 6** | **Dynamic Obstacle in Aisle D** | Fallen box appears; D* Lite dynamically recalculates bypass route. |
| **Demo 7** | **Efficiency Comparison Benchmark** | Live quantitative evaluation of EdgeFleet vs. Stop-and-Wait. |

---

## 🖥️ Running Locally

The local server is running at:
**`http://localhost:3000/`**

To start manually anytime:
```bash
node server.js
```
Open `http://localhost:3000/` in any modern web browser.
