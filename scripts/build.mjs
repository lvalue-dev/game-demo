// 게임을 파일 하나짜리 웹 페이지로 묶는다.
//   dist/index.html  홈서버 등 어디에나 올릴 수 있는 완전한 문서
//   dist/page.html   머리말 없이 내용만 있는 조각(게시용)
// `--serve`를 붙이면 소스가 바뀔 때마다 다시 묶고 같은 네트워크의 폰에서도 열 수 있게 서버를 띄운다.
import { context } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { packModels } from './models.mjs';

// 저장소 안의 게임별 설정. `--project western`처럼 폴더 이름으로 고른다.
const PROJECTS = {
  '.': {
    title: '한탕 작전 프로토타입',
    fonts: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans+KR:wght@400;500;700&display=swap',
    port: 5173,
  },
  western: {
    title: '먼지골 한탕',
    fonts: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=IBM+Plex+Sans+KR:wght@400;500;700&family=Rye&display=swap',
    port: 5174,
  },
  manager: {
    title: '터치라인',
    fonts: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Black+Han+Sans&family=IBM+Plex+Sans+KR:wght@400;500;700&display=swap',
    port: 5175,
  },
};

const serve = process.argv.includes('--serve');
const projectArg = process.argv.indexOf('--project');
const root = projectArg >= 0 ? process.argv[projectArg + 1] : '.';
const project = PROJECTS[root];
if (!project) {
  console.error(`알 수 없는 프로젝트: ${root}. 가능한 값: ${Object.keys(PROJECTS).join(', ')}`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? project.port);
const TITLE = project.title;
const FONTS = project.fonts;
const at = (path) => `${root}/${path}`;

async function assemble(js) {
  const [css, body] = await Promise.all([
    readFile(at('src/style.css'), 'utf8'),
    readFile(at('src/page.html'), 'utf8'),
  ]);
  const head = [
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<title>${TITLE}</title>`,
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>\n${css}</style>`,
  ].join('\n');
  // 넣어 둔 3D 모델이 있으면 가볍게 줄여 페이지에 함께 싣는다.
  const models = await packModels(root);
  const data = Object.keys(models).length > 0 ? `<script>window.__MODELS=${JSON.stringify(models)}</script>\n` : '';
  const script = `${data}<script>\n${js}</script>`;

  const page = `${head}\n${body}${script}\n`;
  const full = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{box-sizing:border-box;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}${script}
</body>
</html>
`;
  await mkdir(at('dist'), { recursive: true });
  await Promise.all([writeFile(at('dist/index.html'), full), writeFile(at('dist/page.html'), page)]);
}

const ctx = await context({
  entryPoints: [at('src/main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: !serve,
  write: false,
  plugins: [
    {
      name: 'assemble',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) return;
          await assemble(result.outputFiles[0].text);
          console.log(`[${new Date().toLocaleTimeString()}] ${at('dist/index.html')} 갱신`);
        });
      },
    },
  ],
});

if (!serve) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
  createServer(async (_req, res) => {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await readFile(at('dist/index.html')));
    } catch {
      res.writeHead(503).end('빌드 중입니다. 잠시 뒤 새로고침하세요.');
    }
  }).listen(port, '0.0.0.0', () => {
    console.log(`이 컴퓨터: http://localhost:${port}`);
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`같은 네트워크의 폰: http://${net.address}:${port}`);
      }
    }
  });
}
