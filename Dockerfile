FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

ENV PORT=3000
ENV DEMO_MODE=true
ENV SOLANA_RPC_URL=https://api.devnet.solana.com

EXPOSE 3000

CMD ["node", "dist/index.js"]
