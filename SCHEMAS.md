# VISPL Tracker - Database Schemas

## Tables

### users
| Column     | Type    | Constraints                                    |
|------------|---------|------------------------------------------------|
| id         | INTEGER | PRIMARY KEY AUTOINCREMENT                      |
| name       | TEXT    | NOT NULL                                       |
| email      | TEXT    | UNIQUE NOT NULL                                |
| password   | TEXT    | NOT NULL (bcrypt hashed)                       |
| role       | TEXT    | NOT NULL DEFAULT 'employee' CHECK(employee/admin) |
| is_online  | INTEGER | DEFAULT 0                                      |
| created_at | TEXT    | DEFAULT datetime('now')                        |

### locations
| Column      | Type    | Constraints                        |
|-------------|---------|-------------------------------------|
| id          | INTEGER | PRIMARY KEY AUTOINCREMENT           |
| user_id     | INTEGER | NOT NULL, FK -> users(id)           |
| latitude    | REAL    | NOT NULL                            |
| longitude   | REAL    | NOT NULL                            |
| recorded_at | TEXT    | NOT NULL (ISO timestamp from device)|
| synced_at   | TEXT    | DEFAULT datetime('now')             |

**Index:** `idx_locations_user_date` on (user_id, recorded_at)

### activity_logs
| Column       | Type    | Constraints                          |
|--------------|---------|---------------------------------------|
| id           | INTEGER | PRIMARY KEY AUTOINCREMENT             |
| user_id      | INTEGER | NOT NULL, FK -> users(id)             |
| latitude     | REAL    | NOT NULL                              |
| longitude    | REAL    | NOT NULL                              |
| description  | TEXT    | NOT NULL (user-entered activity text) |
| triggered_at | TEXT    | NOT NULL (when idle was detected)     |
| created_at   | TEXT    | DEFAULT datetime('now')               |

**Index:** `idx_activity_user_date` on (user_id, triggered_at)

### login_logs
| Column      | Type    | Constraints              |
|-------------|---------|--------------------------|
| id          | INTEGER | PRIMARY KEY AUTOINCREMENT|
| user_id     | INTEGER | NOT NULL, FK -> users(id)|
| login_time  | TEXT    | DEFAULT datetime('now')  |
| logout_time | TEXT    | NULL until logout        |

## API Endpoints

### Auth (`/api/auth`)
- `POST /register` - Register new user (name, email, password, role)
- `POST /login` - Login (email, password) -> returns JWT token
- `POST /logout` - Logout (sets is_online=0, records logout_time)
- `GET /me` - Get current user info + login time

### Locations (`/api/locations`) - Requires Auth
- `POST /sync` - Batch sync locations from device cache
- `GET /today` - Get today's breadcrumb path
- `GET /history/:date` - Get path for a specific date (YYYY-MM-DD)

### Activities (`/api/activities`) - Requires Auth
- `POST /` - Log an activity (idle stop entry)
- `GET /today` - Get today's activity logs
- `GET /history/:date` - Get activities for a specific date

### Admin (`/api/admin`) - Requires Auth + Admin Role
- `GET /employees` - List all employees
- `GET /live` - Get all online employees with latest location
- `GET /employee/:userId/locations/:date` - Employee's path for a date
- `GET /employee/:userId/activities/:date` - Employee's activities for a date

## WebSocket Events
- **Client -> Server:** `location-update` { latitude, longitude, timestamp }
- **Server -> Admin:** `employee-location` { userId, name, latitude, longitude, timestamp }
