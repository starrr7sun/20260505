let video;
let faceMesh;
let handPose;
let facePredictions = [];
let handPredictions = [];
let maskImages = [];
let offscreen;
let currentMask = 0;

// ── 兩張臉譜的關鍵點 UV 比例 ──
const MASKS = [
  {
    // 4379902.png (1122x1389) 紫色臉譜
    file: '4379902.png',
    leftEye:     { u: 261/1122, v: 710/1389 },
    rightEye:    { u: 861/1122, v: 710/1389 },
    eyeSpanU:    600/1122,
    eyeMidU:     561/1122,
    eyeMidV:     710/1389,
    eyeToMouthV: 411/1389,
  },
  {
    // 4379901.png (1179x1382) 黑色臉譜
    file: '4379901.png',
    leftEye:     { u: 0.2844, v: 0.4359 },
    rightEye:    { u: 0.7173, v: 0.4359 },
    eyeSpanU:    0.4329,
    eyeMidU:     0.5008,
    eyeMidV:     0.4359,
    eyeToMouthV: 0.3621,
  },
];

// ── 手勢揮動偵測狀態 ──
let swipeState = {
  active: false,       // 是否有手在追蹤
  startX: null,        // 揮動起始 X
  lastX: null,         // 上一幀 X
  direction: null,     // 'left' or 'right'
  triggered: false,    // 這次揮動已觸發過換臉
};

// ── 換臉動畫 ──
let transition = {
  active: false,
  progress: 0,   // 0~1
  direction: 1,  // 1=向右揮, -1=向左揮
  duration: 25,  // frames
};

function preload() {
  maskImages[0] = loadImage('4379902.png');
  maskImages[1] = loadImage('4379901.png');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  offscreen = createGraphics(windowWidth, windowHeight);
  offscreen.pixelDensity(1);

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // FaceMesh
  faceMesh = ml5.faceMesh(video, { maxFaces: 1 }, () => {
    faceMesh.detectStart(video, r => { facePredictions = r; });
  });

  // HandPose（ml5 v1）
  handPose = ml5.handPose(video, { maxHands: 2, flipped: false }, () => {
    handPose.detectStart(video, r => { handPredictions = r; });
  });
}

// 換臉（帶動畫）
function changeMask(dir) {
  if (transition.active) return;
  transition.active = true;
  transition.progress = 0;
  transition.direction = dir;
  let next = (currentMask + (dir > 0 ? 1 : -1) + MASKS.length) % MASKS.length;
  // 動畫一半時切換
  setTimeout(() => { currentMask = next; }, (transition.duration / 2) * (1000 / 60));
}

function draw() {
  background(20);

  // 底層攝影機（鏡射）
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  const vx = x => map(x, 0, video.width, width, 0);
  const vy = y => map(y, 0, video.height, 0, height);

  // ── 手勢偵測 ──
  detectSwipe(vx, vy);

  // ── 臉譜繪製 ──
  if (facePredictions.length > 0) {
    drawMask(facePredictions[0].keypoints, vx, vy);
  }

  // ── 換臉動畫（掃場效果）──
  if (transition.active) {
    transition.progress += 1 / transition.duration;
    let sweep = transition.progress * width * transition.direction;
    // 半透明黑色掃場
    let alpha = sin(transition.progress * PI) * 180;
    fill(0, 0, 0, alpha);
    noStroke();
    rect(0, 0, width, height);

    if (transition.progress >= 1) {
      transition.active = false;
      transition.progress = 0;
    }
  }

  // ── 手部 UI 提示 ──
  drawHandUI(vx, vy);

  // ── 臉譜名稱提示 ──
  drawHUD();
}

function detectSwipe(vx, vy) {
  if (handPredictions.length === 0) {
    swipeState.active = false;
    swipeState.startX = null;
    swipeState.triggered = false;
    return;
  }

  // 取第一隻手的手腕點（index 0）
  let hand = handPredictions[0];
  let wrist = hand.keypoints[0];
  let wx = vx(wrist.x);

  if (!swipeState.active) {
    swipeState.active = true;
    swipeState.startX = wx;
    swipeState.lastX = wx;
    swipeState.triggered = false;
  } else {
    let dx = wx - swipeState.lastX;
    let totalDX = wx - swipeState.startX;
    swipeState.lastX = wx;

    // 揮動距離超過閾值（螢幕寬度的 15%）且未觸發
    if (!swipeState.triggered && abs(totalDX) > width * 0.15) {
      swipeState.triggered = true;
      let dir = totalDX > 0 ? 1 : -1; // 右揮=+1，左揮=-1
      changeMask(dir);
      // 重置起始點，允許連續揮動
      setTimeout(() => {
        swipeState.startX = wx;
        swipeState.triggered = false;
      }, 800);
    }
  }
}

