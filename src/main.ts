import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
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

    // Register global exception filter
    app.useGlobalFilters(new AllExceptionsFilter());

    // Enable CORS
    const allowedOrigins = [
      'http://localhost:5173',
      'https://finance-tracker-frontend-mu.vercel.app',
      'https://finpulse.nethmihapuarachchi.com',
      process.env.FRONTEND_URL
    ].filter(Boolean);

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.warn(`⚠️ CORS blocked for origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Accept, Authorization',
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