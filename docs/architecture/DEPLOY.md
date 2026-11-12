# 배포 안내 — Vercel 미리보기 배포

> 대상: 저장소 관리자(안). 처음부터 순서대로 따라 하면 브랜치의 **미리보기(Preview) 배포**를 띄우고 확인까지 할 수 있습니다.
> 배포 방식 결정은 `TECH_STACK.md`(R-05), 코드 쪽 결정(허용 Origin·초대 링크 주소)은 `DECISION_CONFLICTS.md` R-36에 있습니다.

> ⚠️ **공개 배포는 팀 결정 전입니다. 운영(Production) 주소는 팀 밖에 공유하지 않습니다.**
> Vercel의 기본 보호(Standard Protection)는 미리보기 주소만 막고 **운영 도메인은 누구나 열 수 있습니다.** 운영 DB·운영 환경변수는 팀이 공개를 결정한 뒤에 넣습니다(4절).

## 한눈에 보기

| 무엇           | 어디                                | 값                                                                                                         |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 저장소         | GitHub `zeus1560/yaksok` (`origin`) | Vercel Hobby는 다른 사람·조직의 비공개 저장소를 배포하지 못해 개인 저장소로 옮겼습니다(팀 저장소는 `team`) |
| 앱             | Vercel 프로젝트                     | 빌드 `npm run build`(= `prisma generate && next build`), Node.js 24                                        |
| 미리보기 DB    | Neon 미리보기 브랜치(`preview`)     | 개발 DB·e2e DB와 다른 브랜치. 마이그레이션은 손으로(`npm run db:deploy:preview`)                           |
| 로컬 설정 파일 | `.env.preview` (Git 제외)           | 미리보기 DB 주소, 배포 주소, 보호 우회 비밀값                                                              |
| 배포 확인      | `npm run test:e2e:preview`          | 배포된 주소에 `@smoke` 묶음(전체 흐름·운영 응답·다른 Origin 거부·초대 링크 주소·`/api/health`)             |
| 함수 지역      | `vercel.json`                       | `"regions": ["sin1"]`(싱가포르, DB와 같은 지역). 저장소가 기준이고 대시보드 설정은 참고입니다(3절 ⑤)       |
| 운영 배포      | `vercel.json`                       | `main` 자동 배포를 **꺼 두었습니다**(9절). 팀이 공개를 정하면 다시 켭니다                                  |
| 휴대폰 확인    | `MOBILE_CHECKLIST.md`               | 실제 휴대폰(아이폰 Safari·안드로이드 Chrome)으로 미리보기 주소를 열어 손으로 확인하는 항목                 |

---

## 1. Neon 미리보기 브랜치와 `.env.preview`

**① 브랜치 만들기 (처음 한 번)**

