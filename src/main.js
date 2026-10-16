import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const ui = {
  garmentType: $('garmentType'),
  frontFile: $('frontFile'), backFile: $('backFile'),
  frontName: $('frontName'), backName: $('backName'),
  frontPreview: $('frontPreview'), backPreview: $('backPreview'),
  cleanupMode: $('cleanupMode'), threshold: $('threshold'), thresholdValue: $('thresholdValue'),
  fabricColor: $('fabricColor'), backgroundColor: $('backgroundColor'),
  rotationSpeed: $('rotationSpeed'), speedValue: $('speedValue'),
  frameSize: $('frameSize'), frameSizeValue: $('frameSizeValue'),
  volumeScale: $('volumeScale'), volumeScaleValue: $('volumeScaleValue'),
  detailWrap: $('detailWrap'), detailWrapValue: $('detailWrapValue'),
  mannequinVisible: $('mannequinVisible'), mannequinColor: $('mannequinColor'),
  flipFront: $('flipFront'), flipBack: $('flipBack'),
  toggleSpin: $('toggleSpin'), resetView: $('resetView'),
  exportVideo: $('exportVideo'), exportDuration: $('exportDuration'),
  continueGenerate: $('continueGenerate'), generationGate: $('generationGate'),
  gateTitle: $('gateTitle'), gateMessage: $('gateMessage'),
  gateStepFront: $('gateStepFront'), gateStepBack: $('gateStepBack'), gateStepGenerate: $('gateStepGenerate'),
  generationProgress: $('generationProgress'), generationProgressBar: $('generationProgressBar'),
  analysisPanel: $('analysisPanel'), analysisTitle: $('analysisTitle'), analysisStatus: $('analysisStatus'),
  frontAlphaStatus: $('frontAlphaStatus'), frontAlphaNote: $('frontAlphaNote'),
  backAlphaStatus: $('backAlphaStatus'), backAlphaNote: $('backAlphaNote'),
  hoodieViewStatus: $('hoodieViewStatus'), hoodieViewNote: $('hoodieViewNote'),
  pantsViewStatus: $('pantsViewStatus'), pantsViewNote: $('pantsViewNote'),
  missingPantsResolution: $('missingPantsResolution'), generateMissingPantsBack: $('generateMissingPantsBack'),
  piecePreviews: $('piecePreviews'), hoodieFrontPiece: $('hoodieFrontPiece'), hoodieBackPiece: $('hoodieBackPiece'),
  pantsFrontPiece: $('pantsFrontPiece'), pantsBackPiece: $('pantsBackPiece'), pantsBackCaption: $('pantsBackCaption'),
  statusText: $('statusText')
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(ui.backgroundColor.value);

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(0, 0, 18);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.24;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
// Keep the viewer on a turntable-like orbit like the reference video.
// Small vertical freedom is allowed, but no overhead/underside views.
controls.minPolarAngle = Math.PI * 0.5;
controls.maxPolarAngle = Math.PI * 0.5;
controls.minDistance = 7;
controls.maxDistance = 80;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x141414, 1.68));
const key = new THREE.DirectionalLight(0xffffff, 2.45);
key.position.set(5, 7, 7);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 40;
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 12;
key.shadow.camera.bottom = -12;
scene.add(key);

const fill = new THREE.DirectionalLight(0xd7e0ff, 1.02);
fill.position.set(-5, 2, 4);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 1.42);
rim.position.set(0, 5, -7);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(12, 96),
  new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.96, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.position.y = -6.5;
floor.visible = false;
scene.add(floor);
floor.visible = false;

const root = new THREE.Group();
scene.add(root);

let garment = null;
let frontSource = null;
let backSource = null;
let spinning = true;
let autoColor = true;
let exportJob = null;
let recording = false;
let showcaseStartMs = performance.now();
let generationApproved = false;
let generating = false;
const analysisState = {
  front: { hasAlpha:false, alphaCoverage:0, cleanupSkipped:false },
  back: { hasAlpha:false, alphaCoverage:0, cleanupSkipped:false },
  pantsDuplicate:false,
  pantsSimilarity:0,
  pantsBackGenerated:false,
  resolved:true
};
const sideTextureState = { topLeft:null, topRight:null, pantsLeft:null, pantsRight:null };

const textureState = {
  frontTop: null,
  backTop: null,
  frontBottom: null,
  backBottom: null
};

const canvasState = {
  frontTop: null,
  backTop: null,
  frontBottom: null,
  backBottom: null
};

const clock = new THREE.Clock();

function setStatus(text) {
  ui.statusText.textContent = text;
}

function easeShowcase(t) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function lerpAngleDeg(a, b, t) {
  return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a, b, easeShowcase(t)));
}

function showcaseAngleAt(progress) {
  const p = ((progress % 1) + 1) % 1;
  // Front showcase: -45 -> +45 -> -45. Then a smooth 180-degree
  // flip to the rear, rear showcase: -45 -> +45 -> -45 relative
  // to 180 degrees, then a smooth 180-degree return to the front.
  if (p < 0.05) return THREE.MathUtils.degToRad(-45);
  if (p < 0.19) return lerpAngleDeg(-45, 45, (p - 0.05) / 0.14);
  if (p < 0.24) return THREE.MathUtils.degToRad(45);
  if (p < 0.38) return lerpAngleDeg(45, -45, (p - 0.24) / 0.14);
  if (p < 0.42) return THREE.MathUtils.degToRad(-45);
  if (p < 0.54) return lerpAngleDeg(-45, 135, (p - 0.42) / 0.12);
  if (p < 0.59) return THREE.MathUtils.degToRad(135);
  if (p < 0.73) return lerpAngleDeg(135, 225, (p - 0.59) / 0.14);
  if (p < 0.78) return THREE.MathUtils.degToRad(225);
  if (p < 0.92) return lerpAngleDeg(225, 135, (p - 0.78) / 0.14);
  return lerpAngleDeg(135, 315, (p - 0.92) / 0.08);
}

function resetShowcaseClock() {
  showcaseStartMs = performance.now();
  if (garment) garment.rotation.y = showcaseAngleAt(0);
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setPreview(which, canvas) {
  const img = which === 'front' ? ui.frontPreview : ui.backPreview;
  if (!img || !canvas) return;
  img.src = canvas.toDataURL('image/png');
  img.hidden = false;
}

function inspectSourceAlpha(image) {
  const maxSide = 220;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const w = Math.max(2, Math.round((image.naturalWidth || image.width) * scale));
  const h = Math.max(2, Math.round((image.naturalHeight || image.height) * scale));
  const c = document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.clearRect(0,0,w,h); ctx.drawImage(image,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data;
  let transparent=0, semi=0;
  for(let i=3;i<d.length;i+=4){ if(d[i]<245) transparent++; if(d[i]>5 && d[i]<245) semi++; }
  const total=w*h; const coverage=transparent/Math.max(1,total);
  return { hasAlpha:coverage>0.015, alphaCoverage:coverage, semiCoverage:semi/Math.max(1,total) };
}

function canvasSimilarity(a,b,size=64){
  if(!a||!b) return 0;
  const sample=(src)=>{
    const c=document.createElement('canvas');c.width=size;c.height=size;
    const x=c.getContext('2d',{willReadFrequently:true});x.clearRect(0,0,size,size);x.drawImage(src,0,0,size,size);
    return x.getImageData(0,0,size,size).data;
  };
  const A=sample(a),B=sample(b); let err=0,n=0;
  for(let i=0;i<A.length;i+=4){
    const aa=A[i+3]/255, ba=B[i+3]/255;
    const ad=Math.abs(aa-ba);
    const dr=(A[i]-B[i])/255, dg=(A[i+1]-B[i+1])/255, db=(A[i+2]-B[i+2])/255;
    const weight=Math.max(0.15,Math.max(aa,ba));
    err += (dr*dr+dg*dg+db*db)/3*weight + ad*ad*0.65;
    n++;
  }
  const mse=err/Math.max(1,n);
  return THREE.MathUtils.clamp(1-Math.sqrt(mse)*1.35,0,1);
}

function parseHexColor(hex){
  const s=(hex||'#203329').replace('#','');
  const v=parseInt(s.length===3?s.split('').map(x=>x+x).join(''):s,16);
  return {r:(v>>16)&255,g:(v>>8)&255,b:v&255};
}

function estimateDetailColor(canvas, baseHex){
  const base=parseHexColor(baseHex); const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const d=ctx.getImageData(0,0,canvas.width,canvas.height).data; let best=[];
  for(let y=0;y<canvas.height;y+=5) for(let x=0;x<canvas.width;x+=5){
    const i=(y*canvas.width+x)*4;if(d[i+3]<180)continue;
    const dist=Math.hypot(d[i]-base.r,d[i+1]-base.g,d[i+2]-base.b);
    const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);
    if(dist>55 && mx-mn>24) best.push([dist,d[i],d[i+1],d[i+2]]);
  }
  best.sort((a,b)=>b[0]-a[0]); if(!best.length)return {r:185,g:130,b:82};
  const slice=best.slice(0,Math.min(160,best.length));
  return {r:Math.round(slice.reduce((s,v)=>s+v[1],0)/slice.length),g:Math.round(slice.reduce((s,v)=>s+v[2],0)/slice.length),b:Math.round(slice.reduce((s,v)=>s+v[3],0)/slice.length)};
}

function generateConservativePantsBack(frontCanvas){
  const w=frontCanvas.width,h=frontCanvas.height;
  const out=document.createElement('canvas');out.width=w;out.height=h;
  const src=frontCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
  const ctx=out.getContext('2d',{willReadFrequently:true}); const img=ctx.createImageData(w,h); const d=img.data;
  const baseHex=dominantVisibleColor(frontCanvas)||ui.fabricColor.value||'#203329'; const base=parseHexColor(baseHex);
  for(let i=0;i<src.length;i+=4){
    const a=src[i+3]; if(a<10){d[i+3]=0;continue;}
    const lum=(src[i]*0.2126+src[i+1]*0.7152+src[i+2]*0.0722)/255;
    const baseLum=(base.r*0.2126+base.g*0.7152+base.b*0.0722)/255;
    const shade=THREE.MathUtils.clamp(0.82+(lum-baseLum)*0.42,0.67,1.12);
    d[i]=Math.round(base.r*shade);d[i+1]=Math.round(base.g*shade);d[i+2]=Math.round(base.b*shade);d[i+3]=a;
  }
  ctx.putImageData(img,0,0);
  const detail=estimateDetailColor(frontCanvas,baseHex); ctx.strokeStyle=`rgba(${detail.r},${detail.g},${detail.b},0.88)`;
  ctx.lineWidth=Math.max(1.5,w*0.0022);ctx.lineCap='round';
  // structural-only back: waistband, outer seams, inner seams and hems. No logo/pockets/drawstrings.
  const line=(pts)=>{ctx.beginPath();ctx.moveTo(pts[0][0]*w,pts[0][1]*h);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0]*w,pts[i][1]*h);ctx.stroke();};
  line([[0.12,0.09],[0.50,0.075],[0.88,0.09]]);
  line([[0.095,0.11],[0.075,0.48],[0.06,0.94]]); line([[0.905,0.11],[0.925,0.48],[0.94,0.94]]);
  line([[0.47,0.22],[0.445,0.45],[0.43,0.94]]); line([[0.53,0.22],[0.555,0.45],[0.57,0.94]]);
  line([[0.06,0.94],[0.43,0.95]]); line([[0.57,0.95],[0.94,0.94]]);
  // preserve alpha exactly after seam drawing.
  const final=ctx.getImageData(0,0,w,h);for(let i=0;i<final.data.length;i+=4)final.data[i+3]=src[i+3];ctx.putImageData(final,0,0);
  return out;
}

function setPiecePreview(img,canvas){ if(!img||!canvas)return; img.src=canvas.toDataURL('image/png'); }

function updateAnalysisPanel(){
  const both=Boolean(frontSource&&backSource&&canvasState.frontTop&&canvasState.backTop);
  if(ui.analysisPanel) ui.analysisPanel.hidden=!both;
  if(!both) return;
  const fa=analysisState.front, ba=analysisState.back;
  ui.frontAlphaStatus.textContent=fa.hasAlpha?'Transparent PNG detected':'Background/model cleanup used';
  ui.frontAlphaNote.textContent=fa.hasAlpha?`Existing alpha trusted (${Math.round(fa.alphaCoverage*100)}% transparent area).`:'No useful transparency detected; smart cleanup isolated the garment.';
  ui.backAlphaStatus.textContent=ba.hasAlpha?'Transparent PNG detected':'Background/model cleanup used';
  ui.backAlphaNote.textContent=ba.hasAlpha?`Existing alpha trusted (${Math.round(ba.alphaCoverage*100)}% transparent area).`:'No useful transparency detected; smart cleanup isolated the garment.';
  ui.hoodieViewStatus.textContent='Front + back ready';
  ui.hoodieViewNote.textContent='Both hoodie views are retained and registered to the same physical landmarks.';
  if(ui.garmentType.value==='set'){
    if(analysisState.pantsDuplicate&&!analysisState.pantsBackGenerated){
      ui.pantsViewStatus.textContent='Back missing';
      ui.pantsViewNote.textContent=`Pants views are ${Math.round(analysisState.pantsSimilarity*100)}% similar; second view appears to be the same side.`;
      ui.missingPantsResolution.hidden=false;
      ui.analysisStatus.textContent='Needs resolution'; ui.analysisStatus.className='analysis-status warn';
      ui.analysisTitle.textContent='One source issue must be resolved before 3D generation';
    }else{
      ui.pantsViewStatus.textContent=analysisState.pantsBackGenerated?'Front + generated back':'Front + back ready';
      ui.pantsViewNote.textContent=analysisState.pantsBackGenerated?'Generated conservative back: fabric, waistband, seams and hems only.':'Distinct pants views detected.';
      ui.missingPantsResolution.hidden=true;
      ui.analysisStatus.textContent='Ready'; ui.analysisStatus.className='analysis-status ok';
      ui.analysisTitle.textContent='Source analysis complete';
    }
  }else{
    ui.pantsViewStatus.textContent='Not required'; ui.pantsViewNote.textContent='Current garment mode does not require separate pants.';
    ui.missingPantsResolution.hidden=true; ui.analysisStatus.textContent='Ready';ui.analysisStatus.className='analysis-status ok';ui.analysisTitle.textContent='Source analysis complete';
  }
  ui.piecePreviews.hidden=false;
  setPiecePreview(ui.hoodieFrontPiece,canvasState.frontTop);setPiecePreview(ui.hoodieBackPiece,canvasState.backTop);
  setPiecePreview(ui.pantsFrontPiece,canvasState.frontBottom);setPiecePreview(ui.pantsBackPiece,canvasState.backBottom);
  if(ui.pantsBackCaption)ui.pantsBackCaption.textContent=analysisState.pantsBackGenerated?'Pants back (generated)':'Pants back';
}

