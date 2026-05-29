#!/bin/bash
set -e

# ==============================================================================
# DAT GCP Cloud Run Deployment Script
# ==============================================================================
# This script builds and deploys the DAT GitHub App to Google Cloud Run.
# Prerequisites: 
# 1. Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install
# 2. Run: gcloud auth login
# 3. Run: gcloud config set project YOUR_PROJECT_ID
# ==============================================================================

SERVICE_NAME="dat-github-app"
REGION="us-central1" # Change to your preferred region

echo "🚀 Initiating Google Cloud Run deployment for DAT..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI could not be found. Please install it first."
    exit 1
fi

PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: GCP Project ID is not set. Run 'gcloud config set project YOUR_PROJECT_ID'"
    exit 1
fi

echo "📦 Building and pushing container image via Google Cloud Build..."
# We use Cloud Build to build the image remotely so we don't need local Docker
IMAGE_URI="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"
gcloud builds submit --tag $IMAGE_URI .

echo "☁️  Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_URI \
  --platform managed \
  --region $REGION \
  --no-allow-unauthenticated \
  --port 8080 \
  --update-env-vars WEBHOOK_SECRET="replace-me-in-gcp-console",APP_ID="replace-me"

echo "✅ Deployment complete!"
echo "⚠️  IMPORTANT: Please go to the GCP Console -> Cloud Run -> $SERVICE_NAME"
echo "   and securely set your GEMINI_API_KEY, PRIVATE_KEY, APP_ID, and WEBHOOK_SECRET in the 'Variables & Secrets' tab."
