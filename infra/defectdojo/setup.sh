#!/bin/bash
set -e

echo "🚀 Fetching official DefectDojo Docker Compose repository..."
if [ -d "django-DefectDojo" ]; then
    echo "✔ django-DefectDojo repository directory already exists. Skipping clone."
else
    git clone https://github.com/DefectDojo/django-DefectDojo.git
fi

cd django-DefectDojo

echo "✅ Repository set up successfully."
echo ""
echo "To start DefectDojo locally, run the following commands:"
echo "  cd django-DefectDojo"
echo "  ./dc-build.sh"
echo "  ./dc-up-d.sh postgres-redis"
echo ""
echo "Once started, the application will be available at http://localhost:8080"
echo "Default credentials will be generated and printed in the docker logs."
