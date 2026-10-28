# Synch Server for Home Assistant OS

Synch의 Node.js 셀프호스팅 서버를 HAOS App으로 실행하는 패키지입니다.
SQLite와 로컬 디스크 저장소를 사용하며 별도 DB/S3 서버가 필요하지 않습니다.
웹 화면, HTTP API, WebSocket 동기화가 모두 같은 포트 `8787`을 사용합니다.

**0.1.0 실험 버전.** 실제 HAOS 설치와 ARM 실행은 추가 확인이 필요합니다.
이 패키지는 Osync와 별개의 서버입니다. 기존 Osync 볼트/DB를 직접 가져오지 않습니다.

## 설치

Home Assistant의 **설정 → 앱 → 앱 스토어 → ⋮ → 저장소**에 다음 주소를 추가하고
**Synch Server**를 설치하세요.

```text
https://github.com/ik1022/ha-synch-app
```

사전 빌드 이미지는 제공하지 않으며 설치 과정에서 원본 소스를 다운로드하고 빌드합니다.

App 설정 예시:

```yaml
public_url: http://192.168.45.62:8787
allowed_emails:
  - you@example.com
request_timeout_ms: 300000
```

자신의 이메일을 입력하고 시작한 다음 **웹 UI 열기**로 계정을 생성합니다.
Obsidian의 **Synch** 플러그인 설정 → **Self-hosted server**에 같은 URL을 저장합니다.
다른 호스트 포트로 매핑했다면 `public_url`에도 해당 포트를 사용하세요.

HTTPS 프록시를 사용하면 `public_url`에 HTTPS 도메인을 넣습니다.
웹 UI 버튼은 직접 HTTP 포트를 여므로 프록시 환경에서는 해당 HTTPS 주소로 직접 접속하세요.
Ingress/HA 사이드바 내장 화면은 포함하지 않습니다.

자세한 내용은 [설치 문서](synch/DOCS.md)를 참고하세요.

## 구성과 검증

- 원본: [hjinco/synch](https://github.com/hjinco/synch), MIT
- 고정 원본 커밋: `446188f24bb212806b33c43fc8c55e4fae6960ff`
- Node.js 24 / Debian Bookworm. 원본 Docker 빌드 절차와 pnpm lockfile 사용
- 최초 실행 시 독립 인증 키 두 개 생성, 재시작·백업 시 보존
- 서버는 UID/GID 1000으로 실행하며 Home Assistant API 권한을 요청하지 않음
- `/data/synch`에 DB·볼트·파일 보관, `/data/synch-secrets.json`에 인증 키 보관
- `backup: cold`로 서버를 멈춘 상태에서 백업

```sh
node --test tests/launcher.test.mjs
docker build --build-arg BUILD_ARCH=amd64 -t synch-ha:0.1.0-test synch
python3 tests/smoke.py synch-ha:0.1.0-test
```

검증 결과는 [VALIDATION.md](VALIDATION.md)에 기록합니다. 테스트는 전용 임시 컨테이너와
볼륨을 만들고 종료 시 제거합니다. CI는 빌드·테스트만 하며 이미지는 게시하지 않습니다.

참고: [Synch 공식 Docker 가이드](https://synch.run/ko/self-hosting-docker/).
