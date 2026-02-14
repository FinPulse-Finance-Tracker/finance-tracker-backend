import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
    constructor(private prisma: PrismaService) { }

    // Create new expense
    async create(userId: string, createExpenseDto: CreateExpenseDto) {
        return this.prisma.expense.create({
            data: {
                ...createExpenseDto,
                date: new Date(createExpenseDto.date),
                userId,
            },
            include: {
                category: true,
            },
        });
    }

    // Get all user expenses with optional filters
    async findAll(
        userId: string,
        categoryId?: string,
        startDate?: string,
        endDate?: string,
    ) {
        const where: any = { userId };

        if (categoryId) {
            where.categoryId = categoryId;
        }

        if (startDate || endDate) {
            where.date = {};
            if (startDate) {
                where.date.gte = new Date(startDate);
            }
            if (endDate) {
                where.date.lte = new Date(endDate);
            }
        }

        return this.prisma.expense.findMany({
            where,
            include: {
                category: true,
            },
            orderBy: {
                date: 'desc',
            },
        });
    }

    // Get single expense
    async findOne(id: string, userId: string) {
        const expense = await this.prisma.expense.findUnique({
            where: { id },
            include: {
                category: true,
            },
        });

        if (!expense) {
            throw new NotFoundException('Expense not found');
        }

        // Ensure user owns this expense
        if (expense.userId !== userId) {
            throw new ForbiddenException('You do not have access to this expense');
        }

        return expense;
    }

    // Update expense
    async update(id: string, userId: string, updateExpenseDto: UpdateExpenseDto) {
        await this.findOne(id, userId); // Check ownership

        const data: any = { ...updateExpenseDto };
        if (updateExpenseDto.date) {
            data.date = new Date(updateExpenseDto.date);
        }

        return this.prisma.expense.update({
            where: { id },
            data,
            include: {
                category: true,
            },
        });
    }

    // Delete expense
    async remove(id: string, userId: string) {
        await this.findOne(id, userId); // Check ownership

        return this.prisma.expense.delete({
            where: { id },
        });
    }

    // Get spending statistics
    async getStats(userId: string, startDate?: string, endDate?: string) {
        const where: any = { userId };

        if (startDate || endDate) {
            where.date = {};
            if (startDate) {
                where.date.gte = new Date(startDate);
            }
            if (endDate) {
                where.date.lte = new Date(endDate);
            }
        }

        const expenses = await this.prisma.expense.findMany({
            where,
            include: {
                category: true,
            },
        });

        // Calculate total - convert Decimal to number
        const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

        // Calculate by category
        const byCategory = expenses.reduce((acc, expense) => {
            if (!expense.category) return acc; // Skip if no category

            const categoryName = expense.category.name;
            if (!acc[categoryName]) {
                acc[categoryName] = {
                    total: 0,
                    count: 0,
                    color: expense.category.color,
                };
            }
            acc[categoryName].total += Number(expense.amount); // Convert Decimal to number
            acc[categoryName].count += 1;
            return acc;
        }, {} as Record<string, { total: number; count: number; color: string | null }>);

        return {
            total,
            count: expenses.length,
            byCategory,
            expenses: expenses.slice(0, 5), // Recent 5 expenses
        };
    }
}
