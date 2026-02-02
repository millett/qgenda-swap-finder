# QGenda Swap Finder

A Streamlit app for finding shift swap candidates for anesthesia residents.

## Features

- **My Schedule Dashboard** - View upcoming shifts at a glance
- **Golden Weekends** - Find weekends where you and friends are off
- **Trip Planner** - Find coverage for vacation trips
- **Weekend Swap** - Find weekend swap candidates with ease ratings
- **Who's Free** - Check availability on specific dates
- **Friends List** - Manage preferred swap partners
- **Swap Ledger** - Track who owes whom

## Quick Start

```bash
# Install dependencies
./deploy.sh install

# Run locally
./deploy.sh run
```

## Deploy to the Web

### Option 1: Streamlit Cloud (Free, Recommended)

1. Push this folder to GitHub
2. Go to [share.streamlit.io](https://share.streamlit.io)
3. Click "New app"
4. Connect your GitHub repo
5. Set main file path to: `app.py`
6. Click Deploy!

Your app will be live at `https://your-app.streamlit.app`

### Option 2: Share on Local Network

```bash
./deploy.sh local
```

Anyone on your WiFi can access the app.

### Option 3: Docker

```bash
./deploy.sh docker
docker run -p 8501:8501 qgenda-swap-finder
```

### Option 4: Railway/Render/Fly.io

Push to GitHub, connect the repo, and set:
- Start command: `streamlit run app.py --server.port $PORT`

## Usage

1. Export your schedule from QGenda as Excel (.xlsx)
2. Upload it in the app sidebar
3. Set your name (as it appears in QGenda)
4. Use the tabs to find swaps!

## Files

- `app.py` - Main Streamlit application
- `swap_finder.py` - Core swap-finding logic
- `friends.json` - Your friends list (auto-created)
- `swap_ledger.json` - Debt tracking (auto-created)
