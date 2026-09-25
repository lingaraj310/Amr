/**
 * EdgeFleet - 3D Warehouse Visualizer & Three.js Scene Engine
 * High-fidelity industrial digital twin rendering racks, AMRs, lanes, dynamic hazards, and paths.
 */

import { S, X, Z, RACK_OBSTACLES, WALL_OBSTACLES, VALID_PORTALS } from './navigationGraph.js';

export class Warehouse3DView {
  constructor(canvasElement, navGraph, fleetManager) {
    this.canvas = canvasElement;
    this.graph = navGraph;
    this.fleet = fleetManager;

    // Layer Groups
    this.groups = {
      struct: new THREE.Group(),
      racks: new THREE.Group(),
      lanes: new THREE.Group(),
      amrs: new THREE.Group(),
      boxes: new THREE.Group(),
      hazards: new THREE.Group(),
      paths: new THREE.Group(),
      zones: new THREE.Group(),
      labels: new THREE.Group(),
      navDebug: new THREE.Group()
    };

    // Camera view modes: 'iso', 'top', 'free', 'follow'
    this.viewMode = 'iso';
    this.cameraTargets = {
      iso: { th: 0.0, ph: 0.82, rad: 122, x: 0, z: 0.25 },
      top: { th: 0.0, ph: 0.001, rad: 110, x: 0, z: 0.25 },
      free: { th: 0.65, ph: 0.68, rad: 115, x: 0, z: 0.25 },
      follow: { th: 0.2, ph: 1.25, rad: 22, x: 0, z: 0 }
    };

    // Orbit state
    this.orbit = {
      th: this.cameraTargets.iso.th,
      ph: this.cameraTargets.iso.ph,
      rad: this.cameraTargets.iso.rad,
      target: new THREE.Vector3(0, 0, 0.25),
      animTarget: null
    };

    this.layerVisibility = {
      racks: true,
      lanes: true,
      vehicles: true,
      boxes: true,
      hazards: true,
      paths: true,
      zones: true,
      labels: true,
      navDebug: false
    };

    this.amrLabels = new Map(); // amrId -> { sprite, canvas, ctx, texture }
    this.boxLabels = new Map(); // boxId -> { sprite, canvas, ctx, texture }
    this.onAmrClickCallback = null;
    this.onFloorClickCallback = null;
    this.geomCache = new Map();
    this.amrPathMeshes = new Map(); // amrId -> { lineMesh, destBeaconMesh, bubbleMesh, lastRouteKey }
    this._tempFollowVec = new THREE.Vector3();

    this.initThree();
    this.fitCameraToWarehouse('iso');
    this.buildStaticWarehouse();
    this.buildNavigationDebugView();
    this.buildAmrMeshes();
    this.buildBoxMeshes();
    this.setupInteractions();
  }

  toggleLayer(layer, isVisible) {
    if (this.layerVisibility[layer] !== undefined) {
      this.layerVisibility[layer] = isVisible;
    }
    if (this.groups[layer]) {
      this.groups[layer].visible = isVisible;
    }
  }

  buildNavigationDebugView() {
    this.groups.navDebug.clear();

    // 1. RED: Rack & Storage Area Non-Navigable Footprints & Boundary Outlines
    for (const rack of RACK_OBSTACLES) {
      const q = this.rc(rack.x1, rack.z1, rack.x2, rack.z2);
      const wireGeom = new THREE.BoxGeometry(q.w + 0.1, 0.25, q.d + 0.1);
      const wireMat = new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true });
      const wireMesh = new THREE.Mesh(wireGeom, wireMat);
      wireMesh.position.set(q.cx, 0.13, q.cz);
      this.groups.navDebug.add(wireMesh);

