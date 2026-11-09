# 🗺️ Academic Showcase API Endpoints Specifications

All endpoints are prefixed with `/api/v1`.

## 🔒 Security

- **Authentication**: JWT (HS256) via `Authorization: Bearer <token>` header
- **Roles**: `STUDENT`, `ADMIN`, `COORDENADOR`
- **CORS**: Configurable via `CORS_ORIGIN` environment variable
- **Security Headers**: HSTS, CSP, X-Frame-Options, X-Content-Type-Options

## 🟢 Projects Domain

### 1. List Projects (Public)
- **Route**: `GET /api/v1/projects`
- **Auth**: None
- **Query Parameters**:
  - `courseId`: `string` (optional, UUID filter)
  - `isFeatured`: `string` (optional, "true" | "false")
  - `page`: `string` (optional, default: "1")
  - `limit`: `string` (optional, default: "12")
- **Responses**:
  - `200 OK`: Returns paginated approved projects
  - `400 Bad Request`: Invalid query parameters

### 2. Create Project
- **Route**: `POST /api/v1/projects`
- **Auth**: Required (JWT + any role)
- **Request Body (JSON)**:
  - `title`: `string` (required, min 5, max 100 chars)
  - `shortDescription`: `string` (required, min 10, max 255 chars)
  - `description`: `string` (required, min 20 chars)
  - `thumbnailUrl`: `string` (optional, valid URL)
  - `courseId`: `string` (required, UUID)
  - `membersIds`: `array` of `string` (required, UUIDs)
- **Responses**:
  - `201 Created`: Returns created project with status `PENDING_REVIEW`
  - `401 Unauthorized`: Invalid or missing token
  - `422 Unprocessable Entity`: Schema validation failure

### 3. Increment View Count
- **Route**: `PATCH /api/v1/projects/:id/view`
- **Auth**: None
- **Path Parameters**:
  - `id`: `string` (required, UUID)
- **Responses**:
  - `200 OK`: Returns updated view count

### 4. Toggle Like
- **Route**: `POST /api/v1/projects/:id/like`
- **Auth**: Required (JWT)
- **Path Parameters**:
  - `id`: `string` (required, UUID)
- **Responses**:
  - `200 OK`: Returns `{ liked: boolean }`
  - `401 Unauthorized`: Invalid or missing token

### 5. Moderate Project Status
- **Route**: `PATCH /api/v1/projects/:id/status`
- **Auth**: Required (JWT - ADMIN or COORDENADOR)
- **Path Parameters**:
  - `id`: `string` (required, UUID)
- **Request Body (JSON)**:
  - `status`: `enum` (`APPROVED`, `REJECTED`, `PENDING_REVIEW`, `DRAFT`)
  - `isFeatured`: `boolean` (optional)
- **Responses**:
  - `200 OK`: Returns updated project
  - `401 Unauthorized`: Invalid or missing token
  - `403 Forbidden`: User does not have permission

### 6. Update Project Content & Team Photos (Curation)
- **Route**: `PATCH /api/v1/projects/:id/content`
- **Auth**: Required (JWT - ADMIN, COORDENADOR, or project creator)
- **Request Body (JSON)**:
  - `title`, `shortDescription`, `description`, `submitterName`, `submitterEmail`, `courseId`, `semesterId`, `className`, `tags`, `liveUrl`, `prototypeUrl`, `repositoryUrl`
  - `submitterAvatarUrl`: `string | null` (optional)
  - `submitterAvatarColor`: `string` (optional, hex `#RRGGBB`)
  - `submitterAvatarUpload`: `{ key: string, token: string }` (optional, direct R2 upload reference)
  - `thumbnailUpload`: `{ key: string, token: string }` (optional, direct R2 upload reference)
  - `contributors`: `array` of `{ name, email?, roleInfo?, avatarUrl?, avatarColor?, avatarUpload? }` (optional)

### 7. Authorize Direct Project Media Uploads
- **Route**: `POST /api/v1/projects/:id/uploads/authorize`
- **Auth**: Required (JWT - ADMIN, COORDENADOR, or project creator)
- **Request Body (JSON)**:
  - `files`: `array` of `{ id, kind: "THUMBNAIL" | "SUBMITTER_AVATAR" | "CONTRIBUTOR_AVATAR" | "PRESENTATION_PDF", contentType, size }`

### 8. Upload Project Avatar (Fallback / Direct Multipart)
- **Route**: `POST /api/v1/projects/:id/avatar`
- **Auth**: Required (JWT - ADMIN, COORDENADOR, or project creator)
- **Request Body (`multipart/form-data`)**:
  - `file`: JPEG, PNG, or WebP image (<= 2 MB)

## 📊 Response Formats

### Success Response
```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 12,
    "totalPages": 9
  }
}
```

### Error Response
```json
{
  "error": "Error Type",
  "message": "Error message"
}
```

## 🏗️ Database Models

### User
- `id`: UUID (primary key)
- `name`: String
- `email`: String (unique)
- `password`: String (hashed)
- `role`: Enum (STUDENT, ADMIN, COORDENADOR)
- `courseId`: UUID (foreign key, optional)

### Course
- `id`: UUID (primary key)
- `name`: String (unique)
- `description`: String (optional)

### Project
- `id`: UUID (primary key)
- `title`: String
- `shortDescription`: String
- `description`: Text
- `thumbnailUrl`: String (optional)
- `status`: Enum (DRAFT, PENDING_REVIEW, APPROVED, REJECTED)
- `isFeatured`: Boolean
- `viewsCount`: Integer (default: 0)
- `courseId`: UUID (foreign key)

### ProjectMember
- `projectId`: UUID (foreign key)
- `userId`: UUID (foreign key)
- `roleInfo`: String (optional)

### Like
- `userId`: UUID (foreign key)
- `projectId`: UUID (foreign key)