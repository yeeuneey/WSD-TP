# GoGoStudy DB Schema

Prisma schema source: `prisma/schema.prisma` (PostgreSQL).

## Tables

### User
| column | type | constraints / default | notes |
| --- | --- | --- | --- |
| id | Int | PK, autoincrement | |
| email | String | unique, not null | login identifier |
| passwordHash | String | not null | hashed password |
| name | String | not null | display name |
| role | String | default `USER` | `USER`, `ADMIN` |
| status | String | default `ACTIVE` | `ACTIVE`, `INACTIVE` |
| provider | String | default `LOCAL` | `LOCAL`, `GOOGLE`, `KAKAO`, `FIREBASE` |
| providerId | String? | unique, nullable | provider-specific id |
| createdAt | DateTime | default `now()` | |
| updatedAt | DateTime | `@updatedAt` | auto-updated |

Indexes: `email` (unique), `providerId` (unique).

### Study
| column | type | constraints / default | notes |
| --- | --- | --- | --- |
| id | Int | PK, autoincrement | |
| title | String | not null | study name |
| description | String | not null | |
| category | String? | nullable | |
| maxMembers | Int? | nullable | |
| status | String | default `RECRUITING` | lifecycle state |
| leaderId | Int | FK -> User(id) | study owner |
| createdAt | DateTime | default `now()` | |

Relations: `leaderId` references `User.id` (`UserLeaderStudies` relation).

### StudyMember
| column | type | constraints / default | notes |
| --- | --- | --- | --- |
| id | Int | PK, autoincrement | |
| studyId | Int | FK -> Study(id) | |
| userId | Int | FK -> User(id) | |
| memberRole | String | default `MEMBER` | `LEADER`, `MEMBER` |
| status | String | default `APPROVED` | membership state |
| joinedAt | DateTime | default `now()` | |

Indexes: unique `(studyId, userId)` to prevent duplicates.

### AttendanceSession
| column | type | constraints / default | notes |
| --- | --- | --- | --- |
| id | Int | PK, autoincrement | |
| studyId | Int | FK -> Study(id) | |
| title | String | not null | session name |
| date | DateTime | not null | session date |
| createdAt | DateTime | default `now()` | |

### AttendanceRecord
| column | type | constraints / default | notes |
| --- | --- | --- | --- |
| id | Int | PK, autoincrement | |
| sessionId | Int | FK -> AttendanceSession(id) | |
| userId | Int | FK -> User(id) | |
| status | String | not null | `PRESENT`, `LATE`, `ABSENT` |
| recordedAt | DateTime | default `now()` | |

## Relationships (ERD, text)
- User 1 --- N Study (leader)
- User 1 --- N StudyMember
- Study 1 --- N StudyMember
- Study 1 --- N AttendanceSession
- AttendanceSession 1 --- N AttendanceRecord
- User 1 --- N AttendanceRecord