      const fillGeom = new THREE.PlaneGeometry(q.w, q.d);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.18, side: 2 });
      const fillMesh = new THREE.Mesh(fillGeom, fillMat);
      fillMesh.rotation.x = -Math.PI / 2;
      fillMesh.position.set(q.cx, 0.04, q.cz);
      this.groups.navDebug.add(fillMesh);
    }

    // 2. BLUE: Approved AMR Navigation Lanes & Graph Edges
    // 3. GREEN: Approved Alternate Bypass Lanes & Connecting Cross-Aisles
    const processedEdges = new Set();
    for (const [key, edge] of this.graph.edges) {
      const edgeRev = `${edge.to}->${edge.from}`;
      if (processedEdges.has(edgeRev)) continue;
      processedEdges.add(key);

      const nodeU = this.graph.getNode(edge.from);
      const nodeV = this.graph.getNode(edge.to);
      if (!nodeU || !nodeV) continue;

      const isAlternate = (nodeU.isWaitingBay || nodeV.isWaitingBay || nodeU.zone === 'TRAFFIC_CORRIDOR' || nodeV.zone === 'TRAFFIC_CORRIDOR');
      const lineColor = isAlternate ? 0x10b981 : 0x0284c7;

      const points = [
        new THREE.Vector3(nodeU.x, 0.10, nodeU.z),
        new THREE.Vector3(nodeV.x, 0.10, nodeV.z)
      ];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
      const lineMesh = new THREE.Line(geom, mat);
      this.groups.navDebug.add(lineMesh);

      [nodeU, nodeV].forEach(n => {
        const nodeGeom = new THREE.RingGeometry(0.18, 0.28, 16);
        const nodeMat = new THREE.MeshBasicMaterial({ color: lineColor, side: 2, transparent: true, opacity: 0.8 });
        const nodeMesh = new THREE.Mesh(nodeGeom, nodeMat);
        nodeMesh.rotation.x = -Math.PI / 2;
        nodeMesh.position.set(n.x, 0.11, n.z);
        this.groups.navDebug.add(nodeMesh);
      });
    }

    this.groups.navDebug.visible = this.layerVisibility.navDebug || false;
  }

  initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    // Clamp devicePixelRatio to max 1.5 for smooth 60 FPS on high-DPI displays (Requirement 26)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1420);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 500);

    // High Quality Industrial Lighting
    const ambient = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.95);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(-35, 75, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -65, right: 65, top: 50, bottom: -50, near: 1, far: 200 });
    this.scene.add(sun);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x94a3b8, 0.4);
    fillLight.position.set(40, 50, -30);
    this.scene.add(fillLight);

    // Add groups
    Object.values(this.groups).forEach(g => this.scene.add(g));

    // Materials
    this.materials = {
      floor: new THREE.MeshStandardMaterial({ color: 0x1a2634, roughness: 0.55, metalness: 0.15 }),
      lane: new THREE.MeshStandardMaterial({ color: 0x27384c, roughness: 0.5 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x1e2e42, roughness: 0.8 }),
      barrier: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 }),
      bollardYellow: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.4 }),
      bollardDark: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 }),
      rack: new THREE.MeshStandardMaterial({ color: 0xe8751a, roughness: 0.45, metalness: 0.35 }), // Primary Industrial Orange (#E8751A)
      rackDark: new THREE.MeshStandardMaterial({ color: 0xc95d12, roughness: 0.55, metalness: 0.3 }), // Dark support (#C95D12)
      beam: new THREE.MeshStandardMaterial({ color: 0xf28a2e, roughness: 0.4, metalness: 0.4 }), // Light beam (#F28A2E)
      pallet: new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.9 }),
      carton: new THREE.MeshStandardMaterial({ color: 0xb9824a, roughness: 0.85 }), // Natural cardboard (#B9824A)
      carton2: new THREE.MeshStandardMaterial({ color: 0xc9955f, roughness: 0.82 }), // Natural cardboard variation 1 (#C9955F)
      carton3: new THREE.MeshStandardMaterial({ color: 0x96633a, roughness: 0.88 }), // Natural cardboard variation 2 (#96633A)
      white: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }),
      chargePort: new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.6 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.75 }),
      steelDark: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.45, metalness: 0.65 }),
      stagingFrame: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.4, metalness: 0.4 }),
      tapeRed: new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3 }),
      screenLed: new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.8 }),
      screenBlue: new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.7 }),
      bubbleWrap: new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.2, transparent: true, opacity: 0.75 })
    };

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // ResizeObserver for reliable dimension tracking
    if (window.ResizeObserver && this.canvas.parentElement) {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.canvas.parentElement);
    }
  }

  computeWarehouseBounds() {
    // Complete warehouse world bounds enclosing:
    // Floor, perimeter walls, all 4 corners, racks, operational zones, Home Area, and lanes.
    const minX = X(40) - 1.5;
    const maxX = X(955) + 1.5;
    const minZ = Z(5) - 1.5;
    const maxZ = Z(595) + 1.5;
    const minY = 0.0;
    const maxY = 4.5;

    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    return { minX, maxX, minZ, maxZ, minY, maxY, width, depth, cx, cz };
  }

  calculateRequiredDistance(th, ph, bounds, paddingFactor = 1.18) {
    const fovY = (this.camera.fov * Math.PI) / 180;
    const tanHalfFovY = Math.tan(fovY / 2);
    const tanHalfFovX = Math.max(0.2, this.camera.aspect * tanHalfFovY);

    // 8 bounding box corners relative to center (cx, 0, cz)
    const corners = [];
    for (const px of [bounds.minX, bounds.maxX]) {
      for (const py of [bounds.minY, bounds.maxY]) {
        for (const pz of [bounds.minZ, bounds.maxZ]) {
          corners.push({ x: px - bounds.cx, y: py, z: pz - bounds.cz });
        }
      }
    }

    const sinPh = Math.sin(ph);
    const cosPh = Math.cos(ph);
    const sinTh = Math.sin(th);
    const cosTh = Math.cos(th);

    let maxRad = 0;
    for (const v of corners) {
      const xCam = v.x * cosTh - v.z * sinTh;
      const yCam = -v.x * cosPh * sinTh + v.y * sinPh - v.z * cosPh * cosTh;
      const zOffset = -v.x * sinPh * sinTh - v.y * cosPh - v.z * sinPh * cosTh;

      const radX = Math.abs(xCam) / tanHalfFovX;
      const radY = Math.abs(yCam) / tanHalfFovY;
      const radReq = zOffset + Math.max(radX, radY);
      if (radReq > maxRad) maxRad = radReq;
    }

    return Math.max(65, maxRad * paddingFactor);
  }

  updateCameraTargets(bounds) {
    bounds = bounds || this.computeWarehouseBounds();

    const isoRad = this.calculateRequiredDistance(0.0, 0.82, bounds, 1.18);
    const topRad = this.calculateRequiredDistance(0.0, 0.001, bounds, 1.15);
    const freeRad = this.calculateRequiredDistance(0.65, 0.68, bounds, 1.15);

    this.cameraTargets = {
      iso: { th: 0.0, ph: 0.82, rad: isoRad, x: bounds.cx, z: bounds.cz },
      top: { th: 0.0, ph: 0.001, rad: topRad, x: bounds.cx, z: bounds.cz },
      free: { th: 0.65, ph: 0.68, rad: freeRad, x: bounds.cx, z: bounds.cz },
      follow: { th: 0.2, ph: 1.25, rad: 22, x: 0, z: 0 }
    };
  }

  fitCameraToWarehouse(viewMode = null) {
    if (viewMode) this.viewMode = viewMode;
    const bounds = this.computeWarehouseBounds();
    this.updateCameraTargets(bounds);

    const targetConfig = this.cameraTargets[this.viewMode] || this.cameraTargets.iso;
    this.orbit.th = targetConfig.th;
    this.orbit.ph = targetConfig.ph;
    this.orbit.rad = targetConfig.rad;
    this.orbit.target.set(targetConfig.x, 0, targetConfig.z);
    this.orbit.animTarget = null;
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const w = Math.max(100, this.canvas.parentElement.clientWidth || window.innerWidth - 240);
    const h = Math.max(100, this.canvas.parentElement.clientHeight || window.innerHeight - 56);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 52 : 42;
    this.camera.updateProjectionMatrix();

    // Dynamically recalculate optimal framing radius for the updated viewport
    const bounds = this.computeWarehouseBounds();
    this.updateCameraTargets(bounds);

    if (this.viewMode === 'iso' || this.viewMode === 'top') {
      const targetConfig = this.cameraTargets[this.viewMode];
      if (targetConfig && !this.orbit.animTarget) {
        this.orbit.rad = targetConfig.rad;
        this.orbit.target.set(targetConfig.x, 0, targetConfig.z);
      }
    }
  }

  getBoxGeometry(w, h, d) {
    const key = `${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
    if (!this.geomCache.has(key)) {
      this.geomCache.set(key, new THREE.BoxGeometry(w, h, d));
    }
    return this.geomCache.get(key);
  }

  box(group, mat, x, y, z, w, h, d, castShadow = true) {
    const geom = this.getBoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  rc(x1, y1, x2, y2) {
    return {
      cx: X((x1 + x2) / 2),
      cz: Z((y1 + y2) / 2),
      w: (x2 - x1) * S,
      d: (y2 - y1) * S
    };
  }

  slab(group, mat, r, y, h) {
    const q = this.rc(...r);
    return this.box(group, mat, q.cx, y, q.cz, q.w, h, q.d);
  }

  buildStaticWarehouse() {
    // 1. Warehouse Floor
    const floorRect = [40, 5, 955, 595];
    const floorMesh = this.slab(this.groups.struct, this.materials.floor, floorRect, -0.2, 0.4);
    floorMesh.userData = { isFloor: true };

    // 2. Navigation lanes on floor (Drivable Warehouse Roads)
    const lanes = [
      // 3 Main Cross-Highways (North, Mid, South)
      [135, 114, 935, 126], // North Highway (pz = 120)
      [165, 288, 935, 302], // Mid Highway (pz = 295)
      [135, 453, 935, 467], // South Highway (pz = 460)

      // 4 Main Storage Aisles
      [287, 120, 301, 460], // Aisle A (px = 294)
      [450, 120, 464, 460], // Aisle B (px = 457)
      [615, 120, 629, 460], // Aisle C (px = 622)
      [805, 120, 819, 295], // Aisle D North (px = 812)
      [829, 295, 843, 460], // Aisle D South (px = 836)

      // 3 Vertical Arteries
      [198, 120, 212, 460], // West Corridor (px = 205)
      [743, 295, 757, 460], // Central Inter-Aisle (px = 750)
      [908, 120, 922, 460]  // East Corridor (px = 915)
    ];
    lanes.forEach(r => this.slab(this.groups.lanes, this.materials.lane, r, 0.02, 0.05));

    // 3. Perimeter Boundary Walls
    const wl = (x1, y1, x2, y2, h = 3.2) => this.slab(this.groups.struct, this.materials.wall, [x1, y1, x2, y2], h / 2, h);
    const bl = (x1, y1, x2, y2, h = 1.2) => this.slab(this.groups.struct, this.materials.barrier, [x1, y1, x2, y2], h / 2, h);

    // Outer Warehouse Perimeter Walls
    wl(48, 8, 946, 14);
    wl(48, 584, 946, 590);
    wl(48, 8, 54, 590);
    wl(940, 8, 946, 590);

    // =========================================================================
    // PHYSICAL ENCLOSED ZONES WITH DESIGNATED 3D GATES / REAL OPENINGS
    // =========================================================================

    // Helper: build 3D Gate Bollards, Hazard Floor Strip, and Entry Signage
    const buildGate = (px, pz, width, depth, label, color = '#facc15') => {
      const worldX = X(px);
      const worldZ = Z(pz);
      const isHorizontal = width >= depth;
      const span = (isHorizontal ? width : depth) * S;
      const halfSpan = span / 2;

      // 3D Industrial Safety Bollards (Yellow with black hazard bands) flanking gate opening
      [-halfSpan, halfSpan].forEach(offset => {
        const bollardGroup = new THREE.Group();
        const bGeom = new THREE.CylinderGeometry(0.14, 0.14, 1.15, 16);
        const bMesh = new THREE.Mesh(bGeom, this.materials.bollardYellow);
        bMesh.position.y = 0.575;
        bMesh.castShadow = true;
        bollardGroup.add(bMesh);

        // Black warning stripes
        [0.35, 0.75].forEach(by => {
          const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.12, 16), this.materials.bollardDark);
          stripe.position.y = by;
          bollardGroup.add(stripe);
        });

        if (isHorizontal) {
          bollardGroup.position.set(worldX + offset, 0, worldZ);
        } else {
          bollardGroup.position.set(worldX, 0, worldZ + offset);
        }
        this.groups.struct.add(bollardGroup);
      });

      // Ground Hazard Entry Threshold Strip
      const threshW = Math.max(1.6, (width * S) * 0.95);
      const threshD = Math.max(1.0, (depth * S) * 0.95);
      const threshMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(threshW, threshD),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.22, depthWrite: false })
      );
      threshMesh.rotation.x = -Math.PI / 2;
      threshMesh.position.set(worldX, 0.09, worldZ);
      this.groups.zones.add(threshMesh);

      // Gate Ground Label
      this.createGroundText(label, worldX, worldZ + (isHorizontal ? 1.35 : 0), color, 1.3);
    };

    // 1. SAFE ZONE NW (Receiving) - Gate Opening at px: 115..165 (center 140, 110)
    wl(190, 14, 194, 108); // East partition wall
    wl(48, 108, 115, 112);  // South wall west segment
    wl(165, 108, 194, 112); // South wall east segment
    buildGate(140, 110, 50, 6, 'SAFE ZONE GATE NW', '#10b981');

    // 2. PACKAGING HUB (Top Center-Left) - Gate Opening at px: 315..375 (center 345, 110)
    bl(218, 14, 222, 108); // West barrier
    bl(433, 14, 437, 108); // East barrier
    bl(220, 108, 315, 112); // South barrier west segment
    bl(375, 108, 435, 112); // South barrier east segment
    buildGate(345, 110, 60, 6, 'PACKAGING GATE', '#38bdf8');

    // 3. TWO-PORT AMR CHARGING STATION (Top Center) - Gate Opening at px: 515..605 (center 560, 110)
    wl(455, 14, 459, 108);  // West boundary wall
    wl(660, 14, 664, 108);  // East boundary wall
    wl(455, 108, 515, 112); // South wall west segment
    wl(605, 108, 664, 112); // South wall east segment
    buildGate(560, 110, 90, 6, 'CHARGING GATE', '#10b981');

    // 4. AMR HOME AREA (Top-Right Room) - Gate Opening at px: 788..872 (center 830, 110)
    wl(708, 14, 712, 108); // West boundary wall
    wl(708, 108, 788, 112); // South wall west segment
    wl(872, 108, 940, 112); // South wall east segment
    buildGate(830, 110, 84, 6, 'HOME AREA GATE', '#38bdf8');

    // 5. INBOUND BUFFER & QUALITY CHECK (Left Side) - Gate Opening at pz: 260..320 (center 188, 290)
    bl(60, 138, 188, 142); // North barrier
    bl(60, 438, 188, 442); // South barrier
    bl(186, 140, 190, 260); // East barrier north segment
    bl(186, 320, 190, 440); // East barrier south segment
    buildGate(188, 290, 6, 60, 'INBOUND GATE', '#38bdf8');

    // 6. SAFE ZONE SW (Maintenance) - Gate Opening at px: 115..165 (center 140, 466)
    wl(190, 468, 194, 584); // East partition wall
    wl(48, 464, 115, 468);  // North wall west segment
    wl(165, 464, 194, 468); // North wall east segment
    buildGate(140, 466, 50, 6, 'MAINTENANCE / SAFE GATE SW', '#10b981');

    // 7. RECEIVING / SORTING & INSPECTION (Bottom Center) - Gate Opening at px: 485..545 (center 515, 466)
    bl(388, 464, 392, 584); // West barrier
    bl(638, 464, 642, 584); // East barrier
    bl(390, 464, 485, 468); // North barrier west segment
    bl(545, 464, 640, 468); // North barrier east segment
    buildGate(515, 466, 60, 6, 'SORTING & INSPECTION GATE', '#a78bfa');

    // 8. MATERIAL HANDLING & STAGING (Bottom Right-Center) - Gate Opening at px: 690..750 (center 720, 466)
    bl(646, 464, 650, 584); // West barrier
    bl(790, 464, 794, 584); // East barrier
    bl(648, 464, 690, 468); // North barrier west segment
    bl(750, 464, 792, 468); // North barrier east segment
    buildGate(720, 466, 60, 6, 'STAGING GATE', '#94a3b8');

    // 9. OPEN DISPATCH & RETURNS (Bottom Right) - Open Entry at px: 815..875 (center 845, 466)
    bl(795, 464, 799, 584); // West low barrier
    bl(795, 464, 815, 468); // North barrier west segment
    bl(875, 464, 940, 468); // North barrier east segment
    buildGate(845, 466, 60, 6, 'DISPATCH & RETURNS GATE', '#38bdf8');

    // =========================================================================
    // 4. INDUSTRIAL PALLET STORAGE RACKS (15 RACK BAYS)
    // =========================================================================
    const rackDefs = [
      [240, 138, 278, 262], [310, 138, 348, 262],
      [402, 138, 442, 262], [472, 138, 510, 262],
      [562, 138, 602, 262], [643, 138, 682, 262],
      [757, 138, 795, 262], [828, 138, 866, 262],
      [237, 325, 278, 445], [310, 325, 350, 445],
      [562, 325, 602, 445], [643, 325, 682, 445],
      [472, 335, 510, 395], [780, 325, 820, 388], [853, 325, 890, 388]
    ];

    rackDefs.forEach(r => this.buildRack(...r));

    // =========================================================================
    // 5. ZONE FLOOR HIGHLIGHTS, EQUIPMENT PROPS, AND LABELS
    // =========================================================================
    
    // PACKAGING HUB 3D PROPS (Top Center-Left) - REALISTIC PACKING OPERATION
    const packRect = [222, 16, 433, 106];
    const packQ = this.rc(...packRect);
    const packFloorMat = new THREE.MeshBasicMaterial({ color: 0x0369a1, transparent: true, opacity: 0.08, depthWrite: false });
    const packPlane = new THREE.Mesh(new THREE.PlaneGeometry(packQ.w, packQ.d), packFloorMat);
    packPlane.rotation.x = -Math.PI / 2;
    packPlane.position.set(packQ.cx, 0.08, packQ.cz);
    this.groups.zones.add(packPlane);

    // Subtle Packaging Area Perimeter Line
    const packEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(packQ.w, packQ.d)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    packEdges.rotation.x = -Math.PI / 2;
    packEdges.position.set(packQ.cx, 0.09, packQ.cz);
    this.groups.zones.add(packEdges);

    this.createGroundText('PACKAGING HUB', packQ.cx, Z(28), '#38bdf8', 2.2);

    // Workstation 1 (Left Table with accessories, screen, carton)
    this.buildPackingWorkstation(X(275), Z(55), 'PACKING WORKSTATION 01', this.materials.carton);
    // Workstation 2 (Right Table with accessories, screen, carton)
    this.buildPackingWorkstation(X(395), Z(55), 'PACKING WORKSTATION 02', this.materials.carton2);

    // Short Industrial Roller Conveyor
    this.buildRollerConveyor(X(330), Z(42), X(360), Z(42), 10, 2);

    // Packing Material Storage Shelving Unit
    this.buildPackingMaterialRack(X(238), Z(45));

    // Package Weighing Station
    this.buildWeighingStation(X(245), Z(82));

    // Carton Strapping / Sealing Station
    this.buildSealingStation(X(418), Z(55));

    // TWO-PORT AMR CHARGING STATION (Top Center)
    const chargeStationRect = [455, 14, 660, 108];
    const csQ = this.rc(...chargeStationRect);
    const csFloorMat = new THREE.MeshBasicMaterial({ color: 0x064e3b, transparent: true, opacity: 0.18, depthWrite: false });
    const csPlane = new THREE.Mesh(new THREE.PlaneGeometry(csQ.w, csQ.d), csFloorMat);
    csPlane.rotation.x = -Math.PI / 2;
    csPlane.position.set(csQ.cx, 0.08, csQ.cz);
    this.groups.zones.add(csPlane);

    this.createGroundText('AMR CHARGING STATION', csQ.cx, Z(32), '#10b981', 2.4);

    // Exactly Two Charging Ports: Port 01 & Port 02
    this.chargingPorts3D = [
      { id: 'CS_01', px: 515, pz: 55, label: 'CHARGING PORT 01', portNum: 1 },
      { id: 'CS_02', px: 605, pz: 55, label: 'CHARGING PORT 02', portNum: 2 }
    ];

    this.portLedMeshes = new Map();
    this.chargingPorts3D.forEach(port => {
      const pWorldX = X(port.px);
      const pWorldZ = Z(port.pz);

      // Industrial Charger Terminal Cabinet
      this.box(this.groups.struct, this.materials.dark, pWorldX, 0.9, pWorldZ - 0.4, 2.2, 1.8, 1.0);
      
      // Status LED indicator screen on cabinet face
      const ledMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.8 });
      const ledScreen = this.box(this.groups.struct, ledMat, pWorldX, 1.1, pWorldZ + 0.12, 1.0, 0.5, 0.15);
      this.portLedMeshes.set(port.id, { mat: ledMat, screen: ledScreen });

      // Ground bay parking box
      const portWidth = 2.6;
      const portDepth = 3.2;
      const portMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(portWidth, portDepth),
        new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.12, depthWrite: false })
      );
      portMesh.rotation.x = -Math.PI / 2;
      portMesh.position.set(pWorldX, 0.09, pWorldZ + 0.8);
      this.groups.zones.add(portMesh);

      const portEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(portWidth, portDepth)),
        new THREE.LineBasicMaterial({ color: 0x10b981 })
      );
      portEdges.rotation.x = -Math.PI / 2;
      portEdges.position.set(pWorldX, 0.10, pWorldZ + 0.8);
      this.groups.zones.add(portEdges);

      this.createGroundText(port.label, pWorldX, pWorldZ + 2.0, '#10b981', 1.4);
    });

    // SAFE ZONES (NW, SW) - EXACTLY TWO SAFE ZONES IN ENTIRE WAREHOUSE (NO SAFE ZONE SE)
    const safeZones = [
      { name: 'SAFE ZONE NW', r: [60, 16, 188, 106], col: 0x10b981 },
      { name: 'SAFE ZONE SW', r: [60, 470, 188, 582], col: 0x10b981 }
    ];

    safeZones.forEach(sz => {
      const q = this.rc(...sz.r);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(q.w, q.d),
        new THREE.MeshBasicMaterial({ color: sz.col, transparent: true, opacity: 0.14, depthWrite: false })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(q.cx, 0.08, q.cz);
      this.groups.zones.add(plane);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(q.w, q.d)),
        new THREE.LineBasicMaterial({ color: sz.col })
      );
      edges.rotation.x = -Math.PI / 2;
      edges.position.set(q.cx, 0.09, q.cz);
      this.groups.zones.add(edges);

      this.createGroundText(sz.name, q.cx, q.cz, '#10b981', 2.2);
    });

    // RECEIVING BUFFER & QUALITY INSPECTION (Left Side) - ORGANIZED BUFFER & INSPECTION
    const inboundBufferRect = [60, 140, 186, 440];
    const ibQ = this.rc(...inboundBufferRect);
    const ibPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(ibQ.w, ibQ.d),
      new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.07, depthWrite: false })
    );
    ibPlane.rotation.x = -Math.PI / 2;
    ibPlane.position.set(ibQ.cx, 0.08, ibQ.cz);
    this.groups.zones.add(ibPlane);

    // Subtle Zone Perimeter Line
    const ibEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(ibQ.w, ibQ.d)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    ibEdges.rotation.x = -Math.PI / 2;
    ibEdges.position.set(ibQ.cx, 0.09, ibQ.cz);
    this.groups.zones.add(ibEdges);

    // Single Clean Zone Label (Horizontally aligned, uncluttered near top-center)
    this.createGroundText('RECEIVING BUFFER & QUALITY INSPECTION', ibQ.cx, Z(160), '#38bdf8', 1.7);

    // -------------------------------------------------------------
    // NORTH: RECEIVING BUFFER (Organized Temporary Staging)
    // -------------------------------------------------------------
    // 1. Small Storage / Staging Rack along West Wall
    this.buildLightweightStagingRack(X(78), Z(190), 3.2, 0.8, 3);

    // 2. Organized Pallet Position 1 (Neat 2x2 Carton Array)
    this.box(this.groups.struct, this.materials.pallet, X(82), 0.08, Z(235), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(82) - 0.35, 0.40, Z(235) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton2, X(82) + 0.35, 0.40, Z(235) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton3, X(82) - 0.35, 0.40, Z(235) + 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton, X(82) + 0.35, 0.40, Z(235) + 0.32, 0.6, 0.48, 0.55);

    // 3. Organized Pallet Position 2 (Neat Staged Bulk Cartons)
    this.box(this.groups.struct, this.materials.pallet, X(82), 0.08, Z(262), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton2, X(82), 0.45, Z(262), 1.2, 0.55, 1.1);
    this.box(this.groups.struct, this.materials.carton, X(82), 0.85, Z(262), 0.8, 0.45, 0.8);

    // -------------------------------------------------------------
    // SOUTH: QUALITY INSPECTION WORKSTATION & SAMPLE STAGING
    // -------------------------------------------------------------
    // 4. Quality Inspection Workstation (Inspection table, QA display, scanner, sample components)
    this.buildInspectionWorkstation(X(82), Z(345));

    // 5. Inspection Sample Parts Rack along West Wall
    this.buildLightweightStagingRack(X(78), Z(395), 2.6, 0.8, 3);

    // 6. Inspected Material Holding Pallet
    this.box(this.groups.struct, this.materials.pallet, X(82), 0.08, Z(308), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(82), 0.42, Z(308), 1.2, 0.50, 1.1);
    this.box(this.groups.struct, this.materials.carton3, X(82), 0.80, Z(308), 0.7, 0.38, 0.7);

    // -------------------------------------------------------------
    // ZONE 1: RECEIVING / SORTING & INSPECTION (Bottom-Center)
    // -------------------------------------------------------------
    const boxBufferRect = [392, 470, 638, 582];
    const bbQ = this.rc(...boxBufferRect);
    const bbPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(bbQ.w, bbQ.d),
      new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.07, depthWrite: false })
    );
    bbPlane.rotation.x = -Math.PI / 2;
    bbPlane.position.set(bbQ.cx, 0.08, bbQ.cz);
    this.groups.zones.add(bbPlane);

    // Subtle Perimeter line
    const bbEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(bbQ.w, bbQ.d)),
      new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.35 })
    );
    bbEdges.rotation.x = -Math.PI / 2;
    bbEdges.position.set(bbQ.cx, 0.09, bbQ.cz);
    this.groups.zones.add(bbEdges);

    // Single Clean Label: RECEIVING / SORTING & INSPECTION
    this.createGroundText('RECEIVING / SORTING & INSPECTION', bbQ.cx, Z(480), '#a78bfa', 1.8);

    // West Side: Medium-Height Industrial Sorting Rack & Temporary Staging Pallet
    this.buildLightweightStagingRack(X(408), Z(525), 3.4, 0.8, 3);
    this.box(this.groups.struct, this.materials.pallet, X(408), 0.08, Z(560), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(408), 0.45, Z(560), 1.2, 0.55, 1.1);
    this.box(this.groups.struct, this.materials.carton2, X(408), 0.85, Z(560), 0.8, 0.45, 0.8);

    // East Side: Sorting / Inspection Workstation & Organized Pallet Staging
    this.buildInspectionWorkstation(X(622), Z(515));
    this.box(this.groups.struct, this.materials.pallet, X(622), 0.08, Z(555), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton3, X(622) - 0.35, 0.40, Z(555) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton, X(622) + 0.35, 0.40, Z(555) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton2, X(622) - 0.35, 0.40, Z(555) + 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton3, X(622) + 0.35, 0.40, Z(555) + 0.32, 0.6, 0.48, 0.55);

    // South Wall: Small Incoming Material Staging Pallet Position
    this.box(this.groups.struct, this.materials.pallet, X(515), 0.08, Z(568), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(515), 0.42, Z(568), 1.1, 0.50, 1.0);

    // -------------------------------------------------------------
    // ZONE 2: MATERIAL HANDLING & STAGING (Bottom Right-Center)
    // -------------------------------------------------------------
    const holdingRect = [650, 470, 790, 582];
    const hdQ = this.rc(...holdingRect);
    const hdPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(hdQ.w, hdQ.d),
      new THREE.MeshBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.08, depthWrite: false })
    );
    hdPlane.rotation.x = -Math.PI / 2;
    hdPlane.position.set(hdQ.cx, 0.08, hdQ.cz);
    this.groups.zones.add(hdPlane);

    // Subtle Perimeter line
    const hdEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(hdQ.w, hdQ.d)),
      new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 })
    );
    hdEdges.rotation.x = -Math.PI / 2;
    hdEdges.position.set(hdQ.cx, 0.09, hdQ.cz);
    this.groups.zones.add(hdEdges);

    // Single Clean Label: MATERIAL HANDLING & STAGING
    this.createGroundText('MATERIAL HANDLING & STAGING', hdQ.cx, Z(480), '#94a3b8', 1.8);

    // West Side: Industrial Material Staging Rack & Pallet Load
    this.buildLightweightStagingRack(X(662), Z(525), 3.2, 0.8, 3);
    this.box(this.groups.struct, this.materials.pallet, X(662), 0.08, Z(560), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton2, X(662), 0.45, Z(560), 1.2, 0.55, 1.1);
    this.box(this.groups.struct, this.materials.carton3, X(662), 0.85, Z(560), 0.75, 0.40, 0.75);

    // East Side: Small Staging Table / Workbench & Pallet Position
    this.buildPackingWorkstation(X(778), Z(515), 'STAGING BENCH', this.materials.carton);
    this.box(this.groups.struct, this.materials.pallet, X(778), 0.08, Z(555), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(778) - 0.35, 0.40, Z(555) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton2, X(778) + 0.35, 0.40, Z(555) - 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton3, X(778) - 0.35, 0.40, Z(555) + 0.32, 0.6, 0.48, 0.55);
    this.box(this.groups.struct, this.materials.carton, X(778) + 0.35, 0.40, Z(555) + 0.32, 0.6, 0.48, 0.55);

    // South Wall: Material Handling Temporary Staging Position
    this.box(this.groups.struct, this.materials.pallet, X(720), 0.08, Z(568), 1.6, 0.16, 1.4);
    this.box(this.groups.struct, this.materials.carton, X(720), 0.42, Z(568), 1.2, 0.50, 1.1);

    // OPEN DISPATCH & RETURNS (Bottom-Right) - OPERATIONAL WORK AREA (NOT A SAFE ZONE)
    const dispatchRect = [797, 470, 938, 582];
    const dpQ = this.rc(...dispatchRect);
    const dpPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(dpQ.w, dpQ.d),
      new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.07, depthWrite: false })
    );
    dpPlane.rotation.x = -Math.PI / 2;
    dpPlane.position.set(dpQ.cx, 0.08, dpQ.cz);
    this.groups.zones.add(dpPlane);

    // Subtle Perimeter demarcation line
    const dpEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(dpQ.w, dpQ.d)),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    dpEdges.rotation.x = -Math.PI / 2;
    dpEdges.position.set(dpQ.cx, 0.09, dpQ.cz);
    this.groups.zones.add(dpEdges);

    this.createGroundText('DISPATCH & RETURNS', dpQ.cx, Z(480), '#38bdf8', 2.2);

    // Outbound Dispatch Staging Pallets & Boxes
    this.box(this.groups.struct, this.materials.pallet, X(838), 0.08, Z(508), 1.8, 0.16, 1.6);
    this.box(this.groups.struct, this.materials.carton, X(838), 0.45, Z(508), 1.3, 0.55, 1.2);
    this.box(this.groups.struct, this.materials.carton2, X(838), 0.85, Z(508), 0.8, 0.45, 0.8);

    this.box(this.groups.struct, this.materials.pallet, X(888), 0.08, Z(508), 1.8, 0.16, 1.6);
    this.box(this.groups.struct, this.materials.carton3, X(888), 0.45, Z(508), 1.3, 0.55, 1.2);
    this.box(this.groups.struct, this.materials.carton, X(888), 0.85, Z(508), 0.8, 0.45, 0.8);

    this.createGroundText('DISPATCH STAGING', X(863), Z(518), '#38bdf8', 1.5);

    // Lightweight Dispatch Staging Racks along East perimeter
    this.buildLightweightStagingRack(X(926), Z(505), 3.4, 0.8, 3);
    this.buildLightweightStagingRack(X(926), Z(550), 3.2, 0.8, 3);

    // Dispatch Roller Conveyor
    this.buildRollerConveyor(X(852), Z(494), X(892), Z(494), 11, 3);

    // Return Inspection Workstation
    this.buildInspectionWorkstation(X(820), Z(545));
    this.createGroundText('RETURN INSPECTION', X(820), Z(568), '#f59e0b', 1.4);

    // Return Hold & Sorting Pallet
    this.box(this.groups.struct, this.materials.pallet, X(880), 0.08, Z(555), 1.8, 0.16, 1.6);
    this.box(this.groups.struct, this.materials.carton, X(880), 0.45, Z(555), 1.2, 0.5, 1.2);
    this.box(this.groups.struct, this.materials.carton3, X(880), 0.85, Z(555), 0.7, 0.4, 0.7);
    this.createGroundText('RETURN HOLD', X(880), Z(572), '#fbbf24', 1.4);

    // AMR HOME AREA (Top-Right Corner - Permanent 5 AMR Parking Bays)
    const homeAreaRect = [712, 16, 938, 106];
    const homeQ = this.rc(...homeAreaRect);
    const homeFloorMat = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.22, depthWrite: false });
    const homePlane = new THREE.Mesh(new THREE.PlaneGeometry(homeQ.w, homeQ.d), homeFloorMat);
    homePlane.rotation.x = -Math.PI / 2;
    homePlane.position.set(homeQ.cx, 0.08, homeQ.cz);
    this.groups.zones.add(homePlane);

    this.createGroundText('AMR HOME AREA', homeQ.cx, Z(30), '#38bdf8', 2.4);

    // Exactly 5 Distinct Parking Bays inside AMR Home Area (HOME-01 to HOME-05)
    const homeSlots = [
      { id: 'AMR-01', px: 755, pz: 50, col: 0x38bdf8, label: 'HOME-01 (AMR-01)' },
      { id: 'AMR-02', px: 830, pz: 50, col: 0xf59e0b, label: 'HOME-02 (AMR-02)' },
      { id: 'AMR-03', px: 905, pz: 50, col: 0x10b981, label: 'HOME-03 (AMR-03)' },
      { id: 'AMR-04', px: 775, pz: 82, col: 0xa855f7, label: 'HOME-04 (AMR-04)' },
      { id: 'AMR-05', px: 885, pz: 82, col: 0xf43f5e, label: 'HOME-05 (AMR-05)' }
    ];

    homeSlots.forEach(slot => {
      const slotWidth = 2.4;
      const slotDepth = 3.0;
      const slotMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(slotWidth, slotDepth),
        new THREE.MeshBasicMaterial({ color: slot.col, transparent: true, opacity: 0.12, depthWrite: false })
      );
      slotMesh.rotation.x = -Math.PI / 2;
      slotMesh.position.set(X(slot.px), 0.09, Z(slot.pz));
      this.groups.zones.add(slotMesh);

      const slotBoxEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(slotWidth, slotDepth)),
        new THREE.LineBasicMaterial({ color: slot.col })
      );
      slotBoxEdges.rotation.x = -Math.PI / 2;
      slotBoxEdges.position.set(X(slot.px), 0.10, Z(slot.pz));
      this.groups.zones.add(slotBoxEdges);

      this.createGroundText(slot.label, X(slot.px), Z(slot.pz) + 1.25, '#' + slot.col.toString(16).padStart(6, '0'), 1.2);
    });

    // Structural & Aisle Labels
    this.createGroundText('RECEIVING (INBOUND)', X(124), Z(55), '#38bdf8', 2.0);
    this.createGroundText('CENTRAL JUNCTION', X(530), Z(295), '#f59e0b', 2.2);
    this.createGroundText('AISLE A', X(294), Z(200), '#94a3b8', 2.0);
    this.createGroundText('AISLE B', X(457), Z(200), '#94a3b8', 2.0);
    this.createGroundText('AISLE C', X(622), Z(200), '#94a3b8', 2.0);
    this.createGroundText('AISLE D', X(812), Z(200), '#94a3b8', 2.0);
    this.createGroundText('MAINTENANCE HUB', X(124), Z(535), '#38bdf8', 2.0);
    this.createGroundText('DISPATCH & RETURNS', X(870), Z(535), '#38bdf8', 2.0);

    // Build Navigation Debug Layer
    this.buildNavDebugMeshes();

    // Freeze static world matrices so Three.js doesn't traverse & recalculate static meshes every frame
    this.freezeStaticMatrices();
  }

  freezeStaticMatrices() {
    const staticGroups = [this.groups.struct, this.groups.racks, this.groups.lanes, this.groups.zones, this.groups.labels];
    for (const grp of staticGroups) {
      grp.traverse(obj => {
        if (obj.isMesh || obj.isLine || obj.isLineSegments) {
          obj.matrixAutoUpdate = false;
          obj.updateMatrix();
        }
      });
    }
  }

  buildRack(x1, y1, x2, y2, levels = 4) {
    const q = this.rc(x1, y1, x2, y2);
    const nBays = Math.max(2, Math.round(q.d / 1.8));
    const baySpacing = q.d / nBays;
    const heights = [0.3, 1.2, 2.1, 3.0];

    // Upright posts (Primary Industrial Orange #E8751A)
    for (let i = 0; i <= nBays; i++) {
      for (const sx of [-1, 1]) {
        this.box(this.groups.racks, this.materials.rack, q.cx + sx * (q.w / 2 - 0.08), 1.7, q.cz - q.d / 2 + i * baySpacing, 0.16, 3.5, 0.16);
      }
      // Diagonal cross-bracing ties (Dark Support #C95D12)
      if (i < nBays) {
        this.box(this.groups.racks, this.materials.rackDark, q.cx, 1.7, q.cz - q.d / 2 + (i + 0.5) * baySpacing, 0.06, 3.2, 0.06);
      }
    }

    // Horizontal shelf load beams (Light Beam #F28A2E) and wire mesh decking
    for (let l = 0; l < levels; l++) {
      const y = heights[l] + 0.05;
      // Front and back longitudinal load beams (Safety Orange #F28A2E)
      for (const sx of [-1, 1]) {
        this.box(this.groups.racks, this.materials.beam, q.cx + sx * (q.w / 2 - 0.08), y, q.cz, 0.1, 0.12, q.d);
      }

      // Shelf Wire Mesh / Decking plates for each bay
      for (let i = 0; i < nBays; i++) {
        const cz = q.cz - q.d / 2 + (i + 0.5) * baySpacing;
        this.box(this.groups.racks, this.materials.dark, q.cx, y + 0.04, cz, q.w * 0.92, 0.04, baySpacing * 0.94);
      }
    }
  }

  buildPackingWorkstation(worldX, worldZ, label = 'PACKING WORKSTATION', boxMat = null) {
    const tableW = 2.4;
    const tableD = 1.3;
    const legH = 0.86;
    const legW = 0.08;

    // 4 Tubular steel legs
    const xOffsets = [-tableW / 2 + legW, tableW / 2 - legW];
    const zOffsets = [-tableD / 2 + legW, tableD / 2 - legW];
    for (const sx of xOffsets) {
      for (const sz of zOffsets) {
        this.box(this.groups.struct, this.materials.steelDark, worldX + sx, legH / 2, worldZ + sz, legW, legH, legW);
      }
    }

    // Steel lower frame perimeter
    this.box(this.groups.struct, this.materials.steelDark, worldX, legH - 0.05, worldZ - tableD / 2 + legW, tableW - legW * 2, 0.06, 0.06);
    this.box(this.groups.struct, this.materials.steelDark, worldX, legH - 0.05, worldZ + tableD / 2 - legW, tableW - legW * 2, 0.06, 0.06);
    this.box(this.groups.struct, this.materials.steelDark, worldX - tableW / 2 + legW, legH - 0.05, worldZ, 0.06, 0.06, tableD - legW * 2);
    this.box(this.groups.struct, this.materials.steelDark, worldX + tableW / 2 - legW, legH - 0.05, worldZ, 0.06, 0.06, tableD - legW * 2);

    // Antistatic / maple laminated tabletop
    this.box(this.groups.struct, this.materials.white, worldX, legH + 0.04, worldZ, tableW, 0.08, tableD);

    // Rear upright posts for upper accessories
    const postH = 0.95;
    this.box(this.groups.struct, this.materials.steelDark, worldX - tableW / 2 + legW, legH + postH / 2 + 0.08, worldZ - tableD / 2 + legW, 0.06, postH, 0.06);
    this.box(this.groups.struct, this.materials.steelDark, worldX + tableW / 2 - legW, legH + postH / 2 + 0.08, worldZ - tableD / 2 + legW, 0.06, postH, 0.06);

    // Upper metal accessory shelf
    this.box(this.groups.struct, this.materials.steel, worldX, legH + postH + 0.06, worldZ - tableD / 2 + 0.18, tableW - 0.1, 0.04, 0.35);

    // Tape dispenser (red/steel)
    this.box(this.groups.struct, this.materials.tapeRed, worldX + 0.7, legH + 0.15, worldZ + 0.25, 0.2, 0.14, 0.3);
    this.box(this.groups.struct, this.materials.steel, worldX + 0.7, legH + 0.17, worldZ + 0.38, 0.12, 0.08, 0.04);

    // Barcode scanner / tablet terminal on swivel arm
    this.box(this.groups.struct, this.materials.steelDark, worldX - 0.7, legH + 0.25, worldZ - 0.2, 0.04, 0.4, 0.04);
    this.box(this.groups.struct, this.materials.screenBlue, worldX - 0.7, legH + 0.45, worldZ - 0.15, 0.42, 0.28, 0.04);

    // Cardboard carton on table
    const cartonMat = boxMat || this.materials.carton;
    this.box(this.groups.struct, cartonMat, worldX, legH + 0.34, worldZ + 0.05, 0.7, 0.52, 0.55);
    // Dark tape stripe on carton
    this.box(this.groups.struct, this.materials.dark, worldX, legH + 0.605, worldZ + 0.05, 0.71, 0.015, 0.1);
  }

  buildRollerConveyor(startX, startZ, endX, endZ, numRollers = 10, numCartons = 2) {
    const len = Math.hypot(endX - startX, endZ - startZ);
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    const angle = Math.atan2(endZ - startZ, endX - startX);
    const conveyorW = 1.0;
    const convH = 0.65;

    const convGroup = new THREE.Group();
    convGroup.position.set(midX, 0, midZ);
    convGroup.rotation.y = -angle;

    // Legs
    const legSpacing = len / 3;
    for (let i = 0; i <= 3; i++) {
      const lx = -len / 2 + i * legSpacing;
      for (const sz of [-conveyorW / 2 + 0.05, conveyorW / 2 - 0.05]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, convH, 0.08), this.materials.steelDark);
        leg.position.set(lx, convH / 2, sz);
        leg.castShadow = true;
        convGroup.add(leg);
      }
    }

    // Side channel rails (Industrial Blue)
    for (const sz of [-conveyorW / 2, conveyorW / 2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.05), this.materials.stagingFrame);
      rail.position.set(0, convH + 0.02, sz);
      rail.castShadow = true;
      convGroup.add(rail);
    }

    // Rollers
    const rollerSpacing = len / (numRollers + 1);
    for (let r = 1; r <= numRollers; r++) {
      const rx = -len / 2 + r * rollerSpacing;
      const rollerGeom = new THREE.CylinderGeometry(0.04, 0.04, conveyorW - 0.08, 12);
      const roller = new THREE.Mesh(rollerGeom, this.materials.steel);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(rx, convH + 0.02, 0);
      roller.castShadow = true;
      convGroup.add(roller);
    }

    // Parcels moving on conveyor
    for (let c = 0; c < numCartons; c++) {
      const cx = -len / 3 + c * (len / (numCartons + 0.5));
      const mat = c % 2 === 0 ? this.materials.carton : this.materials.carton2;
      const carton = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.48), mat);
      carton.position.set(cx, convH + 0.25, 0);
      carton.castShadow = true;
      convGroup.add(carton);

      // Shipping label
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.14), this.materials.white);
      label.rotation.x = -Math.PI / 2;
      label.position.set(cx, convH + 0.462, 0.05);
      convGroup.add(label);
    }

    this.groups.struct.add(convGroup);
  }

  buildPackingMaterialRack(worldX, worldZ) {
    const rackW = 2.2;
    const rackD = 0.8;
    const rackH = 2.2;
    const legW = 0.06;

    // 4 Corner posts
    for (const sx of [-rackW / 2 + legW, rackW / 2 - legW]) {
      for (const sz of [-rackD / 2 + legW, rackD / 2 - legW]) {
        this.box(this.groups.struct, this.materials.steelDark, worldX + sx, rackH / 2, worldZ + sz, legW, rackH, legW);
      }
    }

    // 3 Open wire/steel shelves
    const shelfHeights = [0.3, 1.05, 1.8];
    shelfHeights.forEach((sh, idx) => {
      this.box(this.groups.struct, this.materials.steel, worldX, sh, worldZ, rackW, 0.04, rackD);

      if (idx === 0) {
        // Shelf 1: Stacks of flat folded cardboard carton blanks
        this.box(this.groups.struct, this.materials.carton, worldX - 0.4, sh + 0.14, worldZ, 0.9, 0.24, 0.65);
        this.box(this.groups.struct, this.materials.carton2, worldX + 0.45, sh + 0.12, worldZ, 0.8, 0.20, 0.6);
      } else if (idx === 1) {
        // Shelf 2: Cylindrical rolls of protective bubble wrap
        [-0.5, 0.5].forEach(bx => {
          const rollMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.65, 16), this.materials.bubbleWrap);
          rollMesh.rotation.z = Math.PI / 2;
          rollMesh.position.set(worldX + bx, sh + 0.24, worldZ);
          rollMesh.castShadow = true;
          this.groups.struct.add(rollMesh);
        });
      } else if (idx === 2) {
        // Shelf 3: Extra rolls of packaging tape and small parts bins
        this.box(this.groups.struct, this.materials.tapeRed, worldX - 0.5, sh + 0.1, worldZ, 0.4, 0.16, 0.3);
        this.box(this.groups.struct, this.materials.dark, worldX + 0.4, sh + 0.1, worldZ, 0.6, 0.16, 0.35);
      }
    });
  }

  buildWeighingStation(worldX, worldZ) {
    // Low-profile heavy floor weighing scale platform
    const scaleW = 1.3;
    const scaleD = 1.3;
    const scaleH = 0.10;
    this.box(this.groups.struct, this.materials.steelDark, worldX, scaleH / 2, worldZ, scaleW, scaleH, scaleD);
    this.box(this.groups.struct, this.materials.steel, worldX, scaleH + 0.01, worldZ, scaleW * 0.92, 0.02, scaleD * 0.92);

    // Hazard yellow/black platform border
    const borderGeom = new THREE.EdgesGeometry(new THREE.PlaneGeometry(scaleW, scaleD));
    const borderLine = new THREE.LineSegments(borderGeom, new THREE.LineBasicMaterial({ color: 0xfacc15 }));
    borderLine.rotation.x = -Math.PI / 2;
    borderLine.position.set(worldX, scaleH + 0.02, worldZ);
    this.groups.zones.add(borderLine);

    // Indicator display post
    const postX = worldX - scaleW / 2 - 0.15;
    const postZ = worldZ;
    this.box(this.groups.struct, this.materials.steelDark, postX, 0.65, postZ, 0.06, 1.3, 0.06);
    this.box(this.groups.struct, this.materials.dark, postX, 1.3, postZ, 0.32, 0.22, 0.12);
    this.box(this.groups.struct, this.materials.screenLed, postX, 1.3, postZ + 0.065, 0.24, 0.12, 0.02);

    // Cardboard carton being weighed on scale platform
    this.box(this.groups.struct, this.materials.carton3, worldX, scaleH + 0.3, worldZ, 0.65, 0.55, 0.58);
    this.createGroundText('PACKAGE WEIGHING', worldX, worldZ + 1.1, '#38bdf8', 1.2);
  }

  buildSealingStation(worldX, worldZ) {
    const w = 1.1;
    const d = 0.9;
    const h = 0.82;

    // Machine base cabinet
    this.box(this.groups.struct, this.materials.barrier, worldX, h / 2, worldZ, w, h, d);
    // Tabletop stainless surface
    this.box(this.groups.struct, this.materials.steel, worldX, h + 0.02, worldZ, w, 0.04, d);

    // Yellow strapping arch guide
    const archH = 0.95;
    this.box(this.groups.struct, this.materials.yellow, worldX - w / 2 + 0.06, h + archH / 2, worldZ, 0.08, archH, 0.08);
    this.box(this.groups.struct, this.materials.yellow, worldX + w / 2 - 0.06, h + archH / 2, worldZ, 0.08, archH, 0.08);
    this.box(this.groups.struct, this.materials.yellow, worldX, h + archH, worldZ, w, 0.08, 0.08);

    // Carton inside sealing machine
    this.box(this.groups.struct, this.materials.carton, worldX, h + 0.32, worldZ, 0.62, 0.55, 0.52);
  }

  buildLightweightStagingRack(worldX, worldZ, length = 3.6, depth = 0.8, levels = 3) {
    const legW = 0.06;
    const postH = 2.0;

    // 4 Corner vertical posts (Industrial Blue)
    for (const sx of [-length / 2 + legW, length / 2 - legW]) {
      for (const sz of [-depth / 2 + legW, depth / 2 - legW]) {
        this.box(this.groups.struct, this.materials.stagingFrame, worldX + sx, postH / 2, worldZ + sz, legW, postH, legW);
      }
    }

    // Shelves with sorted parcels
    const shelfHeights = [0.3, 0.95, 1.6];
    shelfHeights.forEach((sh, lIdx) => {
      this.box(this.groups.struct, this.materials.steel, worldX, sh, worldZ, length, 0.04, depth);

      // Groups of sorted parcels on each shelf
      const numBoxes = Math.round(length / 0.9);
      for (let b = 0; b < numBoxes; b++) {
        const bx = worldX - length / 2 + (b + 0.5) * (length / numBoxes);
        const mat = (lIdx + b) % 2 === 0 ? this.materials.carton : this.materials.carton2;
        this.box(this.groups.struct, mat, bx, sh + 0.22, worldZ, 0.55, 0.40, 0.5);
      }
    });
  }

  buildInspectionWorkstation(worldX, worldZ) {
    const tableW = 2.4;
    const tableD = 1.3;
    const legH = 0.86;
    const legW = 0.08;

    // 4 Legs
    for (const sx of [-tableW / 2 + legW, tableW / 2 - legW]) {
      for (const sz of [-tableD / 2 + legW, tableD / 2 - legW]) {
        this.box(this.groups.struct, this.materials.steelDark, worldX + sx, legH / 2, worldZ + sz, legW, legH, legW);
      }
    }

    // Heavy-duty tabletop
    this.box(this.groups.struct, this.materials.white, worldX, legH + 0.04, worldZ, tableW, 0.08, tableD);

    // QA Inspection screen
    this.box(this.groups.struct, this.materials.steelDark, worldX - 0.7, legH + 0.25, worldZ - 0.2, 0.04, 0.4, 0.04);
    this.box(this.groups.struct, this.materials.screenBlue, worldX - 0.7, legH + 0.45, worldZ - 0.15, 0.45, 0.3, 0.04);

    // Handheld scanner & inspection checklist tray
    this.box(this.groups.struct, this.materials.dark, worldX + 0.7, legH + 0.1, worldZ + 0.2, 0.35, 0.08, 0.25);

    // Opened returned carton box on table
    this.box(this.groups.struct, this.materials.carton, worldX, legH + 0.32, worldZ, 0.65, 0.48, 0.52);
  }

  createGroundText(text, x, z, color = '#ffffff', size = 2.0, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Rounded contrast background pill
    const padX = 24;
    const padY = 24;
    const w = canvas.width - padX * 2;
    const h = canvas.height - padY * 2;
    ctx.fillStyle = options.bgColor || 'rgba(11, 19, 31, 0.88)';
    ctx.strokeStyle = options.borderColor || color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(padX, padY, w, h, 36);
    } else {
      ctx.rect(padX, padY, w, h);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 80px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, options.yOffset !== undefined ? options.yOffset : 0.14, z);
    this.groups.labels.add(mesh);
    return mesh;
  }

  buildAmrMeshes() {
    this.fleet.amrs.forEach(amr => {
      const group = new THREE.Group();
      group.userData = { isAmr: true, amrId: amr.id };

      const colHex = amr.colorInfo.colorNum;
      const amrBodyMat = new THREE.MeshStandardMaterial({ color: colHex, metalness: 0.5, roughness: 0.25 });
      const darkChassisMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });

      // Main differential drive chassis (2.4m length x 1.6m width x 0.55m height)
      this.box(group, amrBodyMat, 0, 0.35, 0, 1.6, 0.42, 2.2);
      this.box(group, darkChassisMat, 0, 0.14, 0, 1.65, 0.18, 2.25);

      // Yellow/Black front bumper hazard stripe
      const bumper = this.box(group, this.materials.yellow, 0, 0.25, 1.14, 1.5, 0.25, 0.08);

      // Drive wheels
      [-0.86, 0.86].forEach(x => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 20), darkChassisMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.28, 0);
        group.add(wheel);
      });

      // Rotating Lidar scanner disc puck on top
      const lidarPuck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.18, 20),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 })
      );
      lidarPuck.position.set(0, 0.65, 0.65);
      group.add(lidarPuck);
      group.userData.lidarPuck = lidarPuck;

      // Status LED Halo Ring around chassis perimeter
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const haloRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 28), ringMat);
      haloRing.rotation.x = Math.PI / 2;
      haloRing.position.set(0, 0.24, 0);
      group.add(haloRing);
      group.userData.haloRingMat = ringMat;

      // Mechanical Lifting Platform on top of AMR
      const liftPlatform = new THREE.Group();
      liftPlatform.position.set(0, 0.45, -0.1);
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
      this.box(liftPlatform, plateMat, 0, 0.04, 0, 1.5, 0.08, 1.4);
      
      // Hydraulic lift guide posts
      const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
      [-0.5, 0.5].forEach(px => {
        [-0.4, 0.4].forEach(pz => {
          this.box(liftPlatform, postMat, px, -0.12, pz, 0.08, 0.24, 0.08);
        });
      });
      group.add(liftPlatform);
      group.userData.liftPlatform = liftPlatform;

      // 3D Floating Billboard Sprite Label above AMR (High-Res 512x160)
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 512;
      labelCanvas.height = 160;
      const labelCtx = labelCanvas.getContext('2d');
      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.anisotropy = 4;
      labelTex.generateMipmaps = true;
      labelTex.minFilter = THREE.LinearMipmapLinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 2.5, 0);
      sprite.scale.set(5.2, 1.62, 1);
      group.add(sprite);

      this.amrLabels.set(amr.id, { sprite, canvas: labelCanvas, ctx: labelCtx, texture: labelTex });

      // Position
      group.position.set(amr.position.x, 0, amr.position.z);
      this.groups.amrs.add(group);
      amr.mesh3d = group;
    });
  }

  buildBoxMeshes() {
    // Clear any existing box meshes
    while (this.groups.boxes.children.length > 0) {
      this.groups.boxes.remove(this.groups.boxes.children[0]);
    }

    if (!this.fleet.boxManager) return;

    const cartonMats = [this.materials.carton, this.materials.carton2, this.materials.carton3];

    this.fleet.boxManager.getBoxes().forEach((box, idx) => {
      const boxGroup = new THREE.Group();
      boxGroup.userData = { isBox: true, boxId: box.id };

      // Wooden pallet base (1.35m x 0.12m x 1.35m)
      this.box(boxGroup, this.materials.pallet, 0, 0.06, 0, 1.35, 0.12, 1.35);

      // Natural Cardboard Carton with weight-based proportion
      const heightScale = Math.max(0.65, Math.min(1.15, box.weight / 250.0));
      const boxHeight = 0.75 * heightScale;
      const cartonMat = cartonMats[idx % cartonMats.length];
      this.box(boxGroup, cartonMat, 0, 0.12 + boxHeight / 2, 0, 1.15, boxHeight, 1.15);

      // Black vertical strapping reinforcement bands
      const strapMat = this.materials.dark;
      [-0.35, 0.35].forEach(sx => {
        this.box(boxGroup, strapMat, sx, 0.12 + boxHeight / 2, 0, 0.04, boxHeight + 0.01, 1.16);
      });
      [-0.35, 0.35].forEach(sz => {
        this.box(boxGroup, strapMat, 0, 0.12 + boxHeight / 2, sz, 1.16, boxHeight + 0.01, 0.04);
      });

      // 3D Floating Label Sprite above box (384x128)
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 384;
      labelCanvas.height = 128;
      const labelCtx = labelCanvas.getContext('2d');
      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.anisotropy = 4;
      labelTex.minFilter = THREE.LinearMipmapLinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 0.25 + boxHeight + 0.6, 0);
      sprite.scale.set(3.2, 1.05, 1);
      boxGroup.add(sprite);

      this.boxLabels.set(box.id, { sprite, canvas: labelCanvas, ctx: labelCtx, texture: labelTex });

      // Position at shelf height
      boxGroup.position.set(box.shelfPosition.x, box.shelfPosition.y, box.shelfPosition.z);
      this.groups.boxes.add(boxGroup);
      box.mesh3d = boxGroup;
    });
  }

  updateBoxBillboard(box, force = false) {
    const info = this.boxLabels.get(box.id);
    if (!info) return;

    const displayKey = `${box.status}_${box.weight}_${box.shelfLevel || 1}_${box.carriedBy || 'none'}`;
    if (!force && info.lastKey === displayKey) return;
    info.lastKey = displayKey;

    const { ctx, texture } = info;
    ctx.clearRect(0, 0, 384, 128);

    let borderColor = '#38bdf8';
    let statusText = box.status;
    if (box.status === 'AVAILABLE') borderColor = '#10b981';
    else if (box.status === 'RESERVED') borderColor = '#f59e0b';
    else if (box.status === 'IN_TRANSIT' || box.status === 'BEING_PICKED') borderColor = '#38bdf8';
    else if (box.status === 'DELIVERED') borderColor = '#a855f7';
    else if (box.status === 'EXCEPTION') borderColor = '#ef4444';

    // Rounded tag
    ctx.fillStyle = 'rgba(11, 19, 31, 0.92)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(10, 10, 364, 108, 20);
    } else {
      ctx.rect(10, 10, 364, 108);
    }
    ctx.fill();
    ctx.stroke();

    // Box ID & Weight
    ctx.font = 'bold 36px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${box.id} (${box.weight}kg)`, 192, 50);

    // Rack Shelf & Status pill
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillStyle = borderColor;
    const rackLabel = box.rackId ? `${box.rackId}-S${box.shelfLevel || 1} • ` : '';
    ctx.fillText(`${rackLabel}${statusText}`, 192, 92);

    texture.needsUpdate = true;
  }

  updateAmrBillboard(amr, force = false) {
    const info = this.amrLabels.get(amr.id);
    if (!info) return;

    const displayStatus = amr.getDisplayStatus ? amr.getDisplayStatus() : amr.state;
    const displayKey = `${displayStatus}_${Math.round(amr.battery)}_${amr.carriedBox ? amr.carriedBox.id : 'none'}_${amr.wifiConnected}_${amr.wifiDirectActive}`;
    if (!force && info.lastKey === displayKey) return;
    info.lastKey = displayKey;

    const { ctx, texture } = info;
    ctx.clearRect(0, 0, 512, 160);

    // Pill background
    ctx.fillStyle = 'rgba(11, 19, 31, 0.94)';
    ctx.strokeStyle = amr.colorInfo.hex;
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(14, 14, 484, 132, 26);
    } else {
      ctx.rect(14, 14, 484, 132);
    }
    ctx.fill();
    ctx.stroke();

    // Text ID & Battery %
    ctx.font = 'bold 44px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${amr.id}  [${amr.battery.toFixed(0)}%]`, 256, 70);

    // State Badge
    ctx.font = 'bold 28px "Inter", sans-serif';
    if (amr.state === 'EMERGENCY' || amr.state === 'LOW_BATTERY') {
      ctx.fillStyle = '#ef4444';
    } else if (amr.carriedBox || amr.state === 'MOVING' || amr.state === 'SAFE_EVACUATION') {
      ctx.fillStyle = '#10b981';
    } else if (amr.state === 'WAITING' || amr.state === 'PREEMPTIVE_HOLD' || amr.state === 'SCHEDULED_WAIT' || amr.state === 'PREEMPTIVE_YIELD' || amr.materialHandlingState !== 'NONE') {
      ctx.fillStyle = '#f59e0b';
    } else if (amr.state === 'PLANNING' || amr.state === 'REPLANNING') {
      ctx.fillStyle = '#38bdf8';
    } else if (amr.state === 'IDLE' && amr.isAtHome && amr.isAtHome()) {
      ctx.fillStyle = '#38bdf8';
    } else {
      ctx.fillStyle = '#94a3b8';
    }
    ctx.fillText(displayStatus, 256, 120);

    texture.needsUpdate = true;
  }

  setupInteractions() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };

    this.canvas.addEventListener('pointerdown', e => {
      isDragging = false;
      dragStart = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener('pointermove', e => {
      const dx = Math.abs(e.clientX - dragStart.x);
      const dy = Math.abs(e.clientY - dragStart.y);
      if (dx > 4 || dy > 4) isDragging = true;
      if (e.buttons === 1) {
        // Orbit rotate
        this.orbit.th -= (e.movementX || 0) * 0.005;
        this.orbit.ph = Math.min(1.5, Math.max(0.001, this.orbit.ph - (e.movementY || 0) * 0.005));
        this.orbit.animTarget = null;
      } else if (e.buttons === 2 || e.shiftKey) {
        // Pan
        const s = this.orbit.rad * 0.0012;
        this.orbit.target.x -= (e.movementX * Math.cos(this.orbit.th) + e.movementY * Math.sin(this.orbit.th) * Math.cos(this.orbit.ph)) * s;
        this.orbit.target.z += (e.movementX * Math.sin(this.orbit.th) - e.movementY * Math.cos(this.orbit.th) * Math.cos(this.orbit.ph)) * s;
        this.orbit.animTarget = null;
      }
    });

    this.canvas.addEventListener('pointerup', e => {
      if (!isDragging) {
        this.handlePointerClick(e);
      }
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.orbit.rad = Math.min(350, Math.max(15, this.orbit.rad * (1 + e.deltaY * 0.001)));
      this.orbit.animTarget = null;
    }, { passive: false });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  handlePointerClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 1. Check AMR click
    const amrIntersects = this.raycaster.intersectObjects(this.groups.amrs.children, true);
    if (amrIntersects.length > 0) {
      let obj = amrIntersects[0].object;
      while (obj && !obj.userData.amrId) obj = obj.parent;
      if (obj && obj.userData.amrId && this.onAmrClickCallback) {
        this.onAmrClickCallback(obj.userData.amrId);
        return;
      }
    }

    // 2. Check Floor click (for click-to-inject menu)
    const floorIntersects = this.raycaster.intersectObjects(this.groups.struct.children, true);
    if (floorIntersects.length > 0) {
      const hit = floorIntersects[0];
      if (this.onFloorClickCallback) {
        this.onFloorClickCallback({
          worldX: hit.point.x,
          worldZ: hit.point.z,
          screenX: e.clientX,
          screenY: e.clientY
        });
      }
    }
  }

  setView(mode) {
    this.viewMode = mode;
    const bounds = this.computeWarehouseBounds();
    this.updateCameraTargets(bounds);
    const target = this.cameraTargets[mode];
    if (target) {
      this.orbit.animTarget = { ...target };
    }
  }

  toggleLayer(layerName, visible) {
    this.layerVisibility[layerName] = visible;
    if (this.groups[layerName]) {
      this.groups[layerName].visible = visible;
    }
    if (layerName === 'vehicles') this.groups.amrs.visible = visible;
    if (layerName === 'boxes') this.groups.boxes.visible = visible;
    if (layerName === 'hazards') this.groups.hazards.visible = visible;
    if (layerName === 'paths') this.groups.paths.visible = visible;
    if (layerName === 'zones') this.groups.zones.visible = visible;
    if (layerName === 'labels') this.groups.labels.visible = visible;
    if (layerName === 'navDebug') this.groups.navDebug.visible = visible;
  }

  buildNavDebugMeshes() {
    const group = this.groups.navDebug;
    group.visible = !!this.layerVisibility.navDebug;

    // 1. GREEN = Drivable Lane Centerlines / Navigation Graph Edges
    const edgeDrawn = new Set();
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x10b981, // Green
      transparent: true,
      opacity: 0.75,
      linewidth: 2
    });

    for (const [key, edge] of this.graph.edges) {
      const pairKey = [edge.from, edge.to].sort().join('--');
      if (edgeDrawn.has(pairKey)) continue;
      edgeDrawn.add(pairKey);

      const nodeU = this.graph.getNode(edge.from);
      const nodeV = this.graph.getNode(edge.to);
      if (!nodeU || !nodeV) continue;

      const points = [
        new THREE.Vector3(nodeU.x, 0.12, nodeU.z),
        new THREE.Vector3(nodeV.x, 0.12, nodeV.z)
      ];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geom, lineMat);
      group.add(line);
    }

    // 2. BLUE = Navigation Graph Nodes
    const nodeGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12);
    const nodeMats = {
      CHARGING: new THREE.MeshBasicMaterial({ color: 0x10b981 }),
      SAFE_ZONE: new THREE.MeshBasicMaterial({ color: 0x10b981 }),
      GATE: new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
      JUNCTION: new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
      AISLE: new THREE.MeshBasicMaterial({ color: 0x0284c7 }),
      DEFAULT: new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    };

    for (const [id, node] of this.graph.nodes) {
      let mat = nodeMats.DEFAULT;
      if (node.isChargingStation || node.isSafeZone) mat = nodeMats.CHARGING;
      else if (node.isGate) mat = nodeMats.GATE;
      else if (node.isWaitingBay || id.includes('INTERSECTION') || id.includes('HUB') || id.includes('JUNCTION')) mat = nodeMats.JUNCTION;
      else if (node.zone && node.zone.startsWith('AISLE')) mat = nodeMats.AISLE;

      const mesh = new THREE.Mesh(nodeGeom, mat);
      mesh.position.set(node.x, 0.16, node.z);
      group.add(mesh);
    }

    // 3. RED = Blocked Rack Areas / Obstacle Footprint Polygons
    const rackObstacleMat = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.9 });
    const rackFillMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.16, depthWrite: false });

    RACK_OBSTACLES.forEach(rack => {
      const q = this.rc(rack.x1, rack.z1, rack.x2, rack.z2);
      // Floor fill
      const fillPlane = new THREE.Mesh(new THREE.PlaneGeometry(q.w, q.d), rackFillMat);
      fillPlane.rotation.x = -Math.PI / 2;
      fillPlane.position.set(q.cx, 0.11, q.cz);
      group.add(fillPlane);

      // Perimeter line
      const boxEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(q.w, q.d)),
        rackObstacleMat
      );
      boxEdges.rotation.x = -Math.PI / 2;
      boxEdges.position.set(q.cx, 0.12, q.cz);
      group.add(boxEdges);
    });

    // 4. RED / AMBER = Blocked Wall Obstacle Perimeters
    const wallObstacleMat = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.85 });
    WALL_OBSTACLES.forEach(wall => {
      const q = this.rc(wall.x1, wall.z1, wall.x2, wall.z2);
      const wallEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(q.w, q.d)),
        wallObstacleMat
      );
      wallEdges.rotation.x = -Math.PI / 2;
      wallEdges.position.set(q.cx, 0.12, q.cz);
      group.add(wallEdges);
    });

    // 5. Valid Navigation Portals (Designated Road Entrances)
    const portalMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.4 });
    VALID_PORTALS.forEach(portal => {
      const pw = (portal.width || 4.0) * S;
      const pMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, 0.6), portalMat);
      pMesh.rotation.x = -Math.PI / 2;
      pMesh.position.set(X(portal.px), 0.14, Z(portal.pz));
      group.add(pMesh);
    });
  }

  /**
   * Main Render Tick
   */
  render(time, dt) {
    // 1. Update Camera Position
    if (this.viewMode === 'follow') {
      const selectedAmr = this.fleet.getSelectedAmr();
      if (selectedAmr) {
        this._tempFollowVec.set(selectedAmr.position.x, 0.5, selectedAmr.position.z);
        this.orbit.target.lerp(this._tempFollowVec, 0.1);
      }
    }

    if (this.orbit.animTarget) {
      const t = this.orbit.animTarget;
      this.orbit.th += (t.th - this.orbit.th) * 0.08;
      this.orbit.ph += (t.ph - this.orbit.ph) * 0.08;
      this.orbit.rad += (t.rad - this.orbit.rad) * 0.08;
      this.orbit.target.x += (t.x - this.orbit.target.x) * 0.08;
      this.orbit.target.z += (t.z - this.orbit.target.z) * 0.08;

      if (Math.abs(this.orbit.rad - t.rad) < 0.2) {
        this.orbit.animTarget = null;
      }
    }

    const { th, ph, rad, target } = this.orbit;
    this.camera.position.set(
      target.x + rad * Math.sin(ph) * Math.sin(th),
      target.y + rad * Math.cos(ph),
      target.z + rad * Math.sin(ph) * Math.cos(th)
    );
    this.camera.lookAt(target);

    // 2. Update AMR visual states (LED halo, lidar spin, lift platform, billboard)
    for (const amr of this.fleet.amrs) {
      if (amr.mesh3d) {
        // Lidar spin
        if (amr.mesh3d.userData.lidarPuck) {
          amr.mesh3d.userData.lidarPuck.rotation.y += dt * 8.0;
        }

        // Lift platform smooth height interpolation
        if (amr.mesh3d.userData.liftPlatform) {
          const targetPlatformY = 0.45 + (amr.liftProgress * 0.30);
          amr.mesh3d.userData.liftPlatform.position.y = targetPlatformY;
        }

        // LED Halo Color
        if (amr.mesh3d.userData.haloRingMat) {
          let ringColor = 0x10b981; // Green normal
          if (amr.state === 'EMERGENCY' || amr.state === 'LOW_BATTERY') ringColor = 0xef4444; // Red
          else if (amr.state === 'WAITING' || amr.state === 'PREEMPTIVE_HOLD' || amr.state === 'SCHEDULED_WAIT' || amr.state === 'PREEMPTIVE_YIELD' || amr.materialHandlingState !== 'NONE') ringColor = 0xf59e0b; // Yellow/Amber during hold or lift
          else if (amr.carriedBox) ringColor = 0x38bdf8; // Sky blue during box transit
          else if (amr.state === 'PLANNING' || amr.state === 'REPLANNING') ringColor = 0x38bdf8;
          else if (!amr.wifiConnected || amr.wifiDirectActive) ringColor = 0xa855f7; // Purple

          amr.mesh3d.userData.haloRingMat.color.setHex(ringColor);
        }

        // Update floating text badge (dirty-checked)
        this.updateAmrBillboard(amr);
      }
    }

    // 3. Update Physical 3D Box Positions & Status Badges
    if (this.fleet.boxManager) {
      const boxes = this.fleet.boxManager.getBoxes();
      for (const box of boxes) {
        if (box.mesh3d) {
          if (box.status === 'BEING_PICKED') {
            const carrier = this.fleet.getAmr(box.carriedBy);
            if (carrier) {
              const p = carrier.liftProgress || 0.0;
              const shelf = box.shelfPosition;
              // Smooth transfer from rack shelf onto AMR lift platform
              box.mesh3d.position.x = shelf.x + (carrier.position.x - shelf.x) * p;
              box.mesh3d.position.z = shelf.z + (carrier.position.z - shelf.z) * p;
              box.mesh3d.position.y = shelf.y + ((0.45 + p * 0.30) - shelf.y) * p;
              box.mesh3d.rotation.y = carrier.heading * p;
            }
          } else if (box.status === 'IN_TRANSIT') {
            const carrier = this.fleet.getAmr(box.carriedBy);
            if (carrier) {
              box.mesh3d.position.x = carrier.position.x;
              box.mesh3d.position.z = carrier.position.z;
              box.mesh3d.position.y = 0.45 + (carrier.liftProgress * 0.30) + (box.liftOffsetY || 0.0);
              box.mesh3d.rotation.y = carrier.heading;
            }
          } else if (box.status === 'DELIVERED') {
            box.mesh3d.position.x = box.position.x;
            box.mesh3d.position.z = box.position.z;
            box.mesh3d.position.y = box.position.y !== undefined ? box.position.y : 0.08;
            box.mesh3d.rotation.y = 0;
          } else {
            // AVAILABLE, RESERVED, EXCEPTION: resting on its designated rack shelf
            box.mesh3d.position.x = box.shelfPosition.x;
            box.mesh3d.position.z = box.shelfPosition.z;
            box.mesh3d.position.y = box.shelfPosition.y;
            box.mesh3d.rotation.y = 0;
          }
          this.updateBoxBillboard(box);
        }
      }
    }

    // 4. Update Dynamic Hazards 3D Meshes
    this.updateHazardMeshes(time);

    // 5. Update Active Paths Visualizations (cached in-place line updates)
    this.updatePathVisualizations();

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  }

  updateHazardMeshes(time) {
    const active = this.fleet.scenarios.activeHazards;

    // Remove obsolete meshes
    const currentHazardIds = new Set(active.map(h => h.id));
    for (let i = this.groups.hazards.children.length - 1; i >= 0; i--) {
      const child = this.groups.hazards.children[i];
      if (!currentHazardIds.has(child.userData.hazardId)) {
        this.groups.hazards.remove(child);
      }
    }

    // Add or animate active hazards
    active.forEach(h => {
      let mesh = this.groups.hazards.children.find(c => c.userData.hazardId === h.id);
      if (!mesh) {
        mesh = new THREE.Group();
        mesh.userData.hazardId = h.id;
        mesh.position.set(h.x, 0, h.z);

        if (h.type === 'FIRE') {
          // Fire Flame Cone + Glowing Smoke Aura
          const fireCone = new THREE.Mesh(
            new THREE.ConeGeometry(h.radius * 0.4, 4.0, 16),
            new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.85 })
          );
          fireCone.position.y = 2.0;
          mesh.add(fireCone);
          mesh.userData.fireCone = fireCone;

          const ring = new THREE.Mesh(
            new THREE.RingGeometry(h.radius * 0.9, h.radius, 32),
            new THREE.MeshBasicMaterial({ color: 0xef4444, side: 2, transparent: true, opacity: 0.6 })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.1;
          mesh.add(ring);
        } else if (h.type === 'WIFI_DEAD_ZONE') {
          // Wi-Fi Dead Zone Ring Ripples
          [0.4, 0.7, 1.0].forEach(factor => {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(h.radius * factor - 0.2, h.radius * factor, 32),
              new THREE.MeshBasicMaterial({ color: 0xa855f7, side: 2, transparent: true, opacity: 0.5 })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.12;
            mesh.add(ring);
          });
        } else if (h.type === 'BLOCKED_AISLE') {
          // Red cross obstruction & fallen boxes
          const boxMat = new THREE.MeshStandardMaterial({ color: 0xb45309 });
          this.box(mesh, boxMat, 0, 0.45, 0, 1.6, 0.9, 1.6);
          const crossMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
          [-0.785, 0.785].forEach(ang => {
            const b = this.box(mesh, crossMat, 0, 0.15, 0, 3.2, 0.1, 0.4);
            b.rotation.y = ang;
          });
        }

        this.groups.hazards.add(mesh);
      }

      // Pulse animation
      const pulse = 0.85 + 0.25 * Math.sin(time * 4);
      if (mesh.userData.fireCone) {
        mesh.userData.fireCone.scale.set(pulse, pulse * 1.1, pulse);
      }
    });
  }

  updatePathVisualizations() {
    const showPaths = this.layerVisibility.paths;
    const showDebug = this.layerVisibility.navDebug;

    for (const amr of this.fleet.amrs) {
      let pData = this.amrPathMeshes.get(amr.id);
      if (!pData) {
        pData = { line: null, beacon: null, bubble: null, lastRouteKey: null };
        this.amrPathMeshes.set(amr.id, pData);
      }

      // 1. Safety Bubble (navDebug)
      if (showDebug) {
        if (!pData.bubble) {
          const bubbleGeom = new THREE.RingGeometry(0.76, 0.80, 24);
          const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xf97316, side: 2, transparent: true, opacity: 0.7 });
          pData.bubble = new THREE.Mesh(bubbleGeom, bubbleMat);
          pData.bubble.rotation.x = -Math.PI / 2;
          this.groups.paths.add(pData.bubble);
        }
        pData.bubble.position.set(amr.position.x, 0.15, amr.position.z);
        pData.bubble.visible = true;
      } else if (pData.bubble) {
        pData.bubble.visible = false;
      }

      // 2. Active Route Waypoint Path & Destination Beacon
      const route = amr.activeRoute;
      const idx = amr.trajectoryIndex || 0;
      const hasActivePath = showPaths && route && route.length > 0 && idx < route.length;

      if (hasActivePath) {
        const remainingNodes = route.slice(idx);
        const routeKey = `${amr.id}:${remainingNodes.join('->')}`;

        if (pData.lastRouteKey !== routeKey) {
          // Dispose old line and beacon
          if (pData.line) {
            this.groups.paths.remove(pData.line);
            pData.line.geometry.dispose();
            pData.line = null;
          }
          if (pData.beacon) {
            this.groups.paths.remove(pData.beacon);
            pData.beacon.geometry.dispose();
            pData.beacon = null;
          }

          const points = [];
          points.push(new THREE.Vector3(amr.position.x, 0.22, amr.position.z));
          for (let i = idx; i < route.length; i++) {
            const node = this.graph.getNode(route[i]);
            if (node) {
              points.push(new THREE.Vector3(node.x, 0.22, node.z));
            }
          }

          if (points.length > 1) {
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineBasicMaterial({
              color: amr.colorInfo.colorNum,
              linewidth: 3,
              transparent: true,
              opacity: 0.95
            });
            pData.line = new THREE.Line(geom, mat);
            this.groups.paths.add(pData.line);

            // Glowing destination node beacon
            const destNodeId = route[route.length - 1];
            const destNode = this.graph.getNode(destNodeId);
            if (destNode) {
              const destBeacon = new THREE.Mesh(
                new THREE.RingGeometry(0.35, 0.55, 16),
                new THREE.MeshBasicMaterial({ color: amr.colorInfo.colorNum, side: 2, transparent: true, opacity: 0.85 })
              );
              destBeacon.rotation.x = -Math.PI / 2;
              destBeacon.position.set(destNode.x, 0.23, destNode.z);
              pData.beacon = destBeacon;
              this.groups.paths.add(destBeacon);
            }
          }
          pData.lastRouteKey = routeKey;
        } else if (pData.line) {
          // Route nodes unchanged — simply update start vertex position in-place with zero memory allocation
          const posAttr = pData.line.geometry.attributes.position;
          if (posAttr && posAttr.count > 0) {
            posAttr.setXYZ(0, amr.position.x, 0.22, amr.position.z);
            posAttr.needsUpdate = true;
          }
        }
      } else {
        // No path active — hide/clear path meshes for this AMR
        if (pData.line) {
          this.groups.paths.remove(pData.line);
          pData.line.geometry.dispose();
          pData.line = null;
        }
        if (pData.beacon) {
          this.groups.paths.remove(pData.beacon);
          pData.beacon.geometry.dispose();
          pData.beacon = null;
        }
        pData.lastRouteKey = null;
      }
    }
  }
}
