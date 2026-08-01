FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci --production
EXPOSE 3000
CMD ["node", "src/app.js"]
