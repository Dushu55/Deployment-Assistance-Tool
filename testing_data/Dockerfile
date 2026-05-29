FROM ubuntu:latest
# Missing maintainer/user, using latest tag

# Installing packages without clean
RUN apt-get update && apt-get install python3

# Hardcoded password
ENV DATABASE_PASSWORD="super-secret-password-123"

# Missing USER instruction, runs as root
CMD ["python3", "-m", "http.server"]
