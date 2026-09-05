import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { City } from './world';
import { Ocean } from './ocean';
import { Sky } from './sky';
import { planWave } from './local-water';
import { SunRaysPass } from './sun-rays';
import { Squads, TEAMS } from './squads';
import { DISASTERS, Effects, type DisasterId } from './effects';
import { Sound } from './audio';
import { buildUI, el, icon, selectCard } from './ui';
import './style.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/barlow-condensed/800.css';

buildUI();
const canvas = el<HTMLCanvasElement>('world');
function showError(message: string) { const box = document.createElement('div'); box.className = 'context-error'; const h = document.createElement('h2'); h.textContent = 'Не удалось запустить 3D-город'; const p = document.createElement('p'); p.textContent = message; const b = document.createElement('button'); b.textContent = 'Перезапустить'; b.onclick = () => location.reload(); box.append(h, p, b); document.body.append(box); }
let renderer: T.WebGLRenderer;
try { renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (err) { showError('Нужен браузер с WebGL 2 и включённым аппаратным ускорением. ' + String(err)); throw err; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.info.autoReset = false;
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); showError('Соединение с видеокартой потеряно. Перезапустите игру; для больших карт выберите среднее качество графики.'); });
const scene = new T.Scene(); scene.background = new T.Color('#8aaeb9'); scene.fog = new T.FogExp2('#8aaeb9', .00016);
const camera = new T.PerspectiveCamera(43, innerWidth / innerHeight, 1, 8500);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .07; controls.minDistance = 45; controls.maxDistance = 4400; controls.maxPolarAngle = Math.PI / 2 - .07; controls.minPolarAngle = .13; controls.panSpeed = .8; controls.rotateSpeed = .7; controls.zoomSpeed = .85;
controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.PAN, RIGHT: T.MOUSE.ROTATE }; controls.screenSpacePanning = false; controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
const ambient = new T.HemisphereLight('#cce8ff', '#a79470', 1.35); scene.add(ambient);
const sun = new T.DirectionalLight('#ffe3b9', 3.1); sun.position.set(-330, 620, 400); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -800; sun.shadow.camera.right = 800; sun.shadow.camera.top = 800; sun.shadow.camera.bottom = -800; sun.shadow.camera.far = 2000; sun.shadow.normalBias = 1; sun.shadow.bias = -.00015; scene.add(sun);
const envGenerator = new T.PMREMGenerator(renderer), room = new RoomEnvironment(); const environment = envGenerator.fromScene(room, .04); scene.environment = environment.texture; scene.environmentIntensity = .3; room.dispose(); envGenerator.dispose();
const sky = new Sky(); scene.add(sky);
const ocean = new Ocean(scene, camera);
// Atmospheric landforms beyond the playable islands.
const mountainGroup = new T.Group(); scene.add(mountainGroup);
for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, geo = new T.SphereGeometry(1, 24, 12), pos = geo.attributes.position; for (let k = 0; k < pos.count; k++) { const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k); pos.setY(k, y * (1 + Math.sin(x * 7 + i) * .18 + Math.cos(z * 8) * .15)); } geo.computeVertexNormals(); const rock = new T.Mesh(geo, new T.MeshStandardMaterial({ color: new T.Color().setHSL(.27, .18, .24), roughness: 1 })); rock.scale.set(280 + i % 3 * 130, 60 + i % 4 * 22, 240 + i % 3 * 120); rock.position.set(Math.sin(a) * (2250 + i % 3 * 180), -28, Math.cos(a) * (2250 + i % 3 * 180)); rock.rotation.y = i; mountainGroup.add(rock); }
const target = new T.Group();
const targetRing = new T.Mesh(new T.RingGeometry(.982, 1, 100), new T.MeshBasicMaterial({ color: '#ffc197', transparent: true, opacity: .65, side: T.DoubleSide, depthWrite: false, depthTest: false })); targetRing.rotation.x = -Math.PI / 2; target.add(targetRing);
const innerRing = new T.Mesh(new T.RingGeometry(.31, .315, 50), new T.MeshBasicMaterial({ color: '#ffc197', transparent: true, opacity: .32, side: T.DoubleSide, depthWrite: false })); innerRing.rotation.x = -Math.PI / 2; target.add(innerRing);
const waveArrow = new T.Group(); const arrowMaterial = new T.LineBasicMaterial({ color: '#b1f4ed', depthTest: false, transparent: true, opacity: .9 });
waveArrow.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, -.72), new T.Vector3(0, 0, .65), new T.Vector3(-.16, 0, .4), new T.Vector3(0, 0, .65), new T.Vector3(.16, 0, .4)]), arrowMaterial)); waveArrow.visible = false; target.add(waveArrow);
target.position.y = 1.5; target.visible = false; scene.add(target);
const targetCross = new T.Mesh(new T.RingGeometry(2.2, 2.8, 4), new T.MeshBasicMaterial({ color: '#ffe1be', side: T.DoubleSide, depthWrite: false })); targetCross.rotation.x = -Math.PI / 2; scene.add(targetCross); targetCross.visible = false;
const composer = new EffectComposer(renderer); const renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
const ao = new SSAOPass(scene, camera, innerWidth, innerHeight, 16); ao.kernelRadius = 12; ao.minDistance = .0005; ao.maxDistance = .045; composer.addPass(ao);
const sunRays = new SunRaysPass(scene, camera); composer.addPass(sunRays);
const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), .25, .45, .91); composer.addPass(bloom); composer.addPass(new OutputPass());
let city = new City(scene), sound = new Sound(), effects = new Effects(scene, city, sound);
const squads = new Squads(scene, city, effects); effects.onDeploy = (kind, x, z) => squads.deploy(kind, x, z);
let aimedPlane: T.Group | null = null; let regionMap = false;
let selected: DisasterId = 'meteor', speed = 1, paused = false, simTime = 0, night = 0, nightTarget = 0, dayMode = 0, cinematic = false, preset = 'bay', pendingPreset = 'bay', quality = 'high';
let shakeEnabled = true, flashEnabled = true, sunEnabled = true, raysEnabled = true, toastTimer = 0, fpsFrames = 0, fpsTime = 0, hudClock = 0, mapClock = 0, generating = false, lastNow = performance.now();
const raycaster = new T.Raycaster(), pointer = new T.Vector2(), ground = new T.Plane(new T.Vector3(0, 1, 0), -.8), hitPoint = new T.Vector3(), pressed = new Set<string>();
function homeCamera() { const e = city.extent; camera.position.set(e * 1.48, e * 1.20, e * 1.78); controls.target.set(0, 8, 0); controls.update(); }
homeCamera();
function toast(title: string, description: string, name = 'meteor') { el('toast-title').textContent = title; el('toast-description').textContent = description; el('toast-icon').innerHTML = icon(name); el('toast').classList.add('show'); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el('toast').classList.remove('show'), 3300); }
effects.onEvent = (name, message) => toast(name, message, DISASTERS.find(d => d.name === name)?.icon ?? 'activity');
function setPower(value: number) {
  const input = el<HTMLInputElement>('power'), max = selected === 'nuke' ? 4 : 2;
  effects.power = T.MathUtils.clamp(value, .5, max); input.max = String(max); input.value = String(effects.power);
  el('power-value').textContent = effects.power.toFixed(2).replace(/0$/, '') + '×';
  target.scale.setScalar(DISASTERS.find(d => d.id === selected)!.radius * Math.sqrt(effects.power));
}
function setSelected(id: DisasterId) { selected = id; setPower(effects.power); waveArrow.visible = id === 'tsunami'; el('squad-options').hidden = !id.startsWith('squad_'); el('action-hint').innerHTML = icon('pointer') + (id.startsWith('squad_') ? '<span>Выберите команду. <b>Нажмите на сушу для высадки.</b></span>' : id === 'flood' ? '<span><b>Нажмите на участок:</b> земля просядет и затопится.</span>' : id === 'tsunami' ? '<span><b>Нажмите на зону.</b> Волна пройдёт по стрелке внутри круга.</span>' : '<span>Выберите катастрофу. <b>Нажмите на город.</b></span>'); selectCard(id); const d = DISASTERS.find(d => d.id === id)!; const color = new T.Color(d.color); (targetRing.material as T.MeshBasicMaterial).color.copy(color); (innerRing.material as T.MeshBasicMaterial).color.copy(color); sound.select(); }
function pointAt(x: number, y: number) { const r = canvas.getBoundingClientRect(); pointer.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(pointer, camera); aimedPlane = null; const air = raycaster.intersectObjects(city.planes.filter(p => p.userData.alive), true); if (air.length) { let parent = air[0].object; while (parent.parent && !city.planes.includes(parent as T.Group)) parent = parent.parent; aimedPlane = parent as T.Group; hitPoint.copy(air[0].point); return hitPoint; } const hits = raycaster.intersectObject(city.facade.mesh); if (hits.length) { hitPoint.copy(hits[0].point); hitPoint.y = .8; return hitPoint; } return raycaster.ray.intersectPlane(ground, hitPoint); }
const down = { pointerId: -1, x: 0, y: 0, time: 0, dragged: false, threshold: 7 }; const touches = new Set<number>(); let gesture = false;
function clearPointer() { down.pointerId = -1; down.dragged = false; canvas.classList.remove('dragging'); }
canvas.addEventListener('pointermove', e => {
  // Latch the whole gesture, so dragging back to its start cannot fire a tool.
  if (e.pointerId === down.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) > down.threshold) down.dragged = true;
  if (down.dragged || gesture || (e.pointerType === 'mouse' && (e.buttons & 6))) { canvas.classList.toggle('dragging', e.pointerType === 'mouse'); target.visible = targetCross.visible = false; return; }
  if (pointAt(e.clientX, e.clientY)) { target.position.set(hitPoint.x, Math.max(1.5, effects.waterAt(hitPoint.x, hitPoint.z) + 1), hitPoint.z); if (selected === 'tsunami') { const plan = planWave(city, hitPoint.x, hitPoint.z, effects.power); waveArrow.rotation.y = Math.atan2(plan.dx, plan.dz); } targetCross.position.set(hitPoint.x, 1.6, hitPoint.z); const def = DISASTERS.find(d => d.id === selected)!; target.scale.setScalar(def.radius * Math.sqrt(effects.power)); target.visible = !cinematic && Math.hypot(hitPoint.x, hitPoint.z) < city.worldRadius; targetCross.visible = target.visible; }
});
canvas.addEventListener('pointerleave', () => { target.visible = false; targetCross.visible = false; });
canvas.addEventListener('pointerdown', e => {
  sound.unlock();
  if (e.pointerType === 'touch') { touches.add(e.pointerId); canvas.setPointerCapture(e.pointerId); if (touches.size > 1) { gesture = true; target.visible = targetCross.visible = false; } }
  if (e.button === 0 && down.pointerId === -1) { down.pointerId = e.pointerId; down.x = e.clientX; down.y = e.clientY; down.time = performance.now(); down.dragged = false; down.threshold = e.pointerType === 'touch' ? 10 : 7; }
});
canvas.addEventListener('pointerup', e => {
  if (e.pointerType === 'touch') touches.delete(e.pointerId);
  const tap = e.pointerId === down.pointerId && e.button === 0 && !down.dragged && !gesture && !generating && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= down.threshold && performance.now() - down.time <= 600;
  if (e.pointerId === down.pointerId) clearPointer();
  if (!touches.size) gesture = false;
  canvas.classList.remove('dragging');
  if (!tap) return;
  if (paused) { toast('Симуляция на паузе', 'Нажмите пробел, чтобы продолжить', 'pause'); return; }
  if (pointAt(e.clientX, e.clientY) && Math.hypot(hitPoint.x, hitPoint.z) < city.worldRadius) { if (aimedPlane && !selected.startsWith('squad_') && !['blackhole', 'tornado', 'ufo', 'quake', 'flood', 'tsunami'].includes(selected)) city.destroyPlane(aimedPlane, { x: hitPoint.x - 5, z: hitPoint.z, radius: 45, strength: 170, impulse: true }); effects.trigger(selected, hitPoint.x, hitPoint.z); }
});
canvas.addEventListener('pointercancel', e => { clearPointer(); touches.delete(e.pointerId); gesture = touches.size > 0; });
canvas.addEventListener('lostpointercapture', e => { if (e.pointerId === down.pointerId) clearPointer(); });
window.addEventListener('blur', () => { clearPointer(); touches.clear(); gesture = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
for (const b of document.querySelectorAll<HTMLElement>('[data-disaster]')) b.onclick = () => { sound.unlock(); setSelected(b.dataset.disaster as DisasterId); };
for (const b of document.querySelectorAll<HTMLElement>('[data-category]')) b.onclick = () => {
  for (const tab of document.querySelectorAll('[data-category]')) tab.classList.toggle('active', tab === b);
  for (const card of document.querySelectorAll<HTMLElement>('[data-disaster]')) card.hidden = b.dataset.category !== 'all' && card.dataset.type !== b.dataset.category;
  if (b.dataset.category === 'troops') setSelected('squad_assault');
  else if (b.dataset.category !== 'all') { const first = DISASTERS.find(d => d.category === b.dataset.category); if (first) setSelected(first.id); }
};
for (const b of document.querySelectorAll<HTMLElement>('[data-team]')) b.onclick = () => { squads.team = Number(b.dataset.team); for (const p of document.querySelectorAll<HTMLElement>('[data-team]')) { p.classList.toggle('active', p === b); p.setAttribute('aria-pressed', String(p === b)); } };
el<HTMLInputElement>('power').oninput = e => setPower(Number((e.target as HTMLInputElement).value));
function pause(value = !paused) { paused = value; el('pause').innerHTML = icon(paused ? 'play' : 'pause'); el('pause').setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза'); el('sim-status').textContent = paused ? 'СИМУЛЯЦИЯ НА ПАУЗЕ' : 'СИМУЛЯЦИЯ АКТИВНА'; document.body.classList.toggle('paused-label', paused); }
el('pause').onclick = () => pause();
for (const b of document.querySelectorAll<HTMLElement>('[data-speed]')) b.onclick = () => { speed = Number(b.dataset.speed); pause(false); for (const p of document.querySelectorAll('[data-speed]')) p.classList.toggle('active', p === b); };
el('sound').onclick = () => { sound.unlock(); sound.enabled = !sound.enabled; el('sound').innerHTML = icon(sound.enabled ? 'volume' : 'mute'); el('sound').setAttribute('aria-label', sound.enabled ? 'Выключить звук' : 'Включить звук'); saveSettings(); };
el('help').onclick = () => el<HTMLDialogElement>('help-dialog').showModal(); el('maps').onclick = () => { pendingPreset = preset; el<HTMLDialogElement>('map-dialog').showModal(); }; el('settings').onclick = () => el<HTMLDialogElement>('settings-dialog').showModal();
el('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Полный экран недоступен', 'Разверните окно браузера вручную', 'expand'); } };
el('camera-home').onclick = () => homeCamera();
function toggleCinematic() { cinematic = !cinematic; document.body.classList.toggle('cinematic', cinematic); controls.autoRotate = cinematic; controls.autoRotateSpeed = .28; target.visible = targetCross.visible = false; resize(); }
el('cinematic').onclick = toggleCinematic; el('exit-cinematic').onclick = toggleCinematic;
function setDay(mode: number) { dayMode = mode; nightTarget = mode === 2 ? 1 : mode === 1 ? .38 : 0; el('daytime').innerHTML = icon(mode === 2 ? 'moon' : 'sun'); const desc = preset === 'islands' ? 'Островной город' : 'Прибрежный мегаполис'; el('city-subtitle').innerHTML = `${desc} <span>•</span> ${['Золотой час', 'Сумерки', 'Ночной город'][mode]}`; }
el('daytime').onclick = () => setDay((dayMode + 1) % 3);
for (const b of document.querySelectorAll<HTMLElement>('[data-preset]')) b.onclick = () => { pendingPreset = b.dataset.preset!; for (const p of document.querySelectorAll('[data-preset]')) p.classList.toggle('chosen', p === b); el<HTMLInputElement>('seed').value = { bay: 'NEW-HAVEN', islands: 'ARCHIPELAGO', night: 'NEON-CITY' }[pendingPreset] ?? 'NEW-HAVEN'; };
el('random-seed').onclick = () => { el<HTMLInputElement>('seed').value = `CC-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`; };
async function regenerate(seed: string, size: number, style: string) {
  if (generating) return; generating = true; el('loading').style.display = 'flex'; el('loading').style.opacity = '1';
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  try {
    effects.reset(); city.dispose(); city = new City(scene, seed, size, style === 'islands' ? 'islands' : 'bay'); effects.attachCity(city); squads.reset(city); simTime = 0; preset = style; homeCamera(); setDay(style === 'night' ? 2 : 0); pause(false); updateHUD(); drawMinimap();
    el('city-name').textContent = style === 'islands' ? 'Архипелаг' : style === 'night' ? 'Неон-Сити' : seed === 'NEW-HAVEN' ? 'Нью-Хейвен' : 'Новый горизонт'; el('seed-label').textContent = 'SEED: ' + seed; toast('Город готов', `${city.buildings.length.toLocaleString('ru')} зданий. Чистый лист.`, 'city');
  } catch (e) { showError(String(e)); } finally { generating = false; el('loading').style.opacity = '0'; setTimeout(() => el('loading').style.display = 'none', 500); }
}
el('generate').onclick = () => { const seed = el<HTMLInputElement>('seed').value.trim() || 'NEW-HAVEN'; const size = Number(el<HTMLSelectElement>('map-size').value); el<HTMLDialogElement>('map-dialog').close(); void regenerate(seed, size, pendingPreset); };
el('rebuild').onclick = () => void regenerate(city.seed, city.size, preset);
window.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  pressed.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); if (e.repeat) return;
  if (e.code === 'Space') pause(); if (e.code === 'KeyC') toggleCinematic(); if (e.code === 'KeyH') homeCamera(); if (e.code === 'Escape' && cinematic) toggleCinematic();
  const n = Number(e.key); if (n >= 1 && n <= 9) { const d = DISASTERS[n - 1]; setSelected(d.id); const selectedCard = document.querySelector<HTMLElement>(`[data-disaster="${d.id}"]`)!; if (selectedCard.hidden) document.querySelector<HTMLButtonElement>('[data-category="all"]')!.click(); selectedCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
});
window.addEventListener('keyup', e => pressed.delete(e.code)); window.addEventListener('blur', () => pressed.clear());
function setQuality(value: string, persist = true) { quality = value; renderer.setPixelRatio(Math.min(devicePixelRatio, value === 'high' ? 1.5 : value === 'medium' ? 1 : .75)); renderer.shadowMap.enabled = value !== 'low'; bloom.enabled = value === 'high'; ao.enabled = value === 'high'; sunRays.setQuality(value); renderPass.enabled = true; resize(); if (persist) saveSettings(); }
function saveSettings() { try { localStorage.setItem('crushcity.settings', JSON.stringify({ quality, shakeEnabled, flashEnabled, sunEnabled, raysEnabled, sound: sound.enabled, soundPreferenceVersion: 1, blood: effects.bloodEnabled })); } catch { /* Storage is optional. */ } }
el<HTMLInputElement>('sun-enabled').onchange = e => { sunEnabled = (e.target as HTMLInputElement).checked; saveSettings(); };
el<HTMLInputElement>('rays-enabled').onchange = e => { raysEnabled = (e.target as HTMLInputElement).checked; saveSettings(); };
el<HTMLSelectElement>('quality').onchange = e => setQuality((e.target as HTMLSelectElement).value);
el<HTMLInputElement>('blood-enabled').onchange = e => { effects.setBloodEnabled((e.target as HTMLInputElement).checked); saveSettings(); };
el<HTMLInputElement>('shake-enabled').onchange = e => { shakeEnabled = (e.target as HTMLInputElement).checked; saveSettings(); }; el<HTMLInputElement>('flash-enabled').onchange = e => { flashEnabled = (e.target as HTMLInputElement).checked; saveSettings(); };
try { const s = JSON.parse(localStorage.getItem('crushcity.settings') || '{}'); if (['low', 'medium', 'high'].includes(s.quality)) { el<HTMLSelectElement>('quality').value = s.quality; setQuality(s.quality, false); } if (s.sunEnabled === false) el<HTMLInputElement>('sun-enabled').checked = sunEnabled = false; if (s.raysEnabled === false) el<HTMLInputElement>('rays-enabled').checked = raysEnabled = false; if (s.shakeEnabled === false) el<HTMLInputElement>('shake-enabled').checked = shakeEnabled = false; if (s.flashEnabled === false) el<HTMLInputElement>('flash-enabled').checked = flashEnabled = false; if (s.blood === false) { effects.setBloodEnabled(false); el<HTMLInputElement>('blood-enabled').checked = false; } if (s.soundPreferenceVersion === 1 && s.sound === true) sound.enabled = true; } catch { /* Ignore corrupt settings. */ }
el('sound').innerHTML = icon(sound.enabled ? 'volume' : 'mute'); el('sound').setAttribute('aria-label', sound.enabled ? 'Выключить звук' : 'Включить звук');
function resize() { camera.aspect = innerWidth / innerHeight; if (!cinematic) camera.setViewOffset(innerWidth, innerHeight, 0, Math.min(95, innerHeight * .12), innerWidth, innerHeight); else camera.clearViewOffset(); camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); effects.fire.material.uniforms.uScale.value = innerHeight; effects.smoke.material.uniforms.uScale.value = innerHeight; effects.blood.material.uniforms.uScale.value = innerHeight; effects.sprayWater.material.uniforms.uScale.value = innerHeight; }
window.addEventListener('resize', resize); resize();
function updateHUD() {
  el('population').textContent = Math.max(0, city.population - city.affected).toLocaleString('ru'); el('buildings').textContent = (city.buildings.length - city.destroyed).toLocaleString('ru'); el('damage').innerHTML = city.percent.toFixed(1) + '<span>%</span>'; el('damage-fill').style.height = city.percent + '%';
  const n = effects.events.filter(e => !['ring', 'bolt', 'plume'].includes(e.type)).length;
  el('event-status').textContent = n ? `Активных катастроф: ${n}` : city.destroyed ? `Разрушено зданий: ${city.destroyed}` : 'В городе всё спокойно'; el('event-dot').style.background = n ? '#f6a36b' : '#a0d6a8';
  el('squad-status').hidden = squads.fighters.length === 0; el('squad-status').textContent = squads.summary;
  if (diagnostics) diagnostics.textContent = `SIM ${simTime.toFixed(1)}s | buildings ${city.buildings.length} | destroyed ${city.destroyed} | cars ${city.traffic.filter(c => c.alive).length}/${city.traffic.length} | pedestrians ${city.pedestrians.filter(c => c.alive).length}/${city.pedestrians.length} | planes ${city.planes.filter(c => c.userData.alive).length} | effects ${n} | debris ${effects.debris.length} | car explosions ${effects.carExplosions} | bodies ${effects.bodies.length} | blood ${effects.splats.mesh.count} | waves ${effects.waveCounter} | splashes ${effects.waterImpacts} | impacts ${effects.solidImpacts} | wall hits ${effects.buildingImpacts} | air crashes ${effects.aircraftDestroyed} | lifted cars ${effects.carsLifted} | captured air ${effects.aircraftCaptured} | captured ships ${effects.shipsCaptured} | airborne ${effects.debris.filter(d => !d.resting && !d.removed).length} | squads ${squads.deployed} | troops ${squads.fighters.filter(u => u.alive).length} | shots ${squads.shots} | KIA ${squads.kills} | islands ${city.islands.length} | ferries ${city.ships.filter(s => s.userData.ferry && s.userData.alive).length} | sunk ships ${effects.shipsDestroyed} | docks ${effects.docksDestroyed}/${city.docks.length} | airport ${effects.airportSectionsDestroyed}/${city.airportSections.length} | basins ${city.basins.length} | subsidence ${effects.flood.toFixed(1)}m | draw calls ${renderer.info.render.calls} | triangles ${renderer.info.render.triangles} | seed ${city.seed} | map ${city.size} | power ${effects.power} | ${quality}`;
}
const mini = el<HTMLCanvasElement>('minimap'), mctx = mini.getContext('2d')!;
el('minimap-region').onclick = () => { regionMap = !regionMap; el('minimap-region').textContent = regionMap ? 'Город' : 'Регион'; el('minimap-region').setAttribute('aria-label', regionMap ? 'Показать город на мини-карте' : 'Показать острова на мини-карте'); drawMinimap(); };
function minimapScale() { return Math.min(mini.width, mini.height) / (regionMap ? city.worldRadius * 2.15 : city.extent * 2.4); }
function drawMinimap() {
  const w = mini.width, h = mini.height, scale = minimapScale(), px = (x: number) => w / 2 + x * scale, pz = (z: number) => h / 2 + z * scale;
  mctx.fillStyle = '#18333b'; mctx.fillRect(0, 0, w, h);
  for (const island of city.islands) { mctx.fillStyle = '#688979'; mctx.beginPath(); mctx.arc(px(island.x), pz(island.z), island.radius * scale, 0, Math.PI * 2); mctx.fill(); }
  for (const ship of city.ships) if (ship.userData.alive) { mctx.fillStyle = '#e2d5b0'; mctx.fillRect(px(ship.position.x), pz(ship.position.z), 2, 2); }
  for (const block of city.layout.blocks) { mctx.fillStyle = block.park ? '#527965' : '#435e63'; mctx.fillRect(px(block.x - 26), pz(block.z - 26), 52 * scale, 52 * scale); }
  for (const section of city.airportSections) if (section.alive) { mctx.fillStyle = section.health < 65 ? '#bb9564' : '#657b68'; mctx.fillRect(px(section.x - section.width / 2), pz(section.z - section.depth / 2), section.width * scale, section.depth * scale); }
  for (const b of city.buildings) { mctx.fillStyle = b.collapsed ? '#cf7958' : b.health < 65 ? '#bb9564' : b.height > 65 ? '#a7c2bb' : '#779b93'; mctx.fillRect(px(b.x - b.width / 2), pz(b.z - b.depth / 2), Math.max(1, b.width * scale), Math.max(1, b.depth * scale)); }
  for (const unit of squads.fighters) if (unit.alive) { mctx.fillStyle = TEAMS[unit.team].color; mctx.fillRect(px(unit.x) - 1, pz(unit.z) - 1, 3, 3); }
  mctx.strokeStyle = '#f5d1a49c'; mctx.lineWidth = .8; mctx.beginPath(); mctx.arc(px(controls.target.x), pz(controls.target.z), 10, 0, Math.PI * 2); mctx.stroke(); mctx.fillStyle = '#ead6b2'; mctx.fillRect(px(controls.target.x) - 1, pz(controls.target.z) - 1, 2, 2);
  for (const e of effects.events) { mctx.strokeStyle = '#f9ad76'; mctx.beginPath(); mctx.arc(px(e.x), pz(e.z), 4 + Math.sin(simTime * 3) * 1.5, 0, 6.28); mctx.stroke(); }
}
mini.onclick = e => { const r = mini.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * mini.width, y = (e.clientY - r.top) / r.height * mini.height, scale = minimapScale(); const tx = (x - mini.width / 2) / scale, tz = (y - mini.height / 2) / scale; camera.position.x += tx - controls.target.x; camera.position.z += tz - controls.target.z; controls.target.x = tx; controls.target.z = tz; };
const diagnostics = new URLSearchParams(location.search).has('debug') ? document.createElement('output') : null;
if (diagnostics) { diagnostics.id = 'diagnostics'; diagnostics.style.cssText = 'position:fixed;left:20px;top:285px;max-width:310px;font:10px/1.7 monospace;color:#d9e7e1;background:#10222bd9;padding:10px;border-radius:5px;z-index:9;pointer-events:none'; document.body.append(diagnostics); }
function frame(now: number) {
  requestAnimationFrame(frame); const elapsed = (now - lastNow) / 1000, rawDt = Math.min(elapsed, .08); lastNow = now; const dt = paused || generating || document.hidden ? 0 : rawDt * speed;
  if (!generating) {
    simTime += dt; city.update(dt, simTime); squads.update(dt, simTime); effects.update(dt, simTime);
    const advance = camera.position.distanceTo(controls.target) * rawDt * .55, forward = new T.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize(); const right = new T.Vector3().crossVectors(forward, camera.up).normalize(), move = new T.Vector3();
    if (pressed.has('KeyW') || pressed.has('ArrowUp')) move.addScaledVector(forward, advance); if (pressed.has('KeyS') || pressed.has('ArrowDown')) move.addScaledVector(forward, -advance); if (pressed.has('KeyD') || pressed.has('ArrowRight')) move.addScaledVector(right, advance); if (pressed.has('KeyA') || pressed.has('ArrowLeft')) move.addScaledVector(right, -advance);
    camera.position.add(move); controls.target.add(move); controls.target.x = T.MathUtils.clamp(controls.target.x, -city.worldRadius, city.worldRadius); controls.target.z = T.MathUtils.clamp(controls.target.z, -city.worldRadius, city.worldRadius); controls.update();
    night = T.MathUtils.lerp(night, nightTarget, Math.min(1, rawDt * 1.4)); city.night.value = night;
    sky.update(camera.position, night, sunEnabled); sun.position.copy(sky.sunDirection).multiplyScalar(800);
    ocean.material.uniforms.uSunDirection.value.copy(sky.sunDirection); ocean.update(simTime, night, city);
    sunRays.direction.copy(sky.sunDirection); sunRays.daylight = Math.pow(1 - night, 1.5); sunRays.enabled = raysEnabled && sunRays.daylight > .005;
    const fogColor = new T.Color('#8aaeb9').lerp(new T.Color('#1a263d'), night); (scene.fog as T.FogExp2).color.copy(fogColor); scene.background = fogColor;
    sun.intensity = 2.15 - night * 1.85; sun.color.set('#ffe0b0').lerp(new T.Color('#8dacf4'), night); ambient.intensity = 1.35 - night * .65; renderer.toneMappingExposure = .94 + night * .06; bloom.strength = .15 + night * .35;
    const savedPosition = camera.position.clone(); if (shakeEnabled && effects.shake > .02 && !paused) { camera.position.x += (Math.random() - .5) * effects.shake * 2; camera.position.y += (Math.random() - .5) * effects.shake; camera.updateMatrixWorld(); }
    el('flash').style.opacity = flashEnabled ? String(effects.flash * .6) : '0'; renderer.info.reset(); composer.render(); camera.position.copy(savedPosition);
  }
  fpsFrames++; fpsTime += elapsed; hudClock += rawDt; mapClock += rawDt;
  if (fpsTime > 1) { el('fps').textContent = String(Math.round(fpsFrames / fpsTime)); fpsTime = 0; fpsFrames = 0; }
  if (hudClock > .3) { updateHUD(); hudClock = 0; } if (mapClock > .5) { drawMinimap(); mapClock = 0; }
}
updateHUD(); drawMinimap(); requestAnimationFrame(frame);
setTimeout(() => { el('loading').style.opacity = '0'; setTimeout(() => el('loading').style.display = 'none', 650); }, 900);
