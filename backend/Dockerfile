FROM node:20-bullseye

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends mlt melt ffmpeg frei0r-plugins \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
