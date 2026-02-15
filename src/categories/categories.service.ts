import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
    constructor(private prisma: PrismaService) { }

    // Get all categories (default + user's custom) with monthly stats
    async findAll(userId: string) {
        const categories = await this.prisma.category.findMany({
            where: {
                OR: [
                    { isDefault: true },       // Default categories
                    { userId: userId },         // User's custom categories
                ],
            },
            orderBy: [
                { isDefault: 'desc' },       // Default first
                { name: 'asc' },             // Then alphabetical
            ],
        });

        // Get start and end of current month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        // Single grouped query instead of N+1 per-category aggregates
        const categoryIds = categories.map(c => c.id);

        // Fetch user-specific budgets for these categories
        const userBudgets = await this.prisma.budget.findMany({
            where: {
                userId,
                categoryId: { in: categoryIds },
                period: 'monthly', // Assuming monthly budgets for now
            },
        });

        const budgetMap = new Map(
            userBudgets.map(b => [b.categoryId, Number(b.amount || 0)])
        );

        const spending = await this.prisma.expense.groupBy({
            by: ['categoryId'],
            where: {
                userId,
                categoryId: { in: categoryIds },
                date: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
            _sum: {
                amount: true,
            },
        });

        const spendingMap = new Map(
            spending.map(s => [s.categoryId, Number(s._sum.amount || 0)]),
        );

        const categoriesWithStats = categories.map(category => {
            // Use user-specific budget if available, otherwise fallback to default
            const userBudget = budgetMap.get(category.id);
            const budgetAmount = userBudget !== undefined ? userBudget : Number(category.budgetAmount || 0);

            return {
                ...category,
                budgetAmount, // Override with user budget
                monthlySpent: spendingMap.get(category.id) || 0,
            };
        });

        return categoriesWithStats;
    }

    // Create custom category
    async create(userId: string, createCategoryDto: CreateCategoryDto) {
        return this.prisma.category.create({
            data: {
                ...createCategoryDto,
                userId,
                isDefault: false,
            },
        });
    }

    // Get single category
    async findOne(id: string, userId: string) {
        const category = await this.prisma.category.findUnique({
            where: { id },
        });

        if (!category) {
            throw new NotFoundException('Category not found');
        }

        // Check if user has access (default or owns it)
        if (!category.isDefault && category.userId !== userId) {
            throw new ForbiddenException('You do not have access to this category');
        }

        return category;
    }

    // Update custom category
    async update(id: string, userId: string, updateCategoryDto: UpdateCategoryDto) {
        const category = await this.findOne(id, userId);

        if (category.isDefault) {
            throw new ForbiddenException('Cannot modify system categories');
        }

        return this.prisma.category.update({
            where: { id },
            data: updateCategoryDto,
        });
    }

    // Delete custom category
    async remove(id: string, userId: string) {
        const category = await this.findOne(id, userId);

        if (category.isDefault) {
            throw new ForbiddenException('Cannot delete system categories');
        }

        return this.prisma.category.delete({
            where: { id },
        });
    }

    /**
     * Placeholder for seeding user-specific data if needed in the future.
     * With the current shared category system, default categories (userId: null, isDefault: true)
     * are automatically available to all users.
     */
    async seedDefaultCategories(userId: string) {
        // No action needed for shared categories, but method must exist for Auth/Clerk services
        return;
    }
}
