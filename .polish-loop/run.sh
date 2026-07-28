#!/bin/sh
# Helper: run any command inside the dev PHP container with repo mounted.
exec docker run --rm -v "$PWD":/var/www/html -w /var/www/html \
  --user "$(id -u):$(id -g)" -e HOME=/tmp youtube-board-dev:latest "$@"
