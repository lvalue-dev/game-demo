# 3D 모델 넣는 곳

코드로 빚은 손과 총은 인형처럼 보이는 한계가 있어서, 실제처럼 보여야 하는 것은 밖에서 만든 3D 모델(GLB 파일)을 이 폴더에 넣어 쓴다. 파일을 넣고 빌드하면 게임이 코드로 만든 것 대신 그 모델을 보여 준다. 파일이 없으면 지금처럼 코드로 만든 것이 나온다.

## 넣을 파일

| 파일 이름 | 내용 | 넣으면 바뀌는 것 |
|---|---|---|
| `revolver.glb` | 리볼버 한 자루만 | 1인칭 화면의 총. 손은 코드로 만든 손이 그대로 쥔다. |
| `hold.glb` | 오른팔(소매)과 손이 리볼버를 쥔 모습이 한 덩어리 | 1인칭 화면의 총과 오른손 전체. `revolver.glb`보다 우선한다. |

크기, 놓인 방향, 용량은 신경 쓰지 않아도 된다. 빌드할 때 `scripts/models.mjs`가 면 수를 4만 개 이하로, 질감 그림을 1024픽셀로 줄이고, 게임이 총의 생김새를 보고 총구 방향과 위아래를 맞춘다. 방향이 틀리게 잡히면 `models.json`에서 고친다.

## AI로 만드는 방법

글보다 **그림에서 3D로** 만드는 쪽이 원하는 모양을 얻기 쉽다.

1. 기준 그림을 만든다. 그림 생성 AI에 아래처럼 요청한다. 흰 배경, 옆모습, 그림자 없음이 중요하다.
   - 총: `Side view of an 1873 single-action army revolver, 4.75 inch barrel, blued steel with case-hardened frame, worn walnut grip, photorealistic product photo, plain white background, no shadow, orthographic`
   - 쥔 손: `A man's right forearm and hand gripping an 1873 single-action revolver, pointing left, rolled red wool shirt sleeve, weathered skin, photorealistic, side view, plain white background, no shadow`
2. 그 그림을 AI 3D 생성 도구(Meshy, Tripo, Rodin, Hunyuan3D 등)의 "image to 3D"에 넣는다.
3. 질감은 PBR(색, 거칠기, 금속성, 노멀)로 켜고 **GLB**로 내려받는다.
4. 파일 이름을 위 표대로 바꿔 이 폴더에 올린다. GitHub 웹에서는 작업 브랜치의 `western/assets/` 폴더로 가서 "Add file → Upload files"로 올리면 된다(웹 올리기는 파일당 25MB까지).

어느 도구가 가장 좋은지는 비교 글마다 순위가 다르다. 무료 체험으로 같은 그림을 두세 곳에 넣어 보고 고르는 것이 빠르다. **상업적 이용 조건은 도구와 요금제마다 다르므로 스팀에 낼 모델은 그 도구의 약관을 직접 확인해야 한다.**

## 알아둘 한계

- AI가 만든 총은 부품이 한 덩어리로 붙어 나온다. 공이치기가 젖혀지거나 탄창이 도는 동작은 사라지고, 반동·흔들림·재장전처럼 총 전체가 움직이는 동작만 남는다. 부품이 따로 움직이게 하려면 부품이 나뉜 에셋이 필요하다.
- AI는 손가락을 자주 뭉개거나 개수를 틀린다. `hold.glb`는 여러 번 뽑아 손가락이 멀쩡한 것을 고른다.
- 방향 자동 맞춤은 총만 있는 모델(`revolver.glb`)에만 한다. `hold.glb`는 팔이 길어 생김새로 가늠하기 어려우므로 올린 뒤 `models.json`의 `turn`과 `shift`로 맞춘다.

## models.json

```json
{ "revolver": { "file": "revolver.glb", "fit": "auto", "size": 0.264, "turn": [0, 0, 0], "shift": [0, 0, 0] } }
```

- `fit`: `auto`면 생김새로 방향을 맞추고, `manual`이면 원본 방향 그대로 둔다.
- `size`: 가장 긴 쪽의 길이(미터). 실물 리볼버는 약 0.26이다.
- `turn`: 맞춘 뒤 더 돌릴 각도(도, x·y·z 순).
- `shift`: 옮길 거리(미터, 오른쪽·위·뒤가 +).
- `triangles`, `texture`: 줄일 목표. 기본은 40000, 1024.
