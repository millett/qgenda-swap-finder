#!/bin/bash
# QGenda Swap Finder - Easy Deploy Script
#
# DEPLOYMENT OPTIONS:
#
# 1. STREAMLIT CLOUD (FREE, RECOMMENDED)
#    - Push this folder to GitHub
#    - Go to https://share.streamlit.io
#    - Click "New app" and connect your GitHub repo
#    - Set main file path to: app.py
#    - Done! Your app is live.
#
# 2. LOCAL NETWORK (share with roommates/colleagues)
#    Run: ./deploy.sh local
#    This starts the app accessible to anyone on your network.
#
# 3. DOCKER (for any server)
#    Run: ./deploy.sh docker
#    Then: docker run -p 8501:8501 qgenda-swap-finder
#
# 4. RAILWAY/RENDER (one-click cloud)
#    Just push to GitHub and connect the repo.
#    Set start command to: streamlit run qgenda/app.py --server.port $PORT
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

case "${1:-help}" in
    local)
        echo "Starting QGenda Swap Finder on local network..."
        echo "Other devices can access at: http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}'):8501"
        streamlit run app.py --server.address 0.0.0.0 --server.port 8501
        ;;

    docker)
        echo "Building Docker image..."
        cat > Dockerfile <<'DOCKERFILE'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8501
HEALTHCHECK CMD curl --fail http://localhost:8501/_stcore/health
ENTRYPOINT ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
DOCKERFILE
        docker build -t qgenda-swap-finder .
        echo ""
        echo "Docker image built! Run with:"
        echo "  docker run -p 8501:8501 qgenda-swap-finder"
        ;;

    run)
        echo "Starting QGenda Swap Finder locally..."
        streamlit run app.py
        ;;

    install)
        echo "Installing dependencies..."
        pip install -r requirements.txt
        echo "Done! Run './deploy.sh run' to start the app."
        ;;

    *)
        echo "QGenda Swap Finder - Deploy Script"
        echo ""
        echo "Usage: ./deploy.sh [command]"
        echo ""
        echo "Commands:"
        echo "  install  - Install Python dependencies"
        echo "  run      - Start app locally (localhost only)"
        echo "  local    - Start app on local network (shareable)"
        echo "  docker   - Build Docker image for deployment"
        echo "  help     - Show this message"
        echo ""
        echo "For Streamlit Cloud deployment:"
        echo "  1. Push this folder to GitHub"
        echo "  2. Go to https://share.streamlit.io"
        echo "  3. Connect your repo and set app path to: app.py"
        ;;
esac
