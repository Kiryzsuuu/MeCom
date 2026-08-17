# WorkPulse AILO UI — Complete Web Mockup

Mockup HTML/CSS/JS lengkap untuk aplikasi manajemen project WorkPulse AILO.

## Halaman

| File | Deskripsi |
|------|-----------|
| `login.html` | Login + social auth |
| `dashboard.html` | Overview sprint, issue saya, aktivitas, tim |
| `board.html` | Kanban board (To do / In progress / In review / Done) |
| `list.html` | List view dengan group by status, sort, search |
| `stats.html` | Burndown chart, velocity, distribusi issue |
| `issue-detail.html` | Detail TEST-05 — subtasks, komentar, activity log |
| `create-issue.html` | Modal form buat issue baru |
| `my-issues.html` | Issue yang diassign ke saya, tabs aktif/review/selesai |
| `inbox.html` | Notifikasi — mention, assign, overdue |
| `settings.html` | Profil, notifikasi, keamanan, tim, billing, integrasi |

## Cara pakai

**Paling mudah — Live Server:**
1. Buka folder `WorkPulseailo` di VS Code
2. Install extension **Live Server** (Ritwick Dey)  
3. Klik kanan `index.html` → **Open with Live Server**

**Atau buka langsung:**
```
open WorkPulseailo/src/pages/login.html
```

## Navigasi

```
login → dashboard → board → issue-detail
                  → list
                  → stats
                  → create-issue
         inbox
         my-issues
         settings
```

## Stack implementasi berikutnya

```
backend/     Node.js + Express + Prisma + PostgreSQL + Socket.io
frontend/    React + Vite + TailwindCSS + dnd-kit
auth/        JWT + refresh token
deploy/      Docker + docker-compose
```

## Design system

- **Accent**: `#5B4FE8` (purple-indigo)
- **Font**: SF Pro (`-apple-system`/`SF Pro Display`/`SF Pro Text`, fallback Inter, Segoe UI)
- **Theme**: Terang (light) secara konsisten
- **Icons**: [Tabler Icons](https://tabler-icons.io/)
