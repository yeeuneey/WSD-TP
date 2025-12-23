FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json prisma ./
RUN npm install

COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# prisma 폴더가 빌드 결과물에 필요하므로 컨텍스트에서 직접 복사
COPY prisma ./prisma
# docs 정적 파일 포함
COPY docs ./docs
# Prisma Client 결과물 복사
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 8080

CMD ["node", "dist/server.js"]
