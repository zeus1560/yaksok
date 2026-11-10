# 개발 환경 설정

> 원본: Notion 「환경 설정」 https://app.notion.com/p/3db7085f3182802f9d7bcb4578320e9a
> 추출일: 2026-10-30

> ✅ **개발 환경 구축 완료** — 2026-09-18
>
> `main` 브랜치에 환경 설정이 머지되어 있습니다. **혜승·승주는 아래 「팀원 온보딩」만 따라하면 바로 개발을 시작할 수 있습니다.**
>
> 구성: Next.js 16 + TypeScript + Prisma 7 + PostgreSQL(Neon) + Tailwind 4 · GitHub Actions CI
>
> **개발용 DB는 각자 자기 Neon 프로젝트를 만들어 씁니다.** 서로의 데이터를 건드리지 않기 위해서입니다.

---

## 팀원 온보딩

(혜승 · 승주)

### 1-1. 내 컴퓨터에 필요한 것 (처음 한 번만)

#### 🪟 Windows

```powershell
winget install OpenJS.NodeJS.LTS --version 24.22.2
winget install Git.Git
winget install Microsoft.VisualStudioCode
```

설치 후 **터미널을 새로 열고** 확인합니다.

```powershell
node -v
git --version
```

`node -v`가 **v24.x**여야 합니다. v22나 v20이 나오면 예전 Node가 남아 있는 것이니 제어판에서 지우고 다시 설치하세요.

줄바꿈 사고 방지용 설정을 딱 한 번 실행합니다.

```powershell
git config --global core.autocrlf false
git config --global user.name "본인이름"
git config --global user.email "본인@kangnam.ac.kr"
```

`npm run dev` 실행 시 `npm.ps1 ... 로드할 수 없습니다` 오류가 나면:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

#### 🍎 macOS

```bash
brew install node@24
brew link --overwrite --force node@24
brew install git
brew install --cask visual-studio-code
```

```bash
node -v
git --version
```

`node -v`가 **v24.x**여야 합니다.

```bash
git config --global core.autocrlf false
git config --global user.name "본인이름"
git config --global user.email "본인@kangnam.ac.kr"
```

#### VS Code 확장

**VS Code 확장 네 개**를 설치합니다. VS Code로 `yaksok` 폴더를 열고 터미널을 열어서(보기 → 터미널) 아래를 붙여넣으세요.

```bash
code --install-extension Prisma.prisma
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
```

> 💡 설치 후 **VS Code를 한 번 꺼다 켜야** 확장이 제대로 적용됩니다.
>
> Mac에서 `code: command not found`가 뜨면 VS Code에서 `Cmd + Shift + P` → `Shell Command: Install 'code' command in PATH`를 한 번 실행한 뒤 다시 시도하세요.
>
> 네 개 중 **Prettier가 특히 중요**합니다. `.vscode/settings.json`에서 기본 포매터로 지정해둔 터라, 없으면 저장할 때 자동 정렬이 조용히 안 먹습니다.

> 🧹 전체 재포맷처럼 서식만 바꾼 커밋은 `.git-blame-ignore-revs`에 적어 둡니다. GitHub의 blame 화면은 이 파일을 자동으로 읽고, 로컬 `git blame`은 한 번만 설정하면 됩니다.
>
> ```bash
> git config blame.ignoreRevsFile .git-blame-ignore-revs
> ```

> 🐳 **Docker는 설치하지 않습니다.** DB를 클라우드(Neon)로 쓰기로 해서 필요가 없어졌습니다. 나중에 로컬 Docker DB로 바꾸고 싶으면 `.env` 한 줄만 고치면 되니, 지금 깔 이유가 없습니다.

### 1-2. 코드 받기

```bash
git clone https://github.com/yeonseong0224/yaksok.git
cd yaksok
npm ci
```

> ⚠️ `npm install`이 아니라 **`npm ci`** 입니다. `package-lock.json`에 적힌 버전을 그대로 설치해서 팀 전체가 똑같은 환경이 됩니다.

### 1-3. 내 Neon DB 만들기

