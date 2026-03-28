import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetBudgetDto } from './dto/set-budget.dto';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class BudgetsService {
    private openai: OpenAI | null = null;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        if (apiKey) {
            this.openai = new OpenAI({ apiKey });
        }
    }

    async setBudget(userId: string, dto: SetBudgetDto, targetMonth?: number, targetYear?: number) {
        // Verify category exists
        const category = await this.prisma.category.findUnique({
            where: { id: dto.categoryId },
        });

        if (!category) {
            throw new NotFoundException('Category not found');
        }

        const now = new Date();
        const year = targetYear ?? now.getFullYear();
        const month = targetMonth !== undefined ? targetMonth : now.getMonth();

        const periodStart = new Date(year, month, 1, 0, 0, 0, 0);
        const periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

        const existingBudget = await this.prisma.budget.findFirst({
            where: {
                userId,
                categoryId: dto.categoryId,
                period: dto.period || 'monthly',
                startDate: {
                    gte: periodStart,
                    lte: periodEnd
                }
            },
        });

        const startDate = new Date(year, month, 1, 0, 0, 0, 0);

        if (existingBudget) {
            return this.prisma.budget.update({
                where: { id: existingBudget.id },
                data: {
                    amount: dto.amount,
                    isRecurring: dto.isRecurring !== undefined ? dto.isRecurring : existingBudget.isRecurring,
                    recurringMonths: dto.recurringMonths ? JSON.stringify(dto.recurringMonths) : existingBudget.recurringMonths,
                    nextRecurringDate: dto.isRecurring ? new Date(year, month + 1, 1, 0, 0, 0, 0) : null,
                    recurringStatus: dto.isRecurring ? 'active' : 'inactive',
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
                    isRecurring: dto.isRecurring || false,
                    recurringMonths: dto.recurringMonths ? JSON.stringify(dto.recurringMonths) : null,
                    nextRecurringDate: dto.isRecurring ? new Date(year, month + 1, 1, 0, 0, 0, 0) : null,
                    recurringStatus: dto.isRecurring ? 'active' : 'inactive',
                },
            });
        }
    }

    async getBudgets(userId: string, targetMonth?: number, targetYear?: number) {
        const now = new Date();
        const year = targetYear ?? now.getFullYear();
        const month = targetMonth !== undefined ? targetMonth : now.getMonth();

        // Get date range for current period (monthly by default)
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

        // --- LAZY GENERATION LOGIC ---
        const pendingRecurringBudgets = await this.prisma.budget.findMany({
            where: {
                userId,
                isRecurring: true,
                recurringStatus: 'active',
                nextRecurringDate: {
                    lte: endOfMonth,
                },
            },
        });

        for (const b of pendingRecurringBudgets) {
            if (!b.nextRecurringDate) continue;

            let nextDate = new Date(b.nextRecurringDate);
            let currentBudgetIdToDeactivate = b.id;
            let currentBudgetAmount = b.amount;

            while (nextDate.getTime() <= endOfMonth.getTime()) {
                const genYear = nextDate.getFullYear();
                const genMonth = nextDate.getMonth();
                const genStart = new Date(genYear, genMonth, 1);
                const nextNextDate = new Date(genYear, genMonth + 1, 1);

                // Check if target generation month already has a budget for this category
                const existing = await this.prisma.budget.findFirst({
                    where: {
                        userId,
                        categoryId: b.categoryId,
                        startDate: {
                            gte: genStart,
                            lte: new Date(genYear, genMonth + 1, 0, 23, 59, 59, 999)
                        }
                    }
                });

                let shouldCreate = true;
                if (b.recurringMonths) {
                    try {
                        const parsedMonths = JSON.parse(b.recurringMonths);
                        if (Array.isArray(parsedMonths) && parsedMonths.length > 0) {
                            if (!parsedMonths.includes(genMonth)) {
                                shouldCreate = false;
                            }
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }

                if (!existing && shouldCreate) {
                    // Deactivate old baton
                    await this.prisma.budget.update({
                        where: { id: currentBudgetIdToDeactivate },
                        data: { recurringStatus: 'inactive', nextRecurringDate: null }
                    });

                    const created = await this.prisma.budget.create({
                        data: {
                            userId,
                            categoryId: b.categoryId,
                            amount: currentBudgetAmount,
                            period: b.period,
                            startDate: genStart,
                            isRecurring: true,
                            recurringMonths: b.recurringMonths,
                            nextRecurringDate: nextNextDate,
                            recurringStatus: 'active'
                        }
                    });
                    currentBudgetIdToDeactivate = created.id;
                } else if (existing) {
                    // Deactivate old baton if different
                    if (currentBudgetIdToDeactivate !== existing.id) {
                        await this.prisma.budget.update({
                            where: { id: currentBudgetIdToDeactivate },
                            data: { recurringStatus: 'inactive', nextRecurringDate: null }
                        });
                    }

                    // If a budget somehow got manually created in the middle of a skipped sequence, it takes the baton!
                    const updated = await this.prisma.budget.update({
                        where: { id: existing.id },
                        data: {
                            isRecurring: true,
                            recurringMonths: b.recurringMonths,
                            nextRecurringDate: nextNextDate,
                            recurringStatus: 'active'
                        }
                    });
                    currentBudgetIdToDeactivate = updated.id;
                    currentBudgetAmount = updated.amount; // update the amount carried forward if it changed manually
                } else {
                    // !existing && !shouldCreate -> Skipped month!
                    // Advance the baton on the CURRENT carrier without creating a new record
                    await this.prisma.budget.update({
                        where: { id: currentBudgetIdToDeactivate },
                        data: { nextRecurringDate: nextNextDate }
                    });
                }

                nextDate = nextNextDate;
            }
        }
        // --- END LAZY GENERATION ---

        // Fetch all budgets for this user for the specific month
        const budgets = await this.prisma.budget.findMany({
            where: { 
                userId,
                startDate: {
                    gte: startOfMonth,
                    lte: endOfMonth
                }
            },
            include: {
                category: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // For each budget, calculate spent amount from expenses in the current period
        const budgetsWithSpending = await Promise.all(
            budgets.map(async (budget) => {
                let periodStart: Date;
                let periodEnd: Date;

                if (budget.period === 'weekly') {
                    // For weekly budgets, if observing past month, we might want to just show the whole month
                    // or respect the standard weekly logic but offset. For simplicity, we just use month logic if history is selected,
                    // but we'll try to use standard weekly if it's the current month.
                    if (targetMonth === undefined || (targetMonth === now.getMonth() && targetYear === now.getFullYear())) {
                        const dayOfWeek = now.getDay();
                        periodStart = new Date(now);
                        periodStart.setDate(now.getDate() - dayOfWeek);
                        periodStart.setHours(0, 0, 0, 0);
                        periodEnd = new Date(periodStart);
                        periodEnd.setDate(periodStart.getDate() + 6);
                        periodEnd.setHours(23, 59, 59, 999);
                    } else {
                        // Fallback to monthly view for past weekly budgets to give a snapshot
                        periodStart = startOfMonth;
                        periodEnd = endOfMonth;
                    }
                } else if (budget.period === 'yearly') {
                    periodStart = new Date(year, 0, 1);
                    periodEnd = new Date(year, 11, 31, 23, 59, 59, 999);
                } else {
                    // monthly (default)
                    periodStart = startOfMonth;
                    periodEnd = endOfMonth;
                }

                const spentResult = await this.prisma.expense.aggregate({
                    where: {
                        userId,
                        categoryId: budget.categoryId,
                        date: {
                            gte: periodStart,
                            lte: periodEnd,
                        },
                    },
                    _sum: {
                        amount: true,
                    },
                });

                const spent = Number(spentResult._sum.amount || 0);
                const budgetAmount = Number(budget.amount);
                const remaining = budgetAmount - spent;
                const percentUsed =
                    budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0;

                return {
                    id: budget.id,
                    categoryId: budget.categoryId,
                    category: budget.category,
                    amount: budgetAmount,
                    period: budget.period,
                    startDate: budget.startDate,
                    spent,
                    remaining,
                    percentUsed,
                    isOverBudget: spent > budgetAmount,
                };
            }),
        );

        // Calculate totals
        const totalAllocated = budgetsWithSpending.reduce(
            (sum, b) => sum + b.amount,
            0,
        );
        const totalSpent = budgetsWithSpending.reduce(
            (sum, b) => sum + b.spent,
            0,
        );

        return {
            budgets: budgetsWithSpending,
            summary: {
                totalAllocated,
                totalSpent,
                totalRemaining: totalAllocated - totalSpent,
                budgetCount: budgetsWithSpending.length,
            },
        };
    }

    async deleteBudget(userId: string, budgetId: string) {
        const budget = await this.prisma.budget.findUnique({
            where: { id: budgetId },
        });

        if (!budget) {
            throw new NotFoundException('Budget not found');
        }

        if (budget.userId !== userId) {
            throw new ForbiddenException('You do not own this budget');
        }

        return this.prisma.budget.delete({
            where: { id: budgetId },
        });
    }

    async getBudgetSuggestions(userId: string, categoryId: string, location?: string, shoppingType?: string) {
        // Get category info
        const category = await this.prisma.category.findUnique({
            where: { id: categoryId },
        });

        if (!category) {
            throw new NotFoundException('Category not found');
        }

        // Get the user's budget for this category
        const budget = await this.prisma.budget.findFirst({
            where: { userId, categoryId },
        });

        const budgetAmount = budget ? Number(budget.amount) : null;

        // Get recent expenses in this category for context
        const recentExpenses = await this.prisma.expense.findMany({
            where: { userId, categoryId },
            orderBy: { date: 'desc' },
            take: 10,
            select: { merchant: true, amount: true, description: true },
        });

        // If no OpenAI API key, return empty suggestions
        if (!this.openai) {
            return {
                category: category.name,
                budgetAmount,
                suggestions: [],
            };
        }

        try {
            const merchantContext =
                recentExpenses.length > 0
                    ? `Recent spending: ${recentExpenses
                        .map(
                            (e) =>
                                `${e.merchant || e.description || 'Unknown'} (LKR ${Number(e.amount).toLocaleString()})`,
                        )
                        .join(', ')}`
                    : 'No recent spending data.';

            const locationContext = location ? `specifically in or near ${location}` : `in Sri Lanka`;
            
            let shoppingTypeContext = '';
            // Only apply shopping type if the category suggests shopping-related activities (Shopping, Groceries, etc)
            if (shoppingType && ["shopping", "groceries", "food", "dining", "entertainment"].includes(category.name.toLowerCase())) {
                shoppingTypeContext = `The user is specifically looking for suggestions related to: ${shoppingType}.`;
            }

            const prompt = `You are a smart financial advisor for Sri Lanka. The user has a ${budget?.period || 'monthly'} budget of ${budgetAmount ? `LKR ${budgetAmount.toLocaleString()}` : 'unspecified amount'} for "${category.name}".
${merchantContext}
${shoppingTypeContext}

Suggest 5 specific places, stores, or services ${locationContext} where the user can spend wisely in the "${category.name}" category. For each suggestion, provide:
- name: The place/store name
- tip: A short tip on how to save money there (1 sentence)  
- estimatedSaving: Approximate percentage they could save

Return ONLY valid JSON array, no markdown, no code blocks:
[{"name":"...", "tip":"...", "estimatedSaving":"..."}]`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
            });

            const text = response.choices[0]?.message?.content?.trim() ?? '';

            // Parse the JSON from the response
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const suggestions = JSON.parse(jsonMatch[0]);
                return {
                    category: category.name,
                    budgetAmount,
                    suggestions,
                };
            }

            return {
                category: category.name,
                budgetAmount,
                suggestions: [],
            };
        } catch (error) {
            console.error('OpenAI API error:', error);
            return {
                category: category.name,
                budgetAmount,
                suggestions: [],
            };
        }
    }
}
