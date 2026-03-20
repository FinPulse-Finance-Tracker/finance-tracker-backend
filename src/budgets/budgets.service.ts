import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetBudgetDto } from './dto/set-budget.dto';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class BudgetsService {
    private genAI: GoogleGenerativeAI | null = null;

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) {
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
        }
    }

    async setBudget(userId: string, dto: SetBudgetDto) {
        // Verify category exists
        const category = await this.prisma.category.findUnique({
            where: { id: dto.categoryId },
        });

        if (!category) {
            throw new NotFoundException('Category not found');
        }

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

    async getBudgets(userId: string) {
        const now = new Date();

        // Get date range for current period (monthly by default)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
        );

        // Fetch all budgets for this user with their categories
        const budgets = await this.prisma.budget.findMany({
            where: { userId },
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
                    const dayOfWeek = now.getDay();
                    periodStart = new Date(now);
                    periodStart.setDate(now.getDate() - dayOfWeek);
                    periodStart.setHours(0, 0, 0, 0);
                    periodEnd = new Date(periodStart);
                    periodEnd.setDate(periodStart.getDate() + 6);
                    periodEnd.setHours(23, 59, 59, 999);
                } else if (budget.period === 'yearly') {
                    periodStart = new Date(now.getFullYear(), 0, 1);
                    periodEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
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

    async getBudgetSuggestions(userId: string, categoryId: string) {
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

        // If no Gemini API key, return hardcoded suggestions
        if (!this.genAI) {
            return this.getFallbackSuggestions(category.name);
        }

        try {
            const model = this.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
            });

            const merchantContext =
                recentExpenses.length > 0
                    ? `Recent spending: ${recentExpenses
                        .map(
                            (e) =>
                                `${e.merchant || e.description || 'Unknown'} (LKR ${Number(e.amount).toLocaleString()})`,
                        )
                        .join(', ')}`
                    : 'No recent spending data.';

            const prompt = `You are a smart financial advisor for Sri Lanka. The user has a ${budget?.period || 'monthly'} budget of ${budgetAmount ? `LKR ${budgetAmount.toLocaleString()}` : 'unspecified amount'} for "${category.name}".
${merchantContext}

Suggest 5 specific places, stores, or services in Sri Lanka where the user can spend wisely in the "${category.name}" category. For each suggestion, provide:
- name: The place/store name
- tip: A short tip on how to save money there (1 sentence)  
- estimatedSaving: Approximate percentage they could save

Return ONLY valid JSON array, no markdown, no code blocks:
[{"name":"...", "tip":"...", "estimatedSaving":"..."}]`;

            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();

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

            return this.getFallbackSuggestions(category.name);
        } catch (error) {
            console.error('Gemini API error:', error);
            return this.getFallbackSuggestions(category.name);
        }
    }

    private getFallbackSuggestions(categoryName: string) {
        const fallbacks: Record<
            string,
            Array<{ name: string; tip: string; estimatedSaving: string }>
        > = {
            Food: [
                {
                    name: 'Keells Super',
                    tip: 'Use their loyalty card for extra discounts on weekends',
                    estimatedSaving: '10-15%',
                },
                {
                    name: 'Arpico Supercenter',
                    tip: 'Buy in bulk for household staples to save more',
                    estimatedSaving: '12-18%',
                },
                {
                    name: 'Laugfs Supermarket',
                    tip: 'Check weekly promotions every Wednesday',
                    estimatedSaving: '8-12%',
                },
                {
                    name: 'Local Pola (Market)',
                    tip: 'Fresh vegetables and fruits at wholesale prices',
                    estimatedSaving: '20-30%',
                },
                {
                    name: 'Cargills FoodCity',
                    tip: 'Use the FoodCity app for digital coupons',
                    estimatedSaving: '5-10%',
                },
            ],
            Transport: [
                {
                    name: 'PickMe / Uber',
                    tip: 'Compare both apps before booking — prices vary by time',
                    estimatedSaving: '10-20%',
                },
                {
                    name: 'Sri Lanka Railways',
                    tip: 'Book 2nd class for comfortable long-distance travel at low cost',
                    estimatedSaving: '50-70%',
                },
                {
                    name: 'SLTB Bus Service',
                    tip: 'Use express buses for faster commute with AC comfort',
                    estimatedSaving: '60-80%',
                },
                {
                    name: 'Lanka IOC / Ceylon Petroleum',
                    tip: 'Track fuel prices and fill up on discount days',
                    estimatedSaving: '3-5%',
                },
                {
                    name: 'Carpooling',
                    tip: 'Share rides with colleagues for daily commute savings',
                    estimatedSaving: '40-50%',
                },
            ],
        };

        const suggestions = fallbacks[categoryName] || [
            {
                name: 'Shop around',
                tip: 'Compare prices at 3 different stores before purchasing',
                estimatedSaving: '10-15%',
            },
            {
                name: 'Use loyalty programs',
                tip: 'Sign up for store loyalty cards to earn points and discounts',
                estimatedSaving: '5-10%',
            },
            {
                name: 'Buy during sales',
                tip: 'Wait for seasonal sales and promotional events',
                estimatedSaving: '15-30%',
            },
            {
                name: 'Use digital coupons',
                tip: 'Download store apps for exclusive digital discounts',
                estimatedSaving: '5-12%',
            },
            {
                name: 'Bulk purchases',
                tip: 'Buy frequently used items in bulk for better unit prices',
                estimatedSaving: '10-20%',
            },
        ];

        return {
            category: categoryName,
            budgetAmount: null,
            suggestions,
        };
    }
}
