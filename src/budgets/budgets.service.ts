import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetBudgetDto } from './dto/set-budget.dto';

@Injectable()
export class BudgetsService {
    constructor(private prisma: PrismaService) { }

    async setBudget(userId: string, dto: SetBudgetDto) {
        // Verify category exists
        const category = await this.prisma.category.findUnique({
            where: { id: dto.categoryId },
        });

        if (!category) {
            throw new NotFoundException('Category not found');
        }

        // Upsert budget (create if new, update if exists)
        // We assume 1 budget per category per user for the 'monthly' period for now
        // The unique constraint in schema is @@index([userId, period]), not unique on [userId, categoryId]
        // But logic should enforce one active budget per category.
        // Actually, let's check if there's an existing budget for this category & user.

        const existingBudget = await this.prisma.budget.findFirst({
            where: {
                userId,
                categoryId: dto.categoryId,
                period: dto.period || 'monthly',
            },
        });

        const startDate = new Date();
        startDate.setDate(1); // Start of this month

        if (existingBudget) {
            return this.prisma.budget.update({
                where: { id: existingBudget.id },
                data: {
                    amount: dto.amount,
                },
            });
        } else {
            return this.prisma.budget.create({
                data: {
                    userId,
                    categoryId: dto.categoryId,
                    amount: dto.amount,
                    period: dto.period || 'monthly',
                    startDate: startDate,
                },
            });
        }
    }
}