- [ ] [Neon 콘솔](https://console.neon.tech) → 본인 프로젝트 → **Branches** → **Create branch**
- [ ] 이름 `preview`, 부모는 `main`(개발 DB 브랜치). 데이터 복사 여부는 상관없습니다
- [ ] 만든 브랜치의 **Connect**에서 연결 문자열을 두 개 복사합니다
  - `-pooler`가 **붙은** 주소(Connection pooling 켬) → 앱·Vercel용 `DATABASE_URL`
  - `-pooler`가 **없는** 주소(Connection pooling 끔) → 마이그레이션·테스트 도우미용 `DIRECT_URL`
- [ ] 호스트 이름(`ep-…`)이 개발 DB·e2e DB와 **달라야** 합니다
- [ ] 프로젝트 **지역(Region)** 을 적어 둡니다(3절 ⑤에서 Vercel 지역을 맞춤)

**② `.env.preview` 만들기**

저장소 루트에 `.env.preview`를 만듭니다. `.gitignore`에 들어 있어 커밋되지 않습니다. `sslmode=verify-full`은 `SETUP.md` 1-4와 같습니다.

```bash
# Neon 미리보기 브랜치 — Vercel Preview 환경변수 DATABASE_URL에도 같은 값(-pooler)을 넣는다
DATABASE_URL="postgresql://…@ep-미리보기-pooler.….neon.tech/neondb?sslmode=verify-full&channel_binding=require"
DIRECT_URL="postgresql://…@ep-미리보기.….neon.tech/neondb?sslmode=verify-full&channel_binding=require"

# 배포 확인용 — 배포가 끝난 뒤 채운다(6절). 경로 없이 https 주소만
E2E_BASE_URL=""
# Vercel → Settings → Deployment Protection → Protection Bypass for Automation 에서 만든 값(5절)
VERCEL_AUTOMATION_BYPASS_SECRET=""
```

- **`.env.preview`가 `.env`(개발 DB)나 `.env.e2e`(e2e DB)와 같은 DB를 가리키면** 마이그레이션·테스트 명령이 시작하지 않고 멈춥니다(같은 주소, 또는 풀러·직접 연결만 다른 같은 호스트도).
- 운영 DB 주소는 넣지 않습니다.
- `E2E_BASE_URL`·`VERCEL_AUTOMATION_BYPASS_SECRET`은 명령 앞에 환경변수로 주면 그 값이 먼저 쓰입니다.

## 2. 미리보기 DB 마이그레이션

마이그레이션은 **Vercel 빌드에 넣지 않습니다.** 새 마이그레이션이 생긴 브랜치를 배포하기 **전에** 손으로 적용합니다.

```bash
npm run db:status:preview   # 적용 상태만 확인 (적용 안 된 것이 있으면 목록이 나옴)
npm run db:deploy:preview   # 커밋된 마이그레이션 적용 (prisma migrate deploy)
```

- 두 명령 모두 `.env.preview`의 `DATABASE_URL`·`DIRECT_URL`만 넘깁니다(`.env`의 `DIRECT_URL`이 끼어들지 않음). 첫 줄에 대상 호스트가 나오니 미리보기 브랜치인지 확인합니다.
- `db push`·`migrate dev`·`migrate reset`은 미리보기 DB에 쓰지 않습니다.
- 처음이면 지금 한 번 실행해 둡니다(3절 배포 전에).

> ⚠️ **스키마가 바뀌는 PR(`prisma/migrations/`에 새 폴더가 있는 브랜치)은 push하기 전에 `npm run db:deploy:preview`를 먼저 실행합니다.**
>
> - push하면 Vercel이 바로 Preview 배포를 만들고, 빌드에는 마이그레이션이 없습니다. 순서가 바뀌면 새 코드가 옛 스키마에 붙어 페이지가 500이 됩니다(문제 해결 표).
> - 순서: 마이그레이션 커밋 → `npm run db:deploy:preview` → `git push` → 배포 확인.
> - 미리보기 DB는 **모든 브랜치의 Preview 배포가 함께 씁니다.** 한 브랜치의 마이그레이션을 적용하면 다른 브랜치의 미리보기도 그 스키마를 보게 됩니다. 컬럼 삭제처럼 옛 코드가 깨지는 변경은 다른 미리보기를 쓰는 중이 아닌지 확인하고 적용합니다.

## 3. Vercel 가입과 저장소 불러오기

**① 가입**

- [ ] [vercel.com](https://vercel.com) → **Sign Up** → **Hobby** → **Continue with GitHub**(`zeus1560` 계정)
- [ ] GitHub 앱 권한은 **Only select repositories** → `zeus1560/yaksok`만 고릅니다

**② 저장소 불러오기**

- [ ] 대시보드 **Add New… → Project** → `yaksok` 옆 **Import**
- [ ] **Framework Preset:** `Next.js`(자동 감지)
- [ ] **Root Directory:** `./`(그대로)
- [ ] **Build and Output Settings:** 모두 기본값 그대로(Override 끔)
  - Build Command: `package.json`의 `build` 스크립트(`prisma generate && next build`)를 씁니다. Prisma Client는 이때 `prisma/generated/`에 만들어지고, 그 폴더는 Vercel 의존성 캐시(`node_modules`) 밖이라 매번 새로 생성됩니다
  - Install Command: 자동(`package-lock.json`으로 npm)
- [ ] **Environment Variables:** 이 화면에서는 넣지 말고 **Deploy**를 누릅니다. 4절에서 환경별로 넣습니다

> 📌 불러오기 직후 `main`이 **운영(Production)** 으로 한 번 배포됩니다. 운영 환경변수(`DATABASE_URL`)가 없으므로 빌드가 `DATABASE_URL이 설정되지 않았습니다` → `Failed to collect page data for /api/health`로 **실패합니다. 정상입니다** — 운영에는 아무것도 뜨지 않습니다(로컬에서 같은 조건으로 확인). 운영 주소는 공유하지 않습니다.
> 그 뒤의 `main` 병합은 `vercel.json` 설정으로 배포를 만들지 않습니다(9절).

**③ Node.js 버전**

- [ ] **Settings → Build and Deployment → Node.js Version** → `24.x`
- `package.json`의 `"engines": { "node": ">=24.0.0 <25.0.0" }`가 이 설정보다 우선합니다(Vercel 기본값 26.x를 쓰지 않음). 두 값을 같게 두면 빌드 로그에 경고가 나오지 않습니다

**④ 시스템 환경변수 노출 확인**

- [ ] **Settings → Environment Variables** 화면의 **Automatically expose System Environment Variables**(또는 「Enable access to System Environment Variables」)가 **켜져 있는지** 확인합니다
- 앱이 `VERCEL_ENV`·`VERCEL_URL`·`VERCEL_BRANCH_URL`·`VERCEL_PROJECT_PRODUCTION_URL`·`NEXT_PUBLIC_VERCEL_ENV`로 미리보기 주소를 알아냅니다(허용 Origin·초대 링크). 꺼져 있으면 미리보기에서 모든 상태 변경 요청이 403 `INVALID_ORIGIN`이 됩니다

**⑤ 함수 지역(Region)**

**저장소의 `vercel.json`이 기준입니다. 대시보드 설정은 참고입니다.**

```json
{ "regions": ["sin1"] }
```

- `vercel.json`의 `regions`는 대시보드의 **Settings → Functions → Function Region**보다 우선합니다. 그래서 대시보드에서 바꿀 필요가 없고, 대시보드 값이 달라도 배포는 `sin1`에서 돕니다. 대시보드 값은 `vercel.json`에 `regions`가 없을 때만 쓰입니다
- 함수 지역은 DB와 같거나 가장 가까운 곳으로 맞춥니다(1절 ①)
  - 지금 미리보기 DB는 AWS `ap-southeast-1`(싱가포르)입니다(DB 호스트 이름 `….ap-southeast-1.aws.neon.tech`) → Vercel **Singapore (`sin1`)**
  - Hobby는 지역을 하나만 쓸 수 있습니다. 둘 이상 적으면 배포가 빌드 전에 실패합니다
- [ ] DB 지역이 바뀌면(운영 DB를 다른 지역에 만드는 경우 등) **`vercel.json`의 `regions`를 고쳐 커밋합니다.** 대시보드만 바꾸면 반영되지 않습니다
- [ ] 값을 바꾼 뒤에는 그 커밋의 **새 배포**에서 실제 지역을 확인합니다(아래 「실제 지역 확인」). 이미 만든 배포는 만들 때의 지역 그대로입니다
- **필수입니다.** 이 설정이 없으면 새 프로젝트의 기본값인 미국 동부(`iad1`)에서 돌고, API 하나가 DB를 여러 번 오가는 동안 왕복마다 0.2초쯤이 더해집니다. 2026-11-12 첫 미리보기 배포(`regions`를 넣기 전)에서 실제로 겪었습니다:
  - `/api/health`(쿼리 1번) 약 0.45초, 화면이 5초마다 부르는 조회 API 3~5초, 가능 시간 제출이 10초를 넘겨 `@smoke` 전체 흐름이 「제출했어요.」를 기다리다 실패
  - 화면에서는 「다른 기기의 변경이 5초 안에 반영」이 지켜지지 않고, 카카오 5초 제한에도 걸립니다
- 실제 지역 확인: `npm run test:e2e:preview`가 시작할 때 `[e2e] 배포 응답: … 함수 지역 sin1 …`처럼 출력합니다. 브라우저에서는 개발자 도구 → Network → `/api/health` 응답 헤더 `x-vercel-id`가 `icn1::sin1::…`(앞 = 요청을 받은 곳, 뒤 = 함수가 돈 곳)이면 맞습니다. `icn1::iad1::…`이면 아직 미국 동부입니다

## 4. Vercel 환경변수

**Settings → Environment Variables → Add**. 변수마다 **Environments** 체크박스(Production·Preview·Development)를 아래 표대로 고릅니다. 값을 바꾼 뒤에는 **다시 배포(Redeploy)** 해야 반영됩니다(`NEXT_PUBLIC_` 값은 빌드 때 코드에 박힙니다).

| 이름                   | Preview                                                          | Production                                                                                                        | Development |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| `DATABASE_URL`         | `.env.preview`의 `DATABASE_URL`(Neon 미리보기 브랜치, `-pooler`) | **지금은 넣지 않음.** 공개 결정 뒤 운영 Neon(별도 프로젝트·브랜치)의 `-pooler` 주소                               | 넣지 않음   |
| `NEXT_PUBLIC_BASE_URL` | **넣지 않음** — 미리보기는 그 배포 주소를 자동으로 씀(R-36)      | **지금은 넣지 않음.** 공개 결정 뒤 운영 주소(예: `https://<프로젝트>.vercel.app` 또는 연결한 도메인, 끝 `/` 없이) | 넣지 않음   |

- `DIRECT_URL`은 Vercel에 넣지 않습니다(마이그레이션은 로컬에서만, 2절).
- `KAKAO_*`·`NAVER_*`는 아직 코드가 쓰지 않아 넣지 않습니다.
- `VERCEL_AUTOMATION_BYPASS_SECRET`은 5절에서 비밀값을 만들면 Vercel이 자동으로 넣습니다. 직접 추가하지 않습니다.
- **Preview에 `NEXT_PUBLIC_BASE_URL`(운영 주소)을 넣지 마세요.** 넣어도 초대 링크는 배포 주소로 만들어지지만, 미리보기가 운영 주소에서 온 요청까지 허용하게 됩니다.
- 운영 값을 넣을 때(공개 결정 뒤): 운영 DB에 `prisma migrate deploy`를 먼저 적용하고 `DATABASE_URL`·`NEXT_PUBLIC_BASE_URL`을 Production에만 넣은 뒤 Redeploy. 운영 DB로는 테스트하지 않습니다.

## 5. Deployment Protection과 보호 우회 비밀값

**① 보호 확인**

- [ ] **Settings → Deployment Protection → Vercel Authentication**이 켜져 있고 범위가 **Standard Protection**인지 확인합니다
- Standard Protection: 미리보기 주소와 배포별 주소(`*.vercel.app`)는 **Vercel에 로그인한 프로젝트 구성원만** 열 수 있습니다. 운영 도메인은 열려 있습니다
- 팀원이 미리보기를 보려면 Vercel 계정으로 로그인해야 합니다. Hobby는 구성원을 추가할 수 없으니, 필요하면 같은 화면의 공유 링크 기능을 쓰거나 화면을 공유합니다

**② 자동 테스트용 우회 비밀값 만들기**

- [ ] 같은 화면(**Settings → Deployment Protection**) 아래 **Protection Bypass for Automation** → **Add Secret**(또는 Generate) → 만들어진 값을 복사
- [ ] `.env.preview`의 `VERCEL_AUTOMATION_BYPASS_SECRET="…"`에 붙여 넣습니다
- 테스트는 이 값을 모든 요청에 `x-vercel-protection-bypass` 헤더로 보냅니다. 비밀번호처럼 다룹니다(커밋·채팅·스크린숏 금지). 새로 만들면 예전 값은 바로 무효가 되고, Vercel 쪽 변수는 다음 배포부터 바뀝니다
- 모든 플랜(Hobby 포함)에서 쓸 수 있습니다

## 6. 배포 후 확인 순서

1. [ ] 2절 마이그레이션을 미리보기 DB에 적용했는지 확인 — `npm run db:status:preview`가 「Database schema is up to date」. 스키마가 바뀌는 PR은 **push 전에** 적용합니다(2절)
2. [ ] 브랜치를 `origin`에 push → Vercel **Deployments**에 그 브랜치의 배포가 생기고 **Ready**가 되는지 봅니다
   - 배포 줄의 환경 표시가 **Preview**인지 확인합니다. **Production**으로 잡혔으면 7절을 봅니다
3. [ ] 배포를 눌러 **Build Logs**에서 확인
   - Node.js 24.x로 빌드했다(버전 경고 없음)
   - `prisma generate`가 「Generated Prisma Client」를 출력했다
   - `next build`가 오류 없이 끝났다
4. [ ] 배포 화면의 **Domains**에서 **배포 고유 주소**(`yaksok-<해시>-<계정>.vercel.app`)를 복사합니다
   - 테스트에는 브랜치 주소(`…-git-…`)가 아니라 배포 고유 주소를 씁니다. 그 배포만 가리키고 바뀌지 않기 때문입니다(이유는 8절)
   - 새 커밋을 push하면 배포와 고유 주소가 새로 생깁니다. 그때마다 6번을 다시 합니다
5. [ ] 브라우저에서 그 주소를 엽니다 → Vercel 로그인 → 홈이 보이고, `<주소>/api/health`가 `{"ok":true}`
6. [ ] `.env.preview`의 `E2E_BASE_URL`에 그 주소(끝 `/`·경로 없이)를 넣습니다
7. [ ] 배포 확인 묶음 실행 (dev 서버와 상관없음 — 로컬 서버를 띄우지 않습니다)

   ```bash
   npm run test:e2e:install                                   # 처음 한 번
   npm run test:e2e:preview -- --project=chromium-desktop     # 먼저 chromium만 (API 확인 + 전체 흐름)
   npm run test:e2e:preview                                   # 세 프로젝트 전부
   npx playwright show-report test-results/preview/e2e-report # 결과 보고서
   ```

   - 시작할 때 `<주소>/api/health`를 먼저 부릅니다. 401·403이면 보호 우회 비밀값을 확인하라는 안내와 함께 멈춥니다
   - 이어서 `[e2e] 배포 응답: /api/health …ms, 함수 지역 …`을 출력합니다. 지역이 `sin1`이 아니고 응답이 느리다는 경고(⚠)가 나오면 3절 ⑤를 먼저 확인합니다(그대로 돌리면 전체 흐름이 시간 초과로 실패할 수 있습니다)
   - 세 프로젝트 전부는 6~7분쯤 걸립니다(2026-11-12, 함수 지역이 미국 동부일 때 측정)
   - 테스트가 만든 데이터는 끝날 때 지우고, 미리보기 DB의 모든 테이블 행 수·md5가 시작 상태와 같은지 확인합니다. **테스트 중에는 같은 미리보기를 손으로 쓰지 마세요**(손으로 만든 데이터 때문에 마지막 비교가 실패합니다)
   - 묶음: 전체 흐름(세 브라우저), 운영 응답(GET no-store·상태 변경 직후 새 값·세션 쿠키 `HttpOnly`·`Secure`·`SameSite=Lax`·`Path`), 다른 Origin 거부(Origin 없음·다른 사이트·다른 Vercel 배포·같은 호스트 http·하위 도메인 → 403), 초대 링크가 배포 주소로 만들어지고 그 주소가 열림, `/api/health` 200·no-store

8. [ ] 손으로 한 번: 홈 → 새 약속 만들기 → 설정 완료 화면의 초대 링크가 **지금 연 미리보기 주소**로 시작하는지, 다른 브라우저(로그인한 Vercel 계정)에서 그 링크로 참여되는지
9. [ ] 실제 휴대폰으로 확인: [`MOBILE_CHECKLIST.md`](MOBILE_CHECKLIST.md)

## 7. 브랜치의 배포가 Production으로 잡혔을 때

2026-11-12에 겪은 일입니다. `ahn/feat-미리보기-배포` 브랜치의 **첫 배포가 Preview가 아니라 Production으로 잡혀 실패했습니다.**

- 왜 실패하나: Production 환경에는 `DATABASE_URL`을 넣지 않았습니다(4절). Production으로 잡힌 빌드는 브랜치가 무엇이든 `DATABASE_URL이 설정되지 않았습니다` → `Failed to collect page data for /api/health`로 끝납니다. 코드 문제가 아닙니다
- 고친 방법: **브랜치에 새 커밋을 push했습니다.** Git push로 생기는 배포는 `main`이 아닌 브랜치면 Preview로 만들어집니다. 바꿀 내용이 없으면 빈 커밋을 씁니다

  ```bash
  git commit --allow-empty -m "chore: Vercel 미리보기 배포 시작"
  git push
  ```

- 확인: **Deployments** 목록의 새 배포 줄에 **Preview**가 표시되고 Ready가 됩니다

> ⚠️ **Vercel 대시보드에서 직접 만든 배포가 Production으로 잡혀 실패했습니다(정확한 경로는 확인하지 못함).** 대시보드의 어느 버튼·순서가 Production으로 만드는지는 다시 확인하지 못했습니다. 그래서 미리보기는 대시보드에서 만들지 않고 **브랜치에 push해서** 만듭니다. 다시 배포해야 할 때도 빈 커밋을 push합니다.

## 8. 브랜치 이름과 미리보기 주소

Vercel은 배포마다 주소를 두 가지 만듭니다.

| 주소           | 모양                                         | 가리키는 것                            |
| -------------- | -------------------------------------------- | -------------------------------------- |
| 배포 고유 주소 | `yaksok-<해시>-<계정>.vercel.app`            | 그 배포 하나. 바뀌지 않습니다          |
| 브랜치 주소    | `yaksok-git-<브랜치 이름>-<계정>.vercel.app` | 그 브랜치 이름으로 된 주소의 최신 배포 |

**브랜치 이름의 한글은 브랜치 주소에서 지워집니다.** `ahn/feat-미리보기-배포`의 브랜치 주소는 `…-git-ahn-feat-….vercel.app`이 되었습니다(2026-11-12 확인).

- 그래서 `ahn/feat-<한글>` 형식의 브랜치는 **모두 같은 브랜치 주소(`git-ahn-feat`)를 나눠 씁니다.** 그 주소는 그런 브랜치들 가운데 마지막으로 배포된 것을 가리키므로, 내가 보려던 브랜치가 아닐 수 있습니다
- **테스트(`E2E_BASE_URL`)와 손 확인에는 배포 고유 주소를 씁니다**(6절 4번). 초대 링크도 연 주소 그대로 만들어지므로(R-36) 고유 주소로 열면 링크도 그 배포에 머뭅니다
- **앞으로 브랜치 이름은 영어로 씁니다:** `<이름>/<타입>-<영어 설명>`(예: `ahn/feat-preview-deploy`). 영어 이름은 브랜치 주소에 그대로 남아(`…-git-ahn-feat-preview-deploy-…`) 브랜치마다 주소가 따로 생깁니다. 이미 만든 한글 브랜치는 그대로 둡니다
- 주소의 첫 마디(`.vercel.app` 앞)는 63자까지입니다. 브랜치 이름이 길면 Vercel이 줄이므로 설명은 짧게 씁니다

## 9. 운영(`main`) 배포 — 지금은 꺼 둠

Production에는 DB 주소를 넣지 않았으므로(4절) `main`에 병합할 때마다 운영 빌드가 실패로 남습니다. 팀이 공개 배포를 정할 때까지 **`main`의 자동 배포를 꺼 두었습니다.** 저장소 루트의 `vercel.json`입니다.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"],
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

- `regions`는 함수 지역입니다(3절 ⑤). 운영 배포를 다시 켤 때도 그대로 둡니다

- `git.deploymentEnabled`는 「커밋이 올라와도 배포하지 않을 브랜치」를 정합니다. 적지 않은 브랜치는 기본값 `true`라 **다른 브랜치의 Preview 배포는 그대로 생깁니다**
- Vercel은 push된 커밋에 든 `vercel.json`을 읽으므로, **이 파일이 `main`에 병합된 뒤부터** `main` 배포가 멈춥니다. 어느 커밋의 파일을 읽는지는 공식 문서에 적혀 있지 않아, 처음 병합한 뒤 Deployments에 `main`의 새 Production 배포가 생기지 않는지 한 번 확인합니다(생긴다면 문제 해결 표)
- GitHub Actions CI(`.github/workflows/ci.yml`)는 Vercel과 관계없이 그대로 돕니다

**다시 켜는 방법 (팀이 공개 배포를 정한 뒤)**

1. [ ] 운영 Neon(별도 프로젝트·브랜치)에 `prisma migrate deploy`를 적용합니다(4절)
2. [ ] Vercel **Settings → Environment Variables**에 `DATABASE_URL`·`NEXT_PUBLIC_BASE_URL`을 **Production에만** 넣습니다(4절 표)
3. [ ] `vercel.json`에서 `"main": false` 줄을 지웁니다(`git` 블록이 비면 블록째 지워도 됩니다). 브랜치에서 고쳐 PR로 `main`에 병합합니다
4. [ ] 그 병합 커밋부터 `main`이 Production으로 배포됩니다. Ready와 운영 주소의 `/api/health`를 확인합니다

- 되돌리기(다시 끄기)는 3번의 줄을 되살려 병합하면 됩니다
- 다른 방법인 Ignored Build Step(대시보드 설정 또는 `vercel.json`의 `ignoreCommand`)은 쓰지 않았습니다. 건너뛴 빌드가 Canceled 배포로 계속 남고, 명령이 `deploymentEnabled` 한 줄보다 복잡합니다

## 문제 해결

| 증상                                                                | 원인과 해결                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 미리보기에서 버튼을 누르면 「다시 시도」, 응답 403 `INVALID_ORIGIN` | 시스템 환경변수 노출이 꺼짐(3절 ④) 또는 허용 목록에 없는 주소로 엶(사용자 지정 미리보기 도메인 등). 브랜치 주소나 배포별 주소로 엽니다 |
| 빌드 로그 `DATABASE_URL이 설정되지 않았습니다`                      | 그 환경(Preview·Production)에 `DATABASE_URL`이 없음(4절). 운영 첫 배포의 실패는 정상                                                   |
| `/api/health`가 503 `{"ok":false}`                                  | DB 연결 실패. Preview `DATABASE_URL` 값·Neon 브랜치 상태 확인. Function 로그(**Logs**)에는 오류 종류만 남깁니다                        |
| 페이지가 500, 로그에 테이블이 없다는 오류                           | 미리보기 DB에 마이그레이션 미적용 → `npm run db:deploy:preview`                                                                        |
| `test:e2e:preview`가 「배포 주소 … 401」로 멈춤                     | 보호 우회 비밀값이 비었거나 틀림(5절 ②). 새로 만들었다면 `.env.preview`도 바꿉니다                                                     |
| `test:e2e:preview`가 「같은 DB …를 가리켜 실행을 거부」             | `.env.preview`가 개발·e2e DB 주소. 1절의 미리보기 브랜치 주소로 바꿉니다                                                               |
| 다른 사람이 커밋한 브랜치가 배포되지 않음                           | Hobby는 커밋 작성자가 Vercel 계정 주인이어야 배포됩니다. 안의 커밋으로만 배포합니다                                                    |
| 브랜치의 배포가 **Production**으로 표시되고 빌드 실패               | 대시보드에서 직접 만든 배포이거나 첫 배포가 Production으로 잡힘. 브랜치에 새 커밋(빈 커밋 가능)을 push해 Preview로 만듭니다(7절)       |
| 미리보기가 느림(조회 3~5초), `@smoke` 전체 흐름이 시간 초과         | 함수 지역이 DB와 멂. `x-vercel-id`가 `…::iad1::…`이면 그 배포의 커밋에 `vercel.json` `regions: ["sin1"]`이 있는지 확인합니다(3절 ⑤)    |
| 브랜치 주소(`…-git-ahn-feat-…`)를 열었더니 다른 브랜치 화면         | 한글이 지워져 같은 형식의 브랜치가 주소를 나눠 씁니다(8절). 배포 고유 주소로 엽니다                                                    |
| `main`에 병합했는데 Production 배포가 또 생김(실패)                 | `main`의 `vercel.json`에 `git.deploymentEnabled.main: false`가 있는지 확인합니다(9절). 운영 주소에는 여전히 아무것도 뜨지 않습니다     |
