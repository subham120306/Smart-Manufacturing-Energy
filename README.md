# Smart Manufacturing Energy — Django Dashboard

Industrial Energy Intelligence Platform built with Django + SQLite backend.

## Quick Start

```bash
# Install Django (only dependency)
pip install django

# Run database migrations (first time only)
python manage.py migrate

# Start the server
python manage.py runserver
```

Open **http://127.0.0.1:8000/** in your browser.

## Project Structure

```
Smart-Manufacturing-Energy/
├── manage.py                   ← Django entry point
├── db.sqlite3                  ← SQLite database (auto-created)
├── requirements.txt
├── sme_project/                ← Django project settings
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── dashboard/                  ← Main app
│   ├── models.py               ← UserProfile model
│   ├── views.py                ← login, register, logout, dashboard
│   ├── urls.py
│   ├── admin.py
│   └── templates/dashboard/
│       ├── auth.html           ← Login / Register page
│       └── index.html          ← 7-tab energy dashboard
└── static/
    ├── css/styles.css          ← Terracotta & Charcoal theme
    └── js/
        ├── app.bundle.js       ← Full analytics engine (92 KB)
        └── chart.min.js        ← Chart.js (local)
```

## Features

- **7-Tab Dashboard**: Today, Machines, Energy & Bill, Schedule, Carbon Twin, Savings Plan, Data Setup
- **Live Simulated Telemetry**: 6 machines (M1–M6), 72-hour rolling window
- **ToU Tariff Engine**: Peak / Normal / Off-peak DISCOM billing
- **Predictive Maintenance**: Health scores + failure forecasting
- **Carbon Accounting**: GHG Protocol Scope 1 & 2
- **BEE Benchmarking**: SEC norms for Indian SME industrial units
- **AI Autopilot**: Dispatch simulator with savings projections
- **ISO 50001 Audit Report**: Printable PDF export
- **Backend**: Django + SQLite — user registration, login, logout, admin panel