[neon.com](https://neon.com)에 **GitHub 계정으로 가입**합니다.

- [ ] 프로젝트 생성 · 이름은 본인 것으로 구분되게 (`yaksok-dev-혜승` 같은 식)
- [ ] Region은 **AWS Asia Pacific 1 (Singapore)**
- [ ] Services에서 **Postgres database만 켜고** Object storage · Functions · AI gateway · Neon Auth는 **전부 끕니다**
- [ ] 생성 후 나오는 **Connection string을 복사**합니다

> 🔌 **연결 문자열은 두 종류입니다.** 호스트 이름에 `-pooler`가 붙은 것과 안 붙은 것인데, **`-pooler`가 없는 쪽**을 쓰세요. 화면에 `Connection pooling` 토글이 있으면 꺼두면 됩니다. 풀링 버전은 서버리스 배포용이라 로컬 마이그레이션에서 문제가 생깁니다.
>
> 이런 모양이면 맞습니다.
>
> `postgresql://neondb_owner:비밀번호@ep-무언가.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
>
> `.env`에 넣을 때는 **`sslmode=require`를 `sslmode=verify-full`로 바꿉니다**(아래 1-4).
>
> **비밀번호가 들어 있으니 채팅방이나 문서에 붙여넣지 마세요.**
>
> 메모장 등에서 꼭 갖고 있으세요.

> 💤 Neon 무료 플랜은 5분간 쿼리가 없으면 컴퓨트가 절전됩니다. **한참 만에 보내는 첫 요청이 1초쯤 느린 건 정상**입니다. 저장공간 0.5GB, 월 100 CU-hours로 개발용으로는 충분히 남습니다.

### 1-4. `.env` 만들기

프로젝트 루트에 있는 `.env.example`을 복사해서 `.env`를 만듭니다.

```bash
cp .env.example .env
```

Windows PowerShell이면:

```powershell
Copy-Item .env.example .env
```

`.env`를 열어서 `DATABASE_URL`을 **본인 Neon 연결 문자열**로 바꿉니다. 나머지 값은 아직 비워둬도 됩니다.

> 🔒 **`sslmode`는 `verify-full`로 적습니다.** Neon 화면이 주는 `sslmode=require`는 앱이 쓰는 `pg` 8에서 `verify-full`(인증서·호스트 이름 확인)의 별칭으로 처리되지만, 연결할 때 `SECURITY WARNING: The SSL modes ... are treated as aliases for verify-full` 경고가 나옵니다. `pg` 9부터는 `require`가 표준 libpq 뜻(암호화만, 인증서 확인 안 함)으로 바뀌어 보안이 약해집니다. 지금 동작(확인함)을 유지하려는 것이므로 `verify-full`로 명시합니다. Neon 인증서는 공인 CA라 따로 인증서 파일이 필요 없고, Prisma CLI(`migrate`)도 같은 값으로 동작합니다. `channel_binding=require`는 그대로 둡니다. `DIRECT_URL`을 채울 때도 같습니다.

> 🔥 `.env`는 `.gitignore`에 들어 있어 Git에 올라가지 않습니다. **절대 이 설정을 풀지 마세요.** 한 번 커밋되면 히스토리에 영원히 남아서 키를 재발급하는 것 말고는 방법이 없습니다.

### 1-5. DB 준비하고 실행

```bash
npx prisma generate
npx prisma migrate dev
npm run dev
```

`migrate dev`가 저장소에 있는 마이그레이션 파일들을 **내 Neon DB에 적용**합니다. 비어 있던 DB에 테이블이 생깁니다.

### 1-6. 확인

브라우저에서 두 주소를 엽니다.

| 주소                               | 기대 결과         |
| ---------------------------------- | ----------------- |
| `http://localhost:3000`            | Next.js 기본 화면 |
| `http://localhost:3000/api/health` | `{"ok":true}`     |

> 🎉 `/api/health`에서 `{"ok":true}`가 나오면 **Next.js → Prisma → 내 Neon DB까지 전부 연결된 것**입니다. 환경 구축 완료입니다.
>
> 안 되면 아래 「자주 터지는 오류」를 먼저 보시고, 그래도 안 되면 **30분 이상 혼자 붙잡지 말고** 이슈 DB에 등록하세요.

---

## 프로젝트 구조에서 알아둘 것

| 경로                       | 역할                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `app/`                     | 화면과 API. App Router라 폴더 구조가 곧 URL입니다                  |
| `app/api/health/route.ts`  | 연결 확인용 API. DB에 붙는지 볼 때 씁니다                          |
| `lib/prisma.ts`            | **Prisma 싱글턴.** DB를 쓸 때는 항상 여기서 import합니다           |
| `prisma/schema.prisma`     | DB 스키마. ERD 신버전 5개 테이블 (`docs/architecture/DATABASE.md`) |
| `prisma/migrations/`       | 마이그레이션 기록. **Git으로 공유**되고 각자 DB에 적용합니다       |
| `prisma/generated/`        | 자동 생성 코드. Git에 안 올라가고 `prisma generate`로 만듭니다     |
| `prisma.config.ts`         | Prisma CLI 설정. DB 주소를 환경변수에서 읽습니다                   |
| `AGENTS.md` / `CLAUDE.md`  | AI 에이전트용 프로젝트 규칙. `CLAUDE.md`는 `@AGENTS.md` 한 줄      |
| `.github/workflows/ci.yml` | PR마다 타입·린트·빌드를 검사                                       |

> ⚠️ **`new PrismaClient()`를 직접 호출하지 마세요.** 개발 중 핫리로드마다 새 연결이 쌓여서 `too many connections`로 죽습니다. 항상 이렇게 가져다 쓰세요.
>
> ```ts
> import { prisma } from "@/lib/prisma";
> ```

<details>
<summary><code>lib/prisma.ts</code> 실제 내용</summary>

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/prisma/generated/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL이 설정되지 않았습니다. .env 파일을 확인하세요.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

</details>

---

## 개발 규칙

### 4-1. 브랜치와 PR

`main`에서 직접 작업하거나 push하지 않습니다. 브랜치 이름은 `<이름>/<타입>-<설명>` 형식이고(예: `ahn/feat-약속생성-api`), **기능 하나당 브랜치 하나**를 만들어 PR로 합칩니다.

```bash
git checkout main
git pull
git checkout -b ahn/feat-약속생성-api
# 작업...
git add -A
git commit -m "feat: 약속 생성 API 추가"
git push -u origin ahn/feat-약속생성-api
```

push하면 터미널에 PR 생성 링크가 나옵니다. PR을 만들면 CI가 자동으로 돌아가고, **초록 체크를 확인한 뒤 `Squash and merge`** 합니다.

| 브랜치 이름                            | 용도             |
| -------------------------------------- | ---------------- |
| `<이름>/feat-약속생성-api`             | 기능 추가        |
| `<이름>/fix-투표-중복-버그`            | 버그 수정        |
| `<이름>/chore-...` · `<이름>/docs-...` | 설정·의존성·문서 |

> ⚠️ 이름만으로 된 단독 브랜치(예: `ahn`)가 있으면 Git 규칙상 `ahn/...` 브랜치를 만들 수 없습니다. 단독 브랜치는 병합 후 지우고 시작하세요.

> 🚧 **현재 브랜치 보호 규칙은 실제로 강제되지 않습니다.** GitHub 룰셋은 비공개 저장소에서 Pro 이상이 필요한데 지금은 무료 플랜입니다. 규칙은 만들어뒀지만 적용은 안 되는 상태이므로, **당분간은 서로 약속으로 지킵니다.** 자세한 내용과 해결 방안은 「아직 남은 일」에 있습니다.

### 4-2. 커밋 메시지

```txt
<타입>: <한 줄 요약>

feat:     기능 추가
fix:      버그 수정
chore:    설정·의존성·빌드
docs:     문서
refactor: 동작 변경 없는 구조 개선
test:     테스트

예) feat: 약속 생성 API 추가
    fix: 장소 투표 중복 등록 막기
```

콜론 앞에 공백을 넣지 마세요. `chore :`가 아니라 `chore:`입니다.

### 4-3. DB 스키마를 바꿀 때

> 🔑 **각자 DB가 다르지만 마이그레이션 파일은 공유됩니다.** 이게 핵심입니다.

스키마를 바꾼 사람은:

```bash
# prisma/schema.prisma 수정 후
npx prisma migrate dev --name 변경내용요약
```

`prisma/migrations/` 아래에 새 폴더가 생깁니다. **이 파일을 반드시 PR에 포함**시키세요.

그 PR을 받은 사람은:

```bash
git pull
npx prisma migrate dev
npx prisma generate
```

> ⚠️ pull만 하고 `migrate dev`를 안 돌리면, 코드는 새 컬럼을 찾는데 내 DB에는 없어서 에러가 납니다. **스키마가 바뀐 PR을 받으면 습관적으로 위 세 줄을 실행**하세요.
>
> 순서가 엉켜서 Prisma가 drift를 감지하고 리셋을 제안하면, **본인 개발 DB에 한해** 리셋해도 됩니다. 공유 DB나 운영 DB는 절대 리셋하지 않습니다.

`prisma db push`는 사용하지 않습니다. 변경 기록이 안 남아서 팀원 DB와 어긋납니다.

### 4-4. 유용한 명령

```bash
npm run dev         # 개발 서버
npm run lint        # 린트 (출력 없으면 통과)
npm run typecheck   # 타입 검사 (출력 없으면 통과)
npm run build       # 배포용 빌드
npx prisma studio   # 브라우저로 DB 테이블 보기 · 값 직접 입력 가능
```

> 💡 `npx prisma studio`는 백엔드 입문 단계에서 제일 쓸모 있는 도구입니다. 내 DB에 뭐가 들어 있는지 눈으로 보면서 개발하면 훨씬 빠릅니다.

---

## 자주 터지는 오류

> # 🚨 Prisma 버전 함정 — 이건 꼭 읽으세요
>
> npm에서 `prisma`의 latest 태그가 **8.0.0-rc**(정식 아닌 시험판)를 가리키고 있습니다. 반면 `@prisma/client`의 latest는 7.10.0입니다.
>
> 그래서 `npm i -D prisma`처럼 **버전 없이 설치하면 CLI는 8 시험판, 클라이언트는 7**이 깔려서 깨집니다. Prisma 8은 설정 구조 자체가 달라서 이 문서 내용이 안 맞게 됩니다.
>
> `npx prisma` 실행 시 "Update available 7.10.0 → 8.0.0-rc" 안내가 뜨는데 **무시하세요.**
>
> `npm create prisma@latest`도 8 경로로 안내하므로 쓰지 않습니다.
>
> 버전이 의심되면 확인하세요. 셋 다 `7.10.0`이어야 합니다.
>
> ```bash
> npm ls prisma @prisma/client @prisma/adapter-pg
> ```

| 증상                                                                                                                      | 원인 / 해결                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `new PrismaClient()`에 타입 에러                                                                                          | Prisma 7부터 드라이버 어댑터를 넘겨야 합니다. `lib/prisma.ts`처럼 `adapter: new PrismaPg({ connectionString })`을 전달하세요    |
| `@/prisma/generated/client`를 못 찾음                                                                                     | `npx prisma generate`를 안 돌린 경우. 돌린 뒤에도 빨간 줄이 남으면 VS Code에서 `Ctrl+Shift+P` → `TypeScript: Restart TS Server` |
| `Environment variable not found: DATABASE_URL`                                                                            | `.env`가 없거나 `DATABASE_URL` 줄이 비어 있음. `.env.example`을 복사했는지 확인                                                 |
| 연결할 때 `SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'` | 연결 문자열이 `sslmode=require`. `.env`의 `DATABASE_URL`(과 `DIRECT_URL`)을 `sslmode=verify-full`로 바꾸세요(1-4)               |
| `too many connections`                                                                                                    | `new PrismaClient()`를 여러 곳에서 호출. 전부 `@/lib/prisma` import로 교체                                                      |
| `npm run lint`가 끝나지 않음                                                                                              | `eslint.config.mjs`의 무시 목록에 `prisma/generated/**`가 있는지 확인. 없으면 생성 코드 수천 줄을 검사하느라 멈춥니다           |
| CI만 `Cannot find name 'LayoutProps'`로 실패                                                                              | Next 16이 자동 생성하는 타입이라 `.next`가 없는 CI에서만 납니다. CI에 `npx next typegen` 단계가 있는지 확인                     |
| 안 건드린 파일이 전부 변경으로 표시됨                                                                                     | 줄바꿈(CRLF/LF) 문제. `git config --global core.autocrlf false` 설정 후 `git add --renormalize .`                               |
| 커밋에 파일 수백 개가 딸려옴                                                                                              | Prisma가 `.agents` · `.claude` · `.windsurf`에 문서를 복사합니다. `.gitignore`에 들어 있는지 확인하세요                         |
| `npm ci` 실패                                                                                                             | `package-lock.json`이 최신이 아님. pull을 받았는지 확인                                                                         |
| `npm.ps1 ... 로드할 수 없습니다` (Windows)                                                                                | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`                                                                           |
| cmd에서 `Ctrl+C`가 복사가 안 됨                                                                                           | cmd에서 그 조합은 **실행 중단**입니다. 복사는 드래그 후 `Enter` 또는 우클릭                                                     |

---

## 아직 남은 일

| 항목               | 내용                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 브랜치 보호 미작동 | GitHub 룰셋은 비공개 저장소에서 Pro 이상이 필요합니다. **GitHub Education(Student Developer Pack)** 을 신청하면 Pro를 무료로 받아 해결됩니다. 승인까지 며칠 걸리니 미리 신청해두는 게 좋습니다. 저장소를 공개로 전환하는 방법도 있지만 팀 논의가 필요합니다 |
| 배포               | **Vercel + Neon** 권장. Render 무료 플랜은 15분 유휴 후 잠들어 깨어나는 데 1분이 걸려서, 카카오의 5초 응답 제한을 못 맞춥니다. 무료 DB도 30일 후 만료됩니다                                                                                                 |
| 운영 DB 분리       | 배포 시 개발용과 별도의 Neon 프로젝트(또는 브랜치)를 씁니다. 운영 DB에는 `prisma migrate deploy`만 사용합니다                                                                                                                                               |

---

## 부록 — 팀장 초기 세팅 내역

(기록용 — 다시 볼 일은 거의 없지만 남겨둡니다)

2026-09-18 연성이 혼자 진행한 순서입니다. 팀원은 「팀원 온보딩」만 하면 되므로 따라할 필요 없습니다.

1. **프로젝트 생성** — 빈 폴더 안에서 `.`을 써서 한 겹 더 생기지 않게 했습니다

```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm
```

2. **설치 스크립트 승인** — `unrs-resolver`가 막혀 있어 승인했습니다. 승인 기록은 `package.json`의 `allowScripts`에 남아 팀원·CI에도 자동 적용됩니다

```bash
npm install-scripts approve unrs-resolver
```

3. **버전 고정 장치** — `.nvmrc`(`24`)와 `package.json`의 `engines` 추가
4. **GitHub 연결** — `git remote add origin` 후 `main`에 첫 push
5. **줄바꿈 통일** — `.gitattributes` 추가 (`* text=auto eol=lf`)
6. **Prisma 설치와 초기화** — 버전을 박아서 설치했습니다

```bash
npm i -D prisma@7.10.0 tsx
npm i @prisma/client@7.10.0 dotenv
npm i @prisma/adapter-pg@7.10.0
npx prisma init --datasource-provider postgresql
```

7. **generator output 조정** — `init` 기본값이 `../app/generated/prisma`였는데 `../prisma/generated`로 바꿨습니다. `app/` 안에 생성 코드가 들어가는 걸 피하고, `.gitignore`와 경로를 맞추기 위해서입니다. 이렇게 하면 import가 `@/prisma/generated/client`로 깔끔해집니다
8. **`.gitignore` 보완** — `.env*` 때문에 `.env.example`까지 무시되던 걸 `!.env.example`로 예외 처리하고, `/prisma/generated`와 `.agents/` · `.claude/` · `.windsurf/` · `skills.lock.json`을 추가했습니다
9. **첫 마이그레이션** — `npx prisma migrate dev --name init`
10. **싱글턴과 확인용 API** — `lib/prisma.ts`, `app/api/health/route.ts`
11. **코드 스타일** — Prettier 설치, `.prettierrc` · `.prettierignore` · `.vscode/settings.json`
12. **ESLint 무시 목록** — `eslint.config.mjs`에 `prisma/generated/**` 추가 (없으면 린트가 멈춤)
13. **CI** — `.github/workflows/ci.yml`. 첫 실행이 `LayoutProps` 타입 에러로 깨져서 `npx next typegen` 단계를 추가해 해결했습니다
14. **`AGENTS.md`** — 프로젝트 규칙 작성
15. **PR #1 머지** — Squash and merge

---

> 📚 **참고 자료**
>
> [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) · [Prisma 7 업그레이드 가이드](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) · [Prisma Config 레퍼런스](https://www.prisma.io/docs/orm/reference/prisma-config-reference) · [Prisma + Next.js](https://www.prisma.io/docs/orm/more/help-and-troubleshooting/nextjs-help) · [Neon 무료 플랜 한도](https://neon.com/faqs/free-plan-limits-and-quotas) · [GitHub 룰셋 플랜 요건](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) · [Render 무료 플랜 제약](https://render.com/docs/free) · [Vercel Hobby 플랜](https://vercel.com/docs/plans/hobby) · [카카오 챗봇 사용 안내](https://talktips.kakao.com/content/84)
