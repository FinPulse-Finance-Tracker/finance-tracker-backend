import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { PaginatedExpensesDto, ExpenseStatisticsDto } from './dto/expense.dto';

@Injectable()
export class ExpensesService {
    constructor(private prisma: PrismaService) { }

    /**
     * Create a new expense
     */
    async create(userId: string, createExpenseDto: CreateExpenseDto) {
        // Validate category belongs to user if categoryId is provided
        if (createExpenseDto.categoryId) {
            const category = await this.prisma.category.findUnique({
                where: { id: createExpenseDto.categoryId },
            });

            if (!category) {
                throw new NotFoundException('Category not found');
            }

            if (category.userId !== userId) {
                throw new ForbiddenException('You do not have access to this category');
            }
        }

        return this.prisma.expense.create({
            data: {
                userId,
                amount: createExpenseDto.amount.toString(),
                date: new Date(createExpenseDto.date),
                categoryId: createExpenseDto.categoryId,
                description: createExpenseDto.description,
                merchant: createExpenseDto.merchant,
                paymentMethod: createExpenseDto.paymentMethod,
                isRecurring: createExpenseDto.isRecurring || false,
                source: 'manual',
            },
            include: {
                category: true,
            },
        });
    }

    /**
     * Get all expenses with filtering, pagination, and sorting
     */
    async findAll(userId: string, queryDto: QueryExpenseDto): Promise<PaginatedExpensesDto> {
        const {
            categoryId,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            merchant,
            page = 1,
            limit = 20,
            sortBy = 'date',
            sortOrder = 'desc',
        } = queryDto;

        // Build filter conditions
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

        if (minAmount !== undefined || maxAmount !== undefined) {
            where.amount = {};
            if (minAmount !== undefined) {
                where.amount.gte = minAmount.toString();
            }
            if (maxAmount !== undefined) {
                where.amount.lte = maxAmount.toString();
            }
        }

        if (merchant) {
            where.merchant = {
                contains: merchant,
                mode: 'insensitive',
            };
        }

        // Get total count
        const total = await this.prisma.expense.count({ where });

        // Get paginated expenses
        const expenses = await this.prisma.expense.findMany({
            where,
            include: {
                category: true,
            },
            orderBy: {
                [sortBy]: sortOrder,
            },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            data: expenses as any,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Get a specific expense by ID
     */
    async findOne(userId: string, id: string) {
        const expense = await this.prisma.expense.findUnique({
            where: { id },
            include: {
                category: true,
            },
        });

        if (!expense) {
            throw new NotFoundException(`Expense with ID ${id} not found`);
        }

        if (expense.userId !== userId) {
            throw new ForbiddenException('You do not have access to this expense');
        }

        return expense;
    }

    /**
     * Update an expense
     */
    async update(userId: string, id: string, updateExpenseDto: UpdateExpenseDto) {
        // Verify ownership
        await this.findOne(userId, id);

        // Validate category if being updated
        if (updateExpenseDto.categoryId) {
            const category = await this.prisma.category.findUnique({
                where: { id: updateExpenseDto.categoryId },
            });

            if (!category) {
                throw new NotFoundException('Category not found');
            }

            if (category.userId !== userId) {
                throw new ForbiddenException('You do not have access to this category');
            }
        }

        return this.prisma.expense.update({
            where: { id },
            data: {
                amount: updateExpenseDto.amount?.toString(),
                date: updateExpenseDto.date ? new Date(updateExpenseDto.date) : undefined,
                categoryId: updateExpenseDto.categoryId,
                description: updateExpenseDto.description,
                merchant: updateExpenseDto.merchant,
                paymentMethod: updateExpenseDto.paymentMethod,
                isRecurring: updateExpenseDto.isRecurring,
            },
            include: {
                category: true,
            },
        });
    }

    /**
     * Delete an expense
     */
    async remove(userId: string, id: string) {
        // Verify ownership
        await this.findOne(userId, id);

        await this.prisma.expense.delete({
            where: { id },
        });

        return { message: 'Expense deleted successfully' };
    }

    /**
     * Get spending statistics by category and period
     */
    async getStatistics(
        userId: string,
        startDate?: string,
        endDate?: string,
    ): Promise<ExpenseStatisticsDto> {
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

        // Get all expenses grouped by category
        const expenses = await this.prisma.expense.findMany({
            where,
            include: {
                category: true,
            },
        });

        // Calculate total spending
        const totalSpending = expenses.reduce((sum, expense) => {
            return sum + parseFloat(expense.amount.toString());
        }, 0);

        // Group by category
        const categoryMap = new Map<string, {
            categoryId: string;
            categoryName: string;
            categoryIcon?: string;
            categoryColor?: string;
            total: number;
            count: number;
        }>();

        expenses.forEach(expense => {
            const categoryId = expense.categoryId || 'uncategorized';
            const categoryName = expense.category?.name || 'Uncategorized';
            const categoryIcon = expense.category?.icon;
            const categoryColor = expense.category?.color;

            if (!categoryMap.has(categoryId)) {
                categoryMap.set(categoryId, {
                    categoryId,
                    categoryName,
                    categoryIcon: categoryIcon || undefined,
                    categoryColor: categoryColor || undefined,
                    total: 0,
                    count: 0,
                });
            }

            const category = categoryMap.get(categoryId)!;
            category.total += parseFloat(expense.amount.toString());
            category.count += 1;
        });

        // Convert to array and calculate percentages
        const byCategory = Array.from(categoryMap.values())
            .map(cat => ({
                ...cat,
                percentage: totalSpending > 0 ? (cat.total / totalSpending) * 100 : 0,
            }))
            .sort((a, b) => b.total - a.total);

        return {
            totalSpending,
            byCategory,
            period: {
                startDate: startDate || '',
                endDate: endDate || '',
            },
        };
    }

    /**
     * Get total spending for a date range
     */
    async getTotalSpending(userId: string, startDate?: string, endDate?: string): Promise<number> {
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

        const result = await this.prisma.expense.aggregate({
            where,
            _sum: {
                amount: true,
            },
        });

        return result._sum.amount ? parseFloat(result._sum.amount.toString()) : 0;
    }
}
