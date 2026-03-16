import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BudgetsModule } from './budgets/budgets.module';
import { GmailModule } from './gmail/gmail.module';
import { SmsModule } from './sms/sms.module';
import { ReceiptModule } from './receipt/receipt.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ExpensesModule,
    BudgetsModule,
    GmailModule,
    SmsModule,
    ReceiptModule,
  ],
})
export class AppModule { }
