# 그래픽 품질 향상 설계 (WorldMaterials + 후처리)

- 날짜: 2026-08-28
- 상태: 승인됨 (사용자 검토 대기)
- 범위: 전 오브젝트(건물/지형/자연물/유닛/드래곤 소폭) 표면 품질 + 후처리 파이프라인

## 1. 목표와 제약

**목표**: "단조로운 단색 표면"과 "후처리 부재"를 해결해 현실적 중세 판타지 톤의 표면 질감을 전 오브젝트에 적용한다.

**제약 (사용자 확정)**
- 성능 우선: 중간 사양 노트북 60fps 유지. 텍스처 해상도/후처리는 절제.
- 비주얼 방향: 현실적 중세 판타지 (스타일라이즈드 과장 없음).
- 에셋 파이프라인 없음 — 100% 절차 생성 (프로젝트 관례: 오디오도 합성).
- 아키텍처 불변식 준수:
  - 머티리얼/텍스처는 씬 스코프 (`WeakMap<Scene, ...>` 캐시). `assertMaterialsInScene()` 가드 패턴 적용.
  - `DragonRig.dispose()`가 머티리얼을 소유하지 않듯, 캐시가 머티리얼 수명을 소유.
  - Babylon import는 `@babylonjs/core` 서브패스.

**명시적 제외 (scope 밖)**
- PBR 전환 (StandardMaterial 유지)
- 물/구름/실루엣 링 개선
- 병사 지오메트리 변경 (화면상 크기가 작음)
- 드래곤 텍스처 재작성 (이미 정교함 — 노이즈 헬퍼 추출만)
- 블룸/SSAO (YAGNI — 화염은 이미 ADD 블렌드 발광)

## 2. 핵심 아키텍처 — `WorldMaterials`

**신규 모듈**
- `src/world/Noise.ts`: `valueNoise`, `fbm`, `hash01`을 `DragonMaterials.ts`에서 추출. DragonMaterials와 WorldMaterials가 공유. DragonMaterials 동작 불변 (순수 함수 이동).
- `src/world/WorldMaterials.ts`: 절차적 텍스처/머티리얼 라이브러리.
  - `WeakMap<Scene, WorldMaterialSet>` 씬 스코프 캐시 — DragonMaterials 패턴 복제.
  - 텍스처는 씬당 1회 생성 (미션 로딩 화면에서 수행, 수십 ms — DragonMaterials 선행 사례와 동일).

**텍스처 세트 (해상도 / 맵)**

| 텍스처 | 해상도 | 맵 | 특징 |
|---|---|---|---|
| 돌 | 512 | albedo + normal + gloss | 벽돌 코스 + 풍화 얼룩 + 이끼, 크레비스 AO |
| 목재 | 256 | albedo + normal | 판자 결 + 썩음 얼룩 |
| 지붕 | 256 | albedo + normal | 슬레이트/와편 격자 |
| 천 | 256 | albedo + normal | 직조 격자 미세 노멀 |
| 가죽 | 256 | albedo + normal | 세밀 그레인 |
| 금속 | 256 | albedo + normal | 브러시드 + 스크래치 |
| 나무껍질 | 256 | albedo + normal | 수직 균열 |
| 바위 | 256 | albedo + normal | 각진 균열 + 얼룩 |
| 지면 디테일 | 512 | albedo + normal | 미세 흙/풀 그레인 |

**색조(tint) 시스템 유지** — 핵심 설계 결정:
- 캐시는 텍스처가 붙은 **기본 머티리얼**을 제공하고, 팩토리는 필요 시 `.clone()` 후 `diffuseColor`로 틴트.
- StandardMaterial은 `diffuseTexture × diffuseColor × vertexColor`를 곱하므로 기존 시스템이 그대로 작동:
  - 건물 데미지 틴트 (`BuildingSystem.refreshDamageVisuals`의 `baseDiffuse.scale()`)
  - 병사 문장색 (`def.color`)
  - 지형 정점 색상
- gloss/normal 텍스처는 원본 참조 공유 (클론 비용 절감, 텍스처는 GPU 1회 업로드).

## 3. 콘텐츠 적용

