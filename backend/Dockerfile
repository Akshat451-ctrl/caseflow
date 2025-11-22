FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Remove local .env file from image to ensure platform/runtime env vars (docker-compose / Render) are used
RUN rm -f .env || true

EXPOSE 5000

CMD ["npm", "run", "dev"]