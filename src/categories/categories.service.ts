import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
    constructor(private prisma: PrismaService) { }

    // Default categories to seed for new users
    private defaultCategories = [
        { name: 'Food', icon: '🍔', color: '#FF6B6B' },
        { name: 'Transport', icon: '🚗', color: '#4ECDC4' },
        { name: 'Shopping', icon: '🛍️', color: '#95E1D3' },
        { name: 'Entertainment', icon: '🎬', color: '#F38181' },
        { name: 'Bills', icon: '💡', color: '#AA96DA' },
        { name: 'Health', icon: '⚕️', color: '#FCBAD3' },
        { name: 'Education', icon: '📚', color: '#A8D8EA' },
        { name: 'Housing', icon: '🏠', color: '#FFD93D' },
        { name: 'Travel', icon: '✈️', color: '#6BCB77' },
        { name: 'Other', icon: '📌', color: '#9D9D9D' },
    ];

    /**
     * Seed default categories for a new user
     */
    async seedDefaultCategories(userId: string) {
        const categories = this.defaultCategories.map(cat => ({
            userId,
            name: cat.name,
            icon: cat.icon,
            color: cat.color,
            isDefault: true,
        }));

        await this.prisma.category.createMany({
            data: categories,
        });
    }

    /**
     * Create a new category
     */
    async create(userId: string, createCategoryDto: CreateCategoryDto) {
        return this.prisma.category.create({
            data: {
                userId,
                name: createCategoryDto.name,
                icon: createCategoryDto.icon,
                color: createCategoryDto.color,
                budgetAmount: createCategoryDto.budgetAmount,
                isDefault: false,
            },
        });
    }

    /**
     * Get all categories for a user
     */
    async findAll(userId: string) {
        return this.prisma.category.findMany({
            where: { userId },
            orderBy: [
                { isDefault: 'desc' }, // Default categories first
                { createdAt: 'asc' },
            ],
        });
    }

    /**
     * Get a specific category by ID
     */
    async findOne(userId: string, id: string) {
        const category = await this.prisma.category.findUnique({
            where: { id },
        });

        if (!category) {
            throw new NotFoundException(`Category with ID ${id} not found`);
        }

        if (category.userId !== userId) {
            throw new ForbiddenException('You do not have access to this category');
        }

        return category;
    }

    /**
     * Update a category
     */
    async update(userId: string, id: string, updateCategoryDto: UpdateCategoryDto) {
        // Verify ownership
        const category = await this.findOne(userId, id);

        // Prevent updating certain fields on default categories
        if (category.isDefault && updateCategoryDto.name) {
            throw new BadRequestException('Cannot change the name of a default category');
        }

        return this.prisma.category.update({
            where: { id },
            data: {
                name: updateCategoryDto.name,
                icon: updateCategoryDto.icon,
                color: updateCategoryDto.color,
                budgetAmount: updateCategoryDto.budgetAmount,
            },
        });
    }

    /**
     * Delete a category
     */
    async remove(userId: string, id: string) {
        // Verify ownership
        const category = await this.findOne(userId, id);

        // Prevent deletion of default categories
        if (category.isDefault) {
            throw new BadRequestException('Cannot delete a default category');
        }

        await this.prisma.category.delete({
            where: { id },
        });

        return { message: 'Category deleted successfully' };
    }
}
