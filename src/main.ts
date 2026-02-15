import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express from 'express';

// Create express instance
const expressApp = express();
let isAppInitialized = false;

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  // Enable validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  await app.init();
  isAppInitialized = true;

  return app;
}

// For Vercel serverless
export default async (req, res) => {
  if (!isAppInitialized) {
    await bootstrap();
  }
  return expressApp(req, res);
};

// For local development
if (require.main === module) {
  bootstrap().then(() => {
    expressApp.listen(3000, () => {
      console.log('Server running on http://localhost:3000');
    });
  });
}