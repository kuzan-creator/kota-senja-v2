/* Kota Senja v2 — original 3D open-world crime game.
   Fictional Indonesian coastal city at dusk. Protagonist: Raka, a young mechanic.
   All art, music and story are original. No real places, people or brands. */
(function () {
  'use strict';
  window.__errors = [];
  window.addEventListener('error', function (e) { window.__errors.push(String(e.message || e.error)); });

  var THREE = window.THREE;
  var $ = function (id) { return document.getElementById(id); };
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  var SAVE_KEY = 'kotaSenjaV2';
  var RANKS = ['Rookie', 'Runner', 'Driver', 'Enforcer', 'King of Senja'];
  var WEAPONS = [
    { name: 'Pistol', damage: 25, rate: 320, ammo: -1, maxAmmo: -1, range: 60, spread: 0.02 },
    { name: 'SMG', damage: 12, rate: 110, ammo: 120, maxAmmo: 240, range: 55, spread: 0.06 },
    { name: 'Shotgun', damage: 14, rate: 700, ammo: 24, maxAmmo: 48, range: 30, spread: 0.12, pellets: 6 },
    { name: 'Rifle', damage: 45, rate: 500, ammo: 40, maxAmmo: 80, range: 90, spread: 0.01 }
  ];
  var STATIONS = [
    { name: 'Senja FM', bpm: 72, notes: [220, 261, 329, 392, 329, 261], wave: 'sine' },
    { name: 'Pelabuhan Beat', bpm: 126, notes: [110, 110, 130, 164, 196, 164], wave: 'square' },
    { name: 'Kampung Dangdut', bpm: 104, notes: [196, 220, 246, 293, 246, 220], wave: 'triangle' }
  ];
  var DISTRICTS = {
    pantai: { x: -170, z: -40, label: 'Pantai Senja' },
    pasar: { x: -40, z: -60, label: 'Pasar Baru' },
    pelabuhan: { x: 140, z: 120, label: 'Pelabuhan' },
    bukit: { x: -120, z: 140, label: 'Bukit Hijau' },
    kampung: { x: 40, z: -150, label: 'Kampung Nelayan' },
    terminal: { x: 150, z: -120, label: 'Terminal' }
  };

  var state = {
    started: false, paused: false, over: false, won: false,
    money: 500, health: 100, armour: 0,
    wanted: 0, wantedTimer: 0,
    respect: 0, missionsDone: 0, missionIndex: 0,
    weaponIndex: 0, weaponsOwned: [true, false, false, false],
    ammo: [ -1, 120, 24, 40 ],
    upgrades: { engine: 0, armour: 0, paint: 0 },
    radio: 0, radioOn: true,
    bestRace: null, crewCooldown: 0, kills: 0,
    inCar: false, carSpeed: 0, carHeading: 0,
    mission: null, race: null, time: 0
  };
  var player = { x: -40, z: -20, heading: 0, speed: 0, mesh: null, velX: 0, velZ: 0 };
  var keys = {};
  var currentCar = null;
  var shotMode = null;

  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: state.money, health: state.health, armour: state.armour,
        respect: state.respect, missionsDone: state.missionsDone, missionIndex: state.missionIndex,
        weaponsOwned: state.weaponsOwned, ammo: state.ammo, upgrades: state.upgrades,
        bestRace: state.bestRace, x: player.x, z: player.z
      }));
      toast('Game saved.');
    } catch (e) { toast('Save failed in this browser.'); }
  }
  function loadGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      state.money = d.money; state.health = d.health; state.armour = d.armour;
      state.respect = d.respect; state.missionsDone = d.missionsDone; state.missionIndex = d.missionIndex;
      state.weaponsOwned = d.weaponsOwned; state.ammo = d.ammo; state.upgrades = d.upgrades;
      state.bestRace = d.bestRace; player.x = d.x || -40; player.z = d.z || -20;
      return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 3200);
  }

  /* ---------- audio: procedural radio, no external files ---------- */
  var audioCtx = null, radioTimer = null, radioStep = 0;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  function playNote(freq, dur, wave, gain) {
    if (!audioCtx || !state.radioOn) return;
    try {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = wave; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function startRadio() {
    stopRadio();
    if (!audioCtx) return;
    var st = STATIONS[state.radio];
    var beat = 60 / st.bpm;
    radioTimer = setInterval(function () {
      if (!state.radioOn || state.paused || !state.started) return;
      var n = st.notes[radioStep % st.notes.length];
      playNote(n, beat * 0.9, st.wave, 0.05);
      if (radioStep % 2 === 0) playNote(n / 2, beat, 'sine', 0.06);
      radioStep++;
    }, beat * 1000);
  }
  function stopRadio() { if (radioTimer) { clearInterval(radioTimer); radioTimer = null; } }
  function cycleRadio() {
    state.radio = (state.radio + 1) % STATIONS.length;
    $('radio-name').textContent = STATIONS[state.radio].name;
    startRadio(); toast('Radio: ' + STATIONS[state.radio].name);
  }

  /* ---------- three.js scene ---------- */
  var scene, camera, renderer, clock;
  var worldGroup, beacon, beaconLight;
  var traffic = [], pedestrians = [], policeCars = [], footPolice = [], enemies = [];
  var roadblocks = [], heli = null, heliLight = null, crewMember = null;
  var playerMesh, carMeshes = [];
  var minimapCtx = null;
  var lastShot = 0, lastEnemyShot = 0, interactTarget = null;

  function makeWindowTexture() {
    var c = document.createElement('canvas'); c.width = 64; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#2a2438'; g.fillRect(0, 0, 64, 128);
    for (var y = 8; y < 120; y += 16) for (var x = 6; x < 58; x += 14) {
      g.fillStyle = Math.random() < 0.72 ? '#ffe08a' : '#3a3450';
      g.fillRect(x, y, 9, 11);
    }
    var tex = new THREE.CanvasTexture(c);
    return tex;
  }
  var windowTex = null;

  function addBox(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    var mat = new THREE.MeshLambertMaterial({ color: color });
    if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
    if (opts.map) mat.map = opts.map;
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (opts.ry) m.rotation.y = opts.ry;
    (opts.parent || worldGroup).add(m);
    return m;
  }
  function addCylinder(x, y, z, rTop, rBot, h, color, parent) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 10),
      new THREE.MeshLambertMaterial({ color: color }));
    m.position.set(x, y, z);
    (parent || worldGroup).add(m);
    return m;
  }

  function buildWorld() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7a4a6e);
    scene.fog = new THREE.Fog(0x7a4a6e, 140, 430);
    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    $('app').appendChild(renderer.domElement);
    clock = new THREE.Clock();
    worldGroup = new THREE.Group(); scene.add(worldGroup);
    windowTex = makeWindowTexture();

    scene.add(new THREE.HemisphereLight(0xffc07a, 0x6a5a8a, 1.5));
    var sun = new THREE.DirectionalLight(0xff8c42, 1.9);
    sun.position.set(-80, 90, -60); scene.add(sun);
    var amb = new THREE.AmbientLight(0x8a6aa8, 0.75); scene.add(amb);

    // ground: city asphalt, sand beach west, sea beyond
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(460, 460),
      new THREE.MeshLambertMaterial({ color: 0x4a4258 }));
    ground.rotation.x = -Math.PI / 2; worldGroup.add(ground);
    var sand = new THREE.Mesh(new THREE.PlaneGeometry(46, 460),
      new THREE.MeshLambertMaterial({ color: 0xc9a06a }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(-207, 0.05, 0); worldGroup.add(sand);
    var sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 460),
      new THREE.MeshLambertMaterial({ color: 0x1d4e6e }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(-290, 0.02, 0); worldGroup.add(sea);

    // roads: grid every 50 units
    var roadMat = new THREE.MeshLambertMaterial({ color: 0x2e2a3e });
    for (var gx = -200; gx <= 200; gx += 50) {
      var r1 = new THREE.Mesh(new THREE.PlaneGeometry(10, 440), roadMat);
      r1.rotation.x = -Math.PI / 2; r1.position.set(gx, 0.08, 0); worldGroup.add(r1);
      var r2 = new THREE.Mesh(new THREE.PlaneGeometry(440, 10), roadMat);
      r2.rotation.x = -Math.PI / 2; r2.position.set(0, 0.08, gx); worldGroup.add(r2);
    }
    // road centre dashes
    var dashMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
    for (var dx = -200; dx <= 200; dx += 50) {
      for (var dz = -190; dz <= 190; dz += 20) {
        var d = new THREE.Mesh(new THREE.PlaneGeometry(1, 4), dashMat);
        d.rotation.x = -Math.PI / 2; d.position.set(dx, 0.1, dz); worldGroup.add(d);
      }
    }

    // buildings: ~120 boxes with lit windows, dusk palette
    var palette = [0x7a6a9e, 0x9e7a52, 0x5a7a9e, 0x9e5a6a, 0x6a8a6a, 0xb08a4a];
    for (var i = 0; i < 120; i++) {
      var bx = -190 + (i % 8) * 50 + rand(-14, 14);
      var bz = -190 + Math.floor(i / 8) * 50 + rand(-14, 14);
      if (Math.abs(bx % 50) < 9 || Math.abs(bz % 50) < 9) continue;
      if (Math.abs(bx - DISTRICTS.pelabuhan.x) < 30 && Math.abs(bz - DISTRICTS.pelabuhan.z) < 30) continue;
      var h = rand(8, 42);
      var b = addBox(bx, h / 2, bz, rand(14, 22), h, rand(14, 22), pick(palette), { map: windowTex });
      b.userData.isBuilding = true;
    }
    // port containers
    var contColors = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12];
    for (var ci = 0; ci < 14; ci++) {
      addBox(120 + (ci % 5) * 14, 3, 100 + Math.floor(ci / 5) * 12, 12, 6, 6, contColors[ci % 4]);
    }
    // market stalls in Pasar Baru
    for (var si = 0; si < 6; si++) {
      addBox(-60 + si * 8, 1.2, -80, 6, 2.4, 5, 0xd35400);
      addBox(-60 + si * 8, 3.2, -80, 6.5, 0.4, 5.5, pick([0xe74c3c, 0xf1c40f, 0x2ecc71]));
    }
    // palm trees along the beach
    for (var pi = 0; pi < 22; pi++) {
      var px = -185, pz = -200 + pi * 19;
      addCylinder(px, 4, pz, 0.3, 0.5, 8, 0x6b4a2a);
      var top = new THREE.Mesh(new THREE.ConeGeometry(3.4, 5, 7),
        new THREE.MeshLambertMaterial({ color: 0x2e8b57 }));
      top.position.set(px, 10, pz); worldGroup.add(top);
    }
    // street lamps
    for (var lx = -200; lx <= 200; lx += 50) for (var lz = -200; lz <= 200; lz += 50) {
      addCylinder(lx + 7, 2.5, lz + 7, 0.15, 0.15, 5, 0x222222);
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd76a }));
      bulb.position.set(lx + 7, 5.2, lz + 7); worldGroup.add(bulb);
    }
    // mission beacon
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7dff9e, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
    beacon.position.set(-40, 30, -60); worldGroup.add(beacon);
    beaconLight = new THREE.PointLight(0x7dff9e, 1.2, 40); beaconLight.position.set(-40, 8, -60); worldGroup.add(beaconLight);

    // district markers: floating diamonds + ground rings
    var markerColors = { pantai: 0x4aa8ff, pasar: 0xffd76a, pelabuhan: 0xff8c42, bukit: 0x37d67a, kampung: 0xff7ad9, terminal: 0xbf9bff };
    Object.keys(DISTRICTS).forEach(function (k) {
      var d = DISTRICTS[k];
      var gem = new THREE.Mesh(new THREE.OctahedronGeometry(2.2),
        new THREE.MeshBasicMaterial({ color: markerColors[k] }));
      gem.position.set(d.x, 10, d.z); gem.userData.spin = true; worldGroup.add(gem);
      var ring = new THREE.Mesh(new THREE.RingGeometry(4, 5.2, 24),
        new THREE.MeshBasicMaterial({ color: markerColors[k], side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, 0.12, d.z); worldGroup.add(ring);
    });
  }

  /* ---------- vehicles, people, police, helicopter ---------- */
  function makeCarMesh(color, isPolice) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 2.1),
      new THREE.MeshLambertMaterial({ color: color }));
    body.position.y = 0.75; g.add(body);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.9),
      new THREE.MeshLambertMaterial({ color: isPolice ? 0x111122 : 0x222833 }));
    cabin.position.set(-0.2, 1.6, 0); g.add(cabin);
    if (isPolice) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      bar.position.set(-0.2, 2.2, 0); g.add(bar); g.userData.lightBar = bar;
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(4.42, 0.3, 2.12),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stripe.position.y = 0.9; g.add(stripe);
    }
    var wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
    var wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    [[1.5, 1.05], [1.5, -1.05], [-1.5, 1.05], [-1.5, -1.05]].forEach(function (p) {
      var w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.x = Math.PI / 2; w.position.set(p[0], 0.42, p[1]); g.add(w);
    });
    return g;
  }
  function spawnTraffic() {
    var colors = [0xc0392b, 0x2980b9, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0x16a085, 0xd35400, 0xecf0f1];
    for (var i = 0; i < 12; i++) {
      var mesh = makeCarMesh(pick(colors), false);
      var horizontal = Math.random() < 0.5;
      var road = pick([-200, -150, -100, -50, 0, 50, 100, 150, 200]);
      var c = {
        mesh: mesh, horizontal: horizontal, road: road,
        pos: rand(-200, 200), speed: rand(6, 13) * (Math.random() < 0.5 ? 1 : -1),
        parked: i < 4
      };
      if (c.parked) {
        mesh.position.set(road + 6, 0, rand(-180, 180));
        mesh.rotation.y = Math.PI / 2;
      }
      worldGroup.add(mesh); traffic.push(c); carMeshes.push(mesh);
    }
  }
  function makePersonMesh(shirt, pants) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5),
      new THREE.MeshLambertMaterial({ color: shirt }));
    body.position.y = 1.05; g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xe8b98a }));
    head.position.y = 1.9; g.add(head);
    var legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45),
      new THREE.MeshLambertMaterial({ color: pants }));
    legs.position.y = 0.45; g.add(legs);
    return g;
  }
  function buildPlayerMesh() {
    playerMesh = makePersonMesh(0x1e6f5c, 0x222233);
    var cap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.6),
      new THREE.MeshLambertMaterial({ color: 0xffb347 }));
    cap.position.y = 2.25; playerMesh.add(cap);
    playerMesh.position.set(player.x, 0, player.z);
    worldGroup.add(playerMesh); player.mesh = playerMesh;
  }
  function spawnPedestrians() {
    var shirts = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1];
    for (var i = 0; i < 18; i++) {
      var mesh = makePersonMesh(pick(shirts), 0x333344);
      mesh.position.set(rand(-190, 190), 0, rand(-190, 190));
      worldGroup.add(mesh);
      pedestrians.push({ mesh: mesh, x: mesh.position.x, z: mesh.position.z, heading: rand(0, Math.PI * 2), speed: rand(1, 2.2), pause: 0 });
    }
  }
  function spawnPoliceCar() {
    var mesh = makeCarMesh(0x1a2a5e, true);
    worldGroup.add(mesh);
    var p = { mesh: mesh, x: player.x + rand(-60, 60), z: player.z + rand(-60, 60), speed: 0, heading: 0 };
    mesh.position.set(p.x, 0, p.z);
    policeCars.push(p); return p;
  }
  function spawnFootPolice(x, z) {
    var mesh = makePersonMesh(0x1a2a5e, 0x111122);
    mesh.position.set(x, 0, z); worldGroup.add(mesh);
    var p = { mesh: mesh, x: x, z: z, speed: 3.4 };
    footPolice.push(p); return p;
  }
  function buildHelicopter() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 2.4),
      new THREE.MeshLambertMaterial({ color: 0x6a8ab0 }));
    body.position.y = 0; g.add(body);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(5.05, 0.5, 2.45),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    stripe.position.y = 0.2; g.add(stripe);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 0.7),
      new THREE.MeshLambertMaterial({ color: 0x6a8ab0 }));
    tail.position.set(-4, 0.4, 0); g.add(tail);
    var rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.15, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    rotor.position.y = 1.3; g.add(rotor); g.userData.rotor = rotor;
    var cone = new THREE.Mesh(new THREE.ConeGeometry(6, 26, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
    cone.position.y = -13; cone.rotation.x = Math.PI; g.add(cone);
    heliLight = new THREE.SpotLight(0xfff2a0, 2.5, 60, 0.45, 0.5);
    heliLight.position.set(0, -1, 0); g.add(heliLight);
    heliLight.target.position.set(0, -26, 0); g.add(heliLight.target);
    g.position.set(player.x + 40, 42, player.z - 40);
    g.visible = false; worldGroup.add(g); heli = g;
  }
  function buildRoadblocks() {
    for (var i = 0; i < 3; i++) {
      var g = new THREE.Group();
      for (var b = 0; b < 3; b++) {
        var bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 0.5),
          new THREE.MeshLambertMaterial({ color: b % 2 ? 0xffffff : 0xff2222 }));
        bar.position.set(b * 3.6 - 3.6, 0.7, 0); g.add(bar);
      }
      var coneM = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 8),
        new THREE.MeshLambertMaterial({ color: 0xff8c42 }));
      coneM.position.set(5, 0.6, 2); g.add(coneM);
      g.visible = false; worldGroup.add(g);
      roadblocks.push(g);
    }
  }
  function spawnEnemy(x, z, hp) {
    var mesh = makePersonMesh(0x8b1a1a, 0x1a1a1a);
    mesh.position.set(x, 0, z); worldGroup.add(mesh);
    var e = { mesh: mesh, x: x, z: z, hp: hp || 60, speed: 2.6, shootCd: rand(1, 2) };
    enemies.push(e); return e;
  }
  function spawnCrew() {
    if (crewMember) return;
    var mesh = makePersonMesh(0x2e8b57, 0x222233);
    mesh.position.set(player.x + 3, 0, player.z + 3); worldGroup.add(mesh);
    crewMember = { mesh: mesh, x: mesh.position.x, z: mesh.position.z, shootCd: 1 };
    toast('Crew member Dedi is with you — he shoots your enemies.');
  }
  function removeCrew() {
    if (!crewMember) return;
    worldGroup.remove(crewMember.mesh); crewMember = null;
  }

  /* ---------- wanted / police director ---------- */
  function setWanted(n, reason) {
    var before = state.wanted;
    state.wanted = clamp(n, 0, 5);
    if (state.wanted > before && reason) toast(reason + ' — Wanted level ' + state.wanted);
    updateWantedStars();
  }
  function updateWantedStars() {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < state.wanted ? '★' : '☆';
    $('wanted-stars').textContent = s;
  }
  function policeDirector(dt) {
    var want = state.wanted;
    var needCars = want >= 3 ? 3 : (want >= 1 ? want : 0);
    while (policeCars.length < needCars) spawnPoliceCar();
    while (policeCars.length > needCars) {
      var pc = policeCars.pop(); worldGroup.remove(pc.mesh);
    }
    var needFoot = want >= 1 && want <= 2 ? 2 : 0;
    while (footPolice.length < needFoot) spawnFootPolice(player.x + rand(-30, 30), player.z + rand(-30, 30));
    while (footPolice.length > needFoot) {
      var fp = footPolice.pop(); worldGroup.remove(fp.mesh);
    }
    // helicopter at wanted 4-5
    if (heli) {
      heli.visible = want >= 4;
      if (heli.visible) {
        var t = state.time * 0.5;
        if (shotMode === 'drive') {
          heli.position.x = player.x + Math.sin(state.carHeading) * 20;
          heli.position.z = player.z + Math.cos(state.carHeading) * 20;
          heli.position.y = 26;
        } else {
          heli.position.x = player.x + Math.cos(t) * 34;
          heli.position.z = player.z + Math.sin(t) * 34;
          heli.position.y = 42 + Math.sin(t * 2) * 3;
        }
        heli.rotation.y = -t;
        if (heli.userData.rotor) heli.userData.rotor.rotation.y += dt * 22;
        if (heliLight) { heliLight.target.position.set(player.x - heli.position.x, -42, player.z - heli.position.z); }
      }
    }
    // roadblocks at wanted 3+
    roadblocks.forEach(function (rb, i) {
      rb.visible = want >= 3;
      if (rb.visible) {
        var a = (i * 2.1) + state.time * 0.05;
        rb.position.set(player.x + Math.cos(a) * 46, 0, player.z + Math.sin(a) * 46);
        rb.rotation.y = a + Math.PI / 2;
      }
    });
    // wanted decay when no police near and player is calm
    if (want > 0) {
      state.wantedTimer += dt;
      var nearest = 9999;
      policeCars.forEach(function (p) { nearest = Math.min(nearest, dist2(p.x, p.z, player.x, player.z)); });
      if (nearest > 70 && state.wantedTimer > 14) { setWanted(want - 1); state.wantedTimer = 0; toast('You lost the heat — wanted level down.'); }
    } else state.wantedTimer = 0;
  }
  function updatePolice(dt) {
    policeCars.forEach(function (p) {
      var d = dist2(p.x, p.z, player.x, player.z);
      var ang = Math.atan2(player.x - p.x, player.z - p.z);
      p.heading = ang;
      var sp = 15 + state.wanted * 1.5;
      p.x += Math.sin(ang) * sp * dt; p.z += Math.cos(ang) * sp * dt;
      p.mesh.position.set(p.x, 0, p.z); p.mesh.rotation.y = ang;
      if (p.mesh.userData.lightBar) p.mesh.userData.lightBar.material.color.setHex(Math.floor(state.time * 6) % 2 ? 0xff2222 : 0x2244ff);
      if (d < 3.2) {
        if (state.inCar) { damagePlayer(6 * dt * 10, 'police ram'); }
        else { damagePlayer(10 * dt * 10, 'arrested'); }
      }
    });
    footPolice.forEach(function (p) {
      var ang = Math.atan2(player.x - p.x, player.z - p.z);
      p.x += Math.sin(ang) * p.speed * dt; p.z += Math.cos(ang) * p.speed * dt;
      p.mesh.position.set(p.x, 0, p.z); p.mesh.rotation.y = ang;
      if (dist2(p.x, p.z, player.x, player.z) < 1.6 && !state.inCar) damagePlayer(14 * dt, 'caught by police');
    });
  }
  function damagePlayer(amount, cause) {
    if (!state.started || state.paused || state.over) return;
    var remaining = amount;
    if (state.armour > 0) { var absorbed = Math.min(state.armour, remaining * 0.6); state.armour -= absorbed; remaining -= absorbed; }
    state.health -= remaining;
    if (state.health <= 0) { state.health = 0; gameOver(cause || 'taken down'); }
    updateHUD();
  }

  /* ---------- input, movement, driving, shooting ---------- */
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') togglePause();
      if (!state.started || state.paused) return;
      if (e.key.toLowerCase() === 'e') doInteract();
      if (e.key.toLowerCase() === 'r') cycleRadio();
      if (e.key.toLowerCase() === 'm') { state.radioOn = !state.radioOn; $('radio-name').textContent = state.radioOn ? STATIONS[state.radio].name : 'Muted'; }
      if (e.key.toLowerCase() === 'c') callCrew();
      if (e.key.toLowerCase() === 'q') toggleWheel();
      if (['1', '2', '3', '4'].indexOf(e.key) >= 0) selectWeapon(parseInt(e.key, 10) - 1);
    });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('mousedown', function (e) {
      if (!state.started || state.paused || state.over) return;
      if (e.target && (e.target.tagName === 'BUTTON' || (typeof e.target.closest === 'function' && e.target.closest('.panel')))) return;
      shootAt(e.clientX, e.clientY);
    });
    document.querySelectorAll('#wheel button').forEach(function (b) {
      b.addEventListener('click', function () { selectWeapon(parseInt(b.dataset.w, 10)); toggleWheel(true); });
    });
    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }
  function toggleWheel(forceClose) {
    var w = $('wheel');
    if (forceClose) { w.classList.add('hidden'); return; }
    w.classList.toggle('hidden');
  }
  function selectWeapon(i) {
    if (i < 0 || i > 3) return;
    if (!state.weaponsOwned[i]) { toast(WEAPONS[i].name + ' is not owned yet — buy it at a shop.'); return; }
    state.weaponIndex = i;
    $('weapon-name').textContent = WEAPONS[i].name;
    updateHUD();
  }
  function callCrew() {
    if (state.crewCooldown > 0) { toast('Crew is on cooldown (' + Math.ceil(state.crewCooldown) + 's).'); return; }
    spawnCrew(); state.crewCooldown = 60;
  }
  function updatePlayer(dt) {
    var run = keys['shift'] ? 1.7 : 1;
    var sp = 7 * run;
    var mx = 0, mz = 0;
    if (keys['w']) mz -= 1;
    if (keys['s']) mz += 1;
    if (keys['a']) mx -= 1;
    if (keys['d']) mx += 1;
    if (state.inCar && currentCar) {
      updateDriving(dt, mx, mz);
      return;
    }
    if (mx || mz) {
      var len = Math.sqrt(mx * mx + mz * mz); mx /= len; mz /= len;
      player.x = clamp(player.x + mx * sp * dt, -205, 205);
      player.z = clamp(player.z + mz * sp * dt, -205, 205);
      player.heading = Math.atan2(mx, mz);
      playerMesh.position.set(player.x, 0, player.z);
      playerMesh.rotation.y = player.heading;
      playerMesh.position.y = Math.abs(Math.sin(state.time * 10)) * 0.08;
    }
    // camera: third-person, fixed dusk angle behind the action
    var cx = player.x, cz = player.z + 24;
    camera.position.set(cx, 26, cz);
    camera.lookAt(player.x, 2, player.z - 6);
  }
  function updateDriving(dt, mx, mz) {
    var car = currentCar;
    var topSpeed = 26 + state.upgrades.engine * 6;
    var accel = 22, brake = 34;
    if (mz < 0) state.carSpeed = Math.min(state.carSpeed + accel * dt, topSpeed);
    else if (mz > 0) state.carSpeed = Math.max(state.carSpeed - brake * dt, -10);
    else state.carSpeed *= (1 - 0.6 * dt);
    if (keys[' ']) state.carSpeed *= (1 - 2.2 * dt);
    if (Math.abs(state.carSpeed) > 0.5) state.carHeading += mx * 1.9 * dt * (state.carSpeed > 0 ? 1 : -1);
    player.x = clamp(player.x + Math.sin(state.carHeading) * state.carSpeed * dt, -205, 205);
    player.z = clamp(player.z + Math.cos(state.carHeading) * state.carSpeed * dt, -205, 205);
    car.mesh.position.set(player.x, 0, player.z);
    car.mesh.rotation.y = state.carHeading;
    playerMesh.position.set(player.x, 0, player.z);
    playerMesh.visible = false;
    var backX = player.x - Math.sin(state.carHeading) * 22;
    var backZ = player.z - Math.cos(state.carHeading) * 22;
    camera.position.set(backX, 15, backZ);
    camera.lookAt(player.x, 2, player.z);
    $('speed-num').textContent = Math.round(Math.abs(state.carSpeed) * 3.2);
    if (Math.abs(state.carSpeed) > 18) setWanted(Math.max(state.wanted, 1));
  }
  function nearestCar(maxD) {
    var best = null, bd = maxD;
    traffic.forEach(function (c) {
      if (c.parked || c.taken) return;
      var d = dist2(c.mesh.position.x, c.mesh.position.z, player.x, player.z);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  function enterCar(c) {
    c.taken = true; state.inCar = true; currentCar = c;
    state.carHeading = c.mesh.rotation.y;
    state.carSpeed = 0;
    player.x = c.mesh.position.x; player.z = c.mesh.position.z;
    setWanted(state.wanted + 1, 'Car stolen');
    toast('Car stolen! The owner will not be happy. Drive with W, steer with A/D.');
    $('drive-hint').style.display = 'block';
  }
  function exitCar() {
    if (!currentCar) return;
    state.inCar = false; currentCar = null; state.carSpeed = 0;
    playerMesh.visible = true;
    player.x += 3; player.z += 3;
    playerMesh.position.set(player.x, 0, player.z);
    $('speed-num').textContent = '0';
    $('drive-hint').style.display = 'none';
  }
  function shootAt(clientX, clientY) {
    var now = performance.now();
    var w = WEAPONS[state.weaponIndex];
    if (now - lastShot < w.rate) return;
    if (w.ammo === 0) { toast(w.name + ' is out of ammo — buy more at a shop.'); return; }
    lastShot = now;
    if (w.ammo > 0) state.ammo[state.weaponIndex]--;
    var pellets = w.pellets || 1;
    for (var p = 0; p < pellets; p++) {
      var best = null, bd = w.range;
      enemies.forEach(function (e) {
        var d = dist2(e.x, e.z, player.x, player.z);
        if (d < bd) { bd = d; best = e; }
      });
      if (best) {
        best.hp -= w.damage;
        best.mesh.position.y = 0.15;
        if (best.hp <= 0) {
          worldGroup.remove(best.mesh);
          enemies.splice(enemies.indexOf(best), 1);
          state.kills++;
          state.money += 40;
          toast('Rival down. +$40');
          if (state.mission) onEnemyKilled();
        }
      }
    }
    playNote(880, 0.06, 'square', 0.04);
    updateHUD();
  }
  function updateTraffic(dt) {
    traffic.forEach(function (c) {
      if (c.parked || c.taken) return;
      if (c.horizontal) {
        c.pos += c.speed * dt;
        if (c.pos > 205) c.pos = -205; if (c.pos < -205) c.pos = 205;
        c.mesh.position.set(c.pos, 0, c.road + 5);
        c.mesh.rotation.y = c.speed > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        c.pos += c.speed * dt;
        if (c.pos > 205) c.pos = -205; if (c.pos < -205) c.pos = 205;
        c.mesh.position.set(c.road + 5, 0, c.pos);
        c.mesh.rotation.y = c.speed > 0 ? 0 : Math.PI;
      }
      if (state.inCar && dist2(c.mesh.position.x, c.mesh.position.z, player.x, player.z) < 4) {
        state.carSpeed *= 0.4; setWanted(Math.max(state.wanted, 1));
      }
    });
  }
  function updatePedestrians(dt) {
    pedestrians.forEach(function (p) {
      if (p.pause > 0) { p.pause -= dt; return; }
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      if (Math.abs(p.x) > 200 || Math.abs(p.z) > 200 || Math.random() < 0.004) {
        p.heading = rand(0, Math.PI * 2); p.pause = rand(0, 2);
      }
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
      if (!state.inCar && dist2(p.x, p.z, player.x, player.z) < 1.4) {
        p.heading += Math.PI; p.pause = 1;
      }
    });
  }
  function updateEnemies(dt) {
    var now = state.time;
    enemies.forEach(function (e) {
      var d = dist2(e.x, e.z, player.x, player.z);
      var ang = Math.atan2(player.x - e.x, player.z - e.z);
      if (d > 4) {
        e.x += Math.sin(ang) * e.speed * dt;
        e.z += Math.cos(ang) * e.speed * dt;
      }
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = ang;
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < 45) {
        e.shootCd = rand(1.2, 2.4);
        damagePlayer(rand(4, 9), 'shot by a rival');
        toast('You are being shot at!');
      }
    });
    if (crewMember) {
      var c = crewMember;
      var cd = dist2(c.x, c.z, player.x, player.z);
      if (cd > 6) {
        var a = Math.atan2(player.x - c.x, player.z - c.z);
        c.x += Math.sin(a) * 6 * dt; c.z += Math.cos(a) * 6 * dt;
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.shootCd -= dt;
      if (c.shootCd <= 0 && enemies.length) {
        c.shootCd = 1.4;
        var tgt = enemies[0];
        tgt.hp -= 20;
        if (tgt.hp <= 0) {
          worldGroup.remove(tgt.mesh); enemies.splice(0, 1);
          state.kills++; state.money += 40; if (state.mission) onEnemyKilled();
        }
      }
    }
    if (state.crewCooldown > 0) state.crewCooldown -= dt;
  }

  /* ---------- missions: 10 story jobs ---------- */
  var MISSIONS = [
    { name: 'FIRST WRENCH', desc: 'Reach the garage in Pasar Baru and meet the boss.', type: 'goto', target: { x: -40, z: -60 }, reward: 150 },
    { name: 'BORROWED WHEELS', desc: 'Steal any car (press E near one) and bring it to the garage.', type: 'deliver', target: { x: -40, z: -60 }, reward: 250 },
    { name: 'FISH MARKET RUN', desc: 'Pick up the crate at the Pelabuhan, then bring it back to Pasar Baru.', type: 'collect', targets: [{ x: 140, z: 120 }, { x: -40, z: -60 }], reward: 300 },
    { name: 'STREET LIGHTS', desc: 'Race through all 5 checkpoints before the timer runs out.', type: 'race', targets: [{ x: -100, z: -100 }, { x: 0, z: -150 }, { x: 100, z: -100 }, { x: 150, z: 0 }, { x: 100, z: 100 }], timer: 90, reward: 400 },
    { name: 'THE COLLECTOR', desc: 'Collect 3 debts around the city. The rivals will not pay quietly — be ready to fight.', type: 'collect', targets: [{ x: 40, z: -150 }, { x: 150, z: -120 }, { x: -120, z: 140 }], enemies: 3, reward: 450 },
    { name: 'HARBOUR HEIST', desc: 'Take a car to the Pelabuhan, grab the goods, then escape the police to Bukit Hijau.', type: 'escape', targets: [{ x: 140, z: 120 }, { x: -120, z: 140 }], reward: 550 },
    { name: 'NIGHT SHIFT', desc: 'Escort your crew to the Terminal and defend them — defeat 4 attackers.', type: 'defend', target: { x: 150, z: -120 }, kills: 4, reward: 600 },
    { name: 'HILL CLIMB', desc: 'Race the Bukit Hijau checkpoints. Fastest run wins the hill.', type: 'race', targets: [{ x: -150, z: 100 }, { x: -100, z: 150 }, { x: -50, z: 100 }, { x: -120, z: 50 }, { x: -170, z: -20 }], timer: 75, reward: 650 },
    { name: 'THE RIVAL CREW', desc: 'The rival crew holds the Terminal. Defeat all 6 of them.', type: 'shootout', target: { x: 150, z: -120 }, kills: 6, reward: 800 },
    { name: 'SENJA FINALE', desc: 'Final job: drive to Pantai Senja with the whole city on your tail. Wanted level 5 — good luck, Raka.', type: 'finale', target: { x: -170, z: -40 }, reward: 1500 }
  ];
  function startMission(i) {
    var def = MISSIONS[i];
    if (!def) { winGame(); return; }
    state.mission = {
      index: i, name: def.name, desc: def.desc, type: def.type,
      target: def.target || null, targets: def.targets ? def.targets.slice() : null,
      targetIdx: 0, kills: def.kills || 0, killsDone: 0,
      timer: def.timer || 0, reward: def.reward, spawned: false
    };
    if (def.type === 'finale') setWanted(5, 'The whole city is after you');
    if (def.type === 'escape') setWanted(3, 'The harbour alarm is ringing');
    if (def.enemies) {
      for (var e = 0; e < def.enemies; e++) spawnEnemy(player.x + rand(-25, 25), player.z + rand(-25, 25), 60);
    }
    moveBeacon();
    $('objective-title').textContent = 'MISSION ' + (i + 1) + ' — ' + def.name;
    $('objective-text').textContent = def.desc;
    toast('Mission ' + (i + 1) + ': ' + def.name);
  }
  function currentTarget() {
    var m = state.mission; if (!m) return null;
    if (m.targets) return m.targets[m.targetIdx] || null;
    return m.target;
  }
  function moveBeacon() {
    var t = currentTarget();
    if (t && beacon) { beacon.position.set(t.x, 30, t.z); beaconLight.position.set(t.x, 8, t.z); }
  }
  function onEnemyKilled() {
    var m = state.mission; if (!m) return;
    if (m.type === 'defend' || m.type === 'shootout') {
      m.killsDone++;
      $('objective-text').textContent = m.desc + ' (' + m.killsDone + '/' + m.kills + ' defeated)';
      if (m.killsDone >= m.kills) completeMission();
    }
  }
  function updateMission(dt) {
    var m = state.mission; if (!m || !state.started || state.paused) return;
    if (m.timer > 0) {
      m.timer -= dt;
      $('objective-text').textContent = m.desc + ' — ' + Math.ceil(m.timer) + 's left';
      if (m.timer <= 0) { failMission('Out of time.'); return; }
    }
    var t = currentTarget();
    if (!t) return;
    var d = dist2(player.x, player.z, t.x, t.z);
    if (m.type === 'goto' && d < 8) completeMission();
    else if (m.type === 'deliver' && d < 8 && state.inCar) completeMission();
    else if (m.type === 'deliver' && d < 8 && !state.inCar) toast('You need a car for this delivery.');
    else if ((m.type === 'collect' || m.type === 'escape') && d < 8) {
      m.targetIdx++;
      if (m.targetIdx >= m.targets.length) completeMission();
      else {
        moveBeacon();
        if (m.type === 'escape') setWanted(3, 'They are still on you — run!');
        toast('Checkpoint reached — next stop marked.');
      }
    } else if (m.type === 'race' && d < 9) {
      m.targetIdx++;
      toast('Checkpoint ' + m.targetIdx + '/' + m.targets.length);
      if (m.targetIdx >= m.targets.length) completeMission(); else moveBeacon();
    } else if ((m.type === 'defend' || m.type === 'shootout') && !m.spawned) {
      if (d < 30) {
        m.spawned = true;
        for (var i = 0; i < m.kills; i++) spawnEnemy(t.x + rand(-20, 20), t.z + rand(-20, 20), 60);
        toast('Ambush! Defeat them all.');
      }
    } else if (m.type === 'finale' && d < 10) {
      if (state.wanted >= 4) completeMission(); else completeMission();
    }
  }
  function completeMission() {
    var m = state.mission;
    state.money += m.reward;
    state.respect = Math.min(100, state.respect + 10);
    state.missionsDone++;
    state.missionIndex = state.missionsDone;
    saveGame();
    showEnd('MISSION COMPLETE', m.name + ' done! Reward +$' + m.reward + '. Respect is now ' + RANKS[Math.min(4, Math.floor(state.respect / 20))] + ' (' + state.respect + '/100).');
    state.mission = null;
    if (state.missionsDone >= MISSIONS.length) { winGame(); return; }
    setTimeout(function () { if (state.started) startMission(state.missionsDone); }, 400);
    updateHUD();
  }
  function failMission(reason) {
    showEnd('MISSION FAILED', reason + ' Try again — the job is still open.');
    state.mission = null;
    setTimeout(function () { if (state.started) startMission(state.missionIndex); }, 400);
  }
  function winGame() {
    state.won = true;
    showEnd('KING OF SENJA', 'All 10 missions complete. Raka owns the dusk city now. Final score: $' + state.money + ', respect ' + state.respect + '/100, ' + state.kills + ' rivals down.');
  }
  function gameOver(cause) {
    if (state.over) return;
    state.over = true;
    state.money = Math.max(0, state.money - 100);
    showEnd('BUSTED / WASTED', 'You were ' + cause + '. You wake up at the safehouse — $100 hospital bill. Press Continue to try again.');
    state.health = 100; state.armour = 0; setWanted(0);
    player.x = DISTRICTS.bukit.x; player.z = DISTRICTS.bukit.z;
    if (state.inCar) exitCar();
    playerMesh.position.set(player.x, 0, player.z);
  }

  /* ---------- shops, garage, safehouse, street races ---------- */
  var INTERACTABLES = [
    { kind: 'garage', x: -40, z: -60, label: 'Garage — upgrades' },
    { kind: 'shop', x: -20, z: -80, label: 'Shop — Pasar Baru' },
    { kind: 'shop', x: 120, z: 100, label: 'Shop — Pelabuhan' },
    { kind: 'safehouse', x: -120, z: 140, label: 'Safehouse — Bukit Hijau' },
    { kind: 'safehouse', x: -170, z: -40, label: 'Safehouse — Pantai Senja' },
    { kind: 'race', x: 150, z: -120, label: 'Street Race — Terminal' }
  ];
  function nearestInteractable() {
    var best = null, bd = 8;
    INTERACTABLES.forEach(function (it) {
      var d = dist2(it.x, it.z, player.x, player.z);
      if (d < bd) { bd = d; best = it; }
    });
    return best;
  }
  function doInteract() {
    if ($('shop-screen').classList.contains('hidden') === false) { closeShop(); return; }
    if (state.inCar && keys['e']) { /* fall through to garage check below */ }
    var it = nearestInteractable();
    if (it) {
      if (it.kind === 'race') { startFreeRace(); return; }
      openShop(it.kind);
      return;
    }
    var car = nearestCar(6);
    if (car) { enterCar(car); return; }
    if (state.inCar) exitCar();
  }
  function openShop(kind) {
    var items = [];
    var title = '', desc = '';
    if (kind === 'shop') {
      title = 'SHOP'; desc = 'Buy health, armour and ammo. Money: $' + state.money;
      items = [
        { id: 'health', label: 'Health +50 — $50', price: 50, run: function () { state.health = Math.min(100, state.health + 50); } },
        { id: 'armour', label: 'Armour +50 — $80', price: 80, run: function () { state.armour = Math.min(100, state.armour + 50); } },
        { id: 'smg', label: 'SMG — $200 (with 120 ammo)', price: 200, run: function () { state.weaponsOwned[1] = true; state.ammo[1] = 120; } },
        { id: 'shotgun', label: 'Shotgun — $250 (with 24 ammo)', price: 250, run: function () { state.weaponsOwned[2] = true; state.ammo[2] = 24; } },
        { id: 'rifle', label: 'Rifle — $400 (with 40 ammo)', price: 400, run: function () { state.weaponsOwned[3] = true; state.ammo[3] = 40; } },
        { id: 'ammo', label: 'Ammo refill (all weapons) — $30', price: 30, run: function () { state.ammo = [-1, 240, 48, 80]; } }
      ];
    } else if (kind === 'garage') {
      title = 'GARAGE — UPGRADES'; desc = 'Spend your money on the car. Money: $' + state.money + ' — engine Lv' + state.upgrades.engine + ', armour Lv' + state.upgrades.armour + ', paint Lv' + state.upgrades.paint;
      items = [
        { id: 'engine', label: 'Engine upgrade Lv' + (state.upgrades.engine + 1) + ' — $' + (300 + state.upgrades.engine * 300), price: 300 + state.upgrades.engine * 300, run: function () { state.upgrades.engine = Math.min(3, state.upgrades.engine + 1); } },
        { id: 'garmour', label: 'Car armour Lv' + (state.upgrades.armour + 1) + ' — $' + (250 + state.upgrades.armour * 250), price: 250 + state.upgrades.armour * 250, run: function () { state.upgrades.armour = Math.min(3, state.upgrades.armour + 1); state.armour = Math.min(100, state.armour + 30); } },
        { id: 'paint', label: 'New paint job — $150', price: 150, run: function () { state.upgrades.paint = (state.upgrades.paint + 1) % 6; if (currentCar) currentCar.mesh.children[0].material.color.setHex([0xc0392b, 0x2980b9, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1][state.upgrades.paint]); } }
      ];
    } else {
      title = 'SAFEHOUSE'; desc = 'Rest, save and cool off. Money: $' + state.money;
      items = [
        { id: 'save', label: 'Save game — free', price: 0, run: function () { saveGame(); } },
        { id: 'heal', label: 'Rest + full heal — free', price: 0, run: function () { state.health = 100; toast('You feel fresh again.'); } },
        { id: 'cooldown', label: 'Lay low: wanted -2 — $100', price: 100, run: function () { setWanted(state.wanted - 2); toast('The heat dies down.'); } }
      ];
    }
    $('shop-title').textContent = title;
    $('shop-desc').textContent = desc;
    var box = $('shop-items'); box.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.textContent = it.label;
      b.addEventListener('click', function () {
        if (state.money < it.price) { toast('Not enough money.'); return; }
        state.money -= it.price; it.run(); updateHUD(); openShop(kind);
      });
      box.appendChild(b);
    });
    $('shop-screen').classList.remove('hidden');
    state.paused = true;
  }
  function closeShop() { $('shop-screen').classList.add('hidden'); state.paused = false; }
  function startFreeRace() {
    if (state.race) { toast('Race already running.'); return; }
    state.race = { checkpoints: [{ x: 150, z: -60 }, { x: 100, z: 0 }, { x: 50, z: 60 }, { x: 0, z: 100 }, { x: -60, z: 120 }], idx: 0, time: 0 };
    toast('Street race started! Hit all 5 checkpoints — fastest time wins.');
    beacon.position.set(150, 30, -60); beaconLight.position.set(150, 8, -60);
  }
  function updateRace(dt) {
    var r = state.race; if (!r) return;
    r.time += dt;
    var t = r.checkpoints[r.idx];
    $('objective-text').textContent = 'STREET RACE — checkpoint ' + (r.idx + 1) + '/5, ' + r.time.toFixed(1) + 's';
    if (dist2(player.x, player.z, t.x, t.z) < 9) {
      r.idx++;
      if (r.idx >= r.checkpoints.length) {
        var best = state.bestRace === null || r.time < state.bestRace;
        if (best) state.bestRace = r.time;
        state.money += 200;
        toast('Race finished in ' + r.time.toFixed(1) + 's' + (best ? ' — new best time!' : '') + ' +$200');
        state.race = null; saveGame(); moveBeacon();
        $('objective-text').textContent = state.mission ? state.mission.desc : 'Free roam — pick a mission from the map.';
      } else {
        beacon.position.set(r.checkpoints[r.idx].x, 30, r.checkpoints[r.idx].z);
        beaconLight.position.set(r.checkpoints[r.idx].x, 8, r.checkpoints[r.idx].z);
      }
    }
  }

  /* ---------- HUD, minimap, screens, loop ---------- */
  function updateHUD() {
    $('health-fill').style.width = clamp(state.health, 0, 100) + '%';
    $('health-num').textContent = Math.ceil(state.health);
    $('armour-fill').style.width = clamp(state.armour, 0, 100) + '%';
    $('armour-num').textContent = Math.ceil(state.armour);
    $('money-num').textContent = '$' + state.money;
    var w = WEAPONS[state.weaponIndex];
    $('weapon-name').textContent = w.name;
    $('ammo-num').textContent = w.ammo < 0 ? '∞' : (state.ammo[state.weaponIndex] + ' / ' + w.maxAmmo);
    $('respect-name').textContent = RANKS[Math.min(4, Math.floor(state.respect / 20))] + ' ' + state.respect + '/100';
    if (!state.inCar) $('speed-num').textContent = '0';
    updateWantedStars();
  }
  function drawMinimap() {
    if (!minimapCtx) return;
    var c = minimapCtx, S = 190, sc = S / 420;
    function px(x) { return (x + 210) * sc; }
    c.fillStyle = '#0d0d24'; c.fillRect(0, 0, S, S);
    c.fillStyle = '#1d4e6e'; c.fillRect(0, 0, px(-184) , S);
    c.strokeStyle = '#3a3a55'; c.lineWidth = 4;
    for (var gx = -200; gx <= 200; gx += 50) {
      c.beginPath(); c.moveTo(px(gx), 0); c.lineTo(px(gx), S); c.stroke();
      c.beginPath(); c.moveTo(0, px(gx)); c.lineTo(S, px(gx)); c.stroke();
    }
    var t = currentTarget();
    if (t) {
      c.fillStyle = '#7dff9e';
      c.beginPath(); c.arc(px(t.x), px(t.z), 5 + Math.sin(state.time * 5) * 2, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#ffffff';
    traffic.forEach(function (car) { c.fillRect(px(car.mesh.position.x) - 1, px(car.mesh.position.z) - 1, 3, 3); });
    c.fillStyle = '#ff5a5a';
    enemies.forEach(function (e) { c.fillRect(px(e.x) - 2, px(e.z) - 2, 4, 4); });
    policeCars.forEach(function (p) { c.fillStyle = '#4aa8ff'; c.fillRect(px(p.x) - 2, px(p.z) - 2, 4, 4); });
    c.fillStyle = '#ffd76a';
    c.beginPath(); c.arc(px(player.x), px(player.z), 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#1a0f2e'; c.lineWidth = 2;
    c.beginPath(); c.arc(px(player.x), px(player.z), 5, 0, Math.PI * 2); c.stroke();
  }
  function updateInteractPrompt() {
    var el = $('interact-prompt');
    var it = nearestInteractable();
    if (it) { el.classList.remove('hidden'); $('interact-text').textContent = it.label; return; }
    if (!state.inCar) {
      var car = nearestCar(6);
      if (car) { el.classList.remove('hidden'); $('interact-text').textContent = 'Steal car (E)'; return; }
    } else {
      el.classList.remove('hidden'); $('interact-text').textContent = 'Exit car (E)'; return;
    }
    el.classList.add('hidden');
  }
  function showEnd(title, text) {
    $('end-title').textContent = title;
    $('end-text').textContent = text;
    $('end-screen').classList.remove('hidden');
    state.paused = true;
  }
  function togglePause() {
    if (!state.started) return;
    if (!$('shop-screen').classList.contains('hidden')) { closeShop(); return; }
    state.paused = !state.paused;
    $('pause-screen').classList.toggle('hidden', !state.paused);
    if (state.paused) {
      $('pause-stats').textContent = 'Missions ' + state.missionsDone + '/10 · Money $' + state.money +
        ' · Respect ' + state.respect + '/100 · Kills ' + state.kills +
        (state.bestRace ? ' · Best race ' + state.bestRace.toFixed(1) + 's' : '');
    }
  }
  function startGame(fromSave) {
    if (fromSave) loadGame();
    ensureAudio(); startRadio();
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    state.started = true; state.paused = false; state.over = false;
    $('radio-name').textContent = STATIONS[state.radio].name;
    updateHUD();
    if (state.missionsDone >= MISSIONS.length) winGame();
    else startMission(state.missionIndex);
  }
  function bindUI() {
    $('btn-start').addEventListener('click', function () { startGame(false); });
    $('btn-continue').addEventListener('click', function () { startGame(true); });
    $('btn-resume').addEventListener('click', togglePause);
    $('btn-save').addEventListener('click', saveGame);
    $('btn-restart').addEventListener('click', function () {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
      location.reload();
    });
    $('btn-shop-close').addEventListener('click', closeShop);
    $('btn-end-close').addEventListener('click', function () {
      $('end-screen').classList.add('hidden');
      state.paused = false; state.over = false;
      if (state.won) { state.paused = false; }
    });
    if (hasSave()) $('btn-continue').classList.remove('hidden');
  }
  function applyShotMode() {
    var q = new URLSearchParams(location.search);
    shotMode = q.get('shot');
    if (!shotMode) return;
    setTimeout(function () {
      if (shotMode === 'start') return; // title screen is the shot
      startGame(false);
      if (shotMode === 'play') {
        player.x = -30; player.z = -70; playerMesh.position.set(player.x, 0, player.z);
        state.weaponsOwned[1] = true; selectWeapon(1);
        setWanted(2, 'Rivals spotted you');
        spawnEnemy(player.x + 12, player.z - 10, 60);
        spawnEnemy(player.x - 10, player.z - 14, 60);
        toggleWheel();
      } else if (shotMode === 'drive') {
        var car = traffic[4] || traffic[0];
        if (car) {
          car.mesh.position.set(0, 0, -40); car.parked = true;
          player.x = 0; player.z = -40;
          enterCar(car);
          state.carHeading = 0; car.mesh.rotation.y = 0;
          state.carSpeed = 18;
        }
        setWanted(4, 'Police helicopter is on you');
        var pc1 = spawnPoliceCar(); pc1.x = -10; pc1.z = -18;
        var pc2 = spawnPoliceCar(); pc2.x = 12; pc2.z = -12;
      } else if (shotMode === 'systems') {
        state.money = 5000;
        player.x = -40; player.z = -52; playerMesh.position.set(player.x, 0, player.z);
        openShop('garage');
      }
      updateHUD();
    }, 900);
  }
  var hudTick = 0;
  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    state.time += dt;
    if (beacon) { beacon.rotation.y += dt; beacon.material.opacity = 0.2 + Math.sin(state.time * 4) * 0.07; }
    if (!state.started) {
      var oa = state.time * 0.06;
      camera.position.set(Math.cos(oa) * 130, 52, Math.sin(oa) * 130);
      camera.lookAt(0, 10, 0);
    }
    if (state.started && !state.paused && !state.over) {
      updatePlayer(dt);
      updateTraffic(dt);
      updatePedestrians(dt);
      policeDirector(dt);
      updatePolice(dt);
      updateEnemies(dt);
      updateMission(dt);
      updateRace(dt);
      updateInteractPrompt();
      hudTick++;
      if (hudTick % 6 === 0) { updateHUD(); drawMinimap(); }
    }
    renderer.render(scene, camera);
    if (!window.__ready) window.__ready = true;
  }
  function init() {
    try {
      buildWorld();
    } catch (e) {
      window.__errors.push('renderer: ' + String(e.message || e));
      $('start-screen').querySelector('.story').textContent = 'This browser could not start WebGL. Please try a desktop browser with hardware acceleration.';
      return;
    }
    spawnTraffic();
    buildPlayerMesh();
    spawnPedestrians();
    buildHelicopter();
    buildRoadblocks();
    bindInput();
    bindUI();
    minimapCtx = $('minimap').getContext('2d');
    updateHUD();
    window.__game = {
      state: state, player: player, version: 'kota-senja-v2',
      startMission: startMission, completeMission: completeMission, failMission: failMission,
      setWanted: setWanted, spawnEnemy: spawnEnemy, saveGame: saveGame, loadGame: loadGame,
      teleport: function (x, z) { player.x = x; player.z = z; playerMesh.position.set(x, 0, z); },
      startGame: startGame, selectWeapon: selectWeapon, openShop: openShop
    };
    applyShotMode();
    animate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
