# YouTube Machine — bulut serverida (VPS) ishlatish uchun.
# Qurish:   docker build -t youtube-machine .
# Ishlatish: docker compose up -d   (docker-compose.yml ga qarang)
FROM node:22-bookworm-slim

# ffmpeg + lotin va arab yozuvi uchun shriftlar (subtitrlar shu shriftlar bilan chiziladi)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fonts-noto-core fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=4300 \
    YTM_DATA_DIR=/data
VOLUME /data
EXPOSE 4300
CMD ["node", "server.js"]