function drawMask(pts, vx, vy) {
  let m = MASKS[currentMask];
  let img = maskImages[currentMask];
  if (!img || !img.canvas) return;

  // 人臉眼睛
  let fLE = pts[468]
    ? { x: vx(pts[468].x), y: vy(pts[468].y) }
    : { x: (vx(pts[133].x)+vx(pts[33].x))/2, y: (vy(pts[133].y)+vy(pts[33].y))/2 };
  let fRE = pts[473]
    ? { x: vx(pts[473].x), y: vy(pts[473].y) }
    : { x: (vx(pts[362].x)+vx(pts[263].x))/2, y: (vy(pts[362].y)+vy(pts[263].y))/2 };
  let fM = { x: vx(pts[13].x), y: vy(pts[13].y) };

  let eyeMidX = (fLE.x + fRE.x) / 2;
  let eyeMidY = (fLE.y + fRE.y) / 2;
  let faceEyeSpan = dist(fLE.x, fLE.y, fRE.x, fRE.y);
  let faceEyeToMouth = dist(eyeMidX, eyeMidY, fM.x, fM.y);

  // 傾斜角
  let angle = atan2(fLE.y - fRE.y, fLE.x - fRE.x);

  // 縮放
  let drawH = faceEyeToMouth / m.eyeToMouthV;
  let drawW = max(faceEyeSpan / m.eyeSpanU, drawH * (img.width / img.height));
  drawH = drawW / (img.width / img.height);

  let offsetX = m.eyeMidU * drawW;
  let offsetY = m.eyeMidV * drawH;

  // 離屏繪製
  let og = offscreen.drawingContext;
  offscreen.clear();

  og.save();
  og.translate(eyeMidX, eyeMidY);
  og.rotate(angle);
  og.drawImage(img.canvas, -offsetX, -offsetY, drawW, drawH);
  og.restore();

  // 挖空眼睛嘴巴
  og.save();
  og.globalCompositeOperation = 'destination-out';
  og.fillStyle = 'rgba(0,0,0,1)';

  const cutout = (indices) => {
    og.beginPath();
    indices.forEach((idx, i) => {
      let p = pts[idx]; if (!p) return;
      i === 0 ? og.moveTo(vx(p.x), vy(p.y)) : og.lineTo(vx(p.x), vy(p.y));
    });
    og.closePath();
    og.fill();
  };

  cutout([33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]);  // 右眼
  cutout([263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466]); // 左眼
  cutout([61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185]); // 嘴

  og.restore();
  image(offscreen, 0, 0);
}

function drawHandUI(vx, vy) {
  if (handPredictions.length === 0) return;

  for (let hand of handPredictions) {
    // 畫手腕點
    let w = hand.keypoints[0];
    let wx = vx(w.x), wy = vy(w.y);
    fill(255, 220, 0, 160);
    noStroke();
    ellipse(wx, wy, 20, 20);

    // 畫揮動進度弧
    if (swipeState.active && swipeState.startX !== null) {
      let progress = constrain(abs(wx - swipeState.startX) / (width * 0.15), 0, 1);
      stroke(255, 220, 0, 200);
      strokeWeight(4);
      noFill();
      arc(wx, wy - 40, 50, 50, -PI, 0, OPEN);
      // 填充進度
      stroke(0, 255, 150, 220);
      arc(wx, wy - 40, 50, 50, -PI, -PI + PI * progress, OPEN);
    }
  }
}

function drawHUD() {
  // 左右箭頭提示
  let prev = (currentMask - 1 + MASKS.length) % MASKS.length;
  let next = (currentMask + 1) % MASKS.length;

  push();
  textAlign(CENTER, CENTER);
  noStroke();

  // 左箭頭
  fill(255, 255, 255, 120);
  textSize(36);
  text('◀', 50, height / 2);

  // 右箭頭
  text('▶', width - 50, height / 2);

  // 底部提示
  fill(255, 255, 255, 160);
  textSize(max(14, width * 0.018));
  text('✋ 向左或向右揮手換臉譜', width / 2, height - 36);

  // 臉譜計數點
  for (let i = 0; i < MASKS.length; i++) {
    fill(i === currentMask ? color(255,220,0) : color(255,255,255,100));
    ellipse(width/2 + (i - (MASKS.length-1)/2) * 24, height - 70, 12, 12);
  }
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  offscreen.resizeCanvas(windowWidth, windowHeight);
}
