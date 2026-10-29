import React, { useState, useEffect, useRef, useMemo } from 'react';
import { render, Box, Text } from 'ink';

const h = React.createElement;

// 5줄 높이 LED 폰트 (block 문자로 숫자/콜론 표현)
const FONT = {
  '0': [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  '1': ['  █  ', ' ██  ', '  █  ', '  █  ', ' ███ '],
  '2': [' ███ ', '█   █', '   █ ', '  █  ', '█████'],
  '3': [' ███ ', '    █', '  ██ ', '    █', ' ███ '],
  '4': ['█   █', '█   █', '█████', '    █', '    █'],
  '5': ['█████', '█    ', '████ ', '    █', '████ '],
  '6': [' ███ ', '█    ', '████ ', '█   █', ' ███ '],
  '7': ['█████', '    █', '   █ ', '  █  ', '  █  '],
  '8': [' ███ ', '█   █', ' ███ ', '█   █', ' ███ '],
  '9': [' ███ ', '█   █', ' ████', '    █', ' ███ '],
  ':': ['     ', '  █  ', '     ', '  █  ', '     '],
  // 콜론이 깜빡여 꺼질 때 쓰는 자리. 콜론 글리프와 똑같이 5칸을 채워야 시계 전체 폭이
  // 깜빡일 때마다 바뀌지 않는다 — 폭이 바뀌면 가운데 정렬이 매초 다시 계산돼 양옆 산까지
  // 따라 움직이는 것처럼 보였다(실측 확인).
  ' ': ['     ', '     ', '     ', '     ', '     '],
};

// 콜백을 ref에 담아 최신 상태를 참조하게 하고, setInterval 자체는
// delayMs가 바뀔 때만 다시 건다. 그렇지 않으면 매 렌더링마다(다른 타이머가
// 더 잦은 주기로 리렌더를 일으킬 때마다) 이 interval도 처음부터 다시
// 시작돼서, 더 긴 주기의 타이머는 영영 발동하지 못한다.
function useInterval(callback, delayMs) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const id = setInterval(() => callbackRef.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

// 터미널 글꼴 크기를 바꾸면(창 픽셀 크기는 그대로라도) 터미널이 보고하는 문자 격자 폭
// (process.stdout.columns)이 바뀐다 — Node는 실제 글꼴 픽셀 크기는 못 보고 이 격자 크기만
// 안다. 'resize' 이벤트를 구독해 그 격자 폭이 바뀔 때마다 리렌더해서, 보드 폭·산 폭처럼
// 폭에 따라 계산하는 값들이 따라 바뀌게 한다.
function useTerminalColumns() {
  const [columns, setColumns] = useState(() => process.stdout.columns || 82);
  useEffect(() => {
    function handleResize() {
      setColumns(process.stdout.columns || 82);
    }
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);
  return columns;
}

function BigClock({ text, color }) {
  const rows = [0, 1, 2, 3, 4].map((rowIndex) =>
    text
      .split('')
      .map((ch) => (FONT[ch] ? FONT[ch][rowIndex] : '  '))
      .join('  '),
  );
  return h(
    Box,
    { flexDirection: 'column' },
    ...rows.map((row, i) => h(Text, { key: i, color, bold: true }, row)),
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// rows는 줄마다 { text, kind } 세그먼트 배열이다. kind가 'far'(더 먼 산, 각 산 쌍에서 왼쪽에
// 둔 쪽)면 farColor로, 그 외는 color로 칠한다.
function Mountain({ rows, color, farColor }) {
  return h(
    Box,
    { flexDirection: 'column' },
    ...rows.map((segments, i) =>
      h(
        Box,
        { key: i },
        ...segments.map((seg, j) =>
          h(Text, { key: j, color: seg.kind === 'far' ? farColor : color, bold: true }, seg.text),
        ),
      ),
    ),
  );
}

const WALK_FRAME = '🐕';
const SNIFF_FRAME = '🐶';
const SPRITE_VISUAL_WIDTH = 2; // 이모지는 터미널에서 2칸을 차지한다

const CLOCK_WIDTH = 8 * 5 + 7 * 2; // HH:MM:SS 8글자 * 5칸 + 글자 사이 간격 7개 * 2칸
const MOUNTAIN_GAP = 2; // 산과 시계·날짜 블록 사이 여백(한쪽)
// 시계 칸(CLOCK_WIDTH)은 폭에 따라 줄어들지 않는 고정폭이라, 시계 줄(산 + 여백 + 시계 칸 +
// 여백 + 산)이 요구하는 최소 폭은 산이 0이어도 CLOCK_WIDTH + 여백 2개다. boardWidth가 이보다
// 좁으면 시계 줄 내용이 보드 폭을 넘어서 Ink가 줄바꿈해 버려 LED 폰트 격자·테두리가 깨진다
// (실측 확인: boardWidth 58 미만에서 재현). 그래서 boardWidth 하한을 이 값으로 둔다 — 터미널이
// 그보다도 좁으면(시계 자체가 못 들어가는 극단적인 경우) 더는 줄이지 않고 Ink가 알아서
// 잘리게 둔다(LED 폰트 자체를 줄이지 않는 한 이 아래로는 줄일 방법이 없다).
const MIN_BOARD_WIDTH = CLOCK_WIDTH + MOUNTAIN_GAP * 2;

// Ink는 루트 Box의 너비를 항상 터미널(이 보드가 떠 있는 패널) 전체 폭으로 강제한다(실측 확인,
// server-status-board 쪽에서도 같은 걸 확인했다). 이 보드는 paddingX 0 + 테두리(double) 2를 쓰므로,
// 그 안쪽 내용(강아지 줄·잔디 띠) 폭을 터미널 폭 - 2 로 맞추면 테두리를 꽉 채운다. 잔디는 2칸짜리
// 이모지 격자라 폭이 짝수여야 딱 맞아서 2의 배수로 내림한다. useTerminalColumns로 매번 새로
// 계산하므로 글꼴 크기(→ 터미널 문자 격자 크기)를 바꾸면 따라서 넓어지거나 좁아진다.
function computeBoardWidth(terminalColumns) {
  const raw = Math.max(MIN_BOARD_WIDTH, terminalColumns - 2);
  return raw - (raw % SPRITE_VISUAL_WIDTH);
}

// 시계 양옆 산. 이모지 대신 잔디 카펫과 같은 ▒ 문자로 채운다. 폭은 보드 폭에서 시계 폭을
// 뺀 "실제로 남는 공간"을 계산해서 정하므로, 터미널이 넓으면 산도 넓어진다(남는 공간이
// 없으면 0이 돼서 아예 안 그려진다). 높이가 다른 삼각형 두 개(하나는 꼭대기까지 MOUNTAIN_HEIGHT
// 전부, 다른 하나는 40% 지점부터만)를 서로 다른 위치에 겹쳐서 — 겹치는 자리는 둘 중 하나만
// 채워져 있어도 채운다 — 능선이 여러 봉우리로 겹쳐 보이는 산맥처럼 보이게 한다.
// 잔디 카펫(DogWalk)과 산이 같이 쓰는 텍스처 문자. 산 계산이 잔디보다 먼저 나오므로 여기서 먼저 둔다.
const CARPET_CHAR = '▒';
// 한때는 8줄(시계+빈줄+날짜+빈줄)로 그려서 잔디 바로 윗줄까지 닿게 했었는데, 사용자 터미널
// (Tabby, 커스텀 CSS로 줄간격 1.4)에서는 한 칸의 세로가 보통 터미널보다 1.4배 더 길어서 8줄
// 산이 폭에 비해 탑처럼 길쭉해 보였다(실측 확인: 글꼴 줄간격은 process.stdout로 못 읽으므로
// 코드가 자동으로 보정할 수 없다). 사용자 선택으로 높이를 줄이고, 그 대신 산이 잔디까지 안
// 닿는 건(시계 옆에 떠 있는 것처럼 보이는 것) 다시 받아들이기로 했다.
const MOUNTAIN_HEIGHT = 6;
function computeMountainSideWidth(boardWidth) {
  return Math.max(0, Math.floor((boardWidth - CLOCK_WIDTH) / 2) - MOUNTAIN_GAP);
}

// height줄 중 peakRow줄부터 시작하는(그 위는 빈 줄) 삼각형 하나를 만든다. 마지막 줄(바닥)의
// 반폭이 baseHalfWidth, 중심이 center다.
// 꼭대기를 1칸짜리 뾰족한 점으로 두지 않고 MOUNTAIN_PEAK_MIN_HALF_WIDTH만큼 평평하게 깎는다.
// 폭이 느는 속도도 선형(r/h)이 아니라 sqrt(r/h)로 줘서 꼭대기 쪽은 빨리 넓어지고 바닥 쪽은
// 완만해지게 한다 — 직선 비탈 대신 둥글린 능선처럼 보인다.
const MOUNTAIN_PEAK_MIN_HALF_WIDTH = 1;

function buildPeakRows(width, height, peakRow, baseHalfWidth, center) {
  const localHeight = height - peakRow;
  const rows = [];
  for (let r = 0; r < height; r++) {
    if (r < peakRow || localHeight <= 1) {
      rows.push(' '.repeat(width));
      continue;
    }
    const localR = r - peakRow;
    const t = Math.sqrt(localR / (localHeight - 1));
    const halfWidth = Math.max(MOUNTAIN_PEAK_MIN_HALF_WIDTH, Math.round(t * baseHalfWidth));
    const start = Math.max(0, center - halfWidth);
    const end = Math.min(width, center + halfWidth + 1);
    rows.push(' '.repeat(start) + CARPET_CHAR.repeat(Math.max(0, end - start)) + ' '.repeat(Math.max(0, width - end)));
  }
  return rows;
}

// far(그 산 쌍에서 왼쪽에 둔, 꼭대기까지 닿는 삼각형)와 near(오른쪽에 둔, 40% 지점부터
// 시작하는 작은 삼각형)를 합친다. 겹치는 칸은 near가 far를 가리는 걸로 보고 near로 채운다
// (가까이 있는 산이 먼 산을 가리는 게 자연스럽다). 같은 종류가 이어지는 구간을 하나의
// 세그먼트로 묶어서 Text 노드 수를 줄인다.
function mergePeaks(farRows, nearRows) {
  return farRows.map((farRow, i) => {
    const nearRow = nearRows[i];
    const segments = [];
    let current = null;
    for (let c = 0; c < farRow.length; c++) {
      const filledNear = nearRow[c] !== ' ';
      const filledFar = farRow[c] !== ' ';
      const kind = filledNear ? 'near' : filledFar ? 'far' : null;
      const ch = kind ? CARPET_CHAR : ' ';
      if (current && current.kind === kind) {
        current.text += ch;
      } else {
        current = { text: ch, kind };
        segments.push(current);
      }
    }
    return segments;
  });
}

// 왼쪽·오른쪽 산 쌍 모두 "각자의 왼쪽"에 far(더 먼 산)를 두는 같은 식을 쓴다 — 그래야
// 양쪽 다 "그 쌍의 왼쪽 산이 더 멀리 있는 색"이 된다.
function buildMountainRows(width) {
  if (width <= 0) return Array.from({ length: MOUNTAIN_HEIGHT }, () => [{ text: '', kind: null }]);
  // 중심을 충분히 떨어뜨려 두면(0.3W / 0.75W) 위쪽 줄에서는 두 봉우리가 떨어져 보이다가,
  // 바닥 줄에서야 폭이 넓어지며 서로 닿아 하나의 능선처럼 합쳐진다.
  const nearPeakRow = Math.round(MOUNTAIN_HEIGHT * 0.4);
  // 바닥 반폭을 0.45W로 넓혀서 양 끝(왼쪽 가장자리·오른쪽 발치)까지 산이 닿게 한다. 가장자리를 넘는 부분은
  // buildPeakRows가 잘라 낸다.
  const far = buildPeakRows(width, MOUNTAIN_HEIGHT, 0, Math.floor(width * 0.45), Math.floor(width * 0.3));
  const near = buildPeakRows(width, MOUNTAIN_HEIGHT, nearPeakRow, Math.floor(width * 0.45), Math.floor(width * 0.75));
  return mergePeaks(far, near);
}

// 해/달. 산책로의 나무·강아지처럼 이모지로 그린다(산책로와 산책로 바깥 장식만 이모지,
// 산·잔디 몸체는 그대로 글자). 낮/밤은 시(時)로만 거칠게 가른다(06~17시 낮). 왼쪽 산 위에
// 뜬 것처럼 보이게, 산 폭과 같은 자리에 가운데 정렬해서 올린다 — 시계 쪽(가운데) 칸은
// 그만큼 빈 칸으로 맞춰 둬야 산 위 자리가 보드 가운데가 아니라 실제 산 바로 위로 정렬된다.
// 이모지는 둘 다 터미널에서 2칸을 차지하고 JS 문자열 길이도 마침 2라(서로게이트 쌍),
// centerText의 길이 계산이 그대로 맞는다(실측 확인).
// '☀️'(U+2600+VS16)는 유니코드 기본값이 "텍스트 표시"라 VS16을 못 받는 터미널/폰트에서는 1칸으로
// 그려져(실측 확인: 낮으로 바뀌면 이 줄만 한 칸 밀림), 처음부터 2칸인 '🌕'(U+1F315, 기본값이
// "이모지 표시")와 실제 렌더 폭이 달랐다. 달과 같은 계열인 '🌞'(U+1F31E, 기본값도 이모지 표시)로
// 바꿔서 둘 다 항상 2칸으로 그려지게 한다.
const HOUSE_EMOJI = '🏠';
const SUN_ROW = '🌞';
const MOON_ROW = '🌕';

// text가 width보다 길면(산이 리사이즈로 아주 좁아져서 해/달 한 칸도 못 들어가는 경우) 그냥
// 빈 줄을 돌려준다 — 안 자르고 그대로 내보내면 그 칸에 할당한 폭을 넘어서서, 같은 줄의
// 다른 고정폭 칸(시계 칸 등)과 합쳐 줄 전체 폭이 보드 폭을 넘어 테두리가 깨졌다(실측 확인).
function centerText(text, width) {
  if (text.length > width) return ' '.repeat(Math.max(0, width));
  const padTotal = width - text.length;
  const left = Math.floor(padTotal / 2);
  return ' '.repeat(left) + text + ' '.repeat(padTotal - left);
}

// 밤에만 산 테두리 부근에 랜덤하게 나타나는 부엉이. near 봉우리가 시작되기 전 줄
// (OWL_PERCH_ROWS)은 far 봉우리 하나만 있어서 능선 바로 옆에 빈 칸이 넉넉하다 — 그 줄의
// 실제로 칠해진 구간(filledRangeOfRow)을 찾아 바로 왼쪽이나 오른쪽, 능선에 붙어 앉은
// 것처럼 보이는 자리에 놓는다.
const OWL_EMOJI = '🦉';
const OWL_VISUAL_WIDTH = 2;
// 능선 옆 빈 하늘에 떠 보이지 않도록 꼭대기 줄이 아니라 두 줄 아래부터 앉힌다.
const OWL_PERCH_ROW_OFFSET = 2;
const OWL_PERCH_ROWS = Array.from({ length: Math.round(MOUNTAIN_HEIGHT * 0.4) }, (_, i) => i + OWL_PERCH_ROW_OFFSET);
const OWL_GAP_MIN_MS = 8000;
const OWL_GAP_MAX_MS = 20000;
const OWL_DURATION_MIN_MS = 4000;
const OWL_DURATION_MAX_MS = 9000;

function filledRangeOfRow(segments) {
  let pos = 0;
  let first = -1;
  let last = -1;
  for (const seg of segments) {
    if (seg.kind) {
      if (first === -1) first = pos;
      last = pos + seg.text.length - 1;
    }
    pos += seg.text.length;
  }
  return { first, last };
}

// 그 줄의 x부터 width칸이 모두 비어 있는지(산이 안 칠해져 있는지). 아래 줄로 내려오면 near 봉우리와 겹칠 수 있다.
function isRangeEmpty(segments, x, width) {
  let pos = 0;
  for (const seg of segments) {
    const end = pos + seg.text.length;
    if (seg.kind && x < end && x + width > pos) return false;
    pos = end;
  }
  return true;
}

// 산 모양·폭이 리사이즈로 바뀔 수 있으므로 모듈 상수 대신 그 순간 값을 인자로 받는다.
function pickOwlSpot(mountainLeftRows, mountainRightRows, mountainSideWidth) {
  const sides = [
    { side: 'left', rows: mountainLeftRows },
    { side: 'right', rows: mountainRightRows },
  ];
  const candidates = [];
  for (const { side, rows } of sides) {
    for (const row of OWL_PERCH_ROWS) {
      if (row >= rows.length) continue;
      const { first, last } = filledRangeOfRow(rows[row]);
      if (first === -1) continue; // 그 줄엔 산이 없다(폭이 너무 좁은 경우)
      const leftX = first - 1 - OWL_VISUAL_WIDTH;
      const rightX = last + 2;
      if (leftX >= 0 && isRangeEmpty(rows[row], leftX, OWL_VISUAL_WIDTH)) candidates.push({ side, row, x: leftX });
      if (rightX + OWL_VISUAL_WIDTH <= mountainSideWidth && isRangeEmpty(rows[row], rightX, OWL_VISUAL_WIDTH)) {
        candidates.push({ side, row, x: rightX });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 냄새 맡을 때 강아지 양옆에 깔아주는 나무+잔디. 이모지 4칸(2칸짜리 2개)씩.
const LEFT_DECO = '🌳🌿';
const RIGHT_DECO = '🌿🌳';
const DECO_VISUAL_WIDTH = 4;
const SNIFF_CLUSTER_WIDTH = DECO_VISUAL_WIDTH + SPRITE_VISUAL_WIDTH + DECO_VISUAL_WIDTH;

// 강아지가 걷는 줄 자체도 잔디 카펫으로 채운다. 이모지(2칸)짜리 잔디 띠와 달리
// 여기는 x가 1칸 단위라 한 칸짜리 텍스처 문자를 써서 자리 계산을 그대로 둔다.
function fillCarpet(count) {
  return CARPET_CHAR.repeat(Math.max(0, count));
}

// 냄새 맡기 간격(쉬는 시간)과 지속 시간을 매번 이 범위 안에서 무작위로 뽑는다.
const SNIFF_GAP_MIN_MS = 2000;
const SNIFF_GAP_MAX_MS = 9000;
const SNIFF_DURATION_MIN_MS = 500;
const SNIFF_DURATION_MAX_MS = 7000;

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

// 푸들을 만나는 이벤트: 수풀에서 푸들이 나타나면 누렁이가 지금 있던 자리에 멈춰서 느낌표
// 두 번을 보여준 뒤(alert) 푸들 쪽으로 빠르게 달려간다(rush, 평소 걷는 속도보다 훨씬 빠르다).
// 서로 맞닿는 순간(두 스프라이트가 바로 옆칸까지 붙는 거리) 멈춰 서서 하트 두 번 뿅뿅을
// 보여준 뒤(hearts) - 겹쳐 보이는 프레임 없이 - 바로 같이 사라진다(vanish). 그 뒤 평소처럼
// 오른쪽에서 다시 나타나 걷기를 이어간다.
const POODLE_FRAME = '🐩';
const HEART_FRAME = '💕';
const EXCLAIM_FRAME = '❗';
const REACTION_SLOT_WIDTH = SPRITE_VISUAL_WIDTH; // 반응 아이콘 한 칸(2열)
const REACTION_CLUSTER_WIDTH = SPRITE_VISUAL_WIDTH + REACTION_SLOT_WIDTH; // 강아지+반응칸
const ALERT_FRAMES = [
  { glyph: EXCLAIM_FRAME, duration: 300 },
  { glyph: null, duration: 150 },
  { glyph: EXCLAIM_FRAME, duration: 300 },
  { glyph: null, duration: 150 },
];
const HEART_FRAMES = [
  { glyph: HEART_FRAME, duration: 300 },
  { glyph: null, duration: 150 },
  { glyph: HEART_FRAME, duration: 300 },
  { glyph: null, duration: 150 },
];
const CONTACT_GAP_THRESHOLD = 2; // 이 간격이면 스프라이트끼리 바로 옆칸이라 맞닿은 것으로 본다
const ENCOUNTER_GAP_MIN_MS = 15000;
const ENCOUNTER_GAP_MAX_MS = 30000;
const RUSH_STEP_MS = 40; // alert 뒤 푸들에게 달려갈 때의 이동 주기(평소 걷기 450ms보다 훨씬 빠르다)
const ENCOUNTER_VANISH_MS = 2500;

// 서로 다른 x에 있는 이모지 스프라이트 여러 개를 한 줄에 겹치지 않게 배치한다.
function buildLineWithSprites(width, carpetChar, sprites) {
  const sorted = [...sprites].sort((a, b) => a.x - b.x);
  let line = '';
  let cursor = 0;
  for (const s of sorted) {
    line += carpetChar.repeat(Math.max(0, s.x - cursor));
    line += s.glyph;
    cursor = Math.max(cursor, s.x + s.visualWidth);
  }
  line += carpetChar.repeat(Math.max(0, width - cursor));
  return line;
}

function DogWalk({ width, color }) {
  const maxX = width - SPRITE_VISUAL_WIDTH;
  const [x, setX] = useState(maxX);
  const [sniffing, setSniffing] = useState(false);
  const [paused, setPaused] = useState(false);
  // encounterPhase: null | 'alert' | 'rush' | 'hearts' | 'vanish'
  const [encounterPhase, setEncounterPhase] = useState(null);
  const [poodleX, setPoodleX] = useState(0);
  const [reactionStep, setReactionStep] = useState(0);

  const pausedRef = useRef(paused);
  const sniffingRef = useRef(sniffing);
  const encounterPhaseRef = useRef(encounterPhase);
  const xRef = useRef(x);
  const poodleXRef = useRef(poodleX);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    sniffingRef.current = sniffing;
  }, [sniffing]);
  useEffect(() => {
    encounterPhaseRef.current = encounterPhase;
  }, [encounterPhase]);
  useEffect(() => {
    xRef.current = x;
  }, [x]);
  useEffect(() => {
    poodleXRef.current = poodleX;
  }, [poodleX]);

  // 리사이즈로 width(따라서 maxX)가 줄어들면, 전에 더 넓었을 때 걷던 x가 새 maxX를 넘어설
  // 수 있다 — 그 칸을 넘어서 그리면 줄 길이가 깨지므로 새 범위 안으로 당겨 둔다. 마운트
  // 때도 한 번 도는데 그때는 x가 이미 maxX라 그대로다.
  useEffect(() => {
    setX((prev) => Math.min(prev, maxX));
    xRef.current = Math.min(xRef.current, maxX);
  }, [maxX]);

  useInterval(() => {
    if (paused || sniffing || encounterPhase) return;
    const nextX = x - 1;
    if (nextX <= 0) {
      setX(0);
      setPaused(true);
      setTimeout(() => {
        setX(maxX);
        setPaused(false);
      }, 4000);
    } else {
      setX(nextX);
    }
  }, 450);

  // 간격도 지속 시간도 고정 주기가 아니라 매번 새로 뽑는 랜덤 값이라,
  // 고정 주기 setInterval 대신 스스로 다음 타이머를 예약하는 재귀 setTimeout을 쓴다.
  useEffect(() => {
    let gapTimer;
    let durationTimer;

    const scheduleNext = () => {
      gapTimer = setTimeout(() => {
        if (pausedRef.current || encounterPhaseRef.current) {
          scheduleNext();
          return;
        }
        setSniffing(true);
        const duration = randomBetween(SNIFF_DURATION_MIN_MS, SNIFF_DURATION_MAX_MS);
        durationTimer = setTimeout(() => {
          setSniffing(false);
          scheduleNext();
        }, duration);
      }, randomBetween(SNIFF_GAP_MIN_MS, SNIFF_GAP_MAX_MS));
    };

    scheduleNext();
    return () => {
      clearTimeout(gapTimer);
      clearTimeout(durationTimer);
    };
  }, []);

  // 푸들 조우 이벤트 예약 (sniff 스케줄러와 같은 재귀 setTimeout 패턴).
  // scheduleNext 자체는 "막혀서 재시도"할 때만 스스로를 다시 불렀고,
  // 조우가 실제로 시작된 뒤에는 아무도 다음 타이머를 걸지 않아 평생
  // 한 번만 발동했다. ref에 스케줄 함수를 저장해 두고, 이번 조우가
  // vanish까지 끝났을 때(아래) 다시 호출해서 다음 조우를 예약한다.
  const scheduleNextEncounterRef = useRef(() => {});

  useEffect(() => {
    let timer;

    const scheduleNext = () => {
      timer = setTimeout(() => {
        if (pausedRef.current || sniffingRef.current || encounterPhaseRef.current) {
          scheduleNext();
          return;
        }
        // 누렁이는 x가 줄어드는 쪽(오른쪽 maxX → 왼쪽 0)으로 걷는다. "진행 방향 앞"은 곧
        // 지금 위치보다 작은 x다 — 그 범위에서만 뽑아서 뒤쪽(이미 지나온 자리)에는 안 나오게 한다.
        const target = randomBetween(0, Math.max(1, xRef.current));
        setPoodleX(target);
        poodleXRef.current = target;
        setEncounterPhase('alert');
      }, randomBetween(ENCOUNTER_GAP_MIN_MS, ENCOUNTER_GAP_MAX_MS));
    };

    scheduleNextEncounterRef.current = scheduleNext;
    scheduleNext();
    return () => clearTimeout(timer);
  }, [maxX]);

  // 'alert': 지금 있던 자리에 멈춰 서서 느낌표 두 번을 보여준 뒤 'rush'로 넘어간다.
  useEffect(() => {
    if (encounterPhase !== 'alert') return;
    let step = 0;
    setReactionStep(0);
    let timer;
    const tick = () => {
      timer = setTimeout(() => {
        step += 1;
        if (step >= ALERT_FRAMES.length) {
          setEncounterPhase('rush');
          return;
        }
        setReactionStep(step);
        tick();
      }, ALERT_FRAMES[step].duration);
    };
    tick();
    return () => clearTimeout(timer);
  }, [encounterPhase]);

  // 'rush' 동안 누렁이가 푸들 위치까지 평소보다 훨씬 빠르게 한 칸씩 다가간다.
  // 간격이 CONTACT_GAP_THRESHOLD 이하로 좁혀지면(스프라이트끼리 맞닿으면) 멈추고
  // 'hearts'로 넘어간다.
  useEffect(() => {
    if (encounterPhase !== 'rush') return;
    const id = setInterval(() => {
      const current = xRef.current;
      const target = poodleXRef.current;
      const gap = Math.abs(target - current);

      if (gap <= CONTACT_GAP_THRESHOLD) {
        clearInterval(id);
        setEncounterPhase('hearts');
        return;
      }
      const nextX = current + (target > current ? 1 : -1);
      xRef.current = nextX;
      setX(nextX);
    }, RUSH_STEP_MS);
    return () => clearInterval(id);
  }, [encounterPhase]);

  // 'hearts': 맞닿은 자리에 멈춰 서서 하트 두 번 뿅뿅을 보여준 뒤 'vanish'로 넘어간다.
  useEffect(() => {
    if (encounterPhase !== 'hearts') return;
    let step = 0;
    setReactionStep(0);
    let timer;
    const tick = () => {
      timer = setTimeout(() => {
        step += 1;
        if (step >= HEART_FRAMES.length) {
          setEncounterPhase('vanish');
          return;
        }
        setReactionStep(step);
        tick();
      }, HEART_FRAMES[step].duration);
    };
    tick();
    return () => clearTimeout(timer);
  }, [encounterPhase]);

  // 'vanish' -> 원래 산책으로 복귀 -> 다음 조우를 다시 예약.
  useEffect(() => {
    if (encounterPhase !== 'vanish') return;
    const t = setTimeout(() => {
      setX(maxX);
      xRef.current = maxX;
      setEncounterPhase(null);
      scheduleNextEncounterRef.current();
    }, ENCOUNTER_VANISH_MS);
    return () => clearTimeout(t);
  }, [encounterPhase, maxX]);

  let line;
  if (paused || encounterPhase === 'vanish') {
    line = fillCarpet(width);
  } else if (encounterPhase === 'rush') {
    line = buildLineWithSprites(width, CARPET_CHAR, [
      { x, glyph: WALK_FRAME, visualWidth: SPRITE_VISUAL_WIDTH },
      { x: poodleX, glyph: POODLE_FRAME, visualWidth: SPRITE_VISUAL_WIDTH },
    ]);
  } else if (encounterPhase === 'alert' || encounterPhase === 'hearts') {
    // alert는 간격이 어떻든(멀리서도) 떠야 하고, hearts는 CONTACT_GAP_THRESHOLD(2)로 거의
    // 맞닿은 상태다. 반응 아이콘(2칸)을 강아지 기준 푸들 반대쪽에 붙여야 서로 겹치지 않는다.
    const frames = encounterPhase === 'alert' ? ALERT_FRAMES : HEART_FRAMES;
    const slotContent = frames[reactionStep].glyph ?? CARPET_CHAR.repeat(REACTION_SLOT_WIDTH);
    const poodleOnRight = poodleX >= x;
    const dogCluster = poodleOnRight ? slotContent + WALK_FRAME : WALK_FRAME + slotContent;
    const clusterX = poodleOnRight ? Math.max(0, x - REACTION_SLOT_WIDTH) : x;
    line = buildLineWithSprites(width, CARPET_CHAR, [
      { x: clusterX, glyph: dogCluster, visualWidth: REACTION_CLUSTER_WIDTH },
      { x: poodleX, glyph: POODLE_FRAME, visualWidth: SPRITE_VISUAL_WIDTH },
    ]);
  } else if (sniffing) {
    const clusterStart = Math.max(0, Math.min(x - DECO_VISUAL_WIDTH, width - SNIFF_CLUSTER_WIDTH));
    line =
      fillCarpet(clusterStart) +
      LEFT_DECO +
      SNIFF_FRAME +
      RIGHT_DECO +
      fillCarpet(width - clusterStart - SNIFF_CLUSTER_WIDTH);
  } else {
    line = fillCarpet(x) + WALK_FRAME + fillCarpet(maxX - x);
  }
  return h(Text, { color }, line);
}

// 강아지 줄 위아래를 둘러싸는 잔디 띠. 이모지(2칸)로 보드 폭을 정확히 채우고,
// 그 사이사이에 모양이 다른 나무를 불규칙하게 섞는다. 매 렌더마다 다시 뽑으면 배경이
// 초마다 깜빡이므로 Board에서 boardWidth가 바뀔 때만(useMemo) 다시 뽑는다 — 초마다
// 다시 그리는 시계 틱에는 반응하지 않는다.
const TREE_VARIANTS = ['🌳', '🌲', '🌴'];
const TREE_CHANCE = 0.18;

function buildGrassLine(boardWidth) {
  const slotCount = boardWidth / SPRITE_VISUAL_WIDTH;
  let line = '';
  for (let i = 0; i < slotCount; i++) {
    line +=
      Math.random() < TREE_CHANCE
        ? TREE_VARIANTS[Math.floor(Math.random() * TREE_VARIANTS.length)]
        : '🌿';
  }
  return line;
}

function Board() {
  const [now, setNow] = useState(new Date());
  useInterval(() => setNow(new Date()), 1000);

  const blink = now.getSeconds() % 2 === 0;
  const h24 = pad(now.getHours());
  const m = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const timeText = `${h24}${blink ? ':' : ' '}${m}${blink ? ':' : ' '}${s}`;

  const dateText = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const hour = now.getHours();
  const isDaytime = hour >= 6 && hour < 18;

  // 터미널 문자 격자 폭(글꼴 크기를 바꾸면 창은 그대로라도 이 값이 바뀐다)이 바뀔 때만
  // boardWidth 이하가 다시 계산된다 — 시계가 매초 다시 그려지는 것과는 무관하다.
  const terminalColumns = useTerminalColumns();
  const boardWidth = useMemo(() => computeBoardWidth(terminalColumns), [terminalColumns]);
  const mountainSideWidth = useMemo(() => computeMountainSideWidth(boardWidth), [boardWidth]);
  // 산 모양 자체는 랜덤이 아니라 폭만으로 정해지는 결정론적 계산이라, boardWidth가 바뀔
  // 때 다시 만들어도(잔디처럼) 깜빡이지 않는다 — 같은 폭이면 항상 같은 모양이 나온다.
  // 시계 쪽 간격 칸(MOUNTAIN_GAP)까지 산이 이어지도록 산을 그 폭만큼 더 넓게 그린다(산이 없으면 0 그대로).
  const mountainDrawWidth = mountainSideWidth > 0 ? mountainSideWidth + MOUNTAIN_GAP : 0;
  const mountainLeftRows = useMemo(() => buildMountainRows(mountainDrawWidth), [mountainDrawWidth]);
  const mountainRightRows = useMemo(() => buildMountainRows(mountainDrawWidth), [mountainDrawWidth]);
  // 잔디는 랜덤이라 boardWidth가 바뀔 때만 새로 뽑는다(매초 다시 뽑으면 깜빡인다, 기존 주석 참고).
  const topGrassLine = useMemo(() => buildGrassLine(boardWidth), [boardWidth]);
  const bottomGrassLine = useMemo(() => buildGrassLine(boardWidth), [boardWidth]);

  const [owlSpot, setOwlSpot] = useState(null);
  const isDaytimeRef = useRef(isDaytime);
  // 부엉이 스케줄러는 마운트 때 한 번만 도는 타이머 체인이라, 나중에 콜백이 실행되는
  // 시점의 "그 순간" 값을 읽으려면 ref 미러링이 필요하다(낮/밤뿐 아니라 리사이즈로 산
  // 모양·폭이 바뀐 경우도 마찬가지).
  const mountainLeftRowsRef = useRef(mountainLeftRows);
  const mountainRightRowsRef = useRef(mountainRightRows);
  const mountainSideWidthRef = useRef(mountainDrawWidth);
  useEffect(() => {
    isDaytimeRef.current = isDaytime;
    if (isDaytime) setOwlSpot(null); // 낮이 되면 보여주던 중이어도 바로 치운다
  }, [isDaytime]);
  useEffect(() => {
    mountainLeftRowsRef.current = mountainLeftRows;
  }, [mountainLeftRows]);
  useEffect(() => {
    mountainRightRowsRef.current = mountainRightRows;
  }, [mountainRightRows]);
  useEffect(() => {
    mountainSideWidthRef.current = mountainDrawWidth;
  }, [mountainDrawWidth]);

  // sniff/조우 스케줄러와 같은 재귀 setTimeout 패턴. 타이머가 울릴 때 낮이면(또는 앉을 자리가
  // 없으면) 그냥 다음 타이머만 다시 건다 — 낮에는 아예 보여주지 않는다.
  useEffect(() => {
    let gapTimer;
    let durationTimer;
    const scheduleNext = () => {
      gapTimer = setTimeout(() => {
        const spot = !isDaytimeRef.current
          ? pickOwlSpot(mountainLeftRowsRef.current, mountainRightRowsRef.current, mountainSideWidthRef.current)
          : null;
        if (!spot) {
          scheduleNext();
          return;
        }
        setOwlSpot(spot);
        durationTimer = setTimeout(() => {
          setOwlSpot(null);
          scheduleNext();
        }, randomBetween(OWL_DURATION_MIN_MS, OWL_DURATION_MAX_MS));
      }, randomBetween(OWL_GAP_MIN_MS, OWL_GAP_MAX_MS));
    };
    scheduleNext();
    return () => {
      clearTimeout(gapTimer);
      clearTimeout(durationTimer);
    };
  }, []);

  return h(
    Box,
    {
      borderStyle: 'single', // 굵은 이중선(double) 대신 얇은 1px 테두리.
      borderColor: '#00FF66',
      backgroundColor: '#000000',
      flexDirection: 'column',
      alignItems: 'center',
      paddingX: 0, // 테두리와 내용 사이에 padding이 만드는 빈 줄이 안 남게 한다.
    },
    h(Text, { color: '#00FF66', bold: true }, "Y O U   G O T   T H I S"),
    // 보드 높이는 그대로 두고 좌표만 옮긴다: 해/달 줄 + 본문 8줄(=9줄) 영역을 세 칸(왼쪽 산 · 가운데 · 오른쪽 산)
    // 으로 나눠 각 칸 안에서 위쪽 빈 줄(spacer) 수로 위치를 정한다. 산은 영역 맨 아래(잔디 바로 위)에 붙고,
    // 해/달은 왼쪽 산 바로 위, 시계는 위에서 2번째 줄부터(5줄), 날짜는 맨 아래에서 두 번째 줄이다.
    h(
      Box,
      { height: 1 + 8 },
      h(
        Box,
        { flexDirection: 'column', width: mountainDrawWidth },
        h(Box, { height: 8 - MOUNTAIN_HEIGHT }),
        h(Text, { color: '#00FF66', bold: true }, centerText(isDaytime ? SUN_ROW : MOON_ROW, mountainSideWidth)),
        h(
          Box,
          { position: 'relative' },
          h(Mountain, { rows: mountainLeftRows, color: '#00FF66', farColor: '#045926' }),
          // 왼쪽 산 오른쪽 발치(맨 아랫줄, 산 폭 오른쪽 끝에서 한 칸 밖으로 나온다)에 집 한 채. 올빼미가 앉는 윗줄과는 겹치지 않는다.
          mountainSideWidth >= 2
            ? h(Box, { position: 'absolute', top: MOUNTAIN_HEIGHT - 1, left: mountainSideWidth + 1 }, h(Text, null, HOUSE_EMOJI))
            : null,
          owlSpot && owlSpot.side === 'left'
            ? h(Box, { position: 'absolute', top: owlSpot.row, left: owlSpot.x }, h(Text, { bold: true }, OWL_EMOJI))
            : null,
        ),
      ),
      h(
        Box,
        { flexDirection: 'column', alignItems: 'center', width: CLOCK_WIDTH },
        h(Box, { height: 1 }),
        h(BigClock, { text: timeText, color: '#3B82F6' }),
        h(Box, { height: 1 }),
        h(Text, { color: '#00FF66', bold: true }, dateText),
        h(Box, { height: 1 }),
      ),
      h(
        Box,
        { flexDirection: 'column', width: mountainDrawWidth },
        h(Box, { height: 9 - MOUNTAIN_HEIGHT }),
        h(
          Box,
          { position: 'relative' },
          h(Mountain, { rows: mountainRightRows, color: '#00FF66', farColor: '#045926' }),
          owlSpot && owlSpot.side === 'right'
            ? h(Box, { position: 'absolute', top: owlSpot.row, left: owlSpot.x }, h(Text, { bold: true }, OWL_EMOJI))
            : null,
        ),
      ),
    ),
    h(
      Box,
      { flexDirection: 'column' },
      h(Text, { color: '#00FF66' }, topGrassLine),
      h(DogWalk, { width: boardWidth, color: '#00FF66' }),
      h(Text, { color: '#00FF66' }, bottomGrassLine),
    ),
  );
}

render(h(Board));