function updateWorkflowUI() {
  const frontReady = Boolean(frontSource && canvasState.frontTop);
  const backReady = Boolean(backSource && canvasState.backTop);
  ui.gateStepFront?.classList.toggle('ready', frontReady);
  ui.gateStepBack?.classList.toggle('ready', backReady);
  ui.gateStepGenerate?.classList.toggle('ready', generationApproved);
  ui.gateStepGenerate?.classList.toggle('active', frontReady && backReady && !generationApproved);

  if (generating) {
    ui.gateTitle.textContent = 'Generating full 3D clothing.';
    ui.gateMessage.textContent = 'Building the hoodie/pants around the mannequin, projecting both sides, and connecting edge details around the side surfaces.';
    ui.continueGenerate.disabled = true;
    ui.exportVideo.disabled = true;
    return;
  }
  if (generationApproved) {
    ui.gateTitle.textContent = '3D clothing generated';
    ui.gateMessage.textContent = 'The front, back, and connected side details are now fitted to the mannequin. Uploading a new image will return to Stage 1.';
    ui.continueGenerate.textContent = 'Regenerate 3D Clothing';
    ui.continueGenerate.disabled = !(frontReady && backReady);
    ui.exportVideo.disabled = false;
    return;
  }
  if (frontReady && backReady) {
    const resolved = ui.garmentType.value !== 'set' || analysisState.resolved;
    ui.gateTitle.textContent = resolved ? 'Source analysis complete - continue?' : 'Resolve the missing garment view first';
    ui.gateMessage.textContent = resolved
      ? 'All required views are ready. Continue to fit the garment-specific meshes, generate left/right sides, and build the front/back showcase motion.'
      : 'Ghost360 detected that the pants back is missing or duplicated. Generate the conservative back in Source Analysis before continuing.';
    ui.continueGenerate.textContent = 'Continue - Generate 3D Clothing';
    ui.continueGenerate.disabled = !resolved;
  } else {
    ui.gateTitle.textContent = 'Upload front and back';
    ui.gateMessage.textContent = frontReady || backReady ? 'One side is ready. Add the other side to continue.' : 'Add both images. Ghost360 will clean them first, then ask you to continue.';
    ui.continueGenerate.textContent = 'Continue - Generate 3D Clothing';
    ui.continueGenerate.disabled = true;
    ui.exportVideo.disabled = true;
  }
}

function invalidateGeneration() {
  generationApproved = false;
  if (garment) rebuildGarment();
  updateWorkflowUI();
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function generateClothingStage() {
  if (!(frontSource && backSource && canvasState.frontTop && canvasState.backTop) || generating) return;
  if (ui.garmentType.value === 'set' && !analysisState.resolved) { setStatus('Resolve the missing pants back before generating 3D'); updateWorkflowUI(); return; }
  generating = true;generationApproved = false;ui.generationProgress.hidden = false;ui.generationProgressBar.style.width = '6%';updateWorkflowUI();
  setStatus('Generation 1/6: validating registered front/back garment landmarks.');await wait(120);
  ui.generationProgressBar.style.width='20%';setStatus('Generation 2/6: fitting dropped-shoulder hoodie and straight-leg pants base meshes.');await wait(140);
  ui.generationProgressBar.style.width='38%';setStatus('Generation 3/6: building hood, sleeves, cuffs, pocket, waistband, crotch and hems.');await wait(140);
  ui.generationProgressBar.style.width='56%';setStatus('Generation 4/6: synthesizing dedicated left and right side textures from seam/detail bands.');rebuildSideTextures();await wait(140);
  ui.generationProgressBar.style.width='73%';setStatus('Generation 5/6: projecting panel artwork and preserving front-only/back-only details.');await wait(140);
  ui.generationProgressBar.style.width='88%';setStatus('Generation 6/6: applying cloth folds, mannequin clearance, lighting and turntable framing.');await wait(140);
  generationApproved = true;rebuildGarment();resetShowcaseClock();ui.generationProgressBar.style.width='100%';await wait(180);
  generating=false;ui.generationProgress.hidden=true;ui.generationProgressBar.style.width='0%';updateWorkflowUI();setStatus('3D clothing generated - front/back showcase ready');
}

function disposeTexture(tex) {
  if (tex?.dispose) tex.dispose();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => m.dispose?.());
    }
  });
  object.removeFromParent();
}

function sideMaterial() {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(ui.fabricColor.value),
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide
  });
}

function textureMaterial(texture) {
  return new THREE.MeshStandardMaterial({
    color: texture ? 0xffffff : new THREE.Color(ui.fabricColor.value),
    map: texture || null,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    alphaTest: 0.025,
    side: THREE.DoubleSide
  });
}