### 3.1 건물 (`BuildingFactory`, `CastleBuilder`)
- 돌/목재/지붕 텍스처를 캐시에서 참조. 건물별 머티리얼 클론 유지 (데미지 틴트 보존).
- UV: 병합 메시 프리미티브 UV에 맞춰 건물 종류별 `uScale/vScale` (대형 벽일수록 반복 증가 — keep/wall 6~8, tower 3~4, house 2).
- CastleBuilder는 성 전체가 돌 4종(stone/darkStone/wood/roof) 머티리얼 공유 — 텍스처 부착만으로 즉시 효과.
- 지오메트리 저비용 개선:
  - 타워/keep/gate에 창문 인셋 (어두운 emissive 박스, `emissiveColor` 소폭) — 원거리 실루엣 최대 기여.
  - 지붕 처마 확장 (roof 파트 크기 소폭 증가).
  - 주요 타워 실린더 tessellation 8→12.
  - 삼각형 예산 증가 ~5-10% 이내.

### 3.2 지형/자연물 (`Terrain`, `WorldBuilder` props)
- 지면: 정점 색상 위 타일링 디테일 텍스처 + 노멀 (uScale ~60-80). 기존 groundColor/groundColorAccent 유지.
- 나무: 껍질 노멀 + 잎 무늬 텍스처. 바위: 암석 텍스처 + 노멀.
- 물/구름/실루엣 링: 변경 없음.

### 3.3 유닛 (`SoldierFactory`)
- 병사: 천/가죽/금속 텍스처. 병사별 머티리얼 클론 유지 (문장색 유지).
- 발리스타: 목재 텍스처.
- 지상전 기수 (`createRiderFigure`): 가죽/금속/천/피부 텍스처 — 지상전 근접 촬영 대응.
- 병사 지오메트리: 변경 없음.

### 3.4 드래곤 (소폭)
- `DragonMaterials.ts`에서 노이즈 헬퍼를 `Noise.ts`로 추출하는 것 외 변경 없음.

## 4. 후처리 파이프라인

**신규** `src/engine/PostPipeline.ts`:
- `DefaultRenderingPipeline` — 씬당 1개 (MissionScene, MenuShowcase). 씬 dispose와 함께 해제.
- **FXAA**: 전 티어 상시. 엔진 MSAA(`antialias: true`)는 켜져 있으나 Governor 티어 2/3의 하드웨어 스케일링(1.25x/1.5x) 업스케일 계단을 FXAA가 보완.
- **imageProcessing**: 대비 +5~8%, 미세 비네트, 티어 0-1에서만 톤매핑.
- **블룸/SSAO 없음.**

**Governor 연동**:
- `PerformanceGovernor.ts`의 standalone 함수 `configureSceneQuality(scene, shadows)` 스텁을 구현해 티어별 후처리 전환:
  - 티어 0/1: FXAA + imageProcessing 전체
  - 티어 2/3: FXAA만
- 티어 변경 시 런타임 전환 (GameApp이 이미 governor 티어를 소비하는 경로에 연결).

## 5. 테스트/검증

- 단위 테스트 (신규 `tests/`):
  - Noise 헬퍼 결정론성 (동일 시드 → 동일 값).
  - WorldMaterials 캐시: 같은 씬 동일 인스턴스, 다른 씬 분리, dispose 동작.
  - 재질-씬 소속 가드 (기존 `assertMaterialsInScene` 패턴).
- `npm run typecheck` 그린.
- 기존 단위/E2E 전부 그린 유지 (E2E는 `?test=1`, simWait 패턴 준수).
- `npm run benchmark` (headed) 전/후: 평균 fps 5% 이내 저하 목표.
- 브라우저 수동 검증 + 스크린샷 (QA png 커밋 금지 — 기존 관례).

## 6. 리스크

| 리스크 | 완화 |
|---|---|
| 절차적 텍스처 생성이 로딩 시간에 추가 (수십 ms) | DragonMaterials와 동일 규모 — 로딩 화면에서 수행, 측정 후 조정 |
| 병합 메시 UV가 프리미티브 기본값이라 타일링이 어색할 수 있음 | 건물 종류별 uScale 튜닝, 스크린샷 검증 |
| 후처리가 저사양 티어에서 비용 추가 | FXAA는 저비용, imageProcessing은 티어 2/3에서 off |
| 하드웨어 스케일링과 FXAA 상호작용 | benchmark 전/후 측정으로 확인 |
