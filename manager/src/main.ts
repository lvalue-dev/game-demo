import { snapshot, start } from './ui/app.ts';

// 페이지가 열려 있는 동안 새 버전이 배포되면 진행 중인 판을 넘겨받기 위한 연결 고리.
// 이 고리가 없는 환경(홈서버, 로컬)에서는 그냥 바로 시작한다.
interface HotHook {
  data?: { game?: unknown };
  snapshot?: (take: () => unknown) => void;
  ready?: (boot: (data: { game?: unknown }) => void) => void;
}

const hot = (window as unknown as { claude?: { hot?: HotHook } }).claude?.hot;
hot?.snapshot?.(snapshot);

const boot = (data: { game?: unknown } | undefined): void => start(data ?? {});
if (hot?.ready) hot.ready(boot);
else boot(hot?.data);
