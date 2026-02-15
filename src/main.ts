import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express from 'express';

const expressApp = express();
let cachedApp;

async function bootstrap() {
  if (!cachedApp) {
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
    cachedApp = app;
  }

  return cachedApp;
}

// Vercel serverless handler - THIS IS THE KEY
module.exports = async (req, res) => {
  await bootstrap();
  return expressApp(req, res);
};

// Named export for Vercel
module.exports.default = module.exports;

// For local development
if (require.main === module) {
  bootstrap().then(() => {
    expressApp.listen(3000, () => {
      console.log('Server running on http://localhost:3000');
    });
  });
}