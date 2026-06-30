import { PrismaClient } from "@prisma/client";

// Singleton do Prisma. Em dev o hot-reload recria módulos; sem isso
// abriríamos uma conexão nova a cada reload e estouraria o pool.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