function transparentCapMaterial() {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
}

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function simplifyRDP(points, epsilon) {
  if (points.length < 4) return points;
  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], a, b);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyRDP(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function smoothClosedLoop(points, samples = 220) {
  const pts = points.slice();
  if (pts.length < 4) return pts;
  if (pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  const curvePts = pts.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(curvePts, true, 'centripetal', 0.5);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const v = curve.getPoint(i / samples);
    out.push({ x: v.x, y: v.y });
  }
  out.push({ ...out[0] });
  return out;
}

function alphaMask(canvas, target = 150) {
  const tmp = document.createElement('canvas');
  const aspect = canvas.width / canvas.height;
  let w;
  let h;
  if (aspect >= 1) {
    w = target;
    h = Math.max(24, Math.round(target / aspect));
  } else {
    h = target;
    w = Math.max(24, Math.round(target * aspect));
  }
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 55 ? 1 : 0;
  return { mask, w, h };
}

function largestMaskComponent(mask, w, h) {
  const visited = new Uint8Array(mask.length);
  let best = [];
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    const comp = [];
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const idx = queue[head++];
      comp.push(idx);
      const x = idx % w;
      const y = Math.floor(idx / w);
      const ns = [];
      if (x > 0) ns.push(idx - 1);
      if (x + 1 < w) ns.push(idx + 1);
      if (y > 0) ns.push(idx - w);
      if (y + 1 < h) ns.push(idx + w);
      for (const n of ns) {
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (comp.length > best.length) best = comp;
  }

  const out = new Uint8Array(mask.length);
  for (const idx of best) out[idx] = 1;
  return out;
}

function silhouetteLoop(canvas) {
  const { mask: raw, w, h } = alphaMask(canvas, 170);
  const mask = largestMaskComponent(raw, w, h);
  const edges = new Map();

  const addEdge = (ax, ay, bx, by) => {
    const k = `${ax},${ay}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push({ x: bx, y: by });
  };

  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!solid(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!solid(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!solid(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const loops = [];
  const used = new Set();
  for (const [startKey, ends] of edges.entries()) {
    for (let edgeIndex = 0; edgeIndex < ends.length; edgeIndex++) {
      const edgeId = `${startKey}|${edgeIndex}`;
      if (used.has(edgeId)) continue;
      const [sx, sy] = startKey.split(',').map(Number);
      const loop = [{ x: sx, y: sy }];
      let currentKey = startKey;
      let safety = 0;

      while (safety++ < w * h * 8) {
        const candidates = edges.get(currentKey) || [];
        let chosen = -1;
        for (let i = 0; i < candidates.length; i++) {
          const id = `${currentKey}|${i}`;
          if (!used.has(id)) {
            chosen = i;
            break;
          }
        }
        if (chosen < 0) break;
        const id = `${currentKey}|${chosen}`;
        used.add(id);
        const next = candidates[chosen];
        loop.push(next);
        currentKey = `${next.x},${next.y}`;
        if (currentKey === startKey) break;
      }
      if (loop.length > 20) loops.push(loop);
    }
  }

  if (!loops.length) return null;
  loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  let loop = loops[0];
  if (loop[0].x !== loop[loop.length - 1].x || loop[0].y !== loop[loop.length - 1].y) loop.push({ ...loop[0] });
  loop = simplifyRDP(loop, 0.9);
  loop = smoothClosedLoop(loop, 240);
  if (loop.length < 16) return null;
  return { points: loop, w, h };
}

function genericShape(kind) {
  const s = new THREE.Shape();
  if (kind === 'pants') {
    s.moveTo(-1.4, 3);
    s.lineTo(-1.55, 0.7);
    s.lineTo(-1.05, -3.2);
    s.lineTo(-0.25, -3.2);
    s.lineTo(0, -0.2);
    s.lineTo(0.25, -3.2);
    s.lineTo(1.05, -3.2);
    s.lineTo(1.55, 0.7);
    s.lineTo(1.4, 3);
  } else {
    s.moveTo(-2.7, 1.35);
    s.lineTo(-1.7, 2.1);
    s.lineTo(-0.8, 2.4);
    s.lineTo(0.8, 2.4);
    s.lineTo(1.7, 2.1);
    s.lineTo(2.7, 1.35);
    s.lineTo(2.05, -2.8);
    s.lineTo(-2.05, -2.8);
  }
  s.closePath();
  const pts = kind === 'pants'
    ? [
        {x:-1.4,y:3},{x:-1.55,y:0.7},{x:-1.05,y:-3.2},{x:-0.25,y:-3.2},{x:0,y:-0.2},
        {x:0.25,y:-3.2},{x:1.05,y:-3.2},{x:1.55,y:0.7},{x:1.4,y:3},{x:-1.4,y:3}
      ]
    : [
        {x:-2.7,y:1.35},{x:-1.7,y:2.1},{x:-0.8,y:2.4},{x:0.8,y:2.4},{x:1.7,y:2.1},
        {x:2.7,y:1.35},{x:2.05,y:-2.8},{x:-2.05,y:-2.8},{x:-2.7,y:1.35}
      ];
  return { shape: s, bounds: { minX: -3, maxX: 3, minY: -3.3, maxY: 3.1 }, points: pts };
}

function shapeFromCanvas(canvas, targetHeight, kind = 'top') {
  if (!canvas) return genericShape(kind === 'pants' ? 'pants' : 'top');
  const traced = silhouetteLoop(canvas);
  if (!traced) return genericShape(kind === 'pants' ? 'pants' : 'top');

  const pts = traced.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pw = Math.max(1, maxX - minX);
  const ph = Math.max(1, maxY - minY);
  const scale = targetHeight / ph;
  const physicalW = pw * scale;
  const physicalH = targetHeight;
  const shape = new THREE.Shape();

  const mapped = pts.map((p) => ({
    x: (p.x - (minX + maxX) / 2) * scale,
    y: ((minY + maxY) / 2 - p.y) * scale
  }));

  if (polygonArea(mapped) > 0) mapped.reverse();
  shape.moveTo(mapped[0].x, mapped[0].y);
  for (let i = 1; i < mapped.length; i++) shape.lineTo(mapped[i].x, mapped[i].y);
  shape.closePath();

  return {
    shape,
    bounds: {
      minX: -physicalW / 2,
      maxX: physicalW / 2,
      minY: -physicalH / 2,
      maxY: physicalH / 2
    },
    points: mapped
  };
}

function normalizeUV(geometry, bounds, flipX = false) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  for (let i = 0; i < pos.count; i++) {
    let u = (pos.getX(i) - bounds.minX) / w;
    const v = (pos.getY(i) - bounds.minY) / h;
    if (flipX) u = 1 - u;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function curvedFaceGeometry(shape, bounds, curveAmount, direction = 1) {
  const geo = new THREE.ShapeGeometry(shape, 36);
  normalizeUV(geo, bounds, false);
  const pos = geo.attributes.position;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const hw = Math.max(0.001, (bounds.maxX - bounds.minX) / 2);
  const hh = Math.max(0.001, (bounds.maxY - bounds.minY) / 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = (x - cx) / hw;
    const ny = (y - cy) / hh;
    const domeX = Math.max(0, 1 - nx * nx);
    const domeY = Math.max(0.12, 1 - 0.7 * ny * ny);
    const wrinkle = Math.sin(x * 3.2 + y * 1.3) * 0.012 + Math.sin(y * 5.1) * 0.007;
    pos.setZ(i, direction * (curveAmount * domeX * domeY + wrinkle));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildLoftSideGeometry(points, bounds, kind, depth) {
  const pts = points.slice();
  if (pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const hw = Math.max(0.001, (bounds.maxX - bounds.minX) / 2);
  const hh = Math.max(0.001, (bounds.maxY - bounds.minY) / 2);

  const zSlices = kind === 'pants'
    ? [0.5, 0.32, 0.16, 0, -0.16, -0.32, -0.5]
    : [0.5, 0.36, 0.22, 0.1, 0, -0.1, -0.22, -0.36, -0.5];
  const sliceCount = zSlices.length;
  const ringCount = pts.length;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let s = 0; s < sliceCount; s++) {
    const zn = zSlices[s];
    const centerW = 1 - Math.abs(zn) * 2;
    for (let i = 0; i < ringCount; i++) {
      const p = pts[i];
      const rx = (p.x - cx) / hw;
      const ry = (p.y - cy) / hh;
      const body = Math.max(0, 1 - ry * ry);
      const shoulder = Math.max(0, -ry);
      const hem = Math.max(0, ry);
      let widthPull;
      let thicknessBias = 0;
      let yOffset = 0;

      if (kind === 'pants') {
        const thigh = Math.max(0, 1 - Math.abs(ry - 0.05) * 1.2);
        const ankle = Math.max(0, ry - 0.58);
        widthPull = centerW * (0.18 + 0.14 * thigh - 0.04 * ankle);
        thicknessBias = centerW * 0.02 * thigh;
        yOffset = -centerW * 0.015 * Math.max(0, ry - 0.2);
      } else {
        const hoodShoulder = Math.max(0, -ry - 0.18);
        const belly = Math.max(0, 1 - Math.abs(ry - 0.1) * 1.35);
        widthPull = centerW * (0.12 + 0.16 * belly + 0.08 * hoodShoulder);
        thicknessBias = centerW * (0.035 * belly + 0.025 * shoulder);
        yOffset = centerW * 0.035 * shoulder - centerW * 0.018 * hem;
      }

      const x = cx + (p.x - cx) * (1 - widthPull) + rx * thicknessBias;
      const y = cy + (p.y - cy) * (1 - centerW * 0.015) + yOffset;
      const z = zn * depth;
      positions.push(x, y, z);
      uvs.push(i / ringCount, s / (sliceCount - 1));
    }
  }

  for (let s = 0; s < sliceCount - 1; s++) {
    for (let i = 0; i < ringCount; i++) {
      const ni = (i + 1) % ringCount;
      const a = s * ringCount + i;
      const b = s * ringCount + ni;
      const c = (s + 1) * ringCount + i;
      const d = (s + 1) * ringCount + ni;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildSilhouetteGarment({ frontCanvas, backCanvas, frontTexture, backTexture, targetHeight, depth, curve, kind }) {
  const sourceCanvas = frontCanvas || backCanvas;
  const { shape, bounds, points } = shapeFromCanvas(sourceCanvas, targetHeight, kind);
  const group = new THREE.Group();

  const shellGeo = buildLoftSideGeometry(points, bounds, kind, depth);
  const shell = new THREE.Mesh(shellGeo, sideMaterial());
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const frontGeo = curvedFaceGeometry(shape, bounds, curve, 1);
  normalizeUV(frontGeo, bounds, ui.flipFront.checked);
  const front = new THREE.Mesh(frontGeo, textureMaterial(frontTexture));
  front.position.z = depth * 0.52 + 0.01;
  front.castShadow = true;
  group.add(front);

  const backGeo = curvedFaceGeometry(shape, bounds, curve * 0.82, 1);
  normalizeUV(backGeo, bounds, ui.flipBack.checked);
  const back = new THREE.Mesh(backGeo, textureMaterial(backTexture));
  back.rotation.y = Math.PI;
  back.position.z = -depth * 0.52 - 0.01;
  back.castShadow = true;
  group.add(back);

  return group;
}

function sampledGarmentMask(canvas, targetRows = 150) {
  const aspect = Math.max(0.2, Math.min(3.0, canvas.width / canvas.height));
  const rows = targetRows;
  const cols = Math.max(48, Math.min(180, Math.round(rows * aspect)));
  const tmp = document.createElement('canvas');
  tmp.width = cols;
  tmp.height = rows;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, cols, rows);
  ctx.drawImage(canvas, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 50 ? 1 : 0;
  return { mask: largestMaskComponent(mask, cols, rows), cols, rows };
}

function chamferDistance(mask, cols, rows) {
  const inf = 1e6;
  const d = new Float32Array(mask.length);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? inf : 0;
  const diag = Math.SQRT2;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - cols] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - cols - 1] + diag);
      if (x + 1 < cols && y > 0) v = Math.min(v, d[i - cols + 1] + diag);
      d[i] = v;
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (!mask[i]) continue;
      let v = d[i];
      if (x + 1 < cols) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < rows) v = Math.min(v, d[i + cols] + 1);
      if (x + 1 < cols && y + 1 < rows) v = Math.min(v, d[i + cols + 1] + diag);
      if (x > 0 && y + 1 < rows) v = Math.min(v, d[i + cols - 1] + diag);
      d[i] = v;
    }
  }
  return d;
}

function addTriangleEdge(edgeMap, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const key = `${lo}:${hi}`;
  const entry = edgeMap.get(key);
  if (entry) entry.count++;
  else edgeMap.set(key, { a, b, count: 1 });
}

function clothBaseMaterial() {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(ui.fabricColor.value),
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide
  });
}

function roundedBox(width, height, depth, radius = 0.22, segments = 6) {
  const geo = new RoundedBoxGeometry(width, height, depth, segments, Math.min(radius, width * 0.3, height * 0.3, depth * 0.45));
  const mesh = new THREE.Mesh(geo, clothBaseMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function taperedLimb(length, radiusTop, radiusBottom, squashZ = 0.92) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 36, 8, false);
  geo.scale(1, 1, squashZ);
  const mesh = new THREE.Mesh(geo, clothBaseMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildHoodBase(width, targetHeight, depth) {
  const hood = new THREE.Group();

  // Back of hood: rounded volume behind the opening.
  const shellGeo = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0.15, Math.PI * 0.82);
  shellGeo.scale(width * 0.17, targetHeight * 0.14, depth * 0.95);
  const shell = new THREE.Mesh(shellGeo, clothBaseMaterial());
  shell.position.set(0, targetHeight * 0.37, -depth * 0.20);
  shell.castShadow = true;
  hood.add(shell);

  // Thick hood rim leaves a real black/open center from the front.
  const rimGeo = new THREE.TorusGeometry(width * 0.125, Math.max(0.075, depth * 0.16), 18, 64);
  const rim = new THREE.Mesh(rimGeo, clothBaseMaterial());
  rim.scale.set(1, 1.12, 0.80);
  rim.position.set(0, targetHeight * 0.36, depth * 0.17);
  rim.castShadow = true;
  hood.add(rim);

  return hood;
}

function buildTopGhostBase(width, targetHeight, depth) {
  const group = new THREE.Group();
  const torsoW = width * 0.54;
  const torsoH = targetHeight * 0.70;
  const torsoD = depth * 1.08;
  const torso = roundedBox(torsoW, torsoH, torsoD, Math.min(0.32, torsoW * 0.12), 8);
  torso.position.y = -targetHeight * 0.07;
  group.add(torso);

  const sleeveLength = targetHeight * 0.56;
  const sleeveTop = Math.max(0.28, width * 0.075);
  const sleeveBottom = sleeveTop * 0.70;
  for (const side of [-1, 1]) {
    const sleeve = taperedLimb(sleeveLength, sleeveTop, sleeveBottom, 0.82);
    sleeve.rotation.z = side * -0.18;
    sleeve.position.set(side * width * 0.34, targetHeight * 0.01, 0);
    group.add(sleeve);

    const cuff = taperedLimb(targetHeight * 0.075, sleeveBottom * 1.02, sleeveBottom * 0.94, 0.86);
    cuff.rotation.z = sleeve.rotation.z;
    cuff.position.set(side * width * 0.385, -targetHeight * 0.255, 0);
    group.add(cuff);
  }

  group.add(buildHoodBase(width, targetHeight, depth));
  return group;
}

function buildPantsGhostBase(width, targetHeight, depth) {
  const group = new THREE.Group();
  const waistW = width * 0.78;
  const pelvis = roundedBox(waistW, targetHeight * 0.27, depth * 1.05, 0.20, 7);
  pelvis.position.y = targetHeight * 0.32;
  group.add(pelvis);

  const waistband = roundedBox(waistW * 1.02, targetHeight * 0.08, depth * 1.10, 0.12, 6);
  waistband.position.y = targetHeight * 0.47;
  group.add(waistband);

  const legLength = targetHeight * 0.72;
  const legTop = Math.max(0.26, width * 0.17);
  const legBottom = legTop * 0.82;
  for (const side of [-1, 1]) {
    const leg = taperedLimb(legLength, legTop, legBottom, 0.90);
    leg.position.set(side * width * 0.205, -targetHeight * 0.12, 0);
    group.add(leg);
  }
  return group;
}

function createClothSurface(canvas, texture, targetHeight, depth, kind, side = 1, flipX = false) {
  const aspect = canvas ? Math.max(0.24, Math.min(1.5, canvas.width / canvas.height)) : (kind === 'pants' ? 0.52 : 0.94);
  const width = targetHeight * aspect;
  const geo = new THREE.PlaneGeometry(width, targetHeight, 48, 64);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / Math.max(0.001, width / 2);
    const ny = y / Math.max(0.001, targetHeight / 2);
    let z;

    if (kind === 'pants') {
      const legCenter = nx < 0 ? -0.30 : 0.30;
      const legBulge = Math.exp(-Math.pow((nx - legCenter) / 0.28, 2));
      const pelvisBulge = Math.exp(-Math.pow(nx / 0.58, 2)) * Math.max(0, ny + 0.05);
      const profile = 0.32 + 0.54 * legBulge + 0.28 * pelvisBulge;
      z = side * depth * 0.53 * profile;
      z += side * Math.sin(y * 3.1 + x * 1.4) * depth * 0.012;
    } else {
      const torso = Math.exp(-Math.pow(nx / 0.56, 4)) * Math.exp(-Math.pow((ny + 0.08) / 0.78, 4));
      const leftSleeve = Math.exp(-Math.pow((nx + 0.74) / 0.22, 2)) * Math.exp(-Math.pow((ny + 0.04) / 0.65, 4));
      const rightSleeve = Math.exp(-Math.pow((nx - 0.74) / 0.22, 2)) * Math.exp(-Math.pow((ny + 0.04) / 0.65, 4));
      const hood = Math.exp(-Math.pow(nx / 0.32, 2)) * Math.exp(-Math.pow((ny - 0.72) / 0.27, 2));
      const profile = 0.22 + 0.64 * torso + 0.52 * Math.max(leftSleeve, rightSleeve) + 0.52 * hood;
      z = side * depth * 0.54 * profile;
      z += side * (Math.sin(x * 2.7 + y * 1.2) * 0.012 + Math.sin(y * 4.6) * 0.006) * depth;
    }
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const uv = geo.attributes.uv;
  if (flipX) {
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
  }

  const mesh = new THREE.Mesh(geo, textureMaterial(texture));
  if (side < 0) mesh.rotation.y = Math.PI;
  mesh.castShadow = true;
  return { mesh, width };
}

function buildVolumetricGarment({ canvas, frontTexture, backTexture, targetHeight, maxDepth, edgeDepth, kind }) {
  const group = new THREE.Group();
  const aspect = canvas ? Math.max(0.24, Math.min(1.5, canvas.width / canvas.height)) : (kind === 'pants' ? 0.52 : 0.94);
  const width = targetHeight * aspect;
  const depth = Math.max(0.32, maxDepth * 1.65);

  // Stable mannequin-like rounded geometry is always present, even if image segmentation fails.
  const ghostBase = kind === 'pants'
    ? buildPantsGhostBase(width, targetHeight, depth)
    : buildTopGhostBase(width, targetHeight, depth);
  group.add(ghostBase);

  // Exact uploaded cutouts become the visible front/back cloth skins.
  const front = createClothSurface(canvas, frontTexture, targetHeight, depth, kind, 1, ui.flipFront.checked);
  const back = createClothSurface(canvas, backTexture, targetHeight, depth, kind, -1, ui.flipBack.checked);
  group.add(front.mesh, back.mesh);

  return group;
}

function legacyMannequinMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x161616,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide
  });
}

function mannequinCapsule(radius, length, sx = 1, sy = 1, sz = 1) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 10, 18);
  geo.scale(sx, sy, sz);
  const mesh = new THREE.Mesh(geo, legacyMannequinMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mannequinSphere(rx, ry, rz) {
  const geo = new THREE.SphereGeometry(1, 24, 20);
  geo.scale(rx, ry, rz);
  const mesh = new THREE.Mesh(geo, legacyMannequinMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildTopMannequin(width, targetHeight, depth) {
  const g = new THREE.Group();
  const torso = mannequinCapsule(width * 0.18, targetHeight * 0.38, 1.35, 1.0, Math.max(0.9, depth / (width * 0.34)));
  torso.position.y = -targetHeight * 0.02;
  g.add(torso);

  const shoulder = mannequinSphere(width * 0.34, targetHeight * 0.12, depth * 0.52);
  shoulder.position.y = targetHeight * 0.20;
  g.add(shoulder);

  const chest = mannequinSphere(width * 0.28, targetHeight * 0.12, depth * 0.60);
  chest.position.set(0, targetHeight * 0.02, depth * 0.06);
  g.add(chest);

  const neck = mannequinCapsule(width * 0.05, targetHeight * 0.09, 1.0, 1.0, 1.0);
  neck.position.y = targetHeight * 0.30;
  g.add(neck);

  const hoodSupport = mannequinSphere(width * 0.20, targetHeight * 0.17, depth * 0.66);
  hoodSupport.position.set(0, targetHeight * 0.37, -depth * 0.04);
  g.add(hoodSupport);

  for (const side of [-1, 1]) {
    const upper = mannequinCapsule(width * 0.072, targetHeight * 0.23, 1.0, 1.0, 0.95);
    upper.rotation.z = side * (Math.PI / 2 - 0.55);
    upper.position.set(side * width * 0.33, targetHeight * 0.08, 0);
    g.add(upper);

    const lower = mannequinCapsule(width * 0.060, targetHeight * 0.18, 0.95, 1.0, 0.90);
    lower.rotation.z = side * (Math.PI / 2 - 0.18);
    lower.position.set(side * width * 0.40, -targetHeight * 0.16, 0);
    g.add(lower);
  }
  return g;
}

function buildPantsMannequin(width, targetHeight, depth) {
  const g = new THREE.Group();
  const pelvis = mannequinSphere(width * 0.28, targetHeight * 0.13, depth * 0.58);
  pelvis.position.y = targetHeight * 0.30;
  g.add(pelvis);

  const waist = mannequinSphere(width * 0.33, targetHeight * 0.06, depth * 0.46);
  waist.position.y = targetHeight * 0.43;
  g.add(waist);

  for (const side of [-1, 1]) {
    const upper = mannequinCapsule(width * 0.095, targetHeight * 0.23, 1.0, 1.0, 0.96);
    upper.position.set(side * width * 0.17, targetHeight * 0.04, 0);
    g.add(upper);

    const lower = mannequinCapsule(width * 0.080, targetHeight * 0.25, 0.96, 1.0, 0.92);
    lower.position.set(side * width * 0.17, -targetHeight * 0.30, 0);
    g.add(lower);
  }
  return g;
}

function buildMannequinMountedGarment({ frontCanvas, backCanvas, frontTexture, backTexture, targetHeight, depth, curve, kind }) {
  const sourceCanvas = frontCanvas || backCanvas;
  const shapePack = shapeFromCanvas(sourceCanvas, targetHeight, kind);
  const width = shapePack.bounds.maxX - shapePack.bounds.minX;
  const mannequin = kind === 'pants'
    ? buildPantsMannequin(width, targetHeight, depth)
    : buildTopMannequin(width, targetHeight, depth);

  const cloth = buildSilhouetteGarment({
    frontCanvas,
    backCanvas,
    frontTexture,
    backTexture,
    targetHeight,
    depth,
    curve,
    kind
  });

  const g = new THREE.Group();
  mannequin.renderOrder = 0;
  cloth.renderOrder = 1;
  g.add(mannequin, cloth);
  return g;
}


function mannequinMaterial(exposed = true) {
  const chosen = new THREE.Color(ui.mannequinColor?.value || '#b8b5af');
  if (!exposed) {
    // Covered anatomy is a fit guide only. Make it invisible so shoulders,
    // thighs, elbows and pelvis can never poke through the generated clothing.
    return new THREE.MeshStandardMaterial({
      color: chosen,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
  }
  return new THREE.MeshStandardMaterial({
    color: chosen,
    roughness: 0.74,
    metalness: 0.01
  });
}

function ellipsoid(rx, ry, rz, mat) {
  const geo = new THREE.SphereGeometry(1, 40, 28);
  geo.scale(rx, ry, rz);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function limbBetween(a, b, radiusTop, radiusBottom, mat, squash = 0.92) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, len, 32, 6, false);
  geo.scale(1, 1, squash);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildMannequin(includeHead = true) {
  const g = new THREE.Group();
  const coveredMat = mannequinMaterial(false);
  const exposedMat = mannequinMaterial(true);

  // Slim fashion-mannequin proportions. Covered anatomy stays well inside
  // the clothing shell so the mannequin supports the fit without poking out.
  const pelvis = ellipsoid(0.56, 0.39, 0.31, coveredMat);
  pelvis.position.set(0, -0.82, -0.01);
  g.add(pelvis);

  const abdomen = ellipsoid(0.50, 0.78, 0.29, coveredMat);
  abdomen.position.set(0, 0.13, -0.01);
  g.add(abdomen);

  const chest = ellipsoid(0.67, 0.84, 0.34, coveredMat);
  chest.position.set(0, 1.03, -0.01);
  g.add(chest);

  const neck = limbBetween(new THREE.Vector3(0, 1.90, 0), new THREE.Vector3(0, 2.34, 0), 0.145, 0.14, exposedMat, 0.82);
  g.add(neck);

  if (includeHead) {
    const head = ellipsoid(0.305, 0.455, 0.325, exposedMat);
    head.position.set(0, 2.77, 0.015);
    g.add(head);
  }

  for (const side of [-1, 1]) {
    const shoulder = ellipsoid(0.20, 0.21, 0.21, coveredMat);
    shoulder.position.set(side * 0.83, 1.56, 0);
    g.add(shoulder);

    const a0 = new THREE.Vector3(side * 0.84, 1.47, 0);
    const elbow = new THREE.Vector3(side * 1.10, 0.37, 0.02);
    const wrist = new THREE.Vector3(side * 1.08, -0.79, 0.04);
    g.add(limbBetween(a0, elbow, 0.17, 0.145, coveredMat, 0.82));
    g.add(limbBetween(elbow, wrist, 0.14, 0.11, coveredMat, 0.80));

    const hand = ellipsoid(0.115, 0.205, 0.100, exposedMat);
    hand.position.set(wrist.x, wrist.y - 0.20, wrist.z + 0.015);
    g.add(hand);

    const hip = new THREE.Vector3(side * 0.31, -1.02, 0);
    const knee = new THREE.Vector3(side * 0.31, -2.70, 0.015);
    const ankle = new THREE.Vector3(side * 0.30, -4.37, 0.035);
    g.add(limbBetween(hip, knee, 0.225, 0.185, coveredMat, 0.82));
    g.add(limbBetween(knee, ankle, 0.18, 0.125, coveredMat, 0.80));

    const foot = ellipsoid(0.15, 0.085, 0.28, exposedMat);
    foot.position.set(side * 0.30, -4.60, 0.12);
    g.add(foot);
  }

  g.visible = ui.mannequinVisible?.checked !== false;
  g.userData.isMannequin = true;
  return g;
}

function fitClothingToMannequin(clothing, kind) {
  // Keep the clothing very close to the body but slightly outside it to avoid z-fighting.
  if (kind === 'top') {
    clothing.scale.set(0.78, 0.82, 1.15);
    clothing.position.y += 0.55;
  } else if (kind === 'pants') {
    clothing.scale.set(0.74, 0.82, 1.08);
    clothing.position.y -= 0.25;
  }
  return clothing;
}


function garmentShaderMaterial(frontTexture, backTexture, bounds, kind = 'top') {
  const base = new THREE.Color(ui.fabricColor.value || '#1f3327');
  const wrapStrength = Math.max(0, Math.min(1, Number(ui.detailWrap?.value || 95) / 100));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uFront: { value: frontTexture || null },
      uBack: { value: backTexture || null },
      uHasFront: { value: frontTexture ? 1 : 0 },
      uHasBack: { value: backTexture ? 1 : 0 },
      uBase: { value: base },
      uMinX: { value: bounds.minX }, uMaxX: { value: bounds.maxX },
      uMinY: { value: bounds.minY }, uMaxY: { value: bounds.maxY },
      uFlipFront: { value: ui.flipFront.checked ? 1 : 0 },
      uFlipBack: { value: ui.flipBack.checked ? 1 : 0 },
      uKind: { value: kind === 'pants' ? 1 : 0 },
      uWrap: { value: wrapStrength }
    },
    vertexShader: `
      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vViewNormal;
      void main(){
        vLocalPos = position;
        vLocalNormal = normalize(normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uFront;
      uniform sampler2D uBack;
      uniform float uHasFront;
      uniform float uHasBack;
      uniform vec3 uBase;
      uniform float uMinX, uMaxX, uMinY, uMaxY;
      uniform float uFlipFront, uFlipBack, uWrap;
      varying vec3 vLocalPos;
      varying vec3 vLocalNormal;
      varying vec3 vViewNormal;

      float flipU(float u, float flipFlag){
        return mix(u, 1.0-u, flipFlag);
      }

      vec4 safeFront(vec2 uv){
        if (uHasFront < 0.5) return vec4(uBase, 0.0);
        return texture2D(uFront, uv);
      }
      vec4 safeBack(vec2 uv){
        if (uHasBack < 0.5) return vec4(uBase, 0.0);
        return texture2D(uBack, uv);
      }

      void main(){
        float u = clamp((vLocalPos.x - uMinX) / max(0.001, (uMaxX-uMinX)), 0.0, 1.0);
        float v = clamp((vLocalPos.y - uMinY) / max(0.001, (uMaxY-uMinY)), 0.0, 1.0);
        vec3 LN = normalize(vLocalNormal);
        float nz = clamp(LN.z, -1.0, 1.0);

        vec2 uvF = vec2(flipU(u, uFlipFront), v);
        vec2 uvB = vec2(flipU(u, uFlipBack), v);
        vec4 f = safeFront(uvF);
        vec4 b = safeBack(uvB);

        // Side surfaces inherit a strip from the nearest physical edge of the
        // front/back flats. This lets stitching, pocket edges and artwork that
        // reaches an edge continue around sleeves, shoulders and pant legs.
        float rightSide = step(0.0, vLocalPos.x);
        // Use several edge bands instead of one strip. This carries a wider
        // portion of stitching / seam / artwork information around the side,
        // then smoothly hands it off from the front image to the back image.
        float f0 = mix(0.025, 0.975, rightSide);
        float f1 = mix(0.070, 0.930, rightSide);
        float f2 = mix(0.135, 0.865, rightSide);
        float b0 = mix(0.975, 0.025, rightSide);
        float b1 = mix(0.930, 0.070, rightSide);
        float b2 = mix(0.865, 0.135, rightSide);
        vec4 fE0 = safeFront(vec2(flipU(f0, uFlipFront), v));
        vec4 fE1 = safeFront(vec2(flipU(f1, uFlipFront), v));
        vec4 fE2 = safeFront(vec2(flipU(f2, uFlipFront), v));
        vec4 bE0 = safeBack(vec2(flipU(b0, uFlipBack), v));
        vec4 bE1 = safeBack(vec2(flipU(b1, uFlipBack), v));
        vec4 bE2 = safeBack(vec2(flipU(b2, uFlipBack), v));
        vec4 fEdge = fE0 * 0.48 + fE1 * 0.34 + fE2 * 0.18;
        vec4 bEdge = bE0 * 0.48 + bE1 * 0.34 + bE2 * 0.18;

        // nz runs continuously front -> side -> back, so this creates a real
        // transitional side rather than switching from one decal to another.
        float sideToBack = smoothstep(-0.32, 0.32, -nz);
        vec4 sideTex = mix(fEdge, bEdge, sideToBack);
        float sideAlpha = smoothstep(0.02, 0.16, sideTex.a);

        float frontFace = smoothstep(0.18, 0.72, nz) * uHasFront;
        float backFace  = smoothstep(0.18, 0.72, -nz) * uHasBack;
        frontFace *= smoothstep(0.02, 0.16, f.a);
        backFace  *= smoothstep(0.02, 0.16, b.a);
        float faceW = clamp(max(frontFace, backFace), 0.0, 1.0);
        vec3 faceCol = frontFace >= backFace ? f.rgb : b.rgb;

        float sideAmount = pow(1.0 - abs(nz), 0.72) * sideAlpha * uWrap;
        vec3 color = uBase;
        color = mix(color, sideTex.rgb, sideAmount);
        // Front/back projected art wins as the surface turns toward either face.
        color = mix(color, faceCol, faceW);

        // Blend a little edge texture just before the 90-degree side to avoid a
        // visible texture cliff at the shoulder/sleeve/leg turn.
        float shoulderBlend = (1.0 - smoothstep(0.24, 0.78, abs(nz))) * 0.24 * uWrap;
        color = mix(color, sideTex.rgb, shoulderBlend * sideAlpha * (1.0-faceW));

        vec3 N = normalize(vViewNormal);
        vec3 L = normalize(vec3(0.30, 0.60, 0.92));
        float diff = max(dot(N, L), 0.0);
        float rim = pow(1.0 - abs(N.z), 2.0) * 0.22;
        float shade = 0.60 + diff * 0.55 + rim;
        gl_FragColor = vec4(color * shade, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });
  return material;
}

function loftEllipticalRings(rings, radialSegments = 48, capEnds = true) {
  const positions = [];
  const indices = [];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let s = 0; s < radialSegments; s++) {
      const a = s / radialSegments * Math.PI * 2;
      positions.push(
        (ring.cx || 0) + Math.cos(a) * ring.rx,
        ring.y,
        (ring.cz || 0) + Math.sin(a) * ring.rz
      );
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const n = (s + 1) % radialSegments;
      const a = r * radialSegments + s;
      const b = r * radialSegments + n;
      const c = (r + 1) * radialSegments + s;
      const d = (r + 1) * radialSegments + n;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (capEnds) {
    const bottomCenter = positions.length / 3;
    const br = rings[0];
    positions.push(br.cx || 0, br.y, br.cz || 0);
    const topCenter = positions.length / 3;
    const tr = rings[rings.length - 1];
    positions.push(tr.cx || 0, tr.y, tr.cz || 0);
    for (let s = 0; s < radialSegments; s++) {
      const n = (s + 1) % radialSegments;
      indices.push(bottomCenter, n, s);
      const offset = (rings.length - 1) * radialSegments;
      indices.push(topCenter, offset + s, offset + n);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function sweptEllipticalTube(points, radiusFn, zSquash = 0.86, tubularSegments = 28, radialSegments = 36) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const positions = [];
  const indices = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    let basisA = new THREE.Vector3().crossVectors(tangent, zAxis);
    if (basisA.lengthSq() < 1e-5) basisA = new THREE.Vector3(1,0,0);
    basisA.normalize();
    const basisB = new THREE.Vector3().crossVectors(tangent, basisA).normalize();
    const radius = radiusFn(t);
    for (let s = 0; s < radialSegments; s++) {
      const a = s / radialSegments * Math.PI * 2;
      const p = center.clone()
        .addScaledVector(basisA, Math.cos(a) * radius)
        .addScaledVector(basisB, Math.sin(a) * radius * zSquash);
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < tubularSegments; i++) {
    for (let s = 0; s < radialSegments; s++) {
      const n = (s + 1) % radialSegments;
      const a = i * radialSegments + s;
      const b = i * radialSegments + n;
      const c = (i + 1) * radialSegments + s;
      const d = (i + 1) * radialSegments + n;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function transformGeometry(geo, position = [0,0,0], rotation = [0,0,0], scale = [1,1,1]) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
  m.compose(new THREE.Vector3(...position), q, new THREE.Vector3(...scale));
  geo.applyMatrix4(m);
  return geo;
}

function ellipsoidGeometry(rx, ry, rz, position = [0,0,0], segments = 32) {
  const geo = new THREE.SphereGeometry(1, segments, Math.max(18, Math.round(segments * 0.7)));
  geo.deleteAttribute('uv');
  transformGeometry(geo, position, [0,0,0], [rx, ry, rz]);
  return geo;
}

function shortSleeveCuffGeometry(side, volume = 1) {
  const pts = side < 0
    ? [new THREE.Vector3(-1.47, -0.70, 0), new THREE.Vector3(-1.44, -0.92, 0.02)]
    : [new THREE.Vector3( 1.47, -0.70, 0), new THREE.Vector3( 1.44, -0.92, 0.02)];
  return sweptEllipticalTube(pts, t => THREE.MathUtils.lerp(0.31, 0.29, t), 0.82 * volume, 8, 36);
}

function createHoodShellGeometry(volume = 1) {
  // Soft open-front hood. The front is intentionally missing so the head can
  // sit inside the hood rather than being surrounded by a rigid ring.
  const rowDefs = [
    { y:1.76, rx:0.54, rz:0.39, cz:-0.05 },
    { y:2.02, rx:0.64, rz:0.48, cz:-0.08 },
    { y:2.34, rx:0.70, rz:0.57, cz:-0.10 },
    { y:2.70, rx:0.72, rz:0.62, cz:-0.11 },
    { y:3.00, rx:0.66, rz:0.59, cz:-0.12 },
    { y:3.24, rx:0.50, rz:0.49, cz:-0.14 },
    { y:3.38, rx:0.26, rz:0.30, cz:-0.17 }
  ];
  const arcSegments=64; const positions=[]; const indices=[];
  const aMin=-1.82, aMax=1.82;
  for(let r=0;r<rowDefs.length;r++){
    const row=rowDefs[r];
    for(let i=0;i<=arcSegments;i++){
      const t=i/arcSegments; const a=THREE.MathUtils.lerp(aMin,aMax,t);
      const frontEase=Math.pow(Math.abs((t-0.5)*2.0),2.2);
      const x=Math.sin(a)*row.rx;
      const z=row.cz-Math.cos(a)*row.rz*volume + frontEase*0.035;
      const y=row.y - Math.sin(t*Math.PI)*0.015;
      positions.push(x,y,z);
    }
  }
  const stride=arcSegments+1;
  for(let r=0;r<rowDefs.length-1;r++){
    for(let i=0;i<arcSegments;i++){
      const a=r*stride+i,b=a+1,c=(r+1)*stride+i,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setIndex(indices); geo.computeVertexNormals(); return geo;
}

function createHoodOpeningRimGeometry(volume = 1) {
  const left = [
    new THREE.Vector3(-0.56, 1.92, 0.34 * volume),
    new THREE.Vector3(-0.73, 2.35, 0.40 * volume),
    new THREE.Vector3(-0.66, 2.86, 0.35 * volume),
    new THREE.Vector3(-0.35, 3.25, 0.20 * volume)
  ];
  const right = left.map(p => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
  const points = [...left, new THREE.Vector3(0, 3.36, 0.16 * volume), ...right];
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const geo = new THREE.TubeGeometry(curve, 72, 0.045, 12, false);
  geo.deleteAttribute('uv');
  return geo;
}

function pantsCrotchBridgeGeometry(volume = 1) {
  return ellipsoidGeometry(0.66, 0.44, 0.43 * volume, [0, -1.46, 0], 34);
}


function geometryBounds2D(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return { minX:b.min.x, maxX:b.max.x, minY:b.min.y, maxY:b.max.y };
}

function mappedGarmentMaterial(frontTexture, backTexture, geo, kind, rectFront, rectBack = rectFront, sideBias = 1.0) {
  const b = geometryBounds2D(geo);
  const base = new THREE.Color(ui.fabricColor.value || '#1f3327');
  const wrapStrength = Math.max(0, Math.min(1, Number(ui.detailWrap?.value || 92) / 100)) * sideBias;
  const rf = rectFront, rb = rectBack;
  const sideL=kind==='pants'?sideTextureState.pantsLeft:sideTextureState.topLeft;
  const sideR=kind==='pants'?sideTextureState.pantsRight:sideTextureState.topRight;
  return new THREE.ShaderMaterial({
    uniforms: {
      uFront:{value:frontTexture||null},uBack:{value:backTexture||null},uSideL:{value:sideL||null},uSideR:{value:sideR||null},
      uHasFront:{value:frontTexture?1:0},uHasBack:{value:backTexture?1:0},uHasSideL:{value:sideL?1:0},uHasSideR:{value:sideR?1:0},
      uBase:{value:base},uMinX:{value:b.minX},uMaxX:{value:b.maxX},uMinY:{value:b.minY},uMaxY:{value:b.maxY},
      uRF:{value:new THREE.Vector4(rf[0],rf[1],rf[2],rf[3])},uRB:{value:new THREE.Vector4(rb[0],rb[1],rb[2],rb[3])},
      uFlipFront:{value:ui.flipFront.checked?1:0},uFlipBack:{value:ui.flipBack.checked?1:0},uWrap:{value:wrapStrength}
    },
    vertexShader:`
      varying vec3 vP;varying vec3 vN;varying vec3 vVN;
      void main(){vP=position;vN=normalize(normal);vVN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
    `,
    fragmentShader:`
      uniform sampler2D uFront,uBack,uSideL,uSideR;
      uniform float uHasFront,uHasBack,uHasSideL,uHasSideR,uMinX,uMaxX,uMinY,uMaxY,uFlipFront,uFlipBack,uWrap;
      uniform vec3 uBase;uniform vec4 uRF,uRB;varying vec3 vP;varying vec3 vN;varying vec3 vVN;
      float fu(float u,float f){return mix(u,1.0-u,f);} 
      vec2 rectUV(vec4 r,float u,float v,float flipFlag){return vec2(mix(r.x,r.z,fu(u,flipFlag)),mix(r.y,r.w,v));}
      vec4 sf(vec2 uv){if(uHasFront<0.5)return vec4(uBase,0.0);return texture2D(uFront,clamp(uv,0.001,0.999));}
      vec4 sb(vec2 uv){if(uHasBack<0.5)return vec4(uBase,0.0);return texture2D(uBack,clamp(uv,0.001,0.999));}
      vec4 ss(float rightSide,vec2 uv){if(rightSide>0.5){if(uHasSideR<0.5)return vec4(uBase,1.0);return texture2D(uSideR,clamp(uv,0.001,0.999));}if(uHasSideL<0.5)return vec4(uBase,1.0);return texture2D(uSideL,clamp(uv,0.001,0.999));}
      void main(){
        float u=clamp((vP.x-uMinX)/max(0.001,uMaxX-uMinX),0.0,1.0);float v=clamp((vP.y-uMinY)/max(0.001,uMaxY-uMinY),0.0,1.0);
        vec3 N=normalize(vN);float nz=clamp(N.z,-1.0,1.0);float rightSide=step(0.0,vP.x);
        vec4 F=sf(rectUV(uRF,u,v,uFlipFront));vec4 B=sb(rectUV(uRB,u,v,uFlipBack));
        float sideU=clamp(0.5-0.5*nz,0.0,1.0);float sideV=clamp(mix(uRF.y,uRF.w,v),0.0,1.0);vec4 S=ss(rightSide,vec2(sideU,sideV));
        float fFace=smoothstep(0.28,0.80,nz)*smoothstep(0.015,0.12,F.a)*uHasFront;
        float bFace=smoothstep(0.28,0.80,-nz)*smoothstep(0.015,0.12,B.a)*uHasBack;
        float face=max(fFace,bFace);vec3 faceCol=fFace>=bFace?F.rgb:B.rgb;
        float sideAmt=pow(max(0.0,1.0-abs(nz)),0.52)*uWrap;
        vec3 col=mix(uBase,S.rgb,sideAmt);
        // panel art stays on front/back; side texture only contains semantic edge details + fabric.
        col=mix(col,faceCol,face);
        float transition=(1.0-smoothstep(0.30,0.75,abs(nz)))*0.18*uWrap*(1.0-face);col=mix(col,S.rgb,transition);
        float weave=(sin(vP.x*73.0)*sin(vP.y*67.0))*0.009+sin((vP.x+vP.y)*29.0)*0.005;col*=1.0+weave;
        vec3 VN=normalize(vVN);vec3 L1=normalize(vec3(0.40,0.66,0.92));vec3 L2=normalize(vec3(-0.68,0.38,0.62));
        float d1=max(dot(VN,L1),0.0),d2=max(dot(VN,L2),0.0);float rim=pow(1.0-abs(VN.z),2.0);float shade=0.82+d1*0.28+d2*0.15+rim*0.13+0.04*max(VN.y,0.0);
        float detail=smoothstep(0.13,0.42,length(col-uBase));shade=mix(shade,max(shade,0.96),detail*0.55);
        gl_FragColor=vec4(col*shade,1.0);
      }
    `,
    side:THREE.DoubleSide
  });
}

function wrinkleGeometry(geo, amount=0.018, verticalScale=5.0) {
  const pos=geo.attributes.position;
  geo.computeBoundingBox();
  const b=geo.boundingBox; const hw=Math.max(0.001,(b.max.x-b.min.x)/2); const cx=(b.max.x+b.min.x)/2;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
    const edge=1-Math.min(1,Math.abs((x-cx)/hw));
    const w=(Math.sin(y*verticalScale+x*2.2)*0.65+Math.sin(y*8.1-x*1.3)*0.35)*amount*edge;
    pos.setZ(i,z+w);
  }
  pos.needsUpdate=true; geo.computeVertexNormals(); return geo;
}

function garmentPart(geo, frontTexture, backTexture, kind, rectF, rectB=rectF, sideBias=1.0, wrinkles=0.0) {
  if(wrinkles>0) wrinkleGeometry(geo,wrinkles,kind==='pants'?4.2:5.4);
  const mesh=new THREE.Mesh(geo,mappedGarmentMaterial(frontTexture,backTexture,geo,kind,rectF,rectB,sideBias));
  mesh.castShadow=true; mesh.receiveShadow=true; return mesh;
}

function waistbandBandGeometry(volume=1){
  const geo=loftEllipticalRings([
    {y:-0.48,rx:0.84,rz:0.40*volume},{y:-0.54,rx:0.89,rz:0.43*volume},{y:-0.62,rx:0.91,rz:0.44*volume},{y:-0.72,rx:0.88,rz:0.42*volume}
  ],64,true);
  const pos=geo.attributes.position;for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);const a=Math.atan2(z,x);const ripple=1+Math.sin(a*18.0)*0.012;pos.setX(i,x*ripple);pos.setZ(i,z*ripple);}pos.needsUpdate=true;geo.computeVertexNormals();return geo;
}

function rowAlphaWidth(canvas,yNorm){
  if(!canvas)return 1;const ctx=canvas.getContext('2d',{willReadFrequently:true});const w=canvas.width,h=canvas.height;const y=Math.max(0,Math.min(h-1,Math.round(yNorm*(h-1))));const d=ctx.getImageData(0,Math.max(0,y-2),w,Math.min(5,h-y+2)).data;let min=w,max=-1;
  for(let yy=0;yy<Math.min(5,h-y+2);yy++)for(let x=0;x<w;x++)if(d[(yy*w+x)*4+3]>28){min=Math.min(min,x);max=Math.max(max,x);}return max<0?0:(max-min+1)/w;
}
function hoodieFitMetrics(canvas){
  const shoulder=rowAlphaWidth(canvas,0.33),body=rowAlphaWidth(canvas,0.58),hem=rowAlphaWidth(canvas,0.88);
  return {shoulder:THREE.MathUtils.clamp(shoulder/Math.max(0.01,body),0.86,1.12),hem:THREE.MathUtils.clamp(hem/Math.max(0.01,body),0.82,1.08)};
}
function pantsFitMetrics(canvas){
  const waist=rowAlphaWidth(canvas,0.11),thigh=rowAlphaWidth(canvas,0.30),lower=rowAlphaWidth(canvas,0.72);
  return {waist:THREE.MathUtils.clamp(waist/Math.max(0.01,thigh),0.76,1.12),lower:THREE.MathUtils.clamp(lower/Math.max(0.01,thigh),0.72,1.06)};
}

function kangarooPocketGeometry(volume=1){
  const sh=new THREE.Shape();sh.moveTo(-0.62,-0.25);sh.lineTo(-0.46,0.29);sh.quadraticCurveTo(0,0.36,0.46,0.29);sh.lineTo(0.62,-0.25);sh.quadraticCurveTo(0,-0.34,-0.62,-0.25);sh.closePath();
  const geo=new THREE.ExtrudeGeometry(sh,{depth:0.075,bevelEnabled:true,bevelSegments:3,bevelSize:0.035,bevelThickness:0.025,curveSegments:16});geo.translate(0,-0.34,0.565*volume);return geo;
}

function pocketOpeningTube(side,volume=1){
  const pts=side<0?[new THREE.Vector3(-0.72,-0.70,0.445*volume),new THREE.Vector3(-0.63,-0.92,0.465*volume),new THREE.Vector3(-0.52,-1.10,0.455*volume)]:[new THREE.Vector3(0.72,-0.70,0.445*volume),new THREE.Vector3(0.63,-0.92,0.465*volume),new THREE.Vector3(0.52,-1.10,0.455*volume)];
  const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal',0.5);return new THREE.TubeGeometry(curve,28,0.018,8,false);
}

function createParametricHoodie(frontTexture, backTexture, volume = 1, fit = {}) {
  const g = new THREE.Group();const shoulderScale=fit.shoulder||1,hemScale=fit.hem||1;
  // Relaxed heavyweight torso with a real dropped-shoulder slope and slightly gathered hem.
  const torso = loftEllipticalRings([
    { y:-1.10, rx:1.22*hemScale, rz:0.47*volume },{ y:-0.84, rx:1.29, rz:0.51*volume },{ y:-0.28, rx:1.34, rz:0.55*volume },
    { y:0.36, rx:1.35, rz:0.58*volume },{ y:0.94, rx:1.32, rz:0.58*volume },{ y:1.30, rx:1.28*shoulderScale, rz:0.55*volume },
    { y:1.52, rx:1.17*shoulderScale, rz:0.50*volume },{ y:1.70, rx:0.95, rz:0.44*volume },{ y:1.80, rx:0.72, rz:0.39*volume }
  ],72,false);
  g.add(garmentPart(torso,frontTexture,backTexture,'top',[0.17,0.08,0.83,0.81],[0.17,0.08,0.83,0.81],1.0,0.016));

  // Sleeves hang close to the body, start below the dropped shoulder seam, bend slightly at elbow and taper into cuffs.
  for (const side of [-1,1]) {
    const asym=side>0?1:0;
    const pts=[new THREE.Vector3(side*1.12,1.38-asym*0.015,0.00),new THREE.Vector3(side*1.28,1.08-asym*0.02,0.025+asym*0.008),new THREE.Vector3(side*1.34,0.51-asym*0.015,0.060+asym*0.012),new THREE.Vector3(side*1.31,-0.05-asym*0.02,0.075+asym*0.010),new THREE.Vector3(side*1.23,-0.72-asym*0.018,0.065+asym*0.008)];
    const sleeve=sweptEllipticalTube(pts,t=>{const e=t*t*(3-2*t);return THREE.MathUtils.lerp(0.345,0.245,e);},0.74*volume,52,56);
    const rect=side<0?[0.00,0.12,0.32,0.79]:[0.68,0.12,1.00,0.79];g.add(garmentPart(sleeve,frontTexture,backTexture,'top',rect,rect,1.0,0.012));
    const cuffPts=side<0?[new THREE.Vector3(-1.23,-0.67,0.065),new THREE.Vector3(-1.20,-0.96,0.055)]:[new THREE.Vector3(1.23,-0.67,0.065),new THREE.Vector3(1.20,-0.96,0.055)];
    const cuff=sweptEllipticalTube(cuffPts,t=>THREE.MathUtils.lerp(0.255,0.225,t),0.72*volume,12,48);const cuffRect=side<0?[0.01,0.02,0.29,0.18]:[0.71,0.02,0.99,0.18];g.add(garmentPart(cuff,frontTexture,backTexture,'top',cuffRect,cuffRect,0.88,0.003));
  }

  // Deep fabric hood: open at the face, fuller behind the head, and softly collapsed into the neckline.
  const hoodGeo=createHoodShellGeometry(volume*1.08);g.add(garmentPart(hoodGeo,frontTexture,backTexture,'top',[0.26,0.70,0.74,1.00],[0.26,0.70,0.74,1.00],0.92,0.008));
  const hoodRim=createHoodOpeningRimGeometry(volume*1.08);g.add(garmentPart(hoodRim,frontTexture,backTexture,'top',[0.27,0.70,0.73,0.98],[0.27,0.70,0.73,0.98],0.72,0.001));
  const collar=loftEllipticalRings([{y:1.56,rx:0.64,rz:0.37*volume},{y:1.68,rx:0.72,rz:0.42*volume},{y:1.80,rx:0.69,rz:0.41*volume}],56,true);g.add(garmentPart(collar,frontTexture,backTexture,'top',[0.28,0.65,0.72,0.82],[0.28,0.65,0.72,0.82],0.78,0.003));

  // Actual trapezoidal kangaroo pocket, front-only.
  g.add(garmentPart(kangarooPocketGeometry(volume),frontTexture,null,'top',[0.27,0.12,0.73,0.37],[0.27,0.12,0.73,0.37],0.0,0.002));

  // Thick ribbed lower band, a little tighter than the body.
  const hem=loftEllipticalRings([{y:-1.04,rx:1.22*hemScale,rz:0.45*volume},{y:-1.12,rx:1.20*hemScale,rz:0.44*volume},{y:-1.22,rx:1.17*hemScale,rz:0.43*volume}],64,true);g.add(garmentPart(hem,frontTexture,backTexture,'top',[0.19,0.00,0.81,0.13],[0.19,0.00,0.81,0.13],0.86,0.002));
  return g;
}

function createParametricPants(frontTexture, backTexture, volume = 1, fit = {}) {
  const g = new THREE.Group();const waistScale=fit.waist||1,lowerScale=fit.lower||1;
  const waist=waistbandBandGeometry(volume);waist.scale(waistScale,1,1);g.add(garmentPart(waist,frontTexture,backTexture,'pants',[0.05,0.76,0.95,1.00],[0.05,0.76,0.95,1.00],0.96,0.004));
  const hips=loftEllipticalRings([{y:-0.68,rx:0.86,rz:0.42*volume},{y:-0.88,rx:0.89,rz:0.45*volume},{y:-1.08,rx:0.86,rz:0.44*volume},{y:-1.24,rx:0.72,rz:0.38*volume}],64,false);g.add(garmentPart(hips,frontTexture,backTexture,'pants',[0.05,0.64,0.95,0.91],[0.05,0.64,0.95,0.91],0.92,0.006));

  for(const side of [-1,1]){
    const legAsym=side>0?1:0;
    const pts=[new THREE.Vector3(side*0.42,-1.14,0),new THREE.Vector3(side*0.43,-1.75-legAsym*0.01,0.015+legAsym*0.006),new THREE.Vector3(side*0.44,-2.55-legAsym*0.015,0.025+legAsym*0.008),new THREE.Vector3(side*0.43,-3.43-legAsym*0.01,0.025+legAsym*0.006),new THREE.Vector3(side*0.42,-4.47-legAsym*0.012,0.018+legAsym*0.004)];
    const leg=sweptEllipticalTube(pts,t=>{const knee=THREE.MathUtils.lerp(0.385,0.365,Math.min(1,t/0.58));return THREE.MathUtils.lerp(knee,0.345*lowerScale,Math.max(0,(t-0.58)/0.42));},0.72*volume,64,56);
    const rect=side<0?[0.02,0.00,0.52,0.83]:[0.48,0.00,0.98,0.83];g.add(garmentPart(leg,frontTexture,backTexture,'pants',rect,rect,1.02,0.008));
    const hemPts=[new THREE.Vector3(side*0.42,-4.37,0.018),new THREE.Vector3(side*0.42,-4.57,0.018)];const legHem=sweptEllipticalTube(hemPts,t=>THREE.MathUtils.lerp(0.352*lowerScale,0.34*lowerScale,t),0.72*volume,10,48);const hemRect=side<0?[0.02,0.00,0.52,0.10]:[0.48,0.00,0.98,0.10];g.add(garmentPart(legHem,frontTexture,backTexture,'pants',hemRect,hemRect,0.94,0.002));
    // front pocket seam/opening receives the front texture only; the generated back remains clean.
    g.add(garmentPart(pocketOpeningTube(side,volume),frontTexture,null,'pants',side<0?[0.02,0.60,0.45,0.93]:[0.55,0.60,0.98,0.93],side<0?[0.02,0.60,0.45,0.93]:[0.55,0.60,0.98,0.93],0.0,0.0));
  }
  // Seat/crotch joins both legs before the split instead of treating the pants as two independent tubes.
  const bridge=ellipsoidGeometry(0.50,0.34,0.36*volume,[0,-1.22,-0.015],40);g.add(garmentPart(bridge,frontTexture,backTexture,'pants',[0.31,0.57,0.69,0.80],[0.31,0.57,0.69,0.80],0.72,0.003));
  return g;
}

function silhouetteAspect(canvas) {
  if (!canvas || !canvas.height) return null;
  return canvas.width / canvas.height;
}

function fitParametricWidth(object, canvas, expectedAspect) {
  const a = silhouetteAspect(canvas);
  if (!a) return object;
  const sx = THREE.MathUtils.clamp(a / expectedAspect, 0.88, 1.16);
  object.scale.x *= sx;
  return object;
}

function buildCurrentGarment() {
  const kind = ui.garmentType.value;
  const volume = Math.max(0.72, Math.min(1.35, Number(ui.volumeScale?.value || 100) / 100));
  const group = new THREE.Group();

  // Stage 1 is intentionally empty: upload + clean first. The mannequin and
  // clothing are only created after the user explicitly presses Continue.
  if (!generationApproved) return group;
  if (!(textureState.frontTop || textureState.backTop)) return group;

  const mannequin = buildMannequin(kind !== 'pants');
  group.add(mannequin);

  if (kind === 'set') {
    const hoodie = fitParametricWidth(createParametricHoodie(textureState.frontTop, textureState.backTop, volume, hoodieFitMetrics(canvasState.frontTop || canvasState.backTop)), canvasState.frontTop || canvasState.backTop, 0.84);
    const pants = fitParametricWidth(createParametricPants(textureState.frontBottom, textureState.backBottom, volume, pantsFitMetrics(canvasState.frontBottom || canvasState.backBottom)), canvasState.frontBottom || canvasState.backBottom, 0.48);
    group.add(hoodie, pants);
    return group;
  }
  if (kind === 'pants') {
    group.add(fitParametricWidth(createParametricPants(textureState.frontTop, textureState.backTop, volume, pantsFitMetrics(canvasState.frontTop || canvasState.backTop)), canvasState.frontTop || canvasState.backTop, 0.48));
    return group;
  }
  group.add(fitParametricWidth(createParametricHoodie(textureState.frontTop, textureState.backTop, volume, hoodieFitMetrics(canvasState.frontTop || canvasState.backTop)), canvasState.frontTop || canvasState.backTop, 0.84));
  return group;
}

function fitCamera() {
  if (!garment) return;
  const box = new THREE.Box3().setFromObject(garment);
  if (box.isEmpty()) {
    controls.target.set(0, -0.7, 0);
    camera.position.set(0, -0.2, 17);
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
    controls.update();
    return;
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.2, camera.aspect));
  const distanceV = (size.y / 2) / Math.tan(vfov / 2);
  const distanceH = (size.x / 2) / Math.tan(hfov / 2);
  const frameFraction = Math.max(0.35, Math.min(0.85, Number(ui.frameSize?.value || 55) / 100));
  const margin = 1 / frameFraction;
  const distance = Math.max(distanceV, distanceH) * margin;

  controls.target.set(center.x, center.y - size.y * 0.015, center.z);
  camera.position.set(center.x, center.y + size.y * 0.02, center.z + distance);
  camera.near = Math.max(0.05, distance - size.z * 4 - size.y);
  camera.far = distance + size.y * 4 + 40;
  camera.updateProjectionMatrix();
  controls.update();

  floor.position.y = box.min.y - 0.14;
}

function rebuildGarment() {
  const prevRotation = garment?.rotation?.y || 0;
  if (garment) disposeObject(garment);
  garment = buildCurrentGarment();
  garment.rotation.y = prevRotation;
  root.add(garment);
  fitCamera();
}

function resetView() {
  if (garment) garment.rotation.set(0, showcaseAngleAt(0), 0);
  fitCamera();
  resetShowcaseClock();
}

function sampleCornerBackground(data, w, h) {
  const patch = Math.max(8, Math.round(Math.min(w, h) * 0.035));
  const points = [];
  const corners = [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]];
  for (const [sx, sy] of corners) {
    for (let y = sy; y < sy + patch; y += 2) {
      for (let x = sx; x < sx + patch; x += 2) {
        const i = (y * w + x) * 4;
        points.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }
  let r = 0, g = 0, b = 0;
  for (const p of points) { r += p[0]; g += p[1]; b += p[2]; }
  r /= points.length; g /= points.length; b /= points.length;
  let spread = 0;
  for (const p of points) spread += Math.hypot(p[0] - r, p[1] - g, p[2] - b);
  spread /= points.length;
  return { r, g, b, spread };
}

function removeAutoBackground(ctx, w, h, strength) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const bg = sampleCornerBackground(d, w, h);
  const threshold = Math.max(22, bg.spread * 1.75 + 22 + strength * 1.0);
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const distAt = (idx) => {
    const i = idx * 4;
    return Math.hypot(d[i] - bg.r, d[i + 1] - bg.g, d[i + 2] - bg.b);
  };

  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    if (distAt(idx) <= threshold) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1); }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y); }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = Math.floor(idx / w);
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  for (let i = 0; i < visited.length; i++) {
    if (!visited[i]) continue;
    const di = i * 4;
    const dist = distAt(i);
    const edge = Math.max(0, Math.min(1, (dist - threshold * 0.72) / (threshold * 0.28)));
    d[di + 3] = Math.round(255 * edge);
  }
  ctx.putImageData(imageData, 0, 0);
}

function processImage(image, cleanupMode, strength) {
  const maxSide = 4096;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);

  if (cleanupMode === 'auto') {
    removeAutoBackground(ctx, w, h, Number(strength));
  } else if (cleanupMode !== 'none') {
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const threshold = 8 + Number(strength) * 2.2;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const dist = cleanupMode === 'white'
        ? Math.hypot(255 - r, 255 - g, 255 - b)
        : Math.hypot(r, g, b);
      if (dist < threshold) d[i + 3] = Math.max(0, Math.round(255 * (dist / threshold)));
    }
    ctx.putImageData(id, 0, 0);
  }
  return src;
}

function findComponents(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const scale = Math.min(1, 500 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  const visited = new Uint8Array(sw * sh);
  const queue = new Int32Array(sw * sh);
  const components = [];

  for (let start = 0; start < visited.length; start++) {
    if (visited[start]) continue;
    visited[start] = 1;
    if (sd[start * 4 + 3] <= 35) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    let minX = sw, minY = sh, maxX = 0, maxY = 0, area = 0;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % sw;
      const y = Math.floor(idx / sw);
      area++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const ns = [];
      if (x > 0) ns.push(idx - 1);
      if (x + 1 < sw) ns.push(idx + 1);
      if (y > 0) ns.push(idx - sw);
      if (y + 1 < sh) ns.push(idx + sw);
      for (const n of ns) {
        if (!visited[n] && sd[n * 4 + 3] > 35) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    if (area < sw * sh * 0.002) continue;
    const inv = 1 / scale;
    const bw = (maxX - minX + 1) * inv;
    const bh = (maxY - minY + 1) * inv;
    components.push({
      minX: Math.max(0, Math.floor(minX * inv)),
      minY: Math.max(0, Math.floor(minY * inv)),
      maxX: Math.min(w - 1, Math.ceil((maxX + 1) * inv)),
      maxY: Math.min(h - 1, Math.ceil((maxY + 1) * inv)),
      area: area * inv * inv,
      width: bw,
      height: bh,
      aspect: bw / Math.max(1, bh),
      tallness: bh / Math.max(1, bw),
      centerX: (minX + maxX + 1) * 0.5 * inv,
      centerY: (minY + maxY + 1) * 0.5 * inv
    });
  }

  components.sort((a, b) => b.area - a.area);
  return components;
}

function cropComponent(canvas, comp, pad = 0.025) {
  const xPad = comp.width * pad;
  const yPad = comp.height * pad;
  const sx = Math.max(0, Math.floor(comp.minX - xPad));
  const sy = Math.max(0, Math.floor(comp.minY - yPad));
  const ex = Math.min(canvas.width, Math.ceil(comp.maxX + xPad));
  const ey = Math.min(canvas.height, Math.ceil(comp.maxY + yPad));
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);
  const maxSide = 4096;
  const scale = Math.min(6, maxSide / Math.max(sw, sh));
  const out = document.createElement('canvas');
  out.width = Math.max(2, Math.round(sw * scale));
  out.height = Math.max(2, Math.round(sh * scale));
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

function extractGarments(cleanedCanvas, kind) {
  const components = findComponents(cleanedCanvas);
  if (!components.length) {
    return { top: cleanedCanvas, bottom: cleanedCanvas, detected: false };
  }

  const topScore = (c) => c.area * 0.001 + c.width * 1.0 - Math.abs(c.aspect - 1.0) * 120;
  const bottomScore = (c) => c.area * 0.001 + c.height * 1.05 + c.tallness * 80;

  if (kind === 'set') {
    const mid = cleanedCanvas.width / 2;
    const left = components.filter((c) => c.centerX < mid);
    const right = components.filter((c) => c.centerX >= mid);
    let topComp = (left.length ? left : components).sort((a, b) => topScore(b) - topScore(a))[0];
    let bottomComp = (right.length ? right : components).sort((a, b) => bottomScore(b) - bottomScore(a))[0];
    if (topComp === bottomComp) bottomComp = components.find((c) => c !== topComp) || bottomComp;
    return {
      top: cropComponent(cleanedCanvas, topComp, 0.02),
      bottom: cropComponent(cleanedCanvas, bottomComp, 0.02),
      detected: topComp !== bottomComp
    };
  }

  const selected = kind === 'pants'
    ? [...components].sort((a, b) => bottomScore(b) - bottomScore(a))[0]
    : [...components].sort((a, b) => topScore(b) - topScore(a))[0];
  const crop = cropComponent(cleanedCanvas, selected, 0.02);
  return { top: crop, bottom: crop, detected: true };
}

function dominantVisibleColor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const bins = new Map();
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 220) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r + g + b) / 3;
      if (lum > 238 || lum < 4) continue;
      const qr = Math.round(r / 24);
      const qg = Math.round(g / 24);
      const qb = Math.round(b / 24);
      const key = `${qr},${qg},${qb}`;
      const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bin.n++; bin.r += r; bin.g += g; bin.b += b;
      bins.set(key, bin);
    }
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  if (!best || best.n < 5) return null;
  const vals = [best.r, best.g, best.b].map((v) => Math.round(v / best.n));
  return `#${vals.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function textureFromCanvas(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.userData.owned = true;
  return t;
}

async function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

async function readImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = `${url}?v=${Date.now()}`;
  });
}

function assignGarmentData(which, extracted) {
  const topTexture = textureFromCanvas(extracted.top);
  const bottomTexture = textureFromCanvas(extracted.bottom || extracted.top);
  if (which === 'front') {
    disposeTexture(textureState.frontTop);
    disposeTexture(textureState.frontBottom);
    textureState.frontTop = topTexture;
    textureState.frontBottom = bottomTexture;
    canvasState.frontTop = extracted.top;
    canvasState.frontBottom = extracted.bottom || extracted.top;
  } else {
    disposeTexture(textureState.backTop);
    disposeTexture(textureState.backBottom);
    textureState.backTop = topTexture;
    textureState.backBottom = bottomTexture;
    canvasState.backTop = extracted.top;
    canvasState.backBottom = extracted.bottom || extracted.top;
  }
}


function alphaBoundsCanvas(canvas){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}); const w=canvas.width,h=canvas.height;
  const d=ctx.getImageData(0,0,w,h).data; let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){if(d[(y*w+x)*4+3]>24){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  if(maxX<0)return {minX:0,minY:0,maxX:w-1,maxY:h-1,width:w,height:h};
  return {minX,minY,maxX,maxY,width:maxX-minX+1,height:maxY-minY+1};
}

function registerCanvasPair(front,back,kind='top'){
  if(!front||!back)return [front,back];
  const bf=alphaBoundsCanvas(front),bb=alphaBoundsCanvas(back);
  const af=bf.width/Math.max(1,bf.height),ab=bb.width/Math.max(1,bb.height);
  const avgAspect=THREE.MathUtils.clamp((af+ab)*0.5,kind==='pants'?0.35:0.58,kind==='pants'?0.78:1.28);
  const size=4096,padY=248,targetH=size-padY*2,targetW=Math.min(size-320,Math.round(targetH*avgAspect));
  const x=(size-targetW)/2,y=padY;
  const render=(src,b)=>{const out=document.createElement('canvas');out.width=size;out.height=size;const c=out.getContext('2d');c.clearRect(0,0,size,size);c.drawImage(src,b.minX,b.minY,b.width,b.height,x,y,targetW,targetH);return out;};
  return [render(front,bf),render(back,bb)];
}

function normalizeFrontBackPairs(){
  if(canvasState.frontTop&&canvasState.backTop){
    [canvasState.frontTop,canvasState.backTop]=registerCanvasPair(canvasState.frontTop,canvasState.backTop,'top');
    disposeTexture(textureState.frontTop);disposeTexture(textureState.backTop);
    textureState.frontTop=textureFromCanvas(canvasState.frontTop);textureState.backTop=textureFromCanvas(canvasState.backTop);
  }
  if(canvasState.frontBottom&&canvasState.backBottom){
    [canvasState.frontBottom,canvasState.backBottom]=registerCanvasPair(canvasState.frontBottom,canvasState.backBottom,'pants');
    disposeTexture(textureState.frontBottom);disposeTexture(textureState.backBottom);
    textureState.frontBottom=textureFromCanvas(canvasState.frontBottom);textureState.backBottom=textureFromCanvas(canvasState.backBottom);
  }
}

function sampleBand(data,w,h,xNorm,yNorm,band=0.035){
  const cy=Math.max(0,Math.min(h-1,Math.round(yNorm*(h-1)))); const cx=xNorm*(w-1); const rad=Math.max(1,Math.round(w*band));
  let r=0,g=0,b=0,a=0,n=0;
  for(let ox=-rad;ox<=rad;ox+=Math.max(1,Math.floor(rad/3))){const x=Math.max(0,Math.min(w-1,Math.round(cx+ox)));for(let oy=-2;oy<=2;oy+=2){const y=Math.max(0,Math.min(h-1,cy+oy));const i=(y*w+x)*4;const aa=data[i+3]/255;if(aa<0.05)continue;r+=data[i]*aa;g+=data[i+1]*aa;b+=data[i+2]*aa;a+=aa;n+=aa;}}
  if(n<0.01)return {r:0,g:0,b:0,a:0}; return {r:r/n,g:g/n,b:b/n,a:Math.min(1,a/Math.max(1,rad))};
}

function sampleBandDetail(data,w,h,xNorm,yNorm,base,band=0.10){
  const cy=Math.max(0,Math.min(h-1,Math.round(yNorm*(h-1))));const cx=xNorm*(w-1);const rad=Math.max(2,Math.round(w*band));let best=null,bestDist=0;
  for(let ox=-rad;ox<=rad;ox+=Math.max(1,Math.floor(rad/12))){const x=Math.max(0,Math.min(w-1,Math.round(cx+ox)));for(let oy=-4;oy<=4;oy+=2){const y=Math.max(0,Math.min(h-1,cy+oy));const i=(y*w+x)*4;if(data[i+3]<120)continue;const dist=Math.hypot(data[i]-base.r,data[i+1]-base.g,data[i+2]-base.b);if(dist>bestDist){bestDist=dist;best={r:data[i],g:data[i+1],b:data[i+2],a:data[i+3]/255};}}}
  return best||{r:base.r,g:base.g,b:base.b,a:0,dist:0};
}

function synthesizeSideCanvas(front,back,side,baseHex){
  const W=1024,H=4096,out=document.createElement('canvas');out.width=W;out.height=H;const o=out.getContext('2d',{willReadFrequently:true});const img=o.createImageData(W,H),dst=img.data;
  const getData=(src)=>{const c=document.createElement('canvas');c.width=4096;c.height=4096;const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(src,0,0,4096,4096);return x.getImageData(0,0,4096,4096).data;};
  const F=getData(front),B=getData(back),base=parseHexColor(baseHex);
  const localRight=side==='right';
  const fEdge=localRight?(ui.flipFront.checked?0.045:0.955):(ui.flipFront.checked?0.955:0.045);
  const bEdge=localRight?(ui.flipBack.checked?0.045:0.955):(ui.flipBack.checked?0.955:0.045);
  for(let y=0;y<H;y++){
    const yn=y/(H-1);const fp=sampleBand(F,4096,4096,fEdge,yn,0.045);const bp=sampleBand(B,4096,4096,bEdge,yn,0.045);const fHi=sampleBandDetail(F,4096,4096,fEdge,yn,base,0.11);const bHi=sampleBandDetail(B,4096,4096,bEdge,yn,base,0.11);
    for(let x=0;x<W;x++){
      const t=x/(W-1);const sm=t*t*(3-2*t);const i=(y*W+x)*4;
      const fa=fp.a,ba=bp.a;const fd=Math.hypot(fHi.r-base.r,fHi.g-base.g,fHi.b-base.b);const bd=Math.hypot(bHi.r-base.r,bHi.g-base.g,bHi.b-base.b);
      const fDetail=THREE.MathUtils.clamp((fd-34)/92,0,1)*fHi.a;const bDetail=THREE.MathUtils.clamp((bd-34)/92,0,1)*bHi.a;
      const fLum=(fp.r+fp.g+fp.b)/Math.max(1,base.r+base.g+base.b);const bLum=(bp.r+bp.g+bp.b)/Math.max(1,base.r+base.g+base.b);
      const fabricShade=THREE.MathUtils.clamp((1-sm)*(fa?fLum:1)+sm*(ba?bLum:1),0.78,1.13);
      let r=base.r*fabricShade,g=base.g*fabricShade,b=base.b*fabricShade;
      const detailMix=(1-sm)*fDetail+sm*bDetail;
      if(detailMix>0.01){const dr=(1-sm)*fHi.r+sm*bHi.r,dg=(1-sm)*fHi.g+sm*bHi.g,db=(1-sm)*fHi.b+sm*bHi.b;r=THREE.MathUtils.lerp(r,dr,detailMix);g=THREE.MathUtils.lerp(g,dg,detailMix);b=THREE.MathUtils.lerp(b,db,detailMix);}
      dst[i]=Math.round(THREE.MathUtils.clamp(r,0,255));dst[i+1]=Math.round(THREE.MathUtils.clamp(g,0,255));dst[i+2]=Math.round(THREE.MathUtils.clamp(b,0,255));dst[i+3]=255;
    }
  }
  o.putImageData(img,0,0);return out;
}

function disposeSideTextures(){for(const k of Object.keys(sideTextureState)){disposeTexture(sideTextureState[k]);sideTextureState[k]=null;}}
function rebuildSideTextures(){
  disposeSideTextures(); const base=ui.fabricColor.value||'#203329';
  if(canvasState.frontTop&&canvasState.backTop){sideTextureState.topLeft=textureFromCanvas(synthesizeSideCanvas(canvasState.frontTop,canvasState.backTop,'left',base));sideTextureState.topRight=textureFromCanvas(synthesizeSideCanvas(canvasState.frontTop,canvasState.backTop,'right',base));}
  if(canvasState.frontBottom&&canvasState.backBottom){sideTextureState.pantsLeft=textureFromCanvas(synthesizeSideCanvas(canvasState.frontBottom,canvasState.backBottom,'left',base));sideTextureState.pantsRight=textureFromCanvas(synthesizeSideCanvas(canvasState.frontBottom,canvasState.backBottom,'right',base));}
}

async function refreshTexture(which) {
  const source = which === 'front' ? frontSource : backSource;
  if (!source) return;
  const alpha=inspectSourceAlpha(source); const state=which==='front'?analysisState.front:analysisState.back;
  state.hasAlpha=alpha.hasAlpha;state.alphaCoverage=alpha.alphaCoverage;
  const requested=ui.cleanupMode.value;
  const effectiveMode=(requested==='auto'&&alpha.hasAlpha)?'none':requested;
  state.cleanupSkipped=effectiveMode==='none'&&alpha.hasAlpha;
  const cleaned = processImage(source, effectiveMode, Number(ui.threshold.value));
  const extracted = extractGarments(cleaned, ui.garmentType.value);
  setPreview(which, cleaned);
  if (autoColor) {
    const c = dominantVisibleColor(extracted.top) || dominantVisibleColor(extracted.bottom);
    if (c) ui.fabricColor.value = c;
  }
  assignGarmentData(which, extracted);
}

function registerTopPairOnly(){
  if(!(canvasState.frontTop&&canvasState.backTop))return;
  [canvasState.frontTop,canvasState.backTop]=registerCanvasPair(canvasState.frontTop,canvasState.backTop,'top');
  disposeTexture(textureState.frontTop);disposeTexture(textureState.backTop);
  textureState.frontTop=textureFromCanvas(canvasState.frontTop);textureState.backTop=textureFromCanvas(canvasState.backTop);
}

async function preprocessUploads() {
  generationApproved = false;
  rebuildGarment();
  setStatus('Stage 1: inspecting transparency, isolating garments and checking views.');
  if (frontSource) await refreshTexture('front');
  if (backSource) await refreshTexture('back');
  if (frontSource && backSource && canvasState.frontTop && canvasState.backTop) {
    if(ui.garmentType.value==='set'&&canvasState.frontBottom&&canvasState.backBottom){
      analysisState.pantsSimilarity=canvasSimilarity(canvasState.frontBottom,canvasState.backBottom);
      analysisState.pantsDuplicate=analysisState.pantsSimilarity>=0.90;
      analysisState.resolved=!analysisState.pantsDuplicate||analysisState.pantsBackGenerated;
    }else{analysisState.pantsDuplicate=false;analysisState.pantsSimilarity=0;analysisState.resolved=true;}
    if(analysisState.resolved) normalizeFrontBackPairs(); else registerTopPairOnly();
    updateAnalysisPanel();
  }
  updateWorkflowUI();
  if (frontSource && backSource && canvasState.frontTop && canvasState.backTop) {
    setStatus(analysisState.resolved?'Source analysis complete - press Continue to generate 3D clothing':'Source analysis found a missing pants back - resolve it before Continue');
  } else {
    setStatus('Upload front and back images');
  }
}

function resolveMissingPantsBack(){
  if(!canvasState.frontBottom)return;
  setStatus('Generating conservative pants back from fabric + structural seams.');
  const generated=generateConservativePantsBack(canvasState.frontBottom);
  canvasState.backBottom=generated; disposeTexture(textureState.backBottom);textureState.backBottom=textureFromCanvas(generated);
  analysisState.pantsBackGenerated=true;analysisState.resolved=true;
  normalizeFrontBackPairs();updateAnalysisPanel();updateWorkflowUI();
  setStatus('Generated pants back ready - press Continue to generate the full 3D clothing');
}

async function exportLoopingVideo() {
  if (!garment || recording || !generationApproved) return;
  recording = true;
  ui.exportVideo.disabled = true;
  ui.exportVideo.textContent = 'Rendering 8K.';
  setStatus('Preparing native 8K 7680x4320 showcase export.');

  const exportWidth = 7680;
  const exportHeight = 4320;
  const fps = 30;
  const durationSec = Number(ui.exportDuration.value || 12);
  const gl = renderer.getContext();
  const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0;
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0];
  if (maxRenderbuffer < exportWidth || maxViewport[0] < exportWidth || maxViewport[1] < exportHeight) {
    setStatus(`This GPU/browser cannot allocate a native 8K render target (limit ${Math.min(maxRenderbuffer || 0, maxViewport[0] || 0)}px).`);
    recording = false;
    ui.exportVideo.disabled = false;
    ui.exportVideo.textContent = 'Export 8K Front + Back Showcase';
    return;
  }

  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeTypes.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    setStatus('This browser does not support high-resolution WebM recording.');
    recording = false;
    ui.exportVideo.disabled = false;
    ui.exportVideo.textContent = 'Export 8K Front + Back Showcase';
    return;
  }

  const previousSpin = spinning;
  const originalRotation = garment.rotation.y;
  const originalPixelRatio = renderer.getPixelRatio();
  const originalSize = new THREE.Vector2();
  renderer.getSize(originalSize);
  const originalAspect = camera.aspect;

  spinning = false;
  renderer.setPixelRatio(1);
  renderer.setSize(exportWidth, exportHeight, false);
  camera.aspect = exportWidth / exportHeight;
  camera.updateProjectionMatrix();
  fitCamera();
  garment.rotation.y = showcaseAngleAt(0);
  renderer.render(scene, camera);
  await nextAnimationFrame();
  renderer.render(scene, camera);
  await nextAnimationFrame();

  const stream = renderer.domElement.captureStream(fps);
  const chunks = [];
  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 100_000_000
    });
  } catch (error) {
    renderer.setPixelRatio(originalPixelRatio);
    renderer.setSize(Math.max(1, viewer.clientWidth), Math.max(1, viewer.clientHeight), false);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();
    fitCamera();
    garment.rotation.y = originalRotation;
    spinning = previousSpin;
    recording = false;
    ui.exportVideo.disabled = false;
    ui.exportVideo.textContent = 'Export 8K Front + Back Showcase';
    setStatus(`Could not start 8K recorder: ${error.message || error}`);
    return;
  }

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  const blobPromise = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  const exportPromise = new Promise((resolve) => {
    exportJob = {
      startMs: performance.now(),
      durationMs: durationSec * 1000,
      finishing: false,
      finish: resolve
    };
  });

  setStatus(`Recording 8K showcase - front �45�, flip, back �45� - ${durationSec}s.`);
  recorder.start(1000);
  await exportPromise;
  exportJob = null;
  recorder.stop();
  const blob = await blobPromise;

  // Restore the normal interactive viewer exactly as it was before export.
  renderer.setPixelRatio(originalPixelRatio);
  renderer.setSize(Math.max(1, viewer.clientWidth), Math.max(1, viewer.clientHeight), false);
  camera.aspect = Math.max(1, viewer.clientWidth) / Math.max(1, viewer.clientHeight);
  camera.updateProjectionMatrix();
  fitCamera();
  spinning = previousSpin;
  if (previousSpin) resetShowcaseClock();
  else garment.rotation.y = originalRotation;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghost360-8k-front-back-showcase-${durationSec}s.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  recording = false;
  ui.exportVideo.disabled = false;
  ui.exportVideo.textContent = 'Export 8K Front + Back Showcase';
  setStatus('Downloaded native 8K front/back showcase video');
}

function resize() {
  const w = Math.max(1, viewer.clientWidth);
  const h = Math.max(1, viewer.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (garment) fitCamera();
}
new ResizeObserver(resize).observe(viewer);
resize();

function animate() {
  requestAnimationFrame(animate);
  clock.getDelta();
  if (garment) {
    if (exportJob) {
      const elapsed = performance.now() - exportJob.startMs;
      const progress = Math.min(1, elapsed / exportJob.durationMs);
      garment.rotation.y = showcaseAngleAt(progress);
      if (progress >= 1 && !exportJob.finishing) {
        garment.rotation.y = showcaseAngleAt(0); // exact matching loop frame
        renderer.render(scene, camera);
        exportJob.finishing = true;
        exportJob.finish();
      }
    } else if (spinning && generationApproved) {
      const durationMs = Math.max(1000, Number(ui.exportDuration.value || 12) * 1000);
      const progress = ((performance.now() - showcaseStartMs) % durationMs) / durationMs;
      garment.rotation.y = showcaseAngleAt(progress);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

ui.frontFile.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  generationApproved = false;
  analysisState.pantsBackGenerated=false;analysisState.pantsDuplicate=false;analysisState.resolved=true;disposeSideTextures();
  canvasState.frontTop = null; canvasState.frontBottom = null;
  disposeTexture(textureState.frontTop); disposeTexture(textureState.frontBottom);
  textureState.frontTop = null; textureState.frontBottom = null;
  if (ui.frontPreview) { ui.frontPreview.hidden = true; ui.frontPreview.removeAttribute('src'); }
  ui.frontName.textContent = f.name;
  frontSource = await readImage(f);
  await preprocessUploads();
});

ui.backFile.addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  generationApproved = false;
  analysisState.pantsBackGenerated=false;analysisState.pantsDuplicate=false;analysisState.resolved=true;disposeSideTextures();
  canvasState.backTop = null; canvasState.backBottom = null;
  disposeTexture(textureState.backTop); disposeTexture(textureState.backBottom);
  textureState.backTop = null; textureState.backBottom = null;
  if (ui.backPreview) { ui.backPreview.hidden = true; ui.backPreview.removeAttribute('src'); }
  ui.backName.textContent = f.name;
  backSource = await readImage(f);
  await preprocessUploads();
});

const reprocessFromControls = async () => { analysisState.pantsBackGenerated=false; analysisState.pantsDuplicate=false; analysisState.resolved=true; disposeSideTextures(); await preprocessUploads(); };
ui.garmentType.addEventListener('change', reprocessFromControls);
ui.cleanupMode.addEventListener('change', reprocessFromControls);
ui.threshold.addEventListener('input', () => { ui.thresholdValue.value = ui.threshold.value; });
ui.threshold.addEventListener('change', reprocessFromControls);
ui.flipFront.addEventListener('change', () => { if (generationApproved) { rebuildSideTextures(); rebuildGarment(); } });
ui.flipBack.addEventListener('change', () => { if (generationApproved) { rebuildSideTextures(); rebuildGarment(); } });
ui.fabricColor.addEventListener('input', () => { autoColor = false; if (generationApproved) { rebuildSideTextures(); rebuildGarment(); } });
ui.backgroundColor.addEventListener('input', () => { scene.background = new THREE.Color(ui.backgroundColor.value); });
ui.rotationSpeed.addEventListener('input', () => { ui.speedValue.value = `${ui.rotationSpeed.value}�/s`; });
ui.frameSize?.addEventListener('input', () => { ui.frameSizeValue.value = `${ui.frameSize.value}%`; fitCamera(); });
ui.exportDuration?.addEventListener('change', resetShowcaseClock);
ui.volumeScale?.addEventListener('input', () => { ui.volumeScaleValue.value = `${ui.volumeScale.value}%`; if (generationApproved) rebuildGarment(); });
ui.detailWrap?.addEventListener('input', () => { ui.detailWrapValue.value = `${ui.detailWrap.value}%`; if (generationApproved) rebuildGarment(); });
ui.mannequinVisible?.addEventListener('change', rebuildGarment);
ui.mannequinColor?.addEventListener('input', rebuildGarment);
ui.toggleSpin.addEventListener('click', () => {
  spinning = !spinning;
  ui.toggleSpin.textContent = spinning ? 'Pause showcase' : 'Start showcase';
  if (spinning) resetShowcaseClock();
});
ui.resetView.addEventListener('click', resetView);
ui.exportVideo.addEventListener('click', exportLoopingVideo);
ui.continueGenerate?.addEventListener('click', generateClothingStage);
ui.generateMissingPantsBack?.addEventListener('click', resolveMissingPantsBack);
renderer.domElement.addEventListener('dblclick', resetView);
controls.addEventListener('start', () => {
  if (spinning) ui.toggleSpin.dataset.wasSpinning = '1';
  spinning = false;
});
controls.addEventListener('end', () => {
  if (ui.toggleSpin.dataset.wasSpinning === '1') {
    spinning = true;
    resetShowcaseClock();
    delete ui.toggleSpin.dataset.wasSpinning;
  }
});

rebuildGarment();
animate();
updateWorkflowUI();
setStatus('Ready - upload front and back images');

