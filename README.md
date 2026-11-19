# 한탕 (가제)

"더 털까, 지금 튈까"를 핵심으로 하는 게임의 프로토타입 저장소다. 같은 아이디어를 두 가지 형태로 만들어 비교한다.

| 프로토타입 | 폴더 | 형태 |
|---|---|---|
| 먼지골 한탕 | `western/` | 위에서 내려다보는 실시간 서부 슈팅. 돈을 털고 추격대를 따돌려 말로 탈출한다 |
| 한탕 작전 | 저장소 루트 (`src/`) | 턴제 덱빌딩 로그라이크. 그림 없이 규칙만 검증한다 |

아래 명령은 루트의 카드 게임 기준이고, 서부 게임은 `npm run dev:western`, `npm run build:western`을 쓴다. 빌드 결과는 `western/dist/index.html`이다. 테스트는 `npm test` 한 번으로 둘 다 돈다.

- 규칙과 카드 목록: [docs/prototype-rules.md](docs/prototype-rules.md)
- 시장 조사 리포트: [reports/첫 게임 타겟 시장 분석.md](reports/첫%20게임%20타겟%20시장%20분석.md)

## 실행

Node.js 22.18 이상이 필요하다.

```bash
npm install
npm run dev      # 소스가 바뀌면 다시 묶고 5173번 포트로 서빙
npm run build    # dist/index.html 한 파일로 묶기
npm test         # 규칙 엔진 테스트
npm run sim      # 봇으로 수천 판을 돌려 난이도 수치 점검
```

`npm run dev`를 실행하면 같은 네트워크의 폰에서 열 수 있는 주소가 터미널에 출력된다.

## 홈서버에 올리기

빌드 결과는 `dist/index.html` 파일 하나다. 스크립트와 스타일이 모두 들어 있어서 이 파일만 웹서버가 서빙하는 폴더에 두면 된다.

```bash
git pull && npm ci && npm run build
cp dist/index.html /var/www/hantang/index.html   # 경로는 서버 설정에 맞게
```

글꼴은 Google Fonts에서 불러온다. 인터넷이 막힌 환경에서는 기기의 기본 한글 글꼴로 표시된다.

## 구조

| 경로 | 내용 |
|---|---|
| `western/src/game/` | 서부 게임의 로직. 한 프레임 진행(`sim.ts`), 마을 지도와 작전(`map.ts`), 업그레이드와 정산(`run.ts`) |
| `western/src/` | 서부 게임의 화면(`render.ts`), 입력(`input.ts`), 메뉴와 루프(`main.ts`) |
| `src/game/` | 카드 게임의 규칙 엔진. 카드(`cards.ts`), 장소(`locations.ts`), 진행(`engine.ts`) |
| `src/ui/app.ts` | 상태를 화면으로 그리고 입력을 엔진에 전달 |
| `scripts/sim.ts` | 난이도 점검용 봇 시뮬레이션 |
| `tests/` | 규칙 엔진 테스트 |

수치를 바꿀 때는 `src/game/locations.ts`(상납금, 도주 요구값, 순찰)와 `src/game/cards.ts`(카드 효과와 가격)를 고친 뒤 `npm run sim`으로 확인한다.
