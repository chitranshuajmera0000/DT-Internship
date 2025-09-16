# DT-Internship Task 1 - Events API

This repository contains a small Express.js API for managing "event" documents in MongoDB using the native `mongodb` driver (no Mongoose). It's implemented to match the assignment's API table and supports multipart file uploads for an event image.

## Features
- Use native `mongodb` driver (no mongoose)
- Endpoints under `/api/v3/app/events`
- Support for fetching by id, fetching latest (with pagination), creating, updating, and deleting events
- Accepts `files[image]` upload (stored in `uploads/`) via `multer`
- Duplicate-checker (prevents creating/updating events with same `name` + `schedule`)

## Files of interest
- `server.js` - main Express app and API endpoints
- `db.js` - MongoDB connection helper
# DT-Internship — Events API

Clean, minimal API for managing event documents in MongoDB using the native `mongodb` driver.

This project implements the CRUD endpoints specified in the task and supports image upload for events via `multer`.

## Quick start

1. Install dependencies and copy env file:

```powershell
cd e:\COURSE\PROJECTS\DT-INTERNSHIP\task-1
npm install
copy .env.example .env
# edit .env and set MONGODB_URI
```

2. Run the server:

```powershell
npm start
# or during development:
# npx nodemon server.js
```

The server listens on http://localhost:3000 by default (or the `PORT` you set in `.env`).

## Endpoints
Base path: `/api/v3/app/events`

- GET event by id
  - GET `/api/v3/app/events?id=:eventId`
  - Returns 200 with event JSON, 400 for invalid id, 404 if not found.

- GET latest events (paginated)
  - GET `/api/v3/app/events?type=latest&limit=5&page=1`
  - `type=latest` activates sorting by `schedule` descending.
  - `limit` (default 5), `page` (default 1).

- POST create event (multipart/form-data)
  - POST `/api/v3/app/events`
  - Form fields : `name`, `tagline`, `schedule` (ISO date), `description`, `moderator`, `category`, `sub_category`, `rigor_rank`.
  - Optional file field (type=File): `files[image]`
  - Returns 201 and `{ message, eventId }`. Returns 409 if a duplicate (same `name` + `schedule`) exists.

  - NOTE: The server uses a flexible data model and relaxed validation. Currently the POST endpoint requires a minimal set of fields: `name` and `schedule`. Other fields are optional and will be accepted if provided. The server also normalizes common aliases (e.g. `subCategory` or `sub_category`, `rigorRank` or `rigor_rank`) and coerces `rigor_rank` to a number when sent as a string.

- PUT update event
  - PUT `/api/v3/app/events/:id`
  - Accepts the same fields as POST. Attach `files[image]` to replace/add image.
  - Returns 200 on success, 404 if no such event, 409 if update would create a duplicate.

- DELETE event
  - DELETE `/api/v3/app/events/:id`
  - Returns 200 on success, 404 if not found.

## Data model (flexible)
No fixed schema is enforced (we use the native driver). Typical event fields used by the app:

- `_id` (ObjectId)
- `name`, `tagline`, `description` (strings)
- `schedule` (ISO date string or Date)
- `moderator` (string or numeric id)
- `category`, `sub_category` (strings)
- `rigor_rank` (integer)
- `attendees` (array of user ids)
- `files.image` (string path to uploaded image, e.g. `/uploads/filename.jpg`)

The server uses `name + schedule` to detect duplicates and returns `409 Conflict` when a duplicate is attempted.

## File uploads
- Uploaded files are stored in the `uploads/` directory and served at `/uploads/<filename>`.
- `uploads/` is included in `.gitignore`.

## Troubleshooting & tips
- Multer `Unexpected field` — ensure your multipart form uses the exact file field name `files[image]`.
- If you prefer a simpler field name, update the route middleware to `upload.single('image')` and send the file as `image`.
- Normalize `schedule` to a Date before insert/update if you want consistent behavior across documents.

## Next improvements (optional)
- Add multer `fileFilter` and `limits` to validate uploaded file types and sizes.
- Remove or replace old uploaded images on update/delete to avoid orphan files.
- Add lightweight tests for the duplicate-check helper.

## License
MIT
