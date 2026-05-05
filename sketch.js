let video;
let faceMesh;
let predictions = [];
let maskImage;
let offscreen; // 離屏 canvas，用於臉譜合成

// 臉譜關鍵點（裁切後圖片 1122x1389 的 UV 比例）
const MASK = {
  leftEye:      { u: 261/1122, v: 710/1389 },
  rightEye:     { u: 861/1122, v: 710/1389 },
  mouth:        { u: 562/1122, v: 1121/1389 },
  eyeSpanU:     600/1122,   // 兩眼像素距離 / 圖寬
  eyeToMouthV:  411/1389,   // 眼到嘴像素距離 / 圖高
  eyeMidU:      561/1122,   // 兩眼中點 U
  eyeMidV:      710/1389,   // 兩眼中點 V
};

function preload() {
  maskImage = loadImage('4379902.png');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  // 建立與主 canvas 同大小的離屏 canvas（預設透明背景）
  offscreen = createGraphics(windowWidth, windowHeight);
  
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  faceMesh = ml5.faceMesh(video, () => {
    console.log("Model Ready!");
    faceMesh.detectStart(video, results => {
      predictions = results;
    });
  });
}

function draw() {
  // ── 主 canvas：攝影機畫面（鏡射）──
  background(30);
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  if (predictions.length === 0) return;

  let pts = predictions[0].keypoints;

  // 座標轉換（含水平鏡射）
  const getX = (x) => map(x, 0, video.width, width, 0);
  const getY = (y) => map(y, 0, video.height, 0, height);

  // ── 人臉關鍵點 ──
  // 瞳孔：468=左瞳, 473=右瞳（MediaPipe refinement landmarks）
  let fLE = pts[468]
    ? { x: getX(pts[468].x), y: getY(pts[468].y) }
    : { x: (getX(pts[133].x)+getX(pts[33].x))/2, y: (getY(pts[133].y)+getY(pts[33].y))/2 };
  let fRE = pts[473]
    ? { x: getX(pts[473].x), y: getY(pts[473].y) }
    : { x: (getX(pts[362].x)+getX(pts[263].x))/2, y: (getY(pts[362].y)+getY(pts[263].y))/2 };

  // 嘴巴中心（上下唇中點）
  let fMouth = {
    x: (getX(pts[13].x) + getX(pts[14].x)) / 2,
    y: (getY(pts[13].y) + getY(pts[14].y)) / 2,
  };

  // 眼睛中點
  let eyeMidX = (fLE.x + fRE.x) / 2;
  let eyeMidY = (fLE.y + fRE.y) / 2;
  let faceEyeSpan = dist(fLE.x, fLE.y, fRE.x, fRE.y);
  let faceEyeToMouth = dist(eyeMidX, eyeMidY, fMouth.x, fMouth.y);

  // ── 角度：只取傾斜角，確保不超過 ±45° 避免翻轉 ──
  // 鏡射後 fLE.x > fRE.x（左眼在右側），用 fLE→fRE 向量
  // 但我們要的是「臉的傾斜角」，取絕對傾斜即可
  let rawAngle = atan2(fLE.y - fRE.y, fLE.x - fRE.x); // fLE→fRE（鏡射後左眼x>右眼x）
  // rawAngle 約為 0 表示水平，小角度表示微微傾斜，不會有 180 度問題

  // ── 縮放：以眼距決定寬，以眼到嘴決定高 ──
  let drawW = faceEyeSpan / MASK.eyeSpanU;
  let drawH = faceEyeToMouth / MASK.eyeToMouthV;

  // 臉譜眼睛中點在圖片內的偏移（像素）
  let offsetX = MASK.eyeMidU * drawW;
  let offsetY = MASK.eyeMidV * drawH;

  // ── 離屏 canvas：畫臉譜 + clip 挖空 ──
  let og = offscreen.drawingContext;
  offscreen.clear(); // 清空為完全透明

  og.save();
  og.translate(eyeMidX, eyeMidY);
  og.rotate(rawAngle);
  og.drawImage(maskImage.canvas, -offsetX, -offsetY, drawW, drawH);
  og.restore();

  // 用 destination-out 挖空眼睛嘴巴
  // 此時 offscreen 背景是透明的，destination-out 會真正產生透明孔
  og.save();
  og.globalCompositeOperation = 'destination-out';
  og.fillStyle = 'rgba(0,0,0,1)';

  // 右眼輪廓
  const rightEyeIdx = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  og.beginPath();
  rightEyeIdx.forEach((idx, i) => {
    let p = pts[idx];
    if (!p) return;
    i === 0 ? og.moveTo(getX(p.x), getY(p.y)) : og.lineTo(getX(p.x), getY(p.y));
  });
  og.closePath();
  og.fill();

  // 左眼輪廓
  const leftEyeIdx = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
  og.beginPath();
  leftEyeIdx.forEach((idx, i) => {
    let p = pts[idx];
    if (!p) return;
    i === 0 ? og.moveTo(getX(p.x), getY(p.y)) : og.lineTo(getX(p.x), getY(p.y));
  });
  og.closePath();
  og.fill();

  // 嘴巴輪廓（外唇）
  const mouthIdx = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
  og.beginPath();
  mouthIdx.forEach((idx, i) => {
    let p = pts[idx];
    if (!p) return;
    i === 0 ? og.moveTo(getX(p.x), getY(p.y)) : og.lineTo(getX(p.x), getY(p.y));
  });
  og.closePath();
  og.fill();

  og.restore();

  // ── 把離屏 canvas 疊到主 canvas（攝影機在底層，透明孔會透出攝影機）──
  image(offscreen, 0, 0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  offscreen.resizeCanvas(windowWidth, windowHeight);
}
