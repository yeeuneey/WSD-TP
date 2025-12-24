# GoGoStudy API Design

## Overview
- Base URL: `http://localhost:8080`
- Auth: `Authorization: Bearer <accessToken>`
- Common error response: `{ timestamp, path, status, code, message, details }`

## Auth
- `POST /auth/register`
  - Body: `{ email, password, name }`
  - Response: `{ user, accessToken, refreshToken }`
- `POST /auth/login`
  - Body: `{ email, password }`
  - Response: `{ user, accessToken, refreshToken }`
- `POST /auth/refresh`
  - Body: `{ refreshToken }`
  - Response: `{ user, accessToken, refreshToken }`
- `POST /auth/logout`
  - Header: `Authorization: Bearer <accessToken>`
  - Body: `{ refreshToken }`
  - Response: `{ success: true }`

## Users
- `GET /users/me`
  - Header: `Authorization: Bearer <accessToken>`
  - Response: `{ user }`
- `PATCH /users/me`
  - Header: `Authorization: Bearer <accessToken>`
  - Body: `{ name }`
  - Response: `{ user }`
- `PATCH /users/me/password`
  - Header: `Authorization: Bearer <accessToken>`
  - Body: `{ currentPassword, newPassword }`
  - Response: `{ success: true }`

## Admin Users
- `GET /admin/users`
  - Header: `Authorization: Bearer <accessToken>` (ADMIN)
  - Response: `{ users }`
- `PATCH /admin/users/:id/role`
  - Header: `Authorization: Bearer <accessToken>` (ADMIN)
  - Body: `{ role: USER | ADMIN }`
  - Response: `{ user }`
- `PATCH /admin/users/:id/deactivate`
  - Header: `Authorization: Bearer <accessToken>` (ADMIN)
  - Response: `{ user }`

## Studies & Attendance
- `POST /studies`
  - Header: `Authorization: Bearer <accessToken>`
  - Body: `{ title, description, category?, maxMembers? }`
  - Response: `{ study }`
- `GET /studies`
  - Header: `Authorization: Bearer <accessToken>`
  - Query: `q?, category?, status?, page?, pageSize?`
  - Response: `{ data: Study[], page, pageSize, total }`
- `GET /studies/:studyId`
  - Header: `Authorization: Bearer <accessToken>`
  - Response: `{ study }`
- `POST /studies/:studyId/join`
  - Header: `Authorization: Bearer <accessToken>`
  - Response: `{ membership }` (status=`PENDING`; leader 승인 필요)
- `GET /studies/:studyId/members`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Query: `status?`
  - Response: `{ members }`
- `PATCH /studies/:studyId/members/:userId/status`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Body: `{ status: APPROVED | PENDING | REJECTED }` (정원 초과 시 APPROVED 불가)
  - Response: `{ membership }`
- `DELETE /studies/:studyId/members/:userId`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Response: `{ success: true }`
- `POST /studies/:studyId/members/leave`
  - Header: `Authorization: Bearer <accessToken>` (Member)
  - Response: `{ success: true }` (리더는 탈퇴 불가)
- `POST /studies/:studyId/sessions`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Body: `{ title, date }`
  - Response: `{ session }`
- `GET /studies/:studyId/sessions`
  - Header: `Authorization: Bearer <accessToken>` (Approved Member)
  - Response: `{ sessions }`
- `GET /studies/:studyId/sessions/:sessionId`
  - Header: `Authorization: Bearer <accessToken>` (Approved Member)
  - Response: `{ session }`
- `POST /studies/:studyId/sessions/:sessionId/attendance`
  - Header: `Authorization: Bearer <accessToken>` (Approved Member)
  - Body: `{ status: PRESENT | LATE | ABSENT }`
  - Response: `{ record }`
- `GET /studies/:studyId/sessions/:sessionId/attendance`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Response: `{ sessionId, records }`
- `GET /studies/:studyId/attendance/summary`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader)
  - Response: `{ studyId, summary }`
- `GET /studies/:studyId/attendance/users/:userId`
  - Header: `Authorization: Bearer <accessToken>` (Study Leader 또는 본인)
  - Response: `{ studyId, userId, totalSessions, summary }`
