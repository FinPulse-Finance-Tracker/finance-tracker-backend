import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [PrismaModule, AuthModule, ConfigModule],
    controllers: [BudgetsController],
    providers: [BudgetsService],
    exports: [BudgetsService],
})
export class BudgetsModule { }
