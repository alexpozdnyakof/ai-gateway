// Расширяем Express.Request контекстом аутентификации.
// Подхватывается через include: ["src/**/*"] в tsconfig.
import "express";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        apiKeyId: string;
        email: string;
      };
    }
  }
}
