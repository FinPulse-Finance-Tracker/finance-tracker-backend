import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BudgetsModule } from './budgets/budgets.module';
import { GmailModule } from './gmail/gmail.module';
import { SmsModule } from './sms/sms.module';
import { ReceiptModule } from './receipt/receipt.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FeedbackModule } from './feedback/feedback.module';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: 30000, // 30 seconds default TTL to prevent stale data
    }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ExpensesModule,
    BudgetsModule,
    GmailModule,
    SmsModule,
    ReceiptModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
