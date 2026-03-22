FROM node:18-alpine
WORKDIR /app
COPY package.json .
COPY index.mjs .
RUN npm install --production || true
CMD ["node","index.mjs"]
