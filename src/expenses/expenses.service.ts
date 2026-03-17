import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
    private readonly logger = new Logger(ExpensesService.name);
    constructor(private prisma: PrismaService) { }

    // Create new expense
    async create(userId: string, createExpenseDto: CreateExpenseDto) {
        const { date, nextRecurringDate, amount, ...rest } = createExpenseDto;

        const data: any = {
            ...rest,
            amount,
            date: new Date(date),
            userId,
        };

        // Handle recurring dates if provided or needed
        if (nextRecurringDate) {
            data.nextRecurringDate = new Date(nextRecurringDate);
        }

        if (data.isRecurring && data.recurringInterval) {
            if (!data.nextRecurringDate) {
                // Default next run is interval away from the current record's date
                data.nextRecurringDate = this.calculateNextDate(data.date, data.recurringInterval);
            }
            if (!data.recurringStatus) {
                data.recurringStatus = 'active';
            }
        }

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

        const { date, nextRecurringDate, ...rest } = updateExpenseDto;
        const data: any = { ...rest };

        if (date) {
            data.date = new Date(date);
        }

        if (nextRecurringDate) {
            data.nextRecurringDate = new Date(nextRecurringDate);
        }

        // Logical merge for recurring settings
        const isRecurringMerged = data.isRecurring !== undefined ? data.isRecurring : currentExpense.isRecurring;
        const intervalMerged = data.recurringInterval || (currentExpense as any).recurringInterval;

        if (isRecurringMerged && intervalMerged) {
            // Recalculate next date if recurrence was just enabled, or interval changed, or next date is missing
            const wasRecurring = currentExpense.isRecurring;
            const intervalChanged = data.recurringInterval && data.recurringInterval !== (currentExpense as any).recurringInterval;

            if (!wasRecurring || intervalChanged || !(currentExpense as any).nextRecurringDate) {
                const baseDate = data.date || currentExpense.date;
                data.nextRecurringDate = this.calculateNextDate(new Date(baseDate), intervalMerged);
            }

            if (data.recurringStatus === undefined && !(currentExpense as any).recurringStatus) {
                data.recurringStatus = 'active';
            }
        } else if (isRecurringMerged === false) {
            // Explicitly clearing recurring state
            data.recurringInterval = null;
            data.nextRecurringDate = null;
            data.recurringStatus = null;
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
    }

    /**
     * Daily Cron Job to process recurring expenses
     */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleRecurringExpenses() {
        this.logger.log('Processing recurring expenses job started...');
        const now = new Date();

        try {
            // Find due active recurring expenses
            const dueExpenses = await this.prisma.expense.findMany({
                where: {
                    isRecurring: true,
                    recurringStatus: 'active',
                    nextRecurringDate: {
                        lte: now
                    },
                    recurringInterval: {
                        not: null
                    }
                }
            } as any);

            this.logger.log(`Found ${dueExpenses.length} potential recurring expenses to process`);

            for (const expense of dueExpenses) {
                const interval = (expense as any).recurringInterval;
                if (!interval) continue;

                // 1. Create a shadow copy of the template record
                await this.prisma.expense.create({
                    data: {
                        userId: expense.userId,
                        categoryId: expense.categoryId,
                        amount: expense.amount,
                        description: expense.description,
                        merchant: expense.merchant,
                        paymentMethod: expense.paymentMethod,
                        notes: expense.notes,
                        date: (expense as any).nextRecurringDate || now,
                        source: 'recurring_job',
                        isRecurring: false, // Copies are not templates
                    }
                });

                // 2. Advance the template's next run date
                const nextDate = this.calculateNextDate(
                    (expense as any).nextRecurringDate || now,
                    interval
                );

                await this.prisma.expense.update({
                    where: { id: expense.id },
                    data: {
                        nextRecurringDate: nextDate
                    } as any
                });
            }

            if (dueExpenses.length > 0) {
                this.logger.log(`Finished processing ${dueExpenses.length} recurring expenses`);
            }
        } catch (error) {
            this.logger.error('CRITICAL ERROR in recurring expenses job:', error.stack || error);
        }
    }

    private calculateNextDate(currentDate: Date, interval: string): Date {
        const nextDate = new Date(currentDate);
        switch (interval) {
            case 'daily':
                nextDate.setDate(nextDate.getDate() + 1);
                break;
            case 'weekly':
                nextDate.setDate(nextDate.getDate() + 7);
                break;
            case 'monthly':
                nextDate.setMonth(nextDate.getMonth() + 1);
                break;
            case 'yearly':
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                break;
        }
        return nextDate;
    }
}
