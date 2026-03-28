import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
    private readonly logger = new Logger(ExpensesService.name);
    constructor(private prisma: PrismaService) { }

    // Create new expense
    async create(userId: string, createExpenseDto: CreateExpenseDto) {
        const { date, amount, ...rest } = createExpenseDto;

        const data: any = {
            ...rest,
            amount,
            date: new Date(date),
            userId,
        };

        return this.prisma.expense.create({
            data,
            include: {
                category: true,
            },
        });
    }

    // Get all user expenses with optional filters and pagination
    async findAll(
        userId: string,
        categoryId?: string,
        startDate?: string,
        endDate?: string,
        page: number = 1,
        limit: number = 200, // Client defaults to this for local filtering
    ) {
        try {
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
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    where.date.lte = end;
                }
            }

            const skip = (page - 1) * limit;

            const [expenses, total] = await Promise.all([
                this.prisma.expense.findMany({
                    where,
                    include: {
                        category: true,
                    },
                    orderBy: {
                        date: 'desc',
                    },
                    take: limit,
                    skip,
                }),
                this.prisma.expense.count({ where }),
            ]);

            return {
                data: expenses,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            this.logger.error(`❌ Error in findAll for user ${userId}:`, error.message);
            throw error;
        }
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
        const currentExpense = await this.findOne(id, userId);

        const { date, ...rest } = updateExpenseDto;
        const data: any = { ...rest };

        if (date) {
            data.date = new Date(date);
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
        await this.findOne(id, userId);

        return this.prisma.expense.delete({
            where: { id },
        });
    }

    // Get spending statistics using DB-level aggregation
    async getStats(userId: string, startDate?: string, endDate?: string) {
        try {
            const where: any = { userId };

            if (startDate || endDate) {
                where.date = {};
                if (startDate) {
                    where.date.gte = new Date(startDate);
                }
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    where.date.lte = end;
                }
            }

            const [totals, byCategoryRaw, recentExpenses] = await Promise.all([
                this.prisma.expense.aggregate({
                    where,
                    _sum: { amount: true },
                    _count: true,
                }),
                this.prisma.expense.groupBy({
                    by: ['categoryId'],
                    where,
                    _sum: { amount: true },
                    _count: true,
                }),
                this.prisma.expense.findMany({
                    where,
                    include: { category: true },
                    orderBy: { date: 'desc' },
                    take: 5,
                }),
            ]);

            const categoryIds = byCategoryRaw
                .map(item => item.categoryId)
                .filter((id): id is string => id !== null);

            const categories = categoryIds.length > 0
                ? await this.prisma.category.findMany({
                    where: { id: { in: categoryIds } },
                })
                : [];

            const categoryMap = new Map(categories.map(c => [c.id, c]));

            const byCategory: Record<string, { total: number; count: number; color: string | null }> = {};
            for (const item of byCategoryRaw) {
                if (!item.categoryId) continue;
                const cat = categoryMap.get(item.categoryId);
                if (!cat) continue;
                byCategory[cat.name] = {
                    total: Number(item._sum.amount || 0),
                    count: item._count,
                    color: cat.color,
                };
            }

            return {
                total: Number(totals._sum.amount || 0),
                count: totals._count,
                byCategory,
                expenses: recentExpenses,
            };
        } catch (error) {
            this.logger.error(`❌ Error in getStats for user ${userId}:`, error.message);
            throw error;
        }
    }
}
