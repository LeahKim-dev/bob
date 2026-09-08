# 학원 밥집 수첩

GitHub Pages + Kakao Maps + Supabase Auth/PostgreSQL/RLS 구조입니다.

## 1. Supabase DB 만들기

Supabase 프로젝트를 만든 뒤 SQL Editor에서 `supabase.sql` 전체를 실행합니다.

## 2. 관리자 계정 만들기

웹에서 이메일/비밀번호로 회원가입한 뒤 Supabase SQL Editor에서:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and u.email = '관리자이메일@example.com';
```

## 3. 키 입력

`app.js`의 다음 3곳을 입력합니다.

```js
const KAKAO_JS_KEY = '카카오 JavaScript 키';
const SUPABASE_URL = 'Supabase Project URL';
const SUPABASE_PUBLISHABLE_KEY = 'Supabase Publishable Key';
```

Supabase의 `service_role` 또는 secret key는 절대 넣지 않습니다.

## 4. 학원 위치

`app.js`의 `ACADEMY`에 학원 좌표를 입력하면 처음 지도 중심을 학원으로 잡을 수 있습니다.

```js
const ACADEMY = { name: '학원', lat: 36.000000, lng: 127.000000 };
```

## 5. Kakao Developers

GitHub Pages로 배포할 주소를 Kakao Developers의 JavaScript SDK 허용 도메인에 등록합니다.

## 6. GitHub Pages

4개 파일을 같은 폴더에 넣고 GitHub 저장소에 올린 뒤 Pages에서 배포합니다.

### 보안

- Kakao JavaScript Key: 브라우저용 키라 공개 가능
- Supabase Publishable/anon Key: RLS가 올바르게 설정된 경우 프론트엔드 공개 가능
- Supabase service_role/secret Key: 절대 프론트엔드에 넣지 않음
- 식당 CRUD: DB RLS에서 관리자만 허용

